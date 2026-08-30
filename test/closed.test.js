/* FreePipeCalc — closed circuits, off pumps, equipment, tags.
 * Run:  node test/closed.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model, NET = FD.network;
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'fixtures', 'datacentre-ring.pnet.json');
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
  ok('...kept terse, per docs/MESSAGES.md',
     w[0].message === 'Water source is required.', w[0].message);
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

/* --------------------------------------------------------------------------
 * THE LOADS SET THE FLOW, NOT THE PLANT  (Michael, 2026-08-04)
 *
 * A heat exchanger states the flow it needs to move its duty — that is a demand
 * on the circuit. A source/sink's rated flow is a SELECTION figure: what the
 * machine was bought for, and plant is routinely selected larger than the load
 * it serves today.
 *
 * `debug/20260804-1.json`: a 100 kW chiller rated 1.6 L/s beside a 50 kW coil
 * rated 0.798 L/s — a chiller deliberately picked to run at half load. Sizing
 * on the largest rating drove 1.6 L/s through the coil:
 *
 *     ratio  = 1.600 / 0.798 = 2.006
 *     ΔP     = 200 × 2.006²  = 805 kPa   against a rated 200
 *     duty   = 102.7 m
 *
 * Sized on the coil, the chiller passes 0.798 L/s and drops
 *
 *     200 × (0.798/1.600)² = 200 × 0.2487 = 49.7 kPa
 *
 * which is the square law and needed no code: equipment has always been r·Q²
 * from its own design point. The duty falls to 25.5 m.
 * ----------------------------------------------------------------------- */
section('A closed circuit is sized on its loads, not on its plant');
{
  const RHO = 998, G = 9.81;

  function loop(opts) {
    opts = opts || {};
    const m = M.create();
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 5; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.tag = 'AHU-1';
    coil.equip = { qRated: opts.coil, pdRated: 200e3,
                   equipType: 'exchanger', duty: 50000 };
    const chiller = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    chiller.tag = 'ACCH-01';
    chiller.equip = { qRated: opts.plant, pdRated: 200e3, equipType: 'source',
                      tSet: 20, qMax: -100000 };
    /* Short, wide pipework so the equipment dominates and the hand figures
     * below are recognisable in the answer. */
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN150', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN150', schedule: 'sch40' });
    const res = NET.solveModel(m);
    return { m, pump, coil, chiller, res };
  }

  const t = loop({ coil: 0.000798, plant: 0.0016 });

  ok('The duty was sized on flow, in a circuit with no outflows',
     t.res.pumpSizing.mode === 'flow');
  ok('...and it names the machine it sized on', 
     JSON.stringify(t.res.pumpSizing.sizedOn) === '["AHU-1"]',
     JSON.stringify(t.res.pumpSizing.sizedOn));

  near('The COIL gets its rated flow', Math.abs(t.res.flow[t.coil.id]),
       0.000798, 0.000798 * 2e-3);
  near('...and the plant runs at half load, which is what it was selected for',
       Math.abs(t.res.flow[t.chiller.id]) / 0.0016, 0.4988, 2e-3);

  /* The square law on the plant, by hand: 200 kPa × (0.798/1.6)². */
  {
    const link = t.res.network.links.filter(l => l.id === t.chiller.id)[0];
    const pd = RHO * G * Math.abs(FD.hydraulics.linkLoss(link, t.res.flow[t.chiller.id]));
    near('The plant drops what the square law says at part flow',
         pd / 1000, 200 * Math.pow(0.000798 / 0.0016, 2), 1);
    near('...which is 49.7 kPa', pd / 1000, 49.7, 0.5);
  }

  /* The whole point: an ordinary duty rather than 102.7 m. */
  ok('The pump duty is ordinary', t.pump.pump.head < 30,
     t.pump.pump.head.toFixed(2) + ' m');
  ok('...and nothing is being over-pumped',
     !t.res.warnings.some(w => w.code === 'EQUIP_OFF_RATING'),
     JSON.stringify(t.res.warnings.filter(w => w.code === 'EQUIP_OFF_RATING')
                       .map(w => w.message)));

  /* THE OLD BEHAVIOUR, stated so the regression is unmistakable: had it sized
   * on the chiller, the coil would have seen 2.006× its rating and 4.02× its
   * drop. Computed here, not read from the code. */
  {
    const ratio = 0.0016 / 0.000798;
    near('Sizing on the plant would have been 2.006x the coil rating', ratio, 2.0050, 1e-3);
    near('...and 804 kPa across it', 200 * ratio * ratio, 804.0, 1);
    ok('...which is not what happened',
       Math.abs(t.res.flow[t.coil.id]) < 0.001);
  }

  /* Two coils in SERIES with equal ratings still work — they are all the same
   * flow, so the target is unambiguous. */
  {
    const m = M.create();
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    [1, 2].forEach(k => {
      const c = M.addPipe(m, n[k].id, n[k + 1].id, { kind: 'equip' });
      c.equip = { qRated: 0.002, pdRated: 100e3, equipType: 'exchanger', duty: 30000 };
    });
    const ch = M.addPipe(m, n[3].id, n[4].id, { kind: 'equip' });
    ch.equip = { qRated: 0.010, pdRated: 100e3, equipType: 'source', tSet: 20 };
    M.addPipe(m, n[4].id, n[5].id, { size: 'DN150', schedule: 'sch40' });
    M.addPipe(m, n[5].id, n[0].id, { size: 'DN150', schedule: 'sch40' });
    const res = NET.solveModel(m);
    near('Two matched coils in series both get their rating',
         Math.abs(res.flow[m.pipes[1].id]), 0.002, 0.002 * 2e-3);
    ok('...and the oversized plant is not what set the flow',
       Math.abs(res.flow[ch.id]) < 0.003, 
       (Math.abs(res.flow[ch.id]) * 1000).toFixed(3) + ' L/s');
  }

  /* A PLANT-ONLY circuit has nothing else to go on, so it still sizes on the
   * plant — the rule is "the loads set the flow", and with no loads the plant
   * is the only statement of what flow the circuit wants. */
  {
    const m = M.create();
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 4; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const ch = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    ch.equip = { qRated: 0.004, pdRated: 100e3, equipType: 'source', tSet: 20 };
    M.addPipe(m, n[2].id, n[3].id, { size: 'DN100', schedule: 'sch40' });
    M.addPipe(m, n[3].id, n[0].id, { size: 'DN100', schedule: 'sch40' });
    const res = NET.solveModel(m);
    near('With no loads, the plant sets the flow', Math.abs(res.flow[ch.id]),
         0.004, 0.004 * 2e-3);
  }

  /* An ISOLATED machine states nothing about the circuit it is valved out of. */
  {
    const t2 = loop({ coil: 0.000798, plant: 0.0016 });
    t2.coil.equip.off = true;
    const res = NET.solveModel(t2.m);
    ok('An isolated coil does not set the flow either',
       res.pumpSizing.mode === 'flow' &&
       JSON.stringify(res.pumpSizing.sizedOn) === '["ACCH-01"]',
       JSON.stringify(res.pumpSizing.sizedOn));
  }
}

