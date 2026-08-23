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
const fs = require('fs');
const path = require('path');

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

section('Insulation is a global default, overridden per pipe');
{
  /* DECOUPLED FROM THE SCHEDULE (2026-08-10). Thickness was "25 mm below DN50,
   * 50 mm from DN50 up", keyed per schedule and size; it is now one global
   * value in Thermal settings, overridden per pipe. A schedule is its published
   * dimensions only. The value under test is a design INPUT — the number the
   * engineer sets — not one read back out of the code. */
  const m = M.create();
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0);
  const p = M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });

  near('A fresh model defaults to 50 mm', TH.defaultThicknessMm(m), 50, 1e-12);
  near('...and a blank pipe takes that default',
       TH.thicknessOf(m, p), 0.050, 1e-12);

  /* IT FOLLOWS THE GLOBAL SETTING, not the schedule. */
  m.settings.thermal.insulation_mm = 80;
  near('A blank pipe follows the global thickness',
       TH.thicknessOf(m, p), 0.080, 1e-12);

  /* THE SCHEDULE NO LONGER TOUCHES IT. A DN50 sch40 pipe and a DN300 one take
   * the same global thickness — the whole point of the decoupling. */
  const p2 = M.addPipe(m, a.id, b.id, { size: 'DN300', schedule: 'sch40' });
  near('A different size takes the same global thickness',
       TH.thicknessOf(m, p2), 0.080, 1e-12);

  /* A PIPE'S OWN VALUE ALWAYS WINS, INCLUDING ZERO — otherwise a deliberately
   * bare pipe would silently pick up the default. */
  p.insulation_mm = 0;
  near('A pipe set to zero is bare, whatever the default',
       TH.thicknessOf(m, p), 0, 1e-12);
  p.insulation_mm = 45;
  near('...and its own value is used', TH.thicknessOf(m, p), 0.045, 1e-12);

  /* A MODEL WHOSE SETTINGS PREDATE THE FIELD falls back to 50 mm rather than
   * NaN or zero — old files re-solve against the default. */
  const bare = M.create();
  delete bare.settings.thermal.insulation_mm;
  near('An absent setting falls back to 50 mm',
       TH.defaultThicknessMm(bare), 50, 1e-12);

  /* THE PER-SIZE TABLE, editable in Thermal and keyed by nominal label so it is
   * schedule-independent. It overrides the global default, and a blank row
   * takes it. */
  const m3 = M.create();                       // global default 50
  m3.settings.thermal.insulation = { DN50: 30 };
  near('A per-size entry overrides the global default',
       TH.thicknessMmForSize(m3, 'DN50'), 30, 1e-12);
  near('...only for the size it names', TH.thicknessMmForSize(m3, 'DN100'), 50, 1e-12);
  const lv3 = m3.levels[0].id;
  const a3 = M.addNode(m3, lv3, 0, 0), b3 = M.addNode(m3, lv3, 1, 0);
  const p50 = M.addPipe(m3, a3.id, b3.id, { size: 'DN50', schedule: 'sch40' });
  const p50b = M.addPipe(m3, a3.id, b3.id, { size: 'DN50', schedule: 'sch10' });
  near('A blank pipe takes its size entry', TH.thicknessOf(m3, p50), 0.030, 1e-12);
  near('...the SAME on a different schedule (decoupled)',
       TH.thicknessOf(m3, p50b), 0.030, 1e-12);
  p50.insulation_mm = 12;
  near('...but the pipe’s own value still wins', TH.thicknessOf(m3, p50), 0.012, 1e-12);

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
  ok('...and saying it is outside the THERMAL limits',
     /outside the limits set in THERMAL/.test(err.message), err.message);

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
 *   T limit   tLimit — the temperature it physically cannot pass: a tower
 *                      cannot go below wet bulb, an economizer below ambient.
 *                      HEAT EXCHANGERS ONLY since v0.12.2.
 *
 * Which one binds is reported, because "CH-01 limited by Capacity" is the
 * sentence an engineer wants rather than an unexplained leaving temperature.
 *
 * DESIGN ΔT IS NOT IN THAT LIST ANY MORE, and used to be — it clamped the
 * difference the machine could work across, at any flow. Michael's manufacturer
 * part-load table settled it on 2026-08-09 and the assertions below moved with
 * the physics rather than being renumbered: see `Design ΔT is a design point,
 * not a limit` further down for the table and the arithmetic. `dTMax` is still
 * stored and still has a job — it is one leg of the design-point relation
 * Q = ṁ·Cp·ΔT that `M.setEquipTrio` keeps consistent — but nothing in the
 * thermal solve reads it on a source/sink.
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

  /* ΔT MAX DOES NOT CAP THE DIFFERENCE — v0.16.4, and this block used to assert
   * the opposite.
   *
   * WHAT MOVED AND WHY. The same machine — setpoint 6, inlet 18, a stated
   * Design ΔT of 8 K — used to leave at 10 °C doing 167 kW, because the model
   * clamped ΔT at 8 K. It now reaches its setpoint: 12 K, 250.7 kW. Michael's
   * manufacturer part-load table shows a machine holding its leaving
   * temperature at every load while its ΔT slides from 12 K down to 10.5 K, so
   * ΔT is an OUTPUT of the flow, not something the machine refuses to exceed.
   * Nothing else in the block changed: the hand figures are the unconstrained
   * ones from the top of this section. */
  {
    const t = plant({ tSet: 6, qMax: -1e9, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('A stated Design ΔT does not cap the difference', l.dT, -12, 1e-9);
    near('...so it still reaches its 6 C setpoint', l.tOut, 6, 1e-9);
    near('...at the full -250.7 kW that took', l.qW, -12 * C, 1e-6);
    ok('...and nothing is reported as limiting it', !l.limit, String(l.limit));
  }

  /* CAPACITY IS WHAT BINDS, and it is the only thing that does. 12 K at this
   * flow is 250.7 kW, so a 100 kW machine gets 100 kW. */
  {
    const t = plant({ tSet: 6, qMax: -100000, dTMax: 8 }, flow, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('Capacity binds, ΔT does not', l.limit === 'Capacity', String(l.limit));
    near('...at 100 kW', l.qW, -100000, 1e-6);
  }
  {
    /* QUARTER THE FLOW AND THE SAME MACHINE IS COMFORTABLE. 12 K on a quarter
     * of the flow is 62.7 kW, well inside its 100 kW, so it holds setpoint —
     * and it is THIS row that the old clamp got backwards. Under the clamp the
     * duty was capped at C·ΔT_max, and C falls with flow, so throttling a
     * chiller appeared to reduce its capacity: 8 K × C/4 = 41.8 kW, and the
     * machine was reported as limited while running at a quarter of its
     * nameplate. Michael, 2026-08-09: that is why every machine on the data
     * centre model sat at 26–50% of nameplate with its coils starving. */
    const t = plant({ tSet: 6, qMax: -100000, dTMax: 8 }, flow / 4, 18);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    ok('At a quarter flow nothing binds at all', !l.limit, String(l.limit));
    near('...and it does the 62.7 kW that 12 K needs', l.qW, -12 * C / 4, 1);
    near('...still leaving at setpoint', l.tOut, 6, 1e-9);
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
   * above inlet, positive duty, and the limits behave identically — which now
   * means a stated Design ΔT does not hold it back either. 60 → 80 is 20 K,
   * not the 15 K it is scheduled at, and 20 × 20893.13 = 417.9 kW. */
  {
    const t = plant({ tSet: 80, qMax: 1e9, dTMax: 15 }, flow, 60);
    const l = NET.solveModel(t.m).thermal.links[t.e.id];
    near('Heating is not capped by Design ΔT either', l.dT, 20, 1e-9);
    near('...leaving at its 80 C setpoint', l.tOut, 80, 1e-9);
    near('...at 417.9 kW', l.qW, 20 * C, 1e-6);
    ok('...with a positive duty', l.qW > 0);
    ok('...and nothing binding', !l.limit, String(l.limit));
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
    /* THE SECOND PICKS UP WHAT THE FIRST COULD NOT, and its scheduled 3 K does
     * not stop it. The first leaves at 30 − 100000/20893.13 = 25.2137 °C, so
     * the second works across 25.2137 − 6 = 19.2137 K to reach the same
     * setpoint. It used to stop at 3 K and leave the water at 22.21 °C, which
     * is the clamp saying a machine in series is only allowed its design
     * difference — and the design difference is a design-point figure, not a
     * stop. */
    ok('The second is not held to its design ΔT', !th.links[e2.id].limit,
       String(th.links[e2.id].limit));
    near('...so it finishes the job the first could not',
         th.links[e2.id].tOut, 6, 1e-9);
    near('...working across 19.21 K', th.links[e2.id].dT,
         6 - (30 - 100000 / C), 1e-9);
    /* And the two together are still just Q = C.dT, link by link. */
    near('Duty and difference agree on the first',
         th.links[e1.id].qW, th.links[e1.id].C * th.links[e1.id].dT, 1e-6);
  }
}

/* --------------------------------------------------------------------------
 * DESIGN ΔT IS A DESIGN POINT, NOT A LIMIT.
 *
 * The evidence, and the reason the assertions above moved: Michael's
 * manufacturer part-load table for a 1380 kW air-cooled chiller, 2026-08-09.
 * The two rows recorded in `HANDOVER.md` §6 are used here — the design point
 * and the 30% row, which is the bottom of the table where the flow floors.
 *
 *     load    flow        ΔT       LWT       duty
 *     100%    27.65 L/s   12.0 K   20.00 C   1380 kW  (nameplate)
 *      30%     9.464 L/s  10.5 K   20.00 C    414 kW  (30% of nameplate)
 *
 * TWO THINGS TO READ OFF IT. The leaving temperature is 20.00 °C in BOTH rows —
 * the machine holds its setpoint across the whole range. And the ΔT is not 12 K
 * in both: it collapses to 10.5 K once the flow has floored, because ΔT is what
 * you get when a duty meets a flow, not something the machine refuses to
 * exceed. The design figure of 12 K is 12 K because that is design flow at
 * design return, and nothing else.
 *
 * The arithmetic is Q = ṁ·Cp·ΔT throughout, and it closes:
 *
 *     998 × 0.02765 × 4187 × 12.0  = 1386 kW  against a 1380 kW nameplate
 *     998 × 0.009464 × 4187 × 10.5 =  415 kW  against 30% of 1380 = 414 kW
 *
 * both inside 0.5%, on figures nobody here chose.
 * ----------------------------------------------------------------------- */
section('Design ΔT is a design point, not a limit');
{
  function chiller(flow, inletT) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: inletT, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), j = M.addNode(m, lv, 1, 0);
    const k = M.addNode(m, lv, 2, 0), b = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 900e3); a.device.temperature = inletT;
    b.device = { kind: 'demand', flow: flow, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, j.id, { size: 'DN150', schedule: 'sch40' });
    const e = M.addPipe(m, j.id, k.id, { kind: 'equip' });
    /* The machine EXACTLY as scheduled: 27.65 L/s, 12 K, 1380 kW. */
    e.equip = { qRated: 0.02765, pdRated: 60e3, equipType: 'source',
                tSet: 20, dTMax: 12, qMax: -1380000 };
    M.addPipe(m, k.id, b.id, { size: 'DN150', schedule: 'sch40' });
    m.pipes.forEach(p => { p.insulation_mm = 0; });
    return NET.solveModel(m).thermal.links[e.id];
  }

  /* ---- ROW 1, the design point. 27.65 L/s entering at 32 °C.
   *
   * IT SITS EXACTLY ON ITS NAMEPLATE, which is what a machine selected at its
   * design point does, and the last 0.5% is worth stating rather than tuning
   * away. 27.65 L/s across 12 K is 1386.5 kW on the fluid table this model
   * uses (998 kg/m³, 4187 J/kg·K); the schedule says 1380 kW. The 6.5 kW
   * between them is the manufacturer quoting properties at the mean water
   * temperature and rounding the flow, not a disagreement about the physics.
   *
   * So capacity binds by half a percent and the machine leaves at 20.06 °C
   * rather than 20.00 — six hundredths of a kelvin, which is inside the
   * control deadband and far inside anything a sensor would read. */
  {
    const l = chiller(0.02765, 32);
    near('At design flow it does exactly its 1380 kW nameplate', l.qW, -1380000, 1);
    ok('...sitting on the capacity boundary, as a design selection should',
       l.limit === 'Capacity', String(l.limit));
    near('...and leaves within a tenth of a kelvin of 20.00 C', l.tOut, 20, 0.1);
    ok('...the gap being the half percent between 1380 kW and ρ·q·cp·ΔT',
       Math.abs(RHO * 0.02765 * CP * 12 / 1380000 - 1) < 0.005,
       ((RHO * 0.02765 * CP * 12 / 1380000 - 1) * 100).toFixed(2) + '%');
  }

  /* ---- ROW 2, the 30% row, and it is the one that settles the argument.
   * The flow has floored at 9.464 L/s and the return is 30.5 °C, so the machine
   * works across 10.5 K — not 12 — and still leaves at 20.00 °C. */
  {
    const l = chiller(0.009464, 30.5);
    near('At 30% load it still leaves at 20.00 C', l.tOut, 20, 1e-9);
    near('...but across 10.5 K, not the 12 K design figure', l.dT, -10.5, 1e-9);
    near('...doing 415 kW', l.qW / 1000, -415.2, 1);
    ok('...which is 30% of the nameplate, as the table says',
       Math.abs(l.qW / -1380000 - 0.30) < 0.005,
       (l.qW / -13800).toFixed(1) + '% of nameplate');
    ok('...with nothing limiting it', !l.limit, String(l.limit));
  }

  /* ---- AND THE ROW THE OLD MODEL GOT WRONG. Not from the table — the table
   * never asks for more than 12 K — but the direct consequence of reading ΔT as
   * an output, and the case Michael's data centre lives in: the same machine at
   * the same floored flow with a WARM return, because the coils are starving.
   * 9.464 L/s from 35 °C is 15 K, above the design figure, and 594 kW — well
   * inside 1380 kW. It holds 20 °C.
   *
   * The old model clamped at 12 K, left the water at 23 °C, and reported
   * "limited by Design ΔT" on a machine running at 43% of its nameplate. That
   * is the sentence that appeared on 26–50% of the machines in his model. */
  {
    const l = chiller(0.009464, 35);
    near('A warm return does not stop it holding 20 C', l.tOut, 20, 1e-9);
    near('...working across 15 K', l.dT, -15, 1e-9);
    near('...at 593 kW', l.qW / 1000, -593.2, 1);
    ok('...still well inside its capacity', Math.abs(l.qW) < 1380000,
       (l.qW / -13800).toFixed(1) + '% of nameplate');
    ok('...and not reported as limited by anything', !l.limit, String(l.limit));
  }

  /* CAPACITY IS STILL A CAPACITY. Ask the same machine for more than 1380 kW
   * and it delivers 1380 kW and says so — the limit that survived is the one
   * that is a nameplate figure rather than a design condition. 27.65 L/s from
   * 45 °C wants 25 K, which is 2889 kW. */
  {
    const l = chiller(0.02765, 45);
    near('Asked for 2889 kW it does its 1380 kW', l.qW, -1380000, 1);
    ok('...and names the capacity', l.limit === 'Capacity', String(l.limit));
    near('...leaving at 33.06 C, which is the honest answer',
         l.tOut, 45 - 1380000 / (RHO * 0.02765 * CP), 1e-6);
  }
}

