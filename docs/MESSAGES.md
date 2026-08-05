# Messages — every error, warning and notice

Written 2026-08-05 (v0.13.0), as the first step of the UX pass towards 1.0.

Every coded message the app can produce, what raises it, and what it means. The
codes are the contract: the wording may be tightened during the UX pass, the
codes should not change without a reason.

**Read this before rewording anything.** Several of these messages exist because
a silent version of the same condition cost real time — the notes say which.

---

## 1. How severity works

Three levels, and the difference is not cosmetic.

| Level | What it does | When it is right |
|---|---|---|
| **ERROR** | Clears `converged`, takes the status chip. The numbers are still reported. | Every figure downstream is describing something that cannot exist. |
| **WARNING** | Listed on the calculation sheet and in the status chip count. | The answer stands, but something about it needs an engineer's eye. |
| **NOTICE** | A dialog on load, or a toast. Not part of the result. | Something was changed or assumed on the user's behalf. |

Two conventions worth keeping:

* **The numbers are never hidden.** An implausible answer is still reported
  beside its error — the answer is not wrong, it is describing a system nobody
  will build, and hiding it leaves nothing to diagnose from.
* **Detection lives in the engine, not the renderer.** Warnings were once
  derived from calculation-sheet rows, so `solveModel()` reported "no warnings"
  for a network running at 12 m/s. Anything that reformats a message for display
  must not be the thing that decides it exists.

---

## 2. Errors — the answer cannot be trusted

| Code | Raised when | Message |
|---|---|---|
| `NO_CONVERGE` | The solver reaches its 100-iteration cap without meeting both tolerances (1 mm head, 0.01 L/s imbalance). | "Solver did not converge in 100 iterations…" |
| `SINGULAR` | The head equations have no unique solution — usually a component with no datum. | Reported by the solver. |
| `ISLAND_NO_SOURCE` | A connected group of nodes has no fixed head and no pump, so its pressure level is undefined. | Reported by the solver. |
| `ISLAND` | The drawing is in two or more pieces that cannot exchange water. | Names the nodes in the orphaned group. |
| `COINCIDENT_NODES` | Two nodes sit at the same point without being joined. **The drawing looks continuous and the network is not** — this is the failure the check exists for. | Names both. |
| `NO_RETURN_PATH` | A device has no way for water to get back, so it can carry no flow. | Names the device. |
| `SLOPED_PIPE` | A layout pipe's ends are at different elevations. A layout pipe is LEVEL by rule; only a riser changes height. | Names the pipe. |
| `NO_PUMP_CURVE` | SIMULATION with a running pump that has no curve. A curve-less pump falls back to constant head, which answers a different question — the flow stops responding to the system, the one thing the mode exists to show. | Points at Sizing ▸ Auto/Manual or a pasted curve. |
| `THERMAL_LIMIT` | A solved temperature is outside `thermal.tempMin … tempMax`. The runaway guard: the solve is exact, but a correct answer can still be absurd. | Quotes the worst node and the band. |
| `PRESSURE_IMPLAUSIBLE` | A component ΔP or pump duty exceeds `warn.maxComponentPD` (default 2000 kPa). Shut valves are excluded — `CLOSED_R` is a numerical device, not a pressure. | "…past the 2000 kPa plausibility limit. The arithmetic is right — something in the model is not." |
| `SETPOINT_LOST` | A controlled device runs out of travel with its setpoint still unmet. The actuator is returned to FULL first. | "System is unable to maintain setpoint. Check heat balance." |

### Errors from an edit, not a solve

These are returned by `geometry.changeLength()` and shown as a toast. They stop
the edit; nothing is changed.

| Code | Raised when |
|---|---|
| `NO_PIPE` | The pipe no longer exists. |
| `RISER` | A riser's length is set by the level altitudes, not by typing. |
| `BAD_LENGTH` | A length of zero or less. |
| `NO_DIRECTION` | The pipe has no horizontal direction to extend along. |
| `LOOP` | The far end is tied back to the near end, so the length is locked by the loop. |
| `RISER_TORN` | A riser column is anchored on both sides of the change; moving it would pull the column apart. |

