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
attaches to one global namespace, `FD`. Load order is fixed in `index.html`.
There are no imports anywhere. If you add a file, add it to `index.html`; and if
the engine tests need it, add it to the load list too — `test/harness.js` always
loads the data + engine layer (`schedules`→`solver`), and each test file appends
the higher-level modules it exercises via `load([...])` (e.g. `model.js`,
`network.js`). The pure-UI files (`canvas`, `app`, `dialog`, `printer`, `trace`,
`tools`, `docs`) are not loaded by any test and need no harness entry.

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

The solver asks a link for a resistance `r` and an exponent `n` such that
`h = r·|Q|^(n−1)·Q`. Hazen-Williams and Darcy-Weisbach both satisfy it.

A link may also carry an **optional second term** `rK` at exponent 2, because
the ASHRAE method pairs Hazen-Williams pipe friction (n = 1.852) with
velocity-head fitting losses (n = 2) and the two cannot be folded into one
resistance. Both terms are monotonic in |Q| and share the sign convention, so
the sum is still a strictly increasing loss curve and the Newton step is
unaffected.

**Anything reconstructing a loss from a link must call
`FD.hydraulics.linkLoss(link, q)`.** Reading `link.r` alone silently omits the
fitting term — the number still looks like a pressure drop, it is just too
small. That is exactly how it was caught: the energy-balance and critical-path
reconciliations stopped adding up.

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
| `data/pumps.js` | Pump curves: single-point, three-point quadratic, least-squares fit, parsing. |
| `src/hydraulics.js` | Pipe loss models: Hazen-Williams, Darcy, friction factors. |
| `src/solver.js` | The Global Gradient Algorithm. Knows nothing about drawings. |
| `src/model.js` | Model state: levels, nodes, pipes, risers, devices, save/load. |
| `src/geometry.js` | Rigid length edits, conflict detection, repair. UI-free. |
| `src/network.js` | **Model → solver translation.** The busiest file. |
| `src/dialog.js` | In-app modal dialogs (no browser popups). |
| `src/canvas.js` | Drawing surface: rendering + pointer interaction. |
| `src/printer.js` | Printed level plans as SVG. |
| `src/tools.js` | TOOLS tab: standalone calculators. Reads no model state. |
| `src/docs.js` | DOCUMENTATION tab: renders these files in the app. |
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

### A bullhead tee has no run

Found by Michael on 2026-08-02 (`debug/20260802-2.json`): a perfectly
symmetrical ring split **51.0/49.0**, and it was not noise.

Both legs leave the supply tee at exactly 90°, so `pickRunPair` had two
geometrically identical candidates and fell through to its last-resort
tie-break — **the pipe's ID string**. `P18P1` sorts before `P18P5`, so the north
leg became the run (K = 0.9) and the south leg the branch (K = 1.1): a 22%
resistance difference decided by an identifier. Lengths agreed to 1e-12; the
whole 1.88% came from the tee.

The real fault is deeper than the tie-break. At that junction the two ring legs
are **collinear with each other** — the straight run of the physical fitting is
between *them*, and the supply joins it at right angles. Nothing passes straight
through from the supply, so calling either leg a "run" asserts something untrue.

So `isBullhead()` tests exactly that: when the two charged legs are collinear
with one another (within 2°), neither is a run and both are charged as
branches. That is a change of **which tabulated coefficient applies**, not a new
number — both streams genuinely turn out of the common leg, which is what the
branch coefficient describes — and it is the conservative reading of the two,
which matters for a figure that sizes a pump. The test is pure geometry, so it
cannot oscillate with the flow, which is the same requirement §6 imposes on the
run/branch tie-break itself.

Ordinary cases are untouched: at a riser tee the two charged legs are the riser
onward and the floor take-off (90° apart), and at a plain branch tee they are
the through leg and the take-off (also 90° apart). Only legs in line with one
another are caught.

