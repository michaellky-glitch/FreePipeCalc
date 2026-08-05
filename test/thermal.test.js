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
    /* Wide, because several of these run legitimately hot — an 80 °C LTHW
     * flow is not a runaway. The guard itself is tested on its own below. */
    tempMin: -100, tempMax: 200
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
                           surfaceCoeff: 8, tempMin: -100, tempMax: 200 };
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

  // --- a HEAT EXCHANGER: state the load, the temperature follows ---
  {
    const t = withEquip({ equipType: 'exchanger', duty: C * 6 }, flow);
    const res = NET.solveModel(t.m);
    const link = res.thermal.links[t.e.id];
    near('The stated load is delivered', link.qW, C * 6, 1e-6);
    near('...and the difference is Q/(mdot.Cp)', link.dT, 6, 1e-9);
    near('...which is 125.36 kW', link.qW / 1000, 125.359, 0.01);
    ok('A positive load adds heat to the fluid', link.qW > 0);

    /* Halve the flow and the DUTY is unchanged — that is what load-led means —
     * so the difference doubles. */
    const half = withEquip({ equipType: 'exchanger', duty: C * 6 }, flow / 2);
    const halfLink = NET.solveModel(half.m).thermal.links[half.e.id];
    near('At half flow the load is unchanged', halfLink.qW, C * 6, 1e-6);
    near('...so the difference doubles', halfLink.dT, 12, 1e-6);
  }

  // A negative load is a chiller-side exchanger: the water leaves colder.
  {
    const duty = -125359;
    const t = withEquip({ equipType: 'exchanger', duty: duty }, flow);
    const link = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A negative load is held too', link.qW, duty, 1e-6);
    near('...and the difference is -6.0 K', link.dT, -6, 1e-3);
    ok('...so the water leaves colder', link.tOut < link.tIn);
  }

  /* Q, ΔT and ṁ are LOCKED by Q = ṁ·Cp·ΔT, so stating a ΔT at design is the
   * same statement as stating the duty it implies at the rated flow. The model
   * helpers do that conversion, and it must round-trip exactly. */
  {
    const t = withEquip({ equipType: 'exchanger', duty: 0 }, flow);
    const duty = M.equipDutyFromDT(t.m, t.e, 6);
    near('A stated ΔT converts to the duty it means', duty, C * 6, 1e-6);
    near('...and back again', M.equipDTFromDuty(t.m, t.e, duty), 6, 1e-12);
    t.e.equip.duty = duty;
    near('...and the solve agrees',
         NET.solveModel(t.m).thermal.links[t.e.id].dT, 6, 1e-9);
  }

  // Isolated equipment does nothing thermally.
  {
    const t = withEquip({ equipType: 'exchanger', duty: C * 6, off: true }, flow);
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
                         surfaceCoeff: 8, tempMin: -100, tempMax: 200 };
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
  m.settings.thermal.surfaceCoeff = 0;

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
                         surfaceCoeff: 8, tempMin: -100, tempMax: 200 };
  const lv = m.levels[0].id;
  const n = [];
  for (let i = 0; i < 4; i++) n.push(M.addNode(m, lv, i * 10, 0));
  const back = M.addNode(m, lv, 15, 20);

  const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
  pump.pump = { mode: 'auto', head: 5 };
  const chiller = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
  chiller.equip = { qRated: 0.010, pdRated: 40e3, equipType: 'exchanger', duty: -100000 };
  const coil = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
  coil.equip = { qRated: 0.010, pdRated: 30e3, equipType: 'exchanger', duty: 100000 };
  M.addPipe(m, n[3].id, back.id, { size: 'DN50', schedule: 'sch40' });
  M.addPipe(m, back.id, n[0].id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(p => { p.insulation_mm = 0; });
  m.settings.thermal.surfaceCoeff = 0;          // adiabatic: h = 0

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
                         surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
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

section('Insulation lives on the pipe schedule');
{
  /* Michael's rule (v0.10.1): 25 mm below DN50, 50 mm from DN50 up. It is his
   * standard rather than a transcription, so it is not flagged the way the
   * glycol properties are — it is a decision, and decisions are his to make. */
  near('DN15 takes 25 mm', FD.schedules.defaultInsulation(15), 25, 1e-12);
  near('DN40 takes 25 mm', FD.schedules.defaultInsulation(40), 25, 1e-12);
  near('DN50 is the boundary and takes the LARGER',
       FD.schedules.defaultInsulation(50), 50, 1e-12);
  near('DN300 takes 50 mm', FD.schedules.defaultInsulation(300), 50, 1e-12);

  // An override on the schedule wins over the rule.
  const ov = { sch40: { DN50: 80 } };
  near('A schedule override is used',
       FD.schedules.insulationFor('sch40', 'DN50', 50, ov), 80, 1e-12);
  near('...only for the size it names',
       FD.schedules.insulationFor('sch40', 'DN100', 100, ov), 50, 1e-12);
  near('...and only for the schedule it names',
       FD.schedules.insulationFor('sch10', 'DN50', 50, ov), 50, 1e-12);
  near('A blank override falls back to the rule',
       FD.schedules.insulationFor('sch40', 'DN50', 50, { sch40: { DN50: '' } }),
       50, 1e-12);
  near('Zero is a real override, not a blank',
       FD.schedules.insulationFor('sch40', 'DN50', 50, { sch40: { DN50: 0 } }),
       0, 1e-12);

  /* A pipe's OWN value always wins, INCLUDING zero — otherwise a deliberately
   * bare pipe would silently pick up its schedule's figure. */
  const m = M.create();
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0);
  const p = M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
  near('With nothing set it takes the schedule figure',
       TH.thicknessOf(m, p), 0.050, 1e-12);
  m.settings.insulation = { sch40: { DN50: 80 } };
  near('...and follows an edit to the schedule', TH.thicknessOf(m, p), 0.080, 1e-12);
  p.insulation_mm = 0;
  near('A pipe set to zero is bare, whatever the schedule says',
       TH.thicknessOf(m, p), 0, 1e-12);
  p.insulation_mm = 45;
  near('...and its own value is used', TH.thicknessOf(m, p), 0.045, 1e-12);

  /* Custom schedules can now carry an OUTSIDE diameter, which is what the
   * insulation geometry needs. Without one it falls back to the bore, which
   * understates the surface and so understates the loss. */
  const parsed = FD.schedules.parseSizeTable('DN50\t53.0\t60.3\nDN80\t80.8\t88.9');
  ok('Three columns parse as label / bore / OD', parsed.sizes.length === 2);
  near('Bore is read', parsed.sizes[0].id_mm, 53.0, 1e-12);
  near('...and the outside diameter with it', parsed.sizes[0].od_mm, 60.3, 1e-12);
  const noOD = FD.schedules.parseSizeTable('DN50\t53.0');
  near('With no OD column it falls back to the bore',
       noOD.sizes[0].od_mm, 53.0, 1e-12);
  const badOD = FD.schedules.parseSizeTable('DN50\t53.0\t40');
  near('An OD smaller than the bore is refused, not stored',
       badOD.sizes[0].od_mm, 53.0, 1e-12);
}

/* --------------------------------------------------------------------------
 * Michael's case: a 100 kW load with NO heat rejection equipment.
 *
 * A sealed loop, a pump, a +100 kW load, and bare pipework. Nothing removes
 * heat except the pipes, so the water heats up until they shed exactly what
 * the load puts in. Where it settles IS the answer, and it is set by the
 * ambient rather than by anything the engineer types.
 *
 * This is the case that showed the reference-pinning was wrong. Pinning a node
 * at the flow temperature would have held the loop there and reported a system
 * that never warms — the opposite of the truth. Ambient is a reference, and a
 * pin is only needed when there is no source AND no ambient coupling at all.
 *
 * The steady-state statement is an ENERGY BALANCE and needs no reference
 * temperature to check:  pipe loss + equipment duty = 0.
 * ----------------------------------------------------------------------- */
