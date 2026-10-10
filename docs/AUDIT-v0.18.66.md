# FreePipeCalc audit — v0.18.66

Date: 2026-10-09. Base: v0.18.65 (`40ce610`).

Scope: the whole repository, with a detailed check of SIMULATION against
standard piping engineering methods, and a pass over the user interface.

This report uses ASD-STE100 Simplified Technical English.

---

## 1. Summary

The engine is sound in its method. The network solver, the friction
equations, the valve law, the affinity laws and the heat transport are
correct. Section 5 lists what was checked.

The audit found four calculation defects. This version corrects all four.

Your decisions of 2026-10-10 settled two items: the run of a tee (now the
stream that goes straight) and the heat exchanger model (intended, no
change). A review of the new tee rule found five defects in the loop that
assigns the fittings, all also in v0.18.65, and one in the flow-ratio
coefficient. A re-baseline found one more, in ganged devices.
This version corrects all of them.

Section 2 gives each defect, the correction, the test, and the measured
change to the shipped models. Section 3 lists the items that still need a
decision.

| # | Correction | Mode | Change to shipped results |
|---|---|---|---|
| 2.1 | A running pump has a check valve on its discharge | Both | None on shipped models. Removes a solver divergence. |
| 2.2 | The thermal solve uses the water properties at the source temperature | Both | Coil ΔT +0.56% at 6 °C. Control positions do not change. |
| 2.3 | A ΔP sensor reads the piezometric difference | SIMULATION | None. All shipped sensors have both tappings at one level. |
| 2.4 | A fitting charged to a pump, valve or equipment link is added to the loss | Both | Two test fixtures only: pump head +0.82%, branch flow up to 0.6%. |
| 2.5 | The run of a tee is the stream that goes straight (decided 2026-10-10) | Both | 3-floor riser pump head +9.7% (Hazen-Williams), +22% (Darcy-Weisbach). Other models −2.4% to +2.2%. |
| 2.6 | The fitting passes settle on the model, not on the drawing | Both | Data Hall flows up to 2.6 L/s (Hazen-Williams). Darcy-Weisbach solves on looped models now run to a settled answer. |
| 2.7 | The flow-ratio K holds the table edge below Fb/Fc = 0.09 | Both, Darcy-Weisbach only | Small take-offs from large mains get a realistic K. |
| 2.8 | A ganged follower reports its leader's final position | SIMULATION | Reported speed or opening only. Flows do not change. |

---

## 2. Calculation corrections

### 2.1 A running pump has a check valve on its discharge

**Defect.** The pump curve `H = H0 − a·|Q|^b` was symmetric in Q. A pump
forced backwards still added head, and its loss curve fell as the reverse
flow increased. Each pump in a parallel set has a discharge check valve, and
EPANET applies this rule to all pumps. The program did not.

**Effect.** Two equal pumps in parallel, with one at 60% speed: the shutoff
head of the slow pump (0.36 × 40 m = 14.4 m) is less than the header head
(15.8 m). The solve did not converge. It showed 2300 L/s of reverse flow
through the slow pump and a pump head of −133 774 m.

**Correction.** `src/solver.js`. For reverse flow, the pump gives its shutoff
head and a stiff linear resistance (10⁹ m per m³/s) takes the excess. The
loss is continuous at Q = 0 and increases with Q, so the network has one
solution. The reverse flow is less than 10⁻⁷ m³/s for 100 m of excess head.
The program reports it as zero.

A new warning, `PUMP_SHUTOFF`, names the pump, the system head and the
shutoff head at the current speed.

**Test.** `test/simulation.test.js`, 18 assertions. The main check is
independent of the code: a pump held shut by its check valve must give the
same result as the same pump switched off. It does, to 10⁻⁶ m³/s.

**Change to shipped results.** None. No shipped model has reverse flow
through a pump.

### 2.2 The thermal solve uses the water properties at the source temperature

