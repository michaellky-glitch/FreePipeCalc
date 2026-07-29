# FreePipeCalc — architecture

A guide for anyone picking this codebase up: a programmer, or another LLM
session with no memory of how it got here. It covers what the pieces are, how
data moves between them, and — more importantly — **why** several things are
the way they are, because a number of the decisions look arbitrary until you
know which bug caused them.

Companion documents:

* `ENGINE.md` — the hydraulics maths, with hand-checkable worked examples.
* `piping-friction-loss-spec.md` — the original specification, plus §12 which
  logs every deviation from it and the reason.

---

## 1. What this is

A single-page application for Building Services Engineers. You draw a
multi-level water piping network, and it solves flow distribution, friction
losses and pump duty, then produces a node-to-node calculation sheet and
printable level plans.

It is deliberately **not** a web app. It is a folder of files you open by
double-clicking `index.html`. No server, no install, no build step, no network
access, no CDN.

---

## 2. Three constraints that shape everything

### 2.1 It must run from `file://`

This is the constraint with the widest blast radius.

Browsers apply CORS to ES module loading and treat a `file://` origin as
opaque, so `<script type="module">` fails outright when the folder is opened by
double-clicking. There is no workaround that also keeps "no build step".

**Therefore:** every source file is a classic script wrapped in an IIFE that
attaches to one global namespace, `FD`. Load order is fixed in `index.html` and
mirrored in `test/harness.js`. There are no imports anywhere. If you add a file,
add it to both places.

Anything that fetches — web fonts, CDN libraries, `import()` — is out.

### 2.2 SI internally, always

All model state and all computation is metric: metres, m³/s, pascals, and
metres of head. Imperial is a **formatting concern only** and lives exclusively
in `src/units.js`. Nothing in the solver may call it.

One sharp edge: head is in metres **of the working fluid**, so converting head
to pressure needs that fluid's density. `FD.units.headToPa()` assumes water at
998 kg/m³ and exists for display maths where fluid is not in scope. Anything
reporting a **result** must use `headToPaWith(h, rho)`. Getting this wrong is
silent — a glycol model quietly reports water numbers. It was wrong once
already (spec Q12 notes).

### 2.3 The friction method is swappable

The solver only ever asks a link for a resistance `r` and an exponent `n` such
that `h = r·|Q|^(n−1)·Q`. That is the whole interface. Hazen-Williams and
Darcy-Weisbach both satisfy it, and a third method would too.

---

## 3. Module map

Load order matters; this is it.

| File | Responsibility |
|---|---|
| `data/schedules.js` | Pipe schedules → inner diameters. Sizing helpers. |
| `data/fittings.js` | Fitting equivalent lengths (L/D basis) and K-based losses. |
| `data/valves.js` | Valve Kv/Cv data, opening curves, resistance. |
| `data/ktable.js` | ASHRAE fitting resistance coefficients K, by nominal size. |
| `src/units.js` | SI ↔ display conversion, number parsing. **Display only.** |
| `src/hydraulics.js` | Pipe loss models: Hazen-Williams, Darcy, friction factors. |
| `src/solver.js` | The Global Gradient Algorithm. Knows nothing about drawings. |
| `src/model.js` | Model state: levels, nodes, pipes, risers, devices, save/load. |
| `src/geometry.js` | Rigid length edits, conflict detection, repair. UI-free. |
| `src/network.js` | **Model → solver translation.** The busiest file. |
| `src/dialog.js` | In-app modal dialogs (no browser popups). |
| `src/canvas.js` | Drawing surface: rendering + pointer interaction. |
| `src/printer.js` | Printed level plans as SVG. |
| `src/app.js` | Shell: toolbar, panels, calculation sheet, settings, persistence. |

The dependency direction is strictly downward in that table. `solver.js` does
not know what a riser is. `model.js` does not know what a pixel is.
`network.js` is where drawn geometry becomes hydraulics, which is why it holds
most of the interesting logic.

---

## 4. Data flow

