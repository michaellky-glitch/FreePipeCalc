/* FreePipeCalc — thermal module.
 * Run:  node test/thermal.test.js
 *
 * Expectations are hand calculations, not numbers read back out of the code
 * (ARCHITECTURE.md §15). Where a case has a closed form the algebra is written
 * out above it so it can be re-checked without running anything.
 *
 * SIGN CONVENTION throughout, and it is about the FLUID:
 *     Q < 0  heat removed from the fluid    Q > 0  heat added to the fluid
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'data/pumps.js', 'data/valves.js',
                 'src/hydraulics.js', 'src/solver.js', 'src/network.js', 'src/thermal.js']);
const M = FD.model, NET = FD.network, TH = FD.thermal;

const RHO = 998, CP = 4187;

/* A straight run: source -> pipe -> [device] -> pipe -> outflow. */
function line(opts) {
  opts = opts || {};
  const m = M.create();
  m.settings.thermal = Object.assign({
    ambient: 20, supplyTemp: 6, insulationK: 0.02, surfaceCoeff: 8,
    insulationSet: 'none'
  }, opts.thermal || {});
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0);
  const b = M.addNode(m, lv, opts.length || 10, 0);
  M.setSource(m, a.id, 400e3);
  if (opts.supplyTemp !== undefined) a.device.temperature = opts.supplyTemp;
  b.device = { kind: 'demand', flow: opts.flow || 0.005,
               reqPressure: 100e3, include: true };
  const p = M.addPipe(m, a.id, b.id,
    { size: opts.size || 'DN50', schedule: 'sch40' });
  if (opts.insulation_mm !== undefined) p.insulation_mm = opts.insulation_mm;
  return { m, a, b, p };
}

// ------------------------------------------------------------ loss per metre
/* R' = ln(r_o/r_i)/(2.pi.k) + 1/(2.pi.r_o.h)   [K.m/W],  U' = 1/R'
 *
 * DN50 sch40 is 60.30 mm OD, so r_i = 0.03015 m. With 30 mm of insulation,
 * r_o = 0.06015 m.
 *   ln(0.06015/0.03015) = ln(1.995025) = 0.6907255
 *   /(2.pi.0.02)         = 0.6907255 / 0.1256637 = 5.496...   K.m/W
 *   1/(2.pi.0.06015.8)   = 1/3.023...            = 0.33078    K.m/W
 *   R' = 5.8272 -> U' = 0.17161 W/(m.K)
 */
section('Heat loss per metre of pipe');
{
  const od = 0.06030, t = 0.030, k = 0.02, h = 8;
  const r_i = od / 2, r_o = r_i + t;
  const Rins = Math.log(r_o / r_i) / (2 * Math.PI * k);
  const Rsurf = 1 / (2 * Math.PI * r_o * h);
  const hand = 1 / (Rins + Rsurf);

  near('U per metre matches the two-resistance form',
       TH.lossPerMetreK(od, t, k, h), hand, 1e-12);
  near('...and that is 0.1716 W/(m.K)', hand, 0.17161, 1e-4);

  /* Bare pipe: the insulation term vanishes and the surface film is all of it.
   * 1/(2.pi.0.03015.8) = 0.65995 K.m/W  ->  U' = 1.5153 W/(m.K), nine times
   * the insulated figure. */
  const bare = TH.lossPerMetreK(od, 0, k, h);
  near('Uninsulated is the surface film alone',
       bare, 2 * Math.PI * (od / 2) * h, 1e-12);
  near('...which is 1.5155 W/(m.K)', bare, 1.515504, 1e-5);
  ok('Insulation cuts the loss by about 9x', bare / hand > 8 && bare / hand < 10,
     String(bare / hand));

  // More insulation always helps; a better conductor always hurts.
  ok('Thicker insulation loses less',
     TH.lossPerMetreK(od, 0.050, k, h) < TH.lossPerMetreK(od, 0.030, k, h));
  ok('A worse insulant loses more',
     TH.lossPerMetreK(od, 0.030, 0.04, h) > TH.lossPerMetreK(od, 0.030, k, h));
  ok('A bigger pipe loses more per metre',
     TH.lossPerMetreK(0.1143, t, k, h) > TH.lossPerMetreK(od, t, k, h));
  ok('Zero diameter is not a pipe', TH.lossPerMetreK(0, t, k, h) === 0);
}

