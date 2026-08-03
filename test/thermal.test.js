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
    const t = plant({ tSet: 6, qMax: 100000 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('Capacity caps the duty', l.qW, -100000, 1e-6);
    near('...so it misses the setpoint', l.tOut, 18 - 100000 / C, 1e-9);
    near('...leaving at 13.21 C', l.tOut, 13.2129, 1e-3);
    ok('...and says which limit bound it', l.limit === 'Capacity', String(l.limit));
  }

  /* ΔT MAX. A machine that cannot work across more than 8 K leaves at 10 C,
   * whatever its capacity. */
  {
    const t = plant({ tSet: 6, qMax: 1e9, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('The difference is capped', l.dT, -8, 1e-9);
    near('...so it leaves at 10 C', l.tOut, 10, 1e-9);
    near('...at a duty of -167.1 kW', l.qW, -8 * C, 1e-6);
    ok('...reported as the ΔT limit', l.limit === 'ΔT max', String(l.limit));
  }

  /* Both set: whichever is tighter wins. At this flow, 8 K is 167 kW, so a
   * 100 kW machine is capacity-limited even though ΔT would allow more. */
  {
    const t = plant({ tSet: 6, qMax: 100000, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('The tighter of the two binds', l.limit === 'Capacity', String(l.limit));
    near('...at 100 kW', l.qW, -100000, 1e-6);
  }
  {
    /* Quarter the flow and the SAME machine becomes ΔT-limited: 8 K is now
     * only 41.8 kW, well inside its 100 kW. This is why both limits exist. */
    const t = plant({ tSet: 6, qMax: 100000, dTMax: 8 }, flow / 4, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('At a quarter flow the ΔT limit binds instead', l.limit === 'ΔT max',
       String(l.limit));
    near('...at 41.8 kW', l.qW, -8 * C / 4, 1);
  }

  /* T LIMIT — Michael's waterside economizer. Ambient 18 C is the floor it
   * cannot pass; the setpoint of 25 C is above it, so the setpoint governs and
   * the limit does nothing. */
  {
    const t = plant({ tSet: 25, tLimit: 18, qMax: 1e9 }, flow, 30);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('It holds the setpoint, which is inside the limit', l.tOut, 25, 1e-9);
    ok('...so nothing binds', l.limit === null || l.limit === undefined);
  }
  {
    /* Ask the same economizer for 12 C against an 18 C ambient and it cannot:
     * it gets to 18 and stops. That is the second law, not a control choice. */
    const t = plant({ tSet: 12, tLimit: 18, qMax: 1e9 }, flow, 30);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('It cannot pass its physical limit', l.tOut, 18, 1e-9);
    ok('...and says so', l.limit === 'T limit', String(l.limit));
    ok('...having still done real work', l.qW < 0);
  }

  /* A BOILER is the same machine with the signs the other way up: setpoint
   * above inlet, positive duty, and the limits behave identically. */
  {
    const t = plant({ tSet: 80, qMax: 1e9, dTMax: 15 }, flow, 60);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('Heating is capped by the same ΔT limit', l.dT, 15, 1e-9);
    near('...leaving at 75 C', l.tOut, 75, 1e-9);
    ok('...with a positive duty', l.qW > 0);
    ok('...reported the same way', l.limit === 'ΔT max');
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
                 tSet: 6, qMax: 100000 };
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
    ok('The second is ΔT-limited', th.links[e2.id].limit === 'ΔT max');
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
      tSet: 25, tLimit: 18, qMax: 250000
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
    ok('The pump is at full speed', M.pumpSpeed(t.pump) === 1);
  }

  // ---- 2. CONTROLLED: the pump ramps DOWN and the setpoint is held.
  const controlled = economizer({ link: 'pump' });
  const res = NET.solveModel(controlled.m);
  {
    ok('Solves with a control link', res.converged === true,
       JSON.stringify(res.errors));
    const speed = M.pumpSpeed(controlled.pump);

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
         M.pumpSpeed(controlled.pump), res.controls.devices[0].value, 2e-3);
    near('...and on the same flow', Math.abs(again.flow[controlled.eq.id]),
         Math.abs(res.flow[controlled.eq.id]), 1e-6);
  }

  // ---- 4. THE FLOOR. A machine too small to hold setpoint at minimum speed.
  {
    /* 60 kW wants q = 60000/20893130 = 2.872 L/s, which is well under a
     * quarter of the full-speed flow, so the drive bottoms out. */
    const t = economizer({ link: 'pump', equip: { qMax: 60000 } });
    const r = NET.solveModel(t.m);
    near('The pump sits on its minimum speed', M.pumpSpeed(t.pump), 0.25, 1e-9);
    const l = r.thermal.links[t.eq.id];
    ok('...and the machine is still warm of setpoint', l.tOut > 25.5,
       l.tOut.toFixed(2) + ' C');
    const w = r.warnings.filter(x => x.code === 'CONTROL_AT_LIMIT')[0];
    ok('CONTROL_AT_LIMIT is raised', !!w);
    ok('...naming the minimum and the shortfall',
       !!w && /minimum speed/.test(w.message) && /above/.test(w.message),
       w && w.message);
    ok('...reported as at-min', r.controls.devices[0].state === 'at-min');
  }

  // ---- 5. THE SIGN IS NOT ASSUMED: backing off must be shown to help.
  {
    /* A machine capped by ΔT max leaves at tIn - dTMax whatever the flow, so
     * slowing the pump changes NOTHING about its leaving temperature. A
     * controller that simply "ramps down towards a setpoint" would wind this
     * pump to its floor for no benefit. The perturbation catches it. */
    const t = economizer({ link: 'pump',
                           equip: { qMax: 1e9, dTMax: 2 } });
    const r = NET.solveModel(t.m);
    const l = r.thermal.links[t.eq.id];
    near('The machine is pinned 2 K below inlet', l.tOut, 28, 1e-9);
    ok('...by its ΔT limit', l.limit === 'ΔT max', String(l.limit));
    ok('The pump stayed at full speed', M.pumpSpeed(t.pump) === 1,
       String(M.pumpSpeed(t.pump)));
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
    ok('...and the pump was left alone', M.pumpSpeed(t.pump) === 1);
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
    ok('...and within one percent of valve travel of it',
       qV > qHandV * 0.985, `${((qV / qHandV - 1) * 100).toFixed(2)}%`);
    ok('The report names the opening', r.controls.devices[0].quantity === 'opening');
    ok('...and the position is a whole percent',
       t.valve.valve.opening === Math.round(t.valve.valve.opening));
  }

  // ---- 7. A link to a machine with no setpoint controls nothing, and says so.
  {
    const t = economizer({ link: 'pump',
                           equip: { equipType: 'exchanger', duty: -100000,
                                    tSet: undefined } });
    const r = NET.solveModel(t.m);
    ok('The pump is left at full speed', M.pumpSpeed(t.pump) === 1);
    ok('CONTROL_NO_SETPOINT is raised',
       r.warnings.some(w => w.code === 'CONTROL_NO_SETPOINT'),
       JSON.stringify(r.warnings.map(w => w.code)));
  }

  // ---- 8. DESIGN does not control — the flows there are imposed, not solved.
  {
    const t = economizer({ link: 'pump', mode: 'design' });
    const r = NET.solveModel(t.m);
    ok('No control report in DESIGN', r.controls === null);
    ok('...and the pump is untouched', M.pumpSpeed(t.pump) === 1);
    const plain = NET.solveModel(economizer({ link: null, mode: 'design' }).m);
    near('...so the answer is identical to the same model with no link',
         r.flow[t.eq.id], plain.flow[t.eq.id], 1e-12);
  }
}

report();
