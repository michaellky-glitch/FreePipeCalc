/* Test run — 3-floor riser + ring main, per Michael's sketch.
 *
 * Geometry (identical 20 m × 50 m loop on every floor, level-local metres):
 *
 *      (0,50) ────────── 20m ────────── (20,50)
 *         │                                │
 *        40m                              20m
 *         │                                │
 *      (0,10) ◄─2m─ riser(-2,10)      D1 (20,30)
 *         │                                │
 *        10m                          10m / 30m
 *         │                                │
 *       (0,0) ────────── 20m ────────── (20,0)
 *
 * Level 1 @ 0 m   — SOURCE ─2m─ PUMP ─10m─ RISER ─2m─ loop, ONE demand at (20,30)
 * Level 2 @ 5 m   — RISER ─2m─ loop, TWO demands at (20,30) and (20,20)
 * Level 3 @ 10 m  — RISER ─2m─ loop, TWO demands at (20,30) and (20,20)
 *
 * All pipe DN100 Schedule 40 (102.26 mm bore) for testing.
 * Demands 20 L/s each → 100 L/s total.
 *
 * Run:  node test/testrun-3floor.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');
const FD = load(['src/model.js', 'src/network.js']);
const M = FD.model;

const SIZE = 'DN100';
const SCH = 'sch40';
const DEMAND = 0.020;          // 20 L/s

const m = M.create();
m.settings.schedule = SCH;
m.settings.meta.project = '3-floor riser test';
m.settings.meta.engineer = 'M. Lim';
m.settings.meta.system = 'Ring main, 3 levels';

// ---------------------------------------------------------------- levels
const L1 = m.levels[0];
L1.name = 'Level 1';
M.setLevelAltitude(m, L1.id, 0);
const L2 = M.addLevel(m, { name: 'Level 2', altitude: 5 });
const L3 = M.addLevel(m, { name: 'Level 3', altitude: 10 });

const P = (a, b) => M.addPipe(m, a.id, b.id, { size: SIZE, schedule: SCH });

/* Build one floor's loop + the 2 m stub from the riser.
 * Returns { riser, entry, demands: [...] }. */
function floor(level, demandYs) {
  const N = (x, y) => M.addNode(m, level.id, x, y);

  const riser = N(-2, 10);
  const entry = N(0, 10);
  const topLeft = N(0, 50);
  const topRight = N(20, 50);
  const botLeft = N(0, 0);
  const botRight = N(20, 0);

  P(riser, entry);                 // 2 m stub  (the length that was missing)
  P(entry, topLeft);               // 40 m left edge, upper
  P(topLeft, topRight);            // 20 m top
  P(entry, botLeft);               // 10 m left edge, lower
  P(botLeft, botRight);            // 20 m bottom

  // Right edge, top → bottom, broken by the demand take-offs
  let prev = topRight;
  const demands = [];
  demandYs.forEach(y => {
    const d = N(20, y);
    P(prev, d);
    M.setDemand(m, d.id, DEMAND, 0);
    demands.push(d);
    prev = d;
  });
  P(prev, botRight);               // remainder of the right edge

  return { riser, entry, demands };
}

const f1 = floor(L1, [30]);          // 20 m then 30 m
const f2 = floor(L2, [30, 20]);      // 20 m, 10 m, then 20 m
const f3 = floor(L3, [30, 20]);

// ------------------------------------------------- Level 1 supply + pump
const NL1 = (x, y) => M.addNode(m, L1.id, x, y);
const source  = NL1(-14.2, 10);
const pumpIn  = NL1(-12.2, 10);
const pumpOut = NL1(-12.0, 10);

P(source, pumpIn);                                   // 2 m
/* The pump link is a pure head-gain element — it contributes no friction, so
 * its 0.2 m of geometry does not add loss. The labelled 2 m / 10 m / 2 m are
 * the only pipe in the supply run. */
M.addPipe(m, pumpIn.id, pumpOut.id, {
  kind: 'pump', size: SIZE, schedule: SCH,
  pump: { mode: 'auto', head: 0, flow: 0 }
});
P(pumpOut, f1.riser);                                // 10 m
M.setSource(m, source.id);

// ------------------------------------------------------------ riser column
const col = M.addRiser(m, -2, 10);
M.attachRiser(m, col.id, L3.id, f3.riser.id);
M.attachRiser(m, col.id, L2.id, f2.riser.id);
M.attachRiser(m, col.id, L1.id, f1.riser.id);
M.riserPipes(m);

// ------------------------------------------------------------ pump sizing
/* The engine now auto-sizes 'auto' pumps on every solve, so this no longer
 * runs its own sizing loop — which also means the head reported here includes
 * the settings.pumpSafetyPct margin, as spec §8.4 requires. */
const pump = m.pipes.find(p => p.kind === 'pump');

