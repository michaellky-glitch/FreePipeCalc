# Known issues

Small, non-urgent defects and follow-ups that are logged rather than fixed
immediately, so they are not rediscovered from scratch. Each entry says what it
is, why it is deferred, and where the fix would go.

---

## Open

### `actualDelivery` diverges in SIMULATION when a terminal is short

`src/network.js` — the pressure-driven second pass returns flows of order
**1e10 m³/s** and pressures of order **1e27 Pa** on a simulation model whose
terminal cannot be met. Reproduced on master at 30672e5, so this is not new in
v0.11.1: source at 0 gauge, pump curve `singlePoint(8.8, 0.0108)`, an equipment
link and 4 m of DN100 to a demand node asking 20 L/s at 200 kPa.

The pass pins each deficient terminal at the pressure it *requires* and reads
the net inflow. In SIMULATION that terminal is already represented by a virtual
`__out_` link, so pinning the host node fights the virtual link instead of
replacing it, and the solver runs away down an unbounded branch. In DESIGN
there is no virtual link and the same code behaves.

It surfaces as the bracketed "actual" figures beside the demand-driven answer,
which is a display path — the primary numbers are unaffected. **Setpoint
control (§17C) makes it much easier to hit**, because a controlled pump
routinely reduces flow until a terminal is short. Fix would be in
`actualDelivery`: in SIMULATION the terminal is already pressure-driven, so the
whole second pass is redundant there and should return `null` rather than
re-deriving it.

### The `testrun-*.js` walkthroughs OVERWRITE files in `examples/`

`test/testrun-3floor.js` and `test/testrun-datacentre.js` regenerate the
`.pnet.json` they walk through (`ARCHITECTURE.md` §15 says so, but it is easy to
miss). They write today's *defaults*, so running one as a smoke check silently
rewrote `3-floor-riser-test.pnet.json` and `datacentre-ring.pnet.json`, dropping
`pumpSafetyPct` from 10 to 0 — which broke the "Selection duty applies the
margin on top" assertion in `supply.test.js`, because that margin comes from the
example file. Caught and reverted 2026-07-31.

**So:** they are generators, not tests. Do not run them as a "does it still
work" check, and `git diff examples/` before committing if you have. Worth
making them write to a scratch path, or take an explicit `--write` flag.

### `quadWarnings` has no guard for a zero design flow

`data/pumps.js` — `quadWarnings(qc, qDesign)` divides by `qDesign`
(`100 * rising / qDesign`) and clamps a range to `qDesign * 1.5`. If `qDesign`
is `0` the percentages come out as `Infinity`/`NaN`.

In practice the TOOLS ▸ Generic Pump Curve caller only passes a positive design
flow, so it does not surface today. Deferred by decision (2026-07-30): log now,
add a one-line guard at the top of `quadWarnings` if a zero ever reaches it.

### Printed plans draw devices as plain pipe, with no symbol

`src/printer.js` strokes every pipe at full bore width (line ~126) and never
draws a pump, valve or equipment symbol. On a printed level plan an in-line
device is therefore indistinguishable from a short piece of pipe.

This was always true, but it is now *inconsistent* with the canvas, which draws
devices as point symbols on a thin connector (2026-07-30). The fix is to mirror
that in the SVG: a thin connector for the device link plus a symbol at the
midpoint. Deferred because printing has never been checked on real paper
(`Human-Test.md` §5.5), so the print path is better reviewed in one pass than
piecemeal.

---

## Resolved

### Datacentre parallel-pump test values regenerated — 2026-07-30

`test/simulation.test.js` hard-coded the total flow and pump heads of
`data_centre_redundant_ring_main.pnet (fixed).json`. The model was rebuilt by
hand into a coherent 20 L/s single-equipment circuit, so the old 45 L/s
expectations failed. The baseline was regenerated from the final model
(total 0.020 m³/s; heads 268.5 / 257.6 / 253.3 / 249.6 kPa for 1–4 running
pumps) and all assertions pass again. Not an independent check — a
regression lock, as the originals were.

---

## Logged for reference (not defects)

