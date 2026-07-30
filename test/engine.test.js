/* FreePipeCalc — engine tests.
 * Every expected value here is an independent hand calculation, not a value
 * copied back out of the code. Run:  node test/engine.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load();

const HW_N = 1.852;
const RHO_G = 998 * 9.81;

// Independent re-implementation of Hazen-Williams for cross-checking.
function hwHead(L, d, C, Q) {
  return 10.67 * L * Math.pow(Q, HW_N) / (Math.pow(C, HW_N) * Math.pow(d, 4.8704));
}

// ---------------------------------------------------------------- data
section('Pipe schedules');
{
  const s40 = FD.schedules.get('sch40');
  near('Sch40 DN50 bore = 60.30 − 2×3.91', FD.schedules.size('sch40', 'DN50').id_mm, 52.48, 0.005);
  near('Sch40 DN100 bore', FD.schedules.size('sch40', 'DN100').id_mm, 102.26, 0.005);
  near('EN 10255 Medium DN50 bore', FD.schedules.size('en10255m', 'DN50').id_mm, 53.0, 0.005);
  near('HDPE SDR11 110 mm bore = 110 − 2×10', FD.schedules.size('hdpe_sdr11', '110 mm').id_mm, 90.0, 0.005);
  near('PPR PN20 32 mm bore', FD.schedules.size('ppr_pn20', '32 mm').id_mm, 21.2, 0.005);
  ok('Schedules are ordered smallest-first',
     s40.sizes.every((s, i) => i === 0 || s.id_mm > s40.sizes[i - 1].id_mm));
  ok('Copper is not a built-in schedule (spec §9)',
     !Object.keys(FD.schedules.builtin).some(k => /copper/i.test(k)));

  ok('Size step clamps at the top', FD.schedules.step('sch40', 'DN300', +5) === 'DN300');
  ok('Size step clamps at the bottom', FD.schedules.step('sch40', 'DN15', -5) === 'DN15');
  ok('Size step moves one size up', FD.schedules.step('sch40', 'DN50', +1) === 'DN65');
}

section('Fitting equivalent lengths');
{
  // Flat L/D basis per spec §3.3 — no size correction (see spec Q12.1)
  const e90 = FD.fittings.el('E90', 52.48);
  near('E90 on DN50 = exactly 30·D', e90, 30 * 0.05248, 1e-12);
  near('E45 on DN50 = exactly 16·D', FD.fittings.el('E45', 52.48), 16 * 0.05248, 1e-12);
  near('Tee-run on DN50 = exactly 20·D', FD.fittings.el('TRUN', 52.48), 20 * 0.05248, 1e-12);
  const tbr = FD.fittings.el('TBRANCH', 52.48);
  near('Tee-branch on DN50 = exactly 60·D', tbr, 60 * 0.05248, 1e-12);
  near('Tee-branch is 2× the 90° elbow (60D vs 30D)', tbr / e90, 2.0, 1e-12);
  ok('Tee-run < tee-branch', FD.fittings.el('TRUN', 52.48) < tbr);

  // L/D must be constant across the size range — the correction was removed
  const ld = (d) => FD.fittings.el('E90', d) / (d / 1000);
  near('L/D is flat: DN15 matches DN300', ld(15.76), ld(303.18), 1e-12);
  near('L/D is flat and equals 30', ld(15.76), 30, 1e-12);
  ok('Unknown fitting type contributes no length', FD.fittings.el('NOPE', 52.48) === 0);
  ok('Zero bore contributes no length', FD.fittings.el('E90', 0) === 0);

  ok('0° deviation produces no fitting', FD.fittings.elbowForAngle(2) === null);
  ok('45° deviation → E45', FD.fittings.elbowForAngle(45) === 'E45');
  ok('90° deviation → E90', FD.fittings.elbowForAngle(90) === 'E90');
  ok('80° deviation → E90', FD.fittings.elbowForAngle(80) === 'E90');
  ok('Fitting summary counts duplicates',
     FD.fittings.summarise(['E90', 'E90', 'TBRANCH']) === '2×E90, T-br');
}

// --------------------------------------------------------------- units
section('Units (display layer only)');
{
  near('5 L/s → SI', FD.units.toSIFlow(5, 'L/s'), 0.005, 1e-12);
  near('SI → m³/h', FD.units.flow(0.005, 'm3/h'), 18.0, 1e-9);
  near('1 m head → Pa', FD.units.headToPa(1), RHO_G, 1e-6);
  near('Pa → head round-trip', FD.units.paToHead(FD.units.headToPa(3.7)), 3.7, 1e-9);
  near('100 kPa → psi', FD.units.pressure(100000, 'psi'), 14.5038, 0.001);
  near('400 Pa/m → ft/100ft', FD.units.pdm(400, 'ft/100ft'), 400 / RHO_G * 100, 1e-9);

  near('Parse "1,234.5" (comma thousands)', FD.units.parse('1,234.5'), 1234.5, 1e-9);
  near('Parse "1.234,5" (EU locale)', FD.units.parse('1.234,5'), 1234.5, 1e-9);
  near('Parse "12,5" (EU decimal)', FD.units.parse('12,5'), 12.5, 1e-9);
  near('Parse "3.5 m" with unit suffix', FD.units.parse('3.5 m'), 3.5, 1e-9);
  ok('Parse of junk is NaN', Number.isNaN(FD.units.parse('abc')));
}

// ---------------------------------------------------------- hydraulics
section('Hazen-Williams');
{
  const d = 0.05248, C = 120, L = 100, Q = 0.005;
  const r = FD.hydraulics.methods.HW.r(L, d, C);
  const expected = hwHead(L, d, C, Q);           // ≈ 14.07 m
  near('hf for 100 m DN50 @ 5 L/s (hand calc)', FD.hydraulics.headloss(r, Q, HW_N), expected);
  near('...and that value is ≈14.13 m', expected, 14.130, 0.005);

  ok('Head loss is odd in Q (reverses sign)',
     Math.abs(FD.hydraulics.headloss(r, -Q, HW_N) + expected) < 1e-9);
  near('Doubling length doubles loss',
       FD.hydraulics.headloss(FD.hydraulics.methods.HW.r(2 * L, d, C), Q, HW_N), 2 * expected);

  // dh/dQ must match a numerical derivative
  const h = 1e-9;
  const numeric = (FD.hydraulics.headloss(r, Q + h, HW_N) - FD.hydraulics.headloss(r, Q - h, HW_N)) / (2 * h);
  near('Analytic dh/dQ matches numerical', FD.hydraulics.dhdq(r, Q, HW_N), numeric, numeric * 1e-4);

  near('Velocity of 5 L/s in DN50', FD.hydraulics.velocity(Q, d), Q / (Math.PI * d * d / 4), 1e-9);
  near('...and that is ≈2.31 m/s', FD.hydraulics.velocity(Q, d), 2.312, 0.005);

  // Zero-flow linearisation must be continuous and monotonic
  const tiny = FD.hydraulics.headloss(r, 1e-12, HW_N);
  ok('Loss at ~zero flow is finite and positive', isFinite(tiny) && tiny > 0);
  ok('dh/dQ at zero flow is finite', isFinite(FD.hydraulics.dhdq(r, 0, HW_N)));

  ok('Darcy-Weisbach is available but flagged experimental',
     FD.hydraulics.methods.DW.available === true &&
     FD.hydraulics.methods.DW.experimental === true);

  // Editable coefficients must actually feed through
  const rDefault = FD.hydraulics.methods.HW.r(L, d, C, null);
  const rCustom = FD.hydraulics.methods.HW.r(L, d, C, { hw: { A: 21.34, a: 1.852, b: 1.852, e: 4.8704 } });
  near('Doubling the leading coefficient A doubles r', rCustom, rDefault * 2, 1e-6);
  const rExp = FD.hydraulics.methods.HW.r(L, d, C, { hw: { A: 10.67, a: 1.852, b: 1.852, e: 5 } });
  ok('Changing the diameter exponent changes r', Math.abs(rExp - rDefault) > 1e-6);
  near('Default context matches ASHRAE constants',
       FD.hydraulics.methods.HW.r(L, d, C, { hw: FD.hydraulics.HW_DEFAULTS }), rDefault, 1e-12);
  near('Exponent honours the edited flow exponent',
       FD.hydraulics.exponent('HW', { hw: { A: 10.67, a: 1.9, b: 1.852, e: 4.8704 } }), 1.9, 1e-12);
}

section('Reynolds number and flow regime');
{
  const nu = 1.004e-6, d = 0.05248;
  // v = 1 m/s in 52.48 mm water at 20C -> Re = 1*0.05248/1.004e-6 = 52271
  const q1 = 1.0 * Math.PI * d * d / 4;
  near('Re for 1 m/s in DN50', FD.hydraulics.reynolds(q1, d, nu), d / nu, 1);
  near('...which is about 52 270', FD.hydraulics.reynolds(q1, d, nu), 52271, 5);

  ok('Re 1000 is laminar', FD.hydraulics.isLaminar(1000));
  ok('Re 3000 is transitional', FD.hydraulics.isTransitional(3000));
  ok('Re 50000 is neither laminar nor transitional',
     !FD.hydraulics.isLaminar(50000) && !FD.hydraulics.isTransitional(50000));
  ok('Zero flow is not reported as laminar', !FD.hydraulics.isLaminar(0));
}

section('Darcy friction factors');
{
  /* Reference check: Colebrook at Re = 1e5, ε/d = 0.0001 gives f ≈ 0.0182
   * (standard Moody-chart value). The explicit correlations approximate it. */
  const f = FD.hydraulics.frictionFactor(1e5, 1e-4, 'colebrook');
  near('Colebrook at Re=1e5, e/d=1e-4 ≈ 0.0182', f, 0.0182, 0.0004);

  ['swameejain', 'haaland', 'churchill'].forEach(k => {
    const fk = FD.hydraulics.frictionFactor(1e5, 1e-4, k);
    ok(`${k} is within 3% of Colebrook`, Math.abs(fk - f) / f < 0.03,
       `${k}=${fk.toFixed(5)} vs colebrook=${f.toFixed(5)}`);
  });

  // Smooth pipe, Re = 1e5: Blasius gives f = 0.316·Re^-0.25 = 0.01778
  const fSmooth = FD.hydraulics.frictionFactor(1e5, 1e-8, 'colebrook');
  near('Smooth-pipe Colebrook agrees with Blasius at Re=1e5',
       fSmooth, 0.316 * Math.pow(1e5, -0.25), 0.0008);

  // Laminar branch must be exactly 64/Re
  near('Laminar f = 64/Re', FD.hydraulics.frictionFactor(1000, 1e-4, 'colebrook'), 0.064, 1e-12);

  // Rougher pipe must cost more, and f must fall as Re rises (turbulent)
  ok('Rougher pipe has higher f',
     FD.hydraulics.frictionFactor(1e5, 1e-2, 'colebrook') >
     FD.hydraulics.frictionFactor(1e5, 1e-4, 'colebrook'));
  ok('f decreases with Reynolds number',
     FD.hydraulics.frictionFactor(1e6, 1e-4, 'colebrook') <
     FD.hydraulics.frictionFactor(1e4, 1e-4, 'colebrook'));

  // No correlation may return a nonsense or non-finite value across the range
  Object.keys(FD.hydraulics.frictionFactors).forEach(k => {
    let bad = null;
    [500, 2000, 2500, 3500, 5000, 1e4, 1e5, 1e6, 1e8].forEach(Re => {
      [0, 1e-6, 1e-4, 1e-3, 5e-2].forEach(rr => {
        const v = FD.hydraulics.frictionFactor(Re, rr, k);
        if (!isFinite(v) || v <= 0 || v > 10) bad = `Re=${Re} e/d=${rr} -> ${v}`;
      });
    });
    ok(`${k} is finite and sane across the whole range`, bad === null, bad);
  });
}

