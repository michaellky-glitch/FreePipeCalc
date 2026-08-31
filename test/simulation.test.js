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
/* THERMAL IS LOADED, and it matters. The control loop measures a machine's
 * Design ΔT through `FD.thermal`; without it every ΔT controller is inert and a
 * simulation reads the same whatever the setpoint says — which silently made
 * the DP.1 section below pass identical numbers at 170, 200 and 250 kPa. */
const FD = load(['src/model.js', 'src/geometry.js', 'data/pumps.js', 'data/valves.js',
                 'src/hydraulics.js', 'src/solver.js', 'src/network.js',
                 'src/thermal.js']);
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

/* --------------------------------------------------------------------------
 * THE AFFINITY LAWS — the same pump at part speed.
 *
 *     Q ∝ N        H ∝ N²        so    H_s(Q) = s²·H(Q/s)
 *
 * Substituted into the stored form H = H0 − a·Q^b that stays in the SAME form,
 * which is why the scaling is done once on the curve and the solver never
 * learns about speed at all:
 *
 *     H_s(Q) = s²[H0 − a(Q/s)^b] = s²·H0 − a·s^(2−b)·Q^b
 *
 * The identity itself is what is tested here, not the algebra as written in
 * the source: the expectations below evaluate s²·H(Q/s) directly.
 * ----------------------------------------------------------------------- */
section('Affinity laws: a pump curve at part speed');
{
  const c = P.singlePoint(30, 0.020);          // H0 = 40, a = 25000, b = 2

  ok('Full speed returns the curve untouched', P.atSpeed(c, 1) === c);
  ok('A stopped pump is not a curve', P.atSpeed(c, 0) === null);
  ok('No curve, no scaled curve', P.atSpeed(null, 0.5) === null);

  /* THE identity, at several speeds and several flows, against s².H(Q/s)
   * computed here rather than read out of the module. */
  [0.9, 0.75, 0.5, 0.3].forEach(s => {
    const cs = P.atSpeed(c, s);
    [0.002, 0.008, 0.015, 0.020].forEach(q => {
      near(`H at ${(s * 100).toFixed(0)}% speed, ${q * 1000} L/s is s².H(Q/s)`,
           P.head(cs, q), s * s * P.head(c, q / s), 1e-12);
    });
  });

  /* The duty point rides the affinity parabola to (s.Qd, s².Hd). At half
   * speed that is 10 L/s at 7.5 m — a quarter of 30 m. */
  {
    const cs = P.atSpeed(c, 0.5);
    near('Design flow scales with speed', cs.Qd, 0.010, 1e-15);
    near('Design head scales with speed squared', cs.Hd, 7.5, 1e-12);
    near('...and the curve really passes through it', P.head(cs, 0.010), 7.5, 1e-12);
    near('Shutoff head scales with speed squared', P.shutoffHead(cs), 10, 1e-12);
    near('Maximum flow scales with speed', P.maxFlow(cs), 0.020, 1e-15);
    /* For the default b = 2 the exponent term is s⁰, so `a` does not move at
     * all and the family is a set of parallel-looking parabolas. */
    near('With b = 2 the curvature is unchanged', cs.a, c.a, 1e-9);
  }

  /* b ≠ 2 is where a naive "just scale H0" would go wrong, so it is checked
   * against the same identity. */
  {
    const c3 = { H0: 50, a: 4e6, b: 3, Qd: 0.015, Hd: 50 - 4e6 * Math.pow(0.015, 3) };
    const cs = P.atSpeed(c3, 0.6);
    near('a is scaled by s^(2−b) when b ≠ 2', cs.a, 4e6 * Math.pow(0.6, -1), 1e-6);
    near('...and the identity still holds',
         P.head(cs, 0.009), 0.36 * P.head(c3, 0.015), 1e-9);
  }

  /* END TO END. Against a purely quadratic system, R·Q², the operating point
   * is where s²H0 − aQ² = RQ² (b = 2, so `a` is unchanged), giving
   *
   *     Q = s·sqrt(H0/(a+R))
   *
   * i.e. the flow falls in exact proportion to speed. The model's terminal is
   * exactly quadratic; its 1 m of DN100 pipe is Hazen-Williams at 1.852 and
   * worth well under a percent, so the ratio lands just off exactly s. */
  {
    function rig(speed) {
      const m = M.create();
      m.settings.calcMode = 'simulation';
      const lv = m.levels[0];
      const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
      const cN = M.addNode(m, lv, 2, 0);
      a.device = { kind: 'source', head: 0 };
      cN.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };
      const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
      pump.pump = { mode: 'fixed', head: 30, curve: P.singlePoint(30, 0.020),
                    speed: speed };
      M.addPipe(m, b.id, cN.id, { size: 'DN100', schedule: 'sch40' });
      const res = NET.solveModel(m);
      return { res, q: Math.abs(res.flow[pump.id]), pump };
    }
    const full = rig(1);
    [0.8, 0.6, 0.4].forEach(s => {
      const part = rig(s);
      const ratio = part.q / full.q;
      ok(`At ${(s * 100).toFixed(0)}% speed the flow is ${(s * 100).toFixed(0)}% of full`,
         Math.abs(ratio - s) < 0.005 * s,
         `ratio ${ratio.toFixed(5)}, expected ~${s}`);
    });
    /* And the reported head is read off the SCALED curve, not the rated one —
     * the mistake that would have every panel and the drawing disagreeing with
     * the solver. */
    const half = rig(0.5);
    near('Reported head is the scaled curve at the solved flow',
         half.res.simulation.pumps[0].head,
         P.head(P.atSpeed(half.pump.pump.curve, 0.5), half.q), 1e-9);
    near('...and the reported speed is the one it ran at',
         half.res.simulation.pumps[0].speed, 0.5, 1e-12);
  }
}

