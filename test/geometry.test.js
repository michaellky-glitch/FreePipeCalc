/* FreePipeCalc — geometry editing tests (spec §6).
 * Run:  node test/geometry.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/network.js', 'src/geometry.js']);
const M = FD.model, G = FD.geometry;
const fs = require('fs');
const path = require('path');

const MODEL_FILE = path.join(__dirname, '..', 'examples', '3-floor-riser-test.pnet.json');
const loadTest = () => M.fromJSON(JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')));

const len = (m, id) => M.pipeLength(m, M.pipe(m, id));

section('Straight run — far side translates, lengths preserved');
{
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0), c = M.addNode(m, lv, 20, 0);
  const p1 = M.addPipe(m, a.id, b.id, { size: 'DN50' });
  const p2 = M.addPipe(m, b.id, c.id, { size: 'DN50' });

  const r = G.changeLength(m, p1.id, 15);
  ok('Change succeeds', r.ok, JSON.stringify(r));
  near('Edited pipe is now 15 m', len(m, p1.id), 15, 1e-9);
  near('Downstream pipe keeps its length', len(m, p2.id), 10, 1e-9);
  near('Downstream node translated', M.worldXY(m, c).x, 25, 1e-9);
  ok('Only the edited pipe changed length',
     r.changes.length === 1 && r.changes[0].pipe === p1.id, JSON.stringify(r.changes));

  // shortening works too
  G.changeLength(m, p1.id, 4);
  near('Shortening also preserves downstream', len(m, p2.id), 10, 1e-9);
  near('...and applies the new length', len(m, p1.id), 4, 1e-9);
}

section('TEST 1 — source→pump length change moves all three floors together');
{
  const m = loadTest();
  // supply chain: source -> (2 m) -> pumpIn ; that first pipe is the one edited
  const source = m.nodes.find(n => n.device && n.device.kind === 'source');
  const supply = M.pipesAt(m, source.id)[0];
  near('Supply pipe starts at 2 m', len(m, supply.id), 2, 1e-9);

  // record world positions on every level, and all pipe lengths
  const worldBefore = {};
  m.nodes.forEach(n => { worldBefore[n.id] = M.worldXY(m, n); });
  const lenBefore = G.snapshotLengths(m);
  const colBefore = { x: m.risers[0].x, y: m.risers[0].y };

  const r = G.changeLength(m, supply.id, 5);
  ok('Change succeeds (not refused by the riser rule)', r.ok, JSON.stringify(r));
  near('Supply pipe is now 5 m', len(m, supply.id), 5, 1e-9);

  ok('Exactly one pipe changed length',
     r.changes.length === 1 && r.changes[0].pipe === supply.id, JSON.stringify(r.changes));

  // Every other pipe, on every floor, keeps its length
  let worstDelta = 0, worstId = null;
  m.pipes.forEach(p => {
    if (p.id === supply.id) return;
    const d = Math.abs(M.pipeLength(m, p) - lenBefore[p.id]);
    if (d > worstDelta) { worstDelta = d; worstId = p.id; }
  });
  ok(`No other pipe changed length (worst ${worstDelta.toExponential(1)} m at ${worstId})`,
     worstDelta < 1e-9);

  // Every node except the source moved by exactly the same world delta
  const deltas = {};
  m.nodes.forEach(n => {
    if (n.id === source.id) return;
    const w = M.worldXY(m, n);
    deltas[n.id] = { dx: w.x - worldBefore[n.id].x, dy: w.y - worldBefore[n.id].y };
  });
  const vals = Object.values(deltas);
  const dx0 = vals[0].dx, dy0 = vals[0].dy;
  ok('Every downstream node moved by an identical delta',
     vals.every(v => Math.abs(v.dx - dx0) < 1e-9 && Math.abs(v.dy - dy0) < 1e-9),
     `dx=${dx0.toFixed(4)} dy=${dy0.toFixed(4)}`);
  near('...and the delta is the 3 m the pipe grew by', Math.hypot(dx0, dy0), 3, 1e-9);
  near('Source itself did not move', M.worldXY(m, source).x, worldBefore[source.id].x, 1e-12);

  // All three floors present in the moved set
  const levelsMoved = new Set(m.nodes.filter(n => n.id !== source.id).map(n => n.level));
  ok('All three levels moved', levelsMoved.size === 3, String(levelsMoved.size));
  ok('Riser column moved with them', r.movedRisers === 1, String(r.movedRisers));
  near('Column tracked the same delta',
       Math.hypot(m.risers[0].x - colBefore.x, m.risers[0].y - colBefore.y), 3, 1e-9);

  // Riser attachments must still be coincident with the column
  m.risers[0].attachments.forEach(att => {
    const w = M.worldXY(m, M.node(m, att.node));
    ok(`Attachment on ${M.level(m, att.level).name} still sits on the column`,
       Math.abs(w.x - m.risers[0].x) < 1e-9 && Math.abs(w.y - m.risers[0].y) < 1e-9);
  });

  // And it still solves to the same numbers
  const res = FD.network.solveModel(m);
  ok('Model still solves after the move', res.ok, JSON.stringify(res.errors));
}

section('TEST 2 — L1 top edge 20→30 m is a geometry conflict');
{
  const m = loadTest();
  const L1 = m.levels.find(l => l.name === 'Level 1');
  // top edge runs (0,50) -> (20,50) on Level 1
  const top = m.pipes.find(p => {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return a.level === L1.id && b.level === L1.id &&
           a.y === 50 && b.y === 50 && Math.abs(a.x - b.x) === 20;
  });
  ok('Found the Level 1 top edge', !!top);
  near('...and it is 20 m', len(m, top.id), 20, 1e-9);

  const lenBefore = G.snapshotLengths(m);
  const r = G.changeLength(m, top.id, 30);
  ok('Change is refused', r.ok === false, JSON.stringify(r));
  ok('...with a LOOP code', r.code === 'LOOP', r.code);
  ok('...naming the loop members to highlight', r.cycle && r.cycle.length >= 3,
     JSON.stringify(r.cycle));
  ok('...and the model is untouched',
     m.pipes.every(p => Math.abs(M.pipeLength(m, p) - lenBefore[p.id]) < 1e-12));

  // The highlighted cycle must be the ring, and must include the bottom edge
  const bottom = m.pipes.find(p => {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return a.level === L1.id && b.level === L1.id && a.y === 0 && b.y === 0;
  });
  ok('The highlighted loop includes the opposite (bottom) edge',
     r.cycle.indexOf(bottom.id) >= 0, JSON.stringify(r.cycle));
}

section('TEST 2b — Repair stretches the bottom edge to match');
{
  const m = loadTest();
  const L1 = m.levels.find(l => l.name === 'Level 1');
  const onL1 = p => {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return a.level === L1.id && b.level === L1.id;
  };
  const top = m.pipes.find(p => onL1(p) && M.node(m, p.a).y === 50 && M.node(m, p.b).y === 50);
  const bottom = m.pipes.find(p => onL1(p) && M.node(m, p.a).y === 0 && M.node(m, p.b).y === 0);

  near('Bottom starts at 20 m', len(m, bottom.id), 20, 1e-9);
  const lenBefore = G.snapshotLengths(m);

  const r = G.repairLength(m, top.id, 30);
  ok('Repair succeeds', r.ok, JSON.stringify(r));
  near('Top is now 30 m', len(m, top.id), 30, 1e-9);
  near('Bottom stretched to 30 m to match', len(m, bottom.id), 30, 1e-9);
  ok('Repair cut the bottom edge', r.cutPipe === bottom.id, r.cutPipe);

  // Exactly two pipes should have changed
  ok('Exactly two pipes changed length', r.changes.length === 2,
     JSON.stringify(r.changes.map(c => c.pipe)));
  const ids = r.changes.map(c => c.pipe).sort();
  ok('...and they are the top and bottom edges',
     ids.join() === [top.id, bottom.id].sort().join(), ids.join());

  // The change report must carry old -> new for the window
  r.changes.forEach(c => {
    ok(`Change record for ${c.pipe} has node ids and both lengths`,
       !!c.from && !!c.to && c.oldLength > 0 && c.newLength > 0,
       JSON.stringify(c));
  });
  const bot = r.changes.find(c => c.pipe === bottom.id);
  near('Bottom record reads 20 → 30', bot.oldLength, 20, 1e-9);
  near('...to 30', bot.newLength, 30, 1e-9);

  // Left and right edges must be untouched
  const sides = m.pipes.filter(p => onL1(p) && M.node(m, p.a).x === M.node(m, p.b).x);
  ok('Vertical edges kept their lengths',
     sides.every(p => Math.abs(M.pipeLength(m, p) - lenBefore[p.id]) < 1e-9));

  // Still solvable
  const res = FD.network.solveModel(m);
  ok('Repaired model solves', res.ok, JSON.stringify(res.errors));
}

section('Repair refuses rather than guessing when it cannot fit');
{
  // Triangle: no member is parallel to the edited one, so a single-cut
  // translation cannot land the requested length.
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0), c = M.addNode(m, lv, 5, 8);
  const ab = M.addPipe(m, a.id, b.id, { size: 'DN50' });
  M.addPipe(m, b.id, c.id, { size: 'DN50' });
  M.addPipe(m, c.id, a.id, { size: 'DN50' });

  const before = G.snapshotLengths(m);
  const r = G.repairLength(m, ab.id, 30);
  if (r.ok) {
    // If it did find a fit, the requested length must actually hold
    near('If repaired, the requested length holds', len(m, ab.id), 30, 1e-6);
  } else {
    ok('Refuses with an explanation rather than mangling the model',
       /could not repair/i.test(r.message), r.message);
    ok('...and leaves every length untouched',
       m.pipes.every(p => Math.abs(M.pipeLength(m, p) - before[p.id]) < 1e-9));
  }
}

section('Riser torn in two is refused');
{
  /* Two riser columns pin a level at both ends. Editing a pipe between them
   * would move one attachment and not the other. */
  const m = M.create();
  const L1 = m.levels[0];
  const L2 = M.addLevel(m, { name: 'L2', altitude: 4 });

  const a1 = M.addNode(m, L1.id, 0, 0), b1 = M.addNode(m, L1.id, 10, 0);
  const a2 = M.addNode(m, L2.id, 0, 0), b2 = M.addNode(m, L2.id, 10, 0);
  const mid = M.addPipe(m, a1.id, b1.id, { size: 'DN50' });
  M.addPipe(m, a2.id, b2.id, { size: 'DN50' });

  const c1 = M.addRiser(m, 0, 0);
  M.attachRiser(m, c1.id, L1.id, a1.id);
  M.attachRiser(m, c1.id, L2.id, a2.id);
  const c2 = M.addRiser(m, 10, 0);
  M.attachRiser(m, c2.id, L1.id, b1.id);
  M.attachRiser(m, c2.id, L2.id, b2.id);
  M.riserPipes(m);

  const before = G.snapshotLengths(m);
  const r = G.changeLength(m, mid.id, 15);
  ok('Refused', r.ok === false, JSON.stringify(r));
  ok('...as a loop or a torn riser', r.code === 'RISER_TORN' || r.code === 'LOOP', r.code);
  ok('...leaving the model untouched',
     m.pipes.every(p => Math.abs(M.pipeLength(m, p) - before[p.id]) < 1e-9));
}

