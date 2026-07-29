/* Redraw the data centre redundant ring main from scratch, using the model API
 * only — nothing carried over from the broken file, so no stale property can
 * survive. Layout is a genuine two-pipe ring: supply and return mains joined at
 * the far end, so each CRAH has two feed paths.
 *
 *   y=0   D2 D4 D6 D8 ==10=========40(CRAH1)=========70(CRAH2)=========90   supply
 *          |  |  |  |                |                 |                |
 *        pumps (4 off)             CRAH-01           CRAH-02          ring
 *          |  |  |  |                |                 |             closure
 *   y=20  S2 S4 S6 S8 ==10=========40================70=============90      return
 */
const { load } = require('/home/michael/Documents/FreePipeCalc/test/harness');
const FD = load(['src/model.js', 'src/geometry.js', 'data/pumps.js', 'data/valves.js',
                 'src/hydraulics.js', 'src/solver.js', 'src/network.js']);
const M = FD.model;
const fs = require('fs');

const m = M.create();
const lv = m.levels[0];
lv.name = 'Plant Level';
lv.altitude = 10;
m.settings.schedule = 'sch40';
m.settings.C = 120;
m.settings.meta = {
  project: 'Data centre — redundant ring main',
  system: 'Chilled water', engineer: '', company: '',
  date: '', revision: 'redrawn'
};

const L = lv.id;
const N = (x, y) => M.addNode(m, L, x, y);
const P = (a, b, size) => M.addPipe(m, a.id, b.id, { size: size, schedule: 'sch40' });

// ---- headers in the pump hall -------------------------------------------
const dis = [2, 4, 6, 8].map(x => N(x, 0));     // discharge (supply side)
const suc = [2, 4, 6, 8].map(x => N(x, 20));    // suction  (return side)
for (let i = 0; i < 3; i++) {
  P(dis[i], dis[i + 1], 'DN200');
  P(suc[i], suc[i + 1], 'DN200');
}

// ---- four pumps in parallel, suction -> discharge ------------------------
const pumps = [];
for (let i = 0; i < 4; i++) {
  const p = M.addPipe(m, suc[i].id, dis[i].id, { kind: 'pump', size: 'DN150' });
  /* Duty/standby, as the original drawing had it: one running, three valved
   * out. Four FIXED-HEAD pumps in parallel is an indeterminate problem — the
   * head across each is pinned to the same number, so continuity alone does not
   * decide how they share, and the solver returns one arbitrary answer out of
   * infinitely many. A pump CURVE removes the degeneracy, because then each
   * pump's head depends on its own flow. That is what SIMULATION is for. */
  p.pump = { mode: i === 0 ? 'auto' : 'off', head: 0, flow: 0 };
  p.tag = 'CHW-P-0' + (i + 1);
  pumps.push(p);
}

// ---- supply ring and return ring ----------------------------------------
/* A ring main means the SUPPLY main forms a loop, so every tap can be fed from
 * either direction. It does NOT mean supply meets return at the far end — that
 * is a bypass straight past the load, and the first attempt at this drawing had
 * exactly that: one pump recirculated 205 L/s round it while the CRAHs starved. */
const sup = { a: N(10, 0),  b: N(40, 0),  c: N(70, 0),  d: N(90, 0) };
const supBack = { d: N(90, -12), c: N(70, -12), b: N(40, -12), a: N(10, -12) };
const ret = { a: N(10, 20), b: N(40, 20), c: N(70, 20), d: N(90, 20) };
const retBack = { d: N(90, 32), c: N(70, 32), b: N(40, 32), a: N(10, 32) };

// supply ring: out along y=0, back along y=-12
P(dis[3], sup.a, 'DN200');
P(sup.a, sup.b, 'DN200'); P(sup.b, sup.c, 'DN200'); P(sup.c, sup.d, 'DN200');
P(sup.d, supBack.d, 'DN200');
P(supBack.d, supBack.c, 'DN200'); P(supBack.c, supBack.b, 'DN200');
P(supBack.b, supBack.a, 'DN200');
P(supBack.a, sup.a, 'DN200');            // closes the supply ring

// return ring: out along y=20, back along y=32
P(ret.a, suc[3], 'DN200');
P(ret.b, ret.a, 'DN200'); P(ret.c, ret.b, 'DN200'); P(ret.d, ret.c, 'DN200');
P(ret.d, retBack.d, 'DN200');
P(retBack.d, retBack.c, 'DN200'); P(retBack.c, retBack.b, 'DN200');
P(retBack.b, retBack.a, 'DN200');
P(retBack.a, ret.a, 'DN200');            // closes the return ring

// ---- two CRAH units bridging supply ring to return ring -----------------
function crah(supNode, retNode, tag, q) {
  const p = M.addPipe(m, supNode.id, retNode.id, { kind: 'equip', size: 'DN125' });
  p.equip = { qRated: q, pdRated: 200000 };
  p.tag = tag;
  return p;
}
crah(sup.b, ret.b, 'CRAH-01', 0.025);
crah(sup.c, ret.c, 'CRAH-02', 0.020);

// ---- expansion tank on the suction side ---------------------------------
const tank = N(0, 20);
P(tank, suc[0], 'DN50');
tank.device = { kind: 'source' };
tank.tag = 'EXP-TANK';

M.riserPipes(m);

// ------------------------------------------------------------------ checks
const issues = FD.network.disconnections(m);
console.log('disconnections:', issues.length ? issues.map(i => i.code) : 'CLEAN');

const res = FD.network.solveModel(m);
console.log('converged:', res.converged, 'errors:', res.errors.map(e => e.code));
const L1 = q => (q * 1000).toFixed(2);
m.pipes.filter(p => p.kind === 'equip').forEach(p =>
  console.log('  ' + p.tag + ': ' + L1(Math.abs(res.flow[p.id])) + ' L/s (rated ' +
              L1(p.equip.qRated) + ')'));
m.pipes.filter(p => p.kind === 'pump').forEach(p =>
  console.log('  ' + p.tag + ': ' + L1(Math.abs(res.flow[p.id])) + ' L/s @ ' +
              (p.pump.head * 998 * 9.81 / 1000).toFixed(1) + ' kPa'));
console.log('  velocity warnings:',
  res.warnings.filter(w => w.code === 'VELOCITY').length);

const out = '/home/michael/Documents/FreePipeCalc/examples/data_centre_redundant_ring_main.pnet (fixed).json';
fs.writeFileSync(out, JSON.stringify(M.toJSON ? M.toJSON(m) : m, null, 2));
console.log('written:', out);