The hand-checkable statement is **symmetry itself** — two legs identical in
length, size, C and fittings must carry identical flow whatever the
coefficients are — and `model.test.js` asserts it to 1e-8, along with the
drawing-order independence that the original bug failed.

### Equivalent length is NFPA 13, not an L/D ratio

Hazen-Williams charged fittings on an L/D basis — `EL = (L/D) × bore`, with flat
ratios from the spec — until 2026-08-02. It is now **NFPA 13 (2019) Table
27.2.3.1.1**, supplied by Michael: an equivalent length in **metres against
nominal size**, read straight off the page. Nothing is multiplied by a bore.

Three consequences worth knowing:

* **The lookup key changed from bore to designation.** Under a ratio the bore
  was the *correct* key, because the answer was a multiple of it. Under a table
  keyed on the size designation it is not — HDPE "110 mm" is an outside
  diameter with a 90 mm bore, so keying on bore lands two rows off and reads 15%
  low. Both `el()` and `ktable.k()` now take nominal.
* **The metric column is stored**, not the feet column, because the model is
  metric and imperial is a display conversion (§2.2). The two are the source's
  own independent roundings of each other — 13 ft is printed as 4 m — so an
  imperial display will *not* reproduce the page's feet numbers, and cannot.
* **The straight-through tee row is BLANK**, pending values from Michael. NFPA
  13 tabulates only "flow turned 90°". It is left blank rather than assumed to
  be zero or carried over from the old ratio, so it currently charges nothing —
  and the HYDRAULIC tab, the calculation-sheet appendix and a test all say so
  rather than leaving it to be noticed.

What is deliberately *not* in the app's copy of the table: the 90° long-turn
elbow, butterfly valve, gate valve, vane-type flow switch and swing check rows,
and the ½ in and ¾ in columns. Valves are modelled by flow coefficient
(`data/valves.js`), not equivalent length, and the app's table starts at 25 mm
at Michael's instruction — so a pipe below DN25 clamps to the DN25 figure, which
overstates it. The steel schedules do go down to DN15, so that is worth
revisiting.

**How fittings are charged depends on the method.** Under **ASHRAE (2021)** —
the default — and under **Darcy-Weisbach** they are velocity heads,
`h = K·V²/2g`, from the Ch 22 K tables (Eq 7), carried as a *separate quadratic
term* on the link. Only **Hazen-Williams** charges equivalent length, folded
into the pipe's own resistance.

Darcy moved to K on 2026-08-02 at Michael's instruction, and it is the
consistent choice: Darcy-Weisbach is itself a velocity-head equation, so
charging its fittings by an L/D allowance borrowed from a Hazen-Williams basis
mixed two formulations for no reason. Because Darcy's pipe exponent is also 2,
the K term *could* be folded into the pipe resistance there; it is kept separate
anyway so there is one code path for K fittings and the sheet can report pipe
and fittings apart. `r·Q² + rK·Q² = (r + rK)·Q²` either way.

Note that until 2026-07-31 the K tables were **dead data**: this document
claimed Darcy charged velocity heads, but `headlossK` was never called and both
methods used equivalent length. The ASHRAE method is what finally wires the K
tables into the calculation.

**The K lookup is keyed on NOMINAL size, not bore.** These are different
numbers and confusing them is a real hazard: HDPE "110 mm" is an *outside*
diameter with a 90 mm bore, so keying on bore lands two rows off in the table.
`FD.schedules.nominalMm()` extracts the designation; the bore is used only for
velocity.

All L/D values and all K values are user-editable on the HYDRAULIC tab, because
jurisdictions differ and the built-ins are a starting point, not an authority.

**Every K value is now checked against the printed page.** Michael supplied
ASHRAE p.22.6 on 2026-08-02; both tables are transcribed a second time into
`engine.test.js`, independently of `data/ktable.js`, and all 144 tabulated
values match. That closed the last open question on the threaded 45° elbow
column — it really is nearly flat with size (0.38 → 0.28), unlike the flanged
column, and is not a transcription slip.