### Pipe-schedule K-table cells not cleanly transcribed

Two cells in `data/ktable.js` are flagged in-file as not cleanly transcribed
from the source table. All L/D and K values are user-editable on the HYDRAULIC
tab, so this is a data-provenance caveat, not a code fault. Left as-is by
decision (2026-07-30): far from shipping, revisit when the fitting data is
sourced properly.

### Follow-ups raised by Michael's testing (2026-07-31)

From the ⚠️/❌ notes in `Human-Test.md`:

* **Undo is intermittent** (8.1). Sometimes one press removes a device, sometimes
  two. The pre-edit-snapshot fix helped but did not fully settle it. Low priority
  by decision, but it is a correctness bug in the history, not cosmetics.
* **Negative node pressure should render red** (8.19).
* ~~**Pressure visualiser should gradient along a pipe**~~ (8.20). Done
  v0.7.7-dev. A plain pipe ramps between its two node colours; a pump, valve or
  piece of equipment gets a hard step at the symbol instead, because a device
  puts its whole pressure change at one point and a ramp there would be a lie.
* **Riser marker** should sit at lower-left (225°) of its node, with an arrow
  showing flow direction up or down (7.1).
* **Riser from node to pipe does not connect** (7.2); mid-pipe to node works.
  This is a real snapping defect.
* **Light theme is grey outside the drawing area** (4.9).

### Reported 2026-08-02 — all done

* ~~Pump properties restructure~~ (v0.7.6-dev).
* ~~Outflow in SIMULATE~~ (v0.7.6-dev). The `Q = K·√P` identity is proven in
  `simulation.test.js`; see `HANDOVER.md` §2A.
* ~~Checkboxes become toggles~~ (v0.7.7-dev). Every one in the panels, the
  annotations list and the HYDRAULIC tab. Option switches are muted-vs-accent
  rather than red-vs-green: red means a fault everywhere else here, and an
  unticked label is not one.
* ~~Pressure gradient along a pipe~~ (v0.7.7-dev), above.
* ~~K factor on outflows, pumps and equipment~~ (v0.7.7-dev), from the design
  values, quoted in the model's own display units with the unit written out.
  Michael chose that over the sprinkler convention (L/min per √bar) and over Kv.
* ~~"% of design flow" and "Balance to design Kv" off the SIMULATE outflow
  panel~~ (v0.7.7-dev). Both are still on the calculation sheet, which is where
  a set of terminals can be read against each other.

### The thermal module (v0.10.0) — what is flagged

* **Propylene glycol properties are UNVERIFIED** (`data/fluids.js`). Written
  from recollection of ASHRAE Ch 31 at Michael's instruction, flagged until he
  checks them. Cp scales every thermal duty linearly, so check that first.
* ~~Insulation thicknesses~~ — moved onto the pipe schedule in v0.10.1 with
  Michael's own rule as the default (25 mm below DN50, 50 mm from DN50 up). His
  decision, so no longer flagged. A pipe's own value still wins, including 0.
* **The outside surface coefficient (8 W/m²·K) is a default**, not sourced data.
  On an insulated pipe it is a small part of the resistance; on a **bare** pipe
  it is the whole of it, so a bare-pipe answer is only as good as that number.
* **Fluid properties are held at ONE temperature.** Nothing recalculates density
  or viscosity from the solved temperature, so a glycol circuit run at 6 °C is
  being given 20 °C properties — glycol viscosity roughly doubles over that
  range. This is also why the thermal result cannot feed back into the
  hydraulics: the coupling does not exist yet.
* **Pumps and valves add no heat.** Michael's instruction. A pump's shaft work
  is real but is hundredths of a kelvin at typical duties.
* **The plausibility band defaults to ±50 °C**, which suits chilled water and
  **trips on any LTHW system** — the test suite demonstrates this at 80 °C flow.
  Adjustable on THERMAL, and it has to be set per service.
