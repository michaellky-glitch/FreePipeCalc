# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 1681
assertions of engine behaviour (all passing), but they
cannot tell you whether a button is
discoverable, whether a drawing prints legibly, or whether a result *looks*
right to someone who sizes pipes for a living. Only Michael can sign those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-08-05 (v0.14.1)

## Awaiting Michael's eye — new in v0.7.0-dev

Same caveat as below: built and internally verified, but the build
environment's browser has a 0×0 viewport, so **no pixels were ever rendered**
and nothing here has been looked at.

| # | What | Status | Notes |
|---|---|---|---|
| 8.1 | Undo removes a pump/equipment in ONE press | ❌ | Intermetent bug. Sometimes works. Log as unsolved but low priority. |
| 8.9 | Globe valve: symbol, and Kv about 6× lower than a gate | ⬜ | Filled disc at the throat. 7 assertions. |
| 8.10 | Check valve flapper symbol | ⬜ | Per Michael's screen snip; was a bowtie. |
| 8.13 | Dragging a node onto another joins them; straight run goes continuous | ⬜ | Refuses to dissolve a size change, a corner, or a node with a device. |
| 8.16 | Check valve symbol is larger and its direction readable | ⬜ | **Michael reported this.** 1.6× the bowtie valves. |
| 8.18 | Pipe properties show Pressure drop and PD/m | ⬜ | Verified against the engine (5.69 kPa, 699.8 Pa/m). Note they are on different lengths and say so. |
| 8.19 | ANNOTATIONS: "Node" group, with a Pressure toggle | ✅ | Show -ve pressure in red. |
| 8.20 | Visualisers: FLOW, VELOCITY, PRESSURE | ✅ | Gradient pressure between 2 nodes on pipe. |
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

## 1. Calculations

Nothing here has been signed off yet. The numbers reconcile internally and
against hand calculations, but no independent check against another tool or a
known project has been done.

| # | What | Status | Notes |
|---|---|---|---|
| 1.1 | 3-floor riser + ring main solves sensibly | ⚠️ | Built and reviewed; energy balance closes exactly. Not checked against another tool. |
| 1.2 | Data centre closed circuit, redundant pumps | ⚠️ | Runs; equipment gets exactly its rated flow and ΔP. Numbers not independently verified. |
| 1.11 | `...ring_main.pnet (fixed).json` redrawn example | ⚠️ | **Rebuilt by hand 2026-07-30 and now coherent** — devices are short links (pumps 0.7 m, equip 0.49 m), ~377 m of real pipe carries friction, solves cleanly as a 20 L/s circuit. Numbers not yet independently verified against another tool. |
| 1.3 | Hazen-Williams against a manual calculation | ✅ | **Constants independently confirmed 2026-07-31**: ASHRAE Eq (6), Δh = 6.819·L·(V/C)^1.852·(1/D)^1.167, reduces algebraically to the app's A = 10.67 and e = 4.8704 (agreement 0.035% and 0.012%). ASHRAE Example 1 also reproduces exactly (750.0 Pa). A full worked pipe run by hand is still outstanding. |
| 1.10 | Hazen-Williams, converging/diverging tees | ❌ | **Michael found this wrong.** Two causes, both confirmed in code — see `ENGINE.md`. Blocked on choosing a coefficient source. |
| 1.5 | Loop flow split against hand calculation | ⚠️ | A SYMMETRIC ring now splits exactly in half (asserted to 1e-8, and independent of drawing order) — that much is proven. Michael's `20260802-2.json` was splitting 51/49 until v0.7.10-dev; the cause was the bullhead tee, not the solver. An ASYMMETRIC split against a hand calculation is still unchecked. |
| 1.12 | Bullhead tee coefficient | ⬜ | **New in v0.7.10-dev, and the one to rule on.** Where two ring legs leave a tee in line with each other, both are now charged as a BRANCH (K = 1.1) rather than one as a run (K = 0.9). No number was invented — it is a choice of which tabulated coefficient applies — but you hold ASHRAE Tables 3/4 and this case (inlet through the branch, dividing into both run legs) is arguably its own fitting. Worth confirming. It raises pump duties slightly: +0.20 m on the 3-floor model, +2.6 kPa on the data centre. |
| 1.6 | Pump duty vs. a real selection | ✅ | |
| 1.7 | Darcy-Weisbach | ⚠️ | **Unblocked, BETA (v0.8.0).** Swamee-Jain, at your selection. Validated against a Colebrook iteration written independently in the test suite: 0.9% over the practical envelope, 2.8% at the corner of its published validity (Re 5000, ε/d 1e-2). End to end on 100 m of DN50 at 5 L/s the app gives 11.126 m against 11.046 m hand-iterated. **Never checked against another tool or a real job** — that is what the BETA line on the sheet is for. |
| 1.16 | Equivalent length: three tables | ⬜ | **v0.8.2–0.8.4.** Carrier Table 11 is the default; NFPA 13 and Custom are the alternatives. All 104 published cells asserted against your two pages from a second independent transcription. **The agreement across sources is the reassuring part**: L/D ratios, NFPA and Carrier land within 1% of each other on both fixtures (3-floor duty 41.95 → 41.96 m), and Carrier's tee-run is within 0.25% of the old L/D value at DN100. None was fitted to any other. |
| 1.22 | Two calculation methods | ⬜ | **New in v0.9.0.** `Hazen-Williams (ASHRAE with Equivalent Lengths)` and `Darcy-Weisbach (BETA)`. Numbers moved by **0.08%** on the 3-floor duty (41.96 → 41.99 m) because the survivor derives its constants from the printed 6.819 rather than carrying the rounded 10.67 — that gap IS the rounding in 10.67. An older model saved as ASHRAE migrates to HW on load and changes fitting basis from K to equivalent length, which is a real change to its numbers. |
| 1.23 | K source citation | ⬜ | **Please check this one.** The line now reads "ASHRAE Handbook — Fundamentals, Pipe Sizing, Table 1 (threaded) and Table 2", as you asked. The values are transcribed from the page you sent, which is headed **Ch 22 Tables 3 and 4** (p.22.6), and every cell is asserted against it. The citation and the data's provenance disagree about the table numbers. |
| 1.20 | Carrier feet → metric conversion | ⬜ | Carrier is stored in FEET (the table is printed that way) and converted at ft × 0.3048 to 2 dp. That reproduces **your** metric conversion of the same table cell for cell — app, test arithmetic and your spreadsheet all agree. Worth confirming the rounding convention is the one you want. |
| 1.21 | Published tables are read-only; Custom unlocks | ⬜ | **New in v0.8.4.** You cannot type over a cell while the line beneath says "Source: NFPA 13" — pick Custom, which seeds from whatever was showing. Switching back to a published set drops the custom values rather than applying them under someone else's name. Verified in the DOM. |
| 1.19 | The Carrier row is visibly not NFPA | ⬜ | **New in v0.8.3.** Asterisk on the row, your note above the source line, and a line in the calculation-sheet appendix. Worth checking it reads clearly on a printed sheet, since that is where it matters. |
| 1.17 | Sizes below DN25 | ⬜ | **Please rule on this.** The table starts at DN25 as you asked, so a DN15 pipe is charged the DN25 figure — 0.6 m for a 90° elbow where NFPA prints 0.3 m. The printed table does have ½ in and ¾ in columns and the steel schedules go down to DN15. Two more columns would fix it. |
| 1.18 | Equivalent length shown in feet | ⬜ | The stored value is the printed METRIC column, so a model set to feet shows 1.969 ft where the page prints 2. The two columns are NFPA's own independent roundings of each other (13 ft is printed as 4 m), so no conversion reproduces both. Correct by the metric-first rule — worth knowing if you check against the page in feet. |
| 1.14 | Darcy-Weisbach fittings by K | ⬜ | **New in v0.8.1.** Fittings now charge K·V²/2g from ASHRAE Tables 3/4 under Darcy, as under ASHRAE; only Hazen-Williams uses equivalent length. Verified end to end against a hand calculation (a DN100 threaded elbow at the solved flow costs exactly 0.70·V²/2g). **Numbers on an existing Darcy model will change** — they were on an L/D basis before. |
| 1.15 | K tables against your printed page | ✅ | All 144 tabulated values in both Table 3 and Table 4 now match, asserted in `engine.test.js` from a second independent transcription. The threaded 45° elbow question is closed: the column really is flat (0.38 → 0.28). |
| 1.13 | Swamee-Jain accuracy claim | ⬜ | **Worth your eye.** The literature's "within 1% of Colebrook" is what the code used to say and it is NOT true at the corners — measured 2.8% at Re 5000 with ε/d 1e-2. The app now states 0.9% / 2.8% instead. Confirm that is the right thing to print on a sheet. |
| 1.8 | Critical path is the genuinely worst circuit | ⬜ | Picks the smallest-residual terminal. Worth checking against judgement on a real job. |

## 2. Drawing

| # | What | Status | Notes |
|---|---|---|---|
| 2.4 | Snap priority node > pipe > grid | ✅ | Rewritten so the grid constrains length along the ray. Needs a human eye. |
| 2.5 | Riser placement and cross-level connection | ✅ | Michael reported it was still being checked. Alignment logic reworked since. |
| 2.6 | Levels: add, remove, reorder by drag, `[E]` editor | ✅ | |

## 3. Devices

| # | What | Status | Notes |
|---|---|---|---|
| 3.2 | Pump insert, auto / fixed / off | ✅ | Auto-sizing reworked twice. Re-check duty figures. |
| 3.6 | Pump curve: from duty, paste, table | ⬜ | **New.** Driven in-browser during the redundancy battery; not used by hand. |

## 4. Interface