section('TEST 3 — changing L2 altitude leaves L3 alone');
{
  const m = loadTest();
  const L1 = m.levels.find(l => l.name === 'Level 1');
  const L2 = m.levels.find(l => l.name === 'Level 2');
  const L3 = m.levels.find(l => l.name === 'Level 3');

  const l3NodesBefore = m.nodes.filter(n => n.level === L3.id)
    .map(n => ({ id: n.id, z: M.elevation(m, n), w: M.worldXY(m, n) }));

  M.setLevelAltitude(m, L2.id, 3);

  near('L2 is now at 3 m', L2.altitude, 3, 1e-12);
  near('L1 unchanged at 0 m', L1.altitude, 0, 1e-12);
  near('L3 unchanged at 10 m', L3.altitude, 10, 1e-12);

  const moved = m.nodes.filter(n => n.level === L3.id).some((n, i) => {
    const b = l3NodesBefore[i];
    return Math.abs(M.elevation(m, n) - b.z) > 1e-12 ||
           Math.abs(M.worldXY(m, n).x - b.w.x) > 1e-12;
  });
  ok('No Level 3 node moved in elevation or plan', !moved);

  // Riser segment lengths must follow the new altitudes
  const risers = m.pipes.filter(p => p.kind === 'riser').map(p => {
    const a = M.node(m, p.a), b = M.node(m, p.b);
    return {
      levels: [M.level(m, a.level).name, M.level(m, b.level).name].sort().join('-'),
      len: M.pipeLength(m, p)
    };
  });
  const l12 = risers.find(r => r.levels === 'Level 1-Level 2');
  const l23 = risers.find(r => r.levels === 'Level 2-Level 3');
  near('L1→L2 riser is now 3 m', l12.len, 3, 1e-9);
  near('L2→L3 riser is now 7 m', l23.len, 7, 1e-9);
  near('Total lift is still 10 m', l12.len + l23.len, 10, 1e-9);

  const res = FD.network.solveModel(m);
  ok('Model solves after the altitude change', res.ok, JSON.stringify(res.errors));

  const l3Demand = m.nodes.find(n => n.level === L3.id && n.device && n.device.kind === 'demand');
  near('Level 3 demand is still at 10 m elevation', M.elevation(m, l3Demand), 10, 1e-12);
}

report();