* **The Critical Radius tool takes temperatures that do not enter r_cr = k/h.**
  Michael asked for ambient and fluid temperature as inputs; they are used for
  the heat loss and the surface temperature instead, and the tool says so. If
  what is wanted is the CONDENSATION-CONTROL thickness, that is a different
  calculation needing the room's humidity, which the app does not hold.
* **The effectiveness model for equipment in SIMULATION is not implemented.**
  The two modes shipped (`dT`, `dQ`) are its asymptotes and bracket it. Adding
  it needs one field: the secondary-side entering temperature.

### Reported 2026-08-02 (seventh round) — done, released as v0.9.0

* ~~**Only two calculation methods**~~: `Hazen-Williams (ASHRAE with Equivalent
  Lengths)` and `Darcy-Weisbach (BETA)`. The fitting basis follows the method.
* ~~Clamp DN15 and DN20 to DN25~~ — confirmed, and now asserted.
* ~~Rename to `Tee (Branch)` and `Tee (Straight)`~~.
* ~~Bullhead = the same equivalent length as `Tee (Branch)`~~ — it already was,
  because a bullhead charges both legs as branches; now asserted so it stays
  that way.
* ~~Trim the HYDRAULIC copy~~ on both tables to what Michael asked to keep.

**One thing to be aware of.** The K source line now reads "ASHRAE Handbook —
Fundamentals, Pipe Sizing, Table 1 (threaded) and Table 2", which is the wording
Michael asked for. The values in the app are transcribed from the page he
supplied, which is headed **Ch 22 Tables 3 and 4** (p.22.6), and every cell is
asserted against that page in `engine.test.js`. The citation and the provenance
notes therefore disagree about the table numbers. Left as asked; worth a word
before anything is issued.

### Reported 2026-08-02 (sixth round) — done, v0.8.2

* ~~**Hazen-Williams equivalent length becomes NFPA 13 (2019) Table
  27.2.3.1.1**~~, editable, with a Reset button and the source named beneath.
  Metric stored, IP by conversion only.

* ~~**The straight-through tee row**~~ — supplied by Michael from the **Carrier
  Design Handbook** and wired in at v0.8.3, since NFPA 13 has no such row. It is
  the one row on the NFPA page from a different source, so it carries an
  asterisk, a note above the source line, and a line in the calculation-sheet
  appendix.
* ~~**Three tables to choose from**~~ (v0.8.4): Carrier Design Handbook Table 11
  (default), NFPA 13, and Custom. Published sets are read-only; Custom unlocks
  them and seeds from whatever was showing.

**OPEN, and waiting on Michael:**

* ~~**Sizes below DN25**~~ — **CONFIRMED by Michael 2026-08-02**: clamp DN15 and
  DN20 to the DN25 figure. It is the conservative direction and there is a test
  asserting it for both published sets, so it cannot drift back.
* **An imperial display cannot reproduce the page's feet column.** The stored
  value is the printed METRIC one, and the two columns are the source's own
  independent roundings of each other (13 ft is printed as 4 m). So a model set
  to feet shows 1.969 ft where the page says 2. Correct by the metric-first
  rule, and surprising if you are checking against the page in feet.

### Reported 2026-08-02 (fifth round) — done, v0.8.1

* ~~**Darcy-Weisbach must charge fittings by the ASHRAE K method**~~, and the
  HYDRAULIC tab must show the K table in place of the equivalent-length table.
  Both done: `methods.DW.fittingMode` is now `'K'`, which drives the
  calculation and the table shown from one place.
* Found while doing it, all fixed in the same change:
  * The **method dropdown was hand-written** with HW and DW only, while the
    default is ASHRAE — so it displayed the wrong method on a new model and
    could not get back to ASHRAE. Built from the registry now.
  * **Fitting PD on the drawing was wrong under any K method**, the default
    included. It scaled the pipe's loss by `EL/_Leff`, and under K `_Leff`
    carries no fitting allowance. Now K·V²/2g directly, and it matches a hand
    calculation to the last decimal.

**Still open, by Michael's note:** the equivalent-length table itself needs
revisiting. It is now Hazen-Williams only, and `FD.fittings.unsourced()` is
empty, but the L/D basis has never had the same page-by-page check the K tables
just had.

