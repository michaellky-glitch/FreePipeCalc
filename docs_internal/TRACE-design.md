# TRACE mode

Implemented in `src/trace.js`. This document records how the feature works and why the decisions were made.


**Purpose.** Let an engineer drop a screenshot of an existing drawing behind the
canvas and trace pipework over it. Two workflows drive the design:

1. **Trace to build** — copy in a drawing, follow the pipework to capture every
   elbow and bend, fine-tune lengths afterwards.
2. **Trace to check** — copy in a drawing and compare it against a model that
   already exists.

Workflow 1 is the demanding one: it is the reason scale calibration matters.

---

## Decisions

| Question | Decision |
|---|---|
| Capture | Paste event (Ctrl+V), with drag-and-drop as fallback |
| Storage | Downscale to 2000 px, PNG, embedded in the `.pnet.json` |
| Scope | One image per **level** |
| Scale | Two-point calibration |
| Printing | Never — trace is a working aid |

---

## 1. Capture

Use the **`paste` event** and read `e.clipboardData.items`.

Do **not** use `navigator.clipboard.read()`. It requires a secure context and a
permission grant; a `file://` origin is not secure, so it would fail in exactly
the deployment the app is built for. The paste event has no such restriction —
it is a user-gesture DOM event with the data already attached.

Verified working: a `ClipboardEvent` carrying an image `File` is extracted
cleanly.

Fallbacks, in order of preference:

1. **Drag and drop** an image file onto the canvas. Works from disk, no dialog.
2. **File picker**, for completeness.

## 2. Encoding and size

Downscale to **2000 px on the long edge** and re-encode as **PNG**.

Measured on a synthetic 4K drawing snip (line art on white, which is what a PDF
screenshot actually is):

| Encoding | Size |
|---|---|
| PNG @ 2000 px | **105 KB** |
| JPEG q0.8 @ 2000 px | 125 KB |
| JPEG q0.85 @ 2400 px | 163 KB |
| Raw 4K PNG | 251 KB |

PNG is both **smaller and lossless** here. That is the opposite of the usual
photographic result, and it is because drawings are large flat white areas with
thin black lines — the case PNG compresses well and JPEG handles badly. JPEG
ringing around black lines is precisely the artefact that makes a background
hard to trace against, so PNG is the right choice on quality grounds as well as
size.

If a photographic image is ever pasted, JPEG would win; not worth branching on
until someone actually does it.

## 3. Storage

Embedded in the model file so a `.pnet.json` stays self-contained — the whole
point of that format.

```
level.trace = {
  src:        'data:image/png;base64,...',
  x, y:       world position of the image's top-left, in metres
  width:      world width in metres   (height follows from the aspect ratio)
  aspect:     natural height / natural width, stored so it survives a reload
  opacity:    0–1
  invert:     bool
  locked:     bool
}
```

Aspect ratio is stored rather than derived, so the image geometry is correct
before the bitmap has finished decoding on load.

**Autosave.** Attempt normally; on `QuotaExceededError`, retry without the
`src` fields and warn that traces need re-pasting. localStorage took 4 MB in
testing, so three or four traces fit comfortably — the fallback is for the
pathological case, not the normal one. Autosave must never fail silently
because of a background image.

**A "discard trace" button** on each level, so the weight can be shed
deliberately.

## 4. Scale calibration

The feature that makes traced geometry worth keeping.

Click two points on the image whose real separation is known — a gridline
spacing, a dimensioned run, a column grid — then type that distance. The image
scales so the two points sit that far apart in model space.

Without it the user is eyeballing scale, and every traced length has to be
retyped afterwards. With it, traced lengths land close enough to keep, which is
what turns workflow 1 from "rough sketch" into "starting point".

Corner handles remain available for rough placement, always aspect-locked.

## 5. Appearance

* **Opacity** slider.
* **Invert** toggle.

A PDF screenshot is black on white. On the dark theme that is a glaring white
slab with the pipework lost in it. Inverted, the background goes dark and the
linework goes light, and blue pipes read clearly on top.

Defaults: dark theme → invert on, opacity ~0.6. Light theme → invert off,
opacity ~0.5.

Also offer **hide grid while tracing** — grid lines over a drawing get noisy,
and the drawing is the reference in this mode, not the grid.

Draw order: trace → grid (if shown) → pipes → labels.

## 6. Mode behaviour

**TRACE** is where the image is manipulated: paste, move, scale, calibrate,
lock, set opacity and invert. It sits in the **ANNOTATE** ribbon alongside MOVE,
ALIGN, DETAIL and TEXT BOX.

The image stays visible in **every** mode — you trace over it with the PIPE or
RISER tool, not with TRACE itself. TRACE is for getting the image right; the
drawing tools are for drawing over it.

**Locked by default once calibrated.** Nothing is more irritating than nudging
a calibrated background while drawing over it.

## 7. Snapping while tracing

Grid-along-ray snapping will fight the user when following a drawing: the whole
point is to follow the lines, not the grid.

When a trace is present on the active level, the drawing tools keep 15° angle
snapping — most pipework is orthogonal, so this helps rather than hinders — but
drop grid snapping. Node and pipe snapping stay, since connecting is still
connecting.

## 8. Printing

Not printed. The trace is a working aid; printed plans stay clean black-on-white
drawings of the model.

---

## Not implemented

* **Rotation.** Screenshots are usually square-on, so rotation is probably not
  needed. Left out until someone wants it.
* **Multiple traces per level.** One trace per level is assumed. A large floor
  plate might want two side by side; not built until asked for.
* **Undo.** Pasting and calibrating are not yet undoable. If they are added, the
  image data will pass through the undo stack. Watch for memory pressure with a
  deep history — snapshots are full model copies. It may be necessary to exclude
  `src` from undo snapshots and hold it separately.