**Defect.** v0.18.62 (EQ.5) made the water density, viscosity and specific
heat follow the source temperature. The hydraulic solve used the new values.
`FD.fluids.resolve` did not: for water it returned the 20 °C preset at all
temperatures. The thermal solve, the duty–flow–ΔT relation of each machine,
the THERMAL tab and the TOOLS calculators all read `resolve`. One solve thus
used two different fluids.

**Effect.** At 6 °C the hydraulics used 999.9 kg/m³ and 4202 J/(kg·K). The
heat balance used 998 kg/m³ and 4187 J/(kg·K). The product ρ·cp differs by
0.56%. The THERMAL tab showed 998.0 kg/m³ at 20 °C while the HYDRAULIC tab
showed 999.9 kg/m³ at 6 °C.

**Correction.** `data/fluids.js`. For water, `resolve` returns the values that
`applyFluidTemperature` writes at the start of each solve. Glycol and custom
fluids do not change.

**Test.** `test/thermal.test.js`. A new section builds a 6 °C circuit and
compares the coil ΔT with `Q / (ρ(6) · q · cp(6))`. It reads ρ and cp from
`data/water.js` directly, not through `resolve`.

The hand calculations in `thermal.test.js` are written at 998 kg/m³ and
4187 J/(kg·K). Each model that the file builds is now pinned to those values
with `pinFluid`, which is how v0.18.62 handled the hydraulic suites. No
expected value was changed.

**Change to shipped results.**

| Model | Source temperature | Change |
|---|---|---|
| Tutorial 01, Tutorial 2 part load, tower five level, high-rise, parallel branches | 6 °C | Coil ΔT +0.56% |
| Data Hall & Yard | 30 °C | Coil ΔT +0.40%. Tower ΔT +2.0% (a consequence: the tower ΔT is small) |
| Economizer trim | — | Largest ΔT change 1.7%, on a source/sink |
| All models | — | Pump head, flows, pump speeds and valve openings: no change |

In SIMULATION the controlled positions do not change. The Design ΔT
setpoint and the measured ΔT both move by the same factor, so each control
valve stops at the same opening.

Tutorial 02 already states that 200 kW across 7.5 K is 6.35 L/s at 6 °C and
6.38 L/s at 20 °C. Before this correction the program gave 6.38 L/s at all
temperatures. It now gives 6.35 L/s, which agrees with the tutorial. On
Tutorial 01 the AHU-01 Design ΔT changes from 9.971 K to 9.916 K.

### 2.3 A ΔP sensor reads the piezometric difference

**Defect.** A differential pressure sensor read `p1 − p2`, the gauge
pressure difference. A real transmitter has impulse lines full of water. Each
line adds the column between its tapping and the instrument. The transmitter
therefore reads `ρ·g·(H1 − H2)`. This is also the differential that moves
water through the circuit between the two tappings.

**Effect.** The two values are equal when both tappings are at one level.
They differ by `ρ·g·Δz` when they are not. A supply tapping on the top floor
and a return tapping in the plant room read the static column of the riser
as a differential.

**Correction.** `src/network.js`, new function `differentialPa`. The control
loop, the Auto setpoint seed, the drawing and the sensor panel all use it.
The sensor panel had its own copy of the old sum. That copy is removed.

**Test.** `test/thermal.test.js`. A constructed result with tappings 20 m
apart in level. The expected value is arithmetic: 998 × 9.81 × 5 = 48 951.9 Pa.

**Change to shipped results.** None. In all seven shipped sensors, both
tappings are at one level.

### 2.4 A fitting charged to a device link is added to the loss

**Defect.** The fitting detector charges a fitting to the leg that the flow
says pays for it. That leg can be a pump, a valve or equipment. This occurs
when a pipe connects directly to the end node of a device. The program put
the fitting on the calculation sheet and then did not add its loss.

**Effect.** A DN50 tee branch charged to a coil: 3.05 m of equivalent length
(Hazen-Williams) or K = 5.6 (Darcy-Weisbach) was not calculated. Two of your
frozen drawings have this condition:

- `stacked-riser`: balancing valves BV-1, BV-2 and BV-4 (up to 4.57 m).
- `datacentre-ring`: a 90° elbow (3.05 m) at pump CHW-P-01.

