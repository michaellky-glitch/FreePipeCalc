/* Data centre — the rest of the test battery.
 *
 *   A. geometry stress: change several dimensions and see what breaks
 *   B. second pump on: expect roughly equal head and half the flow each
 *   C. valve on the ring's 30 m section, shut
 *   D. valve on the second pump's discharge, throttled to 25% then 0%
 *
 * Run:  node test/testrun-datacentre-battery.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model, G = FD.geometry;

const FILE = path.join(__dirname, '..', 'examples', 'datacentre-ring.pnet.json');
const base = () => M.fromJSON(JSON.parse(fs.readFileSync(FILE, 'utf8')));

const Ls = q => (q * 1000).toFixed(2);
const kPa = p => (p / 1000).toFixed(1);
const padr = (s, n) => String(s).padEnd(n);
const pad = (s, n) => String(s).padStart(n);
const hr = t => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)); };

const pumps = m => m.pipes.filter(p => p.kind === 'pump');
const equip = m => m.pipes.find(p => p.kind === 'equip');

function summarise(m, res, label) {
  const eq = equip(m);
  console.log('  ' + padr(label, 26) +
    'equip ' + pad(Ls(res.flow[eq.id] || 0), 7) + ' L/s   ' +
    pumps(m).map(p => p.tag.slice(-2) + ':' +
      (p.pump.mode === 'off' ? 'off' : Ls(res.flow[p.id] || 0))).join('  '));
}

// ============================================================ A. geometry
hr('A. GEOMETRY STRESS — change dimensions and see what holds');
{
  const trials = [
    ['ring 30 m side  → 45 m', m => ringPipe(m, 30), 45],
    ['ring 20 m top   → 26 m', m => ringPipe(m, 20), 26],
    ['header 10 m run → 3 m', m => m.pipes.find(p => near(len(m, p), 10) && horizontal(m, p)), 3],
    ['equip branch 1 m → 4 m', m => m.pipes.find(p => near(len(m, p), 1)), 4],
    ['pump spacing 2.5 → 6 m', m => m.pipes.find(p => near(len(m, p), 2.5)), 6]
  ];

  function len(m, p) { return M.pipeLength(m, p); }
  function near(a, b) { return Math.abs(a - b) < 0.01; }
  function horizontal(m, p) {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return a && b && Math.abs(a.y - b.y) < 1e-9;
  }
  function ringPipe(m, wantLen) {
    return m.pipes.find(p => p.kind === 'pipe' && near(len(m, p), wantLen));
  }

  trials.forEach(([label, pick, newLen]) => {
    const m = base();
    const p = pick(m);
    if (!p) { console.log('  ' + padr(label, 26) + 'SKIP — no matching pipe'); return; }

    const before = G.snapshotLengths(m);
    const r = G.changeLength(m, p.id, newLen);
    let note;
    if (r.ok) {
      note = 'rigid move OK, ' + r.changes.length + ' length(s) changed';
    } else {
      // try the repair path
      const rep = G.repairLength(m, p.id, newLen);
      note = r.code + ' → repair ' + (rep.ok
        ? 'OK, changed ' + rep.changes.map(c => c.pipe).join('+')
        : 'REFUSED');
      if (!rep.ok) {
        const untouched = m.pipes.every(x =>
          Math.abs(M.pipeLength(m, x) - before[x.id]) < 1e-9);
        note += untouched ? ' (model untouched)' : ' (MODEL MUTATED!)';
      }
    }
    const res = FD.network.solveModel(m);
    console.log('  ' + padr(label, 26) + padr(note, 44) +
      (res.converged ? 'solves' : 'NO CONVERGE'));
  });
}

// ======================================================== B. second pump
hr('B. SECOND PUMP ON — expect roughly equal head, half the flow each');
{
  const m = base();
  const one = FD.network.solveModel(m);
  summarise(m, one, '1 pump running');

  const m2 = base();
  pumps(m2)[1].pump.mode = 'auto';
  pumps(m2)[1].pump.head = 0;
  const two = FD.network.solveModel(m2);
  summarise(m2, two, '2 pumps running');

  const p = pumps(m2);
  const q1 = Math.abs(two.flow[p[0].id]), q2 = Math.abs(two.flow[p[1].id]);
  const eq = equip(m2);
  console.log();
  console.log(`  pump heads      : ${p[0].pump.head.toFixed(2)} m and ${p[1].pump.head.toFixed(2)} m`);
  console.log(`  pump flows      : ${Ls(q1)} and ${Ls(q2)} L/s   (split ` +
              `${(100 * q1 / (q1 + q2)).toFixed(1)}/${(100 * q2 / (q1 + q2)).toFixed(1)}%)`);
  console.log(`  combined        : ${Ls(q1 + q2)} L/s`);
  console.log(`  equipment flow  : ${Ls(two.flow[eq.id])} L/s  (was ${Ls(one.flow[equip(m).id])})`);
  console.log(`  head vs 1 pump  : ${p[0].pump.head.toFixed(2)} m vs ` +
              `${pumps(m)[0].pump.head.toFixed(2)} m`);
}

// ==================================================== C. shut ring valve
hr('C. VALVE ON THE RING 30 m SECTION');
{
  function withRingValve(opening) {
    const m = base();
    const p30 = m.pipes.find(x => x.kind === 'pipe' &&
      Math.abs(M.pipeLength(m, x) - 30) < 0.01);
    p30.kind = 'valve';
    p30.tag = 'CHW-IV-30';
    p30.valve = { type: 'gate', kv: FD.valves.defaultKv('gate', 102.26), opening };
    return { m, id: p30.id };
  }

  [100, 50, 25, 0].forEach(op => {
    const { m, id } = withRingValve(op);
    const res = FD.network.solveModel(m);
    const eq = equip(m);
    // the other way round the ring: the 20 m top + 20 m upper-right path
    const alt = m.pipes.find(x => x.kind === 'pipe' &&
      Math.abs(M.pipeLength(m, x) - 20) < 0.01);
    console.log('  ' + padr('valve ' + op + '% open', 20) +
      'through valve ' + pad(Ls(res.flow[id] || 0), 8) + ' L/s   ' +
      'equip ' + pad(Ls(res.flow[eq.id] || 0), 7) + ' L/s   ' +
      'pump ' + pad(Ls(res.flow[pumps(m)[0].id] || 0), 7) + ' L/s' +
      (res.converged ? '' : '   NO CONVERGE'));
  });
}

// ================================================ D. valve before pump 2
hr('D. VALVE ON PUMP 2 DISCHARGE — throttled, then shut');
{
  function withPumpValve(opening) {
    const m = base();
    const ps = pumps(m);
    ps[1].pump.mode = 'auto';
    ps[1].pump.head = 0;

    // the pipe leaving pump 2's discharge node
    const dis = ps[1].b;
    const p = M.pipesAt(m, dis).find(x => x.id !== ps[1].id);
    p.kind = 'valve';
    p.tag = 'CHW-IV-P02';
    p.valve = { type: 'gate', kv: FD.valves.defaultKv('gate', 102.26), opening };
    return { m, valveId: p.id };
  }

  [100, 25, 0].forEach(op => {
    const { m, valveId } = withPumpValve(op);
    const res = FD.network.solveModel(m);
    const ps = pumps(m), eq = equip(m);
    const q1 = Math.abs(res.flow[ps[0].id]), q2 = Math.abs(res.flow[ps[1].id]);
    console.log('  ' + padr('P02 valve ' + op + '% open', 22) +
      'P01 ' + pad(Ls(q1), 7) + '  P02 ' + pad(Ls(q2), 7) +
      '   equip ' + pad(Ls(res.flow[eq.id] || 0), 7) +
      '   head ' + pad(ps[0].pump.head.toFixed(1), 6) + ' m' +
      (res.converged ? '' : '   NO CONVERGE'));
  });
  console.log();
  console.log('  (both pumps are auto, so they share one sized head; shutting P02 makes');
  console.log('   the sizer wind the pair up until P01 alone carries the load)');
}

console.log();
