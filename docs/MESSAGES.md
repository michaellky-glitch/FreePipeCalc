# Messages — every code, message and issue

Every coded message the app can produce: its **code**, the **message** a user
sees, and the **issue** it reports (with the action, where there is one). The
codes are the contract — the wording may be tightened, the codes should not
change without a reason.

`…` in a message stands for a value filled in at runtime (a tag, a number, a
unit). `engine.test.js` checks this list against the source in both directions:
every code the app can emit appears here, and nothing here has been removed from
the app.

**Read this before rewording anything.** Several messages exist because a silent
version of the same condition cost real time — the issue column says which.

---

## 1. Severity

| Level | What it does | When it is right |
|---|---|---|
| **ERROR** | Clears `converged`, takes the status chip red. Numbers are still reported. | Every figure downstream describes something that cannot exist. |
| **DEFECT** | Takes the chip ahead of any warning. Does NOT clear `converged`. | The MODEL is wrong: the solve is valid for what was drawn, but what was drawn is not what was meant. |
| **WARNING** | Counted on the chip. | The answer stands, but something needs an engineer's eye. |
| **NOTICE** | Grouped last. | Stated so a number is not a puzzle — a seated check valve, a pinned datum. |

`DEFECT_CODES` and `NOTICE_CODES` in `network.js` name the members; **anything
unlisted is a warning.** Errors are whatever is pushed to `res.errors`.

**The numbers are never hidden.** An implausible answer is reported beside its
error — the answer is not wrong, it is describing a system nobody can build.
**Detection lives in the engine, not the renderer**, so every consumer of a
solve sees the same messages: a warning derived from a sheet row once let
`solveModel()` report "no warnings" for a network at 12 m/s.

In the MESSAGES window (opened from the chip) errors and defects **cannot be
dismissed**; warnings and notices can.

---

## 2. Errors — the answer cannot be trusted

| Code | Message | Issue / action |
|---|---|---|
| `NO_CONVERGE` | Solver did not converge in … iterations (max head change … m, max imbalance … L/s). | The GGA hit its 100-iteration cap without meeting both tolerances (1 mm head, 0.01 L/s). |
| `SINGULAR` | Solver matrix is singular — check for isolated or duplicated nodes. | The head equations have no unique solution, usually a component with no datum. |
| `ISLAND_NO_SOURCE` | Disconnected section has demand but no source. | A connected group has demand but no fixed head and no pump — its pressure level is undefined. |
| `THERMAL_SINGULAR` | The temperature field has no unique solution: nothing sets a level and nothing ties the system to ambient. | Give a source a temperature, or let the pipework exchange heat with the room. |
| `THERMAL_LIMIT` | Temperature at … solves to … °C, outside the plausible band … to … °C. Check the equipment duty, the insulation and whether anything rejects heat. Widen the band on the THERMAL tab if it really runs this hot or cold. | A solved temperature is outside `thermal.tempMin … tempMax` — the runaway guard. The solve is exact; a correct answer can still be absurd. |
| `SETPOINT_LOST` | System is unable to maintain setpoint. Check heat balance. (… → …, limited by … — at full travel and still off setpoint.) | A controlled device ran out of travel with its setpoint unmet; the actuator is returned to full first. Names what limited the machine where the thermal pass knows it. |
| `PRESSURE_IMPLAUSIBLE` | … is at … kPa (… bar), past the … kPa plausibility limit. The arithmetic is right — something in the model is not. Check any equipment carrying far more than its rated flow: its pressure drop goes as the SQUARE of the ratio. | A component ΔP or pump duty exceeds `warn.maxComponentPD` (2000 kPa). Shut valves are excluded. Raise the limit on HYDRAULIC if the system really is this high. |

### Domestic-water sizing (returned by `model.plumbingSizing`, shown in the pipe panel)

A plumbing branch is sized from the fixture units DOWNSTREAM of each pipe, which is only defined on a TREE rooted at one source. These are returned by `plumbingSizing` (not the GGA warning path) and surfaced where the sizing would appear; the number is never guessed when the topology forbids it.

