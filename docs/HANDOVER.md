# Handover

Written 2026-07-30, rewritten 2026-08-03 (v0.11.0), for whoever picks this up next
— most likely a fresh Claude Code session with none of the preceding context.

**Read `ARCHITECTURE.md` before changing anything.** This document covers what is
in flight, what is broken, and what is waiting on Michael. It does not repeat the
architecture.

---

## 1. What this is

FreePipeCalc (FPC) — an offline piping friction-loss calculator for Building
Services Engineers. Single-page HTML app, no build step, no network. Draw a
multi-level water network, get friction losses, flow distribution including
loops, and pump duty. MIT freeware.

Michael is a Building Services Engineer. He wrote the specification
(`docs/piping-friction-loss-spec.md`) and is the only person who can sign off
whether a result *looks* right to someone who sizes pipes for a living.

Run it: open `index.html` in a browser, or serve the folder over HTTP.
Tests: `node test/<name>.test.js` — seven files, **1635 assertions, all passing**.
(The datacentre parallel-pump baseline in `simulation.test.js` was regenerated
2026-07-30 after the model was rebuilt by hand — see §2.)

---

## 2. Where things stand (v0.11.0, 2026-08-03)

Nothing is BROKEN. The engine is green at **1032 assertions** and the repository
is published privately at `github.com/michaellky-glitch/FreePipeCalc`.

The big change since v0.5.0 is the **ASHRAE (2021) method**, now the default —
see `ARCHITECTURE.md` §2.3 and §7. Two things about it matter more than the
rest:

* A link can carry **two loss terms with different exponents** (pipe at 1.852,
  fittings at 2). Anything reconstructing a loss from a link **must** call
  `FD.hydraulics.linkLoss(link, q)`. Reading `link.r` alone silently omits the
  fittings — the number still looks like a pressure drop, it is just too small.
  Ten call sites did exactly that and were caught only because the
  energy-balance and critical-path reconciliations stopped adding up.
* The Hazen-Williams constants are **derived from the printed ASHRAE ones**
  (6.819 / 1.852 / 1.167), not hard-coded. `settings.hw.A` no longer drives the
  default method; `settings.ashrae.K` does.

### Which Hazen-Williams constant is used (not a defect)

The app derives its coefficients from ASHRAE Ch 22 Eq (6) **as printed**
(K = 6.819, a = 1.852, e = 1.167), at Michael's request:

    A = 6.819·(4/π)^1.852 = 10.6663      e = 1.167 + 2·1.852 = 4.8710

Verified 2026-08-02 against Michael's own spreadsheet, which evaluates the same
velocity form: the two agree to **1e-14** — they are the same calculation.

Two things to know before anyone "fixes" this:

* **A hand calc done in the conventional FLOW form** (A = 10.67, e = 4.8704)
  lands 0.14% away. That is the rounding baked into the published 10.67, not an
  error here. The older `HW` method in this app still uses those constants, and
  the HYDRAULIC formula constants are editable, so either route reproduces a
  10.67 hand calc exactly if that is ever wanted.
* **Check the units before chasing a difference.** 1 m wg = ρg = 998 × 9.81 =
  **9.79 kPa**. A reported mismatch on 2026-08-02 turned out to be a m-wg-to-kPa
  conflation plus rounded spreadsheet inputs (V to 3 s.f. and bore to 52.5 mm
  instead of 52.48 — worth 0.12% and 0.04% respectively, because V is raised to
  1.852). Nothing was wrong with the code.

### What is outstanding

| Item | State |
|---|---|
| **Darcy friction-factor correlation** | **CHOSEN: Swamee-Jain** (2026-08-02). Darcy is now BETA rather than blocked, and carries a BETA line on the calculation sheet. Accuracy measured against an iterated Colebrook in `engine.test.js`. |
| **Pump properties restructure** | **Done, v0.7.6-dev.** Head removed as a settable parameter, New curve… button jumps to TOOLS pre-filled, order is Pump ID / Tag / Direction / Status / Design box (Re-size) / Actual box (New curve, Paste, Show, Clear), explanation behind a 🛈. Appearance unsigned — see `Human-Test.md` 4B.6–4B.9. |
| **Outflow in SIMULATE** | **Done, v0.7.6-dev.** Design box + actual box, like equipment. The flow WAS verified to be `Q = Q_d·√(P/ΔP_d)` — see §2A. |
| **Human-Test ⚠️/❌ follow-ups** | Five left in `KNOWN-ISSUES.md`: intermittent undo, negative pressure should be red, riser marker placement/direction, riser node→pipe not connecting, light theme greyness. (The pressure gradient is done, v0.7.7-dev.) |
| **Independent verification** | Still the biggest gap. Nothing has been checked against another tool or a job with known answers. |
| **Printer does not draw devices** | `printer.js` strokes device links as plain pipe with no symbol — now inconsistent with the canvas. In `KNOWN-ISSUES.md`. |

### 2B. What the NFPA 13 table moved, and what is still provisional

Both test fixtures are Hazen-Williams models, so this change hit every baseline
in `supply.test.js` and `simulation.test.js`. The movement was checked before
the numbers were updated, and it decomposes cleanly:

* **Elbows and branches barely move.** At DN100 a 90° elbow goes from
  30 × 0.10226 = 3.068 m to the printed 3.0 m, and a tee-branch from 6.136 m to
  6.1 m. Two independent sources agreeing to ~2% is a good sign for both.
* **The straight-through tee went to ZERO** while its row was blank, then came
  back when Michael supplied Carrier's values, and the default then moved to
  Carrier throughout:

| Basis | 3-floor duty | Data centre, 1 pump |
|---|---|---|
| L/D ratios | 41.95 m | 271.2 kPa |
| NFPA 13, tee-run blank | 39.49 m | 263.7 kPa |
| NFPA 13 + Carrier tee-run | 41.92 m | 269.7 kPa |
| All Carrier (**default**) | 41.96 m | 270.1 kPa |

**The agreement is the check, not any one number.** Three published sources —
and the L/D ratios they replaced — land within 1% of each other on both models,
having never been fitted to one another. Carrier's tee-run is within 0.25% of
the old L/D value at DN100 (2.04 against 2.045 m); Carrier's elbows and branches
sit a little above NFPA's (3.05 against 3.0 m, 6.40 against 6.1). The data
centre model swings furthest on the tee-run row because it has ELEVEN of them.

None of these are hand calculations, and the test comments say so. What is
hand-checkable is the conversion: Carrier is stored in feet and converted at
`ft × 0.3048` to 2 dp, and that reproduces Michael's own metric conversion of
the same table cell for cell.

One test changed rather than being renumbered. `simulation.test.js` asserted
that `PUMP_RUNOUT` fires on the N+1 failure case, and it passed only because the
survivors happened to sit a shade over the fixture's 120% limit. With the tee
allowance gone the system curve flattened, the survivors came to rest at 119.8%,
and the warning correctly stopped firing. The test now sets the threshold either
side of the actual operating point and checks the warning both fires and stays
silent — which is what "does the warning work" means, and is not hostage to
where a fixture lands.

### 2C. The thermal module — the two things waiting on Michael

Both are data that was **not** transcribed from a page. That is a deliberate
exception to the "never invent" rule, agreed with him on the understanding that
it is flagged until he checks it. Do not quietly promote either to `verified`.

1. **Propylene glycol properties** (`data/fluids.js`, `verified: false`).
   Written from recollection of ASHRAE Ch 31. **Cp is the one that matters**: it
   scales every thermal duty linearly, and unlike a friction factor there is
   nothing downstream to absorb an error. Water is not in question — 998 and
   4187 are the app's own long-standing values and were deliberately NOT nudged
   to the textbook 998.2 / 4182, because that would have moved every pressure
   and every duty in every existing model for 0.02%.
2. **The outside surface coefficient** (8 W/m²·K) is a default, not sourced
   data. On an insulated pipe it is a small part of the resistance; on a BARE
   pipe it is the entire resistance, so a bare-pipe answer is only as good as
   that number.

Insulation THICKNESS is no longer on this list. It moved onto the pipe schedule
in v0.10.1 with Michael's own rule as the default — 25 mm below DN50, 50 mm from
DN50 up — which is a decision rather than a transcription. A pipe's own
`insulation_mm` still overrides it, **including 0**: a deliberately bare pipe
must not pick up its schedule's figure.

Both flags surface beside the control, on the THERMAL tab, and on the
CALCULATION SHEET — which is the thing that gets issued.

**What SIMULATION does for equipment**, since it was the open question: one
toggle, `dT` or `dQ`, serves both modes. In SIMULATION `dT` holds the difference
and lets duty float (a controlled coil); `dQ` holds the duty and lets the
difference float (a fixed load). Those are the asymptotes of the real
effectiveness model, so they bracket the truth and each is exact for a real
class of plant. Adding the effectiveness model itself needs exactly one new
field — the secondary-side entering temperature — with UA derived from the
design point. `ARCHITECTURE.md` §18.

### 2E. The 100 kW no-rejection case, and what it changed

Michael asked for it as a test: a 100 kW load with nothing to reject the heat,
which should settle where the pipe loss equals the load. It found two things.

**The datum pinning was wrong.** Pinning happened whenever there was no source,
which would have held that loop at the flow temperature and reported a system
that never warms. Ambient IS a reference — a loop with a load and bare pipe is
not indeterminate. A pin is now used only when there is no source *and* no
ambient coupling at all.

**Gauss-Seidel was the wrong method.** The loop converges at a rate set by how
strongly it is tied to ambient, so 200 passes left the energy balance 69 kW out
on a lagged loop. Every relation in the module is affine in temperature, so it
is now assembled as one linear system and solved with `FD.solver.solveLinear` in
a single pass. Exact, and it retires "did it converge?" — never a physical
question for a linear system.

The loop settles at 63–64 °C for 100 kW into 800 m of bare DN100, with the
energy balance closing to 0 W. Lagged, the same load solves to 4454 °C, which is
the right answer to a system that cannot exist — and is what the **runaway
guard** is for. Michael offered that as an alternative to the equilibrium; it is
kept alongside it instead, so the answer is correct AND an implausible one is
flagged. Band adjustable, defaulting to ±50 °C, which trips on any LTHW system.

### 2D. A second symmetric-split defect, found by a thermal test

The bullhead fix in v0.7.10 tested whether the two charged legs of a tee were
**collinear with each other**. The thermal mixing test then found the same
defect in a geometry that misses: a symmetric **Y**, two legs meeting a common
outlet at 45° each. Not collinear, so nothing caught it — the split came out
51.7/48.3 and the mixed temperature 46.2 °C where symmetry demands 45.0.

`isBullhead` is now `isSymmetricSplit`, and the general statement is to compare
each charged leg's deviation from the **common** leg: if they are equal, nothing
distinguishes them. The bullhead falls out as the special case where both are at
90°. Neither fixture moved, so no baseline changed.

Worth remembering as evidence that a test written for one part of the system is
worth having in another: nothing in the hydraulic suite would have found this.

### Darcy-Weisbach and Swamee-Jain — what was actually verified

Michael selected Swamee-Jain on 2026-08-02 and asked for a test run validating
the friction drop by iteration. That is `engine.test.js` §"Swamee-Jain against
an iterated Colebrook", and the shape of it matters:

