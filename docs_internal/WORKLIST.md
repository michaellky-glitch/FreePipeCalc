# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done. Closed items move to
`Human-Test.md` with a verification note.

The Domestic Water module (DW.MOD) is functionally COMPLETE as of v0.17.12 and
Michael has signed off the IPC data; the only DW item left is a per-pipe
diversity-flow readout on the canvas. Everything else he has raised is done; what
remains is his continued testing (currently on `debug/20260818-lowrise.json`) and
one thing found in passing (DX.1).

Updated 2026-08-24, after **v0.18.14 (beta)** — the handover's open list worked
down: pump runout, the docs registry guard, two `setSync` bugs, the sweep →
iteration rename (SW.2, closed), and the GGA iteration values in `engine.html`.

---

## THE ONE THING OUTSTANDING: MICHAEL HAS NOT SEEN ANY OF IT

Nine versions were built in one session (v0.16.4 → v0.16.15) and **none of the
UI has been through his eyes.** Everything was driven through the DOM and the
numbers were checked, but the preview browser renders nothing to pixels, so no
question of the form "does that LOOK right" has been answered.

`Human-Test.md` opens with a `WAITING ON YOU` block holding **§5K–§5Y**. That is
the backlog. Expect a long list back; work down it and say plainly what was not
done.

The likeliest things to come back:

* the **riser notation** box size and where its leader points (§5Y)
* the **TOOLS window** at 400 px — the Convert rows, the tab strip (§5S)
* the **paste preview** and its rotation on screen (§5W, §5X)
* the **greyed tags** and the grid-sized annotation handles (§5T)

---

## Still open

| # | Item | Notes |
|---|---|---|
| DW.MOD | **Domestic Water module — RE-ARCHITECTED to a separate discipline (2026-08-16)** | Michael pivoted to DE-RISK the GGA (Option A, one app): **a file is one discipline**, `m.discipline` = `hydronic` (default) \| `plumbing`. In a plumbing file the GGA is NEVER invoked. The DISCIPLINE lives a layer ABOVE the tab bar via the **repurposed loop-type chip** (`#system-chip` → HYDRONIC/PLUMBING, click toggles, **confirm warning** "Changing an existing model between Hydronic and Plumbing may break it"). The network tab is relabelled per discipline (HYDRONIC — was "PIPING NETWORK" — or PLUMBING); plumbing shows its own reduced tab set (PLUMBING + plumbing CALCULATION + SETTINGS + DOCS, no THERMAL/HYDRAULIC). Canvas + drawing tools + save file are shared. Plumbing solved only by `M.plumbingSizing`. Full spec + phases A/B/C in `docs/DW-MODULE.md` → **Architecture v2**. **Built already (reusable):** `data/plumbing.js` (IPC E103.3(2) with per-fixture variations, `verified:false`), `M.outflowFU`, `M.plumbingSizing` (tree accumulation + `DW_LOOP`/`DW_NO_SOURCE`/`DW_MULTI_SOURCE`). **To do:** ~~Phase A scaffold~~ **DONE v0.16.33**; ~~Phase B plumbing HYDRAULIC tab + editable IPC tables + sizing sheet~~ **MOSTLY DONE v0.17.0** (Design ribbon drops thermal tools; HYDRAULIC tab kept in plumbing with editable fixture-FU + FU→flow tables, per-model overrides that feed `plumbingSizing`; plumbing CALCULATION sheet: per-pipe downstream FU → diversity flow → velocity). **Status (v0.17.12): functionally COMPLETE.** Discipline scaffold, editable IPC tables (E103.3(2)/(3) + 604.3, merged fixtures table), design sizing + friction + residual pass, K-terminal SIMULATE, per-fixture 604.3 mapping with red estimates, calc sheet with All Pipes/Critical Path (Design) + Critical Path (Simulation), outflow tags/templates/multi-select, and Michael's IPC sign-off (`FD.plumbing.verified` all true). **Only remaining:** a per-pipe diversity-flow readout drawn on the CANVAS itself (numbers already on the sheet + pipe panel). |
| DS.1 | **A DESIGN calculation must assume DESIGN FLOW through each piece of equipment** | Michael, 2026-08-24, and it is DECIDED — what is missing is the change, which he asked to leave for now. Today an integrated control valve in design mode is a fixed resistance at whatever `opening` the last SIMULATION left on it, because the control loop does not run in design. On `test/fixtures/tower-five-level.pnet.json` that put the four floors at 100 / 100 / 54 / 58% and ranked them by valve position instead of by a 0.7% hydraulic spread — the design-mode index was right for the wrong reason. See `HANDOVER.md` §0. |
| DS.2 | **Separate Design Calculation from Simulation Calculation, as PLUMBING already does** | Michael, 2026-08-24: "I think we will need to separate out Design Calculation & Simulation Calculation like is done in Plumbing." The plumbing discipline runs a design sizing pass and a K-terminal simulation as two distinct calculations rather than one solve reading `settings.calcMode`. Hydronic should follow. **Deferred by him**, together with DS.1; the assertions get cleaned up after. |
| MSG.2 | **Trim the verbose messages** | `docs/MESSAGES.md` §7 proposes shorter forms for 8 messages; awaiting Michael's yes/no per line, then apply to source. (CONTROL_HUNTING already reworded in v0.16.26.) |
| DX.1 | Does the DXF open in real CAD? | Untested; nothing in this environment can check it. |

---

## Recently closed

Newest first. Detail in `Human-Test.md` §5A–5J and §5DW.

* **v0.18.14 (BETA), 2026-08-24 — SW.2 CLOSED, plus four more off the handover's
  open list.** The sweep → iteration rename is finished: `sweep`, `MAX_SWEEPS`,
  `reSweep`, `cfgSweeps` and `report.sweeps` are gone from `network.js`, `app.js`
  reads and writes `iterations`, and the saved key is migrated at load by
  `M.migrateControlIterations` so no existing file loses its settling count.
  Also: `PUMP_RUNOUT` measured against the SCALED curve so every controlled pump
  that slowed down raised a false runout (Tutorial 01 at 99% of design flow, over
  a 120% limit); `M.setSync` did not collapse a chain of EXCHANGERS, and would
  build a cycle when the head of a chain was synced to its tail; a guard on the
  `src/docs.js` registry so a renamed document cannot 404 in the tab unnoticed;
  and the GGA iteration values written into `docs/engine.html` §6.3.

