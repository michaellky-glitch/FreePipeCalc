/* FreePipeCalc — supply adequacy, pump auto-sizing, pressure-driven delivery.
 * Run:  node test/supply.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model, NET = FD.network;
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'examples', '3-floor-riser-test.pnet.json');
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
   * 21 L/s through equipment rated for 20 (see spec Q12.11). */
  near('...to the index duty at design flow', pump.pump.head, 41.76, 0.1);
  near('Selection duty applies the margin on top',
       pump.pump.head * (1 + m.settings.pumpSafetyPct / 100), 45.94, 0.15);
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
  ok('...and reading "Source is insufficient for demand"',
     /Source is insufficient for demand/.test(w[0].message), w[0].message);
  ok('...listing every unmet demand', w[0].nodes.length === 5, JSON.stringify(w[0].nodes));
}

section('Pressure-driven delivery — what the system actually supplies');
{
  const m = base();
  irrational(m);
  const res = NET.solveModel(m);

  ok('An actual-delivery result is produced', !!res.actual);
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
            .every(n => res.pressure[n.id] < 0));
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
  ok('No pressure-driven fallback needed (everything is met)', !res.actual);

  near('Pump carries the whole demand', Math.abs(res.flow[pump.id]), 0.1, 1e-9);
  near('Pump sized to the index duty at design flow', pump.pump.head, 41.76, 0.1);

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

report();