* Colebrook-White is solved by a fixed-point iteration **written in the test**,
  not by calling the app's own Colebrook — otherwise the test would only prove
  the app agrees with itself. One point is additionally pinned by *substitution*
  back into Colebrook, so even the iteration is checked rather than trusted.
* The app's Colebrook then matches that iteration to 1e-9.
* Swamee-Jain is swept against it over the whole published validity.

**Two numbers came out of that, and one of them corrected a claim already in
the code.** Within the envelope building-services pipework occupies (Re 1e4–1e7,
ε/d ≤ 1e-3) the agreement is within 0.9%. At the corner of Swamee-Jain's own
stated validity — Re 5000 with ε/d 1e-2, barely turbulent flow in a very rough
pipe — it is 2.8% out. The note in `hydraulics.js` said "within ~1%", which is
the figure everyone repeats and is not true there; it now states both.

An earlier draft of the test asserted f = 0.0182 at Re 1e5, ε/d 1e-4 from
memory. The correct value is 0.018514, and the test failed on it — which is the
`ARCHITECTURE.md` §15 failure mode working as intended. The expectation is now
derived by substitution with the arithmetic written out.

End to end in the app on 100 m of DN50 at 5 L/s: 11.126 m against a
hand-iterated Colebrook of 11.046 m, 0.72% apart — exactly Swamee-Jain's own
deviation at that Re and roughness, so the whole chain (schedule → bore →
velocity → Reynolds → f → r → head loss) is doing what it says.

### 2A. The simulated outflow — verified, and what that does and does not mean

The question asked was whether the outflow flow in SIMULATE really is a function
of node pressure, the design-point K, and the pump curve. It is, and the proof is
algebraic rather than empirical.

The terminal is a link from the outflow node to a virtual discharge node pinned
at the node's own elevation and 0 gauge, carrying `r = ΔP_d/(ρ·g·Q_d²)` at
exponent 2. The head across it is therefore exactly the node's gauge pressure:

    P_node/(ρg) = r·Q²    ⟹    Q = Q_d·√(P_node/ΔP_d) = K·√(P_node)

Nothing else enters. The pump curve acts only by setting `P_node` through the
solve. `simulation.test.js` now holds two new sections asserting this to **1e-9**
across a 1.5× change in K, a change of curve, and two terminals of different K on
one pump — plus a closed-form operating point for two curves. It was
re-confirmed live in the browser: 18.78 L/s at 176.4 kPa against a hand answer of
18.78 L/s.

**What this does NOT establish** is that any absolute number is right. It proves
the terminal model is internally exact and responds to the two inputs it claims
to. Independent verification against another tool is still the biggest gap
(below).

### The tee coefficients — CLOSED

Michael supplied 2021 ASHRAE Fundamentals Ch 22 Tables 3–8 and 27, and decided
**not to distinguish diverging from combining tees**, which is what Tables 3/4
actually tabulate. `TBRANCH_CONV` is 60 (was a guessed 90) and
`FD.fittings.unsourced()` returns empty. Table 7 *does* separate diverting from
mixing and is transcribed in `data/ktable.js`, deliberately **not wired in**: it
reports one "100% mix" coefficient where the app charges a combining tee's two
inlets separately, so mapping it is an interpretation rather than a
transcription. Do not wire it in without asking.

Two real data errors were found and fixed while sourcing this, both worth
remembering as evidence for the "never invent" rule:

* The threaded **45° elbow** column had been *synthesised* as 0.53 × the 90°
  value. The real column is nearly flat with size, so the invention was out by
  up to **250%**. It was plausible, documented, flagged — and still wrong.
* The flanged **gate valve** column was shifted one row, understating every
  size by 17–38%.

---

## 5. Conventions that must not be undone

These were each arrived at by getting it wrong first.

**UI text is terse.** A control gets a label; anything more goes behind a 🛈,
briefly. The audience are Building Services Engineers who do not need a function
explained to them. Long explanatory paragraphs in a panel are a bug, not
documentation — the reasoning belongs in these files, where it costs no one a
scroll. Michael's instruction, 2026-08-03, and it applies to every new control.

**Never invent engineering data.** An unsourced L/D size-correction was written
and then removed because *"an invented correction is not defensible to a checking
engineer"* (`data/fittings.js`). The rule was then vindicated twice over: a *synthesised* 45° elbow column
turned out to be 250% wrong against the real ASHRAE table (§2). If a number
cannot be sourced, ship it flagged or not at all.

**Test expectations are independent hand calculations,** never numbers copied out
of the code. Roughly half of all test failures in this project turned out to be
the *test* being wrong. `ARCHITECTURE.md` §15 records this.

**`file://` must work.** No ES modules, no `fetch()` of sibling files, no
`navigator.clipboard.read()`. Classic `<script>` tags on a global `FD` namespace,
with load order fixed in `index.html` (the harness loads the engine layer and
each suite appends what it needs). The paste EVENT is
used for TRACE and clipboard writes fall back to `execCommand`.

**SI internally, conversion at the edges only.**

**Detection belongs in the engine, not the renderer.** Warnings were once derived
from calculation-sheet rows, so `solveModel()` reported "no warnings" for a
network running at 12 m/s.

**"Converged" is not "correct."** The two failures that best illustrate this:
a model that returned zero flow everywhere with `converged: true` and no errors
(the ring main was not a ring — this is what `disconnections()` now catches), and
the broken example in §2 which solves cleanly and is geometric nonsense.

---

## 6. What changed in the last few sessions

