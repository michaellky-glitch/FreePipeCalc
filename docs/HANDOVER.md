# Handover

Written 2026-07-30, rewritten 2026-08-02 (v0.8.0), for whoever picks this up next
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
Tests: `node test/<name>.test.js` — six files, **777 assertions, all passing**.
(The datacentre parallel-pump baseline in `simulation.test.js` was regenerated
2026-07-30 after the model was rebuilt by hand — see §2.)

---

## 2. Where things stand (v0.8.0, 2026-08-02)

Nothing is BROKEN. The engine is green at **777 assertions** and the repository
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

`ROADMAP.md` has the detail. The headline is **heating and cooling power**:
`Q = ṁ·Cp·ΔT`. The groundwork is in the model already —
`settings.fluid.specificHeat` and `pipe.temperature`, both stored and marked
unused in the UI. The open questions are where ΔT comes from (per section, per
equipment flow/return, or a system-wide design ΔT) and how duty is presented.
