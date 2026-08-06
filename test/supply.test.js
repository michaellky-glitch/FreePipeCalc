/* FreePipeCalc — supply adequacy, pump auto-sizing, pressure-driven delivery.
 * Run:  node test/supply.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model, NET = FD.network;
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'fixtures', '3-floor-riser-test.pnet.json');
const base = () => M.fromJSON(JSON.parse(fs.readFileSync(FILE, 'utf8')));

/* Move the source from L1 to L3 on a 10 m pipe into the riser node, leaving
 * the pump on L1 with nothing upstream of it. */
function irrational(m) {
  const src = m.nodes.find(n => n.device && n.device.kind === 'source');
  M.removeNode(m, src.id);
  const L3 = m.levels.find(l => l.name === 'Level 3');
  const riser3 = m.nodes.find(n => n.level === L3.id && n.x === -2 && n.y === 10);
  const ns = M.addNode(m, L3.id, -12, 10);
  M.addPipe(m, ns.id, riser3.id, { size: 'DN100', schedule: 'sch40' });
  M.setSource(m, ns.id);
  return ns;
}

const code = (res, c) => (res.warnings || []).filter(w => w.code === c);

section('Pump auto-sizes on every solve');
{
  const m = base();
  const pump = m.pipes.find(p => p.kind === 'pump');
  pump.pump.mode = 'auto';
  pump.pump.head = 0;                       // deliberately wrong

  const res = NET.solveModel(m);
  ok('Solve raised the head by itself', pump.pump.head > 1, pump.pump.head.toFixed(2));
  /* The solved head is the HYDRAULIC duty at design flow. The safety factor is
   * a selection margin reported separately — baking it into the solve pushed
   * 21 L/s through equipment rated for 20 (see spec Q12.11).
   *
   * 41.76 -> 41.95 on 2026-08-02, from the bullhead-tee fix. This model has
   * three ring-main supply tees, and one leg of each was charged as a run
   * (K = 0.9) rather than a branch (K = 1.1). The three legs that changed carry
   * 1.30, 2.69 and 2.69 m/s, so the extra 0.2 velocity heads are 0.017, 0.074
   * and 0.074 m — 0.165 m in total against a 0.197 m rise in duty, the
   * remainder being the flow redistribution that follows.
   *
   * Then the equivalent-length basis changed three times in one day, and the
   * duty went 41.95 -> 39.49 -> 41.92 -> 41.96 m. The whole excursion is under
   * 6%, and it ends 0.01 m from where the old L/D ratios had it:
   *
   *   39.49  NFPA 13, straight-through tee row blank and charging nothing
   *   41.92  NFPA 13 + the Carrier straight-through row
   *   41.96  all Carrier (the default set from v0.8.4)
   *
   * The last step is small because Carrier's elbows and branches sit only a
   * little above NFPA's — 3.05 against 3.0 m for a DN100 elbow, 6.40 against
   * 6.1 for a branch — and this model's 13 elbows and 8 branches add about
   * 3 m of equivalent length against ~340 m of pipe.
   *
   * That three published sources land within 1% of each other, and of the L/D
   * basis they replaced, is the useful fact here. RECORDED, not hand
   * calculated; the agreement is the check.
   *
   * 41.96 -> 41.99 at v0.9.0, when the two Hazen-Williams entries were
   * collapsed into one. The survivor derives its flow-form constants from the
   * printed velocity form (A = 6.819(4/pi)^1.852 = 10.6663) where the retired
   * one carried the rounded published 10.67. 0.035% on the constant, 0.08% on
   * the duty — the rounding baked into 10.67, and nothing else. */
  near('...to the index duty at design flow', pump.pump.head, 41.99, 0.05);
  near('Selection duty applies the margin on top',
       pump.pump.head * (1 + m.settings.pumpSafetyPct / 100), 46.19, 0.08);
  ok('Every demand is met', !res.actual, res.actual ? JSON.stringify(res.actual.unmet) : 'met');

  // Re-solving must be stable, not creep upward each time
  const h1 = pump.pump.head;
  NET.solveModel(m);
  const h2 = pump.pump.head;
  NET.solveModel(m);
  ok('Repeated solves do not inflate the head',
     Math.abs(h2 - h1) < 0.01 && Math.abs(pump.pump.head - h1) < 0.01,
     `${h1.toFixed(3)} → ${h2.toFixed(3)} → ${pump.pump.head.toFixed(3)}`);

  // It must also come DOWN when the duty falls
  m.nodes.forEach(n => {
    if (n.device && n.device.kind === 'demand') n.device.flow = 0.002;
  });
  pump.pump.head = 0;
  NET.solveModel(m);
  ok('A lighter load sizes to a much smaller head', pump.pump.head < h1 / 2,
     pump.pump.head.toFixed(2) + ' vs ' + h1.toFixed(2));

  // Fixed-mode pumps are left alone
  const m2 = base();
  const p2 = m2.pipes.find(p => p.kind === 'pump');
  p2.pump.mode = 'fixed';
  p2.pump.head = 5;
  NET.solveModel(m2);
  near('A fixed pump is not resized', p2.pump.head, 5, 1e-12);
}

