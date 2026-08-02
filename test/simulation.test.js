/* FreePipeCalc — pump curves and SIMULATION mode.
 * Run:  node test/simulation.test.js
 *
 * Expectations here are hand calculations, not numbers read back out of the
 * code (see ARCHITECTURE.md §15). Where a case has a closed-form answer the
 * algebra is written out in the comment above it so it can be re-checked
 * without running anything.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'data/pumps.js', 'data/valves.js',
                 'src/hydraulics.js', 'src/solver.js', 'src/network.js']);
const M = FD.model, NET = FD.network, P = FD.pumps;
const fs = require('fs');

const RHO = 998, G = 9.81;
const paToHead = pa => pa / (RHO * G);

// ---------------------------------------------------------------- curve form
section('Single-point curve (EPANET assumption)');
{
  const Hd = 30, Qd = 0.020;
  const c = P.singlePoint(Hd, Qd);

  // H = (4/3)Hd - (1/3)Hd(Q/Qd)^2, so the three fixed points are exact.
  near('Shutoff head is 4/3 of design', c.H0, 40, 1e-12);
  near('Returns design head at design flow', P.head(c, Qd), 30, 1e-12);
  near('Zero head at twice design flow', P.head(c, 2 * Qd), 0, 1e-12);
  near('Max flow is twice design flow', P.maxFlow(c), 0.040, 1e-12);

  // dH/dQ = -2aQ; a = (1/3)(30)/0.02^2 = 25000, so at Qd the slope is 1000.
  near('Slope at design flow is 2aQd', P.slope(c, Qd, 0), 2 * 25000 * Qd, 1e-9);

  // The derivative vanishes at shutoff, which would blow up the Newton step.
  ok('Slope is floored at shutoff', P.slope(c, 0, 0.5) === 0.5);

  ok('Rejects zero design head', P.singlePoint(0, 0.02) === null);
  ok('Rejects zero design flow', P.singlePoint(30, 0) === null);
}

section('Three-point quadratic (TOOLS ▸ Generic Pump Curve)');
{
  /* The worked NFPA 20 example: 1000 L/s at 100 kPa rated, shutoff 140%,
   * and 65% of rated head at 150% of rated flow. Done here in the tool's own
   * display units, which is how the tool works.
   *
   *   m01 = (100-140)/(1000-0)   = -0.04
   *   m12 = (65-100)/(1500-1000) = -0.07
   *   c   = (-0.07 + 0.04)/1500  = -2e-5
   *   b   = -0.04 - (-2e-5)(0+1000) = -0.02
   *   a   = 140
   */
  const qc = P.threePoint({ q: 0, h: 140 }, { q: 1000, h: 100 }, { q: 1500, h: 65 });
  near('Constant coefficient a', qc.a, 140, 1e-9);
  near('Linear coefficient b', qc.b, -0.02, 1e-12);
  near('Quadratic coefficient c', qc.c, -2e-5, 1e-15);

  // It is an interpolation: all three points must come back exactly.
  near('Passes through the shutoff point', P.quadHead(qc, 0), 140, 1e-9);
  near('Passes through the design point', P.quadHead(qc, 1000), 100, 1e-9);
  near('Passes through the runout point', P.quadHead(qc, 1500), 65, 1e-9);

  // A point nobody specified, checked by hand: 140 - 0.02(500) - 2e-5(500^2)
  near('Interpolates correctly at 50% flow', P.quadHead(qc, 500), 125, 1e-9);

  // Zero head: 140 - 0.02q - 2e-5 q^2 = 0 -> q = 2192.58...
  const root = (0.02 - Math.sqrt(0.0004 + 4 * 2e-5 * 140)) / (2 * -2e-5);
  near('Flow at zero head', P.quadMaxFlow(qc), root, 1e-6);

  ok('Order of the three points does not matter',
     Math.abs(P.threePoint({ q: 1500, h: 65 }, { q: 0, h: 140 },
                           { q: 1000, h: 100 }).c - qc.c) < 1e-15);

  ok('Rejects two points at the same flow',
     P.threePoint({ q: 0, h: 140 }, { q: 1000, h: 100 }, { q: 1000, h: 65 }) === null);

  ok('A well-formed curve raises no warnings', P.quadWarnings(qc, 1000).length === 0);

  // A curve that RISES with flow is not a pump.
  const bad = P.threePoint({ q: 0, h: 60 }, { q: 1000, h: 100 }, { q: 1500, h: 140 });
  ok('Warns when head rises with flow',
     P.quadWarnings(bad, 1000).some(w => /RISES/.test(w)));
}

