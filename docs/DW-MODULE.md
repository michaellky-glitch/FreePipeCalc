# Domestic Water (DW) module — agreed design

Michael's request, 2026-08-12, and the two structural decisions taken in the
same discussion. **Not yet built** — this is the spec to build from.

## Decisions

1. **Lives inside DESIGN**, not a new mode. Plumbing is a new OUTFLOW TYPE plus a
   Domestic-Water behaviour, beside the existing `settings.systemType`
   (closed / open). DESIGN is not renamed and its toolset is not duplicated.
2. **A plumbing network must be a TREE.** "Downstream FU" is only defined when
   there is one path from the source, which is how real DW is drawn. A loop on a
   plumbing network raises a defect/error. Generic and closed-loop outflows keep
   the GGA and its loop handling.

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

1. **Data + model + UI.** The Plumbing outflow type, the fixture cold-FU table,
   the FU→flow table (flush tank + flushometer) with the HYDRAULIC selector, and
   the panel to assign a fixture / Custom FU to a plumbing outflow. No solver yet.
2. **Solver.** Downstream-FU tree accumulation + diversity conversion → per-pipe
   design flow (Generic + Plumbing). Tree requirement + loop error. System-aware
   imbalance handling.
3. **Pressure + reporting.** Forward head-loss pass to residual pressure at each
   fixture; sheet reporting.
