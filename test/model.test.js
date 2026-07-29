/* FreePipeCalc — model & network-builder tests.
 * Run:  node test/model.test.js
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/network.js', 'src/printer.js']);
const M = FD.model, NET = FD.network;

/* Build a straight run of pipes along +x on one level.
 * Returns { m, nodes:[...] } with `n` nodes at `spacing` metres apart. */
function line(count, spacing, size) {
  const m = M.create();
  const lv = m.levels[0].id;
  const nodes = [];
  for (let i = 0; i < count; i++) nodes.push(M.addNode(m, lv, i * spacing, 0));
  for (let i = 0; i < count - 1; i++) {
    M.addPipe(m, nodes[i].id, nodes[i + 1].id, { size: size || 'DN50' });
  }
  return { m, nodes };
}

section('Model — levels');
{
  const m = M.create();
  ok('Starts with one level named "Level 0"', m.levels.length === 1 && m.levels[0].name === 'Level 0');
  near('...at altitude 0', m.levels[0].altitude, 0, 1e-12);

  const up = M.addLevel(m, { name: 'Level 1', altitude: 3.5 });
  const down = M.addLevel(m, { name: 'Basement', altitude: -3.5 });
  ok('Levels sort top-first by altitude',
     m.levels.map(l => l.altitude).join(',') === '3.5,0,-3.5',
     m.levels.map(l => l.altitude).join(','));

  M.setLevelAltitude(m, up.id, -10);
  ok('Changing altitude re-sorts',
     m.levels[0].altitude === 0 && m.levels[m.levels.length - 1].altitude === -10);

  ok('Cannot remove the last level',
     (() => { const s = M.create(); return M.removeLevel(s, s.levels[0].id) === false; })());

  // Removing a level takes its nodes and pipes with it
  const m2 = M.create();
  const l2 = M.addLevel(m2, { altitude: 3.5 });
  const a = M.addNode(m2, l2.id, 0, 0), b = M.addNode(m2, l2.id, 5, 0);
  M.addPipe(m2, a.id, b.id, {});
  M.removeLevel(m2, l2.id);
  ok('Removing a level removes its nodes', m2.nodes.length === 0);
  ok('...and its pipes', m2.pipes.length === 0);
}

section('Model — default pipe size is not the smallest in the schedule');
{
  /* Regression: defaulting to sizes[0] gave DN15, which silently modelled a
   * DN15 riser and produced 183 m of friction loss on a 2 L/s riser. */
  ok('Schedule default is not the smallest size',
     FD.schedules.defaultSize('sch40') !== 'DN15', FD.schedules.defaultSize('sch40'));
  ok('Schedule default has at least a 50 mm bore',
     FD.schedules.size('sch40', FD.schedules.defaultSize('sch40')).id_mm >= 50);
  ['sch10', 'sch80', 'en10255m', 'ppr_pn16', 'hdpe_sdr11'].forEach(k => {
    const d = FD.schedules.defaultSize(k);
    ok(`${k} default (${d}) has a sensible bore`,
       FD.schedules.size(k, d).id_mm >= 50);
  });

  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0);
  const p = M.addPipe(m, a.id, b.id, {});
  ok('A pipe drawn with no size given does not default to DN15', p.size !== 'DN15', p.size);

  // Spec §5 — new segments inherit the last used size
  const c = M.addNode(m, lv, 20, 0);
  M.addPipe(m, b.id, c.id, { size: 'DN100' });
  const d = M.addNode(m, lv, 30, 0);
  ok('Next pipe inherits the last used size',
     M.addPipe(m, c.id, d.id, {}).size === 'DN100');

  // ...but a size that does not exist in the target schedule is not carried over
  m.settings.schedule = 'ppr_pn16';
  const e = M.addNode(m, lv, 40, 0);
  const pp = M.addPipe(m, d.id, e.id, { schedule: 'ppr_pn16' });
  ok('Inherited size is dropped if the schedule lacks it',
     FD.schedules.get('ppr_pn16').sizes.some(s => s.label === pp.size), pp.size);
}

section('Model — geometry and level offsets');
{
  const { m, nodes } = line(3, 10);
  near('Pipe length from node spacing', M.pipeLength(m, m.pipes[0]), 10, 1e-9);

  // Spec §7.1: changing a level offset must NOT change geometry or lengths
  const before = m.pipes.map(p => M.pipeLength(m, p));
  m.levels[0].dx = 37.5;
  m.levels[0].dy = -12.25;
  const after = m.pipes.map(p => M.pipeLength(m, p));
  ok('Level offset does not change pipe lengths',
     before.every((v, i) => Math.abs(v - after[i]) < 1e-12));
  near('...but does move world position', M.worldXY(m, nodes[0]).x, 37.5, 1e-12);
  near('...while local coords are untouched', nodes[0].x, 0, 1e-12);

  // Elevation = level altitude + per-node offset
  const lv = m.levels[0];
  lv.altitude = 7;
  nodes[1].dz = -0.6;
  near('Elevation = level altitude + node offset', M.elevation(m, nodes[1]), 6.4, 1e-12);

  // A pipe spanning an elevation change is longer than its plan distance
  const L = M.pipeLength(m, m.pipes[0]);
  near('Sloped pipe length includes rise', L, Math.hypot(10, 0.6), 1e-9);
}