section('Curve fitting');
{
  // Points generated FROM a known curve must fit back to it exactly.
  const truth = { H0: 42, a: 18000, b: 2 };
  const pts = [];
  for (let q = 0; q <= 0.048; q += 0.004) {
    pts.push({ q: q, h: truth.H0 - truth.a * Math.pow(q, truth.b) });
  }
  const f = P.fit(pts);
  near('Recovers H0', f.H0, 42, 1e-6);
  near('Recovers a', f.a, 18000, 1e-2);
  near('Recovers b', f.b, 2, 0.021);          // b is swept in 0.02 steps
  near('r-squared is 1 on exact data', f.fit.r2, 1, 1e-9);
  ok('Reports the point count', f.fit.n === pts.length);
  ok('Marks the source as fitted', f.source === 'fitted');

  ok('Refuses fewer than two points', P.fit([{ q: 0, h: 40 }]) === null);
  // A head that RISES with flow is not a pump curve.
  ok('Refuses a rising curve',
     P.fit([{ q: 0, h: 10 }, { q: 0.01, h: 20 }, { q: 0.02, h: 30 }]) === null);
}

section('Curve parsing');
{
  const t = 'Flow\tHead\n0\t400\n10\t380\n20\t300\n30\t160\n';
  const r = P.parseCurve(t, 'L/s', 'kPa');
  ok('Skips the header row', r.points.length === 4);
  near('Converts flow to m3/s', r.points[1].q, 0.010, 1e-12);
  near('Converts head to metres', r.points[1].h, paToHead(380e3), 1e-9);
  ok('Sorts ascending by flow', r.points.every((p, i, a) => !i || p.q >= a[i - 1].q));

  const csv = P.parseCurve('0,40\n0.02,30', 'm3/s', 'm');
  ok('Accepts comma separation', csv.points.length === 2);
}

// -------------------------------------------------------- terminal behaviour
section('Outflow characteristic');
{
  const m = M.create();
  const lv = m.levels[0];
  const n = M.addNode(m, lv, 0, 0);
  n.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };

  // r = dP / (rho.g.Q^2) = 200000 / (998 * 9.81 * 0.0004)
  const expect = 200e3 / (RHO * G * 0.020 * 0.020);
  near('Resistance from the design point', M.outflowResistance(m, n), expect, 1e-6);

  // The resistance must reproduce the design point it came from.
  const r = M.outflowResistance(m, n);
  near('Reproduces design pressure at design flow',
       FD.hydraulics.headloss(r, 0.020, 2) * RHO * G, 200e3, 1);

  n.device.reqPressure = 0;
  ok('No characteristic without a required pressure', M.outflowResistance(m, n) === null);

  ok('Minimum outflow pressure is 0.1 kPa', M.MIN_OUTFLOW_PRESSURE === 100);
}

// ------------------------------------------------------------- solved system
/* Source -> pump -> pipe -> outflow. With the pipe made very short its friction
 * is negligible, so the operating point is where the pump curve meets the
 * terminal resistance alone and can be solved by hand:
 *
 *   H0 - a.Q^2 = r.Q^2      ->      Q = sqrt(H0 / (a + r))
 */