// ----------------------------------------------------------- pipe outlet
/* T_out = T_amb + (T_in - T_amb).exp(-U'.L/(m.Cp))
 *
 * The exponential matters. A linear model on a long run at low flow walks the
 * temperature straight past ambient and out the other side; this cannot.
 */
section('Temperature along a pipe');
{
  const tIn = 6, tAmb = 20, U = 0.17161, L = 100, mdot = 0.5, cp = CP;
  const x = U * L / (mdot * cp);
  const hand = tAmb + (tIn - tAmb) * Math.exp(-x);
  near('Outlet follows the exponential', TH.pipeOutlet(tIn, tAmb, U, L, mdot, cp),
       hand, 1e-12);
  ok('Chilled water in a warm room gains heat', hand > tIn && hand < tAmb);

  near('No length, no change', TH.pipeOutlet(tIn, tAmb, U, 0, mdot, cp), tIn, 1e-12);
  near('No loss coefficient, no change', TH.pipeOutlet(tIn, tAmb, 0, L, mdot, cp),
       tIn, 1e-12);
  near('At ambient it stays at ambient',
       TH.pipeOutlet(tAmb, tAmb, U, L, mdot, cp), tAmb, 1e-12);

  /* It APPROACHES ambient and stops, however extreme the case. This is the
   * assertion a linear model fails. */
  const far = TH.pipeOutlet(6, 20, 5, 100000, 0.001, cp);
  ok('An enormous run equilibrates to ambient and no further',
     far <= 20 + 1e-9 && far > 19.99, String(far));
  const hot = TH.pipeOutlet(80, 20, 5, 100000, 0.001, cp);
  ok('...from the other side too', hot >= 20 - 1e-9 && hot < 20.01, String(hot));

  // Higher flow carries the temperature further before it changes.
  ok('More flow means less change over the same run',
     Math.abs(TH.pipeOutlet(6, 20, U, L, 2.0, cp) - 6) <
     Math.abs(TH.pipeOutlet(6, 20, U, L, 0.5, cp) - 6));
}

// ------------------------------------------------------------ a solved run
section('A single insulated run, end to end');
{
  const t = line({ length: 100, flow: 0.005, insulation_mm: 30,
                   supplyTemp: 6, thermal: { ambient: 20, surfaceCoeff: 8 } });
  const res = NET.solveModel(t.m);
  ok('Solves', res.converged === true, JSON.stringify(res.errors));
  ok('Produces a thermal result', !!res.thermal);

  const th = res.thermal;
  near('The source holds its supply temperature', th.temperature[t.a.id], 6, 1e-12);

  /* Hand calculation, every step:
   *   mdot = rho.Q = 998 x 0.005          = 4.99 kg/s
   *   C    = mdot.Cp = 4.99 x 4187        = 20893.13 W/K
   *   U'   = 0.171614 W/(m.K)  (above)
   *   x    = U'.L/C = 17.1614 / 20893.13  = 8.2139e-4
   *   T_out = 20 + (6-20).e^-x            = 6.011495 C
   */
  const mdot = RHO * 0.005;
  const C = mdot * CP;
  const U = TH.lossPerMetreK(0.06030, 0.030, 0.02, 8);
  const hand = 20 + (6 - 20) * Math.exp(-U * 100 / C);
  near('The outlet temperature is the hand answer',
       th.temperature[t.b.id], hand, 1e-9);
  near('...which is 6.0115 C', hand, 6.01149, 1e-4);

  /* Q = C.dT, and it is POSITIVE: the room is warmer, so heat goes INTO the
   * chilled water. 20893.13 x 0.011495 = 240.2 W over 100 m. */
  const link = th.links[t.p.id];
  near('Duty is C.dT', link.qW, C * (link.tOut - link.tIn), 1e-9);
  ok('A cold pipe in a warm room GAINS heat, so Q is positive', link.qW > 0,
     link.qW.toFixed(2) + ' W');
  near('...about 240 W over 100 m', link.qW, 240.2, 1);

  /* The same run with hot water: the sign flips, because now the fluid is
   * losing heat to the room. Nothing else changes. */
  const hotRun = line({ length: 100, flow: 0.005, insulation_mm: 30,
                        supplyTemp: 80, thermal: { ambient: 20, surfaceCoeff: 8 } });
  const hotRes = NET.solveModel(hotRun.m);
  const hotLink = hotRes.thermal.links[hotRun.p.id];
  ok('A hot pipe in a cool room LOSES heat, so Q is negative', hotLink.qW < 0,
     hotLink.qW.toFixed(2) + ' W');
  near('...and the magnitude scales with the driving difference',
       Math.abs(hotLink.qW) / Math.abs(link.qW), 60 / 14, 0.01);

  // Uninsulated must lose far more.
  const bare = line({ length: 100, flow: 0.005, insulation_mm: 0,
                      supplyTemp: 6, thermal: { ambient: 20, surfaceCoeff: 8 } });
  const bareRes = NET.solveModel(bare.m);
  ok('A bare pipe gains much more', bareRes.thermal.links[bare.p.id].qW > link.qW * 5);
}

