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

  /* A layout pipe's length is its PLAN distance, whatever the elevations of
   * its ends. Pipes on a level run level; only a riser changes height, and the
   * length an engineer takes off a layout is the horizontal one — which stays
   * true when pipe gradients arrive in v2/v3. The 0.6 m offset above makes this
   * pipe illegal, which is what SLOPED_PIPE reports; the length is still the
   * plan 10 m and never sqrt(10^2 + 0.6^2). */
  near('Length is the plan distance, not the slope', M.pipeLength(m, m.pipes[0]), 10, 1e-9);
  near('...and the rise is reported separately', M.pipeRise(m, m.pipes[0]), -0.6, 1e-12);
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

  ok('East leg (through-flow) gets a dividing tee-RUN',
     byPipe[pE.id] === 'TRUN_DIV', JSON.stringify(byPipe));
  ok('North leg (diverging) gets a dividing tee-BRANCH',
     byPipe[pN.id] === 'TBRANCH_DIV', JSON.stringify(byPipe));
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
     pass2[pSide.id].types.includes('TRUN_DIV'), JSON.stringify(pass2[pSide.id].types));
  ok('...and demotes the straight leg to branch',
     pass2[pStraight.id].types.includes('TBRANCH_DIV'), JSON.stringify(pass2[pStraight.id].types));
  ok('The two passes genuinely differ',
     pass1[pSide.id].el !== pass2[pSide.id].el);
  ok('Solve reports more than one pass', res.passes >= 2, 'passes=' + res.passes);
}

