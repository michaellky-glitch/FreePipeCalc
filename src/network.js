/* FreePipeCalc — model → solver network translation
 *
 * Spec §3.3/§3.4. This is where drawn geometry becomes hydraulics:
 *   - fittings are inferred from the angles between pipes at each node
 *   - equivalent length is charged to the downstream pipe
 *   - tee run/branch assignment depends on FLOW DIRECTION, which is only known
 *     after solving — hence the two-pass solve in solveModel()
 */
(function (FD) {
  'use strict';

  var M = FD.model;

  // -------------------------------------------------------------- geometry
  /* 3D position of a node in world space: level offset applied to x,y and
   * level altitude + per-node offset for z. */
  function pos3(m, n) {
    var w = M.worldXY(m, n);
    return { x: w.x, y: w.y, z: M.elevation(m, n) };
  }

  /* Unit vector pointing from node `at` along pipe `p`. */
  function dirFrom(m, p, atId) {
    var a = M.node(m, atId), b = M.node(m, M.other(p, atId));
    if (!a || !b) return null;
    var pa = pos3(m, a), pb = pos3(m, b);
    var v = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
    var len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-9) return null;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  /* Deviation from straight, in degrees, between two pipes meeting at a node.
   * Two collinear pipes have OPPOSITE outgoing vectors, so a dot of -1 means
   * straight through (0° deviation) and a dot of 0 means a square corner. */
  function deviation(v1, v2) {
    if (!v1 || !v2) return 0;
    var dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    dot = Math.max(-1, Math.min(1, dot));
    return 180 - Math.acos(dot) * 180 / Math.PI;
  }

  // -------------------------------------------------------------- fittings
  /* Work out which fittings sit at `nodeId` and which pipe each is charged to.
   *
   * `flows` (optional) is the flow map from a previous solve. Without it the
   * assignment is a geometric guess; with it, run/branch and downstream are
   * resolved properly.
   *
   * Returns [{ pipe, type }].
   */
  function fittingsAtNode(m, nodeId, flows, warnings) {
    var pipes = M.pipesAt(m, nodeId);
    var out = [];
    if (pipes.length < 2) return out;          // dead end / terminal: no fitting

    /* Is this pipe carrying flow AWAY from the node? That makes it the
     * downstream pipe, which is what the fitting is charged to (spec §3.3). */
    function isDownstream(p) {
      if (!flows) return p.a === nodeId;       // geometric guess before solving
      var q = flows[p.id] || 0;
      // link flow is positive a→b, so it leaves this node when...
      return (p.a === nodeId) ? q > 0 : q < 0;
    }

    if (pipes.length === 2) {
      var dev = deviation(dirFrom(m, pipes[0], nodeId), dirFrom(m, pipes[1], nodeId));
      var type = FD.fittings.elbowForAngle(dev);
      if (!type) return out;                   // collinear — pipes just merge
      var down = pipes.find(isDownstream) || pipes[1];
      out.push({ pipe: down.id, type: type });
      return out;
    }

    /* --- tee (3 pipes) or cross (4+) ---
     *
     * Four pipes at a node used to raise a CROSS warning. It was removed at
     * Michael's request (2026-07-31): four-way junctions are ordinary in real
     * pipework — a ring main crossing a branch, headers in a plant room — and
     * the modelling (two tee branches) is a reasonable treatment rather than
     * something the engineer must act on. The warning fired on every such node
     * and buried the warnings that do need attention. The handling below is
     * unchanged; only the noise is gone. */
    var runPair = pickRunPair(m, nodeId, pipes, flows);

    /* Dividing and combining tees are different fittings, and which one this is
     * depends on the flow, so it is only knowable on the second pass.
     *
     * The charging rule differs too, and getting it wrong was a real error:
     *
     *   DIVIDING (one in, two out) — charge both OUTLETS. Each leaving stream
     *   pays for the split it went through.
     *
     *   COMBINING (two in, one out) — charge both INLETS. This is the case that
     *   was wrong: equivalent length went only to the downstream leg, so the
     *   branch inflow, which suffers most of the loss in a combining tee, was
     *   charged nothing at all. Combining tees were systematically
     *   under-resistanced.
     *
     * Without a previous pass there are no flow directions, so it falls back to
     * the old geometric guess and the undifferentiated coefficients. */
    if (!flows) {
      var down0 = pipes.filter(isDownstream);
      var up0 = pipes.filter(function (p) { return !isDownstream(p); });
      var bull0 = isSymmetricSplit(m, nodeId, down0,
                                   up0.length === 1 ? up0[0] : null);
      down0.forEach(function (p) {
        var isRun0 = !bull0 && (p.id === runPair[0] || p.id === runPair[1]);
        out.push({ pipe: p.id, type: isRun0 ? 'TRUN' : 'TBRANCH' });
      });
      return out;
    }

    var ins = [], outs = [];
    pipes.forEach(function (p) {
      (isDownstream(p) ? outs : ins).push(p);
    });

    /* Everything one way (or all zero) is not a tee doing anything — no flow is
     * being split or merged, so there is nothing to charge. */
    if (!ins.length || !outs.length) return out;

    var dividing = outs.length >= ins.length;
    var charged = dividing ? outs : ins;

    /* A SYMMETRIC split has no run, so neither charged leg may be called one.
     * The common leg is the single one on the other side. */
    var common = (dividing ? ins : outs);
    var bull = isSymmetricSplit(m, nodeId, charged,
                                common.length === 1 ? common[0] : null);

    /* WHAT THE FLOW-RATIO COEFFICIENT NEEDS (TEE.1).
     *
     * Idel'chik's tee coefficients are functions of Qb/Qc and Fb/Fc, and are
     * quoted in terms of the velocity in the COMMON channel — the single leg on
     * the other side of the split. Both are measurable here and nowhere else:
     * this is the one place that knows which leg is common, which are charged,
     * and how much water each carries.
     *
     * The area ratio is DERIVED FROM THE BORES (Michael, 2026-08-30) rather
     * than assumed to be 1. A DN50 branch off a DN100 main is Fb/Fc = 0.25 and
     * the table says that costs several times what an equal-size branch does,
     * which is exactly the distinction a flat coefficient cannot make.
     *
     * `common.length === 1` guards a cross, where there is no single common
     * channel and the ratio is not defined. */
    var qOf = function (pp) { return Math.abs((flows && flows[pp.id]) || 0); };
    var areaOf = function (pp) {
      var d = M.pipeBore(m, pp);
      return (d > 0) ? Math.PI * d * d / 4 : 0;
    };
    var commonPipe = (common.length === 1) ? common[0] : null;
    var qCommon = commonPipe ? qOf(commonPipe) : 0;
    var aCommon = commonPipe ? areaOf(commonPipe) : 0;

    charged.forEach(function (p) {
      var isRun = !bull && (p.id === runPair[0] || p.id === runPair[1]);
      var rec = {
        pipe: p.id,
        type: dividing ? (isRun ? 'TRUN_DIV' : 'TBRANCH_DIV')
                       : (isRun ? 'TRUN_CONV' : 'TBRANCH_CONV')
      };
      /* Only a BRANCH carries the ratios — the run is left flat (option C). */
      if (!isRun && commonPipe && qCommon > 1e-12 && aCommon > 0) {
        var aLeg = areaOf(p);
        if (aLeg > 0) {
          rec.qRatio = qOf(p) / qCommon;      // Qb/Qc
          rec.aRatio = aLeg / aCommon;        // Fb/Fc
          rec.dividing = dividing;
          /* Held so the charged leg can be converted out of the common-channel
           * frame: zeta_leg = zeta_c * (Qc/Qb)^2 * (Ab/Ac)^2. */
          rec.qLeg = qOf(p);
          rec.qCommon = qCommon;
        }
      }
      out.push(rec);
    });
    return out;
  }

  /* Two deviations count as equal within this many degrees. */
  var SYMMETRY_DEG = 2;

  /* A BULLHEAD tee: the two charged legs are collinear WITH EACH OTHER, so the
   * straight run of the fitting is between THEM and the common leg joins it at
   * an angle. Nothing goes straight through from the common leg, and neither
   * charged leg is a run.
   *
   * Found by Michael, 2026-08-02 (debug/20260802-2.json). A perfectly
   * symmetrical ring split 51.0/49.0 instead of 50/50, and the cause was not
   * noise: the two legs of the ring leave the supply tee at exactly 90° each,
   * so `pickRunPair` had two geometrically identical candidates and broke the
   * tie on the pipe's ID STRING. "P18P1" sorts before "P18P5", so the north leg
   * became the run (K = 0.9) and the south leg the branch (K = 1.1) — a 22%
   * resistance difference decided by an identifier. Lengths agreed to 1e-12;
   * the whole 1.88% came from this.
   *
   * Charging both as BRANCH is a change of which tabulated coefficient applies,
   * not a new number: both streams genuinely turn out of the common leg, which
   * is what the branch coefficient describes, and calling one a run asserts
   * that something passes straight through when nothing does. It is also the
   * conservative reading of the two, which matters for a figure that sizes a
   * pump.
   *
   * The test is pure geometry, so it cannot oscillate with the flow — the same
   * requirement §6 imposes on the run/branch tie-break itself. It leaves the
   * ordinary cases alone: at a riser tee the two charged legs are the riser
   * onward and the floor take-off, 90° apart, and at a plain branch tee they
   * are the through leg and the take-off, also 90° apart. Only the case where
   * they are in line with one another is caught.
   *
   * GENERALISED 2026-08-02, after the thermal mixing test found the same
   * defect in a geometry this missed: a symmetric Y, two legs meeting a common
   * outlet at 45° each. Not collinear, so the collinearity test said nothing,
   * and the split came out 51.7/48.3 with the mixed temperature 46.2 °C where
   * symmetry demands 45.0. The general statement is to compare each charged
   * leg's deviation from the COMMON leg: if they are equal, nothing
   * distinguishes them. The bullhead is the special case where both are 90°. */
  function isSymmetricSplit(m, nodeId, charged, common) {
    if (!charged || charged.length !== 2 || !common) return false;
    var dc = dirFrom(m, common, nodeId);
    var d0 = dirFrom(m, charged[0], nodeId), d1 = dirFrom(m, charged[1], nodeId);
    if (!dc || !d0 || !d1) return false;
    return Math.abs(deviation(dc, d0) - deviation(dc, d1)) < SYMMETRY_DEG;
  }

  /* Which two legs form the straight run?
   *
   * Before solving: the straightest pair geometrically.
   * After solving: the pair actually carrying the through-flow — the largest
   * inflow paired with the largest outflow (spec §3.3). This is why the solve
   * has to run twice.
   */
  function pickRunPair(m, nodeId, pipes, flows) {
    if (flows) {
      var ins = [], outs = [];
      pipes.forEach(function (p) {
        var q = flows[p.id] || 0;
        var leaving = (p.a === nodeId) ? q > 0 : q < 0;
        (leaving ? outs : ins).push({ id: p.id, pipe: p, mag: Math.abs(q) });
      });
      ins.sort(function (a, b) { return b.mag - a.mag; });
      outs.sort(function (a, b) { return b.mag - a.mag; });

      if (ins.length && outs.length) {
        /* "The pair carrying the through-flow" is undefined when two legs
         * carry the SAME flow — and that is not a corner case, it is the most
         * ordinary situation in a building: a riser feeding identical floors
         * splits exactly in half at every branch.
         *
         * Picking by magnitude alone then becomes a coin flip between equal
         * numbers. Worse, it self-oscillates: the pick sets the equivalent
         * length, the equivalent length nudges the flows, and the nudge flips
         * the pick back. A 3-floor riser with equal demands sat in a stable
         * 2-cycle and never converged.
         *
         * So near-ties are broken on GEOMETRY, which does not depend on the
         * flow and therefore cannot oscillate: among the tied candidates,
         * take the straightest in→out pair. At a riser tee that correctly
         * makes the vertical run the "run" and the floor take-off the
         * "branch", which is also what the physical fitting looks like. */
        var inCands = tied(ins), outCands = tied(outs);
        var best = null;
        inCands.forEach(function (i) {
          outCands.forEach(function (o) {
            if (i.id === o.id) return;
            var dev = deviation(dirFrom(m, i.pipe, nodeId), dirFrom(m, o.pipe, nodeId));
            /* Tie-break the tie-break on id, so the result cannot depend on
             * array order or on floating-point noise between platforms. */
            if (!best || dev < best.dev - 1e-9 ||
                (Math.abs(dev - best.dev) <= 1e-9 && (i.id + o.id) < best.key)) {
              best = { dev: dev, pair: [i.id, o.id], key: i.id + o.id };
            }
          });
        });
        if (best) return best.pair;
        return [ins[0].id, outs[0].id];
      }
      // Degenerate (everything one way, or all zero) — fall through to geometry.
    }

    var best = [pipes[0].id, pipes[1].id], bestDev = Infinity;
    for (var i = 0; i < pipes.length; i++) {
      for (var j = i + 1; j < pipes.length; j++) {
        var d = deviation(dirFrom(m, pipes[i], nodeId), dirFrom(m, pipes[j], nodeId));
        if (d < bestDev) { bestDev = d; best = [pipes[i].id, pipes[j].id]; }
      }
    }
    return best;
  }

  /* Entries whose magnitude is within TIE_REL of the largest. Sorted list in.
   * The tolerance is generous because the feedback that causes oscillation is
   * itself sizeable: swapping run (20 D) for branch (60 D) moves the effective
   * length by 40 diameters, which on DN100 is about 4 m of pipe — easily
   * enough to reorder two flows that were within a percent of each other. */
  var TIE_REL = 0.02;
  function tied(sorted) {
    if (!sorted.length) return [];
    var top = sorted[0].mag;
    if (!(top > 0)) return sorted.slice();
    return sorted.filter(function (e) { return (top - e.mag) / top <= TIE_REL; });
  }

  /* Total fitting equivalent length charged to each pipe, plus the fitting
   * codes for the calculation sheet. */
  function fittingsByPipe(m, flows, warnings) {
    var byPipe = {};
    m.pipes.forEach(function (p) { byPipe[p.id] = { el: 0, sumK: 0, types: [] }; });
    var kSet = (m.settings.dw && m.settings.dw.kSet) || 'threaded';

    m.nodes.forEach(function (n) {
      fittingsAtNode(m, n.id, flows, warnings).forEach(function (f) {
        var p = M.pipe(m, f.pipe);
        if (!p || !byPipe[p.id]) return;
        var bore_mm = M.pipeBore(m, p) * 1000;
        void bore_mm;

        /* Both bases are accumulated on every build, because the calculation
         * sheet reports whichever the active method did not use, and switching
         * method must not need a rebuild of anything else.
         *
         * BOTH lookups are keyed on NOMINAL size, not bore. They are different
         * numbers and confusing them is a real hazard: HDPE "110 mm" is an
         * OUTSIDE diameter with a 90 mm bore, so keying on bore lands two rows
         * off in the table (ARCHITECTURE §7). Equivalent length used to key on
         * the bore, correctly, because it was an L/D RATIO and the bore was the
         * multiplier; the NFPA 13 table is keyed on the designation instead. */
        var nominal_mm = FD.schedules.nominalMm
          ? FD.schedules.nominalMm(p.size) : bore_mm;
        byPipe[p.id].el += FD.fittings.el(f.type, nominal_mm, m.settings);

        /* ============ THE BRANCH K FOLLOWS THE FLOW RATIO (TEE.1, option C)
         *
         * A flat coefficient cannot describe a tee: the real one varies with
         * Qb/Qc by more than an order of magnitude, which is the largest known
         * approximation in this engine (docs_internal/TEE-LOSSES.md).
         * Idel'chik Diagrams 7-25 and 7-16 give the curve for the exact fitting
         * the geometry detector produces — a standard threaded malleable-iron
         * tee at 90 degrees — and `data/tees.js` carries them.
         *
         * THE CONVERSION IS THE POINT. Idel'chik quotes zeta in terms of the
         * velocity in the COMMON channel; a K added to this leg's `sumK` is
         * charged at THIS leg's velocity by `fittingR`. So
         *
         *     zeta_leg = zeta_c * (w_c/w_leg)^2 = zeta_c * (Qc/Qb)^2 * (Ab/Ac)^2
         *
         * Skipping that conversion is what defeated the 2026-08 attempt.
         *
         * K PATH ONLY — Hazen-Williams keeps its flat equivalent length and is
         * untouched, which is the whole of option C. And the RUN stays flat in
         * both: only the branch is made flow-dependent.
         *
         * FROZEN FOR THIS PASS by construction — `f.qRatio` came from the
         * PREVIOUS pass's flows, exactly as the dividing/combining decision
         * does, so the coefficient cannot chase the solution inside one solve. */
        var kFlat = FD.ktable.k(FD.fittings.ktableType(f.type),
                                nominal_mm, kSet, m.settings.fittingK);
        var kUse = kFlat;
        if (FD.tees && f.qRatio !== undefined && f.qLeg > 1e-12) {
          var zc = FD.tees.branchK(f.qRatio, f.aRatio, f.dividing);
          if (zc !== null && isFinite(zc)) {
            /* THE CONVERSION IS CLAMPED AT THE TABLE'S OWN LOWER BOUND, and
             * this matters more than it looks. `zeta_c` is referenced to the
             * COMMON velocity, so converting to the leg's frame multiplies by
             * (Qc/Qb)^2 — which runs away as the branch flow approaches zero.
             * On the data hall, P457 carries 0.0032 L/s and came out with
             * rK = 4.3e9, a resistance 2600x the whole model's fittings put
             * together. The LOSS was still only 0.045 m, so the physics was not
             * wrong; the RESISTANCE was, and a frozen resistance that large
             * drives the next pass's flow lower still, which raises it again.
             * That is the zero-flow discontinuity Deltares report for exactly
             * this family of coefficients.
             *
             * Idel'chik's tables start at Qb/Qc = 0.1 and `branchK` already
             * clamps zeta there, because below it there is no data. The frame
             * conversion is clamped at the SAME bound, so the two agree about
             * where the table stops. A branch carrying under a tenth of the
             * combined flow is charged as if it carried a tenth — bounded, and
             * conservative in the direction that matters, since its real loss
             * is smaller still. */
            var qEff = Math.max(f.qRatio, FD.tees.qRatios[0]);
            var vRatio = (1 / qEff) * f.aRatio;             // w_c / w_leg
            var kLocal = zc * vRatio * vRatio;
            /* A COMBINING BRANCH CAN BE NEGATIVE and that is real physics — the
             * faster stream gives kinetic energy to the slower (Idel'chik 7-2).
             * It is NOT allowed to make a link's total resistance negative,
             * which would be a pump made of pipe, so it is floored at the pipe
             * level below by clamping the accumulated sum, not here. */
            if (isFinite(kLocal)) kUse = kLocal;
          }
        }
        byPipe[p.id].sumK += kUse;
        byPipe[p.id].types.push(f.type);
      });
    });
    /* A FITTING SET CANNOT ADD ENERGY. Idel'chik's converging-branch
     * coefficients go negative at low flow ratios, which is real — but a link
     * whose total minor loss is negative would be a pump made of pipe, and the
     * solver's resistance model has no room for it. Clamped per PIPE, after
     * everything on that pipe has been added, so a genuinely negative branch
     * can still offset the elbows beside it before the floor applies. */
    Object.keys(byPipe).forEach(function (id) {
      if (byPipe[id].sumK < 0) byPipe[id].sumK = 0;
    });
    return byPipe;
  }

  // --------------------------------------------------------------- build
  /* Translate the model into the abstract network the solver consumes.
   *
   * `prev` is the previous solve result (or null on the first pass). Both the
   * tee run/branch split and check-valve seating depend on the previous
   * answer — flows for the former, heads for the latter. */
  /* EVERY SYNCED DEVICE TAKES ITS LEADER'S POSITION, before the network is
   * built from it. Done here rather than in the control loop because a sync is
   * not a control: there is nothing to search for, and a device that merely
   * copies a position must be correct in DESIGN too, where the loop never runs.
   *
   * One pass is enough because `setSync` collapses chains to their head, so no
   * follower is ever waiting on another follower. */
  function applySyncs(m) {
    m.pipes.forEach(function (p) {
      var x = M.syncedPosition(m, p);
      if (x === null) return;
      if (p.kind === 'pump' && p.pump) p.pump.speed = x;
      else if (p.kind === 'valve' && p.valve) p.valve.opening = Math.round(x * 100);
      /* A COIL COPIES ITS LEADER'S PART LOAD (Michael, 2026-08-09). Fourteen
       * AHUs on a floor sit at the same percentage on a given day, and typing
       * that fourteen times is what sync exists to avoid. */
      else if (p.kind === 'equip' && p.equip) p.equip.loadPct = x * 100;
    });
    applySyncedDesign(m);
  }

  /* ==================================== A SYNC GROUP IS SIZED AS ONE MACHINE
   *
   * Michael, 2026-08-23. Copying only the POSITION left a group that was ganged
   * to run together and yet selected apart: two pumps at one speed could hold
   * two different duties and two different curves, because `autoSizePumps` sized
   * every 'auto' pump on its own and a follower left on Manual simply kept the
   * duty somebody typed. That is not a pump set, it is two pumps that happen to
   * move together — and the discrepancy is invisible on the drawing.
   *
   * So the leader states the SELECTION and the followers take it:
   *
   *   pump      sizing mode, design flow and head, the running head, the curve
   *   exchanger duty, rated flow, rated pressure drop
   *
   * Only the leader is sized (`autoSizePumps` skips anything with a sync), and
   * because this runs at the top of every `build` the followers track the leader
   * THROUGH the sizing iteration rather than lagging it by a pass.
   *
   * A follower switched OFF keeps its own `mode`: standby is a separate decision
   * from selection, and a synced spare is still a spare.
   *
   * SAID IN THE PANEL, NOT IN A MESSAGE (Michael, 2026-08-23). This was a
   * SYNC_SIZED notice for one version. A notice is the wrong place: it fires on
   * every solve and describes a relationship the engineer set up deliberately,
   * which is noise. The pump panel greys the follower's duty boxes, shows the
   * leader's numbers in them and labels the flow row "(Synced with ...)", so the
   * answer is where the question is asked. */
  function applySyncedDesign(m) {
    m.pipes.forEach(function (p) {
      var lead = M.pipe(m, M.syncOf(p));
      if (!lead || lead.id === p.id) return;

      if (p.kind === 'pump' && lead.kind === 'pump' && p.pump && lead.pump) {
        var f = p.pump, L = lead.pump;
        f.sizing = M.pumpSizing(lead);
        if (f.mode !== 'off') f.mode = M.pumpRunMode(lead);
        if (L.qDesign !== undefined) f.qDesign = L.qDesign;
        if (L.hDesign !== undefined) f.hDesign = L.hDesign;
        f.head = L.head || 0;
        if (L.curve) f.curve = JSON.parse(JSON.stringify(L.curve));
        else delete f.curve;
      } else if (p.kind === 'equip' && lead.kind === 'equip' &&
                 p.equip && lead.equip &&
                 p.equip.equipType === 'exchanger' &&
                 lead.equip.equipType === 'exchanger') {
        var fe = p.equip, Le = lead.equip;
        if (Le.duty !== undefined) fe.duty = Le.duty;
        if (Le.qRated !== undefined) fe.qRated = Le.qRated;
        if (Le.pdRated !== undefined) fe.pdRated = Le.pdRated;
      }
    });
  }

  /* ============ A CONTROL VALVE'S POSITION IS AN OUTPUT, NOT A DESIGN INPUT
   *
   * Michael, 2026-08-24, deciding it, and 2026-08-25 asking for the DESIGN half
   * only: "Design calculation should assume design flow through each
   * equipment."
   *
   * The control loop runs in SIMULATION and not in DESIGN, so a design solve
   * used whatever opening the last simulation happened to leave behind. That is
   * not a stale number in a corner — it decides the answer. On
   * `examples/Data Hall & Yard.json` the fourteen AHUs are identical machines
   * on one distribution run, and their valves had settled between 68% and 71%.
   * Ranked by `flow / qRated` the index came out AHU-4 — which is the LEAST
   * remote of the fourteen — because its valve had quantised one step further
   * closed than its neighbours' and it therefore carried 0.4% less water. The
   * whole spread across the system is 0.57%, which is the valves' 1%-of-travel
   * resolution and nothing else. Michael: "logic would say the most remote
   * should be AHU-12 or 13."
   *
   * With the valves at their design position the same model ranks by pipework:
   * AHU-13 first, AHU-9, AHU-14, AHU-8, and AHU-4 LAST. That ordering does not
   * move whatever the valves were last doing, because it is a property of the
   * pipe.
   *
   * THE DESIGN POSITION IS FULL TRAVEL. It is not "no valve" — the valve is a
   * real resistance at 100% and stays in the circuit, which is what a design
   * calculation should charge for. What it is not is a commissioning result
   * borrowed from a run that may have been made at another load.
   *
   * SIMULATION IS UNTOUCHED, deliberately (Michael, 2026-08-25). There the
   * position is the loop's own answer, computed this solve, and it is the
   * quantity the whole exercise exists to find. */
  function actuatorOpening(simulating, opening) {
    if (simulating) return opening;
    return 100;
  }

  function build(m, prev, opts) {
    var warnings = [];
    applySyncs(m);
    var flows = prev && prev.flow ? prev.flow : null;
    var simulating = (m.settings.calcMode === 'simulation');
    M.riserPipes(m);                       // materialise vertical riser links
    var fits = fittingsByPipe(m, flows, warnings);
    var method = FD.hydraulics.method(m.settings.frictionMethod);
    var s = m.settings;
    var rho = (s.fluid && s.fluid.density) || 998;

    /* ============ THE METHOD CANNOT DO TEES PROPERLY, AND SAYS SO IN THE CHIP
     *
     * Michael, 2026-08-28, settling WORKLIST TEE.1 as option C — the flow-ratio
     * branch coefficient goes on the DARCY path only — and then: "Don't put the
     * notification in Hydraulic, just put it in the chip please."
     *
     * WHY HAZEN-WILLIAMS CANNOT CARRY THE FIX (docs_internal/TEE-LOSSES.md §0):
     * a flow-ratio coefficient must ride as an additive K term at exponent 2,
     * and converting Hazen-Williams' equivalent LENGTHS into K needs a friction
     * factor, which Hazen-Williams does not have. Darcy has one, already carries
     * fittings as a separate `rK`, and the solver already sums `r·Q^n + rK·Q²`.
     *
     * ONLY WHEN THE MODEL ACTUALLY HAS A TEE. A limitation that cannot bite the
     * drawing in front of you is noise, and this list is pruned hard for exactly
     * that reason — a single straight run has no tee to get wrong. */
    /* ============ A MACHINE ON AUTO IS SIZED TO THE MOMENT IT IS SIMULATED
     *
     * Michael, 2026-08-29. On AUTO sizing a heat source/sink is unlimited: it
     * holds its setpoint whatever that takes, and its rated flow is whatever
     * the solve landed on. Its hydraulic resistance is derived from that rated
     * point — so in SIMULATION the machine is, in effect, a chiller selected
     * exactly for the conditions being simulated. That is a fine assumption for
     * DESIGN, where finding the selection is the whole job. It is a statement
     * worth making out loud in SIMULATION, where the reader is asking what a
     * REAL plant does at a part-load condition.
     *
     * SIMULATION ONLY: on DESIGN this is not a caveat, it is the method. */
    if (simulating) {
      m.pipes.forEach(function (p) {
        if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
        if (p.equip.equipType !== 'source') return;
        var cap = Number(p.equip.qMax);
        if (isFinite(cap) && cap !== 0) return;        // Manual: nameplate stated
        warnings.push({
          code: 'EQUIP_AUTO_SIM', pipe: p.id,
          message: (p.tag || p.id) + ' is in Auto Mode. Simulating with ' +
                   'Equipment in Auto Mode assumes that the pressure drop is ' +
                   'sized exactly to the current conditions.'
        });
      });
    }

    if (method.fittingMode !== 'K') {
      var hasTee = Object.keys(fits).some(function (id) {
        return (fits[id].types || []).some(function (t) {
          return t.indexOf('TRUN') === 0 || t.indexOf('TBRANCH') === 0;
        });
      });
      if (hasTee) {
        warnings.push({
          code: 'HW_TEE_LIMIT',
          /* The SHORT name. `method.name` is the registry's full title —
           * "Hazen-Williams (ASHRAE with Equivalent Lengths)" — which nests a
           * bracket inside a bracket and reads badly in a sentence. */
          message: 'The current friction loss calculation (' +
                   String(method.name).split(' (')[0] +
                   ') is unable to calculate pressure drops across unequal ' +
                   'dividing tees. Recommend changing to Darcy-Weisbach instead.'
        });
      }
    }

    /* Parallel pumps need a CHARACTERISTIC, not a fixed head.
     *
     * N pumps that each hold their outlet at a fixed head above their inlet,
     * connected between the same two headers, is a degenerate problem: the
     * equations are linearly dependent, continuity alone does not decide how
     * they share, and the solver returns one arbitrary answer out of infinitely
     * many. On the data centre ring that was a 99.9% skew — one pump doing all
     * 45 L/s and the other three sitting at 0.1 L/s — with the TOTAL and the
     * head both perfectly correct.
     *
     * A falling H(Q) removes the degeneracy: a pump taking more than its share
     * makes less head, which pushes flow back to the others until they balance.
     *
     * The shape used is the EPANET single-point assumption anchored on the duty
     * point, so H(Q_duty) = H_duty EXACTLY and a single pump is completely
     * unaffected. The reference flow is COMMON to the whole running set — the
     * average — because it is the shape being shared, not each pump's own
     * history; anchoring each pump on its own previous flow would just preserve
     * whatever skew the first pass happened to produce.
     *
     * This is a solver characteristic, not a user-facing generated curve. The
     * generated-curve feature was removed on purpose (see docs/TOOLS.md); this
     * is the numerical stand-in that makes a fixed-head pump solvable at all,
     * and SIMULATION still requires a real curve. */
    var autoRef = null, autoSlope = 0;
    if (!simulating) {
      var running = m.pipes.filter(function (p) {
        return p.kind === 'pump' && p.pump && p.pump.mode !== 'off' && !p.pump.curve;
      });
      if (running.length > 1) {
        /* The anchor is FROZEN by the caller during auto-sizing, and that is
         * the whole trick.
         *
         * Deriving it from the current flows each pass sets up a positive
         * feedback: more flow raises the average, which flattens the curve
         * (a = H/3Qref²), which passes more flow. Sizing three pumps ran away
         * to 262 L/s at 5547 kPa on the data centre ring.
         *
         * Frozen, the head→flow relation is monotonic and the sizer converges;
         * and because the anchor is the AVERAGE, it is right even when the
         * pass that produced it was badly skewed — the total is correct even
         * when the split is not. */
        /* ONLY when the caller asks. Deriving the anchor from the current
         * flows sets up a positive feedback with the head search — more flow
         * raises the anchor, which flattens the characteristic, which passes
         * more flow — and auto-sizing three pumps ran away to 5547 kPa. The
         * balancing pass in solveModel() supplies a fixed anchor instead, once
         * sizing has already converged. */
        if (opts && opts.autoRef > 0) {
          autoRef = opts.autoRef;
          autoSlope = opts.autoSlope > 0 ? opts.autoSlope : 0;
        }
      }
    }

    /* Context handed to the loss model: editable coefficients, fluid
     * properties, roughness, and (for Darcy) the previous pass's flow so the
     * friction factor can be refreshed. */
    function ctxFor(p, q) {
      return {
        hw: s.hw,
        ashrae: s.ashrae,
        fluid: s.fluid,
        frictionFactor: s.dw && s.dw.frictionFactor,
        roughness_mm: s.dw && s.dw.roughness_mm,
        q: q
      };
    }

    var nodes = m.nodes.map(function (n) {
      var z = M.elevation(m, n);
      var demand = 0, fixedHead = null;
      var dev = n.device;
      if (dev && dev.kind === 'source') {
        /* Inexhaustible supply at its own altitude, holding its stated static
         * pressure AT THE NODE.
         *
         * It used to be pinned at 0 gauge, on the tank-surface reading: the
         * water surface of an open tank really is at atmospheric, and the head
         * it provides is the column above the connection. Every downstream
         * number was right. But the source node itself then read 0 kPa while
         * the very next node read 193, which looks like a pressure JUMP across
         * a pipe that loses 7 kPa — and it is not what an engineer means when
         * they draw a mains connection and label it 200 kPa. Michael and a
         * colleague both read it the same way (2026-08-02).
         *
         * So the node is what you connect to, not the water surface, and it
         * reads the pressure written on it. H = z + P/(ρg) makes the node's own
         * gauge pressure ρg(H − z) = P exactly, and leaves every downstream
         * head identical to before — this changes the reading, not the
         * hydraulics. Elevation is now a separate matter, which is what it
         * always should have been (see model.setSource). */
        fixedHead = z + (dev.pressure || 0) / (rho * 9.81);
      } else if (dev && dev.kind === 'demand' && dev.include !== false) {
        demand = dev.flow || 0;
      }
      return { id: n.id, z: z, demand: demand, fixedHead: fixedHead };
    });

    var links = m.pipes.map(function (p) {
      var L = M.pipeLength(m, p);
      var el = fits[p.id] ? fits[p.id].el : 0;
      var d = M.pipeBore(m, p);

      var qPrev = flows ? flows[p.id] : undefined;
      var ctx = ctxFor(p, qPrev);
      var nExp = FD.hydraulics.exponent(s.frictionMethod, ctx);
      var link = { id: p.id, from: p.a, to: p.b, kind: 'pipe', n: nExp };

      if (p.kind === 'pump' && p.pump && p.pump.mode !== 'off' && simulating && p.pump.curve) {
        /* SIMULATION: the curve is the input. The solver finds where it meets
         * the system — that IS the operating point, for the whole network.
         *
         * At part speed it is the AFFINITY-SCALED curve that meets the system,
         * which is why this goes through M.pumpCurve rather than reading
         * p.pump.curve. Scaling the curve is the only place speed enters the
         * hydraulics; nothing in the solver knows about it. */
        var pc = M.pumpCurve(m, p);
        link.kind = 'pump';
        link.curve = pc;
        link.head = FD.pumps.head(pc, flows ? (flows[p.id] || 0) : 0);
      } else if (p.kind === 'pump' && p.pump && p.pump.mode === 'off') {
        /* An OFF pump is isolated, not an open pipe.
         *
         * Modelling it as zero head leaves a frictionless path straight through
         * the casing, and in a parallel pump set the running pump then
         * short-circuits backwards through its idle neighbours — the test model
         * pushed 392 L/s round the pump hall to deliver 21 L/s to the load.
         *
         * It was previously a very large resistance, which was nearly right:
         * "nearly" cost a real 0.03% of system flow seeping through every
         * stopped pump, and made the reported flows not quite add up. A
         * standby pump sits behind closed isolating valves, so it is now
         * omitted from the network entirely — a genuine break. */
        link._omit = true;
        link._pumpOff = true;
      } else if (p.kind === 'pump' && p.pump) {
        link.kind = 'pump';
        /* Head falls as the square of speed — the same affinity law that scales
         * a curve, applied to the fixed head that stands in for one. A speed
         * typed on a pump must not be silently ignored just because there is no
         * curve behind it. In DESIGN `pumpSpeed` returns 1 and this is a
         * no-op — speed belongs to SIMULATION, see M.pumpSpeed. */
        var ps = M.pumpSpeed(m, p);
        link.head = (p.pump.head || 0) * ps * ps;
        if (autoRef && (p.pump.head || 0) > 0) {
          /* LINEAR droop, H = Hd + k(Qref - Q), not the quadratic single-point
           * shape. Two reasons, both found the hard way:
           *
           * The quadratic runs out at exactly 2*Qref whatever the head, because
           * a = Hd/3Qref² scales with Hd and the zero-crossing does not move.
           * The sizer then cannot reach its target however hard it pushes, and
           * winds the head up to 1e38 trying.
           *
           * A line with a FROZEN slope translates upward as the head rises, so
           * flow is unbounded and the head->flow relation stays monotonic. Its
           * derivative is also constant, which removes the dH/dQ -> 0
           * singularity at shutoff that a quadratic has.
           *
           * In H0 - a·Q^b terms that is b = 1, a = k, H0 = Hd + k·Qref, so the
           * existing curve machinery handles it unchanged. */
          var k = autoSlope > 0 ? autoSlope : (link.head / autoRef);
          link.curve = { H0: link.head + k * autoRef, a: k, b: 1,
                         Qd: autoRef, Hd: link.head, source: 'implicit-droop' };
          link._implicitCurve = true;
        }
      } else if (p.kind === 'valve' && p.valve) {
        link.kind = 'valve';
        link.n = 2;                                  // Kv law is square in Q
        var vt = FD.valves.type(p.valve.type);
        /* A DRAWN CONTROL VALVE FOLLOWS THE SAME POSITION RULE AS AN INTEGRATED
         * ONE: DESIGN charges it at full travel (DS.1), SIMULATION reads the
         * loop's answer. A valve with NO control link is a balancing valve —
         * its position is a design decision somebody made and it is left
         * exactly as set.
         *
         * THE TWO ARE NO LONGER THE SAME PLANT, and that is deliberate since
         * DP.1 (2026-08-31). An INTEGRATED valve is part of the machine, so the
         * rated dP already covers it and the equip branch subtracts it back out.
         * A DRAWN valve is separate pipework and is charged ON TOP of the
         * rating. Same Kv, different answer, because one is inside the machine's
         * quoted figure and the other is not. `closed.test.js` pins the new
         * relationship: an integrated Kv equals a drawn Kv on the NET rating. */
        var vOpening = M.controlOf(p) || M.syncOf(p)
          ? actuatorOpening(simulating, p.valve.opening)
          : p.valve.opening;
        link.r = FD.valves.resistance(p.valve.type, p.valve.kv, vOpening);

        /* A check valve must not pass reverse flow. Direction is only known
         * after solving, so this reuses the two-pass machinery the tee
         * run/branch split uses.
         *
         * The test is on HEAD, not flow. Testing flow oscillates forever: shut
         * the valve because flow was negative, and the next pass reports ~zero
         * flow, which is not negative, so it reopens, reverses, and shuts
         * again. The adverse head difference, by contrast, is still there while
         * the valve is shut — so "shut whenever the upstream head is lower"
         * is a stable fixed point. */
        if (vt.checkValve && prev && prev.head) {
          var hFrom = prev.head[p.a], hTo = prev.head[p.b];
          if (hFrom !== undefined && hTo !== undefined && hFrom < hTo) {
            link.r = FD.valves.CLOSED_R;
            link._checkShut = true;
            warnings.push({
              code: 'CHECK_CLOSED',
              message: 'Check valve ' + p.id + ' is holding against reverse flow.',
              pipe: p.id
            });
          }
        }

        if (FD.valves.isClosed(p.valve.type, vOpening)) {
          warnings.push({
            code: 'VALVE_SHUT',
            message: 'Valve ' + p.id + ' is shut.',
            pipe: p.id
          });
        }
      } else if (p.kind === 'equip' && p.equip && p.equip.off) {
        /* Isolated equipment, same reasoning as a stopped pump: a chiller
         * valved out of the circuit is a break, not a bypass. */
        link._omit = true;
        link._equipOff = true;
      } else if (p.kind === 'equip' && p.equip) {
        link.kind = 'equip';
        link.n = 2;
        link.r = FD.hydraulics.equipmentR(p.equip.pdRated || 0, p.equip.qRated || 0, rho);
        /* AN INTEGRATED CONTROL VALVE is a real valve in series with the coil,
         * so it is a real resistance — the same equal-percentage Kv a drawn
         * globe valve gets. Michael, 2026-08-08: it is what an AHU ships with,
         * and drawing the valve, the sensor and the link by hand on every coil
         * of a sixty-coil model is three gestures that never say anything
         * different.
         *
         * Series resistances ADD, which is the whole reason it can live on the
         * same link rather than needing a link of its own. */
        /* AUTO or MANUAL (`M.icvMode`). An AUTO valve is the machine's own
         * controller and its position is an output — full travel in DESIGN
         * (DS.1), the loop's answer in SIMULATION. A MANUAL valve is somebody's
         * balancing decision and is read as set in BOTH modes, and at full
         * travel it is not a valve at all. */
        var icv = p.equip.icv;
        if (M.icvActive(p)) {
          var icvOpen = (M.icvMode(p) === 'manual')
            ? M.icvOpening(p)
            : actuatorOpening(simulating, icv.opening);

          /* ============ THE STATED EQUIPMENT PD IS THE TOTAL, VALVE INCLUDED
           *
           * Michael, 2026-08-31, fixing DP.1: "is the valve Kv should be built
           * into the design PD... Pressure Drop from Valve Kv at 100% is
           * subtracted from Equipment PD."
           *
           * WHY. A dP sensor placed across a coil in the real world reads the
           * whole branch — coil AND its control valve — because that is where
           * the tappings go. The engine agrees: the valve lives on this same
           * link, so `measure()` sees their sum. Before this, `pdRated` was the
           * COIL alone and the valve was charged ON TOP, so a sensor set to the
           * coil's rated dP could never deliver rated flow. Measured on the
           * HighRise: a 200 kPa setpoint gave the coil 181 kPa and 95.1% flow,
           * and the setpoint had to go to 220 kPa — exactly the valve's 20.3 kPa
           * at full travel — before the coil saw its rating. That is the whole
           * of DP.1.
           *
           * SO THE RATING NOW INCLUDES THE VALVE. The coil's own resistance is
           * the stated dP LESS what the valve drops wide open at rated flow,
           * and the valve is then added back at its actual position. At full
           * travel the two cancel exactly and the link delivers `pdRated` at
           * `qRated`, which is what the engineer typed and what a sensor across
           * it now reads.
           *
           * THE SUBTRACTION IS EXACT IN RESISTANCE SPACE, with no unit work.
           * The valve's drop at rated flow is rho*g*rFull*qRated^2, so dividing
           * by rho*g*qRated^2 to turn it back into an equipment resistance
           * returns rFull itself. Hence a plain subtraction of resistances. */
          var rIcvFull = FD.valves.resistance('globe', icv.kv, 100);
          link.r -= rIcvFull;
          /* A VALVE THAT DROPS MORE THAN THE WHOLE RATING leaves no coil at
           * all. That is a model that cannot be built — an undersized Kv
           * against the stated dP — so it is reported rather than silently
           * turned into a negative resistance, which would be a pump made of
           * coil. Floored at zero: the machine becomes its own valve. */
          if (!(link.r > 0)) {
            link.r = 0;
            warnings.push({
              code: 'ICV_EXCEEDS_PD', pipe: p.id,
              message: (p.tag || p.id) + ' has a control valve that drops more ' +
                       'than the whole rated pressure. Raise the valve Kv or the ' +
                       'rated pressure drop.'
            });
          }
          link.r += FD.valves.resistance('globe', icv.kv, icvOpen);
          link.icv = true;
        }
      } else if (method.fittingMode === 'K') {
        /* ASHRAE and Darcy-Weisbach: the pipe carries its own friction over the
         * DRAWN length only, and the fittings ride alongside as a separate
         * velocity-head term, h = ΣK·V²/2g (Ch 22 Eq 7).
         *
         * Under ASHRAE the two CANNOT be added into one resistance — the
         * exponents differ, 1.852 against 2. Under Darcy both are 2, so they
         * could be; they are kept apart anyway so there is one code path and
         * the sheet can report pipe and fittings separately. */
        link.r = method.r(L, d, p.C, ctx);
        link.rK = FD.hydraulics.fittingR(fits[p.id] ? fits[p.id].sumK : 0, d);
      } else {
        link.r = method.r(L + el, d, p.C, ctx);
      }

      // Cached for the calculation sheet — not read by the solver.
      link._L = L;
      link._el = el;
      /* Under the K method the fittings are NOT in the pipe's length, so the
       * effective length is the drawn length — otherwise the sheet would show a
       * length that was never used in the calculation. */
      link._Leff = (method.fittingMode === 'K') ? L : L + el;
      link._sumK = fits[p.id] ? fits[p.id].sumK : 0;
      link._d = d;
      link._rActual = (link.kind === 'pipe') ? method.r(L, d, p.C, ctx) : 0;
      link._types = fits[p.id] ? fits[p.id].types : [];
      link._rho = rho;
      /* Devices have a direction, and none of them pass flow backwards: a pump
       * cannot be driven in reverse as a turbine, and a chiller has an inlet
       * and an outlet. Same head-based test as the check valve above, and for
       * the same reason — testing FLOW oscillates, testing the adverse head
       * difference is a stable fixed point because the adverse head is still
       * there while the device is held shut. */
      if (!link._omit && prev && prev.head &&
          (link.kind === 'pump' || link.kind === 'equip')) {
        var hA = prev.head[p.a], hB = prev.head[p.b];
        if (hA !== undefined && hB !== undefined && hB > hA && link.kind === 'equip') {
          link.r = FD.valves.CLOSED_R;
          link._reverseHeld = true;
          warnings.push({
            code: 'REVERSE_BLOCKED',
            message: (p.tag || p.id) + ' flow may be reversed. Check its direction.',
            pipe: p.id
          });
        }
      }

      return link;
    });

    /* Omitted links are a genuine break, not a big number. Anything isolated
     * by one is reported by the disconnection check rather than silently
     * solving to zero. */
    var omitted = links.filter(function (l) { return l._omit; });
    links = links.filter(function (l) { return !l._omit; });

    /* A CLOSED circuit has no reservoir anywhere — a chilled-water loop is
     * sealed, and its absolute pressure is set by a fill/expansion vessel, not
     * by an open tank. With no fixed head the solver has no datum, so the
     * whole component is indeterminate and the island rule quietly returns
     * zero flow: a pumped loop that reports as dead.
     *
     * So a component that has a pump but no fixed head gets one node pinned as
     * the pressure datum, at its own elevation (0 gauge). Continuity forces
     * zero net flow through a single pinned node in a closed loop, so this
     * fixes the datum without injecting or removing any water. The pump
     * suction is chosen because that is where a real expansion vessel is
     * normally connected. */
    /* SIMULATION: an outflow is no longer a stated flow but a resistance that
     * takes whatever the system gives it. Each becomes a short link to a
     * virtual discharge node pinned at its own elevation (0 gauge), carrying
     * the terminal's characteristic. Flow through that link is what the
     * terminal actually delivers. */
    if (simulating) {
      m.nodes.forEach(function (n) {
        if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
        var r = M.outflowResistance(m, n);
        var host = nodes.filter(function (x) { return x.id === n.id; })[0];
        if (!host) return;
        host.demand = 0;
        if (r === null) {
          warnings.push({
            code: 'NO_CHARACTERISTIC', node: n.id,
            message: 'Outflow ' + (n.tag || n.id) + ' has no design point. ' +
                     'Provide a rated flow and pressure before simulating.'
          });
          return;
        }
        var vid = '__out_' + n.id;
        nodes.push({ id: vid, z: host.z, demand: 0, fixedHead: host.z, _virtual: true });
        links.push({
          id: vid, from: n.id, to: vid, kind: 'equip', n: 2, r: r,
          _virtual: true, _outflow: n.id,
          _L: 0, _el: 0, _Leff: 0, _d: 0.05, _types: [], _rho: rho
        });
      });
    }

    pinClosedCircuitDatum(nodes, links, warnings);

    // Zero-length pipes are degenerate and would divide by zero downstream.
    links.forEach(function (l) {
      if (l.kind === 'pipe' && l._L < 1e-6) {
        warnings.push({
          code: 'ZERO_LENGTH', pipe: l.id,
          message: 'Pipe ' + ((M.pipe(m, l.id) || {}).tag || l.id) +
                   ' has zero length. Recommend to delete and redraw.'
        });
      }
    });

    return { nodes: nodes, links: links, omitted: omitted, warnings: warnings, rho: rho };
  }

  // --------------------------------------------------------------- solve
  /* Two-pass solve (spec §3.3): the tee run/branch split depends on flow
   * direction, but flow direction is an output of the solve. Solve with a
   * geometric guess, reassign the fittings from the solved directions, solve
   * again. Converges in one or two passes; if the assignment keeps flipping we
   * keep the last result and warn rather than looping forever.
   */
  /* The HYDRAULIC CORE: everything needed to answer "what does the network do
   * at the settings currently on the model", and nothing that exists only for
   * reporting. Split out of solveModel so the control loop below can evaluate a
   * trial pump speed or valve position without paying for the critical path,
   * the pressure-driven second pass and the simulation report each time.
   *
   * Returns { res, net, passes, sizing, stable }. */
  function solveCore(m, maxPasses) {
    var net = build(m, null);
    var res = FD.solver.solve(net);
    var passes = 1, stable = false, prev = signature(net, res);

    while (passes < maxPasses) {
      var next = build(m, res);
      var nextRes = FD.solver.solve(next);
      passes++;
      var sig = signature(next, nextRes);
      net = next; res = nextRes;
      if (sig === prev) { stable = true; break; }
      prev = sig;
    }

    if (!stable && passes >= maxPasses) {
      res.warnings = (res.warnings || []).concat([{
        code: 'FITTING_OSCILLATION',
        message: 'Simulation did not stabilize in ' + maxPasses + ' passes. ' +
                 'Flow directions may be marginal somewhere in the network.'
      }]);
    }

    /* Pumps in 'auto' mode re-size on every solve, so the duty tracks the model
     * instead of going stale the moment anything upstream changes. Each
     * re-size is another solve, so it bails out as soon as the shortfall stops
     * improving — which also stops a dead-ended pump from being wound up
     * forever against a shortfall it cannot possibly fix. */
    var sizing = autoSizePumps(m, res);
    if (sizing.resolved) { res = sizing.res; net = res.network || net; }

    /* Redistribute flow between parallel pumps — AFTER sizing, never during.
     *
     * Auto-sizing with plain fixed-head pumps converges correctly and gives the
     * right TOTAL flow and the right head; what it cannot give is the split
     * between pumps, because N fixed-head links between the same two headers is
     * a degenerate system with infinitely many solutions. On the data centre
     * ring it returned a 99.9% skew — one pump carrying all 45 L/s.
     *
     * So the split is fixed in one extra pass, with each pump given the same
     * linear droop anchored on the share it ought to have: total/N at the head
     * already sized. Because every pump gets an identical characteristic that
     * passes through exactly that point, the balanced split IS the solution,
     * and the pass barely disturbs the total or the head.
     *
     * Doing this inside the sizing loop was tried and does not work: the
     * characteristic and the head-scaling feed back on each other and the
     * search runs away — to 262 L/s at 5547 kPa with a quadratic shape, and to
     * a 1e18 kPa head with a droop whose slope tracked the head. Keeping it
     * outside leaves the sizer's own convergence untouched. */
    var parallel = m.pipes.filter(function (p) {
      return p.kind === 'pump' && p.pump && p.pump.mode !== 'off' &&
             !p.pump.curve && (p.pump.head || 0) > 0;
    });
    if (parallel.length > 1 && m.settings.calcMode !== 'simulation') {
      var totQ = 0;
      parallel.forEach(function (p) { totQ += Math.abs(res.flow[p.id] || 0); });
      var share = totQ / parallel.length;
      if (share > FD.hydraulics.Q_MIN) {
        var bal = build(m, res, {
          autoRef: share,
          autoSlope: (parallel[0].pump.head || 0) / share
        });
        var balRes = FD.solver.solve(bal);
        /* Only accept it if it actually converged and did not move the total —
         * the point is to redistribute, not to re-solve the system. */
        var newTot = 0;
        parallel.forEach(function (p) { newTot += Math.abs(balRes.flow[p.id] || 0); });
        if (balRes.ok && totQ > 0 && Math.abs(newTot - totQ) / totQ < 0.05) {
          res = balRes;
          net = bal;
          res.network = net;
          res.pumpBalance = { share: share, pumps: parallel.length };
        }
      }
    }

    return { res: res, net: net, passes: passes, sizing: sizing, stable: stable };
  }

  /* ============================================ THE SOLVE, AS A GENERATOR
   *
   * `solveModelGen` is the real implementation and it YIELDS — once per network
   * solve inside the control loop, which is the only place a big model spends
   * real time. Everything else drives it:
   *
   *     solveModel(m)            drains it synchronously. Identical answers,
   *                              identical call signature, and it is what
   *                              `solveNow`, the printer and all 1762 test
   *                              assertions use.
   *     the app                  steps it, handing the browser back between
   *                              steps, so the page paints and stays alive.
   *
   * WHY A GENERATOR AND NOT A WORKER (Michael asked, 2026-08-09). A Worker
   * needs `importScripts` or `fetch` to load this file, and BOTH are refused
   * from a `file://` null origin — as is `new Worker('src/network.js')` itself.
   * A Blob worker sidesteps the origin in some browsers and still cannot get
   * the engine into itself without inlining every module as a string, which is
   * a build step. Two independent blockers, and the second one is not a browser
   * quirk that might age out.
   *
   * WHY ONE `evaluate()` IS THE ATOM. Slicing at the DEVICE boundary was tried
   * and backed out: one device's search is a probe, a scan, a descent and a
   * bisection — fifteen or so full solves, seconds on the data centre — so it
   * still blocked for seconds at a time, and each resumed slice re-ran the
   * non-control work on top. One `evaluate()` is about 100 ms, which is a
   * frame's worth of jank rather than a hung page.
   *
   * The yielded value is progress, never state: `{ solves, iteration, device,
   * fraction }`. Nothing is expected to be done with it, and the driver may
   * ignore it entirely. */
  /* ============ THE REQUIRED CAPACITY IS ANSWERED WITHOUT THE CAPACITY
   *
   * Michael, 2026-08-29, on `debug/network.pnet(7).json`: five coils at 160 kW
   * against two 400 kW chillers, so the plant is a shade undersized once the
   * pipes pick up heat from ambient. Each chiller then reported a **required
   * capacity of 1024 kW** and a margin of -61%, while the heat balance was out
   * by 0.03 kW. His diagnosis was right: "the chiller is hitting a brick wall
   * at 400 kW and thermal runaway is happening until heat loss from the pipe to
   * ambient = deficit."
   *
   * `requiredDuty` is `C·(tSet − tIn)` — what the machine needs AT THE INLET IT
   * ACTUALLY HAS. That is the right question when the machine is holding its
   * setpoint. It is circular when it is not: the deficit pushes the return
   * water up, the hotter return raises tIn, the higher tIn raises the apparent
   * requirement, and the loop only settles when the pipes shed the difference
   * to ambient. The number reported is then the requirement for a runaway that
   * exists BECAUSE the machine is short — not the requirement for the duty the
   * building actually presents.
   *
   * So the sizing question is asked of a plant that is NOT short. The thermal
   * pass is one-way over fixed flows — it feeds nothing back into the
   * hydraulics — so lifting the capacity ceilings and running it again costs
   * one pass and no re-solve, and gives each machine the duty it would land on
   * if it could hold its setpoint. That IS the capacity to select.
   *
   * ONLY THE CAPACITY IS LIFTED. A ΔT limit is a real property of the machine
   * and stays; the panel reports which constraint bound it either way.
   *
   * MAIN SOLVE ONLY. The control loop calls `FD.thermal.solve` hundreds of
   * times and never reads this, so it stays out of that path. */
  function applyRequiredCapacity(m, res) {
    if (!FD.thermal || !res || !res.thermal || !res.thermal.links) return;
    var limited = [];
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
      if (p.equip.equipType !== 'source') return;
      var cap = Number(p.equip.qMax);
      if (!isFinite(cap) || cap === 0) return;      // already unlimited
      limited.push({ e: p.equip, cap: p.equip.qMax });
    });
    if (!limited.length) return;

    var free = null;
    limited.forEach(function (x) { delete x.e.qMax; });
    try {
      free = FD.thermal.solve(m, res);
    } catch (err) {
      free = null;
    } finally {
      /* RESTORED ON EVERY PATH. This mutates the live model for the length of
       * one pass, so a throw here would leave every chiller unlimited. */
      limited.forEach(function (x) { x.e.qMax = x.cap; });
    }
    if (!free || !free.links) return;

    Object.keys(res.thermal.links).forEach(function (id) {
      var got = res.thermal.links[id];
      var want = free.links[id];
      if (!got || !want) return;
      if (got.limit !== 'Capacity') return;
      if (want.qW === undefined || want.qW === null || !isFinite(want.qW)) return;
      got.qNeed = want.qW;
    });
  }

  function solveModel(m, maxPasses, opts) {
    var it = solveModelGen(m, maxPasses, opts);
    var r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  /* ============ AUTOMATIC dP SETPOINT — "reset" in the trade sense
   *
   * Michael, 2026-08-31, on Tutorial 2 at part load: "The intended end state of
   * this scenario is for the CV to be near 100% open, and the VFD ramp down
   * further."
   *
   * WHY A FIXED SETPOINT CANNOT DO THAT, and it is not a fault. A pump holding
   * a constant differential holds it at every load. At part load a terminal
   * needs less flow, its branch needs less pressure, and the surplus has to be
   * burned somewhere — so the valve throttles and stays throttled. Measured on
   * Tutorial 2 at 79% load: the pump sits at 87%, every coil valve at about
   * 76%, and 67 of the 110 kPa is spent across the valve doing nothing.
   *
   * RESET is the answer real plant uses, and ASHRAE 90.1 effectively requires
   * it on variable flow: lower the differential setpoint until the most open
   * valve is nearly wide open, and let the pump follow it down. On the same
   * model that takes the pump to 79.6%, the valves to 88-93%, and the hydraulic
   * power from 4.83 kW to 3.86 kW — a fifth of the pumping energy — with every
   * coil still holding its design dT.
   *
   * HOW THE SEARCH WORKS. Feasibility is monotone in the setpoint: high enough
   * and every device holds, and below some value the valves run out of travel
   * and lose setpoint. So it bisects the fraction of the stated setpoint,
   * keeping the LOWEST value at which nothing is lost, and stops early once the
   * most open valve has reached `AUTO_OPEN_TARGET`.
   *
   * IT IS OPT-IN, AND THAT IS DELIBERATE. Each trial is a full control loop.
   * Tutorial 2 costs about 1.7 s and 190 control solves, so a search multiplies
   * that by the number of trials. On a large model this is minutes, which is
   * why it is a switch on the sensor and not the default.
   *
   * `dpSet` is never written. It is the engineer's design figure and the
   * ceiling; `dpAuto` carries the answer. */
  var AUTO_MIN_FRAC = 0.05;      // never search below 5% of the stated setpoint
  var AUTO_STEPS = 7;            // bisections; 1/128 of the range
  var AUTO_OPEN_TARGET = 0.95;   // most-open valve, at which the search stops

  function autoSetpointSensors(m) {
    return m.pipes.filter(function (p) {
      return p.kind === 'sensor' && p.sensor && p.sensor.mode === 'dP' &&
             p.sensor.autoSet && p.sensor.ref && Number(p.sensor.dpSet) > 0;
    });
  }

  function* runControlsAutoGen(m, core, maxPasses, opts) {
    var autos = autoSetpointSensors(m);
    if (!autos.length) {
      /* Nothing on Auto: clear any stale answer so the panel cannot show a
       * figure from a setting that has since been switched off. */
      m.pipes.forEach(function (p) {
        if (p.kind === 'sensor' && p.sensor) delete p.sensor.dpAuto;
      });
      return yield* runControlsGen(m, core, maxPasses, opts);
    }

    var design = autos.map(function (p) { return Number(p.sensor.dpSet); });
    var apply = function (frac) {
      autos.forEach(function (p, i) { p.sensor.dpAuto = design[i] * frac; });
    };
    var lost = function (r) {
      return !!(r && r.errors || []).length &&
             (r.errors || []).some(function (e) { return e.code === 'SETPOINT_LOST'; });
    };
    /* The most open MODULATING VALVE. A pump's speed is not a travel and must
     * not be read as one, or a pump at 87% would look like a wide open valve
     * and stop the search before it started. */
    var maxOpen = function (r) {
      var mx = -1;
      (((r && r.report) || {}).devices || []).forEach(function (d) {
        if (d.quantity === 'opening' && typeof d.value === 'number') {
          mx = Math.max(mx, d.value);
        }
      });
      return mx;
    };

    apply(1);
    var best = yield* runControlsGen(m, core, maxPasses, opts);
    var bestFrac = 1, lastFrac = 1;

    /* NOTHING TO OPEN, NOTHING TO SEARCH FOR. Without a modulating valve the
     * setpoint has no upper bound to press against and the bisection would run
     * to the floor for no reason. */
    if (maxOpen(best) < 0) return best;
    /* If the DESIGN setpoint already fails, lowering it can only fail harder.
     * That is a plant problem and is reported as it already would be. */
    if (lost(best)) return best;

    var lo = AUTO_MIN_FRAC, hi = 1;
    for (var i = 0; i < AUTO_STEPS; i++) {
      if (maxOpen(best) >= AUTO_OPEN_TARGET) break;
      var mid = (lo + hi) / 2;
      apply(mid);
      lastFrac = mid;
      var trial = yield* runControlsGen(m, core, maxPasses, opts);
      if (lost(trial)) {
        lo = mid;                       // too low, the coils ran out of travel
      } else {
        hi = mid; bestFrac = mid; best = trial;
      }
    }

    /* LEAVE THE MODEL HOLDING THE ANSWER. The last trial may have been a
     * rejected one, and its valve positions are still written on the model, so
     * the accepted setpoint is re-run unless it was the last thing tried. */
    apply(bestFrac);
    if (lastFrac !== bestFrac) {
      best = yield* runControlsGen(m, core, maxPasses, opts);
    }
    if (best && best.report) {
      best.report.autoSetpoint = autos.map(function (p) {
        return { pipe: p.id, tag: p.tag || null,
                 design: Number(p.sensor.dpSet), chosen: p.sensor.dpAuto };
      });
    }
    return best;
  }

  function* solveModelGen(m, maxPasses, opts) {
    /* 3 is plenty for tee reassignment alone; check valves can need another
     * round or two to seat, so the ceiling is a little higher. */
    maxPasses = maxPasses || 5;

    var core = solveCore(m, maxPasses);

    /* CONTROL: a pump or globe valve that follows a setpoint modulates here,
     * which is the one place in the app where temperature feeds back into the
     * hydraulics. It re-runs the core several times and leaves the settled
     * modulation on the model, so everything below sees a single consistent
     * answer. §17C. */
    var controls = yield* runControlsAutoGen(m, core, maxPasses, opts);
    if (controls.acted) core = controls.core;

    var net = core.net, res = core.res, passes = core.passes, sizing = core.sizing;
    res.controls = controls.report;
    if (controls.warnings.length) {
      res.warnings = (res.warnings || []).concat(controls.warnings);
    }
    if (controls.errors && controls.errors.length) {
      res.errors = (res.errors || []).concat(controls.errors);
      res.converged = false;
    }

    /* An omitted device is out of the circuit, so its flow is exactly zero —
     * report it as such. Leaving the key absent surfaces as `undefined` in the
     * sheet and the property panel, which reads as a bug rather than as "this
     * pump is off". */
    (net.omitted || []).forEach(function (l) {
      if (res.flow[l.id] === undefined) res.flow[l.id] = 0;
    });

    res.warnings = (res.warnings || []).concat(net.warnings || []);
    res.warnings = res.warnings.concat(flowRegimeWarnings(m, net, res));
    res.warnings = res.warnings.concat(supplyWarnings(m, net, res));
    res.warnings = res.warnings.concat(equipRatingWarnings(m, res));
    /* STATIC PRESSURE, on the GGA path too. Plumbing SIMULATE runs here, and it
     * is the mode where the number gets HIGH: a fixture is a K-terminal, so a
     * quiet system pushes its pump up its curve and the pressure with it.
     * `overPressureWarnings` is discipline-gated, so this is inert in hydronic. */
    res.warnings = res.warnings.concat(overPressureWarnings(m, res.pressure));
    res.warnings = res.warnings.concat(valveOversizedWarnings(m, res));

    /* A pressure nothing will ever be built to is an ERROR, not a warning —
     * the thermal runaway guard's reasoning, applied to pressure. */
    var implausible = pressurePlausibility(m, net, res);
    if (implausible.length) {
      res.errors = (res.errors || []).concat(implausible);
      res.converged = false;
    }

    /* Disconnection is checked on every solve, not just on demand. The model
     * that prompted this returned zero flow with converged:true and no errors —
     * the worst possible failure, because it looks like an answer. */
    /* A riser that stops in mid-air is a disconnection the flat-plan check
     * cannot see, because the column is drawn as a marker rather than a line. */
    (M.riserOpenEnds ? M.riserOpenEnds(m) : []).forEach(function (o) {
      res.warnings = (res.warnings || []).concat([{
        code: 'RISER_OPEN_END', node: o.node, riser: o.riser,
        message: o.riser + ' has an open connection at ' + o.end +
                 '. Connect a pipe or delete it.'
      }]);
    });

    var dis = disconnections(m);
    res.disconnections = dis;
    var fatal = dis.filter(function (d) { return d.severity === 'error'; });
    if (fatal.length) {
      res.errors = (res.errors || []).concat(fatal.map(function (d) {
        return { code: d.code, message: d.message, nodes: d.nodes, pipe: d.pipe };
      }));
      res.converged = false;
    }
    res.warnings = res.warnings.concat(dis.filter(function (d) {
      return d.severity !== 'error';
    }));

    /* A TAG WITH A GENERATED ONE STUCK ON THE END OF IT. Reported every solve,
     * because the route that produces it is not yet identified and a corrupted
     * name that nobody is told about is the worst version of this bug — you
     * find it weeks later on a drawing you have already issued. */
    m.pipes.concat(m.nodes).forEach(function (o) {
      if (!M.looksMangled(o.tag)) return;
      res.warnings.push({
        code: 'TAG_MANGLED', pipe: o.a !== undefined ? o.id : undefined,
        node: o.a === undefined ? o.id : undefined,
        message: 'Internal error caused ' + o.id + ' to become corrupted. Use ' +
                 'Repair tags under File to rectify.'
      });
    });

    /* TWO THINGS WITH THE SAME TAG. Michael, 2026-08-09, while designing
     * copy-paste: nothing detected this, so a pasted lineup would have given
     * two CHWP-01 and the schedule would have listed both without a word.
     *
     * A warning rather than a defect: duplicate tags are a REAL arrangement
     * mid-edit — you copy a floor, then renumber it — and the drawing is not
     * wrong, it is unfinished. What it cannot be is silent, because every table
     * in the calculation sheet is keyed on the tag and two rows called CHWP-01
     * cannot be told apart afterwards. */
    M.duplicateTags(m).forEach(function (d) {
      res.warnings.push({
        code: 'TAG_DUPLICATE',
        message: 'Duplicate tags ' + d.tag + ' for ' + d.ids.join(', ') +
                 ' will cause solver instability. Provide unique tags.'
      });
    });

    /* SIMULATION without a curve is not a simulation. A running pump with no
     * curve falls back to a constant head, which answers a different question
     * entirely — the flow stops responding to the system, which is the one
     * thing this mode exists to show. An ERROR, not a warning, because every
     * number downstream of it is misleading. Checked here rather than only on
     * the mode switch, since a curve can be cleared after the switch. */
    if (m.settings.calcMode === 'simulation') {
      var noCurve = m.pipes.filter(function (p) {
        return p.kind === 'pump' && p.pump && p.pump.mode !== 'off' && !p.pump.curve;
      });
      if (noCurve.length) {
        res.errors = (res.errors || []).concat(noCurve.map(function (p) {
          return {
            code: 'NO_PUMP_CURVE', pipe: p.id,
            message: 'Pump curve is required to simulate. Change pump sizing ' +
                     'mode to Manual or Curve.'
          };
        }));
        res.converged = false;
      }
    }
    res.network = net;
    res.passes = passes;
    res.pumpSizing = sizing;
    recordDesignPoint(m, res);
    /* `recordDesignPoint` writes the leader's settled design point and its
     * curve, and that happens AFTER the last build — so the followers are one
     * step behind until they are told again. No notice from this call: the
     * build above has already raised it. */
    applySyncedDesign(m);

    /* WHAT THE SYSTEM WOULD ACTUALLY DELIVER — a second, pressure-driven pass,
     * reported in brackets beside the demanded flows.
     *
     * SIMULATION ONLY, from 2026-08-06. It is a simulation-shaped number and it
     * was the ONE thing making DESIGN a hybrid: Michael's original intent was
     * that DESIGN shows naive design values, and this quietly answered "but
     * what would really happen?" in the middle of them. He asked for it out.
     *
     * And it turns out DESIGN was the only place it was ever READ: in
     * SIMULATION `simulationReport` supplies every terminal's actual flow and
     * always won the ternary that chose between them. So this is not moved to
     * SIMULATION, it is gone — running it there would be the same pass twice,
     * once properly (every outflow a resistance) and once as an approximation,
     * with two answers to one question.
     *
     * Nothing is lost. In DESIGN the demands IMPOSE the flow, so the honest
     * report of a system that cannot meet them is the negative pressures
     * already in the table: they are the shortfall in head, which is what you
     * size the pump against.
     *
     * `actualDelivery` itself stays and stays tested — it is a sound
     * pressure-driven pass and the gravity case in supply.test.js is worth
     * keeping — it is simply not wired into the solve. */
    res.actual = null;
    res.critical = criticalPath(m, net, res);
    res.simulation = simulationReport(m, net, res);
    /* Temperature is transported by the water, so it can only be worked out
     * once the flows are known — and it feeds nothing back, because fluid
     * properties are held at one temperature. Last, and one-way. */
    res.thermal = FD.thermal ? FD.thermal.solve(m, res) : null;
    applyRequiredCapacity(m, res);
    if (res.thermal) {
      if (res.thermal.warnings.length) {
        res.warnings = res.warnings.concat(res.thermal.warnings);
      }
      /* A temperature outside the plausible band is a HYDRAULIC-level error:
       * it takes the status chip and clears `converged`, because every number
       * on the sheet is then describing a system that cannot exist. */
      if (res.thermal.errors && res.thermal.errors.length) {
        res.errors = (res.errors || []).concat(res.thermal.errors);
        res.converged = false;
      }
    }
    /* LAST, so every message — including the thermal pass's, which are appended
     * after everything else — gets a level. Doing it earlier stamped only the
     * ones raised so far, which is the sort of half-applied rule that is worse
     * than none. */
    classify(res.warnings);
    return res;
  }

  /* Remember the design duty on the pump itself.
   *
   * DESIGN sizes the pump, and the answer is a PAIR — flow and head at the
   * design point. The head was already written back by autoSizePumps; the flow
   * was not, so the design flow only ever existed as "whatever the last solve
   * happened to return". SIMULATION needs both, because there the pump is
   * doing something else and the panel shows the two side by side.
   *
   * Recorded in DESIGN only. Writing it in SIMULATION would overwrite the
   * design point with the operating point, which is the one comparison the
   * panel exists to make. */
  function recordDesignPoint(m, res) {
    if (m.settings.calcMode === 'simulation') return;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'pump' || !p.pump || p.pump.mode === 'off') return;
      /* ONLY FOR A PUMP THAT IS BEING SIZED.
       *
       * On MANUAL the design point is an INPUT — Michael states the flow and
       * the head, and the solve then reported back whatever flow it happened to
       * land on, silently replacing the number he typed (2026-08-06). On CURVE
       * it is the manufacturer's, and equally not ours to move. Writing it back
       * unconditionally made "Manual" mean "manual until you press Solve". */
      if (M.pumpSizing(p) !== 'auto') return;
      var q = res.flow[p.id];
      if (q === undefined) return;
      p.pump.qDesign = Math.abs(q);
      p.pump.hDesign = p.pump.head || 0;
      /* And the curve follows from the duty, HERE, so an auto-sized pump that
       * has never had its panel opened can still be simulated. Generating it
       * only in the panel meant drawing a pump and switching to SIMULATION hit
       * "Pump curve required" for a duty the app had already worked out. */
      M.generateCurve(m, p);
    });
  }

  /* Flow-regime check, run once after the solve has settled.
   *
   * This matters more than it first looks: Hazen-Williams is an empirical
   * correlation fitted to TURBULENT water flow. In laminar flow it is not
   * merely imprecise, it is the wrong equation — so a laminar section is a
   * warning about the method, not just about the velocity. Typically it shows
   * up on oversized pipes at low demand, or on a branch that is nearly shut.
   */
  /* Below this the flow prints as 0.00 L/s, so a regime warning about it cannot
   * be reconciled with the figure shown beside it. Deliberately NOT
   * `hydraulics.Q_MIN`, which is the solver's linearisation floor and five
   * times smaller. */
  var Q_REGIME_MIN = 5e-6;                       // m3/s = 0.005 L/s

  function flowRegimeWarnings(m, net, res) {
    var out = [];
    var warn = m.settings.warn || {};
    var nu = (m.settings.fluid && m.settings.fluid.kinematicViscosity) || 1.004e-6;
    var rho = net.rho || 998;
    /* The ASHRAE method IS Hazen-Williams for pipe friction, so the "this is
     * the wrong equation in laminar flow" warning applies to it too. Testing
     * for 'HW' alone silently dropped the warning the moment ASHRAE became the
     * default — the flow regime does not care which fitting basis is used. */
    var meth = m.settings.frictionMethod || 'HW';
    var usingHW = (meth !== 'DW');

    net.links.forEach(function (l) {
      if (l.kind !== 'pipe' || l._virtual) return;
      var q = res.flow[l.id];
      if (q === undefined || Math.abs(q) < FD.hydraulics.Q_MIN) return;  // no flow, no regime

      var section = l.from + ' → ' + l.to;

      /* Velocity and friction-rate limits are checked HERE, in the engine,
       * not in the calculation-sheet renderer. They were previously derived
       * from the sheet rows, which meant solveModel() reported "no warnings"
       * for a network running at 12 m/s — fine for the UI, silently wrong for
       * any other consumer of the result. Detection belongs with the physics;
       * the UI only reformats these into display units. */
      var v = FD.hydraulics.velocity(q, l._d);
      if (warn.velocity && v > warn.velocity) {
        out.push({
          code: 'VELOCITY', pipe: l.id, section: section,
          velocity: v, limit: warn.velocity,
          message: ((M.pipe(m, l.id) || {}).tag || l.id) + ' velocity ' +
                   v.toFixed(2) + ' m/s exceeds ' + warn.velocity +
                   ' m/s set in HYDRAULIC.'
        });
      }

      if (warn.pdm && l._L > 1e-9) {
        var pdm = rho * 9.81 *
                  (Math.abs(FD.hydraulics.headloss(l._rActual, q, l.n)) / l._L);
        if (pdm > warn.pdm) {
          out.push({
            code: 'PDM', pipe: l.id, section: section,
            pdm: pdm, limit: warn.pdm,
            message: ((M.pipe(m, l.id) || {}).tag || l.id) + ' friction rate ' +
                     pdm.toFixed(0) + ' Pa/m exceeds ' + warn.pdm +
                     ' Pa/m set in HYDRAULIC.'
          });
        }
      }

      if (warn.laminar === false) return;

      /* A PIPE THAT CARRIES NOTHING HAS NO FLOW REGIME WORTH REPORTING —
       * Michael, 2026-08-31: "No laminar flow warnings for pipes with 0 flow."
       *
       * `Q_MIN` above is the SOLVER's linearisation floor, 0.001 L/s, and it is
       * far below what the sheet prints. A dead leg or a branch behind a shut
       * valve trickles a few thousandths of a litre a second, shows as
       * "0.00 L/s" everywhere in the interface, and was still raising a laminar
       * warning against itself — which reads as a bug, because the engineer is
       * being told a pipe carrying nothing is calculated unreliably.
       *
       * The threshold is what the DISPLAY rounds away: below 0.005 L/s the
       * flow prints as 0.00, so a warning about it can never be reconciled with
       * the number beside it. And the warning has nothing to say in any case —
       * it exists to flag an unreliable FRICTION LOSS, and the loss through a
       * pipe carrying nothing is nothing. */
      if (Math.abs(q) < Q_REGIME_MIN) return;

      var Re = FD.hydraulics.reynolds(q, l._d, nu);
      l._Re = Re;

      if (FD.hydraulics.isLaminar(Re)) {
        out.push({
          code: 'LAMINAR',
          pipe: l.id,
          message: ((M.pipe(m, l.id) || {}).tag || l.id) + ' is in laminar flow (Re = ' +
                   Math.round(Re) + '). ' +
                   (usingHW ? 'Hazen-Williams calculation method is not reliable ' +
                              'in this region. Consider using Darcy-Weisbach ' +
                              'calculation method.'
                            : 'Friction loss here is inherently uncertain.')
        });
      } else if (FD.hydraulics.isTransitional(Re)) {
        out.push({
          code: 'TRANSITIONAL',
          pipe: l.id,
          message: ((M.pipe(m, l.id) || {}).tag || l.id) + ' is in transitional ' +
                   'range (Re = ' + Math.round(Re) + '). Both friction ' +
                   'calculations are unreliable in this region. Consider ' +
                   'changing pipe size.'
        });
      }
    });
    return out;
  }

  /* Pin a datum in any pumped component that has no fixed head. Mutates
   * `nodes` in place and appends a warning describing the assumption. */
  function pinClosedCircuitDatum(nodes, links, warnings) {
    var index = {};
    nodes.forEach(function (n, i) { index[n.id] = i; });

    var parent = nodes.map(function (_, i) { return i; });
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    links.forEach(function (l) {
      if (index[l.from] !== undefined && index[l.to] !== undefined) {
        union(index[l.from], index[l.to]);
      }
    });

    var comps = {};
    nodes.forEach(function (n, i) {
      var root = find(i);
      (comps[root] = comps[root] || []).push(i);
    });

    Object.keys(comps).forEach(function (root) {
      var members = comps[root];
      var hasFixed = members.some(function (i) {
        return nodes[i].fixedHead !== null && nodes[i].fixedHead !== undefined;
      });
      if (hasFixed) return;

      // Only pumped components — an unpumped dead leg really does have no flow.
      var pumpsHere = links.filter(function (l) {
        return l.kind === 'pump' && index[l.from] !== undefined &&
               find(index[l.from]) === +root;
      });
      if (!pumpsHere.length) return;

      // Prefer a pump suction; otherwise the first node in the component.
      var pick = index[pumpsHere[0].from];
      if (pick === undefined) pick = members[0];
      nodes[pick].fixedHead = nodes[pick].z;
      nodes[pick]._datum = true;

      warnings.push({
        code: 'NO_SOURCE',
        node: nodes[pick].id,
        message: 'Water source is required.',
        detail: 'To let the calculation proceed, node ' + nodes[pick].id + ' has been ' +
                'pinned as a temporary pressure datum (0 kPa gauge at its own level). ' +
                'Flows and pressure DIFFERENCES are correct, but absolute pressures are ' +
                'relative to that point and will change once a real source is placed.'
      });
    });
  }

  /* Does this in-line device have a terminal node on either side? If so no
   * flow can pass through it, whatever head it is given. */
  function isDeadEnded(m, p) {
    return [p.a, p.b].some(function (id) {
      var n = M.node(m, id);
      return n && !n.device && M.pipesAt(m, id).length < 2;
    });
  }

  // ------------------------------------------------------ pump auto-sizing
  /* Worst unmet pressure across all included demands, in Pa. Negative means
   * every demand is satisfied. */
  function worstShortfall(m, res) {
    var worst = -Infinity, node = null;
    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      var p = res.pressure[n.id];
      if (p === undefined) return;
      var short = (n.device.reqPressure || 0) - p;
      if (short > worst) { worst = short; node = n.id; }
    });
    return { pa: worst === -Infinity ? 0 : worst, node: node };
  }

  /* Re-size every 'auto' pump so the index demand just meets its requirement,
   * plus the safety factor. Returns { resolved, res, iterations, stalled }. */
  function autoSizePumps(m, res) {
    /* Skip pumps that can never pass flow, so a disconnected one is not wound
     * up into a fictitious duty.
     *
     * The test is TOPOLOGICAL, not "does it carry flow right now". A pump that
     * starts at zero head carries no flow precisely because it has not been
     * sized yet — filtering on flow meant a closed circuit could never bootstrap
     * itself off zero. What actually disqualifies a pump is a dead end on one
     * side, which no amount of head can overcome. */
    /* In SIMULATION the duty is an input, not something to be solved for. */
    if (m.settings.calcMode === 'simulation') {
      return { resolved: false, iterations: 0, skipped: true, mode: 'simulation' };
    }
    /* A SYNCED PUMP IS NOT SIZED ON ITS OWN — it takes the leader's duty
     * (`applySyncedDesign`). Sizing it here as well would wind two members of
     * one set against the same shortfall independently, which is the runaway
     * the frozen anchor above exists to prevent. */
    var autos = m.pipes.filter(function (p) {
      return p.kind === 'pump' && p.pump && p.pump.mode === 'auto' &&
             !M.syncOf(p) && !isDeadEnded(m, p);
    });
    if (!autos.length) return { resolved: false, iterations: 0, skipped: true };

    /* No demand nodes at all? Then this is a closed circuit, and the design
     * flow is whatever the equipment is rated for — there is no terminal
     * pressure to aim at. Size on FLOW instead of on pressure. */
    var hasDemand = m.nodes.some(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false;
    });
    /* WHICH EQUIPMENT SETS THE FLOW — the loads do.
     *
     * A heat exchanger states the flow it needs to move its duty: that is a
     * DEMAND on the circuit. A source/sink's rated flow is a SELECTION figure —
     * what the machine was bought for — and a machine is routinely selected
     * larger than the load it serves today. Michael, 2026-08-04.
     *
     * Taking the largest rating across ALL equipment is what produced
     * `debug/20260804-1.json`: a 100 kW chiller rated 1.6 L/s beside a 50 kW
     * coil rated 0.798 L/s — a chiller deliberately selected to run at half
     * load. The sizer drove 1.6 L/s through the coil, 2.006× its rating and
     * therefore 4.02× its pressure drop: 805 kPa against a rated 200, and a
     * pump duty of 102.7 m. Nothing was wrong with the arithmetic.
     *
     * Sized on the coil instead, the chiller passes 0.798 L/s and drops
     * (0.798/1.6)² × 200 = 50 kPa. That half of the fix needed no code at all:
     * equipment has always been r·Q² from its own design point, so a machine
     * at part load drops what the square law says it drops.
     *
     * Plant-only circuits still size on the plant — a loop with nothing but a
     * chiller in it has no other statement of what flow it wants. */
    var equips = m.pipes.filter(function (p) {
      return p.kind === 'equip' && p.equip && !p.equip.off && p.equip.qRated > 0;
    });
    /* An ADIABATIC item — a filter, a strainer — is not a load either. It is
     * pipework with a pressure drop, and it states nothing about what flow the
     * circuit wants. */
    var loads = equips.filter(function (p) {
      return p.equip.equipType !== 'source' && p.equip.equipType !== 'adiabatic';
    });
    if (!hasDemand && equips.length) {
      return autoSizeForFlow(m, res, autos, loads.length ? loads : equips);
    }

    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    var safety = 1 + (m.settings.pumpSafetyPct || 0) / 100;
    var cur = res, prevShort = null, stalled = false, i;
    // heads as they were before the most recent (possibly useless) increase
    var lastGoodHeads = autos.map(function (p) { return p.pump.head || 0; });

    for (i = 0; i < 15; i++) {
      var w = worstShortfall(m, cur);

      /* Converge on the duty from EITHER side. Only ever adding head meant an
       * oversized pump stayed oversized — a model saved with a large duty kept
       * it forever, which is not what 'auto' means. Demands are fixed flows,
       * so lowering the head lowers every pressure by the same amount and one
       * step lands it. */
      if (w.pa < -1) {
        var cut = (-w.pa) / (rho * 9.81);
        autos.forEach(function (p) {
          p.pump.head = Math.max(0, (p.pump.head || 0) - cut);
        });
        var down = build(m, cur);
        cur = FD.solver.solve(down);
        cur.network = down;
        prevShort = null;               // direction changed; restart the stall watch
        continue;
      }
      if (w.pa <= 1) break;                       // satisfied (within 1 Pa)

      /* If a round of extra head barely moved the shortfall, more head will not
       * help either — the pump is not on the path to that demand. Roll the
       * useless head back off and stop, rather than leaving the model carrying
       * a duty that bought nothing. */
      if (prevShort !== null && (prevShort - w.pa) < Math.max(1, Math.abs(prevShort) * 1e-4)) {
        autos.forEach(function (p, k) { p.pump.head = lastGoodHeads[k]; });
        var back = build(m, res);
        cur = FD.solver.solve(back);
        cur.network = back;
        stalled = true;
        break;
      }
      prevShort = w.pa;

      lastGoodHeads = autos.map(function (p) { return p.pump.head || 0; });
      /* No safety factor here. The SOLVE must run at design conditions, or the
       * margin quietly changes the answer instead of describing the pump: in a
       * closed circuit a 10% head margin pushed 21 L/s through equipment rated
       * for 20. The margin is a pump SELECTION figure and is reported as a
       * separate duty head. */
      var add = w.pa / (rho * 9.81);
      autos.forEach(function (p) { p.pump.head = (p.pump.head || 0) + add; });

      var next = build(m, cur);
      cur = FD.solver.solve(next);
      cur.network = next;
    }

    return { resolved: true, res: cur, iterations: i, stalled: stalled };
  }

  /* Size pumps in a closed circuit so the equipment gets its rated flow.
   *
   * The whole circuit is very nearly quadratic (equipment is exactly Q², pipes
   * are Q^1.852), so head scales as roughly Q^1.9. That gives a good enough
   * update rule to converge in a handful of solves:
   *     H_new = H_old × (q_target / q_actual)^1.9
   * From a standing start the flow is zero, so the first guess comes from the
   * equipment's own rated pressure drop, which is the right order of
   * magnitude for a circuit built around it. */
  function autoSizeForFlow(m, res, autos, equips) {
    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    var cur = res, i;

    /* THE DUTY IS SET BY THE WORST-SERVED MACHINE, not the best-served one.
     *
     * This drove the LARGEST actual flow up to the LARGEST rated flow. On
     * parallel loads that stops the moment the EASIEST branch reaches its
     * rating, leaving every harder branch below rated — an undersized pump, and
     * exactly the "auto sizing being slightly wrong" Michael reported
     * (2026-08-21). Two branches at different heights make it plain: the low
     * one reaches rated, the high one never does, and the search stops anyway.
     *
     * The metric is `flow / qRated` and the target is the SMALLEST of them: the
     * duty is right when the machine that is hardest to reach has its rated
     * flow. Comparing ratios rather than flows also handles a circuit whose
     * machines carry different ratings, which comparing raw flows never could.
     *
     * It is the same criterion `criticalPath` picks the index load with, so the
     * calculation sheet and the pump agree about which machine governs. */
    function worstServed(state) {
      var w = null;
      equips.forEach(function (e) {
        var rated = Number(e.equip.qRated);
        if (!(rated > 0)) return;
        var q = Math.abs(state.flow[e.id] || 0);
        var ratio = q / rated;
        if (!w || ratio < w.ratio) w = { ratio: ratio, q: q, rated: rated, pipe: e };
      });
      return w;
    }

    var w = worstServed(cur);
    var target = w ? w.rated : Math.max.apply(null, equips.map(function (e) { return e.equip.qRated; }));

    for (i = 0; i < 25; i++) {
      w = worstServed(cur);
      if (!w) break;
      target = w.rated;
      if (w.q > 0 && Math.abs(w.ratio - 1) < 1e-4) break;

      var head;
      if (!(w.q > FD.hydraulics.Q_MIN)) {
        // standing start — seed from the equipment's rated drop
        head = (equips[0].equip.pdRated || 1e5) / (rho * 9.81) * 1.5;
      } else {
        var ratio = Math.pow(1 / w.ratio, 1.9);
        // damp the step so an over-correction cannot oscillate
        ratio = Math.max(0.25, Math.min(4, ratio));
        head = (autos[0].pump.head || 0) * ratio;
      }
      if (!(head > 0) || !isFinite(head)) break;

      autos.forEach(function (p) { p.pump.head = head; });
      var next = build(m, cur);
      cur = FD.solver.solve(next);
      cur.network = next;
    }

    /* Deliberately NOT multiplied by the safety factor — see the note in
     * autoSizePumps. The equipment must see its rated flow; the margin is
     * reported as the duty head to select against. */
    return { resolved: true, res: cur, iterations: i, mode: 'flow', target: target,
             /* Which machines the duty was sized on, so the sheet can say so
              * rather than leaving "why that flow?" as a puzzle. */
             sizedOn: equips.map(function (e) { return e.tag || e.id; }) };
  }

  /* =============================================== SETPOINT CONTROL (VSD)
   *
   * A pump or globe valve carrying a control link modulates to hold the linked
   * equipment's leaving temperature. This is the ONE place in the app where
   * temperature feeds back into the hydraulics: everywhere else the flows are
   * solved first and the temperature is carried along them (§18).
   *
   * SIMULATION ONLY, and that is not a shortcut. In DESIGN the flows are
   * IMPOSED — a demand node states the flow it takes — so modulating a pump or
   * a valve cannot move them and there is nothing for a controller to do. The
   * one DESIGN case where flow does follow head is a closed circuit being
   * auto-sized, and there `autoSizePumps` is already driving the same actuator
   * towards the rated flow; two controllers on one actuator is not a system
   * with an answer. So: DESIGN sizes, SIMULATION controls.
   *
   * THREE things this had to get right, all of which this codebase has learnt
   * once already:
   *
   * 1. THE DIRECTION IS NOT ASSUMED. More flow moves some machines towards
   *    their setpoint and others away from it, so nothing here hard-codes a
   *    sign. Because an actuator cannot go past fully open or rated speed, the
   *    only question is whether BACKING OFF helps, and that is answered by
   *    perturbation: back off a little, re-solve, compare. If it makes the
   *    error worse, the device is already doing all it can and says so.
   *
   * 2. THE ERROR IS READ FROM A FINISHED SOLVE. The modulation is frozen for
   *    the whole of a core solve and its thermal pass, so no pass is ever
   *    chasing an error it is itself producing. That is the check-valve lesson
   *    (§6) and the frozen-active-set lesson (§18) in a third place.
   *
   * 3. THE SEARCH IS BRACKETED, NOT NEWTON. A source/sink holds its setpoint
   *    exactly once it is no longer limited, so the error is non-zero above
   *    some speed and identically zero below it — a derivative of zero over
   *    half the range, which a secant method divides by. Secant steps are used
   *    only to find a value that meets the setpoint; the answer is then
   *    bisected out as the HIGHEST setting that still meets it, which is where
   *    a real controller comes to rest.
   *
   * The settled value is left on the model (`pump.speed`, `valve.opening`) and
   * reported in `res.controls`. Every controlled device is reset to full before
   * the search, so the answer depends on the model and not on what the last
   * solve happened to leave behind.
   */
  var CTRL_DEFAULTS = { minSpeed: 0.25, minOpening: 10, tol: 0.05 };

  /* WHERE THE SEARCH LOOKS WHEN THE FAR STOP TELLS IT NOTHING — fractions of
   * the travel between the floor and where the device stands, walked DOWNWARD.
   * With the floor itself that is five samples evenly across the range. See the
   * scan in `seek`; four is a bound on the cost, not a resolution anybody
   * derived. */
  var CTRL_SCAN = [0.8, 0.6, 0.4, 0.2];

  /* The thing being modulated, described so the loop never asks whether it is
   * a pump or a valve (HANDOVER §9A, trap 5). `x` is always a fraction of full
   * travel, so one search serves both. */
  function actuatorFor(m, p) {
    var cfg = (m.settings && m.settings.control) || {};
    if (p.kind === 'pump' && p.pump) {
      var lo = Number(cfg.minSpeed);
      return {
        pipe: p, kind: 'pump', quantity: 'speed',
        min: (isFinite(lo) && lo > 0 && lo < 1) ? lo : CTRL_DEFAULTS.minSpeed,
        step: 0.001,
        get: function () { return M.pumpSpeed(m, p); },
        set: function (x) { p.pump.speed = x; },
        label: function (x) { return Math.round(x * 100) + '% speed'; }
      };
    }
    /* AN INTEGRATED CONTROL VALVE is an actuator on the EQUIPMENT link. Same
     * resolution and floor as a drawn globe valve, because it is one — the only
     * difference is that it lives on the machine instead of beside it. */
    if (p.kind === 'equip' && p.equip && p.equip.icv && M.icvMode(p) === 'auto') {
      /* ZERO IS A LEGITIMATE FLOOR — Michael, 2026-08-31: "Allow Minimum Valve
       * Opening 0%". A valve that may shut completely is a real control
       * strategy, and `>= 0` rather than `> 0` is the whole change. A shut
       * valve is charged `CLOSED_R`, which is large but FINITE, so the solver
       * matrix stays non-singular. */
      var le = Number(cfg.minOpening);
      le = (isFinite(le) && le >= 0 && le < 100) ? le : CTRL_DEFAULTS.minOpening;
      return {
        pipe: p, kind: 'valve', quantity: 'opening',
        min: le / 100,
        step: 0.01,
        get: function () {
          var o = Number(p.equip.icv.opening);
          return (isFinite(o) ? Math.min(100, Math.max(0, o)) : 100) / 100;
        },
        set: function (x) { p.equip.icv.opening = Math.round(x * 100); },
        label: function (x) { return Math.round(x * 100) + '% open'; }
      };
    }
    if (p.kind === 'valve' && p.valve) {
      /* A globe valve's opening is a whole percentage — that is what the panel
       * offers and what a real valve is set to — so the search resolution is a
       * percent, not a float. Bisecting past it would be inventing precision
       * the actuator does not have. */
      var lv = Number(cfg.minOpening);
      lv = (isFinite(lv) && lv >= 0 && lv < 100) ? lv : CTRL_DEFAULTS.minOpening;
      return {
        pipe: p, kind: 'valve', quantity: 'opening',
        min: lv / 100,
        step: 0.01,
        get: function () {
          var o = Number(p.valve.opening);
          return (isFinite(o) ? Math.min(100, Math.max(0, o)) : 100) / 100;
        },
        set: function (x) { p.valve.opening = Math.round(x * 100); },
        label: function (x) { return Math.round(x * 100) + '% open'; }
      };
    }
    return null;
  }

  /* WHAT A SENSOR IS READING, from a solved result. One definition, because
   * there are now two consumers: the control loop settles against it, and the
   * drawing prints it beside the instrument.
   *
   * Michael, 2026-08-09: a ΔP sensor's "Display" list offered Temperature, and
   * ticking it drew the water temperature at the tapping — which a differential
   * pressure sensor does not measure. A toggle that draws the wrong quantity is
   * worse than one that draws nothing.
   *
   * Every mode reads at the sensor's INLET node — the water arriving, which is
   * what a tapping on that pipe would see. The two differential modes are
   * MAGNITUDES: which of the two pipes was picked first is an accident of
   * drawing order, not a statement about the plant.
   *
   * Returns { mode, value } in SI, or null when the reading cannot be taken —
   * no result yet, no reference pipe, or nothing setting a temperature. */
  function sensorReading(m, p, res) {
    if (!p || p.kind !== 'sensor' || !p.sensor || !res) return null;
    var sn = p.sensor;
    var num = function (x) { return (x === undefined || !isFinite(x)) ? null : x; };

    if (sn.mode === 'flow') {
      var q = res.flow ? num(res.flow[p.id]) : null;
      return q === null ? null : { mode: 'flow', value: Math.abs(q) };
    }
    if (sn.mode === 'pressure') {
      var pa = res.pressure ? num(res.pressure[p.a]) : null;
      return pa === null ? null : { mode: 'pressure', value: pa };
    }
    if (sn.mode === 'dP' || sn.mode === 'dT') {
      var ref = M.pipe(m, sn.ref);
      if (!ref) return null;
      if (sn.mode === 'dP') {
        var p1 = res.pressure ? num(res.pressure[p.a]) : null;
        var p2 = res.pressure ? num(res.pressure[ref.a]) : null;
        return (p1 === null || p2 === null)
          ? null : { mode: 'dP', value: Math.abs(p1 - p2) };
      }
      var th = res.thermal && res.thermal.temperature;
      if (!th) return null;
      var t1 = num(th[p.a]), t2 = num(th[ref.a]);
      return (t1 === null || t2 === null)
        ? null : { mode: 'dT', value: Math.abs(t1 - t2) };
    }
    var tt = res.thermal && res.thermal.temperature
      ? num(res.thermal.temperature[p.a]) : null;
    return tt === null ? null : { mode: 'temperature', value: tt };
  }

  /* Drains the control loop synchronously. Kept as a named function because it
   * is the shape everything except the app wants, and because a test that has
   * to know about generators is a test about the wrong thing. */
  function runControls(m, core, maxPasses, opts) {
    var it = runControlsGen(m, core, maxPasses, opts);
    var r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  function* runControlsGen(m, core, maxPasses, opts) {
    var warnings = [], errors = [];
    var out = { acted: false, core: core, report: null, warnings: warnings,
                errors: errors };
    if (!FD.thermal) return out;
    if (m.settings.calcMode !== 'simulation') return out;

    var pairs = [];
    m.pipes.forEach(function (p) {
      /* AN INTEGRATED CONTROL VALVE IS LINKED BY EXISTING, to its own machine's
       * ΔT. There is nothing for the user to draw or pick: a valve built into a
       * coil holds that coil's ΔT and could not sensibly hold anything else. */
      /* A MANUAL valve is not a controller — it is a balancing valve somebody
       * set, and there is nothing for the loop to search. */
      if (p.kind === 'equip' && p.equip && p.equip.icv && !p.equip.off &&
          M.icvMode(p) === 'auto') {
        var iAct = actuatorFor(m, p);
        var iOpts = M.controlOptions(m, p.id).filter(function (o) {
          return o.mode === 'dT';
        });
        if (iAct && iOpts.length) {
          pairs.push({ act: iAct, equip: p, target: iOpts[0].value,
                       mode: iOpts[0].mode, label: iOpts[0].label,
                       key: iOpts[0].key, refPipe: null, cmp: iOpts[0].cmp || 'set',
                       options: iOpts, optIndex: 0, result: null, icv: true });
        }
        return;
      }
      /* A SYNCED DEVICE IS NOT A CONTROLLER. It copies a position; there is
       * nothing for the loop to search. `setSync` already clears any control
       * link, so this only catches a hand-edited file. */
      if (M.syncOf(p)) return;
      var c = M.controlOf(p);
      if (!c) return;
      var tgtPipe = M.pipe(m, c.equip);
      if (!tgtPipe) {
        /* THE TARGET HAS BEEN DELETED. The link is still on the device and
         * quietly does nothing — `20260807-DC.json` has four primary pumps
         * pointing at a sensor that no longer exists, which is why they all sat
         * at 100% with no explanation. Say so; a drawn control link that
         * silently does nothing is the exact surprise the link was added to
         * avoid. */
        warnings.push({
          code: 'CONTROL_TARGET_GONE', pipe: p.id,
          message: (p.tag || p.id) + ' is linked to ' + c.equip +
                   ', which has been deleted/renamed. Re-link or clear the control.'
        });
        return;
      }
      var act = actuatorFor(m, p);
      if (!act) return;
      /* WHICH setpoints this controller is chasing, in priority order —
       * Design LWT then Design ΔT on a source/sink, Design flow then Design ΔT
       * on an exchanger, its one setpoint on a sensor. `M.controlChoice` is the
       * one place that knows the order and which are toggled on. */
      var opts = M.controlChoice(m, p);
      var tgt = opts[0];
      if (!tgt) {
        /* A heat exchanger states a LOAD, not a leaving temperature (§18), and
         * a sensor with an empty setpoint states nothing. Either way there is
         * nothing to modulate towards, and it is said out loud — a drawn
         * control link that quietly does nothing is exactly the surprise the
         * link was added to avoid. */
        warnings.push({
          code: 'CONTROL_NO_SETPOINT', pipe: p.id, equip: tgtPipe.id,
          message: (p.tag || p.id) + ' has no setpoint for ' +
                   (tgtPipe.tag || tgtPipe.id) + '. Provide a setpoint.'
        });
        return;
      }
      pairs.push({ act: act, equip: tgtPipe, target: tgt.value,
                   mode: tgt.mode, label: tgt.label, key: tgt.key,
                   refPipe: tgt.ref || null, cmp: tgt.cmp || 'set',
                   /* The fallbacks, in order. Chased only if the one above
                    * turns out to be unreachable. */
                   options: opts, optIndex: 0, result: null });
    });

    /* ================================ DEVICES THAT SHARE A SETPOINT ARE GANGED
     *
     * N controllers chasing ONE measured quantity is degenerate: any split that
     * produces the right reading satisfies all of them, and settling them one
     * at a time picks whichever split the iteration order happens to reach first.
     *
     * `debug/20260807-DC-broken.json` (Michael, 2026-08-08) is four primary
     * pumps on one differential. Settled individually they landed at 100%,
     * 85.8%, 25% and 25% — the last two on their floor carrying NO FLOW, held
     * shut by the first two. Stable, arbitrary, and nothing like the plant.
     *
     * THIS IS ALSO WHAT REAL PLANT DOES. Parallel pumps on a common header
     * share ONE speed command from the BMS; they do not each run a private loop
     * against the same sensor. Michael's own account of the real system — "it
     * would fluctuate over a few hours, then stabilize with roughly equal
     * running %" — is a description of independent loops fighting, and then of
     * the equal split they are eventually commanded to. Ganging goes straight
     * to the answer.
     *
     * It is also the cheap option, which matters on a model this size: one
     * search for the group instead of N interacting ones.
     *
     * GROUPED ON: same actuator quantity, same target, same setpoint. Different
     * setpoints, or a pump and a valve, are not a gang — they are genuinely
     * different jobs that happen to watch the same instrument. */
    var gangs = {};
    pairs.forEach(function (pr) {
      var k = pr.act.quantity + '|' + pr.equip.id + '|' + pr.key + '|' + pr.mode +
              '|' + (pr.cmp || 'set');
      (gangs[k] = gangs[k] || []).push(pr);
    });
    Object.keys(gangs).forEach(function (k) {
      var g = gangs[k];
      if (g.length < 2) return;
      var lead = g[0];
      var members = g.map(function (pr) { return pr.act; });
      /* ONE ACTUATOR over all of them. The floor is the most restrictive in the
       * group and the step the finest, so no member is ever asked for a
       * position it cannot hold. */
      lead.act = {
        pipe: lead.act.pipe, kind: lead.act.kind, quantity: lead.act.quantity,
        min: members.reduce(function (mx, a) { return Math.max(mx, a.min); }, 0),
        step: members.reduce(function (mn, a) { return Math.min(mn, a.step); }, 1),
        gang: members,
        get: function () { return members[0].get(); },
        set: function (x) { members.forEach(function (a) { a.set(x); }); },
        label: lead.act.label
      };
      lead.gang = g;
      /* The others are reported, not searched. */
      g.slice(1).forEach(function (pr) { pr.ganged = lead; });
      /* MICHAEL'S WORDING, 2026-08-08, and it is a DEFECT rather than a notice:
       * the model still answers — the gang below makes sure of that — but it is
       * not the arrangement he wants drawn, and the message says what to draw
       * instead. Ganging stays underneath it as the safety net, because the
       * alternative to a common command is an arbitrary split (§17C), and a
       * warning on top of a wrong answer is worse than a warning on top of a
       * right one. */
      warnings.push({
        code: 'CONTROL_GANGED', pipe: lead.act.pipe.id, equip: lead.equip.id,
        message: 'Multiple equipment connected to ' +
                 (lead.equip.tag || lead.equip.id) + ' may cause unstable ' +
                 'simulation. Connect 1 equipment to the sensor & sync other ' +
                 'equipment to that.',
        detail: 'Until then they are modulated together at one common ' +
                lead.act.quantity + ', which is what a common header does — ' +
                'without that they would settle on an arbitrary split.'
      });
    });
    /* Only the lead of each gang is searched; the rest follow its actuator. */
    var searchPairs = pairs.filter(function (pr) { return !pr.ganged; });

    if (!pairs.length) {
      return { acted: false, core: core, report: null, warnings: warnings,
               errors: errors };
    }

    /* TWO thresholds, and they are different things.
     *
     * `tol` is the DEADBAND: how far off setpoint is worth modulating for at
     * all. A real controller has one, and without it the search chases solver
     * round-off.
     *
     * `EPS` is what "meets the setpoint" means once the search is running, and
     * it is essentially zero. That is safe here BY CONSTRUCTION rather than by
     * luck: only a source/sink carries a setpoint, and a source/sink that is no
     * longer limited holds its setpoint EXACTLY — the error is not small, it is
     * identically zero. So the boundary is a genuine step, and bisecting to a
     * micro-kelvin resolves it rather than hunting an asymptote.
     *
     * Stopping at the edge of the deadband instead was tried first and is
     * subtly wrong: it leaves the machine a whole `tol` short, which is 1% of
     * the flow on a 5 K duty, and leaves it still reporting EQUIP_LIMITED while
     * the controller claims to be holding setpoint. */
    var tolCfg = Number((m.settings.control || {}).tol);
    var tol = (isFinite(tolCfg) && tolCfg > 0) ? tolCfg : CTRL_DEFAULTS.tol;
    var EPS = 1e-7;                            // K — "on setpoint" for the search

    /* THE SOLVE BUDGET SCALES WITH THE NUMBER OF CONTROLLED DEVICES.
     *
     * It was a flat 60, chosen when a model had one controller or two. On
     * `debug/20260805-4.json` — five of them — it ran out at 62 solves partway
     * through the LAST device, which then reported `unsettled` and was parked
     * back at full travel by the lost-setpoint rule. It looked exactly as
     * though the valve had never tried to throttle, and Michael reported it as
     * such. The valve was fine; it simply never got a turn.
     *
     * Per-device, with a ceiling so a pathological model still reports rather
     * than hangs. A device needs roughly 10-15 solves to bracket and bisect,
     * and the iteration may revisit it.
     *
     * MEASURED, so the ceiling is a judgement rather than a guess: on
     * `debug/20260805-4.json` — 33 nodes, 36 pipes, five controllers — one
     * network solve is about 3.5 ms, and the whole controlled solve took 184 ms
     * over 52 inner solves. The 400 ceiling is therefore of the order of a
     * second on a model that size: slow enough to notice, fast enough not to
     * matter, and only reached by a model that is genuinely hunting.
     *
     * `control.maxSolves` overrides it — Michael, 2026-08-05 — for anyone who
     * wants to trade time for a tighter answer, or the reverse on a big model. */
    /* A SOFT limit, and it has to be: it is tested at loop boundaries, and
     * every device takes at least its first probe before the check can bite.
     * With five controllers the floor is about ten solves whatever is asked
     * for. It bounds the work; it does not hit a number exactly. */
    /* HOW MANY ITERATIONS the outer loop may take. Six by default — enough for the
     * parallel branches on every model of Michael's that converges to settle
     * against each other. A rough first pass may be happy with fewer and a final
     * answer may want more, so it is a setting (`control.iterations`), clamped to a
     * sane range. It bounds the OUTER loop; the solve budget below is scaled to
     * match, so asking for more iterations actually buys them rather than running
     * into a ceiling meant for six. */
    var cfgIterations = Number((m.settings.control || {}).iterations);
    var MAX_ITERATIONS = (isFinite(cfgIterations) && cfgIterations >= 1)
      ? Math.min(100, Math.round(cfgIterations)) : 6;

    var cfgSolves = Number((m.settings.control || {}).maxSolves);
    var MAX_SOLVES = (isFinite(cfgSolves) && cfgSolves > 0)
      ? cfgSolves
      /* SCALES WITH THE WORK. The old cap of 400 was chosen when a big model
       * had three controllers; Michael's data centre has five, each needing a
       * probe, a descent and a bisection every iteration. 20 solves per controller
       * per iteration is roughly what one full search costs — so at the default six
       * iterations this is the same 120·devices as before, and raising the iteration
       * count raises the budget with it instead of capping the extra iterations out.
       * An explicit `control.maxSolves` still overrides the lot. */
      : Math.max(400, 20 * pairs.length * MAX_ITERATIONS);
    var solves = 0;
    /* WHERE THE LOOP HAS GOT TO. Declared up here because `evaluate` reports
     * it on every yield, and a `var` hoisted from two hundred lines below reads
     * as a bug even when hoisting saves it. */
    var iteration = 0, doneUnits = 0, curDevice = null;
    /* The worst case: every device settled on every one of the six iterations.
     * Declared with the rest of the progress state rather than beside the iteration
     * loop, because `evaluate` divides by it on the very first yield — and a
     * hoisted `var` read before its assignment is `undefined`, which would have
     * made every fraction NaN. */
    var totalUnits = Math.max(1, searchPairs.length * MAX_ITERATIONS);

    /* ONE NETWORK SOLVE, AND THE ONLY PLACE THIS LOOP YIELDS.
     *
     * About 100 ms on the data centre, and everything expensive in a controlled
     * solve is a multiple of it — so it is both the unit of work and the unit
     * of progress. The yield happens AFTER the solve, so a driver that pauses
     * here is pausing on a consistent state with the newest numbers in hand.
     *
     * `iteration` and `curDevice` are read at yield time rather than passed in, so
     * adding a caller cannot forget to report where it is. */
    function* evaluate() {
      solves++;
      var c = solveCore(m, maxPasses);
      c.thermal = FD.thermal.solve(m, c.res);
      /* PROGRESS, AND IT IS HONEST ABOUT WHAT IT CANNOT KNOW.
       *
       * The loop cannot say how many solves a search will need, so `fraction`
       * is DEVICES SETTLED out of the worst case — every device, every one of
       * the six iterations. It is monotonic and it never overstates, which means a
       * model that converges in two iterations finishes with the bar at a third.
       * That is not a bar that broke: it is a bar that was never told the
       * answer would come early, and the alternative is a number that goes
       * backwards or lies. `iteration` is yielded beside it so the caller can say
       * "iteration 2 of 6" and let the reader draw the right conclusion. */
      yield {
        solves: solves, iteration: iteration, iterations: MAX_ITERATIONS, device: curDevice,
        done: doneUnits, total: totalUnits,
        fraction: Math.min(1, doneUnits / Math.max(1, totalUnits))
      };
      return c;
    }
    /* What the controller is looking at. A temperature comes out of the thermal
     * pass; a flow comes straight off the solve and needs no thermal result at
     * all, which is why a flow-setpoint sensor works in a model with no
     * temperatures in it. */
    function measure(c, pair) {
      if (pair.mode === 'flow') {
        var q = c.res && c.res.flow ? c.res.flow[pair.equip.id] : undefined;
        return (q === undefined || !isFinite(q)) ? null : Math.abs(q);
      }
      /* PRESSURE at the sensor's INLET node — the water arriving, which is what
       * a tapping on that pipe reads. */
      if (pair.mode === 'pressure') {
        var pa = c.res && c.res.pressure ? c.res.pressure[pair.equip.a] : undefined;
        return (pa === undefined || !isFinite(pa)) ? null : pa;
      }
      /* DIFFERENTIAL, between this sensor and its referenced pipe — both read
       * at their inlet, which is where the two tappings would go. Reported as a
       * MAGNITUDE: which way round the two pipes were picked is an accident of
       * drawing order, not a statement about the plant. */
      if (pair.mode === 'dPdiff' || pair.mode === 'dTdiff') {
        var ref = M.pipe(m, pair.refPipe);
        if (!ref) return null;
        if (pair.mode === 'dPdiff') {
          var p1 = c.res && c.res.pressure ? c.res.pressure[pair.equip.a] : undefined;
          var p2 = c.res && c.res.pressure ? c.res.pressure[ref.a] : undefined;
          return (p1 === undefined || p2 === undefined ||
                  !isFinite(p1) || !isFinite(p2)) ? null : Math.abs(p1 - p2);
        }
        var th = c.thermal && c.thermal.temperature;
        if (!th) return null;
        var t1 = th[pair.equip.a], t2 = th[ref.a];
        return (t1 === undefined || t2 === undefined ||
                !isFinite(t1) || !isFinite(t2)) ? null : Math.abs(t1 - t2);
      }
      var l = c.thermal && c.thermal.links && c.thermal.links[pair.equip.id];
      if (!l) return null;
      /* ΔT is compared as a MAGNITUDE. The sign is the direction the machine
       * works in, which is inferred rather than chosen (§18), so a design ΔT
       * of 15 K means 15 K across it either way. */
      if (pair.mode === 'dT') return isFinite(l.dT) ? Math.abs(l.dT) : null;
      return isFinite(l.tOut) ? l.tOut : null;
    }
    /* THE ERROR, AND THE COMPARATOR THAT MAY CLAMP IT TO ONE SIDE.
     *
     * SET is `reading - target` and always was. MIN is a FLOOR: only a
     * shortfall is an error, so the positive half is clamped away and a reading
     * comfortably above target produces exactly zero. MAX is the mirror.
     *
     * Clamping is necessary and NOT sufficient — see `seekOneSided`. With the
     * error zero across the whole satisfied region, `seek`'s "already on
     * setpoint" return fires at full travel and the device never moves, and its
     * tie-break prefers the higher setting where every satisfied position ties
     * at |e| = 0. A one-sided setpoint wants the BOUNDARY of that region, and
     * for MIN that is its LOWEST end — the opposite of what `seek` computes. */
    function clampErr(pair, e) {
      if (e === null) return null;
      if (pair.cmp === 'min') return Math.min(0, e);
      if (pair.cmp === 'max') return Math.max(0, e);
      return e;
    }
    function errorOf(c, pair) {
      var v = measure(c, pair);
      return v === null ? null : clampErr(pair, v - pair.target);
    }
    function quantise(act, x) {
      var q = Math.round(x / act.step) * act.step;
      return Math.max(act.min, Math.min(1, q));
    }

    /* Start every controlled device at full travel. Warm-starting from the last
     * answer would be cheaper and is wrong: the search only ever probes
     * DOWNWARD, so a device that once ramped down could never ramp back up when
     * the load returned, and the reported answer would depend on edit history
     * rather than on the model. */
    var needReset = pairs.some(function (pr) { return Math.abs(pr.act.get() - 1) > 1e-9; });
    pairs.forEach(function (pr) { pr.act.set(1); });
    var cur;
    if (needReset) {
      cur = yield* evaluate();
    } else {
      cur = core;
      if (!cur.thermal) cur.thermal = FD.thermal.solve(m, cur.res);
    }

    /* The DEADBAND, per target. On a temperature it is an absolute number of
     * kelvin. On a FLOW it has to be relative: 0.05 of anything is meaningless
     * without a unit, and 0.05 m³/s is 50 L/s. Half a percent of setpoint,
     * floored at 0.01 L/s — tighter than any real flow meter. */
    function tolFor(pair) {
      /* RELATIVE, with only a token absolute floor. It used to be
       * `max(1e-5, 0.5%)`, and on a branch rated 0.8 L/s the 1e-5 floor is
       * 0.01 L/s — 1.25% — which DOMINATED the relative term and made the
       * deadband four times looser than it read. Michael, 2026-08-05: three
       * valves sat wide open on `debug/20260805-5.json` with their branches
       * 0.1-0.6% over, all inside that floor, while the fourth throttled to
       * 59%. He expected them between 59% and 100%, and he was right.
       *
       * 0.2% of setpoint is tighter than any real flow meter and comfortably
       * inside what one percent of valve travel can resolve. The 1e-7 floor is
       * only there so a setpoint of zero cannot ask for infinite precision. */
      if (pair.mode === 'flow') return Math.max(1e-7, Math.abs(pair.target) * 0.002);
      /* Half a percent of setpoint, floored at 100 Pa — tighter than any real
       * pressure transmitter and well inside the solver's own tolerance. */
      if (pair.mode === 'pressure' || pair.mode === 'dPdiff') {
        return Math.max(100, Math.abs(pair.target) * 0.005);
      }
      return tol;                             // kelvin, for a temperature or a ΔT
    }

    /* "MEETS THE SETPOINT", generalised over the two shapes of error.
     *
     * A SOURCE/SINK holds its setpoint EXACTLY once it is no longer limited, so
     * its error is a step: non-zero above some speed and identically zero
     * below. A SENSOR is continuous — the mixed temperature at a tee slides
     * smoothly with the valve — so its error CROSSES zero rather than reaching
     * it, and a "== 0" test would never fire.
     *
     * One predicate covers both: arrived, or gone past. The bisection that
     * follows then converges on the boundary in the first case and on the root
     * in the second, without knowing which it is looking at. */
    function metBy(e, e0, pair) {
      if (e === null) return false;
      var eps = pair.mode === 'flow' ? 1e-9
              : (pair.mode === 'pressure' || pair.mode === 'dPdiff') ? 1e-4 : 1e-7;
      if (Math.abs(e) <= eps) return true;
      return (e > 0) !== (e0 > 0);          // crossed
    }

    /* Settle ONE device, holding every other where it is.
     *
     * A GENERATOR, because every `evaluate()` in here is a yield point —
     * that is the whole of S3. It recurses into itself in two places (the
     * restart-from-full paths), and `yield*` carries those through the same
     * way it carries a plain call. */
    function* seek(pair) {
      var act = pair.act;
      /* The deadband can never be finer than the ACTUATOR can resolve. A globe
       * valve is set in whole percent, so a mixed temperature lands on a grid
       * about a tenth of a kelvin apart; asking for 0.05 K then means the
       * device is never "on setpoint", and the next iteration hunts again from a
       * position that was already the best available. `floorErr` is what a
       * bracketed search actually achieved, discovered rather than assumed. */
      var band = Math.max(tolFor(pair), pair.floorErr || 0);
      var x0 = act.get();
      var e0 = errorOf(cur, pair);
      if (e0 === null) return { state: 'no-flow', x: x0, error: null, moved: false };
      if (Math.abs(e0) <= band) {
        /* ALREADY ON SETPOINT.
         *
         * Off full travel the device is plainly the reason — it moved to get
         * here — so it is holding it.
         *
         * AT full travel it is not modulating at all. That covers two cases
         * which look identical from here and need the same response: a valve
         * wide open on the furthest branch whose flow is already right (correct
         * commissioning), and a pump following an unlimited chiller's LWT that
         * it has no say over. Both should TRY THE NEXT SETPOINT if they were
         * given one — that is what fixed the pump on 2026-08-04 — and both
         * should simply report as holding it if they were not.
         *
         * `idle` is the signal for exactly that: fall through if there is
         * somewhere to fall to, otherwise it is `on`.
         *
         * THIS WAS A PROBE, TWICE, AND NEITHER WORKED. Near, it read solver
         * noise: 5% of an equal-percentage valve's travel moves the flow by
         * less than the solver's own tolerance. Far, it read the far field: a
         * chiller comfortable at design flow still misses at quarter flow, so
         * the probe "found" an authority the device has no use for. Michael's
         * `20260805-5` then had three correctly-wide-open valves reported as
         * having no authority. The position and the option list answer the
         * question between them, without measuring anything. */
        return { state: (x0 >= 1 - 1e-9) ? 'idle' : 'on',
                 x: x0, error: e0, moved: false };
      }

      /* --- DOES BACKING OFF HELP? The sign question, answered not assumed.
       *
       * PROBED AT THE MINIMUM, not a nudge below where we are. A 5% nudge was
       * the obvious thing and is wrong: on an equal-percentage valve near full
       * travel it changes the flow by about 1e-7 m³/s, which is two orders of
       * magnitude BELOW the solver's own convergence tolerance. The test was
       * reading numerical noise and calling it "backing off does not help", so
       * three valves on `debug/20260805-4.json` sat at 100% while their
       * branches ran 17% over — Michael reported them as not throttling.
       *
       * Probing the far end answers the question definitively for one solve,
       * and it hands the descent a BRACKET straight away rather than making it
       * walk there — so it usually costs fewer solves, not more. */
      var probe = act.min;
      if (!(probe < x0 - 1e-12)) {
        /* --- ALREADY ON THE FLOOR, AND THE SEARCH ONLY DESCENDS.
         *
         * The mirror of the `at-max` case below, and it costs exactly the same
         * bug. A device that walked to its floor on an earlier iteration is asked
         * again on the next one — by which time the OTHER devices have moved
         * the plant out from under it, and what was unreachable may now be one
         * step above where it stands. There is nowhere below to probe, so the
         * search returned `at-min` without solving anything at all, the
         * lost-setpoint rule read that as "nothing in its range holds the
         * setpoint", and slammed it to 100%.
         *
         * `economizer-trim` with ACCH-1's real capacity, 2026-08-09. Iteration 1
         * put PMP-02 on its 25% floor honestly: with all four valves still wide
         * open the mix was 12 K below setpoint at EVERY speed. Iterations 2 and 3
         * then measured +2.4 K at that same floor — the valves had throttled,
         * the response had turned, and the root was sitting at about 28% — and
         * both iterations reported `at-min` and moved nothing.
         *
         * So restart from FULL, which is the only direction this search can
         * travel from, under the same one-shot guard: from full travel there is
         * genuinely nowhere further up and `at-min` then means what it says. */
        if (x0 < 1 - 1e-9 && !pair.reseeking) {
          pair.reseeking = true;
          act.set(1);
          cur = yield* evaluate();
          var upward = yield* seek(pair);
          pair.reseeking = false;
          if (Math.abs(upward.x - x0) > 1e-9) upward.moved = true;
          return upward;
        }
        return { state: 'at-min', x: x0, error: e0, moved: false };
      }
      /* Keep the BEST point seen anywhere in this search, not merely the last
       * one. An actuator has a finite resolution — a globe valve is set in
       * whole percent — so the setpoint usually falls BETWEEN two positions,
       * and the honest answer is whichever of them sits closest to it. Ties go
       * to the higher setting, which is where a source/sink's flat-zero error
       * puts the boundary. */
      var best = { x: x0, e: e0, c: cur };
      var bracketed = false;
      /* Every position this search tried, so the end of it can ask what one
       * step of the actuator is actually WORTH here. See `floorErr` below. */
      var samples = [];
      function record(x, e, c) {
        if (e === null) return;
        samples.push({ x: x, e: e });
        if (metBy(e, e0, pair)) bracketed = true;
        var d = Math.abs(e) - Math.abs(best.e);
        if (d < -1e-12 || (Math.abs(d) <= 1e-12 && x > best.x)) {
          best = { x: x, e: e, c: c };
        }
      }

      act.set(probe);
      var trial = yield* evaluate();
      var e1 = errorOf(trial, pair);
      record(probe, e1, trial);

      /* --- ONE SAMPLE AT THE STOP CANNOT DESCRIBE A CURVE THAT TURNS.
       *
       * Everything below this line assumes the error moves one way with the
       * actuator: the far probe says whether backing off helps, and the descent
       * and the bisection take it from there. On a mixing circuit that
       * assumption is simply false, and it fails silently.
       *
       * The rig in `thermal.test.js` — two sources, a bypass, a check valve and
       * a mixing sensor, which is Michael's economizer in miniature — reads
       * +4.4 K at full speed, falls through setpoint at about 45%, bottoms at
       * −1.4 K near 35%, and rises back through setpoint at about 30%. Two
       * effects fight: while the check valve holds the bypass shut the trim pump
       * sets the WHOLE loop flow, so slowing it puts the same kilowatts into
       * fewer kilograms and the supply gets COLDER; once the bypass opens,
       * mixing takes over and it gets warmer. TWO perfectly good answers, and
       * the single probe at 25% saw only a smaller error of the same sign,
       * descended to the floor, reported `at-min`, and the lost-setpoint rule
       * parked the pump at 100% with the sensor 4.4 K high.
       *
       * So when the far stop does not bracket the setpoint, SCAN the travel
       * before believing it. Walked downward from where the device stands, so
       * the first crossing found is the HIGHEST position that holds setpoint —
       * which is where a controller ramping down from full would stop, and is
       * the same tie-break `record` uses.
       *
       * COSTED, because solves are the currency here: it is skipped entirely
       * whenever the far probe already brackets, which is the ordinary case and
       * still one solve. It is paid only by a device that would otherwise have
       * ended at `at-min`, `at-max` or `unsettled` — that is, only where the
       * answer today is "I could not do it". */
      var scanMet = null, scanHi = x0, scanC = null;
      if (e1 !== null && !metBy(e1, e0, pair) &&
          x0 - probe > 3 * act.step && solves < MAX_SOLVES) {
        var prevX = x0;
        for (var si = 0; si < CTRL_SCAN.length && solves < MAX_SOLVES; si++) {
          var xs = quantise(act, probe + (x0 - probe) * CTRL_SCAN[si]);
          if (!(xs < prevX - 1e-12) || !(xs > probe + 1e-12)) continue;
          act.set(xs);
          var sc = yield* evaluate();
          var se = errorOf(sc, pair);
          record(xs, se, sc);
          if (se === null) {
            cur = sc;
            return { state: 'no-flow', x: xs, error: null, moved: true };
          }
          if (metBy(se, e0, pair)) { scanMet = xs; scanHi = prevX; scanC = sc; break; }
          prevX = xs;
        }
        /* Nothing found. Put the actuator back where the far probe left it, so
         * `trial` still describes the model the descent is about to start
         * from — no solve, just the position. */
        if (scanMet === null) act.set(probe);
      }

      /* HELPED, OR WENT PAST IT. Both mean backing off is the right direction —
       * and the second has to be allowed for, because probing at the MINIMUM
       * usually overshoots hard: on this rig the error goes from +0.15 L/s at
       * full to −0.58 L/s at 10% open. Judging on |error| alone would call that
       * "no better" and leave the valve wide open, which is exactly what three
       * of Michael's valves did. A crossing is the strongest possible evidence
       * that the setpoint is reachable — it brackets the root. */
      var helped = (scanMet !== null) || ((e1 !== null) &&
                   (Math.abs(e1) < Math.abs(e0) - 1e-12 || metBy(e1, e0, pair)));
      if (!helped) {
        /* No better and no crossing. Put it back — and note that `cur` is still
         * the answer at x0, so restoring the model costs nothing to re-solve. */
        act.set(x0);

        /* --- IT MAY NEED TO GO UP, AND THE SEARCH ONLY GOES DOWN.
         *
         * This is a DESCENT from full travel. That is fine on the first pass,
         * where `runControls` has just put every device at full — but a later
         * iteration starts wherever the previous one finished, and a device that
         * now needs to OPEN has nowhere to look from here. It reported
         * `at-max` at 35% open, which then counted as a lost setpoint and
         * parked it at 100%.
         *
         * `debug/20260807-1.json`, Michael, 2026-08-07. Iteration 1 settled every
         * device beautifully — four valves at 32-35%, PMP-01 at 34.7% holding
         * its dP to within 44 Pa. But the valves settled while the pump was
         * still at full, and the pump then dropped to 34.7% and starved them by
         * 25%. Iteration 2 found four valves needing to open, could not open any of
         * them, called all four lost, and threw the whole answer away: pump and
         * valves all back to 100%. He reported it as "PMP-01 ramping up to full
         * speed" and "the CVs also stopped working" — one cause, both symptoms.
         *
         * So restart the descent from FULL, which is the only direction this
         * search can travel from. Guarded against recursing twice: from full
         * travel there is genuinely nowhere further up, and `at-max` then means
         * what its name says. */
        if (x0 < 1 - 1e-9 && !pair.reseeking) {
          pair.reseeking = true;
          act.set(1);
          cur = yield* evaluate();
          var again = yield* seek(pair);
          pair.reseeking = false;
          /* It MOVED — from x0 to wherever this landed — even if the search
           * itself reports otherwise, or the iteration would stop while devices
           * were still being repositioned. */
          if (Math.abs(again.x - x0) > 1e-9) again.moved = true;
          return again;
        }
        return { state: 'at-max', x: x0, error: e0, moved: false };
      }

      /* --- OUT OF BUDGET? PUT IT BACK. -----------------------------------
       *
       * The probe has just moved the actuator to its MINIMUM. If the solve
       * budget is gone, the descent below cannot run, the bisection cannot run,
       * and the search returns with the device sitting on its floor and the
       * probe's error — which on a chilled-water loop is a thermal runaway,
       * because a chiller at quarter flow does not hold its leaving
       * temperature.
       *
       * `debug/20260808-DC-broken.json` (Michael, 2026-08-08): five iterations
       * settled all four chilled-water pumps to within 0.02 K, and the sixth
       * ran out of solves. Every one of them was left at 25% carrying errors of
       * 669, 1317 and 1629 K, judged `unsettled`, and then parked at 100%. He
       * asked why they were "not balancing to maintain 30C" and why they seemed
       * to fight when they are on separate lineups — they were not fighting.
       * The budget ran out and a truncated search left them wherever the last
       * probe happened to put them.
       *
       * A search that cannot finish must be a NO-OP, not a random position. */
      if (solves >= MAX_SOLVES) {
        act.set(x0);
        return { state: 'budget', x: x0, error: e0, moved: false };
      }

      /* --- descend until something meets the setpoint, or the floor is reached.
       * The probe already sits at the minimum, so if it crossed the setpoint
       * this loop exits immediately and the bisection below does the work. */
      var xPrev = x0, ePrev = e0, x = probe, e = e1, c = trial;
      /* THE SCAN ALREADY BRACKETED IT. Hand the two ends straight to the
       * bisection: the descent has nothing left to find. */
      if (scanMet !== null) {
        xPrev = scanHi; x = scanMet; e = errorOf(scanC, pair); c = scanC;
      }
      var met = null, guard = 0;
      while (guard++ < 14 && solves < MAX_SOLVES) {
        if (metBy(e, e0, pair)) { met = x; cur = c; break; }
        if (x <= act.min + 1e-12) {
          /* ON THE FLOOR — and the floor is not automatically the best place to
           * be. It is on a response that only falls, which is the only kind
           * this descent used to meet; on one that turns, the scan above may
           * have found a better position further up, and `best` is tracking it.
           * Reporting the floor regardless threw that away. */
          if (best.x > x + 1e-12 && Math.abs(best.e) < Math.abs(e) - 1e-12) {
            act.set(best.x); cur = best.c;
            return { state: Math.abs(best.e) <= band ? 'on' : 'unsettled',
                     x: best.x, error: best.e,
                     moved: Math.abs(best.x - x0) > 1e-9 };
          }
          cur = c;
          /* Inside the deadband is still "holding setpoint" — it just cannot be
           * held any more tightly than this. */
          return { state: Math.abs(e) <= band ? 'on' : 'at-min',
                   x: x, error: e, moved: true };
        }
        var den = e - ePrev, nx;
        nx = (Math.abs(den) > 1e-12) ? x - e * (x - xPrev) / den : x - 0.1;
        // the search only descends, and always by at least one step
        if (!isFinite(nx) || nx >= x - act.step) nx = x - Math.max(act.step, 0.1);
        nx = quantise(act, nx);
        xPrev = x; ePrev = e;
        x = nx;
        act.set(x);
        c = yield* evaluate();
        e = errorOf(c, pair);
        record(x, e, c);
        if (e === null) { cur = c; return { state: 'no-flow', x: x, error: null, moved: true }; }
      }
      if (met === null) {
        cur = c;
        return { state: Math.abs(e) <= band ? 'on' : 'unsettled',
                 x: x, error: e, moved: true };
      }

      /* --- narrow the bracket to the actuator's own resolution.
       *
       * `a` meets the setpoint and `b` does not. For a SOURCE/SINK everything
       * below `a` meets it too, so the answer is the boundary — the highest
       * setting that still does, which is where a controller stops seeing an
       * error. For a SENSOR the two ends straddle a genuine root and the answer
       * is whichever end is closer, which `record` is already tracking. */
      var a = met, b = xPrev;
      while (b - a > act.step + 1e-12 && solves < MAX_SOLVES) {
        var mid = quantise(act, (a + b) / 2);
        if (!(mid > a + 1e-12) || !(mid < b - 1e-12)) break;
        act.set(mid);
        var mc = yield* evaluate();
        var me = errorOf(mc, pair);
        record(mid, me, mc);
        if (metBy(me, e0, pair)) { a = mid; } else { b = mid; }
      }
      act.set(best.x);
      cur = best.c;
      /* BRACKETED means the search straddled the setpoint: the controller is
       * doing everything it can, and any residual is the actuator's resolution
       * rather than a failure to control. A globe valve set in whole percent
       * cannot land a mixed temperature more finely than about a tenth of a
       * kelvin, and demanding more would report a working control as broken. */
      /* WHAT ONE STEP OF THE ACTUATOR IS WORTH, measured — not the residual
       * that happened to be best.
       *
       * `floorErr` exists so a device is not asked to hold a setpoint more
       * finely than its actuator can resolve. It recorded `|best.e|`, which is
       * the error at the BETTER of the two positions either side of the
       * setpoint — and that is the one number here that cannot be a resolution
       * limit, because the search just achieved it.
       *
       * Michael, 2026-08-24: the four coils on `debug/20260824-debug.json`
       * would not settle until the deadband went to 0.5 K. They were in a
       * period-2 limit cycle, and the trace is unambiguous — from iteration 6 the
       * plant alternates between exactly two states, PMP-01 at 71.10% with the
       * coils at 56/57/57/57 and PMP-01 at 71.70% with them at 56/56/56/56,
       * for ever. AHU-L2 read -0.040 K at 57% and +0.056 K at 56%: ONE PERCENT
       * of valve travel is worth about a tenth of a kelvin, so a 0.05 K
       * deadband is finer than the valve can resolve and neither position is
       * ever "on setpoint". `floorErr` was 0.040 — the good end — so the next
       * iteration found the device outside its own floor and moved it back. The
       * coils then shifted the differential by more than the pump's 275 Pa
       * band, the pump re-settled, and that shifted the coils again.
       *
       * So take the WORST error seen within one step of where the search
       * landed. That is what the actuator's resolution costs at this operating
       * point, and a controller that has straddled the setpoint is holding it
       * as well as it can be held. */
      if (bracketed) {
        var reach = 0;
        for (var sIdx = 0; sIdx < samples.length; sIdx++) {
          if (Math.abs(samples[sIdx].x - best.x) <= act.step + 1e-12) {
            reach = Math.max(reach, Math.abs(samples[sIdx].e));
          }
        }
        pair.floorErr = Math.max(Math.abs(best.e), reach) * 1.0001;
      }
      return { state: (Math.abs(best.e) <= band || bracketed) ? 'on' : 'unsettled',
               x: best.x, error: best.e,
               moved: Math.abs(best.x - x0) > 1e-9 };
    }

    /* Several controllers are settled in turn and the iteration repeated, because
     * one device's modulation moves every other device's inlet temperature.
     * Two or three iterations in practice; if it is still moving after that, say so
     * rather than reporting a number that is still travelling. */
    /* Worth trying the NEXT setpoint on the list. */
    function failed(st) {
      return st === 'at-max' || st === 'at-min' || st === 'unsettled' ||
             st === 'idle';
    }

    /* Ran out of solves. NOT a failure of the plant and NOT a lost setpoint —
     * the search simply did not get to run. It keeps whatever position the last
     * complete iteration gave it, which is the best answer available. */
    function outOfBudget(st) { return st === 'budget'; }

    /* THE SETPOINT IS GENUINELY LOST — a stronger statement than `failed`, and
     * the one that raises an error and parks the actuator at full.
     *
     * `idle` is deliberately NOT in this set. It means the device is at full
     * travel with its setpoint already MET — a valve wide open on the furthest
     * branch, or a pump following a setpoint another machine is holding. The
     * setpoint is not lost; nobody is modulating for it. */
    function lostSetpoint(st) {
      return st === 'at-max' || st === 'at-min' || st === 'unsettled';
    }
    /* `budget` is deliberately in neither set: it must not fall through to the
     * next setpoint (nothing was tried) and must not be parked at full (the
     * position it has came from a search that DID finish). */

    /* Six iterations rather than four. Parallel branches balancing against each
     * other need a few passes to settle, and the budget now allows them. */
    var acted = false, moving = true;
    /* PROGRESS, and a chance to breathe.
     *
     * `onProgress` is called after every device is settled. The app uses it to
     * drive a bar and — because this is single-threaded and the app must run
     * from file://, where Workers are blocked — to decide when to hand the
     * browser back. Returning `false` from it ABANDONS the loop and keeps
     * whatever the last complete iteration produced, which is a valid answer.
     *
     * Michael, 2026-08-08: "Users can accept a progress bar, but not a browser
     * freeze." */
    var onProgress = (opts && opts.onProgress) || null;

    /* ============================ A ONE-SIDED SETPOINT IS A LIMIT, NOT A TARGET
     *
     * Michael, 2026-08-25: "bypass control valves that maintain a minimum flow
     * through chillers. I.e. if the main flow drops below MIN due to downstream
     * valves closing, the bypass valve will open to maintain MIN flow through
     * the chillers."
     *
     * That is a different job from holding a value, and it needs its own search
     * rather than a tweak to `seek`. `seek` descends from full travel looking
     * for where the error CROSSES zero, and answers with the highest setting
     * that meets the setpoint. A limit has no crossing: the error is zero
     * across everything that satisfies it, and the answer wanted is the
     * BOUNDARY of that region — for MIN, its LOWEST end, because a bypass valve
     * that is not needed should be SHUT.
     *
     * So the shape here is a plain bracket, and it needs no assumption about
     * which way the reading moves — only that the two ends differ:
     *
     *   1. Try the REST position first: where the device sits when the limit is
     *      not biting. MIN rests at its floor (a bypass shut, a pump at minimum
     *      speed); MAX rests at full travel. Usually the answer, and it costs
     *      one solve.
     *   2. If rest does not satisfy it, try the FAR end. If that does not
     *      either, the limit cannot be held anywhere — say so and let the
     *      caller fall through to the next setpoint.
     *   3. Otherwise bisect between them for the satisfying position NEAREST
     *      REST — the least the device has to do.
     *
     * Compare SET on the same bypass valve: it would demand flow EQUAL to the
     * minimum, fail to reach it whenever the system is busy, report the
     * setpoint lost and park the valve WIDE OPEN. */
    function* seekOneSided(pair) {
      var act = pair.act;
      var wantLow = (pair.cmp === 'min');
      var band = Math.max(tolFor(pair), pair.floorErr || 0);
      var x0 = act.get();
      var sat = function (e) { return e !== null && Math.abs(e) <= band; };
      var moved = function (x) { return Math.abs(x - x0) > 1e-9; };

      /* 1 — REST. The floor for a MIN, full travel for a MAX. */
      var rest = wantLow ? act.min : 1;
      act.set(rest);
      var cRest = yield* evaluate();
      var eRest = errorOf(cRest, pair);
      if (eRest === null) {
        act.set(x0);
        return { state: 'no-flow', x: x0, error: null, moved: false };
      }
      if (sat(eRest)) {
        cur = cRest;
        return { state: 'on', x: rest, error: eRest, moved: moved(rest) };
      }

      /* 2 — THE FAR END. */
      var far = wantLow ? 1 : act.min;
      act.set(far);
      var cFar = yield* evaluate();
      var eFar = errorOf(cFar, pair);
      if (!sat(eFar)) {
        /* Nothing this device can do holds the limit. `at-max` for a MIN it
         * cannot reach even wide open, `at-min` for a MAX it cannot hold even
         * shut — the same two states `seek` reports, so the fall-back and the
         * parking rules downstream need no special case. */
        cur = cFar;
        return { state: wantLow ? 'at-max' : 'at-min',
                 x: far, error: eFar, moved: moved(far) };
      }

      /* 3 — BISECT for the satisfying position nearest rest. `a` fails, `b`
       * satisfies, and `b` is always the answer so far. */
      var a = rest, b = far, cB = cFar, eB = eFar, guard = 0;
      while (Math.abs(b - a) > act.step + 1e-12 && solves < MAX_SOLVES &&
             guard++ < 24) {
        var mid = quantise(act, (a + b) / 2);
        if (mid <= Math.min(a, b) + 1e-12 || mid >= Math.max(a, b) - 1e-12) break;
        act.set(mid);
        var cm = yield* evaluate();
        var em = errorOf(cm, pair);
        if (sat(em)) { b = mid; cB = cm; eB = em; } else { a = mid; }
      }
      act.set(b);
      cur = cB;
      return { state: 'on', x: b, error: eB, moved: moved(b) };
    }

    /* SETTLE ONE PAIR: the search, plus the priority fall-back to the next
     * setpoint when the first cannot be reached. Pulled out of the iteration loop
     * because the re-settle pass after parking (S4, below) runs exactly this
     * body — and a second hand-copied fall-back would drift out of step with
     * this one the first time either was touched. */
    function* settleOnce(pair) {
      var r = yield* (pair.cmp === 'min' || pair.cmp === 'max'
        ? seekOneSided(pair) : seek(pair));
      /* FALL BACK. "LWT first, then ΔT" is a priority, not a blend: if the
       * first setpoint cannot be reached — the actuator on a stop, or backing
       * off making it worse — chase the next one instead of sitting on a
       * result nobody asked for. Only once per iteration, so a device cannot
       * cycle through its options forever. */
      while (failed(r.state) && pair.optIndex + 1 < pair.options.length) {
        pair.optIndex++;
        var nx = pair.options[pair.optIndex];
        pair.target = nx.value; pair.mode = nx.mode;
        pair.label = nx.label; pair.key = nx.key; pair.cmp = nx.cmp || 'set';
        pair.floorErr = 0;
        pair.fellBack = true;
        /* Each setpoint is chased from FULL TRAVEL. The previous one may have
         * left the actuator on its stop, and starting the next search there
         * hides half the range from it. */
        if (pair.act.get() < 1 - 1e-9) { pair.act.set(1); cur = yield* evaluate(); }
        r = yield* (pair.cmp === 'min' || pair.cmp === 'max'
          ? seekOneSided(pair) : seek(pair));
      }
      return r;
    }

    /* PARK EVERY DEVICE THAT FINISHED LOST AT FULL, and report whether that
     * actually MOVED the plant. A device already sitting at full is marked lost
     * without a re-solve — it changes nothing behind it — so it does not, by
     * itself, ask for a re-settle. A device already flagged lost on an earlier
     * pass is left alone: once lost it stays parked, so the set only ever grows,
     * which is what makes the S4 loop below terminate. */
    function* parkLost() {
      var moved = false;
      for (var pi = 0; pi < searchPairs.length; pi++) {
        var ppair = searchPairs[pi];
        var pr2 = ppair.result;
        if (!pr2 || pr2.lost || !lostSetpoint(pr2.state)) continue;
        if (ppair.act.get() < 1 - 1e-9) {
          ppair.act.set(1);
          cur = yield* evaluate();
          pr2.x = 1;
          pr2.error = errorOf(cur, ppair);
          moved = true;
        }
        pr2.lost = true;
      }
      return moved;
    }

    /* A `for` LOOP, NOT `forEach` — a callback cannot yield, and every `seek`
     * in here is now a `yield*`. That is the only reason this shape changed;
     * the body below is the same body. */
    while (moving && iteration < MAX_ITERATIONS && solves < MAX_SOLVES) {
      moving = false; iteration++;
      var abandoned = false;
      for (var si2 = 0; si2 < searchPairs.length; si2++) {
        var pair = searchPairs[si2];
        curDevice = pair.act.pipe.tag || pair.act.pipe.id;
        var r = yield* settleOnce(pair);

        pair.result = r;
        if (r.moved) { moving = true; acted = true; }

        doneUnits++;
        if (onProgress) {
          var keepGoing = onProgress({
            done: doneUnits, total: totalUnits,
            fraction: Math.min(1, doneUnits / totalUnits),
            iteration: iteration, solves: solves,
            device: curDevice
          });
          if (keepGoing === false) { abandoned = true; moving = false; }
        }
        if (abandoned) break;
      }
      if (abandoned) break;
    }
    curDevice = null;

    /* PARK AT FULL WHEN THE SETPOINT IS LOST — AFTER the iterations, never during
     * (Michael, 2026-08-04 for the rule; moved out of the loop 2026-08-05).
     *
     * `debug/20260804-3.json`: a 110 kW coil against a 100 kW chiller. The loop
     * chased LWT, found that throttling reduced the error, and walked the pump
     * to its 25% floor — making a heat-balance failure worse. Less flow through
     * a machine already at its capacity delivers less cooling, not more. So
     * when nothing in the actuator's range holds the setpoint, the actuator
     * goes back to FULL: in a condition you cannot control, choose the position
     * that delivers most. Same reasoning as a control valve failing open.
     *
     * DOING IT INSIDE THE SWEEP WAS WRONG. Four valves balancing four parallel
     * branches interact — closing one pushes flow to the others — so a device
     * can report `at-max` on one pass and settle happily on the next. Slamming
     * it back to full travel mid-iteration threw away the iteration's progress and
     * made the answer depend on which pass a transient landed in. On
     * `debug/20260805-4.json` it left a valve at 100% that had been perfectly
     * capable of holding its branch. Judged once, at the end, on the state the
     * device actually finished in. */
    /* `parkLost` re-solves after parking, so it yields; `for`, not `forEach`. */
    yield* parkLost();

    /* S4 — RE-SETTLE THE SURVIVORS BEHIND THE PARKING PASS.
     * (Recorded while migrating the `20260805-4` tests, v0.16.4; fixed here.)
     *
     * Parking a lost device at full MOVES THE PLANT. Every survivor settled
     * during the iterations did so against the plant BEFORE that move — so once a
     * device is parked, the others are holding positions they chose against a
     * plant that no longer exists, and the final positions no longer describe
     * the final answer. On `economizer-trim` with ACCH-1 given a capacity it
     * cannot meet, the coil valves park at full and PMP-01 is left 51 kPa off
     * the differential it was holding, because the parking opened four branches
     * out from under it. Michael, WORKLIST S4.
     *
     * So settle the SURVIVORS again against the plant the parked devices now
     * produce. The parked devices are PINNED: they are lost, they belong at
     * full, and re-searching one would only walk it back down and undo the
     * parking. A survivor may itself be driven off setpoint for good by the
     * move — so re-park whatever now finishes lost and go round again, the rest
     * settling behind IT. The lost set only grows (a parked device is never
     * un-parked), so this terminates; `parkRound` bounds it hard for the same
     * reason the iterations are bounded.
     *
     * PARKING STILL HAPPENS ONLY BETWEEN CONVERGED SWEEP-SETS, never mid-iteration
     * — the invariant the 2026-08-05 move out of the loop established. Each
     * round settles the survivors to rest FIRST, then judges parking on the
     * state they actually finished in.
     *
     * ENTERED WHENEVER ANYTHING IS LOST, not only when the parking pass moved
     * an actuator. A lost valve that finished at-max is already at full, so
     * parking it moves nothing — but the survivors may still have settled on an
     * earlier iteration, before it reached full, and are stale against the plant it
     * now holds. One more survivor iteration makes the answer describe itself. */
    var anyLost = searchPairs.some(function (pr) {
      return pr.result && pr.result.lost;
    });
    var parkRound = 0;
    while (anyLost && parkRound < 4 && solves < MAX_SOLVES) {
      parkRound++;
      var reMoving = true, reIteration = 0, reAbandoned = false;
      while (reMoving && reIteration < MAX_ITERATIONS && solves < MAX_SOLVES) {
        reMoving = false; reIteration++;
        for (var ri = 0; ri < searchPairs.length; ri++) {
          var rpair = searchPairs[ri];
          if (rpair.result && rpair.result.lost) continue;   // pinned at full
          curDevice = rpair.act.pipe.tag || rpair.act.pipe.id;
          var rr = yield* settleOnce(rpair);
          rpair.result = rr;
          if (rr.moved) { reMoving = true; acted = true; }
          doneUnits++;
          if (onProgress) {
            var reKeep = onProgress({
              done: doneUnits, total: totalUnits,
              fraction: Math.min(1, doneUnits / totalUnits),
              iteration: iteration, solves: solves,
              device: curDevice
            });
            if (reKeep === false) { reAbandoned = true; reMoving = false; }
          }
          if (reAbandoned) break;
        }
        if (reAbandoned) break;
      }
      curDevice = null;
      /* The survivors would not come to rest either — the iteration never settling
       * is the hunting condition, wherever it happens. */
      if (reMoving) moving = true;
      if (reAbandoned) break;
      /* Park whatever the re-settle pushed over the edge, and go round again so
       * the rest settle behind it. Nothing new lost means the survivors are now
       * consistent with the final lost set — the fixed point, so stop. */
      var newlyParked = yield* parkLost();
      if (!newlyParked) break;
    }

    var ranOut = pairs.some(function (pr) {
      return pr.result && pr.result.state === 'budget';
    });
    if (ranOut) {
      warnings.push({
        code: 'CONTROL_BUDGET',
        message: 'Controls did not stabilize the simulation after ' + solves +
                 ' iterations. Results from the last iteration may be usable. ' +
                 'Check system for conflicting controls, sync equipment to a ' +
                 'single control group, or increase Max Solves in SETTINGS.'
      });
    }
    /* CONTROL_HUNTING is raised AFTER the device report below, so it can say HOW
     * FAR it got — a percentage the engineer can accept or push further, rather
     * than a flat "still moving" (Michael, 2026-08-12). */

    var devices = pairs.map(function (pair) {
      /* A FOLLOWER REPORTS THE GANG'S RESULT, because it is the gang that was
       * searched — but under its OWN pipe and tag, so the panel and the drawing
       * still name the machine in front of you. */
      var lead = pair.ganged || pair;
      var r = lead.result || {};
      var measured = measure(cur, pair);
      var d = {
        pipe: pair.act.pipe.id, tag: pair.act.pipe.tag || null,
        kind: pair.act.kind, quantity: pair.act.quantity,
        equip: pair.equip.id, equipTag: pair.equip.tag || null,
        target: pair.target, setpointOf: pair.mode,
        holding: pair.label || null, holdingKey: pair.key || null,
        fellBack: !!lead.fellBack, lost: !!r.lost,
        /* Who it is modulating with, so the panel can say so. */
        gangedWith: (lead.gang || []).length > 1
          ? lead.gang.map(function (pr) { return pr.act.pipe.tag || pr.act.pipe.id; })
          : null,
        actual: measured,
        /* THE ERROR IS RE-DERIVED FROM WHAT IS ACTUALLY MEASURED, not carried
         * over from the search result.
         *
         * `r.error` is whatever the last probe of that device's search saw. The
         * iteration then moves on and settles OTHER devices, which changes the
         * plant underneath it — so by the time the answer is reported the two
         * can disagree badly. On `20260808-DC-broken` CHWP-01 reported an error
         * of −0.086 K against a measured 32.76 °C on a 30 °C setpoint: the
         * panel said "holding" while the sensor was 2.8 K out. Michael asked to
         * look at the lost setpoints, 2026-08-08, and this is why they did not
         * add up.
         *
         * Measured minus target, from the same `cur` the rest of the row is
         * read from, so the three numbers on the panel can no longer contradict
         * each other. */
        /* THROUGH THE COMPARATOR, like every other error in this loop. Without
         * it a MIN device sitting comfortably above its floor reports the whole
         * surplus as an error, and the state re-judge below then calls a device
         * that is doing exactly what it should `unsettled`. */
        error: (measured === null || measured === undefined)
          ? null : clampErr(pair, measured - pair.target),
        value: pair.act.get(), min: pair.act.min,
        /* `idle` is an internal signal — "at full travel, nothing to do" — and
         * the answer it describes is simply that the setpoint is met. */
        state: (r.state === 'idle') ? 'on' : (r.state || 'on'),
        /* Kept so the reason a device stopped searching is still readable, now
         * that `state` is re-judged from the measurement below. */
        searchState: r.state || null,
        idle: r.state === 'idle'
      };
      /* AND THE STATE FOLLOWS THE MEASUREMENT. A device reported as `on` while
       * its sensor is nearly three kelvin out is the same lie the stale error
       * was — the search finished happily, and then the rest of the iteration moved
       * the plant out from under it. If the final answer is outside the
       * deadband it is not holding, whatever the search concluded. */
      if (d.state === 'on' && d.error !== null &&
          Math.abs(d.error) > Math.max(tolFor(pair), pair.floorErr || 0)) {
        d.state = 'unsettled';
        d.driftedAfterSearch = true;
      }

      var name = d.tag || d.pipe, eqName = d.equipTag || d.equip;
      /* The setpoint may be a temperature or a flow, so the units come from
       * the target rather than being assumed to be kelvin. */
      var isFlow = (pair.mode === 'flow');
      var setTxt = isFlow ? (pair.target * 1000).toFixed(2) + ' L/s'
                 : pair.mode === 'dT' ? pair.target.toFixed(1) + ' K ΔT'
                 : (pair.mode === 'pressure' || pair.mode === 'dPdiff')
                     ? (pair.target / 1000).toFixed(1) + ' kPa'
                 : pair.target.toFixed(1) + ' °C';
      var off = (d.error === null) ? null
        : (isFlow ? Math.abs(d.error * 1000).toFixed(2) + ' L/s'
           : (pair.mode === 'pressure' || pair.mode === 'dPdiff')
               ? Math.abs(d.error / 1000).toFixed(1) + ' kPa'
           : Math.abs(d.error).toFixed(1) + ' K') +
          ' ' + (d.error > 0 ? 'above' : 'below');
      /* Absolute value the machine came to rest at, for CONTROL_UNSETTLED —
       * the setpoint offset by the residual error, in the setpoint's own unit. */
      var settledTxt = (d.error === null) ? setTxt
        : isFlow ? ((pair.target + d.error) * 1000).toFixed(2) + ' L/s'
        : pair.mode === 'dT' ? (pair.target + d.error).toFixed(1) + ' K ΔT'
        : (pair.mode === 'pressure' || pair.mode === 'dPdiff')
            ? ((pair.target + d.error) / 1000).toFixed(1) + ' kPa'
        : (pair.target + d.error).toFixed(1) + ' °C';
      if (d.state === 'at-min') {
        warnings.push({
          code: 'CONTROL_AT_LIMIT', pipe: d.pipe, equip: d.equip,
          message: name + ' is unable to maintain setpoint ' + setTxt +
                   ' at minimum ' + pair.act.quantity + '. Check controls.'
        });
      } else if (d.state === 'at-max') {
        warnings.push({
          code: 'CONTROL_AT_LIMIT', pipe: d.pipe, equip: d.equip,
          message: name + ' is unable to maintain setpoint ' + setTxt +
                   ' at maximum ' + pair.act.quantity + '. Check controls.'
        });
      } else if (d.state === 'unsettled') {
        warnings.push({
          code: 'CONTROL_UNSETTLED', pipe: d.pipe, equip: d.equip,
          message: name + ' is unable to maintain setpoint ' + setTxt +
                   ' (Settled at ' + settledTxt + '). Check setpoint, ' +
                   'equipment capacity or system heat balance.'
        });
      } else if (d.state === 'no-flow') {
        warnings.push({
          code: 'CONTROL_NO_FLOW', pipe: d.pipe, equip: d.equip,
          message: eqName + ' is unable to be controlled as it has no flow.'
        });
      }
      return d;
    });

    /* STILL HUNTING, WITH A METRIC. The iteration never came to rest, so instead of
     * a flat "still moving" it reports how far it got — devices holding their
     * setpoint out of the total, as a percentage. An engineer can then accept,
     * say, 90% while the design is in flux and raise Settling iterations to
     * finish it later, rather than being told only that it did not converge
     * (Michael, 2026-08-12). "Holding" means the final measurement is inside the
     * device's own deadband — the `state === 'on'` the report just re-judged. */
    if (moving) {
      var holding = devices.filter(function (x) { return x.state === 'on'; }).length;
      var totalDev = devices.length;
      var pct = totalDev ? Math.round(holding / totalDev * 100) : 100;
      warnings.push({
        code: 'CONTROL_HUNTING',
        holding: holding, total: totalDev, pct: pct,
        message: 'Controls did not stabilize after ' + iteration + ' iterations. ' +
                 holding + ' of ' + totalDev + ' devices maintaining setpoint. ' +
                 'Results from the last iteration may be usable. Check system ' +
                 'for conflicting controls, sync equipment to a single control ' +
                 'group, or increase Max Solves in SETTINGS.'
      });
    }

    /* THE SETPOINT IS LOST — Michael's wording, 2026-08-04. An ERROR rather
     * than a warning: a system that cannot hold its setpoint anywhere in its
     * actuator's range is not delivering what the model says it delivers, and
     * every number downstream describes an operating point nobody can reach.
     * The cause is almost always the heat balance rather than the control, so
     * the message points there. */
    var lostList = devices.filter(function (x) { return x.lost; });
    if (lostList.length) {
      errors.push({
        code: 'SETPOINT_LOST',
        pipe: lostList[0].pipe, equip: lostList[0].equip,
        message: 'System is unable to maintain setpoint. Check heat balance. (' +
                 lostList.map(function (x) {
                   /* Name what stopped the MACHINE where the thermal pass knows
                    * it — "limited by Design ΔT" is a far more actionable
                    * sentence than "check heat balance" on its own. */
                   var tl = cur.thermal && cur.thermal.links &&
                            cur.thermal.links[x.equip];
                   return (x.tag || x.pipe) + ' → ' + (x.equipTag || x.equip) +
                          (tl && tl.limit ? ', limited by ' + tl.limit : '');
                 }).join('; ') + ' — at full travel and still off setpoint.)'
      });
    }

    return {
      /* Always true once there is anything to control: `cur` is the solve that
       * matches the model as it now stands, and `core` may have been computed
       * with the modulation the previous solve left behind. */
      acted: true, moved: acted,
      errors: errors,
      core: cur,
      warnings: warnings,
      report: { devices: devices, iterations: iteration, solves: solves, tol: tol }
    };
  }

  /* ============================================ WHAT KIND OF PROBLEM IT IS
   *
   * Michael, 2026-08-05: a velocity of 2.5 m/s and two nodes that look joined
   * and are not were listed the same way, and they are not the same kind of
   * thing at all. One is a judgement about the engineering; the other is a
   * drawing that does not mean what it looks like.
   *
   * So there are now THREE levels below an error:
   *
   *   DEFECT   the MODEL is wrong. The solve is valid for what was drawn, but
   *            what was drawn is not what was meant — a node connected to
   *            nothing, equipment at 25× its rating, a control link that holds
   *            nothing. Fix the model and re-run.
   *   WARNING  the answer stands and an engineer should look at it. A velocity
   *            over the limit, a pump past runout, a machine at its capacity.
   *   NOTICE   nothing to do; stated so a number is not a puzzle. A seated
   *            check valve, a pinned thermal datum.
   *
   * A defect does NOT clear `converged` — the arithmetic is sound and hiding
   * the numbers would leave nothing to diagnose from, which is the same rule
   * the plausibility guards follow. It is separated so the two questions an
   * engineer asks ("is my drawing right?" and "is my design right?") stop
   * sharing one list.
   *
   * Anything not named here stays a warning, which is the safe default: a new
   * message is a judgement until someone decides otherwise. */
  var DEFECT_CODES = {
    ZERO_LENGTH: 1, ORPHAN_NODE: 1, RISER_OPEN_END: 1,
    EQUIP_OFF_RATING: 1, NO_CHARACTERISTIC: 1,
    CONTROL_NO_SETPOINT: 1, CONTROL_NO_AUTHORITY: 1, REVERSE_BLOCKED: 1,
    /* "Your drawing does not mean what it looks like" — four pumps drawn as
     * four independent loops are one loop, and Michael wants them redrawn as a
     * lead plus syncs. The answer is still sound (they are ganged), which is
     * why this is a defect and not an error. */
    CONTROL_GANGED: 1, CONTROL_TARGET_GONE: 1, TAG_MANGLED: 1,
    TAG_DUPLICATE: 1,
    /* An equipment rating smaller than its own valve's full-open drop cannot be
     * built. The solve stands (the coil is floored at zero), so it is a defect
     * in the model rather than an error in the physics. */
    ICV_EXCEEDS_PD: 1
  };
  var NOTICE_CODES = {
    CHECK_CLOSED: 1, VALVE_SHUT: 1, THERMAL_DATUM: 1
  };

  /* Stamp a level onto every message that does not already carry one. Done in
   * ONE place, after everything has been collected, so a level cannot depend on
   * which function happened to raise the message. */
  function classify(list) {
    (list || []).forEach(function (w) {
      if (w.level) return;
      w.level = DEFECT_CODES[w.code] ? 'defect'
              : NOTICE_CODES[w.code] ? 'notice' : 'warning';
    });
    return list;
  }

  /* ------------------------------------------- an OVERSIZED control valve
   *
   * A control valve doing all its work in the bottom of its travel is the wrong
   * size. Near the seat a small movement is a large change in Kv, so the loop
   * is twitchy, the position is hard to commission, and the valve wears where
   * it throttles. The rule of thumb an engineer applies is "if it is nearly
   * shut at design, it is too big".
   *
   * NAMED FOR THE FAULT, NOT THE SYMPTOM (renamed 2026-08-05). It was
   * VALVE_AUTHORITY, which shared a word with the control loop's
   * CONTROL_NO_AUTHORITY and meant something unrelated: that one is about a
   * setpoint the actuator cannot move AT ALL, this one about having the
   * movement but spending it in the wrong part of the travel. Two messages that
   * share a word and not a meaning are two messages nobody can keep straight.
   *
   * Applies to control valves only. An isolation valve is meant to be shut or
   * open, and 5% on one is a deliberate crack rather than a selection error. */
  function valveOversizedWarnings(m, res) {
    var out = [];
    var lim = (m.settings.warn && m.settings.warn.valveOversized);
    if (!(lim > 0)) return out;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'valve' || !p.valve || p.valve.type !== 'globe') return;
      var open = Number(p.valve.opening);
      if (!isFinite(open) || open <= 0) return;          // shut is not "throttled"
      if (open >= lim) return;
      var q = res.flow[p.id];
      if (q === undefined || Math.abs(q) < FD.hydraulics.Q_MIN) return;
      out.push({
        code: 'VALVE_OVERSIZED', pipe: p.id, opening: open, limit: lim,
        message: (p.tag || p.id) + ' has insufficient control authority. ' +
                 'Check valve Kv.'
      });
    });
    return out;
  }

  /* -------------------------------------- the pressure plausibility guard
   *
   * The same idea as the thermal runaway guard (§18), for the same reason and
   * with the same teeth: THE SOLVE IS EXACT, BUT A CORRECT ANSWER CAN STILL BE
   * ABSURD, and reporting it as though it were a result is worse than refusing.
   *
   * `debug/20260803-1.json` reported a pump duty of 12 791 m — 1252 bar —
   * because an AHU rated 0.8 L/s was carrying 20 L/s and dropping 125 000 kPa.
   * Every step was right. The model said `converged: true` and offered the
   * number as an answer. v0.11.2 added EQUIP_OFF_RATING beside it, which names
   * the cause; a warning sitting under a plausible-looking figure is still the
   * wrong shape of response to a system that cannot exist.
   *
   * So it is an ERROR: it clears `converged` and takes the status chip, because
   * every number downstream of a 1252 bar pump is describing a system nobody
   * will build. The figures are still reported — the answer is not wrong, it is
   * implausible, and hiding it would leave nothing to diagnose from.
   *
   * The band is ADJUSTABLE and has to be, exactly like the temperature band.
   * The 2000 kPa default is a judgement, not sourced data: building services
   * pipework is PN16 with PN25 on tall risers, so a SINGLE component dropping
   * more than 20 bar is not a building services problem. A fire main or a
   * high-rise booster set may want it raised, and the field is there for that.
   */
  function pressurePlausibility(m, net, res) {
    var out = [];
    var lim = (m.settings.warn && m.settings.warn.maxComponentPD);
    if (!(lim > 0)) return out;
    var rho = net.rho || 998;
    var worst = null;

    function consider(pa, what, id) {
      if (!isFinite(pa) || pa <= lim) return;
      if (!worst || pa > worst.pa) worst = { pa: pa, what: what, id: id };
    }

    net.links.forEach(function (l) {
      if (l._virtual) return;
      /* A SHUT VALVE IS NOT AN IMPLAUSIBLE SYSTEM. `CLOSED_R` is a numerical
       * device for "no path through here", not a claim that the valve is
       * dropping 10^12 metres — a closed isolating valve and a seated check
       * valve are both deliberate, ordinary model states. Reading the sentinel
       * as a pressure would refuse every model with a standby leg in it. */
      if (l.r >= FD.valves.CLOSED_R || l._checkShut) return;
      var q = res.flow[l.id];
      if (q === undefined) return;
      var p = M.pipe(m, l.id);
      var pa = rho * 9.81 * Math.abs(FD.hydraulics.linkLoss(l, q));
      consider(pa, (p && (p.tag || p.id)) || l.id, l.id);
    });

    /* The pump duty as well. Many ordinary components in series can add up to
     * an impossible pump without any one of them tripping the check. */
    m.pipes.forEach(function (p) {
      if (p.kind !== 'pump' || !p.pump || p.pump.mode === 'off') return;
      consider(rho * 9.81 * (p.pump.head || 0), (p.tag || p.id) + ' duty', p.id);
    });

    if (worst) {
      out.push({
        code: 'PRESSURE_IMPLAUSIBLE', pipe: worst.id, pressure: worst.pa,
        limit: lim,
        message: worst.what + ' is at ' + (worst.pa / 1000).toFixed(0) +
                 ' kPa, past the ' + (lim / 1000).toFixed(0) +
                 ' kPa plausibility limit. Check calculation for pressure spikes.'
      });
    }
    return out;
  }

  /* ------------------------------------------ equipment far off its rating
   *
   * Equipment is a fixed characteristic: r = ΔP_rated/(ρg·Q_rated²), so its
   * pressure drop goes as the SQUARE of how far the flow is from the rating.
   * At 25× the rated flow that is 625× the rated drop, and the number stops
   * looking like a plant item and starts looking like a blockage.
   *
   * WHY THIS EXISTS. `debug/20260803-1.json` sized a pump to 12 791 m — 1252
   * bar. Nothing was wrong with the arithmetic: an AHU rated 0.8 L/s at 200 kPa
   * was carrying 20 L/s, which is 125 000 kPa across it and 99.8% of the duty.
   * The AHU's design flow had been rewritten to 0.8 L/s when its ΔT was set
   * (see `M.setEquipTrio`), and nothing anywhere said so. Every warning the app
   * had was about velocity and friction rate in the PIPES.
   *
   * The check is on flow rather than on head, because the flow ratio is the
   * thing an engineer recognises — "this coil is passing 25 times its duty" —
   * and the head follows from it.
   */
  function equipRatingWarnings(m, res) {
    var out = [];
    var lim = (m.settings.warn && m.settings.warn.equipFlowRatio) || 0;
    if (!(lim > 1)) return out;

    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
      var qr = p.equip.qRated || 0;
      if (!(qr > 0)) return;
      var q = Math.abs(res.flow[p.id] || 0);
      if (!(q > FD.hydraulics.Q_MIN)) return;
      var ratio = q / qr;
      if (ratio <= lim && ratio >= 1 / lim) return;
      /* A SOURCE/SINK BELOW ITS RATING IS NORMAL OPERATION, not a defect —
       * plant is routinely selected larger than today's load, and since
       * v0.12.1 the sizer deliberately leaves it at part load. Over-flow is
       * still called out for everything, because that is the square-law trap
       * this check exists for. */
      /* AN ADIABATIC ITEM BELOW ITS RATING IS ALSO NORMAL (Michael,
       * 2026-08-21). A strainer, a filter or a flow meter states a pressure
       * drop at a rated flow; it is pipework, not a load, and it makes no claim
       * about what flow the circuit ought to be carrying. Below rating it is
       * simply dropping less, which is the square law behaving. Over-flow is
       * still reported for everything, because that is the trap this check
       * exists for. */
      if (ratio < 1 && (p.equip.equipType === 'source' ||
                        p.equip.equipType === 'adiabatic')) return;

      var pd = (p.equip.pdRated || 0) * ratio * ratio;
      out.push({
        code: 'EQUIP_OFF_RATING', pipe: p.id, ratio: ratio,
        message: (p.tag || p.id) + ' is rated for ' + (qr * 1000).toFixed(2) +
                 ' L/s but is carrying ' + (q * 1000).toFixed(2) + ' L/s, ' +
                 (ratio >= 1 ? ratio.toFixed(1) + '\u00d7' : '1/' + (1 / ratio).toFixed(1)) +
                 '. Check the design flow, load and rating.'
      });
    });
    return out;
  }

  // -------------------------------------------------- supply-side warnings
  /* Problems with how the system is fed: a pump that cannot pass flow, and
   * demands the source simply cannot reach. */
  function supplyWarnings(m, net, res) {
    var out = [];

    // --- pumps that do nothing ---
    m.pipes.filter(function (p) {
      // an OFF pump carrying no flow is doing exactly what was asked of it
      return p.kind === 'pump' && !(p.pump && p.pump.mode === 'off');
    }).forEach(function (p) {
      var q = res.flow[p.id];
      if (q === undefined || Math.abs(q) > FD.hydraulics.Q_MIN) return;

      /* A pump with a terminal node on one side has no flow path at all —
       * worth saying so explicitly, because "pump does nothing" is otherwise a
       * puzzling result. */
      var deadEnd = [p.a, p.b].filter(function (id) {
        var n = M.node(m, id);
        return n && !n.device && M.pipesAt(m, id).length < 2;
      });

      out.push({
        code: deadEnd.length ? 'PUMP_DEAD_END' : 'PUMP_NO_FLOW',
        pipe: p.id,
        node: deadEnd[0],
        message: deadEnd.length
          ? 'Pump ' + (p.tag || p.id) + ' has no flow (dead end). Check system arrangement.'
          : 'Pump ' + (p.tag || p.id) + ' has no flow. Check system arrangement.'
      });
    });

    // --- demands the supply cannot satisfy ---
    var rho = net.rho || 998;
    var deficient = [];
    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      var p = res.pressure[n.id];
      if (p === undefined) return;
      var short = (n.device.reqPressure || 0) - p;
      if (short > 1) deficient.push({ node: n.id, shortPa: short, available: p });
    });

    if (deficient.length) {
      var sources = m.nodes.filter(function (n) {
        return n.device && n.device.kind === 'source';
      });
      var worst = deficient.reduce(function (a, b) {
        return b.shortPa > a.shortPa ? b : a;
      });
      out.push({
        code: 'SUPPLY_INSUFFICIENT',
        nodes: deficient.map(function (d) { return d.node; }),
        sources: sources.map(function (s) { return s.id; }),
        worstNode: worst.node,
        worstShortPa: worst.shortPa,
        message: 'Insufficient pressure at ' +
                 ((M.node(m, worst.node) || {}).tag || worst.node) + ' (Short by ' +
                 (worst.shortPa / 1000).toFixed(1) + ' kPa). Consider increasing ' +
                 'pipe size or pressure.'
      });
    }

    return out;
  }

  // ---------------------------------------------- pressure-driven delivery
  /* What the system would ACTUALLY deliver.
   *
   * The main solve is demand-driven: every demand takes its stated flow, and
   * an under-supplied network shows that as negative pressure. That is the
   * right number for sizing — it tells you how much head is missing — but it
   * is not physical. Water cannot be drawn from a node that has no pressure to
   * give.
   *
   * So each demand that cannot be met is converted from a fixed FLOW into a
   * fixed HEAD at its required pressure, and the network is re-solved. The
   * flow that then arrives at the node is what the system can really supply.
   * Demands that turn out to be satisfiable are handed back to the
   * demand-driven side, and the two sets are iterated until stable.
   *
   * Returns null when everything is satisfiable (the common case, no cost).
   */
  function actualDelivery(m, net, res) {
    var rho = net.rho || 998;
    var demands = m.nodes.filter(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false;
    });
    if (!demands.length) return null;

    var deficient = {};
    var any = false;
    demands.forEach(function (n) {
      var p = res.pressure[n.id];
      if (p !== undefined && (n.device.reqPressure || 0) - p > 1) {
        deficient[n.id] = true;
        any = true;
      }
    });
    if (!any) return null;

    var byId = {};
    net.nodes.forEach(function (nd) { byId[nd.id] = nd; });

    var lastRes = null, lastNodes = null;

    for (var pass = 0; pass < 8; pass++) {
      var nodes = net.nodes.map(function (nd) {
        var copy = { id: nd.id, z: nd.z, demand: nd.demand, fixedHead: nd.fixedHead };
        if (deficient[nd.id]) {
          var dev = M.node(m, nd.id).device;
          copy.demand = 0;
          // fixed head at the pressure the terminal actually requires
          copy.fixedHead = nd.z + (dev.reqPressure || 0) / (rho * 9.81);
        }
        return copy;
      });

      var r = FD.solver.solve({ nodes: nodes, links: net.links, rho: rho });
      lastRes = r; lastNodes = nodes;

      // Net inflow at each converted node is what the network can deliver.
      var inflow = {};
      Object.keys(deficient).forEach(function (id) { inflow[id] = 0; });
      net.links.forEach(function (l) {
        var q = r.flow[l.id] || 0;
        if (inflow[l.to] !== undefined) inflow[l.to] += q;
        if (inflow[l.from] !== undefined) inflow[l.from] -= q;
      });

      var changed = false;
      demands.forEach(function (n) {
        var nominal = n.device.flow || 0;
        if (deficient[n.id]) {
          // Delivers more than asked for? Then it was satisfiable after all.
          if (inflow[n.id] >= nominal - 1e-12) { delete deficient[n.id]; changed = true; }
        } else if ((n.device.reqPressure || 0) - (r.pressure[n.id] || 0) > 1) {
          deficient[n.id] = true; changed = true;
        }
      });

      if (!changed) break;
    }

    // Final tally, clamping back-flow: a terminal that would need to PUSH water
    // into the network simply delivers nothing.
    var flowByNode = {}, total = 0;
    var inflow2 = {};
    Object.keys(deficient).forEach(function (id) { inflow2[id] = 0; });
    net.links.forEach(function (l) {
      var q = lastRes.flow[l.id] || 0;
      if (inflow2[l.to] !== undefined) inflow2[l.to] += q;
      if (inflow2[l.from] !== undefined) inflow2[l.from] -= q;
    });

    demands.forEach(function (n) {
      var nominal = n.device.flow || 0;
      var got = deficient[n.id] ? Math.max(0, inflow2[n.id]) : nominal;
      flowByNode[n.id] = got;
      total += got;
    });

    return {
      flow: flowByNode,
      linkFlow: lastRes.flow,
      pressure: lastRes.pressure,
      totalDelivered: total,
      totalDemanded: demands.reduce(function (s, n) { return s + (n.device.flow || 0); }, 0),
      unmet: Object.keys(deficient)
    };
  }

  // --------------------------------------------------------- critical path
  /* The critical path — "index circuit" in spec §10 — is the hydraulically
   * most unfavourable route: supply to the terminal that is worst off. It is
   * the path that sets the pump duty, so it is the one an engineer reads
   * first, and it goes at the top of the calculation sheet.
   *
   * "Worst off" is the terminal with the smallest residual (available minus
   * required) — NOT simply the most distant one. A long run in big pipe can
   * easily be better off than a short run in small pipe, and sizing against
   * distance rather than residual is a classic way to undersize a pump.
   *
   * In a closed circuit there are no demands, so the equipment with the
   * largest pressure drop stands in as the index terminal.
   *
   * The path is traced backwards from that terminal, always stepping to the
   * neighbour at HIGHER head — which is where the water came from. That
   * follows the real hydraulic route through loops and rings, rather than
   * guessing at a topological shortest path.
   */
  function criticalPath(m, net, res) {
    if (!net || !res) return null;

    var target = null;
    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      var p = res.pressure[n.id];
      if (p === undefined) return;
      var residual = p - (n.device.reqPressure || 0);
      if (!target || residual < target.residual) {
        target = { node: n.id, residual: residual, kind: 'demand' };
      }
    });

    if (!target) {
      /* CLOSED CIRCUIT — THE INDEX IS THE CIRCUIT THAT BURNS THE MOST HEAD
       * GETTING THERE, which is the one with the LEAST left across its own
       * branch.
       *
       * Michael, 2026-08-25: "take the path of most resistance back to pump (or
       * outflow if no return path)." Right in substance, with one correction
       * that decides whether it works: **the total resistance around every
       * circuit is the SAME**. Kirchhoff — the head changes around any closed
       * loop sum to zero, so for every loop through the pump, friction + static
       * equals the pump head exactly. That identity is asserted in four places
       * in the suite. Ranked by total circuit loss, all fourteen AHUs on the
       * data hall tie, to solver round-off.
       *
       * What differs is how that total is SPLIT. Every circuit spends the pump
       * head on pipework plus its own terminal; the index is the one where the
       * PIPEWORK takes the most, and therefore the one left with the least
       * differential across its branch. It is the same thing Michael is
       * describing, measured somewhere it can actually be told apart — and it
       * is what a commissioning engineer reads off a pair of gauges.
       *
       * WHY NOT `flow / qRated`, which this replaces. It is the right idea in
       * an UNCONTROLLED system: the branch the pump fails to supply is the hard
       * one. But every terminal with a control valve is driven to its setpoint
       * BY ITS OWN CONTROLLER, so in SIMULATION nothing is starved and the
       * metric has nothing left to measure but how close each valve got. On the
       * data hall the whole spread is 0.57% — the valves' one-percent travel
       * resolution — and it picked AHU-4, the LEAST remote of the fourteen
       * (Michael, 2026-08-25: "logic would say the most remote should be
       * AHU-12 or 13"). The new criterion gives AHU-13 in BOTH modes.
       *
       * DESIGN DOES NOT MOVE, and the pump sizer is not orphaned. With the
       * valves at full travel (DS.1) the two criteria rank identically, and
       * `autoSizeForFlow` — which still drives the worst-served ratio to 1 —
       * runs in DESIGN only. So the sheet and the pump still agree about which
       * machine governs, which is what that coupling was for.
       *
       * Plant and adiabatic items are not loads (a chiller's rated flow is a
       * selection figure, a strainer states nothing), so they are considered
       * only when there is nothing else — the same rule `autoSizePumps` uses. */
      var cands = net.links.filter(function (l) {
        return l.kind === 'equip' && res.flow[l.id] !== undefined;
      });
      var loadLinks = cands.filter(function (l) {
        var mp = M.pipe(m, l.id);
        var t = mp && mp.equip && mp.equip.equipType;
        return t !== 'source' && t !== 'adiabatic';
      });
      var pool = loadLinks.length ? loadLinks : cands;

      var worst = null;
      pool.forEach(function (l) {
        /* A BRANCH CARRYING NOTHING IS NOT THE INDEX. Its differential is zero,
         * which would win this comparison outright — an isolated or valved-off
         * coil is not the circuit that governs the pump, it is not a circuit. */
        var q = Math.abs(res.flow[l.id] || 0);
        if (!(q > 1e-9)) return;
        var avail = Math.abs(FD.hydraulics.linkLoss(l, res.flow[l.id]));
        if (!isFinite(avail)) return;
        var mp = M.pipe(m, l.id);
        var rated = (mp && mp.equip) ? Number(mp.equip.qRated) : 0;
        if (!worst || avail < worst.avail) {
          worst = { avail: avail, link: l,
                    ratio: rated > 0 ? q / rated : null };
        }
      });
      if (worst) {
        target = { node: worst.link.to, inlet: worst.link.from, residual: null,
                   kind: 'equipment', link: worst.link.id, served: worst.ratio,
                   /* What is left across the index branch. The rest of the pump
                    * head went into reaching it, which is what makes it the
                    * index. */
                   available: worst.avail };
      }
    }
    /* ---- CHOSEN BY HAND. Overrides the search entirely: the reader has named
     * the two ends, and the job is to report the circuit between them, not to
     * argue about which one governs. Other loads are NOT blocked — whatever is
     * actually on the route the user picked belongs on the tally. */
    var manual = M.criticalManual(m);
    if (manual) {
      target = { node: manual.b, inlet: null, residual: null, kind: 'manual',
                 link: null, served: null, available: null, from: manual.a };
    }

    if (!target) return null;

    /* The path runs back to a FIXED-HEAD node — a source, or the synthetic
     * datum of a closed circuit — not merely to the nearest pump.
     *
     * Stopping at the pump suction leaves the suction-side friction out of the
     * tally, and then friction + static no longer reconciles with the pump
     * duty: on the 3-floor model it came out 38.94 m against a 41.76 m pump,
     * exactly the 2.82 m of pipe upstream of the pump. The pump is simply a
     * link along the path, contributing a head gain rather than terminating
     * it. */
    var origins = {};
    net.nodes.forEach(function (n) {
      if (n.fixedHead !== null && n.fixedHead !== undefined) origins[n.id] = true;
    });
    if (!Object.keys(origins).length) {
      // no fixed head anywhere (shouldn't happen — a datum is pinned) — fall
      // back to pump suctions so the trace still terminates
      net.links.forEach(function (l) { if (l.kind === 'pump') origins[l.from] = true; });
    }

    var adj = {};
    net.links.forEach(function (l) {
      (adj[l.from] = adj[l.from] || []).push(l);
      (adj[l.to] = adj[l.to] || []).push(l);
    });

    /* ONE WALK, RUN TWICE. `up` follows the head gradient UPWARDS, which from a
     * terminal leads back through the plant to the datum — the supply half.
     * `up = false` follows it downwards, which is the direction the water goes
     * — the return half. `block` keeps the return walk from stepping back
     * through the load it just came out of. */
    /* ONE LOAD ON THE PATH, AND ONLY ONE.
     *
     * The walk is greedy on head, and in a headered system every load outlet
     * sits at a similar head — so from the return header the steepest step can
     * be INTO another branch, and the trace then threads a second coil and
     * climbs its supply. On the HighRise it reported five pieces of equipment
     * across 43 sections; on the data centre, four. An index circuit passes
     * through the machine it is the index FOR, once.
     *
     * Plant is not blocked: a primary/secondary system legitimately routes the
     * return through the chiller it shares, and a chiller is not a load. */
    var blockedLinks = {};
    if (target.kind !== 'manual') {
      net.links.forEach(function (l) {
        if (l.kind !== 'equip' || l.id === target.link) return;
        var mp = M.pipe(m, l.id);
        var t = mp && mp.equip && mp.equip.equipType;
        if (t !== 'source' && t !== 'adiabatic') blockedLinks[l.id] = true;
      });
    }

    /* WHERE A CIRCUIT ENDS.
     *
     * An OPEN system ends at a fixed head — a source. A CLOSED circuit has no
     * such thing on its main run: the pinned datum is a bookkeeping node and on
     * a real model it can sit on a dead leg (an expansion connection), which is
     * why the HighRise trace ran past it and dead-ended at N136. Tracing
     * upstream around a closed loop does not terminate on its own — it circles.
     *
     * The pump is the terminator. The circuit is load → return → PUMP → supply
     * → load, so the supply half stops the moment it has come up through a
     * pump, and the return half stops when it arrives back at that pump's
     * suction. That is "the piping back to the pumps" stated as a rule.
     *
     * AND A FIXED HEAD DOES NOT END A CLOSED CIRCUIT — Michael, 2026-08-24:
     * "if the source was located along the critical path, hydraulic calculation
     * stopped at source." The rule above was only half applied. `stopAtPump`
     * was added, but the loop still stopped at ANY fixed head first, so a
     * pressurisation or make-up connection tee'd into the main run cut the
     * trace off wherever it happened to be drawn. It is not a bookkeeping
     * detail: with the source on the load INLET the supply half collapses to
     * the coil alone and the pump vanishes from the path, and with it on the
     * load OUTLET the path comes back EMPTY — friction 0, static 0, and a
     * calculation sheet that reconciles with nothing. On the return leg it is
     * quieter and worse: the path looks complete and simply omits the pipe
     * beyond the tee.
     *
     * So `useOrigins` is OFF for a closed circuit. A source on a closed system
     * sets the pressure; it does not terminate the water. Only an OPEN system
     * — where the water genuinely leaves at a terminal and a fixed head is
     * where it came from — still ends on one. */
    /* AND A GREEDY WALK STILL CANNOT FIND ITS WAY HOME — Michael, 2026-08-24:
     * "the critical path there only seemed to be halfway."
     *
     * `examples/Data Hall & Yard.json` is four cooling-tower trains on a common
     * header. The supply half came up PWP-04's train; the return half, taking
     * the biggest flow at each junction, went back to the plant and into
     * PWP-02's train instead — and stalled on the supply header at N223, where
     * both remaining exits were pipes the supply half had already used. It
     * never reached PWP-04's suction, so the whole return half was discarded
     * and the path stopped at the coil. A valid return route EXISTED the whole
     * time (17 links, ending on P299 into that suction); the walk simply could
     * not go back and take the other branch.
     *
     * That is the §4 trap for the third time — a greedy walk is not a
     * path-finder. Following the flow made it impossible to dead-end in a
     * SINGLE loop, which is what v0.18.11 needed, but a plant with parallel
     * trains has junctions where the biggest branch is not the way home.
     *
     * So the walk BACKTRACKS: depth-first, biggest flow first, unwinding a step
     * when a branch cannot finish. Highest-flow-first means an unobstructed
     * trace takes exactly the route the greedy walk took, so the dominant
     * circuit is still the dominant circuit — the search only does something
     * different where the greedy walk used to give up. `dead` remembers nodes
     * already proven unable to finish, which is what keeps it linear rather
     * than exponential on a meshed model.
     *
     * If nothing finishes, the DEEPEST attempt is returned. The caller already
     * checks where a walk ended, so a trace that cannot close still reports
     * what it found rather than nothing at all. */
    function walk(startNode, up, block, usedLinks, stopAtPump, stopNode, useOrigins) {
      function finished(node, viaLink) {
        if (stopNode) return node === stopNode;
        if (stopAtPump) return !!(viaLink && viaLink.kind === 'pump');
        return !!(useOrigins && origins[node]);
      }
      if (finished(startNode, null)) return { sections: [], end: startNode };

      /* The steps out of a node that the water actually takes, biggest first.
       * `up` wants what FEEDS the node; down wants what it feeds. */
      function options(node, onPath) {
        var list = [];
        (adj[node] || []).forEach(function (l) {
          if (blockedLinks[l.id]) return;
          if (usedLinks && usedLinks[l.id]) return;
          var other = (l.from === node) ? l.to : l.from;
          if (onPath[other]) return;
          var q = res.flow[l.id];
          if (q === undefined) return;
          var leavesNode = (l.from === node) ? (q > 0) : (q < 0);
          if (up === leavesNode) return;
          list.push({ link: l, other: other, score: Math.abs(q) });
        });
        list.sort(function (a, b) { return b.score - a.score; });
        return list;
      }

      var onPath = {}, dead = {}, path = [], deepest = null, guard = 0;
      onPath[startNode] = true;
      /* The return half must not step back through the load it just left. */
      if (block) onPath[block] = true;

      var stack = [{ node: startNode, opts: options(startNode, onPath), i: 0 }];
      while (stack.length && guard++ < 200000) {
        var top = stack[stack.length - 1];
        if (top.i >= top.opts.length) {
          /* Exhausted: this node cannot finish from here. */
          dead[top.node] = true;
          stack.pop();
          var undo = path.pop();
          if (undo) delete onPath[undo.node];
          continue;
        }
        var step = top.opts[top.i++];
        if (dead[step.other]) continue;
        path.push({ link: step.link, from: top.node, to: step.other, node: step.other });
        onPath[step.other] = true;
        if (!deepest || path.length > deepest.length) deepest = path.slice();
        if (finished(step.other, step.link)) { deepest = path.slice(); break; }
        stack.push({ node: step.other, opts: options(step.other, onPath), i: 0 });
      }

      var route = (stack.length && deepest) ? deepest : (deepest || []);
      /* An upstream trace is discovered load-first and reported plant-first. */
      var out = route.map(function (st) {
        return up ? { link: st.link.id, from: st.to, to: st.from }
                  : { link: st.link.id, from: st.from, to: st.to };
      });
      if (up) out.reverse();
      return { sections: out, end: route.length ? route[route.length - 1].node : startNode };
    }

    /* THE SUPPLY HALF: datum → plant → load.
     *
     * A MANUAL path terminates at the node the reader named rather than at the
     * first pump the trace happens to cross — that is the whole point of
     * naming it. */
    var closedCircuit = (target.kind === 'equipment' || target.kind === 'manual');
    var supply = walk(target.node, true, null, null,
                      target.kind === 'equipment',
                      target.kind === 'manual' ? target.from : null,
                      !closedCircuit);
    var sections = supply.sections;
    var cur = supply.end;

    /* THE RETURN HALF — the piece that was missing.
     *
     * Michael, 2026-08-21: "It is not calculating a loop, it seems to end at
     * the equipment... ensure the Simulation includes piping back to the pumps."
     * He is right. The walk terminated the moment it reached the datum, and in
     * a closed circuit the datum IS the pump suction, reached by going UP
     * through the pump — so the pipework carrying the water BACK to the pump
     * was never on the path. On a minimal loop the pump develops 16.97 m
     * (supply 2.81 + coil 11.00 + return 3.16) and the critical path reported
     * 13.81 m: the return side, exactly.
     *
     * Only a closed circuit has one. In an open system the water leaves at the
     * terminal and there is nothing to come back. */
    if (closedCircuit) {
      /* A CIRCUIT DOES NOT USE THE SAME PIPE TWICE. Without this the return
       * half re-traverses the plant the supply half already went through — on
       * the HighRise both halves crossed PMP-2 and WCCH-02, so the reported
       * duty was two pumps for a circuit containing one. Blocking the links the
       * supply half consumed forces a simple circuit, which is what an index
       * circuit is.
       *
       * If the return cannot reach the datum without re-using one of them there
       * is no second half to draw — the supply trace stands on its own, as it
       * does in an open system. */
      var used = {};
      sections.forEach(function (sec) { used[sec.link] = true; });
      var back = walk(target.node, false, target.inlet, used, false, cur, false);
      /* Arriving back at the pump suction is the only acceptance. It used to
       * also accept "ended on a fixed head", which was the pre-`stopAtPump`
       * rule; with the walk no longer stopping at one, that clause can only
       * fire where the trace STALLED to happen to be standing on a source —
       * and splicing a return half that never got home is the truncation this
       * fix exists to remove. */
      if (back.end === cur) {
        sections = sections.concat(back.sections);
      }
    }

    var ids = {};
    sections.forEach(function (sec) { ids[sec.link] = true; });

    var friction = 0, statik = 0, pumpGain = 0;
    sections.forEach(function (sec) {
      var l = net.links.find(function (x) { return x.id === sec.link; });
      if (!l) return;
      if (l.kind === 'pump') pumpGain += (l.head || 0);
      else friction += Math.abs(FD.hydraulics.linkLoss(l, res.flow[l.id]));
      var a = M.node(m, sec.from), b = M.node(m, sec.to);
      if (a && b) statik += M.elevation(m, b) - M.elevation(m, a);
    });

    return {
      target: target.node,
      targetKind: target.kind,
      /* Which load governs, how badly it is served (flow / rated), and the
       * head still available across its own branch — the smallest in the
       * model, which is what selected it. */
      targetLink: target.link || null,
      served: target.served === undefined ? null : target.served,
      available: target.available === undefined ? null : target.available,
      residual: target.residual,
      origin: cur,
      sections: sections,
      linkIds: ids,
      frictionHead: friction,
      staticHead: statik,
      pumpHead: pumpGain
    };
  }

  /* SIMULATION result: what each outflow actually took, against what it was
   * designed for. The gap is the point of the whole exercise — a terminal
   * running over its design flow is stealing from the rest of the system, and
   * is where a balancing valve goes.
   *
   * The throttling needed is reported as the extra resistance that would bring
   * natural flow back to design, expressed as a valve Kv so it can be selected
   * against. */
  /* ---------------------------------------------------------- disconnection
   *
   * Written after a real model came in with zero flow everywhere, converged,
   * and no errors. Nothing was wrong with the hydraulics: the ring main simply
   * was not a ring. Two nodes sat at EXACTLY the same coordinates without being
   * joined, so the drawing looked continuous and the network was not.
   *
   * That failure is invisible on screen and silent in the results, which is the
   * worst combination. This finds it before the solve rather than after.
   */
  function disconnections(m) {
    var issues = [];

    /* Risers are stored as attachments and only become pipes when the network
     * is built. The canvas calls this on every frame WITHOUT building, so a
     * riser that had not yet been materialised looked like a missing link —
     * which reported an island and a pair of coincident nodes at every riser
     * in the model. Materialise first, exactly as build() does. */
    M.riserPipes(m);

    var deg = {};
    m.nodes.forEach(function (n) { deg[n.id] = 0; });
    var adj = {};
    m.pipes.forEach(function (p) {
      if (deg[p.a] === undefined || deg[p.b] === undefined) return;
      deg[p.a]++; deg[p.b]++;
      (adj[p.a] = adj[p.a] || []).push({ to: p.b, pipe: p.id });
      (adj[p.b] = adj[p.b] || []).push({ to: p.a, pipe: p.id });
    });

    /* 1. Coincident but unjoined nodes. The one that actually bites: the
     * drawing shows a continuous run and the model has a gap. */
    var TOL = 0.05;                       // 50 mm — closer than anyone draws
    var connected = {};
    m.pipes.forEach(function (p) {
      connected[p.a + '|' + p.b] = true;
      connected[p.b + '|' + p.a] = true;
    });
    /* Compared in true 3D, not per level. Two nodes at the same plan position on
     * different floors are the normal case at every riser and must not be
     * confused with two nodes genuinely on top of each other. Using the
     * position the model actually resolves — level offset and altitude
     * included — rather than trusting the level field to be comparable. */
    var pts = m.nodes.map(function (n) {
      var w = M.worldXY(m, n);
      return { n: n, x: w.x, y: w.y, z: M.elevation(m, n) };
    });
    (function () {
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var a = pts[i].n, b = pts[j].n;
          if (connected[a.id + '|' + b.id]) continue;
          var d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y,
                             pts[i].z - pts[j].z);
          if (d > TOL) continue;
          issues.push({
            code: 'COINCIDENT_NODES', nodes: [a.id, b.id], distance: d,
            severity: 'error',
            message: (a.tag || a.id) + ' and ' + (b.tag || b.id) +
                     ' are in exactly the same place but are not connected. ' +
                     'Drag them together to join them.'
          });
        }
      }
    })();

    /* 2. Nodes with no pipe at all. */
    m.nodes.forEach(function (n) {
      if (deg[n.id] === 0) {
        issues.push({
          code: 'ORPHAN_NODE', nodes: [n.id], severity: 'warn',
          message: (n.tag || n.id) + ' is disconnected from the network. ' +
                   'Connect it or delete.'
        });
      }
    });

    /* 3. Islands — groups of pipework with no path to the rest. */
    var seen = {}, components = [];
    m.nodes.forEach(function (n) {
      if (seen[n.id] || deg[n.id] === 0) return;
      var stack = [n.id], comp = [];
      seen[n.id] = true;
      while (stack.length) {
        var cur = stack.pop();
        comp.push(cur);
        (adj[cur] || []).forEach(function (e) {
          if (!seen[e.to]) { seen[e.to] = true; stack.push(e.to); }
        });
      }
      components.push(comp);
    });
    if (components.length > 1) {
      components.sort(function (x, y) { return y.length - x.length; });
      components.slice(1).forEach(function (c) {
        /* MARK THE OPEN ENDS, NOT EVERY NODE.
         *
         * Michael, 2026-08-21: after pasting a pump "the disconnect does not
         * show at the end of pipe, but at the pump (not helpful)". Reporting
         * every node in the island put a glyph on both of the pump's own nodes,
         * half a metre apart, so the warning stacked on the device itself and
         * said nothing about where to join it up.
         *
         * The useful place is where the island RUNS OUT — its loose ends, the
         * nodes with one pipe or none. That is where a pipe has to be drawn to.
         * The `nodes` list is also what a message click navigates to, so this
         * takes you to the end that needs connecting.
         *
         * A ring-shaped island has no loose end; then every node is as good as
         * any other and the whole component is reported, as before. */
        var ends = c.filter(function (id) { return (deg[id] || 0) <= 1; });
        issues.push({
          code: 'ISLAND', nodes: ends.length ? ends : c, severity: 'error',
          message: c.length + ' node(s) form a separate island with no pipe ' +
                   'connecting them to the main network. Connect them to the ' +
                   'network or delete.'
        });
      });
    }

    /* 3A. A pipe in the layout must be LEVEL.
     *
     * The rule (Michael, v0.7.8-dev): everything drawn on a level runs
     * horizontally at that level's z, and the only thing that changes height is
     * a riser. `M.pipeLength` therefore reports the plan distance, which is the
     * length an engineer wants off a layout — and will still want once pipe
     * gradients are modelled in v2 or v3.
     *
     * So a plan pipe whose ends sit at different elevations is a defect, and it
     * has to be SAID rather than quietly measured one way or the other. Both
     * readings are wrong for such a pipe: along the slope overstates the run an
     * engineer would take off, and the plan distance understates the friction
     * in a pipe that really is sloped. An error, not a warning.
     *
     * The case that produced this rule is worth keeping: a source's static
     * pressure was stored as the node's elevation, so a 50 m run silently read
     * 54.01 m (debug/20260802-1.json). That storage bug is fixed separately;
     * this is the check that would have caught it in one look. */
    m.pipes.forEach(function (p) {
      if (p.kind === 'riser') return;
      var rise = M.pipeRise(m, p);
      if (Math.abs(rise) < 1e-6) return;
      issues.push({
        code: 'SLOPED_PIPE', pipe: p.id, nodes: [p.a, p.b], severity: 'error',
        rise: rise,
        message: 'Sloped pipes are not supported. Use a riser to change elevation.'
      });
    });

    /* 4. Devices with nowhere for their flow to go.
     *
     * A pump or a chiller only passes flow if what leaves its outlet can get
     * somewhere. In a CLOSED circuit that somewhere is its own inlet, round the
     * loop. In an OPEN system it is a sink — an outflow, or a source acting as
     * a reservoir the water can return to.
     *
     * Checking only for the loop was wrong: it condemned every open system,
     * where a pump legitimately has no return path because the water leaves at
     * the terminal. So the test is reachability to ANY of those, without going
     * back through the device itself. */
    var isSink = {};
    m.nodes.forEach(function (n) {
      if (n.device && (n.device.kind === 'demand' || n.device.kind === 'source')) {
        isSink[n.id] = true;
      }
    });

    m.pipes.forEach(function (p) {
      if (p.kind !== 'pump' && p.kind !== 'equip') return;
      var seen2 = {}, stack = [p.b];
      seen2[p.b] = true;
      var ok2 = isSink[p.b] || false;
      while (stack.length && !ok2) {
        var cur = stack.pop();
        var edges = adj[cur] || [];
        for (var k = 0; k < edges.length; k++) {
          if (edges[k].pipe === p.id) continue;      // not back through itself
          var to = edges[k].to;
          if (to === p.a || isSink[to]) { ok2 = true; break; }
          if (!seen2[to]) { seen2[to] = true; stack.push(to); }
        }
      }
      if (!ok2) {
        issues.push({
          code: 'NO_RETURN_PATH', pipe: p.id, nodes: [p.a, p.b], severity: 'error',
          message: (p.kind === 'pump' ? 'Pump ' : 'Equipment ') + (p.tag || p.id) +
                   ' has no path to return or to outflow.'
        });
      }
    });

    return issues;
  }

  /* ================================================== THE SYSTEM CURVE
   *
   * The head the network demands OF THIS PUMP as a function of the flow through
   * it. Returned as points, for the chart on the calculation sheet.
   *
   * SOLVED, NOT ASSUMED. The textbook shortcut is H = H_op·(Q/Q_op)² — a
   * parabola through the origin and the operating point — and it is only the
   * system curve when there is no static lift, no other pump running, and every
   * loss goes as Q². None of those hold generally: a lift moves the intercept
   * off zero, a second pump changes what this one has to supply, and pipe
   * friction is Q^1.852 under Hazen-Williams. Drawing that parabola and calling
   * it the system would be inventing a curve, which is not what this app does.
   *
   * So each point is a REAL SOLVE. Every operating point lies on the system
   * curve by definition, so sweeping the pump's speed and recording where the
   * network comes to rest traces the system curve exactly — including the
   * static head, the other pumps, and whatever exponent the friction has.
   *
   * Speeds above 1 are a PROBE, not a claim about the pump: the system curve is
   * a property of the pipework and exists at flows this pump cannot reach. Using
   * an over-speeded pump to ask "what head would the network need at that flow"
   * is a numerical device and nothing more.
   *
   * SIMULATION only, because that is the only mode where flow responds to the
   * pump at all (§17C). In DESIGN the demands impose the flow and every one of
   * these solves would return the same point.
   */
  var SYSTEM_SWEEP = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85,
                      0.95, 1.0, 1.1, 1.2, 1.3];

  function systemCurve(m, pipeId, speeds) {
    if (!m || m.settings.calcMode !== 'simulation') return null;
    var p = M.pipe(m, pipeId);
    if (!p || p.kind !== 'pump' || !p.pump || !p.pump.curve) return null;
    if (p.pump.mode === 'off') return null;

    var had = Object.prototype.hasOwnProperty.call(p.pump, 'speed');
    var saved = p.pump.speed;
    /* A control link would fight the speed being imposed here, so the iteration
     * calls solveCore directly — it runs the hydraulics and nothing else. */
    var pts = [];
    function probe(n) {
      p.pump.speed = n;
      var core;
      try { core = solveCore(m, 5); } catch (e) { return; }
      if (!core || !core.res || !core.res.flow) return;
      var q = Math.abs(core.res.flow[pipeId]);
      if (!isFinite(q) || q < FD.hydraulics.Q_MIN) return;
      var h = FD.pumps.head(M.pumpCurve(m, p), q);
      if (!isFinite(h) || h <= 0) return;
      pts.push({ q: q, h: h, speed: n });
    }

    var iteration = speeds || SYSTEM_SWEEP;
    iteration.forEach(probe);

    /* REFINE when the coarse iteration came back thin.
     *
     * Against a STATIC LIFT the pump passes nothing at all until it can raise
     * the head, so most of a linear speed iteration lands on zero flow and is
     * discarded — 25 m of lift left only four points of thirteen. Four points
     * is a polygon, not a curve. So the range that DID work is swept again at
     * full resolution. Nothing is interpolated; every point is still a solve. */
    if (!speeds && pts.length >= 2 && pts.length < 9) {
      var nMin = pts[0].speed, nMax = pts[0].speed;
      pts.forEach(function (pt) {
        if (pt.speed < nMin) nMin = pt.speed;
        if (pt.speed > nMax) nMax = pt.speed;
      });
      var have = {};
      pts.forEach(function (pt) { have[pt.speed.toFixed(4)] = true; });
      for (var i = 0; i <= 12; i++) {
        var n = nMin + (nMax - nMin) * i / 12;
        if (have[n.toFixed(4)]) continue;
        probe(n);
      }
    }
    if (had) p.pump.speed = saved; else delete p.pump.speed;

    pts.sort(function (a, b) { return a.q - b.q; });
    /* Two solves can land on the same flow when the pump is already choked by
     * the system; a repeated abscissa is not a second point. */
    var out = [];
    pts.forEach(function (pt) {
      var last = out[out.length - 1];
      if (last && Math.abs(pt.q - last.q) < 1e-9) return;
      out.push(pt);
    });
    return out.length >= 2 ? out : null;
  }

  function simulationReport(m, net, res) {
    if (m.settings.calcMode !== 'simulation') return null;
    var rho = net.rho || 998;
    var terminals = [];

    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      var vid = '__out_' + n.id;
      var q = Math.abs(res.flow[vid] || 0);
      var qd = n.device.flow || 0;
      var avail = res.pressure[n.id];
      var row = {
        node: n.id, tag: n.tag || null,
        designFlow: qd, actualFlow: q,
        ratio: qd > 0 ? q / qd : null,
        designPressure: n.device.reqPressure || 0,
        actualPressure: avail,
        balanceKv: null
      };

      /* Extra resistance to trim natural flow back to design, as a Kv.
       * Total needed: dP_avail across a terminal passing qd.
       * Terminal alone drops dP_d at qd, so the valve takes the remainder. */
      if (qd > 0 && q > qd * 1.001 && avail > 0) {
        var extraPa = avail - (n.device.reqPressure || 0);
        if (extraPa > 0) {
          var qm3h = qd * 3600;
          row.balanceKv = qm3h / Math.sqrt(extraPa / 1e5);
        }
      }
      terminals.push(row);
    });

    /* Equipment is a terminal too, and in a closed circuit it is usually the
     * ONLY one — the data centre models have no outflow nodes at all. It
     * already carries its own characteristic (qRated at pdRated), so it needs
     * no derivation; it just has to be reported alongside the outflows. */
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip) return;
      var q = Math.abs(res.flow[p.id] || 0);
      var qd = p.equip.qRated || 0;
      var pd = p.equip.pdRated || 0;
      /* Actual dP across the equipment, from the solved flow, not the rating.
       * Equipment is r*Q^2, so it follows the square law away from duty. */
      var link = net.links.filter(function (l) { return l.id === p.id; })[0];
      var actPa = link ? FD.hydraulics.linkLoss(link, q) * rho * 9.81 : null;
      var row = {
        node: p.id, tag: p.tag || null, equipment: true,
        designFlow: qd, actualFlow: q,
        ratio: qd > 0 ? q / qd : null,
        designPressure: pd, actualPressure: actPa,
        balanceKv: null
      };
      if (qd > 0 && q > qd * 1.001) {
        /* Throttling equipment back to rated flow: the surplus head the
         * circuit is delivering has to be burnt in a valve. At rated flow the
         * equipment takes pd, and the rest is the valve's. */
        var availPa = actPa !== null ? actPa * Math.pow(qd / Math.max(q, 1e-12), 2) : null;
        void availPa;
        var extra = (actPa !== null ? actPa : 0) - pd;
        if (extra > 0) row.balanceKv = (qd * 3600) / Math.sqrt(extra / 1e5);
      }
      terminals.push(row);
    });

    var pumps = m.pipes.filter(function (p) { return p.kind === 'pump'; }).map(function (p) {
      var q = Math.abs(res.flow[p.id] || 0);
      /* The curve AS RUN, not as rated. At part speed those are different, and
       * reporting the rated one here would have the sheet and the panel
       * disagreeing with the solver about the same pump. `head`, `maxFlow`,
       * `shutoff` and `beyondCurve` are all statements about the machine as it
       * is running, so they all read this one.
       *
       * `pctOfDesign` does NOT — see below. */
      var curve = M.pumpCurve(m, p);
      /* THE SELECTION, which is the nameplate duty and does not move when a
       * controller changes the speed. */
      var rated = (p.pump && p.pump.curve) || null;
      var ratedQd = rated && rated.Qd > 0 ? rated.Qd
                  : (p.pump && p.pump.qDesign > 0 ? p.pump.qDesign : 0);
      var off = !p.pump || p.pump.mode === 'off';
      var row = { pipe: p.id, tag: p.tag || null, mode: p.pump && p.pump.mode,
                  speed: p.pump ? M.pumpSpeed(m, p) : 1,
                  flow: off ? 0 : q,
                  /* A stopped pump develops no head. Reading its curve at
                   * Q = 0 would report shutoff head, which is what it WOULD
                   * make if it were running — the opposite of the truth. */
                  head: off ? 0 : (curve ? FD.pumps.head(curve, q) : (p.pump.head || 0)),
                  curve: !!curve && !off,
                  maxFlow: null, shutoff: null, pctOfDesign: null, beyondCurve: false };
      if (curve && !off) {
        row.maxFlow = FD.pumps.maxFlow(curve);
        row.shutoff = FD.pumps.shutoffHead(curve);
        /* AGAINST THE RATED DUTY, NOT THE SCALED ONE — the anomaly Michael
         * left open on 2026-08-23: `PUMP_RUNOUT` fired on the app's own
         * `Tutorial 01 - Basics` while the pump was at 99% of design flow and
         * the limit was 120%.
         *
         * It divided by the SCALED curve's Qd. PMP-01 carries 2.3789 L/s
         * against a 2.4001 L/s design — 99.1% — but the control loop had it at
         * 81.3% speed, so the scaled duty point is 0.813 x 2.4001 = 1.9513 L/s
         * and 2.3789 / 1.9513 = 121.9%. The warning was right about the flow it
         * printed and wrong about the percentage beside it.
         *
         * Runout is a statement about the MACHINE against its SELECTION — that
         * is what "check available NPSH or design flow" asks the reader to go
         * and look at, and it is why the threshold is a selection judgement.
         * A pump delivering LESS than its design flow is not in runout, whatever
         * speed it is turning at, so any controlled pump that slowed down used
         * to raise this. `beyondCurve` is the scaled-curve statement and is
         * unchanged: past the end of the curve AS RUN the operating point is
         * one the pump cannot deliver at this speed. */
        row.pctOfDesign = ratedQd > 0 ? q / ratedQd : null;
        /* Past the end of the curve the head would go negative, which no real
         * pump can do — the operating point is outside what this pump can
         * deliver, not a very small head. */
        row.beyondCurve = q > row.maxFlow * 0.999;
      }
      return row;
    });

    /* Runout. Losing a pump in a parallel set does NOT split its flow evenly
     * onto the survivors — they ride out along their own curves to a higher
     * flow and lower head. That is the point of the redundancy, but it is also
     * where a pump leaves its selection: motor loading, NPSHr and efficiency
     * all worsen towards the right of the curve. The threshold is editable
     * because it is a selection judgement, not a physical limit. */
    var runoutPct = (m.settings.warn && m.settings.warn.pumpRunout) || 0;
    if (runoutPct > 0) {
      pumps.forEach(function (pp) {
        if (pp.pctOfDesign === null || pp.mode === 'off') return;
        if (pp.pctOfDesign * 100 <= runoutPct) return;
        res.warnings.push({
          code: 'PUMP_RUNOUT', pipe: pp.pipe,
          pct: pp.pctOfDesign * 100, limit: runoutPct,
          message: 'Pump ' + (pp.tag || pp.pipe) + ' is running at ' +
                   (Math.abs(res.flow[pp.pipe] || 0) * 1000).toFixed(2) + ' L/s, (' +
                   (pp.pctOfDesign * 100).toFixed(1) + '% of design flow). Check ' +
                   'available NPSH or design flow.'
        });
      });
    }

    var totalDesign = terminals.reduce(function (s2, t) { return s2 + t.designFlow; }, 0);
    var totalActual = terminals.reduce(function (s2, t) { return s2 + t.actualFlow; }, 0);

    return { terminals: terminals, pumps: pumps,
             totalDesign: totalDesign, totalActual: totalActual };
  }

  /* Fingerprint of the fitting assignment plus flow directions — if this is
   * unchanged between passes, the two-pass loop has converged. */
  function signature(net, res) {
    return net.links.map(function (l) {
      var q = res.flow[l.id] || 0;
      return l.id + ':' + l._types.join('|') + ':' + (q > 0 ? '+' : q < 0 ? '-' : '0') +
             (l._checkShut ? ':shut' : '');
    }).join(',');
  }

  /* Open or closed, worked out from the model rather than asked for.
   *
   * A system fed by a fixed-head source — tank, mains, anything inexhaustible —
   * is OPEN. A sealed circuit driven round by a pump with no such source is
   * CLOSED; its pressure reference comes from a fill/expansion vessel, which is
   * exactly the NO_SOURCE case the solver already pins a datum for.
   *
   * This is informational only: the solver carries total head, so static lift
   * falls out of the solution either way and nothing downstream branches on it.
   * It is worth showing because it tells the engineer whether the thing they
   * have drawn is the thing they meant to draw.
   */
  function detectSystemType(m) {
    var sources = m.nodes.filter(function (n) {
      return n.device && n.device.kind === 'source';
    }).length;
    var pumps = m.pipes.filter(function (p) {
      return p.kind === 'pump' && !(p.pump && p.pump.mode === 'off');
    }).length;
    var outflows = m.nodes.filter(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false;
    }).length;

    /* A source alone does not make a system OPEN.
     *
     * What distinguishes an open system is that mass actually LEAVES it — there
     * is a terminal drawing water off. A sealed circuit fed by a fill/expansion
     * tank has a source too, but nothing leaves: the tank sets the pressure
     * reference and the pump circulates the same water round. Reporting that as
     * OPEN LOOP was simply wrong, and it is the normal arrangement for a
     * chilled-water circuit with an expansion vessel drawn in.
     *
     * So a pumped system with a source but NO outflow is closed. Without a pump
     * nothing is circulating, so the old reading stands rather than guessing —
     * that is a system still being drawn. */
    if (sources > 0 && outflows === 0 && pumps > 0) {
      return { type: 'closed', sources: sources, pumps: pumps, outflows: 0,
               reason: 'Sealed circuit: ' + pumps + ' pump' + (pumps > 1 ? 's' : '') +
                       ' circulating with no outflow drawing water off. The source ' +
                       'acts as the fill/expansion connection and sets the pressure ' +
                       'reference.' };
    }

    if (sources > 0) {
      return { type: 'open', sources: sources, pumps: pumps, outflows: outflows,
               reason: sources === 1
                 ? 'Fed by a source, so static lift is carried by the system.'
                 : sources + ' sources feed this system.' };
    }
    if (pumps > 0) {
      return { type: 'closed', sources: 0, pumps: pumps,
               reason: 'No source: a sealed circuit driven by ' + pumps + ' pump' +
                       (pumps > 1 ? 's' : '') + '. Add a fill/expansion vessel as a ' +
                       'source to set the pressure reference.' };
    }
    return { type: 'none', sources: 0, pumps: 0,
             reason: 'Nothing drives this system yet — no source and no running pump.' };
  }

  /* Short code describing what a node IS, for drawing annotations:
   *   S source · D demand · P pump · T tee/cross · EL elbow · '' plain end
   * Device role wins over geometry — a source that happens to sit on a corner
   * is still labelled S. */
  function nodeTypeCode(m, nodeId) {
    var n = M.node(m, nodeId);
    if (!n) return '';
    if (n.device && n.device.kind === 'source') return 'S';
    if (n.device && n.device.kind === 'demand') return 'OF';

    var pipes = M.pipesAt(m, nodeId);
    if (pipes.some(function (p) { return p.kind === 'pump'; })) return 'P';
    if (pipes.length >= 3) return 'T';
    if (pipes.length === 2) {
      var dev = deviation(dirFrom(m, pipes[0], nodeId), dirFrom(m, pipes[1], nodeId));
      return FD.fittings.elbowForAngle(dev) ? 'EL' : '';
    }
    return '';
  }

  /* PLUMBING REPORT — the domestic-water "solve", kept entirely OFF the GGA.
   *
   * A plumbing file is never solved by solveCore (the whole point of the
   * discipline split, HANDOVER §2). Its pipe flows come from M.plumbingSizing —
   * downstream fixture units through the diversity curve — not from a
   * simultaneous solve. This assembles a result the rest of the app can consume
   * like a GGA one: signed per-pipe FLOW (so the canvas draws direction arrows),
   * the built NETWORK (so the flow/velocity overlays and per-pipe geometry
   * work), per-pipe FRICTION drop from the SAME friction method the hydronic
   * side uses, and node PRESSURES from a FORWARD pass down the tree (residual
   * pressure at each fixture). build() is used only to resolve geometry, fittings
   * and per-link resistance — it constructs, it does not solve. */
  /* Below this, a pressure difference is arithmetic noise rather than a
   * finding — 1 Pa, a ten-thousandth of a kPa. */
  var PRESSURE_EPS = 1;

  /* PRESSURE THAT IS TOO HIGH IS A FINDING TOO.
   *
   * Michael, 2026-08-19 (20260819-lowrise): "the pipe is over pressurized." He
   * was reading it off the sheet by eye, because nothing said it. With four taps
   * open the booster runs back UP its curve toward shutoff — 308 kPa at 1.26 L/s
   * against a 231 kPa duty — and 200 kPa of mains under it puts 508 kPa into the
   * riser. The arithmetic is right and the SYSTEM is the problem: a fixed-speed
   * booster with no pressure control does exactly this at low draw.
   *
   * So it is reported rather than corrected. The limit is
   * `settings.warn.maxStatic`, editable on the HYDRAULIC tab and defaulting to
   * 552 kPa (80 psi, IPC 604.8's threshold for requiring a pressure-reducing
   * valve). Plumbing only: "static pressure at a fixture" is a defined thing
   * there, and a hydronic circuit is legitimately pressurised well past it. */
  function overPressureWarnings(m, pressure) {
    var out = [];
    if (m.discipline !== 'plumbing') return out;
    var limit = (m.settings.warn && m.settings.warn.maxStatic) || 0;
    if (!(limit > 0)) return out;
    var worst = null;
    m.nodes.forEach(function (n) {
      var p = pressure[n.id];
      if (p === undefined || !isFinite(p)) return;
      if (p <= limit) return;
      if (!worst || p > worst.p) worst = { id: n.id, p: p, tag: n.tag };
      out.push({ node: n.id, _p: p });
    });
    if (!out.length) return [];
    return [{
      code: 'DW_OVER_PRESSURE', node: worst.id, level: 'warning',
      pressure: worst.p, limit: limit, count: out.length,
      message: out.length + ' point' + (out.length === 1 ? '' : 's') +
               ' exceed the ' + Math.round(limit / 1000) + ' kPa static-pressure ' +
               'limit, the highest being ' + (worst.tag || worst.id) + ' at ' +
               Math.round(worst.p / 1000) + ' kPa. A fixed-speed booster runs up ' +
               'its curve as the draw falls, so the worst case is the QUIETEST ' +
               'one. Consider a pressure-reducing valve or a speed-controlled ' +
               'set; the limit is editable on the HYDRAULIC tab.'
    }];
  }

  function plumbingReport(m) {
    var dw = M.plumbingSizing(m);
    if (!dw.ok || !Object.keys(dw.byPipe).length) {
      return { ok: dw.ok, error: dw.error, flow: {}, pressure: {},
               byPipe: dw.byPipe || {}, network: null, plumbing: dw,
               headloss: {}, dpFric: {}, totalFU: dw.totalFU || 0,
               totalFlow: dw.totalFlow || 0, warnings: [],
               errors: dw.error ? [dw.error] : [], iterations: 0 };
    }

    /* Signed flow per pipe: +ve means a→b. `from` is the source-ward end. */
    var flow = {};
    Object.keys(dw.byPipe).forEach(function (id) {
      var s = dw.byPipe[id], p = M.pipe(m, id);
      if (!p) return;
      flow[id] = (p.a === s.from) ? s.flow : -s.flow;
    });

    var net = build(m, { flow: flow });
    var rho = net.rho, g = 9.81;
    var linkById = {};
    net.links.forEach(function (l) { linkById[l.id] = l; });

    /* Friction head loss (m) and pressure drop (Pa) per pipe, at the diversity
     * flow, via the model's own friction method — the same linkLoss the hydronic
     * sheet uses, so nothing is invented here. A PUMP on the tree is not a loss:
     * it ADDS its design head, carried in pumpGain and used by the forward pass
     * below (a booster plumbing system has no pressurised source — the pump is
     * where the head comes from). */
    var headloss = {}, dpFric = {}, pumpGain = {};
    Object.keys(dw.byPipe).forEach(function (id) {
      var pipeObj = M.pipe(m, id);
      if (pipeObj && pipeObj.kind === 'pump' && pipeObj.pump && pipeObj.pump.mode !== 'off') {
        headloss[id] = 0; dpFric[id] = 0;
        pumpGain[id] = rho * g * (pipeObj.pump.head || 0);
        return;
      }
      var l = linkById[id];
      if (!l) return;
      var h = Math.abs(FD.hydraulics.linkLoss(l, flow[id] || 0));
      headloss[id] = h; dpFric[id] = rho * g * h;
    });

    /* Residual pressure: a forward pass down each tree from its source. The
     * source states its own gauge pressure; every pipe drops it by friction and
     * by the static head of any rise. No simultaneous solve — the tree has one
     * path to each fixture, so the accumulation is exact. */
    var pressure = {};
    var fwd = {};
    Object.keys(dw.byPipe).forEach(function (id) {
      var s = dw.byPipe[id];
      (fwd[s.from] = fwd[s.from] || []).push({ pipe: id, to: s.to });
    });
    dw.roots.forEach(function (root) {
      var rn = M.node(m, root);
      pressure[root] = (rn && rn.device && rn.device.pressure) || 0;
      var q = [root], seen = {}; seen[root] = true;
      while (q.length) {
        var u = q.shift();
        (fwd[u] || []).forEach(function (e) {
          if (seen[e.to]) return;
          seen[e.to] = true;
          var un = M.node(m, u), cn = M.node(m, e.to);
          var dz = (cn ? M.elevation(m, cn) : 0) - (un ? M.elevation(m, un) : 0);
          pressure[e.to] = pressure[u] + (pumpGain[e.pipe] || 0) -
                           (dpFric[e.pipe] || 0) - rho * g * dz;
          q.push(e.to);
        });
      }
    });

    /* WARNINGS ARE THE ENGINE'S JOB HERE TOO.
     *
     * This returned `warnings: []` unconditionally until v0.17.15, so a plumbing
     * file could not report a single one: on Michael's own test model
     * (20260818-lowrise) three sections ran over the velocity limit and 83 over
     * the friction-rate limit, and the status chip stayed green with an empty
     * MESSAGES window. The sheet renderer coloured the velocity cells red and
     * nothing else in the app knew — which is precisely the failure this project
     * already fixed once on the hydronic side ("solveModel() reported no
     * warnings for a network running at 12 m/s"). The detection is not
     * re-written here: `flowRegimeWarnings` and `disconnections` are the same
     * functions the GGA path uses, and they are discipline-neutral. */
    var warnings = flowRegimeWarnings(m, net, { flow: flow })
      .concat(overPressureWarnings(m, pressure));
    var errors = [];

    /* A FIXTURE BELOW ITS 604.3 REQUIRED PRESSURE. The delivered residual is
     * the whole point of the forward pass, and nothing was checking it.
     * `computeWarnings` in the app cannot: it compares against the hydronic
     * `device.reqPressure`, which on a plumbing fixture is a placeholder.
     *
     * Only meaningful where there IS a pressure origin — a pressurised source
     * or a running booster pump. With neither, every residual is zero-ish and
     * every fixture would be reported short, which is noise, not a finding. */
    var hasOrigin = m.nodes.some(function (n) {
      return n.device && n.device.kind === 'source' && n.device.pressure > 0;
    }) || m.pipes.some(function (p) {
      return p.kind === 'pump' && p.pump && p.pump.mode !== 'off';
    });
    if (hasOrigin) {
      m.nodes.forEach(function (n) {
        var d = n.device;
        if (!(d && d.kind === 'demand' && d.include !== false)) return;
        if (pressure[n.id] === undefined) return;
        var need = (d.demandType === 'plumbing')
          ? M.plumbingReqPressure(m, d) : (d.reqPressure || 0);
        var short = pressure[n.id] - need;
        /* A TOLERANCE, or an exactly-sized system reports itself short. Size a
         * booster with `plumbingPumpDuty` and the index fixture lands ON its
         * requirement — to within about 3e-11 Pa, which `< 0` duly flagged in
         * red. 1 Pa is the same "close enough" the hydronic pump sizer has
         * always used, and is a ten-thousandth of a kPa. */
        if (short < -PRESSURE_EPS) {
          warnings.push({
            code: 'DW_FIXTURE_SHORT', node: n.id,
            shortfall: -short, required: need, available: pressure[n.id],
            message: 'Insufficient pressure at ' + (n.tag || n.id) +
                     '. Consider increasing pipe size or source pressure.'
          });
        }
      });
    }

    /* A GENERIC OUTFLOW IN A PLUMBING FILE IS ADDED UNDIVERSIFIED, AND SAYS SO.
     *
     * `plumbingSizing` accumulates a non-plumbing demand's `device.flow`
     * LINEARLY on top of the diversified fixture-unit flow, which is the right
     * rule — a continuous draw (a hose bibb left running, cooling make-up, a
     * filter flush) is not a fixture unit and must not be diversified. What was
     * missing is anyone being told it is happening.
     *
     * Michael, 2026-08-18, on 20260818-lowrise: pipe P276 reads 116.9 FU →
     * 2.98 L/s diversified, and a design flow of 3.98. The extra litre is ONE
     * node, N54/OF-2, a generic outflow still sitting at the 1.00 L/s value
     * `setDemand` writes as a default — a quarter of the building's design flow,
     * and a quarter of the booster duty, from a number nobody chose. The flow
     * was right; the silence was the bug. */
    var generics = m.nodes.filter(function (n) {
      var d = n.device;
      return d && d.kind === 'demand' && d.include !== false &&
             d.demandType !== 'plumbing' && (d.flow || 0) > 0;
    });
    if (generics.length) {
      var genTotal = generics.reduce(function (a2, n) { return a2 + n.device.flow; }, 0);
      warnings.push({
        code: 'DW_GENERIC_DEMAND', node: generics[0].id,
        nodes: generics.map(function (n) { return n.id; }),
        total: genTotal, level: 'notice',
        message: 'Generic outflows ' + generics.slice(0, 5).map(function (n) {
                   return (n.tag || n.id);
                 }).join(', ') + (generics.length > 5 ? ', \u2026' : '') +
                 ' add constant ' + (genTotal * 1000).toFixed(2) +
                 ' L/s to the design flow. Dismiss this notification if intentional.'
      });
    }

    /* PIPEWORK THE SIZING NEVER SAW. `plumbingSizing` only walks components
     * that contain a plumbing fixture, so a branch drawn with no fixture on it
     * is absent from `byPipe` — and therefore absent from the calculation sheet
     * entirely, with nothing said. Silently dropping pipework from an issued
     * sheet is the worst version of this. */
    var unsized = m.pipes.filter(function (p) {
      return dw.byPipe[p.id] === undefined && p.kind !== 'riser';
    }).map(function (p) { return p.id; });
    if (unsized.length) {
      warnings.push({
        code: 'DW_UNSIZED', pipe: unsized[0],
        pipes: unsized,
        message: unsized.slice(0, 6).map(function (id) {
                   return (M.pipe(m, id) || {}).tag || id;
                 }).join(', ') + (unsized.length > 6 ? ', \u2026' : '') +
                 ' is not calculated as there are no downstream fixtures. ' +
                 'Dismiss this notification if intentional.'
      });
    }

    /* The same drawing checks the hydronic path runs. A riser ending in mid-air
     * or two nodes on top of each other is a defect in the DRAWING, and the
     * drawing is shared between the disciplines. */
    var dis = disconnections(m);
    dis.forEach(function (dd) {
      if (dd.severity === 'error') {
        errors.push({ code: dd.code, message: dd.message, nodes: dd.nodes, pipe: dd.pipe });
      } else {
        warnings.push(dd);
      }
    });

    return { ok: true, error: null, flow: flow, pressure: pressure, network: net,
             byPipe: dw.byPipe, plumbing: dw, headloss: headloss, dpFric: dpFric,
             totalFU: dw.totalFU, totalFlow: dw.totalFlow,
             disconnections: dis,
             warnings: warnings, errors: errors, iterations: 0 };
  }

  /* ============================ PLUMBING SIMULATION — the model, and REMOTE1
   *
   * `plumbingSimModel` is the K-terminal conversion: every included fixture
   * becomes an ordinary pressure-dependent terminal at its UNDIVERSIFIED 604.3
   * design point, so the UNMODIFIED GGA can push water through it. `openSet`,
   * when given, is the set of fixture nodes left OPEN — everything else is
   * excluded, which is what a closed tap is.
   *
   * It lives here rather than in the panel that used to own it because REMOTE1
   * calls it dozens of times per run and because it is now worth testing. */
  function plumbingSimModel(m, openSet) {
    var sim = JSON.parse(JSON.stringify(m));
    sim.settings.calcMode = 'simulation';
    sim.nodes.forEach(function (n) {
      var d = n.device;
      if (!d || d.kind !== 'demand' || d.demandType !== 'plumbing') return;
      if (openSet && !openSet[n.id]) { d.include = false; return; }   // tap shut
      var q = M.plumbingUndivFlow(m, d);
      if (!(q > 0)) { d.include = false; return; }   // no fixture flow to draw
      d.flow = q;                                     // design flow → sets K
      d.reqPressure = Math.max(M.plumbingReqPressure(m, d), M.MIN_OUTFLOW_PRESSURE);
      d.demandType = 'generic';
    });
    return sim;
  }

  /* THE FIXED-DRAW FORWARD PASS — `plumbingOpenPass` — lived here for one day
   * (v0.17.21) and is removed. Michael, 2026-08-19: "simulated plumbing outflows
   * should still follow K factor equation used for Hydronic! The fundamental
   * Q = K·√P, with K calculated based on design information still stands. It is
   * perfectly normal for a plumbing fixture to discharge more water when
   * overpressurized."
   *
   * He is right. A tap that draws its Table 604.3 flow WHATEVER the pressure
   * makes the simulated flow equal the design flow by construction, which is a
   * model that cannot answer the question a simulation exists to answer. And a
   * forward pass down a tree has nowhere to put a CONTROLLER, so a pump linked
   * to a pressure sensor was ignored rather than failing to hold.
   *
   * SIMULATE is the unmodified GGA on the K-terminal copy above, as it was from
   * v0.17.2 to v0.17.20. It is in the history at v0.18.0 if the fixed-draw case
   * is ever wanted as an option. */

  /* REMOTE1 — the automatic "how many taps can this serve" search — was built
   * here on 2026-08-19 and REMOVED the same day at Michael's request: "revert
   * back to the original method, push forward from pump. The user will need to
   * decide which outflows to turn on/off." Choosing the load case is the
   * engineer's job, not the app's.
   *
   * What it was built on is KEPT and is now the simulation itself:
   * the K-terminal SIMULATE path. The full spec, the reasoning and the numbers
   * are in docs/DW-MODULE.md → "REMOTE1", and the implementation is in the
   * history at v0.17.20, so it can be revived without being re-derived. */

  /* THE DUTY A PLUMBING BOOSTER HAS TO MEET.
   *
   * Pure, and in the engine, so it is pinned by tests rather than living in a
   * panel handler — and so the answer cannot drift from the report it is
   * derived from.
   *
   * The residual pass is EXACTLY LINEAR in pump head: pressure at a node is
   * source + pumpGain − friction − static, and the friction is fixed at the
   * DIVERSITY flow, which does not depend on the head. So the head that brings
   * the worst fixture to exactly its Table 604.3 required pressure is the
   * pump's current head plus that fixture's shortfall — one pass, exact, and it
   * converges from ABOVE as readily as from below (an oversized booster comes
   * down). No iteration, and no GGA: the hydronic sizer solves the model 12
   * times, which in a plumbing file meant the solver seeing every fixture as a
   * 1.00 L/s placeholder demand.
   *
   * Returns { ok, q, h, worstNode, error } with q in m³/s and h in metres.
   * `safetyPct` is applied to the DUTY, not to an increment — there is one pass
   * here, so "10%" means a pump selected 10% above the head the design needs. */
  function plumbingPumpDuty(m, pipeId, rep) {
    rep = rep || plumbingReport(m);
    if (!rep.ok) return { ok: false, error: rep.error, q: null, h: null };
    var p = M.pipe(m, pipeId);
    if (!p || p.kind !== 'pump' || !p.pump) {
      return { ok: false, q: null, h: null,
               error: { code: 'DW_PUMP_MISSING', message: 'Not a pump.' } };
    }
    if (rep.flow[pipeId] === undefined) {
      return { ok: false, q: null, h: null,
               error: { code: 'DW_PUMP_UNSIZED', message:
                 (p.tag || pipeId) + ' is not connected to a demand. Check for disconnects.' } };
    }
    /* WHAT THE PUMP MUST DELIVER — Michael's rule, 2026-08-18:
     *
     *   Q = the UNDIVERSIFIED flow at the most remote outflow
     *     + the DIVERSIFIED flow of (all other fixture units it serves)
     *     + any generic (continuous) draw it serves
     *
     * The index fixture is the one the pump has to satisfy, and it has to
     * satisfy it while it is actually running — at its full Table 604.3 flow,
     * not at its share of a diversified total. Everything behind it is a
     * statistical population and is diversified normally. The generic draw is
     * continuous by definition and is neither diversified nor singled out.
     *
     * This is DIFFERENT from the flow the PIPES are sized on, deliberately: a
     * pipe carries the diversified demand of everything downstream of it, which
     * is the right basis for a pipe and the wrong one for the machine that has
     * to push the index fixture. See docs/DW-MODULE.md → "Booster duty flow".
     *
     * MOST REMOTE = LEAST MARGIN, the same definition the Critical Path uses,
     * so the sheet and the pump agree on which fixture governs. Only fixtures
     * the pump actually serves are considered — its own subtree. */
    var served = {};                      // nodes downstream of the pump
    (function () {
      var kids = {};
      Object.keys(rep.byPipe).forEach(function (id) {
        var sc = rep.byPipe[id];
        (kids[sc.from] = kids[sc.from] || []).push(sc.to);
      });
      var stack = [rep.byPipe[pipeId].to];
      served[rep.byPipe[pipeId].to] = true;
      while (stack.length) {
        var u = stack.pop();
        (kids[u] || []).forEach(function (v) {
          if (served[v]) return;
          served[v] = true; stack.push(v);
        });
      }
    })();

    var worst = null, worstNode = null, worstDev = null;
    m.nodes.forEach(function (n) {
      var dv = n.device;
      if (!(dv && dv.kind === 'demand' && dv.include !== false)) return;
      if (rep.pressure[n.id] === undefined) return;
      var need = (dv.demandType === 'plumbing')
        ? M.plumbingReqPressure(m, dv) : (dv.reqPressure || 0);
      var short = need - rep.pressure[n.id];
      if (worst === null || short > worst) {
        worst = short; worstNode = n.id; worstDev = served[n.id] ? dv : worstDev;
      }
    });
    if (worst === null) {
      return { ok: false, q: null, h: null,
               error: { code: 'DW_PUMP_NO_FIXTURES', message:
                 (p.tag || pipeId) + ' is not connected to a demand. Check for disconnects.' } };
    }

    /* The index fixture among those this pump serves (which on a single-source
     * tree with the booster at the head is every fixture). */
    var idxNode = null, idxMargin = null;
    m.nodes.forEach(function (n) {
      var dv = n.device;
      if (!(dv && dv.kind === 'demand' && dv.include !== false)) return;
      if (!served[n.id] || rep.pressure[n.id] === undefined) return;
      var need = (dv.demandType === 'plumbing')
        ? M.plumbingReqPressure(m, dv) : (dv.reqPressure || 0);
      var margin = rep.pressure[n.id] - need;
      if (idxMargin === null || margin < idxMargin) { idxMargin = margin; idxNode = n; }
    });

    var carried = rep.byPipe[pipeId];               // FU + generic through the pump
    var branchQ = Math.abs(rep.flow[pipeId]);       // what the PIPE is sized for
    var q, ruleQ = null;
    if (idxNode) {
      var idxFU = M.outflowFU(m, idxNode.device);
      var restFU = Math.max(0, carried.fu - idxFU);
      ruleQ = M.plumbingUndivFlow(m, idxNode.device) +
              M.plumbingFuToFlow(m, restFU) +
              (carried.generic || 0);
      /* A FLOOR, added to the rule rather than found in it.
       *
       * At LOW fixture-unit counts the IPC demand curve sits ABOVE the sum of
       * the individual 604.3 flows — four WCs are 8.8 FU → 0.853 L/s off the
       * curve, but 4 × 1.6 gpm = 0.404 L/s at the outlets. So taking the index
       * fixture out of the curve and adding back only its own outlet flow can
       * land BELOW the diversified demand the pipe itself is sized for, and in
       * the degenerate case (one node carrying every fixture on the branch) it
       * removes the entire load. A pump sized to pass less than its own pipe
       * carries is not defensible whatever the rule says, so the duty is never
       * less than the branch's diversified flow.
       *
       * On a real job the rule governs — 20260818-lowrise: 4.054 L/s from the
       * rule against 3.984 L/s from the branch. The floor only bites on small
       * or heavily-grouped branches. Flagged to Michael 2026-08-18; recorded in
       * docs/DW-MODULE.md → "Booster duty flow". */
      q = Math.max(ruleQ, branchQ);
    } else {
      q = branchQ;
    }

    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    var h = (p.pump.head || 0) + worst / (rho * 9.81);
    if (h < 0) h = 0;
    h = h * (1 + (m.settings.pumpSafetyPct || 0) / 100);
    return { ok: true, error: null, q: q, h: h,
             worstNode: worstNode, shortfall: worst,
             indexNode: idxNode ? idxNode.id : null,
             indexFU: idxNode ? M.outflowFU(m, idxNode.device) : 0,
             indexFlow: idxNode ? M.plumbingUndivFlow(m, idxNode.device) : 0,
             servedFU: carried.fu, genericFlow: carried.generic || 0,
             ruleFlow: ruleQ, branchFlow: branchQ, flooredToBranch: ruleQ !== null && branchQ > ruleQ,
             diversifiedFlow: idxNode
               ? M.plumbingFuToFlow(m, Math.max(0, carried.fu - M.outflowFU(m, idxNode.device)))
               : 0 };
  }

  FD.network = {
    build: build,
    plumbingReport: plumbingReport,
    plumbingPumpDuty: plumbingPumpDuty,
    plumbingSimModel: plumbingSimModel,
    nodeTypeCode: nodeTypeCode,
    flowRegimeWarnings: flowRegimeWarnings,
    supplyWarnings: supplyWarnings,
    criticalPath: criticalPath,
    simulationReport: simulationReport,
    disconnections: disconnections,
    detectSystemType: detectSystemType,
    actualDelivery: actualDelivery,
    autoSizePumps: autoSizePumps,
    systemCurve: systemCurve,
    worstShortfall: worstShortfall,
    solveModel: solveModel,
    /* The same solve, yielding once per network solve. The app steps this so
     * the page stays alive; everything else uses `solveModel` above, which
     * drains it. See the note on `solveModelGen`. */
    solveModelGen: solveModelGen,
    sensorReading: sensorReading,
    fittingsAtNode: fittingsAtNode,
    isSymmetricSplit: isSymmetricSplit,
    fittingsByPipe: fittingsByPipe,
    deviation: deviation,
    dirFrom: dirFrom,
    pickRunPair: pickRunPair
  };
})(window.FD = window.FD || {});