/* --------------------------------------------------------------------------
 * AT PART LOAD A PUMP RIDES DOWN THE SYSTEM CURVE  (Michael, 2026-08-03)
 *
 * The operating point is the INTERSECTION of the speed-scaled pump curve with
 * the system curve. On a closed circuit the system is H = R·Q² through the
 * origin, and the intersection then satisfies the affinity laws exactly:
 *
 *     Q2/Q1 = n2/n1        H2/H1 = (n2/n1)²
 *
 * so head must go DOWN with speed, not up.
 *
 * THE FAILURE THIS GUARDS AGAINST is reading the RATED curve at the reduced
 * flow. A pump curve FALLS with flow, so evaluating it further left always
 * reads a HIGHER head — the exact opposite of the truth. On the fitted curve
 * in `debug/20260803-1.json` the two answers diverge hard:
 *
 *     n      Q L/s    correct H    rated-curve-at-Q
 *     1.00   20.000     44.85 m        44.85 m
 *     0.80   15.982     28.72 m        50.12 m      <- rises
 *     0.50    9.964     11.24 m        56.70 m      <- rises further
 *
 * Both columns are "the pump curve evaluated at the solved flow". Only one of
 * them is the machine.
 * ----------------------------------------------------------------------- */
section('Part load rides down the system curve, not up the pump curve');
{
  /* A CLOSED circuit: pump + equipment, no source, no demand. The system curve
   * is then a pure R·Q² through the origin, which is the case where the
   * affinity laws hold exactly for the operating point. */
  function circuit(curve, speed) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0);
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', head: 30, curve: curve, speed: speed };
    const eq = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    eq.equip = { qRated: 0.020, pdRated: 200e3, equipType: 'exchanger', duty: 0 };
    M.addPipe(m, c.id, a.id, { size: 'DN150', schedule: 'sch40' });
    const res = NET.solveModel(m);
    return { m, pump, res, q: Math.abs(res.flow[pump.id]),
             h: res.simulation.pumps[0].head };
  }

  /* Michael's own fitted curve — b = 1.55, NOT the default 2, which is where a
   * "just scale H0" shortcut would come apart. */
  const fitted = { H0: 62.78610963990971, a: 7733.048499512283, b: 1.55072,
                   Qd: 0.02, Hd: 44.85, source: 'fitted' };

  [P.singlePoint(30, 0.020), fitted].forEach((cv, ci) => {
    const label = ci ? "Michael's fitted curve (b = 1.55)" : 'single-point curve (b = 2)';
    const full = circuit(cv, 1);

    [0.9, 0.8, 0.7, 0.6, 0.5].forEach(n => {
      const part = circuit(cv, n);
      near(`${label}: at ${(n * 100).toFixed(0)}% speed the flow is n× full`,
           part.q / full.q, n, 0.002 * n);
      near(`${label}: ...and the head is n² × full`,
           part.h / full.h, n * n, 0.004 * n * n);
      ok(`${label}: ...so head fell rather than rose`, part.h < full.h,
         `${full.h.toFixed(3)} -> ${part.h.toFixed(3)} m`);
    });

    /* THE WRONG ANSWER, computed here so the test states what it is guarding
     * against rather than merely asserting the right one. */
    const half = circuit(cv, 0.5);
    const wrong = P.head(cv, half.q);          // RATED curve at the reduced flow
    ok(`${label}: reading the rated curve at that flow would read HIGHER`,
       wrong > full.h,
       `correct ${half.h.toFixed(2)} m, rated-curve-at-Q ${wrong.toFixed(2)} m, ` +
       `full speed ${full.h.toFixed(2)} m`);
    ok(`${label}: ...and the app does not do that`,
       Math.abs(half.h - wrong) > 1,
       `${half.h.toFixed(2)} vs ${wrong.toFixed(2)}`);
  });

  /* WITH STATIC LIFT the operating point must NOT follow n and n².
   *
   * This is the test that shows the app is SOLVING the intersection rather than
   * applying the affinity laws to the answer. The affinity laws map points on
   * the PUMP curve; the operating point only inherits them when the system
   * curve passes through the origin. Add a static lift and the system curve no
   * longer does: flow falls faster than n, head falls slower than n² because it
   * is approaching the static head, and below some speed the pump cannot lift
   * at all.
   *
   * Hand check on the direction: at 70% speed, Q/Q1 = 0.43 (below 0.70) and
   * H/H1 = 0.65 (above 0.49). Both inequalities are the wrong way round for a
   * naive affinity mapping, and both are right.
   */
  {
    function lift(n) {
      const m = M.create();
      m.settings.calcMode = 'simulation';
      const lv = m.levels[0].id;
      const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
      const c = M.addNode(m, lv, 2, 0);
      a.device = { kind: 'source', head: 0 };
      c.dz = 20;                                   // 20 m of static lift
      c.device = { kind: 'demand', flow: 0.020, reqPressure: 100e3, include: true };
      const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
      pump.pump = { mode: 'fixed', head: 40, curve: P.singlePoint(40, 0.020), speed: n };
      M.addPipe(m, b.id, c.id, { size: 'DN100', schedule: 'sch40' });
      const res = NET.solveModel(m);
      return { q: Math.abs(res.flow[pump.id]), h: res.simulation.pumps[0].head };
    }
    const f = lift(1), p7 = lift(0.7);
    ok('With static lift the flow falls FASTER than speed',
       p7.q / f.q < 0.7 - 0.05, (p7.q / f.q).toFixed(4));
    ok('...and the head falls SLOWER than speed squared',
       p7.h / f.h > 0.49 + 0.05, (p7.h / f.h).toFixed(4));
    ok('...because it is approaching the 20 m static head', p7.h > 20,
       p7.h.toFixed(2) + ' m');
    ok('...but it still FALLS, which is the whole point', p7.h < f.h,
       `${f.h.toFixed(2)} -> ${p7.h.toFixed(2)} m`);
    ok('...monotonically all the way down',
       [1, 0.9, 0.8, 0.7].map(lift).every((v, i, arr) => i === 0 || v.h < arr[i - 1].h),
       [1, 0.9, 0.8, 0.7].map(n => lift(n).h.toFixed(2)).join(' -> '));
  }

  /* THE REPORTED head must be the same number, wherever it is read from. The
   * panel, the drawing and the calculation sheet all go through M.pumpHead. */
  {
    const t = circuit(fitted, 0.6);
    near('M.pumpHead agrees with the simulation report',
         M.pumpHead(t.m, t.pump, t.q), t.h, 1e-9);
    near('...and with the scaled curve read at the solved flow',
         M.pumpHead(t.m, t.pump, t.q),
         P.head(P.atSpeed(fitted, 0.6), t.q), 1e-9);
  }
}

