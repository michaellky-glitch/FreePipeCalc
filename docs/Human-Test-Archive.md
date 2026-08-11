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

