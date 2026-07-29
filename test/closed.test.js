/* FreePipeCalc — closed circuits, off pumps, equipment, tags.
 * Run:  node test/closed.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model, NET = FD.network;
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'examples', 'datacentre-ring.pnet.json');
const base = () => M.fromJSON(JSON.parse(fs.readFileSync(FILE, 'utf8')));
const code = (res, c) => (res.warnings || []).filter(w => w.code === c);
const pumps = m => m.pipes.filter(p => p.kind === 'pump');
const equip = m => m.pipes.find(p => p.kind === 'equip');

/* Smallest possible closed loop: pump + equipment + two pipes, no source. */
function tinyLoop(pumpMode) {
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 0.3, 0);
  const c = M.addNode(m, lv, 20, 0), d = M.addNode(m, lv, 20.3, 0);
  const pump = M.addPipe(m, a.id, b.id, {
    kind: 'pump', size: 'DN100', tag: 'P-01',
    pump: { mode: pumpMode || 'auto', head: 0, flow: 0 }
  });
  M.addPipe(m, b.id, c.id, { size: 'DN100' });
  const eq = M.addPipe(m, c.id, d.id, {
    kind: 'equip', size: 'DN100', tag: 'AHU-01',
    equip: { qRated: 0.010, pdRated: 150000, qOut: 0.010 }
  });
  M.addPipe(m, d.id, a.id, { size: 'DN100' });
  return { m, pump, eq };
}

section('Closed circuit gets a pressure datum');
{
  const { m, pump, eq } = tinyLoop();
  const res = NET.solveModel(m);

  ok('Solves', res.converged, JSON.stringify(res.errors));
  const w = code(res, 'NO_SOURCE');
  ok('NO_SOURCE error is raised', w.length === 1,
     JSON.stringify((res.warnings || []).map(x => x.code)));
  ok('...naming the pinned node', !!w[0].node);
  ok('...telling the engineer a water source is required',
     /Water source is required/.test(w[0].message), w[0].message);
  ok('...and mentioning the top up/expansion tank for closed loops',
     /top up\/expansion tank/.test(w[0].message));
  ok('...with a detail line explaining the temporary datum',
     /temporary pressure datum/.test(w[0].detail || ''), w[0].detail);

  /* Regression: with no datum the solver treated the loop as an island with no
   * source and quietly returned zero flow — a pumped circuit reported dead. */
  ok('Flow actually circulates', Math.abs(res.flow[pump.id]) > 1e-4,
     (res.flow[pump.id] * 1000).toFixed(2) + ' L/s');

  // The datum must not inject or remove water: net flow at that node is zero
  const bal = {};
  m.nodes.forEach(n => { bal[n.id] = 0; });
  res.network.links.forEach(l => { bal[l.from] -= res.flow[l.id]; bal[l.to] += res.flow[l.id]; });
  near('The datum node passes zero net flow', bal[w[0].node], 0, 1e-9);

  // An OPEN system with a real source must not get a datum
  const { m: m2 } = tinyLoop();
  M.setSource(m2, m2.nodes[0].id);
  const res2 = NET.solveModel(m2);
  ok('A circuit with a real source gets no synthetic datum',
     code(res2, 'NO_SOURCE').length === 0);

  // An unpumped dead leg is genuinely dead and must stay that way
  const m3 = M.create(), lv3 = m3.levels[0].id;
  const x = M.addNode(m3, lv3, 0, 0), y = M.addNode(m3, lv3, 10, 0);
  M.addPipe(m3, x.id, y.id, { size: 'DN50' });
  const res3 = NET.solveModel(m3);
  ok('An unpumped isolated run gets no datum', code(res3, 'NO_SOURCE').length === 0);
}

section('Closed circuit sizes the pump on FLOW, not pressure');
{
  const { m, pump, eq } = tinyLoop();
  const res = NET.solveModel(m);

  ok('Pump was sized from a standing start', pump.pump.head > 1,
     pump.pump.head.toFixed(2) + ' m');
  const q = Math.abs(res.flow[eq.id]);
  const target = eq.equip.qRated;

  /* The equipment must see its RATED flow. The safety factor is a selection
   * margin and must not change the hydraulics — when it did, a 10% head margin
   * pushed 21 L/s through equipment rated for 20 (spec Q12.11). */
  near('Equipment gets exactly its rated flow', q, target, target * 1e-3);
  near('...i.e. the ratio is 1.000', q / target, 1, 2e-3);

  // Equipment ΔP must follow the square law off its rating
  const link = res.network.links.find(l => l.id === eq.id);
  const dp = 998 * 9.81 * Math.abs(FD.hydraulics.headloss(link.r, q, link.n));
  near('Equipment ΔP = ΔP_rated × (Q/Q_rated)²',
       dp, eq.equip.pdRated * Math.pow(q / target, 2), 10);

  // Re-solving must be stable
  const h1 = pump.pump.head;
  NET.solveModel(m);
  near('Re-solving does not drift the head', pump.pump.head, h1, 0.01);

  /* A bigger machine needs more head — but not proportionally more. Raising
   * qRated while holding pdRated makes the equipment LESS resistive
   * (r = ΔP_rated/(ρg·Q_rated²)), so its own drop stays at the rating and only
   * the pipe friction grows. Assert the direction, not a made-up multiple. */
  const big = tinyLoop();
  big.eq.equip.qRated = 0.030;
  NET.solveModel(big.m);
  ok('Tripling the rated flow raises the sized head', big.pump.pump.head > h1,
     big.pump.pump.head.toFixed(2) + ' vs ' + h1.toFixed(2));
  near('Equipment drops exactly its rated ΔP at its rated flow',
       (() => {
         const r2 = NET.solveModel(big.m);
         const l = r2.network.links.find(x => x.id === big.eq.id);
         const q2 = Math.abs(r2.flow[big.eq.id]);
         return 998 * 9.81 * Math.abs(FD.hydraulics.headloss(l.r, q2, l.n));
       })(), big.eq.equip.pdRated, big.eq.equip.pdRated * 0.01);
}