/* ===================================================================
 * SYNC SIZES THE GROUP AS ONE MACHINE (Michael, 2026-08-23)
 *
 * A sync used to copy only the POSITION, so two pumps ganged to run together
 * could still hold two different duties and two different curves — one sized by
 * the solver, the other holding whatever somebody typed. The leader now states
 * the selection and the followers take it. It is said in the PUMP PANEL — the
 * follower's duty boxes are greyed and carry the leader's numbers — and NOT as
 * a message: a notice that fires on every solve to describe a relationship the
 * engineer set up on purpose is noise (Michael, 2026-08-23).
 * =================================================================== */
section('Sync shares the sizing, not only the position');
{
  /* ---- PUMPS: the follower takes mode, duty and curve from the leader ---- */
  {
    const m = base();
    const P = pumps(m);
    /* Diverge the follower as hard as the panel allows: a different sizing
     * mode AND a duty nothing would have chosen. */
    P[1].pump.sizing = 'manual';
    P[1].pump.mode = 'fixed';
    P[1].pump.head = 99;
    P[1].pump.hDesign = 99;
    P[1].pump.qDesign = 0.001;
    M.setSync(m, P[1], P[0].id);

    const res = NET.solveModel(m);

    ok('A synced pump takes the leader\u2019s sizing mode',
       M.pumpSizing(P[1]) === M.pumpSizing(P[0]),
       M.pumpSizing(P[1]) + ' vs ' + M.pumpSizing(P[0]));
    near('A synced pump takes the leader\u2019s head',
         P[1].pump.head, P[0].pump.head, 1e-9);
    near('...and the leader\u2019s design flow',
         P[1].pump.qDesign, P[0].pump.qDesign, 1e-12);
    ok('...and an identical curve',
       JSON.stringify(P[1].pump.curve) === JSON.stringify(P[0].pump.curve),
       'follower curve differs from leader');
    ok('The typed 99 m duty is gone', Math.abs(P[1].pump.head - 99) > 1,
       String(P[1].pump.head));

    ok('Syncing raises no message — the panel says it instead',
       code(res, 'SYNC_SIZED').length === 0,
       String(code(res, 'SYNC_SIZED').length));
  }

  /* ---- Only the leader is sized ---------------------------------------- */
  {
    const m = base();
    const P = pumps(m);
    P[1].pump.mode = 'auto';
    P[1].pump.sizing = 'auto';
    M.setSync(m, P[1], P[0].id);
    const res = NET.solveModel(m);
    ok('A synced pump is not auto-sized on its own',
       (res.pumpSizing.sizedOn || []).indexOf(P[1].tag) < 0,
       JSON.stringify(res.pumpSizing.sizedOn));
  }

  /* ---- A synced STANDBY pump stays standby ------------------------------ */
  {
    const m = base();
    const P = pumps(m);
    ok('The fixture gives us an off pump to test with',
       P[1].pump.mode === 'off', P[1].pump.mode);
    M.setSync(m, P[1], P[0].id);
    const res = NET.solveModel(m);
    ok('A synced pump left OFF stays off', P[1].pump.mode === 'off',
       P[1].pump.mode);
    near('...and carries no flow', res.flow[P[1].id] || 0, 0, 1e-12);
    ok('...but still carries the leader\u2019s curve, ready to run',
       !!P[1].pump.curve, 'no curve');
  }

  /* ---- HEAT EXCHANGERS: duty and rating follow the leader --------------- */
  {
    const m = M.fromJSON(JSON.parse(fs.readFileSync(
      path.join(__dirname, 'fixtures', 'parallel-branches.pnet.json'), 'utf8')));
    const ex = m.pipes.filter(p => p.kind === 'equip' &&
                                   p.equip.equipType === 'exchanger');
    ok('The fixture has two coils to sync', ex.length >= 2, String(ex.length));
    const lead = ex[0], follow = ex[1];
    const want = { duty: lead.equip.duty, q: lead.equip.qRated,
                   pd: lead.equip.pdRated };
    follow.equip.duty = 12345;
    follow.equip.qRated = 0.0011;
    follow.equip.pdRated = 33333;
    M.setSync(m, follow, lead.id);

    const res = NET.solveModel(m);

    near('A synced coil takes the leader\u2019s duty', follow.equip.duty,
         want.duty, 1e-9);
    near('...its rated flow', follow.equip.qRated, want.q, 1e-12);
    near('...and its rated pressure drop', follow.equip.pdRated, want.pd, 1e-9);

    ok('A synced coil group raises no message either',
       code(res, 'SYNC_SIZED').length === 0,
       String(code(res, 'SYNC_SIZED').length));
  }

  /* ---- The code is gone from the app entirely -------------------------- */
  {
    const fs2 = require('fs');
    const src = fs2.readFileSync(
      path.join(__dirname, '..', 'src', 'network.js'), 'utf8');
    ok('SYNC_SIZED is not emitted anywhere',
       src.indexOf("code: 'SYNC_SIZED'") < 0, 'still emitted');
  }
}

