# Handover

Written 2026-07-30, rewritten 2026-08-02 (v0.7.5-dev), for whoever picks this up next
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
Tests: `node test/<name>.test.js` — six files, **687 assertions, all passing**.
(The datacentre parallel-pump baseline in `simulation.test.js` was regenerated
2026-07-30 after the model was rebuilt by hand — see §2.)

---

## 2. Where things stand (v0.7.5-dev, 2026-08-02)

Nothing is BROKEN. The engine is green at **687 assertions** and the repository
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

### READ THIS FIRST — the Hazen-Williams constant question

Michael reported the app "very slightly off" against his hand calculations.
It is **not** rounding noise, and the app is not wrong. It is a deliberate
0.142% shift that he should decide about.

The app now derives its coefficients from ASHRAE Ch 22 Eq (6) **as printed**
(K = 6.819, a = 1.852, e = 1.167), because he asked for exactly that:

    A = 6.819·(4/π)^1.852 = 10.6663      e = 1.167 + 2·1.852 = 4.8710

Most hand calculations — and the older `HW` method in this app — use the
conventional flow-form constants **A = 10.67, e = 4.8704**. Worked example,
100 m of DN50 sch40 (52.48 mm bore), C = 120, 5 L/s:

| Basis | h_f |
|---|---|
| A = 10.67, e = 4.8704 (conventional, and the `HW` method here) | 14.1304 m |
| Derived from Eq (6) — what `ASHRAE` now does | 14.1505 m |
| Eq (6) evaluated directly in velocity form | 14.1505 m |

The last two agree to 1e-14, so the app reproduces the printed ASHRAE equation
exactly. The 0.142% is the rounding baked into the published 10.67.

**Both are defensible.** If Michael wants his hand calcs to tie out to the last
digit, either switch the model to the `HW` method, or type 10.67-equivalent
constants into the HYDRAULIC formula (they are editable and flow through). Do
not "fix" this without asking — it is a choice, not a bug.

### What is outstanding

| Item | State |
|---|---|
| **Darcy friction-factor correlation** | Still unchosen. Four implemented, spread ≤1.4%. **Darcy remains unusable** until Michael picks one. |
| **Pump properties restructure** | Requested and NOT done: remove settable Head, add a New Curve button linking to TOOLS, reorder to Tag / Status / [Design flow, Design pressure] / [Actual flow, Actual pressure], explanation behind a 🛈. |
| **Outflow in SIMULATE** | Requested and NOT done: present like equipment (design box + actual box), and verify outflow flow really is a function of node pressure, the design K and the pump curve. |
| **Human-Test ⚠️/❌ follow-ups** | Six, listed in `KNOWN-ISSUES.md`: intermittent undo, negative pressure should be red, pressure visualiser should gradient along a pipe, riser marker placement/direction, riser node→pipe not connecting, light theme greyness. |
| **Independent verification** | Still the biggest gap. Nothing has been checked against another tool or a job with known answers. |
| **Printer does not draw devices** | `printer.js` strokes device links as plain pipe with no symbol — now inconsistent with the canvas. In `KNOWN-ISSUES.md`. |

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