section('Darcy-Weisbach resistance');
{
  const d = 0.05248, L = 100, nu = 1.004e-6;
  const q = 0.005;
  const ctx = { fluid: { kinematicViscosity: nu }, roughness_mm: 0.045,
                frictionFactor: 'colebrook', q: q };
  const r = FD.hydraulics.methods.DW.r(L, d, 120, ctx);

  // Hand check: r = 8fL/(pi^2 g d^5)
  const v = q / (Math.PI * d * d / 4);
  const Re = v * d / nu;
  const f = FD.hydraulics.frictionFactor(Re, 0.000045 / d, 'colebrook');
  const rHand = 8 * f * L / (Math.PI * Math.PI * 9.81 * Math.pow(d, 5));
  near('r matches 8fL/(pi^2 g d^5) by hand', r, rHand, rHand * 1e-9);

  const hf = FD.hydraulics.headloss(r, q, 2);
  ok('Darcy head loss is in a plausible range vs Hazen-Williams',
     hf > 8 && hf < 22, hf.toFixed(3) + ' m');

  // The two methods should be in the same ballpark for ordinary water flow
  const hwR = FD.hydraulics.methods.HW.r(L, d, 120, null);
  const hwH = FD.hydraulics.headloss(hwR, q, 1.852);
  ok('Darcy and Hazen-Williams agree within 25% for this case',
     Math.abs(hf - hwH) / hwH < 0.25,
     `DW ${hf.toFixed(2)} m vs HW ${hwH.toFixed(2)} m`);

  ok('Darcy exponent is 2', FD.hydraulics.exponent('DW', ctx) === 2);
  ok('Rougher pipe gives more resistance',
     FD.hydraulics.methods.DW.r(L, d, 120,
       Object.assign({}, ctx, { roughness_mm: 1.5 })) > r);
  ok('Zero-flow context still returns a finite r',
     isFinite(FD.hydraulics.methods.DW.r(L, d, 120,
       Object.assign({}, ctx, { q: 0 }))));
  ok('Missing-flow context still returns a finite r',
     isFinite(FD.hydraulics.methods.DW.r(L, d, 120,
       Object.assign({}, ctx, { q: null }))));
}