```
   user draws on canvas
            │
            ▼
   FD.model            ← the single source of truth, all SI
            │
            ▼
   FD.network.solveModel(m)
            │
            ├─ build(m, prev)          model → abstract network
            │    ├─ riser links materialised
            │    ├─ fittings inferred from geometry
            │    ├─ closed-circuit datum pinned if needed
            │    └─ link resistances computed
            │
            ├─ FD.solver.solve(net)    GGA → heads and flows
            │
            ├─ repeat 2–5 times        fittings and check valves depend on
            │                          flow direction, which is an OUTPUT
            │
            ├─ autoSizePumps()         pumps in 'auto' mode
            ├─ flowRegimeWarnings()    velocity, PD/m, laminar
            ├─ supplyWarnings()        dead pumps, insufficient supply
            └─ actualDelivery()        pressure-driven pass, only if short
                        │
                        ▼
              results object
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
     canvas rendering        calculation sheet / CSV / print
```

### The results object

```js
{
  ok, converged, iterations, passes,
  head: {nodeId: m}, pressure: {nodeId: Pa}, flow: {linkId: m³/s},
  errors: [...], warnings: [{code, message, ...}],
  network: {nodes, links, rho},   // links carry cached _L, _el, _Leff, _d, _types
  actual: null | {flow, pressure, totalDelivered, totalDemanded, unmet},
  pumpSizing: {resolved, iterations, stalled, mode}
}
```

---

## 5. The solver

Global Gradient Algorithm (Todini–Pilati), the method EPANET uses. Unknowns
are head at each junction and flow in each link. Full derivation in
`ENGINE.md` §3.

Two things about it are worth knowing here.

**Head is total head**, so elevation is handled implicitly and static lift
falls out of the solution. Gauge pressure at a node is `ρ·g·(H − z)`.

**There are three convergence criteria, not two.** The spec named two: head
change and nodal imbalance. Those are insufficient, because a flow circulating
around a closed loop satisfies continuity *exactly* at every node and perturbs
*no* head — so both criteria pass while the loop flow is still numerical
residue from the seed. A third criterion tests that flows have stopped moving.
Without it, a no-demand ring reports a phantom circulation.

---

## 6. Why the solve runs several times

Three separate things depend on the answer in order to compute the answer:

1. **Tee run/branch equivalent length** — which legs form the "run" depends on
   which way the water goes.
2. **Check valve seating** — a check valve blocks reverse flow, and reverse is
   only knowable after solving.
3. **Pump auto-sizing** — duty depends on the losses at the resulting flow.

So `solveModel` loops: solve, rebuild with what it learned, solve again, until
the fitting assignment and valve states stop changing (typically 3 passes, cap
5). A fingerprint of the assignment plus flow signs detects the fixed point.

Two traps here, both hit in real testing:

* **Check valves must seat on HEAD, not flow.** Testing flow oscillates
  forever: shut it because flow was negative, next pass reports ~zero flow,
  which is not negative, so it reopens, reverses, shuts again. The adverse head
  difference is still present while the valve is shut, so it is a stable
  fixed point.

* **Tee run/branch ties must break on GEOMETRY.** A riser feeding identical
  floors splits *exactly* in half, so "the pair carrying the through-flow" is a
  coin flip between two equal numbers — and it self-oscillates, because the
  pick sets the equivalent length, which nudges the flows, which flips the pick
  back. Near-ties (within 2%) are resolved by taking the straightest in→out
  pair, which cannot depend on flow. This also happens to be physically right:
  at a riser tee the vertical run is the run and the floor take-off is the
  branch.

---

## 7. Fittings are never placed by hand

They are inferred from the angles between pipes at each node: two pipes at a
corner give an elbow, three give a tee, four or more raise a warning and are
modelled as two tee branches. Equivalent length is charged to the **downstream**
pipe.

Under Darcy the same fittings are charged as velocity heads (`h = K·V²/2g`)
using ASHRAE K tables instead.

**The K lookup is keyed on NOMINAL size, not bore.** These are different
numbers and confusing them is a real hazard: HDPE "110 mm" is an *outside*
diameter with a 90 mm bore, so keying on bore lands two rows off in the table.
`FD.schedules.nominalMm()` extracts the designation; the bore is used only for
velocity.

All L/D values and all K values are user-editable on the HYDRAULIC tab, because
jurisdictions differ and the built-ins are a starting point, not an authority.
Two K cells are flagged in `data/ktable.js` as not cleanly transcribed — read
that comment before trusting them.

---

## 7A. Modes: EDIT, DRAW PIPE, LAYOUT

The canvas has three modes, plus a set of placement tools.

