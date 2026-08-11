# Human test log — ARCHIVE

Settled sections moved out of `Human-Test.md` to keep the active log focused
on what is still pending. Everything here was verified by Michael (✅) — kept
for the record, not because anything is outstanding. Newest first, as in the
main log.

**Status key** — ✅ passed · ⚠️ passed with a note

---
## 5Y. RISER NOTATION, AS YOU DRAW IT (v0.16.15)

A circle where the column meets this floor's pipework, a leader out at 45°, and
a box carrying the notation — the arrangement from your screenshots.

The symbol says **two** things at once, and the second is the one a floor plan
otherwise cannot tell you: whether the pipe carries on past this storey.

| on the drawing | means |
|---|---|
| `‾V` bar above, one chevron | the column starts here and drops — riser does not go up |
| `V` `V` two chevrons, no bar | it passes straight through, going down |
| `V_` one chevron, bar below | it ends here, fed from above — riser does not go down |

and the mirror of each with `Λ` for water going up.

| # | What | Status | Notes |
|---|---|---|---|
| RN.1 | **The chevron is the flow direction** | ✅ | Taken from the solved flow in the segment touching this floor. A riser pipe is built a = UPPER, b = LOWER, so a positive flow runs downward — getting that backwards would draw every arrow upside down, so there is a test that says so. Verified both ways: reversing the flow flips all six symbols. |
| RN.2 | **The bar marks where the column stops** | ✅ | Verified on a three-floor stack: top floor draws the bar ABOVE the chevron, the middle draws two chevrons and no bar, the bottom draws the bar BELOW. Checked by capturing the actual canvas geometry — the bar lands at y=142 above a box centred on 149, and at y=155 below it. |
| RN.3 | Nothing solved states nothing | ✅ | With no answer yet only the bars are drawn — where the column terminates is geometry and is always true; a chevron is a claim about flow, and inventing "down" because nothing has been calculated would be exactly the sort of invention this project refuses. A dead column (zero flow) is treated the same way. |
| RN.4 | **The box is the select handle now** | ✅ | The little triangle beside the circle existed only because the circle sits on the node and the node wins the click. The box is a bigger target and already clear of the pipework, so the workaround went with the thing it worked around. |
| RN.5 | It prints | ✅ | Same notation on paper, through the same `M.riserNotation`, so the plan and the sheet cannot disagree. **Not verified — printing has still never been checked on real paper.** |
| RN.6 | **Looks** | ✅ | The geometry is verified by capturing every canvas operation — circle, 45° leader, 26 px box, chevron apexes, bar positions — but the *appearance* at working zoom is yours to judge: whether the box is the right size against your pipework, and whether the leader wants to go down-right on every floor or should dodge. |

---

## Awaiting Michael's eye — new in v0.6.0-dev

Built and internally verified (logic node-tested, behaviour driven through the
live DOM), but **nothing below has been looked at by a person**. The preview
browser in the build environment has a 0×0 viewport, so no pixels were ever
rendered — anything about how these LOOK is unverified.

| # | What | Status | Notes |
|---|---|---|---|
| 7.1 | Riser select handle (triangle) + riser size/schedule/C | ⚠️ | Change the riser location marker to be from lower left (225 degrees). Arrow should point up or down to show flow direction. |
| 7.2 | New riser runs to the View Direction level automatically | ✅ | New riser from node to pipe is not connecting. Mid-pipe to node works. |
| 7.4 | Devices drawn as point symbols on a thin connector | ✅ | **The one to judge.** Agreed in principle only. At high zoom a 0.7 m pump link is still 0.7 m of drawing with a fixed-size symbol on it. M: Acceptable but if possible make pump 0.5m to match grids.|
| 7.6 | Multi-select → bulk size / schedule / C | ✅ | Blank = leave alone. Verified bores follow. |

---

---

## 2. Drawing

| # | What | Status | Notes |
|---|---|---|---|
| 2.4 | Snap priority node > pipe > grid | ✅ | Rewritten so the grid constrains length along the ray. Needs a human eye. |
| 2.5 | Riser placement and cross-level connection | ✅ | Michael reported it was still being checked. Alignment logic reworked since. |
| 2.6 | Levels: add, remove, reorder by drag, `[E]` editor | ✅ | |

---

## 5J. THE SIMULATION ACTUALLY RUNS (v0.16.3)

