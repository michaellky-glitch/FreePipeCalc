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

A. **Scaffold. — DONE, v0.16.33.** `m.discipline` (`'hydronic'` default) carried
   through `create`/`toJSON`/`fromJSON` (a legacy or unknown value coerces to
   hydronic). `#system-chip` repurposed as the discipline switch (label
   HYDRONIC/PLUMBING, click toggles, `FD.dialog.confirm` warning on a non-empty
   model). The network tab is relabelled by discipline (HYDRONIC / PLUMBING) and
   THERMAL + HYDRAULIC are hidden in plumbing (with a fallback to the network tab
   if one was active when it was hidden). The solve is gated: `solveNow` and
   `solveSliced` short-circuit to `plumbingSolve` when
   `discipline==='plumbing'`, so `FD.network.solveModel`/`solveModelGen` are
   never on the plumbing code path (verified live: 0 GGA calls). The in-Design
   plumbing UI from v0.16.31–32 is hidden whenever `discipline!=='plumbing'` —
   the outflow-type + fixture/Variation controls in `renderNodeProps`, the
   pipe-panel DW readout in `renderPipeProps`, and the "Plumbing supply" selector
   on the HYDRAULIC tab; the data (`data/plumbing.js`, `M.outflowFU`,
   `M.plumbingSizing`) and the model fields (`demandType`, `fixture`, etc.) stay
   untouched. No plumbing report yet — the CALCULATION pane states it is under
   construction. 4 new model.test assertions (suite 2052).
B. **Plumbing outflow UI + sizing report** in the plumbing discipline. **Largely
   done, v0.17.0** (Michael's 2026-08-16 brief):
   * **Design ribbon** drops the thermal tools (HEAT SOURCE/SINK, HEAT EXCHANGER)
     in plumbing — `#design-thermal-tools` hidden by `applyDiscipline`.
   * **HYDRAULIC tab STAYS** in plumbing (reversed from the Phase A plan, which
     hid it). It now hosts, via `renderPlumbingHydraulic`: the demand-system
     selector, the **editable fixture-FU table** (E103.3(2)) and the **editable
     FU→flow demand table** (E103.3(3), shown/edited in the model's flow unit).
     Only THERMAL is hidden in plumbing now.
   * **Editable tables → per-model overrides.** Edits live sparsely on
     `m.settings.plumbing`: `fu` = `{ "<fixture>.<variation>": FU }`, `demand` =
     `{ flushTank:[[fu,gpm],…], flushometer:[…] }` (materialised whole on first
     edit). Resolved by `M.plumbingFixtureFU` / `M.plumbingDemandCurve` /
     `M.plumbingFuToFlow`, which `outflowFU` and `plumbingSizing` now use — so a
     pipe's flow interpolates off the *edited* curve. Both round-trip through
     save/load (deep-merged in `fromJSON`). "Reset to IPC defaults" per table.
   * **Plumbing CALCULATION sheet** (`renderPlumbingCalc`): per-pipe Section /
     Size / Bore / Downstream FU / (Generic) / Design flow / Velocity, mains
     first, velocity over `warn.velocity` flagged red; totals line; the
     tree-sizing errors (loop / no source / multi source) shown, never guessed.
     There is no GGA to imbalance, so no continuity check.
   * data/plumbing.js `fuToFlow(fu, system, curveOverride)` gained the optional
     curve arg; the shipped IPC transcription already matched Michael's table.
   **Still Phase B/C:** a per-pipe diversity-flow readout drawn on the CANVAS.
C. **Residual pressure (was Phase 3). — DONE, v0.17.1.** `FD.network.plumbingReport`
   runs a forward pass down the tree: signed per-pipe flow (canvas arrows), friction
   drop per pipe from the model's friction method (`build()` for geometry, never the
   GGA solve), and node pressure = source pressure − friction − static lift. The
   CALCULATION sheet reports Friction-drop and Residual columns (negative residual
   in red). Remaining polish: a per-pipe diversity/flow readout drawn on the CANVAS
   itself (the sheet and pipe panel have the numbers).

**Post-brief fixes (v0.17.1), from Michael's review:** `FD.plumbing.verified`
split per table (`{ fixtures:true, demand:false }` — E103.3(2) signed off); the
explanatory hints and unverified banner removed from the HYDRAULIC tab; SHOW ▸
Temperature hidden in plumbing; and — outside the module — **paste onto a pipe now
tees in** (`canvas.js` paste path calls `M.splitPipeAt` on the new anchor when it
lands on a pipe), which also fixed the same gap in hydronic.

**v0.17.2 — undiversified flow, SIMULATE, most-unfavourable path (Michael's 2nd
review list).** The two flow regimes are now both present and kept distinct:
* **DESIGN = diversified sizing** (fixture units → demand curve → pipe design
  flow), unchanged.
* **SIMULATE = undiversified push.** IPC **Table 604.3** is transcribed to metric
  (`FD.plumbing.supplies`, `verified.supply=false`) — each fixture's individual
  outlet flow + required pressure. It is a DIFFERENT taxonomy from E103.3(2), so a
  plumbing outflow carries a separate `dev.supply` (chosen, not mapped).
  `app.buildPlumbingSimModel` converts each fixture to a fixed generic demand at
  its undiversified flow and runs the UNMODIFIED GGA in fixed-demand mode — so the
  water is pushed through the pipes and the delivered pressures/velocities come
  out, with the GGA still never taught fixture units. `M.plumbingUndivFlow` /
  `M.plumbingReqPressure` (override-aware via `m.settings.plumbing.supply`).
* **Most unfavourable path** on the plumbing CALCULATION sheet: the least-margin
  fixture (delivered residual − 604.3 required), path traced source→fixture, like
  the hydronic critical path.
The 604.3 table is editable on the HYDRAULIC tab alongside E103.3(2)/(3).

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