section('Dead-ended pump is reported and not wound up');
{
  const m = base();
  irrational(m);
  const pump = m.pipes.find(p => p.kind === 'pump');
  pump.pump.mode = 'auto';
  const headBefore = pump.pump.head;

  const res = NET.solveModel(m);
  ok('Pump carries no flow', Math.abs(res.flow[pump.id]) < 1e-9,
     String(res.flow[pump.id]));
  const w = code(res, 'PUMP_DEAD_END');
  ok('PUMP_DEAD_END is raised', w.length === 1, JSON.stringify((res.warnings || []).map(x => x.code)));
  ok('...naming the dead-end node', !!w[0].node, JSON.stringify(w[0]));
  ok('...and explaining it does nothing', /nothing can pass/.test(w[0].message));

  /* Regression: the auto-sizer used to wind a disconnected pump up to 65 m
   * before giving up, stamping a fictitious duty on the model. */
  near('Head was not inflated by the auto-sizer', pump.pump.head, headBefore, 1e-9);
}

section('Supply insufficient — source level with its demands');
{
  const m = base();
  const src = irrational(m);
  const res = NET.solveModel(m);

  const w = code(res, 'SUPPLY_INSUFFICIENT');
  ok('SUPPLY_INSUFFICIENT is raised', w.length === 1);
  ok('...naming the source to highlight', w[0].sources.indexOf(src.id) >= 0,
     JSON.stringify(w[0].sources));
  ok('...carrying the shortfall in Pa', w[0].worstShortPa > 1e5,
     (w[0].worstShortPa / 1000).toFixed(1) + ' kPa');
  ok('...and reading "Source is insufficient for outflow"',
     /Source is insufficient for outflow/.test(w[0].message), w[0].message);
  ok('...listing every unmet demand', w[0].nodes.length === 5, JSON.stringify(w[0].nodes));
}

section('Pressure-driven delivery — what the system actually supplies');
{
  const m = base();
  irrational(m);
  const solved = NET.solveModel(m);
  /* CALLED DIRECTLY from 2026-08-06. `res.actual` is no longer wired into the
   * solve: it was a DESIGN-only number and Michael asked for DESIGN to stop
   * answering SIMULATION's question. The pass itself is sound and this gravity
   * case is the best test of it there is, so it keeps its coverage. */
  const res = { actual: NET.actualDelivery(m, solved.network, solved) };

  ok('An actual-delivery result is produced', !!res.actual);
  ok('...but the solve no longer reports one', solved.actual === null,
     JSON.stringify(solved.actual));
  const L3 = m.levels.find(l => l.name === 'Level 3');
  const L1 = m.levels.find(l => l.name === 'Level 1');
  const l3d = m.nodes.filter(n => n.level === L3.id && n.device && n.device.kind === 'demand');
  const l1d = m.nodes.filter(n => n.level === L1.id && n.device && n.device.kind === 'demand');

  /* The source sits at 10 m and so do the L3 terminals: no static head to
   * drive them, and friction can only subtract. They must get nothing. */
  l3d.forEach(n => {
    near(`L3 demand ${n.id} delivers nothing (level with the source)`,
         res.actual.flow[n.id], 0, 1e-9);
  });
  l1d.forEach(n => {
    near(`L1 demand ${n.id} is gravity-fed in full`,
         res.actual.flow[n.id], n.device.flow, 1e-9);
  });

  ok('Total delivered is less than total demanded',
     res.actual.totalDelivered < res.actual.totalDemanded,
     `${(res.actual.totalDelivered * 1000).toFixed(2)} of ${(res.actual.totalDemanded * 1000).toFixed(2)} L/s`);
  near('Total demanded is 100 L/s', res.actual.totalDemanded, 0.1, 1e-12);
  ok('Delivered is a sane fraction, not zero and not everything',
     res.actual.totalDelivered > 0.03 && res.actual.totalDelivered < 0.06,
     (res.actual.totalDelivered * 1000).toFixed(2) + ' L/s');

  // No terminal may deliver more than it asked for, or a negative flow
  m.nodes.filter(n => n.device && n.device.kind === 'demand').forEach(n => {
    const got = res.actual.flow[n.id];
    ok(`${n.id} delivers between 0 and its nominal flow`,
       got >= -1e-12 && got <= n.device.flow + 1e-9,
       (got * 1000).toFixed(3) + ' L/s');
  });

  // Throttled terminals sit at exactly their required pressure
  res.actual.unmet.forEach(id => {
    const n = M.node(m, id);
    near(`${id} sits at its required pressure once throttled`,
         res.actual.pressure[id], n.device.reqPressure || 0, 1);
  });

  // The demand-driven pressures are untouched by the extra pass
  ok('Demand-driven pressures still show the shortfall',
     m.nodes.filter(n => n.device && n.device.kind === 'demand')
            .every(n => solved.pressure[n.id] < 0));
}

