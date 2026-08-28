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