/* ==================================================================
 * CRITICAL PATH IN A CLOSED CIRCUIT — Michael, 2026-08-21.
 *
 * Three faults, all in the equipment (no-demand) branch of criticalPath:
 *   1. the return pipework was not on the path, so friction never
 *      reconciled with the pump duty;
 *   2. the index was chosen by the equipment's own pressure drop, which
 *      is identical for parallel branches and is read at the ACTUAL flow —
 *      so it pointed at the best-served load, not the worst;
 *   3. the greedy head-walk threaded several loads in a headered system.
 *
 * Expectations here are hand-derived: in a closed loop with one pump the
 * pump head IS the friction around the loop, by definition.
 * ================================================================== */
section('Critical path: a closed loop includes the return to the pump');
{
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0].id;
  const n0 = M.addNode(m, lv, 0, 0), n1 = M.addNode(m, lv, 2, 0);
  const n2 = M.addNode(m, lv, 40, 0), n3 = M.addNode(m, lv, 40, 10);
  const pump = M.addPipe(m, n0.id, n1.id, { size: 'DN50' });
  pump.kind = 'pump'; pump.tag = 'PMP';
  pump.pump = { mode: 'fixed', head: 20, sizing: 'manual', speed: 1,
    curve: { H0: 28, a: 70000, b: 1.55, source: 'generated', Qd: 0.0024, Hd: 20,
      points: [{ q: 0, h: 28 }, { q: 0.0024, h: 20 }, { q: 0.0036, h: 13 }] } };
  M.addPipe(m, n1.id, n2.id, { size: 'DN50' });          // supply
  const ahu = M.addPipe(m, n2.id, n3.id, { size: 'DN50' });
  ahu.kind = 'equip'; ahu.tag = 'AHU';
  ahu.equip = { qRated: 0.0024, pdRated: 50000, qOut: 0.02,
                equipType: 'exchanger', duty: 100000, lastEdited: ['qRated', 'duty'] };
  const ret = M.addPipe(m, n3.id, n0.id, { size: 'DN50' });   // return

  const res = NET.solveModel(m);
  const c = res.critical;
  ok('a closed loop has a critical path', !!c);
  ok('...ending at the load', c.target === n3.id, c.target);

  /* THE RETURN PIPE IS ON IT. This is the whole bug: the walk used to stop at
   * the datum reached through the pump, leaving the return side off. */
  ok('the return pipe is on the critical path', !!c.linkIds[ret.id],
     Object.keys(c.linkIds).join(','));
  ok('...and so is the pump', !!c.linkIds[pump.id]);

  /* AND IT RECONCILES. In a closed loop with one pump, friction + static
   * around the circuit equals the head the pump develops. Hand-checked:
   * supply 2.81 m + coil 11.00 m + return 3.16 m = 16.97 m. */
  const developed = M.pumpHead(m, pump, Math.abs(res.flow[pump.id]));
  near('friction + static reconciles with the pump head',
       c.frictionHead + c.staticHead, developed, 1e-6);
}

section('Critical path: the index is the worst-served load, not the nearest');
{
  /* Two identical coils in parallel, one on a much longer run. The long one
   * is starved, so it is the index — and because parallel branches settle at
   * the SAME head difference, the old "largest pressure drop" rule could not
   * tell them apart and took whichever it found first. */
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0].id;
  const s = M.addNode(m, lv, 0, 0), d = M.addNode(m, lv, 2, 0);
  const h = M.addNode(m, lv, 6, 0), r = M.addNode(m, lv, 6, 20);
  const pump = M.addPipe(m, s.id, d.id, { size: 'DN50' });
  pump.kind = 'pump'; pump.tag = 'PMP';
  pump.pump = { mode: 'fixed', head: 25, sizing: 'manual', speed: 1,
    curve: { H0: 35, a: 90000, b: 1.55, source: 'generated', Qd: 0.0048, Hd: 25,
      points: [{ q: 0, h: 35 }, { q: 0.0048, h: 25 }, { q: 0.0072, h: 16 }] } };
  M.addPipe(m, d.id, h.id, { size: 'DN50' });
  function coil(tag, pts) {
    let prev = h.id;
    pts.forEach(function (pt, i) {
      const n = M.addNode(m, lv, pt[0], pt[1]);
      if (i === pts.length - 1) {
        const e = M.addPipe(m, prev, n.id, { size: 'DN50' });
        e.kind = 'equip'; e.tag = tag;
        e.equip = { qRated: 0.0024, pdRated: 50000, qOut: 0.02,
                    equipType: 'exchanger', duty: 100000, lastEdited: ['qRated', 'duty'] };
        prev = n.id;
        return;
      }
      M.addPipe(m, prev, n.id, { size: 'DN50' });
      prev = n.id;
    });
    M.addPipe(m, prev, r.id, { size: 'DN50' });
  }
  coil('AHU-NEAR', [[10, 4], [14, 4]]);                    // short branch
  coil('AHU-FAR',  [[10, 40], [60, 40], [64, 40]]);        // long branch
  M.addPipe(m, r.id, s.id, { size: 'DN50' });

  const res = NET.solveModel(m);
  const near_ = m.pipes.filter(function (p) { return p.tag === 'AHU-NEAR'; })[0];
  const far = m.pipes.filter(function (p) { return p.tag === 'AHU-FAR'; })[0];
  const qn = Math.abs(res.flow[near_.id]), qf = Math.abs(res.flow[far.id]);
  ok('the far coil really is the starved one', qf < qn, qf + ' vs ' + qn);

  const c = res.critical;
  ok('the critical path takes the FAR coil', !!c.linkIds[far.id],
     'near=' + !!c.linkIds[near_.id] + ' far=' + !!c.linkIds[far.id]);
  ok('...and not the near one', !c.linkIds[near_.id]);
  /* ONE LOAD, ONCE. A headered system used to let the walk hop through a
   * second coil on its way back. */
  ok('exactly one load is on the path',
     (!!c.linkIds[near_.id] ? 1 : 0) + (!!c.linkIds[far.id] ? 1 : 0) === 1);
}