section('Restoring the source to L1 fixes everything');
{
  const m = base();                         // the original, unmodified model
  const pump = m.pipes.find(p => p.kind === 'pump');
  pump.pump.mode = 'auto';
  pump.pump.head = 0;

  const res = NET.solveModel(m);
  ok('Solves cleanly', res.ok, JSON.stringify(res.errors));
  ok('No supply-insufficient warning', code(res, 'SUPPLY_INSUFFICIENT').length === 0);
  ok('No dead-end pump warning', code(res, 'PUMP_DEAD_END').length === 0);
  /* The solve reports no `actual` at all now — see the note above. What matters
   * here is that nothing is short in the first place. */
  ok('The solve reports no pressure-driven fallback', !res.actual);
  ok('...and nothing is short anyway',
     m.nodes.filter(n => n.device && n.device.kind === 'demand')
            .every(n => res.pressure[n.id] >= -1));

  near('Pump carries the whole demand', Math.abs(res.flow[pump.id]), 0.1, 1e-9);
  near('Pump sized to the index duty at design flow', pump.pump.head, 41.99, 0.05);

  m.nodes.filter(n => n.device && n.device.kind === 'demand').forEach(n => {
    ok(`${n.id} meets its requirement`,
       res.pressure[n.id] >= (n.device.reqPressure || 0) - 1,
       (res.pressure[n.id] / 1000).toFixed(1) + ' kPa');
  });
}

section('A healthy system pays nothing for these checks');
{
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 30, 0);
  a.dz = 40;
  M.addPipe(m, a.id, b.id, { size: 'DN100' });
  M.setSource(m, a.id);
  M.setDemand(m, b.id, 0.010, 0);

  const res = NET.solveModel(m);
  ok('No actual-delivery pass runs when all demands are met', res.actual === null);
  ok('No supply warnings', code(res, 'SUPPLY_INSUFFICIENT').length === 0);
  ok('No pump sizing attempted when there are no pumps',
     res.pumpSizing && res.pumpSizing.resolved === false);
}

