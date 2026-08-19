/* FreePipeCalc — domestic-water plumbing data (IPC 2018 Appendix E).
 * Fixture cold-FU lookup, the FU→demand diversity curves, and the model's
 * per-outflow FU helper. The data is verified:false (transcribed, awaiting
 * sign-off) — these tests pin the TRANSCRIPTION and the maths, not the code.
 * Run:  node test/plumbing.test.js
 */
'use strict';
const fs = require('fs');
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const P = FD.plumbing, M = FD.model;

const GPM = P.GPM_TO_M3S;

// ---------------------------------------------------------- provenance
section('Provenance');
ok('fixture table E103.3(2) is verified (Michael, 2026-08-16)', P.verified.fixtures === true,
  `verified.fixtures = ${P.verified.fixtures}, expected true`);
ok('demand table E103.3(3) is verified (Michael, 2026-08-18)', P.verified.demand === true,
  `verified.demand = ${P.verified.demand}, expected true`);

// --------------------------------------------------- fixture cold FU
section('Fixture cold FU — Table E103.3(2), by variation');
// Single-variation fixtures resolve their one row.
near('lavatory private = 0.5 FU', P.fixtureFU('lavatory', 'priv'), 0.5, 0);
near('lavatory public = 1.5 FU', P.fixtureFU('lavatory', 'pub'), 1.5, 0);
near('shower private = 1.0 FU', P.fixtureFU('shower', 'priv'), 1.0, 0);
near('shower public = 3.0 FU', P.fixtureFU('shower', 'pub'), 3.0, 0);
near('bathtub private = 1.0 FU', P.fixtureFU('bathtub', 'priv'), 1.0, 0);
near('bathtub public = 3.0 FU', P.fixtureFU('bathtub', 'pub'), 3.0, 0);
near('bidet private = 1.5 FU', P.fixtureFU('bidet', 'priv'), 1.5, 0);
near('kitchen sink private = 1.0 FU', P.fixtureFU('kitchenSink', 'priv'), 1.0, 0);
near('kitchen sink public = 3.0 FU', P.fixtureFU('kitchenSink', 'pub'), 3.0, 0);
near('service sink = 2.25 FU', P.fixtureFU('serviceSink', 'pub'), 2.25, 0);
near('drinking fountain = 0.25 FU', P.fixtureFU('drinkingFountain', 'pub'), 0.25, 0);
near('washing machine 8 lb = 1.0 FU', P.fixtureFU('washingMachine', 'priv8'), 1.0, 0);
near('washing machine 15 lb = 3.0 FU', P.fixtureFU('washingMachine', 'pub15'), 3.0, 0);

// Fixtures split by supply control carry a row per variation.
near('WC private flush tank = 2.2 FU', P.fixtureFU('waterCloset', 'privTank'), 2.2, 0);
near('WC private flush valve = 6.0 FU', P.fixtureFU('waterCloset', 'privValve'), 6.0, 0);
near('WC public flush tank = 5.0 FU', P.fixtureFU('waterCloset', 'pubTank'), 5.0, 0);
near('WC public flush valve = 10.0 FU', P.fixtureFU('waterCloset', 'pubValve'), 10.0, 0);
near('urinal public flush tank = 3.0 FU', P.fixtureFU('urinal', 'pubTank'), 3.0, 0);
near('urinal public flush valve = 10.0 FU', P.fixtureFU('urinal', 'pubValve'), 10.0, 0);
near('bathroom group private tank = 2.7 FU', P.fixtureFU('bathroomGroup', 'privTank'), 2.7, 0);
near('bathroom group private valve = 6.0 FU', P.fixtureFU('bathroomGroup', 'privValve'), 6.0, 0);

// A missing / stale variation id falls back to the fixture's first row.
near('unknown variation falls back to first', P.fixtureFU('waterCloset', 'nope'), 2.2, 0);
near('undefined variation falls back to first', P.fixtureFU('lavatory', undefined), 0.5, 0);

// Custom carries no variation — the caller supplies the FU.
ok('custom fixture FU is null', P.fixtureFU('custom', 'priv') === null,
  `got ${P.fixtureFU('custom', 'priv')}`);
ok('custom offers no variations', P.variations('custom').length === 0,
  `got ${P.variations('custom').length}`);
ok('unknown fixture FU is null', P.fixtureFU('nope', 'priv') === null,
  `got ${P.fixtureFU('nope', 'priv')}`);
ok('WC offers four variations', P.variations('waterCloset').length === 4,
  `got ${P.variations('waterCloset').length}`);
// The transcription fix: private WC flush tank is Private, not "Ppublic".
ok('WC privTank labelled Private', /private/i.test(P.variation('waterCloset', 'privTank').name),
  `got "${P.variation('waterCloset', 'privTank').name}"`);

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

// A plumbing outflow: count × per-fixture FU for the chosen VARIATION. The
// model-wide system no longer affects the FU (only the demand curve).
const wcTank = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset', variation: 'privTank', count: 3 };
near('3 private-tank WCs = 6.6 FU', M.outflowFU(m, wcTank), 6.6, 1e-9);
const wcValve = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset', variation: 'pubValve', count: 3 };
near('3 public-valve WCs = 30.0 FU', M.outflowFU(m, wcValve), 30.0, 1e-9);
m.settings.plumbing.system = 'flushometer';
near('FU is independent of the model system', M.outflowFU(m, wcTank), 6.6, 1e-9);
m.settings.plumbing.system = 'flushTank';

// A stale/missing variation falls back to the fixture's first row (privTank=2.2).
const wcStale = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset', variation: 'gone', count: 1 };
near('stale variation falls back to first row', M.outflowFU(m, wcStale), 2.2, 1e-9);

// Custom fixture uses the typed FU (dev.fu).
const cust = { kind: 'demand', demandType: 'plumbing', fixture: 'custom', fu: 2.5, count: 4 };
near('4 custom @ 2.5 FU = 10 FU', M.outflowFU(m, cust), 10, 1e-9);

// Count guards: missing or non-positive count is treated as a single fixture.
const one = { kind: 'demand', demandType: 'plumbing', fixture: 'shower', variation: 'priv' };
near('shower with no count = 1 fixture = 1 FU', M.outflowFU(m, one), 1.0, 1e-9);
const zero = { kind: 'demand', demandType: 'plumbing', fixture: 'shower', variation: 'priv', count: 0 };
near('shower count 0 clamps to 1 fixture = 1 FU', M.outflowFU(m, zero), 1.0, 1e-9);

// ---------------------------------------- DW sizing (tree accumulation)
section('plumbingSizing — downstream-FU diversity on a tree');

/* A source feeds a junction that fans out to two 5×WC (private flush tank)
 * branches and one generic outflow:
 *      S --p1-- J --p2-- WC1 (5 × 2.2 = 11 FU)
 *                 \-p3-- WC2 (5 × 2.2 = 11 FU)
 *                 \-p4-- G   (generic 0.002 m³/s)               */