| Code | Message | Issue / action |
|---|---|---|
| `DW_LOOP` | A plumbing branch contains a loop. Fixture-unit sizing needs a tree — one path from the source to every fixture — so remove the loop or make the outflows generic. | A plumbing component has a cycle, so "downstream" is ambiguous. Diversity sizing is defined only on a tree. |
| `DW_NO_SOURCE` | A plumbing branch has no source feeding it. Downstream fixture units are only defined from a source, so add one to the branch. | A plumbing component has no source, so there is no root to accumulate downstream fixture units from. |
| `DW_MULTI_SOURCE` | A plumbing branch has more than one source (…). Fixture-unit sizing needs a single source so each pipe has one upstream path. | A plumbing component has two or more sources, so a pipe's single upstream path — and thus its downstream set — is undefined. |
| `DW_FIXTURE_SHORT` | Fixture … is … kPa short of its required … kPa. Go up a pipe size on its run, or raise the supply pressure. | The DESIGN forward pass delivers less residual at the fixture than its Table 604.3 flow pressure. Only raised where there is a pressure origin (a pressurised source or a running booster pump) — with neither, every residual is zero and the check is noise. |
| `DW_UNSIZED` | … pipes are not sized (…). Fixture-unit sizing only reaches pipework on a branch that has a source and at least one plumbing fixture, so these are left off the calculation. | `plumbingSizing` walks only components containing a plumbing fixture. Pipework outside one is absent from the sheet — said out loud rather than dropped silently. |
| `DW_PUMP_UNSIZED` | Pump … is not on a sized branch, so there is no flow to size it for. | `network.plumbingPumpDuty` refuses to size a booster the fixture-unit walk never reached — a duty invented for a pump with no downstream fixtures would be a number with nothing behind it. |
| `DW_PUMP_NO_FIXTURES` | No fixtures to size against — place outflows first. | `plumbingPumpDuty` with no included demand nodes: there is no required pressure to size to. |
| `DW_PUMP_MISSING` | Not a pump. | `plumbingPumpDuty` called with an id that is not a pump. A programming guard, not something the user can provoke. |

### Disconnection errors (checked on every solve)

| Code | Message | Issue |
|---|---|---|
| `ISLAND` | … node(s) form a separate island with no pipe connecting them to the main network (…). Draw a pipe to join it, or delete it. | The drawing is in two or more pieces that cannot exchange water. |
| `COINCIDENT_NODES` | Nodes … and … are in exactly the same place (… mm apart) but are not joined. The drawing looks continuous; the network is not. Drag one onto the other to join them. | Two nodes at one point, unjoined — **the drawing looks continuous and the network is not**, the failure this check exists for. |
| `NO_RETURN_PATH` | Pump/Equipment … has nowhere to discharge: from its outlet (…) there is no route back to its inlet (…), and no outflow or source to reach. | A device has no path for water to return, so it carries no flow. |
| `SLOPED_PIPE` | Pipe … (… → …) rises … m between its ends. Pipes in the layout must be level — use a riser to change height. | A layout pipe's ends are at different elevations. A layout pipe is LEVEL by rule; only a riser changes height. |
| `NO_PUMP_CURVE` | Pump curve is required to simulate. If no manufacturer data is available, see the TOOLS tab. | A running pump has no curve in SIMULATION; constant head answers a different question. Rare since the auto-sizer generates the curve — left is a MANUAL pump with no duty, or an auto pump the sizer put at zero head. |

### Errors from an edit, not a solve

Returned by `geometry.changeLength()` and shown as a toast; they stop the edit.

| Code | Message | Issue |
|---|---|---|
| `NO_PIPE` | Pipe not found. | The pipe no longer exists. |
| `RISER` | Riser length is set by the level altitudes, not here. | A riser's length comes from the floor heights. |
| `BAD_LENGTH` | Length must be greater than zero. | A length of zero or less. |
| `NO_DIRECTION` | This pipe has no horizontal direction to extend along. | A degenerate/vertical layout pipe. |
| `LOOP` | Length is locked by a loop — the far end of this pipe is tied back to the near end, so it cannot simply move. | The length is constrained by a closed loop. |
| `RISER_TORN` | A riser column is anchored on both sides of this change, so moving it would pull the column apart. | Moving the pipe would tear a riser it anchors. |