**Correction.** `src/network.js`, `src/solver.js`, `src/hydraulics.js`. The
fitting is a third loss term on the device link, `rF`, at the exponent of the
method: Q^1.852 for equivalent length, Q² for K. It is not added to the rated
resistance of the device, because other code reads that value as the device
rating. The critical-path tally and the calculation sheet count it as
friction, so friction + static still equals the pump head.

**Test.** `test/engine.test.js`, 5 assertions. A coil rated 30 kPa at 2 L/s,
as the branch of a DN50 tee. Hazen-Williams: the coil drops 30.77 kPa. The
hand value is
10.6663 × 3.05 × 0.002^1.852 / (120^1.852 × 0.05248^4.8710) = 0.0791 m.

Three test rigs in `test/simulation.test.js` are redrawn. Their pumps sat
at a 180° hairpin, or two pumps shared one pair of nodes. The drawing tools
cannot make either layout. The rigs gave a pure pump-and-equipment circuit
only because the fitting at the pump was dropped. Each pump now sits on a
straight run with a pipe either side. No expected value changed.

**Change to shipped results.** `datacentre-ring` DESIGN pump head +0.82%.
`stacked-riser` branch flows up to +0.6%. No example model has this
condition.

### 2.5 The run of a tee is the stream that goes straight — decided

**Decision (2026-10-10):** "flow going straight will be evaluated based on
straight through, flow turning gets the turning coefficient."