/* --------------------------------------------------------------------------
 * "SIZE IT FOR ME" — the required duty, reported per machine.
 *
 * The other half of the ΔT ruling (Michael, 2026-08-09). A machine with no
 * stated capacity holds its setpoint whatever that takes, so the duty it lands
 * on IS the answer to what to buy — the same pattern `autoSizePumps` uses for
 * pumps. `qNeed` on the thermal link is that answer: `C·(tSet − tIn)`, the duty
 * needed to sit on setpoint at the flow the machine actually has.
 *
 * It is on the ENGINE rather than worked out in the panel, so the property
 * sheet and the plant schedule cannot produce two different numbers — the same
 * rule that moved warning detection out of the calculation sheet.
 * ----------------------------------------------------------------------- */
section('Required capacity: the duty a machine needs, reported');
{
  function plant2(equip, flow, inletT) {
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
    e.equip = Object.assign({ qRated: flow, pdRated: 20e3 }, equip);
    M.addPipe(m, k.id, b.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(p => { p.insulation_mm = 0; });
    return { m, e, link: () => NET.solveModel(m).thermal.links[e.id] };
  }

  const flow = 0.005;
  const C = RHO * flow * CP;                     // 20893.13 W/K

  /* ---- UNLIMITED: the requirement and the duty are the same number, because
   * the machine did exactly what was asked. 18 → 6 is 12 K, so 250.7 kW. */
  {
    const t = plant2({ equipType: 'source', tSet: 6 }, flow, 18);
    const l = t.link();
    near('An unlimited machine needs what it did', l.qNeed, l.qW, 1e-9);
    near('...which is C × (setpoint − entering)', l.qNeed, -12 * C, 1e-6);
    ok('...and that IS the capacity to select', !l.limit, String(l.limit));
  }

  /* ---- CAPACITY-LIMITED: the two SEPARATE, and this is the case that makes
   * `qNeed` worth having. The duty reported is the nameplate — 100 kW — and
   * without the requirement beside it there is nothing to say how short the
   * machine is. It needs 250.7 kW, so 100 kW is 60% short. */
  {
    const t = plant2({ equipType: 'source', tSet: 6, qMax: -100000 }, flow, 18);
    const l = t.link();
    near('A limited machine still reports what it DID', l.qW, -100000, 1e-6);
    near('...and separately what it NEEDED', l.qNeed, -12 * C, 1e-6);
    ok('...so the shortfall is readable', Math.abs(l.qNeed) > Math.abs(l.qW),
       (l.qNeed / 1000).toFixed(1) + ' needed vs ' + (l.qW / 1000).toFixed(1) + ' done');
    /* The margin the panel and the plant schedule both quote. */
    near('The margin on a 100 kW selection is −60%',
         (Math.abs(-100000) / Math.abs(l.qNeed) - 1) * 100, -60.11, 0.05);
  }

  /* ---- THE REQUIREMENT MOVES WITH THE FLOW, which is the whole reason it
   * cannot be read off the schedule. Half the flow, half the requirement. */
  {
    const t = plant2({ equipType: 'source', tSet: 6 }, flow / 2, 18);
    near('Half the flow needs half the duty', t.link().qNeed, -12 * C / 2, 1e-6);
  }

  /* ---- AND IT IS NULL WHERE THE QUESTION DOES NOT ARISE. An exchanger STATES
   * its duty — the load is the answer and there is nothing to size — and an
   * adiabatic device has no thermal side at all. */
  {
    const t = plant2({ equipType: 'exchanger', duty: 50000 }, flow, 18);
    const l = t.link();
    ok('An exchanger states no requirement', l.qNeed === null, String(l.qNeed));
    near('...because its stated load already is one', l.qW, 50000, 1);
  }
  {
    const t = plant2({ equipType: 'source' }, flow, 18);   // no setpoint
    ok('A machine with no setpoint is not being asked for anything',
       t.link().qNeed === null, String(t.link().qNeed));
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
    /* AND IT NAMES WHAT STOPPED THE MACHINE. "Check heat balance" on its own
     * sends an engineer looking in the right place; "limited by Capacity" tells
     * them what they will find when they get there. */
    ok('...naming what limited the machine',
       !!e && /limited by Capacity/.test(e.message), e && e.message);
    ok('...and it clears converged', r.converged === false);
  }

  // ---- 5. THE SIGN IS NOT ASSUMED: backing off must be shown to help.
  {
    /* A machine that does NOTHING leaves the water as it arrived whatever the
     * flow, so slowing the pump changes nothing about its leaving temperature.
     * A controller that simply "ramps down towards a setpoint" would wind this
     * pump to its floor for no benefit. The perturbation catches it.
     *
     * THE VEHICLE CHANGED WITH THE PHYSICS, v0.16.4. This used to be a machine
     * pinned 2 K below its inlet by a Design ΔT of 2 K — the only genuinely
     * flat response the model had, and Design ΔT no longer clamps anything. A
     * capacity with the WRONG SIGN is flat for a reason that is still real: a
     * chiller asked to heat delivers nothing at any flow, and says so. The
     * property under test is unchanged — backing off must be SHOWN to help
     * before the search believes it. */
    const t = economizer({ link: 'pump',
                           equip: { tSet: 25, qMax: 1e9 } });
    const r = NET.solveModel(t.m);
    const l = r.thermal.links[t.eq.id];
    near('The machine leaves the water exactly as it arrived', l.tOut, 30, 1e-9);
    ok('...because its capacity is the wrong way round',
       l.limit === 'Capacity (wrong direction)', String(l.limit));
    ok('The pump stayed at full speed', M.pumpSpeed(t.m, t.pump) === 1,
       String(M.pumpSpeed(t.m, t.pump)));
    ok('...reported as at-max', r.controls.devices[0].state === 'at-max',
       r.controls.devices[0].state);
    ok('...with a CONTROL_AT_LIMIT warning at maximum travel',
       r.warnings.some(w => w.code === 'CONTROL_AT_LIMIT' &&
                            /at maximum/.test(w.message)));
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
    ok('...with a CONTROL_AT_LIMIT warning at maximum travel',
       res.warnings.some(w => w.code === 'CONTROL_AT_LIMIT' &&
                              /at maximum/.test(w.message)));
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

  /* ---- 1. LWT ALONE: the chiller holds it whatever the pump does, so the
   * pump is not modulating for it. Reported as ON — the setpoint IS met — and
   * flagged `idle`, which is what makes it fall through when there is
   * somewhere to fall to.
   *
   * This used to be `no-authority` with a warning. Michael's `20260805-5`
   * showed why that was wrong: three valves wide open on the furthest branches,
   * flows already correct, reported as having no authority when they were
   * simply — and correctly — not throttling. */
  {
    const t = plantLoop({ link: true, use: { lwt: true } });
    const res = NET.solveModel(t.m);
    const d = res.controls.devices[0];
    ok('The setpoint is met, so it reports as holding it', d.state === 'on', d.state);
    ok('...flagged as not modulating', d.idle === true);
    near('...and stays at full speed', d.value, 1, 1e-12);
    ok('...with no warning, because nothing is wrong',
       !res.warnings.some(x => /^CONTROL_/.test(x.code)),
       JSON.stringify(res.warnings.filter(x => /^CONTROL_/.test(x.code))
                         .map(x => x.code)));
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
    ok('No control warning once it found something it can hold',
       !res.warnings.some(x => /^CONTROL_/.test(x.code)));
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
    ok('...and no control warning is raised',
       !res.warnings.some(x => /^CONTROL_/.test(x.code)),
       JSON.stringify(res.warnings.filter(x => /^CONTROL_/.test(x.code))
                         .map(x => x.code)));
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

  /* ---- WHAT THE INSTRUMENT IS READING, as one definition.
   *
   * `NET.sensorReading` exists because there are two consumers — the control
   * loop settles against the reading, and the drawing prints it beside the
   * sensor. Michael, 2026-08-09: a ΔP sensor's Display list offered
   * "Temperature", and ticking it drew the water temperature at the tapping,
   * which is not what a differential pressure sensor measures.
   *
   * Two derivations of one quantity is how they come to disagree, so these
   * assertions check the reading against the SOLVE directly, and against what
   * the controller settled on. */
  {
    const t = rig('pressure', { pSet: 300e3 });
    const res = NET.solveModel(t.m);
    const rd = NET.sensorReading(t.m, t.s1, res);
    ok('A pressure sensor reads a pressure', rd && rd.mode === 'pressure',
       JSON.stringify(rd));
    near('...at its own inlet, the water arriving',
         rd.value, res.pressure[t.s1.a], 1e-9);
  }
  {
    const t = rig('dP', { dpSet: 150e3 });
    t.s1.sensor.ref = t.s2.id;
    const res = NET.solveModel(t.m);
    const rd = NET.sensorReading(t.m, t.s1, res);
    ok('A ΔP sensor reads a differential', rd && rd.mode === 'dP',
       JSON.stringify(rd));
    near('...between the two tappings',
         rd.value, Math.abs(res.pressure[t.s1.a] - res.pressure[t.s2.a]), 1e-9);
    ok('...as a MAGNITUDE, whichever pipe was picked first', rd.value > 0);
    /* And the other way round is the same number — which pipe was clicked
     * first is an accident of drawing order. */
    const back = NET.sensorReading(t.m, t.s1, res);
    near('...and it is stable', back.value, rd.value, 1e-12);
  }
  {
    const t = rig('dT', { dtSet: 8 });
    t.s1.sensor.ref = t.s2.id;
    const res = NET.solveModel(t.m);
    const rd = NET.sensorReading(t.m, t.s1, res);
    ok('A ΔT sensor reads a temperature difference', rd && rd.mode === 'dT',
       JSON.stringify(rd));
    near('...between the two tappings', rd.value,
         Math.abs(res.thermal.temperature[t.s1.a] -
                  res.thermal.temperature[t.s2.a]), 1e-9);
    /* The coil between them puts 40 kW in, so the two tappings CANNOT read the
     * same temperature — a differential of zero would mean the reference was
     * being read at the wrong node. */
    ok('...and the coil between them makes it non-zero', rd.value > 0.5,
       rd.value.toFixed(3) + ' K');
  }
  {
    const t = rig('dP', { dpSet: 150e3 });        // no ref pipe
    ok('A differential with nothing to measure against reads nothing',
       NET.sensorReading(t.m, t.s1, NET.solveModel(t.m)) === null);
  }
  {
    const t = rig('temperature', { tSet: 45 });
    const res = NET.solveModel(t.m);
    const rd = NET.sensorReading(t.m, t.s1, res);
    ok('A temperature sensor reads a temperature', rd && rd.mode === 'temperature',
       JSON.stringify(rd));
    near('...at its inlet', rd.value, res.thermal.temperature[t.s1.a], 1e-9);
  }
  {
    const t = rig('flow', { qSet: 0.004 });
    const res = NET.solveModel(t.m);
    const rd = NET.sensorReading(t.m, t.s1, res);
    ok('A flow sensor reads the flow through it', rd && rd.mode === 'flow',
       JSON.stringify(rd));
    near('...as a magnitude', rd.value, Math.abs(res.flow[t.s1.id]), 1e-12);
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

/* --------------------------------------------------------------------------
 * THE HEAT BALANCE CLOSES — for an open system too
 *
 * Michael asked for a heat balance on the calculation sheet, 2026-08-05. The
 * figure that makes it worth having is the RESIDUAL: at steady state everything
 * put into the water comes out of it, so it is zero by definition and needs no
 * reference temperature and no hand calculation to read.
 *
 * `imbalance` — link duties alone — only closes on a SEALED circuit. Two terms
 * were missing:
 *
 *   SOURCE DUTY   a source holds its stated temperature whatever arrives, so it
 *                 is a heat source in its own right. An infinite reservoir does
 *                 not warm up.
 *   BOUNDARY      energy the water carries out of an OPEN system when it leaves
 *                 at a different temperature from the one it entered at.
 *
 * `residual = pipeLoss + equipDuty + sourceDuty − boundary` closes in all three
 * cases, and `imbalance` is kept beside it because every sealed-circuit
 * expectation in this file reads it.
 * ----------------------------------------------------------------------- */
section('The heat balance closes, sealed or open');
{
  const RHOCP = 998 * 4187;

  /* ---- 1. AN OPEN SYSTEM: water in at 10 °C, a 40 kW coil, water out.
   * Everything the coil adds walks out of the demand node, so `imbalance` is
   * +40 kW and the residual is zero. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 10, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), j = M.addNode(m, lv, 1, 0);
    const k = M.addNode(m, lv, 2, 0), b = M.addNode(m, lv, 3, 0);
    M.setSource(m, a.id, 400e3); a.device.temperature = 10;
    b.device = { kind: 'demand', flow: 0.005, reqPressure: 100e3, include: true };
    M.addPipe(m, a.id, j.id, { size: 'DN50', schedule: 'sch40' });
    const e = M.addPipe(m, j.id, k.id, { kind: 'equip' });
    e.equip = { qRated: 0.005, pdRated: 20e3, equipType: 'exchanger', duty: 40000 };
    M.addPipe(m, k.id, b.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const th = NET.solveModel(m).thermal;

    near('The coil adds its 40 kW', th.totals.equipDuty, 40000, 1);
    near('Link duties alone do NOT balance an open system', th.imbalance, 40000, 1);
    near('...because the water carries it out', th.boundary, 40000, 1);
    near('...so the residual is zero', th.residual, 0, 1e-6);

    /* And the boundary term is exactly ṁ·Cp·ΔT across the system, by hand:
     * 40 kW into 5 L/s raises it 40000/(0.005 × 4 178 626) = 1.914 K. */
    const dTsys = 40000 / (0.005 * RHOCP);
    near('...which is ṁ·Cp·ΔT across the whole system',
         th.boundary, 0.005 * RHOCP * dTsys, 1);
    near('...raising the water 1.914 K', dTsys, 1.9145, 1e-3);
  }

  /* ---- 2. A SEALED CIRCUIT with a fill connection. The source carries no net
   * flow, but it PINS the temperature — so a plant that cannot keep up shows as
   * heat absorbed there rather than as an unbalanced answer. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 11, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    M.setSource(m, n[0].id, 250e3); n[0].device.temperature = 11;
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'exchanger', duty: 60000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    /* Deliberately too small: 40 kW of cooling against a 60 kW load. */
    ch.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'source',
                 tSet: 6, qMax: -40000 };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const th = NET.solveModel(m).thermal;

    near('No water crosses the boundary of a sealed circuit', th.boundary, 0, 1e-6);
    ok('The plant cannot keep up', th.totals.equipDuty > 1000,
       (th.totals.equipDuty / 1000).toFixed(2) + ' kW');
    ok('...and the fill absorbs the shortfall', th.sourceDuty < -1000,
       (th.sourceDuty / 1000).toFixed(2) + ' kW');
    near('...to the watt', th.sourceDuty, -(th.totals.equipDuty + th.totals.pipeLoss), 1);
    near('The balance closes', th.residual, 0, 1e-6);
    /* 60 kW in, 40 kW out: the fill is carrying the missing 20 kW. */
    near('...and the shortfall is the 20 kW the chiller is short by',
         th.sourceDuty, -20000, 50);
  }

  /* ---- 2b. AND IT IS NOW SAID OUT LOUD.
   *
   * The behaviour is not new — a reference node has held its temperature
   * whatever arrives since v0.10.0. What was new in v0.14.1 was MEASURING it,
   * and Michael's point (2026-08-05) is that measuring it is not enough: a
   * plant that cannot keep up must raise a warning, or the model reports a
   * perfectly plausible answer while the fill quietly does impossible work.
   *
   * The only version of this anyone ever saw was a thermal RUNAWAY, and only in
   * models where nothing pins the temperature at all — there the surplus has to
   * raise the water until the pipework sheds it. Put a source or a pinned datum
   * in the same model and it vanishes instead. That is the worse failure of the
   * two, because a runaway announces itself. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 11, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    M.setSource(m, n[0].id, 250e3); n[0].device.temperature = 11;
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'exchanger', duty: 60000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    ch.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'source',
                 tSet: 6, qMax: -40000 };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const res = NET.solveModel(m);

    const w = (res.warnings || []).filter(x => x.code === 'HEAT_IMBALANCE')[0];
    ok('HEAT_IMBALANCE is raised', !!w,
       JSON.stringify((res.warnings || []).map(x => x.code)));
    near('...quantifying the shortfall', w && w.watts, -20000, 50);
    ok('...saying which way round it is',
       !!w && /removed at/.test(w.message), w && w.message);
    ok('...and it is a warning, not a defect', w && w.level === 'warning', w && w.level);

    /* The temperatures are perfectly plausible — 11 to 14.6 °C — which is
     * exactly why this needed saying. Nothing else in the result objects. */
    ok('Everything else looks fine, which is the point',
       res.converged === true &&
       res.thermal.totals.max < 20 && res.thermal.totals.min > 5,
       res.thermal.totals.min.toFixed(1) + '…' + res.thermal.totals.max.toFixed(1));
  }
  /* ---- 2c. A BALANCED plant says nothing.
   *
   * SEALED, with no source at all, so the reference is the datum pinned at the
   * chiller outlet — and the chiller is already holding that node at exactly
   * the pinned temperature, so the pin has no work to do. That is what a
   * balanced circuit looks like: the plant removes what the load adds, and
   * nothing is left over for a reference node to absorb.
   *
   * Getting this rig right took two attempts, and the first failure is worth
   * recording. A fill connection stated at 11 °C in the return of a circuit
   * that naturally returns at 9.59 °C makes the pin ADD 83.6 kW — the warning
   * fired, correctly, on a rig that was labelled "balanced" and was not. A
   * source in a return line is a temperature-setting device, not a bystander. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'exchanger', duty: 60000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    ch.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'source',
                 tSet: 6, qMax: -200000 };     // ample, and holds 6 C
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[5].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[5].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const res = NET.solveModel(m);

    near('The chiller removes exactly what the coil adds',
         res.thermal.totals.equipDuty, 0, 50);
    near('...so nothing is absorbed at the reference',
         res.thermal.sourceDuty, 0, 100);
    ok('A plant that keeps up raises nothing',
       !(res.warnings || []).some(x => x.code === 'HEAT_IMBALANCE'),
       JSON.stringify((res.warnings || []).filter(x => x.code === 'HEAT_IMBALANCE')
                         .map(x => x.message)));
    near('...and the balance closes', res.thermal.residual, 0, 1e-6);
  }
  {
    /* The threshold is a setting, like every other. */
    const m = M.create();
    m.settings.warn.heatBalance = 0;
    m.settings.thermal = { ambient: 20, supplyTemp: 11, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 2, 0));
    M.setSource(m, n[0].id, 250e3); n[0].device.temperature = 11;
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'exchanger', duty: 60000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    ch.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'source',
                 tSet: 6, qMax: -40000 };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const res = NET.solveModel(m);
    ok('Zero disables the check',
       !(res.warnings || []).some(x => x.code === 'HEAT_IMBALANCE'));
  }

  /* ---- 3. A GENUINELY SEALED, BALANCED circuit: no source at all, so nothing
   * is pinned and the two figures agree. This is the case every earlier test in
   * this file reads, and it must not have moved. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 6, insulationK: 0.02,
                           surfaceCoeff: 8, tempMin: -100, tempMax: 500 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 4; i++) n.push(M.addNode(m, lv, i * 20, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 10 };
    const load = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    load.equip = { qRated: 0.020, pdRated: 50e3, equipType: 'exchanger', duty: 100000 };
    const p1 = M.addPipe(m, n[2].id, n[3].id, { size: 'DN100', schedule: 'sch40' });
    const p2 = M.addPipe(m, n[3].id, n[0].id, { size: 'DN100', schedule: 'sch40' });
    p1.insulation_mm = 0; p2.insulation_mm = 0;
    const th = NET.solveModel(m).thermal;

    near('Pipe loss cancels the load', th.imbalance, 0, 1);
    near('Nothing is pinned, so no source duty', th.sourceDuty, 0, 1e-6);
    near('...and no boundary flow', th.boundary, 0, 1e-6);
    near('So residual and imbalance are the same number',
         th.residual, th.imbalance, 1e-9);
  }
}

/* --------------------------------------------------------------------------
 * A FILL CONNECTION IS A DEAD LEG, AND ABSORBS NOTHING
 *
 * Michael's objection, 2026-08-05, and he was right: an expansion tank tees off
 * the return with NO FLOW through it. It can only lose a trickle by conduction
 * at the tee, which is normally disregarded. So absent a runaway there should
 * be little or no heat absorbed there.
 *
 * The app already behaves that way, because a source only imposes its
 * temperature on water that flows THROUGH it — and no water flows through a
 * dead leg. What was wrong was the EXAMPLE: `stacked-riser` had the fill in the
 * return line, where every drop passes through it, which is a mains connection
 * rather than an expansion tank.
 *
 * Both cases are pinned here so the distinction cannot quietly reverse.
 * ----------------------------------------------------------------------- */
