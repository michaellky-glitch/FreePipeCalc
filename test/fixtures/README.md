# Test fixtures

Frozen copies of the models the automated suites assert against.

They live here, and **not** in `examples/`, because `examples/` is working
material: it is edited in the app, re-saved, renamed and deleted. On 2026-07-31
that broke the suite — `datacentre-ring.pnet.json` was re-saved from the app
with different geometry (45 → 60 pipes) and the two
`data_centre_redundant_ring_main` files were deleted, so `simulation.test.js`
crashed on a missing file and `closed`/`supply` failed on numbers that no longer
described the model in front of them.

A regression baseline has to be immutable or it is not a baseline. Change these
only when you mean to change what is being asserted, and regenerate the expected
values in the same commit.

## Frozen 2026-08-24 (v0.18.13)

* **`datahall-yard.pnet.json`** — a copy of `examples/Data Hall & Yard.json`.
  Four cooling-tower trains on a common header. It is the model on which the
  greedy critical-path walk went home to the WRONG pump train and stalled on
  the supply header, so the whole return half was discarded and the path
  stopped at the coil ("only seemed to be halfway", Michael 2026-08-24).
  Asserted in DESIGN mode, which skips the control loop — simulation takes the
  better part of a minute and adds nothing to what is being tested.

* **`tower-five-level.pnet.json`** — a copy of Michael's `debug/20260824-debug.json`
  (`debug/` is gitignored, so this is the only copy in the repo). Five levels,
  drawn L0 then L1 then copied upward, two chillers, two ganged pumps on a
  differential and four coils on integrated control valves. It is the model
  that would not settle until the deadband went to 0.5 K.

## `tutorial2-partload.pnet.json`

Michael's finished Tutorial 2, frozen 2026-08-31. Five 200 kW AHUs on a
variable-primary loop, all at `loadPct 79` — the part-load case that produced
the automatic dP setpoint (`simulation.test.js`, "Automatic dP setpoint").

With a FIXED 110 kPa setpoint the coil valves sit near 76% and the pump at 87%.
On Auto the solve picks about 64 kPa, the valves open to 93-100% and the pump
drops to 78%, with every coil still holding its 7.5 K design dT.

Note the plant is deliberately short at full load: five 200 kW coils against two
running 400 kW chillers, so `loadPct 100` loses a setpoint. That is a plant
limitation, not a control one, and the auto search returns the design setpoint
untouched when the ceiling itself cannot be held.
