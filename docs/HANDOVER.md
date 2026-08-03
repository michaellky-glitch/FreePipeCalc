# Handover

Written 2026-07-30, rewritten 2026-08-03 (v0.10.2), for whoever picks this up next
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
Tests: `node test/<name>.test.js` — seven files, **979 assertions, all passing**.
(The datacentre parallel-pump baseline in `simulation.test.js` was regenerated
2026-07-30 after the model was rebuilt by hand — see §2.)

---

## 2. Where things stand (v0.10.2, 2026-08-03)

Nothing is BROKEN. The engine is green at **979 assertions** and the repository
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
  Critical Path, Device Flow, Pump Curve (WIP), Appendix. **A collapsed section
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

## 9. Next version

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