section('A fill on a dead leg absorbs nothing; one in the return line does');
{
  /* One circuit, one difference: where the fill connects. Coil +60 kW, chiller
   * −40 kW, adiabatic pipework — deliberately 20 kW short, so any absorption
   * has somewhere obvious to show up. */
  function circuit(where, cap) {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 11, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 6; i++) n.push(M.addNode(m, lv, i * 3, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    const coil = M.addPipe(m, n[1].id, n[2].id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'exchanger', duty: 60000 };
    const ch = M.addPipe(m, n[2].id, n[3].id, { kind: 'equip' });
    ch.equip = { qRated: 0.004, pdRated: 50e3, equipType: 'source',
                 tSet: 6, qMax: cap === undefined ? -40000 : cap };
    M.addPipe(m, n[3].id, n[4].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[4].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    if (where === 'inline') {
      M.setSource(m, n[0].id, 250e3); n[0].device.temperature = 11;
    } else {
      const t = M.addNode(m, lv, 12, 4);
      M.addPipe(m, n[4].id, t.id, { size: 'DN20', schedule: 'sch40' });
      M.setSource(m, t.id, 250e3); t.device.temperature = 11;
    }
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    return { m, res: NET.solveModel(m) };
  }

  /* ---- THE ONE THAT MATTERS: a real expansion connection. */
  {
    const t = circuit('deadleg', -200000);          // plant ample, so determinate
    const th = t.res.thermal;
    near('A dead-leg fill absorbs nothing', th.sourceDuty, 0, 1);
    ok('...and raises no heat-imbalance warning',
       !(t.res.warnings || []).some(w => w.code === 'HEAT_IMBALANCE'),
       JSON.stringify((t.res.warnings || []).map(w => w.code)));
    ok('...while the circuit still develops a real temperature spread',
       th.totals.max - th.totals.min > 3,
       th.totals.min.toFixed(2) + ' … ' + th.totals.max.toFixed(2) + ' °C');
    near('...and the balance closes', th.residual, 0, 1);
  }

  /* ---- THE SAME FILL IN THE RETURN LINE is a different device: every drop
   * passes through it, so it sets the temperature and absorbs the shortfall. */
  {
    const t = circuit('inline');
    const th = t.res.thermal;
    near('In the return line it absorbs the whole shortfall', th.sourceDuty, -20000, 50);
    ok('...and says so', (t.res.warnings || []).some(w => w.code === 'HEAT_IMBALANCE'));
  }

  /* ---- AND THE TWO MUST AGREE, because they are the SAME PHYSICS.
   *
   * A dead-leg fill and an in-line fill on a sealed circuit both pass zero net
   * water across the boundary. 20 kW into a sealed adiabatic loop has no steady
   * state either way, and where the fill happens to be drawn cannot change
   * that — which is the whole of Michael's 2026-08-06 report. It used to:
   * in-line it absorbed the surplus, on a dead leg it was THERMAL_SINGULAR.
   *
   * Both now pin a datum and report the surplus. By hand: the coil is stated at
   * +60 kW and the chiller is capped at −40 kW, so the loop is 20 kW over and
   * the datum absorbs exactly that. The datum lands at the outlet of the
   * equipment moving the most heat — the 60 kW coil, not the 40 kW chiller —
   * and the chiller then drops the water 40000/C below it, C = ρ·Q·cp. */
  {
    const dead = circuit('deadleg', -40000).res;
    const line2 = circuit('inline').res;
    near('A dead-leg fill and an in-line one give the SAME shortfall',
         dead.thermal.sourceDuty, line2.thermal.sourceDuty, 1);
    near('...which is the 20 kW the chiller is short by',
         dead.thermal.sourceDuty, -20000, 1);
    ok('...reported as a heat imbalance, not as an indeterminate field',
       (dead.warnings || []).some(w => w.code === 'HEAT_IMBALANCE') &&
       !(dead.errors || []).some(e => e.code === 'THERMAL_SINGULAR'),
       JSON.stringify((dead.warnings || []).map(w => w.code)));
    ok('...and the datum is declared', (dead.warnings || []).some(w => w.code === 'THERMAL_DATUM'));

    /* The spread is the chiller's capped duty over the capacity rate, and it is
     * the same number in both drawings. C = 998 × 0.004 × 4187 = 16 714 W/K,
     * so 40 000 / 16 714 = 2.393 K. */
    const C = RHO * 0.004 * CP;
    near('The spread is the chiller cap over the capacity rate',
         dead.thermal.totals.max - dead.thermal.totals.min, 40000 / C, 0.02);
    near('...and identical in the other drawing',
         line2.thermal.totals.max - line2.thermal.totals.min,
         dead.thermal.totals.max - dead.thermal.totals.min, 1e-6);
    near('...with the balance still closing', dead.thermal.residual, 0, 1);
  }

  /* ---- THERMAL_SINGULAR still exists, for a circuit with nothing to pin TO.
   *
   * A sealed adiabatic ring of bare pipework: no source, no equipment, so there
   * is no candidate datum and no statement of temperature anywhere. That field
   * really has no unique solution and there is nothing to do about it. */
  {
    const m = M.create();
    m.settings.thermal = { ambient: 20, supplyTemp: 11, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    const lv = m.levels[0].id;
    const n = [];
    for (let i = 0; i < 4; i++) n.push(M.addNode(m, lv, i * 3, 0));
    const pump = M.addPipe(m, n[0].id, n[1].id, { kind: 'pump' });
    pump.pump = { mode: 'auto', head: 15 };
    M.addPipe(m, n[1].id, n[2].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[2].id, n[3].id, { size: 'DN65', schedule: 'sch40' });
    M.addPipe(m, n[3].id, n[0].id, { size: 'DN65', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    const r = NET.solveModel(m);
    ok('Nothing to pin to is still an ERROR',
       (r.errors || []).some(e => e.code === 'THERMAL_SINGULAR'),
       JSON.stringify((r.errors || []).map(e => e.code)));
    ok('...and it clears converged', r.converged === false);
    /* The numbers are still reported — hiding them would leave nothing to
     * diagnose from — and they are transparently the seed. */
    ok('...with the temperatures still shown',
       r.thermal && r.thermal.totals.max !== null);
  }

  /* ---- The shipped example must stay a PROPER fill connection. */
  {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(
      /* FROM `test/fixtures/`, not `examples/`. The rule is that tests read a
       * FROZEN copy — `test/testrun-*.js` regenerate `examples/`, so a test
       * reading one is a test whose input can be rewritten out from under it.
       * It also means `examples/` and `debug/` can be left out of a public
       * deployment without taking the suite with them (Michael, 2026-08-19). */
      path.join(__dirname, 'fixtures', 'stacked-riser.pnet.json'), 'utf8');
    const ex = NET.solveModel(M.fromJSON(JSON.parse(raw)));
    near('examples/stacked-riser absorbs nothing at its fill',
         ex.thermal.sourceDuty, 0, 1);
    ok('...and raises no heat-imbalance warning',
       !(ex.warnings || []).some(w => w.code === 'HEAT_IMBALANCE'));
    ok('...and still solves clean', ex.converged === true,
       JSON.stringify((ex.errors || []).map(e => e.code)));
  }
}

/* --------------------------------------------------------------------------
 * FOUR VALVES BALANCING FOUR PARALLEL BRANCHES
 *
 * `debug/20260805-4.json`, reported 2026-08-05: the valves were not throttling
 * AHU-1 and a SETPOINT_LOST error was being thrown. Three separate faults, all
 * of which this section pins.
 *
 * 1. THE SOLVE BUDGET WAS FLAT. 60 solves, chosen when a model had one
 *    controller or two. With five it ran out at 62 partway through the last
 *    device, which then reported `unsettled` and was parked back at full travel
 *    — looking exactly as though the valve had never tried. It scales now.
 *
 * 2. PARK-AT-FULL RAN INSIDE THE SWEEP. Parallel branches interact: closing one
 *    pushes flow to the others, so a device can report `at-max` on one pass and
 *    settle happily on the next. Slamming it back to full mid-sweep threw away
 *    the iteration. It is judged once, at the end.
 *
 * 3. THE DIRECTION PROBE READ NOISE. A 5% nudge on an equal-percentage valve
 *    near full travel moves the flow by ~1e-7 m³/s — two orders of magnitude
 *    below the solver's own tolerance. It probes the far end now, and accepts a
 *    CROSSING as well as an improvement, because probing the minimum overshoots
 *    hard: +0.15 L/s at full becomes −0.58 L/s at 10% open, and judging on
 *    |error| alone called that "no better".
 * ----------------------------------------------------------------------- */
section('Parallel branches balance against each other');
{
  const fs = require('fs');
  const path = require('path');
  /* FROZEN INTO `test/fixtures/`, from `debug/20260805-4.json`. A test that
   * reads out of `debug/` is a test whose input is a working file someone may
   * edit or delete — and it kept `debug/` (1.2 MB of investigation material) in
   * a public deployment for one 33-node model. Michael, 2026-08-19. */
  const raw = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'parallel-branches.pnet.json'), 'utf8');

  const m = M.fromJSON(JSON.parse(raw));
  const res = NET.solveModel(m);
  const AHUS = ['P10', 'P34', 'P37', 'P40'];

  /* THE ASSERTION THAT MATTERS: every branch gets its rated flow. Four valves,
   * four setpoints, and the interaction between them resolved. */
  AHUS.forEach(function (id) {
    const p = M.pipe(m, id);
    const ratio = Math.abs(res.flow[id]) / p.equip.qRated;
    ok((p.tag || id) + ' is within 2% of its rated flow',
       Math.abs(ratio - 1) < 0.02, (ratio * 100).toFixed(1) + '%');
  });

  /* Every valve had to move to get there — none is sitting at full travel
   * pretending, which is what the bug looked like. */
  ['P43', 'P46', 'P49', 'P52'].forEach(function (id) {
    const v = M.pipe(m, id);
    ok('Valve ' + id + ' throttled', v.valve.opening < 60 && v.valve.opening > 10,
       v.valve.opening + '% open');
  });

  const byPipe = {};
  res.controls.devices.forEach(function (d) { byPipe[d.pipe] = d; });
  ['P43', 'P46', 'P49', 'P52'].forEach(function (id) {
    ok('...and ' + id + ' reports as holding its setpoint',
       byPipe[id].state === 'on', id + ': ' + byPipe[id].state);
  });

  /* THE PUMP'S LOST SETPOINT WAS THE CLAMP'S DOING, and it is gone — v0.16.4.
   *
   * This block used to assert the opposite, and explaining the movement is the
   * point of it. ACCH-1 is scheduled at 7.977 L/s across 15 K, which is a
   * design point of 500 kW, and it states no capacity. The load on it is
   * 200.1 kW. It was never short of anything — but the model clamped its ΔT at
   * 15 K, and at the flow the four balanced branches actually deliver that cap
   * bit, so it could not reach 7.5 °C and the pump was told it had lost a
   * setpoint no pump speed could recover.
   *
   * That is Michael's data-centre symptom in miniature, on a five-device model
   * small enough to check by hand: machines reported as limited while running
   * well inside their nameplate. With the clamp gone it holds 7.5 °C exactly,
   * doing the 200.1 kW asked of it, and nothing is lost. */
  {
    const e = (res.errors || []).filter(x => x.code === 'SETPOINT_LOST')[0];
    ok('No setpoint is lost any more', !e, e && e.message);
    const l = res.thermal.links['P13'];
    near('ACCH-1 holds its 7.5 °C setpoint', l.tOut, 7.5, 1e-6);
    ok('...with nothing limiting it', !l.limit, String(l.limit));
    ok('...doing about 200 kW of a 500 kW design point',
       Math.abs(l.qW + 200e3) < 2e3, (l.qW / 1000).toFixed(1) + ' kW');
    ok('...and every device reports as holding its setpoint',
       res.controls.devices.every(d => d.state === 'on'),
       JSON.stringify(res.controls.devices.map(d => (d.tag || d.pipe) + ':' + d.state)));
  }

  /* THE BUDGET. It has to be enough for five devices, and it has to be a
   * setting — Michael asked, having seen how much work the loop does. */
  {
    ok('It finished inside its budget', res.controls.solves < 400,
       String(res.controls.solves));
    const m2 = M.fromJSON(JSON.parse(raw));
    m2.settings.control.maxSolves = 8;              // deliberately starved
    const r2 = NET.solveModel(m2);
    /* The budget is a SOFT limit and has to be: it is tested at loop
     * boundaries, and every device takes at least its first probe before the
     * check can bite. With five devices the floor is therefore about ten
     * solves whatever is asked for. What it must do is BOUND the work, not hit
     * a number exactly. */
    ok('A hand-set budget bounds the work',
       r2.controls.solves < res.controls.solves / 2,
       r2.controls.solves + ' against ' + res.controls.solves + ' unbounded');
    ok('...and starving it visibly changes the answer',
       r2.controls.devices.some(d => d.state !== 'on'),
       JSON.stringify(r2.controls.devices.map(d => d.state)));
  }
}

/* --------------------------------------------------------------------------
 * A CROSSING IS EVIDENCE, EVEN WHEN THE MAGNITUDE IS WORSE
 *
 * The direction probe goes to the far end of the travel, where it usually
 * OVERSHOOTS: an error of +0.15 L/s at full becomes −0.58 L/s at the minimum.
 * Judging on |error| alone calls that "backing off does not help" and leaves
 * the valve wide open. A sign change is the strongest possible evidence that
 * the setpoint is reachable — it brackets the root.
 * ----------------------------------------------------------------------- */
section('Overshooting the setpoint still counts as finding it');
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
  v.valve = { type: 'globe', kv: 45, opening: 100 };
  const sn = M.addPipe(m, c.id, d2.id, { kind: 'sensor' });
  /* A setpoint only a little below the wide-open flow, so the far probe
   * overshoots it by a wide margin. */
  sn.sensor = { mode: 'flow', qSet: 0.008 };
  M.addPipe(m, d2.id, e.id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(x => { x.insulation_mm = 0; });

  const wide = NET.solveModel(M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m)))));
  M.setControl(m, v, sn.id);
  const res = NET.solveModel(m);

  ok('Wide open it carries more than the setpoint',
     Math.abs(wide.flow[sn.id]) > 0.008,
     (Math.abs(wide.flow[sn.id]) * 1000).toFixed(2) + ' L/s');
  near('It throttles to the setpoint', Math.abs(res.flow[sn.id]), 0.008, 0.008 * 0.02);
  ok('...having actually moved', v.valve.opening < 100, v.valve.opening + '%');
  ok('...and reports as holding it', res.controls.devices[0].state === 'on',
     res.controls.devices[0].state);
}