section('Operating point against an analytic answer');
{
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0];

  const a = M.addNode(m, lv, 0, 0);
  const b = M.addNode(m, lv, 1, 0);
  const c = M.addNode(m, lv, 2, 0);
  a.device = { kind: 'source', head: 0 };
  c.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };

  const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
  pump.pump = { mode: 'fixed', head: 30, curve: P.singlePoint(30, 0.020) };
  M.addPipe(m, b.id, c.id, { size: 'DN100', schedule: 'sch40' });

  const res = NET.solveModel(m);
  ok('Converges', res.converged === true);

  const rT = 200e3 / (RHO * G * 0.0004);          // terminal resistance
  const aC = (1 / 3) * 30 / (0.020 * 0.020);      // curve coefficient
  const qHand = Math.sqrt(40 / (aC + rT));        // H0 = 40 m

  const sim = res.simulation;
  ok('Produces a simulation report', !!sim);
  ok('Reports one terminal', sim.terminals.length === 1);

  // The 1 m of DN100 pipe adds a little friction, so the solved flow sits just
  // BELOW the frictionless hand answer — within a percent, and on the low side.
  const q = sim.terminals[0].actualFlow;
  ok('Flow is just under the frictionless analytic answer',
     q < qHand && q > qHand * 0.99, `hand ${qHand}, solved ${q}`);

  /* Energy audit: pump head must be exactly absorbed by the pipe and the
   * terminal, and the pipe's share must be small. This is what catches the
   * pipe silently coming out as DN50 when the test asked for DN100 — the flow
   * check above passes either way once the tolerance is loose enough. */
  const net = NET.build(m, res.flow);
  const linkLoss = id => {
    const l = net.links.filter(x => x.id === id)[0];
    return FD.hydraulics.headloss(l.r, Math.abs(res.flow[id] || 0), l.n);
  };
  const pipeId = m.pipes.filter(x => x.kind !== 'pump')[0].id;
  const total = linkLoss(pipeId) + linkLoss('__out_' + c.id);
  near('Pump head is absorbed exactly by the pipe and the terminal',
       P.head(pump.pump.curve, q), total, 1e-6);
  ok('Pipe friction is a small share of the total',
     linkLoss(pipeId) / total < 0.02, String(linkLoss(pipeId) / total));

  ok('Flow exceeds design — the pump rides out along its curve',
     sim.terminals[0].ratio > 1, String(sim.terminals[0].ratio));
  near('Ratio matches actual over design',
       sim.terminals[0].ratio, q / 0.020, 1e-12);

  // Above design flow the terminal is stealing, so a balancing valve is quoted.
  ok('Quotes a balancing Kv', sim.terminals[0].balanceKv > 0);

  // Pump head must be its curve evaluated at the solved flow.
  near('Pump head is read off its own curve',
       sim.pumps[0].head, P.head(pump.pump.curve, q), 1e-9);
  ok('Not beyond the curve', sim.pumps[0].beyondCurve === false);
}

/* ------------------------------------------------------------------------
 * Is the simulated outflow REALLY a function of node pressure, the design K
 * and the pump curve?
 *
 * That is the claim the SIMULATE outflow panel makes, and it is worth proving
 * rather than assuming. The claim decomposes into an identity and a response:
 *
 *   IDENTITY.  The terminal is r·Q² between the node and a virtual discharge
 *   pinned at the node's own elevation (0 gauge), with r = ΔP_d/(ρ·g·Q_d²).
 *   So  P_node/(ρg) = r·Q²  →  Q = Q_d·sqrt(P_node/ΔP_d) = K·sqrt(P_node),
 *   with K = Q_d/sqrt(ΔP_d). This holds EXACTLY, whatever the rest of the
 *   network does, so it is checked to 1e-9. It also means the design point is
 *   a point ON the characteristic: at P_node = ΔP_d the flow is Q_d.
 *
 *   RESPONSE.  P_node is what the pump curve delivers through the solve, so a
 *   different curve must move the flow, and by the amount the algebra says.
 *
 * Every expected value below is worked out from that algebra, not read back
 * out of a solve.
 * ---------------------------------------------------------------------- */