* **CI, 2026-08-19** — GitHub Pages is now published by
  `.github/workflows/pages.yml` on every push to `master`, gated on the test
  suites. The legacy branch builder had stopped firing and the site served
  v0.17.17 for three releases with nothing recorded anywhere. First run: test +
  deploy both green, site live on 0.18.0.

* **v0.18.2 (BETA)** — **Q = K·√P is back, and with it the control loop**
  (Michael, 2026-08-19). The fixed-draw forward pass built the previous day made
  an open tap draw its 604.3 flow whatever the pressure — so simulated flow
  equalled design flow by construction — and, because `runControls` lives inside
  `solveModel`, a pump linked to a pressure sensor was not being controlled at
  all. SIMULATE is the unmodified GGA on the K-terminal copy again (as
  v0.17.2–v0.17.20). Verified: doubling the supply 300 → 600 kPa takes a
  fixture's draw from 0.1177 to 0.1665 L/s, **ratio 1.4142 = √2**; and on
  `20260819-lowrise` the booster settles at **84% speed with PS-1 reading
  150.1 kPa against its 150.0 setpoint**, fixtures drawing 1.04–1.65× design.
  The solved actuator positions are now copied back from the converted copy onto
  the real model — the sensor was holding while the pump panel claimed 100%.
  `plumbingOpenPass` is removed. 1 net new assertion (suite 2224).

* **v0.18.0 (BETA)** — **SIMULATE showed no actual flow** (Michael, 2026-08-19,
  `20260819-lowrise`). It was COMPUTING it — `draw[node]` is the whole basis of
  the forward pass — and then not publishing it in the shape every reader
  expects: `drawDeviceBox`, the outflow panel's ACTUAL section and the sheet all
  look for `res.simulation.terminals`, which the GGA path builds and this path
  did not. A number computed and not published is indistinguishable from a
  number not computed. Now published, same row shape, with a row for every
  outflow — an OFF tap reads 0.00 L/s rather than "—", so the panel says "off"
  instead of "unknown".
  **"Suspiciously close to design" is the method, not a fault:** an open tap
  draws its design flow, so the ratio is exactly 1 by construction. What
  SIMULATE answers here is the PRESSURE.
  **"The pipe is over pressurized" is real and now reported.** With 4 taps open
  the booster runs back UP its curve toward shutoff — 308 kPa at 1.26 L/s
  against a 231 kPa duty — and 200 kPa of mains under it puts **508 kPa** into
  the riser. Correct arithmetic; the SYSTEM wants a PRV or a speed-controlled
  set. New `DW_OVER_PRESSURE` warning against an editable
  `settings.warn.maxStatic` (default 552 kPa = 80 psi, IPC 604.8's PRV
  threshold), plumbing only, editable on the HYDRAULIC tab. **It does not fire on
  this model** — 508 kPa is under 552 — so the threshold is Michael's to set.
  10 new assertions (suite 2223).

* **v0.17.21** — Michael's second 2026-08-19 list. **SIMULATE reverted to a
  user-chosen load case**: the REMOTE1 search is gone (spec kept in
  `docs/DW-MODULE.md`), and plumbing SIMULATE now pushes forward from the source
  and pump with whatever outflows are switched ON — each drawing its FULL 604.3
  flow, the pump reading its CURVE at the flow it passes. So the outflow switch
  is renamed **On/Off** and gains a **bulk** version for a multi-selection, and
  **valves of one type open/close together**. **The source-fed-by-a-pump
  "insufficient" warning is gone with it** — SUPPLY_INSUFFICIENT is a GGA
  warning and the GGA is no longer on any plumbing path. **Sizing now works with
  ordinary outflows and no fixture units at all** — the walk only started from
  components containing a plumbing fixture. **HYDRAULIC:** Fluid Properties and
  Hydraulic Parameters moved to the top, the IPC tables to the bottom, the
  fixtures fold renamed, the row-count and "IPC reference" notes dropped.
  **PROPERTIES:** Tag/Schedule/Size/C/Length/Insulation grouped under **Design**,
  and every titled read-out box (Pipe, Thermal, Domestic water) is now
  collapsible. **MONITOR** no longer duplicates Display. **PROBE** drops
  Temperature in plumbing. **DXF** prompts *3D Model* or *By Level* — one file
  per floor with the Z ordinates left in, so the sheets still stack. **CSV** is
  written with a UTF-8 BOM (Excel was reading `—` as `â€"` and `→` as `â†'`) and
  prompts for which tables to export, one file each — it was writing All Pipes
  and nothing else. 8 new assertions (suite 2213).