section('Critical path: the circuit closes at the pump on a real model');
{
  /* The HighRise is a VARIABLE PRIMARY system (Michael, 2026-08-21): PMP-1 and
   * PMP-2 on duty, PMP-3 in standby. Its datum is pinned on a node the main run
   * does not pass through, which is what exposed the real fault — the trace
   * terminated on `origins` and simply dead-ended when it never met one.
   *
   * A closed circuit ends at the PUMP, not at a fixed head. With that rule the
   * identity below holds exactly, and it is the strongest statement available
   * about a critical path: what the circuit loses is what the pump develops. */
  const fs2 = require('fs');
  const path2 = require('path');
  const file = path2.join(__dirname, 'fixtures', 'highrise-variable-primary.pnet.json');
  if (fs2.existsSync(file)) {
    const hm = M.fromJSON(JSON.parse(fs2.readFileSync(file, 'utf8')));
    hm.settings.calcMode = 'design';
    const hres = NET.solveModel(hm);
    const hc = hres.critical;
    ok('the model has a critical path', !!hc);

    /* ONE load, and it is the worst-served one. */
    const loads = hm.pipes.filter(function (p) {
      return p.kind === 'equip' && p.equip && p.equip.qRated > 0 &&
             p.equip.equipType !== 'source' && p.equip.equipType !== 'adiabatic';
    });
    const onPath = loads.filter(function (p) { return hc.linkIds[p.id]; });
    ok('exactly one load is on the critical path', onPath.length === 1,
       onPath.map(function (p) { return p.tag; }).join(','));
    const ranked = loads.map(function (p) {
      return { tag: p.tag, r: Math.abs(hres.flow[p.id] || 0) / p.equip.qRated };
    }).sort(function (a, b) { return a.r - b.r; });
    ok('...and it is the worst-served load', onPath[0].tag === ranked[0].tag,
       onPath[0].tag + ' vs worst ' + ranked[0].tag);

    /* Only ONE pump: a standby machine and the parallel duty machines are not
     * all in series, so a circuit crosses one of them. */
    const pumpsOn = hm.pipes.filter(function (p) {
      return p.kind === 'pump' && hc.linkIds[p.id];
    });
    ok('the circuit crosses exactly one pump', pumpsOn.length === 1,
       pumpsOn.map(function (p) { return p.tag; }).join(','));

    /* THE IDENTITY. */
    near('friction + static equals the pump head developed',
         hc.frictionHead + hc.staticHead, hc.pumpHead, 1e-6);
  }
}

/* ==================================================================
 * A SOURCE ON THE CIRCUIT DOES NOT END IT — Michael, 2026-08-24:
 * "if the source was located along the critical path, hydraulic
 * calculation stopped at source."
 *
 * A pressurisation / make-up connection pins a fixed head, and the walk
 * terminated on ANY fixed head before it could terminate on the pump.
 * Where the tee sat then decided the answer:
 *
 *   on the return leg   the path looked complete and quietly dropped the
 *                       pipe beyond the tee
 *   on the load inlet   the supply half collapsed to the coil alone; the
 *                       pump was not on the path at all
 *   on the load outlet  the path came back EMPTY — friction 0, static 0
 *
 * The circuit is the same circuit whatever the drawing does about
 * pressurisation, so the test is that every placement gives the SAME path
 * as no source at all, and that the identity holds in each.
 * ================================================================== */