section('Outflow flow follows node pressure, the design K and the curve');
{
  /* Two terminals of DIFFERENT design K on one pump, so the split between them
   * has to be explained by K·sqrt(P) and not by anything else. */
  const mk = (Qd1, Qd2, curve) => {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0];
    const s = M.addNode(m, lv, 0, 0);
    const j = M.addNode(m, lv, 1, 0);
    const t1 = M.addNode(m, lv, 2, 0);
    const t2 = M.addNode(m, lv, 2, 2);
    s.device = { kind: 'source', head: 0 };
    t1.device = { kind: 'demand', flow: Qd1, reqPressure: 200e3 };
    t2.device = { kind: 'demand', flow: Qd2, reqPressure: 150e3 };
    const pump = M.addPipe(m, s.id, j.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', head: 40, curve: curve };
    M.addPipe(m, j.id, t1.id, { size: 'DN100', schedule: 'sch40' });
    M.addPipe(m, j.id, t2.id, { size: 'DN100', schedule: 'sch40' });
    return { m, t1, t2, pump };
  };

  const K = (Qd, dPd) => Qd / Math.sqrt(dPd);

  const base = mk(0.020, 0.010, P.singlePoint(40, 0.030));
  const res = NET.solveModel(base.m);
  ok('Converges', res.converged === true);

  const term = id => res.simulation.terminals.filter(t => t.node === id)[0];
  const a1 = term(base.t1.id), a2 = term(base.t2.id);

  // Q = K·sqrt(P), K = Q_d/sqrt(dP_d). Nothing here comes from the solver
  // except the node pressure the identity is a function OF.
  near('Terminal 1 flow is K1·sqrt(P1)',
       a1.actualFlow, K(0.020, 200e3) * Math.sqrt(res.pressure[base.t1.id]), 1e-9);
  near('Terminal 2 flow is K2·sqrt(P2)',
       a2.actualFlow, K(0.010, 150e3) * Math.sqrt(res.pressure[base.t2.id]), 1e-9);

  // The same statement in the form the panel uses: a ratio to the design point.
  near('Terminal 1 flow is Qd·sqrt(P/dPd)',
       a1.actualFlow, 0.020 * Math.sqrt(res.pressure[base.t1.id] / 200e3), 1e-9);

  ok('The two terminals sit at different pressures',
     Math.abs(res.pressure[base.t1.id] - res.pressure[base.t2.id]) > 1,
     `${res.pressure[base.t1.id]} vs ${res.pressure[base.t2.id]}`);
  near('Reported actual pressure is the node pressure',
       a1.actualPressure, res.pressure[base.t1.id], 1e-9);

  /* Design K is a real input, not decoration: 1.5x the design flow at the same
   * design pressure is 1.5x the K, so at any given node pressure the terminal
   * passes 1.5x the flow. The node pressure itself will drop (the pump is
   * being asked for more), so the flow rises by LESS than 1.5x — the identity
   * is what stays exact. */
  const wider = mk(0.030, 0.010, P.singlePoint(40, 0.030));
  const resW = NET.solveModel(wider.m);
  const w1 = resW.simulation.terminals.filter(t => t.node === wider.t1.id)[0];
  near('A 1.5x design K still obeys the identity',
       w1.actualFlow, K(0.030, 200e3) * Math.sqrt(resW.pressure[wider.t1.id]), 1e-9);
  ok('A larger design K draws more flow', w1.actualFlow > a1.actualFlow,
     `${w1.actualFlow} vs ${a1.actualFlow}`);
  ok('and pulls the node pressure down',
     resW.pressure[wider.t1.id] < res.pressure[base.t1.id]);
  ok('Flow rises by less than the K ratio (pressure gave way)',
     w1.actualFlow / a1.actualFlow < 1.5, String(w1.actualFlow / a1.actualFlow));

  /* The pump curve is the other input. A curve with the same shape but 25%
   * more head at every flow (H0 40 -> 50) must raise both pressures and both
   * flows, and the identity must survive it. */
  const strong = mk(0.020, 0.010, P.singlePoint(50, 0.030));
  const resS = NET.solveModel(strong.m);
  const s1 = resS.simulation.terminals.filter(t => t.node === strong.t1.id)[0];
  near('A stronger curve still obeys the identity',
       s1.actualFlow, K(0.020, 200e3) * Math.sqrt(resS.pressure[strong.t1.id]), 1e-9);
  ok('A stronger curve raises the node pressure',
     resS.pressure[strong.t1.id] > res.pressure[base.t1.id]);
  ok('and therefore the flow', s1.actualFlow > a1.actualFlow);

  /* Only the curve changed, and both terminals kept their K, so both flows
   * must scale by the SAME factor — sqrt(P'/P) at each node. That is only true
   * if the flow really is K·sqrt(P) and nothing else. */
  near('Both terminals scale by sqrt of their own pressure ratio',
       s1.actualFlow / a1.actualFlow,
       Math.sqrt(resS.pressure[strong.t1.id] / res.pressure[base.t1.id]), 1e-9);

  /* And the head the pump makes is its curve read at the total it is passing —
   * the link between the curve and the pressures above. */
  const qPump = Math.abs(resS.flow[strong.pump.id]);
  near('Pump head is its curve at the total flow',
       resS.simulation.pumps[0].head, P.head(strong.pump.pump.curve, qPump), 1e-9);
  near('Pump flow is the sum of what the terminals take',
       qPump,
       resS.simulation.terminals.reduce((a, t) => a + t.actualFlow, 0), 1e-9);
}