---

## 7A. Modes: EDIT, DRAW PIPE, VIEW

The canvas has three modes, plus a set of placement tools.

* **DESIGN / SIMULATE** — the two calculation modes (internally the same
  `edit` tool); select, drag nodes, change properties. Both offer every drawing
  tool. **SHOW DISCONNECT is gone**: disconnections always draw a ⚠️. Multi-selecting offers
  size / schedule / C across the whole selection.
* **DRAW PIPE** — click-to-click routing. Typing digits mid-run and pressing
  Enter draws exactly that length along the current preview bearing: the
  bearing stays a mouse gesture (with its 15° snapping) and only the magnitude
  is typed.
* **VIEW** — arrange the drawing for print. Every annotation is draggable,
  and device properties can be echoed beside their entity in a box. (VIEW was
  called LAYOUT until v0.6.0-dev.) VIEW carries **TRACE** (arranging the
  background you draw over), **ALIGN**, and **ANNOTATIONS**.

**PROBE** (v0.7.8-dev) reads pressure, flow and velocity at any *point* along a
run rather than only at the nodes — the sheet gives node values, and the
question in front of an engineer is often "what is the pressure at the tee I
have not drawn yet". Hover follows the pointer, a click pins the reading so the
mouse can come off the drawing, Esc clears it.

Pressure between two nodes is a **straight line**, and that is the real profile
rather than a convenience: both ends are at the same elevation by the rule
above, so there is no static term varying along the run, and the flow and bore
are constant along a pipe, so friction loss per metre is constant. The one
caveat: fittings are charged as lumped equivalent length spread over the whole
pipe, so where a real fitting sits there is a small step the line averages out.
The node values are exact either way. **This lives here, not in the app** — the
explanation was in the properties panel and was removed as clutter
(Michael, 2026-08-02); flow and velocity likewise dropped the "(whole pipe)"
note beside each reading.

A **device** is where interpolating would be a lie — a pump, valve or piece of
equipment puts its entire pressure change at one point — so probing one reports
both sides and the change across it, and no value along it. This is the same
distinction the PRESSURE visualiser makes between a ramp and a step.

The ribbon has ONE tool section that swaps both its contents and its label with
the mode: the placement tools under `DRAW` in EDIT, the drawing-arrangement
tools under `VIEW` in VIEW. They are alternatives, not companions.

**ALIGN** drags the whole model by one node, snapping the grabbed point to the
grid — for putting a known node back on grid after the drawing has drifted. It
moves every level's `(dx, dy)` **offset**, never a coordinate, so by
construction no geometry, length or fitting can change (§8).

**Dragging a node onto another joins them** (`M.mergeNodes`), and a node left as
a plain joint mid-run is then dissolved into one continuous pipe
(`M.dissolveNode`). Two coincident unjoined nodes are exactly the defect
`disconnections()` reports, so the gesture that creates them resolves them.
Dissolving **refuses** when the two pipes differ in size, schedule or C, when
the node is a real corner, or when it carries a device — each of those would
otherwise silently change the calculation.

VIEW exists because auto-placed labels collide with pipework on anything
busy, and on a printed drawing that is the difference between readable and not.

**Each annotation carries its own offset key**, so it moves independently:
`labelOffset` for the entity's own label or tag, `warnOffset` for the
disconnection ⚠️, `boxOffset` for the "Show on drawing" value box. The value box
shared the label's offset until v0.7.10-dev, which meant dragging a tag took the
values with it and the box could not be grabbed at all — so a tag and its values
could never go on opposite sides of a fitting, which is exactly what a busy
drawing needs. `M.clearLabelOffsets` must clear every key or a reset reads as
half-working.
Label offsets are stored in **screen pixels**, not metres, so a label stays the
same distance from its owner at every zoom — which is what "tidy" means on a
drawing and what carries to print.