function tree() {
  const t = M.create();
  const lv = t.levels[0].id;
  const S = M.addNode(t, lv, 0, 0);
  const J = M.addNode(t, lv, 5, 0);
  const w1 = M.addNode(t, lv, 10, -5);
  const w2 = M.addNode(t, lv, 10, 0);
  const g = M.addNode(t, lv, 10, 5);
  M.setSource(t, S.id, 300000);
  [w1, w2].forEach(function (w) {
    M.setDemand(t, w.id, 0.001, 100000);
    const d = M.node(t, w.id).device;
    d.demandType = 'plumbing'; d.fixture = 'waterCloset'; d.variation = 'privTank'; d.count = 5;
  });
  M.setDemand(t, g.id, 0.002, 100000);           // generic
  const p1 = M.addPipe(t, S.id, J.id, { size: 'DN50' });
  const p2 = M.addPipe(t, J.id, w1.id, { size: 'DN25' });
  const p3 = M.addPipe(t, J.id, w2.id, { size: 'DN25' });
  const p4 = M.addPipe(t, J.id, g.id, { size: 'DN25' });
  if (!t.settings.plumbing) t.settings.plumbing = { system: 'flushTank' };
  return { m: t, ids: { p1: p1.id, p2: p2.id, p3: p3.id, p4: p4.id } };
}

const T = tree();
const r = M.plumbingSizing(T.m);
ok('tree sizes without error', r.ok && !r.error, r.error && r.error.code);

// Branch pipes: 11 FU each, no generic.
near('p2 downstream FU = 11', r.byPipe[T.ids.p2].fu, 11, 1e-9);
near('p2 flow = fuToFlow(11)', r.byPipe[T.ids.p2].flow, P.fuToFlow(11, 'flushTank'), 1e-15);
near('p3 flow = fuToFlow(11)', r.byPipe[T.ids.p3].flow, P.fuToFlow(11, 'flushTank'), 1e-15);
// Generic branch: no FU, carries its generic flow linearly.
near('p4 downstream FU = 0', r.byPipe[T.ids.p4].fu, 0, 1e-12);
near('p4 flow = generic 0.002', r.byPipe[T.ids.p4].flow, 0.002, 1e-12);
// Root main: 22 FU + 0.002 generic; diversity is sub-additive.
near('p1 downstream FU = 22', r.byPipe[T.ids.p1].fu, 22, 1e-9);
near('p1 generic = 0.002', r.byPipe[T.ids.p1].generic, 0.002, 1e-12);
near('p1 flow = 0.002 + fuToFlow(22)', r.byPipe[T.ids.p1].flow, 0.002 + P.fuToFlow(22, 'flushTank'), 1e-15);
ok('main flow is sub-additive (p1 < p2 + p3, FU part)',
  (r.byPipe[T.ids.p1].flow - 0.002) < (r.byPipe[T.ids.p2].flow + r.byPipe[T.ids.p3].flow),
  `p1 ${r.byPipe[T.ids.p1].flow} vs p2+p3 ${r.byPipe[T.ids.p2].flow + r.byPipe[T.ids.p3].flow}`);
near('total flow at source = p1 flow', r.totalFlow, r.byPipe[T.ids.p1].flow, 1e-15);

// The flushometer curve gives a different (larger) main flow.
T.m.settings.plumbing.system = 'flushometer';
const rf = M.plumbingSizing(T.m);
near('flushometer main flow = fuToFlow(22, flushometer) + generic',
  rf.byPipe[T.ids.p1].flow, 0.002 + P.fuToFlow(22, 'flushometer'), 1e-15);
T.m.settings.plumbing.system = 'flushTank';

section('plumbingSizing — errors that must not be guessed');
// A loop across the two WC branches: no longer a tree.
const L = tree();
M.addPipe(L.m, findNode(L.m, 10, -5).id, findNode(L.m, 10, 0).id, { size: 'DN25' });
const rl = M.plumbingSizing(L.m);
ok('loop is rejected as DW_LOOP', !rl.ok && rl.error && rl.error.code === 'DW_LOOP',
  rl.error && rl.error.code);

// A plumbing branch with no source.
const N = M.create();
const nlv = N.levels[0].id;
const a = M.addNode(N, nlv, 0, 0), b = M.addNode(N, nlv, 5, 0);
M.setDemand(N, b.id, 0.001, 100000);
const bd = M.node(N, b.id).device;
bd.demandType = 'plumbing'; bd.fixture = 'lavatory'; bd.variation = 'priv'; bd.count = 2;
M.addPipe(N, a.id, b.id, { size: 'DN25' });
if (!N.settings.plumbing) N.settings.plumbing = { system: 'flushTank' };
const rn = M.plumbingSizing(N);
ok('sourceless plumbing branch is DW_NO_SOURCE', !rn.ok && rn.error && rn.error.code === 'DW_NO_SOURCE',
  rn.error && rn.error.code);

// No plumbing outflows at all → ok, nothing to size.
const P0 = M.create();
const r0 = M.plumbingSizing(P0);
ok('no plumbing outflow → ok, empty', r0.ok && Object.keys(r0.byPipe).length === 0,
  JSON.stringify(r0.error));

// ---------------------------------------- editable tables (overrides)
section('Editable IPC tables — per-model overrides');

// data-layer: an explicit curve overrides the built-in one, same shape/unit.
const customCurve = [[1, 4.0], [10, 20.0], [100, 60.0]];
near('fuToFlowGpm honours an explicit curve at a point',
  P.fuToFlowGpm(10, 'flushTank', customCurve), 20.0, 1e-9);
near('...and interpolates on it (55 FU → 20+(45/90)(60-20)=40)',
  P.fuToFlowGpm(55, 'flushTank', customCurve), 40.0, 1e-9);
near('...and clamps below it', P.fuToFlowGpm(0.5, 'flushTank', customCurve), 4.0, 1e-9);
near('fuToFlow applies SI conversion to the override',
  P.fuToFlow(10, 'flushTank', customCurve), 20.0 * GPM, 1e-12);

// model-layer: a fixture FU override changes the effective FU and the sizing.
const mo = M.create();
if (!mo.settings.plumbing) mo.settings.plumbing = { system: 'flushTank' };
near('default private-tank WC FU is 2.2', M.plumbingFixtureFU(mo, 'waterCloset', 'privTank'), 2.2, 1e-9);
mo.settings.plumbing.fu = {}; mo.settings.plumbing.fu[M.plumbingFUKey('waterCloset', 'privTank')] = 3.5;
near('an override changes the effective fixture FU', M.plumbingFixtureFU(mo, 'waterCloset', 'privTank'), 3.5, 1e-9);
const wcOv = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset', variation: 'privTank', count: 4 };
near('outflowFU uses the overridden FU (4 × 3.5 = 14)', M.outflowFU(mo, wcOv), 14.0, 1e-9);