| # | What | Status | Notes |
|---|---|---|---|
| RS.1 | **Simulation runs again** | ✅ | `showSolveProgress` had been lost in an edit — and it was called *after* `app.solving = true`. The throw left that latch ON, so every later solve hit `if (app.solving) return;` and did nothing, silently, for the rest of the session. Verified on `20260808-DC-broken`: 19 controlled devices solved, results present, no console errors. |
| RS.2 | The latch can never strand again | ✅ | It is released on every path now, including a failure inside the progress bar — which falls back to solving without one. **A latch that only clears on the happy path is a bug waiting for its first exception**, and this was its second outing: the same class of region-replacement edit also ate the Static/Dynamic wiring in v0.16.2. |
| RS.3 | RUN SIMULATION works repeatedly | ✅ | Ran it a second time from a cleared result: latch set, bar shown, 19 devices, latch released, bar hidden. |
| RS.4 | Tick removed | ✅ | Highlight only, as asked. |

---

## 5I. STATIC / DYNAMIC ACTUALLY WIRED UP (v0.16.2)

| # | What | Status | Notes |
|---|---|---|---|
| SM.1 | **Static/Dynamic now do something** | ✅ | My fault, and a bad one: the wiring was **lost between v0.16.0 and v0.16.1** — one of my edits replaced a region that contained it. The buttons shipped with no JavaScript behind them, so neither lit up and clicking DYNAMIC did nothing at all. Restored and verified switching both ways. |
| SM.2 | The active mode is obvious | ✅ | Filled accent, white text, and a ✓. The ordinary button tint is fine for a tool whose effect you can see on the drawing; STATIC vs DYNAMIC decides whether the model responds to you at all, and being unsure which is on is the difference between "locked" and "broken". |
| SM.3 | **RUN SIMULATION** | ✅ | In the Simulate ribbon. Verified end to end: doubled a coil's duty in STATIC, confirmed the answer did **not** move on its own, pressed RUN, and the pump flow moved 3.198 → 3.194 L/s. Goes straight to the solve rather than through the 250 ms debounce — waiting after a deliberate click reads as the button not having worked. |
| SM.4 | It is disabled where it means nothing | ✅ | Greyed in DYNAMIC (every edit already re-solves) and in DESIGN, with the tooltip saying why. |
| SM.5 | Leaving STATIC re-solves | ✅ | Whatever you changed while locked has not been solved for, so switching to DYNAMIC takes a fresh answer. |
| SM.6 | Locked gestures still explain themselves | ✅ | *"Drawing is locked in STATIC simulation. Switch to DYNAMIC on the ribbon to edit while simulating."* |

---

## 5E. SYNC, AND SELECTING A RUN (v0.15.8)

| # | What | Status | Notes |
|---|---|---|---|
| Q5 | **Ctrl-click** adds to the selection | ✅ | Corrected from Shift. Ctrl-clicking something already in the set removes it. Cmd counts as Ctrl. Verified add → add → remove. |
| Q6 | **Shift-click selects the run between** | ✅ | Shortest path by pipe count, both ends included. Verified across your DC model: two pumps eleven pipes apart, and it reports "11 pipes along that run." |
| Q6b | ...and it is a **connectivity test** | ✅ | If the two are not actually joined it selects nothing and says "No pipework connects those two — they are on separate systems." On a drawing where a tee *looks* made and is not, that is the fastest check there is. Risers count as connections, so it will climb between floors. |
| C4 | **Sync** — follow another device's position | ✅ | The answer to C8. Link ONE pump to the sensor and sync the rest to it. Verified: three pumps, one linked, all three end at the same speed and share the flow, and only the leader is searched — no gang warning. |
| C4b | Sync is not a control | ✅ | Setting a sync clears any control link, so two things can never write one actuator. Chains collapse to their head, and a device cannot sync itself. |
| C4c | Only like to like | ✅ | Pump↔pump speed, globe↔globe opening. A percentage of travel and a percentage of speed are not the same quantity. |

**Where to look:** the pump/valve Control section gains a "Sync … with" dropdown
above the control link. Pick a leader and the section collapses to Monitoring /
Now holding — a synced device has no setpoint of its own.

---

## 5AB. YOUR SECOND LIST — v0.16.20 (2026-08-10)

The three from your second message, plus the archive tidy-up. All driven and
wired in the live app with no console errors; the look is yours to sign off.