* **THE FLOW DEADBAND WAS FOUR TIMES LOOSER THAN IT READ** (v0.14.5) —
  `max(0.5%, 1e-5 m³/s)`, and on a 0.8 L/s branch the absolute floor is 1.25%,
  which dominated. Three valves on `20260805-5` sat wide open with their
  branches 0.1–0.6% over while a fourth throttled to 59%; Michael expected them
  in between, and was right. Now `max(0.2%, 1e-7)`, and they land at 59 / 67 /
  100 / 100%.
  `CONTROL_NO_AUTHORITY` was **withdrawn** in the same pass: the condition could
  not be told from a device correctly not modulating, at any probe distance.
  A device at full travel with its setpoint met now reports as holding it and
  falls through to its next setpoint if it has one.
* **THE CONTROL-LINK ROUTE** (v0.14.5) — one meaning for `axis`, the 1 m step
  off the pipe expressed as a choice of axis rather than a special case, and
  dragging can now FLIP the axis so the route moves in all four directions.
* **ΔP AND ΔT SENSORS DRAW PROPERLY** (v0.14.5) — the bubble says `ΔP`/`ΔT`
  rather than `T`, and a dotted line with an open square marks the SECOND pipe
  being probed. Without it "Δp 150 kPa" on a drawing does not say across what.
* **PARALLEL BRANCHES BALANCE** (v0.14.4) — `debug/20260805-4.json`: four
  control valves not throttling, and a spurious SETPOINT_LOST. FOUR faults:
  the solve budget was flat at 60 and the fifth device never got a turn;
  park-at-full ran inside the sweep and destroyed the iteration; the direction
  probe nudged 5% and read solver noise; and `no-authority` was being counted
  as a lost setpoint. All four AHUs now land within 1% of rated flow.
  The budget scales and is settable (`control.maxSolves`) — one network solve
  is ~3.5 ms, the whole controlled solve ~200 ms on that model.
* **A FILL ON A DEAD LEG ABSORBS NOTHING** (v0.14.3) — Michael pushed back on
  the heat-absorption idea: an expansion tank tees off the return with no flow
  through it. He was right, and so was the app; what was wrong was my EXAMPLE,
  which drew the fill in the return line where every drop passes through it.
  Corrected, and both cases are now pinned by tests. `HEAT_IMBALANCE` therefore
  usually means "your fill is in the flow path".
  Checking it also found a real defect: a sealed adiabatic loop whose plant
  cannot keep up is genuinely indeterminate, and `THERMAL_SINGULAR` reported a
  flat seed temperature beside `converged: true`. It is now an ERROR.
  **Still flagged for Michael** — Human-Test TH.8.
* **`HEAT_IMBALANCE`** (v0.14.2) — Michael: "a heat imbalance needs to be a
  warning." He also asked whether the behaviour was new. **It is not**: a
  reference node has absorbed any surplus since v0.10.0. The only version anyone
  saw was a thermal runaway, and only where NOTHING pins the temperature — with
  a source or a pinned datum present it vanished silently, which is worse.
  Threshold `warn.heatBalance`, default 2% of the circulating duty.
* **THE THERMAL SECTION on the calculation sheet** (v0.14.1) — Michael's
  request. Three parts: a HEAT BALANCE leading on the residual, equipment duty,
  and pipework heat gain/loss per pipe with a total and its percentage of the
  equipment duty.
  Writing it found a real gap: `imbalance` only closes on a sealed circuit. A
  source HOLDS its temperature whatever arrives, so it is a duty in its own
  right (`sourceDuty`), and an open system carries energy out with the water
  (`boundary`). `residual` accounts for both and closes everywhere. On the
  stacked-riser example it immediately showed the chiller is 6.3 kW short — a
  finding, not a rounding error. `ARCHITECTURE.md` §18.
* **DXF EXPORT** (v0.14.0, EXPERIMENTAL) — `src/dxf.js`, R12 ASCII, geometry
  and text only. Model space in metres at true size with REAL Z, so risers
  export as genuine verticals and the model opens as a 3D layout. Simpler than
  the SVG printer because there is no page to fit to. Flagged experimental
  because the structure is tested but nothing here can open it in a CAD package
  — that needs Michael. `ARCHITECTURE.md` §14C.
* **THE UX PASS on messages** (v0.14.0) — all five observations from
  `MESSAGES.md` §6 acted on: `VALVE_AUTHORITY` → `VALVE_OVERSIZED` (the two
  "authority" messages meant unrelated things), `CONTROL_UNSETTLED` split from
  the new `CONTROL_HUNTING`, a **DEFECT** severity added between warning and
  error, tags used in place of ids, and eight more messages now say what to DO.
  The defect level is the substantive one: "your drawing does not mean what it
  looks like" and "this pipe is a bit fast" were being counted together.
* **`docs/MESSAGES.md`** (v0.13.1) — every error, warning and notice the app can
  produce, what raises it, and which setting drives its threshold. The first
  step of the UX pass towards 1.0. `engine.test.js` checks the catalogue against
  the source in both directions, so it cannot quietly fall behind.
* **The generated pump curve's SHAPE is a setting** (v0.13.1) — shutoff,
  runout flow and runout head as percentages of the duty point, on SETTINGS.
  Changing them regenerates every generated curve; a pasted one is untouched.