// model-layer: an edited demand curve drives plumbingFuToFlow and sizing.
const md = M.create();
if (!md.settings.plumbing) md.settings.plumbing = { system: 'flushTank' };
near('default 10 FU → 14.6 gpm in SI', M.plumbingFuToFlow(md, 10), 14.6 * GPM, 1e-12);
md.settings.plumbing.demand = { flushTank: [[1, 3.0], [10, 25.0], [5000, 593.0]] };
near('an edited demand curve is used by plumbingFuToFlow', M.plumbingFuToFlow(md, 10), 25.0 * GPM, 1e-12);
ok('plumbingDemandCurve returns the override', !!M.plumbingDemandCurve(md, 'flushTank'));
ok('...and null for an unedited system', M.plumbingDemandCurve(md, 'flushometer') === null);

// end to end: the edited curve flows through plumbingSizing.
const Te = tree();
const before = M.plumbingSizing(Te.m).byPipe[Te.ids.p1].flow;
Te.m.settings.plumbing.demand = { flushTank: FD.plumbing.demand.flushTank.map(function (r) {
  return [r[0], r[1] * 2]; }) };            // double every tank demand point
const after = M.plumbingSizing(Te.m).byPipe[Te.ids.p1].flow;
// p1 carries 22 FU of WC (diversity) + 0.002 generic. Doubling the curve doubles
// only the diversity part, not the generic, so after < 2× before.
near('doubling the tank curve doubles the diversity part of p1',
  after - 0.002, 2 * (before - 0.002), 1e-9);

// ---------------------------------------- plumbing report (flow + friction + pressure)
section('plumbingReport — flow direction, friction, residual pressure');
const NET = FD.network;
{
  const R = tree();                 // S(0,0) source@300 kPa; p1 S→J, p2/p3 J→WC, p4 J→generic
  const rep = NET.plumbingReport(R.m);
  ok('report ok on a valid tree', rep.ok === true, rep.error && rep.error.code);

  // Flow is signed +ve a→b; every pipe here is drawn source-outward (a = upstream).
  ok('p1 flow is positive (a is the source-ward end)', rep.flow[R.ids.p1] > 0);
  ok('p2 flow is positive (drawn J→WC)', rep.flow[R.ids.p2] > 0);
  near('signed flow magnitude matches the sizing',
    Math.abs(rep.flow[R.ids.p1]), R.m && M.plumbingSizing(R.m).byPipe[R.ids.p1].flow, 1e-12);

  // Friction drop is present and positive on a carrying pipe.
  ok('p1 has a positive head loss', rep.headloss[R.ids.p1] > 0);
  ok('p1 has a positive friction pressure drop', rep.dpFric[R.ids.p1] > 0);
  ok('a bigger main carries more flow than its branch',
    rep.flow[R.ids.p1] > rep.flow[R.ids.p2]);

  // Residual pressure: source states its own, and it falls downstream.
  const S = R.m.nodes.filter(function (n) { return n.device && n.device.kind === 'source'; })[0];
  near('source node holds its stated pressure', rep.pressure[S.id], 300000, 1e-6);
  const J = findNode(R.m, 5, 0);
  ok('pressure at the junction is below the source', rep.pressure[J.id] < 300000);
  // On one flat pipe the drop is exactly the friction (no static lift here).
  near('junction pressure = source − friction of p1',
    rep.pressure[J.id], 300000 - rep.dpFric[R.ids.p1], 1e-6);

  // Static lift: raise the junction 10 m and the residual drops by ρgh more.
  const R2 = tree();
  const J2 = findNode(R2.m, 5, 0);
  J2.dz = 10;
  const rep2 = NET.plumbingReport(R2.m);
  const rho = (R2.m.settings.fluid && R2.m.settings.fluid.density) || 998;
  near('a 10 m rise costs ρg·10 of residual pressure',
    (300000 - rep2.dpFric[R2.ids.p1]) - rep2.pressure[J2.id], rho * 9.81 * 10, 1);

  // An unsizeable tree passes the error straight through, no crash.
  const Lp = tree();
  M.addPipe(Lp.m, findNode(Lp.m, 10, -5).id, findNode(Lp.m, 10, 0).id, { size: 'DN25' });
  const repL = NET.plumbingReport(Lp.m);
  ok('a looped plumbing tree reports the error', !repL.ok && repL.error.code === 'DW_LOOP',
    repL.error && repL.error.code);
}

// ---------------------------------------- fixture supply (Table 604.3)
section('Fixture supply — Table 604.3 (undiversified flow & pressure)');
{
  ok('supply table (604.3) is verified (Michael, 2026-08-18)', P.verified.supply === true);
  ok('the supply list is present', P.supplies.length > 5);
  const wc = P.fixtureSupply('wcTankCloseCoupled');
  ok('a supply row transcribes gpm/psi', wc && wc.gpm === 3 && wc.psi === 20);

  const ms = M.create();
  if (!ms.settings.plumbing) ms.settings.plumbing = { system: 'flushTank' };
  // A plumbing outflow with a 604.3 supply outlet: undiversified flow = gpm×count.
  const dev = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset',
                variation: 'privTank', count: 4, supply: 'wcTankCloseCoupled', include: true };
  near('undiversified flow = 4 × 3 gpm in SI',
    M.plumbingUndivFlow(ms, dev), 4 * 3 * GPM, 1e-12);
  near('required pressure = 20 psi in Pa',
    M.plumbingReqPressure(ms, dev), 20 * P.PSI_TO_PA, 1e-6);

  // Explicit 'none' → nothing to push.
  const devNone = { kind: 'demand', demandType: 'plumbing', fixture: 'lavatory',
                    variation: 'priv', count: 2, supply: 'none', include: true };
  near('explicit none → zero undiversified flow', M.plumbingUndivFlow(ms, devNone), 0, 0);

  // UNSET supply falls back to the fixture DEFAULT (Michael's 604.3 mapping,
  // 2026-08-17: WC private flush-tank → Water closet, flushometer tank, 1.6 gpm).
  const devDef = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset',
                   variation: 'privTank', count: 1, include: true };   // no dev.supply
  ok('unset supply resolves to the fixture default outlet',
    M.plumbingFixtureDefault(ms, devDef).label === 'Water closet, flushometer tank',
    M.plumbingFixtureDefault(ms, devDef).label);
  near('WC private flush-tank default is 1.6 gpm', M.plumbingUndivFlow(ms, devDef), 1.6 * GPM, 1e-12);
  const devExplicit = { kind: 'demand', demandType: 'plumbing', fixture: 'waterCloset',
                        variation: 'privTank', count: 1, supply: 'wcBlowoutValve', include: true };
  ok('an explicit supply overrides the default',
    M.plumbingFixtureDefault(ms, devExplicit).label === 'Water closet, blow out, flushometer valve');

  // A generic outflow keeps its own flow.
  near('generic outflow keeps its flow',
    M.plumbingUndivFlow(ms, { kind: 'demand', demandType: 'generic', flow: 0.002, include: true }),
    0.002, 1e-12);

  // Per-model override of a supply row (dev has an explicit wcTankCloseCoupled).
  ms.settings.plumbing.supply = { wcTankCloseCoupled: { gpm: 5, psi: 25 } };
  near('an override changes the undiversified flow', M.plumbingUndivFlow(ms, dev), 4 * 5 * GPM, 1e-12);
  near('...and the required pressure', M.plumbingReqPressure(ms, dev), 25 * P.PSI_TO_PA, 1e-6);
}