/* --------------------------------------------------------------------------
 * SPEED IS A SIMULATION QUANTITY  (Michael, 2026-08-03)
 *
 * In DESIGN the demands IMPOSE the flow and `autoSizePumps` holds the rated
 * duty on top of that, so a speed there cannot slow anything down. What it did
 * instead was make the sizer specify a bigger pump to overcome the throttling
 * it had been handed — on Michael's own model, 44.8 m at 100% speed became
 * 179.4 m at 50%, with the flow pinned at 20.00 L/s the whole way.
 *
 * That is the same "two controllers on one actuator" conflict that made the
 * control loop SIMULATION-only in v0.11.1. The loop was fenced off then and a
 * hand-typed speed was not.
 * ----------------------------------------------------------------------- */
section('A typed speed does nothing in DESIGN, and is not silent about it');
{
  function sized(speed, mode) {
    const m = M.create();
    m.settings.calcMode = mode || 'design';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0);
    M.setSource(m, a.id, 0);
    c.device = { kind: 'demand', flow: 0.010, reqPressure: 100e3, include: true };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10, speed: speed };
    M.addPipe(m, b.id, c.id, { size: 'DN100', schedule: 'sch40' });
    const res = NET.solveModel(m);
    return { m, pump, res, q: Math.abs(res.flow[pump.id]), head: pump.pump.head };
  }

  const full = sized(1);
  const slow = sized(0.5);

  near('The sized duty is the same at 50% speed as at 100%',
       slow.head, full.head, 1e-9);
  ok('...rather than being inflated to overcome its own throttling',
     slow.head < full.head * 1.01,
     `${full.head.toFixed(2)} m -> ${slow.head.toFixed(2)} m`);
  near('The demand is met either way, because DESIGN imposes it',
       slow.q, 0.010, 1e-9);

  ok('The stored speed is kept, not wiped', slow.pump.pump.speed === 0.5);
  near('...but it reads as full speed, because that is what was calculated',
       M.pumpSpeed(slow.m, slow.pump), 1, 1e-12);
  ok('...and the panel is told to explain why',
     M.pumpSpeedIgnored(slow.m, slow.pump) === true);

  /* The same pump in SIMULATION does apply it — the flag is about the mode,
   * not about the pump. */
  {
    const m = sized(0.5).m;
    m.settings.calcMode = 'simulation';
    const p2 = m.pipes.filter(x => x.kind === 'pump')[0];
    near('In SIMULATION the same speed is applied', M.pumpSpeed(m, p2), 0.5, 1e-12);
    ok('...and nothing needs explaining', M.pumpSpeedIgnored(m, p2) === false);
  }

  /* In DESIGN the reported head is the one the solver used — the fixed head,
   * NOT the curve. The curve is not in a DESIGN calculation at all. */
  {
    const t = sized(1);
    t.pump.pump.curve = P.singlePoint(30, 0.020);
    near('DESIGN reports the head the solve ran on, not the curve',
         M.pumpHead(t.m, t.pump, t.q), t.pump.pump.head, 1e-12);
    ok('...which is a different number from the curve at that flow',
       Math.abs(P.head(t.pump.pump.curve, t.q) - t.pump.pump.head) > 1,
       `curve ${P.head(t.pump.pump.curve, t.q).toFixed(2)} m, ` +
       `solved ${t.pump.pump.head.toFixed(2)} m`);
  }
}

/* --------------------------------------------------------------------------
 * THE SYSTEM CURVE — solved, not assumed
 *
 * The head the network demands of a pump as a function of the flow through it.
 * Each point is a real solve at a different pump speed: every operating point
 * lies on the system curve by definition, so sweeping speed traces it exactly.
 *
 * WHY NOT THE PARABOLA. The usual shortcut is H = H_op·(Q/Q_op)² through the
 * origin. That is only the system curve when there is no static lift, no second
 * pump, and every loss goes as Q². The tests below break the first and third of
 * those and show the traced curve following the truth where the parabola would
 * not.
 * ----------------------------------------------------------------------- */