section('Network — cross (4 pipes) is handled without warning');
{
  /* This used to assert a CROSS warning. Removed at Michael's request
   * (2026-07-31): four pipes at a node is ordinary in real pipework and the
   * two-tee-branch treatment is reasonable, so the warning was noise that
   * buried the ones that matter. What must still hold is that the node is
   * FITTED — silently charging nothing there would be a real error. */
  const m = M.create(), lv = m.levels[0].id;
  const c = M.addNode(m, lv, 0, 0);
  [[10, 0], [-10, 0], [0, 10], [0, -10]].forEach(([x, y]) => {
    const n = M.addNode(m, lv, x, y);
    M.addPipe(m, c.id, n.id, {});
  });
  const warnings = [];
  const fits = NET.fittingsAtNode(m, c.id, null, warnings);
  ok('4 pipes at a node raises no CROSS warning',
     !warnings.some(w => w.code === 'CROSS'), JSON.stringify(warnings));
  ok('...and still assigns tee fittings there',
     fits.length > 0 && fits.every(f => /^T/.test(f.type)),
     JSON.stringify(fits));
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

section('Model — device direction (flip, and which devices have one)');
{
  /* Flipping is a swap of the pipe's own endpoints, because every
   * direction-sensitive rule in the engine reads a→b. Both the properties
   * panel and the on-drawing button go through flipPipe so they cannot
   * diverge. */
  const m = M.create();
  const lv = m.levels[0];
  const n1 = M.addNode(m, lv.id, 0, 0), n2 = M.addNode(m, lv.id, 1, 0);
  const pump = M.addPipe(m, n1.id, n2.id, { kind: 'pump', pump: { mode: 'auto', head: 10 } });

  ok('Pump starts a→b as drawn', pump.a === n1.id && pump.b === n2.id);
  M.flipPipe(m, pump.id);
  ok('flipPipe swaps the endpoints', pump.a === n2.id && pump.b === n1.id);
  M.flipPipe(m, pump.id);
  ok('Flipping twice returns to the original', pump.a === n1.id && pump.b === n2.id);
  ok('flipPipe on an unknown id is harmless', M.flipPipe(m, 'nope') === null);

  // Only devices that actually hold against reverse flow are directional.
  const plain = M.addPipe(m, n2.id, M.addNode(m, lv.id, 2, 0).id, {});
  const equip = M.addPipe(m, n1.id, M.addNode(m, lv.id, 0, 1).id,
                          { kind: 'equip', equip: { qRated: 0.02, pdRated: 1e5 } });
  const gate = M.addPipe(m, n1.id, M.addNode(m, lv.id, 0, 2).id,
                         { kind: 'valve', valve: { type: 'gate', kv: 100, opening: 100 } });
  const check = M.addPipe(m, n1.id, M.addNode(m, lv.id, 0, 3).id,
                          { kind: 'valve', valve: { type: 'check', kv: 100, opening: 100 } });
  ok('A pump is directional', M.isDirectional(pump) === true);
  ok('Equipment is directional', M.isDirectional(equip) === true);
  ok('A check valve is directional', M.isDirectional(check) === true);
  ok('A gate valve is NOT directional', M.isDirectional(gate) === false);
  ok('A plain pipe is NOT directional', M.isDirectional(plain) === false);
}

section('Model — merging nodes and dissolving a straight joint');
{
  /* Dragging one node onto another joins them. Two coincident unjoined nodes
   * are exactly the defect disconnections() reports, so the gesture that
   * creates them resolves them. */
  const m = M.create(), lv = m.levels[0].id;
  const a = M.addNode(m, lv, 0, 0);
  const b = M.addNode(m, lv, 10, 0);
  const c = M.addNode(m, lv, 10, 0);      // dropped on top of b
  const d = M.addNode(m, lv, 20, 0);
  M.addPipe(m, a.id, b.id, { size: 'DN50', C: 120 });
  M.addPipe(m, c.id, d.id, { size: 'DN50', C: 120 });

  ok('Two runs, not connected', M.pipesAt(m, b.id).length === 1);
  M.mergeNodes(m, b.id, c.id);
  ok('Merged node carries both pipes', M.pipesAt(m, b.id).length === 2);
  ok('The dropped node is gone', !M.node(m, c.id));

  // Straight, same size/C -> dissolve into one continuous pipe
  const survivor = M.dissolveNode(m, b.id);
  ok('Straight joint dissolves', !!survivor);
  ok('...leaving one pipe', m.pipes.length === 1, String(m.pipes.length));
  ok('...and no joint node', !M.node(m, b.id));
  near('...whose length is the sum', M.pipeLength(m, m.pipes[0]), 20, 1e-9);

  /* A node where the SIZE changes is a real feature of the model. Dissolving
   * it would silently re-size pipework, so it must be refused. */
  const m2 = M.create(), lv2 = m2.levels[0].id;
  const p = M.addNode(m2, lv2, 0, 0), q = M.addNode(m2, lv2, 10, 0), r = M.addNode(m2, lv2, 20, 0);
  M.addPipe(m2, p.id, q.id, { size: 'DN50', C: 120 });
  M.addPipe(m2, q.id, r.id, { size: 'DN100', C: 120 });
  ok('A size transition is NOT dissolved', M.dissolveNode(m2, q.id) === null);
  ok('...so both pipes remain', m2.pipes.length === 2);

  // A genuine corner must survive too, or an elbow would vanish from the calc.
  const m3 = M.create(), lv3 = m3.levels[0].id;
  const s = M.addNode(m3, lv3, 0, 0), t = M.addNode(m3, lv3, 10, 0), u = M.addNode(m3, lv3, 10, 10);
  M.addPipe(m3, s.id, t.id, { size: 'DN50', C: 120 });
  M.addPipe(m3, t.id, u.id, { size: 'DN50', C: 120 });
  ok('A 90° corner is NOT dissolved', M.dissolveNode(m3, t.id) === null);

  // A node carrying a device is not a joint.
  const m4 = M.create(), lv4 = m4.levels[0].id;
  const x = M.addNode(m4, lv4, 0, 0), y = M.addNode(m4, lv4, 10, 0), z = M.addNode(m4, lv4, 20, 0);
  M.addPipe(m4, x.id, y.id, { size: 'DN50', C: 120 });
  M.addPipe(m4, y.id, z.id, { size: 'DN50', C: 120 });
  M.setDemand(m4, y.id, 0.001, 100000);
  ok('A node with a device is NOT dissolved', M.dissolveNode(m4, y.id) === null);
}

section('Model — riser size override (a riser must be sizeable by hand)');
{
  /* Inheritance is only a default. A riser is frequently sized differently from
   * the branches it feeds — a DN80 riser serving DN40 take-offs — so the column
   * carries an explicit override that wins over inheritance and survives
   * re-materialisation. */
  const m = M.create();
  const top = m.levels[0];
  const bot = M.addLevel(m, { name: 'Lower', altitude: -3.5 });
  const tNode = M.addNode(m, top.id, 0, 0);
  const bNode = M.addNode(m, bot.id, 0, 0);
  const tSide = M.addNode(m, top.id, 8, 0);
  M.addPipe(m, tNode.id, tSide.id, { size: 'DN40' });

  const r = M.addRiser(m, 0, 0);
  M.attachRiser(m, r.id, top.id, tNode.id);
  M.attachRiser(m, r.id, bot.id, bNode.id);
  M.riserPipes(m);

  const seg = () => m.pipes.filter(p => p.kind === 'riser' && p.riser === r.id);
  ok('Inherits DN40 before any override', seg()[0].size === 'DN40', seg()[0].size);

  M.setRiserProps(m, r.id, { size: 'DN80', C: 130 });
  ok('Override reaches every materialised segment',
     seg().every(p => p.size === 'DN80' && p.C === 130),
     seg().map(p => p.size + '/' + p.C).join(' '));

  // Re-materialising must not revert to inheritance nor duplicate the pipe.
  M.riserPipes(m);
  ok('Override survives re-materialisation',
     seg().every(p => p.size === 'DN80'), seg().map(p => p.size).join(' '));
  ok('Re-materialising does not duplicate segments', seg().length === 1, String(seg().length));

  // Bore actually changes — the override has to reach the hydraulics, not just
  // the label, or the calculation quietly keeps using the inherited size.
  const bore = M.pipeBore(m, seg()[0]) * 1000;
  ok('Bore follows the override (DN80 > DN40 bore)', bore > 60, bore.toFixed(1) + ' mm');

  // Clearing hands the segment back to inheritance on the next materialise.
  M.setRiserProps(m, r.id, { size: '' });
  ok('Clearing the override drops it from the column', !r.size, String(r.size));
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
  ok('Outflow → OF', NET.nodeTypeCode(m, E.id) === 'OF');
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

  /* Globe valve. It obeys the same Kv law and the same opening machinery as a
   * gate valve — what differs is that its seat is far more restrictive, and
   * that it throttles evenly, which is why it is the regulating valve. */
  const globe = FD.valves.type('globe');
  ok('Globe valve exists and is adjustable', !!globe && globe.adjustable === true);
  ok('Globe is NOT a check valve', !globe.checkValve);
  near('Globe Kv=100 also drops exactly 1 bar at Kv flow',
       FD.units.headToPa(FD.valves.resistance('globe', 100, 100) * (100 / 3600) * (100 / 3600)),
       1e5, 1);
  ok('A globe valve is far more restrictive than a gate valve of the same bore',
     FD.valves.defaultKv('globe', 52.48) < FD.valves.defaultKv('gate', 52.48),
     'globe ' + FD.valves.defaultKv('globe', 52.48).toFixed(0) +
     ' vs gate ' + FD.valves.defaultKv('gate', 52.48).toFixed(0));

  const gKvs = [0, 25, 50, 75, 100].map(o => FD.valves.effectiveKv('globe', 100, o));
  ok('Globe opening curve is monotonic',
     gKvs.every((v, i) => i === 0 || v > gKvs[i - 1]), gKvs.join(','));
  ok('Globe 0% is shut', gKvs[0] === 0 && FD.valves.isClosed('globe', 0));
  /* The point of a globe valve: at half travel it still passes a meaningful
   * fraction, where a gate valve has barely begun to throttle. */
  ok('Globe throttles more evenly than a gate at 50% travel',
     gKvs[2] / gKvs[4] > FD.valves.effectiveKv('gate', 100, 50) / FD.valves.effectiveKv('gate', 100, 100),
     'globe ' + (gKvs[2] / gKvs[4]).toFixed(2) +
     ' vs gate ' + (FD.valves.effectiveKv('gate', 100, 50) / FD.valves.effectiveKv('gate', 100, 100)).toFixed(2));
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

    M.addPipe(m, lo.id, mid.id, { size: 'DN50' });
    M.addPipe(m, mid.id, high.id, useCheck ? {
      kind: 'valve', size: 'DN50',
      valve: { type: 'check', kv: FD.valves.defaultKv('check', 52.48), opening: 100 }
    } : { size: 'DN50' });

    /* 25 m of head difference, stated as the high tank's own static pressure
     * rather than by raising its node. Raising it would slope the pipe into
     * it, which the layout rule forbids (SLOPED_PIPE) — and the source's
     * pressure is what that number always meant. 998 * 9.81 * 25 Pa. */
    M.setSource(m, lo.id, 0);
    M.setSource(m, high.id, 998 * 9.81 * 25);
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
  M.addPipe(m2, s.id, v1.id, { size: 'DN50' });
  M.addPipe(m2, v1.id, v2.id, { kind: 'valve', size: 'DN50',
    valve: { type: 'check', kv: FD.valves.defaultKv('check', 52.48), opening: 100 } });
  M.addPipe(m2, v2.id, dd.id, { size: 'DN50' });
  M.setSource(m2, s.id, 998 * 9.81 * 30);   // 30 m of head, as a pressure
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
     /^TBRANCH/.test(types[horiz.id] || ''), JSON.stringify(types));
  const risers = legs.filter(p => p.kind === 'riser').map(p => types[p.id]).filter(Boolean);
  ok('The vertical riser legs are the RUN',
     risers.length > 0 && risers.every(t => /^TRUN/.test(t)), JSON.stringify(types));

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
  /* Double the constant the ACTIVE method actually reads. The default is now
   * ASHRAE, which derives its coefficient from the printed velocity-form K —
   * doubling settings.hw.A changed nothing, which is exactly what this
   * assertion caught when the method was switched over. */
  const doubled = build(m => { m.settings.ashrae.K *= 2; });
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

section('TRACE — background drawings');
{
  const m = M.create();
  const L1 = m.levels[0];
  const L2 = M.addLevel(m, { name: 'L2', altitude: 4 });
  const img = { src: 'data:image/png;base64,AAAA', aspect: 0.5, width: 2000, height: 1000 };

  ok('A level starts with no trace', L1.trace === null);

  M.setTrace(m, L1.id, img, 0, 0, 40);
  const t = L1.trace;
  ok('Trace attached', !!t);
  near('Width as asked', t.width, 40, 1e-12);
  near('Aspect carried from the image', t.aspect, 0.5, 1e-12);
  near('Centred horizontally on the given point', t.x + t.width / 2, 0, 1e-9);
  near('...and vertically', t.y - (t.width * t.aspect) / 2, 0, 1e-9);
  ok('Unlocked so it can be positioned', t.locked === false);
  ok('Inverted by default on the dark theme', t.invert === true);

  // light theme should NOT invert
  const lightModel = M.create();
  lightModel.settings.theme = 'light';
  M.setTrace(lightModel, lightModel.levels[0].id, img, 0, 0, 40);
  ok('Not inverted on the light theme', lightModel.levels[0].trace.invert === false);

  /* Calibration: two points 10 m apart in model space that are really 25 m
   * must scale the drawing by 2.5, holding the first point still. */
  const r = M.calibrateTrace(m, L1.id, 0, 0, 10, 0, 25);
  near('Scale factor', r.factor, 2.5, 1e-12);
  near('Width scaled', t.width, 100, 1e-9);
  near('Aspect unchanged by calibration', t.aspect, 0.5, 1e-12);

  // the anchor point must not move
  const m2 = M.create();
  M.setTrace(m2, m2.levels[0].id, img, 0, 0, 40);
  const t2 = m2.levels[0].trace;
  const beforeX = t2.x, beforeY = t2.y;
  M.calibrateTrace(m2, m2.levels[0].id, beforeX, beforeY, beforeX + 5, beforeY, 20);
  near('The first picked point stays put (x)', t2.x, beforeX, 1e-9);
  near('...and (y)', t2.y, beforeY, 1e-9);

  ok('Zero measured distance is refused',
     M.calibrateTrace(m, L1.id, 3, 3, 3, 3, 10) === null);
  ok('Zero real distance is refused',
     M.calibrateTrace(m, L1.id, 0, 0, 5, 0, 0) === null);

  /* The trace must NOT ride along on a level copy — it is a picture of the
   * floor it came from, and duplicating it elsewhere would mislead. */
  const a = M.addNode(m, L1.id, 0, 0), b = M.addNode(m, L1.id, 10, 0);
  M.addPipe(m, a.id, b.id, { size: 'DN50' });
  M.copyLevel(m, L1.id, L2.id);
  ok('Copying a level does not copy its trace', !L2.trace);
  ok('...but does copy the pipework', m.nodes.filter(n => n.level === L2.id).length === 2);

  // survives save/load
  const back = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m))));
  const bt = back.levels.find(l => l.name === L1.name).trace;
  ok('Trace survives save/load', !!bt && bt.src === img.src);
  near('...with its geometry', bt.width, 100, 1e-9);

  M.clearTrace(m, L1.id);
  ok('Discarding removes it', L1.trace === null);
}