section('A 100 kW load with no heat rejection finds its own equilibrium');
{
  function loop(loadW, ambient, pipeLen) {
    const m = M.create();
    m.settings.thermal = { ambient: ambient, supplyTemp: 6,
                           insulationK: 0.02, surfaceCoeff: 8,
                           tempMin: -100, tempMax: 500 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0);
    const b = M.addNode(m, lv, 2, 0);
    const c = M.addNode(m, lv, 3, 0);
    const d = M.addNode(m, lv, 3 + pipeLen, 0);

    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const load = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    load.equip = { qRated: 0.020, pdRated: 50e3, equipType: 'exchanger', duty: loadW };
    /* Bare pipework, so it can actually reject heat. Out and back. */
    const out = M.addPipe(m, c.id, d.id, { size: 'DN100', schedule: 'sch40' });
    const ret = M.addPipe(m, d.id, a.id, { size: 'DN100', schedule: 'sch40' });
    out.insulation_mm = 0; ret.insulation_mm = 0;
    return { m, load, out, ret, a, b, c, d };
  }

  const t = loop(100000, 20, 400);
  const res = NET.solveModel(t.m);
  ok('Solves', res.converged === true, JSON.stringify(res.errors));
  const th = res.thermal;
  ok('Produces a thermal result', !!th);

  /* NOT pinned: ambient sets the level, so nothing needed pinning. */
  ok('Nothing was pinned — ambient is the reference', th.pinned === null);
  ok('...and it is reported as a floating system', th.floating === true);
  ok('No datum warning was raised',
     !th.warnings.some(w => w.code === 'THERMAL_DATUM'));
  ok('It converged', th.converged === true, String(th.iterations));

  /* THE assertion: at steady state the pipes shed exactly what the load puts
   * in. This needs no reference temperature and no hand-computed answer — it
   * is the definition of steady state. */
  near('Pipe loss cancels the load exactly', th.totals.pipeLoss, -100000, 1);
  near('...which is what the imbalance figure reports', th.imbalance, 0, 1);
  near('The load is delivering its stated 100 kW', th.totals.equipDuty, 100000, 1);

  /* The water must sit ABOVE ambient — it is being heated and losing to the
   * room — and well above, because bare DN100 sheds only ~1.5 W/(m·K). */
  ok('The loop settles above ambient', th.totals.min > 20,
     th.totals.min.toFixed(1) + ' … ' + th.totals.max.toFixed(1) + ' °C');

  /* And the level is set by the physics, not by the flow temperature typed on
   * the THERMAL tab. Changing that must move nothing. */
  const t2 = loop(100000, 20, 400);
  t2.m.settings.thermal.supplyTemp = 75;
  const th2 = NET.solveModel(t2.m).thermal;
  near('The stated flow temperature does not move a floating system',
       th2.totals.max, th.totals.max, 0.01);

  /* Raising ambient raises the whole loop by the same amount: the balance
   * depends on the DIFFERENCE to ambient, so the profile just shifts. */
  const t3 = loop(100000, 30, 400);
  const th3 = NET.solveModel(t3.m).thermal;
  near('Raising ambient 10 K raises the loop 10 K',
       th3.totals.max - th.totals.max, 10, 0.05);
  near('...and the balance still closes', th3.imbalance, 0, 1);

  /* Halve the load and the temperature rise above ambient halves — the loss is
   * linear in the difference, so the equilibrium difference is linear in the
   * load. That is a hand-checkable statement about the whole loop. */
  const t4 = loop(50000, 20, 400);
  const th4 = NET.solveModel(t4.m).thermal;
  near('Half the load, half the rise above ambient',
       (th4.totals.max - 20) / (th.totals.max - 20), 0.5, 0.02);

  /* More pipe rejects the same load at a smaller rise. Double the run, and the
   * rise roughly halves — not exactly, because the loss per metre is driven by
   * the local difference, which is itself falling along the pipe. */
  const t5 = loop(100000, 20, 800);
  const th5 = NET.solveModel(t5.m).thermal;
  ok('Twice the pipe settles at a lower temperature',
     th5.totals.max < th.totals.max,
     `${th.totals.max.toFixed(1)} -> ${th5.totals.max.toFixed(1)} °C`);
  near('...and still balances', th5.imbalance, 0, 1);

  /* INSULATE it and the same load has almost nowhere to go, so the loop runs
   * far hotter. This is the case worth seeing on a real job. */
  const t6 = loop(100000, 20, 400);
  t6.out.insulation_mm = 50; t6.ret.insulation_mm = 50;
  const th6 = NET.solveModel(t6.m).thermal;
  ok('Insulating the same loop drives it much hotter',
     th6.totals.max > th.totals.max * 2,
     `bare ${th.totals.max.toFixed(0)} °C, lagged ${th6.totals.max.toFixed(0)} °C`);
  near('...and it still balances', th6.imbalance, 0, 1);
}

/* --------------------------------------------------------------------------
 * The runaway guard (Michael, 2026-08-02).
 *
 * The solve is exact, so nothing runs away numerically — but a correct answer
 * can still be an absurd one. A large load in a lagged loop with no heat
 * rejection genuinely does settle somewhere ridiculous, and that is a
 * statement about the DESIGN, not the arithmetic.
 *
 * The band is adjustable, and it has to be: the default +/-50 C suits chilled
 * water and fires on any LTHW system, which the tests above demonstrate by
 * needing it widened.
 * ----------------------------------------------------------------------- */
section('Temperatures outside the plausible band are an error');
{
  function loaded(loadW, band, ins) {
    const m = M.create();
    m.settings.thermal = Object.assign(
      { ambient: 20, supplyTemp: 6, insulationK: 0.02, surfaceCoeff: 8 }, band);
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 2, 0);
    const c = M.addNode(m, lv, 3, 0), d = M.addNode(m, lv, 60, 0);
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const load = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    load.equip = { qRated: 0.020, pdRated: 50e3, equipType: 'exchanger', duty: loadW };
    const out = M.addPipe(m, c.id, d.id, { size: 'DN100', schedule: 'sch40' });
    const ret = M.addPipe(m, d.id, a.id, { size: 'DN100', schedule: 'sch40' });
    var t = (ins === undefined) ? 50 : ins;
    out.insulation_mm = t; ret.insulation_mm = t;
    return m;
  }

  // Defaults: chilled-water band, and a 100 kW load in a lagged loop breaks it.
  const hot = NET.solveModel(loaded(100000, {}));
  ok('A runaway is an ERROR, not a warning',
     (hot.errors || []).some(e => e.code === 'THERMAL_LIMIT'));
  ok('...and it clears converged, because the system cannot exist',
     hot.converged === false);
  const err = hot.errors.find(e => e.code === 'THERMAL_LIMIT');
  ok('...naming the node', !!err.node);
  ok('...and the temperature it reached', err.temperature > 50, String(err.temperature));
  ok('...and saying the band it broke', /-50 to 50/.test(err.message), err.message);

  /* The temperatures are still REPORTED. The answer is not wrong, it is
   * implausible — hiding it would leave nothing to diagnose from. */
  ok('The solved temperatures are still there', hot.thermal.totals.max > 50);
  ok('...and the energy balance still closes',
     Math.abs(hot.thermal.imbalance) < 1, String(hot.thermal.imbalance));

  /* How absurd? 100 kW into 120 m of 50 mm-lagged DN100, which sheds about
   * 0.2 W/(m·K), needs roughly 100000/(0.2 x 120) = 4200 K above ambient. The
   * solve says 4454 °C, and THAT is the point of the guard: it is the right
   * answer to a system that cannot exist. */
  ok('The absurd answer really is absurd', hot.thermal.totals.max > 4000,
     hot.thermal.totals.max.toFixed(0) + ' °C');

  // Widening the band accepts the same system, unchanged.
  const wide = NET.solveModel(loaded(100000, { tempMin: -1e6, tempMax: 1e6 }));
  ok('A wide enough band accepts it',
     !(wide.errors || []).some(e => e.code === 'THERMAL_LIMIT'));
  near('...and gives exactly the same answer', wide.thermal.totals.max,
       hot.thermal.totals.max, 1e-9);

  // A load the pipework can actually reject stays inside the default band.
  const mild = NET.solveModel(loaded(200, {}));
  ok('A load the pipe can shed is fine on the defaults',
     !(mild.errors || []).some(e => e.code === 'THERMAL_LIMIT'),
     mild.thermal.totals.max.toFixed(1) + ' °C');
  ok('...and sits just above ambient', mild.thermal.totals.max > 20 &&
     mild.thermal.totals.max < 40, mild.thermal.totals.max.toFixed(1));

  /* COLD runs away too, and must be caught the same way — the band is two
   * sided. A large negative duty drives the loop below the lower limit. */
  const cold = NET.solveModel(loaded(-100000, {}));
  const cErr = (cold.errors || []).find(e => e.code === 'THERMAL_LIMIT');
  ok('A runaway downwards is caught as well', !!cErr);
  ok('...at a temperature below the lower limit', cErr.temperature < -50,
     String(cErr.temperature));

  /* An ordinary LTHW system at 80 C flow trips the DEFAULT band, which is why
   * it is adjustable. Recorded rather than left to be discovered. */
  const lthw = M.create();
  lthw.settings.thermal = { ambient: 20, supplyTemp: 80, insulationK: 0.02,
                            surfaceCoeff: 8 };
  const lv2 = lthw.levels[0].id;
  const s1 = M.addNode(lthw, lv2, 0, 0), s2 = M.addNode(lthw, lv2, 30, 0);
  M.setSource(lthw, s1.id, 400e3); s1.device.temperature = 80;
  s2.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
  M.addPipe(lthw, s1.id, s2.id, { size: 'DN50', schedule: 'sch40' });
  const lres = NET.solveModel(lthw);
  ok('An 80 C LTHW flow trips the default band — so it must be adjustable',
     (lres.errors || []).some(e => e.code === 'THERMAL_LIMIT'));
  lthw.settings.thermal.tempMax = 120;
  ok('...and is accepted once the band matches the service',
     !(NET.solveModel(lthw).errors || []).some(e => e.code === 'THERMAL_LIMIT'));
}