section('Fitting K table (ASHRAE)');
{
  // Spot values straight off the transcribed tables
  near('Threaded 90° elbow at DN25 = 1.5', FD.ktable.k('E90', 25, 'threaded'), 1.5, 1e-9);
  near('Threaded 90° elbow at DN50 = 1.0', FD.ktable.k('E90', 50, 'threaded'), 1.0, 1e-9);
  near('Threaded gate valve at DN25 = 0.24', FD.ktable.k('GATE', 25, 'threaded'), 0.24, 1e-9);
  near('Threaded tee-branch at DN50 = 1.4', FD.ktable.k('TBRANCH', 50, 'threaded'), 1.4, 1e-9);
  near('Flanged 90° elbow at DN50 = 0.38', FD.ktable.k('E90', 50, 'flanged'), 0.38, 1e-9);
  near('Flanged tee-branch at DN50 = 0.84', FD.ktable.k('TBRANCH', 50, 'flanged'), 0.84, 1e-9);
  near('Flanged 90° elbow at DN300 = 0.24', FD.ktable.k('E90', 300, 'flanged'), 0.24, 1e-9);

  // Interpolation between tabulated sizes
  const mid = FD.ktable.k('E90', 37, 'threaded');   // between DN32 (1.3) and DN40 (1.2)
  ok('Interpolates between tabulated sizes', mid < 1.3 && mid > 1.2, String(mid));

  // Clamped, not extrapolated, outside the table
  near('Clamps below the smallest size', FD.ktable.k('E90', 5, 'threaded'), 2.5, 1e-9);
  near('Clamps above the largest size', FD.ktable.k('E90', 900, 'threaded'), 0.70, 1e-9);

  // Physical sanity
  ok('Tee-branch costs more than tee-run (threaded)',
     FD.ktable.k('TBRANCH', 50, 'threaded') > FD.ktable.k('TRUN', 50, 'threaded'));
  ok('Globe valve costs far more than a gate valve',
     FD.ktable.k('GLOBE', 50, 'threaded') > 10 * FD.ktable.k('GATE', 50, 'threaded'));
  ok('Flanged fittings are cheaper than threaded',
     FD.ktable.k('E90', 50, 'flanged') < FD.ktable.k('E90', 50, 'threaded'));
  ok('45° elbow costs less than 90° (threaded, derived)',
     FD.ktable.k('E45', 50, 'threaded') < FD.ktable.k('E90', 50, 'threaded'));
  ok('45° elbow costs less than 90° (flanged, transcribed)',
     FD.ktable.k('E45', 50, 'flanged') < FD.ktable.k('E90', 50, 'flanged'));
  ok('Threaded 45° is flagged as derived, not transcribed',
     FD.ktable.isDerived('E45', 'threaded') === true);
  ok('Flanged 45° is NOT flagged derived (it was transcribed)',
     FD.ktable.isDerived('E45', 'flanged') === false);

  // K must fall monotonically with size for elbows
  const sizes = [15, 25, 40, 50, 80, 100];
  const ks = sizes.map(s => FD.ktable.k('E90', s, 'threaded'));
  ok('Threaded elbow K falls monotonically with size',
     ks.every((v, i) => i === 0 || v <= ks[i - 1]), ks.join(','));

  // User override wins over the curve
  near('Override pins K flat', FD.ktable.k('E90', 25, 'threaded', { E90: 0.5 }), 0.5, 1e-12);
  near('Blank override falls back to the curve',
       FD.ktable.k('E90', 25, 'threaded', { E90: '' }), 1.5, 1e-9);

  // K-based head loss: h = K V^2 / 2g, K keyed on NOMINAL size, V on the bore
  const d = 0.05248, q = 0.005;
  const v = q / (Math.PI * d * d / 4);
  const K = FD.ktable.k('E90', 50, 'threaded');
  near('Fitting head loss = K V²/2g',
       FD.fittings.headlossK('E90', 50, 52.48, q, 'threaded', null),
       K * v * v / (2 * 9.81), 1e-9);

  /* Regression: the lookup must use the size DESIGNATION, not the bore.
   * HDPE "110 mm" is an OD with a 90 mm bore — keying on 90 would read the
   * table two rows off. */
  near('Nominal is parsed from a DN label', FD.schedules.nominalMm('DN50'), 50, 1e-12);
  near('Nominal is parsed from a plastics label', FD.schedules.nominalMm('110 mm'), 110, 1e-12);
  const hdpeBore = FD.schedules.size('hdpe_sdr11', '110 mm').id_mm;   // 90 mm
  ok('HDPE 110 mm really does have a 90 mm bore', Math.abs(hdpeBore - 90) < 0.01);
  const kByNominal = FD.ktable.k('E90', 110, 'flanged');
  const kByBore = FD.ktable.k('E90', hdpeBore, 'flanged');
  ok('Keying K on bore vs nominal gives different answers (so it matters)',
     Math.abs(kByNominal - kByBore) > 1e-6, `${kByNominal} vs ${kByBore}`);
}

