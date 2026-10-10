# Feasibility — pumps, valves and sensors as points

Date: 2026-10-10. Base: v0.18.66 (`0e56076`).

Question (owner): can pumps, valves and control points become single
nodes, in place of the 0.5 m minimum links? Old files may break. Examples and
tutorials are then to be fixed.

This note uses ASD-STE100 Simplified Technical English.

---

## 1. Verdict

**Feasible, with one condition for each device family.**

- **Pumps, valves and equipment: feasible and stable.** Keep each device as
  a link with two nodes, but put the two nodes at the same point (length 0).
  The solver accepts this without a change (section 3). The fitting detector
  must "see through" the device, or it loses the elbows at devices on a
  corner.
- **Sensors (control points): feasible only if they leave the hydraulic
  network.** A sensor link of length 0 has no resistance, and the solver
  stops converging (section 3). A sensor must become a property of a node.
  It measures; it is not a hydraulic element.

A true node device (the device stored on a node, as a source or a demand is)
is also possible, but it touches about 165 places in the code. The zero-length
link touches few of them. This note recommends the zero-length link.

---

## 2. What the program does today

| Item | Where | Today |
|---|---|---|
| Device storage | `src/model.js` | A pump, valve, equipment or sensor is an entry in `m.pipes` with `kind` and nodes `a`, `b`. Direction is a → b (`flipPipe`). |
| Device length | `src/canvas.js:29` | `DEVICE_LEN = 0.5`. `insertInline` (`src/canvas.js:2351`) splits the pipe and puts two nodes 0.5 m apart. A pipe shorter than 1.0 m cannot hold a device. |
| Sensor | `src/model.js:2186` | A pipe "in every hydraulic sense": it has the friction of its own 0.5 m. It reads at its inlet node `a` (temperature, pressure, ΔP), or its own link flow (`sensorReading`, `src/network.js:2615`). |
| Control references | `src/model.js:1023` | `pump.control.equip` / `valve.control.equip` hold the ID of the sensor or equipment link. `sensor.ref` holds the ID of the second tapping link. |
| Drawing | `src/canvas.js:3503` | A thin connector with a symbol at the midpoint. The symbol angle comes from a → b (`drawPumpGlyph`, `src/canvas.js:4115`). |
| Moving a device | `src/canvas.js:5836` | `deviceSlideAxis` slides the device along a → b. It needs a length above zero. |
| Node merge | `src/model.js:718` | `mergeNodes` removes a link that runs from a node to itself. |

Code that tests a device kind: pump 72, valve 25, equip 46, sensor 23
places, in `model`, `network`, `thermal`, `canvas`, `app` and `dxf`.

Shipped files: 172 device links in 15 files — 90 equipment, 40 pumps, 21
valves, 21 sensors (11 temperature, 7 ΔP, 3 flow). Most are 0.5 m. Others are
0.2, 0.3, 0.487, 0.7 and 1.0 m, and three valves in `stacked-riser` are 7 m
long. No device is at a level change, on a riser or back to back. Two valves
in `stacked-riser` end at a tee.

---

## 3. Spike — every device collapsed to length 0

A script moved the two nodes of each device to one point: the midpoint, or
the junction end if one end is a tee. It then solved each shipped model in
DESIGN, with Hazen-Williams and with Darcy-Weisbach, and compared the result
with the original.

**Pumps, valves and equipment at length 0.** All 30 cases solve. No new
warning. The passes do not change.

| Model | Pump head, HW | Pump head, DW | Cause |
|---|---|---|---|
| 3-floor riser | +0.61% | +0.48% | The 0.5 m becomes pipe |
| Redundant ring main | +0.31% | +0.24% | Same |
| Tutorial 2 part load | +0.32% | +0.25% | Same |
| GGA example | +0.26% | +0.21% | Same |
| Economizer, parallel branches | ≤ +0.06% | ≤ +0.05% | Same |
| **datacentre-ring** | **−1.54%** | **−1.54%** | **Two pump elbows lost** (P0, P40) |
| stacked-riser | +0.03% | −0.24% | Elbows lost at four devices; one run became a branch |

The losses are a defect of the spike, not of the idea. A link of length 0 has
no direction (`dirFrom` returns null). At a pump on a corner the detector then
sees straight pipe and charges no elbow. Section 5 gives the rule that
corrects this.

**Sensors at length 0.** The Data Hall and Tutorial 01 (Hazen-Williams) and
economizer-trim (Darcy-Weisbach) do not converge. A sensor has no resistance
of its own, so at length 0 its link has r = 0 and the matrix is singular. The
note at `src/model.js:2205` gives the same reason. This is why sensors must
leave the network.

---

## 4. Recommended design

| Device | Representation | Reason |
|---|---|---|
| Pump | Link, length 0 | Needs two heads (suction, discharge). All engine code stays. |
| Valve | Link, length 0 | Same. |
| Equipment (coil, chiller…) | Link, length 0 | Same rule for all in-line devices. You did not name equipment — see question 1. |
| Temperature, pressure, flow sensor | Property of a node: `n.sensor` | No resistance, so it cannot be a link of length 0. |
| ΔP / ΔT sensor | Property of a node, `ref` = the second node | It reads at nodes today. |

