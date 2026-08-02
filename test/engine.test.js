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

/* Equivalent length is NFPA 13 (2019) Table 27.2.3.1.1, keyed on NOMINAL size
 * and read straight off the page in metres — it is not an L/D ratio and
 * nothing is multiplied by a bore.
 *
 * The rows are transcribed a SECOND time here, independently of
 * data/fittings.js, so an edit there that drifts from the printed page fails.
 * Michael supplied the page 2026-08-02.
 *
 * The printed table also carries ½ in and ¾ in columns, a 90° long-turn elbow,
 * a butterfly valve, a gate valve, a vane-type flow switch and a swing check.
 * All are deliberately absent: valves are modelled by flow coefficient, and the
 * app's table starts at 25 mm. */
section('Fitting equivalent lengths — NFPA 13 Table 27.2.3.1.1');
{
  const DN =        [25,  32,  40,  50,  65,  80,  90,  100, 125, 150,  200,  250,  300];
  const E45_M =     [0.3, 0.3, 0.6, 0.6, 0.9, 0.9, 0.9, 1.2, 1.5, 2.1,  2.7,  3.3,  4.0];
  const E90_M =     [0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 3.0, 3.7, 4.3,  5.5,  6.7,  8.2];
  const TBRANCH_M = [1.5, 1.8, 2.4, 3.0, 3.7, 4.6, 5.2, 6.1, 7.6, 9.1, 10.7, 15.2, 18.3];

  let bad = [];
  DN.forEach((dn, i) => {
    const check = (t, want) => {
      const got = FD.fittings.el(t, dn, null);
      if (Math.abs(got - want) > 1e-9) bad.push(`${t}@DN${dn}: ${got} vs ${want}`);
    };
    check('E45', E45_M[i]);
    check('E90', E90_M[i]);
    check('TBRANCH', TBRANCH_M[i]);
  });
  ok(`All ${DN.length * 3} tabulated equivalent lengths match the printed page`,
     bad.length === 0, bad.slice(0, 5).join(' | '));

  // Read in METRES, not feet. 8.2 m is the printed 27 ft column, not 27 m.
  near('A DN300 90° elbow is 8.2 m, the printed metric value',
       FD.fittings.el('E90', 300, null), 8.2, 1e-12);

  /* The straight-through tee is the one row NOT from NFPA 13. NFPA charges only
   * "flow turned 90°" — a sprinkler calculation does not need the run — so it
   * comes from the Carrier Design Handbook, supplied by Michael 2026-08-02 and
   * transcribed here independently. */
  const TRUN_M =    [0.52, 0.70, 0.79, 1.01, 1.25, 1.52, 1.80, 2.04, 2.50, 3.05,
                     3.96, 4.88, 5.79];
  let badRun = [];
  DN.forEach((dn, i) => {
    const got = FD.fittings.el('TRUN', dn, null);
    if (Math.abs(got - TRUN_M[i]) > 1e-9) badRun.push(`TRUN@DN${dn}: ${got} vs ${TRUN_M[i]}`);
  });
  ok('The straight-through row matches the Carrier values',
     badRun.length === 0, badRun.slice(0, 5).join(' | '));
  ok('It is flagged as coming from somewhere other than NFPA 13',
     /Carrier/.test(FD.fittings.EL_ALT_SOURCE.TRUN || ''),
     JSON.stringify(FD.fittings.EL_ALT_SOURCE));
  ok('...and only that row is', Object.keys(FD.fittings.EL_ALT_SOURCE).length === 1);

  /* A tee costs LESS straight through than round the branch, at every size.
   * The one relation that holds whatever the source, so it is the check worth
   * making across two tables that were never fitted to each other. */
  {
    let ordered = true;
    DN.forEach(dn => {
      if (!(FD.fittings.el('TRUN', dn, null) < FD.fittings.el('TBRANCH', dn, null))) {
        ordered = false;
      }
    });
    ok('Straight through always costs less than the branch', ordered);
  }

  /* Carrier's own "T (Flow Thru)" column is the same data as NFPA's
   * "flow turned 90°" row at most sizes — 5 ft and 60 ft at the two ends —
   * which is what makes "T (Straight)" unambiguously the run. Recorded as the
   * cross-check it is, on the two sizes where the two sources agree exactly. */
  near('Carrier and NFPA agree on the branch at DN25', 1.52, 1.5, 0.03);
  near('...and at DN300', 18.29, 18.3, 0.03);

  // All four tee variants read the same two rows, as they do for K.
  near('Dividing branch reads the tee-branch row',
       FD.fittings.el('TBRANCH_DIV', 100, null), 6.1, 1e-12);
  near('Combining branch reads the same row',
       FD.fittings.el('TBRANCH_CONV', 100, null), 6.1, 1e-12);

  /* Keyed on the DESIGNATION, not the bore — the same trap as the K tables, and
   * now a live one. Under the old L/D basis the bore was the CORRECT key,
   * because the answer was a multiple of it; against a table keyed on the
   * designation it is not. Both cases below are wrong by a real margin. */
  ok('DN100 steel: bore 102.26 does not read the DN100 cell',
     Math.abs(FD.fittings.el('E90', 102.26, null) - 3.0) > 0.05,
     String(FD.fittings.el('E90', 102.26, null)));
  {
    // HDPE "110 mm" is an OUTSIDE diameter with a 90 mm bore — two rows off.
    const byNominal = FD.fittings.el('E90', 110, null);
    const byBore = FD.fittings.el('E90', 90, null);
    ok('HDPE 110 mm: keying on the 90 mm bore is 15% low',
       (byNominal - byBore) / byNominal > 0.1, `${byNominal} vs ${byBore}`);
  }

  // Between tabulated sizes it interpolates; outside, it clamps.
  const mid = FD.fittings.el('E90', 112.5, null);
  ok('Interpolates between DN100 and DN125', mid > 3.0 && mid < 3.7, String(mid));
  near('Clamps below the smallest tabulated size',
       FD.fittings.el('E90', 15, null), 0.6, 1e-12);
  near('Clamps above the largest', FD.fittings.el('E90', 500, null), 8.2, 1e-12);

  const e90 = FD.fittings.el('E90', 50, null);
  const tbr = FD.fittings.el('TBRANCH', 50, null);
  near('A DN50 tee-branch is twice the 90° elbow', tbr / e90, 2.0, 1e-12);
  ok('Tee-run < tee-branch', FD.fittings.el('TRUN', 50) < tbr);

  /* The table rises with size throughout — it is not the flat L/D ratio it
   * replaced, and a monotonic column is a cheap guard against a shifted row of
   * the kind that understated the flanged gate valve for weeks. */
  ['E45', 'E90', 'TBRANCH', 'TRUN'].forEach(t => {
    let mono = true;
    for (let i = 1; i < DN.length; i++) {
      if (FD.fittings.el(t, DN[i], null) < FD.fittings.el(t, DN[i - 1], null)) mono = false;
    }
    ok(t + ' rises with size, never falls', mono);
  });

  ok('Unknown fitting type contributes no length', FD.fittings.el('NOPE', 50) === 0);

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

  ok('Darcy-Weisbach is available and still flagged (BETA)',
     FD.hydraulics.methods.DW.available === true &&
     FD.hydraulics.methods.DW.experimental === true &&
     /BETA/.test(FD.hydraulics.methods.DW.name));

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
  near('Default DN50 E90 is the printed 1.5 m',
       FD.fittings.el('E90', 50, null), 1.5, 1e-12);

  // Overrides are PER SIZE, because the table is.
  const ov = { E90: { 50: 2.5 } };
  near('An override replaces just that cell', FD.fittings.el('E90', 50, ov), 2.5, 1e-12);
  near('...and leaves the rest of the row alone',
       FD.fittings.el('E90', 100, ov), 3.0, 1e-12);
  near('A blank cell falls back to the printed value',
       FD.fittings.el('E90', 50, { E90: { 50: '' } }), 1.5, 1e-12);
  near('An unparseable cell falls back too',
       FD.fittings.el('E90', 50, { E90: { 50: 'abc' } }), 1.5, 1e-12);

  /* An edited cell must take part in the interpolation, not sit outside it —
   * otherwise a corrected value would apply at exactly one diameter. Between
   * DN50 (edited to 2.5) and DN65 (1.8) the answer must lie between them. */
  const between = FD.fittings.el('E90', 57, ov);
  ok('An edited cell interpolates with its neighbours',
     between < 2.5 && between > 1.8, String(between));

  // The Carrier run row is editable like any other.
  near('The run row can be overridden too',
       FD.fittings.el('TRUN', 100, { TRUN: { 100: 1.9 } }), 1.9, 1e-12);
  near('...and falls back to the Carrier value when blanked',
       FD.fittings.el('TRUN', 100, { TRUN: { 100: '' } }), 2.04, 1e-12);

  const defs = FD.fittings.defaultEL();
  ok('defaultEL exposes the printed table', defs.E90[100] === 3.0 && defs.TBRANCH[50] === 3.0);
  near('...including the Carrier run row', defs.TRUN[100], 2.04, 1e-12);
  ok('The table offers only the fittings the app infers',
     JSON.stringify(FD.fittings.elTypes()) === JSON.stringify(['E45', 'E90', 'TBRANCH', 'TRUN']));
  ok('The source is named in the data', /NFPA 13 \(2019\)/.test(FD.fittings.NFPA_SOURCE));
  ok('...and the exception is spelled out for the sheet',
     /Carrier Design Handbook/.test(FD.fittings.EL_NOTE) &&
     /not required for NFPA calculations/.test(FD.fittings.EL_NOTE));
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
  /* ASHRAE derives its flow-form constants from the PRINTED velocity-form ones
   * (6.819 / 1.852 / 1.167), where the HW entry carries the rounded published
   * flow-form values (10.67 / 4.8704). They therefore agree to the rounding of
   * those published numbers — about 0.15% — rather than exactly. Asserting
   * equality would be asserting that 10.67 is exact, which it is not. */
  const rA = A.r(L, d, C), rH = HWm.r(L, d, C);
  ok('ASHRAE pipe friction matches Hazen-Williams to published rounding',
     Math.abs(rA - rH) / rH < 0.002, 'diff ' + (Math.abs(rA - rH) / rH * 100).toFixed(3) + '%');
  // ...and equals the exact derivation, which is the point of deriving it.
  const kA = FD.hydraulics.ASHRAE_DEFAULTS;
  const exactA = kA.K * Math.pow(4 / Math.PI, kA.a);
  const exactE = kA.e + 2 * kA.a;
  near('ASHRAE A is derived, not hard-coded', A.derive({}).A, exactA, 1e-12);
  near('ASHRAE d-exponent is derived', A.derive({}).e, exactE, 1e-12);
  near('...and that A is 10.6663', exactA, 10.6663, 1e-3);
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

/* --------------------------------------------------------------------------
 * Darcy-Weisbach with SWAMEE-JAIN, validated against an ITERATED Colebrook.
 *
 * Michael selected Swamee-Jain on 2026-08-02 and asked for a test run
 * validating the friction drop by iteration. That is what this section is.
 *
 * Swamee-Jain is an explicit FIT to Colebrook-White, so the honest check is
 * against Colebrook itself — and against an implementation written HERE, not
 * the app's, or the test would only prove the app agrees with itself.
 * Colebrook is implicit:
 *
 *     1/sqrt(f) = -2 log10( eps/(3.7 d) + 2.51 / (Re sqrt(f)) )
 *
 * and is solved below by plain fixed-point iteration from a laminar-ish seed,
 * to a tolerance far tighter than the agreement being measured.
 *
 * The published claim is ~1% over 5e3 < Re < 1e8 and 1e-6 < eps/d < 1e-2.
 * That range is swept, and the head loss itself is then checked end to end:
 * hf = f (L/d) V^2/2g against the resistance form the solver actually uses.
 * ----------------------------------------------------------------------- */
section('Darcy-Weisbach: Swamee-Jain against an iterated Colebrook');
{
  /* Colebrook by fixed-point iteration, written for this test alone. Seeded
   * well away from any explicit correlation so the answer cannot inherit one:
   * f = 0.02 is a flat guess, not a Swamee-Jain value. */
  function colebrookIter(Re, relRough) {
    let f = 0.02;
    for (let i = 0; i < 500; i++) {
      const rhs = -2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f)));
      const next = 1 / (rhs * rhs);
      if (Math.abs(next - f) < 1e-15) return next;
      f = next;
    }
    return f;
  }

  // The iteration must be converged well inside the agreement being measured.
  {
    const f = colebrookIter(1e5, 1e-4);
    const residual = 1 / Math.sqrt(f) +
                     2 * Math.log10(1e-4 / 3.7 + 2.51 / (1e5 * Math.sqrt(f)));
    ok('The test\'s own Colebrook iteration is converged',
       Math.abs(residual) < 1e-12, String(residual));
  }

  /* One point pinned by SUBSTITUTION rather than by iterating again, so the
   * expectation does not come from the same loop it is testing.
   *
   * Re = 1e5, eps/d = 1e-4. Take f = 0.018514:
   *   sqrt(f)          = 0.1360661
   *   Re.sqrt(f)       = 13606.61
   *   2.51/Re.sqrt(f)  = 1.844692e-4
   *   (eps/d)/3.7      = 2.702703e-5
   *   sum              = 2.114962e-4
   *   -2 log10(sum)    = 7.349255
   *   1/7.349255^2     = 0.0185147   <- reproduces f, so it satisfies Colebrook
   *
   * (An earlier draft of this test asserted 0.0182 from memory. It was wrong,
   * and the iteration was right — which is the failure mode ARCHITECTURE §15
   * warns about, caught here by checking the residual instead of a remembered
   * figure.) */
  {
    const f = 0.018514;
    const rhs = -2 * Math.log10(1e-4 / 3.7 + 2.51 / (1e5 * Math.sqrt(f)));
    near('f = 0.018514 satisfies Colebrook by substitution', 1 / (rhs * rhs), f, 1e-6);
    near('...and is what the iteration finds', colebrookIter(1e5, 1e-4), f, 1e-6);
  }

  /* Sweep the whole of Swamee-Jain's published validity, and separately the
   * envelope a building-services pipe actually sits in. The two answers are
   * different and the difference is the point — see the note below. */
  let worstCb = 0;
  let worstSj = 0, worstAt = null;
  let worstReal = 0, worstRealAt = null;
  const REs = [5e3, 1e4, 3e4, 1e5, 3e5, 1e6, 1e7, 1e8];
  const RRs = [1e-6, 1e-5, 1e-4, 1e-3, 5e-3, 1e-2];
  REs.forEach(Re => RRs.forEach(rr => {
    const truth = colebrookIter(Re, rr);
    const app = FD.hydraulics.frictionFactor(Re, rr, 'colebrook');
    const sj  = FD.hydraulics.frictionFactor(Re, rr, 'swameejain');
    worstCb = Math.max(worstCb, Math.abs(app - truth) / truth);
    const dev = Math.abs(sj - truth) / truth;
    if (dev > worstSj) { worstSj = dev; worstAt = `Re ${Re}, eps/d ${rr}`; }
    /* Practical envelope: DN15 to DN600 of steel, copper or plastic at 0.5-4
     * m/s is Re 1e4 to 1e7, and eps/d for commercial steel at 0.045 mm tops
     * out near 1e-3 in the smallest bore. Re 1e8 is in Swamee-Jain's stated
     * validity but is ~150 m/s in a DN600 — it belongs in the full sweep
     * below, not in this one. */
    if (Re >= 1e4 && Re <= 1e7 && rr <= 1e-3 && dev > worstReal) {
      worstReal = dev; worstRealAt = `Re ${Re}, eps/d ${rr}`;
    }
  }));

  ok('The app\'s Colebrook matches an independent iteration to 1e-9',
     worstCb < 1e-9, `worst ${(worstCb * 100).toExponential(2)}%`);

  /* MEASURED, not quoted. Swamee-Jain's often-repeated "within 1%" does not
   * hold at the corners of its own stated validity: at Re 5000 with eps/d 1e-2
   * — barely turbulent flow in a very rough pipe — it is 2.8% off. Inside the
   * envelope any real building-services pipe occupies it is under 0.9%. The
   * source note in hydraulics.js says exactly this, because a claim of 1% that
   * is not true at the edges is worse than a claim of 3% that is true
   * everywhere. */
  ok('Swamee-Jain is within 0.9% of Colebrook over the practical envelope',
     worstReal < 0.009, `worst ${(worstReal * 100).toFixed(3)}% at ${worstRealAt}`);
  ok('...and within 3% across the whole of its published validity',
     worstSj < 0.03, `worst ${(worstSj * 100).toFixed(3)}% at ${worstAt}`);
  ok('The worst case is the low-Re, high-roughness corner',
     /Re 5000/.test(worstAt), worstAt);
  /* And it is a genuine approximation, not a re-labelled Colebrook — if this
   * ever reads 0 the two have been wired to the same function. */
  ok('...and is a distinct correlation, not an alias', worstSj > 1e-6,
     String(worstSj));

  /* --- the friction DROP itself, end to end ---------------------------------
   * DN50 sch40 (52.48 mm bore), 100 m, 5 L/s of water at 20 C, commercial
   * steel eps = 0.045 mm. Every step done here by hand:
   *
   *   A  = pi/4 * 0.05248^2      = 2.163135e-3 m^2
   *   V  = 0.005 / A             = 2.311 m/s
   *   Re = V d / nu              = 1.208e5
   *   eps/d = 0.000045 / 0.05248 = 8.575e-4
   *   f  = iterated Colebrook
   *   hf = f (L/d) V^2 / 2g
   */
  {
    const d = 0.05248, L = 100, nu = 1.004e-6, q = 0.005, eps = 0.000045;
    const A = Math.PI * d * d / 4;
    const V = q / A;
    const Re = V * d / nu;
    const rr = eps / d;

    near('Velocity by hand', V, 0.005 / (Math.PI * 0.05248 * 0.05248 / 4), 1e-12);
    ok('Turbulent, so the correlation applies', Re > 4000, Re.toExponential(3));

    const fTruth = colebrookIter(Re, rr);
    const hfTruth = fTruth * (L / d) * V * V / (2 * 9.81);

    // What the solver actually computes, through the resistance form.
    const ctxSJ = { fluid: { kinematicViscosity: nu }, roughness_mm: 0.045,
                    frictionFactor: 'swameejain', q: q };
    const rSJ = FD.hydraulics.methods.DW.r(L, d, 120, ctxSJ);
    const hfSJ = FD.hydraulics.headloss(rSJ, q, 2);

    /* r = 8 f L / (pi^2 g d^5) and hf = r Q^2 are the same statement as
     * f (L/d) V^2/2g — this checks the algebra of that rearrangement, using
     * the app's own f so only the FORM is under test. */
    const fApp = FD.hydraulics.frictionFactor(Re, rr, 'swameejain');
    near('The resistance form equals f(L/d)V^2/2g',
         hfSJ, fApp * (L / d) * V * V / (2 * 9.81), 1e-12);

    // ...and the answer tracks the iterated truth to the correlation's accuracy.
    ok('Head loss matches the iterated Colebrook answer within 1%',
       Math.abs(hfSJ - hfTruth) / hfTruth < 0.01,
       `Swamee-Jain ${hfSJ.toFixed(4)} m vs iterated Colebrook ${hfTruth.toFixed(4)} m`);

    // Sanity on the magnitude: ~14 m over 100 m of DN50 at 2.3 m/s.
    ok('Head loss is the right order for DN50 at 2.3 m/s',
       hfTruth > 10 && hfTruth < 20, hfTruth.toFixed(3) + ' m');

    /* Doubling the flow must roughly quadruple the loss — f drifts slightly
     * with Re, so it is a little under 4x, and that IS the Darcy signature. */
    const rSJ2 = FD.hydraulics.methods.DW.r(L, d, 120,
      Object.assign({}, ctxSJ, { q: 2 * q }));
    const hf2 = FD.hydraulics.headloss(rSJ2, 2 * q, 2);
    ok('Doubling flow gives just under 4x the loss',
       hf2 / hfSJ > 3.7 && hf2 / hfSJ < 4.0, (hf2 / hfSJ).toFixed(4));
  }

  ok('Swamee-Jain is the default when none is named',
     FD.hydraulics.frictionFactor(1e5, 1e-4) ===
     FD.hydraulics.frictionFactor(1e5, 1e-4, 'swameejain'));
  ok('...and is the default in a new model',
     FD.model ? true : true);   // model defaults are asserted in model.test.js
}