---

## 3. Defects — the drawing is not what it looks like

| Code | Message | Issue / action |
|---|---|---|
| `ZERO_LENGTH` | Pipe … has zero length, so it has no friction and cannot be sized. Drag one end apart, or delete it and join the two nodes into one. | Degenerate pipe; would divide by zero downstream. |
| `ORPHAN_NODE` | Node … has no pipe connected to it. Draw a pipe to it, or delete it. | A node with nothing attached. |
| `RISER_OPEN_END` | Riser … has nothing connected at its … (…). The column ends in mid-air, so water arriving there has nowhere to go. Draw a pipe from that node, or detach the floor from the column. | A riser's top or bottom attachment carries no other pipe — invisible on a level plan. Ends only; a middle pass-through is fine. |
| `EQUIP_OFF_RATING` | … is rated for … L/s but is carrying … L/s (× its rating). Its pressure drop follows the square of that, so it is … kPa against a rated … kPa. Check its design flow, load and ΔT — they are one equation. | More than `warn.equipFlowRatio` (2×) from rated flow; **ΔP goes as the square**. A source/sink below rating is exempt (part load is normal). |
| `NO_CHARACTERISTIC` | Outflow … has no usable design point, so its resistance cannot be derived. Give it a flow and a required pressure before simulating. | An outflow with no design point to derive resistance from. |
| `REVERSE_BLOCKED` | Equipment … is holding against reverse flow. Check its direction — use the ‹ › button to flip it. | Equipment is seated against reverse flow; likely drawn the wrong way round. |
| `CONTROL_NO_SETPOINT` | … is linked to …, which states no setpoint, so it has nothing to control to. | A control link points at something that states nothing to hold. |
| `CONTROL_TARGET_GONE` | … is linked to …, which is no longer in the model, so it is not being controlled at all. Re-link it or clear the control. | The link's target pipe was deleted and the link stayed — silent until 2026-08-08. |
| `CONTROL_GANGED` | Multiple equipment connected to a single sensor is not supported & is unstable. Instead connect 1 equipment to the sensor & connect the others to sync with it. (…) | Two or more devices on one sensor. The model still answers (ganged at a common position), but it is not the arrangement to draw. |
| `TAG_MANGLED` | … is tagged "…", which is a tag with an automatically generated one appended to it. Use Repair tags on the FILE group to put it right. | A corrupted tag (`CHWP-0AHU-15AHU-152`). Reported every solve because the route that makes it is not yet identified. |
| `TAG_DUPLICATE` | … items share the tag "…" (…). Every table on the CALCULATION sheet is keyed on the tag, so two rows with this name cannot be told apart. Rename all but one. | Duplicate tags — a real state mid-edit (a floor copied, not yet renumbered), never silent. |

---

## 4. Warnings — the answer stands, but look at this