Display flags (`obj.show`) are only offered in VIEW, and only on devices and
device nodes — a plain pipe has none, which is worth knowing because it is
probably why the checkboxes were reported as unfindable (`Human-Test.md` 4.3).
Off by default: a drawing
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

## 7B. TRACE — background drawings

`src/trace.js` handles capture and encoding; `canvas.js` renders and
manipulates. Design rationale is in `TRACE-design.md`; the parts that look
arbitrary in the code:

**The paste EVENT, never `navigator.clipboard.read()`.** The async Clipboard API
needs a secure context, and a `file://` origin is not one — it would fail in the
app's primary deployment. The paste event is a user-gesture DOM event with the
data already attached and carries no such restriction. Drag-and-drop onto the
canvas is the fallback.

**Re-encoded as PNG, not JPEG.** Drawings are line art on white: PNG measured
smaller (105 KB vs 125 KB at 2000 px) *and* lossless, while JPEG puts ringing
artefacts around exactly the black lines being traced. The opposite of the usual
photographic advice.

**One trace per LEVEL**, because each floor is traced from a different drawing.
It is deliberately *not* carried by `copyLevel` — a picture of one floor placed
behind another would actively mislead.

**Autosave degrades rather than fails.** On `QuotaExceededError` the write is
retried with the image data stripped but the trace *geometry* kept, so position
and scale survive; the user is warned once. The model is the valuable part, and
a background can always be pasted again.

**Two-point calibration** is what makes traced geometry worth keeping. Click two
points whose real separation is known, type the distance, and the image scales
about the first point. Without it every traced length has to be retyped.

**Grid snapping is dropped while a trace is present**, because the user is
following the drawing, not the grid — snapping would pull every vertex off the
line being traced. Angle and connection snapping stay. The grid is also hidden
by default: it is drawn over the trace and obscured over a third of sampled
pixels at working zoom.

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

### A layout pipe is LEVEL, and its length is the plan distance

Michael's rule, v0.7.8-dev. Everything drawn on a level runs horizontally at
that level's z; the only thing that changes height is a **riser**. So
`M.pipeLength` returns the plan distance for any non-riser pipe, and
`M.pipeRise` reports the elevation difference separately.

It holds forward as well as backward: even once pipe gradients are modelled in
v2 or v3, the length an engineer takes off a layout is the horizontal one.

`pipeLength` used to include the elevation term, and the pair of bugs that came
of it is instructive. A source's static pressure was stored as the node's
elevation, so entering 200 kPa lifted the node 20.43 m and a 50 m run silently
read 54.01 m — while `changeLength` compared the requested length against the
*plan* distance and therefore reported "already 50, nothing to do". One wrong
storage decision, two unrelated-looking symptoms, both silent. Now both sides
speak plan distance and a pipe whose ends differ in elevation is an error
(`SLOPED_PIPE`) rather than measured one way or the other — because *both*
readings are wrong for such a pipe: along the slope overstates the run an
engineer would take off, and the plan distance understates the friction in a
pipe that really is sloped.

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
| Source | Node | Inexhaustible supply holding a stated static pressure AT the node. |
| Demand | Node | Fixed outflow, plus a required pressure. Can be excluded. |
| Pump | In-line link | Modes `auto`, `fixed`, `off`. |
| Valve | In-line link | Gate/globe/check, Kv (Cv is a display conversion), 0/25/50/75/100% open. A globe valve is the same throttling model as a gate but ~6x more resistant open, and throttles evenly. |
| Equipment | In-line link | Rated flow and ΔP; `ΔP = ΔP_rated·(Q/Q_rated)²`. |

### A source states a PRESSURE, and reads it

`device.pressure` in pascals, and `H = z + P/(ρg)` so the node's own gauge
pressure comes back as exactly `P`.

