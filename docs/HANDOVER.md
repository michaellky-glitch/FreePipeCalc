# Handover

Written 2026-07-30, at the end of a long session, for whoever picks this up next
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
Tests: `node test/<name>.test.js` — six files, **670 assertions, all passing**.
(The datacentre parallel-pump baseline in `simulation.test.js` was regenerated
2026-07-30 after the model was rebuilt by hand — see §2.)

---

## 2. ~~BROKEN — fix this first~~ RESOLVED 2026-07-30

**Update (2026-07-30):** Michael rebuilt the model by hand. Devices are now
short links (pumps 0.7 m, equipment 0.49 m) with ~377 m of real pipe carrying
friction, and it solves cleanly. It is now a 20 L/s single-equipment circuit.
The `simulation.test.js` parallel-pump baseline was regenerated to match. The
numbers have **not** been independently verified against another tool. The
original defect writeup is kept below for the record.

### `examples/data_centre_redundant_ring_main.pnet (fixed).json` is incoherent

~~Michael's verdict: *"completely incoherent."* He is right. I generated it
programmatically last session via `examples/build-datacentre-ring.js` and only
ever checked that it *solved*, never that it read as a drawing.~~

~~**The defect:** every pump and both CRAH units are **20 m long links**.~~

```
  pump  CHW-P-01   20.0 m
  pump  CHW-P-02   20.0 m
  ...
  equip CRAH-01    20.0 m
```

~~I placed the suction header at y=20 and the discharge header at y=0 and let each
pump bridge straight between them, so the *pump* is the 20 m connecting pipe.
Same for the CRAHs bridging supply ring to return ring.~~

Michael fixed the model manually as a UX test.

**Why it matters beyond looking wrong:** a pump link is a head source and an
equipment link is a fixed `r·Q²`. Neither carries pipe friction. So roughly 120 m
of DN150/DN125 pipework contributes **zero** friction loss, and the duty head is
under-reported. The numbers in the battery results are therefore not
trustworthy, even though they looked plausible and self-consistent.

**The rule that was violated:** an in-line device must be a SHORT link — under a
metre or two — with real pipe either side carrying the distance. `insertInline()`
in `canvas.js` gets this right (`half = Math.min(0.35, len/4)`); building a model
by hand through `M.addPipe` bypasses that entirely.

**Suggested fix:** redraw so each device is a short link. For each pump: a node
on the suction header, a ~1 m pump link, a node, then a real pipe run to the
discharge header. Same for the CRAHs. Then re-run
`test/simulation.test.js` — the "Parallel pumps share in DESIGN" section asserts
head values (209.4 / 207.0 / 205.6 / 204.3 kPa) taken from the OLD geometry and
**will need updating**; treat a change there as expected, not as a regression.

Better still: ask Michael whether he would rather draw it in the app than have it
generated. A generated example passing tests is exactly how this got through.

**Lesson worth keeping:** "the solver converged" is not "the model is right."
This is the second time that has bitten in two sessions — see §5.

---

## 3. Waiting on Michael

Nothing below should be guessed at.

| Item | Detail |
|---|---|
| **ASHRAE tee coefficients** | Two of four are placeholders — see §4. He has agreed the source (ASHRAE Fundamentals) but not supplied values. |
| **Darcy friction-factor correlation** | Four implemented (Colebrook, Swamee-Jain, Haaland, Churchill), spread ≤1.4%. It is a judgement about auditability, not accuracy. Until chosen, **Darcy is unusable** — `Human-Test.md` marks it ❌. |
| **Real name for `LICENSE.txt`** | Currently the placeholder "Michael". Needed before publishing. |
| **GitHub publishing** | **On hold** at his instruction: *"I have not yet rigorously tested the functionality yet."* Do not push. `docs/PUBLISHING.md` has the notes. |

---

## 4. The tee coefficients

The **structure** is done. Dividing and combining tees are separate fitting
types, and a combining tee charges both of its *inlets* — previously equivalent
length went only to the downstream leg, so a combining tee charged nothing at all
to its branch inflow, which is where most of the loss is.

The **data** is half placeholder:

| Coefficient | L/D | Provenance |
|---|---|---|
| `TRUN_DIV` | 20 | spec §3.3 tee-run |
| `TBRANCH_DIV` | 60 | spec §3.3 tee-branch |
| `TRUN_CONV` | 20 | **placeholder** — assumed equal to the dividing run |
| `TBRANCH_CONV` | 90 | **placeholder** — assumed 1.5× the dividing branch |

Only the *ordering* is asserted with confidence: a stream entering through the
branch of a combining tee loses more than one leaving through the branch of a
dividing tee, because it must turn *and* merge. Magnitudes are guesses.

They are flagged `sourced: false` in `data/fittings.js`, listed by
`FD.fittings.unsourced()`, and named in a notice in the HYDRAULIC tab.

