/* FreePipeCalc — TOOLS calculators (docs/TOOLS.md).
 * Run:  node test/tools.test.js
 *
 * A tool deliberately does NOT reach into the network: it takes numbers in and
 * gives numbers out, so it can be checked against a hand calculation with no
 * model open. That is exactly what this file does.
 *
 * The RENDERING is not tested here — it needs a DOM, and what it draws is
 * logged in `Human-Test.md` instead. The arithmetic is separated from the form
 * precisely so this file can exist.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');

/* tools.js touches `document` only inside its render functions, so a stub is
 * enough to let the module define itself. */
const FD = load(['src/model.js', 'src/tools.js']);
const M = FD.model, T = FD.tools;

const RHO = 998, CP = 4187, G = 9.81;

function model() {
  const m = M.create();
  m.settings.frictionMethod = 'HW';
  m.settings.C = 120;
  m.settings.schedule = 'sch40';
  return m;
}

/* --------------------------------------------------------------------------
 * PIPE VELOCITY & FRICTION — "enter any two, get the third" (Q3).
 *
 * The three are flow, bore and velocity, tied by Q = v·A with A = π·d²/4.
 * There is nothing else in it, which is what makes it hand-checkable.
 * ----------------------------------------------------------------------- */
section('Velocity & friction: any two give the third');
{
  const m = model();

  /* ---- FLOW + VELOCITY → BORE.  d = √(4Q/πv)
   * 4 L/s at 1.5 m/s:  √(4 × 0.004 / (π × 1.5)) = 0.0582686 m */
  {
    const r = T.velocity({ known: 'qv', flow: '4', vel: '1.5', bore: '' }, m);
    ok('It solves', !r.errors.length, JSON.stringify(r.errors));
    near('Bore from flow and velocity', r.D, Math.sqrt(4 * 0.004 / (Math.PI * 1.5)), 1e-12);
    near('...which is 58.269 mm', r.D * 1000, 58.2686, 1e-3);
    near('...the flow being unchanged', r.Q, 0.004, 1e-15);
    near('...and the velocity too', r.V, 1.5, 1e-15);
  }

  /* ---- FLOW + BORE → VELOCITY, and it must return the velocity we started
   * from. A round trip that does not close means one of the two directions is
   * wrong and the tool would not say which. */
  {
    const d = Math.sqrt(4 * 0.004 / (Math.PI * 1.5)) * 1000;
    const r = T.velocity({ known: 'qd', flow: '4', bore: String(d), vel: '' }, m);
    near('Velocity from flow and bore closes the round trip', r.V, 1.5, 1e-9);
  }
  /* ---- BORE + VELOCITY → FLOW, the third direction. */
  {
    const d = Math.sqrt(4 * 0.004 / (Math.PI * 1.5)) * 1000;
    const r = T.velocity({ known: 'dv', bore: String(d), vel: '1.5', flow: '' }, m);
    near('Flow from bore and velocity closes it too', r.Q, 0.004, 1e-12);
  }

  /* ---- THE FRICTION GRADIENT IS THE MODEL'S OWN, and this is the assertion
   * that matters: a tool that re-derives friction is a second implementation,
   * and the two disagree the day one of them is edited.
   *
   * Hazen-Williams, by hand, for one metre of 58.2686 mm at C = 120:
   *
   *     r = A·L / (C^b · d^e)
   *     h = r · Q^1.852
   *     Δp = ρ·g·h
   *
   * THE CONSTANTS ARE THE DERIVED ONES, not the rounded pair on the settings.
   * `m.settings.hw` reads A = 10.67, e = 4.8704 — the figures as they are
   * printed — and `methods.HW.derive` turns them into A = 10.666311,
   * e = 4.871, which is what the solver actually runs on. The difference is
   * 0.14%, which is nothing on a friction estimate and everything to a test
   * with a 1e-9 tolerance. Using the printed pair here would be checking the
   * tool against a formula the model does not use. */
  {
    const r = T.velocity({ known: 'qv', flow: '4', vel: '1.5', bore: '' }, m);
    const d = Math.sqrt(4 * 0.004 / (Math.PI * 1.5));
    const k = FD.hydraulics.method('HW').derive({ hw: m.settings.hw });
    const rr = k.A / (Math.pow(120, k.b) * Math.pow(d, k.e));
    const h = rr * Math.pow(0.004, 1.852);
    near('The gradient is Hazen-Williams, by hand', r.pdm, RHO * FD.units.G * h, 1e-6);
    near('...which is 550 Pa/m', r.pdm, 550.5, 1);
    /* And the printed constants get within a fifth of a percent of it, which
     * is what says the two are the same formula rather than two formulas. */
    const rough = 10.67 / (Math.pow(120, 1.852) * Math.pow(d, 4.8704));
    ok('...and the printed constants agree to 0.2%',
       Math.abs(rough / rr - 1) < 0.002, ((rough / rr - 1) * 100).toFixed(3) + '%');
  }

  /* ---- REYNOLDS AND THE REGIME. ν for water at 20 °C is 1.004e-6 m²/s, so
   * 1.5 m/s in 58.2686 mm is 1.5 × 0.0582686 / 1.004e-6 = 87 056. */
  {
    const r = T.velocity({ known: 'qv', flow: '4', vel: '1.5', bore: '' }, m);
    const fluid = FD.fluids.resolve(m.settings);
    near('Reynolds', r.Re, 1.5 * Math.sqrt(4 * 0.004 / (Math.PI * 1.5)) /
         fluid.kinematicViscosity, 1);
    ok('...turbulent, as it must be at 87 000', r.regime === 'turbulent', r.regime);
  }
  /* And a genuinely laminar case is named as one, because Hazen-Williams is
   * not valid there and the tool has to say so. */
  {
    const r = T.velocity({ known: 'dv', bore: '50', vel: '0.02', flow: '' }, m);
    ok('A slow flow in a big bore is laminar', r.regime === 'laminar',
       r.regime + ' at Re ' + Math.round(r.Re));
  }

  /* ---- VELOCITY HEAD. v²/2g — 1.5 m/s is 0.1147 m. */
  {
    const r = T.velocity({ known: 'qv', flow: '4', vel: '1.5', bore: '' }, m);
    near('Velocity head', r.velHead, 1.5 * 1.5 / (2 * FD.units.G), 1e-12);
    near('...which is 0.115 m', r.velHead, 0.1147, 1e-3);
  }

  /* ---- THE SIZE YOU WOULD BUY. 58.27 mm is not a pipe; DN65 is the smallest
   * sch40 bore that carries 4 L/s at or under 1.5 m/s. Through the schedule's
   * OWN rule, so the tool cannot recommend a size the sizer would not. */
  {
    const r = T.velocity({ known: 'qv', flow: '4', vel: '1.5', bore: '' }, m);
    ok('It names a real pipe size', !!r.pick, JSON.stringify(r.pick));
    ok('...DN65 here', r.pick.name === 'DN65', r.pick && r.pick.name);
    ok('...whose bore is at least the calculated one', r.pick.bore >= r.D,
       (r.pick.bore * 1000).toFixed(1) + ' vs ' + (r.D * 1000).toFixed(1));
    ok('...and it is the SMALLEST that is',
       FD.schedules.size('sch40', 'DN50').id_mm / 1000 < r.D);
  }

  /* ---- NOTHING USEFUL IN, NOTHING PRETENDED OUT. */
  {
    ok('Two blanks are refused',
       T.velocity({ known: 'qv', flow: '', vel: '', bore: '' }, m).errors.length > 0);
    ok('A zero is refused, not divided by',
       T.velocity({ known: 'qv', flow: '4', vel: '0', bore: '' }, m).errors.length > 0);
    ok('...and so is a negative bore',
       T.velocity({ known: 'dv', bore: '-50', vel: '1', flow: '' }, m).errors.length > 0);
  }
}