* **v0.13.0 — the rest of Michael's list.** In one release:
  - **Dead legs take the temperature of the water they touch**, not the source
    water temperature. One fix for two of his symptoms ("resetting at source and
    dead ends", and "temperature should stay constant on pipes with no flow").
    Each no-flow node is tied to a neighbour found by breadth-first search
    outward from the live water, which keeps the system non-singular.
  - **Risers stack.** A column with two attachments is an established line, so a
    third floor joins it WHERE IT IS instead of dragging the column to the click.
    Skipping floors already worked. `RISER_OPEN_END` flags a column that stops
    in mid-air, drawn on the level it happens on.
  - **Pump sizing modes** — Auto / Manual / Curve. Auto and Manual GENERATE a
    three-point curve from the design point, so a model can be simulated without
    the round trip through TOOLS to retype a duty the app just calculated. The
    TOOLS jump is gone from the panel; the generator stays for advanced use.
  - **Pressure and differential sensors**, the differential built as a reference
    on the in-line sensor rather than a floating object.
  - **Setpoint deficit in red** on a source/sink that misses its setpoint.
  - **Copy/paste properties** in the FILE group. Geometry, ids, tags and control
    links never travel.
  - Heating/Cooling Load on the drawing; the sensor Setpoint toggle now does
    something; the control link's middle segment steps 1 m off the pipe.
* **ADIABATIC EQUIPMENT** (v0.12.6) — a third type, for filters and strainers:
  real pressure drop, no thermal side, not a control target, and not one of the
  loads that sizes a circuit.
* **THE PUMP CURVE IS DRAWN, not just tabulated** (v0.12.6) — "Show table"
  became "Show curve" and puts the chart above the numbers, with the operating
  point on it. The sheet's chart was factored into one shared builder
  (`pumpCurveSvg`) so the two cannot drift.
* **"System flow temperature" is now "Source Water Temperature"** (v0.12.6).
* **A COOLING LOAD WAS UNTYPEABLE** (v0.12.5) — the blocker. `setEquipTrio`
  captured the duty's sign from the STORED value and applied it to whatever was
  typed, so −60 kW came back as +60 kW. The sign is now CARRIED when the duty
  is recomputed (re-flowing a chiller leaves it a chiller) and TYPED when it is
  typed. Also fixed: "blank = unlimited" wrote the wrong field on a source/sink,
  whose capacity lives in `qMax`, so clearing the box did nothing.
* **THE CONTROL VALVE IS EQUAL PERCENTAGE** (v0.12.5) — Michael's table. It was
  near-linear, which gave it almost no authority: 50% open passed 55% of Kv, so
  nothing happened until it was nearly shut. The interpolator had to be fixed
  too — breakpoints were hard-coded to the quarter points and returned NaN for
  any other tabulation. On the mixing rig the valve now does its controlling at
  69% of travel instead of 33%.
* **LOSING THE SETPOINT PARKS AT FULL** (v0.12.4) — Michael simulated an
  overload (110 kW coil, 100 kW chiller) and the loop walked the pump DOWN to
  its 25% floor while the loop ran away to 3000 °C. Throttling a machine that
  is already at capacity delivers less cooling, not more. So when nothing in
  the actuator's range holds the setpoint, it returns to full travel and
  `SETPOINT_LOST` fires: "System is unable to maintain setpoint. Check heat
  balance." Note the trade-off — for a machine holding a LEAVING temperature,
  minimum speed was closer to setpoint; this rule picks delivered capacity.
  `ARCHITECTURE.md` §17C.
* **SETPOINT PRIORITY IS DRAGGED** (v0.12.4) — the panel is a rearrangeable
  list, the same gesture as LEVELS, because the order IS the meaning. Stored as
  `control.order`.
* **CONTROL AUTHORITY** (v0.12.3) — the piece that made the priority list
  actually work. A pump chasing a chiller's Design LWT sat at 100% forever,
  because an unlimited chiller holds its setpoint at ANY flow: zero error at
  every speed, so the search correctly did nothing while the control valve
  strangled the flow on its own at 10% open. A setpoint the actuator cannot
  MOVE is not being held. One probe at full travel settles it; if the error
  does not respond, fall through to the next toggled setpoint or raise
  `CONTROL_NO_AUTHORITY`. Michael's model now runs the pump at 57% holding
  15.0 K with the valve wide open. `ARCHITECTURE.md` §17C.
* **VALVE UX** (v0.12.3) — Isolation valve / Control valve names, opening
  controls disabled under a control link, `VALVE_OVERSIZED` below 10% open, and
  a valve's tag and value box finally DRAWN: `drawValveGlyph` never called
  `drawTag`, so a valve showed neither while every other in-line device did.
* **THE LOADS SET THE FLOW** (v0.12.1) — Michael's diagnosis of the high-ΔP
  problem, and he was right. `autoSizeForFlow` took the largest rated flow
  across ALL equipment, so a chiller selected to run at half load forced its own
  rating through a coil rated half that: 2.006× flow, 4.02× ΔP, 102.7 m of pump.
  Sized on the loads instead it is 25.5 m, and the plant drops what the square
  law says at part flow. `ARCHITECTURE.md` §18.
* **CONTROL PRIORITY** (v0.12.2) — a controller now picks WHICH setpoint it
  follows, with toggles: LWT then Design ΔT on a source/sink, Design flow then
  Design ΔT on an exchanger. A fallback, not a blend — one actuator cannot hold
  two setpoints at once.
* **T LIMIT REMOVED from source/sink** (v0.12.2) — "let the engineer evaluate".
  Exchangers keep theirs, where it is the entering-air temperature in disguise.
* **THE VALVE SLIDER** (v0.12.2) — `.cell-input` (added later, for the editable
  calculation sheet) carries `width:100%` at the same specificity as `.tiny-num`
  and later in the file, so the number box took the whole row and the range
  collapsed to its thumb. A visual-only regression, invisible to a test suite
  and to a browser that renders no pixels — Michael's screenshot found it.
* **THE PIPE SENSOR** (v0.12.0) — a new `kind: 'sensor'`, at Michael's request.
  An instrument that states a temperature or flow setpoint for a linked pump or
  globe valve to hold. Thermostatic mixing is the case it was asked for, and
  constant-flow control on a branch falls out of it. Hydraulically it is a plain
  pipe and it passes temperature through. The control search had to be
  generalised: a source/sink's error is a STEP (identically zero once
  unlimited), a sensor's is CONTINUOUS and crosses zero, so the predicate is
  now "arrived, or gone past". `ARCHITECTURE.md` §17D.
