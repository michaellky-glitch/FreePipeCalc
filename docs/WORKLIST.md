# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move to `Human-Test.md` with a verification note.

Updated 2026-08-09, after v0.16.3.

---

## Next — LS.5, RULED, and what actually blocks it

**Michael chose option 1 on 2026-08-09:** Design ΔT stops clamping; models
without an explicit capacity must gain one.

The physics change itself is ~15 lines and correct (`equipOutlet`, the
source/sink branch — delete the `dTMax` clamp; `dTMax` keeps its real job in
`setEquipTrio`). It was applied, the manufacturer table was turned into a
nine-row test and **passed**, and the older ΔT-clamp assertions were migrated.

**IT IS BLOCKED ON SOMETHING ELSE, and this is the finding that matters.**

`economizer-trim` stops converging, and NOT because of the physics. Removing the
clamp exposes a **non-monotonic control response** that the clamp was masking.
Sweeping PMP-02 by hand, with everything else frozen:

    PMP-02 speed   100%   80%    60%    50%    40%    30%    25%
    TS-2 reads    13.55  11.86  11.77  14.80  17.83  20.86  22.37

It falls, then rises. Two effects fight: slowing PMP-02 makes ACCH-1 colder
(less flow, same duty) while the check valve has not yet opened the bypass;
below ~60% the bypass opens and the mixing effect takes over. Under the clamp
ACCH-1's outlet was pinned regardless of flow, so only the second effect existed
and the response was monotonic.

**The bracketed search cannot handle it.** It probes at the minimum, sees a sign
change, and should bisect to the root near 32% — but it reports `at-min` and is
parked at 100%. That is a control-loop defect in its own right, independent of
ΔT, and it will bite any model with a bypass and a mixing setpoint.

**So the order of work is:**

1. **Fix the search on a non-monotonic response** — reproduce with the sweep
   above, which is a small rig (two sources, a bypass, a check valve, a mixing
   sensor). Probably needs the descent to keep the best bracket rather than
   trusting the first crossing.
2. **Then land the ΔT change**, which is already written and tested.

Reverted for now so master stays green. Nothing about the ruling has changed.

**DX.1 —** does the DXF open in real CAD? Untested; nothing in this environment
can check it.

---

## Next

| # | Item | Notes |
|---|---|---|
| S3 | **Make the control loop yield** | The only remaining cause of the freeze. Turn `runControls` into a generator so `seek` can yield per `evaluate()` (~100 ms), with a synchronous driver for `solveModel`/tests and an async one for the app. Device-boundary slicing was tried and backed out — see `HANDOVER.md` §5. Mechanical, delicate, wants Michael able to test. |
| A2 | **Text box does not appear** | The note IS created, on the active level, with the right text — so this is a drawing or hit-test problem, not a model one. Start in `drawNotes`. |
| A4 | Details not selectable | Wired in the SELECT (arrange) tool; while the DETAIL tool is active a click ERASES instead, which may be all this is. Retest now that A5 makes the tool's state visible. |
| S1 | Riser should show pipe properties | |
| Q4 | Drag-snap to grid intersections along the pipe (0.1 m) | Presentation only; the pipe stays straight. |

## Then

| # | Item | Notes |
|---|---|---|
| Q1 | TOOLS becomes a moveable in-UI window | Button in Design, Control and Simulate rather than a whole tab. |
| Q2 | Tools tabs: pump curve · critical radius · pipe velocity & friction · heat transfer | |
| Q3 | Velocity/friction fields update each other | Enter any two, get the third. |

---

## Recently closed

Newest first. Detail in `Human-Test.md` §5A–5J.

* **v0.16.3** — a stranded `app.solving` latch stopped the simulation running at
  all; released on every path now.
* **v0.16.2** — Static/Dynamic had no JavaScript behind it (lost in an edit);
  restored, plus RUN SIMULATION and a clear active highlight.
* **v0.16.1** — the "lost setpoints" were a stale reported error and a stale
  state; both now derived from the final measurement. Annotation: A3, A5, A6,
  A7.
* **v0.16.0** — selection no longer re-solves; STATIC/DYNAMIC; skyline LDLᵀ for
  the GGA matrix (57 s → 39 s, identical answers).
* **v0.15.9** — a truncated control search left every pump on its floor; a
  search that cannot finish is now a no-op. Tag REPAIR and `TAG_MANGLED`.
* **v0.15.8** — sync links; Ctrl adds to the selection, Shift selects the run
  between (which doubles as a connectivity test).
* **v0.15.7** — Ctrl/Shift selection, `controllableAt`, manual VFD slider, no
  arrow at zero flow.
* **v0.15.6** — integrated control valve, capacity override, `Auto` placeholder.
* **v0.15.5** — devices sharing a setpoint are ganged; dangling control links
  reported.
* **v0.15.4** — the two critical corruption bugs: a crash mid-render eating the
  Control section, and a stale field writing to the wrong device.