section('The system curve is traced by solving, not assumed');
{
  function rig(opts) {
    opts = opts || {};
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0);
    a.device = { kind: 'source', head: 0 };
    if (opts.lift) c.dz = opts.lift;
    c.device = { kind: 'demand', flow: 0.020, reqPressure: opts.req === undefined ? 100e3 : opts.req,
                 include: true };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', head: 40, curve: P.singlePoint(40, 0.020) };
    M.addPipe(m, b.id, c.id, { size: opts.size || 'DN100', schedule: 'sch40' });
    return { m, pump, res: NET.solveModel(m) };
  }

  // ---- shape
  {
    const t = rig();
    const sys = NET.systemCurve(t.m, t.pump.id);
    ok('A system curve is produced', !!sys && sys.length >= 5, sys && sys.length);
    ok('...ordered by flow',
       sys.every((pt, i) => i === 0 || pt.q > sys[i - 1].q));
    ok('...and rising: more flow always costs more head',
       sys.every((pt, i) => i === 0 || pt.h > sys[i - 1].h),
       JSON.stringify(sys.map(x => +x.h.toFixed(2))));
    ok('...with every point at a positive flow and head',
       sys.every(pt => pt.q > 0 && pt.h > 0));

    /* THE DEFINING PROPERTY: the solved operating point must lie ON it. The
     * full-speed solve is the sweep's own n = 1 point, so this is exact. */
    const qOp = Math.abs(t.res.flow[t.pump.id]);
    const hOp = M.pumpHead(t.m, t.pump, qOp);
    const at1 = sys.filter(x => Math.abs(x.speed - 1) < 1e-9)[0];
    ok('The operating point is a point on the system curve', !!at1);
    near('...at the same flow', at1.q, qOp, 1e-9);
    near('...and the same head', at1.h, hOp, 1e-9);
  }

  // ---- the model is left exactly as it was found
  {
    const t = rig();
    /* `savedAt` is a timestamp written by toJSON itself, not model state. */
    const snap = () => { const j = M.toJSON(t.m); delete j.savedAt; return JSON.stringify(j); };
    const before = snap();
    NET.systemCurve(t.m, t.pump.id);
    ok('Tracing the curve does not disturb the model', snap() === before);
    ok('...and leaves no stray speed on the pump',
       t.pump.pump.speed === undefined);
  }

  /* ---- STATIC LIFT moves the intercept off zero, which is the case the
   * parabola-through-the-origin gets wrong. With 25 m of lift the system needs
   * 25 m before it will pass any flow at all, so extrapolating the traced curve
   * back towards Q = 0 must approach 25 m and not 0. */
  {
    const t = rig({ lift: 25, req: 50e3 });
    const sys = NET.systemCurve(t.m, t.pump.id);
    ok('With static lift the curve still traces', !!sys && sys.length >= 4,
       sys && sys.length);
    /* Most of a linear speed sweep lands on zero flow when there is a lift to
     * overcome, so the working range is swept again — four points is a polygon,
     * not a curve. Every point is still a solve; nothing is interpolated. */
    ok('...at enough points to draw', sys.length >= 8, String(sys.length));
    const lowest = sys[0];
    ok('...and its lowest point is above the 25 m lift', lowest.h > 25,
       lowest.h.toFixed(2) + ' m at ' + (lowest.q * 1000).toFixed(2) + ' L/s');

    /* The parabola through the origin and the operating point would predict
     * far LESS head at low flow than the network really needs — that is the
     * whole error, and it is large. */
    const op = sys[sys.length - 1];
    const parabola = op.h * Math.pow(lowest.q / op.q, 2);
    ok('...where a parabola through the origin would badly under-read',
       parabola < lowest.h * 0.6,
       `traced ${lowest.h.toFixed(2)} m, parabola ${parabola.toFixed(2)} m`);
  }

  /* ---- NOT SQUARE-LAW either. With no lift and a terminal removed, the loss
   * is Hazen-Williams pipe friction at exponent 1.852, so the traced curve is
   * measurably flatter than Q². Small, but real, and in the right direction. */
  {
    const t = rig({ req: 100, size: 'DN50' });
    const sys = NET.systemCurve(t.m, t.pump.id);
    const lo = sys[0], hi = sys[sys.length - 1];
    const n = Math.log(hi.h / lo.h) / Math.log(hi.q / lo.q);
    ok('The traced exponent sits between 1.852 and 2',
       n > 1.8 && n < 2.05, 'n = ' + n.toFixed(4));
  }

  // ---- refusals
  {
    const t = rig();
    t.m.settings.calcMode = 'design';
    ok('No system curve in DESIGN — the flow is imposed there',
       NET.systemCurve(t.m, t.pump.id) === null);
  }
  {
    const t = rig();
    t.pump.pump.mode = 'off';
    ok('A stopped pump has no system curve', NET.systemCurve(t.m, t.pump.id) === null);
  }
  {
    const t = rig();
    delete t.pump.pump.curve;
    ok('No curve, no system curve', NET.systemCurve(t.m, t.pump.id) === null);
    ok('Asking about something that is not a pump returns nothing',
       NET.systemCurve(t.m, 'nope') === null);
  }
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
     /Pump curve is required to simulate\. Change pump sizing mode to Manual or Curve\./
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
   * And 270.1 / 259.3 / 255.0 / 251.2 at v0.9.0, when the two Hazen-Williams
   * entries were collapsed into one: the survivor derives its constants from
   * the printed velocity form (10.6663) rather than carrying the rounded
   * published 10.67. Sub-0.1%, and visible only in the third pump.
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
  const expectHead = { 1: 270.1, 2: 259.3, 3: 255.0, 4: 251.2 };   // kPa

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

/* ==================================================================
 * RUNOUT IS MEASURED AGAINST THE SELECTION, NOT AGAINST THE SPEED.
 *
 * Michael left this open on 2026-08-23: `PUMP_RUNOUT` fired on the app's own
 * `Tutorial 01 - Basics` while the pump was at about 99% of design flow and
 * the limit was 120%.
 *
 * `pctOfDesign` divided by the SCALED curve's Qd. A pump held at part speed by
 * a controller has a scaled duty point below its rated one, so the same flow
 * reads as a larger fraction of it — PMP-01 carried 2.3789 L/s against a
 * 2.4001 L/s design (99.1%), the loop had it at 81.3% speed, and
 * 2.3789 / (0.813 x 2.4001) = 121.9%. Every controlled pump that slowed down
 * raised a runout it was nowhere near.
 *
 * A pump delivering LESS than its design flow is not in runout, whatever speed
 * it is turning at. `beyondCurve` is the scaled-curve statement and stays that
 * way: past the end of the curve AS RUN, the point cannot be delivered at this
 * speed.
 * ================================================================== */
section('Pump runout is measured against the rated duty, not the scaled one');
{
  /* One pump, one terminal, and the pump deliberately run SLOW so the rated
   * and scaled duty points are far apart. */
  function rig(speed) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.warn.pumpRunout = 120;
    const lv = m.levels[0];
    const a = M.addNode(m, lv, 0, 0);
    const b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0);
    a.device = { kind: 'source', head: 0 };
    c.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3 };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump', tag: 'PMP-01' });
    pump.pump = { mode: 'fixed', head: 30, sizing: 'manual', speed: speed,
                  qDesign: 0.020, hDesign: 30, curve: P.singlePoint(30, 0.020) };
    M.addPipe(m, b.id, c.id, { size: 'DN100', schedule: 'sch40' });
    return { m, pump };
  }

  const slow = rig(0.6);
  const res = NET.solveModel(slow.m);
  const row = (res.simulation.pumps || []).filter(p => p.pipe === slow.pump.id)[0];
  ok('the pump row is reported', !!row);

  const q = Math.abs(res.flow[slow.pump.id] || 0);
  const ratedQd = slow.pump.pump.curve.Qd;
  near('percent of design is measured against the RATED duty',
       row.pctOfDesign, q / ratedQd, 1e-12);

  /* And it is NOT the scaled figure, which is what the bug reported. The two
   * differ by exactly the speed, so this is a real distinction on this rig. */
  const scaled = q / (ratedQd * row.speed);
  ok('...which is not the scaled-curve figure', Math.abs(row.pctOfDesign - scaled) > 0.1,
     'rated ' + row.pctOfDesign.toFixed(4) + ' vs scaled ' + scaled.toFixed(4));

  /* THE POINT OF THE WHOLE THING: a pump below its design flow is never in
   * runout, however slowly it is being asked to turn. */
  ok('the pump is below its design flow', row.pctOfDesign < 1,
     (row.pctOfDesign * 100).toFixed(2) + '%');
  ok('...and raises no runout',
     !(res.warnings || []).some(w => w.code === 'PUMP_RUNOUT'),
     JSON.stringify((res.warnings || []).filter(w => w.code === 'PUMP_RUNOUT')));

  /* The warning still WORKS — this is not a fix that just switched it off.
   * At full speed the same circuit takes the pump out past 120%. */
  const fast = rig(1);
  fast.m.settings.warn.pumpRunout = 100;
  const fres = NET.solveModel(fast.m);
  const frow = (fres.simulation.pumps || []).filter(p => p.pipe === fast.pump.id)[0];
  ok('at full speed the pump is past its design flow', frow.pctOfDesign > 1,
     (frow.pctOfDesign * 100).toFixed(2) + '%');
  ok('...and the runout warning fires',
     (fres.warnings || []).some(w => w.code === 'PUMP_RUNOUT'));

  /* The message must quote the SAME number it judged on — that discrepancy is
   * what made the original report so hard to believe. */
  const w = (fres.warnings || []).filter(x => x.code === 'PUMP_RUNOUT')[0];
  near('the warning quotes the percentage it judged on',
       w.pct, frow.pctOfDesign * 100, 1e-9);
  ok('...and the message text agrees with it',
     w.message.indexOf(w.pct.toFixed(1) + '% of design flow') >= 0, w.message);
}

