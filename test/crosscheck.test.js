/* FreePipeCalc — INDEPENDENT-ALGORITHM CROSS-CHECK
 * ===================================================================
 *
 * The biggest gap in the project (HANDOVER §7): almost every number is internal
 * consistency plus hand calculations by the author of the code. This suite
 * closes part of it by checking the NETWORK SOLVE against a completely separate
 * algorithm.
 *
 * FreePipeCalc solves the network by the Global Gradient Algorithm — a Newton
 * step on the NODAL head equations, factorised as a skyline LDLᵀ (see
 * `solver.js`). This file re-solves the SAME networks by the HARDY CROSS method
 * — correcting the flow around one fundamental LOOP at a time until the head
 * balance closes. Different unknowns (loop-flow corrections, not nodal heads),
 * different iteration, no shared linear algebra. When two unrelated algorithms
 * land on the same flows, the answer is the physics and not a bug either of them
 * happens to share.
 *
 * WHAT IS AND IS NOT BEING CHECKED. The per-pipe head-loss law — Hazen-Williams
 * resistance from bore, length and C — is Michael's, and is the ONE piece
 * already validated against straight pipe (HANDOVER §7). So the Hardy Cross
 * solver is handed each pipe's own r and n out of the assembled network and
 * asked only to distribute the flow. That isolates the thing that was NOT
 * independently checked — how flow splits around a looped network — from the
 * thing that was. Re-deriving r here as well would test the pipe law twice and
 * the distribution not at all.
 *
 * HAZEN-WILLIAMS ONLY, and deliberately. Its resistance depends on geometry
 * alone, so a pipe is a fixed r·Q^1.852 and the two solvers face an identical
 * problem. Darcy-Weisbach (BETA) carries a friction factor that moves with the
 * Reynolds number — r is a function of the flow — so a constant-r Hardy Cross
 * would be solving a different system, and matching it would mean reproducing
 * the friction-factor correlation, i.e. testing the physics rather than the
 * solver. That is a separate exercise (a published single-pipe table), not this
 * one.
 *
 * The test networks are looped on purpose — a tree has one flow path and nothing
 * to distribute. Demands are chosen so flow REVERSES in some pipes (a shared
 * pipe fed from both ends), which is where a sign error in either solver would
 * show. The expected numbers are not written here: they are computed live by the
 * independent method, which is the whole point.
 * =================================================================== */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['src/model.js', 'src/geometry.js', 'data/pumps.js',
                 'data/valves.js', 'src/hydraulics.js', 'src/solver.js',
                 'src/network.js', 'src/thermal.js']);
const M = FD.model, NET = FD.network;

const RHO = 998, G = 9.80665;

/* ---- THE INDEPENDENT SOLVER --------------------------------------------
 *
 * Hardy Cross by fundamental loops. Given pipes {id, from, to, r, n}, the node
 * demands (withdrawals; the source supplies their sum), and the source node:
 *
 *   1. build a spanning tree from the source; the non-tree pipes are CHORDS,
 *      and there is one independent loop per chord;
 *   2. seed continuity-satisfying flows by routing each demand back to the
 *      source along the tree — chords start at zero;
 *   3. for each loop, correct the flow by ΔQ = −Σh / Σ(dh/dQ), where the head
 *      loss in a pipe, signed in the flow direction, is h = r·Q·|Q|^(n−1);
 *   4. repeat until the largest correction vanishes.
 *
 * None of this touches FreePipeCalc's solver — only its per-pipe r and n. */