/* --------------------------------------------------------------------------
 * SOURCE / SINK: state a leaving temperature, the duty follows.
 *
 * A chiller, boiler or cooling tower modulates to hold its setpoint, limited by
 * three things that bind in different places:
 *
 *   capacity  qMax   — binds at HIGH flow, where a small ΔT is still a big duty
 *                      SIGNED (2026-08-03): + adds heat to the fluid, − removes
 *                      it, on the same convention as a load. A chiller has a
 *                      NEGATIVE capacity and cannot heat at all.
 *   ΔT max    dTMax  — binds at LOW flow, where a small duty is still a big ΔT
 *   T limit   tLimit — the temperature it physically cannot pass: a tower
 *                      cannot go below wet bulb, an economizer below ambient
 *
 * Which one binds is reported, because "CH-01 limited by ΔT max" is the
 * sentence an engineer wants rather than an unexplained leaving temperature.
 * ----------------------------------------------------------------------- */
section('Source / Sink holds a setpoint until a limit binds');
{
  function plant(equip, flow, inletT) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: inletT, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), j = M.addNode(m, lv, 1, 0);
    const k = M.addNode(m, lv, 2, 0), b = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 600e3); a.device.temperature = inletT;
    b.device = { kind: 'demand', flow: flow, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, j.id, { size: 'DN50', schedule: 'sch40' });
    const e = M.addPipe(m, j.id, k.id, { kind: 'equip' });
    e.equip = Object.assign({ qRated: flow, pdRated: 20e3, equipType: 'source' }, equip);
    M.addPipe(m, k.id, b.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(p => { if (p.kind !== 'equip') p.insulation_mm = 0; });
    return { m, e };
  }

  const flow = 0.005;
  const C = RHO * flow * CP;               // 20893.13 W/K

  /* Unconstrained: it simply reaches the setpoint. Inlet 18, setpoint 6, so
   * ΔT = -12 K and Q = -12 x 20893.13 = -250.7 kW. */
  {
    const t = plant({ tSet: 6 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('It reaches the setpoint', l.tOut, 6, 1e-9);
    near('...and the duty is whatever that took', l.qW, -12 * C, 1e-6);
    near('...which is -250.7 kW', l.qW / 1000, -250.716, 0.01);
    ok('Sign is inferred: a setpoint below inlet is cooling', l.qW < 0);
    ok('Nothing is limiting it', l.limit === null || l.limit === undefined);
  }

  /* CAPACITY. The same duty asked of a 100 kW machine: it can only manage
   * 100 kW, so ΔT = -100000/20893.13 = -4.786 K and it leaves at 13.21 C. */
  {
    const t = plant({ tSet: 6, qMax: -100000 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('Capacity caps the duty', l.qW, -100000, 1e-6);
    near('...so it misses the setpoint', l.tOut, 18 - 100000 / C, 1e-9);
    near('...leaving at 13.21 C', l.tOut, 13.2129, 1e-3);
    ok('...and says which limit bound it', l.limit === 'Capacity', String(l.limit));
  }

  /* ΔT MAX. A machine that cannot work across more than 8 K leaves at 10 C,
   * whatever its capacity. */
  {
    const t = plant({ tSet: 6, qMax: -1e9, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('The difference is capped', l.dT, -8, 1e-9);
    near('...so it leaves at 10 C', l.tOut, 10, 1e-9);
    near('...at a duty of -167.1 kW', l.qW, -8 * C, 1e-6);
    ok('...reported as the ΔT limit', l.limit === 'Design ΔT', String(l.limit));
  }

  /* Both set: whichever is tighter wins. At this flow, 8 K is 167 kW, so a
   * 100 kW machine is capacity-limited even though ΔT would allow more. */
  {
    const t = plant({ tSet: 6, qMax: -100000, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('The tighter of the two binds', l.limit === 'Capacity', String(l.limit));
    near('...at 100 kW', l.qW, -100000, 1e-6);
  }
  {
    /* Quarter the flow and the SAME machine becomes ΔT-limited: 8 K is now
     * only 41.8 kW, well inside its 100 kW. This is why both limits exist. */
    const t = plant({ tSet: 6, qMax: -100000, dTMax: 8 }, flow / 4, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('At a quarter flow the ΔT limit binds instead', l.limit === 'Design ΔT',
       String(l.limit));
    near('...at 41.8 kW', l.qW, -8 * C / 4, 1);
  }

  /* THE T LIMIT IS GONE FROM A SOURCE/SINK  (Michael, 2026-08-04).
   *
   * It used to clamp the leaving temperature at a physical bound — wet bulb on
   * a tower, ambient on an economizer. His instruction is "let the engineer
   * evaluate": whether a leaving temperature is achievable is a judgement about
   * the SELECTION, and clamping it silently produced an answer that looked
   * achieved when the machine could not have done it.
   *
   * So the setpoint is now met whatever it asks for, and it is the engineer who
   * decides that 12 °C off an 18 °C ambient is not a machine anyone can buy.
   * Capacity and Design ΔT still bind — those are nameplate figures, not
   * judgements. */
  {
    const t = plant({ tSet: 25, tLimit: 18, qMax: -1e9 }, flow, 30);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('It holds its setpoint', l.tOut, 25, 1e-9);
    ok('...with nothing binding', l.limit === null || l.limit === undefined);
  }
  {
    const t = plant({ tSet: 12, tLimit: 18, qMax: -1e9 }, flow, 30);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A setpoint past the old limit is now simply reached', l.tOut, 12, 1e-9);
    ok('...and nothing is reported as limiting it',
       l.limit === null || l.limit === undefined, String(l.limit));
    ok('...having done the work that implies', l.qW < 0);
  }
  {
    /* An EXCHANGER keeps its T limit: there it is the entering-air temperature
     * in disguise, which is a stated condition rather than a judgement. */
    const m2 = M.create();
    m2.settings.thermal = { ambient: 20, supplyTemp: 30, insulationK: 0.02,
                            surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m2.levels[0].id;
    const a = M.addNode(m2, lv, 0, 0), j = M.addNode(m2, lv, 1, 0);
    const k = M.addNode(m2, lv, 2, 0), b = M.addNode(m2, lv, 3, 0);
    M.setSource(m2, a.id, 600e3); a.device.temperature = 30;
    b.device = { kind: 'demand', flow: flow, reqPressure: 100e3, include: true };
    M.addPipe(m2, a.id, j.id, { size: 'DN50', schedule: 'sch40' });
    const e2 = M.addPipe(m2, j.id, k.id, { kind: 'equip' });
    e2.equip = { qRated: flow, pdRated: 20e3, equipType: 'exchanger',
                 duty: -1e6, tLimit: 18 };
    M.addPipe(m2, k.id, b.id, { size: 'DN50', schedule: 'sch40' });
    m2.pipes.forEach(x => { if (x.kind !== 'equip') x.insulation_mm = 0; });
    const l2 = NET.solveModel(m2).thermal.links[e2.id];
    near('An exchanger still cannot pass its T limit', l2.tOut, 18, 1e-9);
    ok('...and still says so', l2.limit === 'T limit', String(l2.limit));
  }

  /* THE SIGN OF THE CAPACITY IS A DIRECTION, not decoration.
   *
   * A chiller is stated as a negative capacity. Ask it to HEAT — a setpoint
   * above its inlet — and it does nothing, because that is what a chiller does
   * when you ask it to heat. It must not quietly warm the water on the strength
   * of a magnitude.
   */
  {
    const t = plant({ tSet: 30, qMax: -100000 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A cooling machine asked to heat does nothing', l.qW, 0, 1e-9);
    near('...so the water leaves as it arrived', l.tOut, 18, 1e-9);
    ok('...and the reason is named, not silent',
       l.limit === 'Capacity (wrong direction)', String(l.limit));
  }
  {
    // ...and the mirror image: a boiler asked to cool.
    const t = plant({ tSet: 6, qMax: 100000 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A heating machine asked to cool does nothing', l.qW, 0, 1e-9);
    ok('...reported the same way', l.limit === 'Capacity (wrong direction)');
  }
  {
    /* BLANK is unlimited in BOTH directions — an unstated capacity has always
     * meant "do not cap this", and a sign cannot be read off a blank. */
    const t = plant({ tSet: 6 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('No capacity stated, no cap', l.tOut, 6, 1e-9);
    ok('...and nothing binds', !l.limit);
    const t2 = plant({ tSet: 30 }, flow, 18);
    const l2 = NET.solveModel(t2.m).thermal.links[t2.e.id];
    near('...in the heating direction too', l2.tOut, 30, 1e-9);
  }
  {
    /* Zero is not a direction. Treated as unstated rather than as "can do
     * nothing", because a field a user has cleared to 0 reads as unset. */
    const t = plant({ tSet: 6, qMax: 0 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A zero capacity is read as unstated', l.tOut, 6, 1e-9);
  }

  /* A BOILER is the same machine with the signs the other way up: setpoint
   * above inlet, positive duty, and the limits behave identically. */
  {
    const t = plant({ tSet: 80, qMax: 1e9, dTMax: 15 }, flow, 60);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('Heating is capped by the same ΔT limit', l.dT, 15, 1e-9);
    near('...leaving at 75 C', l.tOut, 75, 1e-9);
    ok('...with a positive duty', l.qW > 0);
    ok('...reported the same way', l.limit === 'Design ΔT');
  }

  /* The active set settles rather than oscillating — the check-valve lesson.
   * Two plants in series, each with a different limit, must reach a fixed
   * point in a handful of passes. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 30, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i, 0));
    M.setSource(m, n[0].id, 800e3); n[0].device.temperature = 30;
    n[5].device = { kind: 'demand', flow: flow, reqPressure: 100e3, include: true };
    M.addPipe(m, n[0].id, n[1].id, { size: 'DN50', schedule: 'sch40' });
    const e1 = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    e1.equip = { qRated: flow, pdRated: 20e3, equipType: 'source',
                 tSet: 6, qMax: -100000 };
    M.addPipe(m, n[2].id, n[3].id, { size: 'DN50', schedule: 'sch40' });
    const e2 = M.addPipe(m, n[3].id, n[4].id, { kind: 'equip' });
    e2.equip = { qRated: flow, pdRated: 20e3, equipType: 'source',
                 tSet: 6, dTMax: 3 };
    M.addPipe(m, n[4].id, n[5].id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(p => { if (p.kind !== 'equip') p.insulation_mm = 0; });

    const res = NET.solveModel(m);
    const th = res.thermal;
    ok('Two limited plants in series settle',
       !th.warnings.some(w => w.code === 'THERMAL_LIMIT_OSCILLATION'));
    ok('...in a handful of passes', th.iterations <= 5, String(th.iterations));
    ok('The first is capacity-limited', th.links[e1.id].limit === 'Capacity');
    ok('The second is ΔT-limited', th.links[e2.id].limit === 'Design ΔT');
    near('...dropping exactly 3 K', th.links[e2.id].dT, -3, 1e-9);
    /* And the two together are still just Q = C.dT, link by link. */
    near('Duty and difference agree on the first',
         th.links[e1.id].qW, th.links[e1.id].C * th.links[e1.id].dT, 1e-6);
  }
}

/* --------------------------------------------------------------------------
 * VARIABLE-SPEED CONTROL — Michael's waterside economizer, 2026-08-03.
 *
 * Source at 30 C -> pump -> economizer -> pipe -> terminal, in SIMULATION.
 * The pipework is ADIABATIC (surfaceCoeff 0), so the only thermal element in
 * the model is the machine and every number below can be done by hand.
 *
 * The economizer is a source/sink: setpoint 25 C, T limit 18 C (the ambient it
 * cannot pass), and a finite capacity. At full speed the flow is more than that
 * capacity can cool by 5 K, so it is capacity-limited and leaves WARM of
 * setpoint. Backing the pump off gives fewer kilograms to cool for the same
 * watts, which is a bigger drop — so the pump must ramp DOWN. If it ramps up,
 * the sign handling is wrong.
 *
 * THE CLOSED FORM, and it is the assertion that matters. At the settled point
 * the machine sits exactly on its capacity boundary: the duty it needs is the
 * duty it has.
 *
 *     Q_cap = C.dT = rho.q.cp.(30-25)
 *  -> q     = Q_cap / (5.rho.cp)
 *
 * rho.cp = 998 x 4187 = 4 178 626 J/(m3.K), so 5 K is 20 893 130 J/m3 and a
 * 250 kW machine settles at
 *
 *     250 000 / 20 893 130 = 0.01196565 m3/s = 11.966 L/s
 *
 * — independent of the pump, of its curve, and of the pipework. Nothing in
 * that line was read out of the code.
 * ----------------------------------------------------------------------- */
section('Variable-speed control: a pump ramps DOWN to hold a setpoint');
{
  const P = FD.pumps;

  /* `link` is 'pump', 'valve' or null (no control link at all). */
  function economizer(opts) {
    opts = opts || {};
    const m = M.create();
    m.settings.calcMode = opts.mode || 'simulation';
    /* Adiabatic pipework: the machine is the only thermal element. */
    m.settings.thermal = { ambient: 18, supplyTemp: 30, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c = M.addNode(m, lv, 2, 0), d = M.addNode(m, lv, 3, 0);
    const e = M.addNode(m, lv, 4, 0);
    a.device = { kind: 'source', head: 0, temperature: 30 };
    e.device = { kind: 'demand', flow: 0.020, reqPressure: 200e3, include: true };

    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', head: 30, curve: P.singlePoint(30, 0.020) };
    const eq = M.addPipe(m, b.id, c.id, { kind: 'equip' });
    eq.equip = Object.assign({
      qRated: 0.020, pdRated: 20e3, equipType: 'source',
      tSet: 25, tLimit: 18, qMax: -250000
    }, opts.equip || {});
    const valve = M.addPipe(m, c.id, d.id, { kind: 'valve' });
    valve.valve = { type: 'globe', kv: 40, opening: 100 };
    M.addPipe(m, d.id, e.id, { size: 'DN100', schedule: 'sch40' });
    m.pipes.forEach(p => { p.insulation_mm = 0; });

    if (opts.link === 'pump') M.setControl(m, pump, eq.id);
    if (opts.link === 'valve') M.setControl(m, valve, eq.id);
    return { m, pump, eq, valve };
  }

  const RHOCP = RHO * CP;                      // 4 178 626 J/(m3.K)

  // ---- 1. UNCONTROLLED: it misses the setpoint, and says why.
  {
    const t = economizer({ link: null });
    const res = NET.solveModel(t.m);
    ok('Solves without a control link', res.converged === true,
       JSON.stringify(res.errors));
    ok('Nothing to report — no control link', res.controls === null);
    const l = res.thermal.links[t.eq.id];
    ok('The economizer is capacity-limited', l.limit === 'Capacity', String(l.limit));
    ok('...so it leaves WARM of its 25 C setpoint', l.tOut > 25.5,
       l.tOut.toFixed(2) + ' C');
    near('...having done exactly its 250 kW', l.qW, -250000, 1);
    ok('The pump is at full speed', M.pumpSpeed(t.m, t.pump) === 1);
  }

  // ---- 2. CONTROLLED: the pump ramps DOWN and the setpoint is held.
  const controlled = economizer({ link: 'pump' });
  const res = NET.solveModel(controlled.m);
  {
    ok('Solves with a control link', res.converged === true,
       JSON.stringify(res.errors));
    const speed = M.pumpSpeed(controlled.m, controlled.pump);

    /* THE DIRECTION. Down, not up. */
    ok('The pump ramped DOWN', speed < 1, (speed * 100).toFixed(1) + '%');
    ok('...and is off its minimum, so this is a real answer not a floor',
       speed > 0.25 + 1e-9, String(speed));

    const l = res.thermal.links[controlled.eq.id];
    near('The setpoint is held', l.tOut, 25, 1e-6);
    ok('...so nothing is limiting it any more',
       l.limit === null || l.limit === undefined, String(l.limit));

    /* The closed form: q = Q_cap / (5.rho.cp). The controller comes to rest on
     * the boundary itself, not on the edge of a deadband, so this is exact to
     * the resolution of the actuator (0.1% of speed). */
    const qHand = 250000 / (5 * RHOCP);
    near('The settled flow is the capacity boundary, by hand',
         Math.abs(res.flow[controlled.eq.id]), qHand, qHand * 2e-3);
    near('...which is 11.966 L/s', qHand * 1000, 11.9656, 1e-3);
    near('...and the duty is still the full 250 kW', l.qW, -250000, 250);

    /* Flow really did fall — the control is doing work, not agreeing with a
     * coincidence. */
    const free = NET.solveModel(economizer({ link: null }).m);
    ok('Controlled flow is well below the uncontrolled flow',
       Math.abs(res.flow[controlled.eq.id]) < Math.abs(free.flow[free.network &&
         controlled.eq.id]) * 0.9,
       `${(Math.abs(res.flow[controlled.eq.id]) * 1000).toFixed(2)} vs ` +
       `${(Math.abs(free.flow[controlled.eq.id]) * 1000).toFixed(2)} L/s`);

    // ---- the report
    const rep = res.controls;
    ok('A control report is produced', !!rep && rep.devices.length === 1);
    const d = rep.devices[0];
    ok('It names the pump and the machine',
       d.pipe === controlled.pump.id && d.equip === controlled.eq.id);
    ok('...the quantity being modulated', d.quantity === 'speed');
    near('...the target', d.target, 25, 1e-12);
    near('...and the value it settled at', d.value, speed, 1e-12);
    ok('...reported as on setpoint', d.state === 'on', d.state);
    ok('No control warning was raised',
       !res.warnings.some(w => /^CONTROL_/.test(w.code)),
       JSON.stringify(res.warnings.filter(w => /^CONTROL_/.test(w.code))));
  }

  // ---- 3. The answer does not depend on what the last solve left behind.
  {
    controlled.pump.pump.speed = 0.31;         // as if a previous solve had
    const again = NET.solveModel(controlled.m);
    near('Re-solving from a different starting speed lands in the same place',
         M.pumpSpeed(controlled.m, controlled.pump), res.controls.devices[0].value, 2e-3);
    near('...and on the same flow', Math.abs(again.flow[controlled.eq.id]),
         Math.abs(res.flow[controlled.eq.id]), 1e-6);
  }

  /* ---- 4. THE SETPOINT IS LOST — a machine too small to hold it anywhere.
   *
   * 60 kW wants q = 60000/20893130 = 2.872 L/s, well under a quarter of the
   * full-speed flow, so the drive bottoms out and the setpoint is still missed.
   *
   * THE PUMP THEN GOES BACK TO FULL (Michael, 2026-08-04). A throttled pump in
   * a condition it cannot control is strictly worse than an open one: it saves
   * nothing that matters and starves the load. Same reasoning as a control
   * valve failing open.
   *
   * THE TRADE-OFF IS REAL and worth stating. Minimum speed put this machine's
   * LEAVING TEMPERATURE closest to setpoint; full speed moves the most water.
   * They are different objectives, and the rule chooses delivered capacity —
   * which is the one that matters when the machine is short of capacity, and is
   * what stopped the overload in `debug/20260804-3.json` walking the pump down
   * to 25% while the loop ran away to 3000 °C. */
  {
    const t = economizer({ link: 'pump', equip: { qMax: -60000 } });
    const r = NET.solveModel(t.m);
    near('The pump is returned to full speed, not left on its floor',
         M.pumpSpeed(t.m, t.pump), 1, 1e-9);
    const l = r.thermal.links[t.eq.id];
    ok('...and the machine is still warm of setpoint', l.tOut > 25.5,
       l.tOut.toFixed(2) + ' C');
    ok('...reported as lost rather than as a settled answer',
       r.controls.devices[0].lost === true);
    const e = (r.errors || []).filter(x => x.code === 'SETPOINT_LOST')[0];
    ok('SETPOINT_LOST is raised', !!e, JSON.stringify((r.errors||[]).map(x=>x.code)));
    ok('...in Michael\u2019s own words', !!e &&
       /System is unable to maintain setpoint\. Check heat balance\./.test(e.message),
       e && e.message);
    ok('...and it clears converged', r.converged === false);
  }

  // ---- 5. THE SIGN IS NOT ASSUMED: backing off must be shown to help.
  {
    /* A machine capped by ΔT max leaves at tIn - dTMax whatever the flow, so
     * slowing the pump changes NOTHING about its leaving temperature. A
     * controller that simply "ramps down towards a setpoint" would wind this
     * pump to its floor for no benefit. The perturbation catches it. */
    const t = economizer({ link: 'pump',
                           equip: { qMax: -1e9, dTMax: 2 } });
    const r = NET.solveModel(t.m);
    const l = r.thermal.links[t.eq.id];
    near('The machine is pinned 2 K below inlet', l.tOut, 28, 1e-9);
    ok('...by its ΔT limit', l.limit === 'Design ΔT', String(l.limit));
    ok('The pump stayed at full speed', M.pumpSpeed(t.m, t.pump) === 1,
       String(M.pumpSpeed(t.m, t.pump)));
    ok('...reported as at-max', r.controls.devices[0].state === 'at-max',
       r.controls.devices[0].state);
    ok('...with a warning saying backing off would not help',
       r.warnings.some(w => w.code === 'CONTROL_AT_LIMIT' &&
                            /not bring it closer/.test(w.message)));
  }

  // ---- 6. A GLOBE VALVE is the same problem with a different actuator.
  {
    const t = economizer({ link: 'valve' });
    const r = NET.solveModel(t.m);
    ok('Solves', r.converged === true, JSON.stringify(r.errors));
    ok('The valve closed down', t.valve.valve.opening < 100,
       t.valve.valve.opening + '%');
    ok('...and the pump was left alone', M.pumpSpeed(t.m, t.pump) === 1);
    const l = r.thermal.links[t.eq.id];
    near('The setpoint is held', l.tOut, 25, 0.05);
    /* The SAME closed form: the settled flow does not care what throttled it.
     *
     * It lands a little UNDER, and must. A globe valve's position is a whole
     * percent — that is what the panel offers and what a valve is actually set
     * to — so the search cannot resolve the boundary more finely than one
     * percent of travel, and it always stops on the side that MEETS the
     * setpoint. 0.7% of flow is one percent of this valve's travel; a pump,
     * whose speed is resolved to 0.1%, lands on the hand figure exactly. */
    const qHandV = 250000 / (5 * RHOCP);
    const qV = Math.abs(r.flow[t.eq.id]);
    ok('The settled flow is at or under the hand-calculated boundary',
       qV <= qHandV + 1e-9, `${qV} vs ${qHandV}`);
    /* One percent of travel, which on an equal-percentage valve is a larger
     * step in FLOW than the old near-linear shape gave — that is the trade for
     * doing the controlling in the middle of the range rather than at the
     * seat. Measured, not assumed. */
    ok('...and within one percent of valve travel of it',
       qV > qHandV * 0.97, `${((qV / qHandV - 1) * 100).toFixed(2)}%`);
    ok('The report names the opening', r.controls.devices[0].quantity === 'opening');
    ok('...and the position is a whole percent',
       t.valve.valve.opening === Math.round(t.valve.valve.opening));
  }

  /* ---- 7. A HEAT EXCHANGER offers setpoints of its own (Michael, 2026-08-04):
   * Design flow first, Design ΔT second. It states a load rather than a leaving
   * temperature, so "the temperature it holds" was never the question to ask
   * of it — but "the flow it needs" always was. */
  {
    const t = economizer({ link: 'pump',
                           equip: { equipType: 'exchanger', duty: -100000,
                                    qRated: 0.020, tSet: undefined } });
    const r = NET.solveModel(t.m);
    ok('An exchanger is a valid control target', r.controls !== null &&
       r.controls.devices.length === 1,
       JSON.stringify(r.warnings.map(w => w.code)));
    ok('...and the first thing chased is its design flow',
       r.controls.devices[0].setpointOf === 'flow',
       r.controls.devices[0].setpointOf);
    ok('...labelled as such', r.controls.devices[0].holding === 'Design flow',
       String(r.controls.devices[0].holding));
    ok('No CONTROL_NO_SETPOINT, because it does state one',
       !r.warnings.some(w => w.code === 'CONTROL_NO_SETPOINT'));
  }

  /* ---- 7b. A machine that states NOTHING still says so. */
  {
    const t = economizer({ link: 'pump',
                           equip: { equipType: 'exchanger', duty: 0,
                                    qRated: 0, tSet: undefined } });
    const r = NET.solveModel(t.m);
    ok('The pump is left at full speed', M.pumpSpeed(t.m, t.pump) === 1);
    ok('CONTROL_NO_SETPOINT is raised',
       r.warnings.some(w => w.code === 'CONTROL_NO_SETPOINT'),
       JSON.stringify(r.warnings.map(w => w.code)));
  }

  // ---- 8. DESIGN does not control — the flows there are imposed, not solved.
  {
    const t = economizer({ link: 'pump', mode: 'design' });
    const r = NET.solveModel(t.m);
    ok('No control report in DESIGN', r.controls === null);
    ok('...and the pump is untouched', M.pumpSpeed(t.m, t.pump) === 1);
    const plain = NET.solveModel(economizer({ link: null, mode: 'design' }).m);
    near('...so the answer is identical to the same model with no link',
         r.flow[t.eq.id], plain.flow[t.eq.id], 1e-12);
  }
}

/* --------------------------------------------------------------------------
 * PIPE SENSOR — thermostatic mixing  (Michael, 2026-08-04)
 *
 * A sensor is an INSTRUMENT: it reads the water where it sits and states a
 * setpoint for something else to hold. It has no pressure drop of its own and
 * passes temperature straight through — a thermometer that changed the reading
 * would not be one.
 *
 * THE RIG. Hot at 60 °C and cold at 10 °C meet at a tee; a sensor downstream of
 * the blend states 45 °C; a globe valve on the COLD leg holds it. Both legs
 * carry an identical valve so that wide open is symmetric.
 *
 * THE HAND CALCULATION. Mixing is mass-weighted, so at the setpoint
 *
 *     60·f + 10·(1−f) = 45     ->     50·f = 35     ->     f = 0.7
 *
 * SEVENTY PERCENT of the mass must arrive from the hot leg, whatever the total
 * flow turns out to be and whatever the valve had to do to get there. That
 * ratio is the assertion; it involves neither the valve nor the pipework.
 *
 * THE DIRECTION. Wide open the legs are symmetric, so the blend is 35 °C —
 * BELOW setpoint. An actuator can only close from fully open, and closing the
 * COLD leg raises the mix. Put the valve on the hot leg instead and the same
 * setpoint becomes unreachable, which the app must say rather than hunt for.
 * ----------------------------------------------------------------------- */
section('Pipe sensor: thermostatic mixing');
{
  /* `on` is which leg carries the controlled valve: 'cold', 'hot' or null. */
  function blend(opts) {
    opts = opts || {};
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.thermal = { ambient: 20, supplyTemp: 45, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const h = M.addNode(m, lv, 0, 2), c = M.addNode(m, lv, 0, -2);
    const hv = M.addNode(m, lv, 2, 2), cv = M.addNode(m, lv, 2, -2);
    const hv2 = M.addNode(m, lv, 3, 2), cv2 = M.addNode(m, lv, 3, -2);
    const j = M.addNode(m, lv, 5, 0);
    const s1 = M.addNode(m, lv, 6, 0), s2 = M.addNode(m, lv, 7, 0);
    const out = M.addNode(m, lv, 10, 0);

    M.setSource(m, h.id, 300e3); h.device.temperature = 60;
    M.setSource(m, c.id, 300e3); c.device.temperature = 10;
    out.device = { kind: 'demand', flow: 0.010, reqPressure: 100e3, include: true };

    M.addPipe(m, h.id, hv.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, c.id, cv.id, { size: 'DN50', schedule: 'sch40' });
    const vh = M.addPipe(m, hv.id, hv2.id, { kind: 'valve' });
    const vc = M.addPipe(m, cv.id, cv2.id, { kind: 'valve' });
    vh.tag = 'BV-HOT'; vc.tag = 'BV-COLD';
    vh.valve = { type: 'globe', kv: 30, opening: 100 };
    vc.valve = { type: 'globe', kv: 30, opening: 100 };
    const ph = M.addPipe(m, hv2.id, j.id, { size: 'DN50', schedule: 'sch40' });
    const pc = M.addPipe(m, cv2.id, j.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, j.id, s1.id, { size: 'DN50', schedule: 'sch40' });
    const sensor = M.addPipe(m, s1.id, s2.id, { kind: 'sensor' });
    sensor.tag = 'TS-1';
    sensor.sensor = opts.sensor === null ? { mode: 'temperature' }
                  : (opts.sensor || { mode: 'temperature', tSet: 45 });
    M.addPipe(m, s2.id, out.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });

    if (opts.on === 'cold') M.setControl(m, vc, sensor.id);
    if (opts.on === 'hot') M.setControl(m, vh, sensor.id);
    return { m, vh, vc, sensor, ph, pc };
  }

  // ---- 1. UNCONTROLLED: symmetric legs blend to the mean.
  {
    const t = blend({ on: null });
    const res = NET.solveModel(t.m);
    ok('Solves', res.converged === true, JSON.stringify(res.errors));
    const l = res.thermal.links[t.sensor.id];
    near('Symmetric legs blend 60 and 10 to their mean', l.tIn, 35, 0.05);
    ok('...which is below the 45 °C setpoint, so there is work to do', l.tIn < 45);
    ok('Nothing is controlled without a link', res.controls === null);
    near('A sensor passes temperature straight through', l.tOut, l.tIn, 1e-12);
    near('...and adds no duty', l.qW, 0, 1e-9);
  }

  // ---- 2. CONTROLLED: the cold valve closes until the blend is 45 °C.
  {
    const t = blend({ on: 'cold' });
    const res = NET.solveModel(t.m);
    ok('Solves with the sensor wired up', res.converged === true,
       JSON.stringify(res.errors));
    const l = res.thermal.links[t.sensor.id];
    /* THE ACTUATOR'S RESOLUTION IS THE LIMIT, and it is worth stating exactly.
     * A globe valve is set in WHOLE PERCENT (Michael, 2026-08-03 — a balancing
     * valve lands wherever it lands), and on this rig one percent of travel is
     * worth 0.26 K:
     *
     *     70% open -> 44.589 °C        69% open -> 44.975 °C
     *
     * 45.000 falls between them, so no valve position holds it exactly and the
     * honest answer is the closer of the two: 69% is 0.025 K out, 70% is
     * 0.411 K out. The search settles on 69.
     *
     * Those figures moved when the control valve became EQUAL PERCENTAGE
     * (2026-08-05). It now does its throttling at 69% of travel rather than
     * 33%, which is the point of the characteristic — the valve is working in
     * the middle of its range instead of near its seat. */
    near('The sensor is held at its setpoint', l.tIn, 45, 0.15);
    ok('...as closely as a whole percent of valve travel allows',
       Math.abs(l.tIn - 45) < 0.13, l.tIn.toFixed(4) + ' °C');

    ok('The cold valve closed', t.vc.valve.opening < 100,
       t.vc.valve.opening + '% open');
    ok('...and the hot valve was left alone', t.vh.valve.opening === 100);

    /* THE HAND CALCULATION: mixing is mass-weighted, so the leg flows and the
     * mixed temperature are locked together. This identity is exact and holds
     * whatever the valve settled at. */
    const qh = Math.abs(res.flow[t.ph.id]), qc = Math.abs(res.flow[t.pc.id]);
    const f = qh / (qh + qc);
    near('The mixing law ties the leg flows to the reading exactly',
         60 * f + 10 * (1 - f), l.tIn, 1e-9);
    near('...and about seventy percent of the mass arrives hot', f, 0.7, 0.003);

    const rep = res.controls;
    ok('A control report is produced', !!rep && rep.devices.length === 1);
    const dv = rep.devices[0];
    ok('...naming the valve and the sensor',
       dv.pipe === t.vc.id && dv.equip === t.sensor.id);
    ok('...and what kind of setpoint it is', dv.setpointOf === 'temperature',
       dv.setpointOf);
    ok('...reported as on setpoint', dv.state === 'on', dv.state);
  }

  // ---- 3. THE DIRECTION IS NOT ASSUMED. On the hot leg, closing cools.
  {
    const t = blend({ on: 'hot' });
    const res = NET.solveModel(t.m);
    ok('The hot valve stays open', t.vh.valve.opening === 100,
       t.vh.valve.opening + '%');
    ok('...reported as at maximum, not hunted for',
       res.controls.devices[0].state === 'at-max', res.controls.devices[0].state);
    ok('...with a warning that backing off would not help',
       res.warnings.some(w => w.code === 'CONTROL_AT_LIMIT' &&
                              /not bring it closer/.test(w.message)));
  }

  // ---- 4. The MIRROR: a setpoint BELOW the mean is held by the hot valve.
  {
    const t = blend({ on: 'hot', sensor: { mode: 'temperature', tSet: 25 } });
    const res = NET.solveModel(t.m);
    const l = res.thermal.links[t.sensor.id];
    near('A cooler setpoint is held by closing the HOT leg', l.tIn, 25, 0.15);
    ok('...so the hot valve closed', t.vh.valve.opening < 100,
       t.vh.valve.opening + '% open');
    /* 60f + 10(1−f) = 25  ->  50f = 15  ->  f = 0.3 */
    const qh = Math.abs(res.flow[t.ph.id]), qc = Math.abs(res.flow[t.pc.id]);
    near('Thirty percent of the mass arrives hot', qh / (qh + qc), 0.3, 0.003);
  }

  /* ---- 5. A FLOW setpoint, and it needs no temperatures at all.
   *
   * Constant-flow control on a branch: source -> valve -> sensor -> outflow,
   * with the valve throttling until the branch carries what the sensor asks
   * for. Deliberately a DIFFERENT rig from the blend — on the blend's main the
   * total is set by the terminal and closing one leg barely moves it, which is
   * an unreachable setpoint and a separate case (5b). */
  {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 2, 0);
    const c = M.addNode(m, lv, 3, 0), d2 = M.addNode(m, lv, 4, 0);
    const e = M.addNode(m, lv, 8, 0);
    M.setSource(m, a.id, 300e3);
    e.device = { kind: 'demand', flow: 0.010, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
    const v = M.addPipe(m, b.id, c.id, { kind: 'valve' });
    v.tag = 'FCV-1'; v.valve = { type: 'globe', kv: 30, opening: 100 };
    const sn = M.addPipe(m, c.id, d2.id, { kind: 'sensor' });
    sn.tag = 'FS-1'; sn.sensor = { mode: 'flow', qSet: 0.006 };
    M.addPipe(m, d2.id, e.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });

    const wide = NET.solveModel(M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m)))));
    M.setControl(m, v, sn.id);
    const res = NET.solveModel(m);
    ok('Solves', res.converged === true, JSON.stringify(res.errors));

    const dv = res.controls.devices[0];
    ok('The setpoint is reported as a flow', dv.setpointOf === 'flow', dv.setpointOf);
    ok('Wide open the branch carries more than the setpoint',
       Math.abs(wide.flow[sn.id]) > 0.006,
       (Math.abs(wide.flow[sn.id]) * 1000).toFixed(2) + ' L/s');
    /* Within one percent of valve travel, the same limit as the blend above. */
    near('...and the valve throttles it to the 6 L/s asked for',
         Math.abs(res.flow[sn.id]), 0.006, 0.006 * 0.015);
    ok('...having closed to get there', v.valve.opening < 100,
       v.valve.opening + '% open');
    ok('...reported as on setpoint', dv.state === 'on', dv.state);
  }

  /* ---- 5b. A setpoint nothing can reach is SAID, not hunted for. */
  {
    const t = blend({ on: 'cold', sensor: { mode: 'flow', qSet: 0.004 } });
    const res = NET.solveModel(t.m);
    const dv = res.controls.devices[0];
    ok('An unreachable flow setpoint is not silently accepted',
       dv.state !== 'on', dv.state);
    ok('...and it is reported',
       res.warnings.some(w => /^CONTROL_/.test(w.code)),
       JSON.stringify(res.warnings.filter(w => /^CONTROL_/.test(w.code))
                         .map(w => w.code)));
  }

  // ---- 6. A sensor with no setpoint controls nothing, and says so.
  {
    const t = blend({ on: 'cold', sensor: null });
    const res = NET.solveModel(t.m);
    ok('The valve is left wide open', t.vc.valve.opening === 100);
    ok('CONTROL_NO_SETPOINT is raised',
       res.warnings.some(w => w.code === 'CONTROL_NO_SETPOINT'),
       JSON.stringify(res.warnings.map(w => w.code)));
  }

  // ---- 7. A sensor is hydraulically a piece of pipe, and nothing more.
  {
    const t = blend({ on: null });
    const res = NET.solveModel(t.m);
    const link = res.network.links.filter(l => l.id === t.sensor.id)[0];
    ok('It builds as a plain pipe', link.kind === 'pipe', link.kind);
    const plain = M.create();
    ok('...with no equipment characteristic on it', link.r !== undefined);
    /* Its drop is whatever its own length earns and no more: an identical
     * length of the same pipe must have the same resistance. */
    const twin = res.network.links.filter(
      l => l.kind === 'pipe' && l.id !== t.sensor.id &&
           Math.abs(l._L - link._L) < 1e-9 && Math.abs(l._d - link._d) < 1e-12)[0];
    ok('...identical to a plain pipe of the same length and bore',
       !twin || Math.abs(twin.r - link.r) < 1e-9,
       twin ? `${twin.r} vs ${link.r}` : 'no twin to compare');
  }

  // ---- 8. DESIGN does not modulate — the flows are imposed there.
  {
    const t = blend({ on: 'cold' });
    t.m.settings.calcMode = 'design';
    const res = NET.solveModel(t.m);
    ok('No control report in DESIGN', res.controls === null);
    ok('...and the valve is untouched', t.vc.valve.opening === 100);
  }
}

/* --------------------------------------------------------------------------
 * CONTROL AUTHORITY — a setpoint the actuator cannot move is not "held"
 *
 * Michael, 2026-08-04, from `debug/20260804-2.json`. A pump linked to a
 * chiller's Design LWT sat at 100% and never moved. The search was right to do
 * nothing: an unlimited chiller holds 20 °C at ANY flow, so the error was zero
 * at every speed. But the pump was not HOLDING that setpoint — it had no say in
 * it — and the control valve downstream was left to strangle the flow on its
 * own, bottomed out at 10% open. That is not how a system is commissioned.
 *
 * The distinction is AUTHORITY, and it costs one probe: nudge the actuator and
 * see whether the error moves. If it does not, this setpoint gives no signal,
 * so fall through to the next one the device was asked to hold.
 *
 * THE HAND CALCULATION for the fallback. The coil holds 50 kW, so a chiller
 * design ΔT of 15 K fixes the flow:
 *
 *     q = 50 000 / (15 × 998 × 4187) = 7.9771e-4 m³/s = 0.798 L/s
 *
 * which is the coil's own design flow. Chasing design ΔT on the plant lands on
 * design flow, and the balancing valve does not have to throttle at all.
 * ----------------------------------------------------------------------- */
section('Control authority: a setpoint nothing can move is not being held');
{
  const RHOCP = 998 * 4187;

  function plantLoop(opts) {
    opts = opts || {};
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.thermal = { ambient: 20, supplyTemp: 20, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.tag = 'PMP-1';
    /* Sized well ABOVE the coil's design flow, as Michael's model is: at full
     * speed it pushes 1.41 L/s and the chiller sits at 8.5 K, comfortably clear
     * of its 15 K limit. That gap is the point — it is where LWT is held at any
     * flow and therefore tells the pump nothing. */
    pump.pump = { mode: 'fixed', head: 80,
                  curve: FD.pumps.singlePoint(80, 0.0014) };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.tag = 'AHU-1';
    coil.equip = { qRated: 0.0008, pdRated: 200e3, equipType: 'exchanger',
                   duty: 50000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    ch.tag = 'ACCH-01';
    ch.equip = { qRated: 0.0016, pdRated: 200e3, equipType: 'source',
                 tSet: 20, qMax: -100000, dTMax: 15 };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[5].id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, n[5].id, n[0].id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    if (opts.link) {
      M.setControl(m, pump, ch.id);
      pump.pump.control.use = opts.use || { lwt: true, dt: true };
    }
    return { m, pump, coil, ch };
  }

  // ---- 1. LWT alone: the pump cannot move it, and says so.
  {
    const t = plantLoop({ link: true, use: { lwt: true } });
    const res = NET.solveModel(t.m);
    const d = res.controls.devices[0];
    ok('The pump reports no authority over LWT', d.state === 'no-authority',
       d.state);
    near('...and stays at full speed', d.value, 1, 1e-12);
    const w = res.warnings.filter(x => x.code === 'CONTROL_NO_AUTHORITY')[0];
    ok('CONTROL_NO_AUTHORITY is raised', !!w,
       JSON.stringify(res.warnings.map(x => x.code)));
    ok('...and it suggests what the pump CAN hold',
       !!w && /Design ΔT|design flow/.test(w.message), w && w.message);
  }

  // ---- 2. LWT then ΔT: it falls through and does the work.
  {
    const t = plantLoop({ link: true, use: { lwt: true, dt: true } });
    const res = NET.solveModel(t.m);
    const d = res.controls.devices[0];
    ok('It fell back to the next setpoint', d.fellBack === true);
    ok('...which is Design ΔT', d.holding === 'Design ΔT', String(d.holding));
    ok('...and reports as holding it', d.state === 'on', d.state);
    ok('The pump ramped DOWN', d.value < 1, (d.value * 100).toFixed(0) + '%');

    near('The chiller sits on its design ΔT',
         Math.abs(res.thermal.links[t.ch.id].dT), 15, 0.06);
    /* THE hand figure: 50 kW across 15 K is 0.798 L/s, which is the coil's own
     * design flow — chasing ΔT on the plant lands on design flow. */
    const qHand = 50000 / (15 * RHOCP);
    near('...at the flow that implies', Math.abs(res.flow[t.ch.id]), qHand,
         qHand * 0.01);
    near('...which is the coil design flow', qHand, 0.0008, 0.0008 * 0.01);
    ok('No authority warning once it found something it can hold',
       !res.warnings.some(x => x.code === 'CONTROL_NO_AUTHORITY'));
  }

  /* ---- 3. AUTHORITY IS NOT ASSUMED AWAY. Where the actuator really is the
   * reason the setpoint is met, it stays put. Full speed with the chiller
   * SITTING ON its 15 K limit: nudging the pump moves the reading, so the
   * probe finds authority and reports it as held rather than falling through. */
  {
    const t = plantLoop({ link: true, use: { lwt: true, dt: true } });
    /* Shrink the pump so full speed already lands on design flow. */
    t.pump.pump.curve = FD.pumps.singlePoint(28, 0.0008);
    t.pump.pump.head = 28;
    const res = NET.solveModel(t.m);
    const d = res.controls.devices[0];
    ok('At design flow the pump is genuinely holding something',
       d.state === 'on', d.state);
    ok('...without needing to move', d.value > 0.95,
       (d.value * 100).toFixed(0) + '%');
    ok('...and nothing is reported as beyond its authority',
       !res.warnings.some(x => x.code === 'CONTROL_NO_AUTHORITY'));
  }

  // ---- 4. A device already off full travel is not re-probed.
  {
    const t = plantLoop({ link: true, use: { dt: true } });
    const res = NET.solveModel(t.m);
    const d = res.controls.devices[0];
    ok('Chasing ΔT alone works from the start', d.state === 'on', d.state);
    ok('...having moved off full speed', d.value < 1,
       (d.value * 100).toFixed(0) + '%');
    near('...to hold 15 K', Math.abs(res.thermal.links[t.ch.id].dT), 15, 0.06);
  }
}

/* --------------------------------------------------------------------------
 * ADIABATIC EQUIPMENT — a filter, a strainer, a flow meter
 *
 * Michael, 2026-08-05. Real pipework with a real pressure drop and no thermal
 * properties at all. A TYPE rather than a duty of zero, because "no thermal
 * behaviour" and "a duty that happens to be zero" are different statements:
 * only the first should hide the thermal fields and refuse to be controlled.
 * ----------------------------------------------------------------------- */
section('Adiabatic equipment: pressure drop, no thermal side');
{
  function rig(type) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 30, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), j = M.addNode(m, lv, 1, 0);
    const k = M.addNode(m, lv, 2, 0), b = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 600e3); a.device.temperature = 30;
    b.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, j.id, { size: 'DN50', schedule: 'sch40' });
    const e = M.addPipe(m, j.id, k.id, { kind: 'equip' });
    e.tag = 'STR-1';
    e.equip = { qRated: 0.005, pdRated: 30e3, equipType: type,
                duty: 50000, tSet: 6, qMax: -100000, dTMax: 8 };
    M.addPipe(m, k.id, b.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { if (x.kind !== 'equip') x.insulation_mm = 0; });
    return { m, e, res: NET.solveModel(m) };
  }

  const t = rig('adiabatic');
  const l = t.res.thermal.links[t.e.id];
  near('Water leaves as it arrived', l.dT, 0, 1e-12);
  near('...with no duty at all', l.qW, 0, 1e-12);
  near('...and the inlet is the source temperature', l.tIn, 30, 1e-9);
  ok('...with nothing reported as limiting it', !l.limit, String(l.limit));

  /* IT IS STILL PIPEWORK. A strainer has a real pressure drop, and losing that
   * would be a worse error than losing the thermal side. */
  {
    const link = t.res.network.links.filter(x => x.id === t.e.id)[0];
    const pd = 998 * 9.81 * Math.abs(FD.hydraulics.linkLoss(link, t.res.flow[t.e.id]));
    near('It keeps its rated pressure drop', pd / 1000, 30, 0.5);
  }

  ok('It states nothing to control to', M.controlOptions(t.m, t.e.id).length === 0);
  ok('...so it cannot be a control target', M.canBeControlled(t.e) === false);

  /* The same item as an exchanger DOES have a thermal side — the type is what
   * makes the difference, not the numbers, which are identical on both rigs. */
  {
    const x = rig('exchanger');
    const lx = x.res.thermal.links[x.e.id];
    ok('The same numbers as an exchanger do carry a duty', Math.abs(lx.qW) > 1,
       lx.qW.toFixed(1));
    ok('...and it can be controlled', M.canBeControlled(x.e) === true);
  }

  /* It must not set the circuit flow either: a filter is not a load. */
  {
    const m = M.create();
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 5; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.002, pdRated: 100e3, equipType: 'exchanger', duty: 30000 };
    const filt = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    filt.tag = 'STR-2';
    filt.equip = { qRated: 0.010, pdRated: 20e3, equipType: 'adiabatic' };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN150', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN150', schedule: 'sch40' });
    const res = NET.solveModel(m);
    near('A filter does not set the circuit flow — the coil does',
         Math.abs(res.flow[coil.id]), 0.002, 0.002 * 2e-3);
  }
}

/* --------------------------------------------------------------------------
 * A DEAD LEG IS AT THE TEMPERATURE OF THE WATER IT TOUCHES
 *
 * Michael, 2026-08-05: "the temperature is resetting at the source and dead-end
 * pipes", and separately "temperature should remain constant on pipes with no
 * flow — if one end is a tee with flow in another direction, use the
 * temperature of the other end." One fix, both symptoms.
 *
 * Nothing carries a temperature to a dead leg, so the mixing relation has
 * nothing to say. It used to fall back to the SEED — the source water
 * temperature — which is not where that water is; it is at the temperature of
 * the main it hangs off.
 * ----------------------------------------------------------------------- */
section('A dead leg takes the temperature of the water it is connected to');
{
  /* Source at 60 °C -> main -> tee -> outflow, with a capped branch off the
   * tee that carries nothing. The system water is 60 °C throughout (adiabatic
   * pipework), so the dead leg must read 60 — NOT the 6 °C seed. */
  function rig(seedTemp) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: seedTemp, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), tee = M.addNode(m, lv, 4, 0);
    const out = M.addNode(m, lv, 8, 0);
    const dead1 = M.addNode(m, lv, 4, 3), dead2 = M.addNode(m, lv, 4, 6);
    M.setSource(m, a.id, 400e3); a.device.temperature = 60;
    out.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, tee.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, tee.id, out.id, { size: 'DN50', schedule: 'sch40' });
    /* Two pipes of capped branch — the second is a further hop from the live
     * water, which is what tests that the search walks OUTWARD. */
    M.addPipe(m, tee.id, dead1.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, dead1.id, dead2.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    return { m, tee, dead1, dead2, res: NET.solveModel(m) };
  }

  const t = rig(6);
  const T = t.res.thermal.temperature;
  near('The live main is at the source temperature', T[t.tee.id], 60, 1e-9);
  near('The dead branch takes the tee temperature, not the seed',
       T[t.dead1.id], 60, 1e-9);
  near('...and so does the node beyond it', T[t.dead2.id], 60, 1e-9);
  ok('...which is emphatically not the 6 °C source water temperature',
     Math.abs(T[t.dead1.id] - 6) > 50, String(T[t.dead1.id]));

  /* And the answer does not depend on the seed at all any more — the setting
   * Michael suspected of leaking into places it should not. */
  {
    const t2 = rig(80);
    const T2 = t2.res.thermal.temperature;
    near('Changing the source water temperature moves nothing here',
         T2[t2.dead1.id], T[t.dead1.id], 1e-9);
  }

  /* A genuinely ISOLATED island — no path to any live water — still has to be
   * given something, and the seed is the only thing left to say. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 33, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 4, 0);
    const c = M.addNode(m, lv, 8, 0);
    const i1 = M.addNode(m, lv, 0, 9), i2 = M.addNode(m, lv, 4, 9);
    M.setSource(m, a.id, 400e3); a.device.temperature = 60;
    c.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, b.id, c.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, i1.id, i2.id, { size: 'DN50', schedule: 'sch40' });   // orphan
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const T3 = NET.solveModel(m).thermal.temperature;
    near('An orphaned island falls back to the source water temperature',
         T3[i1.id], 33, 1e-9);
  }
}

/* --------------------------------------------------------------------------
 * PRESSURE AND DIFFERENTIAL SENSORS  (Michael, 2026-08-05)
 *
 * A pressure sensor reads its own inlet — the water arriving, which is what a
 * tapping on that pipe reads. A DIFFERENTIAL reads the same thing at two pipes
 * and reports the magnitude of the gap.
 *
 * The differential is built as a REFERENCE on the ordinary in-line sensor
 * rather than a free-standing object: the sensor is already a pipe, already
 * drawn, already a valid control target and already carries a setpoint. A
 * separate object would need its own storage, hit-testing, drawing and control
 * wiring for the same measurement.
 * ----------------------------------------------------------------------- */
section('Pressure and differential sensors');
{
  function rig(mode, extra) {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.thermal = { ambient: 20, supplyTemp: 20, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 7; i++) n.push(M.addNode(m, lv, i * 2, 0));
    M.setSource(m, n[0].id, 400e3); n[0].device.temperature = 60;
    n[6].device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, n[0].id, n[1].id, { size: 'DN50', schedule: 'sch40' });
    const s1 = M.addPipe(m, n[1].id, n[2].id, { kind: 'sensor' });
    s1.tag = 'PS-1';
    s1.sensor = Object.assign({ mode: mode }, extra || {});
    M.addPipe(m, n[2].id, n[3].id, { size: 'DN50', schedule: 'sch40' });
    const eq = M.addPipe(m, n[3].id, n[4].id, { kind: 'equip' });
    eq.equip = { qRated: 0.005, pdRated: 150e3, equipType: 'exchanger', duty: 40000 };
    const s2 = M.addPipe(m, n[4].id, n[5].id, { kind: 'sensor' });
    s2.tag = 'REF-1'; s2.sensor = { mode: 'temperature' };
    M.addPipe(m, n[5].id, n[6].id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    return { m, s1, s2, eq, res: NET.solveModel(m) };
  }

  // ---- a plain pressure sensor
  {
    const t = rig('pressure', { pSet: 300e3 });
    const sp = M.sensorSetpoint(t.s1);
    ok('It states a pressure setpoint', sp && sp.mode === 'pressure',
       JSON.stringify(sp));
    near('...at the value typed', sp.value, 300e3, 1e-9);
    const o = M.controlOptions(t.m, t.s1.id);
    ok('...and offers it as a control option',
       o.length === 1 && o[0].mode === 'pressure', JSON.stringify(o));
    ok('...labelled as a pressure setpoint', o[0].label === 'Pressure setpoint');
  }
  {
    const t = rig('pressure', {});
    ok('A blank pressure setpoint states nothing',
       M.sensorSetpoint(t.s1) === null);
  }

  // ---- a differential
  {
    const t = rig('dP', { dpSet: 150e3 });
    t.s1.sensor.ref = t.s2.id;
    const sp = M.sensorSetpoint(t.s1);
    ok('A differential states a dP setpoint', sp && sp.mode === 'dPdiff',
       JSON.stringify(sp));
    ok('...carrying the pipe it measures against', sp.ref === t.s2.id);

    /* The reading is the gap between the two inlets, and across this rig that
     * is the coil's own pressure drop plus the pipe between them — checked
     * against the solve rather than assumed. */
    const res = NET.solveModel(t.m);
    const p1 = res.pressure[t.s1.a], p2 = res.pressure[t.s2.a];
    ok('The two tappings differ by the plant between them',
       Math.abs(p1 - p2) > 100e3, ((p1 - p2) / 1000).toFixed(1) + ' kPa');
  }
  {
    const t = rig('dP', { dpSet: 150e3 });
    ok('A differential with no reference states nothing',
       M.sensorSetpoint(t.s1) === null);
  }
  {
    const t = rig('dT', { dtSet: 8 });
    t.s1.sensor.ref = t.s2.id;
    const sp = M.sensorSetpoint(t.s1);
    ok('A ΔT differential is distinguished from equipment ΔT',
       sp.mode === 'dTdiff', sp.mode);
    near('...as a magnitude', sp.value, 8, 1e-12);
  }

  /* THE NAME COLLISION THAT BIT. Equipment already offers a setpoint called
   * 'dT' — its own Design ΔT — and routing that into the differential reader
   * sent it looking for a reference pipe that was never going to exist. The
   * two must stay distinguishable. */
  {
    const m = M.create();
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const e = M.addPipe(m, a.id, b.id, { kind: 'equip' });
    e.equip = { qRated: 0.002, pdRated: 100e3, equipType: 'source',
                tSet: 6, qMax: -50000, dTMax: 8 };
    const opts = M.controlOptions(m, e.id);
    ok('Equipment ΔT is mode "dT"', opts[1].mode === 'dT', opts[1].mode);
    ok('...not the differential mode', opts[1].mode !== 'dTdiff');
  }
}

report();