* **EDIT** — select, drag nodes, change properties.
* **DRAW PIPE** — click-to-click routing.
* **LAYOUT** — arrange the drawing for print. Every annotation is draggable,
  and device properties can be echoed beside their entity in a box.

LAYOUT exists because auto-placed labels collide with pipework on anything
busy, and on a printed drawing that is the difference between readable and not.
Label offsets are stored in **screen pixels**, not metres, so a label stays the
same distance from its owner at every zoom — which is what "tidy" means on a
drawing and what carries to print.

Display flags (`obj.show`) are only offered in LAYOUT. Off by default: a drawing
carrying every value is unreadable.

**There is no CALCULATE button.** Every edit already triggers a debounced solve,
so the button forced something that was going to happen 250 ms later anyway, and
switching tabs took the user away from the drawing. The CALCULATION tab renders
from the latest solve whenever it is opened.

### Draw snapping priority: node > pipe > grid

Node and pipe are resolved on the angle-constrained point, so connecting always
beats preserving the bearing.

The grid comes third, and it **cannot** be applied as an absolute position. Doing
so rounds the angle-constrained point onto the nearest intersection and throws
the bearing away — a "horizontal" run drawn at 15° lands centimetres off, and
later runs never meet it, so tees stop forming. That was a real bug.

So the grid constrains the **length along the ray** instead. The bearing is
preserved exactly and lengths still come out in tidy grid multiples, which is
what the grid is for while drawing. Verified: ragged clicks produce bearings on
exact 15° multiples *and* lengths on exact grid multiples.

## 8. Levels, risers and geometry editing

Node coordinates are **level-local metres**. Each level carries an `(dx, dy)`
offset applied only at render and hit-test time. This is what makes floor
alignment free: changing an offset moves a whole floor in world space without
touching a single coordinate or length. That invariant is asserted in the tests.

A **riser column** is a fixed world XY anchor with attachments on several
levels; the vertical links between consecutive attachments are generated, with
length equal to the altitude difference.

### Editing a length

Changing a pipe's length must never change any *other* pipe's length, so the far
side translates rigidly (`src/geometry.js`). Three outcomes:

* **Rigid move works.** Everything on the far side, across all levels, shifts by
  the same delta. A riser column whose attachments are *all* in the moving set
  travels with it — this is what lets a change upstream of a riser carry every
  floor above it along.
* **Riser torn.** A column with only *some* attachments in the moving set would
  be pulled in two. Refused.
* **Loop.** The far side is tied back to the near side, so no rigid translation
  exists. This surfaces as a geometry conflict dialog offering Cancel, Delete
  pipe, or Repair.

**Repair is a heuristic, not a constraint solver.** It cuts the loop at the
member most parallel to the edited pipe and translates the far side; for a
rectangle, editing the top edge stretches the bottom to match. It reports every
length it changed, and it refuses (leaving the model untouched) when no single
cut works — which is what happens in a ladder of parallel loops such as a pump
hall. Treat the change list as the deliverable, not the operation.

---

## 9. Devices

| Device | Model | Notes |
|---|---|---|
| Source | Node | Fixed-head reservoir at its own altitude, 0 gauge. |
| Demand | Node | Fixed outflow, plus a required pressure. Can be excluded. |
| Pump | In-line link | Modes `auto`, `fixed`, `off`. |
| Valve | In-line link | Gate/check, Kv/Cv, 0/25/50/75/100% open. |
| Equipment | In-line link | Rated flow and ΔP; `ΔP = ΔP_rated·(Q/Q_rated)²`. |

In-line devices are inserted by **splitting** a pipe into three: pipe, device,
pipe. The device gets its own inlet and outlet nodes and the runs either side
keep their own lengths and sizes.

Pumps, valves and equipment carry a `tag` — the plant reference an engineer
works from — shown on the drawing, in the calculation sheet and in the CSV.

### An OFF pump is isolated, not an open pipe

Modelled as zero head, an idle pump is a *frictionless bypass*. In a parallel
pump set the running pump then short-circuits backwards through its idle
neighbours: the data-centre test pushed **392 L/s** round the pump hall to
deliver 21 L/s to the load. `off` is therefore modelled as blocked, which is
what a standby pump behind a closed isolating or check valve actually is.

---

## 10. Open vs closed systems

An **open** system has a source: a tank, city mains, anything inexhaustible.
That source is the fixed head the solver needs.

