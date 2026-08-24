# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 1979
assertions of engine behaviour (all passing), but they cannot tell you whether a
button is discoverable, whether a drawing prints legibly, or whether a result
*looks* right to someone who sizes pipes for a living. Only Michael can sign
those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-08-24 (v0.18.12)

**THE CURRENT BATCH IS DIRECTLY BELOW**, before anything historical — Michael
2026-08-09, having gone looking for it and found it buried under two years of
closed sections. Everything under `WAITING ON YOU` is from the last three
versions and none of it has been through his eyes. Older sections follow, newest
first. `WORKLIST.md` says what is waiting on me.

---

# OPEN ENGINEERING QUESTIONS — moved out of the user documentation, 2026-08-19

`docs/engine.html` replaced `docs/ENGINE.md` as the user-facing calculation
method. It states finalized approaches only. Everything below was written in
that document as undecided or unresolved, and belongs to you rather than to a
reader of the manual.

| # | Question | Where it stands |
|---|---|---|
| EQ.1 | **Which Darcy friction-factor correlation should be the default?** | Four are implemented and selectable: Colebrook-White (reference, iterated), **Swamee-Jain (current default)**, Haaland, Churchill. Measured spread across DN25–DN200, steel and PPR, new and fouled, is **at most 1.4%** — the choice barely moves the answer, which is why it has never been forced. `engine.html` states Swamee-Jain as the default and does not call it undecided. **Confirm Swamee-Jain, or name another.** |
| EQ.2 | **The Hazen-Williams / Darcy equivalence.** | At C = 120 against ε = 0.045 mm, Darcy reads 16–27% lower on friction rate. Neither is wrong: C = 120 is aged steel, ε = 0.045 mm is clean new steel. Matching them needs ε ≈ 0.15–0.25 mm or C ≈ 130–140. `engine.html` says exactly this. **Do you want a default pairing recommended in the interface, or is the note enough?** |
| EQ.3 | **Tee losses where flow divides or combines.** | A tee is charged run (L/D 20) or branch (L/D 60) from geometry alone. Real loss depends on the ratio of branch flow to combined flow, over which K varies by more than a factor of ten. Documented as a limitation in `engine.html` §10. **This is the largest known approximation in the engine. Do you want it addressed, and against which table (ASHRAE, Idelchik)?** |
| EQ.4 | **Fitting L/D does not vary with pipe size.** | Published tables give a higher L/D at small bores. A correction curve was trialled and removed because it could not be sourced — a synthesised 45° elbow column proved 250% wrong against the real table. Documented as a limitation. **Leave as is, or source a table you accept?** |
| EQ.5 | **Temperature does not drive fluid properties.** | Density and viscosity are entered independently; temperature is recorded only. A 6 °C circuit uses whatever properties were typed. Documented as a limitation. **Worth implementing, or is stating it enough?** |
| EQ.6 | **Two K values that did not survive cross-checking.** | Threaded 45° elbow: both copies of the ASHRAE table returned a column identical to the 90° elbow, which is physically wrong — shipped as 0.53 × the 90° value (Crane TP-410 L/D ratio) and marked `derived`. Threaded 2 in tee-branch: copies disagreed, 1.4 vs 1.6; 1.4 used because it keeps the column monotonic. **Both need a third source, or your acceptance.** |
| EQ.7 | **Propylene glycol properties are unverified.** | Still `verified: false` in `data/fluids.js`. Specific heat scales every thermal duty linearly. Not mentioned in `engine.html` beyond a general note that unverified fluids are flagged in the interface. |
| EQ.8 | **The static-pressure limit.** | `settings.warn.maxStatic` defaults to 552 kPa (80 psi), the figure at which IPC 604.8 calls for a pressure-reducing valve. Confirmed by you on 2026-08-19. Recorded here because the default is a code figure and other codes differ. |

---

# WAITING ON YOU — v0.18.12 (2026-08-24)

One item, and it is purely a matter of what the drawing should look like. The
two engine fixes in v0.18.12 are asserted in the suites; this is not.

| # | Status | What to look at |
|---|---|---|
| HT.v18-1 | ⬜ | **Two riser rings stack at a pass-through floor.** A column that continues past a floor has a segment BELOW that floor and a segment ABOVE it, and both meet the same node — so `drawRiserGlyph` draws a ring for each, at the same screen point. On `debug/20260824-debug.json` that is P8 and P31 on node N9 at L1, which is what you saw as "50 mm vertical pipes overlapping the risers". They are not extra pipes; they are the column's own segments. **Question for you: should a pass-through floor draw ONE ring rather than two?** The two segments can legitimately differ (size, schedule, C), so drawing one ring means choosing which to show — probably the one carrying the most water, or the larger bore. Nothing is changed until you say. |

Note also that the segments only became VISIBLE when the PDM warning highlighted
them. That part is working as intended.

---

# WAITING ON YOU — v0.16.4 to v0.16.19

Nothing in this block has been looked at by a person. Each row says what was
driven and how, so you know which part is already pinned and which part is the
bit only you can judge.

> **Verified items are archived** in [`Human-Test-Archive.md`](Human-Test-Archive.md)
> so this log shows only what is still pending (⬜ not tested, ❌ failed, ⚠️
> passed-with-a-note). As you tick items ✅ they move to the archive — a whole
> section when it is fully cleared, otherwise just its ✅ rows, leaving the
> pending ones here under the same heading.

## 5DW. DOMESTIC WATER — v0.16.33 … v0.17.1 (2026-08-16)

The plumbing discipline and its pipe-flow sizing. The numbers are pinned by
`plumbing.test.js` / `model.test.js` (2084 assertions); these rows are the parts
only your eye can settle.