section('Critical path: a source on the run does not truncate the circuit');
{
  /* a =pump= b — s1 — c =coil= d — s2 — a.  `s1` and `s2` are plain junctions
   * on the supply and return legs; the source is moved onto each node in turn. */
  function circuit(sourceAt) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0].id;
    const at = {
      a: M.addNode(m, lv, 0, 0), b: M.addNode(m, lv, 2, 0),
      s1: M.addNode(m, lv, 20, 0), c: M.addNode(m, lv, 40, 0),
      d: M.addNode(m, lv, 40, 10), s2: M.addNode(m, lv, 20, 10)
    };
    const pump = M.addPipe(m, at.a.id, at.b.id, { size: 'DN50' });
    pump.kind = 'pump'; pump.tag = 'PMP';
    pump.pump = { mode: 'fixed', head: 20, sizing: 'manual', speed: 1,
      curve: { H0: 28, a: 70000, b: 1.55, source: 'generated', Qd: 0.0024, Hd: 20,
        points: [{ q: 0, h: 28 }, { q: 0.0024, h: 20 }, { q: 0.0036, h: 13 }] } };
    M.addPipe(m, at.b.id, at.s1.id, { size: 'DN50' });
    M.addPipe(m, at.s1.id, at.c.id, { size: 'DN50' });
    const ahu = M.addPipe(m, at.c.id, at.d.id, { size: 'DN50' });
    ahu.kind = 'equip'; ahu.tag = 'AHU';
    ahu.equip = { qRated: 0.0024, pdRated: 50000, qOut: 0.02,
                  equipType: 'exchanger', duty: 100000, lastEdited: ['qRated', 'duty'] };
    M.addPipe(m, at.d.id, at.s2.id, { size: 'DN50' });
    M.addPipe(m, at.s2.id, at.a.id, { size: 'DN50' });
    if (sourceAt) at[sourceAt].device = { kind: 'source', pressure: 300000 };
    return { m, pump };
  }

  const baseRun = circuit(null);
  const baseRes = NET.solveModel(baseRun.m);
  const baseIds = Object.keys(baseRes.critical.linkIds).sort().join(',');
  ok('the un-pressurised circuit is the whole loop',
     baseRes.critical.sections.length === 6, String(baseRes.critical.sections.length));

  ['s1', 's2', 'b', 'c', 'd'].forEach(function (where) {
    const run = circuit(where);
    const res = NET.solveModel(run.m);
    const c = res.critical;
    ok('source on ' + where + ': a critical path is found', !!c);
    if (!c) return;
    ok('source on ' + where + ': the path is the same circuit',
       Object.keys(c.linkIds).sort().join(',') === baseIds,
       Object.keys(c.linkIds).sort().join(',') + ' vs ' + baseIds);
    ok('source on ' + where + ': the pump is on the path', !!c.linkIds[run.pump.id]);
    const developed = M.pumpHead(run.m, run.pump, Math.abs(res.flow[run.pump.id]));
    near('source on ' + where + ': friction + static equals the pump head',
         c.frictionHead + c.staticHead, developed, 1e-6);
  });
}


/* ==================================================================
 * A GREEDY WALK CANNOT FIND ITS WAY HOME — Michael, 2026-08-24: "the
 * critical path there only seemed to be halfway."
 *
 * `test/fixtures/datahall-yard.pnet.json` is four cooling-tower trains on a
 * common header. The supply half came up one train; the return half, taking
 * the biggest flow at each junction, went back to the plant and into a
 * DIFFERENT train, then stalled on the supply header where both remaining
 * exits were pipes the supply half had already used. It never reached the
 * suction it was aiming at, so the entire return half was thrown away and the
 * path stopped at the coil — 27 sections and a tally 46.5 m adrift from what
 * the pumps develop. A valid return route existed the whole time.
 *
 * The walk now backtracks. The identity is the assertion: what the circuit
 * loses is what the pumps on it develop, and nothing else in a model this size
 * reconciles by accident.
 *
 * DESIGN mode deliberately — the control loop takes the better part of a
 * minute here and has nothing to do with the trace.
 * ================================================================== */
section('Critical path: a big model closes the circuit, not half of it');
{
  const file = path.join(__dirname, 'fixtures', 'datahall-yard.pnet.json');
  const dm = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  dm.settings.calcMode = 'design';
  const res = NET.solveModel(dm);
  const c = res.critical;

  ok('the data hall has a critical path', !!c);
  ok('...through a load', !!c.targetLink, String(c.targetLink));

  const load = M.pipe(dm, c.targetLink);
  ok('the index load is on the path', !!c.linkIds[load.id]);

  /* IT IS A CIRCUIT. The failure looked like a path — it had sections, a
   * friction total and a static figure — so the test cannot be "did it return
   * something". Both sides of the index load have to be on it. */
  const at = id => dm.pipes.filter(p => p.id !== load.id &&
                                        (p.a === id || p.b === id));
  const inlet = at(load.a).filter(p => c.linkIds[p.id]);
  const outlet = at(load.b).filter(p => c.linkIds[p.id]);
  ok('the pipework INTO the index load is on the path', inlet.length > 0,
     at(load.a).map(p => p.id).join(','));
  ok('the pipework OUT of the index load is on the path', outlet.length > 0,
     at(load.b).map(p => p.id).join(','));

  /* THE IDENTITY. Under the greedy walk this was 46.51 m out. */
  near('friction + static equals the head developed on the path',
       c.frictionHead + c.staticHead, c.pumpHead, 1e-5);

  /* And it really is a walk home, not a lucky short one. */
  ok('the path crosses at least one pump',
     dm.pipes.some(p => p.kind === 'pump' && c.linkIds[p.id]));
  ok('the path is a substantial circuit, not the supply half alone',
     c.sections.length > 40, String(c.sections.length));

  /* ---- AND THE INDEX IS THE MOST REMOTE COIL, not the one whose valve
   * happened to quantise low (v0.18.15, WORKLIST DS.1).
   *
   * Michael, 2026-08-25: "logic would say the most remote should be AHU-12 or
   * 13... but calculation is showing AHU-4." The fourteen AHUs are identical
   * machines on one distribution run, each with its own integrated control
   * valve, and the whole spread in `flow / qRated` across the system is 0.57% —
   * which is the valves' 1%-of-travel resolution and nothing else. In DESIGN
   * the valves are now charged at full travel, so the ranking is pipework.
   *
   * Ranked by how much head is burnt reaching each coil, AHU-13 is first and
   * AHU-4 is LAST of the fourteen. The old answer was the least remote one. */
  {
    const idx = M.pipe(dm, c.targetLink);
    ok('the index is AHU-13, the most remote coil', idx.tag === 'AHU-13', idx.tag);
    /* AND IT IS NOW THE SAME IN SIMULATION (v0.18.18). The index is chosen by
     * how much head is burnt reaching a coil, which is a property of the pipe,
     * so it no longer depends on where the control valves came to rest. The
     * simulation solve itself is not run here — it takes the better part of a
     * minute on this model — but the criterion is the same one, and the
     * ordering it produces is asserted just below. */
    ok('...and specifically NOT AHU-4, which is the least remote',
       idx.tag !== 'AHU-4', idx.tag);

    /* Stated as a property rather than a name, so this still means something if
     * the model is ever redrawn: the index must be the coil with the LEAST head
     * available across its own branch, because the rest went into the pipework
     * getting there. */
    const coils = dm.pipes.filter(p => p.kind === 'equip' && p.equip &&
                                       p.equip.equipType === 'exchanger');
    const drop = p => res.head[p.a] - res.head[p.b];
    const least = coils.slice().sort((a, b) => drop(a) - drop(b))[0];
    ok('...which is the coil with the least differential across its branch',
       least.id === idx.id, least.tag + ' vs ' + idx.tag);

    /* The valve positions are what used to decide it. They must no longer be
     * able to: forcing every one of them somewhere else cannot move the index. */
    const moved = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    moved.settings.calcMode = 'design';
    moved.pipes.forEach(function (p) {
      if (p.kind === 'equip' && p.equip && p.equip.icv) p.equip.icv.opening = 25;
    });
    const mres = NET.solveModel(moved);
    ok('slamming every control valve to 25% does not move the design index',
       (M.pipe(moved, mres.critical.targetLink) || {}).tag === 'AHU-13',
       (M.pipe(moved, mres.critical.targetLink) || {}).tag);
  }
}