/* ==================================================================
 * TEE.1 IN SIMULATION — THE FLOW-RATIO BRANCH COEFFICIENT UNDER CONTROL
 *
 * `docs_internal/TEE-LOSSES.md` option C makes the tee BRANCH coefficient a
 * function of Qb/Qc on the Darcy path. It was measured in DESIGN, where the
 * two-pass loop derives the ratio once from the previous pass and settles.
 * SIMULATION is the harder case and is what this section covers:
 *
 *   * the control loop re-runs the whole core for every trial valve position
 *     and every trial pump speed, so the coefficient is re-derived hundreds of
 *     times and the SEARCH runs against a system whose resistance moves with it;
 *   * a controlled valve is the one thing in the program that deliberately
 *     drives a branch towards zero flow, which is exactly where the
 *     common-to-leg frame conversion runs away — the (Qc/Qb)^2 term that gave
 *     one data-hall fitting rK = 4.3e9 before the clamp went in.
 *
 * The clamp is the table's own lower bound: Idel'chik starts at Qb/Qc = 0.1,
 * `branchK` already clamps zeta there, and the conversion is clamped at the
 * same place so the two agree about where the data stops.
 * ================================================================== */
section('The tee branch coefficient holds together in SIMULATION');
{
  /* A tee with ONE fitting on the branch and nothing else on that pipe, so the
   * link's whole rK is the tee and can be checked against hand arithmetic.
   *
   *   source -- PUMP -- b ----- T ----- c  (run, terminal)
   *                             |
   *                             d  (branch, DN50)
   *                             |  BV-01
   *                             e  (terminal)
   *
   * b-T and T-c are collinear, so they are the RUN and T-d is the BRANCH.
   * T-d and d-e are collinear too, so node d carries no bend and the branch
   * pipe is charged the tee and nothing besides. */
  function rig(opening, method) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.frictionMethod = method || 'DW';
    const lv = m.levels[0];
    const N = (x, y) => M.addNode(m, lv, x, y);
    const a = N(0, 0), b = N(1, 0), t = N(11, 0), c = N(21, 0), d = N(11, 10), e = N(11, 20);
    a.device = { kind: 'source', head: 0 };
    c.device = { kind: 'demand', flow: 0.020, reqPressure: 100e3 };
    e.device = { kind: 'demand', flow: 0.010, reqPressure: 100e3 };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump', tag: 'PMP-01' });
    pump.pump = { mode: 'fixed', head: 40, sizing: 'manual',
                  qDesign: 0.030, hDesign: 40, curve: P.singlePoint(40, 0.030) };
    M.addPipe(m, b.id, t.id, { size: 'DN100', schedule: 'sch40' });
    M.addPipe(m, t.id, c.id, { size: 'DN100', schedule: 'sch40' });
    const br = M.addPipe(m, t.id, d.id, { size: 'DN50', schedule: 'sch40' });
    const v = M.addPipe(m, d.id, e.id, { kind: 'valve', tag: 'BV-01' });
    v.valve = { type: 'globe', kv: FD.valves.defaultKv('globe', 52.48), opening: opening };
    return { m, pump, br, tee: t };
  }

  function run(opening, method) {
    const r = rig(opening, method);
    const res = NET.solveModel(r.m);
    const link = (res.network.links || []).filter(l => l.id === r.br.id)[0] || {};
    let qRatio = null;
    NET.fittingsAtNode(r.m, r.tee.id, res.flow, []).forEach(f => {
      if (f.pipe === r.br.id && f.qRatio !== undefined) qRatio = f.qRatio;
    });
    return { res, link, qRatio, branchQ: Math.abs(res.flow[r.br.id] || 0),
             totalQ: Math.abs(res.flow[r.pump.id] || 0) };
  }

  /* ---- the hand calculation the clamped branch must reproduce -------------
   * DN50 sch40 bore 52.48 mm in a DN100 sch40 common of 102.26 mm, so
   *   Fb/Fc = (52.48/102.26)^2 = 0.263376
   * On Diagram 7-25 at Qb/Qc = 0.1 the rows either side are 0.19 -> 1.41 and
   * 0.27 -> 1.37, and 0.263376 sits (0.263376-0.19)/0.08 = 0.91720 along, so
   *   zeta_c = 1.41 + (1.37 - 1.41)(0.91720) = 1.373312
   * Converted out of the common-channel frame at the clamped ratio,
   *   K_leg = zeta_c (Fb/Fc / 0.1)^2 = 1.373312 x 2.633759^2 = 9.526237
   * and on a 52.48 mm bore that is
   *   rK = K_leg / (2g A^2) = 103768.9  [s^2/m^5]                          */
  const d100 = FD.schedules.size('sch40', 'DN100').id_mm;
  const d50 = FD.schedules.size('sch40', 'DN50').id_mm;
  const aRatio = Math.pow(d50 / d100, 2);
  near('the area ratio comes off the bores', aRatio, 0.263376, 1e-6);
  const zClamp = FD.tees.branchK(0.1, aRatio, true);
  near('zeta_c at the table bound', zClamp, 1.373312, 1e-6);
  const kClamp = zClamp * Math.pow(aRatio / 0.1, 2);
  near('...converted into the branch frame', kClamp, 9.526237, 1e-5);
  const rkClamp = FD.hydraulics.fittingR(kClamp, d50 / 1000);
  near('...as a resistance', rkClamp, 103768.9, 0.1);

  /* THE COEFFICIENT IS LIVE IN SIMULATION, not frozen at the design ratio.
   * Wide open the branch takes about a quarter of the flow and is charged a
   * few velocity heads; throttled it is charged the clamped value, which is
   * larger by more than a factor of four. A flat coefficient gives one number
   * at both ends, so this difference IS the feature. */
  const wide = run(100), shut = run(1);
  ok('wide open, the branch is well inside the table',
     wide.qRatio > 0.1 && wide.qRatio < 1, String(wide.qRatio));
  ok('throttled, the branch is below the table bound',
     shut.qRatio < 0.1, String(shut.qRatio));
  ok('the charged resistance moves with the flow ratio',
     shut.link.rK > wide.link.rK * 4,
     wide.link.rK + ' -> ' + shut.link.rK);

  /* THE CLAMP. Below Qb/Qc = 0.1 there is no data, so every ratio under it is
   * charged as if it were 0.1 — the same bound `branchK` already applies to
   * zeta. Three openings two orders of magnitude apart must give the SAME
   * resistance, and it must be the hand figure above. */
  const tiny = [1, 0.5, 0.1].map(o => run(o));
  tiny.forEach((r, i) => {
    near('the clamped branch is charged the table bound (opening ' +
         [1, 0.5, 0.1][i] + '%)', r.link.rK, rkClamp, 1);
  });
  ok('...and the branch flow really did fall two orders of magnitude',
     tiny[2].branchQ < tiny[0].branchQ / 5,
     tiny[0].branchQ + ' -> ' + tiny[2].branchQ);

  /* THE RUNAWAY THAT THE CLAMP EXISTS TO STOP. Without it the conversion
   * multiplies by (Qc/Qb)^2, which is unbounded — the data-hall fitting that
   * reached rK = 4.3e9 had Qb/Qc = 0.0002. Here the ratio falls to about 6e-5
   * and the resistance does not move at all. */
  ok('a branch approaching zero flow does not run away',
     tiny[2].link.rK < 2 * rkClamp, String(tiny[2].link.rK));
  tiny.concat([wide, shut]).forEach(r => {
    ok('every throttled case still converges', r.res.converged === true);
    ok('...with no fitting oscillation',
       !(r.res.warnings || []).some(w => w.code === 'FITTING_OSCILLATION'));
  });

  /* A SHUT VALVE IS NOT A SPECIAL CASE. `CLOSED_R` still passes a trickle, so
   * the branch never reaches exactly zero and never falls through to the flat
   * coefficient — the resistance is the same clamped value as at 0.1% open. */
  const closed = run(0);
  ok('a fully shut branch valve is reported', (closed.res.warnings || [])
     .some(w => w.code === 'VALVE_SHUT'));
  near('...and the tee behind it is still charged the clamped value',
       closed.link.rK, rkClamp, 1);

  /* OPTION C: HAZEN-WILLIAMS IS NOT TOUCHED. On the equivalent-length path the
   * fitting is folded into the pipe, there is no separate rK to make
   * flow-dependent, and the charged equivalent length is the same whatever the
   * branch is carrying. */
  const hwWide = run(100, 'HW'), hwShut = run(1, 'HW');
  ok('Hazen-Williams carries no separate fitting resistance',
     !(hwWide.link.rK > 0) && !(hwShut.link.rK > 0),
     hwWide.link.rK + ' / ' + hwShut.link.rK);
  near('...and its equivalent length does not move with the flow ratio',
       hwShut.link._el, hwWide.link._el, 1e-12);
  ok('...which is a real equivalent length, not an absent one',
     hwWide.link._el > 0, String(hwWide.link._el));
  ok('...while the Darcy branch resistance did move',
     shut.link.rK !== wide.link.rK);
}

