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
Section 2 gives each defect, the correction, the test, and the measured
change to the shipped models.

The audit also found three items that need a decision from you. They change
results on many models, or they reverse a recorded decision. This version
does **not** change them. Section 3 gives the measured effect of each.

| # | Correction | Mode | Change to shipped results |
|---|---|---|---|
| 2.1 | A running pump has a check valve on its discharge | Both | None on shipped models. Removes a solver divergence. |
| 2.2 | The thermal solve uses the water properties at the source temperature | Both | Coil ΔT +0.56% at 6 °C. Control positions do not change. |
| 2.3 | A ΔP sensor reads the piezometric difference | SIMULATION | None. All shipped sensors have both tappings at one level. |
| 2.4 | A fitting charged to a pump, valve or equipment link is added to the loss | Both | Two test fixtures only: pump head +0.82%, branch flow up to 0.6%. |

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

---

## 3. Items for your decision — not changed

### 3.1 Which leg of a tee is the run

The program takes the run as the pair of legs with the largest inflow and the
largest outflow (`pickRunPair`, engine.html section 4.3). Standard fitting
data (ASHRAE, Crane, Idel'chik) defines the run by geometry: the two
collinear legs. The branch coefficient is for the stream that turns.

When a side branch takes more flow than the straight leg, the two rules
disagree. The program then gives the run coefficient to the turning stream
and the branch coefficient to the straight stream. With Darcy-Weisbach, the
Idel'chik flow-ratio curve is then applied to the wrong leg.

This is common. On the data hall model the two rules disagree at 30 of 51
tees.

A geometric rule was measured on a copy of the engine. In it, a charged leg
is the run when it is within 30° of straight from the common leg, and a leg
with no flow is not charged:

| Model | Hazen-Williams pump head | Darcy-Weisbach pump head |
|---|---|---|
| 3-floor riser | +9.7% | +22.1% |
| Data centre redundant ring main | +0.4% | +0.6% |
| Data centre ring | +0.3% | +0.5% |
| Tutorial 2 part load | +0.7% | +0.2% |
| Parallel branches | +0.04% | +0.04% |
| Stacked riser | −0.6% | −2.3% |

Models whose pumps are not auto-sized show no change in pump head. Their
pressures and flows change instead.

This change reverses a recorded rule and changes results on most models. It
needs your decision. The patch is small: about ten lines in `fittingsAtNode`.

A related item: a tee with a leg that has no flow, for example a fill
connection on a closed circuit, is charged as a combining tee. The leg with
no flow gets a fitting. Its loss is zero, but the sheet shows the fitting
(Tutorial 01, pipe N0 → N4, "T-br-c").

### 3.2 The heat exchanger model

A heat exchanger holds its stated load at all flows, until its ΔT reaches the
Design ΔT limit. A real coil at part flow gives a larger ΔT and loses less
capacity (effectiveness-NTU). The present model is conservative for valve
and pump selection. It does not show low-ΔT behaviour. This is now in
engine.html section 15. A coil model against flow is a large change.

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

The rule that the interface does not explain basic engineering stays. These
changes remove text that explained a label, correct text that was wrong, and
make labels consistent.

**Text that was wrong**

- HYDRAULIC, Fluid Properties: the list said that nothing calculates the
  properties from the temperature. This was false from v0.18.62. The list is
  removed. One line remains: "Properties at the source temperature."
- HYDRAULIC: the kinematic viscosity showed as `0.0000014718896065571563`.
  It now shows as `1.472e-6`.
- HYDRAULIC, Darcy-Weisbach: the Swamee-Jain note said "The correlation this
  app uses". Colebrook-White is the default. All four notes are corrected.
  The laminar note is not shown for Churchill, which covers laminar flow
  itself.
- THERMAL, Fluid: showed the 20 °C values. Now shows the values in use
  (correction 2.2).
- Calculation sheet, Pump Curve: the key named a red system curve in DESIGN,
  where none is drawn.

**Names and labels**

- SIMULATE ribbon: STATIC and DYNAMIC are now LOCKED and LIVE. To an
  engineer, a dynamic simulation is a transient one. The program is steady
  state only. The buttons only lock or unlock editing.
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

**Explanations removed or shortened**

- SETTINGS, Display: the sentence about drawing sizes and the app chrome.
- Heat source/sink panel: "Set by the solve on Auto sizing. Switch Sizing to
  Manual to state it." showed twice, and a third note was in Actual. It is now
  "Set by Auto sizing." on each locked field.
- Nine other hints are shorter: the calculating notice, the manual critical
  path, the align tool, the annotation label formats, the sync note, the
  sensor with no link, the coil sync note, the part-open isolation valve, and
  the pump with no curve.

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

- All twelve suites pass: 3001 assertions, 0 failures. The base had 2969.
- 32 assertions are new: 18 for the pump check valve, 6 for the fluid
  properties, 3 for the ΔP sensor, and 5 for device-link fittings.
- Each new expected value is a hand calculation or an independent
  comparison, not a value read back from the code.
- The re-baseline in section 2 was measured by solving each shipped model with
  v0.18.65 and with v0.18.66 in the same process.
- The interface changes were checked in Chromium at 1500 × 950, in DESIGN and
  SIMULATE, on Tutorial 01 and on the Data Hall model.
