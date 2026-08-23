# Introduction
I have zero programing knowledge 🤡. My role in this project was directing the LLMs, providing calculation, testing & validation.
 

 

FreePipeCalc is a Free piping friction loss calculator for Building Services Engineers.
 
* Draw and simulate Hydronic ~~\& Plumbing~~ pipe networks. 
* Trace existing drawings in ANNOTATE > TRACE.
* FPC calculates Friction \& static losses.
* Cooling ~~\& Heating~~ (Not tested) loads can be added to the system to simulate typical closed-loop systems.
* SIMULATION mode models how the system responds to various conditions \& expected VFD/valve positions.
* Export as DXF and print.
 

 
# Usage

* GitHub Pages (Not recommended)
* Download the folder, open `index.html` in any web browser.
* Deploy on your own webserver.
 

 
## Data Storage

Data is stored within your browser's storage between sessions. You should still save regularly. No data or telemetry is logged if the page is installed locally (1).
 
 
*(1) - I did not prompt any of the LLMs that worked on this project to include any data logging or telemetry. But I have not run any security tests yet, so who knows? Will remove this message once I get it audited by a third party LLM.*
 

 
## Known Issues

* Plumbing module is still under development.
* Plumbing simulation will usually fail because all outflows are open, water will almost never reach Most Remote Fixture.
* Support for looped piping in Hydronic module only.
* Sometimes a \[REPAIR] button will appear under File. This usually means a tag is damaged. Pressing it should be harmless.
 

 
## Calculation
Friction Loss Calculations use 2 methods from ASHRAE Handbook - Fundamentals, Chapter 22.
 
 
* Hazen-Williams (2)
* Darcy-Weisbach  (Swamee-Jain friction factor).
 
 
Network solver uses the Todini Global Gradient Algorithm (GGA). See Engine Documentation for more details.
 
 
*(2) - At time of development, the ASHRAE handbook did not contain a list of equivalent lengths for pipe fittings. FPC uses Carrier Design Handbook values by default, with NFPA 13 equivalent lengths as an alternative. However, NFPA 13 (2019) Table 27.2.3.1.1 has no straight-through tee row, so Carrier values for straight-through tees are used instead.*
 

 
## A word on trust
This is free software written to be useful, not a certified design tool. The engine is covered by over 2000 assertions whose expected values are independent hand calculations rather than numbers copied out of the code, and `docs/engine.html` gives worked examples you can check yourself with a calculator.
 
 
That is not the same as being right for your project. **Verify the results.**
 
 

 
 
## Everything below is LLM generated.
***

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
      fittings.js       Carrier / NFPA 13 equivalent-length tables, plus legacy L/D ratios
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
      engine.html       maths, derivation, worked checks
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