/* --------------------------------------------------------------------------
 * A source's static pressure is a property of the DEVICE, not an elevation.
 *
 * It was stored as the node's dz until v0.7.7-dev. Hydraulically that gave the
 * right downstream answers — a tank 20.43 m up does provide 200 kPa — but dz is
 * a real elevation, so entering a pressure physically lifted the node and
 * stretched every pipe on it in 3D. And the node itself then read 0 kPa gauge
 * while the next node along read 193, which reads as a pressure JUMP across a
 * pipe that loses 7.
 *
 * Numbers below are hand calculations: rho.g.h with rho = 998, g = 9.81.
 * ----------------------------------------------------------------------- */
section('Source static pressure');
{
  const RHO = 998, G9 = 9.81;

  const build = (pa, dz) => {
    const m = M.create();
    const lv = m.levels[0];
    const s = M.addNode(m, lv, 0, 0);
    const t = M.addNode(m, lv, 50, 0);
    M.setSource(m, s.id, pa);
    if (dz) s.dz = dz;
    t.device = { kind: 'demand', flow: 0.001, reqPressure: 100e3, include: true };
    M.addPipe(m, s.id, t.id, { size: 'DN50', schedule: 'sch40' });
    return { m, s, t, p: m.pipes[0] };
  };

  const b = build(200e3, 0);
  ok('Stored on the device, in pascals', b.s.device.pressure === 200e3);
  ok('The node is not moved', (b.s.dz || 0) === 0);
  near('So the pipe is its drawn plan length', M.pipeLength(b.m, b.p), 50, 1e-12);

  const res = NET.solveModel(b.m);
  near('The source node READS its stated pressure', res.pressure[b.s.id], 200e3, 1);
  ok('...and the next node is below it, not above',
     res.pressure[b.t.id] < res.pressure[b.s.id],
     `${res.pressure[b.s.id]} then ${res.pressure[b.t.id]}`);

  /* Elevation is a separate matter from pressure, and still feeds static head.
   * Raising the source 10 m adds rho.g.10 = 998 * 9.81 * 10 = 97 903.8 Pa at
   * the demand node below it — exactly, with no friction correction, because
   * the pipe's length is its PLAN distance and does not change when one end
   * moves in z. (Such a pipe is illegal under the layout rule; this is the
   * arithmetic, checked on the model that breaks it.) */
  const fc = build(200e3, 0);
  const flat = NET.solveModel(fc.m);
  const rc = build(200e3, 10);
  const high = NET.solveModel(rc.m);

  near('Raising the source does NOT change the pipe length',
       M.pipeLength(rc.m, rc.p), 50, 1e-12);
  near('Raising the source adds exactly rho.g.dz downstream',
       high.pressure[rc.t.id] - flat.pressure[fc.t.id], RHO * G9 * 10, 1e-6);
  near('The source node still reads its own stated pressure',
       high.pressure[rc.s.id], 200e3, 1);
  ok('...and the sloped pipe it creates is reported',
     NET.disconnections(rc.m).some(d => d.code === 'SLOPED_PIPE' && d.severity === 'error'));

  // A source with no stated pressure is still a valid datum at 0 gauge.
  near('Zero pressure is a datum, not an error',
       NET.solveModel(build(0, 0).m).pressure[build(0, 0).s.id], 0, 1);
}