/* The identity above is exact but relative — it says the flow follows the
 * pressure. This pins the ABSOLUTE answer for one case, with the friction made
 * negligible so it has a closed form:
 *
 *   H0 - a·Q² = r·Q²   ->   Q = sqrt(H0/(a + r))
 *
 * A second, stronger curve is solved the same way. Both are hand answers; the
 * solved flows must sit just below them (the pipe still has some friction) and
 * must move between the two curves by the amount the algebra predicts.
 */
section('Two curves against a closed-form operating point');
{
  const one = (Hd) => {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0];
    const s = M.addNode(m, lv, 0, 0);
    const j = M.addNode(m, lv, 0.5, 0);
    const t = M.addNode(m, lv, 1, 0);
    s.device = { kind: 'source', head: 0 };
    t.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };
    const pump = M.addPipe(m, s.id, j.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', head: Hd, curve: P.singlePoint(Hd, 0.020) };
    M.addPipe(m, j.id, t.id, { size: 'DN300', schedule: 'sch40' });
    const res = NET.solveModel(m);
    // singlePoint: H = (4/3)Hd - (1/3)(Hd/Qd²)Q², so H0 = 4Hd/3 and a = Hd/(3Qd²)
    const aC = Hd / (3 * 0.020 * 0.020);
    const rT = 200e3 / (RHO * G * 0.020 * 0.020);
    const qHand = Math.sqrt((4 * Hd / 3) / (aC + rT));
    return { res, qHand, q: res.simulation.terminals[0].actualFlow };
  };

  const lo = one(30);
  const hi = one(45);

  ok('30 m curve lands just under its frictionless answer',
     lo.q < lo.qHand && lo.q > lo.qHand * 0.999, `hand ${lo.qHand}, solved ${lo.q}`);
  ok('45 m curve lands just under its frictionless answer',
     hi.q < hi.qHand && hi.q > hi.qHand * 0.999, `hand ${hi.qHand}, solved ${hi.q}`);

  /* Both terms of the frictionless answer scale with Hd — H0 = 4Hd/3 and
   * a = Hd/3Qd² — but r does not, so the flow ratio is NOT sqrt(45/30). Worked
   * out from the two closed forms rather than assumed. */
  near('The flow ratio between the two curves matches the algebra',
       hi.q / lo.q, hi.qHand / lo.qHand, 2e-3);

  ok('More head means more flow', hi.q > lo.q);
}

section('DESIGN mode is unaffected by a curve');
{
  const m = M.create();
  const lv = m.levels[0];
  const a = M.addNode(m, lv, 0, 0);
  const b = M.addNode(m, lv, 1, 0);
  const c = M.addNode(m, lv, 2, 0);
  a.device = { kind: 'source', head: 0 };
  c.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };
  const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
  pump.pump = { mode: 'auto', head: 0, curve: P.singlePoint(30, 0.020) };
  M.addPipe(m, b.id, c.id, { size: 'DN100', schedule: 'sch40' });

  const res = NET.solveModel(m);   // default calcMode is 'design'
  near('Outflow gets exactly its stated flow', Math.abs(res.flow[c.id] || 0.020), 0.020, 1e-9);
  ok('No simulation report in DESIGN', res.simulation === null || res.simulation === undefined);
}

// --------------------------------------------------- parallel pumps, failure
/* The data centre battery, reduced to its hydraulics. N identical pumps in
 * parallel each take Q/N, so the combined curve is H = H0 - a(Q/N)^2. Losing
 * one does NOT drop total flow by 1/N: the survivors ride out along their own
 * curves. Both operating points below are checked against that algebra.
 */
