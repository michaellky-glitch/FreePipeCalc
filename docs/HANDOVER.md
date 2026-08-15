# Handover

**Read this first, then `WORKLIST.md` for what to do next.**
`ARCHITECTURE.md` is the deep reference — go there when you need to change
something and want to know why it is the way it is. `Human-Test.md` is what
Michael has and has not verified with his own eyes.

State: **v0.16.29, 2026-08-12.** Nine test suites, **1979 assertions**, all
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
    src/tools.js   the TOOLS window — four standalone calculators
    src/printer.js · src/dxf.js · src/dialog.js

---

## 2. Where things stand

**The engine is in good shape and the backlog is empty.** Hydraulics, thermal,
pump sizing, control loops, sync, copy-paste, the tools and the DXF/print paths
all work and are covered. Every item Michael has raised is done.

Nine versions were built in one session on 2026-08-09 (v0.16.4 → v0.16.15), and
the big ones were:

* **Design ΔT stopped clamping the duty** (v0.16.4) — his manufacturer
  part-load table settled it. §6 has the story and the two control-search
  defects it uncovered.
* **Blank capacity became a sizing question** (v0.16.5). `ARCHITECTURE.md` §18.
* **The solve stopped blocking the page** (v0.16.8, S3). §5.
* **Copy and paste**, built as two pure-model functions (v0.16.13).
* **The TOOLS window**, with six calculators (v0.16.10, v0.16.12).

**THE ONE THING OUTSTANDING IS THAT HE HAS NOT SEEN ANY OF IT.** All of it was
driven through the DOM and every number was checked, but the preview browser
renders nothing to pixels, so no question of the form "does that LOOK right" has
been answered. `Human-Test.md` opens with a `WAITING ON YOU` block holding
**§5K–§5Y** — that is the backlog, and `WORKLIST.md` names the four things most
likely to come back.

One thing is recorded but not chased: **DX.1** (does the DXF open in real CAD).
**S4** — park-at-full leaving other devices settled against a plant that has
since moved — is now fixed (v0.16.16): after the sweeps and the parking pass the
loop settles the survivors again against the plant the parked devices hold, and
re-parks anything that itself finishes lost, bounded because the lost set only
ever grows. Parking is still judged only between converged sweep-sets, never
mid-sweep. Provably inert when nothing is lost — the real data centre
(`20260809-DC.json`) solves identically, 675 solves and no drift.

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

**Bump the `?v=` token in `index.html` after editing any module — INCLUDING
`styles.css`.** The browser serves stale code otherwise. It is not a build step.

The stylesheet had **no token at all** until v0.16.10, so every CSS change since
the project began has shipped stale to anyone with the page cached. It cost half
an hour on 2026-08-09: a new tab strip rendered with the wrong `display` and no
children, which reads as a JavaScript bug and is a cached file. If a change
"did not take", check the token before you check the code.

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

**Region-replacement edits swallow definitions.** THREE times now, the third on
2026-08-09 in `canvas.js`: replacing `drawRisers`…`labelSize` deleted ten draw
methods, because between those two names sit the valve, sensor, equipment, tag,
pump, arrow, pipe-label and node-label renderers. The suite did NOT catch it —
they are all DOM code — and it took a console error in the browser. If you
replace a span, list what is inside it FIRST:

    git show HEAD:src/canvas.js | sed -n '/drawRisers/,/labelSize/p' | grep prototype

It happened AGAIN on
2026-08-09 — replacing the span from `copyLevel` to `clearDevice` in `model.js`
deleted **fifty-three functions**, because `clearDevice` is nowhere near
`copyLevel`. The tests caught it instantly (`outflowResistance is not defined`),
and it was repaired by splicing the span back from `git show HEAD:src/model.js`.
Match on the exact text you are replacing, never on a span between two anchors
you have not checked are adjacent. Twice now a scripted edit that
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

**And CLOSE any `file://` tab before you start.** A stuck `file://` tab wedges
the whole renderer, not just itself: with one open in the background, every
`javascript_tool` call against the SERVED tab times out too — including a bare
`1 + 1`. It reads exactly like an infinite loop in whatever you just wrote, and
it is not. `tabs_context` then `tabs_close` on the `file:` one clears it
instantly. Cost half an hour on 2026-08-09.
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
leaving actuators on their floor; Design ΔT clamping the duty at part flow; and
across 2026-08-09, four more rounds of UI defects he found by using it.

**The strongest evidence the engine is right** is `debug/20260809-DC.json`, his
own data centre: 278 pipes, 19 controlled devices, and since v0.16.4 it
CONVERGES with every machine holding its setpoint and nothing reporting a limit.
It did not before. That is the closest thing to an independent check the project
has, because he drew it and he knows what it should do.

**The network solve is now cross-checked against an independent algorithm
(v0.16.17).** `test/crosscheck.test.js` re-solves looped networks by HARDY CROSS
— loop-flow corrections, no shared code with the GGA below the pipe law — and
the two land on the same flows to 1e-10 or better across a two-loop grid, a
three-loop ladder and a rewired grid, under Hazen-Williams. It is handed each
pipe's own r and n, so it isolates the DISTRIBUTION (never independently checked)
from the single-pipe law (which Michael validated). Darcy is out of scope on
purpose: its friction factor moves with the flow, so a constant-r loop method
would be testing the physics, not the solver.

**Still the biggest gap, narrowed but not closed.** The cross-check settles the
looped-network hydraulics; what remains unchecked against anything external is
the THERMAL solve, the CONTROL loop, the single-pipe law against a published
table (as opposed to Michael's eye), and a real job with known/commissioned
answers. `debug/20260809-DC.json` and `debug/20260910-HighRise.json` are
Michael's own "known-good" models — rational to his eye, not CFD-verified — and
are the best sanity references short of that. **A comparison against a real job
with known answers is still the single most valuable thing left to do.**

**Also never done:** a pump curve fitted from a real manufacturer datasheet;
TRACE against a real drawing; printing on real paper; the light theme; whether
the DXF opens in real CAD (`DX.1`). And **none of the v0.16.4–v0.16.15 UI has
been looked at** — see §2.

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
| ANNOTATION selects annotation, never pipework | Everything that mode moves sits ON TOP of the drawing; the pipe underneath was winning the click |
| Annotation handles are sized in GRID SQUARES | A pixel target shrinks with the zoom while everything you aim at is in metres |
| A riser marker says direction AND where the column stops | A chevron for the flow, a bar across the end that terminates — Michael's own convention |
| ALT frees any constraint; Shift only the 15° snap | Shift was already "select the run between" on a device, so one rule could only ever be Alt |
| A cross-floor link has TWO legs, routed separately | `control` and `control.far`; editing the wrong one puts your node on the other floor |
| Copy is a closed FRAGMENT: extract, then insert | Every id it points at is remapped or dropped; a copy following the original's sensor is two devices on one measurement |
| A control link across floors rises through a NODE | Half the link on each floor, meeting at one draggable point in plan |
| Routes are `zRoute`, one degree of freedom | Three orthogonal segments between two fixed points have exactly one |
| Details and notes are their own collections | Nothing in the engine reads them, so a room outline cannot become pipework |