// -------------------------------------------------------------- equipment
/* Q = mdot.Cp.dT, the whole thermal module in one line. The two modes are the
 * two ways of reading it, and the SAME toggle serves DESIGN and SIMULATION:
 * dT mode holds the temperature difference and lets the duty float with flow;
 * dQ mode holds the duty and lets the difference float.
 */
section('Equipment: dT and dQ are the same equation read two ways');
{
  function withEquip(equip, flow) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                           surfaceCoeff: 8, insulationSet: 'none' };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0);
    const j = M.addNode(m, lv, 1, 0);
    const k = M.addNode(m, lv, 2, 0);
    const b = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 500e3);
    a.device.temperature = 6;
    b.device = { kind: 'demand', flow: flow, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, j.id, { size: 'DN50', schedule: 'sch40' }).insulation_mm = 0;
    const e = M.addPipe(m, j.id, k.id, { kind: 'equip' });
    e.equip = Object.assign({ qRated: flow, pdRated: 20e3 }, equip);
    M.addPipe(m, k.id, b.id, { size: 'DN50', schedule: 'sch40' }).insulation_mm = 0;
    /* Pipes carry no length here, so they contribute no heat: the equipment is
     * the only thing acting, which is what makes the arithmetic checkable. */
    m.pipes.forEach(p => { if (p.kind !== 'equip') p.insulation_mm = 0; });
    return { m, e, a, b, j, k };
  }

  const flow = 0.005;
  const C = RHO * flow * CP;              // 20893.13 W/K

  // --- dT mode: state the difference, the duty follows ---
  {
    const t = withEquip({ thermalMode: 'dT', dT: 6 }, flow);
    const res = NET.solveModel(t.m);
    const link = res.thermal.links[t.e.id];
    near('dT mode holds the stated difference', link.dT, 6, 1e-9);
    near('...and the duty is mdot.Cp.dT', link.qW, C * 6, 1e-6);
    near('...which is 125.36 kW', link.qW / 1000, 125.359, 0.01);
    ok('A positive dT adds heat to the fluid', link.qW > 0);

    /* Halve the flow and the difference is UNCHANGED — that is what dT mode
     * means — so the duty halves. This is the controlled-coil case. */
    const half = withEquip({ thermalMode: 'dT', dT: 6 }, flow / 2);
    const halfLink = NET.solveModel(half.m).thermal.links[half.e.id];
    near('At half flow the difference is unchanged', halfLink.dT, 6, 1e-9);
    near('...so the duty halves', halfLink.qW, link.qW / 2, Math.abs(link.qW) * 1e-6);
  }

  // --- dQ mode: state the duty, the difference follows ---
  {
    const duty = -125359;                 // W, negative: a chiller
    const t = withEquip({ thermalMode: 'dQ', duty: duty }, flow);
    const res = NET.solveModel(t.m);
    const link = res.thermal.links[t.e.id];
    near('dQ mode holds the stated duty', link.qW, duty, 1e-6);
    near('...and the difference is Q/(mdot.Cp)', link.dT, duty / C, 1e-9);
    near('...which is -6.0 K', link.dT, -6, 1e-3);
    ok('A negative duty removes heat, so the water leaves colder',
       link.tOut < link.tIn);

    /* Halve the flow and the DUTY is unchanged — that is what dQ mode means —
     * so the difference doubles. This is the fixed-load case. */
    const half = withEquip({ thermalMode: 'dQ', duty: duty }, flow / 2);
    const halfLink = NET.solveModel(half.m).thermal.links[half.e.id];
    near('At half flow the duty is unchanged', halfLink.qW, duty, 1e-6);
    near('...so the difference doubles', halfLink.dT, link.dT * 2, 1e-6);
  }

  /* The two modes AGREE at the design point, which is the check that they are
   * one equation and not two. A dT of 6 K and a duty of mdot.Cp.6 must give
   * identical temperatures at the same flow. */
  {
    const byDT = withEquip({ thermalMode: 'dT', dT: 6 }, flow);
    const byDQ = withEquip({ thermalMode: 'dQ', duty: C * 6 }, flow);
    const l1 = NET.solveModel(byDT.m).thermal.links[byDT.e.id];
    const l2 = NET.solveModel(byDQ.m).thermal.links[byDQ.e.id];
    near('The two modes agree at the design point', l2.tOut, l1.tOut, 1e-9);
    near('...on duty as well', l2.qW, l1.qW, 1e-6);
  }

  // Isolated equipment does nothing thermally.
  {
    const t = withEquip({ thermalMode: 'dT', dT: 6, off: true }, flow);
    const res = NET.solveModel(t.m);
    ok('Isolated equipment is out of the circuit entirely',
       res.thermal === null || res.thermal.links[t.e.id] === undefined);
  }
}

