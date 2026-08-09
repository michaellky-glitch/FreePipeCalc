# Handover

**Read this first, then `WORKLIST.md` for what to do next.**
`ARCHITECTURE.md` is the deep reference — go there when you need to change
something and want to know why it is the way it is. `Human-Test.md` is what
Michael has and has not verified with his own eyes.

State: **v0.16.8, 2026-08-09.** Seven test suites, **1762 assertions**, all
passing (`for f in test/*.test.js; do node $f; done`).

---

## 1. What this is

FreePipeCalc is an offline, single-page piping friction-loss and thermal
calculator for building services. MIT, freeware, no build step, no server, no
dependencies. It opens from `file://` by double-clicking `index.html`.

Michael is a Building Services Engineer. He is the domain authority: when he
says an answer is wrong, the working assumption is that he is right and the
model is wrong, and that has held up every time it has been tested.

**Layers**, load order fixed in `index.html`:

    data/*.js      tables — schedules, fittings, valves, pumps, fluids
    src/units.js   SI internally, conversion at the edges only
    src/hydraulics.js  friction methods (Hazen-Williams, Darcy/Swamee-Jain)
    src/solver.js  the GGA loop and the linear algebra
    src/model.js   the document: levels, nodes, pipes, routes, annotation
    src/network.js build() → solveCore() → autoSizePumps() → runControls()
    src/thermal.js one linear system for temperature, solved not iterated
    src/canvas.js  drawing, hit-testing, every gesture
    src/app.js     panels, ribbon, calculation sheet, persistence
    src/printer.js · src/dxf.js · src/dialog.js

---

## 2. Where things stand

**The engine is in good shape.** Hydraulics, thermal, pump sizing, control
loops, sync, and the DXF/print paths all work and are covered. The last few
sessions have been UX and a run of genuine solver bugs found on Michael's
data-centre model, all fixed.

**Design ΔT, the control search and the non-blocking solve are all DONE**
(v0.16.4, v0.16.8) — §5 and §6 record what happened rather than what is pending.
The solve still TAKES 30–40 s on the data centre; what changed is that the page
stays alive throughout it.

The **early-design sizing aid** is in too (v0.16.5), which is what the ΔT change
was for: blank capacity means "size it for me", and the duty a machine lands on
IS the answer to what to buy. `ARCHITECTURE.md` §18 has it — `qNeed` on the
engine, a Required capacity row with its margin, Auto/Manual sizing on
equipment, and a plant schedule on the CALCULATION sheet.

---

## 3. Conventions that must not be undone

Each of these was arrived at by getting it wrong first.

**`file://` must work.** No ES modules, no `fetch()` of sibling files, no
`navigator.clipboard.read()`, **no Web Workers** (a null origin refuses them).
Classic `<script>` tags on a global `FD`. The paste EVENT is used for TRACE, and
clipboard writes fall back to `execCommand`.

**Never invent engineering data.** An unsourced L/D correction was written and
removed because *"an invented correction is not defensible to a checking
engineer"*. Vindicated twice: a synthesised 45° elbow column turned out 250%
wrong against the real ASHRAE table. If a number cannot be sourced, ship it
flagged or not at all. Exactly one exception exists and is marked
`verified: false` — the propylene glycol properties. Do not quietly promote it.

**Test expectations are independent hand calculations**, never numbers copied
out of the code. About half of all test failures here turned out to be the TEST
being wrong. When a baseline moves, **explain the movement before renumbering
it** — and if it moved because the physics changed, say so to Michael rather
than re-deriving it quietly.

**SI internally, conversion at the edges only.**

**UI text is terse.** A control gets a label; anything more goes behind a 🛈,
briefly. The audience do not need a function explained to them. The reasoning
belongs in these files, where it costs nobody a scroll.

**Detection belongs in the engine, not the renderer.** Warnings were once
derived from calculation-sheet rows, so `solveModel()` reported "no warnings"
for a network running at 12 m/s.

**"Converged" is not "correct."** Two failures make the point: a model returning
zero flow everywhere with `converged: true` and no errors (the ring main was not
a ring — `disconnections()` now catches it), and a geometrically nonsensical
example that solves cleanly.

**Every message is catalogued.** `docs/MESSAGES.md` is checked against the
source in BOTH directions by `engine.test.js`. Add a code, document it.

---

## 4. Traps that have bitten, more than once

These are not hypothetical. Each cost a session or a user-visible bug.

**Bump the `?v=` token in `index.html` after editing any module.** The browser
serves stale code otherwise. It is not a build step.

**THREE VERBS, NOT TWO: `changed`, `arranged`, `selectionChanged`.** v0.16.0
split "selecting is not an edit" out of `changed`, and left a third case
underneath: a change to the DRAWING that the solver cannot see. Dragging a
label, moving a note, repositioning the TRACE image, bending a control leader,
sliding the model onto the grid with ALIGN — all real document changes that must
be SAVED, none of which can move a number. They were all calling `changed()` and
scheduling a forty-second solve. `arranged()` saves and redraws and stops there.

Ask which of the three a gesture is before wiring it. The marquee was calling
`changed()` for a gesture that only writes `selection`, which is why every click
that MISSED a pipe cost a recalculate; `setTool` was calling it too, so picking
up the PROBE — and every mode button, since they select a tool on the way in —
re-solved the model. Michael reported all of that on 2026-08-09.

**`M.addPipe` carries `equip`, `pump`, `valve` and `sensor` — check yours is on
the list.** It copied the first three and dropped `sensor`, so every sensor
arrived with no sensor object and the properties panel filled in its temperature
default: the ΔP button made a temperature sensor, and had done for as long as
differentials have existed. The failure is silent and it is downstream of code
that is completely correct, so it reads as a bug in the tool that placed it.

**An invalid `fillStyle` / `strokeStyle` is SILENTLY IGNORED, and the canvas
keeps the last colour it was given.** Not an error, not a warning, not a black
shape — the previous colour. So a typo or a missing theme key does not look like
a colour bug, it looks like whatever was drawn just before.

A2 (v0.16.6) is the case. The detail/note palette's default colour is named
`'line'`; `View.theme` has never had a `line` key — its neutral is `text`. So
`detailColour('line')` returned `undefined`, and in `drawNotes` the fill was left
at `theme.bg`, set two lines earlier for the note's own backing panel. Every text
box was painted in the background colour on top of a background-coloured
rectangle: created correctly, drawn correctly, invisible. Detail lines took
whatever the previous draw call had left, which is why THEY were visible — in an
arbitrary colour nobody chose.

When a canvas colour looks wrong, check the value is a string before blaming the
drawing.

**A latch that only clears on the happy path is a bug waiting for its first
exception.** `app.solving` was set, then a call threw before the work was
scheduled — so the latch stayed on and the model stopped simulating, silently,
for the rest of the session (v0.16.3). Release state on every path.

**Region-replacement edits swallow definitions.** Twice now a scripted edit that
replaced a span of `app.js` has quietly deleted functions inside it — the
Static/Dynamic wiring (v0.16.2) and the progress-bar helpers (v0.16.3). Both
shipped looking plausible and doing nothing. After any such edit, `grep` for
what you expect to still be there.

**`renderProperties` is rebuilt from scratch on every solve.** So panel state
cannot live in the DOM, and a focused input is detached mid-edit. Field handlers
are wrapped in `commit()`, which refuses a write from a render that is gone, and
the tag field additionally refuses to write to something no longer selected.

**Do not mirror input state you can read directly.** `shiftDown` was tracked on
keydown/keyup, and a keyup that lands in another window never clears it — so
15° snapping silently stopped working after an Alt+Tab. Modifiers now come off
the pointer event.

**`requestAnimationFrame` does not fire in a hidden tab.** Gating work on it
means the work never happens.

**`display:flex` beats the UA's `[hidden] { display:none }`.** Every mode's
tools rendered at once until `.tool-set[hidden]` was added.

**Serve the app on localhost to test it; `file://` in the preview browser is
dead.** This trap has moved. Opening `index.html` as a `file://` URL now hangs
the preview outright — `javascript_tool` and `get_page_text` both time out, so
you cannot even drive the DOM. Served over a **loopback-bound** static server it
works completely: the app loads, `FD` is there, `view.selectionChanged()`
re-renders the panel, and the calculation sheet reads back out of the DOM.

    .claude/launch.json → python3 -m http.server 8787 --bind 127.0.0.1
                                  --directory <repo>

`--bind 127.0.0.1` is not optional — a server on 0.0.0.0 clashes with Michael's
OpenWebUI. `.claude/` is gitignored, so the file is yours and does not ship.
Nothing about the app depends on the origin; `file://` remains what it must SHIP
as, and is what Michael runs.

Screenshots still render nothing to pixels, so this verifies logic, wiring and
numbers — never appearance. **No visual item can be signed off in-session:** log
it in `Human-Test.md`, saying what was driven and what was not.

**`test/testrun-*.js` are GENERATORS, not tests.** Running one rewrites
`examples/`. Tests read frozen copies in `test/fixtures/`; keep it that way.

**Do not start a static server on 0.0.0.0** — it clashes with Michael's
OpenWebUI.

---

## 5. Performance — where the time goes, and the freeze that is gone

On `debug/20260808-DC-broken.json` (278 pipes, 253 nodes, 19 controlled
devices) a full simulation is **~30–40 s**. Profiled:

    hydraulics   ~35 s   455 solveCore calls
    thermal       ~3.5 s 455 thermal solves

Four things already done, and they matter:

* **Selection no longer solves**, and neither does a tool change, a mode
  change, or dragging a label (v0.16.0, v0.16.7). Clicking a pipe used to queue
  a forty-second solve for an answer that cannot have changed.
* **STATIC mode** (the Simulate default) locks anything that would change the
  answer, so nothing re-solves until **RUN SIMULATION**.
* **The GGA matrix is factorised as a skyline LDLᵀ**, not dense Gaussian. It is
  a graph Laplacian — symmetric, positive definite, ~4 non-zeros per row.
  57 s → 39 s, identical answers.
* **THE SOLVE NO LONGER BLOCKS THE PAGE** (S3, v0.16.8). See below.

### S3 — the control loop yields

`solveModelGen` is now the real implementation and it is a **generator**:
`runControlsGen` and `seek` are generators too, and every `evaluate()` — one
network solve plus its thermal pass, about 100 ms — is a `yield*` point.
Everything else drives it:

    solveModel(m)     drains it synchronously. Identical answers, identical
                      signature; `solveNow`, the printer and all 1762 test
                      assertions go through it and did not change.
    the app           steps it on a 24 ms budget, handing the browser back
                      between steps.

The budget is deliberately SMALLER than one solve: `do/while` runs at least one
`next()` before checking the clock, so 24 ms means exactly one network solve per
turn — the finest granularity available. Resumed with `setTimeout`, never
`requestAnimationFrame`, which does not fire in a hidden tab.

**Measured, in the browser, on the 278-pipe model.** A 50 ms heartbeat fired
**459 times during a 29.5 s solve** — 591 is the ceiling if the thread were
completely idle — with a median gap of 62 ms, a 95th of 74 ms, a maximum of
207 ms and **no block over 300 ms**. Before it, the entire 29.5 s was one
uninterruptible block and the heartbeat fired once.

**The new hazard, and it comes WITH the fix.** While the solve blocked, nothing
could be edited underneath it. Now it can be — and the generator holds a live
reference to the model and writes actuator positions into it as it searches. So
`scheduleSolve` bumps `app.solveEpoch`, and a step that finds the epoch moved
**abandons its run**: an answer about a model that has moved is worse than no
answer. Verified by editing mid-solve — the first generator is dropped, exactly
one continues, and the latch releases.

**Progress is honest about what it cannot know.** The loop cannot say how many
solves a search will need, so the fraction is *devices settled out of the worst
case* — every device, every one of the six sweeps. A model that converges in two
sweeps therefore finishes with the bar at a third, which is why the label reads
"sweep 2 of 6" beside it. A bar that never overstates and stops early beats one
that goes backwards.

### Why NOT a Web Worker (Michael asked, 2026-08-09)

It is the obvious answer and it is refused **twice**, which is why the generator
is not a consolation prize:

1. **The origin.** `file://` is a null origin, and `new Worker('src/network.js')`
   is a SecurityError there. A Blob worker sidesteps that in some browsers.
2. **The code cannot get in.** A worker loads the engine with `importScripts`
   or `fetch`, and both are refused from a null origin too. The only way round
   is inlining every module as a string in the page — a **build step**, which is
   the one thing this project does not have.

The second blocker is architectural rather than a browser quirk, so it does not
age out. Reverse Cuthill-McKee ordering was also tried and backed out: it
narrows the profile, but applying the permutation is n² copies per iteration —
57 s against 39 s for no reordering. It would pay only if computed once per
network with the assembly writing into permuted slots. Recorded in `solver.js`
so it is not tried again blind.

---

## 6. Design ΔT, and the two search bugs it uncovered — DONE, v0.16.4

Kept because it is the most consequential physics change the project has made,
and because the two control-loop defects it exposed will bite again.

**Design ΔT no longer clamps the duty.** Michael's manufacturer part-load table
(2026-08-09) settled it: leaving temperature held at **20.00 °C in every row**,
duty exactly `ṁ·Cp·(EFT − LFT)` throughout, 12 K at design because that is
design flow at design return, and at 30% load the flow floors at 9.464 L/s and
the **ΔT collapses to 10.5 K**. Nothing in that table is limited by ΔT. The
clamp capped duty at `C·ΔT_max` and `C` falls with flow, so the model said
throttling a chiller reduces its capacity — which is why 26–50% of the machines
on his data-centre model reported "limited by Design ΔT" while their coils
starved. `dTMax` keeps its real job in `M.setEquipTrio` as the design-point
relation; the thermal solve no longer reads it on a source/sink. Two rows of the
table are `test/thermal.test.js` → *"Design ΔT is a design point, not a limit"*.

**Blank capacity is now genuinely unlimited**, where the clamp used to imply a
ceiling. Michael's ruling: models without an explicit capacity must gain one.
`test/fixtures/economizer-trim` gained ACCH-1's own design point,
`ρ·q_rated·cp·ΔT = 250.00 kW` exactly. That same property is what makes the
sizing aid in `WORKLIST.md` possible.

**Removing the clamp exposed a NON-MONOTONIC control response, and the search
could not cope with it. Two separate defects, both fixed, both in §17C of
`ARCHITECTURE.md`:**

1. **A device on its FLOOR could not climb.** The exact mirror of the `at-max`
   restart-from-full fixed in v0.15.9, and it had been sitting there unnoticed.
   `seek` probes at `act.min`; when the device is already there it returned
   `at-min` *without solving anything*, and the lost-setpoint rule parked it at
   100%. On `economizer-trim`, sweep 1 put PMP-02 on its floor honestly — with
   the valves wide open the mix was 12 K low at every speed — and sweeps 2 and 3
   measured **+2.4 K at that same floor** and moved nothing. It restarts from
   full now and settles at 32.9%.

2. **One sample at the stop cannot describe a curve that turns.** On a mixing
   circuit the response falls and then rises: while the check valve holds the
   bypass shut the trim pump sets the *whole* loop flow, so slowing it makes the
   supply colder; once the bypass opens, mixing makes it warmer. The rig in
   `thermal.test.js` crosses a 20 °C setpoint **twice**, at 45% and 30%, and the
   single probe at the floor saw a smaller error of the same sign and gave up.
   The travel is scanned now — four points, downward, so the first crossing is
   the highest position that holds setpoint — and **only** when the far probe
   fails to bracket, so the ordinary case still costs one solve.

Both were found by removing the clamp, and neither is about ΔT: any model with a
bypass and a mixing setpoint would have hit them.

**What it did to Michael's own files.** `economizer-trim` converges with all six
controllers holding setpoint; ACCH-1 reaches 7.5 °C and four ninths of the flow
goes through it, which is the mixing arithmetic for 30 °C and 7.5 °C mixing to
20 °C. `20260805-4.json` no longer reports a lost setpoint at all — that error
was the clamp's doing on a machine running 200 kW of a 500 kW design point.
`20260807-DC-broken.json` went from not converging in 232 solves to converging
in 55, with all eight devices holding setpoint (23.5 s → 5.4 s).

---

## 7. State of validation

`Human-Test.md` is the authority. Summarised:

**Validated by Michael:** Hazen-Williams for straight pipe. Zero-pressure
outflow refusal. The NFPA 20 worked example. The economizer + trim system
(v0.15.2) reproducing his description of the plant.

**Found wrong by Michael, and fixed:** Hazen-Williams for converging/diverging
flow; pump sizing on plant rather than loads; the flow deadband; four pumps on
one differential; a control search that could only close; a truncated search
leaving actuators on their floor.

**Still never independently verified — the biggest gap.** Almost every number is
internal consistency plus hand calculations by the author of the code, which is
the weakest form of check. **A comparison against another tool, or against a job
with known answers, is the single most valuable thing left to do.**

**Also never done:** a pump curve fitted from a real manufacturer datasheet;
TRACE against a real drawing; printing on real paper; the light theme; whether
the DXF opens in real CAD (`DX.1`).

---

## 8. Working notes

* **Push as you go**, advancing the patch number. Michael says when to move the
  minor. Git identity is configured; plain `git commit` / `git push` are fine.
* **`debug/20260809-DC.json` is the current data centre**, and it is the first
  one that CONVERGES: tags repaired, every machine holding setpoint with nothing
  limiting it, coils at 69–71% valve. Use it in preference to the `-broken`
  files, which are kept because they still reproduce their own bugs.
* **`debug/` holds Michael's problem files** and is gitignored. They are the
  best test material in the project — when one produces a fix, freeze a copy in
  `test/fixtures/` so the case cannot regress.
* **He works in bursts and tests in bulk.** Expect a long list; work down it,
  say plainly what was not done, and never quietly narrow the scope.
* `Previous Version/` holds archived releases, gitignored.

---

## 9. Where the bodies are buried

Short index of the least obvious things, all expanded in `ARCHITECTURE.md`:

| Thing | Why it is like that |
|---|---|
| The solve is a GENERATOR, drained sync or stepped async | One `evaluate()` is the atom; a Worker cannot load the engine from `file://` |
| An edit during a solve ABANDONS it (`solveEpoch`) | The generator writes into the live model; a stale answer is worse than none |
| Control loop settles ONE device at a time, then sweeps | Devices interact; six sweeps, and a search that cannot finish is a no-op |
| The search SCANS when the far stop tells it nothing | A mixing circuit's response turns, so one probe at the stop can miss two roots |
| Devices sharing a setpoint are GANGED | N controllers on one measurement is degenerate; real plant shares one command |
| The search only ever DESCENDS from full travel | A device needing to open restarts from full — it has no other direction, and that applies at the FLOOR as well as mid-travel |
| Thermal is SOLVED, not iterated | Every relation is affine; Gauss-Seidel was hopeless on a lagged loop |
| A source MIXES, it does not reset | It states the temperature of the water it brings IN |
| The datum is pinned only on a SINGULAR solve | Pinning on suspicion overrode machines already holding a setpoint |
| `pump.head` vs `hDesign` | One is what the solver ran on, the other is a report of it |
| Routes are `zRoute`, one degree of freedom | Three orthogonal segments between two fixed points have exactly one |
| Details and notes are their own collections | Nothing in the engine reads them, so a room outline cannot become pipework |
