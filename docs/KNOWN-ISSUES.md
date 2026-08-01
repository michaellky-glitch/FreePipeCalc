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
* **Pressure visualiser should gradient along a pipe** between its two node
  values (8.20), rather than only colouring the nodes.
* **Riser marker** should sit at lower-left (225°) of its node, with an arrow
  showing flow direction up or down (7.1).
* **Riser from node to pipe does not connect** (7.2); mid-pipe to node works.
  This is a real snapping defect.
* **Light theme is grey outside the drawing area** (4.9).

### Reported 2026-08-02, not yet done

* **Pump properties restructure.** Remove settable Head; when no curve is set
  offer a button through to TOOLS ▸ Pump Curve Generator; reorder to
  Tag / Status / [Design flow, Design pressure] (Resize) / [Actual flow, Actual
  pressure] (New Curve, Paste, Show, Clear); explanation behind a 🛈.
* **Outflow in SIMULATE.** Present like equipment — design flow/pressure in one
  box, actual in another — and verify the outflow flow really is a function of
  node pressure, the design-point K and the pump curve.