function hardyCross(pipes, demands, sourceId, opts) {
  opts = opts || {};
  const tol = opts.tol || 1e-14, maxIter = opts.maxIter || 200000;

  const nodes = new Set();
  pipes.forEach(p => { nodes.add(p.from); nodes.add(p.to); });
  const adj = {};
  nodes.forEach(n => adj[n] = []);
  pipes.forEach(p => {
    adj[p.from].push({ pipe: p, other: p.to });
    adj[p.to].push({ pipe: p, other: p.from });
  });

  // spanning tree from the source
  const parent = {}, parentEdge = {};
  const seen = new Set([sourceId]);
  const queue = [sourceId];
  parent[sourceId] = null;
  while (queue.length) {
    const u = queue.shift();
    adj[u].forEach(e => {
      if (!seen.has(e.other)) {
        seen.add(e.other);
        parent[e.other] = u;
        parentEdge[e.other] = e.pipe;
        queue.push(e.other);
      }
    });
  }
  const treeSet = new Set(Object.keys(parentEdge).map(k => parentEdge[k].id));

  // continuity-satisfying seed: route each demand along the tree to the source
  const Q = {};
  pipes.forEach(p => Q[p.id] = 0);
  Object.keys(demands).forEach(nId => {
    const w = demands[nId];
    let v = nId;
    while (parent[v] != null) {
      const p = parentEdge[v];
      Q[p.id] += (p.to === v) ? w : -w;         // flow travels parent -> child
      v = parent[v];
    }
  });

  // fundamental loop for each chord: the chord, plus the tree path joining its
  // ends. Directions are relative to the loop's own traversal.
  const chords = pipes.filter(p => !treeSet.has(p.id));
  const loops = chords.map(chord => {
    const members = [{ pipe: chord, dir: +1 }];  // traverse chord from -> to
    // lowest common ancestor of the chord's two ends
    const chainFrom = new Set();
    for (let x = chord.from; x != null; x = parent[x]) chainFrom.add(x);
    let lca = chord.to;
    while (lca != null && !chainFrom.has(lca)) lca = parent[lca];
    // chord.to up to the LCA (child -> parent each step)
    for (let n = chord.to; n !== lca; n = parent[n]) {
      const p = parentEdge[n];
      members.push({ pipe: p, dir: (p.from === n) ? +1 : -1 });
    }
    // LCA down to chord.from (parent -> child); collected upward then reversed
    const down = [];
    for (let n = chord.from; n !== lca; n = parent[n]) down.push(n);
    down.reverse().forEach(n => {
      const p = parentEdge[n];
      members.push({ pipe: p, dir: (p.to === n) ? +1 : -1 });
    });
    return members;
  });

  const h = (p, q) => p.r * q * Math.pow(Math.abs(q), p.n - 1);
  const dh = (p, q) => p.n * p.r * Math.pow(Math.abs(q), p.n - 1);
  let iter = 0, maxDelta = Infinity;
  for (; iter < maxIter && maxDelta > tol; iter++) {
    maxDelta = 0;
    loops.forEach(loop => {
      let num = 0, den = 0;
      loop.forEach(({ pipe, dir }) => {
        const q = dir * Q[pipe.id];
        num += h(pipe, q);
        den += dh(pipe, q);
      });
      if (den < 1e-30) return;
      const dQ = -num / den;
      loop.forEach(({ pipe, dir }) => { Q[pipe.id] += dir * dQ; });
      if (Math.abs(dQ) > maxDelta) maxDelta = Math.abs(dQ);
    });
  }
  return { Q, iter, maxDelta, chords: chords.length };
}

/* ---- THE COMPARISON ----------------------------------------------------- */
function crossCheck(name, buildFn) {
  const m = M.create();
  m.settings.calcMode = 'design';
  m.settings.frictionMethod = 'HW';
  const spec = buildFn(m);
  const res = NET.solveModel(m);

  ok(`${name}: FreePipeCalc solves it`, res.converged === true,
     JSON.stringify((res.errors || []).map(e => e.code)));

  const net = res.network;
  const pipes = net.links.filter(l => l.kind === 'pipe')
    .map(l => ({ id: l.id, from: l.from, to: l.to, r: l.r, n: l.n }));

  /* FreePipeCalc honoured the demands — continuity closes at every node. An
   * imposed withdrawal that the solve quietly failed to deliver would make the
   * whole comparison meaningless, so it is checked first, independently. */
  let contResid = 0;
  const nodeIds = new Set();
  pipes.forEach(p => { nodeIds.add(p.from); nodeIds.add(p.to); });
  nodeIds.forEach(nid => {
    if (nid === spec.source) return;
    let inflow = 0;
    pipes.forEach(p => {
      if (p.to === nid) inflow += res.flow[p.id];
      if (p.from === nid) inflow -= res.flow[p.id];
    });
    contResid = Math.max(contResid, Math.abs(inflow - (spec.demands[nid] || 0)));
  });
  ok(`${name}: continuity holds in the FreePipeCalc solution`,
     contResid < 1e-7, `${(contResid * 1000).toExponential(2)} L/s`);

  /* THE INDEPENDENT SOLVE. */
  const hc = hardyCross(pipes, spec.demands, spec.source);
  ok(`${name}: the Hardy Cross solve converges (${hc.chords} loops)`,
     hc.maxDelta < 1e-10, `maxΔ ${hc.maxDelta.toExponential(2)} after ${hc.iter} iters`);

  /* EVERY PIPE FLOW AGREES. The two solvers share no code path below the pipe
   * law, so this is the cross-check itself. 1e-6 relative is a vast margin over
   * the ~1e-11 actually seen — the tolerance is the solvers' convergence, not
   * the method. */
  let worstFlow = 0, worstPipe = '';
  pipes.forEach(p => {
    const qF = res.flow[p.id], qH = hc.Q[p.id];
    const rel = Math.abs(qF - qH) / Math.max(Math.abs(qF), 1e-6);
    if (rel > worstFlow) { worstFlow = rel; worstPipe = p.id; }
  });
  ok(`${name}: every pipe flow matches the independent solve`,
     worstFlow < 1e-6,
     `worst ${worstFlow.toExponential(2)} on ${worstPipe}`);

  /* NODAL HEADS AGREE. Rebuilt from the source datum down the network using the
   * independent flows and the same pipe law; the residual is FreePipeCalc's own
   * GGA convergence, tens of Pa in hundreds of kPa. */
  const head = { [spec.source]: res.pressure[spec.source] };
  let changed = true;
  while (changed) {
    changed = false;
    pipes.forEach(p => {
      const dP = p.r * hc.Q[p.id] * Math.pow(Math.abs(hc.Q[p.id]), p.n - 1) * RHO * G;
      if (head[p.from] != null && head[p.to] == null) { head[p.to] = head[p.from] - dP; changed = true; }
      else if (head[p.to] != null && head[p.from] == null) { head[p.from] = head[p.to] + dP; changed = true; }
    });
  }
  let worstP = 0, worstNode = '';
  Object.keys(head).forEach(id => {
    if (res.pressure[id] == null) return;
    const d = Math.abs(res.pressure[id] - head[id]);
    if (d > worstP) { worstP = d; worstNode = id; }
  });
  ok(`${name}: nodal pressures match within the GGA residual`,
     worstP < 250, `worst ${worstP.toFixed(1)} Pa on ${worstNode}`);
}

