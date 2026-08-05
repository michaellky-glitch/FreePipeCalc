/* FreePipeCalc — geometry editing tests (spec §6).
 * Run:  node test/geometry.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/network.js', 'src/geometry.js', 'src/dxf.js']);
const M = FD.model, G = FD.geometry;
const fs = require('fs');
const path = require('path');

const MODEL_FILE = path.join(__dirname, 'fixtures', '3-floor-riser-test.pnet.json');
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

/* --------------------------------------------------------------------------
 * A pipe in the layout is LEVEL, and its length is the plan distance.
 *
 * Michael's rule (v0.7.8-dev): everything drawn on a level runs horizontally at
 * that level's z, and only a riser changes height. The length an engineer takes
 * off a layout is the horizontal one, and that stays true when pipe gradients
 * arrive in v2 or v3.
 *
 * Before the rule, `pipeLength` measured along the slope while `changeLength`
 * compared against the plan distance — so a sloped pipe reported "already that
 * length, nothing to do" and could not be edited at all. That is the symptom
 * Michael hit in debug/20260802-1.json. Both sides now speak plan distance, and
 * a sloped pipe is reported rather than measured either way.
 * ----------------------------------------------------------------------- */
section('Layout pipes are level, and edit on their plan length');
{
  const build = (rise) => {
    const m = M.create();
    const lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0);
    const b = M.addNode(m, lv, 50, 0);
    a.dz = rise;                       // illegal if non-zero — that is the point
    const p = M.addPipe(m, a.id, b.id, { size: 'DN50', schedule: 'sch40' });
    return { m, p, a, b };
  };

  const flat = build(0);
  near('A level pipe is its plan distance', M.pipeLength(flat.m, flat.p), 50, 1e-12);
  ok('...and raises nothing',
     !FD.network.disconnections(flat.m).some(d => d.code === 'SLOPED_PIPE'));
  ok('Editing it is applied', G.changeLength(flat.m, flat.p.id, 37).ok === true);
  near('...to exactly the requested length', M.pipeLength(flat.m, flat.p), 37, 1e-9);

  /* A 20 m rise across a 50 m plan run. The slope distance would be
   * sqrt(50^2 + 20^2) = 53.8516480713450, and that number must NOT appear. */
  const sloped = build(20);
  near('A sloped pipe still reports its PLAN length',
       M.pipeLength(sloped.m, sloped.p), 50, 1e-12);
  ok('...and is not measured along the slope',
     Math.abs(M.pipeLength(sloped.m, sloped.p) - Math.sqrt(2900)) > 3);
  near('The rise is available separately', M.pipeRise(sloped.m, sloped.p), -20, 1e-12);

  const issues = FD.network.disconnections(sloped.m).filter(d => d.code === 'SLOPED_PIPE');
  ok('It is reported', issues.length === 1);
  ok('...as an error, not a warning', issues[0].severity === 'error');
  ok('...naming the pipe', issues[0].pipe === sloped.p.id);
  near('...and carrying the rise', Math.abs(issues[0].rise), 20, 1e-12);

  /* The edit that used to be swallowed. 50 -> 40 must move the far node by
   * exactly 10 m in plan, whatever the elevations are doing. */
  const r = G.changeLength(sloped.m, sloped.p.id, 40);
  ok('Editing a sloped pipe is applied, not swallowed',
     r.ok === true && r.changes.length === 1);
  near('...to exactly the requested length', M.pipeLength(sloped.m, sloped.p), 40, 1e-9);
  near('...by moving the far node 10 m in plan',
       M.worldXY(sloped.m, sloped.b).x - M.worldXY(sloped.m, sloped.a).x, 40, 1e-9);
  near('The rise is untouched by a length edit',
       M.pipeRise(sloped.m, sloped.p), -20, 1e-12);

  /* A length SHORTER than the rise is now perfectly ordinary — the two are
   * unrelated numbers. It was refused while length was measured in 3D. */
  const short = build(20);
  ok('A length shorter than the rise is allowed',
     G.changeLength(short.m, short.p.id, 5).ok === true);
  near('...and lands exactly', M.pipeLength(short.m, short.p), 5, 1e-9);

  // A riser is still purely vertical and still refuses a length edit.
  const fixture = loadTest();
  const riser = fixture.pipes.filter(x => x.kind === 'riser')[0] ||
                (FD.model.riserPipes(fixture),
                 fixture.pipes.filter(x => x.kind === 'riser')[0]);
  if (riser) {
    ok('A riser still refuses a typed length',
       G.changeLength(fixture, riser.id, 4).code === 'RISER');
  }
}