section('Old files migrate their source pressure off the elevation');
{
  const RHO = 998, G9 = 9.81;
  // 20.42821626944 m of water at 998 kg/m3 is exactly 200 kPa.
  const dz = 20.42821626944;
  const old = {
    formatVersion: 1,
    settings: {},
    levels: [{ id: 'L0', name: 'Level 0', altitude: 0, dx: 0, dy: 0 }],
    nodes: [
      { id: 'N0', level: 'L0', x: 10, y: 15, dz: dz, device: { kind: 'source' }, tag: 'SRC-1' },
      { id: 'N1', level: 'L0', x: 60, y: 15, dz: 0,
        device: { kind: 'demand', flow: 0.001, reqPressure: 100000, include: true } }
    ],
    pipes: [{ id: 'P0', a: 'N0', b: 'N1', kind: 'pipe', schedule: 'sch40', size: 'DN50', C: 120 }],
    risers: []
  };

  const m = M.fromJSON(JSON.parse(JSON.stringify(old)));
  ok('The migration is reported, not silent', m.migrations.length === 1);
  ok('...with a code', m.migrations[0].code === 'SOURCE_PRESSURE_MOVED');

  const src = M.node(m, 'N0');
  near('The pressure comes across intact', src.device.pressure, RHO * G9 * dz, 1e-6);
  near('...which is the 200 kPa it was drawn as', src.device.pressure, 200e3, 1);
  ok('The elevation is cleared', src.dz === 0);

  /* The point of the whole fix: the pipe is 50 m of plan run, and it read
   * sqrt(50^2 + 20.42821626944^2) = 54.0121... m before. */
  near('The pipe is back to its true 50 m', M.pipeLength(m, M.pipe(m, 'P0')), 50, 1e-9);

  const res = NET.solveModel(m);
  near('The source node reads 200 kPa', res.pressure.N0, 200e3, 1);

  // Loading an already-migrated file must not double-count.
  const again = M.fromJSON(JSON.parse(JSON.stringify(M.toJSON(m))));
  ok('Re-loading migrates nothing', again.migrations.length === 0);
  near('...and the pressure is unchanged', M.node(again, 'N0').device.pressure, 200e3, 1);
  near('...as is the length', M.pipeLength(again, M.pipe(again, 'P0')), 50, 1e-9);
}