| # | What | Status | Notes |
|---|---|---|---|
| DW.A | **Discipline switch on the loop-type chip** (v0.16.33) | ⬜ | The chip reads HYDRONIC / PLUMBING and toggles on click, with a confirm on a non-empty model. In plumbing the network tab reads PLUMBING, THERMAL is hidden, the Design ribbon drops the thermal tools, and SHOW ▸ Temperature is hidden. Verified live (wiring, tab set, zero GGA calls). **The feel of the switch is yours to judge.** |
| DW.B | **Editable IPC tables on the HYDRAULIC tab** (v0.17.0–1) | ⬜ | Fixture load values E103.3(2) and the FU→flow demand curves E103.3(3), editable in metric, per-model overrides that feed sizing, with "Reset to IPC defaults". Explanatory hints and the unverified banner removed at your request. Verified live: editing an FU or a demand cell reshapes every downstream flow. **Layout/readability of the two tables is yours to judge.** |
| DW.C | **Flow arrows + friction in plumbing** (v0.17.1) | ⬜ | A plumbing file now "solves" (never the GGA): `plumbingReport` gives signed per-pipe flow so the canvas draws direction arrows, plus friction drop and a forward residual-pressure pass. Verified live that flow/pressure/dpFric are computed and arrows would draw (3/3 pipes), residual = source − friction − static. **Whether the arrows and colours LOOK right on the drawing is yours to judge** (the preview canvas renders nothing to pixels). |
| DW.D | **Plumbing CALCULATION sheet** (v0.17.0–1) | ⬜ | Per-pipe Section / Size / Bore / Downstream FU / Design flow / Velocity / Friction drop / Residual, mains first, over-limit velocity and negative residual in red. Verified live on a heavy-load tree. **The sheet's layout is yours to judge.** |
| DW.E | **Paste onto a pipe tees in** (v0.17.1, affects hydronic too) | ⬜ | Pasting a copied fragment whose anchor lands mid-pipe now SPLITS that pipe and joins with a tee (previously it sat on top, connected to nothing) — the same rule as dragging a node onto a run. The drop-and-split was verified live (target split, 3 pipes meet at the junction); the on-screen *snap detection* while dragging the paste could not be exercised here (the preview canvas has no layout), so **please confirm in the real app that the paste anchor turns green over a pipe and tees in on click.** |
| DW.F | **Table 604.3 — undiversified flow & pressure** (v0.17.2) | ⬜ | Transcribed to metric (`verified.supply=false`), a per-fixture undiversified flow + required flow pressure. It is a **separate taxonomy** from the FU table, so each plumbing outflow has its own "Supply outlet (604.3)" selector (no invented mapping). Editable on the HYDRAULIC tab. **Please confirm the transcription and that picking a supply outlet per fixture (rather than auto-mapping from the FU fixture) is the workflow you want.** |
| DW.G | **SIMULATE pushes water in plumbing** (v0.17.2) | ⬜ | In SIMULATE, each fixture imposes its **undiversified** 604.3 flow as a fixed demand and the (unmodified) GGA pushes it through — flow arrows and pressures appear on the canvas. DESIGN stays fixture-unit (diversified) sizing. Verified live: 2×5 WC @ 3 gpm ⇒ 30 gpm through the main, arrows on all sections. **Confirm the intent: SIMULATE = every included fixture drawing its full undiversified flow at once (worst case), not a diversified draw.** |
| DW.H | **Most unfavourable path in Calculation** (v0.17.2) | ⬜ | The plumbing CALCULATION sheet now has an index-run section: the fixture with the least margin (delivered residual − 604.3 required pressure), the path traced source→fixture with per-section flow/velocity/friction/residual, and the margin (red if insufficient). Verified live (margin 146.9 kPa on a 300 kPa supply). **The layout and whether "least margin" is the right governing rule are yours to judge.** |
| DW.I | **Outflow FU as a Display option** (v0.17.4) | ⬜ | Design ▸ Properties ▸ Display on a plumbing outflow now has a **Fixture units** switch that draws a value box ("FU 2.2") at the node. Plumbing-only. Verified live (box drawn, toggle present). **Placement/legibility of the box is yours to judge.** |
| DW.J | **Booster pump now flows without supply outlets set** (v0.17.4, was a bug) | ⬜ | `20260817-PLBG.json` reported "pump has no flow" in SIMULATE: its WCs had no 604.3 supply outlet, so undiversified flow was zero. A fixture now carries a DEFAULT supply outlet, so a sized model simulates straight away. Fixed & frozen as `test/fixtures/plumbing-booster.pnet.json` (6 WC → 1.136 L/s, no PUMP_NO_FLOW). **Confirm the default outlet picked per fixture is sensible** (e.g. WC private flush-tank → "tank, close coupled", 3 gpm/20 psi); ambiguous fixtures (bathroom group, tank urinal, washing machine) default to none. |
| DW.K | **604.3 supply baked into fixture/variation** (v0.17.5) | ⬜ | The supply outlet is no longer a separate dropdown on the outflow — it follows the fixture/variation and is shown read-only (values still editable on HYDRAULIC). **Confirm the fixture→outlet pairings** (`FD.plumbing.supplyDefault`). |
| DW.L | **Outflow defaults to Plumbing type; pre-place template** (v0.17.5) | ⬜ | In a plumbing file a new outflow starts as a Plumbing (water-closet) fixture. The OUTFLOW tool now shows a "New outflow" template panel (fixture/variation/count) that stamps each placed outflow — place N of one fixture, change, place M of the next. Verified live (2 urinals placed from the template). **Judge the workflow feel.** |
| GEN.1 | **Paste single outflow onto a node applies it** (v0.17.5) | ⬜ | Copy an outflow, paste with its anchor on an existing pipe-end node → that node becomes the outflow (was: nothing pasted). Verified live. |
| GEN.2 | **Context-sensitive Ctrl+C/V replaces the property buttons** (v0.17.5) | ⬜ | The dedicated Copy/Paste-properties buttons are gone. Copy one object, select a same-kind target, Ctrl+V = properties only (now works for source/outflow nodes too); nothing selected = place normally. Verified live. **Confirm this is the single behaviour you wanted.** |
| GEN.3 | **Trace Ctrl+V + Set-Scale cursor** (v0.17.5) | ⬜ | In Trace, Ctrl+V no longer places previously-copied pipe (leaves it for the image paste); Set Scale uses a crosshair while picking. Verified live (state + cursor); **the image paste itself needs a real clipboard image to confirm in the app.** |
| DW.M | **Plumbing calc + pipe props match hydronic** (v0.17.7) | ⬜ | The plumbing CALCULATION sheet now has the hydronic layout: project-metadata head, collapsible All Pipes / Critical Path sections (renamed from "Most unfavourable path"), index rows flagged, index-grid summary. The pipe-props "Domestic water" box uses the same styling as hydronic "Thermal". Booster-pump head is now in the residual/Critical-Path pass (20260817-PLBG shows +55.7 kPa margin). Verified live. **Judge the standardised look.** |
| DW.N | **Outflow flow, panel labels, fixture tags** (v0.17.8) | ⬜ | The outflow's design flow on the drawing was the 1.00 L/s placeholder; it now shows the **undiversified** flow in DESIGN and the **K-terminal solved** flow in SIMULATE (fixtures now simulate as pressure-dependent K-terminals, like hydronic). Properties ▸ Design labels renamed (Fixture Units (Cold) / Type / Design Flow / Design Pressure). Auto-tags follow the fixture (WC-1, UR-1, HB-1, …); Lavatory renamed "Lavatory/Hand Basin". Verified live. **Confirm the simulate draw (K-terminal) is what you meant, and the tag prefixes read right.** |
| DW.O | **604.3 mapping merged into one fixture table** (v0.17.9, merged v0.17.11) | ⬜ | Each fixture/variation's design flow & pressure follows your spreadsheet (WC priv-tank→flushometer tank 1.6 gpm, priv/pub-valve→blow-out 25 gpm/45 psi, pub-tank→close-coupled 3 gpm; urinals→urinal valve 12 gpm; dishwashing machine added). Now shown as **one merged table** on the HYDRAULIC tab — Fixture units + Type (604.3) + Design flow + Design pressure, all editable per fixture — not a separate table. Estimates (bathroom group, kitchen sink public, shower public, washing machines) are computed from 604.3 and shown in **red** with the footnote. **Confirm the estimates and the WC/urinal outlet choices — these drive sizing & simulation.** IPC data stays verified:false. |
| DW.P | **Plumbing test-run batch** (v0.17.12) | ⬜ | IPC demand/604.3 data now marked verified (no unverified banner). Multi-select outflows edit common properties + Display together. Outflow Display: Tag (Info Panel) default on, Design flow shows the design (undiversified) value, Temperature removed; the 1.00 L/s node placeholder is gone; no Thermal on a plumbing pipe in Simulate. HYDRAULIC fixtures table reordered (Fixture / Occupancy·Supply / FU / Design Flow / Design Pressure / Table 604.3 Type). Calculation: Demand Curve Type line, hydronic-style columns + Downstream FU, and split **Critical Path (Design)** vs **Critical Path (Simulation)** — on 20260818-lowrise the index fixture reads 307.3 kPa design vs 149.7 kPa simulation (was the reconciliation puzzle). Verified live. **Confirm the two critical-path numbers read as you expect.** |
| DW.Q | **Info-panel Tag drew only when another switch was on** (v0.17.13, was a bug) | ⬜ | A plumbing outflow's **Tag (Info Panel)** defaults ON, and a default-ON switch is stored only when it is switched OFF — so a fresh outflow had an EMPTY `show`, and the value-box renderer bailed on "no flags set" before it reached the tag. Ticking any other switch (Fixture units, Design flow…) put a key in `show` and the tag appeared with it. The renderer now asks the model which flags default ON (`M.displayDefaults`). Verified live on 20260818-lowrise: 21 of 21 plumbing outflows on the active level draw their tag with no `show` stored at all (the 22nd is a leftover *generic* outflow, which correctly has no default tag), and switching Tag off removes it. **Where the tag box sits beside the fixture is yours to judge.** |
| DW.R | **Calculation sheet ran past the page margins in portrait** (v0.17.14, was a bug) | ⬜ | Every sheet cell is `nowrap` — right on screen, where the pane scrolls sideways, wrong on paper where it cannot. Measured at the old print size the plumbing critical-path table needed 945px and the hydronic one 1059px against the 703px between A4 portrait's 12mm margins — 356px off the right edge. On paper only: headings and TEXT cells (Section, Tag, Fittings) may now wrap, padding tightens to 3×5px and the size drops 9.5pt → 9pt; **numbers stay `nowrap`**, so no figure can be split across lines. Rows also no longer break across a page boundary (the header row already repeated — the tables use a real `thead`). Verified by replaying the real @media print rules in a 703px box: every table on both sheets sits at exactly 703px with zero overflow anywhere in the pane, screen rendering unchanged (13px, nowrap). **Judge the printed result: whether 9pt is small enough to read and the wrapped two-line headings look right — say the word and the sheet can go landscape instead, which would let the type back up.** |
| DW.S | **Plumbing/hydronic parity pass** (v0.17.15) | ⬜ | Your "check the presentation is consistent in both modes" list. The plumbing CALCULATION sheet gains **Fittings** and **EL** columns (the allowance was always in the numbers — the pipe panel and the CSV showed it, the sheet printed L and L eff with nothing between them), a **Tag** column, `fmtSize` on the size (on NPS the two sheets read 2" and DN50 for the same pipe), the friction rate flagged red against the limit, the **friction method** named in the sheet head, a new **Fixtures** section (every fixture — FU, design flow, required, available, margin — worst first, the analogue of hydronic's Device Flow), **Warnings** and **Appendix** sections, Static + Pump head on the Critical Path grid, and **the disclaimer, which the plumbing sheet did not carry at all**. The CSV now exports the plumbing sheet instead of hydronic columns headed "System: Open loop". The printed plan now carries the FU pipe label. Verified live on 20260818-lowrise and 20260817-PLBG; hydronic sheet byte-for-byte the same shape as before. **Judge the new Fixtures table and whether the 14-column plumbing sheet is still readable.** |
| DW.T | **Plumbing raised no warnings at all** (v0.17.15, was a bug) | ⬜ | `plumbingReport` returned an empty warnings list unconditionally, so on **your own 20260818-lowrise** 83 sections over the 400 Pa/m limit and 2 over 2.4 m/s reported **"Sized · 184 pipes · 117 FU" in green** with an empty MESSAGES window. It now runs the same detectors the GGA path uses, plus `DW_FIXTURE_SHORT` (a fixture below its 604.3 pressure — the app was measuring these against the hydronic placeholder field and could never fire) and `DW_UNSIZED` (a branch with no fixture, previously dropped from the sheet in silence). Chip now reads **85 warnings** in amber and the list is clickable. **Confirm the 400 Pa/m and 2.4 m/s limits are the ones you want applied to domestic water — if plumbing should carry different defaults from hydronic, say so and they can be split per discipline.** |
| DW.U | **Booster sized to 47 L/s @ 2 MPa** (v0.17.16, was a bug) | ⬜ | Your 20260818-lowrise report. `autoSizePump` runs the GGA on the model twelve times — which in a plumbing file both put the solver back on the DESIGN path and made it read every fixture's **1.00 L/s placeholder**: 47 fixtures × 1.00 = 47 L/s, chasing the hydronic placeholder pressure for twelve rounds of added head. Plumbing now sizes in **one pass with no solve**: the residual pass is linear in pump head, so the head that puts the worst fixture exactly on its 604.3 requirement is the current head plus that fixture's shortfall — and it comes DOWN for an oversized pump, not just up. Lowrise now sizes to **3.984 L/s @ 23.6 m (231 kPa)**, governed by N185, worst margin 0.00 kPa, zero GGA calls (instrumented). Hydronic sizing untouched. **Check the duty against your own selection — and say whether you want a margin on it (pumpSafetyPct is 0 in this file; 10% would give 26.0 m).** |
| DW.V | **Plumbing HYDRAULIC tab reinstated in full** (v0.17.16) | ⬜ | The tab stopped after the IPC tables, so **Hydraulic Parameters** (method picker + the live formula with editable coefficients), **Pipe schedule**, **Fitting equivalent lengths / K table** and **Warning thresholds** were unreachable in a plumbing file — all of which the plumbing calculation uses. It now falls through to the shared sections; only SYSTEM (open/closed loop) stays hydronic-only. Fluid Properties came with them — density and viscosity feed the friction calc, and the sheet quotes the fluid. Both IPC tables are **collapsible**: fixtures open, demand curves closed. Verified live (limit 400 → 900 Pa/m takes warnings 86 → 50; Darcy swaps EL for the K table); hydronic tab unchanged. **Judge the section order — the IPC tables sit above Fluid Properties at the moment, and Fluid Properties is my call, not your ask; say if you want it gone.** |
| DW.W | **Printed plan now carries a pipe's tag** (v0.17.16) | ⬜ | `printer.js` never included `p.tag` in a pipe label, so a named run was on screen and missing from the plan. Now included, first, under the same tagVisible rule. **Note the trade-off:** the printer drops any label longer than the pipe it sits on, so adding the tag pushes some labels out — with 20 pipes tagged on lowrise, 2 labels fitted. Turning off Length or Diameter buys the room back. **Tell me if you would rather the tag won and something else dropped.** |
| DW.X | **Where the design flow comes from, and the booster duty rule** (v0.17.17) | ⬜ | Your P276 question. Design Flow 3.98 = Diversity Flow 2.98 (116.9 FU) **+ 1.00 L/s from N54/OF-2**, a generic outflow on Level 1 still at the 1.00 L/s default. Generic demand is added undiversified — correct, but nothing said so. Now a `DW_GENERIC_DEMAND` notice names it, the sheet gains **Diversified** and **Generic** columns so the row adds up on the page, and the pipe panel always writes the sum out. **First question for you: is OF-2 deliberate?** If it is a stray, deleting it takes the design flow to 2.98 L/s and the booster duty with it. Your duty rule is implemented and logged in `docs/DW-MODULE.md` — lowrise now sizes to **4.054 L/s @ 23.6 m** (index N185 at 0.101 L/s + 114.7 FU diversified 2.953 + generic 1.000). **Two things to rule on: (1) I floored the duty at the branch diversified flow, because at low FU your rule can land below the flow the pipe is sized for — inert here, say if you would rather it were not there; (2) the HEAD is still evaluated at the design (diversified) flows, not at the higher duty flow.** |
| DW.Y | **The calculation sheet now prints landscape when it must** (v0.17.17) | ⬜ | The pipe schedule reached 17 columns and at that width nothing fits A4 portrait — 734px of table against 703px of page even at 8pt with 2px padding, which is past readable. Rather than shrink the type further, PRINT measures the widest open table and claims a landscape page when it needs one, with a toast saying why. Portrait is still used whenever it fits (a hydronic sheet, or plumbing without tags). **Judge the landscape sheet — the letterhead margin drops from 28mm to 20mm to pay for it.** |
| DW.Z | **REMOTE1 — the plumbing simulation load case** (v0.17.19) | ⬜ | Your method, implemented. In a plumbing file the SIMULATE **STATIC** button now reads **REMOTE1** and runs it: open the most remote fixture, then the next, until the system cannot deliver, then back off the last one. On 20260818-lowrise it serves **12 of 46** and the index fixture ends **+5.2 kPa** in hand instead of **−220.8 kPa** all-open. An open tap draws its FULL 604.3 flow — I did try the K-terminal draw first and one water closet pulled 2.35 L/s, which is why it does not. The pump contributes what its CURVE gives at the flow it passes. DYNAMIC still gives the all-open case. **Judge the served count against the job.** (v0.17.20: the order is now re-ranked every round against the live pressures, at no extra cost — the open question is closed.) |
| DW.AA | **SIMULATE is yours to set up again** (v0.17.21) | ⬜ | REMOTE1's automatic search is gone. Plumbing SIMULATE pushes forward from the source and pump with whatever outflows are **On** — each drawing its FULL 604.3 flow, the pump reading its CURVE at the flow it passes. So: 'Include in calculation' is now **On/Off**, a multi-selection of outflows gets a **bulk On/Off**, and valves of one type **open/close together** (mixed types refuse and say why — 'open' does not mean the same thing on a gate valve and a control valve). Verified: switching 4 outflows off took the open set 47 → 43. **Your source+pump 'insufficient' report is resolved by this** — SUPPLY_INSUFFICIENT is a GGA warning and the GGA is no longer on any plumbing path; please confirm you no longer see it. |
| DW.AB | **SIMULATE now shows actual flow** (v0.18.0, was a bug) | ⬜ | Your `20260819-lowrise` report. The forward pass was computing every outflow's draw and not publishing it where the panel, the drawing and the sheet look for it (`res.simulation.terminals`). Now: N177 reads **Actual flow 0.95 L/s, Actual pressure 435.0 kPa**, an OFF tap reads 0.00 L/s, and `Qa 0.95 L/s` draws on the canvas. **On the other two observations:** *close to design* is the method — an open tap draws its design flow, so the ratio is exactly 1 by construction, and what SIMULATE answers here is the PRESSURE. *Over-pressurised* is real: 200 kPa mains + 308 kPa of pump (the curve read at 1.26 L/s, against a 231 kPa duty) = **508 kPa**. A fixed-speed booster does that at low draw. There is now a `DW_OVER_PRESSURE` warning against an editable limit — **but it defaults to 552 kPa (80 psi, IPC 604.8) and 508 kPa is under it, so it does not fire on your model. Tell me the limit you want and I will set the default.** |
| DW.AC | **Q = K·√P restored, and the pump holds its sensor** (v0.18.2, was a bug) | ⬜ | Both of your reports were the same cause: the fixed-draw pass I built the day before. It made an open tap draw its 604.3 flow whatever the pressure (so simulated flow = design flow by construction), and — because `runControls` lives inside `solveModel` — a forward pass down a tree had nowhere to put a controller, so PS-1 was being **ignored**, not failing to hold. SIMULATE is the unmodified GGA on the K-terminal copy again. **You were right about the physics**: doubling supply 300 → 600 kPa takes a fixture from 0.1177 to 0.1665 L/s, ratio **1.4142 = √2**. On your file the booster now settles at **84% speed with PS-1 at 150.1 kPa against its 150.0 setpoint**, and fixtures draw 1.04–1.65× design. The pump panel reads 84% too — the solved speed is copied back off the converted copy, which it was not before. |
| UI.C | **Exports** (v0.17.21) | ⬜ | **DXF** now asks: *3D Model* (what you had) or *By Level*. By Level wrote 3 files for the 3-floor model with Z kept — Level 2 at 6.00 m, Level 1 at 3.00, Level 0 at 0.60 — and a riser appears on both sheets it connects. **CSV**: the strange characters were an encoding mismatch (Excel reads a .csv as the system code page unless it finds a byte-order mark); files now start EF BB BF, verified on the raw bytes. And it asks which tables to export, one file each — it really was writing All Pipes only. Plumbing offers All Pipes + Fixture schedule; hydronic All Pipes + Critical Path. **Tell me which other tables you want offered.** |
| UI.D | **Panel grouping** (v0.17.21) | ⬜ | Tag, Schedule, Size, C factor, Length, Insulation are now under a **Design** section, and every titled read-out box (Pipe, Thermal, Domestic water) is collapsible and remembers its state. MONITOR cards no longer carry Display — that is a drawing decision, made where the drawing is. The plumbing PROBE no longer shows Temperature. |
| UI.A | **MONITOR tool** (v0.17.19) | ⬜ | New TOOLS tab. **+** adds whatever is selected on the drawing, **−** removes the last, each card has its own **×**, and clicking a card's name goes to it. Each card holds the REAL properties panel for that device — the same code the left-hand panel runs, not a copy — so a pump on Level 0 and a fixture on Level 2 can be tuned side by side. The list is saved with the model. **Judge whether + taking the selection is the gesture you wanted, or whether you expected a picker.** |
| UI.B | **Small ones** (v0.17.19) | ⬜ | TOOLS ribbon in CAPS (done in CSS, so the tab names stay readable elsewhere). The active level now shows on the **collapsed** LEVELS header in accent colour. CALCULATION: a TOTAL row on Fixtures (47 listed, 56 count, 116.9 FU, 11.02 L/s) and on both Critical Paths (Section PD, Static); **Total friction drop now reads negative** (−40.3 kPa). No totals on All Pipes — adding the drop of every section in a branched tree totals paths no water takes together. |

## 5AC. UI HOUSEKEEPING — v0.16.23–25 (2026-08-10 … 12)

| # | What | Status | Notes |
|---|---|---|---|
| DR.1 | **Toggling display/info-panel tags does not re-solve** (v0.16.26) | ⬜ | The "Show on drawing" / Tag (Info Panel) switches now save and redraw only, never re-solve — presentation cannot move a number. Verified live: toggling a Display flag schedules a save, not a solve (same as the Tag-visible switch). |
| IT.1 | **"Sweep" is now "Iteration" in the UI** (v0.16.26) | ✅ | Progress bar ("iteration 2 of 6"), the Settling-iterations field, and the control messages. Internal variable/setting names still say sweep (logged, SW.2). |
| HM.1 | **CONTROL_HUNTING reports how far it got** (v0.16.26) | ⬜ | Instead of "still moving after 6 sweeps", it now reads "Not fully settled after 6 iterations — N of M controlled devices holding setpoint (X%). … Raise Settling iterations in SETTINGS to converge further, or accept it if this is close enough." So you can accept 90% while designing and finish later. Verified: a hunting model reports the fraction (e.g. 1 of 6, 17%). |
| MSG.1 | **The status chip opens a MESSAGES window** (v0.16.25) | ✅ | A moveable window like TOOLS, opened by clicking the chip. Two lists — Active and Dismissed — listing every error, defect, warning and notice, ordered by severity. Clicking a message goes to the pipe/node it names (switches floor, centres, selects); the old highlight-every-pipe-at-once is gone. Warnings and notices have a **Dismiss** button → Dismissed (with **Restore** there); errors and defects cannot be dismissed and read "must fix". Dismissal is keyed by code + where, so it survives a re-solve (session only). Verified live: dismiss/restore, navigation, errors locked, persistence, chip open/close. **The look and feel are yours to judge.** |
| MSG.2 | **Chip: dismissed drop off, grey not orange, click toggles** (v0.16.27) | ⬜ | Dismissing a warning in the window drops the chip count live ("2 warnings" → "1 warning"); the warnings chip is now grey (errors red, defects amber unchanged); clicking the chip opens AND closes the window, like TOOLS. Verified live. |
| UX.1 | **Sync part load, one-coil case** (v0.16.23) | ✅ | With a single heat exchanger the "Sync part load %" row now shows DISABLED with "Place a second heat exchanger to sync this one to it", instead of vanishing. With two or more coils it is a working dropdown, as before (verified on `20260809-DC.json`). |
| UX.2 | **Calculation sheet remembers collapsed sections** (v0.16.24) | ✅ | Collapse All Pipes to read Critical Path only and it stays collapsed when you leave the tab and come back — the sheet used to rebuild and reset every section. Thermal and the Appendix still start collapsed until you change them; then that is remembered too. Verified live: collapsed All Pipes, switched tabs, still collapsed. Session-only (not saved to the file). |
| UX.3 | **Tool instruction always sits below the ribbon** (v0.16.24) | ✅ | It used to trail to the right when short and wrap below when long, so Heat Source/Sink and Heat Exchanger showed their prompts in different places. Now every variant's instruction is on its own line below the buttons. New wording: source = "Place heat source/sink on pipe (e.g. Chiller/Cooling Tower). Holds LWT."; exchanger = "Place heat exchanger on pipe (e.g. AHU/FCU). Holds ΔT up to Temperature Limit." **The look is yours to judge.** |

## 5AA. WHILE YOU WERE AWAY — v0.16.16 to v0.16.19 (2026-08-10)

Done from your list and the standing backlog while you slept. The engine
changes are covered by new tests; the two UI/visual ones are driven and wired
but, as always, not looked at.

| # | What | Status | Notes |
|---|---|---|---|
| S4.7 | **Survivors re-settle behind a device parked at full** (v0.16.16) | ⬜ | The recorded S4. Parking a lost device at full moves the plant, and the others had settled against the plant BEFORE that move — so their positions no longer described the answer. Now the loop settles the survivors again against the parked plant, re-parking anything that itself finishes lost, bounded. On `economizer-trim` with ACCH-1 undersized to 145 kW: coils went from ~14% over rated → within 0.3%, PMP-01 from 30.8 kPa off its differential → 147 Pa, five drifted devices → none. Provably inert when nothing is lost — `20260809-DC` solves identically (675 solves, no drift). Genuine limit cycles (two non-ganged pumps fighting) are still, correctly, flagged CONTROL_HUNTING. New `thermal.test.js` section, red-before/green-after. |

## 5W. COPY AND PASTE, FIND, AND THE FLOOR ABOVE (v0.16.13)

**A backup of v0.16.12 is in `Previous Version/v0.16.12`,** taken before any of
this and diffed against the working tree to confirm it is identical.

### Copy and paste

| # | What | Status | Notes |
|---|---|---|---|
| CP.5 | ...and a link out of the selection is DROPPED and said so | ⬜ | On `economizer-trim` the copied PMP-02 came out with no control link, because TS-2 was not in the selection — and the toast said so at copy time, not after. |

### What this fixed on the way


### Find, and the floor above

## 5V. THE SMALL-THINGS ROUND (v0.16.12)

Your list of 2026-08-09, in the order you gave it. Everything was driven through
the DOM; none of it has been LOOKED at.

| # | What | Status | Notes |
|---|---|---|---|
| SM.5 | **Pipes and fittings have it too** | ⬜  | A plain pipe had no Tag field at all — it has one now, drawn first in the pipe label, and a Display section carrying the switch. A plain node (a fitting) gets the switch as well: its label always exists, whether or not anyone has named it. |

## 5L. "SIZE IT FOR ME" — THE EARLY-DESIGN SIZING AID (v0.16.5)

The other half of your ΔT ruling. Blank capacity now means the machine holds
its setpoint whatever that takes, so the duty it lands on is the answer to what
to buy.

**These were driven in a real browser** — the app served over `127.0.0.1:8787`,
the model loaded, the panel and the sheet read back out of the DOM, no console
errors. That verifies the wiring and the numbers. It does not verify how any of
it LOOKS, which still needs your eyes.

| # | What | Status | Notes |
|---|---|---|---|
| SZ.1 | **Required capacity**, in the equipment Actual section | ⬜ | `C·(setpoint − entering)` at the flow the machine actually has. On `economizer-trim`, ACCH-1 reads **134.09 kW** required against 134.09 kW done — unlimited, the two are the same number by definition. |
| SZ.2 | **Margin on selection** beside it | ⬜ | `+86.4% (250.00 kW selected)` on ACCH-1: 250/134.09 − 1. Red when negative. When a capacity BINDS this is the only place the shortfall is stated, because the reported duty is then the nameplate rather than the demand. |
| SZ.3 | **Sizing: Auto / Manual** on equipment | ⬜ | Mirrors the pump panel. Verified round trip on ACCH-1: Manual −250 kW / 15 K / 3.9886 L/s → **Auto** clears the capacity and touches neither the flow nor the ΔT → **Manual** writes back the **134.09 kW it actually needs**, holds the 3.9886 L/s design flow, and moves the design ΔT to **8.05 K** = 134090.6/(998 × 0.0039886 × 4187). The design flow is held deliberately: it is a number you chose, and a sizing decision must not quietly rewrite it. |
| SZ.4 | On Auto, the panel says what to do with the number | ⬜ | "% Load" reads `—` (there is no nameplate to be a percentage of) and a hint says *"Sizing is Auto, so this is the capacity to select. Switch Sizing to Manual to lock it in as the nameplate."* |
| SZ.5 | **Plant schedule** on the CALCULATION sheet | ⬜ | In the Thermal section, sources and sinks only. On `economizer-trim` with CT-01 left on Auto: <br>`ACCH-1  3.99  1.43  15.00  22.50  134.09  250.00  +86.4%` <br>`CT-01   4.00  3.20   5.98   4.92   65.77  Auto    —` <br>Worth looking at the two ΔT columns together: ACCH-1 is working across **22.50 K against a 15 K design figure**, and CT-01 across **4.92 K against 5.98 K**. That is the whole of the ΔT change in two rows — ΔT is an output of the flow, above or below the schedule as the system dictates. |
| SZ.6 | It is not a duplicate of Equipment duty | ⬜ | That table reports what every device DID; this one answers what to buy. Both are in the Thermal section; both print when it is open. |

## 5K. DESIGN ΔT, AND THE SEARCH THAT COULD NOT SEE PAST ITS OWN PROBE (v0.16.4)

Your ruling on LS.5, and the two control-loop defects that removing the clamp
uncovered. All of it is covered by tests; none of it has been through your eyes
yet.

| # | What | Status | Notes |
|---|---|---|---|
| LS.5 | **Design ΔT stops clamping the duty** — your ruling, option 1 | ⬜ | Your part-load table is now a test: at design, 27.65 L/s across 12 K sits exactly on the 1380 kW nameplate; at 30% load, 9.464 L/s across **10.5 K** leaving at 20.00 °C is 415 kW against 30% of 1380 = 414 kW. And the row your data centre lives in: the same machine at that floored flow with a **35 °C return** now holds 20 °C across 15 K doing 593 kW, where it used to stop at 12 K, leave the water at 23 °C, and report "limited by Design ΔT" at 43% of nameplate. |
| LS.7 | Models without a capacity must gain one | ⬜ | `economizer-trim` gained ACCH-1's own design point, 250.00 kW = ρ·q_rated·cp·ΔT on the fixture's own numbers. **Your other files will need the same** — blank now means unlimited, which is the sizing question, not a ceiling. |
| LS.8 | `20260805-4`'s lost setpoint has gone, and it was never real | ⬜ | ACCH-1 is scheduled 7.977 L/s across 15 K = a 500 kW design point, carrying 200 kW. It was never short of anything; the clamp bit at the flow the balanced branches deliver, so it could not reach 7.5 °C and the pump was told it had lost a setpoint no speed could recover. It now holds 7.5 °C with nothing limiting it. |
| CS.1 | **A device on its floor could not climb back** | ⬜ | The mirror of the v0.15.9 restart-from-full, and it had been there all along. On `economizer-trim`, sweep 1 puts PMP-02 on its 25% floor *honestly*; by sweep 2 the valves have throttled and the answer is at 32.9% — but with nothing below to probe, the search returned `at-min` without solving anything and the pump was parked at 100%. Now it restarts from full. |
| CS.2 | **The response of a mixing circuit is not monotonic** | ⬜ | Two sources, a bypass, a check valve, a mixing sensor — your economizer in miniature. While the check valve holds the bypass shut the trim pump sets the *whole* loop flow, so slowing it makes the supply **colder**; once the bypass opens, mixing makes it **warmer**. The rig crosses a 20 °C setpoint twice, at 45% and 30%. One probe at the stop saw a smaller error of the same sign and gave up. The travel is scanned now — downward, so it stops at the higher root, which is where a controller ramping down from full stops. |
| CS.3 | `economizer-trim` converges, and the split moved | ⬜ | ACCH-1 reaches 7.5 °C rather than being pinned at 15 °C, so the mix needs **four ninths** through the chiller rather than two thirds: 30x + 7.5(1−x) = 20 → x = 5/9 bypassed. PMP-02 at 32.9%, TS-2 at 19.96 °C, CT-01 66 kW + ACCH-1 134 kW = the 200 kW the four coils put in. |
| CS.4 | It got faster, not slower | ⬜ | `20260807-DC-broken.json`: was 232 solves over 6 sweeps and **did not converge**; now 55 solves over 2 and converges with all eight devices holding setpoint — 23.5 s → 5.4 s. `20260808-DC-broken.json`: 41.5 s → 40.0 s. |

---

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
| 1.10 | Hazen-Williams, converging/diverging tees | ❌ | **Michael found this wrong.** Two causes, both confirmed in code — see `ENGINE.md`. Blocked on choosing a coefficient source. |
| 1.5 | Loop flow split against hand calculation | ⚠️ | A SYMMETRIC ring now splits exactly in half (asserted to 1e-8, and independent of drawing order) — that much is proven. Michael's `20260802-2.json` was splitting 51/49 until v0.7.10-dev; the cause was the bullhead tee, not the solver. An ASYMMETRIC split against a hand calculation is still unchecked. |
| 1.12 | Bullhead tee coefficient | ⬜ | **New in v0.7.10-dev, and the one to rule on.** Where two ring legs leave a tee in line with each other, both are now charged as a BRANCH (K = 1.1) rather than one as a run (K = 0.9). No number was invented — it is a choice of which tabulated coefficient applies — but you hold ASHRAE Tables 3/4 and this case (inlet through the branch, dividing into both run legs) is arguably its own fitting. Worth confirming. It raises pump duties slightly: +0.20 m on the 3-floor model, +2.6 kPa on the data centre. |
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
| 1.13 | Swamee-Jain accuracy claim | ⬜ | **Worth your eye.** The literature's "within 1% of Colebrook" is what the code used to say and it is NOT true at the corners — measured 2.8% at Re 5000 with ε/d 1e-2. The app now states 0.9% / 2.8% instead. Confirm that is the right thing to print on a sheet. |
| 1.8 | Critical path is the genuinely worst circuit | ⬜ | Picks the smallest-residual terminal. Worth checking against judgement on a real job. |

## 3. Devices

| # | What | Status | Notes |
|---|---|---|---|
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

## 5H. THE LOST SETPOINTS, AND ANNOTATION (v0.16.1)

### The lost setpoints — you were right, and there were two separate things

| # | What | Status | Notes |
|---|---|---|---|
| LS.3 | **Why the plant will not ramp up — your point, confirmed** | ⬜ | **Every chiller and tower says `limit: Design ΔT`, and none is near its capacity.** CT-01: 421 kW of 836 (50%), inlet 49.2 → outlet 39.2, i.e. exactly its 10 K Design ΔT. ACCH-01: 269 kW of 800 (34%), 39.2 → 24.2, exactly 15 K. The machines are not out of capacity — they are refusing to work harder because ΔT is treated as a hard clamp on the temperature change **at any flow**. |
| LS.4 | So the AHUs starve | ⬜ | All 14 at 89–91% of rated flow, EWT 31–32.6 °C, ICVs wide open. The loop cannot get cold because the plant will not take more than its design ΔT out of it. |

### Annotation batch

| # | What | Status | Notes |
|---|---|---|---|
| A2 | Text box | ⬜ | Still open. The note IS created on the active level with the right text — so this is a drawing or hit-test problem, not a model one. Next. |
| A4 | Details selectable | ⬜ | Wired in the SELECT (arrange) tool; while the DETAIL tool is active a click erases instead, which may be what you hit. Worth retesting now A5 makes the tool's state visible. |

## 5G. PERFORMANCE, AND STATIC SIMULATION (v0.16.0)

| # | What | Status | Notes |
|---|---|---|---|
| S4 | **STATIC / DYNAMIC** | ⬜ | In the Simulate ribbon, Static default. Locks anything that would change the answer — drawing, dragging pipes/devices/nodes, isolating, reversing, deleting. Still free: every property readout, selection, control-link routes, DETAIL and TEXT annotation, and moving labels. Refusals say so rather than silently ignoring the gesture. The panel greys its editable fields to match. |
| S3 | Progress bar | ⚠️ | **Partial, and I want to be straight about it.** The bar appears before the solve starts, so a long wait is explained rather than looking like a hung page — but the solve itself is still one uninterruptible block, so the page is still unresponsive while it runs. See below. |
| S3b | Why not fully non-blocking | ⬜ | A Web Worker is the obvious answer and is unavailable: the app must run from `file://` and Chrome refuses to construct a Worker from a null origin. Slicing at the device boundary was tried and backed out — one device's search is ~15 full solves, so it still blocked for seconds and each slice re-ran the non-control work. The atom that works is one `evaluate()`, which needs the control loop turned into a generator. That is next, and I would rather do it with you able to test. |

## 5F. THE CHWPs, AND A TAG REPAIR (v0.15.9)

| # | What | Status | Notes |
|---|---|---|---|
| CH.3 | What is left is real | ⬜ | `SETPOINT_LOST` on all 14 AHUs: their **integrated valves** are at full travel and still off setpoint, with TS-1/2/4 reading ~32.8 °C against 30. That is a heat-balance statement, not a control failure — the lineups cannot deliver what the hall is rejecting at these speeds. Worth checking against your intent. |
| TG.1 | **Tag corruption — still not reproduced** | ⚠️ | **Read this one.** I have not found the route. The v0.15.8 guards demonstrably work (I drove the detached-input path and the write was refused), yet `20260808-DC-broken` was saved by v0.15.8 with `CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1`. Every corrupted value is `<a real tag><one or more freshly generated ones>`. |
| TG.3 | One it cannot fully repair | ⬜ | `CHWP-0AHU-15AHU-152` → `CHWP-0`. The head really is `CHWP-0` — the repair can only strip what was appended, it cannot know you meant `CHWP-02`. Please rename that one by hand. |
| SY.1 | **Sync drawn on selection** | ⬜ | Select a master and a dash-dot line goes out to each follower; select a follower and one goes back to the master, with an open arrowhead at the follower so the direction is on the drawing. Straight, and only while selected — a sync is a relationship you check and move on from, and eight pumps' worth of permanent leaders would bury the pipework. |

## 5D. SELECTION, PICKING AND TWO SLIDERS (v0.15.7)

| # | What | Status | Notes |
|---|---|---|---|
| A1 | No arrow at zero flow | ⬜ | The old threshold was 1e-9 m³/s — a numerical zero, not a hydraulic one, so a shut branch settling at 1e-7 still drew an arrow. Now `Q_MIN`, the same threshold the solver uses to decide a link carries water, so the drawing and the calculation agree about what "no flow" means. |

## 5C. EQUIPMENT CONTROLS, AND FOUR SMALL ONES (v0.15.6)

| # | What | Status | Notes |
|---|---|---|---|
| C3 | dP button places a temperature sensor | ⬜ | **Could not reproduce** — all five buttons place their own kind in this build. But see C1: clicking the middle of a 25 m pipe hit-tested onto an adjacent **1 m device pipe**, which would place a sensor somewhere you did not mean. I think that is what you saw, and it is next. |

## 5B. PUMPS IN PARALLEL (v0.15.5)

| # | What | Status | Notes |
|---|---|---|---|
| PP.2 | Why grouping, not self-modulation | ⬜ | **Worth your view.** N loops on one sensor is degenerate — any split that gives the right reading satisfies all of them, so "self-modulating" can only ever land somewhere arbitrary. Real plant doesn't do it either: parallel pumps on a common header take ONE speed command. Your own description — fluctuates for hours, then settles at roughly equal % — is independent loops fighting, then being commanded equal. This goes straight to that answer. |
| PP.3 | Staging | ⬜ | Grouping is on *same target + same setpoint*. To stage a lag set, give it its own setpoint — that is the natural way to say it and it needs no new concept. |
| PP.4 | It says so | ⬜ | `CONTROL_GANGED` names every member, and the pump panel gains a "Modulating with" row. A behaviour this consequential should never have to be inferred. |
| PP.6 | Solve time | ⬜ | ~30 s on the DC model. Ganging cut 4 searches to 1, but this model is 275 pipes with 5 independent loops. The loading bar and Static mode you asked for are the right answers and are still on the list. |

## 5A. THE TWO CRITICAL BUGS (v0.15.4)

| # | What | Status | Notes |
|---|---|---|---|
| CR.5 | Check your two saved files | ⬜ | `20260807-DC.json` and `-DC-broken.json` BOTH already carry the mangled tags — the corruption predates them, so the fix cannot repair them. Three to correct by hand: `P298` → PWP-04, `P379` → CHWP-02, `P413` → CHWP-04. |

## 4Z. ANNOTATION, ROUTES AND PRINTING (v0.15.3)

| # | What | Status | Notes |
|---|---|---|---|
| AN.3 | Control link nodes drag freely | ⬜ | Grab any bend. The first drag converts the Z into waypoints, starting from exactly what is on screen so it does not jump. Grid-snapped; Shift for free placement. |
| AN.4 | LINK NODE adds a bend | ⬜ | Select the pump, valve or sensor first, then press it. It goes in the middle of the longest segment — the one with room. |
| AN.5 | **DETAIL** | ⬜ | Click to place vertices, Esc finishes, click an existing line to erase it. Colour and width in Properties. Nothing in the calculation ever reads them — pinned by a test that solves before and after adding a 100 m line across the model. |
| AN.6 | **TEXT BOX** | ⬜ | Click to place, click again to edit, drag to move. Multi-line. |

## 4Y. THE ECONOMIZER MODEL, AND FIVE UI ITEMS (v0.15.2)

| # | What | Status | Notes |
|---|---|---|---|
| EC.3 | The one remaining warning | ⬜ | `EQUIP_LIMITED` on ACCH-1: it is on its 15 K design ΔT, so from 30 °C it can only reach 15 °C. That is your design, not a fault — but check the ΔT is what you meant. |
| UI.15 | **Blank capacity = unlimited, not "auto"** | ⬜ | **Your question.** There is no auto-balance mode. For a SOURCE/SINK, blank capacity already gives you most of what you asked for: it modulates freely to hold its leaving temperature, so it absorbs whatever the loop throws at it. What blank does NOT do is size itself against the load and report a duty you could put on a schedule. Say if you want that. |

## 4X. UI PASS, PANELS AND THE RIBBON (v0.15.1)

| # | What | Status | Notes |
|---|---|---|---|
| UX.3 | Equipment panel | ⬜ | Details · Design · Actual · Display, your list. Heat source/sink and heat exchanger get their own Design fields; "Other" (adiabatic) drops to Flow / Pressure drop / K factor. |
| UX.6 | Temperature limit Max/Min | ⬜ | Shown beside the value, following the load direction: a heating coil is limited by a maximum, a cooling coil by a minimum. It is an indicator, not a second input — the engine already works out which side binds, and two ways of saying it could disagree. **Tell me if you wanted it settable.** |
| UX.7 | Control valve vs isolation valve | ⬜ | Two panels now. Isolation gets Open/Closed as its Status and no position slider — a gate valve is not a regulating device. **One judgement call:** an existing gate valve left part-open keeps its slider, so nothing drawn before this loses a setting silently. |
| UX.8 | Check valve | ⬜ | Third shape: Direction, Kv, no status and no position. |
| UX.9 | % Load and Position % on the drawing | ⬜ | Both were offered as toggles and neither was drawn. On a balanced circuit the valve positions are the answer, so they are the thing you want on a plot. |

## 4W. UI PASS, FIRST STAGE (v0.15.0)

| # | What | Status | Notes |
|---|---|---|---|
| UI.3 | Tools grouped by what the thing IS | ⬜ | Edit · Pipe · Hydraulic · Thermal · Valves, named on the ribbon. |
| UI.4 | One button per device type | ⬜ | The valve dropdown is gone and equipment type is choosable at placement: HEAT SOURCE/SINK and HEAT EXCHANGER get the right defaults, OTHER places an adiabatic item tagged STR-n. |
| UI.5 | CONTROL LINK is a tool | ⬜ | Click the pump or control valve, then its target. The panel button still works and is now "Link sensor". |
| UI.6 | Copy/Paste moved out of FILE | ⬜ | Into DESIGN ▸ Edit, beside the selection they act on. |
| UI.9 | Design duty shown but not editable on Auto/Curve | ⬜ | Dashed, greyed, unfocusable. Your instruction — and it stops the panel changing height when the dropdown moves. |

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

## 4U. ANGLE SNAP AND THE ΔP LEADERS (v0.14.8)

| # | What | Status | Notes |
|---|---|---|---|
| AS.3 | Connecting still beats the bearing | ⬜ | Unchanged and deliberate: a node or pipe within the snap radius wins over the 15° constraint, so a run can still land exactly on existing work. One of the three test pipes came out at −30.18° for that reason. |
| DP.1 | The ΔP stem is orthogonal | ⬜ | It was still a diagonal — I made the *reference* line orthogonal in v0.14.6 and left the leader from the pipe to the bubble alone, which only shows once the bubble is dragged. Both are Z routes now. |
| DP.2 | The reference line no longer retraces the stem | ⬜ | On `20260805-5` it left the bubble going back over its own stem and then ran parallel to the sensor's pipe 9 px off it — the mess in your screenshot. It now leaves perpendicular when the far tapping is behind the bubble. Verified over five drag positions: no diagonals, no retracing, no zero-length segments. |
| DP.3 | Drag the bubble to the far side of the pipe | ⬜ | The case that broke the first fix: the nominal normal points one way and the dragged leader arrives from the other. Worth a look in all four quadrants. |

## 4T. PUMP SIZING AND SOURCE MIXING (v0.14.7)

| # | What | Status | Notes |
|---|---|---|---|
| PS.3 | A pasted manufacturer curve is untouched | ⬜ | Neither the sizer nor the panel regenerates a curve marked `fitted`. |
| PS.4 | **A pump the sizer puts at ZERO head** | ⬜ | **Known gap, your call.** If the source alone satisfies every outflow, auto sizing lands on 0 m; there is no duty to build a curve from, and SIMULATE still says "Pump curve required" — which is not a useful way to say "this pump has nothing to do". Say the word and it gets its own message. |
| SM.1 | A source on a main MIXES | ⬜ | Your report. 1.76 L/s of 60 °C meeting 6.24 L/s of 10 °C make-up gives 20.99 °C; it used to read a flat 10 °C. |
| SM.2 | A source on a branch is unchanged | ⬜ | Your workaround has to keep working: every drop leaving the node came from the source, so the node sits at the source temperature exactly. |
| SM.3 | **A fill absorbs nothing, wherever it is drawn** | ⬜ | **This is the answer to TH.8.** A dead-leg fill and an in-line one on the same sealed circuit now report the SAME 20 kW shortfall, against a pinned datum rather than against the fill. Your expansion-tank objection was right — the tank was never absorbing anything, the pin was. |
| SM.4 | THERMAL_DATUM may appear where it did not before | ⬜ | It is now raised when the solve genuinely cannot pick a temperature level, and NOT raised when a chiller setpoint already sets one. On one test model the old pin was overriding a chiller holding 6 °C and booking the 83.6 kW difference as absorbed heat. Worth watching for on a model that used to be quiet. |

## 4S. DEADBAND, ROUTES AND ΔP SYMBOLS (v0.14.5)

| # | What | Status | Notes |
|---|---|---|---|
| DB.2 | ΔP / ΔT bubble says so | ⬜ | Was showing `T`. Two-character labels use a smaller font to fit the bubble. |
| DB.3 | The second probed pipe is drawn | ⬜ | Dotted line from the bubble to the reference pipe with an open square at the far tapping — a different mark from the control link's ring, because it means a different thing. Only when both are on the level being shown. |
| DB.4 | Control links drag in all four directions | ⬜ | Pull across the current segment and the route flips axis (1.6× hysteresis so it does not chatter). Verified live: axis h → v, mid 44.88 → 8.53. |
| DB.5 | **Is 0.2% the right flow deadband?** | ⬜ | **Your call.** Tighter than any flow meter and comfortably inside what 1% of valve travel resolves — but it is what decides whether a nearly-right branch gets throttled at all. |
| DB.6 | The reference line is orthogonal | ⬜ | Right-angle Z like the control link, not the diagonal you photographed. Leaves along the stem so it cannot double back across the sensor's own pipe. Verified: H → V → H, ending on the square. |
| DB.7 | DXF: ΔP/ΔT bubble and its reference line | ⬜ | Same defect was in the export — it said `T` too, and drew no reference line. Now `dP`/`dT` and the same orthogonal route, solid rather than dotted (R12 has no dotted linetype without an LTYPE table). Still unopened in real CAD — see DX.1. |

## 4R. PARALLEL BRANCH BALANCING (v0.14.4)

| # | What | Status | Notes |
|---|---|---|---|
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
| BK.3 | Control valve is equal percentage | ⬜ | Your table. On the mixing rig the valve now controls at 69% of travel instead of 33% — say whether that reads better on a real job. |
| BK.4 | "Source Water Temperature" | ⬜ | Renamed on THERMAL. It is what a SOURCE holds when it states no temperature of its own, plus the pin for a fully adiabatic circuit — not a setpoint. |
| BK.5 | Adiabatic equipment type | ⬜ | Filter/strainer: keeps its ΔP, no thermal side, no control options. Verified: 687 kPa drop retained, ΔT exactly 0, `canBeControlled` false. |
| BK.6 | "Show curve" draws the curve above the table | ⬜ | With the operating point on it. Same builder as the calculation sheet, so they cannot drift. No system curve in the quick look — say if you want it. |

## 4L. OVERLOAD BEHAVIOUR and setpoint priority (v0.12.4)

Driven live on `20260804-3.json`.

| # | What | Status | Notes |
|---|---|---|---|
| OV.2 | `SETPOINT_LOST`, your wording | ⬜ | "System is unable to maintain setpoint. Check heat balance." An ERROR — it clears `converged`. |
| OV.3 | **The trade-off, and it needs your ruling** | ⬜ | **The one to judge.** For a machine holding a LEAVING temperature, minimum speed was *closer to setpoint*; full speed moves the most water. The rule now picks delivered capacity. It changed the v0.11.1 economizer case, which parks at full instead of on its floor. Overrule me if that reads wrong on a real job. |
| OV.4 | Setpoint priority is a drag list | ⬜ | Same grip and gesture as LEVELS, labelled primary / secondary. Verified live: dragging ΔT above LWT stored `order:['dt','lwt']` and the engine followed. |

## 4K. CONTROL AUTHORITY and valve UX (v0.12.3)

Driven live on `20260804-2.json`.

| # | What | Status | Notes |
|---|---|---|---|
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
| PC.1 | One chart per pump, no more "first pump only" | ✅ | Confirmed 2 charts, captioned `PMP-01` and `PMP-02 — 75% speed`. The WIP note is gone. |
| PC.2 | 90/80/70/60/50% curves, dotted | ✅ | 5 dotted polylines per chart, each labelled at its own shutoff head where nothing else is drawn. |
| PC.3 | System curve in red |✅ | Uses `var(--error)`, so it is red in both themes. Labelled "system" at its top end. |
| PC.4 | The simulated operating point, marked and labelled | ✅ | e.g. `27.41 L/s @ 277.1 kPa`. |
| PC.5 | A pump running at a speed outside the family gets its own dashed curve | ✅ | PMP-02 at 75% drew an 8th polyline, dashed `6 3`. Say if that is clutter. |
| PC.6 | **Is the red line dense enough to read?** | ✅ | **The one to judge.** 6–9 solved points per curve. Against static lift most of a speed sweep passes no flow, so the working range is swept again — but the line is still a polyline through solved points, not a smooth fit. |
| PC.7 | In DESIGN there is no red line, and a 🛈 says why | ✅| Confirmed: 0 red polylines, family and rated curve still drawn, marker reads "…the demands impose the flow, so there is nothing to trace." |
| PC.8 | Does the system curve look right for a job you know? | ✅| **The engineering judgement.** It is solved rather than assumed — each point is a real solve — so it should show static lift as a non-zero intercept. Worth checking against something you have sized by hand. |

## 4F. PART LOAD / VFD reporting (v0.11.3)

Your catch. The engine was already solving the intersection correctly — what
was wrong was what got reported. Swept in the live app on your own model.

| # | What | Status | Notes |
|---|---|---|---|
| PL.1 | Panel "Actual pressure" falls at part load | ✅ | Read back live across 100→50% on your fitted curve: 439.1 → 356.0 → 281.4 → 215.5 → 158.4 → 110.1 kPa. H/H1 matched n² to four decimals. |
| PL.2 | Panel, drawing plate and calculation sheet all agree | ✅ | All three now call `M.pumpHead()`. They disagreed before: the plate was right, the panel and sheet read the curve in DESIGN. |
| PL.3 | A typed VFD % in DESIGN no longer inflates the sized duty | ✅ | Was 44.8 m at 100% → 179.4 m at 50%, flow pinned at 20.00 L/s. Now unchanged at 44.8 m. |
| PL.4 | 🛈 appears on VFD speed when a stored speed is being ignored | ✅ | Only in DESIGN, and only when a speed below 100% is actually stored. Reads: "Speed applies in SIMULATION only…". |
| PL.5 | Stale "Design pressure" after a bad DESIGN solve | ✅ | **Noticed, not fixed.** Your model still showed `Design pressure 12791.88 m` in SIMULATION — that is `hDesign` recorded by the last DESIGN solve, before the AHU was corrected. It refreshes on the next DESIGN solve. Say if you want it blanked instead when it is stale. |
| PL.6 | Does the part-load picture look right on a job? | ✅ | **The engineering judgement.** The numbers are hand-checkable (H ∝ n², and correctly NOT n² once there is static lift) but whether the whole reading is what you expect is your call. |

## 4C. SETPOINT CONTROL — variable-speed pumps (v0.11.1)

The engine side is covered by 47 new assertions, including Michael's economizer
against a closed-form flow. **Nothing below has been rendered to pixels** — the
preview browser has a 0×0 viewport, so every item here is about appearance and
is unsigned. The DOM was driven and read back, so the wiring is known good; how
it *looks* is not.

| # | What | Status | Notes |
|---|---|---|---|
| 4C.1 | Pump info plate shows `N 54%` when modulating | ✅ | Only when off full speed — "100%" on every pump is clutter. Line added below `H`. |
| 4C.2 | Pump panel Actual box: `Speed  54% — holding ECO-01` | ✅| Read back from the live DOM, so the text is right; the layout is not checked. Says `(at minimum)` when on the floor. |
| 4C.3 | Device Flow row reads `PMP-01 (54% speed)` | ✅ | Read back live. |
| 4C.4 | Pump-curve chart: scaled curve solid, rated curve dashed behind it | ✅ | **The one to judge.** Two polylines confirmed present; whether the dashed rated curve reads clearly at 45% opacity is a visual call. Caption says "54% speed (rated curve dashed)". |
| 4C.5 | Controlled globe valve: "Set by the control link" beside the slider | ✅ | The position is now an OUTPUT — without this line, setting it by hand looks like a bug when the next solve moves it. Not exercised in the browser; logic is a one-line `M.controlOf` guard. |
| 4C.6 | THERMAL ▸ Setpoint control: three fields | ✅ | Minimum pump speed (%), minimum valve opening (%), deadband (K). Values read back as 25 / 10 / 0.05. |
| 4C.7 | `CONTROL_AT_LIMIT` wording on the sheet | ✅| "PMP-01 is at its minimum speed (25% speed) and ECO-01 is still 2.5 K above its 25.0 °C setpoint." Engine-tested; not seen in the warnings panel. |
| 4C.9 | Pump panel now reads `VFD speed 100%` on every running pump | ✅ | You asked for it shown; it was hidden at 100% before. There is also a **VFD %** toggle in the pump's "Show on drawing" list, off by default, which puts `VFD 54%` on the info plate. Say if you want that on by default. |
| 4C.8 | Does 54% look right for that economizer? | ✅ | **The engineering judgement.** The flow it settles at is hand-checkable (11.97 L/s for a 250 kW machine across 5 K) but whether the whole picture is what he would expect on a job is his call. |

## 4D. THERMAL module (v0.10.0)

Built and engine-tested; nothing here has been rendered to pixels, and two data
sets need Michael's eye before anything is issued.

| # | What | Status | Notes |
|---|---|---|---|
| 4D.1 | **Propylene glycol properties** | ⬜ | **Check these first.** Written from recollection of ASHRAE Ch 31, flagged `verified: false` throughout, and the flag appears on the calculation sheet. **Cp scales every duty linearly** — 5% out on Cp is 5% out on every kW. Water is untouched (998 / 4187, the app's own values). |
| 4D.2 | **Insulation thicknesses** | ⬜ | A placeholder, and flagged as one. No single standard exists to read off — thickness follows service, ambient and jurisdiction. Set them from your standard; a pipe's own value wins, including 0. |
| 4D.3 | Outside surface coefficient | ⬜ | 8 W/m²·K, a default. On a bare pipe it is the ENTIRE resistance, so a bare-pipe answer is only as good as this. |
| 4D.4 | THERMAL tab layout | ✅ | Sign convention, fluid readout, conditions, insulation table, last-solve summary. Never seen as pixels. |
| 4D.5 | Equipment ΔT / Q toggle | ✅ | One toggle serves DESIGN and SIMULATION. Verified in the DOM: ΔT 6 K and a duty of −125.359 kW give exactly ∓6 K and ±125.36 kW on the same model. |
| 4D.6 | Temperature on the drawing, probe, visualiser | ✅ | ANNOTATIONS ▸ Temperature, the PROBE readout, and a TEMPERATURE visualiser beside PRESSURE. Verified through the render path; the probe re-solves the exponential rather than interpolating between the ends. |
| 4D.7 | Fluid selector locks unless Custom | ⬜ | A named fluid's properties are read-only, for the same reason the published equivalent-length tables are. Verified in the DOM. |
| 4D.8 | **Does the whole thing agree with a job you know?** | ✅ | **The one that matters.** Pipe heat gain, coil duties and mixed temperatures against something with known answers. Nothing here has been checked against another tool. |

## 4E. Thermal, second round (v0.10.1)

| # | What | Status | Notes |
|---|---|---|---|
| 4E.1 | **Insulation Critical Radius tool** | ✅ | **Please rule on this one.** It takes ambient and fluid temperature as you asked, but the critical radius is `r_cr = k/h` and contains **no temperature at all** — doubling the temperature difference doubles the heat flow at every radius and moves the turning point not at all. Rather than ignore the inputs, they drive the heat loss and the **surface temperature**, which is the number to compare against dew point. With PU at k = 0.02 and h = 8, r_cr = **2.5 mm**, so it never binds on any pipe in any schedule here. If what you actually want is the condensation-control thickness, that is a different calculation and needs the room's humidity. |
| 4E.2 | Insulation moved onto the pipe schedule | ✅ | The schedule table now shows nominal / bore / OD / wall / insulation, with only insulation editable. 25 mm below DN50, 50 mm from DN50 up. A pipe still overrides it individually, including 0. |
| 4E.3 | Current schedule + Add / Copy buttons | ✅ | "Copy Current Schedule" seeds a new custom one from the active schedule's sizes. Custom schedules now take an **outside diameter** as their third column instead of insulation — the thermal module needs it, and without it a custom schedule falls back to the bore and understates heat loss. |
| 4E.4 | Equipment: Hydraulics header, thermal dropdown | ✅| "Solve Q from ΔT" / "Solve ΔT from Q". |
| 4E.5 | **A 100 kW load with no heat rejection** | ✅ | **Your test case, and it found a real design fault.** The datum pinning would have held the loop at the flow temperature and reported a system that never warms. Ambient is a reference, so a pin is now only used when there is no source *and* no ambient coupling. The loop settles where the pipes shed exactly what the load puts in — 63–64 °C for 100 kW into 800 m of bare DN100, energy balance closing to 0 W. |
| 4E.6 | Runaway guard | ✅ | Your alternative, kept alongside the equilibrium rather than instead of it. Outside the band it is an **error**, clears `converged`, and takes the status chip — but the temperatures are still reported, because the answer is not wrong, it is implausible, and hiding it leaves nothing to diagnose from. |

## 4F. Equipment types (v0.10.3)

| # | What | Status | Notes |
|---|---|---|---|
| 4F.1 | Source / Sink and Heat Exchanger | ✅ | Setpoint-led and load-led. Verified against hand calculations: a 100 kW chiller asked for 6 °C from an 18 °C inlet leaves at 13.21 °C and reports "Limited by Capacity". |
| 4F.2 | Capacity vs ΔT max | ✅ | Both are needed and bind in different places — the same machine swaps from capacity-limited to ΔT-limited at a quarter of the flow. Worth confirming that matches your plant data. |
| 4F.3 | T limit | ✅ | Your economizer case: setpoint 25 °C, limit 18 °C. Holds 25; asked for 12 it reaches 18 and stops, reporting "T limit". |
| 4F.4 | Load ↔ ΔT are locked | ✅ | Both boxes offered on an exchanger; each rewrites the other at the rated flow. The model stores duty. |
| 4F.5 | Valve opening 0–100%, 1% steps | ✅ | Slider plus a typed box. The Kv curve is still tabulated at the quarter points and interpolated between them — **that interpolation is a shape, not measured data**, same caveat as the Kv values themselves. |
| 4F.6 | **Variable-speed pumps** | ✅ | **NOT BUILT.** Your realisation that setpoints need pump modulation is right, and it is the next significant piece — see HANDOVER §9. |

## 5. Output

| # | What | Status | Notes |
|---|---|---|---|
| 5.1 | Calculation sheet readability | ⬜ | |
| 5.2 | Critical path listed first and highlighted | ⬜ | **New.** |
| 5.3 | CSV export opens cleanly in Excel | ⬜ | Check the delimiter/decimal option for your locale. |
| 5.4 | Print calculation sheet | ⬜ | Letterhead margin reserved at the top. |
| 5.5 | Print level plans — one page per level, shared scale | ⬜ | Sheets should physically overlay. |
| 5.6 | Save and reload a model | ✅ | Exercised constantly in testing; not deliberately stress-tested. |

## 6. Error handling

| # | What | Status | Notes |
|---|---|---|---|
| 6.1 | No source → "Water source is required" | ✅ | |
| 6.2 | Supply insufficient → red source, actual flows in brackets | ✅ | |
| 6.3 | Dead-ended pump | ✅ | |
| 6.5 | Laminar flow warning | ✅ | |
| 6.6 | Shut valve starving a demand | ✅ | |

## 6A. Source pressure and pipe length (v0.7.7-dev)

Both of these came from `debug/20260802-1.json` and are reproduced in the
automated suites, but the *reading* is the part only you can sign off.

| # | What | Status | Notes |
|---|---|---|---|
| 6A.1 | A source node reads its stated pressure | ✅ | Was 0 kPa gauge, which read as a jump at the next node. Now `H = z + P/(ρg)`, so the node reads exactly what is typed into it. **Every downstream number is unchanged** — check that against a model you already know. |
| 6A.2 | Setting a source pressure no longer moves the node | ⬜ | It was stored as an elevation. `20260802-1.json` now loads with its pipe at exactly 50 m, not 54.01 m. |
| 6A.3 | Pipe length is editable on a sloped pipe | ✅ | `changeLength` was comparing a 3D length to a plan length. It now solves `plan = √(L² − rise²)` and refuses a length below the rise. |
| 6A.4 | The migration dialog on loading an older file | ✅ | **Please read it and say whether it explains itself.** It fires once per file and it is telling you pipe lengths have changed. |
| 6A.5 | Sloped layout pipes are refused | ✅ | **New in v0.7.8-dev.** A pipe whose ends differ in elevation is a `SLOPED_PIPE` error and takes the status chip red. Verified in-browser on the old `20260802-1.json` geometry. Worth checking against any model of yours that predates the rule — if one lights up, the pipe was being measured along its slope and its friction was overstated. |
| 6A.6 | Pipe lengths after the rule change | ✅ | **Please spot-check a model you know.** Any pipe whose ends were at the same elevation is unchanged to the last decimal. Only a pipe that was silently sloped moves — and that one was wrong before. |

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