A **closed** system — a chilled-water circuit, for instance — is sealed and has
no reservoir. With no fixed head anywhere the component is indeterminate, and
the solver's island rule ("no fixed head, no demand → Q = 0, valid") quietly
returns **zero flow for a live pumped circuit**.

So a pumped component with no fixed head gets one node pinned as a temporary
pressure datum, preferring a pump suction (where a real expansion vessel
connects). Continuity forces zero net flow through a single pinned node in a
closed loop, so it is a datum and nothing more. This is reported as the
`NO_SOURCE` hydraulic error telling the engineer to provide a tank, mains or
expansion vessel — the calculation still runs so the numbers can be seen, but
absolute pressures are relative to that point until a real source is placed.

---

## 11. Pump sizing

Pumps in `auto` mode re-size on **every solve**, so the duty tracks the model
instead of going stale. Measured cost is 1.3–2.6 ms per solve; it is free.

Two sizing targets:

* **Open system** — size until the worst demand meets its required pressure.
* **Closed circuit** — there are no demand nodes, so the *equipment's rated
  flow* is the design flow. Size until the equipment gets it, iterating
  `H ← H × (q_target/q_actual)^1.9` (the circuit is near-quadratic).

Safeguards, both earned the hard way:

* Sizing converges from **either** side. Only ever adding head meant a model
  saved with an oversized pump kept it forever, which is not what "auto" means.
  Demands are fixed flows, so lowering the head lowers every pressure by the
  same amount and one step lands it.
* Pumps that can never pass flow are skipped. The test is **topological** (is
  either end a dead end?), not "does it carry flow right now" — a pump starting
  at zero head carries no flow precisely because it has not been sized yet, and
  a flow-based test meant a closed circuit could never bootstrap off zero.
* If a round of added head fails to improve the shortfall, the useless head is
  rolled back and sizing stops. Otherwise a disconnected pump winds itself up
  to a fictitious duty and stamps it on the saved model.

### The safety factor never enters the solve

It is applied to the **pump head only**, and only as a reported selection duty.
It defaults to 0.

This matters. In an open system a margin inside the solve is harmless — demands
are fixed flows, so it shows as surplus pressure. In a **closed** circuit the
equipment is a *resistance*, not a fixed flow, so extra head becomes extra
flow: a 10% margin pushed 21 L/s through equipment rated for 20, and the
reported ΔP rose to 220 kPa purely from the square law on the excess.

The calculation therefore runs at design conditions and the margin is quoted
separately as "select against". Extra head on a fixed-speed pump raises flow
rather than sitting spare; real systems are brought back with regulating
valves. Reporting the margin instead of simulating it also stops it compounding
with the margins already sitting in the C factor, fitting allowances and
equipment ratings.

---

## 11A. The critical path

The hydraulically most unfavourable route — supply to the worst-off terminal.
Spec §10 calls it the *index circuit*; the UI says **critical path**, which is
the term Michael uses. It sets the pump duty, so it goes at the top of the
calculation sheet: `res.critical` carries it, and the sheet orders those rows
first and tints them.

It works for every kind of supply — gravity-only open loops (no pump at all),
multiple sources, pumped open loops, and closed circuits.

Two things about the definition are easy to get wrong.

**"Worst off" means the smallest residual, not the greatest distance.** A long
run in large pipe is frequently better off than a short run in small pipe.
Sizing against distance is a classic way to undersize a pump.

**The path runs back to a fixed-head node, not to the nearest pump.** Stopping
at the pump suction leaves the suction-side friction out of the tally, and then
friction + static no longer reconciles with the pump duty — on the 3-floor test
model it came out 38.94 m against a 41.76 m pump, exactly the 2.82 m of pipe
upstream. The pump is a link along the path contributing a head gain, not a
terminus.

The trace steps to the neighbour at **higher head**, which is where the water
came from. That follows the real hydraulic route through loops and rings rather
than guessing at a topological shortest path.

In a closed circuit there are no demands, so the equipment with the largest
pressure drop stands in as the index terminal.

## 11B. Open or closed is detected, not asked

A system fed by a fixed-head source is **open**. A sealed circuit driven round
by a pump with no such source is **closed** — its pressure reference comes from
a fill/expansion vessel, which is exactly the `NO_SOURCE` case the solver
already pins a datum for. Neither is **no supply**.