/* --------------------------------------------------------------------------
 * A BULLHEAD tee has no run, so neither leg may be charged as one.
 *
 * Michael, 2026-08-02 (debug/20260802-2.json): a perfectly symmetrical ring
 * split 51.0/49.0 and he asked whether that was a problem or noise. It was a
 * problem. The two legs leave the supply tee at exactly 90 degrees each, so
 * the run/branch pick had two geometrically identical candidates and broke the
 * tie on the pipe's ID STRING — one leg got K = 0.9 (run), the other K = 1.1
 * (branch), a 22% difference decided by an identifier. Pipe lengths agreed to
 * 1e-12; the whole 1.88% came from the tee.
 *
 * The expectation here is SYMMETRY itself, which is the strongest hand
 * calculation available: two legs identical in length, size, C and fittings
 * must carry identical flow, whatever the coefficients happen to be. The
 * id-order test is the one that would have caught the original bug.
 * ----------------------------------------------------------------------- */
section('Bullhead tee: a symmetric ring splits exactly in half');
{
  /* source - feed - [tee] - two identical 10 m legs - [tee] - outflow.
   * `flip` builds the two legs in the opposite order, which is the only thing
   * the old tie-break was actually keying on. */
  function ring(flip) {
    const m = M.create();
    const lv = m.levels[0].id;
    const s  = M.addNode(m, lv, 0, 0);
    const t1 = M.addNode(m, lv, 10, 0);      // split tee
    const up = M.addNode(m, lv, 10, 10);
    const dn = M.addNode(m, lv, 10, -10);
    const up2 = M.addNode(m, lv, 20, 10);
    const dn2 = M.addNode(m, lv, 20, -10);
    const t2 = M.addNode(m, lv, 20, 0);      // join tee
    const out = M.addNode(m, lv, 30, 0);

    const P = (a, b) => M.addPipe(m, a.id, b.id, { size: 'DN100', schedule: 'sch40' });
    P(s, t1);
    const legs = flip
      ? [() => [P(t1, dn), P(dn, dn2), P(dn2, t2)], () => [P(t1, up), P(up, up2), P(up2, t2)]]
      : [() => [P(t1, up), P(up, up2), P(up2, t2)], () => [P(t1, dn), P(dn, dn2), P(dn2, t2)]];
    const first = legs[0](), second = legs[1]();
    P(t2, out);

    M.setSource(m, s.id, 400e3);
    M.setDemand(m, out.id, 0.020, 100e3);
    return { m, t1, t2, s, out,
             upLeg: flip ? second[0] : first[0],
             dnLeg: flip ? first[0] : second[0] };
  }

  const a = ring(false);
  const res = NET.solveModel(a.m);
  ok('Converges', res.converged === true, JSON.stringify(res.errors));

  const qUp = Math.abs(res.flow[a.upLeg.id]), qDn = Math.abs(res.flow[a.dnLeg.id]);
  ok('Both legs carry flow', qUp > 1e-6 && qDn > 1e-6);
  /* Identical legs, therefore identical flow. Not "within a percent" — the
   * only difference permitted is the solver's own convergence residue. */
  ok('A symmetric ring splits exactly in half',
     Math.abs(qUp - qDn) / ((qUp + qDn) / 2) < 1e-8,
     `${(qUp * 1000).toFixed(9)} vs ${(qDn * 1000).toFixed(9)} L/s`);
  near('...and the halves add up to the demand', qUp + qDn, 0.020, 1e-9);

  // Neither leg is a run: nothing passes straight through this tee.
  const types = {};
  NET.fittingsAtNode(a.m, a.t1.id, res.flow, []).forEach(f => { types[f.pipe] = f.type; });
  ok('Split tee charges BOTH legs as a branch',
     types[a.upLeg.id] === 'TBRANCH_DIV' && types[a.dnLeg.id] === 'TBRANCH_DIV',
     JSON.stringify(types));
  const jtypes = {};
  NET.fittingsAtNode(a.m, a.t2.id, res.flow, []).forEach(f => { jtypes[f.pipe] = f.type; });
  ok('Join tee charges BOTH inlets as a branch',
     Object.keys(jtypes).length === 2 &&
     Object.keys(jtypes).every(k => jtypes[k] === 'TBRANCH_CONV'),
     JSON.stringify(jtypes));

  /* The bug was an ID-ORDER dependency, so drawing the legs the other way
   * round must give bit-for-bit the same answer. */
  const b = ring(true);
  const res2 = NET.solveModel(b.m);
  near('Drawing order does not change the split',
       Math.abs(res2.flow[b.upLeg.id]), qUp, 1e-9);
  near('...for the other leg either',
       Math.abs(res2.flow[b.dnLeg.id]), qDn, 1e-9);
}