/* ==================================================================
 * AND ON A REAL MODEL WITH A CONTROL LOOP.
 *
 * The rig above sets valve positions by hand. This is the thing the handover
 * asked for: a variable-primary high rise where 11 controlled valves and a
 * pressure-controlled pump are all searched at once, with the branch
 * coefficient re-derived inside every trial solve.
 * ================================================================== */
section('The control loop settles with the flow-ratio coefficient live');
{
  const file = __dirname + '/fixtures/highrise-variable-primary.pnet.json';
  function solve(maxPasses) {
    const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    m.settings.frictionMethod = 'DW';
    m.settings.calcMode = 'simulation';
    const res = NET.solveModel(m, maxPasses);
    let q = 0;
    m.pipes.forEach(p => {
      if (p.kind === 'pump' && p.pump && p.pump.mode !== 'off') q += Math.abs(res.flow[p.id] || 0);
    });
    return { res, q };
  }

  const a = solve();
  ok('the simulation converges', a.res.converged === true);
  const bad = (a.res.warnings || []).filter(w =>
    w.code === 'FITTING_OSCILLATION' || w.code === 'CONTROL_BUDGET' ||
    w.code === 'CONTROL_HUNTING');
  ok('nothing oscillates, hunts or runs out of budget', bad.length === 0,
     bad.map(w => w.code).join(','));

  /* A FITTING SET CANNOT ADD ENERGY. Idel'chik's converging-branch zeta is
   * negative at low flow ratios — real physics, and this model evaluates it
   * on well over a hundred branch legs — but a link whose total minor loss
   * came out negative would be a pump made of pipe. */
  const negative = (a.res.network.links || []).filter(l => (l.rK || 0) < 0);
  ok('no link ends up with a negative fitting resistance', negative.length === 0,
     negative.map(l => l.id).join(','));

  /* THE FROZEN COEFFICIENT REACHES A FIXED POINT. Each pass derives the ratio
   * from the previous pass's flows, so the question is whether more passes
   * keep moving the answer. Doubling the ceiling must change nothing. */
  const b = solve(10);
  ok('doubling the pass ceiling does not move the answer',
     Math.abs(b.q - a.q) / a.q < 1e-9,
     (a.q * 1000).toFixed(6) + ' vs ' + (b.q * 1000).toFixed(6) + ' L/s');
  ok('...and it did not need the extra passes', b.res.passes <= 5,
     String(b.res.passes));
}

