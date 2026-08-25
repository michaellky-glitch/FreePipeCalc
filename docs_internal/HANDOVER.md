# Handover

**Read this first, then `WORKLIST.md` for what to do next.** Developer docs now
live in `docs_internal/` (this file, `WORKLIST.md`, `Human-Test.md`,
`DW-MODULE.md`, `piping-friction-loss-spec.md`, `KNOWN-ISSUES.md`, `PUBLISHING.md`,
`ROADMAP.md`). USER docs live in `docs/` and are now HTML pages
(`architecture.html`, `engine.html`, `user-manual.html`, `tutorial-01-basics.html`,
plus Michael's own `tutorial-*.html`) — go to **Architecture** for the deep
reference. `Human-Test.md` is what Michael has and has not verified with his own
eyes; its top block now holds **open engineering questions EQ.1–EQ.8** migrated
out of the user docs.

State: **v0.18.21 (beta), 2026-08-25.** Ten test suites, **2437 assertions**, all
passing in about 15 s (`for f in test/*.test.js; do node $f; done`).

---

## 0. LATEST — v0.18.21, DS.2 done cheaply, and THE FREEZE (2026-08-25)

### THE SHEET WAS SOLVING. That is the whole of the "convergence" report.

**Michael:** *"the data hall... was converging simulations nicely before but the
last version did not."* Then, unprompted: *"I noticed that pause too. I think
it's related to changing tabs, especially to Calculation."*

He found it. **Nothing is wrong with the convergence.** Three consecutive
re-solves of `examples/Data Hall & Yard.json` settle IDENTICALLY — 5 iterations,
634 solves, 19 of 19 devices holding, no hunting, no errors — and v0.18.13 and
v0.18.20 give the same numbers to the digit. Checked before touching anything.

`renderCalculationInner` opened with `var res = app.results || solveNow();`.
`solveNow` is the SYNCHRONOUS solve. Open CALCULATION before the background
solve has landed and the page locks for **44 seconds**: no progress bar, no
repaint, no answer to a click. **A frozen tab is indistinguishable from a solve
that will not converge**, which is exactly how it was reported.

The whole of S3 (v0.16.8) exists so a long solve YIELDS. Opening a tab must not
step around it. The sheet now asks for a solve the normal way and says
"Calculating…"; `applyResult` already re-renders it when the answer lands.
Measured: opening the sheet with no result in hand went from a 44-second freeze
to **1 ms**. The other two `|| solveNow()` sites (CSV export, print) are
deliberate user actions where a wait is expected and are untouched.

### DS.2, AND THE OBJECTION THAT WAS WRONG

**Michael:** *"Why can't you present the last Simulated results? No need to
re-run it, which I agree, may be slightly different every time."*

Right, and the previous answer — that showing both calculations costs two solves
per render — was wrong. The result is already in memory from when the reader ran
it. `lastByMode` keeps ONE RESULT PER MODE, so the sheet shows the design path
and the simulated path together for nothing.

* `app.modelRev` is bumped in **`scheduleSolve`**, and there only. `changed()`
  is NOT the funnel it looks like — the canvas has its own onChange callback, so
  an edit made by drawing never reaches it. Every path that can move a number
  schedules a solve. That cost a debugging round.
* **Switching mode is not an edit.** It needs a solve but the drawing has not
  moved, so `app.modeSwitch` suppresses the bump once and the other mode's
  cached result is not labelled stale for it.
* A cached result from before the last edit is still SHOWN — it describes a real
  calculation — but the section note reads `· out of date` and a hint says to run
  it again. A mode never run says `not run` and names the button that fills it.
* `forgetResults()` on NEW and on LOAD: cached results describe a different
  drawing entirely.
* The `[Manual]` button lives on the DESIGN section only. The selection is a
  property of the model, not of a mode; offering it twice would suggest there
  were two of them.

Verified in the browser: design only → `Design Auto` + `Simulation not run`;
after simulating → both present, design still `Auto`, revision unchanged.

**REMAINING FROM DS.2:** `All Pipes` is still one section following the current
mode, as PLUMBING has it. Both critical paths are what Michael asked to see.

---

## 0A7. v0.18.19/.20 — a critical path you can name, and the docs (2026-08-25)

**Michael, 2026-08-25:** *"to fully resolve the Design calculation issue, we
will need to allow the user to select calculating between 2 points (and back) in
addition to the current auto method. Otherwise non-obvious things may trip up
the users and they will be unable to verify."*

That is the right argument, and it is the one to keep: the automatic index is a
defensible choice made from numbers the reader cannot see, and on the data hall
the difference between first and last of fourteen is under a percent. An
engineer checking a run by hand has to be able to NAME it.

**BUILT (v0.18.19):**
* `m.settings.criticalManual` — two node ids; absent means automatic, which is
  what every existing file does. **One must sit on a pump**, because the tally
  only means something as a circuit. The pump end is stored FIRST whichever
  order it was clicked. A pair naming a deleted node reads as unset.
* `criticalPath` honours it and terminates at the named node instead of the
  first pump crossed. Other loads are NOT blocked in manual mode — whatever is
  on the route the reader picked belongs on the tally. The
  friction + static = pump head identity holds, which is the check that it is a
  circuit and not half of one.
* **The button toggles.** With a manual path set it goes straight back to Auto.
  Otherwise it switches to HYDRONIC with the toast *"Select 2 nodes to calculate
  the friction drop between. One of the nodes must be a pump."* Escape during
  the pick does the same as pressing it again (`View.pathPick`, `canvas.js`).
* **CAL PATH** in SHOW: the calculation path in red, automatic or manual,
  whichever the sheet reports. Not a scale — a pipe is on the path or it is not.
* **TEMPERATURE → TEMP.** The hydronic sheet now uses Plumbing's wording —
  `All Pipes (…)` and `Critical Path (…)` — **named for the mode actually
  solved**, so a section headed DESIGN cannot show a simulated path.

**DOCS (v0.18.20), ASD-STE100 as house style asks (§4 records it):**
`user-manual.html` gains §2.6 *Calculation sheet and the critical path* (how the
automatic path is chosen, the four-step manual procedure, CAL PATH), *Setpoint
limits* under Control (SET/MIN/MAX with the chiller bypass worked through and
an IMPORTANT against using SET for it), the Auto/Manual control-valve rows, and
the CAL PATH / TEMP ribbon entries. `engine.html` gains *Choosing the path by
hand* beside the index-circuit rule. Sections renumbered 2.6→2.9; the contents
list and every anchor check out in the browser.

### NOT DONE — and this is the one to read

**Michael asked for "2 Calculations in Hydronic — Design & Simulation", both
presented at once as PLUMBING does. Only the WORDING was aligned.** The sheet
still shows ONE path: the mode you solved in, correctly labelled. Showing both
together needs two solves per render, and on `Data Hall & Yard.json` a
simulation solve is **44 s** against 134 ms for design. Plumbing gets away with
it because its sizing is arithmetic, not a GGA.

The cheap half is available: a DESIGN solve is milliseconds even on the data
hall, so the sheet could always carry the design path and add the simulation one
when the model is in SIMULATE. That was not built because `solveModel` mutates
the model (valve positions, sizing) and running a second pass behind the user's
back needs its own think. **This is DS.2 and it is still open.**

---

## 0A6. v0.18.18 — the index circuit, in both modes (2026-08-25)

**Michael, 2026-08-25:** *"what should be happening is that pump flow is
simulated, all the control valves and VFDs find their set points, and after
several iterations the simulation settles. So all the calculations were already
done, just reporting. In this case, we should be able to just take the path of
most resistance back to pump (or outflow if no return path)."*

**Right in substance; one correction decides whether it works.** The TOTAL
resistance around every circuit is the SAME. Kirchhoff: the head changes around
any closed loop sum to zero, so for every loop through the pump,
friction + static = pump head exactly — the identity asserted in four places in
the suite. Ranked by total circuit loss, all fourteen data-hall AHUs tie to
solver round-off. There is nothing to be "most" of.

**What differs is the SPLIT.** Every circuit spends the pump head on pipework
plus its own terminal. The index is the one where the PIPEWORK takes the most,
and therefore the one left with the LEAST differential across its own branch —
which is the figure a commissioning engineer reads off a pair of gauges. Same
idea Michael described, measured where it can actually be told apart.

`flow / qRated` is gone as the selection criterion. It is right in an
UNCONTROLLED system, and wrong the moment a terminal has a control valve: the
valve drives the terminal to its setpoint, so nothing is starved and the ratio
measures only how close each valve got. Data hall spread: **0.57%**, the valves'
one-percent travel resolution, picking AHU-4 — the LEAST remote of fourteen.

| model | design | simulation |
|---|---|---|
| Data Hall | AHU-13 | **AHU-13** (was AHU-4) |
| HighRise | AHU-9 | AHU-9 |
| Tutorial 01 | AHU-01 | AHU-01 |
| tower | AHU-L3 | **AHU-L2** |

**THE TOWER DISAGREES BETWEEN MODES, AND THAT IS NOT A BUG — but say so if it
is raised.** Its four coils are in SERIES up a riser, so in simulation they sit
at different flows (1.21–1.35 L/s) and different inlet temperatures while each
holds its own ΔT. "Hardest to serve at this operating point" is then genuinely
not "hardest by design", and the spread is 1.24%. The data hall's coils are in
parallel and identical, so both modes agree there.

**The pump sizer is not orphaned.** `autoSizeForFlow` still drives the
worst-served ratio to 1, and it runs in DESIGN only — where DS.1 puts the valves
at full travel and the two criteria rank IDENTICALLY. So the sheet and the pump
still agree about which machine governs, which is what that coupling was for.
The §4 trap entry should be read with that qualification now.

`res.critical.available` is new: the head left across the index branch, the
smallest in the model, which is what selected it. `served` (flow / rated) is
still reported — it is useful, it is just not the selector.

`docs/engine.html` §6.3 carries the rule with the Kirchhoff argument spelled
out, since it is the part that rules out the obvious method.

**STILL OPEN:** DS.2, `user-manual.html` vs Michael's tutorials, MSG.2, and
whether a chiller should carry its own minimum-flow setpoint rather than needing
a sensor.

---

## 0A5. v0.18.17 — MIN/MAX/SET on setpoints (2026-08-25)

**Michael chose option B and gave the case:** *"bypass control valves that
maintain a minimum flow through chillers. I.e. if the main flow drops below MIN
due to downstream valves closing, the bypass valve will open to maintain MIN
flow through the chillers."*

Every setpoint now carries a comparator. `SET` is the default and is what
setpoints have always done. `MIN` is a FLOOR — the controller acts only when the
reading falls below it and otherwise sits where it does least. `MAX` is the
mirror. Stored where the SETPOINT is (`sensor.cmp`, `equip.cmp[key]`), sparse,
absent means SET, so no file needs migrating.

**IT IS NOT SET SAID DIFFERENTLY, and the test asserts the contrast.** On the
same bypass valve, at full load:

| | bypass | chiller flow | result |
|---|---|---|---|
| **MIN** 4.20 L/s | **10%** (shut) | 6.05 L/s | holding, silent |
| **SET** 4.20 L/s | **100%** (wide open) | 7.33 L/s | `SETPOINT_LOST` |

SET cannot get the flow DOWN to 4.20 while the system is busy, so it calls the
setpoint lost and parks the valve wide open — the opposite of what a bypass
should do. Across falling load, MIN gives exactly the plant Michael described:

| load | 100% | 70% | 50% | 30% | 10% |
|---|---|---|---|---|---|
| coil flow | 5.930 | 4.205 | 2.970 | 1.811 | 0.571 |
| bypass | 10% | 10% | 38% | 49% | 56% |
| chiller | 6.053 | 4.375 | 4.215 | 4.266 | 4.196 |

Shut while the chiller is above its floor, then opening exactly as far as it
must. All devices report `on`.

**THE DESIGN NOTE WAS WRONG THAT CLAMPING IS ENOUGH** (recorded in v0.18.16 and
now confirmed by building it). Three things were needed:

1. `errorOf` clamps through `clampErr(pair, e)` — MIN keeps only the negative
   half, MAX only the positive.
2. **`seekOneSided`**, a search of its own. `seek` descends looking for where the
   error CROSSES zero and answers with the highest setting that meets the
   setpoint. A limit has no crossing — the error is zero across everything that
   satisfies it — so the answer wanted is the BOUNDARY of that region, and for
   MIN that is its LOWEST end. The new search tries the REST position first
   (floor for MIN, full travel for MAX; usually the answer, one solve), then the
   far end, then bisects between them for the satisfying position nearest rest.
   It assumes nothing about which way the reading moves, only that the two ends
   differ. `seek` is untouched.
3. **The reported error had to be clamped too.** `res.controls.devices[].error`
   re-derives `measured - target` from the final solve, and without the clamp a
   MIN device sitting comfortably above its floor reported the whole surplus as
   an error — and the state re-judge downstream then called a device doing
   exactly the right thing `unsettled`. That one cost a debugging round.

Also: the gang key includes the comparator, so a MIN and a SET on the same
reading are not modulated together; the priority fall-back carries the next
option's comparator.

**UI:** a `Setpoints` section on the sensor and equipment panels, rendered FROM
`M.controlOptions` rather than hand-placed beside each field, so a machine that
grows a setpoint grows a comparator with it. The controller's own setpoint list
prints `≥` / `≤` — "Design flow 4.20 L/s" and "Design flow ≥ 4.20 L/s" are
different instructions and the list is where they are chosen.
`docs/engine.html` §9 carries it with the bypass worked through.

**STILL OPEN:** DS.2, the SIMULATION-mode index, `user-manual.html` vs Michael's
tutorials, MSG.2.

---

## 0A4. v0.18.16 — the ICV is Auto or Manual (2026-08-25)

**Michael, 2026-08-25:** *"I was just thinking about that slider. It should be
greyed out in simulate. But I do want to have a way for the user to do manual
balancing if they so wish. Repurpose the ICV toggle to be Manual/Auto. Auto works
as it currently does, Manual unlocks (at 100% treat as no valve)."*

Built. The on/off switch is gone; the row is a **Control valve: Auto | Manual**
select, matching the pump's Sizing row (a switch says on/off, and these are two
ways of working).