section('Safety factor is a reported margin, never part of the solve');
{
  near('Default safety factor is 0', M.defaultSettings().pumpSafetyPct, 0, 1e-12);

  /* The factor must not touch flows, friction or pressures — only the duty
   * figure quoted for pump selection. Otherwise it compounds with the margins
   * already sitting in the C factor, fitting allowances and equipment ratings. */
  function solveAt(pct) {
    const m = base();
    m.settings.pumpSafetyPct = pct;
    const pump = m.pipes.find(p => p.kind === 'pump');
    pump.pump.mode = 'auto'; pump.pump.head = 0;
    const res = NET.solveModel(m);
    return { m, res, pump,
             flows: res.network.links.map(l => res.flow[l.id]),
             press: m.nodes.map(n => res.pressure[n.id]) };
  }
  const a = solveAt(0), b = solveAt(10), c = solveAt(50);

  near('Head required is identical at 0% and 10%', b.pump.pump.head, a.pump.pump.head, 1e-9);
  near('...and at 50%', c.pump.pump.head, a.pump.pump.head, 1e-9);
  ok('Every flow is identical regardless of the factor',
     a.flows.every((q, i) => Math.abs(q - b.flows[i]) < 1e-12 &&
                             Math.abs(q - c.flows[i]) < 1e-12));
  ok('Every pressure is identical regardless of the factor',
     a.press.every((p, i) => Math.abs(p - b.press[i]) < 1e-9 &&
                             Math.abs(p - c.press[i]) < 1e-9));

  // ...and the selection duty does scale, at the pump only
  near('Selection duty at 10% is head × 1.10',
       b.pump.pump.head * 1.10, a.pump.pump.head * 1.10, 1e-9);
  ok('Selection duty exceeds the hydraulic duty when a margin is set',
     b.pump.pump.head * 1.10 > b.pump.pump.head);
}

section('Critical path — the hydraulically most unfavourable route');
{
  const m = base();
  const res = NET.solveModel(m);
  const ix = res.critical;
  ok('A critical path is identified', !!ix);

  /* It must be the WORST-OFF terminal, not simply the most distant. */
  let worst = null;
  m.nodes.forEach(n => {
    if (!n.device || n.device.kind !== 'demand') return;
    const resid = res.pressure[n.id] - (n.device.reqPressure || 0);
    if (!worst || resid < worst.r) worst = { id: n.id, r: resid };
  });
  ok('Critical terminal is the demand with the smallest residual',
     ix.target === worst.id, `${ix.target} vs ${worst.id}`);

  /* The path must reach a FIXED-HEAD node, not stop at the pump — otherwise
   * the suction-side friction is missing and the tally cannot reconcile with
   * the pump duty. */
  const origin = M.node(m, ix.origin);
  ok('Path terminates at the source', !!(origin.device && origin.device.kind === 'source'),
     ix.origin);

  const pump = m.pipes.find(p => p.kind === 'pump');
  near('friction + static reconciles with the pump duty',
       ix.frictionHead + ix.staticHead, pump.pump.head, 0.01);
  near('Residual at the critical terminal is zero (that is what makes it critical)',
       ix.residual, 0, 50);

  // path continuity: each section starts where the previous ended
  let broken = null;
  ix.sections.forEach((sec, i) => {
    if (i && ix.sections[i - 1].to !== sec.from) broken = i;
  });
  ok('Path is continuous end to end', broken === null, 'break at ' + broken);
  ok('Path ends at the critical terminal',
     ix.sections[ix.sections.length - 1].to === ix.target);
  ok('Path starts at the origin', ix.sections[0].from === ix.origin);

  // every section must be a real link carrying flow
  ok('Every critical section is a real link',
     ix.sections.every(sec => res.network.links.some(l => l.id === sec.link)));
}

section('Auto-sizing converges from ABOVE as well as below');
{
  /* Regression: sizing only ever ADDED head, so a model saved with an oversized
   * pump kept it forever — which is not what 'auto' means. */
  const m = base();
  const pump = m.pipes.find(p => p.kind === 'pump');
  pump.pump.mode = 'auto';
  pump.pump.head = 0;
  NET.solveModel(m);
  const correct = pump.pump.head;

  pump.pump.head = correct * 3;            // grossly oversized
  NET.solveModel(m);
  near('An oversized auto pump is brought back down', pump.pump.head, correct, 0.05);

  pump.pump.head = correct / 4;            // grossly undersized
  NET.solveModel(m);
  near('An undersized auto pump is brought up', pump.pump.head, correct, 0.05);
}