/* ==================================================================
 * DS.1 — A CONTROL VALVE'S POSITION IS AN OUTPUT, NOT A DESIGN INPUT.
 *
 * Michael, 2026-08-24: "Design calculation should assume design flow through
 * each equipment", and 2026-08-25, asking for the DESIGN half only.
 *
 * The control loop runs in SIMULATION and not in DESIGN, so a design solve read
 * whatever opening the last simulation left behind — and on the data hall that
 * DECIDED the answer. Fourteen identical AHUs on one run, valves settled
 * between 68% and 71%, and the index came out the LEAST remote of them because
 * its valve had quantised one step further closed than its neighbours'.
 *
 * A BALANCING valve is the opposite case and must not be caught by this: its
 * position is a decision somebody made, and it stays exactly as set.
 * ================================================================== */
section('Design: a controlled valve is at full travel, a balancing valve is not');
{
  /* pump — pipe — VALVE — coil — return. The valve is the only thing that
   * changes between the runs below. */
  function rig(kind) {
    const m = M.create();
    m.settings.calcMode = 'design';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 2, 0);
    const c = M.addNode(m, lv, 20, 0), d = M.addNode(m, lv, 22, 0);
    const e = M.addNode(m, lv, 22, 10);
    const pump = M.addPipe(m, a.id, b.id, { size: 'DN50', kind: 'pump', tag: 'PMP' });
    pump.pump = { mode: 'fixed', head: 25, sizing: 'manual', speed: 1,
      curve: { H0: 34, a: 80000, b: 1.55, source: 'generated', Qd: 0.0024, Hd: 25,
        points: [{ q: 0, h: 34 }, { q: 0.0024, h: 25 }, { q: 0.0036, h: 16 }] } };
    M.addPipe(m, b.id, c.id, { size: 'DN50' });
    const valve = M.addPipe(m, c.id, d.id, { size: 'DN50', kind: 'valve', tag: 'CV' });
    valve.valve = { type: 'globe', kv: 12, opening: 100 };
    const coil = M.addPipe(m, d.id, e.id, { size: 'DN50', kind: 'equip', tag: 'AHU' });
    coil.equip = { qRated: 0.0024, pdRated: 50000, qOut: 0.02, equipType: 'exchanger',
                   duty: 100000, lastEdited: ['qRated', 'duty'] };
    M.addPipe(m, e.id, a.id, { size: 'DN50' });
    /* A control link is what makes it a CONTROL valve. The build only asks
     * `M.controlOf`, so this exercises the rule without the loop. */
    if (kind === 'control') valve.valve.control = { equip: coil.id, key: 'dT' };
    return { m, valve, coil };
  }

  const open = rig('control');
  const qOpen = Math.abs(NET.solveModel(open.m).flow[open.coil.id]);
  ok('the reference case solves with flow', qOpen > 0, String(qOpen));

  /* ---- A CONTROL VALVE: the position is ignored in DESIGN. */
  [10, 40, 100].forEach(function (pos) {
    const t = rig('control');
    t.valve.valve.opening = pos;
    const q = Math.abs(NET.solveModel(t.m).flow[t.coil.id]);
    near('a control valve at ' + pos + '% gives the same design flow', q, qOpen,
         qOpen * 1e-9);
  });

  /* ---- A BALANCING VALVE: the position is a design input and is honoured.
   * This is the assertion that stops the fix over-reaching. */
  const bal100 = rig('balancing');
  const qBal100 = Math.abs(NET.solveModel(bal100.m).flow[bal100.coil.id]);
  near('a balancing valve wide open matches the control valve at full travel',
       qBal100, qOpen, qOpen * 1e-9);

  const bal40 = rig('balancing');
  bal40.valve.valve.opening = 40;
  const qBal40 = Math.abs(NET.solveModel(bal40.m).flow[bal40.coil.id]);
  ok('a balancing valve at 40% DOES throttle the design solve', qBal40 < qBal100 * 0.9,
     (qBal100 * 1000).toFixed(4) + ' -> ' + (qBal40 * 1000).toFixed(4) + ' L/s');

  /* ---- THE RATING INCLUDES THE INTEGRATED VALVE (DP.1, 2026-08-31).
   *
   * The two ways of drawing it USED to agree exactly, and deliberately. They no
   * longer do, and the difference is the whole of the DP.1 fix.
   *
   * An INTEGRATED valve is part of the machine, so the rated dP an engineer
   * types is the TOTAL for the branch — coil and valve together — which is what
   * a dP sensor across it reads. A DRAWN valve is separate pipework and is
   * charged on top of the rating. So the same Kv gives a different answer
   * depending on which one it is, and that is correct: they are not the same
   * plant. Michael: "Pressure Drop from Valve Kv at 100% is subtracted from
   * Equipment PD."
   *
   * THE INVARIANT THAT REPLACES THE OLD EQUIVALENCE. At full travel the
   * subtraction and the addition cancel exactly, so the link resistance is the
   * one the rating alone implies. This is the property that makes a sensor set
   * to the machine's rated dP deliver its rated flow. */
  {
    const t = rig('balancing');
    t.valve.valve.kv = 1e9;                        // the drawn valve out of the way
    t.coil.equip.icv = { kv: 40, opening: 33 };    // AUTO: design charges full travel
    const res = NET.solveModel(t.m);
    const link = res.network.links.filter(l => l.id === t.coil.id)[0];
    const expect = FD.hydraulics.equipmentR(50000, 0.0024, 998);
    near('at full travel the link resistance is exactly the rating alone',
         link.r, expect, expect * 1e-12);
  }

  /* AND IT IS A REAL SUBTRACTION, not a no-op. An integrated Kv 40 on a machine
   * rated 50 kPa is the same plant as a DRAWN Kv 40 on a machine rated
   * 50 kPa less the valve's full-open drop at rated flow. By hand: 0.0024 m3/s
   * is 8.64 m3/h, so (8.64/40)^2 bar = 4.666 kPa, leaving 45.334 kPa of coil. */
  {
    const integrated = rig('balancing');
    integrated.valve.valve.kv = 1e9;
    integrated.coil.equip.icv = { kv: 40, opening: 33, mode: 'manual' };
    const qInt = Math.abs(NET.solveModel(integrated.m).flow[integrated.coil.id]);

    /* BALANCING, not control: DS.1 charges a CONTROL valve at full travel in
     * DESIGN, so a control valve here would ignore the 33% and compare two
     * different positions. A balancing valve is honoured as set, which is what
     * the manual integrated valve above is too. */
    const drawn = rig('balancing');
    drawn.valve.valve.kv = 40;
    drawn.valve.valve.opening = 33;
    drawn.coil.equip.pdRated = 45334.4;            // the rating net of the valve
    const qDrawn = Math.abs(NET.solveModel(drawn.m).flow[drawn.coil.id]);

    near('an integrated valve equals a drawn one on the NET rating',
         qInt, qDrawn, qDrawn * 1e-4);
  }

  /* A VALVE THAT SPENDS THE WHOLE RATING leaves no coil, and is reported rather
   * than allowed to become a negative resistance. Kv 12 at 8.64 m3/h drops
   * (8.64/12)^2 bar = 51.84 kPa against a 50 kPa rating, so this rig — which is
   * the one this section used before DP.1 — is exactly that case. */
  {
    const t = rig('balancing');
    t.valve.valve.kv = 1e9;
    t.coil.equip.icv = { kv: 12, opening: 33 };
    const res = NET.solveModel(t.m);
    const w = (res.warnings || []).filter(x => x.code === 'ICV_EXCEEDS_PD');
    ok('a valve bigger than the whole rating raises ICV_EXCEEDS_PD', w.length === 1,
       (res.warnings || []).map(x => x.code).join(','));
    ok('...naming the machine', w.length === 1 && w[0].pipe === t.coil.id);
    /* The coil floors at zero and the link becomes the valve alone. This ICV is
     * AUTO, so DESIGN charges it at FULL travel (DS.1) whatever the 33% says —
     * so the link is exactly the wide-open valve and nothing else. */
    const link = res.network.links.filter(l => l.id === t.coil.id)[0];
    near('...and the coil floors at zero, leaving only the valve',
         link.r, FD.valves.resistance('globe', 12, 100), 1e-6);
  }

  /* ---- SIMULATION IS UNTOUCHED, which is what Michael asked for. There the
   * position is the loop's own answer, and a valve it is NOT controlling still
   * reads as drawn. */
  const sim = rig('balancing');
  sim.m.settings.calcMode = 'simulation';
  sim.valve.valve.opening = 40;
  const qSim40 = Math.abs(NET.solveModel(sim.m).flow[sim.coil.id]);
  const simOpen = rig('balancing');
  simOpen.m.settings.calcMode = 'simulation';
  const qSimOpen = Math.abs(NET.solveModel(simOpen.m).flow[simOpen.coil.id]);
  ok('an uncontrolled valve still throttles in SIMULATION', qSim40 < qSimOpen * 0.9,
     (qSimOpen * 1000).toFixed(4) + ' -> ' + (qSim40 * 1000).toFixed(4) + ' L/s');
}