// ---------------------------------------------------------------- mixing
/* Rule of mixtures, mass-weighted:  T = sum(mdot_i.T_i) / sum(mdot_i)
 *
 * Mass rather than volume because it is energy that mixes; with one fluid and
 * a constant Cp the Cp cancels and this is exact.
 */
section('Mixing at a junction');
{
  /* Two sources at different temperatures meeting at a tee, then one outflow.
   * Flows are set by the hydraulics, so the test reads them back rather than
   * assuming them — the ASSERTION is the mass-weighted identity, which holds
   * whatever the split turns out to be. */
  const m = M.create();
  m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                         surfaceCoeff: 8, insulationSet: 'none' };
  const lv = m.levels[0].id;
  const hot = M.addNode(m, lv, 0, 10);
  const cold = M.addNode(m, lv, 0, -10);
  const tee = M.addNode(m, lv, 10, 0);
  const out = M.addNode(m, lv, 20, 0);
  M.setSource(m, hot.id, 400e3);  hot.device.temperature = 80;
  M.setSource(m, cold.id, 400e3); cold.device.temperature = 10;
  out.device = { kind: 'demand', flow: 0.010, reqPressure: 100e3, include: true };
  const p1 = M.addPipe(m, hot.id, tee.id, { size: 'DN50', schedule: 'sch40' });
  const p2 = M.addPipe(m, cold.id, tee.id, { size: 'DN50', schedule: 'sch40' });
  const p3 = M.addPipe(m, tee.id, out.id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(p => { p.insulation_mm = 0; });
  /* No heat exchange with the room: the mixing is then the only thing acting,
   * so the identity can be asserted exactly rather than to a tolerance. */
  m.settings.thermal.surfaceCoeff = 1e-12;

  const res = NET.solveModel(m);
  ok('Solves', res.converged === true, JSON.stringify(res.errors));
  const th = res.thermal;

  const q1 = Math.abs(res.flow[p1.id]), q2 = Math.abs(res.flow[p2.id]);
  ok('Both sources feed the tee', q1 > 1e-6 && q2 > 1e-6);

  const t1 = th.links[p1.id].tOut, t2 = th.links[p2.id].tOut;
  const hand = (q1 * t1 + q2 * t2) / (q1 + q2);   // rho cancels
  near('The tee is the mass-weighted mix of what arrives',
       th.temperature[tee.id], hand, 1e-9);
  ok('...and lies between the two', th.temperature[tee.id] > t2 &&
     th.temperature[tee.id] < t1, `${t2} .. ${th.temperature[tee.id]} .. ${t1}`);

  /* Equal flows would give the plain average. They are equal here by symmetry
   * — same length, same size — so the mix must be 45 C. */
  near('Equal legs give the plain average', th.temperature[tee.id], 45, 0.5);
  near('...and the flows really are equal', q1, q2, q1 * 1e-6);

  // Energy is conserved across the junction.
  const cp = CP;
  const inW = RHO * q1 * cp * t1 + RHO * q2 * cp * t2;
  const outW = RHO * (q1 + q2) * cp * th.temperature[tee.id];
  near('Energy in equals energy out at the junction', outW, inW, Math.abs(inW) * 1e-9);
}