| # | What | Status | Notes |
|---|---|---|---|
| CB.1 | **Convert input boxes match the other inputs** | ✅ | You meant the CONVERT tab (screenshot), where the boxes were browser-default white in the dark panel. They now carry the same styling as every `.field input` — dark `--bg-input`, `--text`, `--line` border. Verified live: the computed background is `rgb(17,21,26)`, identical to a panel input. |
| IN.2 | **The insulation table in Thermal is editable** | ✅ | Each nominal size has its own thickness box now, keyed by LABEL so it is the same whatever schedule the pipe is on — on top of the global default and the per-pipe override. Blank in a row takes the default. Verified live: editing DN15 to 37 mm stores it and `thicknessMmForSize` returns 37; the loss column follows. Resolution order is pipe → size-table → global default → 50 mm. |
| DP.1 | **Detail boxes are copy-pasteable** | ✅ | Ctrl+C on a selected note or detail line (or several) takes an annotation-only fragment; Ctrl+V places it following the pointer by its own lowest-leftmost corner (no node to anchor on), Esc cancels, R rotates. It pastes as a DRAWING change — saved, not solved — and is allowed even while a simulation is locked, the same reason annotation is deletable while locked. Annotation also rides along when copied together with pipework, on the same offset. Model layer tested in `model.test.js`; the ghost/rotate/insert exercised live with no error. **The on-screen look of the ghost is unverified — screenshots render nothing here.** |
| RM.1 | **The riser notation box drags in Annotation** (v0.16.22) | ✅ | Grabbing the callout box in the MOVE tool moves it, and the leader is redrawn from the circle on the pipework to the box so it stays attached — the circle itself does not move. The offset is per FLOOR (so each level's callout can dodge that floor's pipework) and in screen pixels, so it keeps its size and place through zoom. Snaps to grid, frees with Shift/Alt, saves without solving, survives save/load. Verified live: grabbing the box set the drag, dragging moved the box and its stored offset while the riser's plan point stayed put, and the offset round-tripped through `toJSON`/`fromJSON`. **The feel and the leader's look are yours to judge.** |
| DM.1 | **Detail lines & their nodes move in Annotation** (v0.16.21) | ✅ | In the MOVE tool: grabbing a VERTEX moves it on its own — together with any vertex exactly coincident with it, so a shared corner or a closed box's doubled first/last point stays joined. Grabbing a LINE moves the whole CONNECTED detail — every line sharing a corner — so the box moves as one, whether you drew it as a single closed polyline or as separate lines meeting at their ends. Notes drag too (the wiring was a dead stub before). All snap to grid, free with Shift/Alt, save without solving. Verified live by dispatching real pointer events: a doubled corner moved both its points and left the far corner alone; a whole polyline shifted +3/+3; two separate lines forming an L moved together at their shared corner. **The feel of it is yours to judge.** |
| AR.1 | Settled sections archived | ✅ | You asked me to archive settled issues. Fully-verified sections (riser notation, sim-runs / static-dynamic / sync, and the old Drawing / v0.6.0-dev rounds) moved to `Human-Test-Archive.md`; this log now shows what is still pending, with a pointer at the top. |

---

## 5R. Q4 — A DEVICE SLIDES ALONG ITS RUN (v0.16.9)

"Drag-snap to grid intersections along the pipe (0.1 m) — presentation only;
the pipe stays straight."

| # | What | Status | Notes |
|---|---|---|---|
| Q4.1 | **It slides along the run, and the run stays straight** | ✅ | A device is two nodes spliced into a run, so dragging it anywhere but along that run put a dog-leg in the pipework either side. Verified on a straight 20 m main with a gate valve at 8 m: dragged 3.37 m along and **4 m sideways**, it moved 3.40 m along and **zero** sideways, and every node stayed on y = 0. |
| Q4.2 | 0.1 m steps | ✅ | 3.37 m of travel lands on 3.40. Finer than the drawing grid on purpose — this is positioning a valve in a run, not laying out pipework, and the device is only 0.5 m long. |
| Q4.3 | The neighbours absorb it | ✅ | 7.75 + 0.50 + 11.75 became 11.15 + 0.50 + 8.35. The run is still 20 m and still one straight line. **It is an EDIT, not presentation** — those two pipe lengths really changed, so it solves and saves like any other geometry change. |
| Q4.4 | It cannot be driven off the end |✅ | Dragged to x = 60 it stops at 19.00…19.50, leaving a device length of margin before the outflow. Without the clamp the neighbour pipe turns inside out and reports a negative length. |
| Q4.5 | **Alt frees it** — and NOT Shift | ✅ | Alt gives back the old unconstrained move. Shift would have matched the convention everywhere else, and it cannot be used: on a device Shift already means "select the run between", and it suppresses the drag from starting at all, so a Shift-freed move could never have worked. The mode hint now says so. |

---

## 5Q. A CONTROL LINK THAT CHANGES FLOOR (v0.16.9)

Your new item. A pump on the plant floor following a sensor two storeys up used
to be drawn as **nothing at all** — the renderer refused any link whose two ends
were not both on the level being drawn, because a straight dashed line between
them cuts across a floor it has no business on.