---

## 3. Warnings — the answer stands, but look at this

### Flow regime and limits

| Code | Raised when | Why it matters |
|---|---|---|
| `VELOCITY` | Pipe velocity exceeds `warn.velocity` (2.4 m/s). | Noise, erosion, and the reason pipes get sized up. |
| `PDM` | Friction rate exceeds `warn.pdm` (400 Pa/m). | The usual sizing criterion in building services. |
| `LAMINAR` | Re below 2000. | **Hazen-Williams is a turbulent correlation.** In laminar flow it is not merely imprecise, it is the wrong equation — so this is a warning about the METHOD, not the velocity. |
| `TRANSITIONAL` | Re between 2000 and 4000. | Friction here is inherently uncertain whatever the method. |

### Supply and pumps

| Code | Raised when |
|---|---|
| `NO_SOURCE` | Nothing feeds the network — no source node and no running pump. |
| `SUPPLY_INSUFFICIENT` | The source cannot meet an outflow's required pressure. Quotes the worst node and the shortfall. |
| `PUMP_DEAD_END` | A pump carries no flow because one side is a dead end. No head can fix that. |
| `PUMP_NO_FLOW` | A running pump carries no flow for some other reason. |
| `PUMP_RUNOUT` | A pump is past `warn.pumpRunout` (120%) of its design flow. Matters after losing a pump in a parallel set: the survivors ride out along their curves, and motor loading, NPSHr and efficiency all worsen to the right. |
| `UNREACHABLE` | An outflow is isolated by a shut valve or not connected to a source. |
| `OUTFLOW_SHORT` | An outflow is short of its required pressure, by this much. |

### Valves, fittings and geometry

| Code | Raised when |
|---|---|
| `VALVE_SHUT` | A valve is fully closed, so its branch passes nothing. |
| `CHECK_CLOSED` | A check valve is holding against reverse flow. Normal operation, reported so the zero flow is not a puzzle. |
| `REVERSE_BLOCKED` | Equipment is holding against reverse flow — check its direction with the ‹ › button. |
| `VALVE_AUTHORITY` | A CONTROL valve is below `warn.valveAuthority` (10%) open. "…has insufficient control authority. Consider reducing size." A different sense of the word from `CONTROL_NO_AUTHORITY`: this valve HAS the movement but spends it all near its seat. Isolation valves and shut valves are exempt. |
| `ZERO_LENGTH` | A pipe of zero length — degenerate, and would divide by zero downstream. |
| `ORPHAN_NODE` | A node with nothing connected to it. |
| `RISER_OPEN_END` | A riser column's top or bottom attachment carries no other pipe, so the column ends in mid-air. Invisible on a level plan, because a column is drawn as a marker rather than a line. Ends only — a middle attachment with nothing on it is an ordinary pass-through. |
| `FITTING_OSCILLATION` | The tee run/branch assignment did not settle in the pass limit. Flow directions are marginal somewhere. |

### Equipment

| Code | Raised when |
|---|---|
| `EQUIP_LIMITED` | A machine is limited by Capacity, Design ΔT, a T limit, or `Capacity (wrong direction)`, and is not reaching its setpoint. "CH-01 is limited by Capacity" is the sentence worth having; a leaving temperature that silently misses is not. |
| `EQUIP_OFF_RATING` | Equipment is more than `warn.equipFlowRatio` (2×) from its rated flow. **Its ΔP goes as the SQUARE of that**, which is how a 0.8 L/s coil carrying 20 L/s produced a 1252 bar pump. A source/sink BELOW its rating is exempt: part-load plant is normal operation. |
| `NO_CHARACTERISTIC` | An outflow has no usable design point, so its resistance cannot be derived. Needed before simulating. |

### Control