pump.pump.mode = 'fixed';
pump.pump.head = 0;
const noPump = FD.network.solveModel(m);

pump.pump.mode = 'auto';
const res = FD.network.solveModel(m);

// ------------------------------------------------------------------ report
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);
const kPa = p => (p / 1000).toFixed(1);
const Ls = q => (q * 1000).toFixed(2);

console.log('='.repeat(78));
console.log('3-FLOOR RISER + RING MAIN — TEST RUN');
console.log('='.repeat(78));
console.log(`Levels          : L1 @ 0 m, L2 @ 5 m, L3 @ 10 m`);
console.log(`Pipe            : ${SIZE} Schedule 40, bore ${FD.schedules.size(SCH, SIZE).id_mm} mm, C=${m.settings.C}`);
console.log(`Demands         : 5 × 20 L/s = ${Ls(0.1)} L/s total`);
console.log(`Nodes / pipes   : ${m.nodes.length} / ${m.pipes.length}`);
console.log(`Solver          : converged=${res.converged}, ${res.iterations} iterations, ${res.passes} passes`);
console.log(`Errors          : ${res.errors.length ? JSON.stringify(res.errors) : 'none'}`);
console.log();

console.log('--- WITHOUT PUMP (source alone, 0 gauge at L1) ---');
const wpD = m.nodes.filter(n => n.device && n.device.kind === 'demand');
console.log(`  worst demand pressure : ${kPa(Math.min(...wpD.map(n => noPump.pressure[n.id])))} kPa`);
console.log();

console.log('--- PUMP DUTY ---');
console.log(`  Flow  : ${Ls(Math.abs(res.flow[pump.id]))} L/s`);
console.log(`  Head  : ${pump.pump.head.toFixed(2)} m  (${kPa(998 * 9.81 * pump.pump.head)} kPa)`);
console.log();

console.log('--- DEMANDS ---');
console.log('  node  level     flow      elev    available   residual');
m.nodes.filter(n => n.device && n.device.kind === 'demand').forEach(n => {
  const lv = M.level(m, n.level);
  console.log('  ' + padr(n.id, 6) + padr(lv.name, 9) +
    pad(Ls(n.device.flow) + ' L/s', 10) + pad(M.elevation(m, n).toFixed(1) + ' m', 9) +
    pad(kPa(res.pressure[n.id]) + ' kPa', 13) +
    pad(kPa(res.pressure[n.id] - n.device.reqPressure) + ' kPa', 12));
});
console.log();

console.log('--- RISER FLOWS (must equal the demand carried above) ---');
m.pipes.filter(p => p.kind === 'riser').forEach(p => {
  const a = M.node(m, p.a), b = M.node(m, p.b);
  console.log(`  ${p.id}  ${M.level(m, a.level).name} → ${M.level(m, b.level).name}` +
    `   ${pad(Ls(res.flow[p.id]), 8)} L/s   L=${M.pipeLength(m, p).toFixed(2)} m  ${p.size}`);
});
console.log();

console.log('--- MASS BALANCE ---');
const bal = {};
m.nodes.forEach(n => { bal[n.id] = 0; });
res.network.links.forEach(l => { bal[l.from] -= res.flow[l.id]; bal[l.to] += res.flow[l.id]; });
let worstErr = 0, worstNode = null;
m.nodes.forEach(n => {
  if (n.device && n.device.kind === 'source') return;
  const want = (n.device && n.device.kind === 'demand') ? n.device.flow : 0;
  const err = Math.abs(bal[n.id] - want);
  if (err > worstErr) { worstErr = err; worstNode = n.id; }
});
console.log(`  worst nodal imbalance : ${(worstErr * 1000).toExponential(2)} L/s at ${worstNode}`);
console.log(`  source delivers       : ${Ls(-bal[source.id])} L/s   (expect 100.00)`);
console.log();

console.log('--- WARNINGS ---');
const codes = {};
(res.warnings || []).forEach(w => { codes[w.code || 'THRESH'] = (codes[w.code || 'THRESH'] || 0) + 1; });
console.log('  ' + (Object.keys(codes).length
  ? Object.entries(codes).map(([k, v]) => `${k} ×${v}`).join(', ') : 'none'));
const vmax = Math.max(...res.network.links.filter(l => l.kind === 'pipe')
  .map(l => FD.hydraulics.velocity(res.flow[l.id], l._d)));
console.log(`  peak velocity : ${vmax.toFixed(2)} m/s`);
console.log();