section('Parallel pumps and pump failure');
{
  const file = __dirname + '/fixtures/datacentre-ring.pnet.json';
  const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  const pumps = m.pipes.filter(p => p.kind === 'pump');
  ok('Four pumps in the example', pumps.length === 4);

  // Design duty, +10% on both axes, then split 4 ways for parallel operation.
  const design = NET.solveModel(m);
  const dutyQ = Math.abs(design.flow[pumps[0].id]);
  const dutyH = pumps[0].pump.head;
  ok('DESIGN sizes the running pump', dutyQ > 0 && dutyH > 0);

  const selQ = dutyQ * 1.1, selH = dutyH * 1.1;
  const each = P.singlePoint(selH, selQ / 4);

  m.settings.calcMode = 'simulation';
  pumps.forEach(p => { p.pump.mode = 'fixed'; p.pump.head = selH; p.pump.curve = each; });

  const all = NET.solveModel(m);
  ok('Four-pump case converges', all.converged === true);
  const q4 = all.simulation.terminals[0].actualFlow;
  const h4 = all.simulation.pumps[0].head;
  /* Each pump must sit on its OWN curve at its OWN flow. Checking against
   * H0 - a(Q_total/4)^2 would only be right if the four shared flow exactly,
   * and the ring is not quite symmetric — H is non-linear in Q, so the mean
   * flow does not give the mean head. */
  all.simulation.pumps.forEach((pp, i) => {
    near('Pump ' + (i + 1) + ' of 4 sits on its curve',
         pp.head, P.head(each, pp.flow), 1e-9);
  });
  void h4;

  const shares = all.simulation.pumps.map(p => p.flow);
  ok('Identical parallel pumps share flow within 1%',
     (Math.max(...shares) - Math.min(...shares)) / Math.max(...shares) < 0.01,
     shares.join(', '));

  // Now fail one.
  pumps[3].pump.mode = 'off';
  const fail = NET.solveModel(m);
  ok('Failure case converges', fail.converged === true);
  const sim = fail.simulation;
  const q3 = sim.terminals[0].actualFlow;
  const live = sim.pumps.filter(p => p.mode !== 'off');

  ok('The failed pump carries no flow', sim.pumps[3].flow === 0);
  ok('The failed pump develops no head', sim.pumps[3].head === 0);
  live.forEach((pp, i) => {
    near('Surviving pump ' + (i + 1) + ' sits on its curve',
         pp.head, P.head(each, pp.flow), 1e-9);
  });
  /* Flow is conserved exactly.
   *
   * A stopped pump used to be modelled as a closed valve with a large but
   * FINITE resistance (valves.CLOSED_R = 1e12, square law), which passed
   * sqrt(h/1e12) — about 5e-6 m3/s per stopped pump at this circuit's head,
   * or 0.03% of system flow. Small, but it meant the reported flows did not
   * add up, which is the sort of discrepancy that costs an hour to chase.
   *
   * A stopped pump is now omitted from the network entirely, so there is no
   * seepage to account for and this closes to solver tolerance. */
  const delivered = live.reduce((s2, p) => s2 + p.flow, 0);
  near('Pump flows sum to the terminal flow exactly', delivered, q3, q3 * 1e-9);
  ok('A stopped pump passes no flow at all', sim.pumps[3].flow === 0);

  ok('Total flow falls', q3 < q4);
  // Losing 25% of the pumps must NOT lose 25% of the flow: the system curve is
  // steep, so the survivors take up most of the slack.
  ok('Flow falls by far less than a quarter', q3 > q4 * 0.85, `${q4} -> ${q3}`);
  ok('Survivors run past their design flow', live.every(p => p.pctOfDesign > 1));

  /* The runout WARNING, tested against an explicit threshold rather than
   * against wherever this model happens to land.
   *
   * It used to assert simply that PUMP_RUNOUT fired, and passed because the
   * survivors sat a shade over the fixture's 120% limit. When equivalent length
   * moved to NFPA 13 (2026-08-02) the circuit lost the straight-through tee
   * allowance, the system curve flattened, and the survivors came to rest at
   * 119.8% — just under. The warning correctly stopped firing and the test
   * failed for a reason that had nothing to do with the warning.
   *
   * So the threshold is now set here, either side of the actual operating
   * point, which is what "does the warning work" actually means. */
  const worst = Math.max.apply(null, live.map(p => p.pctOfDesign)) * 100;
  ok('Survivors are between 100% and 130% of design', worst > 100 && worst < 130,
     worst.toFixed(2) + '%');

  m.settings.warn.pumpRunout = Math.floor(worst) - 1;      // just below them
  const warned = NET.solveModel(m);
  ok('Runout is warned about once the limit is below them',
     warned.warnings.some(w => w.code === 'PUMP_RUNOUT'),
     'limit ' + m.settings.warn.pumpRunout + '%, worst ' + worst.toFixed(2) + '%');

  m.settings.warn.pumpRunout = Math.ceil(worst) + 1;       // just above them
  const quiet = NET.solveModel(m);
  ok('...and silent once the limit is above them',
     !quiet.warnings.some(w => w.code === 'PUMP_RUNOUT'),
     'limit ' + m.settings.warn.pumpRunout + '%');
  m.settings.warn.pumpRunout = 120;
}

