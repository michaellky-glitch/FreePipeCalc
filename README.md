# FreePipeCalc

Free piping friction loss calculator for Building Services Engineers. Draw a
multi-level water piping network, solve it, and get flow distribution, friction
losses and pump duty — plus a node-to-node calculation sheet you can print or
export.

**Download the folder, open `index.html`, and it runs.** No server, no install,
no build step, no network access, no CDN, no accounts. It works from a USB stick
on a machine with no internet.

Calculations follow ASHRAE: Hazen-Williams friction loss and the equivalent-length
fitting method, with Darcy-Weisbach available as an experimental option. All
computation is SI internally; imperial is a display conversion.

## What it does

* **Draws** multi-level networks — levels, riser columns, loops, rings.
* **Traces** over a pasted screenshot of an existing drawing, with two-point
  scale calibration.
* **Solves** branched *and* looped topologies with multiple sources and pumps,
  using the Global Gradient Algorithm (the method EPANET uses).
* **Detects fittings automatically** from the drawn geometry — elbows and tees
  are inferred from pipe angles, never placed by hand.
* **Sizes pumps** to the index circuit, or to equipment rated flow in closed
  circuits, re-sizing on every solve.
* **Warns** on velocity, friction rate, laminar flow, insufficient supply,
  dead-ended pumps and missing sources.
* **Reports** a node-to-node calculation sheet, CSV export, and printable level
  plans at a shared scale.

Devices supported: sources, demands, pumps (running / fixed / off), gate and
check valves with Kv/Cv, and equipment with rated flow and pressure drop. All
of them carry an equipment tag that appears on the drawing and in the sheet.

## Running it

Open `index.html` in a browser. Double-clicking the file works; so does dragging
it onto a browser window.

Save your model with **SAVE MODEL** — it writes a `.pnet.json` file, plain text
and readable, which **LOAD MODEL** reads back. Worked examples are in
`examples/`.

## Documentation

* `docs/ARCHITECTURE.md` — how the program works and why. **Start here.**
* `docs/ENGINE.md` — the hydraulics maths, with hand-checkable worked examples.
* `docs/piping-friction-loss-spec.md` — the specification; §12 logs every
  deviation from it and the reason.
* `docs/ROADMAP.md` — what is agreed but not yet built, and what was ruled out.
* `docs/Human-Test.md` — what has been checked by hand, and what has not.
* `docs/PUBLISHING.md` — notes on releasing this repository.

## A word on trust

This is free software written to be useful, not a certified design tool. The
engine is covered by ~440 assertions whose expected values are independent hand
calculations rather than numbers copied out of the code, and `docs/ENGINE.md`
gives worked examples you can check yourself with a calculator.

That is not the same as being right for your project. **Verify the results.**

---

## Status

Usable for simple networks. Implemented so far:

| Area | State |
|---|---|
| Pipe schedule data (ASME Sch 10/40/80, EN 10255 M/H, PPR, HDPE) | done |
| Fitting equivalent lengths (ASHRAE L/D method) | done |
| Unit conversion / parsing (display layer) | done |
| Hazen-Williams pipe loss | done |
| Network solver (GGA — loops, multiple sources, pumps, islands) | done |
| Model, levels, risers, save/load `.pnet.json` | done |
| Fitting auto-detection + two-pass tee run/branch | done |
| Canvas: draw, snap, tee insertion, zoom/pan, select, delete | done |
| Calculation sheet + CSV export + print stylesheet | done |
| Settings, theming, autosave, undo/redo | done |
| Test suite (633 assertions) | done |
| TRACE mode: trace over a pasted drawing | done |
| Open/closed detection shown on the ribbon | done |
| DOCUMENTATION tab rendering the project docs | done |
| LAYOUT mode: draggable labels, device value boxes | done |
| Rendered formulas with inline editable coefficients | done |
| Riser placement UI, column snapping across levels (§7.2) | done |
| Pump device: place, auto-size or fix head (§8.4) | done |
| In-app dialogs (no browser popups) | done |
| Level drag-reorder + property editor | done |
| Drawing annotations `50⌀/12.50m/3.00L/s`, toggleable | done |
| Node renumbering from source | done |
| Printed level plans, one page per level, shared scale (§10.1) | done |
| Valves: gate & check, Kv/Cv, 0–100% opening | done |
| HYDRAULIC tab: method, editable coefficients, fluid, fitting tables | done |
| Laminar / transitional flow warning | done |
| Darcy-Weisbach module (experimental, correlation pending) | done |
| ASHRAE fitting K coefficient tables | done |
| Riser auto-alignment: inactive floors slide to the active floor | done |