section('Critical path works for every kind of open loop');
{
  // (a) gravity fed, no pump: the HIGHER demand is worse off, not the further one
  const g = M.create(), lv = g.levels[0].id;
  const tank = M.addNode(g, lv, 0, 0); tank.dz = 30;
  const j = M.addNode(g, lv, 20, 0);
  const low = M.addNode(g, lv, 40, 0);            // far, but low
  const high = M.addNode(g, lv, 20, 25); high.dz = 12;   // near, but high
  M.addPipe(g, tank.id, j.id, { size: 'DN100' });
  M.addPipe(g, j.id, low.id, { size: 'DN80' });
  M.addPipe(g, j.id, high.id, { size: 'DN50' });
  M.setSource(g, tank.id);
  M.setDemand(g, low.id, 0.006, 50000);
  M.setDemand(g, high.id, 0.006, 50000);

  const rg = NET.solveModel(g);
  ok('Gravity system with no pump still yields a critical path', !!rg.critical);
  ok('...ending at the HIGHER demand, not the more distant one',
     rg.critical.target === high.id,
     `${rg.critical.target} (high=${high.id}, low=${low.id})`);
  ok('...starting at the source', rg.critical.origin === tank.id);
  ok('...with no pump gain', Math.abs(rg.critical.pumpHead) < 1e-12);
  ok('Static is negative going downhill from the tank', rg.critical.staticHead < 0,
     rg.critical.staticHead.toFixed(2) + ' m');

  // available = static gain − friction; check it reconciles
  const RG = 998 * 9.81;
  const predicted = (-rg.critical.staticHead - rg.critical.frictionHead) * RG;
  near('Available pressure reconciles with static − friction',
       rg.pressure[high.id], predicted, 50);

  // (b) two sources
  const t = M.create(), lv2 = t.levels[0].id;
  const s1 = M.addNode(t, lv2, 0, 0); s1.dz = 25;
  const s2 = M.addNode(t, lv2, 60, 0); s2.dz = 25;
  const d = M.addNode(t, lv2, 30, 0);
  M.addPipe(t, s1.id, d.id, { size: 'DN80' });
  M.addPipe(t, s2.id, d.id, { size: 'DN80' });
  M.setSource(t, s1.id); M.setSource(t, s2.id);
  M.setDemand(t, d.id, 0.010, 0);
  const rt = NET.solveModel(t);
  ok('Two-source open loop yields a critical path', !!rt.critical);
  ok('...originating at one of the sources',
     rt.critical.origin === s1.id || rt.critical.origin === s2.id);
  ok('...and ending at the demand', rt.critical.target === d.id);
}

section('Open / closed detection');
{
  const open = base();
  ok('Pumped system with a source reads OPEN',
     NET.detectSystemType(open).type === 'open');

  const closed = M.fromJSON(JSON.parse(
    require('fs').readFileSync(
      require('path').join(__dirname, 'fixtures', 'datacentre-ring.pnet.json'), 'utf8')));
  ok('Sealed pumped circuit reads CLOSED',
     NET.detectSystemType(closed).type === 'closed');
  ok('...and says why', /fill\/expansion/.test(NET.detectSystemType(closed).reason));

  const empty = M.create();
  ok('Nothing drawn reads as no supply',
     NET.detectSystemType(empty).type === 'none');

  /* Adding a source to a sealed circuit does NOT make it open.
   *
   * This assertion used to expect OPEN, on the rule "any source ⇒ open". That
   * is wrong, and Michael reported it against the datacentre model: bolting an
   * expansion vessel onto a chilled-water circuit is the NORMAL arrangement,
   * and the circuit is still closed — the tank sets the pressure reference and
   * nothing draws water off. What makes a system open is mass LEAVING it, so
   * the discriminator is an outflow, not a source. Changed 2026-07-30. */
  const flip = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(closed))));
  const pump = flip.pipes.find(p => p.kind === 'pump');
  M.setSource(flip, pump.a);
  ok('A source on a circuit with no outflow stays CLOSED',
     NET.detectSystemType(flip).type === 'closed',
     NET.detectSystemType(flip).type);
  ok('...and says the source is the fill/expansion connection',
     /fill\/expansion/.test(NET.detectSystemType(flip).reason));

  // An OUTFLOW is what actually makes it open: mass now leaves the system.
  const withOutflow = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(flip))));
  const far = withOutflow.nodes.find(n => !n.device);
  M.setDemand(withOutflow, far.id, 0.001, 100000);
  ok('Adding an outflow flips it to OPEN',
     NET.detectSystemType(withOutflow).type === 'open',
     NET.detectSystemType(withOutflow).type);

  /* An excluded outflow must not count — it is not drawing anything. */
  const excluded = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(withOutflow))));
  excluded.nodes.forEach(n => {
    if (n.device && n.device.kind === 'demand') n.device.include = false;
  });
  ok('An excluded outflow does not make it open',
     NET.detectSystemType(excluded).type === 'closed',
     NET.detectSystemType(excluded).type);

  // switching every pump off removes the drive
  const allOff = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(closed))));
  allOff.pipes.forEach(p => { if (p.kind === 'pump') p.pump.mode = 'off'; });
  ok('All pumps off and no source reads as no supply',
     NET.detectSystemType(allOff).type === 'none');
}