| Code | Raised when |
|---|---|
| `CONTROL_NO_SETPOINT` | A control link points at something that states nothing to hold. A drawn link that quietly does nothing is exactly the surprise the link was added to avoid. |
| `CONTROL_NO_AUTHORITY` | The setpoint is met, but the actuator cannot MOVE it — an unlimited chiller holds its LWT at any flow. Names what the device CAN hold instead. Only raised when there is no other toggled setpoint to fall back to. |
| `CONTROL_AT_LIMIT` | The device is on a stop (minimum speed, minimum opening, or full travel) and the setpoint is still missed. |
| `CONTROL_NO_FLOW` | The controlled machine carries no flow, so there is nothing to control to. |
| `CONTROL_UNSETTLED` | Either a device came to rest off setpoint, or the sweep was still moving after four passes — check whether two devices are working against each other. |

### Thermal

| Code | Raised when |
|---|---|
| `THERMAL_DATUM` | No source and no ambient coupling, so a reference temperature was pinned. Reported, never silent. |
| `THERMAL_SINGULAR` | The temperature field has no unique solution: nothing sets a level and nothing ties the system to ambient. |
| `THERMAL_LIMIT_OSCILLATION` | Which equipment limit binds kept changing over 30 passes. Check for two machines fighting for the same setpoint. |
| `NO_THERMAL_REFERENCE` | Nothing in the model states a temperature. |

---

## 4. Notices — something was done on your behalf

| Code | Raised when |
|---|---|
| `SOURCE_PRESSURE_MOVED` | Migration on load. A source's static pressure had been stored as the node's ELEVATION, which stretched every pipe on it in 3D — 50 m read as 54.01 m. The pressure is unchanged; the elevation is now separate. Shown in a dialog because the migration moves pipe lengths. |

---

## 5. Settings that drive a threshold

Every tunable that turns a message on or off, and where it lives. All are
DEFAULTS a user can change — none is transcribed data.

| Setting | Default | Drives | Tab |
|---|---|---|---|
| `warn.velocity` | 2.4 m/s | `VELOCITY` | HYDRAULIC |
| `warn.pdm` | 400 Pa/m | `PDM` | HYDRAULIC |
| `warn.laminar` | on | `LAMINAR`, `TRANSITIONAL` | HYDRAULIC |
| `warn.pumpRunout` | 120% | `PUMP_RUNOUT` | HYDRAULIC |
| `warn.equipFlowRatio` | 2× | `EQUIP_OFF_RATING` | HYDRAULIC |
| `warn.maxComponentPD` | 2000 kPa | `PRESSURE_IMPLAUSIBLE` | HYDRAULIC |
| `warn.valveAuthority` | 10% | `VALVE_AUTHORITY` | HYDRAULIC |
| `thermal.tempMin` / `tempMax` | −50 / +50 °C | `THERMAL_LIMIT` | THERMAL |
| `control.minSpeed` | 0.25 | `CONTROL_AT_LIMIT` | THERMAL |
| `control.minOpening` | 10% | `CONTROL_AT_LIMIT` | THERMAL |
| `control.tol` | 0.05 K | the control deadband | THERMAL |

Setting any threshold to **0 disables its check**, except the temperature band,
where the band itself is the meaning.

---

## 6. For the UX pass — what is worth changing

Observations from writing this out, offered rather than acted on.

1. **Two different "authority" messages.** `VALVE_AUTHORITY` (the valve is
   oversized) and `CONTROL_NO_AUTHORITY` (the setpoint cannot be moved) share a
   word and mean unrelated things. Worth renaming one.

2. **`CONTROL_UNSETTLED` covers two conditions** — a device off setpoint, and a
   sweep that never settled. They deserve separate codes.

3. **Nothing distinguishes "wrong" from "not ideal".** `VELOCITY` at 2.5 m/s and
   `COINCIDENT_NODES` are both listed the same way, but one is a judgement and
   the other is a drawing that does not mean what it looks like. A severity
   between warning and error, or grouping on the sheet, would help.

4. **Several messages name an id where a tag would read better** —
   `ORPHAN_NODE`, `ISLAND`, `RISER_OPEN_END`. An engineer works from tags.

5. **No message says what to DO** except `NO_PUMP_CURVE`, `EQUIP_OFF_RATING`,
   `CONTROL_NO_AUTHORITY` and `SETPOINT_LOST`. Those four are the most useful
   ones in practice, which is probably not a coincidence.