/* ---- THE NETWORKS ------------------------------------------------------- */

/* A two-loop grid. The middle rail (N2–N5) is shared between the loops and, at
 * these demands, is fed from N2 — while N3–N4 runs BACKWARDS, drawn toward N3.
 *
 *   N1 --A-- N2 --B-- N3
 *   |         |        |
 *   F         G        C
 *   |         |        |
 *   N6 --E-- N5 --D-- N4
 */
section('Cross-check vs Hardy Cross: two-loop grid');
crossCheck('two-loop grid', m => {
  const lv = m.levels[0].id, N = (x, y) => M.addNode(m, lv, x, y);
  const n1 = N(0, 0), n2 = N(10, 0), n3 = N(20, 0),
        n4 = N(20, 10), n5 = N(10, 10), n6 = N(0, 10);
  const P = (a, b, s) => { const p = M.addPipe(m, a.id, b.id, { size: s, schedule: 'sch40' }); p.insulation_mm = 0; return p; };
  P(n1, n2, 'DN100'); P(n2, n3, 'DN80'); P(n3, n4, 'DN80');
  P(n4, n5, 'DN100'); P(n5, n6, 'DN80'); P(n6, n1, 'DN100'); P(n2, n5, 'DN65');
  M.setSource(m, n1.id, 400000);
  M.setDemand(m, n3.id, 0.020); M.setDemand(m, n4.id, 0.015);
  M.setDemand(m, n5.id, 0.010); M.setDemand(m, n6.id, 0.005);
  return { source: n1.id, demands: { [n3.id]: 0.020, [n4.id]: 0.015, [n5.id]: 0.010, [n6.id]: 0.005 } };
});

/* A three-loop ladder: two rails and four rungs, so three fundamental loops for
 * the independent solver to close simultaneously.
 *
 *   T0 - T1 - T2 - T3
 *   |    |    |    |
 *   B0 - B1 - B2 - B3
 */
section('Cross-check vs Hardy Cross: three-loop ladder');
crossCheck('three-loop ladder', m => {
  const lv = m.levels[0].id, N = (x, y) => M.addNode(m, lv, x, y);
  const T = [N(0, 0), N(10, 0), N(20, 0), N(30, 0)];
  const B = [N(0, 10), N(10, 10), N(20, 10), N(30, 10)];
  const P = (a, b, s) => { const p = M.addPipe(m, a.id, b.id, { size: s, schedule: 'sch40' }); p.insulation_mm = 0; return p; };
  for (let i = 0; i < 3; i++) { P(T[i], T[i + 1], 'DN100'); P(B[i], B[i + 1], 'DN80'); }
  for (let i = 0; i < 4; i++) P(T[i], B[i], 'DN65');
  M.setSource(m, T[0].id, 500000);
  const d = {};
  d[T[2].id] = 0.012; d[B[1].id] = 0.008; d[B[3].id] = 0.010; d[T[3].id] = 0.006; d[B[2].id] = 0.009;
  Object.keys(d).forEach(id => M.setDemand(m, id, d[id]));
  return { source: T[0].id, demands: d };
});

/* The same grid rewired — different bores and a heavier, lopsided demand, so it
 * is a genuinely different flow field and not the first case in disguise. */
section('Cross-check vs Hardy Cross: two-loop grid, rewired');
crossCheck('grid, rewired', m => {
  const lv = m.levels[0].id, N = (x, y) => M.addNode(m, lv, x, y);
  const n1 = N(0, 0), n2 = N(10, 0), n3 = N(20, 0),
        n4 = N(20, 10), n5 = N(10, 10), n6 = N(0, 10);
  const P = (a, b, s) => { const p = M.addPipe(m, a.id, b.id, { size: s, schedule: 'sch40' }); p.insulation_mm = 0; return p; };
  P(n1, n2, 'DN80'); P(n2, n3, 'DN65'); P(n3, n4, 'DN100');
  P(n4, n5, 'DN65'); P(n5, n6, 'DN100'); P(n6, n1, 'DN80'); P(n2, n5, 'DN100');
  M.setSource(m, n1.id, 600000);
  M.setDemand(m, n3.id, 0.030); M.setDemand(m, n6.id, 0.025); M.setDemand(m, n4.id, 0.004);
  return { source: n1.id, demands: { [n3.id]: 0.030, [n6.id]: 0.025, [n4.id]: 0.004 } };
});

report();