section('Editable fitting equivalent lengths');
{
  near('Default E90 EL is 30·D', FD.fittings.el('E90', 52.48, null), 30 * 0.05248, 1e-12);
  near('Override changes EL', FD.fittings.el('E90', 52.48, { E90: 60 }), 60 * 0.05248, 1e-12);
  near('Blank override falls back to default',
       FD.fittings.el('E90', 52.48, { E90: '' }), 30 * 0.05248, 1e-12);
  const defs = FD.fittings.defaultLD();
  ok('defaultLD exposes the built-in table', defs.E90 === 30 && defs.TBRANCH === 60);
}

// ------------------------------------------------------------- solver
section('Solver — single pipe');
{
  const d = 0.05248, C = 120, L = 100, Q = 0.005;
  const net = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },     // reservoir, 0 gauge at z=0
      { id: 'B', z: 0, demand: Q, fixedHead: null }
    ],
    links: [{ id: 'p1', from: 'S', to: 'B', kind: 'pipe', n: HW_N,
              r: FD.hydraulics.methods.HW.r(L, d, C) }]
  };
  const res = FD.solver.solve(net);
  ok('Converged', res.ok, JSON.stringify(res.errors));
  near('Flow equals the demand', res.flow.p1, Q, 1e-9);
  near('Head at B = −hf (hand calc)', res.head.B, -hwHead(L, d, C, Q), 1e-4);
  near('Gauge pressure at B', res.pressure.B, -hwHead(L, d, C, Q) * RHO_G, 1);
}