// ---------------------------------------------------------- closed circuit
section('A closed circuit pins its own reference temperature');
{
  /* Pump and chiller round a loop, no source at all — the thermal equivalent
   * of the hydraulic NO_SOURCE case. Something has to be known or every
   * temperature floats, so one node is pinned and it is reported. */
  const m = M.create();
  m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                         surfaceCoeff: 8, insulationSet: 'none' };
  const lv = m.levels[0].id;
  const n = [];
  for (let i = 0; i < 4; i++) n.push(M.addNode(m, lv, i * 10, 0));
  const back = M.addNode(m, lv, 15, 20);

  const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
  pump.pump = { mode: 'auto', head: 5 };
  const chiller = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
  chiller.equip = { qRated: 0.010, pdRated: 40e3, thermalMode: 'dQ', duty: -100000 };
  const coil = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
  coil.equip = { qRated: 0.010, pdRated: 30e3, thermalMode: 'dQ', duty: 100000 };
  M.addPipe(m, n[3].id, back.id, { size: 'DN50', schedule: 'sch40' });
  M.addPipe(m, back.id, n[0].id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(p => { p.insulation_mm = 0; });
  m.settings.thermal.surfaceCoeff = 1e-12;      // adiabatic pipes

  const res = NET.solveModel(m);
  const th = res.thermal;
  ok('Produces a thermal result', !!th);
  ok('It converged', th.converged === true, String(th.iterations));
  ok('A node was pinned, and it is reported', !!th.pinned);
  ok('...and said out loud as a warning',
     th.warnings.some(w => w.code === 'THERMAL_DATUM'));
  near('The pinned node sits at the system flow temperature',
       th.temperature[th.pinned.node], 6, 1e-9);

  /* Chiller -100 kW and coil +100 kW: the loop balances, so the water returns
   * to where it started. That is the physical statement of steady state, and
   * it is what the iteration has to reproduce round a loop. */
  const dutySum = Object.keys(th.links)
    .reduce((s2, id) => s2 + th.links[id].qW, 0);
  near('The duties cancel round the loop', dutySum, 0, 1);

  /* And the temperatures separate by Q/(mdot.Cp) across each machine. */
  const q = Math.abs(res.flow[chiller.id]);
  const C = RHO * q * CP;
  near('The chiller drops the water by Q/(mdot.Cp)',
       th.links[chiller.id].dT, -100000 / C, 1e-6);
  near('...and the coil puts it back', th.links[coil.id].dT, 100000 / C, 1e-6);
}

// ------------------------------------------------------- pumps and valves
section('Pumps and valves pass temperature straight through');
{
  const m = M.create();
  m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                         surfaceCoeff: 1e-12, insulationSet: 'none' };
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
  const c = M.addNode(m, lv, 2, 0), d = M.addNode(m, lv, 3, 0);
  const e = M.addNode(m, lv, 20, 0);
  M.setSource(m, a.id, 500e3); a.device.temperature = 75;
  e.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
  const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
  pump.pump = { mode: 'fixed', head: 3 };
  M.addPipe(m, b.id, c.id, { size: 'DN50', schedule: 'sch40' });
  const valve = M.addPipe(m, c.id, d.id, { kind: 'valve' });
  valve.valve = { type: 'gate', kv: FD.valves.defaultKv('gate', 52.48), opening: 100 };
  M.addPipe(m, d.id, e.id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(p => { p.insulation_mm = 0; });

  const th = NET.solveModel(m).thermal;
  near('A pump adds no heat', th.links[pump.id].dT, 0, 1e-12);
  near('...and no duty', th.links[pump.id].qW, 0, 1e-9);
  near('A valve adds no heat', th.links[valve.id].dT, 0, 1e-12);
  /* Both are real simplifications — a pump does put its shaft work in — and
   * they are Michael's instruction, recorded so a future session does not
   * "fix" them without asking. */
  near('So the water arrives as it left', th.temperature[e.id], 75, 1e-9);
}

