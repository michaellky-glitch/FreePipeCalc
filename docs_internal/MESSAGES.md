# Messages

Message text may be edited, but message codes are fixed. The placeholder `[…]` represents runtime values (such as tags, numbers, or units). The test suite (`engine.test.js`) validates this document against source code in both directions to ensure all emitted codes are documented.

---

## 1. Severity

| Level | Behavior | Description |
| --- | --- | --- |
| **ERROR** | Sets status chip to red and clears `converged`. Calculated values remain visible. | Indicates physically impossible network conditions. |
| **DEFECT** | Takes priority on the status chip; retains `converged` state. | Indicates model setup or geometry errors where calculated results do not match intent. |
| **WARNING** | Counted on the chip. | Indicates valid calculation results that exceed typical engineering parameters. |
| **NOTICE** | Grouped last. | Provides context for specific network conditions (e.g., seated check valves or pinned datums). |

### Code classification

- **Errors:** Values pushed to `res.errors`.
- **Defects & Notices:** Defined explicitly in `DEFECT_CODES` and `NOTICE_CODES` within `network.js`.
- **Warnings:** All message codes not explicitly listed as errors, defects, or notices.
### Message handling

- **Engine-level detection:** All message detection occurs in the engine to guarantee identical output across all application views.
- **Visible values:** Calculated values remain visible alongside error messages to assist with troubleshooting.
- **Dismissal rules:** In the MESSAGES window, **warnings** and **notices** can be dismissed. **Errors** and **defects** cannot be dismissed.
---

## 2. Errors
### Hydronic-Thermal
| Code | Message | Issue / action |
| --- | --- | --- |
| `NO_CONVERGE` | Solver did not converge in \[Number\] iterations (max head change \[Pressure\] \[Unit\], max imbalance \[Flow\] L/s). | The GGA hit its 100-iteration cap without meeting both tolerances (1 mm head, 0.01 L/s). |
| `SINGULAR` | No unique solution for pressure. Check for isolated or duplicated nodes. | The head equations have no unique solution, usually a component with no datum. |
| `ISLAND_NO_SOURCE` | Disconnected section has demand but no source. Check for system disconnects. | A connected group has demand but no fixed head and no pump — its pressure level is undefined. |
| `THERMAL_SINGULAR` | No unique solution for pressure. Check source and ambient air temperature. | Give a source a temperature, or let the pipework exchange heat with the room. |
| `THERMAL_LIMIT` | Temperature at \[Node\] solves to \[Temperature\] \[Unit\], outside the limits set in THERMAL. Check the heat balance of the system, or widen the plausibility band in the THERMAL tab if correct. | A solved temperature is outside `thermal.tempMin … tempMax` — the runaway guard. The solve is exact; a correct answer can still be absurd. |
| `SETPOINT_LOST` | System is unable to maintain setpoint. Check heat balance. (… → …, limited by … — at full travel and still off setpoint.) | A controlled device ran out of travel with its setpoint unmet; the actuator is returned to full first. Names what limited the machine where the thermal pass knows it. |
| `PRESSURE_IMPLAUSIBLE` | \[Node\] is at \[dP\] \[Unit\], past the \[dP\] \[Unit\] plausibility limit. Check calculation for pressure spikes. | A component ΔP or pump duty exceeds `warn.maxComponentPD` (2000 kPa). Shut valves are excluded. Raise the limit on HYDRAULIC if the system really is this high. |
---
### Domestic-water