section('Solver — series pipes and static lift');
{
  const d = 0.05248, C = 120, Q = 0.004;
  const r = (L) => FD.hydraulics.methods.HW.r(L, d, C);
  // Elevated tank 20 m up, feeding down 20 m then 50 m horizontally.
  const net = {
    nodes: [
      { id: 'T', z: 20, demand: 0, fixedHead: 20 },
      { id: 'M', z: 0,  demand: 0, fixedHead: null },
      { id: 'D', z: 0,  demand: Q, fixedHead: null }
    ],
    links: [
      { id: 'riser', from: 'T', to: 'M', kind: 'pipe', n: HW_N, r: r(20) },
      { id: 'run',   from: 'M', to: 'D', kind: 'pipe', n: HW_N, r: r(50) }
    ]
  };
  const res = FD.solver.solve(net);
  ok('Converged', res.ok, JSON.stringify(res.errors));
  near('Series flow is continuous', res.flow.riser, res.flow.run, 1e-12);
  near('Flow equals demand', res.flow.run, Q, 1e-9);

  const hf70 = hwHead(70, d, C, Q);
  near('Head at D = 20 m − hf over 70 m', res.head.D, 20 - hf70, 1e-4);
  // Static lift is recovered as pressure: 20 m tank − friction
  near('Gauge pressure at D (hand calc)', res.pressure.D, (20 - hf70) * RHO_G, 2);
  ok('Pressure at D is positive (gravity tank works)', res.pressure.D > 0);
}