It was pinned at 0 gauge until v0.7.7-dev, on the tank-surface reading: the
water surface of an open tank really is at atmospheric, and the head it provides
is the column above the connection point. Every downstream number was right. But
the source node then read 0 kPa while the very next node read 193, which looks
like a pressure *jump* across a pipe that loses 7 — and it is not what an
engineer means when they draw a mains connection and write 200 kPa on it.
Michael and a colleague both read it the same way. So the node is the connection,
not the water surface. Downstream heads are identical either way; this changed
the reading, not the hydraulics.

The pressure was also **stored as the node's `dz`** until then, which was the
actual defect: `dz` is a real elevation offset and `pipeLength` is a 3D
distance, so entering 200 kPa lifted the node 20.43 m and stretched a 50 m run
to 54.01 m. Pressure and elevation are independent properties and are now stored
separately. `M.fromJSON` migrates old files and returns the list on
`m.migrations`; the app raises a dialog rather than a toast, because the fix
*changes pipe lengths* an engineer may already have read off the panel.

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
* **Closed circuit** — there are no outflow nodes, so the *equipment's rated
  flow* is the design flow. Size until the equipment gets it, iterating
  `H ← H × (q_target/q_actual)^1.9` (the circuit is near-quadratic).

Safeguards, both earned the hard way:

* Sizing converges from **either** side. Only ever adding head meant a model
  saved with an oversized pump kept it forever, which is not what "auto" means.
  Outflows are fixed flows, so lowering the head lowers every pressure by the
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

A system fed by a fixed-head source **that something draws water off** is
**open**. A sealed circuit driven round by a pump is **closed** — its pressure
reference comes from a fill/expansion vessel, which is exactly the `NO_SOURCE`
case the solver pins a datum for. Neither is **no supply**.

**A source alone does not make a system open.** What distinguishes open is that
mass actually *leaves*: there is an outflow drawing water off. A chilled-water
circuit with an expansion vessel drawn in has a source and is still closed —
the tank sets the pressure reference and the pump circulates the same water.
Reporting that as OPEN LOOP was a real defect (found by Michael on the
datacentre model, fixed 2026-07-30). So the discriminator is an **outflow**, not
a source: a pumped system with a source but no included outflow reads CLOSED.
Without a pump the old reading stands rather than guessing, because that is a
system still being drawn.

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
the flow that then arrives is what the system can really supply. Outflows that
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
| `SUPPLY_INSUFFICIENT` | Outflows cannot be met. Hydraulic error; source turns red on the drawing. |
| `PUMP_DEAD_END`, `PUMP_NO_FLOW` | Pump doing nothing. Hydraulic error. |
| `VALVE_SHUT`, `CHECK_CLOSED` | Valve state. |
| ~~`CROSS`~~ | Removed 2026-07-31. 4+ pipes at a node is ordinary; still modelled as two tee branches, just not warned about. |
| `ISLAND_NO_SOURCE` | Disconnected section carrying demand. |
| `FITTING_OSCILLATION` | Two-pass loop did not settle. Should be rare. |
| `COINCIDENT_NODES` | Two nodes in the same place, not joined. **Error.** The drawing looks continuous and the network is not. |
| `ISLAND` | Pipework with no path to the rest of the network. **Error.** |
| `ORPHAN_NODE` | A node with no pipe on it. |
| `SLOPED_PIPE` | A layout pipe whose ends differ in elevation. **Error** — pipes on a level must be level; use a riser. |
| `NO_RETURN_PATH` | A pump or equipment whose outlet can reach neither its own inlet nor any sink. **Error.** |
| `NO_PUMP_CURVE` | SIMULATION with a running pump that has no curve. **Error** — a constant-head pump answers a different question. |
| `PUMP_RUNOUT` | A pump past `settings.warn.pumpRunout` % of its design flow. |
| `REVERSE_BLOCKED` | Equipment holding against reverse flow — check its direction. |

