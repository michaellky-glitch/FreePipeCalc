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

**Two methods, and the fitting basis follows the method** (v0.9.0):

| Key | Name | Pipe friction | Fittings |
|---|---|---|---|
| `HW` | Hazen-Williams (ASHRAE with Equivalent Lengths) | ASHRAE Ch 22 Eq (6) | equivalent length |
| `DW` | Darcy-Weisbach (BETA) | Swamee-Jain friction factor | K velocity heads, Eq (7) |

There were three until then: this one with K fittings, a second Hazen-Williams
with equivalent length, and Darcy. The first two computed pipe loss
*identically* — they were two roundings of the same ASHRAE equation, 0.035%
apart — and differed only in how they charged fittings. So the menu offered what
looked like two equations and was really one equation and two fitting bases.
Collapsed at Michael's instruction; `'ASHRAE'` in a saved file migrates to
`'HW'` on load.

The survivor keeps the **printed velocity-form constants** (6.819 / 1.852 /
1.167) and derives the flow form from them, rather than carrying the rounded
published 10.67 / 4.8704. An engineer checking against the Handbook sees the
numbers on the page, and editing them reaches the solve.


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
| `data/schedules.js` | Pipe schedules → bore, outside diameter, insulation thickness. Sizing helpers. |
| `data/fittings.js` | Fitting equivalent lengths (L/D basis) and K-based losses. |
| `data/valves.js` | Valve Kv/Cv data, opening curves, resistance. |
| `data/ktable.js` | ASHRAE fitting resistance coefficients K, by nominal size. |
| `src/units.js` | SI ↔ display conversion, number parsing. **Display only.** |
| `data/pumps.js` | Pump curves: single-point, three-point quadratic, least-squares fit, parsing. |
| `data/fluids.js` | Water and propylene-glycol property sets. **Glycol rows are flagged unverified.** |
| `src/hydraulics.js` | Pipe loss models: Hazen-Williams, Darcy, friction factors. |
| `src/solver.js` | The Global Gradient Algorithm. Knows nothing about drawings. |
| `src/model.js` | Model state: levels, nodes, pipes, risers, devices, save/load. |
| `src/geometry.js` | Rigid length edits, conflict detection, repair. UI-free. |
| `src/network.js` | **Model → solver translation.** The busiest file. |
| `src/thermal.js` | Temperature transport, mixing and heat loss. Reads the solved flows; feeds nothing back. |
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

### Equivalent length: three tables, not an L/D ratio

Hazen-Williams charged fittings on an L/D basis — `EL = (L/D) × bore`, with flat
ratios from the spec — until 2026-08-02. It now reads a published table of
equivalent lengths in **metres against nominal size**. Nothing is multiplied by
a bore. `settings.elSet` chooses between three:

| Set | Source | Notes |
|---|---|---|
| `carrier` | Carrier Design Handbook, Table 11 | **The default.** |
| `nfpa13` | NFPA 13 (2019) Table 27.2.3.1.1 | Straight-through tee is Carrier's — NFPA has no such row. |
| `custom` | user-defined | Seeded from whichever set was showing. |

**A published set is READ-ONLY.** Every cell used to be editable in every mode,
which meant a value could be typed over while the line underneath still read
"Source: NFPA 13". Choose Custom to change anything; switching into Custom seeds
every cell from what was on screen, and switching back to a published set drops
the custom values rather than quietly applying them under someone else's name.

Four things worth knowing:

* **The lookup key is the designation, not the bore.** Under a ratio the bore
  was the *correct* key, because the answer was a multiple of it. Under a table
  keyed on the size designation it is not — HDPE "110 mm" is an outside diameter
  with a 90 mm bore, so keying on bore lands two rows off. Both `el()` and
  `ktable.k()` take nominal.
* **Carrier is stored in FEET and converted**, because Table 11 is printed in
  feet: `ft × 0.3048`, rounded to 2 dp. That reproduces Michael's own metric
  conversion of the same table cell for cell, which `engine.test.js` asserts —
  the app, the test's arithmetic and his spreadsheet all agreeing is what makes
  the transcription trustworthy. **NFPA is stored in metres**, because that page
  prints both columns and they are its own independent roundings of each other
  (13 ft is printed as 4 m); the metric one is the number on the page in the
  units this app works in. It follows that an imperial *display* cannot
  reproduce either page's feet column, and cannot be made to.
* **NFPA has no straight-through tee** — a sprinkler calculation does not need
  one — so in that set the row is Carrier's, carrying an asterisk, a footnote
  above the source line, and a line in the calculation-sheet appendix. A page
  headed by one source with a row from another has to say so on the page.
* **The app's table starts at DN25** and smaller pipes clamp to that column —
  confirmed by Michael, 2026-08-02, so DN15 and DN20 are charged the DN25
  figure. Both printed tables do carry smaller columns, so this is a decision
  rather than an oversight, and it is the conservative direction.

Carrier's other columns — 90° long radius, 90° street, 45° street, 180°, and the
two *reduced* straight-through cases — are not carried. The app infers a fitting
from the angle between two pipes, so it cannot tell a street elbow from a
standard one or know a tee's reduction ratio; offering those columns would
invite a choice the geometry cannot support.

**How fittings are charged follows the method.** **Darcy-Weisbach** charges
velocity heads, `h = K·V²/2g`, from the Ch 22 K tables (Eq 7), carried as a
*separate quadratic term* on the link. **Hazen-Williams** charges equivalent
length, folded into the pipe's own resistance.

That pairing is the consistent one: Darcy-Weisbach is itself a velocity-head
equation, so charging its fittings by an equivalent length borrowed from a
Hazen-Williams basis mixed two formulations for no reason. Because Darcy's pipe
exponent is also 2, the K term *could* be folded into the pipe resistance; it is
kept separate anyway so there is one code path for K fittings and the sheet can
report pipe and fittings apart. `r·Q² + rK·Q² = (r + rK)·Q²` either way.