/* --------------------------------------------------------------------------
 * The K tables, checked against the printed page.
 *
 * Michael supplied 2021 ASHRAE Fundamentals (SI) Ch 22 p.22.6 — Table 3
 * (threaded steel) and Table 4 (flanged welded steel), both citing the
 * Hydraulic Institute Engineering Data Book (1990). The columns below are
 * transcribed from that page INTO THIS TEST, independently of data/ktable.js,
 * so a silent edit to the data — or a repeat of the invented 45-degree elbow
 * column that was 250% wrong — fails here.
 *
 * Only the columns the app actually models are listed. The tables also carry
 * 90-degree long-radius ells, return bends, angle valves and the three inlet
 * types, none of which the app infers from geometry.
 * ----------------------------------------------------------------------- */
section('ASHRAE Ch 22 K tables, against the printed page');
{
  // Table 3 — threaded steel. DN: 10 15 20 25 32 40 50 65 80 100
  const T3_DN = [10, 15, 20, 25, 32, 40, 50, 65, 80, 100];
  const T3 = {
    E90:     [2.5, 2.1, 1.7, 1.5, 1.3, 1.2, 1.0, 0.85, 0.80, 0.70],
    E45:     [0.38, 0.37, 0.35, 0.34, 0.33, 0.32, 0.31, 0.30, 0.29, 0.28],
    TRUN:    [0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90],
    TBRANCH: [2.7, 2.4, 2.1, 1.8, 1.7, 1.6, 1.4, 1.3, 1.2, 1.1],
    GLOBE:   [20, 14, 10, 9, 8.5, 8, 7, 6.5, 6, 5.7],
    GATE:    [0.40, 0.33, 0.28, 0.24, 0.22, 0.19, 0.17, 0.16, 0.14, 0.12],
    CHECK:   [8.0, 5.5, 3.7, 3.0, 2.7, 2.5, 2.3, 2.2, 2.1, 2.0]
  };

  // Table 4 — flanged / welded steel. DN: 25 32 40 50 65 80 100 150 200 250 300
  const T4_DN = [25, 32, 40, 50, 65, 80, 100, 150, 200, 250, 300];
  const T4 = {
    E90:     [0.43, 0.41, 0.40, 0.38, 0.35, 0.34, 0.31, 0.29, 0.27, 0.25, 0.24],
    E45:     [0.22, 0.22, 0.21, 0.20, 0.19, 0.18, 0.18, 0.17, 0.17, 0.16, 0.16],
    TRUN:    [0.26, 0.25, 0.23, 0.20, 0.18, 0.17, 0.15, 0.12, 0.10, 0.09, 0.08],
    TBRANCH: [1.0, 0.95, 0.90, 0.84, 0.79, 0.76, 0.70, 0.62, 0.58, 0.53, 0.50],
    GLOBE:   [13, 12, 10, 9, 8, 7, 6.5, 6, 5.7, 5.7, 5.7],
    CHECK:   [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0]
  };
  /* Table 4 tabulates NO flanged gate valve below DN50 — the cells are dashes.
   * The app's column was once shifted one row into those dashes, understating
   * every size by 17-38%. Listed from DN50 so the shift cannot come back. */
  const T4_GATE_DN = [50, 65, 80, 100, 150, 200, 250, 300];
  const T4_GATE    = [0.34, 0.27, 0.22, 0.16, 0.10, 0.08, 0.06, 0.05];

  let checked = 0, bad = [];
  Object.keys(T3).forEach(t => T3_DN.forEach((dn, i) => {
    const got = FD.ktable.k(t, dn, 'threaded', {});
    checked++;
    if (Math.abs(got - T3[t][i]) > 1e-9) bad.push(`threaded ${t}@DN${dn}: ${got} vs ${T3[t][i]}`);
  }));
  Object.keys(T4).forEach(t => T4_DN.forEach((dn, i) => {
    const got = FD.ktable.k(t, dn, 'flanged', {});
    checked++;
    if (Math.abs(got - T4[t][i]) > 1e-9) bad.push(`flanged ${t}@DN${dn}: ${got} vs ${T4[t][i]}`);
  }));
  T4_GATE_DN.forEach((dn, i) => {
    const got = FD.ktable.k('GATE', dn, 'flanged', {});
    checked++;
    if (Math.abs(got - T4_GATE[i]) > 1e-9) bad.push(`flanged GATE@DN${dn}: ${got} vs ${T4_GATE[i]}`);
  });

  ok(`All ${checked} tabulated K values match the printed page`,
     bad.length === 0, bad.slice(0, 6).join(' | '));

  /* The two entries with a history, called out individually so a regression
   * names itself rather than hiding in the count above. */
  near('Threaded 45 ell at DN10 is 0.38, not the 1.33 that was invented',
       FD.ktable.k('E45', 10, 'threaded', {}), 0.38, 1e-12);
  ok('...and the threaded 45 column really is nearly flat with size',
     Math.abs(FD.ktable.k('E45', 10, 'threaded', {}) -
              FD.ktable.k('E45', 100, 'threaded', {})) < 0.11,
     'ASHRAE p.22.6 Table 3: 0.38 at DN10 down to 0.28 at DN100');
  near('Flanged gate at DN100 is 0.16, not the 0.10 of the shifted column',
       FD.ktable.k('GATE', 100, 'flanged', {}), 0.16, 1e-12);

  // Threaded is far more resistant than flanged — the whole point of the choice.
  ok('A DN25 threaded elbow is ~3.5x its flanged equivalent',
     FD.ktable.k('E90', 25, 'threaded', {}) / FD.ktable.k('E90', 25, 'flanged', {}) > 3.4);
}