|  | position is | DESIGN reads | SIMULATION reads | slider |
|---|---|---|---|---|
| **Auto** | an OUTPUT | full travel (DS.1) | where the loop settles | disabled |
| **Manual** | an INPUT | as set | as set | live |

**MANUAL AT FULL TRAVEL IS NO VALVE**, which is exactly what the old switch's
"off" meant — so both states the switch offered are still reachable.

**NO MIGRATION, BY CONSTRUCTION.** `M.icvMode` DERIVES the mode: no `icv` object
at all is manual-at-100 by definition (no valve, no resistance, nothing to
control), and an `icv` with no `mode` is the behaviour that shipped, which is
Auto. An old file opened here and saved again is byte-identical in this respect.
`M.icvOpening` and `M.icvActive` are the other two helpers; `icvActive` is what
the build asks, and it is false for a manual valve at full travel.

A MANUAL valve is **not a controller** — `actuatorFor` and the ICV branch of
`runControlsGen` both gate on `M.icvMode(p) === 'auto'`, so there is nothing for
the loop to search and it does not appear in `res.controls.devices`.

`docs/engine.html` §8.1 carries the Auto/Manual rule beside the DS.1 table.
Michael is REMOTE off GitHub Pages and cannot read `docs_internal/`.

### A NOTE ON THE `?v=` TOKEN, because it cost time again

The node suites read from disk and passed while the BROWSER served
`model.js?v=0.18.15` — a token already spent earlier in the session — so
`M.icvMode` was `undefined` in the app and every properties panel threw. §4 says
this. What §4 does not say, and now does: **navigating to the same URL does not
re-fetch `index.html` either.** Bump the token AND load `index.html?nc=<n>`.

### MIN/MAX/SET — STARTED, NOT BUILT, AND THE DESIGN IS UNDER-SPECIFIED