| # | What | Status | Notes |
|---|---|---|---|
| 4.4 | Vertical pipe label drag box | ⚠️ | Was a horizontal box on a vertical pipe (Michael's screenshot). Fixed; needs confirming. |
| 4.7 | Custom pipe schedule: paste from a spreadsheet | ⬜ | **New.** Three columns, all in mm. |
| 4.9 | Dark and light themes | ⚠️ | Light theme outside drawing area can be a bit grey. |
| 4.10 | Every checkbox is now a switch | ⬜ | **New in v0.7.7-dev.** Panels, the annotations list, and HYDRAULIC. Verified in the DOM (no `input[type=checkbox]` left in any panel) and each one toggles the model. Two things to look at: does a column of switches read better than tick boxes at this density, and is the muted-vs-accent off/on state clear enough? It is deliberately NOT red/green — red is a fault everywhere else in this app. |
| 4.11 | PRESSURE visualiser gradients along a pipe | ⬜ | **New in v0.7.7-dev.** Verified through the real render path: a plain pipe ramps between its two node colours, a pump/valve/equipment link gets a hard step at the symbol. Never seen as pixels — the legend, the disc-over-gradient contrast and whether the ramp is legible at working zoom are all yours. |
| 4.12 | K factor on outflows, pumps and equipment | ⬜ | **New in v0.7.7-dev.** From the design values, in the model's display units, unit spelled out (`0.316 L/s/√kPa`). Hover gives the arithmetic and warns it is neither the sprinkler K nor a Kv. |
| 4.20 | HYDRAULIC equivalent-length table | ⬜ | **New in v0.8.2.** Thirteen size columns, every cell editable, edited cells tinted, Reset button below, "Source: NFPA 13 (2019) Table 27.2.3.1.1" underneath. Verified in the DOM: it renders the printed values, an edit reaches the engine and interpolates with its neighbours, blanking a cell restores the printed figure, and Reset clears the lot. Whether thirteen columns are readable at your panel width is yours to judge. |
| 4.18 | HYDRAULIC method dropdown | ⬜ | **Bug found and fixed in v0.8.1.** It listed HW and DW only, while the default is ASHRAE — a new model showed "Hazen-Williams" in a box that was set to ASHRAE, and choosing either was a one-way door. It is built from the engine's method list now. Worth a look at whether all three read clearly. |
| 4.19 | Fitting PD annotation | ⬜ | **Bug fixed in v0.8.1**, and it affected the DEFAULT method, not just Darcy. Verified against a hand calculation (517.84 Pa both ways). Switch on ANNOTATIONS ▸ Fitting PD to see it. |
| 4.15 | HYDRAULIC formula renders with real superscripts | ⬜ | **Fixed in v0.8.0** — it was a flex-layout bug, so exponents sat on the baseline and read as separate factors. Verified in the DOM (the exponent boxes now sit 8.7 px above the baseline of the term they belong to, on both methods); never seen as pixels. |
| 4.16 | TOOLS: NFPA 20 / Generic / Copy / ⓘ on one row | ⬜ | **New in v0.8.0.** Verified all four share a line and Copy sits above the result table. |
| 4.17 | SIMULATE: pump head on the DRAWING matches the panel | ⬜ | **Bug you reported, fixed in v0.8.0.** Verified: with a deliberately weak curve, the drawing and the panel both read 109.1 kPa where the design duty is 131.7 kPa. Previously the drawing showed 131.7. |
| 4.14 | "Show on drawing" box drags independently of the tag | ⬜ | **New in v0.7.10-dev.** Verified through real pointer events on both a device and a node: dragging the tag leaves `boxOffset` alone and vice versa, and grabbing the box selects its entity. **Existing models will move**: a box that was dragged with its tag before now starts back at its default position, once. |
| 4.13 | PROBE under VIEW | ⬜ | **New in v0.7.8-dev.** Verified through real pointer events: hover follows the pipe, click pins, Esc clears the pin (a second Esc leaves the tool). The readout box, the crosshair marker and whether a 24 px catch radius feels right are all yours. Trimmed in v0.7.9-dev — no panel copy, no "(whole pipe)" note; the properties panel now shows whatever is selected. |

## 4A. TRACE mode

New in v0.5.0. Internally tested (paste, render, calibration, drag, scale, lock,
grid suppression, save/load and the autosave fallback all verified in-browser),
but nothing here has been used against a real drawing yet.

| # | What | Status | Notes |
|---|---|---|---|
| 4A.1 | Ctrl+V a real screen snip from a PDF | ⬜ | Synthetic images only so far. |
| 4A.2 | Drag-and-drop an image file | ⬜ | |
| 4A.3 | Paste works from `file://` | ⬜ | **Most important item here.** The paste event should not be blocked from disk, but it has only been proven over HTTP. |
| 4A.4 | Two-point scale calibration on a real drawing | ⬜ | Verified numerically; needs a drawing with a known dimension. |
| 4A.5 | Legibility over a white PDF background | ⬜ | Invert + 0.6 opacity is the default on the dark theme. Judgement call. |
| 4A.6 | Trace, then check lengths against the real drawing | ⬜ | The whole point of workflow 1. |
| 4A.7 | Multi-level: a different drawing per floor | ⬜ | |
| 4A.8 | Model file size with 3+ traces | ⬜ | ~50 KB each in testing. |

## 4B. DESIGN / SIMULATION modes

New in v0.5.0. The redundancy battery below was run in Node and reproduced
in-browser; the numbers were checked against hand calculations of the parallel
pump curves, not read back out of the code.

**Battery: `datacentre-ring`, pump selected at +10% on both flow and head.**

| Step | Result | Sensible? |
|---|---|---|
| 1 pump, curve at 22.0 L/s @ 285.6 kPa | 21.25 L/s @ 292.1 kPa; CRAH-01 takes 21.24 L/s (106% of design) | Yes — an oversized pump rides out along its curve until the system absorbs it |
| 4 pumps, each 5.5 L/s @ 285.6 kPa | 21.66 L/s total, 5.40–5.43 L/s each @ ~288.5 kPa | Yes — matches `H₀ − a(Q/4)²` by hand to 0.1%; identical pumps share within 0.6% |
| 1 of 4 fails | 19.82 L/s total, 6.60 L/s each @ 243.5 kPa, survivors at 120% of design | Yes — losing 25% of the pumps loses only 8.5% of the flow, and the survivors ride out |

The last row is the point of the feature: flow barely moves, but each surviving
pump is pushed to 120% of its selection, which is where motor loading and NPSH
need checking. That now raises a `PUMP_RUNOUT` warning against an editable
threshold (`settings.warn.pumpRunout`, default 120%).

| # | What | Status | Notes |
|---|---|---|---|
| 4B.1 | DESIGN/SIMULATION chip toggles and locks the calculated side | ⚠️ | Reworked in v0.7.6-dev — see 4B.6–4B.11. Nothing is a disabled input any more; both sides are read-only boxes. Needs a human eye on discoverability. |
| 4B.3 | Parallel pumps and N+1 failure | ⚠️ | Battery above. Not checked against another tool. |
| 4B.4 | Balancing Kv figures | ⬜ | Computed but never checked against a valve schedule. |
| 4B.5 | Fitted curve from a real manufacturer datasheet | ⬜ | **Most important item here.** Only synthetic curves so far. |
| 4B.6 | Pump panel: order reads Pump ID / Tag / Direction / Status / DESIGN / ACTUAL | ⬜ | **New in v0.7.6-dev.** Verified in the DOM; never rendered to pixels. |
| 4B.7 | The 🛈 marker beside the pump heading | ⬜ | **New.** Hover text confirmed present. Two things to look at: does the glyph render on your machine (it may fall back to a box), and is a hover tooltip discoverable enough for what it says? |
| 4B.8 | "New curve…" jumps to TOOLS with the duty pre-filled | ⬜ | **New.** Verified in the DOM: the tab switches and the generator opens carrying the pump's design flow and pressure. |
| 4B.9 | DESIGN vs ACTUAL boxes are visually distinguishable | ⬜ | **New.** Two `.readout` boxes with small caps titles. Purely a look question. |
| 4B.10 | Outflow in SIMULATE: design box editable, actual box beside it | ⬜ | **New in v0.7.6-dev.** The design flow is now EDITABLE in SIMULATE (it is the input the terminal's characteristic comes from, not a result). Worth confirming that reads right. |
| 4B.11 | Head is no longer a settable pump parameter | ⬜ | **New.** The box was permanently disabled and is gone. Confirm nothing is missed by its absence. |

## 4C. TOOLS tab

| # | What | Status | Notes |
|---|---|---|---|
| 4C.2 | Copy 3 points → paste into a pump | ⚠️ | Verified in-browser; the three stated duties come back exact. Not yet done by hand through the clipboard. |
| 4C.3 | Copy full table → paste into a pump | ⚠️ | Works, but shifts all three stated duties ~1%. The tool says so. |
| 4C.4 | Clipboard copy over `file://` | ⬜ | Uses the `execCommand` fallback, same as the rest of the app. Proven over HTTP only. |
| 4C.5 | Rising / concave-up curve warnings | ⬜ | Unit-tested; not seen by a human. |

## MICHAEL'S TO-DO

Things only Michael can settle, pulled out of the tables below so they are not
buried in them. Nothing here is a defect — each is a number or a judgement the
app cannot source for itself.

| # | To do | Why it matters |
|---|---|---|
| **TD.1** | **Check the propylene glycol properties** (`data/fluids.js`) | Asked for at his instruction and written from recollection of ASHRAE Ch 31, flagged `verified: false` throughout. **Cp first**: it scales every thermal duty *linearly*, and unlike a friction factor nothing downstream absorbs an error. Water is untouched at 998 / 4187. The flag shows beside the selector, on THERMAL, and on the calculation sheet. |
| **TD.2** | Set the outside surface coefficient | 8 W/m²·K is a default, not sourced. On an insulated pipe it is a small part of the resistance; on a **bare** pipe it is the whole of it. |
| **TD.3** | Set the plausibility band per service | Defaults to ±50 °C, which suits chilled water and **trips on any LTHW system** — the test suite demonstrates this at 80 °C flow. Adjustable on THERMAL. |
| **TD.4** | Confirm the insulation rule | 25 mm below DN50, 50 mm from DN50 up, per size on the schedule. His rule, so not flagged — but worth confirming it is the one he meant, including that DN50 itself takes 50. |
| **TD.9** | **Confirm the pump-curve cut-off at 200% of duty flow** | Done as asked. Note it changes what you see on a FITTED curve: yours reached zero head at 224% of duty, so the last 24% is now off the chart. |
| **TD.8** | **Put a minus sign in front of any cooling capacity in older files** | Capacity is now signed (− removes heat), so a chiller saved with a positive Q max will refuse to cool and say `Capacity (wrong direction)`. Not migrated automatically because the direction cannot be known before a solve — see KNOWN-ISSUES. Your `20260803-1.json` already uses −51 kW, so it is unaffected. |
| **TD.6** | **Set the VSD minimum speed** (THERMAL ▸ Setpoint control) | Defaults to 25%. Real drives vary — 25–30% is the usual range, but it is a plant decision and the app cannot source it. Sitting on the floor is reported rather than hidden. Minimum valve opening (10%) and the deadband (0.05 K) are on the same panel. |
| **TD.7** | **Judge whether a controlled pump should also be allowed in DESIGN** | It is SIMULATION-only today, because in DESIGN the demands impose the flows and a controller cannot move them. That reasoning is in `ARCHITECTURE.md` §17C — worth confirming it matches how he would expect to use it. |
| **TD.5** | Rule on the Critical Radius tool's temperature inputs | It takes ambient and fluid temperature as asked, but **r_cr = k/h contains no temperature**. They are used for heat loss and surface temperature instead. See 4E.1. |

## 4B-EQ. EQUIPMENT PANELS reworked (v0.11.2)

All of this was driven through the live DOM against `debug/20260803-1.json` and
read back, so the wiring and the text are known good. **Appearance is not** —
the preview browser renders no pixels.

| # | What | Status | Notes |
|---|---|---|---|
| EQ.1 | Heat Exchanger: `Heating/Cooling Load (kW)` with the sign tooltip | ⬜ | Read back live. Tooltip: "Positive value indicates heat entering fluid. Negative value indicates heat removed from fluid." |
| EQ.2 | Source/Sink: `Heating/Cooling Capacity (kW)`, sign tooltip + "Blank = Unlimited" | ⬜ | Read back live on ACCH-01 (−51 kW). |
| EQ.3 | Source/Sink field order: Type, Capacity, % Load, Setpoint, ΔT Max, Temperature Limit | ⬜ | Confirmed in that order on ACCH-01. |
| EQ.4 | `% Load` reads actual duty ÷ capacity | ⬜ | ACCH-01 showed **98.8%** (−50.39 / −51 kW). Shows `—` when the capacity is blank. |
| EQ.5 | ΔT max and T limit tooltips both read "Optional — leave blank for unlimited." | ⬜ | **Wording changed from yours** — you wrote "Option"; I read that as a typo for "Optional". Say if you meant it literally. |
| EQ.6 | The explanation on the Thermal heading is gone | ⬜ | Removed on both types. The sign convention moved onto the two fields it governs. |
| EQ.7 | Design flow / Load / ΔT interrelation | ⬜ | **The one to judge.** Your sequence, driven live: flow 20 L/s → load 50 kW (ΔT auto 0.598 K) → ΔT 15 K → **flow auto-recalculated to 0.7977 L/s**. Marker on all three fields explains it. |
| EQ.8 | Blank capacity / ΔT max / T limit really are unlimited | ✅ | Engine-tested both directions, 9 assertions. |

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

## 5D. SELECTION, PICKING AND TWO SLIDERS (v0.15.7)

| # | What | Status | Notes |
|---|---|---|---|
| Q5 | **Shift-click to build a selection** | ✅ | Adds, and shift-clicking something already in the set removes it. Verified 1 → 2 → back to 1, with the bulk panel appearing. A shift-click never starts a DRAG — moving geometry during what reads as a selection would be its own bug. |
| C1 | **CHWP-1 unpickable for a control link** | ✅ | Picking a controller took `deviceAt \|\| pipeAt`, and a pump sits IN a pipe with more pipe running away either side — so a click a few pixels off the symbol found the plain pipe, `canControl` said no, and you were told to "click a pump" while pointing at one. `controllableAt` searches devices first at a generous radius and **can only ever return something linkable** — verified over 45 probes across the model, zero unlinkable results. |
| C7 | **Manual VFD slider** | ✅ | Appears as its own Speed section only when the pump has no control link — with a link the position is an output and a slider would be a lie. Verified: absent when linked, present the moment the link is cleared. |
| A1 | No arrow at zero flow | ⬜ | The old threshold was 1e-9 m³/s — a numerical zero, not a hydraulic one, so a shut branch settling at 1e-7 still drew an arrow. Now `Q_MIN`, the same threshold the solver uses to decide a link carries water, so the drawing and the calculation agree about what "no flow" means. |
| E4 | Grey `Auto` in an unlimited capacity box | ✅ | Your ruling. An empty box read as a field nobody had filled in rather than as a decision. |
| UI.6 · DB.5 | Closed on your ruling | ✅ | Max/Min indicator as-is; 0.2% deadband confirmed. |

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
| C3 | dP button places a temperature sensor | ⬜ | **Could not reproduce** — all five buttons place their own kind in this build. But see C1: clicking the middle of a 25 m pipe hit-tested onto an adjacent **1 m device pipe**, which would place a sensor somewhere you did not mean. I think that is what you saw, and it is next. |

## 5B. PUMPS IN PARALLEL (v0.15.5)

| # | What | Status | Notes |
|---|---|---|---|
| PP.1 | **Four PWPs settle together** | ✅ | On `-DC-broken` they now all run **67.5%, ~8.9 L/s each**, holding the 250 kPa differential to within 225 Pa. Before: 100 / 85.8 / 25 / 25, with the last two on their floor carrying **no flow** — back-pressured shut by the first two. `SETPOINT_LOST` is gone. |
| PP.2 | Why grouping, not self-modulation | ⬜ | **Worth your view.** N loops on one sensor is degenerate — any split that gives the right reading satisfies all of them, so "self-modulating" can only ever land somewhere arbitrary. Real plant doesn't do it either: parallel pumps on a common header take ONE speed command. Your own description — fluctuates for hours, then settles at roughly equal % — is independent loops fighting, then being commanded equal. This goes straight to that answer. |
| PP.3 | Staging | ⬜ | Grouping is on *same target + same setpoint*. To stage a lag set, give it its own setpoint — that is the natural way to say it and it needs no new concept. |
| PP.4 | It says so | ⬜ | `CONTROL_GANGED` names every member, and the pump panel gains a "Modulating with" row. A behaviour this consequential should never have to be inferred. |
| PP.5 | **Dangling control links** | ✅ | Found while tracing: in `20260807-DC.json` all four PWPs point at `P455`, which is **not in the model** — the sensor was deleted and the links stayed. They were silently uncontrolled at 100%, with nothing said. `CONTROL_TARGET_GONE` now reports it. Part of your "controls get dropped". |
| PP.6 | Solve time | ⬜ | ~30 s on the DC model. Ganging cut 4 searches to 1, but this model is 275 pipes with 5 independent loops. The loading bar and Static mode you asked for are the right answers and are still on the list. |

## 5A. THE TWO CRITICAL BUGS (v0.15.4)

| # | What | Status | Notes |
|---|---|---|---|
| CR.1 | **Controls section disappearing** | ✅ | A readout helper in the pump's Actual section did not `return` its row, so hanging an info marker off it threw — from inside `renderProperties`, HALF WAY THROUGH. Details and Design were already appended; Control and Display never were. The model never lost anything; the panel stopped drawing. It fires when a pump carries a speed below 1 and the mode is DESIGN — i.e. on every modulating pump the moment you leave SIMULATE, which is exactly when you saw it. |
| CR.2 | ...and it took the rest of `changed()` with it | ✅ | The exception escaped into `changed()`, so the autosave, the clean-snapshot bookkeeping and the solve schedule were all skipped whenever it fired. That is the other half of "intermittently dropped or reset". |
| CR.3 | The panel now fails safe | ✅ | Wrapped in a guard: on any future render error it says so and says the model is untouched, instead of silently truncating. The shape of that failure was worse than the failure — it accuses the model of losing data it still holds. |
| CR.4 | **Silent tag corruption** | ✅ | Two causes, both fixed. (a) A focused input is detached when the panel rebuilds, and the browser fires its `change` afterwards — the closure then wrote to the device that was no longer selected, from a box already replaced on screen. Verified: an edit begun on P350 was landing on P350 *after* the selection had moved to P379. Every field handler is now stamped with its render and no-ops if that render is gone. (b) A nameless text input joins the browser's autofill pool, and every tag box in this app looks identical to it — which is where `CHWP-04PMP-1` and `PWP-04MP-4MP-4…` came from. The app was never concatenating anything; the browser was filling a box it had no business in. |
| CR.5 | Check your two saved files | ⬜ | `20260807-DC.json` and `-DC-broken.json` BOTH already carry the mangled tags — the corruption predates them, so the fix cannot repair them. Three to correct by hand: `P298` → PWP-04, `P379` → CHWP-02, `P413` → CHWP-04. |

## 4Z. ANNOTATION, ROUTES AND PRINTING (v0.15.3)

| # | What | Status | Notes |
|---|---|---|---|
| AN.1 | Globe valves read CV | ✅ | The FITTINGS table keeps `GLV` — there it really is "globe valve, open" as a K factor, which is a different statement. |
| AN.2 | **Temperature discontinuities** | ✅ | Your fix, implemented as described. On `20260807-1` the bypass is now a uniform 30 °C, the chiller leg a uniform 15 °C and the run below the mix a uniform 20.08 °C — three flat colours meeting at the tee instead of three ramps into it. |
| AN.3 | Control link nodes drag freely | ⬜ | Grab any bend. The first drag converts the Z into waypoints, starting from exactly what is on screen so it does not jump. Grid-snapped; Shift for free placement. |
| AN.4 | LINK NODE adds a bend | ⬜ | Select the pump, valve or sensor first, then press it. It goes in the middle of the longest segment — the one with room. |
| AN.5 | **DETAIL** | ⬜ | Click to place vertices, Esc finishes, click an existing line to erase it. Colour and width in Properties. Nothing in the calculation ever reads them — pinned by a test that solves before and after adding a 100 m line across the model. |
| AN.6 | **TEXT BOX** | ⬜ | Click to place, click again to edit, drag to move. Multi-line. |
| AN.7 | Printing as-shown | ✅ | Device tags, value boxes, control links, ΔP routes, detail lines and notes all reach the page now. Verified: 6 dashed links + 1 ΔP route + the note + PMP-01's tag and flow; turn LINKS off on the ribbon and both link kinds leave the page while the annotation stays. |
| AN.8 | Old files still take annotations | ✅ | A file written before details existed had no id counter for them, so every one came out `DNaN` — same id, undeletable. Worth a spot-check on one of your older saves. |

## 4Y. THE ECONOMIZER MODEL, AND FIVE UI ITEMS (v0.15.2)

| # | What | Status | Notes |
|---|---|---|---|
| EC.1 | **`20260807-1` converges** | ✅ | One cause behind all three symptoms. The control search is a DESCENT from full travel; a later sweep starts where the last finished, so a device that needs to OPEN had nowhere to look, reported `at-max` mid-travel, and got parked at 100%. Sweep 1 had already found a good answer and sweep 2 threw it away. |
| EC.2 | The plant now does what you described | ✅ | CT-01 35.04 → 30.00 · ACCH-1 30.00 → 15.00 (ΔT-limited) · TS-2 20.08 · PMP-01 91.9% holding 200.8 kPa against 200 · PMP-02 48.8% · all four coils within 0.6% of rated flow · a third of the flow bypassing, which is exactly what 30/15 → 20 mixing requires. Frozen as `test/fixtures/economizer-trim.pnet.json`. |
| EC.3 | The one remaining warning | ⬜ | `EQUIP_LIMITED` on ACCH-1: it is on its 15 K design ΔT, so from 30 °C it can only reach 15 °C. That is your design, not a fault — but check the ΔT is what you meant. |
| UI.11 | Heating/Cooling toggles on an empty box | ✅ | Your bug. A signed number cannot express "cooling, magnitude not yet decided", so the switch had nothing to write. The direction is now held as a UI intent until a number exists, then the stored sign takes over. |
| UI.12 | Red heating, blue cooling | ✅ | The one place in this app where red is not a fault. |
| UI.13 | Units in the label, box left-aligned | ✅ | "Capacity (kW)", and the entry reads from the left like every other field. |
| UI.14 | Clicking the status chip highlights | ✅ | It set `chip.onclick` to open CALCULATION in the DEFECTS branch and never cleared it, so once a model had raised a defect ONCE the chip jumped to the sheet for the rest of the session. Removed — it highlights at every severity now. |
| UI.15 | **Blank capacity = unlimited, not "auto"** | ⬜ | **Your question.** There is no auto-balance mode. For a SOURCE/SINK, blank capacity already gives you most of what you asked for: it modulates freely to hold its leaving temperature, so it absorbs whatever the loop throws at it. What blank does NOT do is size itself against the load and report a duty you could put on a schedule. Say if you want that. |

## 4X. UI PASS, PANELS AND THE RIBBON (v0.15.1)

| # | What | Status | Notes |
|---|---|---|---|
| UX.1 | The ribbon is two rows | ✅ | **My bug, and an instructive one:** `display:flex` on `.tool-set` beats the UA's `[hidden] { display:none }`, so all four modes' tools rendered at once — what you photographed. Fixed, and split into chrome-on-top / tools-underneath, since DESIGN's tools alone are 1374 px and one row wrapped anyway. Verified single-line at 1440 and 1920. |
| UX.2 | `res.actual` gone from DESIGN | ✅ | Your call. It turned out DESIGN was the only place it was ever *read* — SIMULATION always preferred the simulation report — so it is gone entirely rather than moved. The error box now says a negative pressure is the head that is MISSING, and points at SIMULATE for what would really be delivered. |
| UX.3 | Equipment panel | ⬜ | Details · Design · Actual · Display, your list. Heat source/sink and heat exchanger get their own Design fields; "Other" (adiabatic) drops to Flow / Pressure drop / K factor. |
| UX.4 | **Heating/Cooling switch** | ✅ | Replaces the typed minus sign. Verified: toggling 50 kW heating gives −50 kW stored and reads "Cooling"; typing `-12` moves the switch by itself. A typed sign always wins. |
| UX.5 | Cooling loads read positive | ✅ | "Cooling load 50.00 kW" in the panel, "Cool 50.0 kW" on the drawing. Display only — stored, calculated and exported values keep the sign. |
| UX.6 | Temperature limit Max/Min | ⬜ | Shown beside the value, following the load direction: a heating coil is limited by a maximum, a cooling coil by a minimum. It is an indicator, not a second input — the engine already works out which side binds, and two ways of saying it could disagree. **Tell me if you wanted it settable.** |
| UX.7 | Control valve vs isolation valve | ⬜ | Two panels now. Isolation gets Open/Closed as its Status and no position slider — a gate valve is not a regulating device. **One judgement call:** an existing gate valve left part-open keeps its slider, so nothing drawn before this loses a setting silently. |
| UX.8 | Check valve | ⬜ | Third shape: Direction, Kv, no status and no position. |
| UX.9 | % Load and Position % on the drawing | ⬜ | Both were offered as toggles and neither was drawn. On a balanced circuit the valve positions are the answer, so they are the thing you want on a plot. |

## 4W. UI PASS, FIRST STAGE (v0.15.0)

| # | What | Status | Notes |
|---|---|---|---|
| UI.1 | Four modes | ✅ | DESIGN / CONTROL / SIMULATE / ANNOTATION, each with its own tools. Verified: each shows only its own set, and picking a tool from anywhere pulls the ribbon to that tool's mode. |
| UI.2 | Only DESIGN and SIMULATE touch the calculation | ✅ | **Deliberate, and worth checking you agree.** CONTROL and ANNOTATION leave `calcMode` alone, so you can go SIMULATE → CONTROL and tune a link with the valve positions still on screen. Coupling them would blank every position at the moment you went to look. |
| UI.3 | Tools grouped by what the thing IS | ⬜ | Edit · Pipe · Hydraulic · Thermal · Valves, named on the ribbon. |
| UI.4 | One button per device type | ⬜ | The valve dropdown is gone and equipment type is choosable at placement: HEAT SOURCE/SINK and HEAT EXCHANGER get the right defaults, OTHER places an adiabatic item tagged STR-n. |
| UI.5 | CONTROL LINK is a tool | ⬜ | Click the pump or control valve, then its target. The panel button still works and is now "Link sensor". |
| UI.6 | Copy/Paste moved out of FILE | ⬜ | Into DESIGN ▸ Edit, beside the selection they act on. |
| UI.7 | Property sections collapse and stay collapsed | ✅ | Verified across a re-render and a re-selection; stored in localStorage per section NAME, so closing Display closes it for every device. |
| UI.8 | The pump panel in the new structure | ✅ | Details · Design · Actual · Control · Display, exactly your list. Renames done: Online/Offline, Input/Show/Clear, Link sensor, Remove control, Reset link. |
| UI.9 | Design duty shown but not editable on Auto/Curve | ⬜ | Dashed, greyed, unfocusable. Your instruction — and it stops the panel changing height when the dropdown moves. |
| DP.4 | The second dP/dT tapping drags along its pipe | ✅ | Your note. Clamped to the run: verified at t=0, t=1, and dragged well off the pipe. It moves the DRAWING only — the reading is still taken at the pipe's inlet node, since a pipe has one pressure at each end and no profile along it to read from. |
| UI.10 | Overlapping drag handles pick the nearest | ✅ | Found while testing DP.4: a tapping under a control-link bend resolved by draw order, which is not something you can see. Nearest centre now. |

**NOT in this stage, and staged next:** the Equipment, Adiabatic, Isolation
Valve and Control Valve panels (the framework is in — they are mechanical now),
and the two new drawing tools, Detail and Text Box. See the reply for why those
two are their own piece of work.

## 4V. THE ΔP ROUTE, REBUILT (v0.14.9)

| # | What | Status | Notes |
|---|---|---|---|
| DR.1 | One C/Z between the two tappings | ⬜ | Your design. On `20260805-5` it comes out as the C you drew: out 1 m, along 4.44 m, back 1 m, with ΔP at the geometric centre of the middle segment. An open square at **each** tapping — both ends are measurement points, unlike the control link's one-ended ring. |
| DR.2 | Every vertex drags | ⬜ | The bubble and both bends are handles. They all move the same thing, because a three-segment orthogonal path between two **fixed** points has exactly one degree of freedom — move one bend and the other has to follow. Verified: bubble → mid 65.59, then a bend → mid 57.04. |
| DR.3 | It cannot be flipped onto itself | ⬜ | Two tappings on the same riser have no horizontal middle segment to offer, so a hard sideways drag used to collapse the route onto the pipe and straight back. It now just keeps sliding along the axis it has. |
| DR.4 | **Reset route** | ⬜ | Your request. On both the sensor panel and any pump/valve with a control link. Verified: slid the route 30 m off, reset put it back to 1 m. |
| DR.5 | A ΔP whose reference is on another level | ⬜ | Falls back to the plain bubble-and-stem, since a route to another floor would cut across pipework it has nothing to do with. Worth a look — it is the one path the new code does not take. |
| DR.6 | Setpoint switches show the right units | ✅ | Found while checking DR.4: a pump holding 200 kPa had its own switch reading **"Differential pressure 200000.0 °C"**. The formatter only knew flow, ΔT and °C, and the three modes the sensor added all fell through to °C. Now 200.0 kPa. |

## 4U. ANGLE SNAP AND THE ΔP LEADERS (v0.14.8)

| # | What | Status | Notes |
|---|---|---|---|
| AS.1 | 15° snapping works again | ✅ | Nothing was wrong with `angleSnap` — untouched since v0.4.0. `shiftDown` was set on keydown and cleared on keyup, and **a keyup that arrives somewhere else never clears it**. Hold Shift, Alt+Tab away (Shift+Alt+Tab *is* the reverse app switch), and it stays suppressed for the rest of the session. Now read off the pointer event, so one mouse movement fixes it. Verified: forced the stuck state, drew three pipes, got exact 15° multiples. |
| AS.2 | Shift still disables it while genuinely held | ✅ | Verified in the same run — held reads true, released reads false. |
| AS.3 | Connecting still beats the bearing | ⬜ | Unchanged and deliberate: a node or pipe within the snap radius wins over the 15° constraint, so a run can still land exactly on existing work. One of the three test pipes came out at −30.18° for that reason. |
| DP.1 | The ΔP stem is orthogonal | ⬜ | It was still a diagonal — I made the *reference* line orthogonal in v0.14.6 and left the leader from the pipe to the bubble alone, which only shows once the bubble is dragged. Both are Z routes now. |
| DP.2 | The reference line no longer retraces the stem | ⬜ | On `20260805-5` it left the bubble going back over its own stem and then ran parallel to the sensor's pipe 9 px off it — the mess in your screenshot. It now leaves perpendicular when the far tapping is behind the bubble. Verified over five drag positions: no diagonals, no retracing, no zero-length segments. |
| DP.3 | Drag the bubble to the far side of the pipe | ⬜ | The case that broke the first fix: the nominal normal points one way and the dragged leader arrives from the other. Worth a look in all four quadrants. |

## 4T. PUMP SIZING AND SOURCE MIXING (v0.14.7)

| # | What | Status | Notes |
|---|---|---|---|
| PS.1 | An auto-sized pump goes straight to SIMULATE | ✅ | Draw a pump, leave it alone, switch mode. The SIZER generates the curve now, so the panel no longer has to be visited. Verified with a pump created exactly as the canvas creates it: generated curve after one DESIGN solve, gate passes. |
| PS.2 | Manual values survive | ✅ | Typed 9.0 L/s / 31 m, solved, isolated the pump, put it back, solved again — unchanged throughout, and it returned as `fixed` rather than `auto`. |
| PS.3 | A pasted manufacturer curve is untouched | ⬜ | Neither the sizer nor the panel regenerates a curve marked `fitted`. |
| PS.4 | **A pump the sizer puts at ZERO head** | ⬜ | **Known gap, your call.** If the source alone satisfies every outflow, auto sizing lands on 0 m; there is no duty to build a curve from, and SIMULATE still says "Pump curve required" — which is not a useful way to say "this pump has nothing to do". Say the word and it gets its own message. |
| SM.1 | A source on a main MIXES | ⬜ | Your report. 1.76 L/s of 60 °C meeting 6.24 L/s of 10 °C make-up gives 20.99 °C; it used to read a flat 10 °C. |
| SM.2 | A source on a branch is unchanged | ⬜ | Your workaround has to keep working: every drop leaving the node came from the source, so the node sits at the source temperature exactly. |
| SM.3 | **A fill absorbs nothing, wherever it is drawn** | ⬜ | **This is the answer to TH.8.** A dead-leg fill and an in-line one on the same sealed circuit now report the SAME 20 kW shortfall, against a pinned datum rather than against the fill. Your expansion-tank objection was right — the tank was never absorbing anything, the pin was. |
| SM.4 | THERMAL_DATUM may appear where it did not before | ⬜ | It is now raised when the solve genuinely cannot pick a temperature level, and NOT raised when a chiller setpoint already sets one. On one test model the old pin was overriding a chiller holding 6 °C and booking the 83.6 kW difference as absorbed heat. Worth watching for on a model that used to be quiet. |

## 4S. DEADBAND, ROUTES AND ΔP SYMBOLS (v0.14.5)

| # | What | Status | Notes |
|---|---|---|---|
| DB.1 | Valves land between 59% and 100% | ✅ | `20260805-5`: 59 / 67 / 100 / 100%, no errors. The two at 100% are the furthest branches and are genuinely within tolerance wide open — which is what your dP-controlled pump is for. |
| DB.2 | ΔP / ΔT bubble says so | ⬜ | Was showing `T`. Two-character labels use a smaller font to fit the bubble. |
| DB.3 | The second probed pipe is drawn | ⬜ | Dotted line from the bubble to the reference pipe with an open square at the far tapping — a different mark from the control link's ring, because it means a different thing. Only when both are on the level being shown. |
| DB.4 | Control links drag in all four directions | ⬜ | Pull across the current segment and the route flips axis (1.6× hysteresis so it does not chatter). Verified live: axis h → v, mid 44.88 → 8.53. |
| DB.5 | **Is 0.2% the right flow deadband?** | ⬜ | **Your call.** Tighter than any flow meter and comfortably inside what 1% of valve travel resolves — but it is what decides whether a nearly-right branch gets throttled at all. |
| DB.6 | The reference line is orthogonal | ⬜ | Right-angle Z like the control link, not the diagonal you photographed. Leaves along the stem so it cannot double back across the sensor's own pipe. Verified: H → V → H, ending on the square. |
| DB.7 | DXF: ΔP/ΔT bubble and its reference line | ⬜ | Same defect was in the export — it said `T` too, and drew no reference line. Now `dP`/`dT` and the same orthogonal route, solid rather than dotted (R12 has no dotted linetype without an LTYPE table). Still unopened in real CAD — see DX.1. |

## 4R. PARALLEL BRANCH BALANCING (v0.14.4)

| # | What | Status | Notes |
|---|---|---|---|
| BAL.1 | Four valves balance four branches | ✅ | `20260805-4`: all four AHUs within 1% of rated flow, valves at 36–37%. Was three valves stuck at 100% with branches 17% over. |
| BAL.2 | The pump's SETPOINT_LOST is correct and now says why | ⬜ | "…PMP-1 → ACCH-1, **limited by Design ΔT** — at full travel and still off setpoint." The chiller's 15 K Design ΔT stops it reaching 7.5 °C; no pump speed fixes that. Toggle Design ΔT as a fallback on the pump if you want it to chase that instead. |
| BAL.3 | `Max control solves` on THERMAL | ⬜ | 0 = auto (40 + 30 per controlled device, capped 400). One solve is ~3.5 ms on a 36-pipe model; the whole controlled solve took ~200 ms over 50 solves. Raise it for an awkward model, lower it if a big model feels sluggish while drawing. |
| BAL.4 | **Does 36–37% look right for those valves?** | ⬜ | **The engineering judgement.** Equal-percentage characteristic, four equal branches off a common header. |

## 4Q. THERMAL section on the CALCULATION sheet (v0.14.1)

| # | What | Status | Notes |
|---|---|---|---|
| TH.1 | Heat balance, leading on the residual | ⬜ | Verified live on the stacked-riser example: residual −0.000 kW, "balanced". |
| TH.2 | **The source/fill term**, now with a warning | ⬜ | **Worth your eye.** A source holds its temperature whatever arrives, so it is a duty. On the example it reads "Absorbed at the source −6.30 kW — the plant is short by this much". That is a real finding about the example, not a rounding error. |
| TH.3 | Equipment duty table | ⬜ | Tag, type, flow, in/out, ΔT, Q, and what limited it. |
| TH.4 | Pipework heat gain / loss | ⬜ | Every pipe: length, insulation, U′, in/out, Q in watts. Totals for gain, loss, net, and **net as a % of equipment duty** — the number you actually use it for. On the example: +0.178 kW, 2.9%. |
| TH.5 | Every pipe is listed, including zero rows | ⬜ | Deliberate: a zero row on a well-insulated main is a result, and leaving it out makes the total impossible to check by adding up. Say if you'd rather they were suppressed. |
| TH.6 | The section is collapsed by default | ⬜ | So it does not print unless you open it, per the existing convention. |
| **TH.8** | **⚑ HEAT ABSORPTION AT A SOURCE — RESOLVED in v0.14.7, see SM.3** | ✅ | **FLAGGED FOR HIS EYE, 2026-08-05. Do not treat as settled.** His objection: an expansion tank tees off the return with NO FLOW through it, can only lose a trickle by conduction at the tee, and that is normally disregarded. So absent a runaway there should be little or no absorption. See the note below. **The verdict, 2026-08-06: he was right and the app was not.** A source no longer absorbs anything at all — it mixes its own make-up into whatever is flowing past — so a fill absorbs nothing wherever it is drawn, and the shortfall shows against a pinned datum instead. The dead-leg-versus-in-line distinction this row was written around has gone: it was never physics, it was where the pin happened to land. |
| TH.7 | `HEAT_IMBALANCE` warning (v0.14.2) | ⬜ | Fires above 2% of circulating duty (adjustable, HYDRAULIC ▸ Heat balance tolerance). On the stacked-riser example: "6.3 kW is being removed at the source to hold its stated temperature… the cooling plant is short by that much, or the stated temperature is wrong." |

### TH.8 — what the experiment showed

Michael's objection is correct, and it turned out to be about WHERE the fill is
drawn rather than about the thermal model.

The same sealed circuit — 60 kW coil, 40 kW chiller, adiabatic pipework — run
twice, differing only in where the fill connects:

| Fill connection | Absorbed at source | Circuit temperatures | Reported |
|---|---|---|---|
| **In the return line** (every drop passes through it) | −20.0 kW | 11.0 – 14.6 °C | `HEAT_IMBALANCE` |
| **On a dead-leg tee** (no flow through it) | **0.0 kW** | flat 11 °C | `THERMAL_SINGULAR` |

So:

* **A properly drawn expansion/fill connection absorbs nothing**, exactly as he
  says. A source only imposes its temperature on water that flows THROUGH it,
  and no water flows through a dead leg.
* **The 6.3 kW in `examples/stacked-riser.pnet.json` was my example's fault.** I
  drew the fill in the return line, where every drop passes through it — which
  is a mains connection with full flow, not an expansion tank. The example has
  been corrected.
* **`HEAT_IMBALANCE` is therefore as much a DRAWING warning as a plant one.**
  "Your fill is in the flow path" is the commonest way to trigger it.

**And it exposed a real defect, now fixed.** With the fill on a dead leg and the
plant short, the circuit is genuinely indeterminate — 20 kW into a sealed
adiabatic loop with nothing to absorb it has no steady state. The solve was
correctly detecting that (`THERMAL_SINGULAR`) but reporting a **flat 11 °C**,
which is just the seed, while `converged` stayed **true**. Meaningless numbers
presented as an answer: the exact silent failure this project keeps having to
stamp out. `THERMAL_SINGULAR` now clears `converged` like every other
"these numbers describe nothing" condition.

**Still for Michael:** whether `HEAT_IMBALANCE`'s threshold and wording are
right once he has seen it on a job, and whether a source in a flow path should
be called out on its own rather than only through its thermal consequence.

## 4P. DXF EXPORT and the message UX pass (v0.14.0)

| # | What | Status | Notes |
|---|---|---|---|
| DX.1 | **Does the DXF open in your CAD?** | ⬜ | **The one that matters, and I cannot check it.** R12 ASCII, model space in metres at true size, real Z. Try `examples/stacked-riser.pnet.json` → DXF: risers should come out as vertical lines, and the 14→7 m one skips Level 3. |
| DX.2 | Layers | ⬜ | One per level and per kind — `FPC-Level_1-PIPE`, `FPC-RISERS-RISER`, `…-SYMBOL`, `…-TAG`, `…-NODE`. Freeze what you don't want. |
| DX.3 | Symbol and text sizes | ⬜ | Text 0.25 m, symbols 0.25 m radius, both in model space. Guessed for 1:50 — tell me what they should be. |
| DX.4 | Non-ASCII in tags | ⬜ | Δ → `d`, ° → `deg`, → → `-`. R12 has no UTF-8 guarantee. |
| UX.1 | `VALVE_OVERSIZED` replaces `VALVE_AUTHORITY` | ⬜ | The two "authority" messages meant unrelated things. |
| UX.2 | `CONTROL_HUNTING` split out | ⬜ | "These devices are fighting" is not "this device cannot get there". |
| UX.3 | **DEFECT severity** | ⬜ | **Worth your eye.** The chip now reads e.g. "1 model defect, 2 warnings" and the sheet groups them. Verified live. Membership is `DEFECT_CODES` in network.js — say if anything is in the wrong bucket. |
| UX.4 | Tags instead of ids | ⬜ | e.g. "Node ORPH-1 has no pipe connected to it. Draw a pipe to it, or delete it." |
| UX.5 | Eight more messages say what to do | ⬜ | Velocity, friction rate, zero length, orphan, island, coincident nodes, riser open end, control unsettled. |

## 4N. v0.13.0 — the rest of the list

| # | What | Status | Notes |
|---|---|---|---|
| N.1 | Dead legs hold the water's temperature | ✅ | Engine-tested. Also answers your Simulate-mode item. `Source Water Temperature` no longer leaks into dead ends. |
| N.2 | Risers stack, and skip floors | ⬜ | New `examples/stacked-riser.pnet.json`: four storeys, coils on L1/L2/L4, **Level 3 skipped** — the top riser span is 7.00 m against 3.50 m for the others. Solves clean. |
| N.3 | `RISER_OPEN_END` | ⬜ | Dashed amber ring and "top/bottom open" on the level it happens on, plus a warning. |
| N.4 | Pump Sizing: Auto / Manual / Curve | ⬜ | **The one to judge.** Verified live: switching to Manual exposed Design flow/pressure and generated a curve (6.89 L/s @ 17.49 m, `source: 'generated'`). Shape is shutoff 140%, duty, 65% at 150% flow — the same shape the TOOLS generator uses. Say if you want a different one. |
| N.5 | TOOLS link removed from the pump panel | ⬜ | Generator still on the TOOLS tab. |
| N.6 | Pressure sensor | ⬜ | Reads its own inlet. Glyph letter `P`. |
| N.7 | dP / dT sensors | ⬜ | **Differs from what you described.** You asked for a floating box probing two pipes; I built it as a *reference pipe* on the ordinary sensor — pick the second pipe on the drawing. Same measurement, reuses the sensor's drawing, panel and control wiring. Overrule me if you want the free-standing box. |
| N.8 | Setpoint deficit in red on a Source/Sink | ⬜ | Shows the gap and what limited it, only when it misses by more than 0.05 K. |
| N.9 | Copy/paste properties in FILE | ⬜ | ⧉ and ⎀ buttons. Verified live. Geometry, id, tag and control links never travel; device properties only land on the same kind of device. |
| N.10 | Heating/Cooling Load on the drawing | ⬜ | New "Heating/Cooling Load" toggle in Show on drawing. |
| N.11 | Sensor Setpoint toggle | ⬜ | Was source/sink only, so it did nothing on a sensor. |
| N.12 | Control link steps 1 m off the pipe | ⬜ | Only the DEFAULT route, and only when the two ends are level — a dragged bend stays put. |

**Your three models, rechecked** — `20260805-3` now solves clean: all four AHUs at 0.80 L/s and 15 K, chiller at 200 kW, valves modulating 61/100/100/100%. `-1` still reports `NO_CONVERGE` (logged in KNOWN-ISSUES — two pumps an order of magnitude apart, imbalance 8.5e-6, essentially converged but not certified). `-2` has a pump curve of 0.5 m, which is why nothing flows; the new sizing modes prevent that being generated.

## 4M. THE BLOCKER and the follow-ups (v0.12.5 / v0.12.6)

| # | What | Status | Notes |
|---|---|---|---|
| BK.1 | A cooling load is typeable | ✅ | The sign is now TYPED when you type it and CARRIED when it is recomputed. Both your models were bad only because their chillers had positive capacities. |
| BK.2 | Blank = unlimited on a Source/Sink | ✅ | Was writing the wrong field entirely. |
| BK.3 | Control valve is equal percentage | ⬜ | Your table. On the mixing rig the valve now controls at 69% of travel instead of 33% — say whether that reads better on a real job. |
| BK.4 | "Source Water Temperature" | ⬜ | Renamed on THERMAL. It is what a SOURCE holds when it states no temperature of its own, plus the pin for a fully adiabatic circuit — not a setpoint. |
| BK.5 | Adiabatic equipment type | ⬜ | Filter/strainer: keeps its ΔP, no thermal side, no control options. Verified: 687 kPa drop retained, ΔT exactly 0, `canBeControlled` false. |
| BK.6 | "Show curve" draws the curve above the table | ⬜ | With the operating point on it. Same builder as the calculation sheet, so they cannot drift. No system curve in the quick look — say if you want it. |

## 4L. OVERLOAD BEHAVIOUR and setpoint priority (v0.12.4)

Driven live on `20260804-3.json`.

| # | What | Status | Notes |
|---|---|---|---|
| OV.1 | The pump no longer throttles into an overload | ✅ | Was 25% (its floor); now 100%. The runaway falls from ~3000 °C to 420 °C — still a runaway, still flagged, but no longer made worse by the control. |
| OV.2 | `SETPOINT_LOST`, your wording | ⬜ | "System is unable to maintain setpoint. Check heat balance." An ERROR — it clears `converged`. |
| OV.3 | **The trade-off, and it needs your ruling** | ⬜ | **The one to judge.** For a machine holding a LEAVING temperature, minimum speed was *closer to setpoint*; full speed moves the most water. The rule now picks delivered capacity. It changed the v0.11.1 economizer case, which parks at full instead of on its floor. Overrule me if that reads wrong on a real job. |
| OV.4 | Setpoint priority is a drag list | ⬜ | Same grip and gesture as LEVELS, labelled primary / secondary. Verified live: dragging ΔT above LWT stored `order:['dt','lwt']` and the engine followed. |
| OV.5 | Your third question — "once it hits the design ΔT limit the pump stops trying" | ✅ | That was it, and two things caused it. The v0.12.3 authority probe stopped the pump chasing a setpoint it could not move; this one stops it *throttling* when no setpoint is reachable. Both were needed. |

## 4K. CONTROL AUTHORITY and valve UX (v0.12.3)

Driven live on `20260804-2.json`.

| # | What | Status | Notes |
|---|---|---|---|
| CA.1 | The VFD no longer pins at 100% | ✅ | Your file: PMP-1 falls through to Design ΔT, settles at **57%**, chiller at exactly **15.00 K**, GLV-01 back to **100% open**. Flow 0.800 L/s = the coil's design flow. |
| CA.2 | `CONTROL_NO_AUTHORITY` when nothing else is toggled | ⬜ | "PMP-1 has no authority over ACCH-01's Design LWT: it is held at 20.0 °C whatever PMP-1 does… Hold a setpoint the pump can actually move — Design ΔT or design flow." |
| CA.3 | **Is falling through the right behaviour?** | ⬜ | **Your call.** With both toggled it silently moves to the second. The alternative is to refuse and make you pick. I chose silent-with-a-`(fallback)`-label in the panel. |
| CA.4 | Isolation valve / Control valve names | ⬜ | Dropdown reads Isolation valve / Control valve / Check valve. Keys in saved files unchanged. |
| CA.5 | Opening controls greyed out when controlled | ⬜ | Slider and box `disabled`, row at 50% opacity. Verified live. |
| CA.6 | `VALVE_OVERSIZED` below 10% open | ⬜ | Your wording exactly. Control valves only; a shut valve and an isolation valve are exempt. Threshold on HYDRAULIC ▸ Warning thresholds. |
| CA.7 | Valve tag, flow and PD now draw | ⬜ | **Was a real bug** — `drawValveGlyph` never called `drawTag`, so a valve showed neither its tag nor its value box while every other in-line device did. The %-open label moved below the glyph to make room. |

## 4J. THE HIGH-ΔP FIX and the panel rework (v0.12.1 / v0.12.2)

Driven through the live app on `20260804-1.json` and read back.

| # | What | Status | Notes |
|---|---|---|---|
| HP.1 | Your model sizes to **25.53 m**, was 102.68 m | ✅ | Your diagnosis was right. Chiller now drops 49.7 kPa = 200 × (0.798/1.6)², the square law at part load. No EQUIP_OFF_RATING. |
| HP.2 | Source/Sink: LWT Setpoint, Design ΔT, no Temperature Limit | ⬜ | Read back live: Capacity −100 kW, % Load 50.0%, LWT Setpoint 20 °C, Design ΔT 15 K. |
| HP.3 | Source/Sink trio interrelates | ⬜ | Your sequence, live: flow 1.2 L/s → ΔT 19.94 K; capacity −60 kW → ΔT 11.97 K; ΔT 20 K → **flow 0.7179 L/s**. Sign preserved (chiller stays a chiller). |
| HP.4 | Control section: Monitoring, then setpoint switches | ⬜ | Live on PMP-1: `Monitoring ACCH-01`, `[x] Design LWT 20.0 °C`, `[ ] Design ΔT 15.0 K`. Toggling ΔT on stored `use:{lwt:true,dt:true}`. |
| HP.5 | Priority is a **fallback**, not a blend | ⬜ | **Worth your eye.** One actuator cannot hold two setpoints at once, so the second is chased only when the first proves unreachable. Say if you meant something closer to a cascade. |
| HP.6 | Valve slider fixed | ⬜ | Range now 102 px of a 170 px row, number box 56 px. Cause: `.cell-input` overriding `.tiny-num` — same specificity, later in the file. |
| HP.7 | Sensor bubble perpendicular, draggable in VIEW | ⬜ | On your vertical run it is offset 18 px sideways and 0 px along — measured, not eyeballed. Drag key `sensorOffset`, cleared by "Reset label positions". |
| HP.8 | Sensor panel says "Linked to" | ⬜ | Was "Controlled by". |
| HP.9 | "Limited by" now reads **Design ΔT** | ⬜ | Was "ΔT max", to match the renamed field. |

## 4H. PIPE SENSOR — thermostatic mixing (v0.12.0)

Your request. Engine side is 34 new assertions including the mixing hand
calculation. Driven through the live app on a hot/cold blend and read back.
**Appearance is unsigned** — no pixels rendered.

| # | What | Status | Notes |
|---|---|---|---|
| PS.1 | SENSOR button in the COMMAND group | ⬜ | Placing one splits a pipe like PUMP/VALVE/EQUIP do. Tags auto-increment TS-1, TS-2. |
| PS.2 | Sensor symbol | ⬜ | **The one to judge.** An instrument bubble — hollow circle on a stem, `T` or `F` inside — in amber. Deliberately not the filled green/red ring a pump and chiller share, because it is not plant and has no in-service state. |
| PS.3 | Panel: Measures (Temperature / Flow), one setpoint, and who is following it | ⬜ | On the live rig it read `Temperature 45.11 °C` and `TMV-1  31% open`. Says "Controlled by: nothing" when no link exists. |
| PS.4 | Thermostatic mixing works | ⬜ | 60 °C and 10 °C blended, sensor at 45 °C, valve on the cold leg closed to 31% and held it. Hand check: 70% of the mass must arrive hot, and it does. |
| PS.5 | The residual is one percent of valve travel | ⬜ | 33% open gives 45.106 °C, 34% gives 44.845 °C — 45.000 falls between. The search keeps the closer. **Say if you want finer valve steps**; the 1% grid was your call in v0.10.3. |
| PS.6 | Flow setpoint, for constant-flow control on a branch | ⬜ | Throttles to the flow asked for within one percent of travel. An unreachable setpoint is reported rather than hunted for. |
| PS.7 | Does "Pipe Sensor" earn its place as an Equipment vs a Valve? | ⬜ | **Your call.** I made it a device kind of its own rather than an equipment subtype — it has no design point, no duty and no service state, and as equipment it would have leaked into the off-rating check, the terminal list and the duty columns. |

## 4I. PRESSURE PLAUSIBILITY GUARD (v0.12.0)

| # | What | Status | Notes |
|---|---|---|---|
| PG.1 | `debug/20260803-1.json` now refuses to report | ⬜ | "PMP-1 duty is at 125237 kPa (1252.4 bar), past the 2000 kPa plausibility limit. The arithmetic is right — something in the model is not." Clears `converged` and takes the status chip. |
| PG.2 | **Is 2000 kPa the right default?** | ⬜ | **Your call.** My reasoning: PN16 pipework, PN25 on tall risers, so a single component past 20 bar is not building services. A fire main may want it raised. Field is on HYDRAULIC ▸ Warning thresholds; 0 disables. |
| PG.3 | Equipment flow ratio is now editable too | ⬜ | Default 2×. Same panel. |

## 4G. PUMP CURVE chart on the CALCULATION sheet (v0.11.4)

Your request. Structure and content were driven through the live DOM on a
two-pump model with 12 m of static lift and one pump at 75% speed, and read
back. **Everything about how it LOOKS is unsigned** — no pixels were rendered.

| # | What | Status | Notes |
|---|---|---|---|
| PC.1 | One chart per pump, no more "first pump only" | ⬜ | Confirmed 2 charts, captioned `PMP-01` and `PMP-02 — 75% speed`. The WIP note is gone. |
| PC.2 | 90/80/70/60/50% curves, dotted | ⬜ | 5 dotted polylines per chart, each labelled at its own shutoff head where nothing else is drawn. |
| PC.3 | System curve in red | ⬜ | Uses `var(--error)`, so it is red in both themes. Labelled "system" at its top end. |
| PC.4 | The simulated operating point, marked and labelled | ⬜ | e.g. `27.41 L/s @ 277.1 kPa`. |
| PC.5 | A pump running at a speed outside the family gets its own dashed curve | ⬜ | PMP-02 at 75% drew an 8th polyline, dashed `6 3`. Say if that is clutter. |
| PC.6 | **Is the red line dense enough to read?** | ⬜ | **The one to judge.** 6–9 solved points per curve. Against static lift most of a speed sweep passes no flow, so the working range is swept again — but the line is still a polyline through solved points, not a smooth fit. |
| PC.7 | In DESIGN there is no red line, and a 🛈 says why | ⬜ | Confirmed: 0 red polylines, family and rated curve still drawn, marker reads "…the demands impose the flow, so there is nothing to trace." |
| PC.8 | Does the system curve look right for a job you know? | ⬜ | **The engineering judgement.** It is solved rather than assumed — each point is a real solve — so it should show static lift as a non-zero intercept. Worth checking against something you have sized by hand. |

## 4F. PART LOAD / VFD reporting (v0.11.3)

Your catch. The engine was already solving the intersection correctly — what
was wrong was what got reported. Swept in the live app on your own model.

| # | What | Status | Notes |
|---|---|---|---|
| PL.1 | Panel "Actual pressure" falls at part load | ⬜ | Read back live across 100→50% on your fitted curve: 439.1 → 356.0 → 281.4 → 215.5 → 158.4 → 110.1 kPa. H/H1 matched n² to four decimals. |
| PL.2 | Panel, drawing plate and calculation sheet all agree | ⬜ | All three now call `M.pumpHead()`. They disagreed before: the plate was right, the panel and sheet read the curve in DESIGN. |
| PL.3 | A typed VFD % in DESIGN no longer inflates the sized duty | ⬜ | Was 44.8 m at 100% → 179.4 m at 50%, flow pinned at 20.00 L/s. Now unchanged at 44.8 m. |
| PL.4 | 🛈 appears on VFD speed when a stored speed is being ignored | ⬜ | Only in DESIGN, and only when a speed below 100% is actually stored. Reads: "Speed applies in SIMULATION only…". |
| PL.5 | Stale "Design pressure" after a bad DESIGN solve | ⬜ | **Noticed, not fixed.** Your model still showed `Design pressure 12791.88 m` in SIMULATION — that is `hDesign` recorded by the last DESIGN solve, before the AHU was corrected. It refreshes on the next DESIGN solve. Say if you want it blanked instead when it is stale. |
| PL.6 | Does the part-load picture look right on a job? | ⬜ | **The engineering judgement.** The numbers are hand-checkable (H ∝ n², and correctly NOT n² once there is static lift) but whether the whole reading is what you expect is your call. |

## 4C. SETPOINT CONTROL — variable-speed pumps (v0.11.1)

The engine side is covered by 47 new assertions, including Michael's economizer
against a closed-form flow. **Nothing below has been rendered to pixels** — the
preview browser has a 0×0 viewport, so every item here is about appearance and
is unsigned. The DOM was driven and read back, so the wiring is known good; how
it *looks* is not.

| # | What | Status | Notes |
|---|---|---|---|
| 4C.1 | Pump info plate shows `N 54%` when modulating | ⬜ | Only when off full speed — "100%" on every pump is clutter. Line added below `H`. |
| 4C.2 | Pump panel Actual box: `Speed  54% — holding ECO-01` | ⬜ | Read back from the live DOM, so the text is right; the layout is not checked. Says `(at minimum)` when on the floor. |
| 4C.3 | Device Flow row reads `PMP-01 (54% speed)` | ⬜ | Read back live. |
| 4C.4 | Pump-curve chart: scaled curve solid, rated curve dashed behind it | ⬜ | **The one to judge.** Two polylines confirmed present; whether the dashed rated curve reads clearly at 45% opacity is a visual call. Caption says "54% speed (rated curve dashed)". |
| 4C.5 | Controlled globe valve: "Set by the control link" beside the slider | ⬜ | The position is now an OUTPUT — without this line, setting it by hand looks like a bug when the next solve moves it. Not exercised in the browser; logic is a one-line `M.controlOf` guard. |
| 4C.6 | THERMAL ▸ Setpoint control: three fields | ⬜ | Minimum pump speed (%), minimum valve opening (%), deadband (K). Values read back as 25 / 10 / 0.05. |
| 4C.7 | `CONTROL_AT_LIMIT` wording on the sheet | ⬜ | "PMP-01 is at its minimum speed (25% speed) and ECO-01 is still 2.5 K above its 25.0 °C setpoint." Engine-tested; not seen in the warnings panel. |
| 4C.9 | Pump panel now reads `VFD speed 100%` on every running pump | ⬜ | You asked for it shown; it was hidden at 100% before. There is also a **VFD %** toggle in the pump's "Show on drawing" list, off by default, which puts `VFD 54%` on the info plate. Say if you want that on by default. |
| 4C.8 | Does 54% look right for that economizer? | ⬜ | **The engineering judgement.** The flow it settles at is hand-checkable (11.97 L/s for a 250 kW machine across 5 K) but whether the whole picture is what he would expect on a job is his call. |

## 4D. THERMAL module (v0.10.0)

Built and engine-tested; nothing here has been rendered to pixels, and two data
sets need Michael's eye before anything is issued.

| # | What | Status | Notes |
|---|---|---|---|
| 4D.1 | **Propylene glycol properties** | ⬜ | **Check these first.** Written from recollection of ASHRAE Ch 31, flagged `verified: false` throughout, and the flag appears on the calculation sheet. **Cp scales every duty linearly** — 5% out on Cp is 5% out on every kW. Water is untouched (998 / 4187, the app's own values). |
| 4D.2 | **Insulation thicknesses** | ⬜ | A placeholder, and flagged as one. No single standard exists to read off — thickness follows service, ambient and jurisdiction. Set them from your standard; a pipe's own value wins, including 0. |
| 4D.3 | Outside surface coefficient | ⬜ | 8 W/m²·K, a default. On a bare pipe it is the ENTIRE resistance, so a bare-pipe answer is only as good as this. |
| 4D.4 | THERMAL tab layout | ⬜ | Sign convention, fluid readout, conditions, insulation table, last-solve summary. Never seen as pixels. |
| 4D.5 | Equipment ΔT / Q toggle | ⬜ | One toggle serves DESIGN and SIMULATION. Verified in the DOM: ΔT 6 K and a duty of −125.359 kW give exactly ∓6 K and ±125.36 kW on the same model. |
| 4D.6 | Temperature on the drawing, probe, visualiser | ⬜ | ANNOTATIONS ▸ Temperature, the PROBE readout, and a TEMPERATURE visualiser beside PRESSURE. Verified through the render path; the probe re-solves the exponential rather than interpolating between the ends. |
| 4D.7 | Fluid selector locks unless Custom | ⬜ | A named fluid's properties are read-only, for the same reason the published equivalent-length tables are. Verified in the DOM. |
| 4D.8 | **Does the whole thing agree with a job you know?** | ⬜ | **The one that matters.** Pipe heat gain, coil duties and mixed temperatures against something with known answers. Nothing here has been checked against another tool. |

## 4E. Thermal, second round (v0.10.1)

| # | What | Status | Notes |
|---|---|---|---|
| 4E.1 | **Insulation Critical Radius tool** | ⬜ | **Please rule on this one.** It takes ambient and fluid temperature as you asked, but the critical radius is `r_cr = k/h` and contains **no temperature at all** — doubling the temperature difference doubles the heat flow at every radius and moves the turning point not at all. Rather than ignore the inputs, they drive the heat loss and the **surface temperature**, which is the number to compare against dew point. With PU at k = 0.02 and h = 8, r_cr = **2.5 mm**, so it never binds on any pipe in any schedule here. If what you actually want is the condensation-control thickness, that is a different calculation and needs the room's humidity. |
| 4E.2 | Insulation moved onto the pipe schedule | ⬜ | The schedule table now shows nominal / bore / OD / wall / insulation, with only insulation editable. 25 mm below DN50, 50 mm from DN50 up. A pipe still overrides it individually, including 0. |
| 4E.3 | Current schedule + Add / Copy buttons | ⬜ | "Copy Current Schedule" seeds a new custom one from the active schedule's sizes. Custom schedules now take an **outside diameter** as their third column instead of insulation — the thermal module needs it, and without it a custom schedule falls back to the bore and understates heat loss. |
| 4E.4 | Equipment: Hydraulics header, thermal dropdown | ⬜ | "Solve Q from ΔT" / "Solve ΔT from Q". |
| 4E.5 | **A 100 kW load with no heat rejection** | ⬜ | **Your test case, and it found a real design fault.** The datum pinning would have held the loop at the flow temperature and reported a system that never warms. Ambient is a reference, so a pin is now only used when there is no source *and* no ambient coupling. The loop settles where the pipes shed exactly what the load puts in — 63–64 °C for 100 kW into 800 m of bare DN100, energy balance closing to 0 W. |
| 4E.6 | Runaway guard | ⬜ | Your alternative, kept alongside the equilibrium rather than instead of it. Outside the band it is an **error**, clears `converged`, and takes the status chip — but the temperatures are still reported, because the answer is not wrong, it is implausible, and hiding it leaves nothing to diagnose from. |

## 4F. Equipment types (v0.10.3)

| # | What | Status | Notes |
|---|---|---|---|
| 4F.1 | Source / Sink and Heat Exchanger | ⬜ | Setpoint-led and load-led. Verified against hand calculations: a 100 kW chiller asked for 6 °C from an 18 °C inlet leaves at 13.21 °C and reports "Limited by Capacity". |
| 4F.2 | Capacity vs ΔT max | ⬜ | Both are needed and bind in different places — the same machine swaps from capacity-limited to ΔT-limited at a quarter of the flow. Worth confirming that matches your plant data. |
| 4F.3 | T limit | ⬜ | Your economizer case: setpoint 25 °C, limit 18 °C. Holds 25; asked for 12 it reaches 18 and stops, reporting "T limit". |
| 4F.4 | Load ↔ ΔT are locked | ⬜ | Both boxes offered on an exchanger; each rewrites the other at the rated flow. The model stores duty. |
| 4F.5 | Valve opening 0–100%, 1% steps | ⬜ | Slider plus a typed box. The Kv curve is still tabulated at the quarter points and interpolated between them — **that interpolation is a shape, not measured data**, same caveat as the Kv values themselves. |
| 4F.6 | **Variable-speed pumps** | ⬜ | **NOT BUILT.** Your realisation that setpoints need pump modulation is right, and it is the next significant piece — see HANDOVER §9. |

## 5. Output

| # | What | Status | Notes |
|---|---|---|---|
| 5.1 | Calculation sheet readability | ⬜ | |
| 5.2 | Critical path listed first and highlighted | ⬜ | **New.** |
| 5.3 | CSV export opens cleanly in Excel | ⬜ | Check the delimiter/decimal option for your locale. |
| 5.4 | Print calculation sheet | ⬜ | Letterhead margin reserved at the top. |
| 5.5 | Print level plans — one page per level, shared scale | ⬜ | Sheets should physically overlay. |
| 5.6 | Save and reload a model | ⚠️ | Exercised constantly in testing; not deliberately stress-tested. |

## 6. Error handling

| # | What | Status | Notes |
|---|---|---|---|
| 6.1 | No source → "Water source is required" | ⬜ | |
| 6.2 | Supply insufficient → red source, actual flows in brackets | ⬜ | |
| 6.3 | Dead-ended pump | ⬜ | |
| 6.5 | Laminar flow warning | ⬜ | |
| 6.6 | Shut valve starving a demand | ⬜ | |

## 6A. Source pressure and pipe length (v0.7.7-dev)

Both of these came from `debug/20260802-1.json` and are reproduced in the
automated suites, but the *reading* is the part only you can sign off.

| # | What | Status | Notes |
|---|---|---|---|
| 6A.1 | A source node reads its stated pressure | ⬜ | Was 0 kPa gauge, which read as a jump at the next node. Now `H = z + P/(ρg)`, so the node reads exactly what is typed into it. **Every downstream number is unchanged** — check that against a model you already know. |
| 6A.2 | Setting a source pressure no longer moves the node | ⬜ | It was stored as an elevation. `20260802-1.json` now loads with its pipe at exactly 50 m, not 54.01 m. |
| 6A.3 | Pipe length is editable on a sloped pipe | ⬜ | `changeLength` was comparing a 3D length to a plan length. It now solves `plan = √(L² − rise²)` and refuses a length below the rise. |
| 6A.4 | The migration dialog on loading an older file | ⬜ | **Please read it and say whether it explains itself.** It fires once per file and it is telling you pipe lengths have changed. |
| 6A.5 | Sloped layout pipes are refused | ⬜ | **New in v0.7.8-dev.** A pipe whose ends differ in elevation is a `SLOPED_PIPE` error and takes the status chip red. Verified in-browser on the old `20260802-1.json` geometry. Worth checking against any model of yours that predates the rule — if one lights up, the pipe was being measured along its slope and its friction was overstated. |
| 6A.6 | Pipe lengths after the rule change | ⬜ | **Please spot-check a model you know.** Any pipe whose ends were at the same elevation is unchanged to the last decimal. Only a pipe that was silently sloped moves — and that one was wrong before. |

---

## Known gaps

* **Darcy-Weisbach is unusable** until the friction-factor correlation is
  chosen. Four are implemented; the spread is ≤1.4%, so it is a judgement call
  about auditability rather than accuracy.
* **No independent verification of any result.** Everything so far is internal
  consistency plus hand calculations by the author of the code, which is the
  weakest form of check. A comparison against another tool, or against a job
  with known answers, is the single most valuable thing left to do.
* **Light theme** has barely been looked at — including how a trace looks on it,
  where invert defaults to off.
* **TRACE has never seen a real drawing.** Everything so far is synthetic line
  art generated in the test itself.
* **Printing** has not been done on real paper.
* **Simulated outflow flow is now proven, in algebra.** `Q = Q_d·√(P_node/ΔP_d)`
  holds to 1e-9 in `simulation.test.js` and was re-confirmed live in the browser
  (18.78 L/s at 176.4 kPa against a hand answer of 18.78 L/s). That verifies the
  *relationship*; it does not verify that the absolute numbers match another
  tool, which remains the gap above.
* **No pump curve has ever been fitted from a real datasheet.** The fitter is
  exercised only against curves generated from its own form, which it recovers
  exactly — that proves the algebra, not that manufacturer curves take this
  shape. The fit quality is displayed for precisely this reason.

## How to log a result

Set the status, add a note if it is anything other than a clean pass, and update
the date at the top. If something fails, a line about *what you did* and *what
you expected* is worth more than the failure itself.