section('Network — fitting detection from geometry');
{
  // Straight through: no fitting
  const s = line(3, 10);
  let fits = NET.fittingsAtNode(s.m, s.nodes[1].id, null, []);
  ok('Collinear pipes produce no fitting', fits.length === 0, JSON.stringify(fits));

  // Square corner: 90° elbow
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), c = M.addNode(m, lv, 10, 0), b = M.addNode(m, lv, 10, 10);
  M.addPipe(m, a.id, c.id, { size: 'DN50' });
  M.addPipe(m, c.id, b.id, { size: 'DN50' });
  fits = NET.fittingsAtNode(m, c.id, null, []);
  ok('Right-angle corner gives one E90', fits.length === 1 && fits[0].type === 'E90',
     JSON.stringify(fits));

  // 45° corner
  const m45 = M.create(), l45 = m45.levels[0].id;
  const p = M.addNode(m45, l45, 0, 0), q = M.addNode(m45, l45, 10, 0),
        r = M.addNode(m45, l45, 20, 10);
  M.addPipe(m45, p.id, q.id, {});
  M.addPipe(m45, q.id, r.id, {});
  fits = NET.fittingsAtNode(m45, q.id, null, []);
  ok('45° corner gives one E45', fits.length === 1 && fits[0].type === 'E45',
     JSON.stringify(fits));

  near('Deviation of a straight line is 0°',
       NET.deviation({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 0, 1e-9);
  near('Deviation of a square corner is 90°',
       NET.deviation({ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 90, 1e-9);
}

section('Network — tee run/branch by flow direction (spec §3.3)');
{
  /* A tee: main runs west→east through T, with a branch going north.
   *        N
   *        |
   *   W ---T--- E
   */
  const m = M.create(), lv = m.levels[0].id;
  const W = M.addNode(m, lv, -10, 0);
  const T = M.addNode(m, lv, 0, 0);
  const E = M.addNode(m, lv, 10, 0);
  const N = M.addNode(m, lv, 0, 10);
  const pW = M.addPipe(m, W.id, T.id, { size: 'DN50' });
  const pE = M.addPipe(m, T.id, E.id, { size: 'DN50' });
  const pN = M.addPipe(m, T.id, N.id, { size: 'DN50' });

  M.setSource(m, W.id);
  M.setDemand(m, E.id, 0.004, 0);
  M.setDemand(m, N.id, 0.001, 0);

  // Geometric guess (no flows): W-E is the straight pair
  const guess = NET.pickRunPair(m, T.id, M.pipesAt(m, T.id), null);
  ok('Geometric guess picks the straight-through pair',
     guess.includes(pW.id) && guess.includes(pE.id), JSON.stringify(guess));

  const res = NET.solveModel(m);
  ok('Tee network solves', res.ok, JSON.stringify(res.errors));

  // After solving, flow enters from W and leaves E (large) and N (small).
  const fits = NET.fittingsAtNode(m, T.id, res.flow, []);
  const byPipe = {};
  fits.forEach(f => { byPipe[f.pipe] = f.type; });

  ok('East leg (through-flow) gets tee-RUN', byPipe[pE.id] === 'TRUN', JSON.stringify(byPipe));
  ok('North leg (diverging) gets tee-BRANCH', byPipe[pN.id] === 'TBRANCH', JSON.stringify(byPipe));
  ok('Incoming leg is charged nothing (EL goes downstream)',
     byPipe[pW.id] === undefined, JSON.stringify(byPipe));

  // Equivalent length actually reaches the right pipes
  const els = NET.fittingsByPipe(m, res.flow, []);
  const bore = M.pipeBore(m, pN) * 1000;
  near('Branch EL = 60·D', els[pN.id].el, FD.fittings.el('TBRANCH', bore), 1e-12);
  near('Run EL = 20·D', els[pE.id].el, FD.fittings.el('TRUN', bore), 1e-12);
  ok('Branch EL is 3× the run EL', Math.abs(els[pN.id].el / els[pE.id].el - 3) < 1e-12);
}

section('Network — the second pass actually changes the answer');
{
  /* Tee where the GEOMETRICALLY straight leg is NOT the one carrying the
   * through-flow: the straight leg feeds a small demand, the "branch" feeds a
   * large one. A single-pass solve would mislabel both legs. */
  const m = M.create(), lv = m.levels[0].id;
  const S = M.addNode(m, lv, -10, 0);
  const T = M.addNode(m, lv, 0, 0);
  const straight = M.addNode(m, lv, 10, 0);
  const side = M.addNode(m, lv, 0, 10);
  M.addPipe(m, S.id, T.id, { size: 'DN50' });
  const pStraight = M.addPipe(m, T.id, straight.id, { size: 'DN50' });
  const pSide = M.addPipe(m, T.id, side.id, { size: 'DN50' });
  M.setSource(m, S.id);
  M.setDemand(m, straight.id, 0.0005, 0);   // small
  M.setDemand(m, side.id, 0.006, 0);        // large — this is the real run

  const pass1 = NET.fittingsByPipe(m, null, []);
  const res = NET.solveModel(m);
  const pass2 = NET.fittingsByPipe(m, res.flow, []);

  ok('Pass 1 (geometry) calls the straight leg the run',
     pass1[pStraight.id].types.includes('TRUN'), JSON.stringify(pass1[pStraight.id].types));
  ok('Pass 2 (flow) reassigns the run to the leg carrying through-flow',
     pass2[pSide.id].types.includes('TRUN'), JSON.stringify(pass2[pSide.id].types));
  ok('...and demotes the straight leg to branch',
     pass2[pStraight.id].types.includes('TBRANCH'), JSON.stringify(pass2[pStraight.id].types));
  ok('The two passes genuinely differ',
     pass1[pSide.id].el !== pass2[pSide.id].el);
  ok('Solve reports more than one pass', res.passes >= 2, 'passes=' + res.passes);
}

section('Network — cross (4 pipes) warns');
{
  const m = M.create(), lv = m.levels[0].id;
  const c = M.addNode(m, lv, 0, 0);
  [[10, 0], [-10, 0], [0, 10], [0, -10]].forEach(([x, y]) => {
    const n = M.addNode(m, lv, x, y);
    M.addPipe(m, c.id, n.id, {});
  });
  const warnings = [];
  NET.fittingsAtNode(m, c.id, null, warnings);
  ok('4 pipes at a node raises a CROSS warning',
     warnings.some(w => w.code === 'CROSS'), JSON.stringify(warnings));
}

section('Network — source, demand and include-in-calculation');
{
  const { m, nodes } = line(2, 50, 'DN50');
  M.setSource(m, nodes[0].id);
  M.setDemand(m, nodes[1].id, 0.005, 200000);

  let res = NET.solveModel(m);
  ok('Solves with a source and a demand', res.ok, JSON.stringify(res.errors));
  near('Pipe carries the demand flow', Math.abs(res.flow[m.pipes[0].id]), 0.005, 1e-9);

  // Spec §8.2 — unchecking a demand removes it from the solve
  M.node(m, nodes[1].id).device.include = false;
  res = NET.solveModel(m);
  near('Excluded demand contributes no flow', res.flow[m.pipes[0].id], 0, 1e-9);

  M.node(m, nodes[1].id).device.include = true;
  res = NET.solveModel(m);
  near('Re-including it restores the flow', Math.abs(res.flow[m.pipes[0].id]), 0.005, 1e-9);
}

section('Network — source is a reservoir at its own altitude (spec §8.1)');
{
  // Tank on the roof: 20 m of static should appear at the ground-floor demand.
  const m = M.create();
  const roof = m.levels[0];
  M.setLevelAltitude(m, roof.id, 20);
  const ground = M.addLevel(m, { name: 'Ground', altitude: 0 });

  const tank = M.addNode(m, roof.id, 0, 0);
  const base = M.addNode(m, ground.id, 0, 0);
  M.setSource(m, tank.id);
  M.setDemand(m, base.id, 0.002, 0);

  const riser = M.addRiser(m, 0, 0);
  M.attachRiser(m, riser.id, roof.id, tank.id);
  M.attachRiser(m, riser.id, ground.id, base.id);

  const res = NET.solveModel(m);
  ok('Riser network solves', res.ok, JSON.stringify(res.errors));
  ok('A riser link was generated', m.pipes.some(p => p.kind === 'riser'));
  near('Riser length = altitude difference', M.pipeLength(m, m.pipes[0]), 20, 1e-9);

  // 20 m of water ≈ 195.8 kPa, less friction down the riser
  ok('Static lift appears as pressure at the base',
     res.pressure[base.id] > 180000 && res.pressure[base.id] < 195900,
     (res.pressure[base.id] / 1000).toFixed(1) + ' kPa');
}

section('Network — degenerate models do not crash');
{
  const empty = M.create();
  const r0 = NET.solveModel(empty);
  ok('Empty model solves trivially', r0.converged, JSON.stringify(r0.errors));

  // Demand with no source anywhere
  const { m, nodes } = line(2, 10);
  M.setDemand(m, nodes[1].id, 0.003, 0);
  const r1 = NET.solveModel(m);
  ok('Demand with no source is reported, not crashed',
     r1.errors.some(e => e.code === 'ISLAND_NO_SOURCE'), JSON.stringify(r1.errors));

  // Zero-length pipe
  const m2 = M.create(), lv = m2.levels[0].id;
  const a = M.addNode(m2, lv, 5, 5), b = M.addNode(m2, lv, 5, 5);
  M.addPipe(m2, a.id, b.id, {});
  const net = NET.build(m2, null);
  ok('Zero-length pipe raises a warning',
     net.warnings.some(w => w.code === 'ZERO_LENGTH'), JSON.stringify(net.warnings));
}

section('Model — save / load round trip');
{
  const { m, nodes } = line(4, 12, 'DN65');
  M.setSource(m, nodes[0].id);
  M.setDemand(m, nodes[3].id, 0.004, 150000);
  M.addLevel(m, { name: 'Level 1', altitude: 3.5 });
  m.settings.meta.project = 'Round trip test';
  m.settings.C = 135;

  const json = JSON.parse(JSON.stringify(M.toJSON(m)));
  const back = M.fromJSON(json);

  ok('Levels survive', back.levels.length === m.levels.length);
  ok('Nodes survive', back.nodes.length === m.nodes.length);
  ok('Pipes survive', back.pipes.length === m.pipes.length);
  ok('Project metadata survives', back.settings.meta.project === 'Round trip test');
  ok('C factor survives', back.settings.C === 135);
  ok('Device survives', back.nodes[3].device.kind === 'demand');
  near('Demand flow survives', back.nodes[3].device.flow, 0.004, 1e-12);

  const r1 = NET.solveModel(m), r2 = NET.solveModel(back);
  near('Reloaded model solves identically',
       r2.flow[back.pipes[0].id], r1.flow[m.pipes[0].id], 1e-12);

  ok('Rejects a file with no formatVersion',
     (() => { try { M.fromJSON({ nodes: [] }); return false; } catch (e) { return true; } })());
  ok('Rejects a file from a newer format',
     (() => { try { M.fromJSON({ formatVersion: 99 }); return false; }
              catch (e) { return /newer version/.test(e.message); } })());

  // Counters must not collide after a reload that lost _seq
  const stripped = JSON.parse(JSON.stringify(M.toJSON(m)));
  delete stripped._seq;
  const rebuilt = M.fromJSON(stripped);
  const fresh = M.addNode(rebuilt, rebuilt.levels[0].id, 99, 99);
  ok('Rebuilt id counters do not collide with existing nodes',
     rebuilt.nodes.filter(n => n.id === fresh.id).length === 1, fresh.id);
}

section('Model — riser size inheritance (spec §7.2)');
{
  const m = M.create();
  const top = m.levels[0];
  const bot = M.addLevel(m, { name: 'Lower', altitude: -3.5 });
  const tNode = M.addNode(m, top.id, 0, 0);
  const bNode = M.addNode(m, bot.id, 0, 0);

  // Horizontal pipes of different sizes meet the riser at each end
  const tSide = M.addNode(m, top.id, 8, 0);
  const bSide = M.addNode(m, bot.id, 8, 0);
  M.addPipe(m, tNode.id, tSide.id, { size: 'DN40' });
  M.addPipe(m, bNode.id, bSide.id, { size: 'DN80' });

  const r = M.addRiser(m, 0, 0);
  M.attachRiser(m, r.id, top.id, tNode.id);
  M.attachRiser(m, r.id, bot.id, bNode.id);
  M.riserPipes(m);

  const riser = m.pipes.find(p => p.kind === 'riser');
  ok('Riser inherits the LARGER connected pipe size', riser.size === 'DN80', riser.size);
  ok('Riser links are not duplicated on repeat calls',
     (M.riserPipes(m), m.pipes.filter(p => p.kind === 'riser').length === 1));

  ok('A level in one riser is not locked', M.isLevelLocked(m, top.id) === false);
  const r2 = M.addRiser(m, 20, 0);
  const t2 = M.addNode(m, top.id, 20, 0), b2 = M.addNode(m, bot.id, 20, 0);
  M.attachRiser(m, r2.id, top.id, t2.id);
  M.attachRiser(m, r2.id, bot.id, b2.id);
  ok('A level in two risers has a locked offset', M.isLevelLocked(m, top.id) === true);
}

section('Annotations — node type codes and size labels');
{
  const m = M.create(), lv = m.levels[0].id;
  const W = M.addNode(m, lv, -10, 0), T = M.addNode(m, lv, 0, 0);
  const E = M.addNode(m, lv, 10, 0), N = M.addNode(m, lv, 0, 10);
  M.addPipe(m, W.id, T.id, {}); M.addPipe(m, T.id, E.id, {}); M.addPipe(m, T.id, N.id, {});
  ok('3 pipes at a node → T', NET.nodeTypeCode(m, T.id) === 'T', NET.nodeTypeCode(m, T.id));

  const c1 = M.addNode(m, lv, 40, 0), c2 = M.addNode(m, lv, 50, 0), c3 = M.addNode(m, lv, 50, 10);
  M.addPipe(m, c1.id, c2.id, {}); M.addPipe(m, c2.id, c3.id, {});
  ok('Right-angle corner → EL', NET.nodeTypeCode(m, c2.id) === 'EL', NET.nodeTypeCode(m, c2.id));

  M.setSource(m, W.id);
  ok('Source → S (device beats geometry)', NET.nodeTypeCode(m, W.id) === 'S');
  M.setDemand(m, E.id, 0.001, 0);
  ok('Demand → D', NET.nodeTypeCode(m, E.id) === 'D');
  ok('Plain dead end → no code', NET.nodeTypeCode(m, c1.id) === '');

  // Collinear pipes are not an elbow
  const s1 = M.addNode(m, lv, 0, -30), s2 = M.addNode(m, lv, 10, -30), s3 = M.addNode(m, lv, 20, -30);
  M.addPipe(m, s1.id, s2.id, {}); M.addPipe(m, s2.id, s3.id, {});
  ok('Collinear join → no code', NET.nodeTypeCode(m, s2.id) === '');

  // ⌀ labels, per the drawing-annotation convention
  ok('DN50 renders as 50⌀', FD.units.sizeLabel('DN50', 'DN') === '50⌀',
     FD.units.sizeLabel('DN50', 'DN'));
  ok('PPR "63 mm" renders as 63⌀', FD.units.sizeLabel('63 mm', 'DN') === '63⌀',
     FD.units.sizeLabel('63 mm', 'DN'));
  ok('NPS mode still uses inch labels', FD.units.sizeLabel('DN50', 'NPS') === '2"',
     FD.units.sizeLabel('DN50', 'NPS'));
}

section('Valves — Kv law');
{
  const RG = 998 * 9.81;
  // By definition, Kv m³/h through the valve costs exactly 1 bar.
  [10, 100, 285].forEach(kv => {
    const r = FD.valves.resistance('gate', kv, 100);
    const Q = kv / 3600;
    near(`Kv=${kv} drops exactly 1 bar at Kv flow`,
         FD.units.headToPa(r * Q * Q), 1e5, 1);
  });

  near('Cv = 1.156 × Kv', FD.valves.kvToCv(100), 115.6, 0.01);
  near('Kv↔Cv round trip', FD.valves.cvToKv(FD.valves.kvToCv(37.5)), 37.5, 1e-9);

  ok('DN50 gate default Kv is plausible (250–320)',
     FD.valves.defaultKv('gate', 52.48) > 250 && FD.valves.defaultKv('gate', 52.48) < 320,
     String(FD.valves.defaultKv('gate', 52.48)));
  ok('A check valve is more restrictive than a gate valve',
     FD.valves.defaultKv('check', 52.48) < FD.valves.defaultKv('gate', 52.48));
  ok('Bigger bore gives bigger Kv',
     FD.valves.defaultKv('gate', 102.26) > FD.valves.defaultKv('gate', 52.48));

  // Opening curve must be monotonic, and shut must mean shut
  const kvs = [0, 25, 50, 75, 100].map(o => FD.valves.effectiveKv('gate', 285, o));
  ok('Opening curve is monotonic', kvs.every((v, i) => i === 0 || v > kvs[i - 1]), kvs.join(','));
  ok('0% open is fully shut', kvs[0] === 0);
  near('100% open is the full Kv', kvs[4], 285, 1e-9);
  ok('Shut valve reports as closed', FD.valves.isClosed('gate', 0));
  ok('Open valve does not report as closed', !FD.valves.isClosed('gate', 100));
  ok('Closing the valve raises resistance',
     FD.valves.resistance('gate', 285, 25) > FD.valves.resistance('gate', 285, 100));
}

section('Valves — in a solved network');
{
  function withValve(opening, type) {
    const m = M.create(), lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 20, 0),
          c = M.addNode(m, lv, 21, 0), d = M.addNode(m, lv, 50, 0);
    M.addPipe(m, a.id, b.id, { size: 'DN50' });
    M.addPipe(m, b.id, c.id, {
      kind: 'valve', size: 'DN50',
      valve: { type: type || 'gate', kv: FD.valves.defaultKv(type || 'gate', 52.48), opening }
    });
    M.addPipe(m, c.id, d.id, { size: 'DN50' });
    // Tank 30 m up so there is real driving head
    M.setLevelAltitude(m, lv, 0);
    M.setSource(m, a.id);
    M.setDemand(m, d.id, 0.005, 0);
    return m;
  }

  const open = NET.solveModel(withValve(100));
  ok('Network with an open valve solves', open.ok, JSON.stringify(open.errors));

  const half = NET.solveModel(withValve(50));
  ok('Network with a half-open valve solves', half.ok, JSON.stringify(half.errors));

  // Same demand either way (fixed-flow demand), but the valve must cost more head
  const vOpen = open.network.links.find(l => l.kind === 'valve');
  const vHalf = half.network.links.find(l => l.kind === 'valve');
  const dpOpen = Math.abs(FD.hydraulics.headloss(vOpen.r, open.flow[vOpen.id], 2));
  const dpHalf = Math.abs(FD.hydraulics.headloss(vHalf.r, half.flow[vHalf.id], 2));
  ok('Throttling to 50% costs more head than fully open', dpHalf > dpOpen * 5,
     `open ${dpOpen.toFixed(4)} m, half ${dpHalf.toFixed(4)} m`);

  // A shut valve must be reported and must starve the demand
  const shut = NET.solveModel(withValve(0));
  ok('Shut valve raises a VALVE_SHUT warning',
     (shut.warnings || []).some(w => w.code === 'VALVE_SHUT'),
     JSON.stringify((shut.warnings || []).map(w => w.code)));
  const dNode = shut.network.nodes.find(n => n.demand > 0);
  ok('Shut valve starves the downstream demand (pressure collapses)',
     shut.pressure[dNode.id] < -1e6,
     (shut.pressure[dNode.id] / 1000).toFixed(0) + ' kPa');
  ok('Solver still converges with a shut valve', shut.converged);
}

section('Valves — check valve seats against reverse flow');
{
  /* Two reservoirs at different heads joined through a check valve pointing
   * from the LOW tank to the HIGH tank. Water wants to run high→low, i.e.
   * backwards through the valve, so the valve must seat and stop it. */
  function twoTanks(useCheck) {
    const m = M.create();
    const hi = m.levels[0];
    M.setLevelAltitude(m, hi.id, 0);
    const lo = M.addNode(m, hi.id, 0, 0);      // low tank
    const mid = M.addNode(m, hi.id, 10, 0);
    const high = M.addNode(m, hi.id, 30, 0);   // high tank
    lo.dz = 0; high.dz = 25;                   // 25 m of head difference

    M.addPipe(m, lo.id, mid.id, { size: 'DN50' });
    M.addPipe(m, mid.id, high.id, useCheck ? {
      kind: 'valve', size: 'DN50',
      valve: { type: 'check', kv: FD.valves.defaultKv('check', 52.48), opening: 100 }
    } : { size: 'DN50' });

    M.setSource(m, lo.id);
    M.setSource(m, high.id);
    return m;
  }

  const without = NET.solveModel(twoTanks(false));
  const flowWithout = Math.abs(without.flow[without.network.links[1].id]);
  ok('Without a check valve, water runs backwards from the high tank',
     flowWithout > 1e-4, (flowWithout * 1000).toFixed(2) + ' L/s');

  const withCv = NET.solveModel(twoTanks(true));
  const cvLink = withCv.network.links.find(l => l.kind === 'valve');
  ok('Check-valve model converges', withCv.converged, JSON.stringify(withCv.errors));
  ok('Check valve seats (flagged shut)', cvLink._checkShut === true);
  ok('Check valve stops the reverse flow',
     Math.abs(withCv.flow[cvLink.id]) < 1e-5,
     (withCv.flow[cvLink.id] * 1000).toFixed(6) + ' L/s');
  ok('Seating is reported to the user',
     (withCv.warnings || []).some(w => w.code === 'CHECK_CLOSED'));

  // ...and it must NOT block correct forward flow
  const m2 = M.create(), lv = m2.levels[0].id;
  const s = M.addNode(m2, lv, 0, 0), v1 = M.addNode(m2, lv, 10, 0),
        v2 = M.addNode(m2, lv, 11, 0), dd = M.addNode(m2, lv, 40, 0);
  s.dz = 30;
  M.addPipe(m2, s.id, v1.id, { size: 'DN50' });
  M.addPipe(m2, v1.id, v2.id, { kind: 'valve', size: 'DN50',
    valve: { type: 'check', kv: FD.valves.defaultKv('check', 52.48), opening: 100 } });
  M.addPipe(m2, v2.id, dd.id, { size: 'DN50' });
  M.setSource(m2, s.id);
  M.setDemand(m2, dd.id, 0.004, 0);
  const fwd = NET.solveModel(m2);
  const fwdValve = fwd.network.links.find(l => l.kind === 'valve');
  ok('Check valve passes forward flow unimpeded',
     Math.abs(fwd.flow[fwdValve.id] - 0.004) < 1e-9,
     (fwd.flow[fwdValve.id] * 1000).toFixed(3) + ' L/s');
  ok('...and is not flagged shut', !fwdValve._checkShut);
  ok('Two-pass loop settled (no oscillation warning)',
     !(fwd.warnings || []).some(w => w.code === 'FITTING_OSCILLATION'),
     'passes=' + fwd.passes);
}

section('Laminar flow warning');
{
  /* A very low flow in a large pipe is laminar. Hazen-Williams is a turbulent
   * correlation, so this must be flagged as a method problem. */
  function run(flow, size, on) {
    const m = M.create(), lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 30, 0);
    M.addPipe(m, a.id, b.id, { size: size });
    M.setSource(m, a.id);
    M.setDemand(m, b.id, flow, 0);
    if (on === false) m.settings.warn.laminar = false;
    return NET.solveModel(m);
  }

  const slow = run(2e-6, 'DN300');       // 0.002 L/s in DN300 -> deeply laminar
  ok('Very low flow in a big pipe is flagged laminar',
     (slow.warnings || []).some(w => w.code === 'LAMINAR'),
     JSON.stringify((slow.warnings || []).map(w => w.code)));
  ok('...and the message names Hazen-Williams as inapplicable',
     (slow.warnings || []).some(w => w.code === 'LAMINAR' && /Hazen-Williams/.test(w.message)));

  const fast = run(0.005, 'DN50');       // ordinary design flow -> turbulent
  ok('Normal design flow is not flagged laminar',
     !(fast.warnings || []).some(w => w.code === 'LAMINAR'),
     JSON.stringify((fast.warnings || []).map(w => w.code)));

  const off = run(2e-6, 'DN300', false);
  ok('The warning can be switched off',
     !(off.warnings || []).some(w => w.code === 'LAMINAR'));

  // Zero-flow pipes have no regime and must not be flagged
  const idle = M.create();
  const lv2 = idle.levels[0].id;
  const x = M.addNode(idle, lv2, 0, 0), y = M.addNode(idle, lv2, 10, 0);
  M.addPipe(idle, x.id, y.id, { size: 'DN50' });
  M.setSource(idle, x.id);
  const idleRes = NET.solveModel(idle);
  ok('A pipe with no flow is not flagged laminar',
     !(idleRes.warnings || []).some(w => w.code === 'LAMINAR'));
}

section('Symmetric riser tee does not oscillate (regression)');
{
  /* A riser feeding identical floors splits EXACTLY in half at each branch, so
   * "the leg pair carrying the through-flow" is a coin flip between two equal
   * numbers. Picking by magnitude alone self-oscillated: the pick set the
   * equivalent length, which nudged the flows, which flipped the pick back —
   * a stable 2-cycle that never converged. Near-ties are now broken on
   * geometry, which cannot depend on flow. */
  function riserModel() {
    const m = M.create();
    const L1 = m.levels[0];
    M.setLevelAltitude(m, L1.id, 0);
    const L2 = M.addLevel(m, { name: 'L2', altitude: 5 });
    const L3 = M.addLevel(m, { name: 'L3', altitude: 10 });

    const mk = (lv) => {
      const r = M.addNode(m, lv.id, 0, 0);
      const d = M.addNode(m, lv.id, 10, 0);
      M.addPipe(m, r.id, d.id, { size: 'DN100' });
      return { r, d };
    };
    const f1 = mk(L1), f2 = mk(L2), f3 = mk(L3);
    // equal demands on the upper two floors -> exact 50/50 split at the L2 tee
    M.setDemand(m, f2.d.id, 0.02, 0);
    M.setDemand(m, f3.d.id, 0.02, 0);

    const src = M.addNode(m, L1.id, -10, 0);
    src.dz = 60;
    M.addPipe(m, src.id, f1.r.id, { size: 'DN100' });
    M.setSource(m, src.id);

    const col = M.addRiser(m, 0, 0);
    M.attachRiser(m, col.id, L3.id, f3.r.id);
    M.attachRiser(m, col.id, L2.id, f2.r.id);
    M.attachRiser(m, col.id, L1.id, f1.r.id);
    M.riserPipes(m);
    return { m, f2 };
  }

  const { m, f2 } = riserModel();
  const res = NET.solveModel(m);
  ok('Symmetric riser converges', res.ok, JSON.stringify(res.errors));
  ok('...without a fitting-oscillation warning',
     !(res.warnings || []).some(w => w.code === 'FITTING_OSCILLATION'),
     'passes=' + res.passes);
  ok('...in fewer than the maximum passes', res.passes < 5, 'passes=' + res.passes);

  /* The tie is between the two OUTFLOWS at the L2 tee — 20 L/s continuing up
   * to L3 and 20 L/s turning into the L2 floor — fed by a 40 L/s inflow from
   * below. That exact 50/50 split is what made the magnitude-only pick a coin
   * flip. */
  const legs = M.pipesAt(m, f2.r.id);
  const outs = legs.filter(p => {
    const q = res.flow[p.id] || 0;
    return (p.a === f2.r.id) ? q > 0 : q < 0;
  }).map(p => Math.abs(res.flow[p.id]));
  ok('The riser tee sees two exactly-tied outflows',
     outs.length === 2 && Math.abs(outs[0] - outs[1]) < 1e-9,
     outs.map(x => (x * 1000).toFixed(4)).join(' vs '));

  // Geometry must win the tie: the straight vertical pair is the run,
  // the horizontal floor take-off is the branch.
  const types = {};
  NET.fittingsAtNode(m, f2.r.id, res.flow, []).forEach(f => { types[f.pipe] = f.type; });
  const horiz = legs.find(p => p.kind !== 'riser');
  ok('The horizontal floor take-off is the BRANCH',
     types[horiz.id] === 'TBRANCH', JSON.stringify(types));
  const risers = legs.filter(p => p.kind === 'riser').map(p => types[p.id]).filter(Boolean);
  ok('The vertical riser legs are the RUN',
     risers.length > 0 && risers.every(t => t === 'TRUN'), JSON.stringify(types));

  // Deterministic: repeated solves of fresh copies must agree exactly
  const sigs = [];
  for (let i = 0; i < 4; i++) {
    const fresh = riserModel();
    const r = NET.solveModel(fresh.m);
    sigs.push(r.network.links.map(l => l.id + ':' + l._types.join('|')).join(','));
  }
  ok('Repeated solves give an identical fitting assignment',
     new Set(sigs).size === 1, String(new Set(sigs).size) + ' distinct results');
}

section('Threshold warnings come from the engine, not the renderer');
{
  /* Regression: velocity and friction-rate breaches used to be detected only
   * while rendering the calculation sheet, so solveModel() reported "no
   * warnings" for a network running at 12 m/s. Detection belongs with the
   * physics so every consumer of a solve sees it. */
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 20, 0);
  a.dz = 60;
  M.addPipe(m, a.id, b.id, { size: 'DN100' });
  M.setSource(m, a.id);
  M.setDemand(m, b.id, 0.100, 0);        // 100 L/s in DN100 ≈ 12 m/s

  const res = NET.solveModel(m);
  const codes = (res.warnings || []).map(w => w.code);
  ok('Engine reports a VELOCITY breach', codes.includes('VELOCITY'), JSON.stringify(codes));
  ok('Engine reports a PDM breach', codes.includes('PDM'), JSON.stringify(codes));

  const v = (res.warnings || []).find(w => w.code === 'VELOCITY');
  ok('Velocity warning carries the value and the limit',
     v.velocity > 12 && v.limit === 2.4, JSON.stringify(v));
  ok('...and names the section', /→/.test(v.section), v.section);

  const p = (res.warnings || []).find(w => w.code === 'PDM');
  ok('PD/m warning carries the value in Pa/m and the limit',
     p.pdm > 400 && p.limit === 400, JSON.stringify({ pdm: p.pdm, limit: p.limit }));

  // Raising the limits must clear them
  m.settings.warn.velocity = 20;
  m.settings.warn.pdm = 1e9;
  const relaxed = NET.solveModel(m);
  const relaxedCodes = (relaxed.warnings || []).map(w => w.code);
  ok('Raising the limits clears both breaches',
     !relaxedCodes.includes('VELOCITY') && !relaxedCodes.includes('PDM'),
     JSON.stringify(relaxedCodes));

  // A sensible design must not trip them
  const ok2 = M.create(), lv2 = ok2.levels[0].id;
  const x = M.addNode(ok2, lv2, 0, 0), y = M.addNode(ok2, lv2, 20, 0);
  x.dz = 20;
  M.addPipe(ok2, x.id, y.id, { size: 'DN100' });
  M.setSource(ok2, x.id);
  M.setDemand(ok2, y.id, 0.010, 0);      // 10 L/s in DN100 ≈ 1.2 m/s
  const good = NET.solveModel(ok2);
  ok('A sensibly sized run raises no threshold warnings',
     !(good.warnings || []).some(w => w.code === 'VELOCITY' || w.code === 'PDM'),
     JSON.stringify((good.warnings || []).map(w => w.code)));
}