Hydraulic errors take the status chip to themselves in red, because every
number on the sheet is conditional on them.

### Disconnection is checked on every solve

`FD.network.disconnections(m)` runs before the results are returned, and the
fatal codes above clear `converged`. It exists because a real model arrived with
zero flow everywhere, `converged: true` and no errors: the ring main was not a
ring, six pairs of nodes sat at exactly the same coordinates without being
joined, and both chillers ended in dead ends. Zero flow that looks like an
answer is worse than no answer.

It materialises risers first (`M.riserPipes`), because a riser is stored as
attachments and only becomes a pipe when the network is built — and the canvas
calls this on every frame without building. Coincidence is tested in true 3D via
`worldXY` and `elevation`, so two nodes at the same plan position on different
floors — every riser — are not mistaken for a break.

**SHOW DISCONNECT** is a view toggle (`view.showDisconnects`), not a tool.
Finding a break is half the job; you then switch to EDIT to join the pipe, and
as a tool the markers vanished exactly when they were needed.

---

## 4A. DESIGN and SIMULATION

Two modes, because the same drawing answers two different questions and a
terminal *is* a different object in each.

| | DESIGN | SIMULATION |
|---|---|---|
| Outflow | required flow — an **input** | a resistance derived from its design point |
| Outflow flow | as stated | an **output** |
| Pump | duty calculated — an **output** | curve — an **input**, and mandatory |
| Question | "what pump do I need?" | "what will this pump do?" |

The mode is `settings.calcMode` and the chip on the ribbon toggles it.

**Both sides are shown, in two boxes, not one greyed input** (v0.7.6-dev). A
pump and an outflow each present a **Design** group — what it was sized for —
and an **Actual** group — what it is doing. In DESIGN the two agree by
construction; in SIMULATION the gap between them is the answer.

Two consequences worth knowing:

* **A pump's head is no longer settable.** It never was in practice — DESIGN
  auto-sizes it, SIMULATION reads it off the curve — so the box sat permanently
  disabled with a change handler that could not fire. `network.recordDesignPoint()`
  now writes `pump.qDesign` / `pump.hDesign` back onto the model on every DESIGN
  solve, because SIMULATION does not re-size anything and the panel still has to
  show what the pump was selected FOR.
* **An outflow's design flow stays EDITABLE in SIMULATION.** It is not a result
  there: it is the input the terminal's characteristic is derived from. Disabling
  it hid the number driving the simulated flow, and put the *actual* flow in a
  box labelled as the design flow.

Terminal characteristic comes from the design point, `r = ΔP_d / (ρ·g·Q_d²)`,
which is the same form equipment already uses — so nothing extra is entered.
That is why an outflow at zero required pressure is refused: `K = Q/√ΔP` is
undefined there, and guessing would be inventing engineering data.

That characteristic sits on a short link from the terminal node to a virtual
discharge node pinned at the terminal's own elevation, 0 gauge. So the head
across it is exactly the node's gauge pressure, and

    P_node/(ρg) = r·Q²    ⟹    Q = Q_d·√(P_node/ΔP_d) = K·√(P_node)

with `K = Q_d/√ΔP_d`. The simulated flow is therefore a function of **three
things and nothing else**: the node pressure, the design-point K, and — through
the solve, which is what sets the node pressure — the pump curve. That identity
is exact whatever the rest of the network does, which makes it a strong check,
and `simulation.test.js` asserts it to 1e-9 across a change of K, a change of
curve, and two terminals of different K sharing one pump.

Full reasoning in `SIMULATION-design.md`.

### Devices have direction

Pumps, equipment and check valves pass flow one way only, `a → b`, flipped by
swapping the pipe's endpoints (the `‹ ›` button). Reverse flow is held using the
same head-based test as the check valve — testing *flow* oscillates forever,
testing the adverse *head difference* is a stable fixed point because the
adverse head is still there while the device is shut.

