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

---

## 5AA. WHILE YOU WERE AWAY — v0.16.16 to v0.16.19 (2026-08-10)

| # | What | Status | Notes |
|---|---|---|---|
| XC.1 | **The network solve is cross-checked against an INDEPENDENT algorithm** (v0.16.17) | ✅ | Your biggest gap (§7), first dent. `test/crosscheck.test.js` re-solves looped networks by HARDY CROSS — loop-flow corrections, no shared code with the GGA below the pipe law — and the two agree on every flow to 1e-10 across a two-loop grid, a three-loop ladder and a rewired grid (Hazen-Williams). Handed each pipe's own r and n, so it checks the DISTRIBUTION, which was never independently checked, not the single-pipe law, which you validated. Darcy is out of scope on purpose (its friction factor moves with the flow). Nothing user-facing — this is validation only. |
| SW.1 | **Settling sweeps is configurable** (v0.16.18) | ✅ | THERMAL ▸ Setpoint control ▸ **Settling sweeps** (default 6). Your ask: a first pass keeps six, a final answer can have 10+ and wait. The auto solve budget scales with it so the extra sweeps are actually taken. Default behaviour identical (unset = 6 sweeps, same solve count). Verified in the live app: the field is present; 12 → 12 sweeps, 20 → 20, a converging model still stops early. |
| CV.7 | **Check valve is now an arrowhead + seat bar** (v0.16.19) | ✅ | Your sketch of 2026-08-10, read as the standard non-return symbol: a triangle pointing the way flow is ALLOWED (a→b, confirmed against the solver's reverse-flow rule) with a seat bar across its tip, replacing the swing flapper. Drawn larger than the bowtie valves so the direction reads. **Driven in the live app — placed and rendered with no error — but the APPEARANCE is unverified: screenshots render nothing to pixels here. This one needs your eye.** If the arrow points the wrong way or the seat sits wrong, say so. |
| INS.1 | **Insulation decoupled from the schedule** (v0.16.19) | ✅ | Your ask. Thickness is now one global default in THERMAL (50 mm, `thermal.insulation_mm`), overridden per pipe (including 0 for bare) — the "25 mm below DN50, 50 mm above" schedule rule and its per-size editor are gone; a schedule is its published dimensions only. Verified in the live app: THERMAL shows a **Thickness** field, the schedule table lost its Insulation column, and the per-pipe override still wins. **Your two known-good files re-solve on the 50 mm default** — sub-DN50 pipes shift 25→50 mm, so their pipe heat-loss changes slightly; both still converge (DC 20.0–45.1 °C, HighRise 6.0–16.1 °C). You chose "let them re-solve". |
| UI.1 | Calculate input boxes black | ✅ | **Logged in WORKLIST, not yet done.** From the code the tool INPUT boxes already use the standard near-black colour; the muted-grey ones are the read-only CALCULATED-RESULT boxes. Needs your eye to confirm exactly which boxes you mean before I touch shared styling. |

---

## 5X. YOUR TESTING ROUND OF 2026-08-09 (v0.16.14)

| # | What | Status | Notes |
|---|---|---|---|
| TR.1 | **A device snaps to half a grid, not to travel** | ✅ | I had it wrong: quantising the DISTANCE MOVED means where a device ends up depends on where it started, so two valves nudged along the same main never line up. The POSITION is snapped now, to half a minor grid. Verified: dragged towards 21.37 m it lands on **12.750** — on the 0.25 lattice — and the y never moves. |
| TR.2 | **Display > Design Load works on plant** | ✅ | It was drawn only for an EXCHANGER, whose design figure is `duty`; a source/sink keeps its on `qMax`, so on a chiller or tower the switch did nothing at all. |
| TR.3 | **Sensor tags say what they measure** | ✅ | `TS / PS / FS / DPS / DTS`. Verified all five on the real button path: temperature=TS-1, pressure=PS-1, flow=FS-1, dP=**DPS-1**, dT=**DTS-1**. The mangled-tag detector was taught the new prefixes at the same time, so `DPS-1` does not read as corruption. |
| TR.4 | Capacity override → **Part load**, no explanation | ✅ | It never was an override of the capacity: the design figure is untouched and this asks what the machine is doing today. |
| TR.5 | **Coils sync their part load** | ✅ | You marked this ❌ ("no option to sync coil part loads (unselectable)", 2026-08-10). I could not reproduce it: loading `20260809-DC.json` and selecting AHU-1 in the LIVE app, the coil's Control section shows **Sync part load % with** offering all 13 other AHUs, in both DESIGN and SIMULATION — the field is present and selectable. The sync only DISAPPEARS when a coil is the ONLY heat exchanger in the model, because there is nothing to sync it to; that is almost certainly what you hit — a single coil, or a coil selected before its neighbours were placed. **v0.16.23 makes that case self-explanatory:** the "Sync part load %" row now shows DISABLED with "Place a second heat exchanger to sync this one to it", rather than vanishing. If you still see no option with two or more coils present, it is likely a stale cache (§4) — hard-refresh; otherwise tell me the exact steps. Coil to coil only: a percentage of duty and a percentage of travel are not the same quantity, so a pump is never a target. |
| TR.6 | **Enter calculates** | ✅ | Bound to the tools body, so a tool that grows a field cannot forget, and only where there is a button to press — which is why CONVERT (live as you type) ignores it. |
| TR.7 | Velocity & friction → **Hydraulic** | ✅ | |
| TR.8 | **Solve for Friction drop** — and for a bore FROM one | ✅ | Five modes now. Sizing on a gradient is how a main is actually picked, so that direction is there too: 10 L/s at 400 Pa/m gives 88.1 mm → DN100. **Bisected, not inverted** — a closed form written for Hazen-Williams would not serve Darcy, whose friction factor depends on the bore it is solving for. Round-trips exactly: 4 L/s in 58.269 mm reads 550 Pa/m, and 550.465 Pa/m gives 58.269 mm back. |
| TR.9 | **A link node on the upper floor stays on the upper floor** | ✅ | Real bug, mine. A cross-floor link has TWO legs that route independently — the near one on `control`, the far one on `control.far` — and every edit wrote to the near leg whatever floor you were on. That is also the "dragging nodes on the wrong level". Verified: adding on the upper floor puts 3 points on the far leg and **0** on the near one. |
| TR.10 | Risers show what they are doing | ✅ | Per SEGMENT — flow, velocity, ΔP between each pair of floors — because a column is not one pipe: on a stack serving four floors the bottom segment carries far more than the top, and one averaged number would hide exactly that. Plus the tag switch. |
| TR.11 | **Paste: Tab picks the end, R turns it** | ✅ | Tab cycles the joining node round the boundary; R turns the fragment 90° clockwise about it. Verified both. Only the geometry turns — label offsets are stored in screen pixels and route bends in world coordinates, so those are dropped rather than left pointing the wrong way. |
| TR.12 | **A pipe end dropped on a pipe makes a tee** | ✅ | It used to mean nothing, so the node sat on top of the run touching nothing — the silent break `disconnections()` exists to report, made by hand. Verified: the main is replaced by two halves that keep its size, schedule and C, and three pipes meet at the drop. |
| TR.13 | **Convert keeps the caret** | ✅ | Every keystroke rebuilt the tab, which destroys the input you are typing in — the same trap `renderProperties` has. The opposite box is written in place now. Verified: typing 3 then 5 leaves the SAME input element focused and gives 35 °C → 95.00 °F. |

### Interface

| # | What | Status | Notes |
|---|---|---|---|
| TR.14 | "COMMAND" gone from the ribbon | ✅ | It was also being re-applied in JavaScript on every mode change, which is why taking it out of the markup was not enough on its own. |
| TR.15 | **COPY / PASTE on Design > Edit** | ✅ | They do what Ctrl+C / Ctrl+V do. The two that used to sit there copied PROPERTIES — a different verb — and have moved to the bottom of the properties panel's DESIGN section, as **Copy properties / Paste properties**. Two buttons a foot apart both saying COPY is a trap. |
| TR.16 | Valves duplicated into CONTROL | ✅ | Beside the sensors, since a control valve is placed while you are wiring controls. |
| TR.17 | **ADD CONTROL works in either direction** | ✅ | Sensor first or pump first. A pump can only ever be the follower and a sensor only ever the target, so there is nothing ambiguous and no reason to make the hand remember an order. |
| TR.18 | REPAIR hides itself | ✅ | Shown only when something in the model actually looks mangled, re-checked on every solve. Not deleted — the corruption was real and this is the only way back from it. |
| TR.19 | **Alt frees any constraint** | ✅ | Pipe angles, the grid, detail lines, device sliding. Shift still frees the 15° snap because the fingers know it, but Alt is the one that means it everywhere — on a device drag Shift was already taken (it selects the run between), so a single rule was only ever going to be Alt. |

---

## 5W. COPY AND PASTE, FIND, AND THE FLOOR ABOVE (v0.16.13)

| # | What | Status | Notes |
|---|---|---|---|
| CP.1 | **Ctrl+C takes the selection, Ctrl+V places it** | ✅ | Shift-click still selects the run, exactly as you expected. On `economizer-trim`: PMP-02 → ACCH-1 gives 3 pipes; Ctrl+C reports "3 pipes and 4 nodes copied — 1 link to items outside the selection will be dropped". The fragment follows the pointer and the next click drops it; Esc cancels. |
| CP.2 | The anchor is where it met the loop | ✅ | A boundary node — one that a copied pipe and an uncopied pipe both touch. That is where the copy will want to join, which is what you predicted. If there is no boundary it falls back to the lowest-then-leftmost node, so the answer is stable rather than dependent on selection order. |
| CP.3 | **Dropping onto a node JOINS it** | ✅ | The anchor ring fills green when it is over an existing node. Verified: dropping onto one creates 3 nodes instead of 4 — the anchor is reused rather than duplicated — and a copied pipe lands on it. Dropping in free space is allowed too, and `disconnections()` flags the loose end, which is the existing safety net. |
| CP.4 | **A copied pump follows the COPIED sensor** | ✅ | Not the original's. Pointing at the original is two pumps on one measurement, which is the degenerate case `CONTROL_GANGED` exists to complain about. |
| CP.6 | **Tags are made unique** | ✅ | ACCH-1 → ACCH-2, PMP-02 → PMP-03, keeping the printed width (CHWP-01 → CHWP-02, not CHWP-2). Zero duplicate tags in the model afterwards. |
| CP.7 | A settled VFD position does not travel | ✅ | The copy starts at full travel; it came out of a solve of different plant, and the control loop resets to full anyway. |
| CP.8 | The copy is left selected | ✅ | So it can be moved or deleted straight away. |
| CP.9 | **Duplicate tags are now reported** | ✅ | `TAG_DUPLICATE`. Nothing detected this before — every table on the CALCULATION sheet is keyed on the tag, so two rows called CHWP-01 could not be told apart. A warning, not a defect: it is a real state mid-edit. |
| CP.10 | **Copying a FLOOR was losing every sensor and every control link** | ✅ | `copyLevel` enumerated the fields to carry — kind, schedule, size, C, tag, equip, pump, valve — and silently dropped `sensor`, `control` and `sync`. The same bug `addPipe` had, from the same cause. It goes through the same two functions as copy-paste now, which clone wholesale. Verified: a dP sensor and its control link both survive a floor copy and the link points at the copy. |
| CP.11 | The copy dialog was lying about sources | ✅ | It said "A SOURCE is deliberately not copied"; the code has always copied them, and your own test records that suppressing them was tried and rejected. The sentence is gone. |
| F.1 | **A Find tab in TOOLS** | ✅  | Matches tag *and* internal id, case-insensitive substring — both are things you have in your hand. "ACCH" finds all three; "P70" finds TS-2. Tag matches sort above id matches. |
| F.2 | Clicking a result goes to it | ✅  | Switches floor if it has to, centres it **without changing the zoom**, and selects it. It is the one tool that reads the model, and it only ever reads. |
| F.3 | **Copy level offers a new floor first** | ✅  | "New floor above — Level 11", selected by default, and offered even when there is nowhere else to copy to so the button never dead-ends. |
| F.4 | ...following the old floor's numbering | ✅  | Level 10 → Level 11. Width kept, so Level 09 → Level 10, not Level 9. `L2` → `L3`, `B1` → `B2`, `Level 3 (Plant)` → `Level 4 (Plant)`. A name with no number gets " 2" — Roof, Roof 2. Anything already taken steps again. |

---

## 5V. THE SMALL-THINGS ROUND (v0.16.12)

| # | What | Status | Notes |
|---|---|---|---|
| SM.1 | Sync VFD with: "None" | ✅  | Was "— not synced —". Verified with two pumps: the list reads `None | PMP-02`. |
| SM.2 | Tag Visible moved to DISPLAY | ✅  | First in the section, above the value-box switches — it governs them, since with the tag off there is nothing for them to sit under. |
| SM.3 | Its explanation is gone | ✅  | |
| SM.4 | The value-box line is now "Tag (Info Panel)" | ✅  | The two were both called "Tag" once they shared a section. |
| SM.6 | A hidden tag's box is GREY, not orange | ✅ | Grey box + grey text = hidden. Orange box = something on that you can grab. The orange had it reading as "selected". |
| SM.7 | **The DETAIL tool's first click snaps** | ✅ | Off-grid (3.17, 2.23) lands on (3.00, 2.00); with Shift it stays put. The cause was `shiftDown` being read only on pointermove — an opening vertex is placed by a pointerdown with no move of its own, so it used whatever the last move had seen. |
| SM.8 | Delete removes details and text boxes | ✅ | Both fell through to `removeNode`, which quietly did nothing because no node has their id. |
| SM.9 | The DETAIL blurb is one line, behind a 🛈 | ✅ | Your wording: "Draws annotation lines. Holding shift removes grid snaps. Escape to exit." |
| SM.10 | "Remove line" → "Delete" | ✅ | |
| SM.11 | **Link nodes are their own ribbon group** | ✅ | `Link nodes: ADD | REMOVE`. |
| SM.12 | REMOVE takes one out | ✅ | Verified: 3 → 2 → … → and with the last one gone the route falls back to its plain Z. |
| SM.13 | **They are easier to place** | ✅ | The target was a flat 12 px; it is the same grid-sized handle as everything else now (36 px by default). And the cause of "especially between PWP-01 and DP-02" was **mine**: `routePointAt` asked for the route without naming a floor, which v0.16.9 made return null for a link that changes floor — so a cross-floor link had nothing to click on at all. |
| SM.14 | A preview shows where it will land | ✅ | A green ⊕ at the exact point for ADD, a red ⊗ over the node that would go for REMOVE, following the pointer. |
| SM.15 | **Neither triggers a simulation** | ✅| Measured: 0 solves across an add and four removes. It was calling `changed()`; it calls `arranged()` now — save and redraw, no solve. |
| SM.16 | Prompts and the progress bar sit top-centre of the WORK area | ✅ | Both, at the same anchor. The bar was pinned 96 px from the top of the window and the ribbon is taller than that — and it WRAPS, so its height depends on the window width and on which mode is showing. The canvas now publishes its own position as `--work-top`. Toasts moved up from the bottom to join it. |
| SM.17 | TOOLS moved to MISC | ✅ | Beside RENUMBER and ⤢, once, instead of three copies in the mode palettes. |
| SM.18 | Explanations gone from the tools | ✅ | All of them. |
| SM.19 | **"Solve for", and the answer at the bottom** | ✅ | Velocity: `Solve for` names the output, `bore` is `Pipe diameter`, and the solved box is last — flow/velocity/**diameter**, or diameter/velocity/**flow**, and so on. Heat transfer the same. |
| SM.20 | The pump curve is drawn, above Result | ✅ | The three stated duties marked on it, so what the interpolation did between them is visible rather than described. |
| SM.21 | Critical radius marked (BETA) | ✅ | |
| SM.22 | **A CONVERT tab** | ✅ | Two-way and live — type in either box and the other follows, no direction to choose and no button. Verified both directions: 100 °C → 212.0 °F, and 9 °F of ΔT → 5.00 K typed from the right. Rows: **absolute temperature**, **ΔT**, pressure (kPa · bar · psi · m H2O · mm Hg · ft wg), flow (L/s · L/min · m³/h · US gpm), each end picking its own unit. |
| SM.23 | The two temperature rows are separate on purpose | ✅ | An absolute temperature carries the 32° offset; a difference does not. One shared row is how a ΔT of 5 K becomes 41 °F on a schedule. There is a test that says so. |

---

## 5T. YOUR ANNOTATION BATCH, AND THE TAGS (v0.16.11)

| # | What | Status | Notes |
|---|---|---|---|
| AN.1 | **Pipes are not selectable in Annotation** | ✅ | Clicking the pipe LINE or a node in MOVE now selects nothing; in SELECT both still work. What stays selectable there: notes, detail lines, control-link bends, the cross-floor riser, and **labels and tags** — including a pipe's own size annotation, which you need to grab in order to drag it. Devices stay selectable too, because MOVE is where the "Show on drawing" checkboxes live. |
| AN.2 | **Bigger handles, adjustable** | ✅ | Measured in GRID SQUARES rather than pixels, so the target holds its size relative to the drawing instead of shrinking with the zoom. SETTINGS → Drawing → **Annotation handle size (grids)**, default 0.5, ceiling 2. At your grid and zoom: **0.5 → 36 px across, 1 → 72, 2 → 144** (it was a flat 22). The floor scales with the setting as well as the grid term — without that, at 8 px/m half of 0.5 grid is under two pixels and the setting would have appeared to do nothing. |
| AN.3 | **Annotation → SELECT renamed MOVE** | ✅ | And the tooltip with it: "Move labels, tags, notes, detail lines and control-link nodes into place for printing." |
| AN.4 | **Tags have their own Visible switch** | ✅ | On any tagged pipe, device or node: **Tag visible: ON/OFF**, beside the Tag field. Separate from the "Show on drawing" checkboxes, which control the value BOX. Verified: OFF hides it in SELECT and on prints, keeps it in MOVE, and it is still selectable there. Stored as `tagOff`, so every existing model keeps its tags. |
| AN.5 | ...greyed, not gone, in Annotation | ✅ | Drawn in the muted colour at 55% opacity. Hiding it there too would leave nothing to click on to turn it back on. |
| AN.6 | **Control links only appear on their own floor** | ✅ | **This was my regression, from v0.16.9.** The "both ends on the level being drawn" test used to be written out at both call sites; moving it into `controlRoute` dropped it for the ordinary same-floor case, because a link that does not span has no span to check itself against. An L0 link is now absent on L1 and L2, and there is a test. |
| AN.7 | The riser is easier to grab | ✅ | Same handle sizing as AN.2 — 36 px across by default rather than 22. |

---

## 5U. TAG REPAIR, IN THE BACKEND (v0.16.11)

You left this with me. It turned out to be two faults, and the repair was giving
a wrong answer as well as missing one.

| # | What | Status | Notes |
|---|---|---|---|
| T1.1 | **The mangling INSERTS, it does not append** | ✅ | `CHWP-0AHU-15AHU-152` is `CHWP-02` with `AHU-15` inserted twice at a caret — the real tag's trailing "2" is stranded after it. The old rule stripped the trailing run and gave **`CHWP-0`**: plausible, wrong, and silent. Removing the repeated token from wherever it sits gives **`CHWP-02`**, which is the answer. |
| T1.2 | ...and the inserted text can be truncated | ✅ | `PWP-04MP-4MP-4…×7` appends `MP-4`, which is `PMP-4` with its first character absorbed, so matching whole generated tags missed it entirely. A hyphenated group repeated at the end catches it. |
| T1.3 | **And it no longer renames good tags** | ✅ | Found by writing the false-positive half of the test: **`B2-AHU-7` was being stripped to `B2-`**, and had been since the rule existed. A real mangling leaves a complete tag behind it (`CHWP-04`); a hierarchical name leaves a dangling separator (`B2-`). The head must now end in a letter or digit. `AHU-1212`, `SUB-AHU-12-A`, `VAV-1-2` are all left alone. |
| T1.4 | It is still a best guess | ✅ | The mangling is lossy — `CHWP-02` came back only because the stranded "2" survived, and a mangling that ate it would be unrecoverable. Worth a glance at what REPAIR TAGS reports rather than trusting it. |

---

## 5S. Q1–Q3 — THE TOOLS WINDOW (v0.16.10)

| # | What | Status | Notes |
|---|---|---|---|
| Q1.1 | **A moveable window, not a tab** | ✅ | Opened from a TOOLS button in Design, Control and Simulate — three buttons, all wired. A tab took the drawing off the screen in order to answer a question you were asking about the drawing. Verified: opens, closes with ✕ or Esc, drags by its title bar (200,150 after a drag), and both position and open state come back after a reload. |
| Q1.2 | It stays on screen | ✅ | Dragging clamps to the viewport. A window dropped off the edge and then reopened where it was left is a window you cannot get back. |
| Q2.1 | **Four tabs** | ✅| Pump curve · Critical radius · Velocity & friction · Heat transfer. One at a time — stacked worked with two and would not with four in a 400 px window. All four render. |
| Q3.1 | **Velocity & friction: any two give the third** |✅ | Flow + velocity → bore, flow + bore → velocity, bore + velocity → flow. All three round-trip exactly: 4 L/s at 1.5 m/s gives 58.269 mm, and putting that back gives 1.5 m/s and 4 L/s. Which two are yours is a dropdown, not a guess from what you typed last — guessing overwrites the box you are correcting as you type into it. |
| Q3.2 | ...and the friction is the MODEL's | ✅ | Assembled exactly as `network.build` assembles a pipe. 4 L/s in 58.27 mm at C=120 reads **550 Pa/m**, hand-checked against Hazen-Williams to 1e-6. Re 87,056, turbulent, 55.0 kPa per 100 m. A tool with its own friction formula is a second implementation waiting to disagree. |
| Q3.3 | It answers "what size do I buy?" | ✅ | 58.27 mm is not a pipe. **DN65 (62.7 mm)**, through the schedule's own `sizeForFlow` — the same rule the sizer uses — so the tool cannot recommend a size the model would not have picked. |
| Q3.4 | **Heat transfer: any two give the third** | ✅| Q = ṁ·Cp·ΔT. 50 kW across 5 K → **2.39 L/s**, 2.388 kg/s, capacity rate 10 000 W/K; putting the flow and ΔT back gives 50.00 kW. Uses the model's fluid, so glycol gives a glycol answer — and says on screen when those properties are the unverified ones. |
| Q3.5 | The arithmetic is tested without a DOM | ✅ | New eighth suite, `test/tools.test.js`, 36 assertions — the calculators are separated from their forms precisely so they can be hand-checked with no model open, which is the rule the tools page has always stated. |
| Q3.6 | **Looks** | ✅ | Everything above was driven through the DOM. **Nothing about how the window LOOKS has been seen** — not the tab strip, not the drag bar, not how the fields sit at 400 px wide. That is the part only you can judge. |

---

## 5O. THE PAGE NO LONGER FREEZES WHILE IT SOLVES (S3, v0.16.8)

The solve still TAKES 30–40 s on your data centre. What changed is that the
browser stays alive for all of it.

Everything below was measured in a real browser on `20260808-DC-broken.json`
(278 pipes, 19 controlled devices) with a 50 ms heartbeat: if the thread is
blocked, the ticks stop.

| # | What | Status | Notes |
|---|---|---|---|
| S3.1 | **The page answers while it solves** | ✅ | **459 heartbeats during a 29.5 s solve.** 591 is the ceiling if the thread were completely idle, so the page was live for about four fifths of the wall clock. Median gap 62 ms, 95th 74 ms, worst 207 ms, and **nothing over 300 ms**. Before this, the whole 29.5 s was one uninterruptible block and the heartbeat fired **once**. |
| S3.2 | The answer did not change | ✅ | This is the assertion that matters most and it is why the sync driver was kept: `solveModel` drains the same generator, so all 1762 test assertions run through the new code unchanged. Checked directly on three models — economizer-trim, and both DC files — comparing every flow to 12 significant figures, every device state and position, every warning and error code. **Identical.** |
| S3.3 | The progress bar means something | ✅ | Reads e.g. `29%  Simulating… sweep 2 of 6 · CHWP-01`. The fraction is *devices settled out of the worst case* — every device on all six sweeps — so it never overstates, and a model that settles in two sweeps **finishes with the bar at a third**. That is why the sweep count is spelled out beside it. A bar that stops early beats one that goes backwards, but tell me if you would rather have an indeterminate stripe. |
| S3.4 | **An edit during a solve abandons it** | ✅ | New hazard, and it arrived WITH the fix: while the page froze, nothing could be edited underneath a running solve. Now it can be, and the loop writes actuator positions into the live model as it searches — so a solve that started before an edit is answering about a model that has moved. Verified: edit mid-solve, the first run is dropped, exactly one continues, the latch releases and the bar clears. |
| S3.5 | Nothing else changed shape | ✅ | `solveNow`, the printer, the calculation sheet and the DXF path all still call the plain synchronous `solveModel`. Only the app's debounced background solve steps the generator, and only for models over 60 pipes in SIMULATION — a small model still solves in one go, as before. |
| S3.6 | Web Workers — asked and answered | ✅ | No, and for two reasons rather than one. `file://` is a null origin so `new Worker('src/network.js')` is a SecurityError; and even past that a worker cannot `importScripts` or fetch the engine from a null origin, so the source would have to be inlined as a string — a build step. The second blocker is architectural, not a browser quirk that ages out. Written up in `HANDOVER.md` §5. |

---

## 5N. YOUR FOUR REPORTS OF 2026-08-09 (v0.16.7)

All four reproduced first, measured, then fixed. The recalculate ones were
counted by wrapping `solveModel` and driving the real gestures, so "no solve" is
a measurement rather than an opinion.

| # | What | Status | Notes |
|---|---|---|---|
| R.1 | **Clicking in static mode no longer re-solves** | ✅ | Clicking a PIPE was already fine (v0.16.0). Clicking **empty space** was not: that is the marquee path, and it ended with `changed()` — a solve and a save — for a gesture that only ever writes `selection`. Every click that missed a pipe cost you a recalculate. Measured before: 1 solve. After: none. |
| R.2 | **Picking up the PROBE no longer re-solves** | ✅ | `setTool` ended with `onChange()`, which schedules a solve and a save. Every tool change did it. It refreshes the panel now and nothing else — the panel still has to be rebuilt because TRACE, DETAIL and the annotation modes each put their own controls in it. |
| R.3 | **CONTROL and ANNOTATION no longer re-solve on the way in** | ✅ | Same cause as R.2: `setUIMode` selects a tool on entry, so every mode button inherited the solve. Measured: CONTROL, ANNOTATION and SIMULATE all now cost nothing, and a real edit still solves exactly once. |
| R.3b | And four drags that were also solving | ✅ | Found while in there. Dragging a **label**, a **note**, the **TRACE image**, a **control-link bend**, or the whole model with **ALIGN** each scheduled a full solve. None can move a number — ALIGN is documented as unable to change a length, it moves every level by the same offset. They are saved now and not solved. There is a third verb for it: `changed` (edit → solve + save), `arranged` (drawing → save only), `selectionChanged` (neither). |
| R.4 | **The dP button makes a dP sensor** | ✅ | `sensorClick` always picked the right default; `M.addPipe` copied `equip`, `pump` and `valve` and **silently dropped `sensor`**. The pipe arrived as `kind: 'sensor'` with no sensor object, and the panel then filled in its temperature default. Verified all five buttons on the real ribbon path: TEMPERATURE / FLOW / PRESSURE / DIFF. PRESSURE / DIFF. TEMPERATURE now produce `temperature` / `flow` / `pressure` / `dP` / `dT`. |
| R.5 | **A sensor's Display list offers what it measures** | ✅ | Was a fixed list — Tag, Flow, Temperature, Setpoint — whatever the instrument was. Now: a ΔP sensor offers **Differential pressure**, a ΔT sensor **Differential temperature**, a pressure sensor **Pressure**. Flow stays on every mode, because a sensor is a piece of pipe and the flow through it is always real. |
| R.5b | ...and the toggle actually draws it | ✅| A checkbox that draws nothing is the failure this project keeps catching, so the drawing was done too. Verified by capturing what the renderer paints: `374.6 kPa` on the pressure sensor, `ΔP 9.2 kPa` on the differential, `ΔT 0.0 K` on the ΔT — each matching `FD.network.sensorReading`, which is now the ONE definition of what a sensor reads, shared with the control loop so the drawing and the controller cannot disagree. |

---

## 5M. THE TEXT BOX, AND DETAILS YOU CAN SELECT (v0.16.6)

A2 and A4. They turned out to be one bug and a half, and both were found by
driving the real app in a browser — served on `127.0.0.1`, clicks dispatched at
real canvas coordinates, the result read back out of the model and out of the
pixels.

| # | What | Status | Notes |
|---|---|---|---|
| A2 | **The text box appears** | ✅ | It was always being drawn. The palette's default colour is named `line` and the theme's neutral is called `text`, so `detailColour('line')` returned `undefined` — and an invalid canvas colour is **silently ignored**, leaving the fill at `theme.bg`, which had been set two lines earlier for the note's own backing panel. Background text on a background panel. Proved by reading the pixels inside the note's box: **0 foreground pixels before, 97 after**. |
| A2b | Detail lines were the same bug, wearing a disguise | ✅ | A default-coloured detail line took whatever colour the previous draw call happened to leave. They were visible, so nobody looked — but the colour was an accident. Both now use the theme's neutral. |
| A4 | **Details and notes are selectable with SELECT** | ✅ | Not the erase behaviour after all, though that is real too — with the DETAIL tool active a click does erase. `pickAnnotation` says in its own comment that it is tried "before the model's own hit tests in VIEW, and after them in EDIT", and the EDIT half was never wired: the helper was called from exactly one place. Verified: clicking a detail line in SELECT now selects it and its panel renders; clicking a note selects it; VIEW still works; clicking empty space still clears and starts a marquee; clicking a pipe still selects the pipe. |
| A4b | Ctrl and Shift still assemble a set | ✅ | The annotation pick is only tried on a PLAIN click. With a modifier held you are building a selection by hand, and a stray detail line under the pointer must not replace it. |

---

## Awaiting Michael's eye — new in v0.7.0-dev

| # | What | Status | Notes |
|---|---|---|---|
| 8.19 | ANNOTATIONS: "Node" group, with a Pressure toggle | ✅ | Show -ve pressure in red. |
| 8.20 | Visualisers: FLOW, VELOCITY, PRESSURE | ✅ | Gradient pressure between 2 nodes on pipe. |

---

## 1. Calculations

| # | What | Status | Notes |
|---|---|---|---|
| 1.3 | Hazen-Williams against a manual calculation | ✅ | **Constants independently confirmed 2026-07-31**: ASHRAE Eq (6), Δh = 6.819·L·(V/C)^1.852·(1/D)^1.167, reduces algebraically to the app's A = 10.67 and e = 4.8704 (agreement 0.035% and 0.012%). ASHRAE Example 1 also reproduces exactly (750.0 Pa). A full worked pipe run by hand is still outstanding. |
| 1.6 | Pump duty vs. a real selection | ✅ | |
| 1.15 | K tables against your printed page | ✅ | All 144 tabulated values in both Table 3 and Table 4 now match, asserted in `engine.test.js` from a second independent transcription. The threaded 45° elbow question is closed: the column really is flat (0.38 → 0.28). |

---

## 3. Devices

| # | What | Status | Notes |
|---|---|---|---|
| 3.2 | Pump insert, auto / fixed / off | ✅ | Auto-sizing reworked twice. Re-check duty figures. |

---

## 4B-EQ. EQUIPMENT PANELS reworked (v0.11.2)

| # | What | Status | Notes |
|---|---|---|---|
| EQ.8 | Blank capacity / ΔT max / T limit really are unlimited | ✅ | Engine-tested both directions, 9 assertions. |

---

## 5H. THE LOST SETPOINTS, AND ANNOTATION (v0.16.1)

| # | What | Status | Notes |
|---|---|---|---|
| LS.1 | **The reported error was stale** | ✅ | CHWP-01 reported `err −0.086 K` on a 30 °C setpoint while its sensor read **32.76 °C**. `error` was carried over from the last probe of that device's search; the sweep then settles *other* devices and moves the plant out from under it. It is now re-derived as `measured − target` from the same state the rest of the row is read from, so the three numbers can no longer contradict each other. |
| LS.2 | ...and so was the state | ✅ | It said `on` — holding — while 2.8 K out. If the final measurement is outside the deadband the device is not holding, whatever the search concluded. Now reported `unsettled`, with `driftedAfterSearch` set so the cause is distinguishable from a device that never settled at all. |
| LS.5 | **This is a modelling decision I want your ruling on** | ✅ **RULED, done in v0.16.4 — see 5K** | Design ΔT is the ΔT **at design flow**. At part flow the same machine moving the same duty produces a *larger* ΔT — Q = ṁ·Cp·ΔT. Clamping ΔT at any flow therefore caps the duty at `ṁ·Cp·ΔT_design`, which *falls as flow falls*: the model says reducing flow through a chiller reduces its capacity, which is backwards. **My recommendation:** `qMax` should be the capacity limit, and Design ΔT should be a design-point statement used to derive it — not a runtime clamp. That is a change to the physics of every existing model, so I have not made it. Say the word. |
| A3 | Detail lines snap | ✅ | 15° bearing **and** grid, using the pipe tool's rule: the grid constrains the LENGTH ALONG the bearing, not the position. Snapping position instead pulled a 15° aim to 14.04°, because the nearest grid intersection is almost never on the ray. Verified: four aims at 14.6/46.1/73.1/170.1° land on exactly 15/45/75/165°, each at a 0.5 m multiple of length. Shift frees both. |
| A5 | DETAIL tool shows its settings | ✅ | Palette and line width for the *next* line, since with the tool active there is nothing selected to describe. Changing the tool's colour pushes no undo — undo should take back the line you drew, not the colour you were about to draw in. |
| A6 | `ADD LINK NODE`, and click-to-place | ✅ | Renamed. With nothing selected the button now ARMS: the next click on any control link or ΔP route puts a bend exactly where you point, snapped, then disarms. Selecting the device first still adds one at the longest segment's midpoint. Verified: a 4-point route became 5 with the new bend at the clicked position. |
| A7 | Route handles are easier to grab | ✅ | 14 px → 22 px. They often sit on a pipe that is also asking for the click. |
| A1 | No arrow at zero flow | ✅ | (v0.15.7) |

---

## 5G. PERFORMANCE, AND STATIC SIMULATION (v0.16.0)

| # | What | Status | Notes |
|---|---|---|---|
| S2a | **Selecting no longer re-solves** | ✅ | This was the big one and it was one line of wiring. *Every* selection went through `changed()`, which schedules a solve AND a save — so clicking a pipe on your DC model queued a forty-second solve for an answer that cannot have changed. Selection now has its own path: panel, levels, redraw, stop. |
| S2b | **The hydraulic solve is ~1.5× faster** | ✅ | 57 s → 39 s on the DC model, *identical answers* (all 1681 assertions pass). Every GGA iteration was building a dense 250×250 matrix and running O(n³) Gaussian elimination — but that matrix is a graph Laplacian: symmetric, positive-definite, ~4 non-zeros per row. It now factorises as a skyline LDLᵀ and falls back to the general solve if a pivot says it is not SPD after all. |
| S3c | A trap worth knowing | ✅ | The first driver gated its slices on `requestAnimationFrame`, which **does not fire in a hidden or backgrounded tab** — a solve started and then never continued. Everything now runs off `setTimeout`. |

---

## 5F. THE CHWPs, AND A TAG REPAIR (v0.15.9)

| # | What | Status | Notes |
|---|---|---|---|
| CH.1 | **CHWP-01..04 now hold 30 °C** | ✅ | You were right that they should not be fighting — they were not. Sweeps 1–5 settled all four to within 0.02 K. **Sweep 6 ran out of the solve budget**, and a truncated search left each one sitting at the probe position, which is the actuator's FLOOR — a chiller at quarter flow does not hold its leaving temperature, so the errors came back as 669, 1317 and 1629 K, all four were judged unsettled, and then parked at 100%. A search that cannot finish is now a **no-op**: the device keeps the position its last complete sweep gave it. |
| CH.2 | The budget scales with the work | ✅ | Was capped at 400 — chosen when a big model had three controllers. Now 120 per controller. `CONTROL_BUDGET` says so if it still bites. |
| TG.2 | So it is attacked from the other end | ✅ | A tag box now **refuses** to commit a value of that shape; a second lock means it can only write to something still selected; `TAG_MANGLED` reports any it finds on every solve; and **REPAIR** on the FILE group strips the suffix. Verified on your file: `CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1` → `CHWP-04`. |

---

## 5D. SELECTION, PICKING AND TWO SLIDERS (v0.15.7)

| # | What | Status | Notes |
|---|---|---|---|
| Q5 | **Shift-click to build a selection** | ✅ | Adds, and shift-clicking something already in the set removes it. Verified 1 → 2 → back to 1, with the bulk panel appearing. A shift-click never starts a DRAG — moving geometry during what reads as a selection would be its own bug. |
| C1 | **CHWP-1 unpickable for a control link** | ✅ | Picking a controller took `deviceAt \|\| pipeAt`, and a pump sits IN a pipe with more pipe running away either side — so a click a few pixels off the symbol found the plain pipe, `canControl` said no, and you were told to "click a pump" while pointing at one. `controllableAt` searches devices first at a generous radius and **can only ever return something linkable** — verified over 45 probes across the model, zero unlinkable results. |
| C7 | **Manual VFD slider** | ✅ | Appears as its own Speed section only when the pump has no control link — with a link the position is an output and a slider would be a lie. Verified: absent when linked, present the moment the link is cleared. |
| E4 | Grey `Auto` in an unlimited capacity box | ✅ | Your ruling. An empty box read as a field nobody had filled in rather than as a decision. |
| UI.6 · DB.5 | Closed on your ruling | ✅ | Max/Min indicator as-is; 0.2% deadband confirmed. |

---

## 5C. EQUIPMENT CONTROLS, AND FOUR SMALL ONES (v0.15.6)

| # | What | Status | Notes |
|---|---|---|---|
| EQ.1 | **Integrated control valve** | ✅ | A globe valve built into the machine, holding that machine's own Design ΔT — no valve, sensor or link to draw. It is a real resistance in series with the coil (verified: 12 Kv wide open drops the branch flow; at 10% travel its resistance is 9.2e9 against the coil's 5.1e5 and the branch all but closes) and a real actuator (appears in the control report holding its own equipment on a ΔT). |
| EQ.2 | **Capacity override** | ✅ | 0–100% on the stated duty. Verified: 40% gives 20 kW from a 50 kW coil, 0% gives nothing, and **the design figure is untouched** — the machine is still on the schedule at full duty. Remove the override and it is back to 50 kW. |
| EQ.3 | Temperature limit reads from the left | ✅ | |
| C8 | **Multiple devices on one sensor** | ✅ | Your wording, verbatim, as a DEFECT. The gang stays underneath it so the answer is never arbitrary — `detail` says so — but the message tells you to link one and sync the rest. |
| C5 | dP setpoint tag said Temperature | ✅ | The drawing's `SP` label fell through to °C for both differential modes. Same fall-through that put "200000.0 °C" on a pump switch in v0.15.1; this was the other place it hid. |
| C6 | Sensor showed its temperature twice | ✅ | "35.4 → 35.4 °C" is one number written twice. An instrument now shows one value; anything that actually does something thermal still shows both, because there they differ. |
| C2 | `Control Link` → `Add Control` | ✅ | |

---

## 5B. PUMPS IN PARALLEL (v0.15.5)

| # | What | Status | Notes |
|---|---|---|---|
| PP.1 | **Four PWPs settle together** | ✅ | On `-DC-broken` they now all run **67.5%, ~8.9 L/s each**, holding the 250 kPa differential to within 225 Pa. Before: 100 / 85.8 / 25 / 25, with the last two on their floor carrying **no flow** — back-pressured shut by the first two. `SETPOINT_LOST` is gone. |
| PP.5 | **Dangling control links** | ✅ | Found while tracing: in `20260807-DC.json` all four PWPs point at `P455`, which is **not in the model** — the sensor was deleted and the links stayed. They were silently uncontrolled at 100%, with nothing said. `CONTROL_TARGET_GONE` now reports it. Part of your "controls get dropped". |

---

## 5A. THE TWO CRITICAL BUGS (v0.15.4)

| # | What | Status | Notes |
|---|---|---|---|
| CR.1 | **Controls section disappearing** | ✅ | A readout helper in the pump's Actual section did not `return` its row, so hanging an info marker off it threw — from inside `renderProperties`, HALF WAY THROUGH. Details and Design were already appended; Control and Display never were. The model never lost anything; the panel stopped drawing. It fires when a pump carries a speed below 1 and the mode is DESIGN — i.e. on every modulating pump the moment you leave SIMULATE, which is exactly when you saw it. |
| CR.2 | ...and it took the rest of `changed()` with it | ✅ | The exception escaped into `changed()`, so the autosave, the clean-snapshot bookkeeping and the solve schedule were all skipped whenever it fired. That is the other half of "intermittently dropped or reset". |
| CR.3 | The panel now fails safe | ✅ | Wrapped in a guard: on any future render error it says so and says the model is untouched, instead of silently truncating. The shape of that failure was worse than the failure — it accuses the model of losing data it still holds. |
| CR.4 | **Silent tag corruption** | ✅ | Two causes, both fixed. (a) A focused input is detached when the panel rebuilds, and the browser fires its `change` afterwards — the closure then wrote to the device that was no longer selected, from a box already replaced on screen. Verified: an edit begun on P350 was landing on P350 *after* the selection had moved to P379. Every field handler is now stamped with its render and no-ops if that render is gone. (b) A nameless text input joins the browser's autofill pool, and every tag box in this app looks identical to it — which is where `CHWP-04PMP-1` and `PWP-04MP-4MP-4…` came from. The app was never concatenating anything; the browser was filling a box it had no business in. |

---

## 4Z. ANNOTATION, ROUTES AND PRINTING (v0.15.3)

| # | What | Status | Notes |
|---|---|---|---|
| AN.1 | Globe valves read CV | ✅ | The FITTINGS table keeps `GLV` — there it really is "globe valve, open" as a K factor, which is a different statement. |
| AN.2 | **Temperature discontinuities** | ✅ | Your fix, implemented as described. On `20260807-1` the bypass is now a uniform 30 °C, the chiller leg a uniform 15 °C and the run below the mix a uniform 20.08 °C — three flat colours meeting at the tee instead of three ramps into it. |
| AN.7 | Printing as-shown | ✅ | Device tags, value boxes, control links, ΔP routes, detail lines and notes all reach the page now. Verified: 6 dashed links + 1 ΔP route + the note + PMP-01's tag and flow; turn LINKS off on the ribbon and both link kinds leave the page while the annotation stays. |
| AN.8 | Old files still take annotations | ✅ | A file written before details existed had no id counter for them, so every one came out `DNaN` — same id, undeletable. Worth a spot-check on one of your older saves. |

---

## 4Y. THE ECONOMIZER MODEL, AND FIVE UI ITEMS (v0.15.2)

| # | What | Status | Notes |
|---|---|---|---|
| EC.1 | **`20260807-1` converges** | ✅ | One cause behind all three symptoms. The control search is a DESCENT from full travel; a later sweep starts where the last finished, so a device that needs to OPEN had nowhere to look, reported `at-max` mid-travel, and got parked at 100%. Sweep 1 had already found a good answer and sweep 2 threw it away. |
| EC.2 | The plant now does what you described | ✅ | CT-01 35.04 → 30.00 · ACCH-1 30.00 → 15.00 (ΔT-limited) · TS-2 20.08 · PMP-01 91.9% holding 200.8 kPa against 200 · PMP-02 48.8% · all four coils within 0.6% of rated flow · a third of the flow bypassing, which is exactly what 30/15 → 20 mixing requires. Frozen as `test/fixtures/economizer-trim.pnet.json`. |
| UI.11 | Heating/Cooling toggles on an empty box | ✅ | Your bug. A signed number cannot express "cooling, magnitude not yet decided", so the switch had nothing to write. The direction is now held as a UI intent until a number exists, then the stored sign takes over. |
| UI.12 | Red heating, blue cooling | ✅ | The one place in this app where red is not a fault. |
| UI.13 | Units in the label, box left-aligned | ✅ | "Capacity (kW)", and the entry reads from the left like every other field. |
| UI.14 | Clicking the status chip highlights | ✅ | It set `chip.onclick` to open CALCULATION in the DEFECTS branch and never cleared it, so once a model had raised a defect ONCE the chip jumped to the sheet for the rest of the session. Removed — it highlights at every severity now. |

---

## 4X. UI PASS, PANELS AND THE RIBBON (v0.15.1)

| # | What | Status | Notes |
|---|---|---|---|
| UX.1 | The ribbon is two rows | ✅ | **My bug, and an instructive one:** `display:flex` on `.tool-set` beats the UA's `[hidden] { display:none }`, so all four modes' tools rendered at once — what you photographed. Fixed, and split into chrome-on-top / tools-underneath, since DESIGN's tools alone are 1374 px and one row wrapped anyway. Verified single-line at 1440 and 1920. |
| UX.2 | `res.actual` gone from DESIGN | ✅ | Your call. It turned out DESIGN was the only place it was ever *read* — SIMULATION always preferred the simulation report — so it is gone entirely rather than moved. The error box now says a negative pressure is the head that is MISSING, and points at SIMULATE for what would really be delivered. |
| UX.4 | **Heating/Cooling switch** | ✅ | Replaces the typed minus sign. Verified: toggling 50 kW heating gives −50 kW stored and reads "Cooling"; typing `-12` moves the switch by itself. A typed sign always wins. |
| UX.5 | Cooling loads read positive | ✅ | "Cooling load 50.00 kW" in the panel, "Cool 50.0 kW" on the drawing. Display only — stored, calculated and exported values keep the sign. |

---

## 4W. UI PASS, FIRST STAGE (v0.15.0)

| # | What | Status | Notes |
|---|---|---|---|
| UI.1 | Four modes | ✅ | DESIGN / CONTROL / SIMULATE / ANNOTATION, each with its own tools. Verified: each shows only its own set, and picking a tool from anywhere pulls the ribbon to that tool's mode. |
| UI.2 | Only DESIGN and SIMULATE touch the calculation | ✅ | **Deliberate, and worth checking you agree.** CONTROL and ANNOTATION leave `calcMode` alone, so you can go SIMULATE → CONTROL and tune a link with the valve positions still on screen. Coupling them would blank every position at the moment you went to look. |
| UI.7 | Property sections collapse and stay collapsed | ✅ | Verified across a re-render and a re-selection; stored in localStorage per section NAME, so closing Display closes it for every device. |
| UI.8 | The pump panel in the new structure | ✅ | Details · Design · Actual · Control · Display, exactly your list. Renames done: Online/Offline, Input/Show/Clear, Link sensor, Remove control, Reset link. |
| DP.4 | The second dP/dT tapping drags along its pipe | ✅ | Your note. Clamped to the run: verified at t=0, t=1, and dragged well off the pipe. It moves the DRAWING only — the reading is still taken at the pipe's inlet node, since a pipe has one pressure at each end and no profile along it to read from. |
| UI.10 | Overlapping drag handles pick the nearest | ✅ | Found while testing DP.4: a tapping under a control-link bend resolved by draw order, which is not something you can see. Nearest centre now. |

---

## 4V. THE ΔP ROUTE, REBUILT (v0.14.9)

| # | What | Status | Notes |
|---|---|---|---|
| DR.6 | Setpoint switches show the right units | ✅ | Found while checking DR.4: a pump holding 200 kPa had its own switch reading **"Differential pressure 200000.0 °C"**. The formatter only knew flow, ΔT and °C, and the three modes the sensor added all fell through to °C. Now 200.0 kPa. |

---

## 4U. ANGLE SNAP AND THE ΔP LEADERS (v0.14.8)

| # | What | Status | Notes |
|---|---|---|---|
| AS.1 | 15° snapping works again | ✅ | Nothing was wrong with `angleSnap` — untouched since v0.4.0. `shiftDown` was set on keydown and cleared on keyup, and **a keyup that arrives somewhere else never clears it**. Hold Shift, Alt+Tab away (Shift+Alt+Tab *is* the reverse app switch), and it stays suppressed for the rest of the session. Now read off the pointer event, so one mouse movement fixes it. Verified: forced the stuck state, drew three pipes, got exact 15° multiples. |
| AS.2 | Shift still disables it while genuinely held | ✅ | Verified in the same run — held reads true, released reads false. |

---

## 4T. PUMP SIZING AND SOURCE MIXING (v0.14.7)

| # | What | Status | Notes |
|---|---|---|---|
| PS.1 | An auto-sized pump goes straight to SIMULATE | ✅ | Draw a pump, leave it alone, switch mode. The SIZER generates the curve now, so the panel no longer has to be visited. Verified with a pump created exactly as the canvas creates it: generated curve after one DESIGN solve, gate passes. |
| PS.2 | Manual values survive | ✅ | Typed 9.0 L/s / 31 m, solved, isolated the pump, put it back, solved again — unchanged throughout, and it returned as `fixed` rather than `auto`. |

---

## 4S. DEADBAND, ROUTES AND ΔP SYMBOLS (v0.14.5)

| # | What | Status | Notes |
|---|---|---|---|
| DB.1 | Valves land between 59% and 100% | ✅ | `20260805-5`: 59 / 67 / 100 / 100%, no errors. The two at 100% are the furthest branches and are genuinely within tolerance wide open — which is what your dP-controlled pump is for. |

---

## 4R. PARALLEL BRANCH BALANCING (v0.14.4)

| # | What | Status | Notes |
|---|---|---|---|
| BAL.1 | Four valves balance four branches | ✅ | `20260805-4`: all four AHUs within 1% of rated flow, valves at 36–37%. Was three valves stuck at 100% with branches 17% over. |

---

## 4Q. THERMAL section on the CALCULATION sheet (v0.14.1)

| Fill connection | Absorbed at source | Circuit temperatures | Reported |
|---|---|---|---|
| **TH.8** | **⚑ HEAT ABSORPTION AT A SOURCE — RESOLVED in v0.14.7, see SM.3** | ✅ | **FLAGGED FOR HIS EYE, 2026-08-05. Do not treat as settled.** His objection: an expansion tank tees off the return with NO FLOW through it, can only lose a trickle by conduction at the tee, and that is normally disregarded. So absent a runaway there should be little or no absorption. See the note below. **The verdict, 2026-08-06: he was right and the app was not.** A source no longer absorbs anything at all — it mixes its own make-up into whatever is flowing past — so a fill absorbs nothing wherever it is drawn, and the shortfall shows against a pinned datum instead. The dead-leg-versus-in-line distinction this row was written around has gone: it was never physics, it was where the pin happened to land. |

---

## 4N. v0.13.0 — the rest of the list

| # | What | Status | Notes |
|---|---|---|---|
| N.1 | Dead legs hold the water's temperature | ✅ | Engine-tested. Also answers your Simulate-mode item. `Source Water Temperature` no longer leaks into dead ends. |

---

## 4M. THE BLOCKER and the follow-ups (v0.12.5 / v0.12.6)

| # | What | Status | Notes |
|---|---|---|---|
| BK.1 | A cooling load is typeable | ✅ | The sign is now TYPED when you type it and CARRIED when it is recomputed. Both your models were bad only because their chillers had positive capacities. |
| BK.2 | Blank = unlimited on a Source/Sink | ✅ | Was writing the wrong field entirely. |

---

## 4L. OVERLOAD BEHAVIOUR and setpoint priority (v0.12.4)

| # | What | Status | Notes |
|---|---|---|---|
| OV.1 | The pump no longer throttles into an overload | ✅ | Was 25% (its floor); now 100%. The runaway falls from ~3000 °C to 420 °C — still a runaway, still flagged, but no longer made worse by the control. |
| OV.5 | Your third question — "once it hits the design ΔT limit the pump stops trying" | ✅ | That was it, and two things caused it. The v0.12.3 authority probe stopped the pump chasing a setpoint it could not move; this one stops it *throttling* when no setpoint is reachable. Both were needed. |

---

## 4K. CONTROL AUTHORITY and valve UX (v0.12.3)

| # | What | Status | Notes |
|---|---|---|---|
| CA.1 | The VFD no longer pins at 100% | ✅ | Your file: PMP-1 falls through to Design ΔT, settles at **57%**, chiller at exactly **15.00 K**, GLV-01 back to **100% open**. Flow 0.800 L/s = the coil's design flow. |

---

## 4J. THE HIGH-ΔP FIX and the panel rework (v0.12.1 / v0.12.2)

| # | What | Status | Notes |
|---|---|---|---|
| HP.1 | Your model sizes to **25.53 m**, was 102.68 m | ✅ | Your diagnosis was right. Chiller now drops 49.7 kPa = 200 × (0.798/1.6)², the square law at part load. No EQUIP_OFF_RATING. |