/* --------------------------------------------------------------------------
 * EQUIPMENT FAR OFF ITS RATING — the diagnosis missing from debug/20260803-1
 *
 * Equipment carries a fixed characteristic r = ΔP_rated/(ρg·Q_rated²), so its
 * pressure drop goes as the SQUARE of how far the flow sits from the rating.
 *
 * Michael's model sized a pump to 12 791 m — 1252 bar — and nothing said why.
 * The cause was an AHU rated 0.8 L/s at 200 kPa carrying 20 L/s:
 *
 *     r     = 200 000 / (998 × 9.81 × 0.0008²) = 3.1919e7  m/(m³/s)²
 *     h     = r·Q²  = 3.1919e7 × 0.020²        = 12 767.6 m
 *     ratio = 0.020 / 0.0008 = 25×,  and 25² = 625× the rated 200 kPa
 *
 * 12 767.6 of the 12 791 m — 99.8% of the pump duty — was that one machine.
 * The arithmetic was right; the app simply never mentioned it.
 * ----------------------------------------------------------------------- */
section('Equipment carrying far more than its rating is called out');
{
  const RHO = 998, G = 9.81;

  function rig(qRated) {
    const m = M.create();
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0), d = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 0);
    d.device = { kind: 'demand', flow: 0.020, reqPressure: 100e3, include: true };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const eq = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    eq.tag = 'AHU-1';
    eq.equip = { qRated: qRated, pdRated: 200e3, equipType: 'exchanger', duty: 50000 };
    M.addPipe(m, c.id, d.id, { size: 'DN100', schedule: 'sch40' });
    return { m, pump, eq };
  }

  // The hand figures above, independent of anything the app computes.
  const r = 200e3 / (RHO * G * 0.0008 * 0.0008);
  near('AHU resistance from its own design point', r, 3.1919e7, 1e4);
  near('...gives 12 767.6 m at 20 L/s', r * 0.020 * 0.020, 12767.6, 0.5);

  {
    const t = rig(0.0008);                       // 25× under-rated, as saved
    const res = NET.solveModel(t.m);
    const w = res.warnings.filter(x => x.code === 'EQUIP_OFF_RATING')[0];
    ok('EQUIP_OFF_RATING is raised', !!w,
       JSON.stringify(res.warnings.map(x => x.code)));
    near('...with the ratio it actually ran at', w && w.ratio, 25, 0.1);
    ok('...naming the machine and both flows', !!w &&
       /AHU-1/.test(w.message) && /0\.80 L\/s/.test(w.message) &&
       /20\.00 L\/s/.test(w.message), w && w.message);
    ok('...and the pressure drop that follows from it',
       !!w && /125000 kPa/.test(w.message), w && w.message);

    /* The pump duty really is dominated by that one machine — which is the
     * whole point of the warning. */
    const h = t.pump.pump.head;
    ok('The sized head is in the thousands of metres', h > 12000 && h < 13500,
       h.toFixed(1) + ' m');
    ok('...and the AHU accounts for essentially all of it',
       (r * 0.020 * 0.020) / h > 0.99, ((r * 0.02 * 0.02) / h).toFixed(4));
  }

  {
    // Correctly rated, so nothing to say, and a sane duty.
    const t = rig(0.020);
    const res = NET.solveModel(t.m);
    ok('A machine at its rating raises nothing',
       !res.warnings.some(x => x.code === 'EQUIP_OFF_RATING'));
    ok('...and the pump duty is ordinary', t.pump.pump.head < 60,
       t.pump.pump.head.toFixed(2) + ' m');
  }

  {
    // Under-flow is called out too: 4x under is 1/16 of the rated drop.
    const t = rig(0.100);
    const res = NET.solveModel(t.m);
    const w = res.warnings.filter(x => x.code === 'EQUIP_OFF_RATING')[0];
    ok('Running well UNDER the rating is called out as well', !!w);
    ok('...and reads as a fraction rather than a multiple',
       !!w && /1\/5\.0 its rating/.test(w.message), w && w.message);
  }

  {
    // The threshold is a setting, like velocity and friction rate.
    const t = rig(0.0008);
    t.m.settings.warn.equipFlowRatio = 0;
    const res = NET.solveModel(t.m);
    ok('Zero disables the check',
       !res.warnings.some(x => x.code === 'EQUIP_OFF_RATING'));
  }
}