console.log('--- LOOP BALANCE CHECK (each floor ring must close) ---');
[[L1, f1], [L2, f2], [L3, f3]].forEach(([lv, f]) => {
  // walk entry → topLeft → topRight → ...right edge... → botRight → botLeft → entry
  /* Only the six pipes that form the rectangle: both ends must be ON the
   * rectangle (x = 0 or x = 20). Filtering merely by "not the riser node"
   * wrongly swept in the Level 1 supply run, which is not part of the ring. */
  const onRing = n => (n.x === 0 || n.x === 20);
  const ring = m.pipes.filter(p => {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return p.kind === 'pipe' && a.level === lv.id && b.level === lv.id &&
           onRing(a) && onRing(b);
  });
  let sum = 0;
  ring.forEach(p => {
    const l = res.network.links.find(x => x.id === p.id);
    const a = M.node(m, p.a), b = M.node(m, p.b);
    // sign convention: clockwise positive (up the left edge, across the top,
    // down the right, back along the bottom)
    const dir = (a.x === b.x) ? (a.x === 0 ? (b.y > a.y ? 1 : -1) : (b.y < a.y ? 1 : -1))
                              : (a.y === 50 ? (b.x > a.x ? 1 : -1) : (b.x < a.x ? 1 : -1));
    sum += dir * FD.hydraulics.headloss(l.r, res.flow[p.id], l.n);
  });
  console.log(`  ${padr(lv.name, 9)} Σ head loss around the ring = ${sum.toExponential(2)} m`);
});
console.log();

console.log('--- INDEX CIRCUIT (source → worst demand), section by section ---');
{
  // worst = lowest residual pressure
  let worst = null;
  m.nodes.forEach(n => {
    if (!n.device || n.device.kind !== 'demand') return;
    const resid = res.pressure[n.id] - (n.device.reqPressure || 0);
    if (!worst || resid < worst.resid) worst = { node: n, resid };
  });

  // Walk back from the worst demand to the source along the steepest head
  // gradient — the physical path the index flow takes.
  const adj = {};
  res.network.links.forEach(l => {
    (adj[l.from] = adj[l.from] || []).push(l);
    (adj[l.to] = adj[l.to] || []).push(l);
  });
  const path = [];
  let cur = worst.node.id, guard = 0;
  const seen = new Set([cur]);
  while (cur !== source.id && guard++ < 200) {
    let best = null;
    (adj[cur] || []).forEach(l => {
      const other = (l.from === cur) ? l.to : l.from;
      if (seen.has(other)) return;
      // pick the neighbour at higher head — that is where the water came from
      const dh = res.head[other] - res.head[cur];
      if (!best || dh > best.dh) best = { l, other, dh };
    });
    if (!best) break;
    path.unshift({ link: best.l, from: best.other, to: cur });
    seen.add(best.other);
    cur = best.other;
  }

  console.log(`  index demand: ${worst.node.id} on ${M.level(m, worst.node.level).name}` +
              `  (residual ${kPa(worst.resid)} kPa)`);
  console.log('  section        L(m)   EL(m)   Q L/s    v m/s    friction m   static m');
  let fricTotal = 0, statTotal = 0;
  path.forEach(s => {
    const l = s.link;
    const q = Math.abs(res.flow[l.id]);
    if (l.kind === 'pump') {
      console.log('  ' + padr(s.from + '→' + s.to, 14) + pad('PUMP', 8) +
                  pad('', 8) + pad(Ls(q), 8) + pad('', 9) +
                  pad('+' + pump.pump.head.toFixed(2), 13));
      return;
    }
    const fric = Math.abs(FD.hydraulics.headloss(l.r, res.flow[l.id], l.n));
    const stat = M.elevation(m, M.node(m, s.to)) - M.elevation(m, M.node(m, s.from));
    fricTotal += fric; statTotal += stat;
    console.log('  ' + padr(s.from + '→' + s.to, 14) + pad(l._L.toFixed(2), 7) +
      pad(l._el.toFixed(2), 8) + pad(Ls(q), 8) +
      pad(FD.hydraulics.velocity(res.flow[l.id], l._d).toFixed(2), 9) +
      pad(fric.toFixed(3), 13) + pad(stat.toFixed(2), 11));
  });
  console.log('  ' + '-'.repeat(74));
  console.log(`  friction along index : ${fricTotal.toFixed(2)} m`);
  console.log(`  static lift          : ${statTotal.toFixed(2)} m`);
  console.log(`  sum                  : ${(fricTotal + statTotal).toFixed(2)} m`);
  console.log(`  pump head            : ${pump.pump.head.toFixed(2)} m`);
  console.log(`  difference           : ${(pump.pump.head - fricTotal - statTotal).toFixed(3)} m` +
              `   (= residual at the index demand, ${(worst.resid / (998 * 9.81)).toFixed(3)} m)`);
}
console.log();

// ------------------------------------------------------------------- save
const out = path.join(__dirname, '..', 'examples');
if (!fs.existsSync(out)) fs.mkdirSync(out);
const file = path.join(out, '3-floor-riser-test.pnet.json');
fs.writeFileSync(file, JSON.stringify(M.toJSON(m), null, 2));
console.log('Model written to examples/3-floor-riser-test.pnet.json');
console.log('(LOAD MODEL in the app to open it.)');