// ---------------------------------------- 604.3 default mapping (Michael's sheet)
section('Fixture default flow & pressure — 604.3 mapping (Michael, 2026-08-17)');
{
  const mm = M.create();
  function def(fx, v) {
    return M.plumbingFixtureDefault(mm, { demandType: 'plumbing', fixture: fx, variation: v });
  }
  // Direct maps (not estimated).
  near('bathtub private → 4 gpm', def('bathtub', 'priv').gpm, 4, 1e-9);
  ok('bathtub is a direct 604.3 map (not estimated)', def('bathtub', 'priv').estimated === false);
  near('WC private flush-tank → flushometer tank 1.6 gpm', def('waterCloset', 'privTank').gpm, 1.6, 1e-9);
  near('WC private flush-valve → blow-out 25 gpm @ 45 psi', def('waterCloset', 'privValve').gpm, 25, 1e-9);
  near('...at 45 psi', def('waterCloset', 'privValve').psi, 45, 1e-9);
  near('WC public flush-tank → close coupled 3 gpm', def('waterCloset', 'pubTank').gpm, 3, 1e-9);
  near('WC public flush-valve → blow-out 25 gpm', def('waterCloset', 'pubValve').gpm, 25, 1e-9);
  near('urinal (tank) → urinal valve 12 gpm', def('urinal', 'pubTank').gpm, 12, 1e-9);
  near('dishwashing machine → dishwasher residential 2.75 gpm', def('dishwashingMachine', 'priv').gpm, 2.75, 1e-9);

  // Estimated (red) — derived from 604.3.
  const ks = def('kitchenSink', 'pub');
  ok('kitchen sink public is estimated', ks.estimated === true);
  near('...= FU ratio (3/1) × sink residential 1.75 = 5.25 gpm', ks.gpm, 5.25, 1e-9);
  const sh = def('shower', 'pub');
  ok('shower public is estimated', sh.estimated === true);
  near('...= 3 × shower mixing valve 2.5 = 7.5 gpm', sh.gpm, 7.5, 1e-9);
  const wm = def('washingMachine', 'priv8');
  ok('washing machine (private) is estimated', wm.estimated === true);
  near('...= lavatory 0.8 gpm', wm.gpm, 0.8, 1e-9);
  near('...at 100 kPa', wm.psi * P.PSI_TO_PA, 100000, 1);
  const bg = def('bathroomGroup', 'privTank');
  ok('bathroom group is estimated', bg.estimated === true);
  // largest 2 of lav 0.8, shower 2.5, WC-flushometer-tank 1.6 = 2.5 + 1.6 = 4.1
  near('...= largest 2 of lav+shower+WC = 4.1 gpm', bg.gpm, 4.1, 1e-9);
  near('...highest pressure of the three = 20 psi', bg.psi, 20, 1e-9);
  const bgv = def('bathroomGroup', 'privValve');
  near('bathroom group (flush valve) = 25 + 2.5 = 27.5 gpm', bgv.gpm, 27.5, 1e-9);
  near('...highest pressure = 45 psi', bgv.psi, 45, 1e-9);

  // An estimate TRACKS an edit to the 604.3 outlet it is built from.
  mm.settings.plumbing = mm.settings.plumbing || { system: 'flushTank' };
  mm.settings.plumbing.supply = { sinkResidential: { gpm: 2.0, psi: 8 } };
  near('kitchen sink public follows an edited residential (3 × 2.0 = 6.0)',
    def('kitchenSink', 'pub').gpm, 6.0, 1e-9);

  // A per-fixture design override (the merged HYDRAULIC table) wins over the map.
  const mo2 = M.create();
  mo2.settings.plumbing = mo2.settings.plumbing || { system: 'flushTank' };
  mo2.settings.plumbing.design = { 'bathtub.priv': { gpm: 6, psi: 30 } };
  const bt = M.plumbingFixtureDefault(mo2, { demandType: 'plumbing', fixture: 'bathtub', variation: 'priv' });
  near('a per-fixture design override sets the flow', bt.gpm, 6, 1e-9);
  near('...and the pressure', bt.psi, 30, 1e-9);
  // Overriding an estimated row keeps its estimated (red) flag.
  mo2.settings.plumbing.design['shower.pub'] = { gpm: 9 };
  const sp2 = M.plumbingFixtureDefault(mo2, { demandType: 'plumbing', fixture: 'shower', variation: 'pub' });
  ok('an overridden estimate is still flagged estimated', sp2.estimated === true && sp2.gpm === 9);
}

section('Plumbing SIMULATE — undiversified flows through the GGA (converted copy)');
{
  // Mirror app.buildPlumbingSimModel: convert plumbing fixtures to generic
  // demands at their undiversified 604.3 flow, then solve with the real GGA.
  const T2 = tree();                       // 2 × (5 WC private-tank), source @ 300 kPa
  T2.m.nodes.forEach(function (n) {
    const d = n.device;
    if (d && d.kind === 'demand' && d.demandType === 'plumbing') {
      d.supply = 'wcTankCloseCoupled';     // 3 gpm, 20 psi
    }
  });
  const design = M.plumbingSizing(T2.m).byPipe[T2.ids.p1].flow;   // diversified
  const sim = JSON.parse(JSON.stringify(T2.m));
  sim.settings.calcMode = 'simulation';    // K-terminals, like a hydronic sim
  sim.nodes.forEach(function (n) {
    const d = n.device;
    if (d && d.kind === 'demand' && d.demandType === 'plumbing') {
      const q = M.plumbingUndivFlow(T2.m, d);
      d.flow = q; d.reqPressure = 20 * P.PSI_TO_PA; d.demandType = 'generic';
    }
  });
  const res = NET.solveModel(sim);
  ok('the GGA solves the converted plumbing model', !!res && !!res.flow);
  // Continuity at the junction holds whatever the terminals draw.
  const cont = Math.abs(res.flow[T2.ids.p2]) + Math.abs(res.flow[T2.ids.p3]) +
               Math.abs(res.flow[T2.ids.p4]);
  near('main = sum of the branch flows (continuity)', Math.abs(res.flow[T2.ids.p1]), cont, 1e-9);
  ok('fixtures draw a pressure-dependent flow (K-terminals)',
    Math.abs(res.flow[T2.ids.p2]) > 0);
  ok('simulate flow exceeds the diversified design flow (ample supply)',
    Math.abs(res.flow[T2.ids.p1]) > design,
    Math.abs(res.flow[T2.ids.p1]) + ' vs ' + design);
}