/* --------------------------------------------------------------------------
 * THE PRESSURE PLAUSIBILITY GUARD
 *
 * The thermal runaway guard's reasoning, applied to pressure: the solve is
 * exact, but a correct answer can still be absurd, and reporting 1252 bar as
 * though it were a result is worse than refusing.
 *
 * `debug/20260803-1.json` did exactly that — converged: true, no errors, and a
 * pump duty of 12 791 m. EQUIP_OFF_RATING named the cause from v0.11.2, but a
 * warning under a plausible-looking figure is the wrong shape of response to a
 * system nobody will build.
 * ----------------------------------------------------------------------- */
section('A pressure nothing will be built to is an error, not a result');
{
  function rig(qRated, limit) {
    const m = M.create();
    if (limit !== undefined) m.settings.warn.maxComponentPD = limit;
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0), d = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 0);
    d.device = { kind: 'demand', flow: 0.020, reqPressure: 100e3, include: true };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const eq = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    eq.tag = 'AHU-1';
    eq.equip = { qRated: qRated, pdRated: 200e3, equipType: 'exchanger', duty: 50000 };
    M.addPipe(m, c.id, d.id, { size: 'DN100', schedule: 'sch40' });
    return { m, pump, eq, res: NET.solveModel(m) };
  }

  {
    const t = rig(0.0008);                       // the debug model's ratio
    ok('It refuses to report the answer as converged', t.res.converged === false);
    const e = (t.res.errors || []).filter(x => x.code === 'PRESSURE_IMPLAUSIBLE')[0];
    ok('PRESSURE_IMPLAUSIBLE is raised', !!e,
       JSON.stringify((t.res.errors || []).map(x => x.code)));
    ok('...quoting the pressure in bar as well as kPa',
       !!e && /bar/.test(e.message), e && e.message);
    ok('...and saying the arithmetic is right, the model is not',
       !!e && /arithmetic is right/.test(e.message));
    ok('The numbers are still reported, not hidden',
       Math.abs(t.res.flow[t.eq.id]) > 0);
    ok('EQUIP_OFF_RATING still names the cause beside it',
       (t.res.warnings || []).some(w => w.code === 'EQUIP_OFF_RATING'));
  }

  {
    const t = rig(0.020);                        // correctly rated
    ok('An ordinary model raises nothing', t.res.converged === true,
       JSON.stringify(t.res.errors));
    ok('...and no implausible-pressure error',
       !(t.res.errors || []).some(x => x.code === 'PRESSURE_IMPLAUSIBLE'));
  }

  {
    // The band is adjustable, and it has to be — a fire main runs high.
    const t = rig(0.0008, 0);
    ok('Zero disables the guard',
       !(t.res.errors || []).some(x => x.code === 'PRESSURE_IMPLAUSIBLE'));
  }
  {
    const t = rig(0.020, 50e3);                  // absurdly tight limit
    ok('A tighter band catches an otherwise ordinary model',
       (t.res.errors || []).some(x => x.code === 'PRESSURE_IMPLAUSIBLE'));
  }

  /* A SHUT VALVE IS NOT AN IMPLAUSIBLE SYSTEM. CLOSED_R is a numerical device
   * for "no path through here", not a claim about a pressure — and a standby
   * leg behind a closed valve is an ordinary thing to draw. */
  {
    const m = M.create();
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0), d = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 400e3);
    d.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
    const v = M.addPipe(m, b.id, c.id, { kind: 'valve' });
    v.valve = { type: 'gate', kv: 100, opening: 0 };
    M.addPipe(m, c.id, d.id, { size: 'DN50', schedule: 'sch40' });
    const res = NET.solveModel(m);
    ok('A shut valve does not trip the pressure guard',
       !(res.errors || []).some(x => x.code === 'PRESSURE_IMPLAUSIBLE'),
       JSON.stringify((res.errors || []).map(x => x.code)));
    ok('...and it is still reported as shut',
       (res.warnings || []).some(w => w.code === 'VALVE_SHUT'));
  }
}

report();