section('An OFF pump is isolated, not an open pipe');
{
  const m = base();
  const ps = pumps(m);
  ok('Three of the four pumps are off',
     ps.filter(p => p.pump.mode === 'off').length === 3);

  const res = NET.solveModel(m);
  const running = ps.find(p => p.pump.mode !== 'off');
  const idle = ps.filter(p => p.pump.mode === 'off');

  idle.forEach(p => {
    ok(`${p.tag} passes essentially no flow`,
       Math.abs(res.flow[p.id]) < 1e-4,
       (res.flow[p.id] * 1000).toFixed(4) + ' L/s');
  });

  /* Regression: modelled as zero head, an idle pump is a frictionless bypass.
   * The running pump then short-circuits backwards through its neighbours —
   * 392 L/s round the pump hall to deliver 21 L/s to the load. */
  const eq = equip(m);
  const qPump = Math.abs(res.flow[running.id]);
  const qEquip = Math.abs(res.flow[eq.id]);
  ok('The running pump carries the circuit flow, not a short-circuit',
     Math.abs(qPump - qEquip) / qEquip < 0.05,
     `pump ${(qPump * 1000).toFixed(2)} vs equip ${(qEquip * 1000).toFixed(2)} L/s`);
  ok('...and that is nowhere near the old 392 L/s', qPump < 0.05);

  ok('An off pump is not reported as "doing nothing"',
     code(res, 'PUMP_NO_FLOW').length === 0,
     JSON.stringify(code(res, 'PUMP_NO_FLOW').map(w => w.pipe)));

  // Off pumps are not auto-sized
  idle.forEach(p => {
    near(`${p.tag} head stays at zero`, p.pump.head || 0, 0, 1e-12);
  });
}

section('Two pumps share the load');
{
  const m = base();
  const ps = pumps(m);
  ps[1].pump.mode = 'auto';
  ps[1].pump.head = 0;
  const res = NET.solveModel(m);

  const q1 = Math.abs(res.flow[ps[0].id]), q2 = Math.abs(res.flow[ps[1].id]);
  near('Both auto pumps are given the same head', ps[0].pump.head, ps[1].pump.head, 1e-9);
  /* Not an even split, and it should not be.
   *
   * The two pumps discharge into a common header, so one enters it through the
   * straight run and the other through a branch. A combining tee charges the
   * branch inflow more than the run inflow, so the branch-side pump meets more
   * resistance and carries less. Before combining tees charged their inlets at
   * all, this came out at a suspiciously exact 50/50.
   *
   * The expected direction is therefore uneven, with the imbalance bounded by
   * the extra 60 D the branch leg carries — a few metres of equivalent pipe on
   * DN100, so single-figure percent, not a landslide. */
  const share = q1 / (q1 + q2);
  ok('Neither pump is starved', share > 0.45 && share < 0.55,
     `${(q1 * 1000).toFixed(2)} / ${(q2 * 1000).toFixed(2)} L/s`);

  /* Nearly, but not exactly, even — and the direction is what matters.
   *
   * The two pumps discharge into a common header, so one enters through the
   * straight run and the other through a branch, which is the more lossy path.
   * The branch-side pump therefore carries slightly LESS.
   *
   * The imbalance is small (well under 1%) because a pump has droop: taking
   * more flow makes less head, which pushes flow back. That is the balancing
   * characteristic in solveModel() and it is physically representative — a real
   * pump curve is far steeper than the difference between a run and a branch
   * tee, so real parallel pumps do share nearly evenly. An earlier version of
   * this test expected several percent, which was measured when pumps were
   * modelled as fixed-head. A fixed-head pump has NO droop, so it cannot
   * compensate at all and the piping asymmetry shows up undamped and
   * exaggerated. */
  ok('The branch-side pump carries slightly less', share < 0.5, String(share));
  ok('...but only slightly, because a pump with droop self-compensates',
     0.5 - share < 0.02, String(share));

  const eq = equip(m);
  near('Combined flow still equals the circuit flow',
       q1 + q2, Math.abs(res.flow[eq.id]), 5e-5);

  /* Two pumps need slightly LESS head than one: each moves half the flow
   * through the pump-hall pipework, so the local losses fall. */
  const singleModel = base();
  NET.solveModel(singleModel);
  const singleHead = pumps(singleModel)[0].pump.head;
  ok('Two pumps need no more head than one',
     ps[0].pump.head <= singleHead + 1e-6,
     `two-pump ${ps[0].pump.head.toFixed(2)} m vs single ${singleHead.toFixed(2)} m`);
  ok('...and the difference is small (same circuit, same duty)',
     Math.abs(ps[0].pump.head - singleHead) / singleHead < 0.15);
}