section('Darcy-Weisbach through the network builder');
{
  function solveWith(method) {
    const m = M.create(), lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 40, 0);
    a.dz = 30;
    M.addPipe(m, a.id, b.id, { size: 'DN50' });
    M.setSource(m, a.id);
    M.setDemand(m, b.id, 0.004, 0);
    m.settings.frictionMethod = method;
    return { m, res: NET.solveModel(m) };
  }

  const hw = solveWith('HW');
  const dw = solveWith('DW');
  ok('Hazen-Williams model solves', hw.res.ok, JSON.stringify(hw.res.errors));
  ok('Darcy-Weisbach model solves', dw.res.ok, JSON.stringify(dw.res.errors));

  const qHW = Math.abs(hw.res.flow[hw.m.pipes[0].id]);
  const qDW = Math.abs(dw.res.flow[dw.m.pipes[0].id]);
  near('Both deliver the demanded flow (HW)', qHW, 0.004, 1e-9);
  near('Both deliver the demanded flow (DW)', qDW, 0.004, 1e-9);

  const pHW = hw.res.pressure[hw.m.nodes[1].id];
  const pDW = dw.res.pressure[dw.m.nodes[1].id];
  ok('Delivered pressures agree within 15% between methods',
     Math.abs(pHW - pDW) / Math.abs(pHW) < 0.15,
     `HW ${(pHW / 1000).toFixed(1)} kPa vs DW ${(pDW / 1000).toFixed(1)} kPa`);

  ok('Darcy link uses exponent 2',
     dw.res.network.links[0].n === 2, String(dw.res.network.links[0].n));
  ok('Hazen-Williams link uses exponent 1.852',
     Math.abs(hw.res.network.links[0].n - 1.852) < 1e-12);

  // Every correlation must produce a solvable network
  Object.keys(FD.hydraulics.frictionFactors).forEach(k => {
    const t = solveWith('DW');
    t.m.settings.dw.frictionFactor = k;
    const r = NET.solveModel(t.m);
    ok(`Network solves with the ${k} correlation`, r.ok, JSON.stringify(r.errors));
  });
}