section('Solver — parallel loop (unequal legs)');
{
  const C = 120, Q = 0.010;
  const dA = 0.05248, dB = 0.04094;            // DN50 and DN40
  const rA = FD.hydraulics.methods.HW.r(60, dA, C);
  const rB = FD.hydraulics.methods.HW.r(80, dB, C);
  const net = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },
      { id: 'X', z: 0, demand: Q, fixedHead: null }
    ],
    links: [
      { id: 'legA', from: 'S', to: 'X', kind: 'pipe', n: HW_N, r: rA },
      { id: 'legB', from: 'S', to: 'X', kind: 'pipe', n: HW_N, r: rB }
    ]
  };
  const res = FD.solver.solve(net);
  ok('Converged', res.ok, JSON.stringify(res.errors));

  const qa = res.flow.legA, qb = res.flow.legB;
  near('Continuity: legs sum to the demand', qa + qb, Q, 1e-9);
  ok('Larger/shorter leg carries more flow', qa > qb, `legA=${qa}, legB=${qb}`);

  // Loop closure: head loss must be identical down both legs
  const hA = FD.hydraulics.headloss(rA, qa, HW_N);
  const hB = FD.hydraulics.headloss(rB, qb, HW_N);
  near('Loop closure residual ≈ 0', hA - hB, 0, 1e-6);

  // Cross-check the split against the closed-form solution
  //   rA·qa^n = rB·qb^n  and  qa+qb=Q  →  qa = Q / (1 + (rA/rB)^(1/n))
  const ratio = Math.pow(rA / rB, 1 / HW_N);
  near('Split matches closed-form', qa, Q / (1 + ratio), 1e-7);
}

section('Solver — pump');
{
  const d = 0.05248, C = 120, Q = 0.005;
  const r = FD.hydraulics.methods.HW.r(100, d, C);
  const net = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },
      { id: 'P', z: 0, demand: 0, fixedHead: null },
      { id: 'D', z: 0, demand: Q, fixedHead: null }
    ],
    links: [
      { id: 'pump', from: 'S', to: 'P', kind: 'pump', head: 30 },
      { id: 'pipe', from: 'P', to: 'D', kind: 'pipe', n: HW_N, r: r }
    ]
  };
  const res = FD.solver.solve(net);
  ok('Converged', res.ok, JSON.stringify(res.errors));
  near('Pump raises head by 30 m', res.head.P - res.head.S, 30, 0.01);
  near('Head at D = 30 − hf', res.head.D, 30 - hwHead(100, d, C, Q), 0.01);
  ok('Pump makes the delivery pressure positive', res.pressure.D > 0);
}

section('Solver — degenerate cases');
{
  const r = FD.hydraulics.methods.HW.r(10, 0.05248, 120);

  // Closed loop, no demand → zero flow is the valid answer
  const ring = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },
      { id: 'A', z: 0, demand: 0, fixedHead: null },
      { id: 'B', z: 0, demand: 0, fixedHead: null }
    ],
    links: [
      { id: 'l1', from: 'S', to: 'A', kind: 'pipe', n: HW_N, r },
      { id: 'l2', from: 'A', to: 'B', kind: 'pipe', n: HW_N, r },
      { id: 'l3', from: 'B', to: 'S', kind: 'pipe', n: HW_N, r }
    ]
  };
  const res1 = FD.solver.solve(ring);
  ok('Ring with no demand converges', res1.ok, JSON.stringify(res1.errors));
  ok('...with ~zero flow everywhere',
     ['l1', 'l2', 'l3'].every(k => Math.abs(res1.flow[k]) < 1e-6),
     JSON.stringify(res1.flow));

  // Island with demand but no source → reported, not crashed
  const orphan = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },
      { id: 'A', z: 0, demand: 0.001, fixedHead: null },
      { id: 'Z1', z: 0, demand: 0.002, fixedHead: null },
      { id: 'Z2', z: 0, demand: 0, fixedHead: null }
    ],
    links: [
      { id: 'l1', from: 'S', to: 'A', kind: 'pipe', n: HW_N, r },
      { id: 'l9', from: 'Z1', to: 'Z2', kind: 'pipe', n: HW_N, r }
    ]
  };
  const res2 = FD.solver.solve(orphan);
  ok('Orphan island is reported as an error',
     res2.errors.some(e => e.code === 'ISLAND_NO_SOURCE'), JSON.stringify(res2.errors));
  ok('...and the connected part still solves',
     Math.abs(res2.flow.l1 - 0.001) < 1e-9, `l1=${res2.flow.l1}`);
  ok('...and the orphan carries zero flow', res2.flow.l9 === 0);

  // Zero demand on a live network
  const idle = {
    nodes: [
      { id: 'S', z: 0, demand: 0, fixedHead: 0 },
      { id: 'A', z: 0, demand: 0, fixedHead: null }
    ],
    links: [{ id: 'l1', from: 'S', to: 'A', kind: 'pipe', n: HW_N, r }]
  };
  const res3 = FD.solver.solve(idle);
  ok('Idle network converges', res3.ok);
  ok('...with no flow', Math.abs(res3.flow.l1) < 1e-6);
  near('...and static head carried to the dead end', res3.head.A, 0, 1e-6);
}