/* --------------------------------------------------------------------------
 * DXF EXPORT (EXPERIMENTAL)
 *
 * Structure only. Nothing here can open the file in AutoCAD or BricsCAD, which
 * is exactly why the feature is flagged experimental in the UI — the same "no
 * pixels" limit that governs every visual item, one step further out. What CAN
 * be checked is that the file is well formed R12: the sections in order, the
 * layer table matching the layers actually used, real metres in model space,
 * and risers as true verticals.
 * ----------------------------------------------------------------------- */
section('DXF export writes a well-formed R12 file');
{
  /* Two levels, a pipe on each, a device, and a riser between them — one of
   * everything the exporter handles. */
  function tower() {
    const m = M.create();
    const G = m.levels[0];
    G.name = 'Ground'; G.altitude = 0;
    const L1 = M.addLevel(m); L1.name = 'Level 1'; L1.altitude = 4;
    m.levels.sort((a, b) => b.altitude - a.altitude);

    const g1 = M.addNode(m, G.id, 0, 0), g2 = M.addNode(m, G.id, 6, 0);
    const gR = M.addNode(m, G.id, 10, 0);
    g1.tag = 'N-GND';
    M.addPipe(m, g1.id, g2.id, { size: 'DN50', schedule: 'sch40' });
    const pump = M.addPipe(m, g2.id, gR.id, { kind: 'pump' });
    pump.tag = 'CHWP-01'; pump.pump = { mode: 'auto', head: 20 };

    const a1 = M.addNode(m, L1.id, 10, 0), a2 = M.addNode(m, L1.id, 4, 0);
    M.addPipe(m, a1.id, a2.id, { size: 'DN50', schedule: 'sch40' });

    const r = M.addRiser(m, 10, 0);
    M.attachRiser(m, r.id, G.id, gR.id);
    M.attachRiser(m, r.id, L1.id, a1.id);
    M.riserPipes(m);
    return m;
  }

  const dxf = FD.dxf.build(tower());
  const L = dxf.split('\r\n');

  // ---- shape of the file
  ok('It starts with a SECTION', L[0] === '0' && L[1] === 'SECTION');
  ok('...and the first is the HEADER', L[2] === '2' && L[3] === 'HEADER');
  ok('It declares R12', dxf.indexOf('AC1009') > 0);
  /* Pairs are (code, value), so the value sits ONE line after its code:
   *     9 | $INSUNITS | 70 | 6 */
  ok('...in metres', L[L.indexOf('$INSUNITS') + 2] === '6',
     L.slice(L.indexOf('$INSUNITS'), L.indexOf('$INSUNITS') + 3).join('|'));
  ok('It ends with EOF', L[L.length - 2] === 'EOF', JSON.stringify(L.slice(-3)));
  ok('Sections are balanced',
     L.filter(v => v === 'SECTION').length === L.filter(v => v === 'ENDSEC').length,
     L.filter(v => v === 'SECTION').length + ' vs ' + L.filter(v => v === 'ENDSEC').length);
  ok('There are three of them', L.filter(v => v === 'SECTION').length === 3);
  ok('Lines are CRLF-terminated', dxf.indexOf('\r\n') > 0);

  // ---- the LAYER table must match what the entities actually use
  {
    /* Walked as PAIRS throughout. Scanning for a bare '8' finds every
     * coordinate that happens to equal 8 as well — the naive version of this
     * check reported the ACI colour as an undeclared layer. */
    const declared = [];
    for (let i = 0; i < L.length - 1; i += 2) {
      if (L[i] === '0' && L[i + 1] === 'LAYER') {
        for (let j = i + 2; j < L.length - 1 && L[j] !== '0'; j += 2) {
          if (L[j] === '2') { declared.push(L[j + 1]); break; }
        }
      }
    }
    const used = new Set();
    for (let i = 0; i < L.length - 1; i += 2) {
      if (L[i] === '8') used.add(L[i + 1]);
    }
    ok('Every layer used is declared',
       [...used].every(u => declared.indexOf(u) >= 0),
       [...used].filter(u => declared.indexOf(u) < 0).join(', '));
    const tblAt = L.indexOf('LAYER');
    ok('...and the table count matches',
       Number(L[tblAt + 2]) === declared.length,
       L[tblAt + 2] + ' vs ' + declared.length);
    ok('Layers are named per level and per kind',
       declared.some(d => /^FPC-Ground-PIPE$/.test(d)) &&
       declared.some(d => /^FPC-Level_1-PIPE$/.test(d)),
       declared.join(', '));
  }

  // ---- entities, and REAL metres
  function entities(kind) {
    const out = [];
    for (let i = 0; i < L.length - 1;) {
      if (L[i] === '0' && L[i + 1] === kind) {
        let j = i + 2; const e = {};
        while (j < L.length - 1 && L[j] !== '0') { e[L[j]] = L[j + 1]; j += 2; }
        out.push(e); i = j;
      } else i += 2;
    }
    return out;
  }

  const lines = entities('LINE');
  ok('Pipes come out as LINE entities', lines.length >= 3, String(lines.length));
  {
    /* The 6 m pipe on the ground floor is 6 m in the file — model space at true
     * size, no page transform. That is the whole reason this exporter is
     * simpler than the SVG one. */
    const six = lines.filter(e =>
      Math.abs(Math.hypot(+e['11'] - +e['10'], +e['21'] - +e['20']) - 6) < 1e-9);
    ok('A 6 m pipe is 6 m in the file — metres, at true size', six.length >= 1);
  }
  {
    /* RISERS ARE TRUE VERTICALS: same x and y, 4 m of Z. On a stack of flat
     * plans a riser is a marker to interpret; in 3D it is simply there. */
    const vert = lines.filter(e => /RISER/.test(e['8'] || ''));
    ok('The riser is exported', vert.length === 1, String(vert.length));
    const v = vert[0];
    near('...vertical in X', +v['10'], +v['11'], 1e-9);
    near('...vertical in Y', +v['20'], +v['21'], 1e-9);
    near('...spanning the floor-to-floor height', Math.abs(+v['31'] - +v['30']), 4, 1e-9);
  }

  ok('The pump becomes a CIRCLE and a chevron',
     entities('CIRCLE').length >= 1);
  {
    const texts = entities('TEXT');
    ok('Tags are written as TEXT', texts.some(e => e['1'] === 'CHWP-01'),
       texts.map(e => e['1']).join(','));
    ok('...and so are node tags', texts.some(e => e['1'] === 'N-GND'));
    ok('Text has a real model height',
       texts.every(e => +e['40'] > 0.05 && +e['40'] < 1));
  }

  /* NON-ASCII IS TRANSLITERATED. R12 has no escaping and no UTF-8 guarantee, so
   * a Δ or a ° in a tag would come out as mojibake in a reader that assumes the
   * drawing's own code page. */
  {
    ok('Delta becomes d', FD.dxf.ascii('\u0394T') === 'dT');
    ok('Degree becomes deg', FD.dxf.ascii('45\u00b0C') === '45degC');
    ok('An arrow becomes a hyphen', FD.dxf.ascii('a \u2192 b') === 'a - b');
    ok('Anything else becomes a question mark',
       FD.dxf.ascii('\u4e2d') === '?');
    ok('Plain ASCII is untouched', FD.dxf.ascii('AHU-1 DN50') === 'AHU-1 DN50');
  }

  /* An empty model must not produce a broken file. */
  {
    const empty = FD.dxf.build(M.create());
    ok('An empty model still writes a valid file',
       empty.indexOf('EOF') > 0 &&
       empty.split('\r\n').filter(v => v === 'SECTION').length === 3);
  }
}

report();