| Rigid-translation length edits, incl. across risers (§6) | done |
| Copy level layout up/down, carrying risers (§6) | done |
| Custom user pipe schedules, paste from a spreadsheet (§9) | done |
| Critical path identification, ordering and highlighting (§10) | done |
| Geometry-conflict detection + Repair with change log (§6) | done |
| Pump auto-sizing on every solve, with safety factor (§8.4) | done |
| Supply-adequacy checks + pressure-driven actual delivery | done |
| Equipment device with tag, rated flow and ΔP (§8.3) | done |
| Equipment tags on drawing, sheet and CSV | done |
| Closed circuits: pressure datum + flow-based pump sizing | done |
| Pump off/running modes | done |
| Pump duty table: head required vs selection margin | done |
| DESIGN / SIMULATION modes, calculated side locked | done |
| Pump curves: paste manufacturer data, least-squares fit with quality shown | done |
| TOOLS tab — Generic Pump Curve (three-point, NFPA 20 preset) | done |
| SHOW DISCONNECT: coincident nodes, islands, devices with nowhere to discharge | done |
| Device direction with flip, no reverse flow through pump/equipment/check valve | done |
| Parallel pumps share flow in DESIGN | done |
| Combining vs dividing tees (structure done, 2 of 4 coefficients placeholder) | partial |
| Drag a device body; labels snap to grid; riser select/delete | done |

Previous releases are kept under `Previous Version/`.

## Running the tests

    node test/engine.test.js
    node test/model.test.js

No dependencies. The harness evaluates the same browser source files that
`index.html` loads, in the same order.

## Design constraints worth knowing

**Classic scripts, not ES modules.** Browsers block ES module loading over
`file://` (CORS treats it as an opaque origin), so `<script type="module">`
breaks the "open it by double-clicking" requirement. Every source file is an
IIFE attaching to a single global `FD`. Load order is fixed in `index.html`.

**SI everywhere internally.** Model state and all computation is metric —
metres, m³/s, pascals. Imperial is a formatting concern only and lives
exclusively in `src/units.js`. Nothing in the solver may call it.

**The friction method is swappable.** The solver only asks a link for its
resistance and derivative, so Darcy-Weisbach (v2) drops in beside
Hazen-Williams without touching the solver.

## Layout

    index.html          load order lives here
    styles.css
    data/
      schedules.js      pipe schedules -> inner diameters
      fittings.js       ASHRAE equivalent lengths
      valves.js         valve Kv/Cv data and opening curves
      ktable.js         ASHRAE fitting resistance coefficients K
      pumps.js          pump curves: single-point, 3-point quadratic, fitting
    src/
      units.js          SI <-> display conversion and parsing
      hydraulics.js     pipe loss models
      solver.js         Global Gradient Algorithm network solver
      model.js          model state: levels, nodes, pipes, risers, save/load
      geometry.js       rigid length edits, conflict detection, repair
      network.js        model -> solver translation, fitting auto-detection
      canvas.js         drawing surface: render + pointer interaction
      dialog.js         in-app modal dialogs (no browser popups)
      printer.js        printed level plans (SVG, one page per level)
      trace.js          background drawings to trace over
      tools.js          TOOLS tab: standalone calculators
      docs.js           DOCUMENTATION tab: renders docs/ in the app
      app.js            shell: toolbar, panels, sheet, settings, persistence
    docs/
      ENGINE.md         maths, derivation, worked checks
    examples/
      3-floor-riser-test.pnet.json      3-floor riser + ring main test model
      irrational-source-on-L3.pnet.json source above its demands, dead-ended pump
      datacentre-ring.pnet.json         closed circuit, 4 pumps, dual ring main
      datacentre-ring-with-source.pnet.json  ...plus an expansion tank at the pump
    test/
      harness.js        Node shim + assertions
      engine.test.js
      model.test.js
      geometry.test.js
      supply.test.js
      closed.test.js
      testrun-3floor.js     end-to-end run of the example model
      testrun-irrational.js under-supplied system walk-through

## Licence

MIT — see `LICENSE.txt`.

*For preliminary design assistance only. Results must be verified by a
qualified engineer. No warranty; no liability.*
