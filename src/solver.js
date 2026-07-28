/* FreePipeCalc — network solver
 *
 * Spec §3.4: Nodal Newton-Raphson / Global Gradient Algorithm (Todini-Pilati),
 * the method EPANET uses. Handles branched and looped topologies, multiple
 * sources, pumps and fixed-flow demands in one framework — no manual loop
 * identification.
 *
 * The solver is deliberately ignorant of drawings, levels and risers. It takes
 * an abstract network and returns heads and flows; network.js is responsible
 * for building that abstraction from the model.
 *
 *   network = {
 *     nodes: [{ id, z, demand, fixedHead }]      z,head in m; demand m³/s OUT
 *     links: [{ id, from, to, kind, r, n, head }]
 *   }
 *
 * kind: 'pipe' | 'equip' — loss  h = r·|Q|^(n-1)·Q
 *       'pump'           — gain  h = −head  (fixed-head pump; curve is v2)
 *
 * Sign convention: link flow Q is positive from `from` to `to`.
 * Head H is TOTAL head (elevation + pressure head), so static lift falls out
 * of the solution naturally; gauge pressure at a node is ρ·g·(H − z).
 */
(function (FD) {
  'use strict';

  var MAX_ITER = 100;
  var TOL_HEAD = 1e-3;      // 1 mm  (spec §3.4)
  var TOL_FLOW = 1e-5;      // 0.01 L/s nodal imbalance (spec §3.4)
  var PUMP_DHDQ_MIN = 1.0;  // regularises the otherwise-singular fixed-head pump

  /* A THIRD criterion, beyond the two the spec names, is required for correctness.
   * A flow circulating around a closed loop satisfies continuity exactly at every
   * node (zero imbalance) and perturbs no head (zero head change) — so head and
   * imbalance tests both pass while the loop flow is still pure numerical
   * residue from the initial guess. Without this test a no-demand ring reports a
   * phantom circulation of whatever the seed flow was, decayed by one iteration.
   * Loop flow decays geometrically by (1 − 1/n) ≈ 0.46 per iteration, so a tight
   * absolute floor costs only a handful of extra iterations. */
  var TOL_DQ_ABS = 1e-8;    // m³/s — absolute flow-change floor
  var TOL_DQ_REL = 1e-4;    // or this fraction of the largest flow in the network

  // ---------------------------------------------------------------- linalg
  /* Dense Gaussian elimination with partial pivoting. Networks here are at
   * most a few hundred junctions, so O(n³) is entirely adequate and avoids
   * shipping a sparse library. Returns null if the matrix is singular. */
  function solveLinear(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i, best = Math.abs(A[i][i]);
      for (k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > best) { best = Math.abs(A[k][i]); piv = k; }
      }
      if (best < 1e-14) return null;
      if (piv !== i) {
        var t = A[i]; A[i] = A[piv]; A[piv] = t;
        var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
      }
      var d = A[i][i];
      for (k = i + 1; k < n; k++) {
        var f = A[k][i] / d;
        if (f === 0) continue;
        for (j = i; j < n; j++) A[k][j] -= f * A[i][j];
        b[k] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  // ------------------------------------------------------- link behaviour
  /* Head loss along the link (from → to) and its derivative w.r.t. Q. */
  function linkLoss(link, q) {
    if (link.kind === 'pump') return -(link.head || 0);
    return FD.hydraulics.headloss(link.r, q, link.n);
  }

  function linkDhdq(link, q) {
    if (link.kind === 'pump') return PUMP_DHDQ_MIN;
    return Math.max(FD.hydraulics.dhdq(link.r, q, link.n), 1e-9);
  }

  // ------------------------------------------------------------ islands
  /* Split the network into connected components so that a detached island
   * without a source can be reported instead of making the matrix singular. */
  function findIslands(nodes, links, index) {
    var parent = nodes.map(function (_, i) { return i; });
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

    links.forEach(function (l) {
      var a = index[l.from], b = index[l.to];
      if (a !== undefined && b !== undefined) union(a, b);
    });

    var groups = {};
    nodes.forEach(function (nd, i) {
      var root = find(i);
      (groups[root] = groups[root] || []).push(i);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // ------------------------------------------------------------- solve
  function solve(network) {
    var nodes = network.nodes || [];
    var links = network.links || [];
    var errors = [], warnings = [];

    var index = {};
    nodes.forEach(function (nd, i) { index[nd.id] = i; });

    var H = new Array(nodes.length);
    var Q = {};
    links.forEach(function (l) { Q[l.id] = (l.q0 !== undefined) ? l.q0 : 1e-4; });

    // Initial heads: fixed where given, otherwise the node's own elevation.
    nodes.forEach(function (nd, i) {
      H[i] = (nd.fixedHead !== null && nd.fixedHead !== undefined) ? nd.fixedHead : nd.z;
    });

    // --- islands: only components containing a fixed head are solvable ---
    var islands = findIslands(nodes, links, index);
    var solvable = new Array(nodes.length).fill(false);
    var deadIslands = [];

    islands.forEach(function (members) {
      var hasSource = members.some(function (i) {
        return nodes[i].fixedHead !== null && nodes[i].fixedHead !== undefined;
      });
      if (hasSource) {
        members.forEach(function (i) { solvable[i] = true; });
      } else {
        var demanding = members.filter(function (i) { return Math.abs(nodes[i].demand || 0) > 0; });
        deadIslands.push({ nodes: members.map(function (i) { return nodes[i].id; }),
                           hasDemand: demanding.length > 0 });
        if (demanding.length) {
          errors.push({
            code: 'ISLAND_NO_SOURCE',
            message: 'Disconnected section has demand but no source.',
            nodes: demanding.map(function (i) { return nodes[i].id; })
          });
        }
        // Closed loop with no demand: Q = 0 everywhere is a valid answer (§3.4).
        members.forEach(function (i) { H[i] = nodes[i].z; });
      }
    });

    links.forEach(function (l) {
      if (!solvable[index[l.from]]) Q[l.id] = 0;
    });

    // Unknown heads = solvable junctions that are not fixed-head.
    var unknown = [], slot = {};
    nodes.forEach(function (nd, i) {
      var fixed = (nd.fixedHead !== null && nd.fixedHead !== undefined);
      if (solvable[i] && !fixed) { slot[i] = unknown.length; unknown.push(i); }
    });

    if (!unknown.length) {
      return finish(true, 0, 0);
    }

    var n = unknown.length, iter = 0, converged = false, maxDH = Infinity, maxImb = Infinity;

    for (iter = 1; iter <= MAX_ITER; iter++) {
      // Assemble  A·H = F   (see derivation in docs/ENGINE.md)
      var A = [], F = new Array(n).fill(0), i;
      for (i = 0; i < n; i++) A.push(new Array(n).fill(0));

      for (i = 0; i < n; i++) F[i] = -(nodes[unknown[i]].demand || 0);

      links.forEach(function (l) {
        var si = index[l.from], ei = index[l.to];
        if (!solvable[si] || !solvable[ei]) return;

        var q = Q[l.id];
        var dh = linkDhdq(l, q);
        var p = 1 / dh;
        var y = p * linkLoss(l, q);
        var c = y - q;                       // constant term of the linearised link

        var su = slot[si], eu = slot[ei];
        var sFixed = (su === undefined), eFixed = (eu === undefined);

        if (!sFixed) {
          A[su][su] += p;
          F[su] += c;
          if (eFixed) F[su] += p * H[ei];
          else A[su][eu] -= p;
        }
        if (!eFixed) {
          A[eu][eu] += p;
          F[eu] -= c;
          if (sFixed) F[eu] += p * H[si];
          else A[eu][su] -= p;
        }
      });

      var Hnew = solveLinear(A, F);
      if (!Hnew) {
        errors.push({ code: 'SINGULAR', message: 'Solver matrix is singular — check for isolated or duplicated nodes.' });
        return finish(false, iter, Infinity);
      }

      // Head change & flow update
      maxDH = 0;
      for (i = 0; i < n; i++) {
        var gi = unknown[i];
        maxDH = Math.max(maxDH, Math.abs(Hnew[i] - H[gi]));
        H[gi] = Hnew[i];
      }

      var maxDQ = 0, maxQ = 0;
      links.forEach(function (l) {
        var si = index[l.from], ei = index[l.to];
        if (!solvable[si] || !solvable[ei]) return;
        var q = Q[l.id];
        var p = 1 / linkDhdq(l, q);
        var c = p * linkLoss(l, q) - q;
        var qn = p * (H[si] - H[ei]) - c;
        maxDQ = Math.max(maxDQ, Math.abs(qn - q));
        maxQ = Math.max(maxQ, Math.abs(qn));
        Q[l.id] = qn;
      });

      // Continuity residual at every unknown node
      maxImb = 0;
      var bal = new Array(nodes.length).fill(0);
      links.forEach(function (l) {
        var si = index[l.from], ei = index[l.to];
        if (!solvable[si] || !solvable[ei]) return;
        bal[si] -= Q[l.id];
        bal[ei] += Q[l.id];
      });
      for (i = 0; i < n; i++) {
        var g = unknown[i];
        maxImb = Math.max(maxImb, Math.abs(bal[g] - (nodes[g].demand || 0)));
      }

      var flowSettled = (maxDQ < TOL_DQ_ABS) || (maxDQ < TOL_DQ_REL * maxQ);
      if (maxDH < TOL_HEAD && maxImb < TOL_FLOW && flowSettled) { converged = true; break; }
    }

    if (!converged) {
      errors.push({
        code: 'NO_CONVERGE',
        message: 'Solver did not converge in ' + MAX_ITER + ' iterations (max head change ' +
                 maxDH.toExponential(2) + ' m, max imbalance ' + (maxImb * 1000).toFixed(3) + ' L/s).'
      });
    }

    return finish(converged, iter, maxImb);

    // ---------------------------------------------------------------
    function finish(ok, iterations, imbalance) {
      var heads = {}, pressures = {};
      /* Head is in metres OF THE WORKING FLUID, so converting it to pressure
       * must use that fluid's density — not a hard-coded 998. The network
       * carries rho from the model's fluid settings. */
      var rho = network.rho || 998;
      var g = 9.81;

      /* Anything below the linearisation cutoff is numerical dust, not flow.
       * Snapping it to exactly zero is what makes "grey = no flow" pipe
       * colouring (spec §4) stable instead of flickering on rounding. */
      Object.keys(Q).forEach(function (k) {
        if (Math.abs(Q[k]) < FD.hydraulics.Q_MIN) Q[k] = 0;
      });

      nodes.forEach(function (nd, i) {
        heads[nd.id] = H[i];
        pressures[nd.id] = rho * g * (H[i] - nd.z);          // gauge (spec §10)
      });
      return {
        ok: ok && !errors.length,
        converged: ok,
        iterations: iterations,
        imbalance: imbalance,
        head: heads,
        pressure: pressures,
        flow: Q,
        errors: errors,
        warnings: warnings,
        islands: islands.length,
        deadIslands: deadIslands
      };
    }
  }

  FD.solver = {
    solve: solve,
    solveLinear: solveLinear,          // exported for the test harness
    MAX_ITER: MAX_ITER,
    TOL_HEAD: TOL_HEAD,
    TOL_FLOW: TOL_FLOW
  };
})(window.FD = window.FD || {});
