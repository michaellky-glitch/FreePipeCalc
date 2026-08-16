# Domestic Water (DW) module — agreed design

Michael's request, 2026-08-12; re-architected 2026-08-16 to isolate the
known-good GGA (see **Architecture v2**). The DATA and the sizing CORE are built
(v0.16.31–32); the DISCIPLINE split and the plumbing UI/report are what remain.

## Decisions

> **SUPERSEDED, 2026-08-16.** Decision 1 below (DW lives inside DESIGN, sharing
> the GGA network) was reversed by Michael to DE-RISK the known-good solver. The
> current architecture is in "**Architecture v2**" further down; it is what the
> next session builds. Decision 2 (a plumbing network is a TREE) still holds.
> v0.16.31–v0.16.32 built the DATA, the model helpers and `M.plumbingSizing`
> under the old plan; those are reusable as-is. What changes is WHERE the UI and
> the solve live — a separate discipline, not an outflow type inside Design.

1. ~~**Lives inside DESIGN**, not a new mode. Plumbing is a new OUTFLOW TYPE plus
   a Domestic-Water behaviour, beside `settings.systemType`.~~ **Reversed** — see
   Architecture v2.
2. **A plumbing network must be a TREE.** "Downstream FU" is only defined when
   there is one path from the source, which is how real DW is drawn. A loop on a
   plumbing network raises an error (`DW_LOOP`). Still holds.

## Architecture v2 — a file is one DISCIPLINE (agreed 2026-08-16)

The motivation is SAFETY: the mature GGA (closed-loop + generic pumped systems,
thermal, controls) must not be reworked to carry fixture-unit diversity. So the
two are kept apart at the top level.

* **`m.discipline` = `'hydronic'` (default) | `'plumbing'`.** A saved file is one
  or the other; the user works in one. This is the whole isolation: in a plumbing
  file the GGA is **never invoked** — not "left untouched", not on the code path.
* **The switch is the repurposed loop-type chip.** The `#system-chip`
  (OPEN LOOP / CLOSED LOOP / NO SUPPLY) beside the status chip becomes the
  DISCIPLINE switch: it reads **HYDRONIC** or **PLUMBING** and clicking it toggles
  the discipline. Discipline sits a layer ABOVE the tab bar — a deliberate choice,
  because most hydronic tabs do not apply to plumbing, so they are swapped, not
  crammed in beside CALCULATION. The open/closed-loop reading it used to show is a
  hydronic-only concept and still appears on the calc sheet via
  `systemTypeLabel()`; in a plumbing file it is meaningless and gone.
* **Switching warns.** Toggling the chip on a non-empty model pops a confirm —
  *"Changing an existing model between Hydronic and Plumbing may break it."* — via
  `FD.dialog.confirm`. The two disciplines share geometry but not device
  semantics (a hydronic flow-demand outflow is not a plumbing fixture), so a
  switch can strand device settings; the warning makes that the user's choice.
* **Tab set is per discipline.** The network tab is relabelled by discipline —
  **HYDRONIC** (was "PIPING NETWORK") or **PLUMBING**. Hydronic shows today's tabs
  unchanged. Plumbing shows PLUMBING + a plumbing CALCULATION + SETTINGS +
  DOCUMENTATION, and HIDES THERMAL (and the hydronic HYDRAULIC tab — a plumbing
  system setting, flush-tank/flushometer, replaces it). The network CANVAS,
  drawing tools and save file are SHARED — a node is a node in either — so the
  drawing code is reused, not duplicated.
* **HYDRONIC** = everything today, unchanged: GGA, DESIGN/SIMULATE/CONTROL/
  ANNOTATION modes, THERMAL, HYDRAULIC, the calculation sheet.
* **PLUMBING**: solved ONLY by `M.plumbingSizing`. No SIMULATE, no CONTROL, no
  pumps-as-curves. THERMAL "does almost nothing" (Michael) — hide or blank it.
  An outflow is a FIXTURE (fixture + Variation + count, from `data/plumbing.js`),
  not a flow demand. The calc is the FU schedule → per-pipe diversity flow →
  velocity/PDM at that flow → forward head-loss pass to residual pressure at each
  fixture.
* **Remove the in-Design plumbing UI** added in v0.16.31–32 (the Plumbing outflow
  type + Variation dropdown in the hydronic Design panel, and the DW readout in
  the hydronic pipe panel). DW belongs to the PLUMBING discipline now; `data/
  plumbing.js` and `M.plumbingSizing` stay and move behind the plumbing tab.

### Build phases (v2)

A. **Scaffold.** `m.discipline` (`'hydronic'` default) carried through
   `create`/`toJSON`/`fromJSON`. Repurpose `#system-chip` as the discipline
   switch (label HYDRONIC/PLUMBING, click toggles, confirm warning on a non-empty
   model). Relabel the network tab by discipline and show/hide the auxiliary tabs
   per discipline. Gate the solve so `discipline==='plumbing'` never calls the
   GGA. Hide the in-Design plumbing outflow UI + pipe-panel DW readout (from
   v0.16.31–32) whenever `discipline!=='plumbing'`. No plumbing report yet — the
   plumbing pane can state it is under construction.