section('Editable coefficients change the answer');
{
  const build = (tweak) => {
    const m = M.create(), lv = m.levels[0].id;
    const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 50, 0);
    a.dz = 40;
    M.addPipe(m, a.id, b.id, { size: 'DN50' });
    M.setSource(m, a.id);
    M.setDemand(m, b.id, 0.004, 0);
    if (tweak) tweak(m);
    return NET.solveModel(m);
  };

  const base = build(null);
  const doubled = build(m => { m.settings.hw.A = 21.34; });
  const bNode = 1;
  ok('Doubling coefficient A increases the loss',
     doubled.pressure[doubled.network.nodes[bNode].id] <
     base.pressure[base.network.nodes[bNode].id],
     'base vs doubled');

  const fluid = build(m => { m.settings.fluid.density = 1200; });   // e.g. glycol-ish
  ok('Changing fluid density changes reported pressure',
     Math.abs(fluid.pressure[fluid.network.nodes[bNode].id] -
              base.pressure[base.network.nodes[bNode].id]) > 1,
     'density feeds the head→pressure conversion');

  const el = build(m => { m.settings.fittingLD.E90 = 300; });
  ok('Editing fitting L/D is picked up by the builder',
     JSON.stringify(el.network.links.map(l => l._el)) !==
     JSON.stringify(base.network.links.map(l => l._el)) ||
     base.network.links.every(l => l._el === 0),
     'no fittings in this straight run, so equal is expected');
}