Michael cleared it to proceed ("simulate seems to be working as expected. So
please proceed with the MIN/MAX controls"). Reading the search before writing it
turned up a real problem with the one-line design in §0 of the old handover
("the change is to clamp the error to one side"). **Clamping alone does not
work, and the reason is worth keeping:**

With `err = min(0, reading − target)` for MIN, a device at full travel that
already meets the minimum has `e0 = 0`. `seek` then takes the ALREADY ON
SETPOINT early return and parks it at full travel without searching at all. Even
with that return suppressed, the floor branch and `best`'s tie-break both prefer
the HIGHER setting — and for a one-sided setpoint EVERY satisfied position has
`|e| = 0`, so "closest to zero, ties to the higher x" is full travel again. The
answer wanted is the **boundary** of the satisfied region, and for MIN that is
the LOWEST setting that still meets it — the opposite end from the one the
bisection is written to take.

**And underneath that is a semantic question only Michael can settle**, which is
why nothing was written:

* **(A) MIN as a LIMIT that settles on the boundary** — throttle down, but not
  past the point where the reading falls below target; comes to rest at
  reading = target. This is what a real minimum-flow controller does. But it
  gives the SAME answer as SET in the normal case, differing only at the edges,
  which makes the feature nearly redundant.
* **(B) MIN as a CONSTRAINT that does nothing until violated** — if the reading
  is at or above target, do not move at all. This is what his own wording says
  ("act only when the reading is below target"), and it only earns its keep
  ALONGSIDE another setpoint, via the existing priority list.

Put to him with that evidence. Do not guess: the two produce different plant.

---

## 0A3. v0.18.15 — DS.1 built: a design calculation is at design conditions (2026-08-25)

**Michael, 2026-08-25, on `examples/Data Hall & Yard.json`:** *"logic would say
the most remote should be AHU-12 or 13, or one of the others along that line.
But calculation is showing AHU-4."* He is right, and the cause is DS.1.

**THE DIAGNOSIS.** Fourteen IDENTICAL AHUs on one distribution run, each with its
own integrated control valve holding its own coil's ΔT. Every coil is therefore
driven to design flow BY ITS OWN CONTROLLER, so `flow / qRated` — the index
criterion — has nothing left to measure but how close each valve got. The whole
spread across the system is **0.57%**, which is the valves' one-percent travel
resolution. They had settled between 68% and 71%. AHU-4's had quantised one step
further closed than its neighbours', so it carried 0.4% less water and won
"worst served" — and AHU-4 is **the LEAST remote of the fourteen.**

Ranked by how much head is burnt reaching each coil (the drop left across its own
branch, smallest first — the field measurement a commissioning engineer takes):

| | 1 | 2 | 3 | 4 | … | 13 | 14 |
|---|---|---|---|---|---|---|---|
| coil | **AHU-13** | AHU-9 | AHU-14 | AHU-8 | … | AHU-11 | **AHU-4** |
| ICV | 71% | 71% | 71% | 71% | … | 69% | 68% |

That ordering is **identical in all four combinations** of mode and starting
valve position, because it is a property of the pipe. `flow / qRated` was
different in every one of them.

**MICHAEL'S CHOICE (asked, four options): fix DESIGN only, leave SIMULATION.**
So that is exactly what was built.

**WHAT CHANGED.** `actuatorOpening(simulating, opening)` in `network.js`. In
DESIGN a CONTROLLED valve is charged at **full travel**; in SIMULATION it is
charged where the loop put it. It applies to an integrated valve on equipment
and, identically, to a drawn globe valve carrying a control link — the panel
already tells the reader an ICV is "equivalent to drawing a control valve in the
branch and linking it here", so the two must not give different design answers
for the same plant. **A valve with NO control link is a balancing valve and is
read exactly as set, in both modes.** That is the assertion that stops the fix
over-reaching, and it is tested.

Design mode on the data hall now reports **AHU-13**, and slamming every control
valve to 25% cannot move it. Simulation still reports AHU-4, as asked.

**NOT SILENTLY.** The position slider is disabled in DESIGN for a controlled
valve — the same rule and the same reason it is already disabled in SIMULATION
(Michael, 2026-08-04: "leaving them live invites setting a number the next solve
overwrites, which reads as the app ignoring you") — and says *"Not used in
DESIGN — the valve is charged at full travel."* A balancing valve's slider stays
live. All four states driven in the browser and confirmed.

**`docs/engine.html` §8.1 carries the rule**, in a table of the two modes with
the index-circuit consequence spelled out. Michael is working REMOTE off GitHub
Pages and cannot read `docs_internal/`, so anything he needs has to be in the
app's own documentation or in chat.

**The tower's index is unchanged at AHU-L3-N01** and is now right for the right
reason: L3 was already the most resistant circuit on the pipework (0.852 m
against L4's 0.741 m — L1/L2/L3 tee into a passing riser and are charged
`TBRANCH_CONV + E90`, while L4 sits at the END of the column and is charged
`E90` alone), and design mode no longer reaches that answer through leftover
valve positions.

**STILL OPEN:** DS.2 (separate the Design and Simulation calculations the way
PLUMBING does), and the SIMULATION index, which Michael has deliberately left
reporting worst-served. MIN/MAX/SET is still not started and still needs his
confirmation.

---

## 0A2. v0.18.14 — the handover's open list, worked down (2026-08-24)

Michael, 2026-08-24, having accepted the AHU-L3 finding: *"Design calculation
should assume design flow through each equipment. I think we will need to
separate out Design Calculation & Simulation Calculation like is done in
Plumbing. We can leave those two for now and clean up assertions later. We can
proceed with the leftover items from the handover."*

### TWO DECISIONS TAKEN AND DEFERRED — do not re-derive these

1. **A DESIGN calculation assumes DESIGN FLOW through each piece of equipment.**
   It does not use whatever position the last SIMULATION left the control valves
   in. That is the answer to the question v0.18.13 raised, and it is settled;
   what is not built is the change. Today an ICV in design mode is a fixed
   resistance at its stored `opening`, which is why the four floors of the tower
   ranked by leftover valve positions (L1 100%, L2 100%, L3 54%, L4 58%) instead
   of by a 0.7% hydraulic spread.
2. **DESIGN and SIMULATION should be separated the way PLUMBING already does
   it.** The plumbing discipline computes a design sizing pass and a K-terminal
   simulation as two distinct calculations rather than one solve reading a mode
   flag. Hydronic should follow. **Michael's instruction is to leave both for
   now and clean up the assertions afterwards**, so nothing here has been built
   towards them. `WORKLIST.md` carries them as **DS.1** and **DS.2**.

### DONE — five items off the open list

* **`PUMP_RUNOUT` on `Tutorial 01 - Basics` at ~99% of design flow** (open since
  2026-08-23). Real bug. `pctOfDesign` divided by the SPEED-SCALED curve's `Qd`.
  PMP-01 carries 2.3789 L/s against a 2.4001 L/s design — **99.1%** — but the
  control loop had it at 81.3% speed, so the scaled duty point is
  0.813 × 2.4001 = 1.9513 L/s and 2.3789 / 1.9513 = **121.9%**, over the 120%
  limit. The warning quoted the right FLOW and a wrong percentage beside it, and
  **every controlled pump that slowed down raised a runout it was nowhere near.**
  Runout is a statement about the machine against its SELECTION — which is what
  "check available NPSH or design flow" sends the reader to look at — so it now
  divides by the RATED duty. `beyondCurve` is the scaled-curve statement and is
  unchanged. Tutorial 01 is clean.

* **The four stale `docs/*.md` paths were ALREADY FIXED** — by Michael, in
  v0.18.10 (`ce05a11`), when the registry was rewritten to user-facing HTML
  only. Every one of the nine entries resolves. The handover item was stale.
  What was missing is a guard, so `test/tools.test.js` now asserts that every
  file in `FD.docs.list` is on disk, that the DEFAULT is (it was `HANDOVER.md`,
  which 404'd on every single load of the tab), that each entry has a title and
  a blurb, and that every `.html` entry is marked `html: true` — without that
  flag a document is handed to the markdown renderer and fails silently from
  `file://`.

* **`M.setSync` — TWO bugs, one function.**
  1. The chain-collapse walk read `head.pump` and `head.valve` and never
     `head.equip`, so a chain of EXCHANGERS was not collapsed: sync coil C to
     coil B while B already follows A, and C stayed pointing at B.
     `applySyncedDesign` resolves exactly one level of `syncOf`, so C then
     copied B's duty in the same pass B was copying A's — a follower following a
     follower, one build behind, which is the in-group discrepancy sync exists
     to remove. Now goes through `syncOf`, which knows all three kinds.
  2. **Found while testing the first:** the walk DETECTED a chain closing on
     itself and then assigned the sync anyway. Syncing the HEAD of a chain to
     its TAIL built the cycle the code exists to prevent — A follows C while C
     follows A. Nothing settles (every build copies each one's position onto the
     other) and `autoSizePumps` skips anything with a sync, so **neither machine
     gets sized**. It applied to pumps and valves too. Now refused.

* **WORKLIST SW.2 — the sweep → iteration rename is finished.** `sweep`,
  `MAX_SWEEPS`, `reSweep`, `cfgSweeps` and `report.sweeps` are gone from
  `network.js`; `app.js` reads `p.iteration` / `p.iterations` and writes
  `control.iterations`. The saved key is migrated at load by
  `M.migrateControlIterations` — a bare rename would have silently reset every
  existing file's settling count to the default six. The new key wins if a file
  somehow carries both. Three `sweep`s remain in the source and all three are
  the unrelated sense (a spatial sweep in `canvas.js`, sweeping a pump's speed
  in `network.js`, and the migration itself).

* **`docs/engine.html` §6.3 — the GGA iteration values**, requested "later" and
  now written. A per-iteration table for the worked example: largest head
  change, largest flow change, largest imbalance, the ring-leg flow and the head
  at the index terminal, for all three iterations, with the three things worth
  reading in it — continuity is satisfied from iteration 1 because it is the
  LINEAR half of the problem and only the energy equation is iterated;
  convergence is quadratic (largest flow change 2.90 → 0.046 → 0.0000022 L/s);
  and the first iteration OVERSHOOTS from the 0.1 L/s seed. The claim that the
  ring splits "exactly" 1.5/1.5 is softened to what the solver actually returns,
  1.499967 / 1.500033, with a note putting that 33 nL/s residue against the
  tolerances. Values captured from the engine, not estimated.

### STILL OPEN

* **MIN/MAX/SET on setpoints — designed by Michael, NOT built, NOT started.**
  It is the largest item on the list and the standing instruction is to confirm
  the design with him before building it. "Proceed with the leftover items" is
  not that confirmation, so it was left. Everything else on the list is done or
  belongs to him.
* **`user-manual.html` vs Michael's own `tutorial-*.html` set** — the overlap on
  the Piping Network ribbon. His call, unchanged.
* **DS.1 / DS.2** above.
* The Data Hall takes **47 s** in SIMULATION — the size of the model (~75 ms per
  core solve on 520 pipes), not the control loop. Not chased.

---

## 0A1. v0.18.13 — the second pass over the same test (2026-08-24)

Michael re-tested v0.18.12. He had already repaired the risers in his own file
(they are R2/R3 now, DN100 throughout, so the v0.18.12 inheritance fix is
confirmed on a real model). Three things came back.

**1. THE CRITICAL PATH STOPPED HALFWAY ON A BIG MODEL.** On
`examples/Data Hall & Yard.json` — four cooling-tower trains on a common header
— the path ended at the coil. The supply half came up PWP-04's train; the return
half, taking the biggest flow at each junction, went back to the plant and into
**PWP-02's** train instead, then stalled on the supply header at N223 where both
remaining exits were pipes the supply half had already used. `back.end !== cur`,
so the whole return half was discarded: 27 sections and a tally **46.5 m adrift**
from what the pumps develop. A valid return route existed the whole time — 17
links, ending on P299 into PWP-04's suction.

This is the §4 trap for the THIRD time. Following the flow (v0.18.11) made it
impossible to dead-end in a single loop, which was the fix that was needed then;
a plant with parallel trains has junctions where the biggest branch is simply
not the way home. **`walk` now backtracks** — depth-first, biggest flow first,
unwinding when a branch cannot finish, with a `dead` set so it stays linear
rather than exponential. Highest-flow-first means an unobstructed trace takes
exactly the route the greedy walk took, so the dominant circuit is unchanged
wherever the greedy walk worked; the search only does something different where
it used to give up. If nothing finishes, the DEEPEST attempt is returned.

Every closed model now reconciles exactly: Data Hall 44 sections, HighRise 36,
the tower 23, Tutorial 01 12 — friction + static = pump head to 1e-7 m or better.

**2. THE DEADBAND — TRACED, AND IT WAS NOT THE DEADBAND.** Michael: "any way to
trace this down? Otherwise make the default 0.5 K." **The default stays at
0.05 K.** It was a period-2 limit cycle. At 0.05 K the tower ran all 100 sweeps
and 4554 solves, took 20 s and still reported `CONTROL_HUNTING`; from sweep 6 the
plant alternated between exactly two states — PMP-01 at 71.10% with the coils at
56/57/57/57, and PMP-01 at 71.70% with them at 56/56/56/56 — for ever.

**One percent of valve travel, the actuator's entire resolution, is worth about
a tenth of a kelvin on these coils.** AHU-L2 read -0.040 K at 57% and +0.056 K at
56%, so a 0.05 K deadband is finer than the valve can resolve and neither
position is ever "on setpoint". The coils then moved the differential by more
than the pump's 275 Pa band, the pump re-settled, and that moved the coils again.

`floorErr` (`seek`, `src/network.js`) exists to stop precisely this, and it was
recording `|best.e|` — the error at the BETTER of the two positions either side
of the setpoint, which is the one number there that cannot be a resolution limit,
because the search had just achieved it. It now records the **worst error seen
within one actuator step of where the search landed**. The tower settles in **6
sweeps / 197 solves / 1 s** at the default deadband; 0.5 K was never the fix, it
was a band coarse enough to hide the problem.

**3. THE INDEX IS AHU-L3-N01, AND THAT IS CORRECT.** Michael expected the top
floor. It is not, and the pipework says why. Circuit friction, ICVs equalised:

| circuit | branch pipework | risers below | total |
|---|---|---|---|
| L1 | 0.573 m | 0.147 m | 0.720 m |
| L2 | 0.567 m | 0.242 m | 0.810 m |
| **L3** | 0.565 m | 0.287 m | **0.852 m** |
| L4 | 0.438 m | 0.303 m | 0.741 m |

L4's extra riser segment is worth 0.016 m and its floor pipework is 0.127 m
cheaper, so it is NOT the index. The floors are all 10.50 m of pipe — the
difference is FITTINGS. On L1/L2/L3 the riser passes through, so the floor return
tees into it: P12 is charged `TBRANCH_CONV + E90`, 4.57 m of equivalent length on
a 5 m pipe. **On L4 the riser terminates**, so the return is charged `E90` alone,
1.52 m. The top floor sits at the END of the column, not on a branch off it, and
that is genuinely cheaper. `flow / qRated` ranks the four in exactly the order
the friction tally does. Checked separately that splitting a straight run (the
DP sensor sits in L4's return) does not change its friction — one 5 m pipe and
the same run split in three give 0.68232 m either way.

**BUT THE DESIGN-MODE ANSWER IS DECIDED BY LEFTOVER VALVE POSITIONS, and that is
a real question for Michael.** In DESIGN the control loop does not run, so each
ICV is a fixed resistance at whatever the last SIMULATION left on it — in his
file L1 100%, L2 100%, L3 54%, L4 58%. The true hydraulic spread between the four
floors is 0.7%; the valve positions swamp it, which is why design mode reports
L3 at ratio 1.05 against L1 at 1.41 while simulation reports L1 as the index.
The index is L3 either way once the valves are equal, but in design mode it is
right for the wrong reason. **Should a DESIGN calculation use the control
valves' last simulated positions, or open them to their design position?**

**Also this run:**
* `test/fixtures/datahall-yard.pnet.json` and `test/fixtures/tower-five-level.pnet.json`
  frozen — copies of `examples/Data Hall & Yard.json` and Michael's
  `debug/20260824-debug.json` (that one is gitignored, so the fixture is the only
  copy in the repo). Both are asserted against; see `test/fixtures/README.md`.
* The Data Hall takes **47 s** to solve in SIMULATION — 5 sweeps, 634 core
  solves, settling cleanly with no hunting. That is the size of the model, not
  the control loop: about 75 ms per solve on 520 pipes. Not chased. The suite
  asserts it in DESIGN mode (125 ms) for that reason.
* The riser-glyph question in `Human-Test.md` is **withdrawn** — Michael:
  "that's what the glyphs are for. To indicate flows to above and to below."
  The notation already says which way the column runs at each floor.

---

## 0B1. v0.18.12 — three findings from Michael's test (2026-08-24)

Michael built `debug/20260824-debug.json` — a five-level tower, drawn L0 then L1
then **copied upward to L2/L3/L4**, with a second chiller added at step 4. Three
reports came out of it. Two were bugs and are fixed; the third was already
correct and now has tests holding it that way.

**1. A SOURCE ON THE CIRCUIT ENDED THE CRITICAL PATH.** Michael: "if the source
was located along the critical path, hydraulic calculation stopped at source."
v0.18.11 established that *a closed circuit terminates at the pump, not at a
fixed head* — but only half applied it. `stopAtPump` was added to `walk` while
the loop condition `while (!origins[cur] ...)` was left in place, so ANY fixed
head still won the race. A pressurisation or make-up connection tee'd into the
main run then decided the answer by where it was drawn:

| source sits on | what came back |
|---|---|
| the return leg | a path that LOOKS complete, quietly missing the pipe past the tee |
| the load inlet | the coil alone — the pump is not on the path at all |
| the load outlet | **nothing**: 0 sections, friction 0, static 0 |

`walk` now takes `useOrigins`, and it is **off for a closed circuit**. A source
on a closed system sets the pressure; it does not terminate the water. Only an
open system still ends on a fixed head. The return half's acceptance is now
`back.end === cur` alone — the old `|| origins[back.end]` could only fire where
the trace had STALLED to be standing on a source, which is the truncation being
removed. Five source placements around one loop now all give the identical
circuit and the identity holds in each (`test/closed.test.js`).

**2. A RISER STEPPED DOWN TO THE BRANCH SIZE WHEN A FLOOR WAS COPIED.** Michael:
"flow seems to be going through 50 mm vertical pipes... fluid should be following
risers, which are 100 mm." It *was* following the risers — P31/P32/P47/P48 are
segments of R0/R1, not stray pipes. `inheritRiserSize` read only the horizontals
at a segment's OWN two ends; the plant header sits on the bottom attachment and
nothing above it does, so R0 came out **DN100 from L0→L1 and DN50 for the other
four floors** — the whole building's flow through 50 mm, with a PDM warning as
the only sign. Adding a floor is not a decision to reduce the riser.

`inheritRiserSize(m, r)` now takes the RISER and returns **one size for the whole
column**: the largest bore among the horizontals at every attachment *and* the
column's existing segments. `riserPipes` resolves it **once per column, before
any segment is made** — resolving per segment made the answer depend on creation
order, and attachments run top-down, so a column materialised in one go would
have inherited the TOP floor's branch all the way to the plant.

Only NEW segments are ever computed, so a deliberate taper (per segment, or via
the column override) is untouched. **This does not repair a file drawn under the
old rule** — the DN50 segments already exist. The fix for `20260824-debug.json`
is to select R0, set Size to DN100, and the same for R1; `setRiserProps` pushes
it onto every segment. The panel hint now says "largest pipe on the column".

**3. SYNCED HEAT EXCHANGERS DO NOT SYNC THEIR CONTROL VALVES** — checked, and
they never did. `applySyncs` copies `loadPct`; `applySyncedDesign` copies `duty`,
`qRated`, `pdRated`. Nothing touches `equip.icv`. On the debug file, four coils
synced to AHU-L4-N01 and all forced to 100% still settle at 57 / 62 / 100 / 100.

The reason it works is an ORDER in `runControlsGen` that is easy to break: the
ICV branch is taken **before** the "a synced device is not a controller" return,
so a synced coil still gets a loop of its own. A new section in
`test/thermal.test.js` asserts the follower is its own controlled device, on its
own coil's ΔT, unganged from the leader, and that neither its opening nor its Kv
is copied. Two identical coils on runs of different length NEED different
openings to do the same duty — that is what the valve is for.

**STILL OPEN from this test — Michael's own list, not chased:**
* **The L4 copy would not stabilize until the deadband went to 0.5 K.** The file
  as saved gives `CONTROL_HUNTING` + `SETPOINT_LOST` on AHU-L4-N01 at the default
  `tol` 0.05, and converges cleanly at 0.5. Michael said not to spend cycles
  until he can reproduce it. **It reproduces from the file every time** — that is
  the repro, whenever it is wanted. Note `debug/` is in `.gitignore`, so the file
  lives only on Michael's machine; freeze it into `test/fixtures/` first if this
  is ever picked up, the way the HighRise was.
* **The critical path runs through ACCH-L0-N02**, the chiller added at step 4,
  not N01. Michael noticed and set it aside. The walk follows the largest flow at
  each junction, so it is reporting a real split; worth confirming the split is
  right rather than the reporting.
* **Two riser glyphs stack at a pass-through floor.** On L1 both P8 (below) and
  P31 (above) meet node N9, so `drawRiserGlyph` draws a ring for each at the same
  point — which is what "overlapping the risers" looks like. Cosmetic; logged in
  `Human-Test.md` for Michael to judge.

**Also noticed, not fixed:** `M.setSync` collapses a sync CHAIN by walking
`head.pump` / `head.valve` and never `head.equip`, so an exchanger synced to an
exchanger that is itself a follower is not re-pointed at the head of the chain.
`applySyncedDesign` reads one level of `syncOf`, so the second follower would
copy a follower. No model has hit it yet.

---

## 0A. v0.18.11 — critical path rewritten (2026-08-23)

**The critical path was wrong in the closed-circuit (equipment) case, and it was
making the pump sizing wrong with it.** Michael flagged it critical. Four faults
in `criticalPath` (`src/network.js`), all in the branch that runs when there are
no demand nodes. The open-system/demand branch was correct and is untouched.

1. **The return pipework was not on the path.** The trace climbed to the pinned
   datum, and in a closed loop it reached that datum *up through the pump* — so
   the pipe carrying water BACK to the pump was never included.
2. **The index load was chosen by its own ΔP.** Parallel branches settle at the
   same head difference so that cannot separate them, and it is read at ACTUAL
   flow, so a starved branch reports a SMALLER drop than one over-flowing. It
   pointed at the best-served load. Now the index is the **worst-served** load,
   `flow / qRated`.
3. **The walk threaded several loads** (5 on the HighRise, 4 on the DC). Other
   loads are now blocked, and the return half may not re-use a supply link.
4. **The walk could DEAD-END.** A greedy head-gradient walk can step into a
   branch whose only exit it has already visited — on the HighRise it stopped at
   N28 while the datum was N143. Two changes: it now **follows the flow**
   (continuity cannot dead-end), and a closed circuit **terminates at the pump**,
   not at a fixed head — the pinned datum can sit on a dead leg, which is what
   the HighRise does.

`autoSizeForFlow` drove the LARGEST flow to the LARGEST rating, so it stopped
once the EASIEST branch reached rating — an undersized pump. It now drives the
**worst-served ratio** to 1, the same criterion the critical path uses, so the
sheet and the pump agree on which machine governs.

**Verified:** minimal loop 16.9692 = 16.9692; a two-floor copy reports L2 not L1;
HighRise (variable primary — PMP-1/2 duty, PMP-3 standby) and both DC models each
give ONE load, ONE pump, and **friction + static = pump head exactly (delta
0.000 m)**. `test/fixtures/highrise-variable-primary.pnet.json` is frozen and the
IDENTITY is asserted, not a hard-coded duty.

**Also in v0.18.11:**
* EWT/LWT on the info panel is a slash, not an arrow.
* A strainer (adiabatic) below its rating no longer raises `EQUIP_OFF_RATING`;
  plant already had that exemption. Over-rating is still reported for everything.
* A disconnected island is flagged at its **open ends** (degree ≤ 1), not on every
  node — a pasted pump used to stack the glyph on the device itself.
* New heat exchangers / heat sources are **oriented to the flow** when the pipe
  already carries some (`insertInline(..., alignToFlow)`).
* **Equipment naming convention** — `[Prefix1][Number1]-[Prefix2][Number2]`,
  prefix None|Tag, number None|Floor|Sequence, per equipment kind, on SETTINGS.
  Trailing spaces kept; the dash disappears when the second half is empty.
  `M.equipmentTag` / `M.retagLevelEquipment` / `M.levelNumber` in `model.js`.
  **Copying a floor now re-tags its equipment.** Michael's worked example
  (L0-AHU01 … L3-AHU01) is asserted.

**STILL OPEN — the MIN/MAX/SET discussion.** How to support control schemes other
than "hold a value" (e.g. minimum flow through chillers at low load). Proposal,
not built: add a comparator to a setpoint — SET (current behaviour), MIN (act
only when the reading is below target), MAX (only when above). The bracketed
search is already one-sided, so the change is to clamp the error to one side
(`err = max(0, target − reading)` for MIN); the direction-agnostic perturbation
logic is untouched. UI: a MIN/MAX/SET selector beside each setpoint.

---

## 0B. Earlier in this run — v0.18.3 to v0.18.10 (2026-08-20/23)

**STANDING RULES NOW, from Michael (2026-08-23): BOTH freezes are LIFTED.** Bump
the `?v=` token and `FD.VERSION` together as normal, and push — he tests off
GitHub Pages. CI (`.github/workflows/pages.yml`) gates the deploy on the test
suite, so a red suite means the site does not update.

Because the token now moves with the edit, a UI change is verifiable by opening
`index.html` normally. `styles.css` edited AFTER a bump within the same session
still needs a `?nc=` buster on the `<link>`, since the token has already been
spent.

**Note house style (Michael):** in the HTML docs, the callout classes map to
fixed tags — `.note.rule` → **NOTE:**, `.note.limit` → **IMPORTANT:**,
`.note.check` → **SUGGESTION:**. Write plainly (ASD-STE100 principles); no
headline sentences.

**Done this phase:**
* **Message-wording pass** — every engine message string aligned to Michael's
  revised `docs/MESSAGES.md`, codes unchanged. Touched `solver/geometry/model/
  thermal/app/network.js`; `app.js` `computeWarnings` PDM reformatter and the
  DW_FIXTURE_SHORT pass-through updated. 14 test assertions on old phrasing were
  re-pointed (`closed/model/simulation/supply/thermal.test.js`). **Flagged to
  Michael for him to fix IN THE DOC** (source shipped the corrected form):
  THERMAL_SINGULAR says "pressure" should be "temperature"; PDM says "velocity"
  should be "friction rate"; REVERSE_BLOCKED "it's"→"its"; TAG_MANGLED "use"→
  "Use"; SUPPLY_INSUFFICIENT + OUTFLOW_SHORT have an unbalanced "(Short by …";
  SOURCE_PRESSURE_MOVED's Message cell concatenates new + old text.
* **Setpoint control moved** THERMAL tab → SETTINGS (it drives the control loop,
  which runs in plumbing too, where THERMAL is hidden).
* **User-facing HTML docs** built and registered in `src/docs.js` (each
  `html: true`, opened in an `<iframe>` in the DOCUMENTATION pane — an iframe is
  a navigation, so it works from `file://` where `fetch()` of a sibling does not;
  theme passes in `?theme=`): `engine.html` (Calculation Method, with the 10.67
  derivation and a worked GGA example on `20260819-example.json`),
  `architecture.html`, `user-manual.html`, `tutorial-01-basics.html`.

**Open / handed back to Michael:**
* **`src/docs.js` registry has 4 stale paths** that 404 in the app —
  `docs/HANDOVER.md` (the DEFAULT doc, so it 404s on every load),
  `docs/piping-friction-loss-spec.md`, `docs/Human-Test.md`, `docs/PUBLISHING.md`
  (now in `docs_internal/`), plus `docs/ROADMAP.md` (never existed). **Decide
  whether internal docs should appear in the app at all**, then fix or drop the
  entries.
* **Michael is building his own `tutorial-hydronic/calculation/hydraulic/
  thermal.html`** (per-tab, mock-up based). The `user-manual.html` I wrote
  overlaps the Piping Network ribbon — he will say how to reconcile.
* **`examples/` was emptied/regenerated by Michael** this cycle; tests read only
  `test/fixtures/`, so `examples/` and `debug/` can be dropped from a deployment.
* **GGA iteration-values** expansion of `engine.html` §6 was requested "later"
  (WORKLIST / task backlog).
* **Possible anomaly to check:** `PUMP_RUNOUT` fires on `Tutorial 01 - Basics`
  at ~99% of design flow (limit is 120%). Not chased.

**OPEN AT THE END OF THIS RUN (2026-08-23) — read with §0:**
* **MIN/MAX/SET on setpoints — designed, NOT built.** See §0. This is the next
  substantial piece of engine work and Michael has already framed the use case
  (holding a minimum flow through chillers at low load).
* **`docs_internal/Draft/` and `docs_internal/Fixed/` are UNTRACKED.** They are
  Michael's own in-progress documentation; they were deliberately left out of the
  v0.18.11 commit rather than bundled into it. Ask before committing them.
* **The naming convention applies FORWARD ONLY** — to equipment placed from now
  on and to a floor when it is copied. Existing tags are untouched by design.
  There is no "re-tag the whole model" action; `M.retagLevelEquipment(m, levelId)`
  exists and would be the building block if Michael wants one.
* **The naming preview on SETTINGS always shows the GROUND floor.** It builds a
  throwaway model so the preview cannot drift from the real result, which means
  it cannot show how L3 would number. Deliberate; say so if it is raised.
* **HighRise is now a frozen fixture** at `test/fixtures/highrise-variable-primary.pnet.json`.
  It is a VARIABLE PRIMARY system — PMP-1 and PMP-2 duty, PMP-3 standby. Do not
  read it as primary/secondary; that misreading cost most of a session.

**DONE 2026-08-22 (v0.18.3) — the two program changes Michael asked for:**
1. **A new Heat Exchanger arrives with its Integrated Control Valve ON.**
   `View.prototype.equipClick` (`src/canvas.js`) sets `eq.equip.icv` after
   `insertInline` when `def.equipType === 'exchanger'`, with
   `kv: FD.valves.defaultKv('globe', M.pipeBore(m, eq) * 1000)` and
   `opening: 100` — the SAME expression the panel switch uses, so a valve made
   by placement and one made by the switch are identical (checked: DN50 sch40,
   bore 52.48 mm, Kv 45 both ways). **PLACEMENT ONLY.** A source or an adiabatic
   item gets no `icv`; `migrateEquipThermal` never adds one, so existing files
   load exactly as before (verified on `economizer-trim`, `parallel-branches`,
   `stacked-riser` — 11 exchangers, 0 with `icv`). Retyping an item to Heat
   Exchanger in the panel does not add one either.
   `docs/tutorial-01-basics.html` §7 already told the reader to set the switch
   Off, so the tutorial still works; a NOTE was added saying the valve now
   arrives ON, because the reader would otherwise meet a switch already on and
   skip the row.
2. **Level view-direction arrows** on each Levels row — `renderLevels`
   (`src/app.js`), `.level-dir` / `.level-dir-btn` in `styles.css`. Both arrows
   always draw and the ACTIVE one is lit (accent, full opacity; the other sits
   at .45). **Michael asked for them to be CLICKABLE**, so clicking an arrow
   sets `lv.lookDir` with `pushUndo()` — the level dialog keeps its field.
   `stopPropagation` on the click, so setting the direction on a row does NOT
   make that level active (verified). Undo restores the direction and relights
   the row.

**DONE 2026-08-23 (v0.18.4/.5) — A SYNC GROUP IS SIZED AS ONE MACHINE.**
Michael: "multiple equipment in sync should also have their sizing synced. There
should be a Notice generated." Sync previously copied only the POSITION (pump
speed / valve opening / coil part load), so a ganged pump set could run at one
speed while holding two duties and two curves — `autoSizePumps` sized every
`mode === 'auto'` pump independently, and a follower left on Manual simply kept
whatever duty had been typed.

* **`applySyncedDesign(m, notices)`** (`src/network.js`), called from
  `applySyncs`, so it runs at the top of EVERY `build` and therefore tracks the
  leader THROUGH the sizing iteration instead of lagging it by a pass. A PUMP
  follower takes the leader's sizing mode, `qDesign`, `hDesign`, `head` and a
  deep copy of the curve; an EXCHANGER follower takes `duty`, `qRated`,
  `pdRated`. Called a second time after `recordDesignPoint`, which writes the
  leader's settled design point after the last build.
* **Only the leader is sized** — `autos` in `autoSizePumps` now also filters on
  `!M.syncOf(p)`.
* **A synced pump left OFF keeps its own `mode`.** Standby is a separate
  decision from selection; the spare still takes the leader's curve, so it is
  ready to run.
* **SAID IN THE PANEL, NOT IN A MESSAGE.** This shipped for one version as a
  `SYNC_SIZED` notice; Michael took it out same day — "remove the notification
  and just grey out slave pump pressure and flows. Show the master pump values
  instead with (Synced with XXX) appended after flow." A notice fires on every
  solve to describe a relationship the engineer set up on purpose, which is
  noise, and it answers the question a long way from where it is asked. So the
  PUMP panel (`renderPumpProps`, `src/app.js`) now:
  - reads the design point from the LEADER (`pumpDesignPoint(syncLead || p)`), so
    a pump synced a moment ago shows the duty it is about to be given rather
    than the one it is about to lose;
  - forces both duty boxes read-only on a follower whatever the sizing mode says
    (`manual = sizing === 'manual' && !syncLead`) — they pick up the existing
    `.field input[readonly]` treatment, muted with a dashed border;
  - appends `(Synced with <leader>)` as a `.hint-inline` on the FLOW row only.
  `SYNC_SIZED` is gone from `NOTICE_CODES`, the engine and the catalogue. 17
  assertions in `test/closed.test.js`, one of which greps `network.js` to prove
  the code is not emitted anywhere. Behaviour documented in `docs/engine.html`
  §7.4 and §8.3.

**STILL OPEN.** The greying is done for PUMPS only, which is what Michael asked
for. A synced COIL's duty / rated flow / rated pressure drop boxes are still
editable and are overwritten on the next solve — the same trap, one panel along.
The pump **Sizing** dropdown on a follower is also still editable and equally
forced. Both are one-line applications of the same pattern; left alone rather
than widened past the instruction. Sync also does NOT copy a coil's ICV,
`dTMax` or `tLimit` — only the three fields agreed.

**`MESSAGES.md` MOVED** (Michael, 2026-08-23) to `docs_internal/` with the rest
of the developer docs — `docs/` is USER documentation now. That broke
`test/engine.test.js`, which read `docs/MESSAGES.md` and threw on the missing
file; the catalogue check follows the file to `docs_internal/MESSAGES.md`.

**DONE 2026-08-23 (v0.18.6) — TUTORIAL 01 auto-size + DOCUMENTATION cleanup.**
* **Tutorial 01** (`docs/tutorial-01-basics.html`) grew two sections and now runs
  to 14. NEW **§12 "Size the pump automatically"** shows DESIGN auto-size on the
  one-AHU loop — a "What DESIGN shows — one AHU" box: design flow 2.4 L/s, pump
  duty **~86 kPa** (below the 150 kPa hand estimate). "Add a second AHU"
  renumbered 12→13. NEW **§14 "Size the pump for both AHUs"** — auto-size with two
  coils gives **~178 kPa / ~4.7 L/s**, both coils recover to ~2.4 L/s and ~10 K.
  Both new sections carry the recommendation NOT to leave a pump on Auto when
  simulating (a coil's — pump's — Auto curve is frozen at the last DESIGN duty and
  does not re-size in SIMULATE; a never-sized pump has no curve at all →
  `NO_PUMP_CURVE`). Numbers are from the real engine (headless build of the
  parallel branch), not estimated.
* **§5 IMPORTANT re-pointed.** It claimed "an Auto pump has no fixed curve for
  the simulation to read", which the auto-generate-on-design behaviour makes
  false. Now: Manual/Curve give a curve directly, an Auto pump uses the curve
  from its last DESIGN sizing. Consistent with `architecture.html` §8.5.
* **DOCUMENTATION tab cleaned** (`src/docs.js`). The old registry pointed at ~12
  files that no longer live in `docs/` (moved to `docs_internal/`, or the Draft
  tutorials, or never-existed `ROADMAP.md`) — every one a 404, including the
  default `HANDOVER.md`. Registry is now the eight USER-facing docs: User Manual,
  Tutorial 01, Calculation method, Engine verification, Architecture, Messages,
  README, Licence. All the `docs/*.html` except the backup, per Michael. Default
  is the User Manual. Verified in-app: the nav shows exactly those eight and the
  tutorial frame renders the two new sections.
* **`engine_backup.html` moved** `docs/` → `docs_internal/` (Michael).

**DONE 2026-08-23 (v0.18.9) — equipment tags, SECURITY REVIEW, schedules tutorial.**

1. **Equipment tags say what the machine is, and are two digits.**
   `TAG_PREFIX` (`src/canvas.js`) split `equip: 'AHU'` into **`exchanger: 'HX'`**
   and **`heatsource: 'HS'`**; `equipClick` picks by `equipType`. `nextTag` now
   zero-pads below 10 — **HX-01, HS-01, STR-01** — and past 99 it just grows
   (HX-100). The pad lives in `nextTag`, so PUMPS AND SENSORS GOT IT TOO
   (PMP-01, PS-01): consistent, and flagged to Michael. `AHU` is deliberately
   NOT reused, so an old file's AHU-1 and a new HX-01 never collide and each
   numbers independently — verified, along with gap reuse (HX-01 + HX-03 → HX-02).
   `AHU|HX|HS` added to the four mangled-tag regexes in `model.js`.

2. **SECURITY REVIEW — `docs_internal/SECURITY-REVIEW.md`.** Three real findings,
   all REPRODUCED in the running app and re-tested after fixing:
   * **HIGH, fixed — stored XSS via a pipe-schedule name.** `m.customSchedules`
     comes straight out of the .pnet.json and the THERMAL tab concatenated
     `curS.name` into `innerHTML`. A crafted model file ran script on opening the
     tab. It PERSISTED: custom schedules are written to `localStorage` on the
     next save, so it re-fired every launch. (Test payload cleaned out of
     Michael's browser storage afterwards.)
   * **HIGH, fixed — stored XSS via a display unit** (`settings.display.flow`)
     into the TOOLS table header, same class.
   * **MEDIUM, fixed — CSV formula injection.** A tag of `=cmd|'/c …'!A1`
     exported as a live formula cell. `csvSafe()` prefixes an apostrophe —
     **but deliberately never to a number**, or `-5.2` would stop being numeric.
   * Fixes are output encoding, not input filtering: `theadRow()` in `app.js` and
     `tools.js` builds headers through `textContent`. **The rule: anything out of
     a model file is DATA — into the DOM as text, never as markup.**
   * Found sound: **no network egress at all** (no fetch/XHR/WebSocket/beacon/CDN
     — the app cannot phone home), no `eval`/`Function`/`document.write`, no
     prototype pollution, printer.js builds SVG via `createElementNS`+`textContent`,
     dxf.js sanitises to ASCII.

3. **`docs/tutorial-02-schedules.html`** — adding a pipe schedule, both the
   in-app Custom route and editing `data/schedules.js`. Registered in `docs.js`
   (nine entries now). **`data/schedules.js` was made easier to edit**: a signposted
   header, a new **`fromBore([[label, bore, od], …])`** helper beside `fromWall`,
   and a **YOUR OWN SCHEDULES** block at the end of the table with a commented
   template. The template's placeholders are `<od>`/`<wall>`, NOT numbers, so
   uncommenting it without editing fails loudly instead of shipping invented
   data. **The tutorial was executed literally** — added a schedule by its own
   steps, confirmed 15.00/0.70 → bore 13.6 mm, then restored the file.

**STE PASS 2026-08-23 (v0.18.10), Michael: "When putting in notes for the user
to follow in the schedules, please remember to use our STE approach."** The
instructional comments I first wrote in `data/schedules.js` were in the project's
DEVELOPER voice — long sentences, figurative wording ("fails loudly", "quietly
shipping a made-up pipe", "falls back ... without saying so"), headline openers
("ADDING YOUR OWN SCHEDULE?"). Those comments are read by a USER who is editing
the file, so they take the doc house style, not the code one. Rewritten:

* `data/schedules.js` — the header, both helper comments and the YOUR OWN
  SCHEDULES block. Numbered imperative steps, one instruction per sentence,
  active voice, no idiom. Warnings carry the same `IMPORTANT:` tag the HTML docs
  use. The two templates are now labelled TEMPLATE 1 / TEMPLATE 2 by which
  published table the reader has.
* `docs/tutorial-02-schedules.html` — 31 sentences rewritten. One prose sentence
  over 22 words remains and it is a list of standard names. No idiom left.

**The rule for next time: developer comments keep the project voice; anything a
USER is expected to follow is STE, wherever it physically lives.** A `.js` file
is not automatically developer text.

Re-verified after the rewrite by following the new steps literally: added a
schedule from TEMPLATE 1, confirmed 15.00/0.70 gives bore 13.6 mm, restored the
file.

**NOTE FOR NEXT TIME — the cache bit me.** I bumped to 0.18.7, THEN edited
app.js, and the browser served the pre-fix file: the XSS retest reported "still
vulnerable" against a file that was already fixed. Bump AFTER the last edit, or
re-bump. §0 says this; it is easy to do in the wrong order.

---

## 1. What this is

FreePipeCalc is an offline, single-page piping friction-loss and thermal
calculator for building services. MIT, freeware, no build step, no server, no
dependencies. It opens from `file://` by double-clicking `index.html`.

Michael is a Building Services Engineer. He is the domain authority: when he
says an answer is wrong, the working assumption is that he is right and the
model is wrong, and that has held up every time it has been tested.

**Layers**, load order fixed in `index.html`:

    data/*.js      tables — schedules, fittings, valves, pumps, fluids,
                   plumbing (IPC fixture units, demand + 604.3 tables, verified)
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

**The engine is in good shape and the backlog is short.** Hydraulics, thermal,
pump sizing, control loops, sync, copy-paste, the tools and the DXF/print paths
all work and are covered.

**The one feature in flight is the Domestic Water (DW) module.** Approach was
agreed with Michael (`docs/DW-MODULE.md`). **Phase 1 (v0.16.31)** added the data
(`data/plumbing.js`, IPC 2018 Appendix E, `verified: false`), the model
(`M.outflowFU`, `settings.plumbing.system`, `demandType`), and the outflow UI.
**v0.16.32** made the fixture list the full Table E103.3(2) with a per-outflow
**Variation** dropdown, and added the **sizing core** `M.plumbingSizing(m)` — a
pure tree walk from the source that accumulates downstream cold FU + generic
flow per pipe and sizes `Generic + fuToFlow(FU)` (sub-additive), rejecting a
loop / missing / multiple source (`DW_LOOP`, `DW_NO_SOURCE`, `DW_MULTI_SOURCE`)
rather than guessing. The PIPE panel shows the diversity flow read-only.

**RE-ARCHITECTED 2026-08-16 to protect the GGA (Option A, one app).** Michael
decided DW must not fold into the known-good solver at all. The new shape: **a
file is one discipline** — `m.discipline` = `'hydronic'` (default) or
`'plumbing'` — and in a plumbing file the GGA is NEVER invoked (not on the code
path). Discipline sits a layer ABOVE the tab bar, on the **repurposed loop-type
chip** (`#system-chip` becomes a HYDRONIC/PLUMBING switch; clicking it toggles,
with a confirm — "Changing an existing model between Hydronic and Plumbing may
break it"). The network tab is relabelled per discipline (HYDRONIC — was "PIPING
NETWORK" — or PLUMBING) and the plumbing discipline shows a reduced tab set (no
THERMAL/HYDRAULIC). Plumbing is solved only by `M.plumbingSizing`. The in-Design
plumbing UI from v0.16.31–32 (Plumbing outflow type, Variation dropdown,
pipe-panel DW readout) is hidden unless the discipline is plumbing, and rebuilt
inside it. The data (`data/plumbing.js`) and the sizing core (`M.plumbingSizing`,
`M.outflowFU`) stay. Full spec and build phases A/B/C are in `docs/DW-MODULE.md`
→ **Architecture v2**.

**CURRENT STATE (v0.18.2): the DW module is functionally complete and Michael
has signed the IPC data off — `FD.plumbing.verified = { fixtures, demand, supply }`
all TRUE.** What exists:

* **Discipline scaffold** — `m.discipline` `'hydronic'|'plumbing'`, the
  `#system-chip` toggle/confirm, per-discipline tab set, and the solve gate: a
  plumbing file makes ZERO GGA `solveModel`/`solveCore` calls on the DESIGN path.
* **Data** (`data/plumbing.js`): E103.3(2) fixture cold-FU (with per-fixture
  `tag` prefix, e.g. WC/UR/HB), E103.3(3) demand curves (flush-tank/flushometer),
  and Table 604.3 supply outlets. `DEFAULT_SPEC` maps each fixture/variation to a
  604.3 outlet OR a computed ESTIMATE (bathroom group = largest 2 of lav+shower+WC;
  kitchen-sink/shower public = FU-ratio × private; washing machine = lavatory /
  service-sink flow @ 100 kPa). All three tables editable per model
  (`m.settings.plumbing.fu` / `.demand` / `.design`, plus legacy `.supply`).
* **Model helpers** (`src/model.js`): `plumbingSizing` (diversified tree sizing),
  `plumbingFixtureDefault`/`plumbingSpecDefault` (604.3 design flow+pressure,
  estimate-aware), `plumbingUndivFlow`, `plumbingReqPressure`, `plumbingFuToFlow`,
  `outflowFU`, `plumbingTagPrefix`.
* **The plumbing "solve"** (`FD.network.plumbingReport`): DESIGN sizing +
  per-pipe friction + a forward RESIDUAL-pressure pass (adds a booster pump's
  head). SIMULATE (`app.buildPlumbingSimModel`) converts each fixture to a
  pressure-dependent K-terminal at its undiversified 604.3 design point and runs
  the UNMODIFIED GGA — so DESIGN and SIMULATION give different, both-correct
  pressures.
* **HYDRAULIC tab** (plumbing): supply-system selector; ONE merged fixtures table
  (Fixture | Occupancy/Supply | Fixture Units (FU) | Design Flow | Design
  Pressure | Table 604.3 Type), all editable, estimated rows in RED with a
  footnote; and the editable demand-curve table.
* **CALCULATION sheet** (plumbing, hydronic-style collapsible sections): a
  Demand-Curve-Type line, **All Pipes (Design)**, **Critical Path (Design)**, and
  **Critical Path (Simulation)** — columns follow hydronic with a Downstream-FU
  column before Flow.
* **Outflows**: default to a plumbing WC in a plumbing file; auto-tag by fixture
  (WC-1, UR-1…); a pre-placement TEMPLATE panel (OUTFLOW tool); Display switches
  (Tag Info-Panel default-on, FU, Design/Actual flow, Required/Available), no
  Temperature; multi-select edits common props + Display together.

**The per-pipe diversity-flow readout on the canvas is DONE** — it was built and
never ticked off. Annotations ▸ Pipes carries **Fixture units** (plumbing only,
`a.pipeFU`) and the ordinary **Flow** annotation reads `res.flow`, which in a
plumbing file IS the diversity flow: a pipe on 20260818-lowrise labels
`48.8FU/50⌀/2.81L/s`. The printed plan carries the same label as of v0.17.15. The DXF
item DX.1 is unrelated. Regression fixtures: `test/fixtures/plumbing-booster.pnet.json`.

**Debug files used:** `debug/20260817-PLBG.json` (booster), `debug/20260818-lowrise.json`
(47 outflows, the current test model).

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
flagged or not at all. The propylene glycol properties are still shipped flagged
`verified: false` and must not be quietly promoted. The IPC 2018 plumbing tables
in `data/plumbing.js` (fixture cold FU, FU→demand curves, 604.3 supply outlets)
WERE transcribed-not-confirmed but Michael signed them off on 2026-08-18, so
`FD.plumbing.verified` is now `{ fixtures:true, demand:true, supply:true }`. The
"estimated" 604.3 rows (not in the code — bathroom group, kitchen-sink/shower
public, washing machine) remain flagged in RED on the HYDRAULIC tab.

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

**A GREEDY WALK IS NOT A PATH-FINDER.** `criticalPath` traced the index circuit
by repeatedly stepping to the neighbouring node with the highest head. That is a
greedy walk, and a greedy walk can step into a branch whose only exit it has
already marked as visited — it then simply stops, wherever it happens to be. On
`20260910-HighRise` it stopped at N28 while the datum was N143, and the result
looked plausible: a path, a friction total, a static figure. Nothing said the
path had not arrived. **If a trace must reach a specific place, check that it
GOT there** (`origins[end]`), and prefer a rule that cannot dead-end —
following the flow works because continuity guarantees the water returns to the
plant (v0.18.11).

**A METRIC READ AT THE SOLVED FLOW CANNOT RANK THINGS THAT SHARE A HEAD.** The
index load was picked by the largest pressure drop across the equipment. Parallel
branches settle at the SAME head difference between headers, so that number is
equal for all of them by construction — and because it is read at the ACTUAL
flow, a starved branch reports a SMALLER drop than one that is over-flowing. The
metric pointed at the best-served load while claiming to find the worst. **Rank
by how badly a machine is SERVED (`flow / qRated`), not by what it drops**, and
use the same criterion in the sizer so the sheet and the pump cannot disagree
(v0.18.11).


These are not hypothetical. Each cost a session or a user-visible bug.

**Bump the `?v=` token in `index.html` after editing any module — INCLUDING
`styles.css`.** The browser serves stale code otherwise. It is not a build step.

**AND A TOKEN IS SPENT ONCE.** Editing a module AFTER bumping, within the same
session, leaves the browser on the old copy — the node suites read from disk and
go green while the app runs the previous file. On 2026-08-25 that made
`M.icvMode` `undefined` in the browser and every properties panel threw, against
a fully passing suite. **Navigating to the same URL does not re-fetch
`index.html` either**, so bumping alone is not enough once the page is loaded:
bump the token AND load `index.html?nc=<n>`.

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

**`runControlsGen` BEGINS `if (!FD.thermal) return out;`** — so a harness that
omits `src/thermal.js` makes every control loop a silent no-op, and a controlled
pump appears to ignore its sensor. That is exactly how Michael's plumbing sensor
looked broken from a test script on 2026-08-19; the app was fine. `plumbing.test.js`
now loads thermal for this reason even though nothing in it is thermal.

**DO NOT REPLACE THE K-TERMINAL WITH A FIXED DRAW.** It was done for one day
(v0.17.21) and cost the physics AND the control loop — see
`docs/DW-MODULE.md` → "SIMULATE is the GGA on a K-terminal copy". A fixture
discharges more when over-pressurised; that is the finding, not a fault.

**A NUMBER COMPUTED AND NOT PUBLISHED IS A NUMBER NOT COMPUTED.** The plumbing
forward pass had every outflow's actual draw in `draw[node]` — it is the whole
basis of the method — and reported "no actual flow" everywhere, because
`drawDeviceBox`, the outflow panel and the calculation sheet all read
`res.simulation.terminals` and only the GGA path built one (v0.18.0). **When a
second solve path is added, list what the FIRST one publishes** — `flow`,
`pressure`, `warnings`, `errors`, `simulation`, `critical` — and either fill each
one or be deliberate about leaving it empty. Four of those six have now been
found missing on the plumbing path, one release at a time.

**A PLACEHOLDER IS A LOADED GUN ONCE A SECOND DISCIPLINE READS IT.** A plumbing
fixture keeps `device.flow = 0.001` and `device.reqPressure = 100000` — the
values `setDemand` writes for a hydronic outflow — because the real numbers come
from Table 604.3 via `M.plumbingUndivFlow` / `M.plumbingReqPressure`. Anything
that reads the raw fields on a plumbing fixture gets a number that is
syntactically fine and physically meaningless. It has now bitten three times:
the drawing showed 1.00 L/s (v0.17.8), `computeWarnings` measured shortfalls
against the wrong pressure (v0.17.15), and `autoSizePump` sized a booster at
47 fixtures × 1.00 L/s = **47 L/s @ 2 MPa** (v0.17.16). **In a plumbing file, go
through the M.plumbing* helpers, never `dev.flow` or `dev.reqPressure`.**

**A SECOND DISCIPLINE DRIFTS UNLESS SOMETHING PULLS IT BACK.** The plumbing
module reached "functionally complete" with ten presentation and engine
divergences from the hydronic baseline, none of them visible from inside the
plumbing code (v0.17.15). The two that mattered: `plumbingReport` returned
`warnings: []` unconditionally, so 83 over-limit sections reported a green chip;
and the plumbing sheet carried no DISCLAIMER, because the shared one sat after
the early `return` in `renderCalculationInner`. **When you add a discipline
branch, list what the hydronic path does AFTER the branch point** — the
disclaimer, the warnings section, the appendix and the CSV writer were all
downstream of it. Shared behaviour now lives in shared functions
(`fillWarningGroups`, `appendDisclaimer`, `updateStatusChip(res, err, okLabel)`,
`flowRegimeWarnings`) rather than being written twice.

**`nowrap` IS A SCREEN DECISION, AND PAPER HAS NO SCROLLBAR.** Every
`table.sheet` cell is `white-space: nowrap` so a column never breaks mid-number;
on screen the pane scrolls sideways when that makes the table too wide. Printed,
it simply ran off the right margin — 1059px of hydronic table against 703px of
A4 portrait between the 12mm margins (v0.17.14). The print rules now let the
HEADINGS and TEXT cells wrap and keep the numbers unbreakable. If a column is
added to a sheet, measure the table's `min-content` width against 703px before
assuming it still fits.

**A DEFAULT-ON SWITCH IS NOT IN THE MODEL.** `setDisplayFlag` deletes a value
equal to its default to keep the document sparse, so a plumbing outflow's Tag —
which defaults ON — is stored only when it is switched OFF. `drawDeviceBox` then
bailed on `Object.keys(show).length === 0` before it could draw it, and the tag
appeared only once some OTHER switch had put a key in `show` (v0.17.13). An
empty `show` does not mean "nothing is drawn": ask `M.displayDefaults(m, obj)`
too, and take a panel's `def:` from there rather than writing `true` at the call
site, or the two drift.

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

**NO TEST READS `examples/` OR `debug/` ANY MORE (v0.17.19).** Two did —
`thermal.test.js` opened `examples/stacked-riser.pnet.json` and
`debug/20260805-4.json` directly — which broke the project's own rule and meant
neither directory could be dropped from a public deployment without taking 528
assertions with it. Both are frozen into `test/fixtures/` now, and the full suite
passes with both directories deleted. `debug/` is gitignored AND untracked: it
lives on Michael's disk and does not go to GitHub. **`examples/` is therefore
free to change** — nothing depends on its contents.

**GITHUB PAGES IS PUBLISHED BY A WORKFLOW, NOT THE BRANCH BUILDER (2026-08-19).**
`.github/workflows/pages.yml` runs on every push to `master`: it runs all ten
test suites, and deploys only if they pass. The legacy branch builder was silently
dropping pushes — v0.17.19, v0.17.20 and v0.18.0 all reached the remote while the
site went on serving v0.17.17, with no error recorded anywhere and only two builds
in the entire history. A workflow leaves a run with a log. `workflow_dispatch`
re-runs it by hand from the Actions tab without an empty commit. It also removes
Jekyll from the path: the artifact is served exactly as uploaded.

**If the site does not update, look at the Actions tab first** — a red `test` job
means the deploy was refused on purpose.

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
| A plumbing (DW) outflow is sized from FIXTURE UNITS, not continuity | Demand is a sub-additive diversity curve (IPC), so a DW branch legitimately does NOT balance — Phase 2 solver must not treat that as an error |