Sensitivity, measured by sweeping `TBRANCH_CONV` 60→120 D: 1.4% of total friction
on the data centre ring, 0.00% on the 3-floor riser. **Do not read that as
reassurance** — both are generously sized systems where straight pipe dominates.
Exposure rises with the number of combining tees and falls with pipe size.

Two routes forward, in `ROADMAP.md`: flat values per case (four numbers, no code
change), or flow-ratio dependent (`fittingsAtNode` already knows every leg's
flow, so Qb/Qc is available where the fitting is assigned — but it needs a curve
per case and a change to how `fittingLD` is stored and edited).

---

## 5. Conventions that must not be undone

These were each arrived at by getting it wrong first.

**Never invent engineering data.** An unsourced L/D size-correction was written
and then removed because *"an invented correction is not defensible to a checking
engineer"* (`data/fittings.js`). The same principle produced the placeholder
flags in §4, and is why the ASHRAE tee data is still open rather than filled in
from memory. If a number cannot be sourced, ship it flagged or not at all.

**Test expectations are independent hand calculations,** never numbers copied out
of the code. Roughly half of all test failures in this project turned out to be
the *test* being wrong. `ARCHITECTURE.md` §15 records this.

**`file://` must work.** No ES modules, no `fetch()` of sibling files, no
`navigator.clipboard.read()`. Classic `<script>` tags on a global `FD` namespace,
with load order in `index.html` mirrored in `test/harness.js`. The paste EVENT is
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

Recent enough to still be settling.

* **DESIGN / SIMULATION modes.** Terminals are fixed flows in DESIGN and
  resistances in SIMULATION; whichever side is calculated is greyed and locked.
  `settings.calcMode`, toggled by the ribbon chip. DEMAND renamed OUTFLOW
  throughout the UI (drawing code `OF`, not `O` — a lone O reads as zero).
* **Pump curves.** `data/pumps.js`. A curve is mandatory in SIMULATION. The
  auto-generated single-point curve was REMOVED as a user-facing feature —
  replaced by TOOLS ▸ Generic Pump Curve, where three duties are stated.
  `pumps.singlePoint()` survives as a test fixture and as the internal
  characteristic described below.
* **TOOLS tab** (`src/tools.js`). Generic Pump Curve: exact quadratic through
  three points by Newton's divided differences, NFPA 20 preset. Offers two
  copy payloads and explains the difference — the three defining points refit
  exactly, the full 16-row table refits to r²≈0.9997 but shifts all three stated
  duties by ~1%. **Default is the three points.**
* **Disconnection detection** (`network.disconnections`). Coincident unjoined
  nodes, orphans, islands, devices with nowhere to discharge. Runs on every
  solve; fatal codes clear `converged`. SHOW DISCONNECT is a view *toggle*
  (`view.showDisconnects`), not a tool, so markers persist while you fix things.
* **Device direction.** Pumps, equipment and check valves are directional, with a
  `‹ ›` flip that swaps the pipe's endpoints. Reverse flow held by a head-based
  test (testing flow oscillates; testing adverse head is a stable fixed point).
* **Offline devices are omitted from the network,** not modelled as a large
  resistance. The old `CLOSED_R = 1e12` leaked ~0.03% of system flow per stopped
  pump. `net.omitted` carries them; `res.flow` still reports zero, not undefined.
* **Parallel pumps share flow in DESIGN.** N fixed-head pumps between the same
  two headers is degenerate — it returned a 99.9% skew. After sizing converges,
  one further pass gives every running auto pump the same linear droop
  `H = H_duty + k(Q_share − Q)` anchored on `total/N`. Read the ENGINE.md section
  before touching it: it must run AFTER sizing, the shape must be LINEAR, and the
  result must not be forced exactly equal. All three were failures first.
* **Canvas:** device bodies draggable as a unit, labels snap to the world grid,
  accessory placement previews its target pipe, risers selectable and deletable.

---

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

* **Browser caching has repeatedly produced false readings.** The workaround has
  been bumping the dev-server port in `~/.claude/launch.json` — currently
  **8821**. If a change appears not to have taken effect, check whether the
  browser is serving a stale script before debugging the code.
* **Screenshots time out** in this environment. `preview_eval` with DOM
  inspection is reliable; `preview_screenshot` is not. Verify by reading the DOM.
* **Git identity is not configured** in this repo. Commit with
  `git -c user.name='Michael' -c user.email='michael.lky@gmail.com'`.
* Nothing has ever been pushed. Five-plus local commits on the default branch.
* `Previous Version/` holds archived releases.

---

## 9. Next version

`ROADMAP.md` has the detail. The headline is **heating and cooling power**:
`Q = ṁ·Cp·ΔT`. The groundwork is in the model already —
`settings.fluid.specificHeat` and `pipe.temperature`, both stored and marked
unused in the UI. The open questions are where ΔT comes from (per section, per
equipment flow/return, or a system-wide design ΔT) and how duty is presented.