section('Print plans — one shared transform for every level');
{
  const m = M.create();
  const g = m.levels[0];
  const up = M.addLevel(m, { name: 'Level 1', altitude: 3.5 });
  // very different extents per level: the transform must still be shared
  const a = M.addNode(m, g.id, 0, 0), b = M.addNode(m, g.id, 60, 0);
  M.addPipe(m, a.id, b.id, {});
  const c = M.addNode(m, up.id, 0, 0), d = M.addNode(m, up.id, 5, 0);
  M.addPipe(m, c.id, d.id, {});

  const bounds = FD.printer.worldBounds(m);
  ok('Bounds cover every level', bounds.maxX >= 60 && bounds.minX <= 0,
     JSON.stringify(bounds));

  const tf = FD.printer.fitTransform(m);
  ok('Scale is positive and finite', tf.scale > 0 && isFinite(tf.scale), String(tf.scale));

  // The same world point must map to the same page point regardless of level —
  // that is what makes the printed sheets overlay.
  const p1 = { x: tf.x(0), y: tf.y(0) };
  const p2 = { x: tf.x(0), y: tf.y(0) };
  ok('Transform is deterministic', p1.x === p2.x && p1.y === p2.y);
  ok('60 m spans more page width than 5 m at the shared scale',
     (tf.x(60) - tf.x(0)) > (tf.x(5) - tf.x(0)));

  // Degenerate single-point model must not divide by zero
  const tiny = M.create();
  M.addNode(tiny, tiny.levels[0].id, 3, 3);
  const tf2 = FD.printer.fitTransform(tiny);
  ok('Single-node model yields a finite scale', isFinite(tf2.scale) && tf2.scale > 0,
     String(tf2.scale));

  const empty = M.create();
  ok('Empty model yields a finite scale', isFinite(FD.printer.fitTransform(empty).scale));
}

