# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move to `Human-Test.md` with a verification note.

Updated 2026-08-09, after v0.16.11.

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
| S1 | Riser should show pipe properties | |

---

## Recently closed

Newest first. Detail in `Human-Test.md` §5A–5J.

* **v0.16.11** — Michael's Annotation batch: pipes unselectable in MOVE,
  grid-sized handles, SELECT renamed MOVE, a per-tag Visible switch, and a
  control link no longer showing on floors it does not belong to (my regression
  from v0.16.9). Plus T1, tag repair, which was recovering the wrong tag AND
  renaming good ones.
* **v0.16.10** — Q1-Q3: the tools move out of a tab and into a moveable window
  with four tabs, opened from Design, Control and Simulate; two new ones —
  pipe velocity & friction, and heat transfer — both "enter any two, get the
  third". An eighth test suite with them.
* **v0.16.9** — Q4: an in-line device slides ALONG its run in 0.1 m steps
  instead of being dragged off it and kinking the pipework (Alt frees it); and
  a control link whose two ends are on different floors is drawn
  at last: half on each floor, meeting at a riser node you can drag in
  ANNOTATION. It used to be drawn as nothing at all.
* **v0.16.8** — S3: the solve is a generator and the page no longer freezes.
  459 heartbeats during a 29.5 s solve where there used to be one; an edit
  mid-solve abandons the run rather than overwriting with a stale answer.
* **v0.16.7** — four reports from Michael: static-mode clicks and tool changes
  were still re-solving (the marquee path and `setTool`); ALIGN, label, note,
  TRACE and control-leader drags now save without solving; `addPipe` was
  dropping the `sensor` it was handed, so every sensor came out a temperature
  sensor; and a sensor's Display list now offers what it measures and draws it.
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