section('Valves respond correctly in the ring');
{
  function ringValve(opening) {
    const m = base();
    const p30 = m.pipes.find(x => x.kind === 'pipe' &&
      Math.abs(M.pipeLength(m, x) - 30) < 0.01);
    p30.kind = 'valve';
    p30.valve = { type: 'gate', kv: FD.valves.defaultKv('gate', 102.26), opening };
    return { m, id: p30.id, res: NET.solveModel(m) };
  }

  const open = ringValve(100), shut = ringValve(0);
  ok('The 30 m ring section carries flow when open',
     Math.abs(open.res.flow[open.id]) > 1e-3,
     (open.res.flow[open.id] * 1000).toFixed(2) + ' L/s');
  ok('Shutting it stops flow through that section',
     Math.abs(shut.res.flow[shut.id]) < 1e-5,
     (shut.res.flow[shut.id] * 1000).toFixed(4) + ' L/s');

  /* The whole point of a ring main: losing one side must not lose the load. */
  const qOpen = Math.abs(open.res.flow[equip(open.m).id]);
  const qShut = Math.abs(shut.res.flow[equip(shut.m).id]);
  ok('Equipment keeps its flow — the ring reroutes',
     Math.abs(qOpen - qShut) / qOpen < 0.02,
     `${(qOpen * 1000).toFixed(2)} → ${(qShut * 1000).toFixed(2)} L/s`);
  ok('Shut valve is reported', code(shut.res, 'VALVE_SHUT').length === 1);
}

section('Throttling a pump shifts load to its partner');
{
  function pumpValve(opening) {
    const m = base();
    const ps = pumps(m);
    ps[1].pump.mode = 'auto'; ps[1].pump.head = 0;
    const p = M.pipesAt(m, ps[1].b).find(x => x.id !== ps[1].id);
    p.kind = 'valve';
    p.valve = { type: 'gate', kv: FD.valves.defaultKv('gate', 102.26), opening };
    return { m, ps: pumps(m), res: NET.solveModel(m) };
  }

  const full = pumpValve(100), quarter = pumpValve(25), shut = pumpValve(0);
  const f = r => [Math.abs(r.res.flow[r.ps[0].id]), Math.abs(r.res.flow[r.ps[1].id])];
  const [a1, a2] = f(full), [b1, b2] = f(quarter), [c1, c2] = f(shut);

  ok('Throttling P02 to 25% reduces its flow', b2 < a2,
     `${(a2 * 1000).toFixed(2)} → ${(b2 * 1000).toFixed(2)} L/s`);
  ok('...and P01 picks up the slack', b1 > a1,
     `${(a1 * 1000).toFixed(2)} → ${(b1 * 1000).toFixed(2)} L/s`);
  ok('Shutting P02 stops it completely', c2 < 1e-5,
     (c2 * 1000).toFixed(4) + ' L/s');
  ok('...and P01 carries the whole circuit', c1 > 0.019,
     (c1 * 1000).toFixed(2) + ' L/s');

  const eqFlows = [full, quarter, shut].map(r => Math.abs(r.res.flow[equip(r.m).id]));
  ok('Equipment flow is maintained throughout',
     eqFlows.every(q => Math.abs(q - eqFlows[0]) / eqFlows[0] < 0.02),
     eqFlows.map(q => (q * 1000).toFixed(2)).join(', '));
}

section('Equipment tags');
{
  const m = base();
  const eq = equip(m);
  ok('Equipment carries a tag', eq.tag === 'CRAH-01', String(eq.tag));
  ok('Pumps carry tags', pumps(m).every(p => /^CHW-P-0\d$/.test(p.tag)),
     pumps(m).map(p => p.tag).join(','));

  // tags survive a save/load round trip
  const back = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m))));
  ok('Tags survive save/load',
     equip(back).tag === 'CRAH-01' && pumps(back)[0].tag === 'CHW-P-01');

  // a pipe with no tag stays untagged rather than gaining an empty one
  const plain = m.pipes.find(p => p.kind === 'pipe');
  ok('Plain pipes have no tag property', plain.tag === undefined);
}

report();
