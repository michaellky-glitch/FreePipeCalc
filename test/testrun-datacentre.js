/* Test run — data centre: redundant pumps into a redundant ring main.
 *
 * CLOSED circuit (no source):
 *   4 pumps at L1 (only P-01 running) → supply header → 10 m → L1 ring main
 *   → 1 m branch → EQUIPMENT (20 L/s, 200 kPa) → riser +0.5 m to L1A
 *   → L1A ring → 10 m → risers back down to the pump suctions.
 *
 * Both rings are 20 m × 50 m.
 *
 * L1  @ 10.00   L1A @ 10.50
 *
 * Run:  node test/testrun-datacentre.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'src/network.js']);
const M = FD.model;

const SIZE = 'DN100', SCH = 'sch40';
const Ls = q => (q * 1000).toFixed(2);
const kPa = p => (p / 1000).toFixed(1);
const padr = (s, n) => String(s).padEnd(n);
const pad = (s, n) => String(s).padStart(n);

function build() {
  const m = M.create();
  m.settings.schedule = SCH;
  m.settings.systemType = 'closed';
  m.settings.meta.project = 'Data centre — redundant ring main';
  m.settings.meta.system = 'CHW, N+1 pumps, dual ring';

  const L1 = m.levels[0];
  L1.name = 'Level 1';
  M.setLevelAltitude(m, L1.id, 10);
  const L1A = M.addLevel(m, { name: 'Level 1A', altitude: 10.5 });

  const P = (a, b, o) => M.addPipe(m, a.id, b.id,
    Object.assign({ size: SIZE, schedule: SCH }, o || {}));

  // ---------------------------------------------------------------- L1
  const N = (x, y) => M.addNode(m, L1.id, x, y);

  /* Pump hall. Four pumps on 2.5 m centres. Each pump sits between a suction
   * node (fed by a riser down from L1A) and a discharge node, and each
   * discharge rises 2.5 m to the supply header. */
  const suction = [], discharge = [], pumps = [];
  for (let i = 0; i < 4; i++) {
    const x = i * 2.5;
    const suc = N(x, -2.5);          // riser lands here
    const dis = N(x, -2.3);          // short pump body
    suction.push(suc); discharge.push(dis);
    pumps.push(P(suc, dis, {
      kind: 'pump',
      tag: 'CHW-P-0' + (i + 1),
      pump: { mode: i === 0 ? 'auto' : 'off', head: 0, flow: 0 }
    }));
  }

  /* Return header at y = 0 (pump discharges rise 2.5 m into it) and supply
   * header at y = 5 — the "5 m" on the sketch. */
  const retH = [], supH = [];
  for (let i = 0; i < 4; i++) {
    const x = i * 2.5;
    retH.push(N(x, 0));
    supH.push(N(x, 5));
    P(discharge[i], retH[i]);        // 2.3 m of the 2.5 m rise (pump takes 0.2)
    P(retH[i], supH[i]);             // 5 m
  }
  for (let i = 0; i < 3; i++) {
    P(retH[i], retH[i + 1]);         // 2.5 m
    P(supH[i], supH[i + 1]);         // 2.5 m
  }

  /* Ring main on L1: 20 wide × 50 tall, fed from BOTH headers — that is the
   * redundancy. Local origin: bottom-left of the ring at (17.5, -10). */
  const RX = 17.5, RY = -10;
  const ringBL = N(RX, RY), ringBR = N(RX + 20, RY);
  const ringTL = N(RX, RY + 50), ringTR = N(RX + 20, RY + 50);
  const feedLow = N(RX, RY + 10);        // 10 m up the left edge  (lower header)
  const feedHigh = N(RX, RY + 15);       // 5 m above that         (upper header)
  const equipTee = N(RX + 20, RY + 30);  // 20 m down from top-right

  P(ringBL, feedLow);                    // 10 m
  P(feedLow, feedHigh);                  // 5 m
  P(feedHigh, ringTL);                   // 35 m
  P(ringTL, ringTR);                     // 20 m
  P(ringTR, equipTee);                   // 20 m
  P(equipTee, ringBR);                   // 30 m
  P(ringBR, ringBL);                     // 20 m

  P(supH[3], feedHigh);                  // 10 m — supply header into the ring
  P(retH[3], feedLow);                   // 10 m — return header into the ring

  // Equipment branch: 1 m out of the ring, then the unit itself
  const eqIn = N(RX + 21, RY + 30);
  const eqOut = N(RX + 21.3, RY + 30);
  P(equipTee, eqIn);                     // 1 m
  const equip = P(eqIn, eqOut, {
    kind: 'equip', tag: 'CRAH-01',
    equip: { qRated: 0.020, pdRated: 200000, qOut: 0.020 }
  });

  // --------------------------------------------------------------- L1A
  const NA = (x, y) => M.addNode(m, L1A.id, x, y);
  const aBL = NA(RX, RY), aBR = NA(RX + 20, RY);
  const aTL = NA(RX, RY + 50), aTR = NA(RX + 20, RY + 50);
  const aRiserIn = NA(RX + 20, RY + 30);   // riser up from the equipment outlet
  const aFeed = NA(RX, RY + 10);           // 10 m up the left edge

  P(aFeed, aTL);                           // 40 m
  P(aTL, aTR);                             // 20 m
  P(aTR, aRiserIn);                        // 20 m
  P(aRiserIn, aBR);                        // 30 m
  P(aBR, aBL);                             // 20 m
  P(aBL, aFeed);                           // 10 m

  const aHeader = NA(RX - 10, RY + 10);    // 10 m out to the riser drop point
  P(aFeed, aHeader);                       // 10 m

  // ------------------------------------------------------------- risers
  // equipment outlet -> up to L1A ring
  const rEquip = M.addRiser(m, RX + 21, RY + 30);
  M.attachRiser(m, rEquip.id, L1A.id, aRiserIn.id);
  M.attachRiser(m, rEquip.id, L1.id, eqOut.id);

  /* Four return risers from L1A back down to the pump suctions. They all start
   * from the one header point on L1A, so short connectors fan out to the four
   * riser positions. */
  for (let i = 0; i < 4; i++) {
    const x = i * 2.5;
    const drop = NA(x, -2.5);
    P(aHeader, drop);
    const r = M.addRiser(m, x, -2.5);
    M.attachRiser(m, r.id, L1A.id, drop.id);
    M.attachRiser(m, r.id, L1.id, suction[i].id);
  }

  M.riserPipes(m);
  return { m, pumps, equip, L1, L1A, suction, ringBR, equipTee };
}