An **off** pump or **isolated** equipment is omitted from the network entirely.
It was previously a very large resistance, which was nearly right; "nearly" cost
about 0.03% of system flow seeping through every stopped pump, so the reported
flows did not add up. `net.omitted` carries them and `solveModel` reports their
flow as zero rather than leaving the key absent.

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

`.formula-eq` must stay an **inline** formatting context. It was `display: flex`
and that broke every raised or lowered element in it: a flex item is not an
inline box, so `vertical-align` does nothing to one. Exponents sat on the
baseline — `(V/C)` followed by `1.852` reads as a separate factor, not a power —
and the fraction's own `vertical-align: middle` was ignored too. Superscripts
and fractions are built on inline layout; do not put a flex container above
them.

Only the fitting table the active method actually uses is shown: K coefficients
under ASHRAE and Darcy-Weisbach, equivalent lengths under Hazen-Williams.
Showing both invites entering numbers into the one being ignored.

**The method list is built from the registry**, not hand-written. It was
hand-written and held HW and DW only, while the default method is ASHRAE — so a
new model showed "Hazen-Williams" in a box that was set to ASHRAE, and picking
either option was a one-way door with no route back. Both faults came from
restating in the UI something the engine already knows.

## 15. Testing

Six suites, 817 assertions, no dependencies:

```
node test/engine.test.js     schedules, fittings, units, hydraulics, solver
node test/model.test.js      model, levels, network building, annotations
node test/geometry.test.js   rigid edits, conflicts, repair
node test/supply.test.js     pump sizing, supply adequacy, pressure-driven
node test/closed.test.js     closed circuits, off pumps, equipment, tags
node test/simulation.test.js DESIGN/SIMULATION, pump curves, parallel pumps
```

All 817 pass. The "Parallel pumps share in DESIGN" section of
`simulation.test.js` regression-locks the total flow and pump heads of
`data_centre_redundant_ring_main.pnet (fixed).json`; those expectations were
regenerated on 2026-07-30 after the model was rebuilt by hand (§2), so a change
there when the model changes is expected, not a regression.

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

* **Darcy-Weisbach is BETA**, no longer blocked. **Swamee-Jain** is the chosen
  friction-factor correlation (Michael, 2026-08-02) and the default for new
  models; the other three stay selectable, and a model saved earlier keeps the
  choice it was saved with rather than being silently re-specified.

  Its accuracy is **measured, not quoted**. `engine.test.js` sweeps Swamee-Jain
  against a fixed-point iteration of Colebrook-White written in the test itself:
  within **0.9%** over Re 1e4–1e7 with ε/d ≤ 1e-3, the envelope every
  building-services pipe sits in, and up to **2.8%** at the corner of its
  published validity (Re 5000 with ε/d 1e-2). The widely repeated "within 1%"
  does not hold there, and the note in `hydraulics.js` says so. End to end on a
  DN50 run the app lands 0.72% above a hand-iterated Colebrook, which is exactly
  the correlation's own deviation at that Re and roughness.

  The method carries a BETA line in the calculation-sheet header and a note in
  the appendix, because the sheet is what gets issued.
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

* Adding a source file? Add it to `index.html`. If an engine test needs it, add
  it to that test's `load([...])` list (or to `test/harness.js` if every suite
  needs it). Pure-UI files need no harness entry — see §2.1.
* Reporting a pressure derived from a head? Use `headToPaWith(h, rho)`.
* Adding a warning? Detect it in the engine, format it in the UI.
* Touching the two-pass loop? Anything flow-direction-dependent must have a
  tie-break that does not itself depend on flow, or it will oscillate.
* Changing pump sizing? The safety factor must stay out of the solve.
* Read `piping-friction-loss-spec.md` §12 first. Every entry there is a
  deviation from the written spec with the reason it was necessary; several
  look like bugs until you read why.