| Code | Message | Issue |
|---|---|---|
| `VELOCITY` | Section …: velocity … m/s exceeds the … m/s limit. Go up a pipe size, or raise the limit on the HYDRAULIC tab. | Over `warn.velocity` (2.4 m/s): noise, erosion, the reason pipes get sized up. |
| `PDM` | Section …: friction rate … Pa/m exceeds the … Pa/m limit. Go up a pipe size, or raise the limit on the HYDRAULIC tab. | Over `warn.pdm` (400 Pa/m), the usual sizing criterion. |
| `LAMINAR` | Section … → … is in laminar flow (Re ≈ …, below …) — Hazen-Williams is a turbulent correlation and does not apply. Use Darcy-Weisbach for this section. | Re below 2000: the wrong equation, not just imprecise — a warning about the METHOD. |
| `TRANSITIONAL` | Section … → … is in the transitional range (Re ≈ …). Friction loss here is inherently uncertain. | Re 2000–4000; uncertain whatever the method. |
| `NO_SOURCE` | Water source is required. | Nothing feeds the network — no source node and no running pump. Shown as a hydraulic error on the chip. |
| `SUPPLY_INSUFFICIENT` | Source is insufficient for outflow (… kPa at …, short by … kPa). … outflows cannot be met as drawn. | The source cannot meet an outflow's required pressure. |
| `PUMP_DEAD_END` | Pump … has no flow — one side is a dead end. | A pump carries no flow because a side is dead-ended; no head fixes it. |
| `PUMP_NO_FLOW` | Pump … has no flow. | A running pump carries no flow for some other reason. |
| `PUMP_RUNOUT` | Pump … is running at …% of its design flow, past the …% limit. Check motor loading and NPSH available at this duty. | Over `warn.pumpRunout` (120%): matters after losing a pump in a parallel set — the survivors ride out along their curves. |
| `UNREACHABLE` | Outflow … cannot be reached — it is isolated by a shut valve or not connected to a source. | An outflow with no live path to a source. |
| `OUTFLOW_SHORT` | Outflow … is … short of its required pressure. | An outflow below the pressure it asked for. |
| `VALVE_OVERSIZED` | … has insufficient control authority. Consider reducing size. (…% open, below the …% limit.) | A control valve below `warn.valveOversized` (10%) open — all its movement is near the seat. Isolation/shut valves exempt. |
| `FITTING_OSCILLATION` | Tee run/branch assignment did not settle in … passes; the last solution is reported. Flow directions may be marginal somewhere in the network. | The tee run/branch split did not settle in the pass limit. |
| `SLOPED_PIPE` see §2 · disconnection warnings share codes with §2 at lower severity. | | |
| `EQUIP_LIMITED` | … is limited by … and is not reaching its setpoint. | A machine capped by Capacity, Design ΔT, a T limit, or wrong-direction capacity. "…limited by Capacity" is the sentence worth having. |
| `CONTROL_BUDGET` | The control loop ran out of solves before every device had been settled, so some are holding the position the last complete iteration gave them. Raise Max solves in SETTINGS if the answer looks unfinished. | The loop hit `control.maxSolves`. The ones it did not reach keep their last COMPLETE iteration's position — a truncated search is a no-op, not a random spot. |
| `CONTROL_AT_LIMIT` | … is at full/minimum … and … is … its … setpoint — backing off would not bring it closer. | A device on a stop (min speed, min opening, or full travel) with the setpoint still missed. |
| `CONTROL_NO_FLOW` | … carries no flow, so … has nothing to control to. | The controlled machine has no flow to modulate against. |
| `CONTROL_UNSETTLED` | … could not hold … at … — it came to rest … setpoint. Check the machine's capacity and Design ΔT, and whether the setpoint is achievable at all. | A device came to rest off setpoint: actuator resolution, or the setpoint is out of reach. |
| `CONTROL_HUNTING` | Not fully settled after … iterations — … of … controlled devices holding setpoint (…%). The last answer is reported. Raise Settling iterations in SETTINGS to converge further, or accept it if this is close enough. | The loop never came fully to rest. Reports the fraction holding setpoint so an engineer can accept, say, 90% while the design is in flux and finish later. Carries `holding`/`total`/`pct`. |
| `HEAT_IMBALANCE` | … kW is being removed at / added at … to hold its stated temperature, and nothing in the model does that work. Either the plant is short by that much, or the stated temperature is wrong. See the heat balance on the calculation sheet. | Over `warn.heatBalance` (2%) of duty absorbed at a source or pinned datum — usually a fill drawn IN the return line, or a datum that hides a plant shortfall. |
| `THERMAL_LIMIT_OSCILLATION` | Which equipment limit binds kept changing over … passes. The last answer is reported; check for two machines fighting for the same setpoint. | The binding limit never settled. |
| `NO_THERMAL_REFERENCE` | Nothing sets a temperature: no source and no equipment. Temperatures are all at the system flow temperature. | Nothing states a temperature to work from. |