/* ==================================================================
 * THE CRITICAL PATH, CHOSEN BY HAND.
 *
 * Michael, 2026-08-25: "we will need to allow the user to select calculating
 * between 2 points (and back) in addition to the current auto method.
 * Otherwise non-obvious things may trip up the users and they will be unable
 * to verify."
 *
 * Two node ids. One of them must sit on a pump, because the tally only means
 * something as a circuit — out along the run and back to the machine driving
 * it. The identity is the check that it IS a circuit.
 * ================================================================== */
section('Critical path: two ends chosen by hand');
{
  function rig() {
    const m = M.create();
    m.settings.calcMode = 'design';
    const lv = m.levels[0].id;
    const N = (x, y) => M.addNode(m, lv, x, y);
    const a = N(0, 0), b = N(2, 0), h = N(6, 0), r = N(6, 40);
    const pump = M.addPipe(m, a.id, b.id, { size: 'DN50', kind: 'pump', tag: 'PMP' });
    pump.pump = { mode: 'fixed', head: 25, sizing: 'manual', speed: 1,
      curve: { H0: 35, a: 90000, b: 1.55, source: 'generated', Qd: 0.0048, Hd: 25,
        points: [{ q: 0, h: 35 }, { q: 0.0048, h: 25 }, { q: 0.0072, h: 16 }] } };
    M.addPipe(m, b.id, h.id, { size: 'DN50' });
    function coil(tag, pts) {
      let prev = h.id, made = null;
      pts.forEach(function (pt, i) {
        const n = N(pt[0], pt[1]);
        if (i === pts.length - 1) {
          made = M.addPipe(m, prev, n.id, { size: 'DN50', kind: 'equip', tag: tag });
          made.equip = { qRated: 0.0024, pdRated: 50000, qOut: 0.02,
                         equipType: 'exchanger', duty: 100000,
                         lastEdited: ['qRated', 'duty'] };
          prev = n.id; return;
        }
        M.addPipe(m, prev, n.id, { size: 'DN50' });
        prev = n.id;
      });
      M.addPipe(m, prev, r.id, { size: 'DN50' });
      return made;
    }
    const near_ = coil('AHU-NEAR', [[10, 4], [14, 4]]);
    const far = coil('AHU-FAR', [[10, 60], [70, 60], [74, 60]]);
    M.addPipe(m, r.id, a.id, { size: 'DN50' });
    return { m, pump, near_, far };
  }

  /* ---- WHICH NODES MAY BE PICKED. */
  {
    const t = rig();
    ok('a pump end is on a pump', M.nodeOnPump(t.m, t.pump.a) === true);
    ok('a coil outlet is not', M.nodeOnPump(t.m, t.near_.b) === false);
    ok('two nodes with no pump between them are refused',
       M.setCriticalManual(t.m, t.near_.b, t.far.b) === null);
    ok('...and nothing is stored', M.criticalManual(t.m) === null);
    ok('the same node twice is refused',
       M.setCriticalManual(t.m, t.pump.a, t.pump.a) === null);
  }

  /* ---- THE PUMP END IS STORED FIRST, whichever order it was clicked. Asking
   * the reader to click them in a set order would be a rule with no reason. */
  {
    const t = rig();
    const fwd = M.setCriticalManual(t.m, t.pump.a, t.near_.b);
    ok('pump first stays first', fwd.a === t.pump.a && fwd.b === t.near_.b,
       JSON.stringify(fwd));
    const t2 = rig();
    const rev = M.setCriticalManual(t2.m, t2.near_.b, t2.pump.a);
    ok('pump second is put first', rev.a === t2.pump.a && rev.b === t2.near_.b,
       JSON.stringify(rev));
  }

  /* ---- IT OVERRIDES THE SEARCH. The automatic index here is the FAR coil;
   * naming the NEAR one has to give the near one, or the button does nothing. */
  {
    const auto = rig();
    const autoRes = NET.solveModel(auto.m);
    ok('the automatic index is the far coil',
       autoRes.critical.targetLink === auto.far.id,
       (M.pipe(auto.m, autoRes.critical.targetLink) || {}).tag);

    const t = rig();
    M.setCriticalManual(t.m, t.pump.a, t.near_.b);
    const res = NET.solveModel(t.m);
    const c = res.critical;
    ok('a manual path reports as manual', c.targetKind === 'manual', c.targetKind);
    ok('...ending where it was told', c.target === t.near_.b, c.target);
    ok('...starting at the pump node it was told', c.origin === t.pump.a, c.origin);
    ok('...through the NEAR coil, not the automatic index',
       !!c.linkIds[t.near_.id] && !c.linkIds[t.far.id],
       'near=' + !!c.linkIds[t.near_.id] + ' far=' + !!c.linkIds[t.far.id]);
    ok('...and across the pump', !!c.linkIds[t.pump.id]);

    /* AND IT IS STILL A CIRCUIT — out and back. */
    near('friction + static equals the head developed on the manual path',
         c.frictionHead + c.staticHead, c.pumpHead, 1e-6);
    ok('the path has both halves', c.sections.length > 4, String(c.sections.length));
  }

  /* ---- CLEARING GOES BACK TO AUTOMATIC. */
  {
    const t = rig();
    M.setCriticalManual(t.m, t.pump.a, t.near_.b);
    ok('set', !!M.criticalManual(t.m));
    M.setCriticalManual(t.m, null, null);
    ok('cleared', M.criticalManual(t.m) === null);
    const res = NET.solveModel(t.m);
    ok('and the search is back in charge',
       res.critical.targetKind === 'equipment' &&
       res.critical.targetLink === t.far.id,
       res.critical.targetKind + ' ' + (M.pipe(t.m, res.critical.targetLink) || {}).tag);
  }

  /* ---- A STALE PAIR IS IGNORED. A node deleted after the pair was stored
   * must not leave the sheet reporting a path between things that are gone. */
  {
    const t = rig();
    M.setCriticalManual(t.m, t.pump.a, t.near_.b);
    t.m.nodes = t.m.nodes.filter(n => n.id !== t.near_.b);
    ok('a pair naming a deleted node reads as unset',
       M.criticalManual(t.m) === null);
  }
}


report();