// ---------------------------------------- fixture auto-tag prefixes
section('Fixture auto-tag prefixes (Michael, 2026-08-17)');
{
  const want = { custom: 'OF', bathroomGroup: 'BG', bathtub: 'BA', bidet: 'BT',
    drinkingFountain: 'DF', kitchenSink: 'KS', lavatory: 'HB', serviceSink: 'SS',
    shower: 'SH', urinal: 'UR', washingMachine: 'WM', waterCloset: 'WC' };
  Object.keys(want).forEach(function (fx) {
    ok(fx + ' → ' + want[fx], P.tagPrefix(fx) === want[fx], P.tagPrefix(fx));
  });
  ok('an unknown fixture falls back to OF', P.tagPrefix('nope') === 'OF');
  ok('Lavatory is renamed to Lavatory/Hand Basin',
    P.fixture('lavatory').name === 'Lavatory/Hand Basin', P.fixture('lavatory').name);
}

// ---------------------------------------- outflow defaults to plumbing type
section('setDemand — plumbing outflow by default in a plumbing file');
{
  const hy = M.create();                       // hydronic
  const hn = M.addNode(hy, hy.levels[0].id, 0, 0);
  M.setDemand(hy, hn.id, 0.001, 100000);
  ok('a hydronic outflow stays generic', M.node(hy, hn.id).device.demandType === 'generic');

  const pl = M.create(); pl.discipline = 'plumbing';
  const pn = M.addNode(pl, pl.levels[0].id, 0, 0);
  M.setDemand(pl, pn.id, 0.001, 100000);
  const pd = M.node(pl, pn.id).device;
  ok('a plumbing outflow defaults to a plumbing fixture', pd.demandType === 'plumbing');
  ok('...a water closet, first variation, count 1',
    pd.fixture === 'waterCloset' && pd.count === 1 && !!pd.variation);
  ok('...with a baked-in supply outlet (no separate pick needed)',
    M.plumbingFixtureDefault(pl, pd).label === 'Water closet, flushometer tank',
    M.plumbingFixtureDefault(pl, pd).label);
}

// ------------------------------ engine warnings from plumbingReport (v0.17.15)
section('plumbingReport — the engine reports warnings, not just the renderer');
{
  /* `plumbingReport` returned `warnings: []` unconditionally until v0.17.15, so
   * a plumbing file could not raise one: on Michael's own 20260818-lowrise, 83
   * sections were over the friction-rate limit and the status chip stayed green.
   * Detection belongs in the engine — the same rule the hydronic side already
   * learned. These pin that the SHARED detectors now run on the plumbing path. */
  const W = tree();
  // Squeeze the main so it is unambiguously over both limits.
  const mainPipe = W.m.pipes.filter(function (x) { return x.id === W.ids.p1; })[0];
  mainPipe.size = 'DN15';
  W.m.settings.warn = W.m.settings.warn || {};
  W.m.settings.warn.velocity = 2.4;
  W.m.settings.warn.pdm = 400;
  const rw = FD.network.plumbingReport(W.m);
  ok('the report still sizes', rw.ok === true, rw.error && rw.error.code);
  const codes = rw.warnings.map(function (x) { return x.code; });
  ok('an over-velocity main raises VELOCITY', codes.indexOf('VELOCITY') >= 0, codes.join(','));
  ok('...and PDM for the friction rate', codes.indexOf('PDM') >= 0, codes.join(','));
  const vw = rw.warnings.filter(function (x) { return x.code === 'VELOCITY'; })[0];
  ok('the warning names the pipe it is about', vw.pipe === W.ids.p1, vw.pipe);
  ok('...and carries the limit it breached', vw.limit === 2.4, String(vw.limit));

  // Generously sized, the same model raises neither — the limits are respected,
  // not just the detectors wired up.
  const Q = tree();
  Q.m.pipes.forEach(function (x) { x.size = 'DN100'; });
  Q.m.settings.warn = { velocity: 2.4, pdm: 400 };
  const rq = FD.network.plumbingReport(Q.m);
  const qc = rq.warnings.map(function (x) { return x.code; });
  ok('an amply sized model raises no VELOCITY', qc.indexOf('VELOCITY') < 0, qc.join(','));
  ok('...and no PDM', qc.indexOf('PDM') < 0, qc.join(','));
}

section('plumbingReport — a fixture below its 604.3 required pressure');
{
  /* The app's `computeWarnings` cannot catch this: it measures against the
   * hydronic `device.reqPressure`, which on a plumbing fixture is a placeholder
   * left by setDemand. The engine measures against M.plumbingReqPressure. */
  const S = tree();
  // Starve it: a source barely above zero cannot meet a WC's 604.3 pressure.
  S.m.nodes.filter(function (n) { return n.device && n.device.kind === 'source'; })
    .forEach(function (n) { n.device.pressure = 20000; });   // 20 kPa
  const rs = FD.network.plumbingReport(S.m);
  const shorts = rs.warnings.filter(function (x) { return x.code === 'DW_FIXTURE_SHORT'; });
  ok('a starved fixture raises DW_FIXTURE_SHORT', shorts.length > 0, String(rs.warnings.length));
  ok('...naming the node', !!M.node(S.m, shorts[0].node), shorts[0].node);
  ok('...with the shortfall in Pa', shorts[0].shortfall > 0, String(shorts[0].shortfall));
  ok('...and the requirement it missed',
    Math.abs(shorts[0].required -
      M.plumbingReqPressure(S.m, M.node(S.m, shorts[0].node).device)) < 1e-9,
    String(shorts[0].required));

  /* NO PRESSURE ORIGIN, NO CHECK. With no supply pressure and no pump every
   * residual is zero and every fixture would be reported short — noise, not a
   * finding. */
  const N = tree();
  N.m.nodes.filter(function (n) { return n.device && n.device.kind === 'source'; })
    .forEach(function (n) { n.device.pressure = 0; });
  const rn = FD.network.plumbingReport(N.m);
  ok('an unpressurised model raises no fixture-short noise',
    rn.warnings.every(function (x) { return x.code !== 'DW_FIXTURE_SHORT'; }),
    rn.warnings.map(function (x) { return x.code; }).join(','));
}