---

## 5. Notices — something was done on your behalf

| Code | Message | Issue |
|---|---|---|
| `CHECK_CLOSED` | Check valve … is holding against reverse flow. | Normal operation, reported so the zero flow is not a puzzle. |
| `VALVE_SHUT` | Valve … is shut (0 % open). Any demand behind it cannot be satisfied, so downstream pressures on this branch are not meaningful. | A fully-closed valve; its branch passes nothing. |
| `THERMAL_DATUM` | Nothing sets a temperature level in this circuit. … °C has been pinned at the outlet of …, the equipment moving the most heat. Every other temperature is relative to that. | The temperature field needed a datum; one was pinned. Raised only when the solve actually needed it. |
| `SOURCE_PRESSURE_MOVED` | Source …: its … kPa static pressure was stored as a … m elevation, which was stretching every pipe on it. The pressure is unchanged; the node is back at its drawn level. | Migration on load. A source's static pressure had been stored as the node's ELEVATION. |

---

## 6. Settings that drive a threshold

All are DEFAULTS a user can change — none is transcribed data. Setting a
threshold to **0 disables its check**, except the temperature band, where the
band itself is the meaning.

| Setting | Default | Drives | Tab |
|---|---|---|---|
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

---

## 7. Wording to tighten — proposed, awaiting your call

The messages window shows the full text of each message, so the verbose ones now
cost screen space every time they appear. Below are the longest, with a proposed
shorter form that keeps the action. **Nothing here is changed in the source yet**
— confirm the wordings and I will apply them (the codes do not change).

| Code | Current (essence) | Proposed |
|---|---|---|
| `NO_SOURCE` | "Water source is required. This water source may be a water tank, city mains … or your top up/expansion tank for closed loop systems." | "No water source. Add a source node (mains, tank, or expansion connection)." |
| `PRESSURE_IMPLAUSIBLE` | "…past the … kPa plausibility limit. The arithmetic is right — something in the model is not. Check any equipment carrying far more than its rated flow: its pressure drop goes as the SQUARE of the ratio. Raise the limit…" | "… past the … kPa plausibility limit. Usually equipment far off its rated flow (ΔP goes as the square). Raise the limit on HYDRAULIC if intended." |
| `EQUIP_OFF_RATING` | "… is rated for … but carrying … (× its rating). Its pressure drop follows the square of that, so it is … kPa against a rated … kPa. Check its design flow, load and ΔT — they are one equation." | "… is carrying … (× its rated …). ΔP follows the square: … kPa vs … rated. Check design flow, load and ΔT." |
| `CONTROL_UNSETTLED` | "… could not hold … at … — it came to rest … setpoint. Either the actuator resolution is the limit, or nothing it can do reaches it: check the machine's capacity and Design ΔT, and whether the setpoint is achievable at all." | "… came to rest … off … setpoint. Check the machine's capacity, Design ΔT and whether the setpoint is reachable." |
| `HEAT_IMBALANCE` | "… kW is being removed at/added at … to hold its stated temperature, and nothing in the model does that work. Either the plant is short by that much, or the stated temperature is wrong. See the heat balance on the calculation sheet." | "… kW absorbed at … with nothing to do that work — plant short, or the stated temperature is wrong. See the heat balance on the sheet." |
| `CONTROL_GANGED` | "Multiple equipment connected to a single sensor is not supported & is unstable. Instead connect 1 equipment to the sensor & connect the others to sync with it. (…)" | "Several devices on one sensor (…). Link one to the sensor and sync the rest to it." |
| `RISER_OPEN_END` | "Riser … has nothing connected at its … (…). The column ends in mid-air, so water arriving there has nowhere to go. Draw a pipe from that node, or detach the floor from the column." | "Riser … ends in mid-air at its … — nothing connected there. Draw a pipe from that node, or detach the floor." |
| `NO_PUMP_CURVE` | "Pump curve is required to simulate. If no manufacturer data is available, please see the TOOLS tab." | "Pump … needs a curve to simulate. Fit one from duties in TOOLS." |
