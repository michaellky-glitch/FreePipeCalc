# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move to `Human-Test.md` with a verification note.

Updated 2026-08-09, after v0.16.6.

---

## Next

**LS.5 and the early-design sizing aid are both done** (v0.16.4 / v0.16.5).
`HANDOVER.md` §6 has the ΔT story and the two search defects; `ARCHITECTURE.md`
§18 has the sizing aid. What is left below is the list as it stood.

**DX.1 —** does the DXF open in real CAD? Untested; nothing in this environment
can check it.

---

## Found in passing, not fixed

| # | Item | Notes |
|---|---|---|
| S4 | **Park-at-full happens AFTER the sweeps, and nothing re-settles behind it** | Found while migrating the `20260805-4` tests, v0.16.4. Give ACCH-1 a capacity it genuinely cannot meet and the pump is parked at 100% at the very end — correctly — but the four coil valves settled against the *starved* plant the pump had produced during the sweeps, and are left at 100% with their branches 14–16% over. The final positions do not describe the final answer. Not a regression (it predates v0.16.4) and not exercised by any of Michael's real files, so it is recorded rather than chased. The fix is probably one more settling sweep after the parking pass. |

---

## Next

| # | Item | Notes |
|---|---|---|
| S3 | **Make the control loop yield** | The only remaining cause of the freeze. Turn `runControls` into a generator so `seek` can yield per `evaluate()` (~100 ms), with a synchronous driver for `solveModel`/tests and an async one for the app. Device-boundary slicing was tried and backed out — see `HANDOVER.md` §5. Mechanical, delicate, wants Michael able to test. |
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

* **v0.16.6** — A2 and A4, and they were one bug and a half. A missing theme
  key made every text box paint itself in the background colour (an invalid
  canvas colour is silently ignored, so it kept the last one); and
  `pickAnnotation` was documented as being tried in EDIT and never called there.
* **v0.16.5** — the early-design sizing aid: `qNeed` on the engine, a Required
  capacity row and a margin, Auto/Manual sizing on equipment, and a plant
  schedule on the CALCULATION sheet.
* **v0.16.4** — Design ΔT stops clamping the duty at part flow (LS.5, Michael's
  manufacturer table); and the two control-search defects that change exposed —
  a device on its floor could not climb back, and a single probe at the stop
  could not see a response that turns.

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
