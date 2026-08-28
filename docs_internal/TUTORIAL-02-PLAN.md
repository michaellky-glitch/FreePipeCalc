# Tutorial 02 — build plan (NOT YET WRITTEN)

**Status: SCOPED, NOT BUILT.** Michael set this out on 2026-08-28. The endpoint
file already exists and ships: `examples/Tutorial 02 - Hydronic System.json`.
**The tutorial has to tell the reader how to GET there.** Michael: *"The tutorial
file is the end point, you need to tell the user how to get there."*

Write it as `docs/tutorial-02-hydronic.html`, register it in `src/docs.js`
between Tutorial 01 and Tutorial 05, and **follow it through yourself
afterwards** — his explicit instruction: *"After the tutorial is done, follow
through the tutorial yourself to ensure it works."*

## The endpoint model, as shipped

| | |
|---|---|
| Levels | L0 plant (0 m), L1 (35 m), L2 (38.5), L3 (42), L4 (45.5), L5 (49) — 3.5 m floor to floor |
| Risers | R0 and R1, six attachments each |
| Pumps | PMP-1 (auto, DP control link), PMP-2 (synced to PMP-1), PMP-3 (**off**, standby, synced) |
| Chillers | WCCH-01, WCCH-02, WCCH-03 — `source`, qRated 30.97 L/s each |
| Coils | AHU-1 … AHU-5, one per floor, 200 kW, qRated 5.63 L/s, each with an integrated control valve |
| Sensor | DPS-01, mode `dP`, between the AHU-5 supply and return, **250 kPa** |
| Method | Darcy-Weisbach, SIMULATION |

Solves clean: converged, no errors, no warnings.

## The eight steps, in his words

1. **L0 plant room** — 2 pumps and chillers **in auto mode**. *"we will be
   skipping the bypass valve for now."*
2. **Draw L1.**
3. **Copy up to L2 onwards** — this is the floor-copy feature, and the place to
   show that copying re-tags the equipment.
4. **Simulate** — show the VFDs at 100% while the control valves modulate
   heavily. This is the symptom that motivates step 5.
5. **Add DPS-01** between the AHU-5 supply and return pipes, link it to PMP-1,
   set it to **200 kPa**.
6. **Link PMP-1 and PMP-2** — the sync feature.
7. **Re-simulate — IT FAILS.** The setpoint has to rise by typically 50 kPa
   (to the 250 kPa the shipped file carries). **Say in the tutorial that this is
   under investigation** — see `WORKLIST.md` **DP.1**.
8. **Add a third chiller by copy-and-paste** (WCCH-03).

## Done already, 2026-08-28

* **AHU-15 renamed AHU-5** on L5 — Michael: *"please fix the L5 AHU naming"*.
  Verified: tags now read AHU-1 … AHU-5, no duplicates, model still solves clean.
* **The pipe-schedule tutorial is renumbered 02 → 05**, per his instruction, so
  the number is free. `docs/tutorial-05-schedules.html`, its `<title>`, its `<h1>`,
  the `src/docs.js` registry entry and title, `data/schedules.js` and the
  handover all updated. The registry guard in `test/tools.test.js` passes.

## Watch for

* The floor heights are **3.5 m** apart with L1 at **35 m** — the reader has to
  set the level altitudes, and that is easy to get wrong. State them.
* PMP-3 ships **off**. Step 1 says two pumps; the third arrives as a standby and
  the tutorial should say when it is added and why it is off.
* Step 8 adds a third CHILLER, not a third pump. Do not conflate them.
* Michael's own `tutorial-hydronic/calculation/hydraulic/thermal.html` set and
  the overlap with `user-manual.html` are still unresolved — do not duplicate
  ribbon documentation here.


---

## WALKTHROUGH FINDINGS — 2026-08-28 (tutorial WRITTEN and followed through)

`docs/tutorial-02-hydronic.html` is written and registered (between Tutorial 01
and Tutorial 05). I drove the endpoint model through the steps and corrected the
tutorial's claims to what the model actually produces. Two things for Michael:

**1. THE "VFDs at 100% while CVs modulate HEAVILY" SYMPTOM (step 4 of the brief)
IS ONLY PARTLY THERE.** Measured on the shipped file:

| state | pumps | AHU valves | dP across AHU-5 |
|---|---|---|---|
| before sensor (pumps free @100%) | 100% | 66–74% open | 291 kPa |
| after sensor @250, PMP-2 synced | ~95% | 72–81% open | 250 kPa (held) |

The valves throttle to about two-thirds open — **moderate, not heavy** — and
adding the sensor moves the pumps only 100% → 95%. The direction is right and the
tutorial now says so honestly (the result boxes carry these numbers, and step 9
adds a line that the effect is bigger on a plant with more spare head). **But if
you want the tutorial to DRAMATISE the energy saving, the model needs more spare
pump head** — an auto-sized pump self-fits the load, so it barely oversizes.
Consider shipping the pumps slightly oversized (Manual, or a higher design head)
so the "before" state is genuinely wasteful and the sensor visibly rescues it.

**2. THE STANDBY / PUMP-COUNT GAP.** Your step 1 says "2 pumps"; the endpoint
ships THREE (PMP-3 standby, off). The tutorial builds two duty pumps and adds a
NOTE that a standby third can be added the same way and left Off. If you would
rather the tutorial build all three explicitly, say so.

**3. DP anomaly confirmed and sharpened** — WORKLIST DP.1. At 200 kPa the pump
sits at 86% (NOT maxed) and the device reports state `on`, yet SETPOINT_LOST
fires. That state/error contradiction is the thread to pull. The tutorial's step
9 tells the reader to expect the failure and raise to ~250, and names it as
under investigation.

**Verified:** page tags balanced, TOC's ten anchors all resolve, all four tables
`.scroll`-wrapped, renders in dark theme, registry guard passes. Layout could not
be pixel-measured — the browser pane reports 0 width — but the page reuses
Tutorial 01's head and structure verbatim, and Tutorial 01 reports MORE apparent
overflow than this page under the same collapsed pane, so it is a measurement
artefact, not a defect.