* **THE PRESSURE PLAUSIBILITY GUARD** (v0.12.0) — a component ΔP or pump duty
  past `warn.maxComponentPD` (default 2000 kPa) is an ERROR that clears
  `converged`, the same way a temperature outside the band is. The 1252 bar
  answer in `debug/20260803-1.json` was still being offered as a result with
  only a warning beside it. Shut valves are excluded: `CLOSED_R` is a numerical
  device, not a pressure.
* **THE PUMP-CURVE CHART** (v0.11.4) — no longer WIP. One chart per pump, with
  the rated curve solid, the 90–50% speed family dotted, the operating point,
  and the **system curve in red, traced by solving** rather than assumed. Every
  operating point lies on the system curve by definition, so sweeping the
  pump's speed traces it exactly — including static lift, other pumps and the
  real friction exponent, none of which the usual parabola-through-the-origin
  gets right. `FD.network.systemCurve()`, `ARCHITECTURE.md` §17C.
* **PART LOAD RIDES DOWN THE SYSTEM CURVE** (v0.11.3) — Michael's catch. The
  ENGINE was right: on a closed circuit the solved operating point satisfies
  Q ∝ n and H ∝ n² to four decimals, and with static lift it correctly does
  NOT. What was wrong was the REPORTING. The panel and the calculation sheet
  read the pump curve in **DESIGN** too, where the solver runs on `pump.head`
  and the curve is not in the calculation — and because DESIGN imposes the
  flow, a curve read at an unchanged flow walks UP as the pump backs off
  (44.85 → 50.12 → 56.70 m on his own curve). Separately, a typed speed in
  DESIGN made `autoSizePumps` inflate the rated duty to overcome its own
  throttling: 44.8 m at 100% became 179.4 m at 50%. Both fixed —
  `M.pumpHead()` is now the single definition of "the head this pump is
  developing", and speed applies in SIMULATION only. `ARCHITECTURE.md` §17C.
* **THE 12 791 m PUMP** (v0.11.2) — `debug/20260803-1.json`. Not a solver
  defect: an AHU rated 0.8 L/s at 200 kPa was carrying 20 L/s, which by the
  square law is 125 000 kPa across it and 99.8% of the pump duty. Its design
  flow had been silently rewritten when its ΔT was set. Three things came out
  of it: design flow / load / ΔT are now ONE relation that moves whichever
  field you touched least recently (`M.setEquipTrio`), `EQUIP_OFF_RATING`
  reports any machine far off its rating, and equipment capacity is now signed.
  `ARCHITECTURE.md` §18. Corrected, the same model sizes to 44.85 m — exactly
  what its pump curve was fitted for.
* **SETPOINT CONTROL** (v0.11.1) — the control link now DOES something. A
  linked pump changes speed and a linked globe valve changes position until the
  machine holds its setpoint. This is the only place temperature feeds back into
  the hydraulics. SIMULATION only, because in DESIGN the flows are imposed by
  the demands and a controller has nothing to move. `ARCHITECTURE.md` §17C, and
  §9A below for how the four traps turned out.
* **CONTROL LINKS** (v0.11.0) — a pump or globe valve records which equipment's
  setpoint it follows, drawn as a dashed green orthogonal route.
  `ARCHITECTURE.md` §17B.
* **Two EQUIPMENT TYPES** (v0.10.3) — Source / Sink and Heat Exchanger, split
  on what you know at design, with capacity, ΔT and temperature limits and the
  binding one reported. Replaces the dT/dQ modes. `ARCHITECTURE.md` §18.
* **Valve opening is the full 0–100% range** in 1% steps (v0.10.3). It snapped
  to five positions, which is not how a regulating valve is set.
* **THE THERMAL MODULE** (v0.10.0) — the headline. `src/thermal.js` carries
  temperature along the solved flows: heat loss through insulation, mixing at
  junctions, and equipment duty from `Q = ṁ·Cp·ΔT`. New THERMAL tab, fluid
  presets, temperature on the drawing, in the probe and as a visualiser, and a
  Thermal section on the calculation sheet. `ARCHITECTURE.md` §18 has the whole
  design; §2C below has the two things that need Michael.
* **TWO calculation methods, not three** (v0.9.0). `Hazen-Williams (ASHRAE with
  Equivalent Lengths)` and `Darcy-Weisbach (BETA)`. The two Hazen-Williams
  entries computed pipe loss identically — two roundings of the same equation,
  0.035% apart — and differed only in how they charged fittings, so the menu
  offered what looked like two equations and was one equation with two fitting
  bases. The fitting basis now follows the method. `'ASHRAE'` in a saved file
  migrates to `'HW'`.
* **Hazen-Williams equivalent length is a CHOICE OF THREE published tables**
  (v0.8.2 → v0.8.4), all supplied by Michael: **Carrier Design Handbook Table 11
  (the default)**, **NFPA 13 (2019) Table 27.2.3.1.1**, and **Custom**. Metres
  against NOMINAL size; the old L/D ratio basis is gone. A published set is
  read-only — Custom is how you change anything, and it seeds from whatever was
  showing. NFPA has no straight-through tee row, so there it is Carrier's, with
  an asterisk and a footnote. This moved every HW baseline three times in one
  day; see §2B, where the movement is the interesting part.
* **Darcy-Weisbach charges fittings by K** (v0.8.1), from ASHRAE Ch 22 Eq (7)
  and Tables 3–6, exactly as the ASHRAE method does. It was equivalent length,
  which mixed two formulations — Darcy is itself a velocity-head equation. The
  HYDRAULIC tab now shows the K table under Darcy as a consequence, which is
  what Michael asked for; the equivalent-length table is Hazen-Williams only and
  is still on the list to revisit.