**Alternative not recommended — the device on a node.** The node carries the
device, and `network.build` makes two internal nodes. This is the cleanest
data model. But every one of the ~165 places that finds a device in
`m.pipes`, and every result keyed on the device link ID, must change. That is
about three times the work and most of the risk.

---

## 5. Rules the engine must adopt

1. **A point device is inside its junction for fittings.** In
   `fittingsByPipe`, join the two nodes of each zero-length device into one
   junction (union-find). The legs of the junction are the pipes on both
   nodes. The detector then finds the elbow or tee of the pipes around the
   device, and charges it to the downstream pipe, as for any junction. A pump
   between two collinear pipes gets no fitting. A pump on a corner gets one
   elbow, not two and not zero.
2. **A device with a length keeps working as now.** The rule above applies
   only at length 0. The 169 test constructions of pumps, valves and
   equipment with a length stay valid.
3. **A sensor is not in the hydraulic network.** It reads at its node:
   - temperature and pressure: the node value;
   - flow: the flow through the node, the sum of the inflows (on a node with
     two pipes and no demand, this is the pipe flow);
   - ΔP: `differentialPa` between the node and `ref`;
   - ΔT: the temperature difference between the node and `ref`.
4. **The removed length is pipe.** A drawn run is the real pipe length. The
   0.5 m of a device was a drawing artefact without friction. After the change,
   that length is ordinary pipe (section 3: +0.03% to +0.6% pump head).
5. **No change to the solver, the thermal solve or the control search.**

---

## 6. Migration of old files

In `fromJSON`, one step for files saved before the change:

1. **Pump, valve, equipment.** Move both nodes to the midpoint. If one end is
   a junction, move the other end onto it. The adjacent pipes get the length.
2. **Sensor.** Remove the sensor link. Join its two nodes into one node at the
   midpoint. Put the sensor data on that node as `n.sensor`. Change each
   reference to the sensor link ID into the node ID: `pump.control.equip`,
   `valve.control.equip`, `sensor.ref` (for a ΔP sensor, the `ref` link becomes
   that link's inlet node, which is where it reads today).
3. **Cases the step cannot convert.** A device at a level change, two devices
   back to back, or a device with both ends at junctions. The step keeps the
   length and gives a warning. None of these is in a shipped file.

An older version of the program cannot read a node sensor. You accepted this.

---

## 7. Interface changes

| Item | Change | Size |
|---|---|---|
| Placing a device | `insertInline` splits the pipe at the click point. Remove the 1.0 m minimum. A sensor splits the pipe at one new node. | Small |
| Symbol angle | From the adjacent pipe, not from a → b. Flow arrow from the solved flow. | Small |
| Selection | The point selects the device. The two device nodes are not selectable alone. | Medium |
| Moving | Slide along the adjacent run, both nodes together (`deviceSlideAxis` and the drag code). | Medium |
| Connecting a pipe to a device point | Refuse. Draw a short pipe and connect to it. Otherwise the side (suction or discharge) is not known. | Small |
| Node labels | One label at the device, not "N12N11". Inlet and outlet values in the device box. | Small |
| Delete | Join the two nodes again, and join the pipe if the run is straight and of one size (`dissolveNode`). | Small |
| Sensor panel, control link pick, copy / paste, copy level | Work on a node sensor. | Medium |
| Print and DXF | Symbol angle from the adjacent pipe. | Small |

---

## 8. Plan

| Step | Files | Effort | Risk |
|---|---|---|---|
| 1. Fitting junctions for zero-length devices, with hand-checked tests (corner pump, pump at a tee, collinear pump) | `network.js`, `model.test.js` | 1 day | Low |
| 2. Node sensors in the engine: readings, control loop, Auto ΔP seed, report | `network.js`, `model.js`, tests | 1.5 days | Medium |
| 3. Migration in `fromJSON`, with a test that loads each shipped file and checks the result against section 3 | `model.js`, `model.test.js` | 1 day | Medium |
| 4. Canvas: place, draw, select, slide, delete, guards | `canvas.js` | 2–3 days | **High** — this part cannot be tested without a browser |
| 5. Panels, sheet, print, DXF | `app.js`, `printer.js`, `dxf.js` | 1 day | Low |
| 6. Re-save examples and fixtures; re-baseline the tests that move; Tutorial 01 and 02 text and screenshots; user manual | `examples/`, `test/fixtures/`, `docs/` | 1–1.5 days | Low |

Total: 7.5 to 9 days of work. Steps 1 to 3 go first. They keep the old
drawing behaviour and can be checked by the test suites alone.

---

## 9. Decisions for you

1. **Equipment too?** Recommended: yes. One rule for all in-line devices.
2. **Where the device length goes on migration.** Recommended: half to each
   adjacent pipe. Pump heads move +0.03% to +0.6% on the shipped models.
3. **A flow sensor at a tee.** Recommended: a sensor is placed on a pipe
   only, so its node has two pipes and the flow is that pipe's flow.
4. **Devices back to back** (for example a pump and its check valve).
   Recommended: each at its own point, with a pipe between them, of any
   length.
5. **A pipe connected directly to a device point.** Recommended: not
   permitted at first.