| Code | Message | Issue / action |
| --- | --- | --- |
| `DW_LOOP` | Plumbing loops are not supported. Remove the loop or use generic outflows in Hydronic mode. | A plumbing component has a cycle, so "downstream" is ambiguous. Diversity sizing is defined only on a tree. |
| `DW_NO_SOURCE` | A plumbing branch has no source. Connect a source to the system or check for disconnects. | A plumbing component has no source, so there is no root to accumulate downstream fixture units from. |
| `DW_MULTI_SOURCE` | Multiple sources are not supported for plumbing systems. Consider splitting the system or use Hydronic mode. | A plumbing component has two or more sources, so a pipe's single upstream path — and thus its downstream set — is undefined. |
| `DW_FIXTURE_SHORT` | Insufficient pressure at \[Node\]. Consider increasing pipe size or source pressure. | The DESIGN forward pass delivers less residual at the fixture than its Table 604.3 flow pressure. Only raised where there is a pressure origin (a pressurised source or a running booster pump) — with neither, every residual is zero and the check is noise. |
| `DW_UNSIZED` | \[Pipe Tag\] is not calculated as there are no downstream fixtures. Dismiss this notification if intentional. | `plumbingSizing` walks only components containing a plumbing fixture. Pipework outside one is absent from the sheet — said out loud rather than dropped silently. |
| `DW_GENERIC_DEMAND` | Generic outflows \[Node\] add constant \[Flow\] \[Unit\] to the design flow. Dismiss this notification if intentional. | A NOTICE, not a warning: the rule is correct and deliberate. It exists because the number is easy to leave at its default and is added linearly to every pipe upstream — on 20260818-lowrise one such node was a quarter of the building's design flow. |
| `DW_OVER_PRESSURE` | … points exceed the … kPa static-pressure limit, the highest being … at … kPa. A fixed-speed booster runs up its curve as the draw falls, so the worst case is the QUIETEST one. Consider a pressure-reducing valve or a speed-controlled set; the limit is editable on the HYDRAULIC tab. | Plumbing only. Against `settings.warn.maxStatic`, default 552 kPa (80 psi — IPC 604.8's threshold for requiring a PRV); 0 disables it. Reported, not corrected: the arithmetic is right and it is the system that needs the valve. |
| `DW_PUMP_UNSIZED` | \[Pump Tag\] is not connected to a demand. Check for disconnects. | `network.plumbingPumpDuty` refuses to size a booster the fixture-unit walk never reached — a duty invented for a pump with no downstream fixtures would be a number with nothing behind it. |
| `DW_PUMP_NO_FIXTURES` | \[Pump Tag\] is not connected to a demand. Check for disconnects. | `plumbingPumpDuty` with no included demand nodes: there is no required pressure to size to. |
| `DW_PUMP_MISSING` | Not a pump. | `plumbingPumpDuty` called with an id that is not a pump. A programming guard, not something the user can provoke. |
---
### Disconnection errors

| Code | Message | Issue |
| --- | --- | --- |
| `ISLAND` | \[Quantity\] node(s) form a separate island with no pipe connecting them to the main network. Connect them to the network or delete. | The drawing is in two or more pieces that cannot exchange water. |
| `COINCIDENT_NODES` | \[Node\] and \[Node\] are in exactly the same place but are not connected. Drag them together to join them. | Two nodes at one point, unjoined — **the drawing looks continuous and the network is not**, the failure this check exists for. |
| `NO_RETURN_PATH` | Pump/Equipment \[Tag\] has no path to return or to outflow. | A device has no path for water to return, so it carries no flow. |
| `SLOPED_PIPE` | Sloped pipes are not supported. Use a riser to change elevation. | A layout pipe's ends are at different elevations. A layout pipe is LEVEL by rule; only a riser changes height. |
| `NO_PUMP_CURVE` | Pump curve is required to simulate. Change pump sizing mode to Manual or Curve. | A running pump has no curve in SIMULATION; constant head answers a different question. Rare since the auto-sizer generates the curve — left is a MANUAL pump with no duty, or an auto pump the sizer put at zero head. |
---
### Editing errors


| Code | Message | Issue |
| --- | --- | --- |
| `NO_PIPE` | Pipe not found. | The pipe no longer exists. |
| `RISER` | Riser \[Pipe Tag\] length cannot be set manually. Change level height to change this length. | A riser's length comes from the floor heights. |
| `BAD_LENGTH` | \[Pipe Tag\] Length must be greater than zero. | A length of zero or less. |
| `NO_DIRECTION` | This pipe has no horizontal direction to extend along. | A degenerate/vertical layout pipe. |
| `LOOP` | Length \[Pipe Tag\] is constrained by a closed loop. Disconnect the loop before changing geometry. | The length is constrained by a closed loop. |
| `RISER_TORN` | Riser \[Pipe Tag\] is constrained by top and bottom connections. Disconnect riser before changing geometry. | Moving the pipe would tear a riser it anchors. |

---

## 3. Defects

| Code | Message | Issue / action |
| --- | --- | --- |
| `ZERO_LENGTH` | Pipe \[Pipe Tag\] has zero length. Recommend to delete and redraw. | Degenerate pipe; would divide by zero downstream. |
| `ORPHAN_NODE` | \[Node\] is disconnected from the network. Connect it or delete. | A node with nothing attached. |
| `RISER_OPEN_END` | \[Pipe Tag\] has an open connection at \[Top/Bottom\]. Connect a pipe or delete it. | A riser's top or bottom attachment carries no other pipe — invisible on a level plan. Ends only; a middle pass-through is fine. |
| `EQUIP_OFF_RATING` | \[Tag\] is rated for \[Flow\] \[Unit\] but is carrying \[Flow\] \[Unit\], \[%\]. Check the design flow, load and rating. | More than `warn.equipFlowRatio` (2×) from rated flow; **ΔP goes as the square**. A source/sink below rating is exempt (part load is normal). |
| `NO_CHARACTERISTIC` | Outflow \[Tag\] has no design point. Provide a rated flow and pressure before simulating. | An outflow with no design point to derive resistance from. |
| `REVERSE_BLOCKED` | \[Tag\] flow may be reversed. Check it's direction. | Equipment is seated against reverse flow; likely drawn the wrong way round. |
| `CONTROL_NO_SETPOINT` | \[Control Tag\] has no setpoint for \[Equipment Tag\]. Provide a setpoint. | A control link points at something that states nothing to hold. |
| `CONTROL_TARGET_GONE` | \[Tag\] is linked to \[Removed Tag\], which has been deleted/renamed. Re-link or clear the control. | The link's target pipe was deleted and the link stayed — silent until 2026-08-08. |
| `CONTROL_GANGED` | Multiple equipment connected to \[Sensor Tag\] may cause unstable simulation. Connect 1 equipment to the sensor & sync other equipment to that. | Two or more devices on one sensor. The model still answers (ganged at a common position), but it is not the arrangement to draw. |
| `TAG_MANGLED` | Internal error caused \[Tag\] to become corrupted. use Repair tags under File to rectify. | A corrupted tag (`e.g. CHWP-0AHU-15AHU-152`). Reported every solve because the route that makes it is not yet identified. |
| `TAG_DUPLICATE` | Duplicate tags \[Display Tag\] for \[Internal Tags\] will cause solver instability. Provide unique tags. | Duplicate tags — a real state mid-edit (a floor copied, not yet renumbered), never silent. |

---

## 4. Warnings

| Code | Message | Issue |
| --- | --- | --- |
| `VELOCITY` | \[Pipe Tag\] velocity \[Velocity\] \[Units\] exceeds \[Velocity Limit\] \[Units\] set in HYDRAULIC. | Over `warn.velocity` (2.4 m/s): noise, erosion, the reason pipes get sized up. |
| `PDM` | \[Pipe Tag\] velocity \[PDM\] \[Units\] exceeds \[PDM\] \[Units\] set in HYDRAULIC. | Over `warn.pdm` (400 Pa/m), the usual sizing criterion. |
| `HW_TEE_LIMIT` | The current friction loss calculation (\[Method\]) is unable to calculate pressure drops across unequal dividing tees. Recommend changing to Darcy-Weisbach instead. | A warning about the METHOD, like `LAMINAR`. Hazen-Williams charges tees a flat equivalent length; the real coefficient varies with the flow ratio Qb/Qc by more than an order of magnitude. The flow-ratio treatment can only go on the Darcy path, because it must ride as an additive K term at exponent 2 and converting equivalent lengths to K needs a friction factor Hazen-Williams does not have (WORKLIST TEE.1, option C, Michael 2026-08-28). Raised ONCE per solve, and only when the model actually contains a tee. |
| `LAMINAR` | \[Pipe Tag\] is in laminar flow (Re = \[Re\]). Hazen-Williams calculation method is not reliable in this region. Consider using Darcy-Weisbach calculation method. | Re below 2300: the wrong equation, not just imprecise — a warning about the METHOD. |
| `TRANSITIONAL` | \[Pipe Tag\] is in transitional range (Re = \[Re\]). Both friction calculations are unreliable in this region. Consider changing pipe size. | Re 2300–4000; uncertain whatever the method. |
| `NO_SOURCE` | Water source is required. | Nothing feeds the network — no source node and no running pump. Shown as a hydraulic error on the chip. |
| `SUPPLY_INSUFFICIENT` | Insufficient pressure at \[Node\] (Short by \[Pressure\] \[Units\]. Consider increasing pipe size or pressure. | The source cannot meet an outflow's required pressure. |
| `PUMP_DEAD_END` | Pump \[Tag\] has no flow (dead end). Check system arrangement. | A pump carries no flow because a side is dead-ended; no head fixes it. |
| `PUMP_NO_FLOW` | Pump \[Tag\] has no flow. Check system arrangement. | A running pump carries no flow for some other reason. |
| `PUMP_RUNOUT` | Pump \[Tag\] is running at \[Flow\] \[Units\], (\[%\]% of design flow). Check available NPSH or design flow. | Over `warn.pumpRunout` (120%): matters after losing a pump in a parallel set — the survivors ride out along their curves. |
| `UNREACHABLE` | \[Tag\] is isolated by closed valve or not connected to source. Dismiss this notification if intentional. | An outflow with no live path to a source. |
| `OUTFLOW_SHORT` | Insufficient pressure at \[Node\] (Short by \[Pressure\] \[Units\]. Consider increasing pipe size or pressure. | An outflow below the pressure it asked for. |
| `VALVE_OVERSIZED` | \[Tag\] has insufficient control authority. Check valve Kv. | A control valve below `warn.valveOversized` (10%) open — all its movement is near the seat. Isolation/shut valves exempt. |
| `FITTING_OSCILLATION` | Simulation did not stabilize in \[number\] passes. Flow directions may be marginal somewhere in the network. | The tee run/branch split did not settle in the pass limit. |
| `SLOPED_PIPE` see §2 · disconnection warnings share codes with §2 at lower severity. |  |  |
| `EQUIP_LIMITED` | \[Tag\] is limited by \[Parameter\] and is not reaching its setpoint. | A machine capped by Capacity, Design ΔT, a T limit, or wrong-direction capacity. "…limited by Capacity" is the sentence worth having. |
| `CONTROL_BUDGET` | Controls did not stabilize the simulation after \[number\] iterations. Results from the last iteration may be usable. Check system for conflicting controls, sync equipment to a single control group, or increase Max Solves in SETTINGS. | The loop hit `control.maxSolves`. The ones it did not reach keep their last COMPLETE iteration's position — a truncated search is a no-op, not a random spot. |
| `CONTROL_AT_LIMIT` | \[Tag\] is unable to maintain setpoint \[Setpoint\] \[Unit\] at \[Maximum/Minimum\] \[Control Authority\]. Check controls. | A device on a stop (min speed, min opening, or full travel) with the setpoint still missed. |
| `CONTROL_NO_FLOW` | \[Tag\] is unable to be controlled as it has no flow. | The controlled machine has no flow to modulate against. |
| `CONTROL_UNSETTLED` | \[Tag\] is unable to maintain setpoint \[Setpoint\] \[Unit\] (Settled at \[Value\] \[Unit\]). Check setpoint, equipment capacity or system heat balance. | A device came to rest off setpoint: actuator resolution, or the setpoint is out of reach. |
| `CONTROL_HUNTING` | Controls did not stabilize after \[number\] iterations. \[Number\] of \[Number\] devices maintaining setpoint. Results from the last iteration may be usable. Check system for conflicting controls, sync equipment to a single control group, or increase Max Solves in SETTINGS. | The loop never came fully to rest. Reports the fraction holding setpoint so an engineer can accept, say, 90% while the design is in flux and finish later. Carries `holding`/`total`/`pct`. |
| `HEAT_IMBALANCE` | System heat imbalanced by \[Heat\] \[Units\] being \[added/removed\] at \[Node\]. Check Thermal Calculations and Source Temperature. | Over `warn.heatBalance` (2%) of duty absorbed at a source or pinned datum — usually a fill drawn IN the return line, or a datum that hides a plant shortfall. |
| `THERMAL_LIMIT_OSCILLATION` | Simulation did not stabilize in \[number\] passes due to thermal oscillation. Two or more devices may be fighting for the same setpoint. Check system for conflicting controls, sync equipment to a single control group, or increase Max Solves in SETTINGS. | The binding limit never settled. |
| `NO_THERMAL_REFERENCE` | Nothing sets a temperature. Acceptable if the system is adiabatic. | Nothing states a temperature to work from. |

---

## 5. Notices

| Code | Message | Issue |
| --- | --- | --- |
| `CHECK_CLOSED` | Check valve \[Node\] is holding against reverse flow. | Normal operation, reported so the zero flow is not a puzzle. |
| `VALVE_SHUT` | Valve \[Node\] is shut. | A fully-closed valve; its branch passes nothing. |
| `THERMAL_DATUM` | Nothing sets a temperature level in this circuit. … °C has been pinned at the outlet of …, the equipment moving the most heat. Every other temperature is relative to that. | The temperature field needed a datum; one was pinned. Raised only when the solve actually needed it. |
| `SOURCE_PRESSURE_MOVED` | \[Node\] static pressure \[Pressure\] \[Units\] is stored as \[Height\] \[Units\] elevation. A vertical pipe was created. Source …: its … kPa static pressure was stored as a … m elevation, which was stretching every pipe on it. The pressure is unchanged; the node is back at its drawn level. | Migration on load. A source's static pressure had been stored as the node's ELEVATION. |

---

## 6. Settings that drive a threshold

All are DEFAULTS a user can change — none is transcribed data. Setting a
threshold to **0 disables its check**, except the temperature band, where the
band itself is the meaning.

| Setting | Default | Drives | Tab |
| --- | --- | --- | --- |
| `warn.velocity` | 2.4 m/s | `VELOCITY` | HYDRAULIC |
| `warn.pdm` | 400 Pa/m | `PDM` | HYDRAULIC |
| `warn.laminar` | on | `LAMINAR`, `TRANSITIONAL` | HYDRAULIC |
| `warn.pumpRunout` | 120% | `PUMP_RUNOUT` | HYDRAULIC |
| `warn.equipFlowRatio` | 2× | `EQUIP_OFF_RATING` | HYDRAULIC |
| `warn.maxComponentPD` | 2000 kPa | `PRESSURE_IMPLAUSIBLE` | HYDRAULIC |
| `warn.valveOversized` | 10% | `VALVE_OVERSIZED` | HYDRAULIC |
| `warn.heatBalance` | 2% | `HEAT_IMBALANCE` | HYDRAULIC |
| `control.maxSolves` | 0 (auto) | `CONTROL_BUDGET` | THERMAL |
| `control.sweeps` | 6 | how many settling sweeps | THERMAL |
| `thermal.tempMin` / `tempMax` | −50 / +50 °C | `THERMAL_LIMIT` | THERMAL |
| `control.minSpeed` | 0.25 | `CONTROL_AT_LIMIT` | THERMAL |
| `control.minOpening` | 10% | `CONTROL_AT_LIMIT` | THERMAL |
| `control.tol` | 0.05 K | the control deadband | THERMAL |