* **Every K value is checked against the printed page** (v0.8.1). Michael
  supplied ASHRAE p.22.6; both tables are transcribed a second time into
  `engine.test.js`, independently of `data/ktable.js`, and all 144 match. The
  open question on the threaded 45° elbow column is CLOSED — it really is nearly
  flat with size.
* **The method dropdown was lying** (v0.8.1). It was hand-written with HW and DW
  only while the default is ASHRAE, so a new model showed "Hazen-Williams" in a
  box set to ASHRAE and picking either was a one-way door. Built from the
  registry now.
* **Fitting PD on the drawing was wrong under any K method** (v0.8.1), which
  includes the default. It apportioned the pipe's loss by an equivalent-length
  fraction of `_Leff` — and under K, `_Leff` has no fitting allowance in it at
  all. It is now K·V²/2g directly.
* **Darcy-Weisbach is unblocked** (v0.8.0). Swamee-Jain selected; BETA on the
  sheet, not "do not use". §2 below has the accuracy, which is measured rather
  than quoted — and the widely repeated "within 1%" turned out not to hold at
  the corners, so the app says 0.9% / 2.8% instead.
* **The HYDRAULIC formula rendered wrong** (v0.8.0). `.formula-eq` was a flex
  container, and a flex item is not an inline box, so `vertical-align` did
  nothing: every exponent sat on the baseline and every fraction ignored its own
  alignment. `(V/C)` followed by a baseline `1.852` reads as a separate factor
  rather than a power. Fixed by returning it to inline layout.
* **A pump's head on the DRAWING was the design duty in SIMULATE** (v0.8.0),
  while the properties panel had it right — so one model reported two heads.
  The drawing now reads the curve at the solved flow, in SIMULATION only.
* **The bullhead-tee fix** (v0.7.10-dev). Michael asked whether a 1.88% split in
  a symmetrical ring was a problem or noise. It was a problem, and the cause was
  that the run/branch pick had two identical candidates and broke the tie on the
  **pipe's ID string**. Where the two charged legs are collinear with each other
  nothing goes straight through, so neither is a run and both are now charged as
  branches. `ARCHITECTURE.md` §7 has the full reasoning. **This moved regression
  baselines** in `supply.test.js` (41.76 → 41.95 m) and `simulation.test.js`
  (four parallel-pump heads, +2.6 to +2.7 kPa each); both are recorded figures
  with the arithmetic of the shift written into the test comments.
* **A layout pipe is LEVEL** (v0.7.8-dev), and its length is the plan distance.
  Michael's rule: only a riser changes height, and the length wanted off a
  layout is the horizontal one — which stays true when pipe gradients arrive in
  v2/v3. `M.pipeLength` no longer carries an elevation term; a pipe whose ends
  differ in elevation is the `SLOPED_PIPE` **error**. This retires the
  `plan = √(L² − rise²)` workaround added the day before: plan and drawn length
  are now the same number.
* **PROBE** (v0.7.8-dev) — a VIEW tool reading pressure, flow and velocity at
  any point along a run. `ARCHITECTURE.md` §7A has why the pressure line is the
  real profile and why a device is a step instead. **The reasoning lives in the
  docs, not in the app** — the panel copy and the "(whole pipe)" note beside
  flow and velocity were both cut as clutter (v0.7.9-dev). Do not put them back
  without asking.
* **Two defects found in `debug/20260802-1.json`** (v0.7.7-dev), both from one
  wrong decision. A source's static pressure was stored as the node's ELEVATION,
  which stretched every pipe on it in 3D — 50 m read as 54.01 m. And
  `changeLength` compared a requested 3D length against a PLAN length, so typing
  50 back in was a silent no-op. Both fixed; `KNOWN-ISSUES.md` has the detail.
  **Old files are migrated on load and the app now says so in a dialog**, since
  the migration moves pipe lengths.
* **A source node reads its stated pressure**, not 0 kPa gauge (v0.7.7-dev), at
  Michael's request and his colleague's. Downstream numbers are unchanged —
  this is the reading, not the hydraulics. `ARCHITECTURE.md` §9.
* **UX pass** (v0.7.7-dev) — every checkbox is a switch; the PRESSURE visualiser
  ramps along a pipe and steps at a device; outflows, pumps and equipment show
  their design K factor.
* **Pump and outflow property panels restructured** (v0.7.6-dev) — a Design box
  and an Actual box on each, the pump's Head no longer settable, the explanation
  behind a 🛈. `ARCHITECTURE.md` §4A has the reasoning.
* **ASHRAE (2021) is the default method** — Hazen-Williams pipe friction with
  K velocity-head fittings, both sourced from Ch 22. See §2.
* **Modes.** EDIT is now **DESIGN**; **SIMULATE** is a mode beside it rather
  than a chip toggle, and offers the same drawing tools. VIEW is the third.
  The tool section is labelled **COMMAND** and swaps contents with the mode.
* **SHOW DISCONNECT is gone.** Disconnections always draw a ⚠️, in every mode,
  draggable in VIEW. Label offsets are keyed so the glyph moves independently
  of the node number.
* **CALCULATION restructured** into five collapsible sections — All Pipes,
  Critical Path, Device Flow, Pump Curve, Appendix. **A collapsed section
  does not print**, which is how you choose what to issue. Project metadata is
  edited in the sheet header (and removed from SETTINGS).
* **Test fixtures moved to `test/fixtures/`.** `examples/` is working material
  that Michael edits and re-saves; a regression baseline cannot live there. This
  broke the suite once already.
* Devices are a constant **0.5 m**; they render as point symbols; pumps and
  equipment have on/off buttons on the drawing and red/green switches in the
  panel; globe valve added; devices arrive tagged SRC-/OF-/PMP-/AHU-.