/* --------------------------------------------------------------------------
 * HEAT TRANSFER — Q = ṁ·Cp·ΔT, the same shape and the same relation the
 * equipment panel keeps between capacity, design flow and design ΔT.
 * ρ·Cp = 998 × 4187 = 4 178 626 J/(m³·K).
 * ----------------------------------------------------------------------- */
section('Heat transfer: any two give the third');
{
  const m = model();
  const RHOCP = RHO * CP;

  /* 50 kW across 5 K:  50 000 / (5 × 4 178 626) = 0.00239312 m³/s */
  {
    const r = T.heat({ known: 'qdt', duty: '50', dT: '5', flow: '' }, m);
    ok('It solves', !r.errors.length, JSON.stringify(r.errors));
    near('Flow from duty and ΔT', r.q, 50000 / (5 * RHOCP), 1e-12);
    near('...which is 2.393 L/s', r.q * 1000, 2.3931, 1e-3);
    near('...and the mass flow with it', r.mdot, RHO * r.q, 1e-12);
    near('...capacity rate 10 000 W/K', r.C, RHOCP * r.q, 1e-9);
  }
  /* Round trips, both ways. */
  {
    const q = 50000 / (5 * RHOCP);
    const a = T.heat({ known: 'qf', duty: '50', flow: String(q * 1000), dT: '' }, m);
    near('ΔT from duty and flow closes the round trip', a.dTv, 5, 1e-9);
    const b = T.heat({ known: 'fdt', flow: String(q * 1000), dT: '5', duty: '' }, m);
    near('Duty from flow and ΔT closes it too', b.Q, 50000, 1e-6);
  }
  /* A cooling duty is the same arithmetic with the sign the other way up; the
   * tool reports magnitudes, because "5 K across it" is 5 K either way. */
  {
    const r = T.heat({ known: 'qdt', duty: '-50', dT: '5', flow: '' }, m);
    near('A negative duty gives the same flow', r.q, 50000 / (5 * RHOCP), 1e-12);
  }
  /* THE FLUID IS THE MODEL'S, and it is `FD.fluids.resolve` that decides what
   * that means — a preset's properties come from the table, not from whatever
   * happens to be stored beside the preset key. Asserted with the resolved
   * numbers for that reason: writing 1030/3800 into the settings and expecting
   * them back tests a behaviour the app does not have, and should not. */
  {
    const g = model();
    g.settings.fluid = { preset: 'pg30' };
    const f = FD.fluids.resolve(g.settings);
    ok('The preset is resolved from the table', f.key === 'pg30', f.name);
    const r = T.heat({ known: 'qdt', duty: '50', dT: '5', flow: '' }, g);
    near('Glycol needs more flow for the same duty',
         r.q, 50000 / (5 * f.density * f.specificHeat), 1e-15);
    ok('...which is more than water needed', r.q > 50000 / (5 * RHOCP),
       (r.q * 1000).toFixed(4) + ' vs ' + (50000 / (5 * RHOCP) * 1000).toFixed(4) + ' L/s');
    /* And it is the one fluid in the table marked unverified — the tool says so
     * on screen, and this is the reminder not to quietly promote it. */
    ok('...and it is still flagged as unverified', f.verified === false);
  }
  {
    ok('A zero ΔT is refused rather than divided by',
       T.heat({ known: 'qdt', duty: '50', dT: '0', flow: '' }, m).errors.length > 0);
    ok('A blank duty is refused',
       T.heat({ known: 'qf', duty: '', flow: '2', dT: '' }, m).errors.length > 0);
  }
}