section('plumbingReport — pipework the sizing never reached');
{
  /* `plumbingSizing` only walks components that contain a plumbing fixture, so
   * a branch drawn without one is absent from byPipe — and was therefore absent
   * from the calculation sheet with nothing said. */
  const U = tree();
  const lv = U.m.levels[0].id;
  const a1 = M.addNode(U.m, lv, 40, 40);
  const b1 = M.addNode(U.m, lv, 45, 40);
  const stray = M.addPipe(U.m, a1.id, b1.id, { size: 'DN25' });
  const ru = FD.network.plumbingReport(U.m);
  const un = ru.warnings.filter(function (x) { return x.code === 'DW_UNSIZED'; })[0];
  ok('a fixture-less branch raises DW_UNSIZED', !!un,
    ru.warnings.map(function (x) { return x.code; }).join(','));
  ok('...listing the pipe it left out', un && un.pipes.indexOf(stray.id) >= 0,
    un && un.pipes.join(','));
  ok('...and the sized tree itself raises none',
    FD.network.plumbingReport(tree().m).warnings
      .every(function (x) { return x.code !== 'DW_UNSIZED'; }));
}

// ------------------------------------- REMOTE1 plumbing simulation (v0.17.19)
section('plumbingRemote1 — the load case a booster is actually sized for');
{
  /* Michael, 2026-08-19: "as all outflows are open, the furthest point will
   * never receive water." He is right, and it is an artefact of the question:
   * a booster is not sized to run every tap in the building at once. REMOTE1
   * opens the most remote tap, then the next, until the system cannot deliver,
   * and backs off the last one. */
  const raw = JSON.parse(fs.readFileSync(
    __dirname + '/fixtures/plumbing-booster.pnet.json', 'utf8'));
  const mb = M.fromJSON(raw);
  const r = FD.network.plumbingRemote1(mb);
  ok('it resolves', r.ok === true, r.error && r.error.code);
  ok('the index fixture is the most remote', !!M.node(mb, r.indexNode), r.indexNode);
  ok('it serves at least the index fixture', r.openCount >= 1, String(r.openCount));
  ok('...and never more than there are', r.openCount <= r.total,
    r.openCount + '/' + r.total);
  ok('one pass per tap opened, no more', r.solves <= r.total + 1, String(r.solves));

  /* THE SERVED SET REALLY IS SERVED. Every open fixture must have at least its
   * 604.3 flow pressure — that is what "served" means, and it is the assertion
   * the whole method exists to make true. */
  const open = {};
  r.openNodes.forEach(function (id) { open[id] = true; });
  let shortfalls = 0;
  r.openNodes.forEach(function (id) {
    const need = M.plumbingReqPressure(mb, M.node(mb, id).device);
    if (r.result.pressure[id] < need - 1) shortfalls++;
  });
  ok('every served fixture has its required pressure', shortfalls === 0, String(shortfalls));

  /* A CLOSED TAP DRAWS NOTHING. */
  const closed = mb.nodes.filter(function (n) {
    return n.device && n.device.kind === 'demand' &&
           n.device.demandType === 'plumbing' && !open[n.id];
  });
  if (closed.length) {
    ok('a shut tap draws nothing', (r.result.draw[closed[0].id] || 0) === 0,
      String(r.result.draw[closed[0].id]));
  }

  /* AN OPEN TAP DRAWS ITS FULL 604.3 FLOW — not a diversified share, and not
   * the K-terminal's "whatever the system gives it", which on lowrise had ONE
   * water closet pulling 2.35 L/s. */
  const first = r.openNodes[0];
  near('an open tap draws its full 604.3 flow',
    r.result.draw[first], M.plumbingUndivFlow(mb, M.node(mb, first).device), 1e-15);

  /* OPENING THE ONE THAT BROKE IT REALLY DOES BREAK IT. */
  if (r.firstFailure) {
    const tooMany = {};
    r.openNodes.forEach(function (id) { tooMany[id] = true; });
    tooMany[r.firstFailure] = true;
    const bad = FD.network.plumbingOpenPass
      ? FD.network.plumbingOpenPass(mb, tooMany)
      : null;
    if (bad) {
      let anyShort = false;
      Object.keys(tooMany).forEach(function (id) {
        const need = M.plumbingReqPressure(mb, M.node(mb, id).device);
        if (bad.pressure[id] < need - 1) anyShort = true;
      });
      ok('opening one more leaves something short — which is why it stopped', anyShort);
    }
  }

  /* RE-RANKED EVERY ROUND (Michael, 2026-08-19). "The next most remote" is a
   * question about the system as it stands: once ten taps are running the
   * pressures have moved, and the tap with the least margin LEFT is not
   * necessarily the one the design pass ranked eleventh.
   *
   * The invariant, checked by replaying the run: at each step the tap chosen was
   * the least-margin one still shut, measured on the pass that preceded it. That
   * is the definition, and it is what ranking-once violated. */
  {
    const cands = mb.nodes.filter(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false &&
             n.device.demandType === 'plumbing' &&
             M.plumbingUndivFlow(mb, n.device) > 0;
    }).map(function (n) {
      return { node: n.id, need: M.plumbingReqPressure(mb, n.device) };
    });
    const rep0 = FD.network.plumbingReport(mb);
    let prev = rep0, openSoFar = {}, violations = 0, checked = 0;
    r.order.forEach(function (id) {
      const shut = cands.filter(function (c) { return !openSoFar[c.node]; });
      let bestMargin = Infinity;
      shut.forEach(function (c) {
        const p = prev.pressure[c.node];
        const mg = (p === undefined) ? -Infinity : p - c.need;
        if (mg < bestMargin) bestMargin = mg;
      });
      const chosen = cands.filter(function (c) { return c.node === id; })[0];
      const pc = prev.pressure[chosen.node];
      const mc = (pc === undefined) ? -Infinity : pc - chosen.need;
      checked++;
      if (mc > bestMargin + 1e-6) violations++;
      openSoFar[id] = true;
      prev = FD.network.plumbingOpenPass(mb, openSoFar, rep0);
    });
    ok('every tap opened was the least-margin one still shut at that moment',
      violations === 0, violations + ' of ' + checked + ' out of order');
    ok('...and the replay covered the whole run', checked === r.openCount,
      checked + ' vs ' + r.openCount);
  }

  /* RANKING ONCE AND RE-RANKING CAN DISAGREE, and where they do the re-ranked
   * order is the one that matches its own simulation. On the booster fixture the
   * two happen to agree; the assertion is that the run is SELF-CONSISTENT
   * (above), not that it differs on every model. */

  /* THE ALL-OPEN CASE IS THE ONE HE OBJECTED TO, and it is still available on
   * DYNAMIC — pinned here so the difference is on the record. */
  const allOpen = FD.network.solveModel(FD.network.plumbingSimModel(mb, null));
  ok('all-open remains a different (and harsher) answer',
    allOpen.pressure[r.indexNode] < r.result.pressure[r.indexNode] + 1,
    'all-open ' + allOpen.pressure[r.indexNode] + ' vs remote1 ' +
    r.result.pressure[r.indexNode]);
}

