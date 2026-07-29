# Roadmap

Agreed but not yet built. Ordered roughly as discussed; the heating/cooling
work is the headline item for the next version.

Anything already delivered lives in the README status table. Anything that was
*decided against* is at the bottom, with the reason, so it does not get
proposed again.

---

## Next version

### DESIGN and SIMULATION modes

Pump-driven analysis: the engineer specifies a pump curve and the app derives
the flow, instead of specifying flows and deriving the pump. Designed and
agreed; see `docs/SIMULATION-design.md`.

**BUILT** in v0.5.0 — this section is kept as the record of why.

Prototyped before designing — a pump curve patched into the existing solver
found the operating point to ~1e-13 against analytic answers in 10–13
iterations, under a millisecond. **No separate system-curve intersection is
needed; the GGA already is that intersection.** Equipment ΔP needs no new work
either, being already a quadratic resistance.

The real content is semantic: for a pump curve to determine flow, terminals must
become resistances. Hence two modes, with the calculated side greyed and locked,
and DEMAND renamed to OUTFLOW.

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

* ~~**Accessory placement should snap to pipe.**~~ **Done.** Placement always
  did snap; what was missing was any sign of it. The radius is now 28 px and the
  target pipe is highlighted with the insertion point marked.
* **Pipe intersections should default to 90°.** Snap square unless the user
  "wiggles" away from it, then fall back to the 15° increments. The intent is
  that the common case needs no precision from the user.
* **Riser placement should ask which way it goes** — a page dialog (not a
  browser popup) offering the floor above or below, with `z` / `x` shortcuts.
  Some users will not read the toast that currently explains it.
* ~~**Labels should snap to grid.**~~ **Done** — to the world grid, not to
  their own offset, so labels on different anchors line up. Shift overrides.
  Node dragging already snapped.

### Functionality

* **Drag accessories ALONG their pipe.** Partly done: a device body can now be
  dragged as a unit (both endpoints move together, length and orientation
  preserved). What is still missing is constraining that drag to slide along the
  run rather than moving freely. The constraint is that the *angle and the
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

* **TRACE mode** (v0.5.0) — built as designed in `TRACE-design.md`.
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

## Native quadratic pump curves

The TOOLS ▸ Generic Pump Curve builds `h(q) = a + b·q + c·q²`, but the solver
stores `H₀ − a·Q^b`, which has no linear term. Pasting a generated curve
therefore refits it and loses about 1% — see `docs/TOOLS.md`.

Teaching the solver to carry the quadratic directly would remove the loss
entirely, and is no harder than what it already does: `dh/dq = b + 2c·q` is a
cleaner derivative than the power law's. Not done because it changes the stored
model format and so needs a `formatVersion` bump and a migration for curves
already saved.


## Tee coefficients for converging and diverging flow

**Open, and the one outstanding engineering item.**

The structure is built — dividing and combining tees are separate fitting types
and a combining tee charges both of its inlets — but two of the four
coefficients are placeholders:

| Coefficient | L/D | |
|---|---|---|
| `TRUN_CONV` | 20 | placeholder — assumed equal to the dividing run |
| `TBRANCH_CONV` | 90 | placeholder — assumed 1.5× the dividing branch |

Agreed source: **ASHRAE Fundamentals**, for consistency with the K tables
already in `data/ktable.js`.

The honest difficulty is that real tee losses are a function of the flow ratio
Qb/Qc and vary by more than an order of magnitude across it, so a flat L/D
cannot be right everywhere. Two ways forward:

1. **Flat values per case** — enter four numbers from ASHRAE at a representative
   flow ratio. Cheap, no code change, and no worse in kind than the flat L/D the
   spec already mandates.
2. **Flow-ratio dependent** — `fittingsAtNode()` already knows every leg's flow,
   so Qb/Qc is available at the point the fitting is assigned. This would mean a
   curve per case rather than a scalar, and a change to how `fittingLD` is
   stored and edited.

(2) is the right answer eventually. (1) is what unblocks issuing calculations
through branched pipework.