**A bullhead tee is charged as a branch on both legs**, in either basis. Nothing
passes straight through one, so neither leg is a run (§7 "A bullhead tee has no
run"), and every branch variant reads the same table row.

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

## 17B. Control links

A pump or **globe** valve can take its setpoint from a piece of equipment: it
modulates to hold that machine's leaving temperature. New in v0.11.0.

Stored on the **controller**, not the equipment — one machine's setpoint can be
served by several devices, but a device follows exactly one:

```js
pump.control = { equip: pipeId, axis: 'h'|'v', mid: worldCoord }
```

**Only a globe valve.** A gate valve isolates rather than regulates, and a check
valve has no position to set at all.

**Picked on the drawing, not from a list.** "Which chiller" is a question about
the drawing, and a menu of P-numbers is not an answer to it. Click *Control*,
click the equipment; click *Control* again to clear. Escape cancels, and a click
on anything that is not equipment cancels too — a mis-click must not leave the
canvas in a mode the user cannot see.

**Drawn as a dashed green orthogonal route**, L or Z. Green and dashed so it
reads as a signal rather than pipework: it carries no water. Orthogonal because
a diagonal across a floor plan reads as a pipe run.

`axis` and `mid` are **presentation only** and there is a test asserting that
moving them changes no flow anywhere. `mid` is a **world** coordinate, not a
screen offset like `labelOffset`: a label follows its owner, a route bend stays
where it was put. An **L is the Z whose middle segment has collapsed**, so one
parameter gives both shapes and there is one code path. Both bend handles slide
the same line, which is what keeps the route orthogonal however it is dragged.

Toggled by CONTROL LINKS in the VIEW group. On by default — a hidden control
relationship is a surprise waiting to happen.

**Something acts on it now** — §17C. Recording and drawing was v0.11.0; the
modulation is v0.11.1.

## 17C. Setpoint control — variable-speed pumps and modulating valves

New in v0.11.1. A pump or globe valve carrying a control link (§17B) modulates
to hold the linked equipment's leaving temperature. `runControls()` in
`network.js`, wrapped around the solve the way `autoSizePumps` is.

**This is the only place temperature feeds back into the hydraulics.**
Everywhere else the flows are solved first and the temperature is carried along
them (§18), one way, no path back. A pump whose speed depends on a temperature
closes that loop, so `solveModel` gained an outer iteration. The hydraulic core
was split out as `solveCore()` so a trial setting can be evaluated without also
paying for the critical path, the pressure-driven second pass and the simulation
report.

### SIMULATION only, and that is not a shortcut

In DESIGN the flows are **imposed** — a demand node states the flow it takes —
so modulating a pump or a valve cannot move them and a controller has nothing to
do. The one DESIGN case where flow does follow head is a closed circuit being
auto-sized, and there `autoSizePumps` is already driving the same actuator
towards the rated flow. Two controllers on one actuator is not a system with an
answer. **DESIGN sizes; SIMULATION controls.**

### Part load rides down the SYSTEM curve

Worth stating plainly, because getting it wrong looks plausible. The operating
point is the **intersection** of the speed-scaled pump curve with the system
curve. On a closed circuit the system is `H = R·Q²` through the origin, and the
intersection then inherits the affinity laws exactly — `Q ∝ n`, `H ∝ n²`. Head
goes **down** at part load.

The mistake that is easy to make is reading the **rated** curve at the reduced
flow. A pump curve *falls* with flow, so evaluating it further left always reads
a **higher** head — the exact opposite. On the fitted curve in
`debug/20260803-1.json`:

| n | Q (L/s) | correct H | rated curve at that Q |
|---|---|---|---|
| 1.00 | 20.000 | 44.85 m | 44.85 m |
| 0.80 | 15.982 | 28.72 m | **50.12 m** |
| 0.50 | 9.964 | 11.24 m | **56.70 m** |

Both columns are "the pump curve evaluated at the solved flow"; only one is the
machine. Michael caught this on 2026-08-03 — the panel and the calculation sheet
were reading the curve in **DESIGN**, where the solver runs on `pump.head` and
the curve is not in the calculation at all, so the flow does not fall when the
pump slows and the reported head walks up.

`M.pumpHead(m, p, q)` is now the single definition, and the panel, the drawing
and the sheet all call it. Three separate readouts have disagreed with the
solver at least once each; one function is the fix.

**With static lift the operating point does NOT follow n and n²**, and there is
a test asserting exactly that. The affinity laws map points on the *pump* curve;
the operating point only inherits them when the system curve passes through the
origin. Add a 20 m lift and at 70% speed the flow falls to 43% (faster than n)
while the head only falls to 65% (slower than n², because it is approaching the
static head). Both inequalities are the wrong way round for a naive affinity
mapping, and both are right — which is the evidence that the app is solving the
intersection rather than scaling the answer.

### Speed applies in SIMULATION only

Not a UI nicety — it is where the physics is. A pump can only ride down the
system curve where the **flow is free to respond**. In DESIGN the demands impose
the flow and `autoSizePumps` holds the rated duty on top of that, so scaling the
head there slows nothing: the sizer simply specifies a bigger pump to overcome
the throttling it was handed. On Michael's own model, **44.8 m at 100% speed
became 179.4 m at 50%**, with the flow pinned at 20.00 L/s throughout. Exactly
backwards.

That is the same "two controllers on one actuator" conflict that made the
control loop SIMULATION-only in v0.11.1. The loop was fenced off then and a
hand-typed speed was not, which left the conflict reachable through the one door
still open. `M.pumpSpeed(m, p)` returns 1 outside SIMULATION; the stored speed is
kept rather than cleared, so switching back restores it, and
`M.pumpSpeedIgnored` drives a 🛈 on the panel so a number that is doing nothing
says so.

### The pump-curve chart, and the system curve

One chart per pump on the calculation sheet (v0.11.4). It used to draw the first
pump with a curve and apologise for the rest, which is no use on a job with a
duty and a standby. Each chart carries the **rated curve** solid, the
**90/80/70/60/50% family** dotted, the **system curve in red**, and the
**operating point** where the two meet. That is the picture that makes a VSD
legible: at part load you run down the red line, not along the black one.

**The system curve is SOLVED, not assumed** — `FD.network.systemCurve()`. The
shortcut everyone draws is `H = H_op·(Q/Q_op)²`, a parabola through the origin
and the operating point, and it is only the system curve when there is no static
lift, no other pump running, and every loss goes as Q². None of those hold
generally: a lift moves the intercept off zero, a second pump changes what this
one has to supply, and Hazen-Williams friction is Q^1.852. Drawing that parabola
and labelling it "system" would be inventing a curve.

So every point is a real solve. **Every operating point lies on the system curve
by definition**, so sweeping the pump's speed and recording where the network
comes to rest traces it exactly — static head, other pumps, real exponents and
all. The tests measure the traced exponent (it comes out between 1.852 and 2, as
it must) and show a parabola through the origin under-reading by more than 40% at
low flow once there is 25 m of lift.

Two details worth knowing. Speeds above 1 are a **probe**, not a claim about the
pump: the system curve is a property of the pipework and exists at flows this
pump cannot reach. And against a static lift most of a linear speed sweep lands
on zero flow and is discarded — 25 m of lift left four points of thirteen — so
the range that did work is **swept again at full resolution**. Nothing is
interpolated; a thin curve is re-solved, not smoothed.

SIMULATION only, for the same reason speed is: in DESIGN the demands impose the
flow and every one of those solves would return the same point. The chart still
draws there, with the rated curve and the family, and a 🛈 saying why the red
line is absent.

### Speed is an affinity scaling of the curve, and nothing else

`Q ∝ N`, `H ∝ N²`, so `H_s(Q) = s²·H(Q/s)`. Substituted into the stored form
`H = H0 − a·Q^b` that comes out in the *same* form —

    H0' = s²·H0        a' = a·s^(2−b)        b' = b

— which is why `FD.pumps.atSpeed()` can do the whole job on the curve and the
solver never learns that speed exists. A fixed head (no curve) is scaled by `s²`
by the same law. **Everything that reads a curve must go through
`M.pumpCurve(p)`**, or the drawing, the panel and the sheet will each report the
rated curve while the solver runs a scaled one — the same class of mistake as
reading `link.r` without the fittings (`HANDOVER.md` §2).

The affinity laws are textbook similarity relations, not fitted here. Efficiency
is deliberately not scaled: the app carries no power curve, so there is nothing
to be wrong about.

### Three things this had to get right

**1. The direction is not assumed.** More flow moves some machines towards their
setpoint and others away from it. Nothing hard-codes a sign. Because an actuator
cannot go past rated speed or fully open, the only question is whether *backing
off* helps, and that is answered by **perturbation**: back off a little,
re-solve, compare. If the error gets worse, the device is already doing all it
can and says so (`CONTROL_AT_LIMIT`). A machine capped by ΔT max is the case
that catches a hard-coded sign — its leaving temperature does not depend on flow
at all, so a naive controller winds the pump to its floor for no benefit.

**2. The error is read from a finished solve.** The modulation is frozen for the
whole of a core solve and its thermal pass, so no pass ever chases an error it is
itself producing. That is the check-valve lesson (§6) and the frozen-active-set
lesson (§18) in a third place.

**3. The search is bracketed, not Newton.** A source/sink holds its setpoint
*exactly* once it is no longer limited, so the error is non-zero above some
speed and identically zero below it — a derivative of zero over half the range,
which a secant method divides by. Secant steps are used only to find *a* setting
that meets the setpoint; the answer is then bisected out as the **highest**
setting that still meets it, which is where a real controller comes to rest.

Two thresholds, and they are different things. `control.tol` (0.05 K) is the
**deadband** — how far off setpoint is worth modulating for at all. The search
itself resolves the boundary to a micro-kelvin, which is safe *by construction*
rather than by luck, because that boundary is a genuine step. Stopping at the
edge of the deadband instead was tried first and is subtly wrong: it leaves the
machine a whole `tol` short — 1% of the flow on a 5 K duty — and still reporting
`EQUIP_LIMITED` while the controller claims to be holding setpoint.

### The floor, and reporting it

`control.minSpeed` defaults to 0.25 and `control.minOpening` to 10%. Real drives
are not run below roughly a quarter speed, and a pump at no flow makes the
thermal solve singular, so the floor is a numerical necessity as much as a plant
one. All three settings are **defaults a user can change, not transcribed data**,
and they are on the THERMAL tab.

Sitting on a floor is reported, never hidden: *"PMP-01 is at its minimum speed
(25% speed) and ECO-01 is still 2.5 K above its 25.0 °C setpoint"* — the same
shape as `EQUIP_LIMITED`.

### Written against the actuator, not against a pump

`actuatorFor()` returns a `{ min, step, get, set, label }` over a fraction of
full travel, so one search serves a pump's speed and a globe valve's position.
A valve's step is a whole **percent** — that is what the panel offers and what a
valve is actually set to — so it settles at or just under the boundary rather
than on it. On the test rig that is 0.7% of flow; a pump, resolved to 0.1% of
speed, lands on the hand figure exactly.

### Every solve starts from full

Warm-starting from the previous answer would be cheaper and is wrong: the search
only ever probes downward, so a device that once ramped down could never ramp
back up when the load returned, and the reported answer would depend on edit
history rather than on the model. A controlled globe valve's opening is
therefore an **output** — the panel says so beside the slider.

### Reported

`res.controls = { devices: [...], sweeps, solves, tol }`, one entry per
controlled device with its target, what it actually achieved, the value it
settled at and a `state` of `on` / `at-min` / `at-max` / `no-flow` /
`unsettled`. Speed appears on the pump's info plate (`N 54%`), in the Actual box
of its panel with the machine it is holding, on the Device Flow row, and on the
pump-curve chart as a solid scaled curve with the rated one dashed behind it.

Several controllers are settled in turn and the sweep repeated, because one
device's modulation moves every other device's inlet temperature. Two or three
sweeps in practice; still moving after four is `CONTROL_UNSETTLED`.

A link to a machine that states no setpoint — a heat exchanger states a *load* —
raises `CONTROL_NO_SETPOINT` rather than doing nothing quietly.

### What a controller follows, and in what order

A machine states more than one thing worth holding, and which one a controller
chases is an engineering decision (Michael, 2026-08-04):

| Target | First | Then |
|---|---|---|
| Source / sink | Design LWT | Design ΔT |
| Heat exchanger | Design flow | Design ΔT |
| Sensor | its one setpoint | — |

`M.controlOptions` owns the order; `control.use` holds the toggles, on the
CONTROLLER rather than the machine, because two pumps following one chiller may
legitimately hold different things. Absent a stored choice the first option is
on, and turning the last one off clears the link — a control link with nothing
to hold is not a state worth having. The panel reads *Monitoring: ACCH-01*, then
one switch per setpoint, then what it actually settled on, marked `(fallback)`
when it is not the first.

**A setpoint the actuator cannot move is not being held.** This is the rule that
makes the priority list work, and it was missing until v0.12.3. A pump linked to
a chiller's Design LWT sat at 100% and never moved: an unlimited chiller holds
20 °C at *any* flow, so the error was zero at every speed and the search
correctly did nothing — while the control valve downstream was left to strangle
the flow on its own, bottomed out at 10% open. That is not commissioning.

The distinction is **authority**, and it costs one probe: nudge the actuator and
see whether the error moves. If it does, the setting is genuinely holding the
setpoint. If it does not, the setpoint gives no signal, so fall through to the
next toggled option — or raise `CONTROL_NO_AUTHORITY` naming what the device
*can* hold. The probe runs only at **full travel**: a device already throttled
plainly has authority, and probing it again misreads the far side of a setpoint,
where a machine sitting on its own ΔT limit holds the reading flat however much
further the pump backs off.

On Michael's model the pump falls through to Design ΔT, settles at **57% speed**
with the chiller at exactly 15.0 K, and the control valve stays **100% open**.
The flow that implies is `50 kW / (15 K × ρ·Cp) = 0.798 L/s` — the coil's own
design flow. Chasing design ΔT on the plant lands on design flow, which is why
the balancing valve does not have to throttle at all.

**"First, then" is a fallback, not a blend.** One actuator cannot hold two
setpoints at once, and pretending otherwise is how a loop starts oscillating.

**The order is DRAGGED, not fixed.** Which setpoint matters more is an
engineering judgement, so the panel is a list you rearrange — the same gesture
as LEVELS, chosen because the order *is* the meaning here and a rearrangeable
list says that better than a pair of radio buttons. Stored as `control.order`
on the controller. An option the stored order does not mention keeps its natural
place after the ones it does, so a machine that grows a setpoint later never
silently drops off the list.

### At full travel with the setpoint met, nothing is being controlled

Two cases look identical from inside the loop and want the same response: a
valve wide open on the furthest branch whose flow is already right (correct
commissioning), and a pump following a setpoint another machine is holding
regardless. Both report the setpoint as **met**, and both **try the next
setpoint** if they were given one. That internal signal is `idle`; it becomes
`on` in the report, because the setpoint genuinely is met.

**This was a probe twice, and neither distance worked.** NEAR it read solver
noise — 5% of an equal-percentage valve's travel moves the flow by less than the
solver's own convergence tolerance. FAR it read the far field — a chiller
comfortable at design flow still misses at quarter flow, so the probe "found" an
authority the device has no use for. `CONTROL_NO_AUTHORITY` was withdrawn with
it: the condition it named could not be told from a device that is simply, and
correctly, not modulating.

### The flow deadband is relative

`max(0.2% of setpoint, 1e-7 m³/s)`. It was `max(0.5%, 1e-5)`, and on a branch
rated 0.8 L/s the 1e-5 floor is **0.01 L/s — 1.25%** — which dominated the
relative term and made the deadband four times looser than it read. Three valves
on `debug/20260805-5.json` sat wide open with their branches 0.1–0.6% over, all
inside that floor, while a fourth throttled to 59%. Michael expected them in
between, and was right.

### Drawing annotation: lines and notes the model never sees

`m.details` and `m.notes` are their own collections, not a kind of pipe, and
that is the entire design. Nothing in `network.js`, `thermal.js` or any warning
reads them, so there is no path by which a room outline becomes fifteen metres
of pipework. Michael, 2026-08-07: *"These lines do not interact with the model
at all, to allow user to draw boxes to represent equipment or rooms."* A piece
of equipment is 0.5 m on the drawing and a plant room is fifteen; the drawing
needs a way to say the second without the calculation hearing it.

**Colours are palette NAMES, not hex.** Six of them, resolved against the theme
at draw time, so a drawing made in dark mode is legible in light and maps to a
print-safe equivalent on paper rather than vanishing.

The one trap: a file written before these existed has a `_seq` with no counter
for them, and `undefined++` is `NaN` — every annotation added to such a model
came out as `DNaN`, all sharing one id and therefore undeletable. The counters
are filled in **after** `_seq` is restored, because restoring it replaces the
object wholesale.

### The temperature gradient is sampled INSIDE the pipe

A node temperature at a tee is the **mixture** of everything arriving. A pipe
arriving there never contains that mixture — it delivers its own outlet
temperature into it — so colouring the run up to the node value smears a real
discontinuity back down the pipe.

Michael's fix, 2026-08-07, and it is the right one: read **half a metre in from
each end** and paint that gradient across the whole run. Half a metre is inside
the pipe by any reckoning, so it is that pipe's own water; the colour still
reaches the node, so the jump appears exactly where it happens — at the tee, as
a step between two pipes rather than a ramp along one. On the economizer model
the bypass reads a uniform 30 °C, the chiller leg a uniform 15 °C, and the run
below the mixing point a uniform 20.08 °C: three flat colours meeting at a
point, which is what the plant does.

`tIn`/`tOut` are oriented by FLOW, not by a→b, so the direction has to be
resolved before they are used.

### A route may be taken over by hand

`zRoute` gives one degree of freedom, which is all a Z between two fixed points
HAS. A route may instead carry `pts` — a list of world points — and is then
drawn exactly as given, with any number of bends anywhere.

The two live side by side deliberately. Every link starts as a Z, because that
needs no decisions and is right most of the time; the first drag of a bend, or
the first LINK NODE, converts it. **Taking over starts from what is on screen** —
the Z's own bends become the first waypoints — so the link cannot jump on the
first grab, and nothing has to be migrated on load.

**Orthogonality is not enforced between waypoints.** It cannot be: with three or
more free bends there is no unique orthogonal path through them, and snapping
each drag to an axis fights the hand placing it. The default route is orthogonal
and stays so until someone deliberately moves a point off it.

The two ends are never waypoints — they belong to the two devices and stay
pinned however the middle is dragged.

### The plan prints what the screen shows

The printed plan drew pipework, nodes and pipe labels and nothing else, so every
device tag, every value box and every control link — the things that make a
drawing say what it is FOR — were on screen and absent from the paper.
`renderPlans` now takes the **view**, so the ribbon's own switches decide: turn
LINKS off and they leave the page too. Detail lines and notes are not view
state, so they always print.

### The Z route: one shape, one degree of freedom

`M.zRoute(a, b, axis, mid)` is three orthogonal segments between two **fixed**
points, and it has exactly **one** degree of freedom. That is geometry, not a
limitation: with both ends pinned, where the middle segment sits determines both
bends. So every vertex is a grab handle and they all move the same thing — the
answer to *"all vertices of the C/Z should be draggable"* is that they are, and
that moving one necessarily moves the other.

A **C** is the same route with `mid` outside the span of the two ends, so both
end segments leave the same way. No special case.

**An axis whose middle segment would have zero length is not a route.** With
`axis` 'h' the middle segment spans `a.y→b.y` and vanishes when the ends are
level; with 'v' it spans `a.x→b.x` and vanishes when they share a vertical.
Either way the three segments collapse into a line that runs out and straight
back along itself, which is what two tappings on the same riser produced when a
drag flipped the axis onto them. The flip is refused at the drag, and `zRoute`
normalises anyway — and when it overrides a stored axis it drops the stored
`mid` with it, because that number is a coordinate on the *other* axis.

Deciding this in two places is how it went wrong the first time: the axis choice
for level ends lived both in the degeneracy guard and in the `mid` defaulting,
and they disagreed. One place now; the defaulting only decides **how far** off.

**Reset route** on the panel clears `axis` and `mid`. A route can be slid until
its handles are off screen, and then there is nothing left to grab — Michael
asked for the recovery on 2026-08-06, and it is one button rather than a rule
about how far a drag may go.

### The control-link route: one meaning for `axis`

`axis` names WHICH COORDINATE `mid` is, and therefore which way the middle
segment runs:

| `axis` | `mid` is | middle segment |
|---|---|---|
| `'h'` | an X | vertical |
| `'v'` | a Y | horizontal |

One meaning throughout, so the renderer, the drag handler and the stored value
cannot disagree — they did until 2026-08-05, where the level-ends case built its
route from the *other* coordinate while the drag handler still wrote this one,
so the first drag made the route jump.

**The 1 m step off the pipe is a choice of AXIS, not a special case.** Two
devices on the same run are level with each other, and a vertical middle segment
between them collapses onto the pipe; a horizontal one 1 m above is exactly
"step off, along, and back", and needs no second code path.

**Dragging flips the axis.** It used to be fixed when the link was made, so the
segment could only slide one way and a drag across it did nothing — it read as
hitting a limit. Pull far enough across (1.6× the along-axis movement, as
hysteresis) and the route switches: a Z that bends the other way is the same
route seen from ninety degrees.

### Devices that share a setpoint are GANGED

N controllers chasing ONE measured quantity is **degenerate**: any split that
produces the right reading satisfies all of them, so settling them one at a time
picks whichever split the sweep order happens to reach first.

`debug/20260807-DC-broken.json` (Michael, 2026-08-08) is four primary pumps on
one differential. Settled individually they landed at **100%, 85.8%, 25%, 25%** —
the last two on their floor carrying **no flow at all**, held shut by the first
two. Stable, arbitrary, and nothing like the plant.

**This is also what real plant does.** Parallel pumps on a common header share
ONE speed command from the BMS; they do not each run a private loop against the
same sensor. Michael's own account of the real system — *"it would fluctuate
over a few hours, then stabilize with roughly equal running %"* — is a
description of independent loops fighting each other, and then of the equal
split they are eventually commanded to. Ganging goes straight to the answer:
all four settle at **67.5%**, each carrying 8.9 L/s, holding the 250 kPa
setpoint to within 225 Pa.

It is also the cheap option, which matters on a model this size: one search for
the group rather than N interacting ones.

**Grouped on**: same actuator quantity, same target, same setpoint. Different
setpoints, or a pump and a valve, are not a gang — those are genuinely different
jobs that happen to watch the same instrument, and that is how you stage plant:
give the lag set a different setpoint.

The gang's floor is the most restrictive in the group and its step the finest,
so no member is ever asked for a position it cannot hold. Every member still
reports under its OWN tag with `gangedWith` beside it, so the panel and the
drawing name the machine in front of you, and `CONTROL_GANGED` says it out loud —
a behaviour this consequential must never be inferred.

### A control link to a deleted target is not silent

`if (!tgtPipe) return;` — the link stays on the device, points at nothing, and
the device is simply never controlled. That is why the four primary pumps on
`20260807-DC.json` sat at 100% with nothing to explain it: their sensor had been
deleted and the links stayed behind. `CONTROL_TARGET_GONE` now says so.

### The search descends, so a device that must OPEN restarts from full

`seek` is a **descent from full travel**. It probes at the actuator's minimum,
and if that helps it walks down. That is complete on the first pass, because
`runControls` puts every device at full before it starts — but a later sweep
begins wherever the previous one finished, and a device that now needs to go UP
has nowhere to look. It reported `at-max` at mid-travel, which counts as a lost
setpoint, which **parks it at 100%**.

`debug/20260807-1.json` (Michael, 2026-08-07) is the case, and it is worth
keeping because six controllers interact in it: four coil valves on flow, a
primary pump on a differential, and a secondary pump on a mixed temperature.

    sweep 1   every device settles. Valves 32–35%, PMP-01 holding its dP to
              within 44 Pa. A good answer.
    sweep 2   but the valves settled while the pump was still at full; the pump
              then dropped to 34.7% and starved them by 25%. Four valves now
              need to OPEN, none can, all four report at-max, all four are
              parked at 100% — and PMP-01 with them.

He reported it as *"PMP-01 is ramping up to full speed and exceeding"* and *"the
CVs also stopped working"*. One cause, both symptoms, plus a third: with the
valves wide open the branch flows were wrong, the mix temperature was wrong, and
CT-01 fell to `Capacity (wrong direction)` because its inlet had dropped below
its own setpoint.

**So a device that cannot improve by closing, and is not already at full,
restarts its search from full.** That is the only direction this search can
travel from. Guarded against recursing twice: from full travel there really is
nowhere further up, and `at-max` then means what its name says.

With it, the same model converges in five sweeps — valve at 59% and three
correctly wide open, PMP-01 at 91.9% holding 200.8 kPa against a 200 kPa
setpoint, PMP-02 at 48.8% holding the mix at 20.08 °C, and a third of the flow
bypassing the chiller exactly as the mixing arithmetic requires.

### Losing the setpoint: park at FULL, do not throttle

`debug/20260804-3.json` — a 110 kW coil against a 100 kW chiller. The loop
chased LWT, found that throttling *reduced* the error, and walked the pump down
to its 25% floor while the loop ran away to 3000 °C. Michael's objection is the
right one: in a condition it cannot control, a pump should be doing its most,
not its least.

The reasoning is physical. Less flow through a machine already at its capacity
delivers less cooling, not more — throttling holds the *leaving temperature*
closer to setpoint while starving the load, which is the wrong thing to optimise
when the machine is short of capacity. So when nothing in the actuator's range
holds the setpoint, **the actuator returns to full travel** and the answer is an
error:

> System is unable to maintain setpoint. Check heat balance.

`SETPOINT_LOST` clears `converged`, because a system that cannot hold its
setpoint anywhere is not delivering what the model says it delivers. On his
model the pump goes back to 100% and the runaway falls from 3000 °C to 420 °C —
still a runaway, still flagged, but no longer made worse by the control.

**The trade-off is real and worth knowing.** For a machine holding a leaving
temperature, minimum speed put it *closest to setpoint*; full speed moves the
most water. Those are different objectives and this rule picks delivered
capacity. It also changed the v0.11.1 economizer case, which now parks at full
rather than sitting on its floor.

Each fallback option is also chased **from full travel**: the previous one may
have left the actuator on its stop, and starting the next search there hides
half the range from it.

### Balancing several branches, and what it costs

Four control valves on four parallel branches interact: closing one pushes flow
to the others. The sweep is Gauss-Seidel over the devices, and three separate
faults had to be fixed before `debug/20260805-4.json` would balance
(2026-08-05, all reported by Michael as "the valves are not throttling"):

1. **The solve budget was flat.** 60, chosen when a model had one controller or
   two. With five it ran out at 62 partway through the LAST device, which then
   reported `unsettled` and was parked back at full travel — looking exactly as
   though the valve had never tried. It scales now: `40 + 30` per device, capped
   at 400, overridable as `control.maxSolves`.
2. **Park-at-full ran inside the sweep.** A device can report `at-max` on one
   pass and settle happily on the next, and slamming it back to full mid-sweep
   threw away the iteration's progress. Judged once, at the end.
3. **The direction probe read noise.** A 5% nudge on an equal-percentage valve
   near full travel moves the flow by ~1e-7 m³/s — two orders of magnitude below
   the solver's own convergence tolerance.

**The probe now goes to the far end, and accepts a CROSSING as well as an
improvement.** That second half matters: probing the minimum overshoots hard —
+0.15 L/s at full becomes −0.58 L/s at 10% open — and judging on |error| alone
called that "backing off does not help" and left the valve wide open. A sign
change is the strongest possible evidence the setpoint is reachable, because it
brackets the root.

**The authority test stopped being a probe at all.** It could not be made to work
at any single distance: near, it read solver noise; far, it read the far field,
because a chiller that holds its setpoint comfortably at design flow will still
miss it at quarter flow. At full travel there is nothing left to give and
nothing to improve, so whatever is holding the setpoint is not this device —
the position alone answers the question, and costs nothing.

**What it costs.** On that model — 33 nodes, 36 pipes, five controllers — one
network solve is about 3.5 ms and the whole controlled solve takes ~200 ms over
50 inner solves. The 400 ceiling is of the order of a second on a model that
size, and only a model that is genuinely hunting gets near it.

### Control valve authority is a different word

`VALVE_OVERSIZED` is about a valve that HAS the movement but spends it all near
its seat, where a small change in position is a large change in Kv: twitchy to
control, hard to commission, and wearing where it throttles. Below
`warn.valveOversized` (default 10%) it reports *"CV-01 has insufficient control
authority. Consider reducing size."* Control valves only — an isolation valve is
meant to be shut or open, and a cracked-open one is a deliberate act.

## 17D. The pipe sensor

### It measures five things

A **differential** draws the second pipe it probes: a dotted line from the
bubble with an open square at the far tapping, deliberately a different mark
from the control link's ring because it means a different thing. Without it
"Δp 150 kPa" on a drawing does not say across what. The bubble carries `ΔP` or
`ΔT` rather than the `T` it showed until 2026-08-05.

A **differential is ONE ROUTE BETWEEN THE TWO TAPPINGS**, with the bubble at the
geometric centre of its middle segment. Michael, 2026-08-06: *"Could we just
draw a C/Z between the 2 points and put the dP symbol at the geometric center of
the middle section?"*

What it replaces is the lesson, and it took three goes to learn. A bubble hung
off the sensor's own pipe **plus** a separate reference line to the far tapping
is two leaders that have to be kept from colliding, and they never were: the
reference line ran diagonally (v0.14.5), then it retraced the stem (v0.14.6),
then it retraced it only when the bubble had been dragged across the pipe
(v0.14.8). Each fix was correct and each left another case. One route has
nothing to collide with — and it says what a ΔP *is* far better, because the
symbol sits **between** the two things being measured.

It is `M.zRoute`, the same object the control link uses, so there is one
implementation of "orthogonal path between two fixed points" and one drag
handler. An open square marks **each** tapping: both ends are measurement
points and neither is the sender, which is exactly the difference from the
control link's one-ended ring. Dotted rather than dashed, so the two do not read
as the same thing.

Temperature, flow, pressure, and two DIFFERENTIALS — Δp and ΔT between this
sensor and a referenced pipe. A pressure or differential reading is taken at the
sensor's **inlet node**: the water arriving, which is what a tapping on that
pipe would read.

The differential is a **reference on the ordinary in-line sensor**, not a
free-standing object. Michael asked for a floating box that probes two pipes; a
sensor is already a pipe, already drawn, already a valid control target and
already carries a setpoint, so "and compare with that pipe" reuses all of it
where a separate object would need its own storage, hit-testing, drawing and
control wiring for the same measurement. The second pipe is picked on the
drawing, the same gesture as a control link.

**The differential modes are `dPdiff` and `dTdiff`, not `dP`/`dT`.** A piece of
equipment already offers a setpoint called `dT` — its own Design ΔT — and the
two are different measurements: one is the difference across a single machine,
the other between two separate pipes. Sharing a name routed the equipment's ΔT
into the differential reader, which then went looking for a reference pipe that
was never going to be there.


New in v0.12.0, at Michael's request. An **instrument**, not a device: it reads
the water where it sits and states a setpoint for something else to hold.

```js
pipe.kind = 'sensor';
pipe.sensor = { mode: 'temperature' | 'flow', tSet: °C, qSet: m³/s };
```

The case that drove it is **thermostatic mixing**: put a sensor downstream of a
blend, state the temperature you want, and Control-link a valve on one leg to
it. It also gives constant-flow control on a branch for free, because a flow
setpoint is the same machinery with a different measured quantity.

**It is a pipe in every hydraulic sense.** It has a length, a bore and ordinary
friction, and adds nothing of its own — a pocket welded into a run *is* a piece
of pipe. That is why `network.build()` needs no branch for it: a sensor falls
through to the pipe treatment and earns exactly the friction its own 0.5 m is
worth. It passes temperature straight through too, like a pump or a valve — a
thermometer that changed the reading would not be one.

Two alternatives were rejected and are worth recording. Modelling it as
**equipment** would give it a design point and therefore a pressure drop that
does not exist, and would leak it into everything that treats equipment as
plant: the off-rating check, the terminal list, the duty columns. Modelling it
as a **zero-resistance link** would put a singular row in the Jacobian for no
benefit at all.

Drawn as an **instrument bubble** — a small hollow circle on a stem, carrying
`T` or `F` — in amber. Green and red are the in-service/isolated pair on devices
that have a service state; a sensor has none, and must not read as plant.

### What it changed in the control loop

`M.controlTarget()` is now the single place that knows what a controller may
follow: a source/sink's leaving temperature, or a sensor's setpoint of either
kind. A heat exchanger states a *load* and has no setpoint, which is why it is
not in that list and raises `CONTROL_NO_SETPOINT`.

**The search had to be generalised, and this is the interesting part.** A
source/sink holds its setpoint *exactly* once unlimited, so its error is a
**step** — non-zero above some speed, identically zero below. A sensor is
**continuous**: the mixed temperature at a tee slides smoothly with the valve,
so its error *crosses* zero rather than reaching it, and the `== 0` test that
worked for the step would never fire. One predicate now covers both: *arrived,
or gone past*. The bisection that follows converges on the boundary in the first
case and on the root in the second without knowing which it is looking at.

**The deadband learns the actuator's resolution.** A globe valve is set in whole
percent, so on the test rig one percent of travel is worth 0.26 K:

    34% open → 44.845 °C        33% open → 45.106 °C

45.000 falls between them. No valve position holds it exactly, so the search
keeps the **best point it found** rather than the last one, and records what it
achieved as `floorErr` — otherwise the next sweep hunts again from a position
that was already the best available, and a working control reports as broken.
The deadband on a flow is relative (half a percent of setpoint, floored at
0.01 L/s), because 0.05 of a flow is meaningless without a unit.

## 18. The thermal module

New in v0.10.0. `src/thermal.js` runs AFTER the hydraulic solve and reads its
flows, because temperature is carried by the water. It feeds nothing back
*except through a control link*: fluid properties are held at one temperature,
so a warmer pipe does not change its own friction, and the only path from a
temperature to a flow is a modulating pump or valve (§17C). That is a real simplification, recorded in `KNOWN-ISSUES.md`
rather than hidden.

### Sign convention

Michael's, and it is about the **fluid**, not the room:

    Q < 0   heat REMOVED from the fluid   (a chiller, a hot pipe losing to the room)
    Q > 0   heat ADDED to the fluid       (a boiler, a CHW coil picking up load)

So a chilled-water coil reads **positive** — the room is being cooled and the
water is being warmed. Everything in the module follows from that.

### Three things, coupled, which is why it iterates

1. **Mixing** at a junction, mass-weighted: `T = Σ(ṁᵢTᵢ)/Σ(ṁᵢ)`. Mass rather
   than volume because it is energy that mixes; with one fluid and a constant
   Cp the Cp cancels and this is exact.
2. **A pipe** exchanging heat with ambient. Closed form, no stepping along the
   pipe: `T_out = T_amb + (T_in − T_amb)·exp(−U'L/ṁCp)`, with
   `U' = 1/[ ln(r₀/rᵢ)/(2πk) + 1/(2πr₀h) ]`. The exponential matters — a linear
   model on a long run at low flow walks the temperature straight past ambient
   and out the other side. **`rᵢ` is the pipe's OUTSIDE radius**, because
   insulation sits on the pipe rather than in the bore; this is one of the few
   places that wants `od_mm` and not the bore.
3. **Equipment**, in one of two modes.

### It is SOLVED, not iterated

Every relation above is **affine** in temperature — mixing is linear, pipe
transport is `T_out = e^(−x)·T_in + T_amb(1−e^(−x))`, equipment adds a constant
— so the whole network is one linear system and `FD.solver.solveLinear` does it
in a single pass.

It was swept Gauss-Seidel until temperatures stopped moving, which worked and
was wrong. The convergence rate is set by how strongly the loop is tied to
ambient, so it was fine on a system with a source and hopeless on Michael's case
of a 100 kW load in a lagged loop with no heat rejection: 200 passes still left
the energy balance **69 kW** out. That is not a tolerance to tune — it is the
wrong method for a linear problem. Solving it also retires "did it converge?",
which was never a physical question here.

### A source is a STREAM, not a reset

A source states the temperature of **the water it brings in**, which is not the
same as the temperature of the node it sits on. It used to be a hard pin — `T =
the source temperature, whatever arrives` — so a source teed into a live main
**reset every drop flowing past it**. Michael, 2026-08-06: *"Sources placed on
pipes are still acting as a temperature reset. Temporary workaround is to place
the source on a branch pipe — this happens often in practice, but placing on the
main line is an equally valid choice."*

It is now one more stream into the mixing, carrying only the water it actually
introduces:

    m_src = (what leaves the node) − (what arrives at it)          by continuity

    T_node = ( Σ m_i·T_i  +  m_src·T_src ) / ( Σ m_i + m_src )

At the end of a branch `m_src` is all of the flow, the sum has one term, and the
answer is exactly the source temperature — which is why the workaround worked
and why nothing about that case moves. Teed into a main, 1.76 L/s of 60 °C
against 6.24 L/s of 10 °C make-up gives 20.99 °C where the pin gave a flat 10.

**Against the solver's own zero, not against literal zero.** Round a closed ring
the flow in and out of a node differ in the last bit — 1.1e-13 kg/s on the
sealed-circuit test — and `m_src > 0` read that as a source introducing water.
`ρ·Q_MIN` is the same threshold that decided which links carry water at all.

**Only a source that introduces water sets the level.** A fill connection on a
sealed circuit carries nothing and does NOT hold the loop at mains temperature.
Counting any source at all was what let a zero-flow fill both suppress the datum
and pin the loop — two ways of saying the same wrong thing.

### The datum is applied on a singular solve, not on suspicion

`solveLinear` returning null is the exact test for "this temperature field has no
unique solution". So the pin waits for it. It used to be applied whenever there
was no source, and that overrode machines that were already stating a level: a
chiller holding 6 °C had its outlet pinned at the system flow temperature
instead, and the difference — **83.6 kW** — was booked as heat absorbed at a fill
connection carrying no water. Nothing was singular; the pin invented the problem
it was there to solve.

The consequence worth knowing is that **where a fill is drawn no longer changes
the answer**. A dead-leg fill and an in-line one on the same sealed circuit are
the same physics — zero net water across the boundary — and both now report the
same 20 kW shortfall against the same pinned datum. Before, in-line absorbed it
and on a dead leg it was `THERMAL_SINGULAR`. `THERMAL_SINGULAR` survives for a
circuit with nothing to pin **to**: no source, no equipment, no ambient coupling.

### A dead leg is at the temperature of the water it touches

Nothing carries a temperature to a capped branch or a shut-off standby, so the
mixing relation has nothing to say and the row needs filling some other way. It
used to be filled with the **seed** — the source water temperature — which is
what Michael saw as "the temperature is resetting at the source and dead-end
pipes" (2026-08-05).

A dead leg is not at the supply temperature; it is at the temperature of the
water it is connected to, because that is the water that is in it. So each such
node is tied to a neighbour:

    T_dead − T_neighbour = 0

still linear, still exact. His own statement of the rule: *"if one end is a tee
with flow in another direction, use the temperature of the other end."*

The neighbour is found by **breadth-first search outward from the live nodes**,
so every dead node points at something nearer the live water than itself. That
ordering is what keeps the system non-singular — two dead nodes pointing at each
other would be `T1 − T2 = 0` twice over, which has no unique solution. A node
with no path to live water at all falls back to the seed, because there genuinely
is nothing else to say about it.

### The loads set the flow, not the plant

`autoSizeForFlow` sizes a closed circuit so the equipment gets its rated flow.
**Which equipment** is the question, and the answer is the LOADS (Michael,
2026-08-04). A heat exchanger states the flow it needs to move its duty — a
demand on the circuit. A source/sink's rated flow is a **selection** figure:
what the machine was bought for, and plant is routinely selected larger than the
load it serves today.

Taking the largest rating across all equipment produced `debug/20260804-1.json`:
a 100 kW chiller rated 1.6 L/s beside a 50 kW coil rated 0.798 L/s — a chiller
deliberately selected to run at half load. The sizer drove 1.6 L/s through the
coil, 2.006× its rating and therefore **4.02× its pressure drop**: 805 kPa
against a rated 200, and a pump duty of 102.7 m. Nothing was wrong with the
arithmetic.

Sized on the coil, the chiller passes 0.798 L/s and drops
`200 × (0.798/1.6)² = 49.7 kPa`, and the duty falls to **25.5 m**. That half of
it needed no code at all: equipment has always been `r·Q²` from its own design
point, so a machine at part load drops what the square law says. It never got
the chance, because the flow was wrong.

Two consequences. An **isolated** machine no longer sets the target — a chiller
valved out states nothing about the circuit it is not in. And a source/sink
**below** its rating no longer raises `EQUIP_OFF_RATING`: part-load plant is
normal operation and is now the deliberate result of this rule. Over-flow is
still called out for everything, because that is the square-law trap the check
exists for. A plant-only circuit still sizes on the plant — with no loads, the
plant is the only statement of what flow the circuit wants.

### Three equipment types

**Adiabatic** joined the two below on 2026-08-05: a filter, a strainer, a flow
meter. Real pipework with a real pressure drop and no thermal properties at all.
It is a TYPE rather than a duty of zero because *"no thermal behaviour"* and
*"a duty that happens to be zero"* are different statements — only the first
should hide the thermal fields, refuse to be a control target, and stay out of
the set of loads that sizes a circuit. It keeps its hydraulics: losing a
strainer's ΔP would be a worse error than losing its thermal side.

### Two equipment types, split on what you know at design

Michael's, 2026-08-03. The solver only ever needs `Q = f(T_in, ṁ)`, so the
question is not what a machine *is* — the tag already says that — but which
quantity you can state.

| Type | State | Follows | Limits |
|---|---|---|---|
| **Source / Sink** — chiller, boiler, tower | leaving temperature | duty | capacity, ΔT max, T limit |
| **Heat Exchanger** — AHU, FCU, plate HX | load | temperature | ΔT max, T limit |

Three things about the limits are worth knowing:

* **Capacity and ΔT max both matter**, because they bind in different places.
  At high flow a small ΔT is still a big duty, so capacity binds; at low flow a
  small duty is still a big ΔT, so ΔT max binds. The tests demonstrate the same
  machine swapping from one to the other at a quarter of the flow.
* **T limit is the second law**, not a control choice. A tower cannot go below
  wet bulb, an economizer below ambient. It is also the *secondary temperature
  in disguise* — on a coil it is the entering air — which means an effectiveness
  model, if it is ever wanted, is one more field on the same type rather than a
  restructure.
* **Which limit bound it is reported**, per link and as an `EQUIP_LIMITED`
  warning. "CH-01 is limited by Capacity and is not reaching its setpoint" is
  the sentence worth having; a leaving temperature that silently misses its
  setpoint is not.

**The T limit is gone from a source/sink** (v0.12.2). It clamped the leaving
temperature at a physical bound — wet bulb on a tower, ambient on an economizer.
Michael's instruction, 2026-08-04: *"let the engineer evaluate."* Whether a
leaving temperature is achievable is a judgement about the **selection**, and
clamping it silently produced an answer that looked achieved when no machine
could have done it. Capacity and Design ΔT still bind: those are nameplate
figures, not judgements. An exchanger keeps its T limit, where it is the
entering-air temperature in disguise — a stated condition rather than a
judgement.

`dTMax` is now labelled **Design ΔT**, and on a source/sink it is one of three
stored figures rather than a limit bolted on: design flow, Heating/Cooling
Capacity and Design ΔT are `Q = ṁ·Cp·ΔT` exactly as on an exchanger, and go
through the same `M.setEquipTrio`. The difference is that a source/sink stores
all three — they are all nameplate — so the third is rewritten on every edit
rather than derived on read.

Sign is inferred, never selected: a setpoint below the inlet is cooling.
`dTMax` is a magnitude.

**Capacity is SIGNED** (v0.11.2), on the same convention as a load: `+` adds
heat to the fluid, `−` removes it. A chiller carries a negative capacity and
therefore *cannot heat*, however its setpoint is set — asked to work the wrong
way it delivers nothing, reported as `Capacity (wrong direction)` rather than
quietly reversing. Blank is unlimited in both directions, and zero is read as
unstated rather than as "can do nothing", because a field cleared to 0 reads as
unset. This is the one change in v0.11.2 that can alter an existing model: see
`KNOWN-ISSUES.md`.

### Design flow, load and ΔT are ONE equation

`Q = ṁ·Cp·ΔT`, so only two of the three are ever independent. **Editing one
recomputes whichever you touched least recently, holding the other**
(`M.setEquipTrio`, Michael's rule 2026-08-03). Set the flow, then the load, and
ΔT follows; then change ΔT and the *flow* moves, because the load is the newer
statement.

The alternative — always rewriting the same partner — is not a matter of taste.
It is what produced `debug/20260803-1.json`: a 50 kW coil given a 15 K ΔT had
its design flow silently rewritten from 20 to 0.8 L/s, and the pump was then
sized to push 20 L/s through a machine rated for 0.8. Equipment ΔP goes as the
square of the flow ratio, so 25× flow is 625× the drop; the AHU alone came to
12 768 m of the 12 792 m duty — 1252 bar, every step of it arithmetically
correct and nothing anywhere saying so. Correcting the design flow returns the
same model to 44.85 m, which is exactly what its pump curve was fitted for.

Two consequences elsewhere. `EQUIP_OFF_RATING` now reports any machine sitting
more than `warn.equipFlowRatio` (default 2) away from its rated flow, with the
pressure drop that follows from it. And the edit history lives on the model as
`equip.lastEdited` — UI state, stored deliberately, because reopening a file
must not silently change which field moves next. Absent, it reads as
`['qRated','duty']`, which is how the panel behaved before any of this existed.

On an exchanger, **Q, ΔT and ṁ are locked** by `Q = ṁ·Cp·ΔT`, so the panel
offers both and each rewrites the other at the rated flow. The model stores the
duty; the engine only ever sees one quantity.

### The active set — and the check-valve lesson, again

A limit makes the system **piecewise** linear: which branch of an equipment
relation applies depends on its inlet temperature, which is what the solve
produces. So the active set is **frozen**, the now-linear system is solved
exactly, the set is recomputed from the answer, and it repeats until nothing
changes. Two or three passes in practice, capped at 30 with a
`THERMAL_LIMIT_OSCILLATION` warning.

Freezing it is the whole trick, and it is the same trap check-valve seating
taught (§6): **decide from a stable quantity, not from the answer being
computed.** The deciding quantity here is the inlet temperature that the
previous pass fixed, so a pass cannot flip a limit on the strength of a duty it
is itself producing.

### One toggle serves DESIGN and SIMULATION

It looked like two features when it was asked for. It is one:

| Mode | States | Follows | In SIMULATION |
|---|---|---|---|
| `dT` | the temperature difference | `Q = ṁCpΔT` | ΔT held, duty floats with flow — a coil under control |
| `dQ` | the duty | `ΔT = Q/ṁCp` | duty held, ΔT floats — a fixed load: IT, process, electric heater |

Those two are not approximations picked for convenience. They are the
**asymptotes of the real effectiveness model**,
`Q = ṁCp(T_in−T_sec)(1−e^(−UA/ṁCp))`: at high flow it tends to constant duty,
at low flow to constant ΔT. So they bracket the truth and each is *exact* for a
real class of plant. The effectiveness model itself needs exactly one number the
app does not have — the secondary-side entering temperature — with `UA` derived
from the design point the same way an outflow's K and equipment's ΔP already
are. That is the next step if it is wanted, not a rewrite.

Pumps and valves pass temperature straight through, at Michael's instruction. A
pump does put its shaft work into the water, but at typical duties that is
hundredths of a kelvin and stating it would imply a precision the rest of this
does not have.

### The reference temperature — and why AMBIENT counts as one

A **source** holds its supply temperature. Failing that, **the pipework's
exchange with ambient is itself a reference**: a loop with a load and bare pipe
is not indeterminate, it heats up until the pipes shed what the load puts in,
and where it settles is the answer.

That distinction was got wrong first. Pinning happened whenever there was no
source, which held Michael's 100 kW loop at the flow temperature and reported a
system that never warms — the opposite of the truth. A pin is now used only when
there is **no source AND no ambient coupling**: a genuinely adiabatic circuit,
which is a balanced chiller and coil round insulated pipework, where the level
really can sit anywhere. Reported as `THERMAL_DATUM`, never silent.

`h = 0` on the surface coefficient means **adiabatic**, not "unset". It is the
only way to express a sealed circuit, and substituting a default there would
quietly reinstate the heat exchange the engineer had switched off.

### The pressure plausibility guard

The same idea as the runaway guard below, applied to pressure, and added for
the same reason: `debug/20260803-1.json` reported a pump duty of **1252 bar**
with `converged: true` and no errors. Every step of the arithmetic was right —
an AHU rated 0.8 L/s was carrying 20 L/s and dropping 125 000 kPa, and equipment
ΔP goes as the square of the flow ratio. `EQUIP_OFF_RATING` (v0.11.2) names the
cause, but a warning sitting under a plausible-looking figure is the wrong shape
of response to a system nobody will build.

So a component ΔP or pump duty past `warn.maxComponentPD` is an **error**: it
clears `converged` and takes the status chip. The figures are still reported —
the answer is not wrong, it is implausible, and hiding it would leave nothing to
diagnose from.

The 2000 kPa default is a judgement, not sourced data: building services
pipework is PN16, PN25 on tall risers, so a *single component* dropping more
than 20 bar is not a building services problem. Adjustable on the HYDRAULIC tab,
0 disables it. **A shut valve is excluded** — `CLOSED_R` is a numerical device
for "no path through here", not a claim about a pressure, and a standby leg
behind a closed valve is an ordinary thing to draw.

### The heat balance, and the two terms that are not link duties

The CALCULATION sheet's Thermal section leads on the **residual**: at steady
state everything put into the water comes out of it, so it is zero by
definition. It needs no reference temperature and no hand calculation to read,
which is what makes it the one figure worth putting first.

`imbalance` — the sum of link duties — only closes on a **sealed** circuit. Two
terms were missing, and both are real physics rather than bookkeeping:

* **`sourceDuty`** — a source HOLDS its stated temperature whatever arrives, so
  it is a heat source in its own right; an infinite reservoir does not warm up.
  The energy is the flow through it times the difference between what it holds
  and what it would otherwise have mixed to. On a sealed circuit with a fill
  connection this is where a plant shortfall appears: the fill quietly absorbs
  it. `examples/stacked-riser.pnet.json` shows exactly that — 150.2 kW of coils
  against 143.9 kW of chiller, and 6.3 kW absorbed at the fill.
* **`boundary`** — energy the water carries out of an OPEN system when it leaves
  at a different temperature from the one it entered at. Independent of the
  temperature datum, because mass is conserved and an arbitrary offset in T
  cancels between the two sums.

**And a significant `sourceDuty` is now a WARNING** (`HEAT_IMBALANCE`, v0.14.2,
Michael's instruction). Measuring it was not enough: a plant that cannot keep up
would otherwise report a perfectly plausible answer while the fill quietly does
impossible work.

Worth being clear that the BEHAVIOUR is not new — a reference node has held its
temperature whatever arrives since v0.10.0, the first thermal commit. The only
version of it anyone ever saw was a thermal RUNAWAY, and only in models where
nothing pins the temperature at all: there the surplus has to raise the water
until the pipework sheds it. Put a source or a pinned datum in the same model
and it vanishes instead, which is the worse failure of the two because a runaway
announces itself.

The threshold is relative — `warn.heatBalance`, default 2% of the circulating
duty — because a fill connection legitimately carries a trickle and a watt on a
100 kW plant is noise.

**And it is usually a DRAWING problem.** Michael's objection, 2026-08-05: an
expansion tank tees off the return with no flow through it, and can only lose a
trickle by conduction at the tee. He is right, and so is the app — a source only
imposes its temperature on water that flows THROUGH it, and no water flows
through a dead leg. Run the same circuit twice:

| Fill connection | Absorbed | Reported |
|---|---|---|
| In the return line | −20.0 kW | `HEAT_IMBALANCE` |
| On a dead-leg tee | **0.0 kW** | nothing |

So `HEAT_IMBALANCE` most often means *"your fill is in the flow path"* — which
makes it a mains connection rather than an expansion tank.
`examples/stacked-riser.pnet.json` was drawn that way and has been corrected;
its 6.3 kW was the example's fault, not the model's.

`residual = pipeLoss + equipDuty + sourceDuty − boundary`, and it closes in all
three cases. `imbalance` is kept beside it because every sealed-circuit
expectation in the suite reads it, and for a sealed circuit the two are the same
number.

The section also lists **every pipe**, including the ones that move nothing. A
zero row on a well-insulated main is a result rather than clutter, and leaving it
out makes the total impossible to check by adding up.

### The runaway guard

The solve is exact, so nothing runs away numerically — but a correct answer can
still be absurd. 100 kW into 120 m of lagged DN100 settles at **4454 °C**,
because that is what the arithmetic says about a system that cannot exist.
A temperature outside `thermal.tempMin … tempMax` is therefore an **error**: it
clears `converged` and takes the status chip, because every number downstream is
conditional on it. The temperatures are still reported — the answer is not
wrong, it is implausible, and hiding it would leave nothing to diagnose from.

The band is adjustable and has to be. The default ±50 °C suits chilled water and
**trips on any LTHW system**; the test suite demonstrates that at 80 °C flow.

### Unverified data, carried with teeth

Two data sets in this module were **not** transcribed from a page, which is a
deliberate exception to the "never invent engineering data" rule and was agreed
with Michael on the understanding that they are flagged until he checks them:

* **Propylene glycol properties** (`data/fluids.js`) — written from recollection
  of ASHRAE Ch 31. Cp is the one to check first: it scales every thermal duty
  *linearly*, and unlike a friction factor there is nothing downstream to absorb
  an error.
Insulation thickness is no longer among them. It moved onto the **pipe
schedule** (v0.10.1), where it sits beside bore and outside diameter as a
physical property of the pipe, with Michael's own rule as the default — 25 mm
below DN50, 50 mm from DN50 up. That is a decision rather than a transcription,
so it is not flagged; a pipe's own `insulation_mm` still overrides it, including
0 for a bare pipe.

Both carry `verified: false`, both are listed by an `unverified()` helper, and
the flag appears beside the control, on the THERMAL tab **and on the calculation
sheet**, which is the thing that gets issued.

## 14B. Messages

`docs/MESSAGES.md` is the catalogue: every coded error, warning and notice, what
raises it, and which setting drives its threshold. Written 2026-08-05 as the
first step of the UX pass towards 1.0.

**The codes are the contract.** Wording may be tightened; a code should not
change without a reason, because it is what the sheet, the status chip and any
future consumer key off.

`engine.test.js` checks the catalogue against the source in BOTH directions —
every emitted code must be documented, and nothing documented may have been
removed from the app. A catalogue that quietly falls behind is worse than none,
because it reads as complete.

## 14C. DXF export (EXPERIMENTAL)

`src/dxf.js`. Writes the DRAWING — pipework, risers, device symbols and text.
No properties, no results, no calculation sheet; Michael's scope.

**R12 ASCII**, because it is plain text — group-code/value pairs and a fixed
section order. That matters more here than anywhere else: the app has no build
step and must run from `file://`, so a binary writer or a library dependency
would break the constraint everything else is shaped around (§2.1). R12 also
needs no object handles, no class table and no extended entity data, and the
four entities used — LINE, CIRCLE, ARC, TEXT — have been readable since 1990.

**Model space, in metres, at true size, with real Z.** No transform at all: the
app already stores world coordinates in metres, which is exactly what DXF wants,
so this exporter is *simpler* than the SVG one in `printer.js` — that has to fit
a building onto a page. Elevation becomes Z, so a riser exports as a genuine
vertical line and the model opens as a 3D layout rather than a stack of
unrelated plans.

One layer per level and per kind of content (`FPC-Level_1-PIPE`,
`FPC-RISERS-RISER`), so anything can be frozen independently. Non-ASCII is
transliterated — R12 has no escaping and no UTF-8 guarantee, so a Δ in a tag
would come out as mojibake in a reader that assumes the drawing's own code page.

**EXPERIMENTAL, and honestly so.** `geometry.test.js` checks the structure —
sections in order and balanced, the layer table matching the layers actually
used, metres at true size, risers vertical — but nothing in this environment can
open the file in AutoCAD or BricsCAD. That is the "no pixels" limit one step
further out. Until it has been opened in a real CAD package, *"it should work"*
is the strongest claim available.

## 15. Testing

Seven suites, 1649 assertions, no dependencies:

```
node test/engine.test.js     schedules, fittings, units, hydraulics, solver
node test/model.test.js      model, levels, network building, annotations
node test/geometry.test.js   rigid edits, conflicts, repair
node test/supply.test.js     pump sizing, supply adequacy, pressure-driven
node test/closed.test.js     closed circuits, off pumps, equipment, tags
node test/simulation.test.js DESIGN/SIMULATION, pump curves, parallel pumps
node test/thermal.test.js    heat loss, mixing, equipment duty, fluid data
```

All 1032 pass. The "Parallel pumps share in DESIGN" section of
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

## 15D. Modifier keys come from the pointer event

`shiftDown` was set on `keydown` and cleared on `keyup`, and **a keyup that
arrives somewhere else never clears it**. Hold Shift, Alt+Tab away — and
Shift+Alt+Tab *is* the reverse application switch, so this is a gesture people
make on purpose — and the release goes to the other window. It stays true for
the rest of the session.

Shift suppresses 15° angle snapping, so the symptom is *"pipes stopped snapping
to 15 degree angles"* with nothing in the model to explain it and nothing in the
snap code wrong: `angleSnap` had not been touched since v0.4.0.

Every pointer event carries `shiftKey` as it actually is at that instant, and a
`pointermove` always precedes the click that would use it, so **the pointer event
is the authority** and stale state cannot survive one mouse movement. The key
handlers and a `blur` listener stay as belt and braces.

The general rule: **do not mirror input state you can read directly.** A mirror
has to be invalidated, and the invalidation is what goes missing.

## 16C. Pump sizing: what may be written back, and what may not

Three modes, and the difference is only WHERE the numbers come from.

| Sizing | Design flow | Design head | Curve |
|---|---|---|---|
| `auto` | the solve writes it | the sizer writes it | generated from the duty |
| `manual` | **typed** | **typed** | generated from the duty |
| `curve` | **typed** | **typed** | **pasted** |

Two rules follow, and both were broken until 2026-08-06.

**The sizer writes back ONLY on `auto`.** `recordDesignPoint` wrote the solved
flow over `qDesign` for every running pump, so "Manual" meant manual until you
pressed Solve. Michael: *"When the pump is in Manual size mode, the system
overwrites manually input values."*

**The curve is generated by the SIZER, not by the panel.** `M.generateCurve`
lives in `model.js` for that reason. A pump drawn and left alone is
`{mode:'auto', head:20}` with no `sizing` field at all — `insertInline` creates
it and the panel used to be the only thing that ever filled one in — so
switching to SIMULATION asked for a curve the app had already worked out the
duty for. `M.pumpSizing(p)` derives the effective mode so that a pump nobody has
clicked on reads the same everywhere.

On `auto` the curve is built from **`pump.head`**, not from `hDesign`. The head
is what the sizer wrote and what the solver ran on; `hDesign` is a report of it,
written back after the solve, and reading it would build the curve from the
previous duty on any path that regenerates without solving first.

**A running pump goes back to the mode its sizing implies.** Both toggles — the
panel's and the drawing's — set `mode = 'auto'` unconditionally, so isolating a
manually-sized pump and putting it back handed it to the sizer. `M.pumpRunMode`
is the one answer.

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

## 17E. The four modes, and why DESIGN and SIMULATE stay separate

Michael asked (2026-08-06) whether the two are still different enough to be
modes, or whether they should merge and show simulation values throughout. They
must stay. They are not two views of one calculation — they are **different
boundary conditions**, and every one of these is a genuine `if` in the engine:

| | DESIGN | SIMULATION |
|---|---|---|
| An outflow is | an **imposed flow** | a **resistance**, `K = Q/√ΔP` — it takes what it is given |
| A pump is | a fixed head the sizer solves for | its **curve**; the operating point is curve ∩ system |
| `autoSizePumps` | runs | skipped — the duty is an input |
| VFD speed | ignored (§17C) | applied, scaling the curve |
| Control loops | not run | `runControls` runs |
| Parallel pumps | need a synthesised droop characteristic | real curves already remove the degeneracy |

DESIGN asks *"what size must this be for these flows?"* — flows given, sizes the
answer. SIMULATION asks *"given these sizes, what happens?"* — sizes given, flows
the answer. **Merging them would remove the ability to size anything**, and
SIMULATION cannot even start without a curve, which is something DESIGN produces.

**One thing WAS hybrid, and it is gone (2026-08-06).** `res.actual` — a
pressure-driven second pass reported in brackets — was computed in DESIGN, and
it was a simulation-shaped number in a design answer. Michael asked for it out.

It turned out DESIGN was the only place it was ever READ: in SIMULATION
`simulationReport` supplies every terminal's actual flow and always won the
ternary choosing between them. So it is not moved to SIMULATION, it is **gone** —
running it there would be the same question answered twice, once properly (every
outflow a resistance) and once as an approximation.

Nothing is lost. In DESIGN the demands IMPOSE the flow, so the honest report of a
system that cannot meet them is the **negative pressures already in the table**:
they are the shortfall in head, which is what you size the pump against.
`actualDelivery` itself stays, and stays tested — it is a sound pass and the
gravity case in `supply.test.js` is the best test of it there is — it is simply
not wired into the solve.

### A mode is a tool palette; two of them also set the calculation

DESIGN draw it · CONTROL wire it up · SIMULATE run it · ANNOTATION arrange it.

DESIGN and SIMULATE set `calcMode`, because it would be strange for the button
named SIMULATE not to simulate. **CONTROL and ANNOTATION deliberately do not.**
A control link only does anything in SIMULATION, so forcing CONTROL back to
DESIGN would blank every valve position at the exact moment you went to look at
them. `app.uiMode` is the single answer to "where am I", and picking a tool from
anywhere pulls the ribbon to the mode that tool lives in, so the palette and the
tool cannot disagree.

Tools are grouped by **what the thing is** — Pipe, Hydraulic, Thermal, Valves —
with the group named on the ribbon, so a tool is found by asking "what am I
placing?" rather than by remembering where it sits. The valve type was a
dropdown and the equipment type was not choosable at all (you placed generic
equipment and then found Type in the panel); both are buttons now, one per kind,
carried as a `data-variant` on a single tool so that hit-testing, insertion and
the mode hint stay one code path.

## 17F. The property panel: three levels

    L1  what is selected       the panel heading
    L2  a category of data     a collapsible section
    L3  the individual fields

Every device is built from the same sections in the same order — **Details,
Design, Actual, Control, Display** — so the panel does not rearrange itself
between one device and the next. "The flow it is actually doing" is in the same
place on a pump as on a coil.

**Open/closed is remembered per SECTION NAME, not per device**, in
`localStorage`. `renderProperties` rebuilds this DOM from scratch on every solve,
so the state cannot live in the elements; and keyed by name, collapsing Display
collapses it everywhere, which is what someone who does not use it wants.

Two rules that fall out of it:

* **A value that is not yours to type is shown, not hidden.** A pump's design
  duty is editable on Manual and read-only on Auto and Curve. Hiding it made the
  panel change height and shuffle everything below it whenever the dropdown
  moved, and left you unable to read the duty the sizer had chosen without
  switching to Manual.
* **Display is always present.** It used to appear only while the VIEW tool was
  active — a control you had to already know about, since you cannot discover it
  from a different mode. As a section it costs one line closed.

`field()` returns the CONTROL, not the wrapper, because that is what callers
wire their change handler to. `fieldLabel(control)` goes back up for the
`<label>`; doing it inline reads as though `field` returned the wrapper.

### One panel per DEVICE, not per model class

`renderValveProps` renders three panels and `renderEquipProps` renders three,
because that is how many devices those two model classes actually cover. A
control valve has a position and may follow a setpoint; an isolation valve is
open or shut and that IS its status; a check valve has neither. Giving all three
the same fields meant two of them showed controls that did nothing.

**Globe is the control valve**, matching `M.canControl` — *not* `type.adjustable`,
which a gate valve also has. A gate valve can sit part-open and the solver
interpolates its Kv, but it is not a regulating device, so offering it a 1%
slider invites modelling something nobody installs. An existing gate valve left
part-open keeps its slider, so no drawn model loses a setting silently.

### A cooling load reads positive

*"Cooling Load : xxx kW"*, not *"−xxx kW"*. The sign convention is about the
FLUID and it is right — negative means heat removed — but nobody writes a
chiller's duty with a minus sign on a schedule, and a panel that does looks like
an error. **Display only**: the stored value keeps its sign, and every
calculation, message and export still sees it, because the convention is what
makes the heat balance add up (§18).

The same reasoning gives the load a **Heating/Cooling switch** instead of a typed
minus sign. Typing a signed number still works and MOVES THE SWITCH — someone who
knows the convention should not be fought, and silently discarding their sign is
how you teach them the app does not listen.

### The ribbon is two rows

Chrome on top — file, mode, overlays — and the mode's tools underneath, which is
the only part that changes. One row wrapped onto three at any real screen width,
and wrapping put the group labels somewhere strange: they are absolutely
positioned over their cluster, so a wrapped cluster leaves its label floating
over whatever landed there instead.

A trap worth remembering: **`display: flex` beats the user agent's
`[hidden] { display: none }`** — same origin, higher specificity — so every
mode's tools rendered at once until `.tool-set[hidden]` was added explicitly.

## 17A. UI text is terse

A control gets a label. If a note is genuinely required it goes behind a 🛈
hover, and it is brief even there. The audience are Building Services Engineers
and they do not need a function explained to them.

Long explanatory paragraphs in a panel are a **bug**, not documentation. The
reasoning belongs in these files, where it costs no one a scroll — which is
also why the comments in the source are as long as they are. Michael's
instruction, 2026-08-03; roughly 40 lines of panel prose came out of THERMAL,
the fluid selector, the schedule table and the device panels at v0.10.2.

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