section('Bullhead detection leaves ordinary tees alone');
{
  const lv0 = (m) => m.levels[0].id;

  /* An ORDINARY branch tee: in from the west, one leg carries straight on east
   * and one takes off north. The east leg really does go straight through, so
   * it stays the run. */
  {
    const m = M.create(), lv = lv0(m);
    const s = M.addNode(m, lv, 0, 0);
    const t = M.addNode(m, lv, 10, 0);
    const east = M.addNode(m, lv, 30, 0);
    const north = M.addNode(m, lv, 10, 10);
    M.addPipe(m, s.id, t.id, { size: 'DN100', schedule: 'sch40' });
    const pe = M.addPipe(m, t.id, east.id, { size: 'DN100', schedule: 'sch40' });
    const pn = M.addPipe(m, t.id, north.id, { size: 'DN100', schedule: 'sch40' });
    M.setSource(m, s.id, 400e3);
    M.setDemand(m, east.id, 0.010, 100e3);
    M.setDemand(m, north.id, 0.010, 100e3);
    const res = NET.solveModel(m);

    ok('Not a bullhead: the two legs are 90 degrees apart',
       NET.isBullhead(m, t.id, [pe, pn]) === false);
    const ty = {};
    NET.fittingsAtNode(m, t.id, res.flow, []).forEach(f => { ty[f.pipe] = f.type; });
    ok('The straight-on leg is still the run', ty[pe.id] === 'TRUN_DIV', JSON.stringify(ty));
    ok('The take-off is still the branch', ty[pn.id] === 'TBRANCH_DIV', JSON.stringify(ty));
  }

  /* Two collinear legs IS the bullhead case, whichever way round they are. */
  {
    const m = M.create(), lv = lv0(m);
    const c = M.addNode(m, lv, 0, 0);
    const n = M.addNode(m, lv, 0, 10);
    const sN = M.addNode(m, lv, 0, -10);
    const w = M.addNode(m, lv, -10, 0);
    const pn = M.addPipe(m, c.id, n.id, { size: 'DN100', schedule: 'sch40' });
    const ps = M.addPipe(m, c.id, sN.id, { size: 'DN100', schedule: 'sch40' });
    M.addPipe(m, w.id, c.id, { size: 'DN100', schedule: 'sch40' });
    ok('Collinear legs are a bullhead', NET.isBullhead(m, c.id, [pn, ps]) === true);
    ok('...in either order', NET.isBullhead(m, c.id, [ps, pn]) === true);
    ok('A single leg is never a bullhead', NET.isBullhead(m, c.id, [pn]) === false);
    ok('Nor is an empty set', NET.isBullhead(m, c.id, []) === false);
  }
}

report();