| # | What | Status | Notes |
|---|---|---|---|
| CF.1 | **Half the link on each floor** | ✅ | On the device's floor, a dashed line from the device out to a riser node. On the sensor's floor, a dashed line from the same node to the sensor. Verified by capturing what the renderer paints: ground floor draws `PMP-01` and `↑ TS-1  (Level 1)`; Level 1 draws `TS-1` and `↑ PMP-01  (Level 0)`. |
| CF.2 | The node says where it goes | ✅ | A ring in the control colour — same shape as a pipework riser, so it reads as "this goes up" — labelled with the far end's tag and the floor it is on. "Up to what?" is the question the marker raises, so it answers it. |
| CF.3 | **Draggable in ANNOTATION** | ✅ | ANNOTATION selects the `view` tool, which is where the control-link bend handles already live, so it is the same gesture. Verified: drag moves it and it snaps to the grid. Not draggable with SELECT — the handle is not even registered there. |
| CF.4 | One riser, moved from either floor | ✅ | There is only one of it: a control cable rising through a shaft is in one place. Dragged from the ground floor to (4, −6), then from Level 1 to (13, 2) — the same point moved both times, and both halves of the link still meet at it exactly. |
| CF.5 | It is annotation, so it saves without re-solving | ✅ | Released through `arranged()`, the verb added in v0.16.7 — the drawing changed, the answer cannot have. It survives a save and reload. |
| CF.6 | The two halves route independently | ✅ | Each leg keeps its own axis and mid, or they would share one degree of freedom between two lines and fight over it. |
| CF.7 | Same-floor links are untouched | ✅ | The case every existing model is. Checked on `economizer-trim`: 6 controlled devices, 0 spans, all 6 routes drawn, 16 bend handles, no riser handles, and the sample route is the same four points as before. |
| CF.8 | It prints | ✅ | The printed plan follows the same rule per sheet, riser and label included. **Not verified — printing has never been checked on real paper.** |

---

## 5P. YOUR DATA CENTRE, ON THE REPAIRED FILE (`debug/20260809-DC`)

Not a change — a **result**. This is the first run of your data centre on a
clean file with the v0.16.4 physics, and it is the confirmation the ΔT ruling
was waiting for. Nothing here was edited by me; it is what your model now does.

**Tags are clean.** `CHWP-0AHU-15AHU-152` → `CHWP-02` and
`CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1` → `CHWP-04`. All 36 tags read properly. The
ΔP sensor was replaced too — `DP-01` on P458 is now `DP-02` on P482, a real
`mode: 'dP'` sensor holding 250 kPa.

| # | What | Status | Notes |
|---|---|---|---|
| DC.1 | **It converges, with no errors** | ✅ | `converged: true`, no `SETPOINT_LOST`. `20260808-DC-broken` did not converge and had 14 devices parked at full. 594 solves over 6 sweeps, 43 s. |
| DC.2 | **Every machine holds its setpoint, and none is "limited by" anything** | ✅ | ACCH-01/02/03 hold **20.00 °C**, CT-01/02/03 hold **35.00 °C**, and the `limit` column is empty on all six. This is the sentence that used to read "limited by Design ΔT" on 26–50% of your machines. |
| DC.3 | ...at genuine part load, which is the point | ✅ | The chillers do **310 kW of 800 kW (39%)** and the towers **622 kW of 836 kW (74%)**. Same low percentages as before — but now they are what the load actually is, with nothing capping them, rather than a clamp refusing to let them work harder. The difference is DC.2. |
| DC.4 | The coils are no longer starving |✅ | All 14 AHUs hold their Design ΔT with their valves at **69–71%** — real modulating positions with authority in hand — and errors of 0.02 K. PWP-01 holds the differential to **993 Pa of 250 kPa** (0.4%). CHWP-01/02/03 sit at 51% holding 30 °C to within 0.01 K. |
| DC.5 | **The fourth lineup is carrying nothing — is that deliberate?** | ✅ | CHWP-04 reports `no-flow`, ACCH-04 does 0.0 kW, and CT-04 has no thermal link at all. `CONTROL_NO_FLOW` is raised. If that set is N+1 standby then this is correct and the warning is just telling you so. If it is meant to be running, something upstream of it is not connected. **Your call — I have not touched it.** |
| DC.6 | `CONTROL_HUNTING` after six sweeps | ✅ | The loop was still moving when it ran out of sweeps, so the answer reported is the last one rather than a settled one. The numbers look settled — 0.02 K on the coils, 0.4% on the differential — so this is a "could not prove it had stopped" rather than a "wrong". 19 interacting devices is the most this model has ever had to settle at once. Tell me if you want the sweep ceiling raised. |