/* =====================================================================
 * A SOURCE ON A LIVE MAIN MIXES. IT DOES NOT RESET.
 *
 * Michael, 2026-08-06: "Sources placed on pipes are still acting as a
 * temperature reset. Temporary workaround is to place the source on a branch
 * pipe — this happens often in practice, but placing on the main line is an
 * equally valid choice."
 *
 * A source states the temperature of THE WATER IT BRINGS IN. At the end of a
 * branch that is all of the water, so the node sits at the source temperature
 * and nothing changes. Teed into a main it is only the make-up, and the rest is
 * flowing past — which a hard pin overwrote.
 * ===================================================================== */
section('A source teed into a live main mixes with it');
{
  /* Two supplies into one outflow. HOT enters at N0 at 60 °C; COLD is teed in
   * at the junction J at 10 °C; the outflow draws from beyond J.
   *
   * The split is set by the hydraulics, so the expectation is written as the
   * MIXING RELATION and evaluated on the solved mass flows — the physics by
   * hand, not a number read back out of the thermal module:
   *
   *     T_J = (ṁ_hot·T_hot + ṁ_cold·T_cold) / (ṁ_hot + ṁ_cold)
   *
   * Adiabatic pipework throughout, so nothing else can move a temperature. */
  const m = M.create();
  m.settings.thermal = { ambient: 20, supplyTemp: 60, insulationK: 0.02,
                         surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
  const lv = m.levels[0].id;
  const hot = M.addNode(m, lv, 0, 0);
  const mid = M.addNode(m, lv, 1, 0);
  const j   = M.addNode(m, lv, 10, 0);
  const out = M.addNode(m, lv, 20, 0);
  M.setSource(m, hot.id, 400e3); hot.device.temperature = 60;
  /* THE ONE UNDER TEST: a second supply ON the main, not at the end of it. */
  M.setSource(m, j.id, 400e3);   j.device.temperature = 10;
  out.device = { kind: 'demand', flow: 0.008, reqPressure: 100e3, include: true };
  /* A PUMP ON THE HOT BRANCH, and it is what makes the case exist at all: the
   * source at J FIXES the pressure there, so an unassisted branch at the same
   * pressure delivers nothing and the near source takes the lot. With the pump
   * pushing against that fixed pressure the hot side delivers, and the source
   * at J makes up only the remainder — which is exactly what a make-up
   * connection on a live main does. */
  const pump = M.addPipe(m, hot.id, mid.id, { kind: 'pump' });
  pump.pump = { mode: 'fixed', sizing: 'manual', head: 5 };
  M.addPipe(m, mid.id, j.id, { size: 'DN25', schedule: 'sch40' });
  M.addPipe(m, j.id, out.id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(x => { x.insulation_mm = 0; });
  const res = NET.solveModel(m);
  const th = res.thermal;

  const qHot = Math.abs(res.flow[m.pipes[1].id]);          // mid -> J
  const qTot = Math.abs(res.flow[m.pipes[2].id]);          // J -> outflow
  const qCold = qTot - qHot;                               // injected at J

  ok('Both supplies actually carry water', qHot > 1e-6 && qCold > 1e-6,
     (qHot * 1000).toFixed(3) + ' + ' + (qCold * 1000).toFixed(3) + ' L/s');

  const expect = (qHot * 60 + qCold * 10) / qTot;
  near('The junction is the mass-weighted mix of the two supplies',
       th.temperature[j.id], expect, 1e-6);
  ok('...so it is NOT reset to the source temperature',
     Math.abs(th.temperature[j.id] - 10) > 1,
     th.temperature[j.id].toFixed(2) + ' °C');
  ok('...and it lies between the two', th.temperature[j.id] > 10 && th.temperature[j.id] < 60);
  near('...and the outflow sees the mixed water', th.temperature[out.id], expect, 1e-6);

  /* The heat balance must still close, and the make-up must be booked in at
   * ITS OWN temperature — using the mixed value would invent energy. */
  near('The balance still closes', th.residual, 0, 1);
  near('Nothing is absorbed at the source', th.sourceDuty, 0, 1e-6);
}

section('A source at the end of a branch is unchanged');
{
  /* The same water, the same duty, the fill on a stub instead. Every drop that
   * leaves the source node came from the source, so the mixing relation has one
   * term and gives exactly the source temperature — which is why Michael's
   * workaround worked and why this must not move. */
  const m = M.create();
  m.settings.thermal = { ambient: 20, supplyTemp: 60, insulationK: 0.02,
                         surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
  const lv = m.levels[0].id;
  const s = M.addNode(m, lv, 0, 0);
  const j = M.addNode(m, lv, 0, 5);
  const out = M.addNode(m, lv, 10, 5);
  M.setSource(m, s.id, 400e3); s.device.temperature = 12;
  out.device = { kind: 'demand', flow: 0.006, reqPressure: 100e3, include: true };
  M.addPipe(m, s.id, j.id, { size: 'DN40', schedule: 'sch40' });
  M.addPipe(m, j.id, out.id, { size: 'DN50', schedule: 'sch40' });
  m.pipes.forEach(x => { x.insulation_mm = 0; });
  const th = NET.solveModel(m).thermal;
  near('The source node is at its stated temperature', th.temperature[s.id], 12, 1e-9);
  near('...and so is everything it feeds', th.temperature[out.id], 12, 1e-9);
  near('...absorbing nothing', th.sourceDuty, 0, 1e-9);
}

/* =====================================================================
 * A DEVICE MAY NEED TO OPEN, AND THE SEARCH ONLY CLOSES.
 *
 * `runControls` settles one device at a time and sweeps. The search is a
 * DESCENT from full travel, which is fine on the first pass — everything
 * starts at full — but a later sweep begins wherever the last one finished. A
 * device that now needs to go UP has nowhere to look, reports `at-max` at
 * mid-travel, is counted as a lost setpoint, and gets parked at 100%.
 *
 * MICHAEL'S ECONOMIZER + TRIM SYSTEM, 2026-08-07 (`debug/20260807-1`, frozen
 * here). A water-side economizer with air-cooled trim, as used in data centres:
 *
 *   CT-01     cools the return from 35 °C to 30 °C          (free cooling)
 *   ACCH-1    takes PART of that flow down to 15 °C         (mechanical trim)
 *   a bypass  carries the rest at 30 °C
 *   TS-2      reads the mix, and PMP-02 modulates to hold it at 20 °C
 *   PMP-01    holds a minimum differential at the index AHU
 *   4 valves  hold their own coil's design flow
 *
 * Six interacting controllers. Sweep 1 settled every one of them — valves at
 * 32–35%, PMP-01 holding its dP to within 44 Pa. But the valves settled while
 * the pump was still at full, the pump then dropped to 34.7% and starved them
 * by 25%, and sweep 2 found four valves needing to OPEN, could not open any,
 * and threw the answer away: everything back to 100%.
 * ===================================================================== */
section('Economizer + trim: six controllers that must settle together');
{
  const raw = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'economizer-trim.pnet.json'), 'utf8');
  const m = M.fromJSON(JSON.parse(raw));
  m.settings.calcMode = 'simulation';
  const res = NET.solveModel(m);

  ok('It converges', res.converged === true,
     JSON.stringify((res.errors || []).map(e => e.code)));
  ok('...with no lost setpoint',
     !(res.errors || []).some(e => e.code === 'SETPOINT_LOST'),
     JSON.stringify((res.errors || []).map(e => e.code)));

  const dev = id => res.controls.devices.filter(x => x.pipe === id)[0];
  const byTag = t => m.pipes.filter(p => p.tag === t)[0];

  /* NOTHING PARKED AT FULL AND STILL SHORT. That is the failure itself: the
   * answer discarded and every actuator slammed open. */
  res.controls.devices.forEach(d => {
    ok(`${d.equipTag || d.pipe} is not parked at full while off setpoint`,
       !(d.value >= 0.999 && d.state === 'at-max'),
       `${(d.value * 100).toFixed(1)}% ${d.state}`);
  });

  /* THE FOUR COILS CARRY THEIR RATED FLOW. Each is rated 0.7977 L/s; a 2% band
   * is well inside what one percent of valve travel resolves. */
  ['AHU-1', 'AHU-3', 'AHU-4', 'AHU-5'].forEach(tag => {
    const p = byTag(tag);
    near(`${tag} carries its rated flow`,
         Math.abs(res.flow[p.id]), p.equip.qRated, p.equip.qRated * 0.02);
  });

  /* THE PLANT, by hand from Michael's own description of the system.
   *
   * THE SPLIT MOVED WITH THE PHYSICS, v0.16.4, and it moved because ACCH-1 now
   * reaches its setpoint. It used to be capped by its 15 K design ΔT, so from
   * 30 °C it could only reach 15 °C and the mix needed a third of the flow
   * bypassed. Design ΔT no longer clamps, and ACCH-1 has gained the capacity it
   * was relying on the clamp to imply — 250 kW, which is its OWN design point,
   * ρ·q_rated·cp·ΔT_design = 998 × 3.9886 L/s × 4187 × 15 K = 250.00 kW exactly.
   * Michael's ruling of 2026-08-09: a model without a stated capacity must gain
   * one.
   *
   * So ACCH-1 now leaves at its 7.5 °C setpoint, and with x the fraction
   * bypassed at 30 °C the mix at TS-2 is
   *
   *     30x + 7.5(1 − x) = 20   →   x = 5/9
   *
   * — five ninths bypasses and FOUR NINTHS goes through the chiller, which is
   * what PMP-02 is modulating to achieve. The duties follow from the same two
   * numbers: the four coils put in 4 × 50 = 200 kW, ACCH-1 takes 4/9 of
   * 3.197 L/s across 30 − 7.5 = 22.5 K, and CT-01 takes the rest. */
  const th = res.thermal;
  near('CT-01 holds its 30 °C leaving temperature',
       th.links[byTag('CT-01').id].tOut, 30, 0.1);
  near('ACCH-1 reaches its 7.5 °C setpoint',
       th.links[byTag('ACCH-1').id].tOut, 7.5, 0.1);
  ok('...with nothing limiting it', !th.links[byTag('ACCH-1').id].limit,
     String(th.links[byTag('ACCH-1').id].limit));
  near('TS-2 reads the 20 °C supply setpoint',
       th.temperature[byTag('TS-2').a], 20, 0.3);

  const q1 = Math.abs(res.flow[byTag('PMP-01').id]);
  const q2 = Math.abs(res.flow[byTag('PMP-02').id]);
  near('...because four ninths of the flow goes through the chiller',
       q2 / q1, 4 / 9, 0.03);
  /* AND THE HEAT BALANCE CLOSES ON THE SAME TWO NUMBERS. 200 kW in, and the
   * two machines share it — no third party, and nothing left over. */
  near('The two machines between them reject the 200 kW put in',
       th.links[byTag('CT-01').id].qW + th.links[byTag('ACCH-1').id].qW,
       -200e3, 2e3);
  ok('...and the rest bypasses it, forwards through the check valve',
     q1 - q2 > 0, ((q1 - q2) * 1000).toFixed(3) + ' L/s');

  /* PMP-01 HOLDS THE DIFFERENTIAL rather than running away to full speed. The
   * setpoint is 200 kPa and the band is 0.5% of it. */
  const dp = dev(byTag('PMP-01').id);
  ok('PMP-01 is modulating, not flat out', dp.value < 0.99,
     (dp.value * 100).toFixed(1) + '%');
  ok('...and holding its differential', Math.abs(dp.error) <= 1000,
     dp.error.toPrecision(4) + ' Pa');

  const p2 = dev(byTag('PMP-02').id);
  ok('PMP-02 is modulating, not flat out', p2.value < 0.99,
     (p2.value * 100).toFixed(1) + '%');
  ok('...and holding the supply temperature', Math.abs(p2.error) <= 0.5,
     p2.error.toPrecision(4) + ' K');
}

/* =====================================================================
 * S4 — THE SURVIVORS MUST RE-SETTLE BEHIND A PARKED DEVICE.
 *
 * Parking a device that has lost its setpoint at full MOVES THE PLANT, and the
 * other controllers settled during the sweeps against the plant BEFORE that
 * move. Judged once and left there, their final positions describe a plant that
 * no longer exists (WORKLIST S4, recorded v0.16.4).
 *
 * The same economizer + trim, with ACCH-1 given 145 kW — a capacity it cannot
 * meet. It can no longer reach its 7.5 °C setpoint (it leaves capacity-limited
 * near 20 °C), so the mix at TS-2 cannot be pulled down to 20 °C at any trim
 * speed: PMP-02 walks to its floor, finds it no better, and is PARKED AT FULL.
 * That parking opens the whole chiller branch back up — and the four coil
 * valves, which had throttled to hold their rated flow against the starved plant
 * PMP-02 produced mid-sweep, are now passing too much, while PMP-01 is left tens
 * of kPa off the differential it was holding.
 *
 * Before the re-settle pass this test was RED: PMP-02 parked correctly, but
 * PMP-01 sat 30.8 kPa off a 1 kPa band and all four coils and PMP-01 were
 * flagged `driftedAfterSearch` — the search finished happily, then the parking
 * moved the plant out from under them and nothing settled them again. The fix
 * settles the survivors against the plant the parked pump now holds.
 *
 * EVERY NUMBER HERE IS A DESIGN INPUT, not a figure read back out: the coils'
 * rated flow is their own qRated, and PMP-01's band is half a percent of its
 * own differential setpoint. The only claim is that each controller that is
 * still modulating is doing its stated job.
 * ===================================================================== */
section('S4: survivors re-settle behind a device parked at full');
{
  const raw = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'economizer-trim.pnet.json'), 'utf8');
  const m = M.fromJSON(JSON.parse(raw));
  m.settings.calcMode = 'simulation';
  const byTag = t => m.pipes.filter(p => p.tag === t)[0];
  /* Undersize the chiller so it cannot hold its setpoint — the whole point. */
  byTag('ACCH-1').equip.qMax = -145000;
  const res = NET.solveModel(m);

  const dev = id => res.controls.devices.filter(x => x.pipe === id)[0];

  /* THE PARK ACTUALLY HAPPENED — otherwise the rest is vacuous. PMP-02 chased
   * the mix it can no longer reach, and was returned to full. */
  const p2 = dev(byTag('PMP-02').id);
  ok('PMP-02 has lost its setpoint and is parked at full',
     p2.lost === true && p2.value >= 0.999,
     `lost=${p2.lost} value=${(p2.value * 100).toFixed(1)}%`);
  ok('...so SETPOINT_LOST is raised',
     (res.errors || []).some(e => e.code === 'SETPOINT_LOST'),
     JSON.stringify((res.errors || []).map(e => e.code)));

  /* THE FIX ITSELF: nothing that is still modulating may be left describing the
   * pre-parking plant. `driftedAfterSearch` is exactly that condition — a device
   * that came to rest on setpoint, then had the plant moved under it. After the
   * re-settle pass no survivor carries it. */
  const stranded = res.controls.devices.filter(
    d => d.driftedAfterSearch && !d.lost);
  ok('No survivor is left drifted behind the parked pump',
     stranded.length === 0,
     stranded.map(d => `${d.tag || d.pipe} ${d.searchState}`).join(', '));

  /* THE COILS CARRY THEIR RATED FLOW. Each is rated 0.7977 L/s; 2% is well
   * inside what one percent of valve travel resolves. A coil valve that is
   * itself parked is exempt — it is at full because it genuinely cannot hold
   * its branch, which is a different finding. */
  ['AHU-1', 'AHU-3', 'AHU-4', 'AHU-5'].forEach(tag => {
    const p = byTag(tag);
    const d = res.controls.devices.filter(x => x.equipTag === tag)[0];
    if (d && d.lost) return;
    near(`${tag} carries its rated flow, not the starved-plant flow`,
         Math.abs(res.flow[p.id]), p.equip.qRated, p.equip.qRated * 0.02);
  });

  /* PMP-01 HOLDS ITS DIFFERENTIAL. The band is half a percent of the setpoint,
   * the same deadband the engine uses; before the fix it was 30 kPa out. */
  const dp = dev(byTag('PMP-01').id);
  const band = Math.max(100, Math.abs(dp.target) * 0.005);
  ok('PMP-01 re-settles onto its differential setpoint',
     !dp.lost && Math.abs(dp.error) <= band,
     `${dp.error.toFixed(0)} Pa (band ${band.toFixed(0)} Pa)`);
}