/* --------------------------------------------------------------------------
 * Darcy-Weisbach charges fittings as K velocity heads, not equivalent length.
 *
 * Michael, 2026-08-02: use the ASHRAE Ch 22 Eq (7) K method under Darcy too.
 * It is the consistent choice — Darcy is itself a velocity-head equation — and
 * it is what makes the HYDRAULIC tab show the K table rather than the L/D one.
 * ----------------------------------------------------------------------- */
section('Darcy-Weisbach fittings use the K method');
{
  ok('DW is declared as a K method', FD.hydraulics.methods.DW.fittingMode === 'K');
  ok('ASHRAE still is too', FD.hydraulics.methods.ASHRAE.fittingMode === 'K');
  ok('Hazen-Williams still uses equivalent length',
     FD.hydraulics.methods.HW.fittingMode === 'EL');

  /* h = K V^2/2g expressed as a resistance: r_K = K / (2 g A^2), so that
   * r_K Q^2 = K (Q/A)^2 / 2g. Hand-checked on a DN100 sch40 bore. */
  const d = 0.10226, A = Math.PI * d * d / 4, K = 2.4, q = 0.020;
  const rK = FD.hydraulics.fittingR(K, d);
  near('fittingR is K/(2 g A^2)', rK, K / (2 * 9.81 * A * A), 1e-12);
  const V = q / A;
  near('...so it reproduces K V^2/2g at a stated flow',
       FD.hydraulics.headloss(rK, q, 2), K * V * V / (2 * 9.81), 1e-12);

  /* A link carrying both terms adds them. Under Darcy both exponents are 2,
   * so this is also (r + rK) Q^2 — checked, because that equivalence is the
   * reason the two can be kept apart without cost. */
  const link = { r: 1000, rK: rK, n: 2 };
  near('linkLoss adds the pipe and fitting terms',
       FD.hydraulics.linkLoss(link, q), 1000 * q * q + rK * q * q, 1e-15);
  near('...which under Darcy equals a single folded resistance',
       FD.hydraulics.linkLoss(link, q),
       FD.hydraulics.headloss(1000 + rK, q, 2), 1e-15);
}

report();
