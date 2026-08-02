# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 834
assertions of engine behaviour (all passing), but they
cannot tell you whether a button is
discoverable, whether a drawing prints legibly, or whether a result *looks*
right to someone who sizes pipes for a living. Only Michael can sign those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-08-02 (v0.9.0)

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