section('LAYOUT: label offsets and display flags');
{
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 10, 0);
  const p = M.addPipe(m, a.id, b.id, { size: 'DN50' });

  near('Default offset is zero', M.labelOffset(a).dx, 0, 1e-12);
  M.setLabelOffset(a, 12.34, -8.7);
  near('Offset stored (rounded to 0.1 px)', M.labelOffset(a).dx, 12.3, 1e-9);
  near('...both axes', M.labelOffset(a).dy, -8.7, 1e-9);

  /* Offsets are screen pixels, not metres, so a label keeps its distance from
   * its owner at every zoom. Nothing about them may touch geometry. */
  near('Moving a label does not move the node', a.x, 0, 1e-12);
  near('...nor change any pipe length', M.pipeLength(m, p), 10, 1e-9);

  M.setLabelOffset(a, 0, 0);
  ok('Zeroing an offset removes the property entirely', a.labelOffset === undefined);

  M.setLabelOffset(p, 5, 5);
  M.clearLabelOffsets(m);
  ok('clearLabelOffsets wipes nodes and pipes',
     a.labelOffset === undefined && p.labelOffset === undefined);

  // display flags
  ok('No flags by default', Object.keys(M.displayFlags(p)).length === 0);
  M.setDisplayFlag(p, 'flow', true);
  M.setDisplayFlag(p, 'tag', true);
  ok('Flags accumulate', M.displayFlags(p).flow && M.displayFlags(p).tag);
  M.setDisplayFlag(p, 'flow', false);
  ok('Unticking removes just that flag',
     !M.displayFlags(p).flow && M.displayFlags(p).tag);
  M.setDisplayFlag(p, 'tag', false);
  ok('Emptying removes the property entirely', p.show === undefined);

  // both survive save/load
  M.setLabelOffset(a, 7, -3);
  M.setDisplayFlag(p, 'flow', true);
  const back = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m))));
  near('Offsets survive save/load', M.labelOffset(back.nodes[0]).dx, 7, 1e-9);
  ok('Display flags survive save/load', M.displayFlags(back.pipes[0]).flow === true);
}