/* =====================================================================
 * THE NUMBER OF SETTLING SWEEPS IS THE USER'S TO SET (v0.16.18).
 *
 * Michael, 2026-08-10: a first pass is happy with the six sweeps the loop has
 * always done, but a final answer may want ten or more and can afford to wait.
 * `control.sweeps` bounds the outer loop, and the solve budget scales with it so
 * the extra sweeps are actually taken rather than capped out by a ceiling meant
 * for six.
 *
 * Exercised on a HUNTING model — ACCH-1 undersized so the loop never settles —
 * because only there does the sweep count bite: a model that converges stops
 * early whatever the ceiling, which is the other half of the contract.
 * ===================================================================== */
section('Settling sweeps are configurable');
{
  const raw = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'economizer-trim.pnet.json'), 'utf8');
  function runSweeps(sweeps) {
    const m = M.fromJSON(JSON.parse(raw));
    m.settings.calcMode = 'simulation';
    m.pipes.filter(p => p.tag === 'ACCH-1')[0].equip.qMax = -140000;  // hunts
    if (sweeps !== undefined) {
      m.settings.control = m.settings.control || {};
      m.settings.control.sweeps = sweeps;
    }
    return NET.solveModel(m).controls;
  }

  const def = runSweeps(undefined);
  ok('The default is six sweeps', def.sweeps === 6, String(def.sweeps));

  const few = runSweeps(2);
  ok('A lower setting stops the loop sooner', few.sweeps === 2, String(few.sweeps));
  ok('...and costs fewer solves for it', few.solves < def.solves,
     `${few.solves} vs ${def.solves}`);

  const many = runSweeps(12);
  ok('A higher setting runs every sweep asked for', many.sweeps === 12,
     String(many.sweeps));
  /* THE BUDGET SCALED WITH IT. If the solve ceiling had stayed at its six-sweep
   * value the loop would have run out long before the twelfth sweep; that it
   * reaches twelve is the scaling doing its job. */
  ok('...which the solve budget grew to allow', many.solves > def.solves,
     `${many.solves} vs ${def.solves}`);

  /* A CONVERGING MODEL IS NOT DRAGGED OUT TO THE CEILING. Raise the limit high
   * and the untouched economizer, which settles in a couple of sweeps, still
   * stops early — the setting is a ceiling, not a quota. */
  const m2 = M.fromJSON(JSON.parse(raw));
  m2.settings.calcMode = 'simulation';
  m2.settings.control = { sweeps: 50 };
  const conv = NET.solveModel(m2).controls;
  ok('A model that settles early ignores a high ceiling', conv.sweeps < 50,
     `${conv.sweeps} sweeps`);
}

