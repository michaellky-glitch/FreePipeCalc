# Roadmap

Agreed but not yet built. Ordered roughly as discussed; the heating/cooling
work is the headline item for the next version.

Anything already delivered lives in the README status table. Anything that was
*decided against* is at the bottom, with the reason, so it does not get
proposed again.

---

## Next version

### TRACE mode

Trace pipework over a pasted screenshot of an existing drawing. Designed and
agreed; see `docs/TRACE-design.md` for the decisions and the reasoning.

In short: paste event (not the async Clipboard API, which `file://` blocks),
one image per level, downscaled to 2000 px PNG and embedded in the model file,
two-point scale calibration, opacity and invert for working over white PDF
backgrounds, locked once calibrated, never printed.

### Heating / cooling power

The headline feature. The groundwork is already in the model:

* `settings.fluid.specificHeat` (Cp) — stored, marked unused in the UI.
* `pipe.temperature` — per-section fluid temperature, stored, unused.

A section already knows its flow. Given a temperature difference across it,
duty follows from `Q = ṁ·Cp·ΔT` with `ṁ = ρ·q`. The open questions are where ΔT
comes from (per-section entry, per-equipment flow/return, or a system-wide
design ΔT) and how duty is presented — per section, per equipment, or rolled up
per level.

### UX

* **Accessory placement should snap to pipe.** Risers, sources, demands, pumps,
  equipment and valves should use the same snapping the pipe tool does. Risers
  already have generous snapping; the rest still use the plain 10 px radius.
* **Pipe intersections should default to 90°.** Snap square unless the user
  "wiggles" away from it, then fall back to the 15° increments. The intent is
  that the common case needs no precision from the user.
* **Riser placement should ask which way it goes** — a page dialog (not a
  browser popup) offering the floor above or below, with `z` / `x` shortcuts.
  Some users will not read the toast that currently explains it.
* **Dragging nodes and labels should snap to grid.** Node dragging is currently
  free-form; label dragging is free-form by design but should probably snap too.

### Functionality

* **Drag accessories along their pipe.** In EDIT, a pump/valve/equipment should
  slide along the run it sits in. The constraint is that the *angle and the
  total length between the nodes either side must not change* — so it is a
  reposition within a fixed span, not a geometry edit.
* **Inline metadata editing.** Project, engineer, revision and so on should be
  editable directly in the calculation sheet header, the way the Hazen-Williams
  coefficients are editable inside the formula.
* **Split the calculation into two sections.**
  1. *Critical path* — only the sections that set the pump duty.
  2. *All pipes* — the full sheet as it exists now.

  The critical path is already identified, ordered first and highlighted, so
  this is a presentation split rather than new analysis.

---

## Delivered since this list was written

* Open/closed detection, shown live on the PIPING NETWORK ribbon.
* Critical path (index circuit) identification, ordering and highlighting.
* Copy level layout, custom pipe schedules with spreadsheet paste.
* DOCUMENTATION tab.

## Decided against

* **PNG plan export.** Print-to-PDF via the browser is good enough, and SVG
  already covers the vector case. Dropped 2026-07-29.

---

## Still open

* **Darcy-Weisbach friction factor correlation** has not been chosen. All four
  are implemented and selectable. The spread across realistic building-services
  cases is ≤1.4%, so this is a judgement call about auditability rather than
  accuracy — Colebrook-White is the reference the others approximate; Churchill
  covers every flow regime in one expression.
* **`LICENSE.txt` carries a placeholder name.** It needs a real name before the
  repository is published.