* **v0.17.20** — **REMOTE1 re-ranks every round** (Michael, 2026-08-19: "yes,
  please do this"). The order taps open in is now decided against the pressures
  the system actually has at that moment, not the design ranking computed once —
  because after ten taps are running, the least-margin tap left is not
  necessarily the one design ranked eleventh. **The extra pass per step it was
  supposed to cost does not exist:** the forward pass already computes a residual
  at every SHUT node, which is exactly "what would be available here if I opened
  it", so the last accepted pass carries the ranking signal for free. 19 passes
  either way on lowrise, 98 ms. Pinned by the invariant rather than the output —
  each tap opened was the least-margin one still shut, measured on the pass
  before it. 2 new assertions (suite 2206).

* **v0.17.19** — Michael's 2026-08-19 list. **REMOTE1** — the plumbing SIMULATE
  load case. Opening every fixture at once left the index fixture 220.8 kPa short
  on lowrise, which is an artefact of the question, not a finding: a booster is
  not sized to run every tap at once. REMOTE1 opens the most remote tap, then the
  next, until the system cannot deliver, and backs off the last one — **12 of 46
  served on lowrise, index margin +5.2 kPa** instead of −220.8. An open tap draws
  its FULL 604.3 flow, not a K-terminal draw (which had one WC pulling 2.35 L/s);
  the pump contributes what its CURVE gives at the flow it passes; no GGA on the
  path. In plumbing the SIMULATE **STATIC** button reads **REMOTE1**; DYNAMIC
  keeps the all-open case. Spec + the open question in `docs/DW-MODULE.md`.
  **MONITOR tool** — a new TOOLS tab: + adds the canvas selection, − removes the
  last, and each watched device gets the REAL properties panel (the same
  `renderPipeProps`/`renderNodeProps`, not a copy) so equipment on another floor
  can be tuned without leaving the floor you are on. Saved with the model.
  **TOOLS ribbon in caps.** **The active level now shows on the collapsed LEVELS
  header.** **CALCULATION:** a TOTAL row on Fixtures (count, FU, flow) and on both
  Critical Paths (Section PD, Static); Total friction drop reads negative.
  **Deployment:** `test/thermal.test.js` was reading `examples/stacked-riser` and
  `debug/20260805-4.json` directly — both are now frozen in `test/fixtures/`, so
  the whole suite passes with `examples/` and `debug/` deleted, and `debug/` is
  untracked (it stays on Michael's disk, it no longer goes to GitHub).
  8 new assertions (suite 2204).

* **v0.17.17** — **"Downstream FU = 116.9, Diversity Flow = 2.98. Why is Design
  Flow 3.98?"** (Michael, 2026-08-18, on P276 of 20260818-lowrise). The answer
  is **one generic outflow**, N54/OF-2 on Level 1, still sitting at the 1.00 L/s
  value `setDemand` writes as a default. `plumbingSizing` adds a generic
  (non-plumbing) demand LINEARLY on top of the diversified fixture-unit flow,
  which is the right rule — a continuous draw is not a fixture unit — but
  nothing said it was happening, and that one node was **a quarter of the
  building's design flow and a quarter of the booster duty**, from a number
  nobody chose. Now: a **`DW_GENERIC_DEMAND` notice** naming the nodes and their
  total; **Diversified** and **Generic** columns on the sheet (Generic only when
  the model has any) so a row shows its own arithmetic — 116.9 | 2.98 | 1.00 |
  3.98; and the pipe panel always writes the sum out instead of hiding Design
  flow when there is no generic.
  **BOOSTER DUTY FLOW — Michael's rule, logged in `docs/DW-MODULE.md` at his
  request:** Q = the undiversified flow at the most remote outflow + the
  diversified flow of (total FU − that outflow's FU) + any generic draw. The
  index fixture is the least-margin one, the same definition the Critical Path
  uses. Lowrise: N185 at 0.101 L/s + 114.7 FU diversified to 2.953 + 1.000
  generic = **4.054 L/s** (was 3.984 on the whole-branch rule). **One addition,
  flagged:** at low FU the demand curve sits above the sum of the 604.3 outlet
  flows, so the rule can land BELOW the flow the pipe itself is sized for — the
  duty is floored at the branch flow. Inert on a real job.
  **PRINT: the sheet now turns.** The pipe schedule reached 17 columns and at
  that width nothing fits A4 portrait — 734px even at 8pt with 2px padding.
  `printAs` measures the widest OPEN table under the print typography and claims
  a landscape named page when it must, saying so in a toast.
  14 new assertions (suite 2196). Human-Test **DW.X**.

* **v0.17.16** — **The booster sized to 47 L/s @ 2 MPa, and the plumbing
  HYDRAULIC tab had no controls on it** (Michael, 2026-08-18).
  **THE PUMP.** `autoSizePump` calls `solveModel(m)` — the GGA — on the model
  itself, twelve times. In a plumbing file that put the GGA back on the DESIGN
  path the discipline split exists to keep it off, and it saw every fixture as
  an ordinary demand at `device.flow`, which on a plumbing fixture is the
  **1.00 L/s placeholder**: 47 fixtures × 1.00 = **47 L/s**, chasing
  `device.reqPressure` (the hydronic placeholder) for twelve rounds of added
  head. New `FD.network.plumbingPumpDuty(m, pipeId)` — pure, in the engine,
  pinned by tests — sizes it in **one pass with no solve at all**: the residual
  pass is exactly linear in pump head (friction is fixed at the diversity flow,
  which does not depend on head), so the head that puts the worst fixture on its
  604.3 requirement is the current head plus that fixture's shortfall. It
  converges from ABOVE as readily as from below, so an oversized booster comes
  down. On 20260818-lowrise: **3.984 L/s @ 23.6 m (231 kPa)**, zero GGA calls,
  worst margin 0.00 kPa. Hydronic sizing is untouched.
  **THE TAB.** The plumbing HYDRAULIC tab `return`ed after the IPC tables, so
  the **friction method**, the **pipe schedule**, the **fitting equivalent
  lengths / K table** and the **warning thresholds** were unreachable in a
  plumbing file — every one of which the plumbing calculation uses. It now falls
  through to the shared sections (only SYSTEM, an open/closed-loop reading, stays
  hydronic-only). Verified live: raising the friction-rate limit 400 → 900 Pa/m
  takes the warnings 86 → 50, and switching to Darcy swaps the equivalent-length
  table for the K table. Both IPC tables are now **collapsible** — fixtures open,
  demand curves closed.
  **Also, both flagged items fixed** (Michael: "fix both"): the CSV header no
  longer hard-codes "Hazen-Williams (ASHRAE)" whatever the model uses, and the
  printed plan carries a pipe's tag as the canvas does. And a **1 Pa tolerance**
  on `DW_FIXTURE_SHORT` — an exactly-sized booster lands the index fixture on
  its requirement to within 3e-11 Pa, which the bare `< 0` flagged in red.
  9 new assertions (suite 2182). Human-Test **DW.U**.

* **v0.17.15** — **Plumbing/hydronic parity pass** (Michael, 2026-08-18: "check
  that the presentation is consistent in both modes … also check the backend").
  The plumbing module was built by a less capable model and had drifted from the
  hydronic baseline in ten places. **Engine (the serious half):**
  `plumbingReport` returned `warnings: []` unconditionally, so a plumbing file
  could not raise one — on `20260818-lowrise` **83 sections were over the
  400 Pa/m friction-rate limit and 2 over the velocity limit**, and the status
  chip sat green with an empty MESSAGES window. It now runs the SAME
  `flowRegimeWarnings` and `disconnections` the GGA path uses, plus two new
  codes: **`DW_FIXTURE_SHORT`** (a fixture below its 604.3 required pressure —
  the app's `computeWarnings` could not catch this, it was measuring against the
  hydronic `device.reqPressure` placeholder) and **`DW_UNSIZED`** (pipework in a
  component with no fixture, previously dropped from the sheet in silence). The
  status chip is now the shared one, so it counts, colours, previews and honours
  dismissals like hydronic. **Sheet:** the **Fittings** and **EL** columns are
  back (the allowance was always IN the numbers — the pipe panel and the CSV
  showed it, the sheet printed L and L eff with nothing to explain the gap);
  **Tag** gets its own column; sizes go through `fmtSize` (with the size unit on
  NPS, hydronic read 2" and plumbing read DN50 for the same pipe); the friction
  rate is flagged red against the limit; the sheet head names the **friction
  method** (it quotes a friction drop on every row and never said which
  equation); new **Fixtures** section (the analogue of hydronic's Device Flow —
  every fixture, FU, design flow, required, available, margin, worst first); new
  **Warnings** and **Appendix — Sizing Parameters** sections; Static and Pump
  head added to the Critical Path grid; and **the DISCLAIMER**, which the
  plumbing sheet did not carry at all. **CSV:** a plumbing file exported the
  hydronic columns with a "System: Open loop" header — it now exports the
  plumbing sheet, same columns, same order. **Print:** the printed plan now
  carries the FU pipe label the canvas draws. 15 new assertions (suite 2173).
  Verified live on 20260818-lowrise and 20260817-PLBG; hydronic sheet unchanged
  (7 sections, 14 columns, 9 warnings); the 14-column plumbing table still fits
  A4 portrait. Human-Test **DW.S**.

* **v0.17.14** — **The Calculation sheet printed past the page margins in
  portrait** (Michael, 2026-08-18). Every sheet cell is `white-space: nowrap`,
  which is right on screen — the pane scrolls sideways — and wrong on paper,
  where there is nowhere to scroll to. Measured at the old print size: the
  plumbing critical-path table needs **945px** and the hydronic one **1059px**,
  against the **703px** between A4 portrait's 12mm margins, so it ran 356px off
  the right edge. `@media print` now lets the HEADINGS and the TEXT cells (the
  section, the tag, the fitting list) wrap, tightens the cell padding to 3×5px
  and drops 9.5pt → 9pt; **numeric cells stay `nowrap`**, so no figure is ever
  split across lines. Table rows also no longer break across a page boundary.
  Verified by replaying the real @media print rules in a 703px box: every table
  on both the plumbing and the hydronic sheet sits at exactly 703px with zero
  overflow anywhere in the pane (the 14-column hydronic one included), and the
  on-screen sheet is untouched at 13px/nowrap. Human-Test **DW.R**.

* **v0.17.13** — **Info-panel Tag drew only when another Display switch was on**
  (Michael, 2026-08-18). A plumbing outflow's Tag defaults ON, and a default-ON
  flag is stored in `obj.show` only when it is switched OFF — so a fresh outflow
  had an empty `show` and `View.drawDeviceBox` early-returned on
  `Object.keys(flags).length === 0` before it reached the tag. Ticking any other
  switch put a key in `show` and the tag appeared alongside it. The defaults now
  live in the model (`M.displayDefaults` / `M.displayShown`), the renderer's
  cheap guard asks for them too, and both properties panels take their `def`
  from the same place instead of hard-coding `true`. 10 new assertions (suite
  2158). Verified live on 20260818-lowrise: every plumbing outflow on the active
  level draws its tag with nothing stored in `show`; a leftover *generic*
  outflow correctly does not; switching Tag off (single or multi-select) removes
  it and switching it back on returns the model to sparse. No console errors.

* **v0.17.12** — Michael's 2026-08-18 plumbing test-run list. **General:** IPC
  demand/604.3 data marked **verified** (all three tables signed off); **>1
  selected outflows** now edit common properties + Display switches together
  (`renderBulkProps`). **Display:** outflows gain **Tag (Info Panel)** (default
  ON), **Design flow** shows the *design* (undiversified) flow not the solved
  one, Temperature dropped, wording follows hydronic; the **1.00 L/s** node-glyph
  placeholder is gone for plumbing outflows; **Thermal** read-outs dropped from a
  plumbing pipe in Simulate. **HYDRAULIC:** the fixtures table reordered to
  Fixture | Occupancy/Supply | Fixture Units (FU) | Design Flow | Design Pressure
  | Table 604.3 Type. **CALCULATION:** a *Demand Curve Type* line under the
  metadata; the pipe columns now follow hydronic (ID/L/L eff/PD·m/Section PD/
  Static) with **Downstream FU** before Flow; **All Pipes (Design)** + **Critical
  Path (Design)** are labelled as such and a new **Critical Path (Simulation)**
  section is added — resolving the design-vs-actual pressure confusion (lowrise:
  307.3 kPa design vs 149.7 kPa simulation at the index fixture). Verified live on
  20260818-lowrise.json; no console errors.
* **v0.17.11** — Merge the 604.3 mapping into ONE table (Michael, 2026-08-18:
  "map it to 604.3 … merge into a single table"). The plumbing HYDRAULIC tab now
  has a single per-fixture table — Fixture / Occupancy / **Fixture units** /
  **Type (604.3)** / **Design flow** / **Design pressure** — all editable per
  fixture-variation; the separate raw-604.3 outlets table and the standalone
  mapping table are gone. Design flow/pressure default from the 604.3 mapping and
  a per-fixture edit (`m.settings.plumbing.design`) overrides it; ESTIMATED rows
  (not in 604.3) show in **red** with the footnote. `M.plumbingSpecDefault`
  exposes the pre-override mapped value. 3 new assertions (suite 2148). Verified
  live: one merged table, WC/urinal/estimate values correct, red inputs render,
  editing design flow persists, no console errors.
* **v0.17.9** — Remap plumbing default flow & pressure per Michael's 604.3
  spreadsheet (2026-08-17). Each fixture/variation's default design flow &
  pressure now follows an explicit **604.3 mapping** (`FD.plumbing.defaultSpec`,
  resolved by `M.plumbingFixtureDefault`): direct outlet maps for most, and
  computed ESTIMATES for the ones 604.3 does not list — bathroom group (largest 2
  of lavatory+shower+WC), kitchen sink & shower public (FU-ratio × the private
  outlet), washing machine (lavatory / service-sink flow @ 100 kPa). WC remapped
  (priv-tank→flushometer tank, priv/pub-valve→blow-out, pub-tank→close-coupled);
  urinal (both)→urinal valve; **Dishwashing machine added** (→ dishwasher
  residential, 2.75 gpm, no cold FU). Estimates resolve LIVE against the editable
  604.3 values. A new **"Fixture design flow & pressure"** table on the HYDRAULIC
  tab lists every mapping, estimated rows in **red** with the footnote *"Items in
  red were not in IPC Table 604.3, and are estimated based on similar plumbing
  fixtures."* 22 new assertions (suite 2145). Verified live (all 22 rows match
  the spreadsheet, estimates red, booster still solves), no console errors.
  **Confirm the estimates and the WC/urinal outlet choices.**
* **v0.17.8** — Plumbing outflow flow, panel labels, fixture tags (Michael,
  2026-08-17). (1) The outflow's **design flow** on the drawing was stuck at the
  1.00 L/s placeholder — it now shows the **undiversified 604.3 flow** in DESIGN,
  and the **K-terminal solved flow** in SIMULATE. (2) SIMULATE now models each
  fixture as a pressure-dependent **K-terminal** (design point = undiversified
  604.3 flow @ 604.3 pressure), exactly like a hydronic terminal, instead of a
  fixed demand — so fixtures draw more where pressure is ample and less where it
  is short. (3) Properties ▸ Design renamed: Cold fixture units → **Fixture Units
  (Cold)**, Supply outlet (604.3) → **Type**, Undiversified flow → **Design
  Flow**, Required pressure → **Design Pressure**. (4) A placed plumbing outflow's
  **auto-tag follows the fixture** — WC-1, UR-1, HB-1, BG/BA/BT/DF/KS/SS/SH/WM,
  Custom→OF; changing the fixture/type re-tags an auto-default (never a hand-named
  one). Lavatory renamed **Lavatory/Hand Basin**. 14 new assertions (suite 2123).
  Verified live on the booster file (design 0.76 L/s urinal, simulate 0.194 vs
  0.189 K-solved, tags UR-1/WC-1/HB-1), no console errors.
* **v0.17.7** — Standardise plumbing presentation on the hydronic baseline
  (Michael, 2026-08-17). The plumbing CALCULATION sheet is now the same shape as
  hydronic: a project-metadata sheet-head, **collapsible sections** (`<details>`),
  and the index run renamed **Critical Path** (was "Most unfavourable path") with
  its sections flagged in All Pipes and an index-grid summary (Sections / total
  friction / available / required / margin). The pipe-properties **Domestic
  water** read-out now uses the same `readoutBox` styling as hydronic **Thermal**.
  Also fixed on the way: the plumbing residual/Critical-Path now accounts for a
  BOOSTER PUMP — `plumbingReport`'s forward pass adds the pump's design head (a
  booster plumbing system has no pressurised source), so `20260817-PLBG.json`
  shows a real +55.7 kPa margin instead of nothing. No new assertions (suite
  2109); verified live on the booster file and a hydronic regression, no console
  errors.
* **v0.17.5** — Michael's 2026-08-17 batch. **General:** (1) pasting a single
  outflow onto an existing (pipe-end) node now applies the device there — the
  drop stamped a junction and dropped the device before. (2) The dedicated
  "Copy/Paste properties" buttons are gone; Ctrl+C/Ctrl+V is now the one
  context-sensitive path — copy a single object, select a same-kind target, paste
  = properties only; nothing selected = place normally. Extended to NODE devices
  (source/outflow), not just in-line devices. **Annotation:** (3) in the Trace
  tool Ctrl+V no longer hijacks a previously-copied pipe fragment — it is left for
  the background-image paste. (4) Set Scale shows a crosshair cursor while
  picking, back to the move cursor after. **Design ▸ Outflow:** (5) the 604.3
  supply outlet is now BAKED into the fixture/variation (shown read-only), not a
  second thing to pick; the values stay editable on HYDRAULIC. (6) in a plumbing
  file a new outflow defaults to a Plumbing (water-closet) fixture. (7) the
  OUTFLOW tool has a pre-placement TEMPLATE panel (fixture/variation/count) so a
  run of the same fixture can be laid down without editing each — place 5
  urinals, switch to lavatory, place 2, etc. 8 new assertions (suite 2109).
  Verified live end-to-end; no console errors.
* **v0.17.4** — Domestic Water: outflow FU display + booster-no-flow fix (Michael,
  2026-08-17). (1) An outflow now has a **Fixture units** option in
  Design ▸ Properties ▸ Display (plumbing only) — a value box "FU 2.2" drawn at
  the node, the fixture's own cold FU. (2) **Fix: a sized plumbing file reported
  "pump has no flow" in SIMULATE** (`debug/20260817-PLBG.json`) because its
  fixtures had no 604.3 supply outlet set, so every undiversified flow was zero.
  A fixture now has a DEFAULT supply outlet (`FD.plumbing.supplyDefault`, e.g. WC
  private flush-tank → "Water closet, tank, close coupled" 3 gpm/20 psi), resolved
  by `M.plumbingSupplyId` when `dev.supply` is unset — so a sized model simulates
  without a supply set on every fixture by hand, and the pump gets flow (verified:
  6 WC → 1.136 L/s). The default is a convenience the user sees ("— default" in
  the selector) and overrides. Case frozen as `test/fixtures/plumbing-booster.pnet.json`.
  6 new assertions (suite 2105).
* **v0.17.3** — Domestic Water: **downstream fixture units as a pipe-label
  option** (Michael, 2026-08-16). A new `annotate.pipeFU` flag draws the pipe's
  downstream cold FU on the drawing (e.g. "22.0FU/40⌀/5.00m/1.28L/s"); the toggle
  ("Fixture units") appears in the DISPLAY TAGS panel **only in a plumbing file**,
  and the label reads the sizing pass (`res.byPipe`). No fixture units exist in a
  hydronic model, so it does nothing there. Verified live (label on/off, toggle
  plumbing-only, no console errors).
* **v0.17.2** — Domestic Water: Table 604.3, plumbing SIMULATE, most-unfavourable
  path (Michael's list, 2026-08-16). (1) **IPC Table 604.3** transcribed to metric
  (`FD.plumbing.supplies`, verified:false) — the undiversified per-fixture flow +
  required pressure. It is a different taxonomy from E103.3(2), so each plumbing
  outflow gets a SEPARATE "Supply outlet (604.3)" selection (`dev.supply`) rather
  than an invented mapping; editable on the HYDRAULIC tab like the other tables.
  (2) **SIMULATE now pushes water through a plumbing file** — `buildPlumbingSimModel`
  converts each fixture to a fixed demand at its undiversified 604.3 flow and runs
  the unmodified GGA (fixed-demand/design mode); DESIGN stays fixture-unit sizing.
  Flow arrows and pressures render on the canvas. (3) The plumbing CALCULATION
  sheet gained a **Most unfavourable path** section (index run to the least-margin
  fixture; residual vs 604.3 required pressure), like the hydronic critical path.
  (4) `verified.fixtures` = true (E103.3(2) signed off). (5) Explanations removed
  from the plumbing Calculation sheet. (6) SHOW ▸ Temperature hidden in plumbing.
  22 new assertions (suite 2096). Verified live: SIMULATE pushes 30 gpm through,
  arrows draw, most-unfavourable path shows margin, 604.3 table edits, no console
  errors. **Simulate semantics** (undiversified fixed flow) and the 604.3
  transcription are `Human-Test.md` §5DW for Michael's confirmation.
* **v0.17.1** — Domestic Water: the plumbing "solve", and Michael's review list
  (2026-08-16). (1) `FD.network.plumbingReport` gives a plumbing file signed
  per-pipe FLOW (so the canvas draws direction arrows), per-pipe FRICTION drop,
  and a forward RESIDUAL-pressure pass down the tree — built from
  `M.plumbingSizing` + a geometry-only `build()`, still never the GGA solver; the
  CALCULATION sheet gains Friction-drop and Residual columns. (2)
  `FD.plumbing.verified` is now per table `{ fixtures:true, demand:false }` —
  Michael verified E103.3(2). (3) Explanatory hints + the unverified banner
  removed from the plumbing HYDRAULIC tab. (4) SHOW ▸ Temperature hidden in
  plumbing. (5) **Pasting a fragment onto a pipe now tees in** (was: sat on top,
  connected to nothing) — fixes hydronic too. 17 new assertions (suite 2084).
  Verified live: flow/friction/residual computed, arrows would draw, tee-on-drop
  splits the pipe, tables edit, hydronic unaffected, no console errors. Visual
  items (arrow appearance, paste snap) in `Human-Test.md` §5DW. **Left:** a
  per-pipe diversity readout drawn on the canvas.
* **v0.17.0** — Domestic Water Phase B: the plumbing HYDRAULIC tab, editable IPC
  tables, and the fixture-unit sizing sheet (Michael's brief, 2026-08-16). The
  plumbing **Design ribbon drops the thermal tools** (heat source/sink, heat
  exchanger). The **HYDRAULIC tab stays** in plumbing (only THERMAL is hidden
  now) and hosts the demand-system selector plus two **editable** IPC tables —
  the fixture load values E103.3(2) and the FU→flow demand curves E103.3(3),
  shown and edited in the model's flow unit (metric). Edits are per-model
  overrides on `m.settings.plumbing.fu` / `.demand`, resolved by
  `M.plumbingFixtureFU` / `M.plumbingDemandCurve` / `M.plumbingFuToFlow`, which
  the sizer now uses — so a **pipe's flow interpolates off the edited curve**;
  both round-trip through save/load, each table has a "Reset to IPC defaults".
  The plumbing **CALCULATION sheet** (`renderPlumbingCalc`) sizes every pipe:
  Section / Size / Bore / Downstream FU / (Generic) / Design flow / Velocity,
  mains first, velocity over the limit in red, with the tree-sizing errors shown
  rather than guessed. data still `verified:false` (now correctable in-app). 15
  new assertions (suite 2067). Verified live: flows and velocity flags correct
  on a heavy-load tree, editing an FU or demand cell reshapes the sizing, the
  hydronic side unaffected. Remaining: a per-pipe canvas readout, and Phase C
  (residual pressure).
* **v0.16.33** — Domestic Water Phase A: the discipline scaffold. A file is now
  one DISCIPLINE — `m.discipline` = `'hydronic'` (default) | `'plumbing'`,
  carried through `create`/`toJSON`/`fromJSON` (legacy/unknown → hydronic). The
  loop-type chip `#system-chip` is repurposed as the discipline switch: it reads
  HYDRONIC / PLUMBING and clicking it toggles, with a `FD.dialog.confirm`
  warning ("Changing an existing model between Hydronic and Plumbing may break
  it.") on a non-empty model. The network tab is relabelled per discipline and
  THERMAL + HYDRAULIC are hidden in plumbing. The solve is gated so a plumbing
  file NEVER invokes the GGA (`solveModel`/`solveModelGen` off the code path,
  verified live at 0 calls); the plumbing CALCULATION pane says "under
  construction" for now. The in-Design plumbing UI from v0.16.31–32 (outflow
  type + fixture/Variation in `renderNodeProps`, the pipe-panel DW readout, and
  the HYDRAULIC "Plumbing supply" selector) is hidden unless the discipline is
  plumbing; the data and `M.plumbingSizing` stay for Phase B. 4 new assertions
  (suite 2052). Verified live in the browser (logic + wiring; the chip/tab
  appearance is Michael's to eyeball). See `docs/DW-MODULE.md` → Architecture v2,
  Phase A.
* **v0.16.32** — Domestic Water: fixture variations + the sizing core. The
  fixture list is now the full IPC 2018 Table E103.3(2), and each outflow has a
  **Variation** dropdown below Fixture (Private / Public × flush tank / flush
  valve etc.), each carrying its own cold FU; `M.outflowFU` reads the variation,
  not the model-wide system. `M.plumbingSizing(m)` is the pure DW sizer: on the
  tree rooted at the source it accumulates downstream cold FU + generic flow per
  pipe and sizes `Generic + fuToFlow(FU)` (sub-additive), rejecting a loop / no
  source / multiple sources (`DW_LOOP`, `DW_NO_SOURCE`, `DW_MULTI_SOURCE`) rather
  than guessing. The PIPE panel shows Downstream FU, Diversity flow and velocity
  at design for a DW branch, or the error. Data still `verified:false`. 15 new
  assertions (suite 2048). Folding the diversity flow into the main solve/sheet
  and the forward pressure pass remain — see DW.MOD. Verified live (logic).
* **v0.16.31** — Domestic Water module, Phase 1 (data + model + UI; no solver
  yet). A Plumbing outflow type sits inside the outflow DESIGN panel: choose a
  fixture (10 from IPC 2018 Table E103.3(2), cold column) and a count, or Custom
  with a typed FU, and the panel reads back the cold fixture units. A "Plumbing
  supply" selector on the HYDRAULIC tab picks the demand curve (flush tank /
  flushometer valve, Table E103.3(3)). New `data/plumbing.js` carries the
  transcribed tables **`verified: false`** (glycol treatment) pending Michael's
  sign-off — the FU→demand diversity curve, sub-additive, is why a DW branch
  legitimately does not balance. New `model.outflowFU()` and `plumbing.test.js`
  (39 assertions). The tree accumulation + diversity SOLVER is Phase 2. Verified
  live. See `docs/DW-MODULE.md`.
* **v0.16.30** — context-aware paste for devices (CP.CTX). Ctrl+V of a single
  copied device, with a device of the SAME kind selected, stamps its properties
  onto that device (never its tag); nothing selected — or a different-kind
  target, or the copied device itself — places a new object as before. Verified
  live.
* **v0.16.29** — Source/Outflow panel presented like a pump or exchanger
  (SO.PANEL): Details / Design / Actual / Display sections, and a new "Actual
  flow" display tag (Qa) on the node. Verified live.
* **v0.16.28** — a batch of contained UI items (Michael, 2026-08-12). The TOOLS
  and MESSAGES windows are now RESIZABLE (drag the corner) and RECOVER when
  off-screen: shrinking the browser used to strand them past the edge with no
  way back; now reopening drops the window on the right side if its last spot is
  off-screen. LEVELS is collapsible (click the header; state kept in
  localStorage; adding a level re-expands). TRACE cleanup: "Set scale from a
  known distance" → "Set Scale", the Drawing-width box and all the explanatory
  hints removed, and Set-Scale's second point now snaps to 15° (Shift/Alt frees,
  with a live preview). Verified live. Deferred to the week: context-aware
  copy/paste (CP.CTX), the Source/Outflow panel rework (SO.PANEL), and the DW
  module (DW.MOD, approach under discussion).
* **v0.16.27** — status-chip follow-ups (Michael, 2026-08-12). Dismissed
  warnings no longer count on the chip (dismissing one updates the count live).
  The warnings chip is now GREY rather than orange — warnings are soft and
  dismissable; errors (red) and defects (amber) still catch the eye. Clicking
  the chip now toggles the MESSAGES window open/closed, like the TOOLS button.
  Verified live: 2 warnings → dismiss → 1; grey colour; toggle.
* **v0.16.26** — three from Michael, 2026-08-12. (1) Turning info-panel / "Show
  on drawing" tags on or off no longer re-solves — it saves and redraws like the
  Tag-visible switch beside it (presentation, not geometry). (2) User-facing
  "sweep" is now "iteration" (progress bar, Settling-iterations field, control
  messages); the internal rename is logged as SW.2. (3) CONTROL_HUNTING now
  reports a metric — "N of M controlled devices holding setpoint (X%)" — so an
  engineer can accept, say, 90% while the design is in flux and raise Settling
  iterations to finish it later, rather than a flat "still moving". Carries
  `holding`/`total`/`pct` fields. Verified live.
* **v0.16.25** — the status chip opens a MESSAGES window (Michael, 2026-08-12).
  A moveable window like TOOLS with two lists, **Active** and **Dismissed**,
  showing every error, defect, warning and notice ordered by severity. Clicking
  a message goes to the pipe/node it names (switches floor, centres, selects) —
  the old "highlight every affected pipe at once" is deprecated. Each warning and
  notice carries a **Dismiss** button that moves it to Dismissed; errors and
  defects cannot be dismissed (they read "must fix"). Dismissal is by signature
  (code + where), so it survives a re-solve; session-only. Verified live:
  dismiss/restore, per-item navigation, errors locked, persistence across
  re-solve, chip opens/closes it. **Still open from this round: the MESSAGES.md
  reference reformat (Code/Message/Issue) and trimming verbose messages.**
* **v0.16.24** — two UI items (Michael, 2026-08-10). (1) The CALCULATION sheet
  now REMEMBERS which sections you collapsed: it was rebuilt on every switch to
  the tab, resetting every section, so collapsing All Pipes to read Critical
  Path only lasted until you looked away. `app.calcCollapsed` keeps the
  open/closed state by section title for the session; Thermal and the Appendix
  still start collapsed until you change them. (2) The tool INSTRUCTION under the
  ribbon now always sits on its own line below the buttons — it used to trail to
  the right when short and wrap below when long, so the same prompt appeared in
  two places. New wording for the two equipment prompts, per Michael. Verified
  live.
* **v0.16.23** — coil part-load sync discoverability (Michael reported TR.5 as
  "no option to sync coil part loads"). Could not reproduce a real fault: on
  `20260809-DC.json` a coil's Control section shows **Sync part load % with**
  offering the 13 other AHUs, in DESIGN and SIMULATION alike (verified live).
  The field only vanished when a coil was the ONLY heat exchanger in the model —
  nothing to sync to. That case now shows the row DISABLED with "Place a second
  heat exchanger to sync this one to it", so the option is no longer invisible.
  (If it persists with two or more coils it is a stale cache — hard-refresh.)
* **v0.16.22** — the riser notation box is draggable in Annotation (Michael,
  2026-08-10). Grabbing the callout box in the MOVE tool moves it; the leader is
  redrawn from the circle on the pipework to the box every frame, so it stays
  attached, and the circle itself does not move. The offset is per level (each
  floor places its own callout clear of that floor's pipework) and in screen
  pixels, so it holds through zoom; it snaps to the grid, frees with Shift/Alt,
  saves without solving, and persists through save/load. Verified live by
  dispatching pointer events. **The look is Michael's to judge.**
* **v0.16.21** — detail lines and their nodes are moveable in Annotation
  (Michael, 2026-08-10). In the MOVE tool: grabbing a detail VERTEX moves it on
  its own — with any vertex exactly coincident, so a shared corner or a closed
  box's doubled point stays joined; grabbing a detail LINE moves the whole
  CONNECTED detail (every line sharing a corner), so a box moves as one whether
  drawn as one closed polyline or as separate lines meeting at their ends. Notes
  became draggable at the same time (the `dragNote` stub was never wired). All
  snap to the grid, free with Shift/Alt, and save without solving (`arranged`).
  Verified live by driving real pointer events: node-drag, whole-polyline drag,
  and a two-line L moving together, no console errors. **The on-screen feel is
  still Michael's to judge.**
* **v0.16.20** — Michael's second list of 2026-08-10. (1) The CONVERT tool's
  input boxes were browser-default white in the dark panel — now styled to match
  `.field input` (UI.1, his clarified item). (2) The Thermal insulation TABLE is
  now EDITABLE per nominal size (`thermal.insulation`, keyed by size so it is
  schedule-independent), on top of the global default and the per-pipe override.
  (3) DETAIL boxes (notes and detail lines) are now copy-pasteable — Ctrl+C/V
  carries an annotation-only fragment that follows the pointer by its own corner
  and pastes as a drawing change (no solve). Verified live: Convert boxes dark,
  table edits persist, annotation copy/paste extracts-renders-rotates-inserts
  with no error. New model.test.js and thermal.test.js coverage. Human-Test
  settled sections archived to `Human-Test-Archive.md`.
* **v0.16.19** — two from Michael's list of 2026-08-10. (1) The CHECK VALVE is
  now an arrowhead pointing the way flow is allowed with a seat bar across its
  tip — the standard non-return symbol, replacing the swing flapper. (2)
  INSULATION is decoupled from the pipe schedule: thickness is a single global
  default in Thermal (50 mm, `thermal.insulation_mm`), overridden per pipe
  (including 0 for bare). The old "25 mm below DN50, 50 mm above" schedule rule
  and its per-size editor are gone; a schedule is now its published dimensions
  only. Old files re-solve on the 50 mm default (sub-DN50 pipes shift 25→50);
  the two known-good files still converge. Both are visual/behavioural and
  await Michael's eye. **The check-valve appearance cannot be verified here —
  screenshots render nothing to pixels.**
* **v0.16.18** — the number of settling sweeps is now the user's to set
  (`control.sweeps`, a field in Thermal ▸ Setpoint control, default 6). A first
  pass keeps the six it always did; a final answer can ask for 10+ and wait. The
  auto solve budget scales with the sweep count so the extra sweeps are actually
  taken, not capped out by a ceiling meant for six; an explicit Max control
  solves still overrides. Default behaviour is unchanged (6 sweeps, identical
  solves). New `thermal.test.js` section.
* **v0.16.17** — the network solve is now cross-checked against an INDEPENDENT
  algorithm (`test/crosscheck.test.js`, a ninth suite). Hardy Cross — loop-flow
  corrections, no shared code with the GGA below the pipe law — re-solves looped
  networks and agrees with FreePipeCalc's flows to 1e-10 across a two-loop grid,
  a three-loop ladder and a rewired grid (Hazen-Williams). It isolates the flow
  DISTRIBUTION, which was never independently checked, from the single-pipe law,
  which Michael validated. First real dent in the biggest gap (HANDOVER §7);
  what remains external-unchecked is thermal, control, the single-pipe law vs a
  published table, and a real job with known answers.
* **v0.16.16** — S4 closed: the survivors re-settle behind a device parked at
  full. Parking a lost device at full moves the plant, and the other
  controllers had settled against the plant *before* that move — so their final
  positions described a plant that no longer existed (on `economizer-trim` with
  ACCH-1 undersized, the coils sat 14% over their rated flow and PMP-01 ended
  30 kPa off its differential). The control loop now settles the survivors again
  against the plant the parked devices hold, re-parking anything that itself
  finishes lost, bounded and terminating because the lost set only grows.
  Parking is still judged only between converged sweep-sets, never mid-sweep.
  New `thermal.test.js` section; the fix is provably inert when nothing is lost.
* **v0.16.15** — riser notation to Michael's own drawing convention: a circle,
  a leader and a box carrying a chevron for the flow direction and a bar across
  whichever end the column terminates at.
* **v0.16.14** — Michael's testing round: half-grid device snapping, sensor
  tags by mode, Part Load and its sync, a Hydraulic tool that sizes on a
  friction gradient, Enter to calculate, tee-on-drop, paste Tab/R, Alt as the
  one "let me" modifier, and the cross-floor link-node bug (mine). S1 closed:
  risers report per segment.
* **v0.16.13** — copy and paste (Ctrl+C / Ctrl+V) built on two pure-model
  functions; a Find tab; copy-level offers a new floor above and follows the
  floor numbering. Fixed on the way: a floor copy was silently losing every
  sensor and every control link, and nothing reported duplicate tags.
* **v0.16.12** — Michael's small-things round: panel wording, Tag Visible into
  DISPLAY and onto pipes and fittings, the DETAIL tool's snap and Delete, a
  Link nodes ribbon group with ADD/REMOVE and a preview, prompts moved to the
  top of the work area, and the TOOLS window gains a two-way CONVERT tab.
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
