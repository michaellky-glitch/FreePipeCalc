# Known issues

Small, non-urgent defects and follow-ups that are logged rather than fixed
immediately, so they are not rediscovered from scratch. Each entry says what it
is, why it is deferred, and where the fix would go.

---

## Open

### `quadWarnings` has no guard for a zero design flow

`data/pumps.js` — `quadWarnings(qc, qDesign)` divides by `qDesign`
(`100 * rising / qDesign`) and clamps a range to `qDesign * 1.5`. If `qDesign`
is `0` the percentages come out as `Infinity`/`NaN`.

In practice the TOOLS ▸ Generic Pump Curve caller only passes a positive design
flow, so it does not surface today. Deferred by decision (2026-07-30): log now,
add a one-line guard at the top of `quadWarnings` if a zero ever reaches it.

*(none)*

---

## Resolved

### Datacentre parallel-pump test values regenerated — 2026-07-30

`test/simulation.test.js` hard-coded the total flow and pump heads of
`data_centre_redundant_ring_main.pnet (fixed).json`. The model was rebuilt by
hand into a coherent 20 L/s single-equipment circuit, so the old 45 L/s
expectations failed. The baseline was regenerated from the final model
(total 0.020 m³/s; heads 268.5 / 257.6 / 253.3 / 249.6 kPa for 1–4 running
pumps) and all 633 assertions pass again. Not an independent check — a
regression lock, as the originals were.

---

## Logged for reference (not defects)

### Pipe-schedule K-table cells not cleanly transcribed

Two cells in `data/ktable.js` are flagged in-file as not cleanly transcribed
from the source table. All L/D and K values are user-editable on the HYDRAULIC
tab, so this is a data-provenance caveat, not a code fault. Left as-is by
decision (2026-07-30): far from shipping, revisit when the fitting data is
sourced properly.