section('Solver — multiple sources');
{
  const r = FD.hydraulics.methods.HW.r(50, 0.05248, 120);
  const net = {
    nodes: [
      { id: 'S1', z: 10, demand: 0, fixedHead: 10 },
      { id: 'S2', z: 10, demand: 0, fixedHead: 10 },
      { id: 'D',  z: 0,  demand: 0.008, fixedHead: null }
    ],
    links: [
      { id: 'a', from: 'S1', to: 'D', kind: 'pipe', n: HW_N, r },
      { id: 'b', from: 'S2', to: 'D', kind: 'pipe', n: HW_N, r }
    ]
  };
  const res = FD.solver.solve(net);
  ok('Converged', res.ok, JSON.stringify(res.errors));
  near('Identical sources split the flow evenly', res.flow.a, res.flow.b, 1e-9);
  near('Total equals demand', res.flow.a + res.flow.b, 0.008, 1e-9);
}

section('Solver — larger looped grid (mass balance)');
{
  // 3×3 grid of junctions, one source, scattered demands. No hand solution —
  // the check is that continuity holds exactly at every node.
  const r = FD.hydraulics.methods.HW.r(25, 0.077922, 120);   // DN80
  const nodes = [{ id: 'S', z: 0, demand: 0, fixedHead: 25 }];
  const links = [];
  for (let i = 0; i < 9; i++) {
    nodes.push({ id: 'n' + i, z: 0, demand: (i % 3 === 0 ? 0.0015 : 0.0005), fixedHead: null });
  }
  const at = (row, col) => 'n' + (row * 3 + col);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (col < 2) links.push({ id: `h${row}${col}`, from: at(row, col), to: at(row, col + 1), kind: 'pipe', n: HW_N, r });
      if (row < 2) links.push({ id: `v${row}${col}`, from: at(row, col), to: at(row + 1, col), kind: 'pipe', n: HW_N, r });
    }
  }
  links.push({ id: 'feed', from: 'S', to: 'n0', kind: 'pipe', n: HW_N, r });

  const res = FD.solver.solve({ nodes, links });
  ok('Converged', res.ok, JSON.stringify(res.errors));
  ok(`...in ${res.iterations} iterations (< 100)`, res.iterations < 100);

  const bal = {};
  nodes.forEach(nd => { bal[nd.id] = 0; });
  links.forEach(l => { bal[l.from] -= res.flow[l.id]; bal[l.to] += res.flow[l.id]; });
  let worst = 0, worstNode = null;
  nodes.forEach(nd => {
    if (nd.fixedHead !== null) return;
    const e = Math.abs(bal[nd.id] - nd.demand);
    if (e > worst) { worst = e; worstNode = nd.id; }
  });
  ok(`Continuity holds at every junction (worst ${(worst * 1000).toExponential(2)} L/s at ${worstNode})`,
     worst < 1e-8);

  const totalDemand = nodes.reduce((s, nd) => s + (nd.demand || 0), 0);
  near('Source supplies the total demand', res.flow.feed, totalDemand, 1e-8);

  // Every loop in the grid must close: sum of signed head losses around it ≈ 0
  const hl = {};
  links.forEach(l => { hl[l.id] = FD.hydraulics.headloss(l.r, res.flow[l.id], HW_N); });
  const loop = hl['h00'] + hl['v01'] - hl['h10'] - hl['v00'];
  near('Head loss around a mesh loop closes to zero', loop, 0, 1e-6);
}