B. **Plumbing outflow UI + sizing report** in the plumbing discipline: the
   fixture/Variation/count panel (reuse the v0.16.31–32 controls, now here), and
   a plumbing results object from `plumbingSizing` feeding a per-pipe diversity
   readout on the canvas and a plumbing calculation sheet. Make the
   continuity/imbalance messaging plumbing-aware (or simply absent — there is no
   GGA to imbalance).
C. **Residual pressure (was Phase 3).** Forward head-loss pass from the source
   along the tree to residual pressure at each fixture; sheet reporting.

## The flow model — why it is not the GGA

The GGA imposes demands and solves a looped network for simultaneous flows that
satisfy continuity. Plumbing does not: a pipe's design flow is the total Fixture
Units DOWNSTREAM of it, run through a diversity curve that is deliberately
SUB-ADDITIVE — two 10-FU branches (~0.5 L/s each) merge to a 20-FU main
(~0.8 L/s, not 1.0).

For each pipe, on the tree rooted at the source:

    flow(pipe) = Σ(downstream Generic demands, summed linearly)
               + FUtoFlow( Σ(downstream cold FUs) )

* The **mass imbalance** (Σ outflows ≠ source, pipe flows do not balance at a
  junction) is the diversity effect and is EXPECTED for plumbing. The continuity
  / imbalance checks must become SYSTEM-TYPE-AWARE: still an error for closed
  loop and for Generic-only networks, allowed for plumbing.
* Sizing still uses the existing VELOCITY and PDM checks, evaluated at the
  diversity flow.
* Residual pressure at each fixture comes from a FORWARD head-loss pass from the
  source along the tree — not a simultaneous solve.

So DW has its own small "solver": a downstream accumulation + diversity
conversion + a forward pressure pass, running when plumbing outflows are present.

## Data (transcribe from IPC 2018, cite, `verified: false` until Michael confirms)

* **FU → flow conversion — Table E103.3(E)** (a.k.a. E103.3): two curves,
  **Flush Tank** and **Flushometer**, selected on the HYDRAULIC tab.
  https://codes.iccsafe.org/content/IPC2018/appendix-e-sizing-of-water-piping-system
  (`#IPC2018_AppxE_SecE102.2.1_TblE103.3_3`)
* **Fixture cold FU — Table E103.3(2)**, COLD column only. Fixtures:
  Custom, Bathroom Group, Water Closet, Urinal, Bidet, Shower, Bathtub,
  Private Lavatory, Public Lavatory, Kitchen Sink.
  (`#IPC2018_AppxE_SecE201.1_TblE103.3_2`)

Never invent a cell; transcribe exactly and flag unverified, as with the K
tables and the glycol properties.

## Outflow types

* **Generic** (current) — imposes a flow demand, carried upstream by continuity.
* **Plumbing** — carries a Fixture Unit value (a chosen fixture from the table,
  or Custom FU). Contributes its cold FU to every pipe upstream of it.

A model may mix the two; a pipe's flow is the sum of both contributions.

## Phasing (multi-session; watch the weekly usage)

1. **Data + model + UI. — DONE, v0.16.31.** The Plumbing outflow type, the
   fixture cold-FU table, the FU→flow table (flush tank + flushometer) with the
   HYDRAULIC selector, and the panel to assign a fixture / Custom FU to a
   plumbing outflow. No solver yet. Shipped in `data/plumbing.js`
   (`verified:false`), `M.outflowFU` / `settings.plumbing.system` /
   `demandType`, the outflow DESIGN panel type selector, and
   `test/plumbing.test.js` (39 assertions). Verified live in the browser.
2. **Solver core — DONE, v0.16.32** (integration pending). `M.plumbingSizing(m)`
   walks the tree from the source, accumulates downstream cold FU + generic flow
   per pipe, and sizes `Generic + FD.plumbing.fuToFlow(FU)`. It rejects a loop,
   a missing source, or multiple sources (`DW_LOOP` / `DW_NO_SOURCE` /
   `DW_MULTI_SOURCE`) rather than guessing. Read-only in the PIPE panel.
   Per-outflow **Variation** (occupancy × supply control) picks the fixture's own
   cold-FU row from Table E103.3(2). **Still to integrate:** fold the diversity
   flow into the MAIN solve (`res.flow`) and the CALCULATION SHEET so DW pipes
   size on it and VELOCITY/PDM fire at that flow; make the continuity/imbalance
   checks system-type-aware (expected for DW, an error for closed-loop/Generic)
   once DW flows drive the solve.
3. **Pressure + reporting.** Forward head-loss pass to residual pressure at each
   fixture; sheet reporting.

**Before promoting the data to `verified: true`:** Michael must confirm the IPC
transcription and the per-fixture occupancy/control assumptions noted in
`data/plumbing.js` against his own copy of the code.