`FD.network.detectSystemType(m)` returns the type and a plain-English reason.
The result is shown on the PIPING NETWORK ribbon and updates live as the
drawing changes, because the useful moment to learn you have drawn a closed
circuit is while drawing it, not on a tab you might not open.

It is written back onto `settings.systemType` so the saved model, the CSV and
the sheet header all agree with the chip. The field is now a *record of what was
detected* rather than a question the user answers.

This is informational only: the solver carries total head, so static lift falls
out of the solution either way and nothing downstream branches on it.

## 12. Demand-driven vs pressure-driven

The main solve is **demand-driven**: every demand takes its stated flow, and an
under-supplied network shows that as negative pressure. That is the right
number for sizing — the negative value *is* how much head is missing.

It is not, however, what physically happens: water cannot be drawn from a node
with no pressure to give. So when any demand is short, a second
**pressure-driven** pass runs. Each unsatisfiable demand is converted from a
fixed flow to a fixed head at its required pressure and the network re-solved;
the flow that then arrives is what the system can really supply. Demands that
turn out to be satisfiable are handed back, and the two sets iterate until
stable. Back-flow is clamped — a terminal that would have to push water into
the network delivers nothing.

Both numbers are reported, because they answer different questions: the
demand-driven pressure in the table, the achievable flow in brackets beside the
nominal one. When everything is satisfiable the second pass does not run at all
and `res.actual` is `null`.

---

## 13. Warnings vs errors

Detection lives in the **engine**, not in the renderer. It was in the renderer
once, which meant `solveModel()` reported "no warnings" for a network running
at 12 m/s — fine on screen, silently wrong for every other consumer. The UI
only reformats warnings into display units.

Codes worth knowing:

| Code | Meaning |
|---|---|
| `VELOCITY`, `PDM` | Threshold breaches. Carry value and limit. |
| `LAMINAR`, `TRANSITIONAL` | Flow regime. Laminar means Hazen-Williams is the *wrong equation*, not merely imprecise. |
| `NO_SOURCE` | No source anywhere; a temporary datum was pinned. Hydraulic error. |
| `SUPPLY_INSUFFICIENT` | Demands cannot be met. Hydraulic error; source turns red on the drawing. |
| `PUMP_DEAD_END`, `PUMP_NO_FLOW` | Pump doing nothing. Hydraulic error. |
| `VALVE_SHUT`, `CHECK_CLOSED` | Valve state. |
| `CROSS` | 4+ pipes at a node. |
| `ISLAND_NO_SOURCE` | Disconnected section carrying demand. |
| `FITTING_OSCILLATION` | Two-pass loop did not settle. Should be rare. |

Hydraulic errors take the status chip to themselves in red, because every
number on the sheet is conditional on them.

---

## 14. File format

Native format is JSON with a `.pnet.json` extension, chosen for portability:
plain text, human-readable, parseable by anything. It embeds everything —
settings, custom schedules, levels and offsets, nodes, pipes, riser columns,
devices — and carries a `formatVersion` so old files stay loadable.

`fromJSON` **merges** settings over defaults rather than replacing them, so a
file written by an older build picks up settings added since without becoming
invalid. Loading a file from a *newer* format is refused with an explanation.

EPANET `.inp` export is a future item; it cannot be the native format because
it cannot store levels, offsets, riser columns or per-floor drawing
coordinates.

---

## 14A. The HYDRAULIC tab

Everything that defines *how* the calculation is done, in the order an engineer
reaches for it:

1. **Fluid Properties** — name, density, viscosity, temperature, Cp.
2. **System** — open or closed loop.
3. **Hydraulic Parameters** — calculation method and its coefficients.
4. **Pipe schedules**, **fitting data**, **warning thresholds**.

The formula is rendered two-dimensionally — a real fraction with a rule line —
with the coefficients as **inputs inside the formula itself**. Editing
`10.67` in place is the same gesture as reading it. A single-line
`a / (b · c)` is something an engineer has to decode rather than read.

Only the fitting table the active method actually uses is shown: equivalent
lengths under Hazen-Williams, K coefficients under Darcy-Weisbach. Showing both
invites entering numbers into the one being ignored.

## 15. Testing

Five suites, ~440 assertions, no dependencies:

```
node test/engine.test.js     schedules, fittings, units, hydraulics, solver
node test/model.test.js      model, levels, network building, annotations
node test/geometry.test.js   rigid edits, conflicts, repair
node test/supply.test.js     pump sizing, supply adequacy, pressure-driven
node test/closed.test.js     closed circuits, off pumps, equipment, tags
```

