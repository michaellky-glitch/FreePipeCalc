/* FreePipeCalc — domestic-water plumbing data (IPC 2018 Appendix E).
 * Fixture cold-FU lookup, the FU→demand diversity curves, and the model's
 * per-outflow FU helper. The data is verified:false (transcribed, awaiting
 * sign-off) — these tests pin the TRANSCRIPTION and the maths, not the code.
 * Run:  node test/plumbing.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const P = FD.plumbing, M = FD.model;

const GPM = P.GPM_TO_M3S;

// ---------------------------------------------------------- provenance
section('Provenance');
ok('plumbing data is flagged unverified', P.verified === false,
  `verified = ${P.verified}, expected false (transcribed from IPC, not signed off)`);

// --------------------------------------------------- fixture cold FU
section('Fixture cold FU — Table E103.3(2)');
// Single-value fixtures ignore the supply system.
near('lavatory private = 0.5 FU', P.fixtureFU('lavPrivate', 'flushTank'), 0.5, 0);
near('lavatory private ignores system', P.fixtureFU('lavPrivate', 'flushometer'), 0.5, 0);
near('lavatory public = 1.5 FU', P.fixtureFU('lavPublic', 'flushTank'), 1.5, 0);
near('shower = 1.0 FU', P.fixtureFU('shower', 'flushTank'), 1.0, 0);
near('bathtub = 1.0 FU', P.fixtureFU('bathtub', 'flushTank'), 1.0, 0);
near('bidet = 1.5 FU', P.fixtureFU('bidet', 'flushTank'), 1.5, 0);
near('kitchen sink = 1.0 FU', P.fixtureFU('kitchenSink', 'flushTank'), 1.0, 0);

// System-dependent fixtures switch tank vs valve.
near('WC flush tank = 2.2 FU', P.fixtureFU('waterCloset', 'flushTank'), 2.2, 0);
near('WC flushometer = 6.0 FU', P.fixtureFU('waterCloset', 'flushometer'), 6.0, 0);
near('urinal flush tank = 3.0 FU', P.fixtureFU('urinal', 'flushTank'), 3.0, 0);
near('urinal flushometer = 5.0 FU', P.fixtureFU('urinal', 'flushometer'), 5.0, 0);
near('bathroom group tank = 2.7 FU', P.fixtureFU('bathroomGroup', 'flushTank'), 2.7, 0);
near('bathroom group valve = 6.0 FU', P.fixtureFU('bathroomGroup', 'flushometer'), 6.0, 0);

// Custom carries no value — the caller supplies it.
ok('custom fixture FU is null', P.fixtureFU('custom', 'flushTank') === null,
  `got ${P.fixtureFU('custom', 'flushTank')}`);
ok('unknown fixture FU is null', P.fixtureFU('nope', 'flushTank') === null,
  `got ${P.fixtureFU('nope', 'flushTank')}`);

// ------------------------------------------------ demand diversity curve
section('FU → demand — Table E103.3(3)');
// Exact tabulated points.
near('flush tank 1 FU = 3.0 gpm', P.fuToFlowGpm(1, 'flushTank'), 3.0, 1e-9);
near('flush tank 10 FU = 14.6 gpm', P.fuToFlowGpm(10, 'flushTank'), 14.6, 1e-9);
near('flush tank 100 FU = 43.5 gpm', P.fuToFlowGpm(100, 'flushTank'), 43.5, 1e-9);
near('flush tank 5000 FU = 593 gpm', P.fuToFlowGpm(5000, 'flushTank'), 593.0, 1e-9);
near('flushometer 5 FU = 15.0 gpm', P.fuToFlowGpm(5, 'flushometer'), 15.0, 1e-9);
near('flushometer 20 FU = 35.0 gpm', P.fuToFlowGpm(20, 'flushometer'), 35.0, 1e-9);

// Piecewise-linear interpolation between points (22 FU between 20→25).
// tank: 19.6 + (2/5)(21.5-19.6) = 19.6 + 0.76 = 20.36
near('flush tank 22 FU interpolates to 20.36', P.fuToFlowGpm(22, 'flushTank'), 20.36, 1e-9);

// Sub-additivity: two 10-FU branches do not add to the 20-FU flow.
ok('curve is sub-additive (2×10 FU < 20 FU flow summed)',
  P.fuToFlowGpm(20, 'flushTank') < 2 * P.fuToFlowGpm(10, 'flushTank'),
  `f(20)=${P.fuToFlowGpm(20, 'flushTank')} vs 2·f(10)=${2 * P.fuToFlowGpm(10, 'flushTank')}`);

// Clamping outside the tabulated range.
near('below flush-tank curve clamps to first', P.fuToFlowGpm(0.5, 'flushTank'), 3.0, 1e-9);
near('flushometer below 5 FU clamps to 15', P.fuToFlowGpm(2, 'flushometer'), 15.0, 1e-9);
near('above curve clamps to last', P.fuToFlowGpm(99999, 'flushTank'), 593.0, 1e-9);
near('zero FU is zero flow', P.fuToFlowGpm(0, 'flushTank'), 0, 0);
near('negative FU is zero flow', P.fuToFlowGpm(-3, 'flushTank'), 0, 0);

// ------------------------------------------------------ SI conversion
section('FU → demand in SI (m³/s)');
// 10 FU flush tank = 14.6 gpm → 14.6 × 3.785411784/60000 = 9.2112e-4 m³/s.
near('flush tank 10 FU in m³/s', P.fuToFlow(10, 'flushTank'), 14.6 * GPM, 1e-12);
near('flush tank 10 FU ≈ 0.921 L/s', P.fuToFlow(10, 'flushTank') * 1000, 0.9211, 1e-3);
near('zero FU SI is zero', P.fuToFlow(0, 'flushTank'), 0, 0);

// ------------------------------------------------- model outflowFU helper
section('model.outflowFU — per-outflow fixture-unit contribution');
const m = M.create();
if (!m.settings.plumbing) m.settings.plumbing = { system: 'flushTank' };

// A generic outflow contributes no fixture units.
const gen = { kind: 'demand', demandType: 'generic', flow: 0.001 };
near('generic outflow contributes 0 FU', M.outflowFU(m, gen), 0, 0);
// A source is not a demand — no FU.
near('source device contributes 0 FU',
  M.outflowFU(m, { kind: 'source', demandType: 'plumbing', fixture: 'shower', count: 3 }), 0, 0);

// A plumbing outflow: count × per-fixture FU, following the model system.
const wc3 = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset', count: 3 };
near('3 WCs on flush tank = 6.6 FU', M.outflowFU(m, wc3), 6.6, 1e-9);
m.settings.plumbing.system = 'flushometer';
near('3 WCs on flushometer = 18.0 FU', M.outflowFU(m, wc3), 18.0, 1e-9);
m.settings.plumbing.system = 'flushTank';

// Custom fixture uses the typed FU (dev.fu).
const cust = { kind: 'demand', demandType: 'plumbing', fixture: 'custom', fu: 2.5, count: 4 };
near('4 custom @ 2.5 FU = 10 FU', M.outflowFU(m, cust), 10, 1e-9);

// Count guards: missing or non-positive count is treated as a single fixture.
const one = { kind: 'demand', demandType: 'plumbing', fixture: 'shower' };
near('shower with no count = 1 fixture = 1 FU', M.outflowFU(m, one), 1.0, 1e-9);
const zero = { kind: 'demand', demandType: 'plumbing', fixture: 'shower', count: 0 };
near('shower count 0 clamps to 1 fixture = 1 FU', M.outflowFU(m, zero), 1.0, 1e-9);

report();
