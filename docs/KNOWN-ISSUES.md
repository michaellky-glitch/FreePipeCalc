# Known issues

Small, non-urgent defects and follow-ups that are logged rather than fixed
immediately, so they are not rediscovered from scratch. Each entry says what it
is, why it is deferred, and where the fix would go.

---

## Open

### The `testrun-*.js` walkthroughs OVERWRITE files in `examples/`

`test/testrun-3floor.js` and `test/testrun-datacentre.js` regenerate the
`.pnet.json` they walk through (`ARCHITECTURE.md` §15 says so, but it is easy to
miss). They write today's *defaults*, so running one as a smoke check silently
rewrote `3-floor-riser-test.pnet.json` and `datacentre-ring.pnet.json`, dropping
`pumpSafetyPct` from 10 to 0 — which broke the "Selection duty applies the
margin on top" assertion in `supply.test.js`, because that margin comes from the
example file. Caught and reverted 2026-07-31.

**So:** they are generators, not tests. Do not run them as a "does it still
work" check, and `git diff examples/` before committing if you have. Worth
making them write to a scratch path, or take an explicit `--write` flag.

### `quadWarnings` has no guard for a zero design flow

`data/pumps.js` — `quadWarnings(qc, qDesign)` divides by `qDesign`
(`100 * rising / qDesign`) and clamps a range to `qDesign * 1.5`. If `qDesign`
is `0` the percentages come out as `Infinity`/`NaN`.

In practice the TOOLS ▸ Generic Pump Curve caller only passes a positive design
flow, so it does not surface today. Deferred by decision (2026-07-30): log now,
add a one-line guard at the top of `quadWarnings` if a zero ever reaches it.

### Printed plans draw devices as plain pipe, with no symbol

`src/printer.js` strokes every pipe at full bore width (line ~126) and never
draws a pump, valve or equipment symbol. On a printed level plan an in-line
device is therefore indistinguishable from a short piece of pipe.

This was always true, but it is now *inconsistent* with the canvas, which draws
devices as point symbols on a thin connector (2026-07-30). The fix is to mirror
that in the SVG: a thin connector for the device link plus a symbol at the
midpoint. Deferred because printing has never been checked on real paper
(`Human-Test.md` §5.5), so the print path is better reviewed in one pass than
piecemeal.

---

## Resolved

### Datacentre parallel-pump test values regenerated — 2026-07-30

`test/simulation.test.js` hard-coded the total flow and pump heads of
`data_centre_redundant_ring_main.pnet (fixed).json`. The model was rebuilt by
hand into a coherent 20 L/s single-equipment circuit, so the old 45 L/s
expectations failed. The baseline was regenerated from the final model
(total 0.020 m³/s; heads 268.5 / 257.6 / 253.3 / 249.6 kPa for 1–4 running
pumps) and all assertions pass again. Not an independent check — a
regression lock, as the originals were.

---

## Logged for reference (not defects)

### Pipe-schedule K-table cells not cleanly transcribed

Two cells in `data/ktable.js` are flagged in-file as not cleanly transcribed
from the source table. All L/D and K values are user-editable on the HYDRAULIC
tab, so this is a data-provenance caveat, not a code fault. Left as-is by
decision (2026-07-30): far from shipping, revisit when the fitting data is
sourced properly.

### Follow-ups raised by Michael's testing (2026-07-31)

From the ⚠️/❌ notes in `Human-Test.md`:

* **Undo is intermittent** (8.1). Sometimes one press removes a device, sometimes
  two. The pre-edit-snapshot fix helped but did not fully settle it. Low priority
  by decision, but it is a correctness bug in the history, not cosmetics.
* **Negative node pressure should render red** (8.19).
* ~~**Pressure visualiser should gradient along a pipe**~~ (8.20). Done
  v0.7.7-dev. A plain pipe ramps between its two node colours; a pump, valve or
  piece of equipment gets a hard step at the symbol instead, because a device
  puts its whole pressure change at one point and a ramp there would be a lie.
* **Riser marker** should sit at lower-left (225°) of its node, with an arrow
  showing flow direction up or down (7.1).
* **Riser from node to pipe does not connect** (7.2); mid-pipe to node works.
  This is a real snapping defect.