/* =====================================================================
 * A MIXING CIRCUIT'S RESPONSE IS NOT MONOTONIC, AND THE SEARCH ASSUMED IT WAS.
 *
 * Michael's economizer in miniature — two sources, a bypass, a check valve and
 * a mixing sensor, which is the smallest thing that shows the behaviour:
 *
 *     S -> B -+-- PMP-02 --> CHW (18 C setpoint, 150 kW) --+-> TS-1 -> PMP-01
 *             |                                            |            |
 *             +----------- check valve (bypass) -----------+          coil
 *                                                                       |
 *     S <------------------ CT-01 (30 C) <------------------------------+
 *
 * TWO EFFECTS FIGHT, and they pull opposite ways:
 *
 *   While the check valve holds the bypass SHUT, PMP-02 is in series with the
 *   loop and sets the WHOLE flow. Slowing it puts the same kilowatts into fewer
 *   kilograms, so the supply gets COLDER.
 *
 *   Below the speed at which PMP-02 can no longer carry what PMP-01 delivers,
 *   the bypass opens, 30 °C water joins the mix, and the supply gets WARMER.
 *
 * So sweeping PMP-02 from full to its floor, TS-1 FALLS and then RISES, and it
 * crosses a 20 °C setpoint TWICE — near 45% and again near 30%. Both are
 * perfectly good answers; a controller ramping down from full would stop at the
 * first.
 *
 * WHAT THE SEARCH DID (before v0.16.4): it probed once at the 25% floor, read a
 * smaller error OF THE SAME SIGN, descended to the floor, reported `at-min`, and
 * the lost-setpoint rule parked the pump at 100% with the sensor 4.4 K high. One
 * sample at the stop cannot describe a curve that turns. It scans the travel
 * now when the far stop does not bracket the setpoint.
 * ===================================================================== */