// -------------------- generic demand is added undiversified, and says so (v0.17.17)
section('plumbingReport — a generic outflow is added undiversified and reported');
{
  /* Michael, 2026-08-18, on P276 of 20260818-lowrise: "Downstream FU = 116.9,
   * Diversity Flow = 2.98. Why is Design Flow 3.98?" One generic outflow a floor
   * below, still at the 1.00 L/s value `setDemand` writes as a default, added
   * LINEARLY to every pipe upstream — a quarter of the building's design flow
   * and a quarter of the booster duty. The rule is right (a continuous draw is
   * not a fixture unit); nothing was saying it applied. */
  const G = tree();                      // p4 feeds a generic outflow at 0.002
  const rg = FD.network.plumbingReport(G.m);
  const main = rg.byPipe[G.ids.p1];
  near('the main carries the diversified FU flow plus the generic, linearly',
    main.flow, P.fuToFlow(main.fu, 'flushTank') + main.generic, 1e-15);
  near('...and the generic part is NOT run through the demand curve',
    main.generic, 0.002, 1e-12);
  ok('the diversified part alone is less than the total',
    P.fuToFlow(main.fu, 'flushTank') < main.flow);

  const note = rg.warnings.filter(function (w) { return w.code === 'DW_GENERIC_DEMAND'; })[0];
  ok('a generic outflow raises DW_GENERIC_DEMAND', !!note,
    rg.warnings.map(function (w) { return w.code; }).join(','));
  ok('...as a NOTICE, because the rule is correct and deliberate',
    note && note.level === 'notice', note && note.level);
  near('...carrying the total generic draw', note.total, 0.002, 1e-12);
  ok('...and naming the node responsible', note.nodes.length === 1 &&
    !!M.node(G.m, note.nodes[0]), note.nodes.join(','));

  /* An all-fixture job says nothing — the notice must not become wallpaper. */
  const F = tree();
  F.m.nodes.forEach(function (n) {
    if (n.device && n.device.kind === 'demand' && n.device.demandType !== 'plumbing') {
      n.device.include = false;
    }
  });
  const rf = FD.network.plumbingReport(F.m);
  ok('an all-fixture model raises no generic notice',
    rf.warnings.every(function (w) { return w.code !== 'DW_GENERIC_DEMAND'; }));
  near('...and its main is purely the diversified FU flow',
    rf.byPipe[F.ids.p1].flow, P.fuToFlow(rf.byPipe[F.ids.p1].fu, 'flushTank'), 1e-15);
}

// ---------------------------- booster pump sizing on the plumbing path (v0.17.16)
section('plumbingPumpDuty — sizing a booster without the GGA');
{
  /* Michael, 2026-08-18: on 20260818-lowrise the booster auto-sized to
   * 47 L/s @ 2 MPa. The app's hydronic sizer calls `solveModel(m)` — the GGA —
   * on the model itself, so it saw all 47 fixtures as ordinary flow demands at
   * `device.flow`, the 1.00 L/s PLACEHOLDER (47 × 1.00 = 47 L/s), and chased
   * `device.reqPressure`, the hydronic placeholder, for twelve rounds of added
   * head. The plumbing duty needs no solve at all: the residual pass is exactly
   * linear in pump head, so one pass is exact. */
  function boosterTree() {
    const t = M.create(); t.discipline = 'plumbing';
    const lv = t.levels[0].id;
    const S = M.addNode(t, lv, 0, 0);
    const A = M.addNode(t, lv, 2, 0);
    const B = M.addNode(t, lv, 12, 0);
    M.setSource(t, S.id, 0);                       // no mains pressure: the pump is it
    M.setDemand(t, B.id, 0.001, 100000);
    const dv = M.node(t, B.id).device;
    dv.demandType = 'plumbing'; dv.fixture = 'waterCloset';
    dv.variation = 'privTank'; dv.count = 4;
    const pump = M.addPipe(t, S.id, A.id, { size: 'DN50' });
    pump.kind = 'pump';
    pump.pump = { mode: 'fixed', head: 0, sizing: 'auto' };
    M.addPipe(t, A.id, B.id, { size: 'DN25' });
    if (!t.settings.plumbing) t.settings.plumbing = { system: 'flushTank' };
    t.settings.pumpSafetyPct = 0;
    return { m: t, pump: pump.id, fixture: B.id };
  }

  const BT = boosterTree();
  const rep0 = FD.network.plumbingReport(BT.m);
  const duty = FD.network.plumbingPumpDuty(BT.m, BT.pump);
  ok('the duty resolves', duty.ok === true, duty.error && duty.error.code);

  /* THE DUTY FLOW IS MICHAEL'S RULE (2026-08-18, logged in docs/DW-MODULE.md):
   * the index fixture at its FULL 604.3 flow, plus the DIVERSIFIED flow of every
   * other fixture unit the pump serves, plus any generic draw. It is NOT the
   * whole-branch diversified flow (that is the PIPE's basis), and emphatically
   * not count × the 1.00 L/s placeholder (the 47 L/s bug). */
  const idxDev = M.node(BT.m, BT.fixture).device;
  const idxFU = M.outflowFU(BT.m, idxDev);
  const servedFU = rep0.byPipe[BT.pump].fu;
  const expect = M.plumbingUndivFlow(BT.m, idxDev) +
                 P.fuToFlow(servedFU - idxFU, 'flushTank') +
                 (rep0.byPipe[BT.pump].generic || 0);
  near('the rule gives index-at-full-flow + the rest diversified', duty.ruleFlow, expect, 1e-15);
  ok('the index fixture is named', duty.indexNode === BT.fixture, duty.indexNode);
  near('...at its undiversified 604.3 flow',
    duty.indexFlow, M.plumbingUndivFlow(BT.m, idxDev), 1e-15);

  /* THE FLOOR. This tree puts all four WCs on ONE node, so the index fixture is
   * the whole branch: the rule takes all 8.8 FU out of the curve and adds back
   * 4 x 1.6 gpm = 0.404 L/s, which is BELOW the 0.853 L/s the pipe is sized for
   * (at low FU the demand curve sits above the sum of the outlet flows). A pump
   * that passes less than its own pipe is not defensible, so the duty floors at
   * the branch flow. */
  ok('the rule alone would fall below the pipe flow here',
    duty.ruleFlow < Math.abs(rep0.flow[BT.pump]),
    `rule ${duty.ruleFlow} vs pipe ${Math.abs(rep0.flow[BT.pump])}`);
  near('...so the duty floors at the branch diversified flow',
    duty.q, Math.abs(rep0.flow[BT.pump]), 1e-15);
  ok('...and says it was floored', duty.flooredToBranch === true);
  const placeholder = idxDev.flow * idxDev.count;
  ok('...and is NOT count × the placeholder flow (the 47 L/s bug)',
    Math.abs(duty.q - placeholder) > 1e-6,
    `duty ${duty.q} vs placeholder ${placeholder}`);

  /* APPLY IT AND THE WORST FIXTURE LANDS EXACTLY ON ITS REQUIREMENT. One pass,
   * because the residual pass is linear in head. */
  M.pipe(BT.m, BT.pump).pump.head = duty.h;
  const rep1 = FD.network.plumbingReport(BT.m);
  const fixNode = M.node(BT.m, BT.fixture);
  const need = M.plumbingReqPressure(BT.m, fixNode.device);
  near('one pass puts the worst fixture exactly on its 604.3 requirement',
    rep1.pressure[BT.fixture], need, 1e-6);
  ok('...so nothing is reported short', rep1.warnings
    .every(function (w) { return w.code !== 'DW_FIXTURE_SHORT'; }));
  ok('the governing fixture is named', duty.worstNode === BT.fixture, duty.worstNode);

  /* IT CONVERGES FROM ABOVE TOO. An oversized booster must come DOWN — "auto"
   * that only ever adds head is not auto. */
  M.pipe(BT.m, BT.pump).pump.head = duty.h + 25;
  const down = FD.network.plumbingPumpDuty(BT.m, BT.pump);
  near('a 25 m oversized booster re-sizes back to the same duty', down.h, duty.h, 1e-9);

  /* The safety percentage lands on the duty, once. */
  BT.m.settings.pumpSafetyPct = 10;
  M.pipe(BT.m, BT.pump).pump.head = duty.h;
  const safe = FD.network.plumbingPumpDuty(BT.m, BT.pump);
  near('10% safety gives 1.10 x the required head', safe.h, duty.h * 1.1, 1e-9);
  BT.m.settings.pumpSafetyPct = 0;

  /* A pump off the sized tree is refused rather than given a made-up duty. */
  const OT = boosterTree();
  const lv2 = OT.m.levels[0].id;
  const x1 = M.addNode(OT.m, lv2, 60, 60), x2 = M.addNode(OT.m, lv2, 65, 60);
  const stray = M.addPipe(OT.m, x1.id, x2.id, { size: 'DN25' });
  stray.kind = 'pump'; stray.pump = { mode: 'fixed', head: 0, sizing: 'auto' };
  const bad = FD.network.plumbingPumpDuty(OT.m, stray.id);
  ok('a pump off the sized tree is refused, not guessed',
    bad.ok === false && bad.error.code === 'DW_PUMP_UNSIZED',
    bad.error && bad.error.code);
}