* **Light theme is grey outside the drawing area** (4.9).

### Reported 2026-08-02 — all done

* ~~Pump properties restructure~~ (v0.7.6-dev).
* ~~Outflow in SIMULATE~~ (v0.7.6-dev). The `Q = K·√P` identity is proven in
  `simulation.test.js`; see `HANDOVER.md` §2A.
* ~~Checkboxes become toggles~~ (v0.7.7-dev). Every one in the panels, the
  annotations list and the HYDRAULIC tab. Option switches are muted-vs-accent
  rather than red-vs-green: red means a fault everywhere else here, and an
  unticked label is not one.
* ~~Pressure gradient along a pipe~~ (v0.7.7-dev), above.
* ~~K factor on outflows, pumps and equipment~~ (v0.7.7-dev), from the design
  values, quoted in the model's own display units with the unit written out.
  Michael chose that over the sprinkler convention (L/min per √bar) and over Kv.
* ~~"% of design flow" and "Balance to design Kv" off the SIMULATE outflow
  panel~~ (v0.7.7-dev). Both are still on the calculation sheet, which is where
  a set of terminals can be read against each other.

### Reported 2026-08-02 (third round) — done

* ~~**Symmetrical ring splits 51/49**~~ (`debug/20260802-2.json`). Not noise —
  the run/branch pick had two geometrically identical candidates at the supply
  tee and broke the tie on the pipe's ID string, so one leg got K = 0.9 and the
  other K = 1.1. Fixed v0.7.10-dev by recognising the bullhead case: where the
  two charged legs are collinear with each other, nothing passes straight
  through and neither is a run. See `ARCHITECTURE.md` §7.
* ~~Source: remove the static-pressure explanation~~ (v0.7.10-dev).
* ~~VIEW: remove the "Values switched on here appear in a box…" hint~~ and
  ~~the equipment square-law hint~~ (v0.7.10-dev).
* ~~"Show on drawing" box is separately movable~~ (v0.7.10-dev). It has its own
  `boxOffset` and its own drag handle; it shared the entity's `labelOffset`
  before, so dragging a tag took the values with it.

### Reported 2026-08-02 (second round) — done

* ~~**Disallow vertically sloped pipes.**~~ v0.7.8-dev. Everything in the layout
  runs level; only a riser changes height. `M.pipeLength` returns the plan
  distance for any non-riser pipe and `M.pipeRise` reports the difference;
  `SLOPED_PIPE` is an error. Michael's reasoning is worth keeping: even once
  pipe gradients are modelled in v2 or v3, the length an engineer takes off a
  layout is the horizontal one. This also retired the `plan = √(L² − rise²)`
  solve added to `changeLength` the day before — with the rule in place, plan
  and drawn length are the same number and the direct comparison is correct
  again.
* ~~**PROBE command under VIEW.**~~ v0.7.8-dev. Pressure, flow and velocity at
  any point along a pipe. Pressure is the one that varies and is a straight line
  between the node values (level pipe, constant flow, uniform bore ⟹ constant
  loss per metre); a pump, valve or piece of equipment reports both sides and
  the change across instead, because a device puts its whole change at one
  point.

### Two defects found in `debug/20260802-1.json`, both fixed v0.7.7-dev

Worth keeping because they are a good illustration of one wrong decision
producing two unrelated-looking symptoms.

* **A source's static pressure was stored as the node's elevation** (`dz`).
  Hydraulically that gave the right downstream answers — a tank 20.43 m up does
  provide 200 kPa — but `dz` is a real elevation and `pipeLength` is a 3D
  distance, so typing 200 kPa silently stretched a 50 m run to 54.01 m. It is
  now `device.pressure`, in pascals, and old files are migrated on load with a
  dialog saying what changed, because the migration moves pipe lengths.
* **`changeLength` compared a requested 3D length against a PLAN length.** So
  typing 50 back into that 54.01 m pipe reported "already 50, nothing to do" —
  `ok:true` with an empty change list — and the field sprang back. It now solves
  `plan = √(L² − rise²)`, and refuses with `SHORTER_THAN_RISE` when the
  requested length is below the pipe's own rise. This one was independent of the
  first: any genuinely sloped pipe had it.