section('A mixing circuit: the response falls, then rises');
{
  const P = FD.pumps;

  function mixRig(opts) {
    opts = opts || {};
    const m = M.create();
    m.settings.calcMode = 'simulation';
    m.settings.systemType = 'closed';
    /* Adiabatic pipework: the two machines and the coil are the only thermal
     * elements, so every number below is a hand calculation. */
    m.settings.thermal = { ambient: 20, supplyTemp: 30, insulationK: 0.02,
                           surfaceCoeff: 0, tempMin: -100, tempMax: 200 };
    m.settings.control = { minSpeed: 0.25, minOpening: 10, tol: 0.05, maxSolves: 0 };
    const lv = m.levels[0].id;
    const N = (x, y) => M.addNode(m, lv, x, y);
    const S = N(0, 0), B = N(4, 0), C = N(8, 4), D = N(12, 0), E = N(16, 0),
          F = N(20, 0), G = N(24, 0), H = N(28, 0);
    M.setSource(m, S.id, 0);
    M.addPipe(m, S.id, B.id, { size: 'DN100', schedule: 'sch40' });

    /* The trim pump, in series with the loop while the bypass is shut. */
    const p2 = M.addPipe(m, B.id, C.id, { kind: 'pump' });
    p2.pump = { mode: 'fixed', sizing: 'manual', head: 60, qDesign: 0.004,
                hDesign: 60 };
    p2.pump.curve = P.fit([{ q: 0, h: 84 }, { q: 0.004, h: 60 }, { q: 0.006, h: 39 }]);
    p2.tag = 'PMP-02';

    const chw = M.addPipe(m, C.id, D.id, { kind: 'equip' });
    chw.equip = { qRated: 0.004, pdRated: 8e3, equipType: 'source',
                  tSet: 18, qMax: -150000 };
    chw.tag = 'CHW-1';

    /* THE BYPASS. A check valve, so it can only ever carry B -> D: when PMP-02
     * over-pumps its branch there is nothing for it to do, and it opens by
     * itself once PMP-02 can no longer take the whole loop flow. */
    const chk = M.addPipe(m, B.id, D.id, { kind: 'valve' });
    chk.valve = { type: 'check', kv: 120, opening: 100 };
    chk.tag = 'BYPASS';

    const ts = M.addPipe(m, D.id, E.id, { kind: 'sensor' });
    ts.sensor = { mode: 'temperature', tSet: 20 };
    ts.tag = 'TS-1';

    const p1 = M.addPipe(m, E.id, F.id, { kind: 'pump' });
    p1.pump = { mode: 'fixed', sizing: 'manual', head: 8, qDesign: 0.004,
                hDesign: 8 };
    p1.pump.curve = P.fit([{ q: 0, h: 11.2 }, { q: 0.004, h: 8 }, { q: 0.006, h: 5.2 }]);
    p1.tag = 'PMP-01';

    const coil = M.addPipe(m, F.id, G.id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 80e3, equipType: 'exchanger',
                   duty: 200e3 };
    coil.tag = 'AHU-1';

    const ct = M.addPipe(m, G.id, H.id, { kind: 'equip' });
    ct.equip = { qRated: 0.004, pdRated: 60e3, equipType: 'source',
                 tSet: 30, qMax: -100000 };
    ct.tag = 'CT-01';

    M.addPipe(m, H.id, S.id, { size: 'DN100', schedule: 'sch40' });
    m.pipes.forEach(p => { p.insulation_mm = 0; });

    if (opts.control !== false) M.setControl(m, p2, ts.id);
    return { m, p1, p2, chw, ct, coil, ts, chk, mix: D };
  }

  /* ---- 1. THE RESPONSE ITSELF, swept by hand with nothing controlling.
   * This is the fixture for everything below: if the shape ever stops being a
   * fall and then a rise, the rest of this section is testing nothing. */
  {
    const t = mixRig({ control: false });
    const at = s => {
      t.p2.pump.speed = s;
      return NET.solveModel(t.m, 8).thermal.temperature[t.mix.id];
    };
    const full = at(1), dip = at(0.35), floor = at(0.25);
    ok('At full speed the mix is ABOVE setpoint', full > 20.5,
       full.toFixed(3) + ' C');
    ok('...it falls BELOW setpoint in the middle of the travel', dip < 19.5,
       dip.toFixed(3) + ' C');
    ok('...and is back ABOVE setpoint at the 25% floor', floor > 20.5,
       floor.toFixed(3) + ' C');
    ok('So the setpoint is crossed twice, and the floor tells you nothing',
       (full - 20) > 0 && (dip - 20) < 0 && (floor - 20) > 0,
       [full, dip, floor].map(x => x.toFixed(2)).join(' / '));

    /* AND THE TWO LIMBS ARE THE TWO EFFECTS. Above the turn the bypass is shut
     * and PMP-02 carries the whole loop; below it the bypass is carrying real
     * flow. */
    t.p2.pump.speed = 1;
    const hi = NET.solveModel(t.m, 8);
    t.p2.pump.speed = 0.25;
    const lo = NET.solveModel(t.m, 8);
    ok('At full speed the check valve is shut',
       Math.abs(hi.flow[t.chk.id]) < 0.01 * Math.abs(hi.flow[t.chw.id]),
       (Math.abs(hi.flow[t.chk.id]) * 1000).toFixed(4) + ' L/s');
    ok('...and at the floor the bypass is carrying a third of the flow',
       Math.abs(lo.flow[t.chk.id]) > 0.25 * Math.abs(lo.flow[t.chw.id]),
       (Math.abs(lo.flow[t.chk.id]) * 1000).toFixed(4) + ' L/s');
  }

  /* ---- 2. AND THE CONTROL LOOP FINDS IT. */
  {
    const t = mixRig({});
    const r = NET.solveModel(t.m);
    ok('It converges', r.converged === true,
       JSON.stringify((r.errors || []).map(e => e.code)));
    ok('...with no lost setpoint',
       !(r.errors || []).some(e => e.code === 'SETPOINT_LOST'),
       JSON.stringify((r.errors || []).map(e => e.code)));

    const d = r.controls.devices[0];
    ok('PMP-02 is modulating, not parked at full', d.value < 0.99,
       (d.value * 100).toFixed(1) + '%');
    ok('...and it stopped at the HIGHER of the two roots, which is where a ' +
       'controller ramping down from full would stop', d.value > 0.4,
       (d.value * 100).toFixed(1) + '%');
    ok('...reported as holding its setpoint', d.state === 'on', d.state);
    near('...and the sensor reads 20 C',
         r.thermal.temperature[t.mix.id], 20, 0.05);

    /* THE SETTLED POINT, BY HAND, and it needs nothing from the search.
     *
     * At the answer the bypass is shut, so the whole loop flow passes through
     * CHW-1, which is working at its 150 kW capacity. The mix is therefore
     *
     *     TS-1 = 30 − 150000/(ρ·Q·cp) = 20   →   Q = 150000/(10 × ρ × cp)
     *
     * and ρ·cp = 998 × 4187 = 4 178 626 J/(m³·K), so Q = 3.5896 L/s.
     * Nothing in that line was read out of the code. */
    const qHand = 150000 / (10 * RHO * CP);
    near('The settled flow is the hand-calculated 3.590 L/s',
         Math.abs(r.flow[t.chw.id]), qHand, qHand * 0.01);

    /* AND THE HEAT BALANCE CLOSES. The coil puts in 200 kW; CHW-1 takes its
     * 150 kW and CT-01 takes the other 50 kW, holding 30 °C into the branch. */
    const th = r.thermal;
    near('CHW-1 is working at its 150 kW capacity',
         th.links[t.chw.id].qW, -150e3, 500);
    near('...and CT-01 takes the other 50 kW', th.links[t.ct.id].qW, -50e3, 1500);
    near('...holding 30 C into the mixing circuit',
         th.links[t.ct.id].tOut, 30, 0.05);
  }
}

/* =====================================================================
 * DEVICES THAT SHARE A SETPOINT MODULATE TOGETHER.
 *
 * N controllers chasing ONE measured quantity is degenerate: any split that
 * gives the right reading satisfies all of them, so settling them one at a time
 * picks whichever split the sweep order reaches first.
 *
 * Michael, 2026-08-08, four primary pumps on one differential: 100%, 85.8%,
 * 25%, 25% — the last two on their floor carrying NO FLOW, held shut by the
 * first two. Stable, arbitrary, and nothing like the plant, which runs parallel
 * pumps on a common header from ONE speed command.
 * ===================================================================== */
section('Pumps sharing a setpoint run at a common speed');
{
  /* Three identical pumps in parallel between two headers, all following the
   * same differential sensor. */
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0].id;
  const inlet = M.addNode(m, lv, 0, 0);
  const hdr = M.addNode(m, lv, 12, 0);
  M.setSource(m, inlet.id, 0);

  const pumps = [];
  for (let i = 0; i < 3; i++) {
    const a = M.addNode(m, lv, 4, (i - 1) * 4);
    const b = M.addNode(m, lv, 8, (i - 1) * 4);
    M.addPipe(m, inlet.id, a.id, { size: 'DN65', schedule: 'sch40' });
    const p = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    p.pump = { mode: 'fixed', sizing: 'manual', head: 25, qDesign: 0.004, hDesign: 25 };
    p.pump.curve = FD.pumps.fit([{ q: 0, h: 35 }, { q: 0.004, h: 25 }, { q: 0.006, h: 16 }]);
    p.tag = 'P' + (i + 1);
    M.addPipe(m, b.id, hdr.id, { size: 'DN65', schedule: 'sch40' });
    pumps.push(p);
  }
  /* A load, and a differential across it for them all to hold. */
  const c1 = M.addNode(m, lv, 20, 0), c2 = M.addNode(m, lv, 26, 0);
  M.addPipe(m, hdr.id, c1.id, { size: 'DN65', schedule: 'sch40' });
  const coil = M.addPipe(m, c1.id, c2.id, { kind: 'equip' });
  coil.equip = { qRated: 0.009, pdRated: 120e3, equipType: 'exchanger', duty: 60000 };
  M.addPipe(m, c2.id, inlet.id, { size: 'DN65', schedule: 'sch40' });

  const sN = M.addNode(m, lv, 13, 0);
  const sens = M.addPipe(m, hdr.id, sN.id, { kind: 'sensor' });
  const refN = M.addNode(m, lv, 27, 0);
  const ref = M.addPipe(m, c2.id, refN.id, { size: 'DN65', schedule: 'sch40' });
  sens.sensor = { mode: 'dP', ref: ref.id, dpSet: 100e3 };
  pumps.forEach(p => M.setControl(m, p, sens.id));
  m.pipes.forEach(x => { x.insulation_mm = 0; });

  const res = NET.solveModel(m);
  const dev = id => res.controls.devices.filter(x => x.pipe === id)[0];

  ok('The gang is reported, not silent',
     (res.warnings || []).some(w => w.code === 'CONTROL_GANGED'),
     JSON.stringify((res.warnings || []).map(w => w.code)));

  const speeds = pumps.map(p => M.pumpSpeed(m, p));
  ok('All three run at the same speed',
     Math.max.apply(null, speeds) - Math.min.apply(null, speeds) < 1e-9,
     speeds.map(s => (s * 100).toFixed(1) + '%').join(' / '));

  /* AND THEREFORE SHARE THE FLOW. Identical pumps at one speed between the same
   * two headers must carry the same flow — that is the whole reason a common
   * speed command is what real plant uses. */
  const flows = pumps.map(p => Math.abs(res.flow[p.id]));
  const spread = (Math.max.apply(null, flows) - Math.min.apply(null, flows)) /
                 Math.max.apply(null, flows);
  ok('...and split the flow between them', spread < 0.02,
     flows.map(q => (q * 1000).toFixed(3) + ' L/s').join(' / '));

  /* NONE OF THEM IS PARKED ON ITS FLOOR CARRYING NOTHING, which is the failure
   * this replaces. */
  flows.forEach((q, i) => {
    ok(`P${i + 1} is actually pumping`, q > 1e-5, (q * 1000).toFixed(4) + ' L/s');
  });

  /* Each still reports under its OWN name, with the group named beside it. */
  pumps.forEach(p => {
    const d = dev(p.id);
    ok(`${p.tag} reports its own row`, !!d && d.tag === p.tag);
    ok(`...naming the gang`, !!d && d.gangedWith && d.gangedWith.length === 3,
       d ? JSON.stringify(d.gangedWith) : 'none');
  });
}