/* ==================================================================
 * DP.1 — A dP SETPOINT EQUAL TO THE MACHINE'S RATING DELIVERS RATED FLOW.
 *
 * Michael, 2026-08-31, from the data hall and the high rise: "IRL, we place a
 * DP sensor across the most remote HX to hold that 200 kPa DP, ensuring flow is
 * sufficient... Right now, simulation requires ~+50 kPa from HX design setpoint
 * or there is insufficient flow."
 *
 * He was right about the cause. The dP sensor spans the EQUIPMENT LINK, and an
 * integrated control valve sits on that same link, so `measure()` reads coil AND
 * valve. While `pdRated` meant the coil ALONE, a setpoint equal to the rating
 * could never deliver rated flow — it was short by exactly the valve's drop.
 * Measured before the fix: 200 kPa gave the coil 181 kPa and 95.1% flow, and
 * the setpoint had to reach 220 kPa, which is 200 plus the valve's 20.3 kPa at
 * full travel.
 *
 * `pdRated` is now the TOTAL for the branch. This pins the consequence.
 * ================================================================== */
section('A dP setpoint equal to the rating delivers rated flow');
{
  const file = __dirname + '/fixtures/highrise-variable-primary.pnet.json';
  function atSetpoint(kPa) {
    const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    m.settings.calcMode = 'simulation';
    m.pipes.filter(p => p.id === 'P180')[0].sensor.dpSet = kPa * 1000;
    const res = NET.solveModel(m);
    const eq = m.pipes.filter(p => p.id === 'P167')[0];
    return {
      res, eq,
      q: Math.abs(res.flow.P167 || 0),
      frac: Math.abs(res.flow.P167 || 0) / eq.equip.qRated,
      open: eq.equip.icv.opening,
      lost: (res.errors || []).some(e => e.code === 'SETPOINT_LOST')
    };
  }

  /* AHU-10 is rated 200 kPa and the sensor spans it. Setting the sensor to that
   * rating must now give the machine its rated flow, with its own valve wide
   * open — which is what the index terminal does in a real plant. */
  const at = atSetpoint(200);
  ok('the equipment the sensor spans is rated 200 kPa',
     at.eq.equip.pdRated === 200000, String(at.eq.equip.pdRated));
  near('a setpoint equal to the rating gives rated flow', at.frac, 1, 0.01);
  ok('...with the machine’s own valve at full travel', at.open >= 99,
     String(at.open));
  ok('...and no setpoint is lost', at.lost === false);

  /* NOT SWITCHED OFF. Below the rating the machine really is starved and must
   * still say so — the check that stops this becoming a fix that just silences
   * the message. */
  const low = atSetpoint(170);
  ok('below the rating the flow really does fall short', low.frac < 0.97,
     (low.frac * 100).toFixed(1) + '%');
  ok('...and the setpoint is reported lost', low.lost === true);

  /* ABOVE the rating the surplus is burned by the valve, which throttles. That
   * is the behaviour Michael described seeing at 250 kPa on the data hall. */
  const high = atSetpoint(250);
  ok('above the rating the valve throttles to absorb the surplus', high.open < 90,
     String(high.open));
  near('...and the flow stays at rated', high.frac, 1, 0.01);
}

/* ==================================================================
 * A ZERO MINIMUM VALVE OPENING — Michael, 2026-08-31: "Settings > Setpoint
 * Control: Allow Minimum Valve Opening 0%. Right now min 1%."
 *
 * The floor used to be rejected unless it was strictly above zero, so a valve
 * could never be driven fully shut by the control loop however the setting was
 * typed. A valve that may close completely is a real control strategy.
 * ================================================================== */
section('The control loop accepts a 0% minimum valve opening');
{
  /* THE FLOOR HAS TO BIND for the change to be visible, and this rig makes it
   * bind. An exchanger holds its DESIGN ΔT, and design ΔT = duty/(rho.c.qRated).
   * 2 kW across 0.05 L/s is 9.6 K, which the circuit can only reach by
   * throttling hard — the loop wants about 6% open. So a 10% floor makes the
   * setpoint unreachable while a 0% floor does not, which is the whole of it. */
  function rig(minOpening) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.control = { minSpeed: 0.25, minOpening: minOpening, tol: 0.05,
                           maxSolves: 0, sweeps: 10 };
    m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200,
                           overloadPct: 10 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 20, 0), d = M.addNode(m, lv, 22, 0);
    const e = M.addNode(m, lv, 22, 10);
    a.device = { kind: 'source', head: 400e3, temperature: 6 };
    e.device = { kind: 'demand', flow: 0.004, reqPressure: 50e3, include: true };
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump', tag: 'PMP' });
    pump.pump = { mode: 'fixed', head: 30, sizing: 'manual', speed: 1,
                  qDesign: 0.004, hDesign: 30, curve: P.singlePoint(30, 0.004) };
    M.addPipe(m, b.id, c.id, { size: 'DN50', schedule: 'sch40' });
    const valve = M.addPipe(m, c.id, d.id, { size: 'DN50', kind: 'valve', tag: 'CV' });
    valve.valve = { type: 'globe', kv: 16, opening: 100 };
    const coil = M.addPipe(m, d.id, e.id, { size: 'DN50', kind: 'equip', tag: 'AHU' });
    coil.equip = { qRated: 5e-5, pdRated: 20e3, qOut: 5e-5,
                   equipType: 'exchanger', duty: 2000 };
    valve.valve.control = { equip: coil.id, key: 'dT' };
    m.pipes.forEach(p => { if (p.kind !== 'equip') p.insulation_mm = 0; });
    return { m, valve, coil };
  }
  const lost = r => (r.errors || []).some(e => e.code === 'SETPOINT_LOST');

  /* A ZERO FLOOR IS READ, not replaced by the 10% default. It used to fail the
   * `> 0` test, so a valve could never be driven below 10% however the setting
   * was typed. */
  const zero = rig(0);
  const rz = NET.solveModel(zero.m);
  ok('a 0% floor solves', rz.converged === true, JSON.stringify(rz.errors));
  ok('...and the valve settles below the old 10% default',
     zero.valve.valve.opening < 10, zero.valve.valve.opening + '% open');
  ok('...without going negative', zero.valve.valve.opening >= 0,
     String(zero.valve.valve.opening));
  ok('...and it holds its setpoint there', !lost(rz),
     JSON.stringify((rz.errors || []).map(e => e.code)));

  /* THE SAME PLANT AT THE OLD FLOOR CANNOT. This is the assertion that says the
   * change is worth something rather than cosmetic: the setpoint is reachable
   * at 6% and not at 10%, so the floor decides whether the model works. */
  const ten = rig(10);
  const r10 = NET.solveModel(ten.m);
  ok('the same plant at a 10% floor loses the setpoint', lost(r10),
     JSON.stringify((r10.errors || []).map(e => e.code)));

  /* AND A NON-ZERO FLOOR IS STILL HONOURED — this is not "the floor is now
   * ignored". A device that loses its setpoint is parked at full travel, which
   * is the documented rule, so what is checked is that it never rests BETWEEN
   * zero and its floor. */
  ok('a valve never rests inside its own floor',
     ten.valve.valve.opening === 100 || ten.valve.valve.opening >= 10,
     ten.valve.valve.opening + '% open');
}

