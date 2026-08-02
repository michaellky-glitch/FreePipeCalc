/* FreePipeCalc — geometry editing (spec §6)
 *
 * Changing a pipe's length must never change any OTHER pipe's length: the
 * far side of the edited pipe translates rigidly. That works until the far
 * side is tied back to the near side — by a loop, or by a riser column that
 * only partly moves — at which point no rigid translation exists and the
 * change is a genuine geometry conflict.
 *
 * This module is deliberately UI-free and pure-ish so it can be unit tested:
 * every entry point reports what it would do, or what stopped it, and the
 * caller decides whether to show a dialog.
 */
(function (FD) {
  'use strict';

  var M = FD.model;
  var EPS = 1e-9;

  // ------------------------------------------------------------- helpers
  /* Nodes reachable from `startId` without using any pipe in `excluded`. */
  function componentFrom(m, startId, excluded) {
    var skip = {};
    (excluded || []).forEach(function (id) { skip[id] = true; });
    var seen = {}, stack = [startId];
    seen[startId] = true;
    while (stack.length) {
      var cur = stack.pop();
      M.pipesAt(m, cur).forEach(function (p) {
        if (skip[p.id]) return;
        var o = M.other(p, cur);
        if (!seen[o]) { seen[o] = true; stack.push(o); }
      });
    }
    return seen;
  }

  /* Shortest path of pipes from `fromId` to `toId`, not using `excluded`.
   * Returns [pipe, ...] or null. Used to identify the loop that blocks an
   * edit — the path plus the edited pipe IS the cycle. */
  function pathBetween(m, fromId, toId, excluded) {
    var skip = {};
    (excluded || []).forEach(function (id) { skip[id] = true; });
    var prev = {}, seen = {}, queue = [fromId];
    seen[fromId] = true;
    while (queue.length) {
      var cur = queue.shift();
      if (cur === toId) break;
      M.pipesAt(m, cur).forEach(function (p) {
        if (skip[p.id]) return;
        var o = M.other(p, cur);
        if (seen[o]) return;
        seen[o] = true;
        prev[o] = { node: cur, pipe: p };
        queue.push(o);
      });
    }
    if (!seen[toId]) return null;
    var out = [], cur2 = toId;
    while (cur2 !== fromId) {
      var step = prev[cur2];
      if (!step) return null;
      out.unshift(step.pipe);
      cur2 = step.node;
    }
    return out;
  }

  /* Plan-direction unit vector of a pipe, in world XY. Null for anything with
   * no horizontal extent (a riser). */
  function planDir(m, p) {
    var a = M.node(m, p.a), b = M.node(m, p.b);
    if (!a || !b) return null;
    var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
    var dx = wb.x - wa.x, dy = wb.y - wa.y;
    var len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    return { x: dx / len, y: dy / len, len: len };
  }

  /* Snapshot every pipe's length, so a repair can be diffed afterwards rather
   * than trusted to report itself. */
  function snapshotLengths(m) {
    var out = {};
    m.pipes.forEach(function (p) { out[p.id] = M.pipeLength(m, p); });
    return out;
  }

  function diffLengths(m, before) {
    var changes = [];
    m.pipes.forEach(function (p) {
      var was = before[p.id];
      if (was === undefined) return;
      var now = M.pipeLength(m, p);
      if (Math.abs(now - was) > 1e-6) {
        changes.push({
          pipe: p.id,
          from: p.a, to: p.b,
          oldLength: was,
          newLength: now
        });
      }
    });
    return changes;
  }

  /* Translate a set of nodes by a world delta. Node coordinates are
   * level-local, but the offset of each level is unchanged, so adding the same
   * delta to local coordinates moves every node by the same amount in world
   * space regardless of which level it sits on. */
  function translateNodes(m, nodeSet, dx, dy) {
    Object.keys(nodeSet).forEach(function (id) {
      var n = M.node(m, id);
      if (n) { n.x += dx; n.y += dy; }
    });
  }

  /* Riser columns are anchored to a world XY shared by every level they touch.
   * If ALL of a column's attachments are inside the moving set, the column
   * moves with them and nothing breaks. If only SOME are, the column would be
   * torn in two — that is a conflict, not something to silently fudge. */
  function riserStatus(m, nodeSet) {
    var moving = [], torn = [];
    m.risers.forEach(function (r) {
      var inSet = r.attachments.filter(function (a) { return nodeSet[a.node]; }).length;
      if (inSet === 0) return;
      if (inSet === r.attachments.length) moving.push(r);
      else torn.push(r);
    });
    return { moving: moving, torn: torn };
  }

  // -------------------------------------------------------- length change
  /* Attempt a rigid length change. Does NOT mutate on failure.
   *
   * Returns:
   *   { ok:true,  changes:[...] }
   *   { ok:false, code:'LOOP',  conflict:[pipeIds], cycle:[pipeIds] }
   *   { ok:false, code:'RISER_TORN', risers:[ids] }
   *   { ok:false, code:'...' , message }
   */
  function changeLength(m, pipeId, newLength) {
    var p = M.pipe(m, pipeId);
    if (!p) return { ok: false, code: 'NO_PIPE', message: 'Pipe not found.' };
    if (p.kind === 'riser') {
      return { ok: false, code: 'RISER',
               message: 'Riser length is set by the level altitudes, not here.' };
    }
    if (!(newLength > 0)) {
      return { ok: false, code: 'BAD_LENGTH', message: 'Length must be greater than zero.' };
    }

    var dir = planDir(m, p);
    if (!dir) {
      return { ok: false, code: 'NO_DIRECTION',
               message: 'This pipe has no horizontal direction to extend along.' };
    }

    /* Plan distance IS the pipe's length: a layout pipe is horizontal by rule
     * and M.pipeLength no longer carries an elevation term (model.pipeLength).
     * Before that rule this comparison was a real and silent bug — a sloped
     * pipe reported "already that length, nothing to do" and could not be
     * edited at all. It is correct now because the two are the same number,
     * and `SLOPED_PIPE` catches any model where they are not. */
    var delta = newLength - dir.len;
    if (Math.abs(delta) < 1e-9) return { ok: true, changes: [] };

    var comp = componentFrom(m, p.b, [p.id]);

    // Far side tied back to the near side: no rigid translation exists.
    if (comp[p.a]) {
      var cycle = pathBetween(m, p.a, p.b, [p.id]) || [];
      return {
        ok: false, code: 'LOOP',
        cycle: cycle.map(function (x) { return x.id; }),
        conflict: cycle.map(function (x) { return x.id; }),
        message: 'Length is locked by a loop — the far end of this pipe is tied ' +
                 'back to the near end, so it cannot simply move.'
      };
    }

    var risers = riserStatus(m, comp);
    if (risers.torn.length) {
      return {
        ok: false, code: 'RISER_TORN',
        risers: risers.torn.map(function (r) { return r.id; }),
        conflict: m.pipes.filter(function (x) { return x.kind === 'riser'; })
                         .map(function (x) { return x.id; }),
        message: 'A riser column is anchored on both sides of this change, so ' +
                 'moving it would pull the column apart.'
      };
    }

    var before = snapshotLengths(m);
    translateNodes(m, comp, dir.x * delta, dir.y * delta);
    /* Columns entirely inside the moving set travel with it — this is what
     * lets a change upstream of a riser carry every floor above it along. */
    risers.moving.forEach(function (r) { r.x += dir.x * delta; r.y += dir.y * delta; });

    return { ok: true, changes: diffLengths(m, before), movedRisers: risers.moving.length };
  }

  // -------------------------------------------------------------- repair
  /* Make the requested length fit by ALSO changing one other member of the
   * blocking loop, then report every length that moved.
   *
   * Strategy: cut the loop at the member most parallel to the edited pipe and
   * translate everything on the far side. For a rectangle, editing the top
   * edge cuts the bottom edge, slides the whole right-hand side across, and
   * the bottom stretches to match — which is the intuitive repair. Candidates
   * are tried in order of parallelism, so a cut that leaves another loop
   * intact simply falls through to the next one.
   *
   * This is a heuristic, not a constraint solver. It reports exactly what it
   * changed so the result can be checked, and refuses rather than guessing
   * when no candidate works.
   */
  function repairLength(m, pipeId, newLength) {
    var p = M.pipe(m, pipeId);
    if (!p) return { ok: false, message: 'Pipe not found.' };

    var dir = planDir(m, p);
    if (!dir) return { ok: false, message: 'This pipe has no horizontal direction.' };
    var delta = newLength - dir.len;
    if (Math.abs(delta) < 1e-9) return { ok: true, changes: [] };

    var cyclePipes = pathBetween(m, p.a, p.b, [p.id]);
    if (!cyclePipes || !cyclePipes.length) {
      return { ok: false, message: 'No loop found to repair against.' };
    }

    // Rank candidate cuts by how parallel they are to the edited pipe.
    var candidates = cyclePipes.map(function (c) {
      var cd = planDir(m, c);
      var par = cd ? Math.abs(cd.x * dir.x + cd.y * dir.y) : -1;
      return { pipe: c, parallel: par, len: cd ? cd.len : 0 };
    }).filter(function (c) { return c.parallel >= 0 && c.pipe.kind !== 'riser'; })
      .sort(function (a, b) {
        if (Math.abs(b.parallel - a.parallel) > 1e-6) return b.parallel - a.parallel;
        return b.len - a.len;                       // prefer stretching a long member
      });

    for (var i = 0; i < candidates.length; i++) {
      var cut = candidates[i].pipe;
      var comp = componentFrom(m, p.b, [p.id, cut.id]);
      if (comp[p.a]) continue;                      // still tied back — another loop

      var risers = riserStatus(m, comp);
      if (risers.torn.length) continue;             // would tear a column

      var before = snapshotLengths(m);
      translateNodes(m, comp, dir.x * delta, dir.y * delta);
      risers.moving.forEach(function (r) { r.x += dir.x * delta; r.y += dir.y * delta; });

      var changes = diffLengths(m, before);
      var achieved = M.pipeLength(m, p);
      if (Math.abs(achieved - newLength) > 1e-6) {
        // Did not actually land on the requested length — undo and try again.
        translateNodes(m, comp, -dir.x * delta, -dir.y * delta);
        risers.moving.forEach(function (r) { r.x -= dir.x * delta; r.y -= dir.y * delta; });
        continue;
      }

      return { ok: true, changes: changes, cutPipe: cut.id };
    }

    return {
      ok: false,
      message: 'Could not repair this geometry automatically. The loop is ' +
               'constrained in a way that has no single-member fix — change the ' +
               'opposing pipe by hand, or break the loop first.'
    };
  }

  FD.geometry = {
    componentFrom: componentFrom,
    pathBetween: pathBetween,
    planDir: planDir,
    changeLength: changeLength,
    repairLength: repairLength,
    snapshotLengths: snapshotLengths,
    diffLengths: diffLengths
  };
})(window.FD = window.FD || {});