section('Linear algebra');
{
  const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
  const b = [8, -11, -3];
  const x = FD.solver.solveLinear(A.map(r => r.slice()), b.slice());
  near('Gaussian elimination x₁', x[0], 2, 1e-9);
  near('Gaussian elimination x₂', x[1], 3, 1e-9);
  near('Gaussian elimination x₃', x[2], -1, 1e-9);
  ok('Singular matrix returns null',
     FD.solver.solveLinear([[1, 2], [2, 4]], [1, 2]) === null);
}

section('ASHRAE (2021) method — Hazen-Williams pipe + K fittings');
{
  /* 2021 ASHRAE Fundamentals Ch 22. Pipe friction is Eq (6), algebraically the
   * same Hazen-Williams already in use; fittings are Eq (7), K velocity heads,
   * carried as a SEPARATE quadratic term. */
  const A = FD.hydraulics.methods.ASHRAE;
  const HWm = FD.hydraulics.methods.HW;
  ok('ASHRAE method exists and is not experimental', !!A && A.experimental === false);
  ok('...and charges fittings by K', A.fittingMode === 'K');
  ok('...where plain Hazen-Williams charges equivalent length', HWm.fittingMode === 'EL');

  const d = 0.0525, C = 120, L = 100;
  near('ASHRAE pipe friction == Hazen-Williams pipe friction',
       A.r(L, d, C), HWm.r(L, d, C), 1e-12);
  near('ASHRAE exponent is the HW exponent', A.exponent(), 1.852, 1e-12);

  /* Fitting term against Eq (7) by hand: h = K·V²/2g, so K=1 at V=1 m/s
   * costs 1/(2·9.81) = 0.050968 m. */
  const area = Math.PI * d * d / 4;
  const q1 = 1.0 * area;
  const rK = FD.hydraulics.fittingR(1.0, d);
  near('K=1 at 1 m/s costs V^2/2g by hand',
       FD.hydraulics.headloss(rK, q1, 2), 1 / (2 * 9.81), 1e-9);
  near('K=2.5 scales linearly with K',
       FD.hydraulics.headloss(FD.hydraulics.fittingR(2.5, d), q1, 2), 2.5 / (2 * 9.81), 1e-9);
  near('doubling the flow quadruples the fitting loss',
       FD.hydraulics.headloss(rK, 2 * q1, 2),
       4 * FD.hydraulics.headloss(rK, q1, 2), 1e-12);
  ok('No fittings means no K term', FD.hydraulics.fittingR(0, d) === 0);

  /* The composite. Its derivative must match a numerical one: the GGA's Newton
   * step depends on that agreement, and a wrong derivative shows up as poor
   * convergence rather than as an obviously wrong number. */
  const link = { r: A.r(L, d, C), n: 1.852, rK: rK };
  const q = 0.004;
  near('linkLoss sums the pipe and fitting terms',
       FD.hydraulics.linkLoss(link, q),
       FD.hydraulics.headloss(link.r, q, 1.852) + FD.hydraulics.headloss(rK, q, 2), 1e-15);
  ok('...and exceeds the pipe term alone',
     FD.hydraulics.linkLoss(link, q) > FD.hydraulics.headloss(link.r, q, 1.852));

  const hh = 1e-7;
  const numeric = (FD.hydraulics.linkLoss(link, q + hh) - FD.hydraulics.linkLoss(link, q - hh)) / (2 * hh);
  const analytic = FD.hydraulics.dhdq(link.r, q, 1.852) + FD.hydraulics.dhdq(rK, q, 2);
  near('composite dh/dq matches a numerical derivative', analytic, numeric, Math.abs(numeric) * 1e-4);

  ok('composite loss is odd in q',
     Math.abs(FD.hydraulics.linkLoss(link, -q) + FD.hydraulics.linkLoss(link, q)) < 1e-15);

  const plain = { r: A.r(L, d, C), n: 1.852 };
  near('a link without fittings is unchanged',
       FD.hydraulics.linkLoss(plain, q), FD.hydraulics.headloss(plain.r, q, 1.852), 1e-15);
}

report();