/* --------------------------------------------------------------------------
 * CONVERT — the factors, checked against printed values.
 *
 * The two temperature rows are DIFFERENT conversions and that is the whole
 * reason they are separate rows: an absolute temperature carries the 32°
 * offset, a difference does not. 5 K is 9 °F of difference, not 41.
 * ----------------------------------------------------------------------- */
section('Convert: the factors are the printed ones');
{
  const P = {}; T.convert.pressure.forEach(([n, f]) => { P[n] = f; });
  const Q = {}; T.convert.flow.forEach(([n, f]) => { Q[n] = f; });

  /* Pressure, all against the pascal. */
  near('1 kPa is 1000 Pa', P['kPa'], 1000, 0);
  near('1 bar is 100 kPa', P['bar'] / P['kPa'], 100, 1e-12);
  near('1 psi is 6.894757 kPa', P['psi'] / P['kPa'], 6.894757, 1e-6);
  near('1 m H2O is 9.80665 kPa', P['m H2O'] / P['kPa'], 9.80665, 1e-9);
  near('1 mm Hg is 133.3224 Pa', P['mm Hg'], 133.3224, 1e-4);
  near('1 ft wg is 2.989067 kPa', P['ft wg'] / P['kPa'], 2.989067, 1e-6);
  /* And the two round trips an engineer would spot: 1 bar = 14.5038 psi,
   * 10 m H2O = 98.0665 kPa. */
  near('1 bar is 14.5038 psi', P['bar'] / P['psi'], 14.50377, 1e-4);
  near('10 m H2O is 98.0665 kPa', 10 * P['m H2O'] / P['kPa'], 98.0665, 1e-9);

  /* Flow, all against m³/s. */
  near('1 L/s is 0.001 m³/s', Q['L/s'], 0.001, 0);
  near('60 L/min is 1 L/s', 60 * Q['L/min'] / Q['L/s'], 1, 1e-12);
  near('1 L/s is 3.6 m³/h', Q['L/s'] / Q['m³/h'], 3.6, 1e-9);
  near('1 US gpm is 0.0630902 L/s', Q['gpm (US)'] / Q['L/s'], 0.0630902, 1e-6);
  near('...so 100 gpm is 6.309 L/s', 100 * Q['gpm (US)'] / Q['L/s'], 6.30902, 1e-4);

  /* THE TEMPERATURE PAIR, which is the one that bites. */
  const cToF = c => c * 9 / 5 + 32;
  const dToF = c => c * 9 / 5;
  near('0 °C is 32 °F', cToF(0), 32, 0);
  near('100 °C is 212 °F', cToF(100), 212, 0);
  near('−40 °C is −40 °F', cToF(-40), -40, 1e-12);
  near('A 5 K difference is 9 °F', dToF(5), 9, 1e-12);
  ok('...and NOT 41, which is what one shared row would have given',
     Math.abs(dToF(5) - cToF(5)) > 30);
}

report();