section('SIMULATION refuses to run without a pump curve');
{
  const file = __dirname + '/fixtures/datacentre-ring.pnet.json';
  const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  m.settings.calcMode = 'simulation';
  // the example's running pump has no curve
  const res = NET.solveModel(m);
  const err = (res.errors || []).filter(e => e.code === 'NO_PUMP_CURVE');
  ok('Raises NO_PUMP_CURVE', err.length === 1, JSON.stringify(res.errors));
  ok('...with the required wording',
     /Pump curve is required to simulate\. If no manufacturer data is available, please see the TOOLS tab\./
       .test(err[0].message), err[0].message);
  ok('...and does not report convergence', res.converged === false);

  // An OFF pump needs no curve — it is isolated.
  m.pipes.filter(p => p.kind === 'pump').forEach(p => { p.pump.mode = 'off'; });
  const off = NET.solveModel(m);
  ok('A stopped pump is not required to have a curve',
     (off.errors || []).filter(e => e.code === 'NO_PUMP_CURVE').length === 0);
}

section('Round trip: TOOLS table back into the solver');
{
  /* The tool builds a quadratic; the solver stores H0 - a.Q^b, which has no
   * linear term. Pasting the three defining points is exact (3 parameters,
   * 3 points); pasting the whole table is a least-squares compromise that
   * moves all three. Both are asserted because the tool offers both and tells
   * the user which is which. */
  const rho = 998, g = 9.81;
  const toSI = r => ({ q: r.q / 1000, h: r.h * 1000 / (rho * g) });   // L/s, kPa
  const qc = P.threePoint({ q: 0, h: 140 }, { q: 1000, h: 100 }, { q: 1500, h: 65 });

  const three = [{ q: 0, h: 140 }, { q: 1000, h: 100 }, { q: 1500, h: 65 }].map(toSI);
  const fit3 = P.fit(three);
  const kpa = h => h * rho * g / 1000;
  near('Three points: shutoff exact', kpa(P.head(fit3, 0)), 140, 1e-3);
  near('Three points: design exact', kpa(P.head(fit3, 1.0)), 100, 1e-3);
  near('Three points: runout exact', kpa(P.head(fit3, 1.5)), 65, 1e-3);

  const table = [];
  for (let pct = 0; pct <= 150; pct += 10) {
    const q = 1000 * pct / 100;
    table.push(toSI({ q: q, h: P.quadHead(qc, q) }));
  }
  const fitAll = P.fit(table);
  ok('Full table fits the quadratic closely overall', fitAll.fit.r2 > 0.999,
     String(fitAll.fit.r2));
  // ...but at the cost of the stated points, which is why the tool warns.
  ok('Full table moves the stated design point',
     Math.abs(kpa(P.head(fitAll, 1.0)) - 100) > 0.1,
     String(kpa(P.head(fitAll, 1.0))));
  ok('...though by under 2% of design head',
     Math.abs(kpa(P.head(fitAll, 1.0)) - 100) < 2,
     String(kpa(P.head(fitAll, 1.0))));
}