// -------------------------------------------------------------- properties
section('Fluid properties and the unverified flag');
{
  const water = FD.fluids.get('water');
  near('Water density is the app\'s long-standing 998', water.density, 998, 1e-12);
  near('Water Cp is the app\'s long-standing 4187', water.specificHeat, 4187, 1e-12);
  ok('Water is not flagged', water.verified === true);

  /* The glycol rows were written from recollection, at Michael's instruction,
   * and are flagged until he checks them. The test asserts the FLAG, not the
   * values — asserting values written from memory against the same memory
   * would prove nothing. */
  const unv = FD.fluids.unverified();
  ok('Three glycol rows are flagged unverified', unv.length === 3,
     unv.map(f => f.key).join(', '));
  ok('...and they are the propylene ones',
     unv.every(f => /Propylene/.test(f.name)));
  ok('...each naming what to check it against',
     unv.every(f => /ASHRAE|manufacturer/.test(f.source)));

  /* What CAN be asserted about them is the ordering, which is physics rather
   * than recollection: more glycol means denser, more viscous, lower Cp and a
   * lower freezing point. A transcription slip that broke any of these would
   * be caught. */
  const g = ['water', 'pg10', 'pg20', 'pg30'].map(k => FD.fluids.get(k));
  for (let i = 1; i < g.length; i++) {
    ok(`${g[i].key}: denser than ${g[i - 1].key}`, g[i].density > g[i - 1].density);
    ok(`${g[i].key}: more viscous`,
       g[i].kinematicViscosity > g[i - 1].kinematicViscosity);
    ok(`${g[i].key}: lower specific heat`, g[i].specificHeat < g[i - 1].specificHeat);
    ok(`${g[i].key}: freezes lower`, g[i].freezePoint < g[i - 1].freezePoint);
  }

  // Applying a preset copies its numbers onto the model.
  const m = M.create();
  M.applyFluidPreset(m, 'pg30');
  near('Applying a preset copies its density', m.settings.fluid.density, 1024, 1e-12);
  near('...and its Cp', m.settings.fluid.specificHeat, 3850, 1e-12);
  ok('...and records which fluid they came from', m.settings.fluid.preset === 'pg30');

  /* Custom leaves the numbers alone: they are the engineer's. */
  m.settings.fluid.density = 1100;
  M.applyFluidPreset(m, 'custom');
  near('Custom does not overwrite what was entered', m.settings.fluid.density, 1100, 1e-12);
  ok('Custom is the only editable fluid',
     FD.fluids.isEditable('custom') && !FD.fluids.isEditable('pg30'));

  // A saved file cannot drift from its preset.
  const round = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(
    (() => { const mm = M.create(); M.applyFluidPreset(mm, 'pg20');
             mm.settings.fluid.density = 1;      // hand-edited nonsense
             return mm; })()))));
  near('Reloading re-applies the named fluid\'s properties',
       round.settings.fluid.density, 1015, 1e-12);
}

section('Insulation thickness defaults are flagged, not sourced');
{
  const unv = FD.insulation.unverified();
  ok('The default thickness set is flagged', unv.length === 1 &&
     unv[0].key === 'standard');
  ok('"Uninsulated" is not — zero is a real choice',
     FD.insulation.set('none').verified === true);
  near('Uninsulated really is zero',
       FD.insulation.defaultThickness(100, 'none'), 0, 1e-12);

  // Rises with size, as every published table does.
  let mono = true;
  FD.insulation.DN.forEach((dn, i) => {
    if (i && FD.insulation.defaultThickness(dn, 'standard') <
             FD.insulation.defaultThickness(FD.insulation.DN[i - 1], 'standard')) {
      mono = false;
    }
  });
  ok('Thickness never falls with size', mono);
  near('Clamps below the table', FD.insulation.defaultThickness(5, 'standard'),
       FD.insulation.defaultThickness(15, 'standard'), 1e-12);
  near('Clamps above it', FD.insulation.defaultThickness(900, 'standard'),
       FD.insulation.defaultThickness(300, 'standard'), 1e-12);

  /* A pipe's own value always wins, INCLUDING zero — otherwise a deliberately
   * bare pipe would silently pick up the default. */
  const m = M.create();
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0);
  const p = M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
  ok('With nothing set it takes the default',
     TH.thicknessOf(m, p) > 0);
  p.insulation_mm = 0;
  near('A pipe set to zero is bare', TH.thicknessOf(m, p), 0, 1e-12);
  p.insulation_mm = 45;
  near('...and its own value is used', TH.thicknessOf(m, p), 0.045, 1e-12);
}

report();