**Defect.** The run was the pair of legs with the largest inflow and the
largest outflow (`pickRunPair`). Standard fitting data (ASHRAE, Crane,
Idel'chik) defines the run by geometry. When a side branch took more flow
than the straight leg, the program gave the run coefficient to the stream
that turned and the branch coefficient to the stream that went straight.
With Darcy-Weisbach, the Idel'chik flow-ratio curve went on the wrong leg.
On the data hall model the two rules disagreed at 30 of 51 tees.

**Correction** (`fittingsAtNode`, `goesStraight`). The flow sets dividing or
combining and the charged legs, as before. A charged leg is the run if it is
less than 8° from a leg on the common side. This is the program's one
definition of "straight": the deviation at which the elbow rule charges no
elbow. (The first measurement in this report used 30°.) The quantity of flow
has no effect. With it:

- A leg with no flow is not part of the fitting. A fill connection is no
  longer charged "T-br-c" against 0.00 L/s (Tutorial 01, N0 → N4).
- A cross can have two legs on the common side. A charged leg is then the run
  only if the leg in line with it can supply its flow, within 2%.
- A leg with zero length has no direction, so no leg is in line with it.
- One common leg has one run. In a very narrow Y, only the straighter leg is
  the run, and neither leg if they are within 2° of each other.

**Test.**
- `model.test.js`: the "second pass" section now pins the new rule. The
  turning leg that carries 92% of the flow gets the Idel'chik K
  357.5/144 = 2.4826 by hand. New sections cover the cross, the zero-length
  leg and the narrow Y, each from continuity or geometry.
- `supply.test.js`: the 3-floor riser by hand, 46.06 m.
- `simulation.test.js`: the ring main pump heads, 270.96 / 260.17 / 255.72 /
  251.98 kPa for 1 to 4 pumps. They come from a separate solver written from
  the drawing and the published tables. With the old rule, that solver gives
  the old engine's heads to 0.01 kPa. The engine agrees with it to 0.03 kPa.

**Change to shipped results.** DESIGN, auto-sized pump head, v0.18.65 against
this version. The figures include sections 2.6 and 2.7.

| Model | Hazen-Williams | Darcy-Weisbach |
|---|---|---|
| 3-floor riser | +9.68% | +22.05% |
| Data centre ring | +1.51% | +2.18% |
| Data centre redundant ring main | +0.36% | +0.57% |
| Tutorial 2 part load | +0.71% | +0.24% |
| Economizer trim | +0.07% | +0.07% |
| Parallel branches | +0.04% | +0.04% |
| Stacked riser | −0.69% | −2.42% |

Models whose pumps are not auto-sized show no change in pump head. Their
flows change instead. On the Data Hall the largest change is 2.6 L/s
(Hazen-Williams) and 11.9 L/s (Darcy-Weisbach). The DESIGN index coil is
AHU-12 (was AHU-13) with Hazen-Williams. On the ring mains under Darcy-Weisbach, the flow in the
discharge ladder moves by up to 8 L/s, because the old rule gave the run to
the turning leg there.

### 2.6 The fitting passes settle on the model, not on the drawing

The program assigns the fittings from the flows of the previous pass, and
repeats until the assignment settles. A review of section 2.5 found these
defects in that loop. All five are also in v0.18.65. The new rule makes
defects 1 and 2 larger.

1. **The first pass read the drawing.** Without flows, it took a pipe drawn
   away from a node as an outlet. On a looped header, two different
   solutions can each agree with their own fittings, and that guess selected
   one of them. On the Data Hall, a reversal of all the pipes moved
   cross-connector P280 from +6.9 to −6.8 L/s and the index coil from AHU-12
   to AHU-10. A mirror-symmetric double header split 19 / 41 L/s.
   **Now** the first pass charges no tee.
2. **Darcy-Weisbach stopped early.** The loop stopped when the fitting types
   and the flow signs repeated. The flow-ratio K also depends on the flows,
   so the flows still moved. On the Data Hall, P280 was 9.2 L/s against a
   settled 13.0 L/s. **Now** a K method also waits until no flow changes by
   more than 0.1% of the largest flow, with a maximum of 20 passes.
3. **The oscillation warning was lost.** Auto-sizing and the parallel-pump
   balance replace the result, and the warning went with the old result.
   **Now** the program adds the warning last.
4. **A take-off at exactly Q_MIN changed state at each pass.** The solver
   reports a flow below Q_MIN as 0, so the leg was wet, then dry, then wet.
   **Now** a leg becomes dry below Q_MIN/2 and wet above 2·Q_MIN.
5. **An elbow at a corner fed from both sides went to the pipe drawn last.**
   A symmetric diamond split 10.21 / 9.79 L/s. **Now** the program charges
   an elbow only where one pipe feeds the other.

**Test** (`model.test.js`). The symmetric double header gives 30 / 30 L/s
with zero cross flow in three drawings, under both methods. The diamond gives
10 / 10 L/s in both drawing orders. A take-off at Q_MIN settles. On the Data
Hall under Darcy-Weisbach, one more pass moves no flow by more than 0.2% of
the largest. A 2-pass solve of a model with an auto pump reports
FITTING_OSCILLATION. Each of these tests fails on the engine without the
correction.

**Cost.** Hazen-Williams models settle in 3 passes, as before. Under
Darcy-Weisbach most shipped models settle in 3 passes, the two ring mains in
9 and the Data Hall in 13 (5 before, not settled). A Darcy-Weisbach solve of
the Data Hall thus does 2.6 times as many passes.

### 2.7 The flow-ratio K holds the table edge below Fb/Fc = 0.09

**Defect.** Idel'chik's tables cover 0.09 ≤ Fb/Fc ≤ 1.0. `branchK` holds
ζ<sub>c</sub> at the 0.09 row, but the conversion into the frame of the
branch used the true ratio. So below the table the leg's K fell as
(Fb/Fc)². A DN15 take-off from a DN100 main (Fb/Fc = 0.024) got K = 0.16 at
Qb/Qc = 0.05, and 0.014 at Qb/Qc = 1, against a flat 2.4. On the Data Hall,
24 of 57 flow-ratio branches are below the table.

**Correction.** Outside the table, the coefficient is held at the table edge
in the frame of the smaller leg, because the loss follows the velocity in
that leg. Below 0.09 the branch is the smaller leg, so the conversion is also
held at 0.09. Above 1.0 nothing changes. The common leg is then the smaller
leg, and the program already charges the loss at its velocity (the DN40
riser into a DN200 header in engine.html section 4.4).

**Test** (`model.test.js`). DN15 off DN100 at Qb/Qc = 0.05:
2.80 × (0.09 / 0.1)² = 2.268 by hand. DN100 off DN25 holds row 1.0.
DN50 off DN100 is inside the table and does not change.

### 2.8 A ganged follower reports its leader's final position

**Defect.** The control search ends on its best point without a rebuild. The
followers of a sync group only copy the leader in `build`, so they kept the
position of the last trial. Three ganged pumps reported 73.6 / 73.5 / 73.5%.
The flows were correct.

**Correction.** `solveModelGen` copies the leader's position to the
followers after the control loop.

**Change to shipped results.** Reported follower speed or opening only.

---

## 3. Items for your decision

### 3.1 The price of a turn of 8° to 75° at a tee

Under the decided rule, a turn of 8° or more at a tee is a branch, and it gets
the full 90° tee branch coefficient. At an elbow, the same turn gets the 45°
elbow value. A 45° lateral and a Y also get the 90° branch coefficient.

Example: `datacentre-ring`, node N31, a five-way manifold with four dry legs.
The live leg P36 is 18.4° from straight. It now gets a tee branch, 6.40 m
(K 2.30) at DN100. An elbow there gets 1.58 m (K 0.28).

Options:

- (a) Keep. A turn is a turn. This version does (a).
- (b) At a tee, charge a turn of 8° to 75° as a run plus a 45° elbow.
- (c) When only two legs have flow, use the elbow rule.

This is written in engine.html section 15 as a limit.

### 3.2 The heat exchanger model — decided: intended

A heat exchanger holds its stated load at all flows, until its ΔT reaches the
Design ΔT limit.

**Decision (2026-10-10):** this is the intended method. No change. The
limitation note is removed from engine.html section 15, and section 8.3 now
says that the method is intended.

### 3.3 The control valve characteristic

The control valve table in `data/valves.js` is your table. It is not a
constant-ratio equal-percentage curve. The ratio over each 10% of travel goes
from 0.85 near full open to 0.50 near shut. A true equal-percentage valve
with a rangeability of 50 has a constant ratio of 0.676. This is a note only.
Real valves are often modified equal-percentage.

### 3.4 Other notes

- `BRANCH-NOTES.md` is on master. It says "work in progress, do not merge"
  for the `tee-fittings` branch, and it describes TEE.1 as waiting for a
  decision. TEE.1 option C is in the code. Recommend: move the file to
  `docs_internal/`.
- On the drawing, the node numbers at the two ends of a short device overlap
  (for example "N12N11"). A fix is in `canvas.js`. Not done.
- The user manual says a pump must be in Manual or Curve sizing to run in
  Simulate. An Auto pump gets a curve from its design duty after a DESIGN
  solve. The `NO_PUMP_CURVE` message gives the same advice, so the text is
  not changed. Check that it is the advice you want.
- Hazen-Williams charges fittings at Q^1.852, not Q². This is known
  (`BRANCH-NOTES.md`, option A).

---

## 4. User interface changes

Two rules apply:

- The interface does not explain basic engineering.
- Calculation workflow comes before UI. Text that tells the engineer what the
  solve does, which number to use, or what to do next stays, even when it
  makes a panel longer.

These changes correct text that was wrong, make labels consistent, and remove
only text that was about the screen itself.

**Text that was wrong**

- HYDRAULIC, Fluid Properties: the list said that nothing calculates the
  properties from the temperature. This was false for water from v0.18.62.
  The Temperature line now says that, for water, the source temperature sets
  the three properties. For glycol and custom fluids it keeps its old text.
- HYDRAULIC: the kinematic viscosity showed as `0.0000014718896065571563`.
  It now shows as `1.472e-6`.
- HYDRAULIC, Darcy-Weisbach: the Swamee-Jain note said "The correlation this
  app uses". Colebrook-White is the default, so that clause is removed. The
  laminar note is not shown for Churchill, which covers laminar flow itself.
- THERMAL, Fluid: showed the 20 °C values. Now shows the values in use
  (correction 2.2).
- Calculation sheet, Pump Curve: the key named a red system curve in DESIGN,
  where none is drawn.

**Names and labels**

- SIMULATE ribbon: STATIC and DYNAMIC are now LOCKED and LIVE, in a group
  named Solve. To an engineer, a dynamic simulation is a transient one. The
  program is steady state only. The buttons set when the model re-solves; the
  edit lock follows from that.
- Pump panel: the curve buttons Input, Show and Clear are now Paste curve,
  Show curve and Clear curve.
- Panel headings show the tag where one exists: Sensor, Pipe, Node and Riser
  showed the internal id.
- Delete buttons use one verb: "Delete …". Some said "Remove …".
- "Tag visible: ON" is now "Tag visible". The switch shows the state.
- ΔP is written the same way everywhere. The sensor panel had "Δp".
- `CHECK_CLOSED` and `VALVE_SHUT` name the valve by tag, not by internal id.
- Tab headings use Title Case on all tabs.

**Layout**

- HYDRAULIC: the Calculation method select is two columns wide. The name was
  cut off at "Equivale".
- Pipe panel: the results are in an Actual section, as on all other panels.
- Levels panel: a long level name stays on one line. The altitude and the
  buttons move below it when the panel is narrow.

**Explanations removed or shortened** — only text about the screen:

- SETTINGS, Display: the sentence about drawing sizes and the app chrome.
- ANNOTATION, Display tags: the label formats are given as two examples.
- Isolation valve: the part-open note no longer describes the slider.

All the hints that describe the calculation workflow stay as they were: the
Auto sizing notes on the heat source/sink panel, the capacity to select, the
calculating notice, the manual critical path, the align tool, the sync notes,
the sensor with no link, the pump with no curve, and the friction-factor
notes.

---

## 5. Checked and found correct

- **Network solver.** Todini–Pilati global gradient algorithm. The flow
  update is the standard linearised form. The convergence test has a third
  criterion for loop flow, which head and continuity checks cannot see.
  Correct.
- **Hazen-Williams.** The flow-form constants 10.6663 and 4.8710 are derived
  from ASHRAE Ch 22 Eq (6). Correct.
- **Darcy-Weisbach.** Colebrook-White by iteration, f = 64/Re below
  Re 2300, a linear blend to Re 4000. Correct.
- **Valve law.** The head-basis resistance uses a reference density. This is
  the specific-gravity-corrected Kv definition: the pressure drop scales with
  the fluid density and the head does not. Correct.
- **Affinity laws.** `H0' = s²·H0`, `a' = a·s^(2−b)`. The tests check the
  identity `H_s(Q) = s²·H(Q/s)` directly. Correct.
- **Check valve.** Seated on the head difference, not on the flow, so it
  cannot oscillate. Correct.
- **Equipment.** A square-law resistance from the rated point. The
  integrated valve is subtracted at full travel, so the link drops the rated
  pressure at the rated flow. Correct.
- **Heat transport.** Mass-weighted mixing. Pipe heat loss by the closed
  exponential form. Insulation resistance on the outside diameter. Correct.
- **Controls.** A bracketed search per device. The deadband follows the
  resolution of the actuator. A lost setpoint parks the actuator at full
  travel after the iterations, not during them. Parallel controllers on one
  setpoint share one command. The Auto ΔP setpoint is a critical-valve reset.
  These are sound steady-state methods.
- **Outflows in SIMULATION.** A K-factor terminal from the design flow and
  pressure. Correct.

---

## 6. Verification

- All twelve suites pass: 3056 assertions, 0 failures. The base had 2969.
- 32 assertions are new for sections 2.1 to 2.4: 18 for the pump check
  valve, 6 for the fluid properties, 3 for the ΔP sensor, and 5 for
  device-link fittings. Sections 2.5 to 2.7 add and replace more (section
  2.5 and 2.6, "Test").
- Each new expected value is a hand calculation or an independent
  comparison, not a value read back from the code.
- The re-baseline in section 2 was measured by solving each shipped model with
  v0.18.65 and with v0.18.66 in the same process.
- The interface changes were checked in Chromium at 1500 × 950, in DESIGN and
  SIMULATE, on Tutorial 01 and on the Data Hall model.