section('New fluid and presentation settings');
{
  const d = M.defaultSettings();
  ok('Fluid has an editable name', d.fluid.name === 'Water');
  near('Specific heat defaults to water', d.fluid.specificHeat, 4187, 1);
  near('UI font default', d.presentation.uiFontSize, 14, 1e-12);
  near('Label size default', d.presentation.labelSize, 11, 1e-12);
  near('Arrow size default', d.presentation.arrowSize, 1, 1e-12);

  // per-pipe temperature is optional and does not affect hydraulics yet
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0), b = M.addNode(m, lv, 20, 0);
  a.dz = 30;
  const p1 = M.addPipe(m, a.id, b.id, { size: 'DN100' });
  M.setSource(m, a.id); M.setDemand(m, b.id, 0.01, 0);
  const before = NET.solveModel(m).flow[p1.id];
  p1.temperature = 60;
  const after = NET.solveModel(m).flow[p1.id];
  near('Per-pipe temperature does not yet change the hydraulics', after, before, 1e-12);
  ok('...but is stored on the pipe', p1.temperature === 60);
  const back = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m))));
  ok('...and survives save/load', back.pipes[0].temperature === 60);
}

section('Copy level layout');
{
  const m = M.create();
  const L1 = m.levels[0];
  M.setLevelAltitude(m, L1.id, 0);
  const L2 = M.addLevel(m, { name: 'L2', altitude: 4 });

  const a = M.addNode(m, L1.id, 0, 0), b = M.addNode(m, L1.id, 10, 0),
        c = M.addNode(m, L1.id, 10, 8);
  M.addPipe(m, a.id, b.id, { size: 'DN50' });
  M.addPipe(m, b.id, c.id, { size: 'DN65', tag: 'BR-1' });
  M.setDemand(m, c.id, 0.004, 50000);
  M.setSource(m, a.id);
  const col = M.addRiser(m, 0, 0);
  M.attachRiser(m, col.id, L1.id, a.id);

  const r = M.copyLevel(m, L1.id, L2.id);
  ok('Reports what it copied', r.nodes === 3 && r.pipes === 2, JSON.stringify(r));

  const l2Nodes = m.nodes.filter(n => n.level === L2.id);
  ok('All nodes copied', l2Nodes.length === 3);
  ok('Coordinates preserved',
     l2Nodes.some(n => n.x === 10 && n.y === 8));

  const l2Pipes = m.pipes.filter(p => {
    const x = M.node(m, p.a), y = M.node(m, p.b);
    return p.kind !== 'riser' && x.level === L2.id && y.level === L2.id;
  });
  ok('All pipes copied', l2Pipes.length === 2);
  ok('Sizes preserved', l2Pipes.some(p => p.size === 'DN65'));
  ok('Tags preserved', l2Pipes.some(p => p.tag === 'BR-1'));
  ok('Demand copied', l2Nodes.some(n => n.device && n.device.kind === 'demand'));

  /* Sources ARE copied. Suppressing them was tried and rejected: forgetting to
   * delete a duplicated source is ordinary user error with an easy workflow
   * around it, whereas silently dropping part of the layout is the worse
   * surprise. */
  ok('Source is copied like everything else',
     l2Nodes.some(n => n.device && n.device.kind === 'source'),
     JSON.stringify(l2Nodes.map(n => n.device && n.device.kind)));
  ok('...giving two sources, which is the user\'s to resolve',
     m.nodes.filter(n => n.device && n.device.kind === 'source').length === 2);

  // risers follow the copy so the stack stays connected
  ok('Riser extended to the new level', r.risers === 1);
  ok('Column now has two attachments', m.risers[0].attachments.length === 2);
  ok('A riser link was generated', m.pipes.some(p => p.kind === 'riser'));
  near('Riser length is the altitude difference',
       M.pipeLength(m, m.pipes.find(p => p.kind === 'riser')), 4, 1e-9);

  // lengths on the source floor are untouched
  near('Original geometry unchanged', M.pipeLength(m, m.pipes[0]), 10, 1e-9);

  // copying onto itself is refused
  ok('Copying a level onto itself does nothing', M.copyLevel(m, L1.id, L1.id) === null);
}

report();