`test/harness.js` is a Node shim that evaluates the same browser sources, in
the same order, against a fabricated `window`. There is no separate build of
the code for testing.

Alongside them are walk-through scripts that print a full worked model rather
than asserting:

```
node test/testrun-3floor.js             3-floor riser + ring main
node test/testrun-irrational.js         under-supplied system
node test/testrun-datacentre.js         closed circuit, redundant pumps
node test/testrun-datacentre-battery.js geometry stress, valves, 2nd pump
```

They write their models to `examples/`, which the app can load directly.

**Two conventions worth keeping.** Expected values are independent hand
calculations, not numbers copied back out of the code — several bugs were found
precisely because a hand calculation disagreed. And when a test fails, work out
which side is wrong before touching either; roughly half the failures in this
codebase's history were the *test* being wrong, and fixing the code to match a
bad test would have been worse than useless.

---

## 16. Known limitations

* **Darcy-Weisbach is experimental** and the friction-factor correlation has
  not been settled. All four are implemented and selectable; the spread across
  realistic cases is ≤1.4%, so the choice matters far less than the ε-vs-C
  equivalence between methods.
* **Repair cannot fix every geometry.** It refuses rather than guessing.
* **Temperature and specific heat are stored but not implemented.** Temperature
  does not drive density or viscosity, which are entered independently. Cp is
  present for the heating/cooling power work coming next (`Q = ṁ·Cp·ΔT`), as is
  the per-pipe `temperature` field — a section carrying flow and a ΔT is what
  gives a duty.
* **No balancing valve sizing**, no pump curves, no EPANET export, no
  Copy Up/Down, no custom schedule editor UI. See spec §13.
* **Index circuit is not highlighted** in the calculation sheet yet.

---

## 16A. Copying a level

`M.copyLevel(m, from, to)` duplicates everything drawn on one level onto
another at the same level-local coordinates, and extends any riser column
touching the source floor so the stack stays connected rather than arriving as
an island.

**Everything** comes across, sources included. Suppressing the source was tried
and rejected: forgetting to delete a duplicated source is ordinary user error
with an easy workflow around it (copy the lowest floor, delete the source on the
copy, copy upward from there), whereas silently dropping part of the layout is
the worse surprise.

## 16B. Custom pipe schedules

A schedule is a name, a default C factor, and a list of `{label, id_mm}`. The
label and the bore are the two governing fields (spec §9); everything hydraulic
derives from the bore.

Custom schedules are stored **twice on purpose**: in `localStorage`, so they
follow the engineer across projects, and embedded in every saved `.pnet.json`,
so a model file stays usable on a machine that has never seen the schedule.

They are sorted smallest-first on save, because size stepping during DRAW walks
the list in order and `sizeForFlow` assumes ascending bore.

Deleting one that is in use falls its pipes back to the default schedule, which
changes their bore and therefore the calculation — so the confirmation says so.

## 16C. The DOCUMENTATION tab

`src/docs.js` renders the project's own markdown inside the app, so the
reasoning behind the calculations travels with the tool.

The markdown renderer is small and hand-rolled on purpose. A library would mean
a build step or a CDN, and §2.1 rules out both. It covers exactly what these
documents use — headings, paragraphs, lists, tables, fenced and indented code,
blockquotes, rules, inline emphasis/code/links — and is not a general parser.

**It cannot work over `file://`.** A local origin is opaque, so `fetch` of a
sibling file is blocked by the same rule that rules out ES modules. That is not
a bug to fix; the tab detects it and says so, pointing at the files on disk.
Serving the folder over HTTP makes it work.

## 17. If you are changing something

* Adding a source file? Add it to `index.html` **and** `test/harness.js`.
* Reporting a pressure derived from a head? Use `headToPaWith(h, rho)`.
* Adding a warning? Detect it in the engine, format it in the UI.
* Touching the two-pass loop? Anything flow-direction-dependent must have a
  tie-break that does not itself depend on flow, or it will oscillate.
* Changing pump sizing? The safety factor must stay out of the solve.
* Read `piping-friction-loss-spec.md` §12 first. Every entry there is a
  deviation from the written spec with the reason it was necessary; several
  look like bugs until you read why.