* Undo now snapshots the pre-edit state (it took two presses before) — though
  Michael reports it is still intermittent.

## 7. State of validation

From `Human-Test.md`, which is the authority.

**Validated by Michael:** Hazen-Williams for straight pipe ("mostly correct").
Zero-pressure outflow refusal. The NFPA 20 worked example.

**Found wrong by Michael:** Hazen-Williams for converging/diverging flow — this
is what §4 is about. Darcy (blocked on §3).

**Never independently verified — the biggest gap.** Every other number is
internal consistency plus hand calculations by the author of the code, which is
the weakest form of check. A comparison against another tool, or against a job
with known answers, is the single most valuable thing left to do.

**Also never done:** a pump curve fitted from a real manufacturer datasheet (the
fitter only recovers curves generated from its own form — that proves the
algebra, not that real curves take that shape); TRACE against a real drawing;
printing on real paper; the light theme.

---

## 8. Practical notes

* **Cache-busting is now built in.** `index.html` carries `?v=<token>` on every
  script. **Bump it after editing a module** or the browser serves stale code —
  this has bitten more than once. It is not a build step: they are still plain
  classic scripts, and browsers ignore the query for `file://`.
* **The preview browser has a 0×0 viewport** in the build environment, so
  screenshots time out and NOTHING is ever rendered to pixels. Drive the DOM and
  read it back — that verifies logic and wiring, never appearance. Every visual
  item in `Human-Test.md` is therefore unsigned until Michael looks.
* **`test/testrun-*.js` are GENERATORS, not tests.** Running one rewrites files
  in `examples/`. That produced a bad commit once. `git diff examples/` before
  committing if you have run them.
* **Git identity is configured** (noreply email, set globally). Plain
  `git commit` and `git push` are fine. Michael asked for work to be pushed as
  it is done, advancing the 0.7.x patch number; he will say when to move the
  first two digits.
* `Previous Version/` holds archived releases (v0.2 → v0.6), gitignored.

## 9A. Variable-speed pumps — DONE, v0.11.1

Landed 2026-08-03. `ARCHITECTURE.md` §17C has the design; this is what a reader
of the old §9A needs to know about how it turned out.

**All four traps were real, and one of them was not on the list.**

* **The direction.** Not assumed anywhere. Because an actuator cannot exceed
  rated speed or fully open, the sign question reduces to *"does backing off
  help?"*, and that is answered by perturbing and re-solving. Michael's
  economizer ramps DOWN to 54% and holds 25.0 °C. A machine capped by ΔT max is
  the counter-case — its leaving temperature does not depend on flow at all —
  and the perturbation correctly leaves that pump at full speed instead of
  winding it to the floor for nothing. Both are tests.
* **A stable quantity.** The modulation is frozen for a whole core solve plus
  its thermal pass, so no pass chases an error it is itself producing.
* **The floor.** `control.minSpeed`, default 0.25, on the THERMAL tab, and
  sitting on it raises `CONTROL_AT_LIMIT` naming the machine and the shortfall.
* **One loop for both actuators.** `actuatorFor()` is a `{min, step, get, set}`
  over a fraction of full travel; the search never asks whether it is driving a
  pump or a valve.

**The trap that was not on the list, and it cost the most time.** Newton and
secant methods are the wrong family here. A source/sink holds its setpoint
*exactly* once it is unlimited, so the error is non-zero above some speed and
identically **zero** below it — a flat half-range that a secant step divides by.
The search now uses secant steps only to find *a* setting that meets the
setpoint, then **bisects** for the highest setting that still does. Related: the
first version stopped at the edge of the 0.05 K deadband, which looks fine and
leaves the machine a whole tolerance short — 1% of flow on a 5 K duty — and
still reporting `EQUIP_LIMITED` while the controller claims to be holding
setpoint. Bisecting to the true boundary fixed both.

**How it is verified.** `test/thermal.test.js`, section "Variable-speed
control". The economizer settles where its duty equals its capacity, so the
flow has a closed form that involves neither the pump nor the pipework:

    q = Q_cap / (ΔT·ρ·cp)  =  250 000 / (5 × 998 × 4187)  =  11.966 L/s

and the controlled model lands on it. Affinity scaling is checked in
`simulation.test.js` against `s²·H(Q/s)` evaluated in the test rather than
against the algebra as written in `data/pumps.js`.

**Unsigned by Michael** — everything visual. See `Human-Test.md` §4C.

## 9. Next version

With setpoint control in place (§9A), the SIMULATION question from 2026-08-02
largely answers itself: a coil holding its leaving temperature by modulating
flow IS the controlled-coil case, solved rather than assumed.

The thermal module landed in v0.10.0. What is NOT in it, in the order it would
most likely be wanted:

* **The effectiveness model for equipment in SIMULATION.** One new field per
  piece of equipment (secondary-side entering temperature); UA derived from the
  design point. §2C.
* **Temperature-dependent fluid properties.** Everything is held at 20 °C, and
  glycol viscosity roughly doubles between 20 °C and 0 °C — so a chilled circuit
  at 6 °C is being given the wrong viscosity, which affects Darcy but not
  Hazen-Williams. It is also what would let the thermal result feed back into
  the hydraulics, which it currently cannot.
* **Pump heat gain.** Left out at Michael's instruction, and it is hundredths of
  a kelvin at typical duties.

Older notes below, kept because the groundwork is still relevant:
`Q = ṁ·Cp·ΔT`. The groundwork is in the model already —
`settings.fluid.specificHeat` and `pipe.temperature`, both stored and marked
unused in the UI. The open questions are where ΔT comes from (per section, per
equipment flow/return, or a system-wide design ΔT) and how duty is presented.