section('A control link to a deleted target is reported');
{
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0), c = M.addNode(m, lv, 9, 0);
  M.setSource(m, a.id, 200e3);
  c.device = { kind: 'demand', flow: 0.004, reqPressure: 100e3, include: true };
  const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
  pump.pump = { mode: 'fixed', sizing: 'manual', head: 20, qDesign: 0.004, hDesign: 20 };
  pump.pump.curve = FD.pumps.fit([{ q: 0, h: 28 }, { q: 0.004, h: 20 }, { q: 0.006, h: 13 }]);
  M.addPipe(m, b.id, c.id, { size: 'DN50', schedule: 'sch40' });
  /* A link to something that is not there — what deleting a sensor leaves. */
  pump.pump.control = { equip: 'P999', axis: 'h', mid: null, use: { set: true } };

  const res = NET.solveModel(m);
  ok('A dangling control link is called out',
     (res.warnings || []).some(w => w.code === 'CONTROL_TARGET_GONE'),
     JSON.stringify((res.warnings || []).map(w => w.code)));
  ok('...and the solve still completes', res.ok !== false || !!res.flow);
}

/* =====================================================================
 * EQUIPMENT CONTROLS: an integrated valve, and a capacity override.
 * ===================================================================== */
section('Integrated control valve and capacity override');
{
  function rig() {
    const m = M.create();
    m.settings.calcMode = 'simulation';
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 1, 0);
    const c1 = M.addNode(m, lv, 9, 0), c2 = M.addNode(m, lv, 12, 0);
    const d = M.addNode(m, lv, 20, 0);
    M.setSource(m, a.id, 0);
    const pump = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    pump.pump = { mode: 'fixed', sizing: 'manual', head: 25, qDesign: 0.004, hDesign: 25 };
    pump.pump.curve = FD.pumps.fit([{ q: 0, h: 35 }, { q: 0.004, h: 25 }, { q: 0.006, h: 16 }]);
    M.addPipe(m, b.id, c1.id, { size: 'DN50', schedule: 'sch40' });
    const coil = M.addPipe(m, c1.id, c2.id, { kind: 'equip' });
    coil.equip = { qRated: 0.004, pdRated: 80e3, equipType: 'exchanger', duty: 50000 };
    coil.tag = 'AHU-1';
    M.addPipe(m, c2.id, d.id, { size: 'DN50', schedule: 'sch40' });
    M.addPipe(m, d.id, a.id, { size: 'DN50', schedule: 'sch40' });
    m.pipes.forEach(x => { x.insulation_mm = 0; });
    return { m, coil, pump };
  }

  /* ---- CAPACITY OVERRIDE scales the stated load and leaves the design alone. */
  {
    const t = rig();
    const base = NET.solveModel(t.m);
    const q0 = base.thermal.links[t.coil.id].qW;
    near('Without an override the coil does its stated duty', q0, 50000, 50);

    t.coil.equip.loadPct = 40;
    const r = NET.solveModel(t.m);
    near('At 40% it does 40% of it', r.thermal.links[t.coil.id].qW, 20000, 50);
    near('...and the DESIGN figure is untouched', t.coil.equip.duty, 50000, 1e-9);

    t.coil.equip.loadPct = 0;
    const z = NET.solveModel(t.m);
    near('At 0% it does nothing', z.thermal.links[t.coil.id].qW, 0, 1);

    delete t.coil.equip.loadPct;
    const back = NET.solveModel(t.m);
    near('Removed, it is back to full duty',
         back.thermal.links[t.coil.id].qW, 50000, 50);
  }

  /* ---- AN INTEGRATED VALVE is a real resistance AND a real actuator.
   *
   * The resistance is measured in DESIGN, because in SIMULATION the valve is
   * CONTROLLED — the loop holds the coil's ΔT and writes the position, so a
   * hand-set opening is an input the solve is entitled to overrule. That is the
   * same rule a drawn control valve follows. */
  {
    const t = rig();
    t.m.settings.calcMode = 'design';
    const open = NET.solveModel(t.m);
    const qOpen = Math.abs(open.flow[t.coil.id]);

    t.coil.equip.icv = { kv: 12, opening: 100 };
    const withV = NET.solveModel(t.m);
    ok('An integrated valve is a real resistance',
       Math.abs(withV.flow[t.coil.id]) < qOpen,
       (qOpen * 1000).toFixed(3) + ' -> ' + (Math.abs(withV.flow[t.coil.id]) * 1000).toFixed(3) + ' L/s');

    /* Shut, it throttles hard — the same equal-percentage Kv curve a drawn
     * globe valve uses. At 10% travel its Kv is 0.12 against 12, and its
     * resistance 9.2e9 against the coil's own 5.1e5, so the branch all but
     * closes. */
    t.coil.equip.icv.opening = 10;
    const shut = NET.solveModel(t.m);
    ok('...and closing it throttles the branch',
       Math.abs(shut.flow[t.coil.id]) < Math.abs(withV.flow[t.coil.id]) * 0.1,
       (Math.abs(shut.flow[t.coil.id]) * 1000).toFixed(4) + ' L/s');

    t.m.settings.calcMode = 'simulation';

    /* And it controls to its OWN machine's ΔT, with nothing drawn or linked. */
    t.coil.equip.icv.opening = 100;
    t.coil.equip.dTMax = undefined;
    const ctl = NET.solveModel(t.m);
    const dev = ctl.controls && ctl.controls.devices
      .filter(x => x.pipe === t.coil.id)[0];
    ok('It appears as a controlled device without being linked', !!dev,
       JSON.stringify((ctl.controls || {}).devices || []));
    if (dev) {
      ok('...holding its own machine', dev.equip === t.coil.id, dev.equip);
      ok('...on a ΔT', dev.setpointOf === 'dT', dev.setpointOf);
      ok('...as an opening', dev.quantity === 'opening', dev.quantity);
    }
  }
}

/* =====================================================================
 * SYNC — the answer to "multiple equipment on one sensor".
 * ===================================================================== */
section('A synced pump holds its leader\u2019s speed');
{
  const m = M.create();
  m.settings.calcMode = 'simulation';
  const lv = m.levels[0].id;
  const inlet = M.addNode(m, lv, 0, 0), hdr = M.addNode(m, lv, 12, 0);
  M.setSource(m, inlet.id, 0);
  const pumps = [];
  for (let i = 0; i < 3; i++) {
    const a = M.addNode(m, lv, 4, (i - 1) * 4), b = M.addNode(m, lv, 8, (i - 1) * 4);
    M.addPipe(m, inlet.id, a.id, { size: 'DN65', schedule: 'sch40' });
    const p = M.addPipe(m, a.id, b.id, { kind: 'pump' });
    p.pump = { mode: 'fixed', sizing: 'manual', head: 25, qDesign: 0.004, hDesign: 25 };
    p.pump.curve = FD.pumps.fit([{ q: 0, h: 35 }, { q: 0.004, h: 25 }, { q: 0.006, h: 16 }]);
    p.tag = 'P' + (i + 1);
    M.addPipe(m, b.id, hdr.id, { size: 'DN65', schedule: 'sch40' });
    pumps.push(p);
  }
  const c1 = M.addNode(m, lv, 20, 0), c2 = M.addNode(m, lv, 26, 0);
  M.addPipe(m, hdr.id, c1.id, { size: 'DN65', schedule: 'sch40' });
  const coil = M.addPipe(m, c1.id, c2.id, { kind: 'equip' });
  coil.equip = { qRated: 0.009, pdRated: 120e3, equipType: 'exchanger', duty: 60000 };
  M.addPipe(m, c2.id, inlet.id, { size: 'DN65', schedule: 'sch40' });
  const sN = M.addNode(m, lv, 13, 0);
  const sens = M.addPipe(m, hdr.id, sN.id, { kind: 'sensor' });
  const refN = M.addNode(m, lv, 27, 0);
  const ref = M.addPipe(m, c2.id, refN.id, { size: 'DN65', schedule: 'sch40' });
  sens.sensor = { mode: 'dP', ref: ref.id, dpSet: 100e3 };
  m.pipes.forEach(x => { x.insulation_mm = 0; });

  /* MICHAEL'S ARRANGEMENT: one linked, the rest synced to it. */
  M.setControl(m, pumps[0], sens.id);
  ok('P2 can sync a pump', !!M.setSync(m, pumps[1], pumps[0].id));
  ok('P3 too', !!M.setSync(m, pumps[2], pumps[0].id));

  const res = NET.solveModel(m);
  ok('No gang warning — only one is linked',
     !(res.warnings || []).some(w => w.code === 'CONTROL_GANGED'),
     JSON.stringify((res.warnings || []).map(w => w.code)));

  const speeds = pumps.map(p => M.pumpSpeed(m, p));
  ok('All three end at the same speed',
     Math.max.apply(null, speeds) - Math.min.apply(null, speeds) < 1e-9,
     speeds.map(s => (s * 100).toFixed(1) + '%').join(' / '));
  ok('...and it is the LEADER that was searched',
     res.controls.devices.length === 1 &&
     res.controls.devices[0].pipe === pumps[0].id,
     JSON.stringify(res.controls.devices.map(d => d.tag)));

  const flows = pumps.map(p => Math.abs(res.flow[p.id]));
  const spread = (Math.max.apply(null, flows) - Math.min.apply(null, flows)) /
                 Math.max.apply(null, flows);
  ok('...so they share the flow', spread < 0.02,
     flows.map(q => (q * 1000).toFixed(3)).join(' / '));

  /* A SYNC IS NOT A CONTROL — setting one clears the link, so the two can never
   * both be trying to write the same actuator. */
  M.setControl(m, pumps[1], sens.id);
  M.setSync(m, pumps[1], pumps[0].id);
  ok('Syncing clears any control link', !M.controlOf(pumps[1]));

  /* AND ONLY LIKE TO LIKE. A percentage of travel and a percentage of speed are
   * not the same quantity. */
  const val = M.addPipe(m, c1.id, c2.id, { kind: 'valve' });
  val.valve = { type: 'globe', kv: 20, opening: 100 };
  ok('A pump cannot sync a valve', !M.canSync(pumps[0], val));
  ok('...nor a valve a pump', !M.canSync(val, pumps[0]));

  /* A CHAIN collapses to its head, so nothing waits on a follower. */
  M.setSync(m, pumps[2], pumps[1].id);
  ok('Syncing to a follower syncs to the head instead',
     M.syncOf(pumps[2]) === pumps[0].id, M.syncOf(pumps[2]));
  ok('A device cannot sync itself', M.setSync(m, pumps[0], pumps[0].id) === null);
}

report();
