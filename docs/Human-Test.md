# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 1391
assertions of engine behaviour (all passing), but they
cannot tell you whether a button is
discoverable, whether a drawing prints legibly, or whether a result *looks*
right to someone who sizes pipes for a living. Only Michael can sign those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-08-05 (v0.12.6)

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
| CA.6 | `VALVE_AUTHORITY` below 10% open | ⬜ | Your wording exactly. Control valves only; a shut valve and an isolation valve are exempt. Threshold on HYDRAULIC ▸ Warning thresholds. |
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