// ------------------------------------------------------------------ run
const built = build();
const m = built.m;

console.log('='.repeat(78));
console.log('DATA CENTRE — redundant pumps into redundant ring main (CLOSED circuit)');
console.log('='.repeat(78));
console.log(`levels     : L1 @ 10.00 m, L1A @ 10.50 m`);
console.log(`nodes/pipes: ${m.nodes.length} / ${m.pipes.length}`);
console.log(`pumps      : ${built.pumps.map(p => p.tag + '(' + p.pump.mode + ')').join(', ')}`);
console.log(`equipment  : ${built.equip.tag} — ${Ls(built.equip.equip.qRated)} L/s @ ` +
            `${kPa(built.equip.equip.pdRated)} kPa`);
console.log();

const res = FD.network.solveModel(m);

console.log(`converged  : ${res.converged}`);
console.log(`errors     : ${res.errors.length ? JSON.stringify(res.errors.map(e => e.code)) : 'none'}`);
if (res.errors.length) {
  res.errors.forEach(e => console.log(`   ${e.code}: ${e.message}`));
}
console.log();

console.log('PUMPS');
built.pumps.forEach(p => {
  console.log('  ' + padr(p.tag, 10) + padr(p.pump.mode, 7) +
    pad('head ' + (p.pump.head || 0).toFixed(2) + ' m', 16) +
    pad('flow ' + Ls(res.flow[p.id] || 0) + ' L/s', 20));
});
console.log();

console.log('EQUIPMENT');
{
  const q = res.flow[built.equip.id];
  const link = res.network.links.find(l => l.id === built.equip.id);
  console.log('  ' + padr(built.equip.tag, 10) +
    'flow ' + Ls(q || 0) + ' L/s   ' +
    (link ? 'ΔP ' + kPa(998 * 9.81 * Math.abs(FD.hydraulics.headloss(link.r, q, link.n))) + ' kPa'
          : ''));
}
console.log();

const codes = {};
(res.warnings || []).forEach(w => { codes[w.code] = (codes[w.code] || 0) + 1; });
console.log('WARNINGS');
Object.keys(codes).forEach(c => {
  if (c === 'VELOCITY' || c === 'PDM') console.log(`  ${c} ×${codes[c]}`);
  else (res.warnings.filter(w => w.code === c)).forEach(w => console.log(`  ${c}: ${w.message}`));
});
if (!Object.keys(codes).length) console.log('  none');
console.log();

const out = path.join(__dirname, '..', 'examples', 'datacentre-ring.pnet.json');
fs.writeFileSync(out, JSON.stringify(M.toJSON(m), null, 2));
console.log('Model written to examples/datacentre-ring.pnet.json');