section('Parallel pumps share in DESIGN (the degeneracy fix)');
{
  /* N pumps each holding a fixed head between the same two headers is a
   * degenerate problem: the equations are linearly dependent and continuity
   * alone does not decide the split. Before the balancing pass this returned a
   * 99.9% skew — one pump carrying the whole flow while the rest sat near zero —
   * with the TOTAL and the HEAD both perfectly correct.
   *
   * These values are a regression baseline regenerated from the hand-rebuilt
   * model (2026-07-30), which is a 20 L/s single-equipment circuit — the old
   * numbers came from the earlier 45 L/s two-CRAH geometry. They also guard
   * against the balancing pass disturbing the sizing.
   *
   * REGENERATED THREE MORE TIMES on 2026-08-02, as the equivalent-length basis
   * settled:
   *
   *   271.2 / 260.3 / 256.0 / 252.2   L/D ratios
   *   263.7 / 254.6 / 252.1 / 250.1   NFPA 13, tee-run blank, charging nothing
   *   269.7 / 258.9 / 254.5 / 250.8   NFPA 13 + the Carrier straight-through row
   *   270.1 / 259.3 / 254.9 / 251.2   all Carrier (the default set from v0.8.4)
   *
   * This model has ELEVEN straight-through tees, which is why it swings
   * furthest on that one row. The end point is within 0.5% of where the L/D
   * ratios had it, from a published table that was never fitted to them.
   *
   * REGENERATED BEFORE THAT for the bullhead-tee fix: 268.5 / 257.6 /
   * 253.3 / 249.6 became 271.2 / 260.3 / 256.0 / 252.2. This is a ring main, so
   * its supply and return tees are bullhead tees — nothing passes straight
   * through them — and one leg of each was being charged as a run (K = 0.9)
   * instead of a branch (K = 1.1). Correcting it adds resistance, so every head
   * rises, by 2.6-2.7 kPa across all four cases. A uniform shift of a couple of
   * kPa from an extra 0.2 velocity heads at two tees is the expected size and
   * the expected direction; anything else would have meant the fix did
   * something other than what it says. These are RECORDED figures, not hand
   * calculations — the hand-calculable statement about this fix is the symmetry
   * assertion in model.test.js, which needs no coefficient at all. */
  const file = __dirname + '/fixtures/data_centre_redundant_ring_main.pnet (fixed).json';
  const expectHead = { 1: 270.1, 2: 259.3, 3: 254.9, 4: 251.2 };   // kPa

  [1, 2, 3, 4].forEach(n => {
    const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    const ps = m.pipes.filter(p => p.kind === 'pump');
    ps.forEach((p, i) => { p.pump.mode = i < n ? 'auto' : 'off'; p.pump.head = 0; });

    const res = NET.solveModel(m);
    const qs = ps.slice(0, n).map(p => Math.abs(res.flow[p.id]));
    const tot = qs.reduce((a, b) => a + b, 0);

    near(n + ' pump(s): total flow is the circuit flow', tot, 0.020, 0.0015);
    near(n + ' pump(s): head matches the pre-existing sizer answer',
         ps[0].pump.head * RHO * G / 1000, expectHead[n], 0.5);

    if (n > 1) {
      const spread = (Math.max(...qs) - Math.min(...qs)) / Math.max(...qs);
      ok(n + ' pumps share to within 5% (was 99.9% skewed)', spread < 0.05,
         qs.map(q => (q * 1000).toFixed(2)).join(' / '));
      qs.forEach((q, i) => {
        ok(n + ' pumps: pump ' + (i + 1) + ' carries a real share',
           q > 0.020 / n * 0.9 && q < 0.020 / n * 1.1, (q * 1000).toFixed(2));
      });
    }
  });

  /* The residual spread must not be zeroed out either — it is the real
   * asymmetry of the headers, and forcing an exactly equal split would be
   * inventing a symmetry the drawing does not have. */
  const m4 = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  m4.pipes.filter(p => p.kind === 'pump').forEach(p => { p.pump.mode = 'auto'; p.pump.head = 0; });
  const r4 = NET.solveModel(m4);
  const q4 = m4.pipes.filter(p => p.kind === 'pump').map(p => Math.abs(r4.flow[p.id]));
  ok('The split is not artificially flattened to exactly equal',
     Math.max(...q4) - Math.min(...q4) > 1e-6, q4.map(q => (q * 1000).toFixed(3)).join(' / '));
}

section('Equipment is reported as a terminal');
{
  const file = __dirname + '/fixtures/datacentre-ring.pnet.json';
  const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  const design = NET.solveModel(m);
  const p0 = m.pipes.filter(p => p.kind === 'pump')[0];
  m.settings.calcMode = 'simulation';
  p0.pump.curve = P.singlePoint(p0.pump.head, Math.abs(design.flow[p0.id]));

  const res = NET.solveModel(m);
  // This model has NO outflow nodes at all — its only load is equipment, so
  // without equipment rows the flow-distribution table would come out empty.
  ok('No outflow nodes in this model',
     m.nodes.filter(n => n.device && n.device.kind === 'demand').length === 0);
  ok('Equipment still appears as a terminal', res.simulation.terminals.length === 1);
  ok('Marked as equipment', res.simulation.terminals[0].equipment === true);
  near('Design flow is the rated flow',
       res.simulation.terminals[0].designFlow, 0.020, 1e-9);
  ok('Total design flow is non-zero', res.simulation.totalDesign > 0);
}

report();
