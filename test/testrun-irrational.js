/* Test run — "irrational system", per Michael's sketch.
 *
 * Same 3-floor model, but:
 *   - the SOURCE is moved from L1 up to L3, on a 10 m pipe into the riser node
 *   - the pump stays on L1 with NOTHING upstream of it (dead end)
 *
 * Expected findings:
 *   - the pump carries no flow and is doing nothing
 *   - the L3 demands sit at the SAME elevation as the source, so they cannot
 *     be served: no static head, and friction only makes it worse
 *   - the supply is insufficient overall; the achievable flows are what the
 *     pressure-driven pass reports
 *
 * Run:  node test/testrun-irrational.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model;

const FILE = path.join(__dirname, '..', 'examples', '3-floor-riser-test.pnet.json');
const base = () => M.fromJSON(JSON.parse(fs.readFileSync(FILE, 'utf8')));

const kPa = p => (p / 1000).toFixed(1);
const Ls = q => (q * 1000).toFixed(2);
const padr = (s, n) => String(s).padEnd(n);
const pad = (s, n) => String(s).padStart(n);

/* Move the source from L1 to L3, on a 10 m pipe into the L3 riser node. */
function moveSourceToL3(m) {
  const src = m.nodes.find(n => n.device && n.device.kind === 'source');
  // drop the source and the 2 m pipe that fed the pump
  M.removeNode(m, src.id);

  const L3 = m.levels.find(l => l.name === 'Level 3');
  // the L3 riser node sits at level-local (-2, 10)
  const riser3 = m.nodes.find(n => n.level === L3.id && n.x === -2 && n.y === 10);
  const newSrc = M.addNode(m, L3.id, -12, 10);      // 10 m out from the riser
  M.addPipe(m, newSrc.id, riser3.id, { size: 'DN100', schedule: 'sch40' });
  M.setSource(m, newSrc.id);
  return newSrc;
}

function report(title, m) {
  const res = FD.network.solveModel(m);
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));

  const pump = m.pipes.find(p => p.kind === 'pump');
  console.log(`solver          : converged=${res.converged}, ${res.passes} passes`);
  if (pump) {
    console.log(`pump            : head ${(pump.pump.head || 0).toFixed(2)} m, ` +
                `flow ${Ls(res.flow[pump.id] || 0)} L/s, mode ${pump.pump.mode}` +
                (res.pumpSizing && res.pumpSizing.stalled ? '  [auto-size stalled]' : ''));
  }
  console.log();

  console.log('DEMANDS   (demand-driven pressure, then what is actually deliverable)');
  console.log('  node   level     elev   nominal    available    actual');
  m.nodes.filter(n => n.device && n.device.kind === 'demand').forEach(n => {
    const lv = M.level(m, n.level);
    const act = res.actual ? res.actual.flow[n.id] : n.device.flow;
    console.log('  ' + padr(n.id, 7) + padr(lv.name, 10) +
      pad(M.elevation(m, n).toFixed(1) + 'm', 6) +
      pad(Ls(n.device.flow) + ' L/s', 11) +
      pad(kPa(res.pressure[n.id]) + ' kPa', 13) +
      pad('(' + Ls(act) + ')', 10));
  });
  console.log();

  if (res.actual) {
    console.log(`  demanded  ${Ls(res.actual.totalDemanded)} L/s` +
                `   delivered ${Ls(res.actual.totalDelivered)} L/s` +
                `   unmet at: ${res.actual.unmet.join(', ') || 'none'}`);
    console.log();
  }

  const groups = {};
  (res.warnings || []).forEach(w => {
    (groups[w.code || 'THRESH'] = groups[w.code || 'THRESH'] || []).push(w);
  });
  console.log('WARNINGS');
  Object.keys(groups).forEach(code => {
    const g = groups[code];
    if (code === 'VELOCITY' || code === 'PDM') {
      console.log(`  ${code} ×${g.length}`);
    } else {
      g.forEach(w => console.log(`  ${code}: ${w.message}`));
    }
  });
  console.log();
  return res;
}

// ---------------------------------------------------------------- run it
const m = base();
moveSourceToL3(m);
const bad = report('IRRATIONAL — source on L3, pump dead-ended on L1', m);

// ---- put it back the way it was and confirm it recovers ----
const m2 = base();
const good = report('RESTORED — source back on L1 ahead of the pump', m2);

console.log('='.repeat(78));
console.log('SUMMARY');
console.log('='.repeat(78));
const badPump = m.pipes.find(p => p.kind === 'pump');
console.log(`irrational : pump flow ${Ls(bad.flow[badPump.id] || 0)} L/s, ` +
            `delivered ${bad.actual ? Ls(bad.actual.totalDelivered) : 'n/a'} of 100.00 L/s`);
const goodPump = m2.pipes.find(p => p.kind === 'pump');
console.log(`restored   : pump flow ${Ls(good.flow[goodPump.id])} L/s @ ` +
            `${goodPump.pump.head.toFixed(2)} m, all demands met = ` +
            `${!good.actual}`);

const out = path.join(__dirname, '..', 'examples', 'irrational-source-on-L3.pnet.json');
fs.writeFileSync(out, JSON.stringify(M.toJSON(m), null, 2));
console.log('\nIrrational model written to examples/irrational-source-on-L3.pnet.json');