// ------------------------------- display defaults (default-ON Tag, v0.17.13)
section('Display defaults — a default-ON flag is not stored in `show`');
{
  /* THE BUG (Michael, 2026-08-18): the info-panel Tag defaults ON for a plumbing
   * outflow, so it is absent from `obj.show` until it is switched OFF — and the
   * renderer bailed on an empty `show` before it drew anything. The tag only
   * appeared once some OTHER display switch had put a key in `show`. */
  const pl = M.create(); pl.discipline = 'plumbing';
  const pn = M.addNode(pl, pl.levels[0].id, 0, 0);
  M.setDemand(pl, pn.id, 0.001, 100000);
  const node = M.node(pl, pn.id);

  ok('a fresh plumbing outflow stores no display flags', !node.show);
  ok('...but Tag defaults ON', M.displayDefaults(pl, node).tag === true);
  ok('...so displayShown reports the tag drawn', M.displayShown(pl, node, 'tag') === true);
  ok('...and there IS a default to stop the renderer bailing',
    Object.keys(M.displayDefaults(pl, node)).length > 0);
  ok('a flag with no default reads off', M.displayShown(pl, node, 'fu') === false);

  // Switching it OFF stores the explicit false; switching back ON clears it.
  M.setDisplayFlag(node, 'tag', false, true);
  ok('switching Tag off stores an explicit false', node.show && node.show.tag === false);
  ok('...and displayShown follows the explicit value', M.displayShown(pl, node, 'tag') === false);
  M.setDisplayFlag(node, 'tag', true, true);
  ok('switching it back on returns to the sparse default',
    !node.show && M.displayShown(pl, node, 'tag') === true);

  // A hydronic outflow has no default-ON tag — nothing changes for it.
  const hy = M.create();
  const hn = M.addNode(hy, hy.levels[0].id, 0, 0);
  M.setDemand(hy, hn.id, 0.001, 100000);
  const hnode = M.node(hy, hn.id);
  ok('a hydronic outflow has no default-ON flags',
    Object.keys(M.displayDefaults(hy, hnode)).length === 0);
  ok('...and its tag is not drawn by default', M.displayShown(hy, hnode, 'tag') === false);
}

// ---------------------------------------- regression: booster with no supply set
section('Regression — plumbing booster simulates with no supply outlets set');
{
  /* Michael, 2026-08-17 (debug/20260817-PLBG.json → test/fixtures): a sized
   * plumbing file with a booster pump reported PUMP_NO_FLOW in SIMULATE because
   * the fixtures had no 604.3 supply outlet, so every undiversified flow was
   * zero. The fixture DEFAULT now fills that in, so the pump has flow. */
  const raw = JSON.parse(fs.readFileSync(__dirname + '/fixtures/plumbing-booster.pnet.json', 'utf8'));
  const mb = M.fromJSON(raw);
  ok('the fixture file is a plumbing simulation', mb.discipline === 'plumbing' &&
     mb.settings.calcMode === 'simulation');
  const noSupply = mb.nodes.every(function (n) {
    return !(n.device && n.device.kind === 'demand') || !n.device.supply;
  });
  ok('...with no supply outlet set on any fixture (the trigger)', noSupply);

  // Replicate app.buildPlumbingSimModel: fixtures → K-terminals at their
  // undiversified 604.3 design point, solved by the real GGA (simulation mode).
  const sim = JSON.parse(JSON.stringify(mb));
  sim.settings.calcMode = 'simulation';
  let pushed = 0;
  sim.nodes.forEach(function (n) {
    const d = n.device;
    if (d && d.kind === 'demand' && d.demandType === 'plumbing') {
      const q = M.plumbingUndivFlow(mb, d);
      if (!(q > 0)) { d.include = false; return; }
      d.flow = q; d.reqPressure = Math.max(M.plumbingReqPressure(mb, d), M.MIN_OUTFLOW_PRESSURE);
      d.demandType = 'generic'; pushed++;
    }
  });
  ok('every fixture gets a (default) undiversified design point', pushed === 6, String(pushed));
  const res = FD.network.solveModel(sim);
  const pump = mb.pipes.filter(function (p) { return p.kind === 'pump'; })[0];
  ok('no PUMP_NO_FLOW warning', !(res.warnings || []).some(function (w) { return w.code === 'PUMP_NO_FLOW'; }),
     (res.warnings || []).map(function (w) { return w.code; }).join(','));
  ok('the pump now carries flow (was the bug: zero)', Math.abs(res.flow[pump.id]) > 0,
     String(res.flow[pump.id]));
}

function findNode(mm, x, y) {
  return mm.nodes.filter(function (n) { return n.x === x && n.y === y; })[0];
}

report();