### Reported 2026-08-02 (fourth round) — done, released as v0.8.0

* ~~HYDRAULIC formula rendering~~. `.formula-eq` was `display: flex`, which
  makes every child a flex item — and `vertical-align` does nothing to a flex
  item, so exponents sat on the baseline and fractions ignored their own
  alignment. Back to inline layout.
* ~~SIMULATE: the drawing showed a pump's DESIGN head~~. The properties panel
  was right and the drawing was not. It now reads the curve at the solved flow,
  in SIMULATION only — in DESIGN the solver runs on `pump.head` even when a
  curve exists, so reading the curve there would report a head the calculation
  did not use.
* ~~Darcy-Weisbach~~ implemented as BETA with Swamee-Jain, validated against an
  independent iteration of Colebrook. See `HANDOVER.md` §2.
* ~~TOOLS button renames and one-row layout~~. NFPA 20 / Generic / Copy / ⓘ on
  a single row, so Copy no longer sits below a sixteen-row table.

### Reported 2026-08-02 (third round) — done

* ~~**Symmetrical ring splits 51/49**~~ (`debug/20260802-2.json`). Not noise —
  the run/branch pick had two geometrically identical candidates at the supply
  tee and broke the tie on the pipe's ID string, so one leg got K = 0.9 and the
  other K = 1.1. Fixed v0.7.10-dev by recognising the bullhead case: where the
  two charged legs are collinear with each other, nothing passes straight
  through and neither is a run. See `ARCHITECTURE.md` §7.
* ~~Source: remove the static-pressure explanation~~ (v0.7.10-dev).
* ~~VIEW: remove the "Values switched on here appear in a box…" hint~~ and
  ~~the equipment square-law hint~~ (v0.7.10-dev).
* ~~"Show on drawing" box is separately movable~~ (v0.7.10-dev). It has its own
  `boxOffset` and its own drag handle; it shared the entity's `labelOffset`
  before, so dragging a tag took the values with it.

### Reported 2026-08-02 (second round) — done

* ~~**Disallow vertically sloped pipes.**~~ v0.7.8-dev. Everything in the layout
  runs level; only a riser changes height. `M.pipeLength` returns the plan
  distance for any non-riser pipe and `M.pipeRise` reports the difference;
  `SLOPED_PIPE` is an error. Michael's reasoning is worth keeping: even once
  pipe gradients are modelled in v2 or v3, the length an engineer takes off a
  layout is the horizontal one. This also retired the `plan = √(L² − rise²)`
  solve added to `changeLength` the day before — with the rule in place, plan
  and drawn length are the same number and the direct comparison is correct
  again.
* ~~**PROBE command under VIEW.**~~ v0.7.8-dev. Pressure, flow and velocity at
  any point along a pipe. Pressure is the one that varies and is a straight line
  between the node values (level pipe, constant flow, uniform bore ⟹ constant
  loss per metre); a pump, valve or piece of equipment reports both sides and
  the change across instead, because a device puts its whole change at one
  point.

### Two defects found in `debug/20260802-1.json`, both fixed v0.7.7-dev

Worth keeping because they are a good illustration of one wrong decision
producing two unrelated-looking symptoms.

* **A source's static pressure was stored as the node's elevation** (`dz`).
  Hydraulically that gave the right downstream answers — a tank 20.43 m up does
  provide 200 kPa — but `dz` is a real elevation and `pipeLength` is a 3D
  distance, so typing 200 kPa silently stretched a 50 m run to 54.01 m. It is
  now `device.pressure`, in pascals, and old files are migrated on load with a
  dialog saying what changed, because the migration moves pipe lengths.
* **`changeLength` compared a requested 3D length against a PLAN length.** So
  typing 50 back into that 54.01 m pipe reported "already 50, nothing to do" —
  `ok:true` with an empty change list — and the field sprang back. It now solves
  `plan = √(L² − rise²)`, and refuses with `SHORTER_THAN_RISE` when the
  requested length is below the pipe's own rise. This one was independent of the
  first: any genuinely sloped pipe had it.