/* ==================================================================
 * AUTOMATIC dP SETPOINT — reset, in the trade sense.
 *
 * Michael, 2026-08-31, on Tutorial 2 at part load: "The intended end state of
 * this scenario is for the CV to be near 100% open, and the VFD ramp down
 * further."
 *
 * A FIXED setpoint cannot do that, and it is not a fault: a pump holding a
 * constant differential holds it at every load, so a part-loaded coil throttles
 * its valve and stays throttled while the surplus pressure is burned across it.
 * On Auto the solve lowers the setpoint until the most open valve is nearly
 * wide open and lets the pump follow it down.
 * ================================================================== */
section('Automatic dP setpoint');
{
  /* FROZEN INTO `test/fixtures/`, not read from `debug/`. Michael's working
   * folder is gitignored, so a test that reached into it would pass here and
   * fail on a clean checkout — and CI gates the Pages deploy. This is the
   * standing rule for any of his drawings that produces a fix. */
  const file = __dirname + '/fixtures/tutorial2-partload.pnet.json';
  {
    function run(loadPct, auto) {
      const m = M.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
      m.pipes.forEach(p => {
        if (p.kind === 'equip' && p.equip.equipType === 'exchanger') {
          p.equip.loadPct = loadPct;
        }
      });
      const sn = m.pipes.filter(p => p.id === 'P151')[0].sensor;
      if (auto) sn.autoSet = true; else delete sn.autoSet;
      const res = NET.solveModel(m);
      const opens = m.pipes.filter(p => p.kind === 'equip' &&
        p.equip.equipType === 'exchanger').map(p => p.equip.icv.opening);
      return {
        res, sn, opens,
        maxOpen: Math.max(...opens),
        speed: m.pipes.filter(p => p.id === 'P26')[0].pump.speed,
        dT: res.thermal.links.P117.dT,
        lost: (res.errors || []).some(e => e.code === 'SETPOINT_LOST')
      };
    }

    /* AT PART LOAD, FIXED, the valves throttle and stay throttled. This is the
     * state Michael reported: 79% load, valves near 76%, pump near 87%. */
    const fixed = run(79, false);
    ok('fixed: the valves are throttled well short of open', fixed.maxOpen < 85,
       fixed.opens.join(','));
    ok('fixed: every coil still holds its ΔT', !fixed.lost);
    near('fixed: the setpoint is the one that was typed',
         fixed.sn.dpSet, 110e3, 1);
    ok('fixed: nothing is written to the auto figure',
       fixed.sn.dpAuto === undefined, String(fixed.sn.dpAuto));

    /* ON AUTO, the same plant opens its valves and slows its pump. */
    const auto = run(79, true);
    ok('auto: the most open valve reaches the target', auto.maxOpen >= 95,
       auto.opens.join(','));
    ok('auto: the pump runs slower than it did', auto.speed < fixed.speed,
       fixed.speed + ' -> ' + auto.speed);
    ok('auto: every coil still holds its ΔT', !auto.lost,
       JSON.stringify((auto.res.errors || []).map(e => e.code)));
    near('auto: ...and holds it at the design 7.5 K', auto.dT, 7.5, 0.15);

    /* THE TYPED FIGURE IS NEVER OVERWRITTEN. It is the design differential and
     * the ceiling the search starts from, and it must survive so switching Auto
     * off restores it. */
    near('auto: the typed setpoint is untouched', auto.sn.dpSet, 110e3, 1);
    ok('auto: the chosen setpoint is below it',
       auto.sn.dpAuto < auto.sn.dpSet, (auto.sn.dpAuto / 1000).toFixed(1) + ' kPa');
    ok('auto: ...and above the search floor',
       auto.sn.dpAuto > auto.sn.dpSet * 0.05,
       (auto.sn.dpAuto / 1000).toFixed(1) + ' kPa');

    /* IT TRACKS THE LOAD, which is the whole point: the lighter the load, the
     * lower the setpoint the plant can hold. */
    const light = run(40, true);
    ok('a lighter load chooses a lower setpoint still',
       light.sn.dpAuto < auto.sn.dpAuto,
       (auto.sn.dpAuto / 1000).toFixed(1) + ' -> ' + (light.sn.dpAuto / 1000).toFixed(1) + ' kPa');
    ok('...with the valves still near open', light.maxOpen >= 90,
       light.opens.join(','));
    ok('...and the pump slower again', light.speed < auto.speed,
       auto.speed + ' -> ' + light.speed);

    /* SWITCHING AUTO OFF CLEARS THE ANSWER, so a stale figure cannot be shown
     * beside a setting that is no longer on. */
    const back = run(79, false);
    ok('switching Auto off clears the chosen figure',
       back.sn.dpAuto === undefined, String(back.sn.dpAuto));
  }
}


report();
