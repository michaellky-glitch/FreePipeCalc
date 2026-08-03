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

    charged.forEach(function (p) {
      var isRun = !bull && (p.id === runPair[0] || p.id === runPair[1]);
      out.push({
        pipe: p.id,
        type: dividing ? (isRun ? 'TRUN_DIV' : 'TBRANCH_DIV')
                       : (isRun ? 'TRUN_CONV' : 'TBRANCH_CONV')
      });
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
        byPipe[p.id].sumK += FD.ktable.k(FD.fittings.ktableType(f.type),
                                         nominal_mm, kSet, m.settings.fittingK);
        byPipe[p.id].types.push(f.type);
      });
    });
    return byPipe;
  }

  // --------------------------------------------------------------- build
  /* Translate the model into the abstract network the solver consumes.
   *
   * `prev` is the previous solve result (or null on the first pass). Both the
   * tee run/branch split and check-valve seating depend on the previous
   * answer — flows for the former, heads for the latter. */
  function build(m, prev, opts) {
    var warnings = [];
    var flows = prev && prev.flow ? prev.flow : null;
    var simulating = (m.settings.calcMode === 'simulation');
    M.riserPipes(m);                       // materialise vertical riser links
    var fits = fittingsByPipe(m, flows, warnings);
    var method = FD.hydraulics.method(m.settings.frictionMethod);
    var s = m.settings;
    var rho = (s.fluid && s.fluid.density) || 998;

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
        link.r = FD.valves.resistance(p.valve.type, p.valve.kv, p.valve.opening);

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

        if (FD.valves.isClosed(p.valve.type, p.valve.opening)) {
          warnings.push({
            code: 'VALVE_SHUT',
            message: 'Valve ' + p.id + ' is shut (0 % open). Any demand behind it cannot be ' +
                     'satisfied, so downstream pressures on this branch are not meaningful.',
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
            message: 'Equipment ' + (p.tag || p.id) + ' is holding against reverse flow. ' +
                     'Check its direction — use the ‹ › button to flip it.',
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
            message: 'Outflow ' + (n.tag || n.id) + ' has no usable design point, so ' +
                     'its resistance cannot be derived. Give it a flow and a required ' +
                     'pressure before simulating.'
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
        warnings.push({ code: 'ZERO_LENGTH', message: 'Pipe has zero length.', pipe: l.id });
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
        message: 'Tee run/branch assignment did not settle in ' + maxPasses +
                 ' passes; the last solution is reported. Flow directions may be ' +
                 'marginal somewhere in the network.'
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

  function solveModel(m, maxPasses) {
    /* 3 is plenty for tee reassignment alone; check valves can need another
     * round or two to seat, so the ceiling is a little higher. */
    maxPasses = maxPasses || 5;

    var core = solveCore(m, maxPasses);

    /* CONTROL: a pump or globe valve that follows a setpoint modulates here,
     * which is the one place in the app where temperature feeds back into the
     * hydraulics. It re-runs the core several times and leaves the settled
     * modulation on the model, so everything below sees a single consistent
     * answer. §17C. */
    var controls = runControls(m, core, maxPasses);
    if (controls.acted) core = controls.core;

    var net = core.net, res = core.res, passes = core.passes, sizing = core.sizing;
    res.controls = controls.report;
    if (controls.warnings.length) {
      res.warnings = (res.warnings || []).concat(controls.warnings);
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

    /* Disconnection is checked on every solve, not just on demand. The model
     * that prompted this returned zero flow with converged:true and no errors —
     * the worst possible failure, because it looks like an answer. */
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
            message: 'Pump curve is required to simulate. If no manufacturer data is ' +
                     'available, please see the TOOLS tab.' +
                     ' (' + (p.tag || p.id) + ')'
          };
        }));
        res.converged = false;
      }
    }
    res.network = net;
    res.passes = passes;
    res.pumpSizing = sizing;
    recordDesignPoint(m, res);

    /* When the network cannot meet its demands, the demand-driven answer above
     * is still the right one to REPORT — the negative pressures are the size
     * of the shortfall. But it is not what would physically happen, so a
     * second pressure-driven pass works out what the system would actually
     * deliver, for display in brackets. */
    res.actual = actualDelivery(m, net, res);
    res.critical = criticalPath(m, net, res);
    res.simulation = simulationReport(m, net, res);
    /* Temperature is transported by the water, so it can only be worked out
     * once the flows are known — and it feeds nothing back, because fluid
     * properties are held at one temperature. Last, and one-way. */
    res.thermal = FD.thermal ? FD.thermal.solve(m, res) : null;
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
      var q = res.flow[p.id];
      if (q === undefined) return;
      p.pump.qDesign = Math.abs(q);
      p.pump.hDesign = p.pump.head || 0;
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
          message: 'Section ' + section + ': velocity ' + v.toFixed(2) +
                   ' m/s exceeds the ' + warn.velocity + ' m/s limit.'
        });
      }

      if (warn.pdm && l._L > 1e-9) {
        var pdm = rho * 9.81 *
                  (Math.abs(FD.hydraulics.headloss(l._rActual, q, l.n)) / l._L);
        if (pdm > warn.pdm) {
          out.push({
            code: 'PDM', pipe: l.id, section: section,
            pdm: pdm, limit: warn.pdm,
            message: 'Section ' + section + ': friction rate ' + pdm.toFixed(0) +
                     ' Pa/m exceeds the ' + warn.pdm + ' Pa/m limit.'
          });
        }
      }

      if (warn.laminar === false) return;

      var Re = FD.hydraulics.reynolds(q, l._d, nu);
      l._Re = Re;

      if (FD.hydraulics.isLaminar(Re)) {
        out.push({
          code: 'LAMINAR',
          pipe: l.id,
          message: 'Section ' + l.from + ' → ' + l.to + ' is in laminar flow (Re ≈ ' +
                   Math.round(Re) + ', below ' + FD.hydraulics.RE_LAMINAR + ')' +
                   (usingHW ? ' — Hazen-Williams is a turbulent correlation and does not ' +
                              'apply here. Use Darcy-Weisbach for this section.' : '.')
        });
      } else if (FD.hydraulics.isTransitional(Re)) {
        out.push({
          code: 'TRANSITIONAL',
          pipe: l.id,
          message: 'Section ' + l.from + ' → ' + l.to + ' is in the transitional range (Re ≈ ' +
                   Math.round(Re) + '). Friction loss here is inherently uncertain.'
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
        message: 'Water source is required. This water source may be a water tank, city ' +
                 'mains or any other inexhaustible supply for open loop systems, or your ' +
                 'top up/expansion tank for closed loop systems.',
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
    var autos = m.pipes.filter(function (p) {
      return p.kind === 'pump' && p.pump && p.pump.mode === 'auto' && !isDeadEnded(m, p);
    });
    if (!autos.length) return { resolved: false, iterations: 0, skipped: true };

    /* No demand nodes at all? Then this is a closed circuit, and the design
     * flow is whatever the equipment is rated for — there is no terminal
     * pressure to aim at. Size on FLOW instead of on pressure. */
    var hasDemand = m.nodes.some(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false;
    });
    var equips = m.pipes.filter(function (p) {
      return p.kind === 'equip' && p.equip && p.equip.qRated > 0;
    });
    if (!hasDemand && equips.length) {
      return autoSizeForFlow(m, res, autos, equips);
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
    var target = Math.max.apply(null, equips.map(function (e) { return e.equip.qRated; }));
    var cur = res, i;

    for (i = 0; i < 25; i++) {
      var q = Math.max.apply(null, equips.map(function (e) {
        return Math.abs(cur.flow[e.id] || 0);
      }));
      if (q > 0 && Math.abs(q - target) / target < 1e-4) break;

      var head;
      if (!(q > FD.hydraulics.Q_MIN)) {
        // standing start — seed from the equipment's rated drop
        head = (equips[0].equip.pdRated || 1e5) / (rho * 9.81) * 1.5;
      } else {
        var ratio = Math.pow(target / q, 1.9);
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
    return { resolved: true, res: cur, iterations: i, mode: 'flow', target: target };
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
    if (p.kind === 'valve' && p.valve) {
      /* A globe valve's opening is a whole percentage — that is what the panel
       * offers and what a real valve is set to — so the search resolution is a
       * percent, not a float. Bisecting past it would be inventing precision
       * the actuator does not have. */
      var lv = Number(cfg.minOpening);
      lv = (isFinite(lv) && lv > 0 && lv < 100) ? lv : CTRL_DEFAULTS.minOpening;
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

  function runControls(m, core, maxPasses) {
    var warnings = [];
    var out = { acted: false, core: core, report: null, warnings: warnings };
    if (!FD.thermal) return out;
    if (m.settings.calcMode !== 'simulation') return out;

    var pairs = [];
    m.pipes.forEach(function (p) {
      var c = M.controlOf(p);
      if (!c) return;
      var eq = M.pipe(m, c.equip);
      if (!eq || eq.kind !== 'equip' || !eq.equip || eq.equip.off) return;
      var act = actuatorFor(m, p);
      if (!act) return;
      var set = Number(eq.equip.tSet);
      if (!isFinite(set)) {
        /* A heat exchanger states a LOAD, not a leaving temperature (§18), so
         * there is no setpoint to hold and nothing to modulate towards. Said
         * out loud, because a drawn control link that does nothing is exactly
         * the surprise the link was added to avoid. */
        warnings.push({
          code: 'CONTROL_NO_SETPOINT', pipe: p.id, equip: eq.id,
          message: (p.tag || p.id) + ' is linked to ' + (eq.tag || eq.id) +
                   ', which states no setpoint, so it has nothing to control to.'
        });
        return;
      }
      pairs.push({ act: act, equip: eq, target: set, result: null });
    });
    if (!pairs.length) {
      return { acted: false, core: core, report: null, warnings: warnings };
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
    var MAX_SOLVES = 60;
    var solves = 0;

    function evaluate() {
      solves++;
      var c = solveCore(m, maxPasses);
      c.thermal = FD.thermal.solve(m, c.res);
      return c;
    }
    function errorOf(c, pair) {
      var l = c.thermal && c.thermal.links && c.thermal.links[pair.equip.id];
      if (!l || !isFinite(l.tOut)) return null;
      return l.tOut - pair.target;
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
      cur = evaluate();
    } else {
      cur = core;
      if (!cur.thermal) cur.thermal = FD.thermal.solve(m, cur.res);
    }

    /* Settle ONE device, holding every other where it is. */
    function seek(pair) {
      var act = pair.act;
      var x0 = act.get();
      var e0 = errorOf(cur, pair);
      if (e0 === null) return { state: 'no-flow', x: x0, error: null, moved: false };
      if (Math.abs(e0) <= tol) return { state: 'on', x: x0, error: e0, moved: false };

      // --- does backing off help? The sign question, answered not assumed.
      var probe = quantise(act, x0 - Math.max(act.step, 0.05));
      if (!(probe < x0 - 1e-12)) {
        return { state: 'at-min', x: x0, error: e0, moved: false };
      }
      act.set(probe);
      var trial = evaluate();
      var e1 = errorOf(trial, pair);
      if (e1 === null || !(Math.abs(e1) < Math.abs(e0) - 1e-12)) {
        /* No better. Put it back — and note that `cur` is still the answer at
         * x0, so restoring the model costs nothing to re-solve. */
        act.set(x0);
        return { state: 'at-max', x: x0, error: e0, moved: false };
      }

      // --- descend until something meets the setpoint, or the floor is reached
      var xPrev = x0, ePrev = e0, x = probe, e = e1, c = trial;
      var met = null, guard = 0;
      while (guard++ < 14 && solves < MAX_SOLVES) {
        if (Math.abs(e) <= EPS) { met = x; cur = c; break; }
        if (x <= act.min + 1e-12) {
          cur = c;
          /* On the floor. Inside the deadband is still "holding setpoint" —
           * it just cannot be held any more tightly than this. */
          return { state: Math.abs(e) <= tol ? 'on' : 'at-min',
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
        c = evaluate();
        e = errorOf(c, pair);
        if (e === null) { cur = c; return { state: 'no-flow', x: x, error: null, moved: true }; }
      }
      if (met === null) {
        cur = c;
        return { state: Math.abs(e) <= tol ? 'on' : 'unsettled',
                 x: x, error: e, moved: true };
      }

      /* --- the answer is the HIGHEST setting that still meets the setpoint.
       * Everything below `met` meets it too — a source/sink that is no longer
       * limited holds its setpoint at any lower flow — but a controller comes
       * to rest where it stops seeing an error, which is the boundary. */
      var a = met, b = xPrev, best = cur;      // a meets it, b does not
      while (b - a > act.step + 1e-12 && solves < MAX_SOLVES) {
        var mid = quantise(act, (a + b) / 2);
        if (!(mid > a + 1e-12) || !(mid < b - 1e-12)) break;
        act.set(mid);
        var mc = evaluate();
        var me = errorOf(mc, pair);
        if (me !== null && Math.abs(me) <= EPS) { a = mid; best = mc; }
        else b = mid;
      }
      act.set(a);
      cur = best;
      return { state: 'on', x: a, error: errorOf(best, pair),
               moved: Math.abs(a - x0) > 1e-9 };
    }

    /* Several controllers are settled in turn and the sweep repeated, because
     * one device's modulation moves every other device's inlet temperature.
     * Two or three sweeps in practice; if it is still moving after that, say so
     * rather than reporting a number that is still travelling. */
    var acted = false, moving = true, sweep = 0;
    while (moving && sweep < 4 && solves < MAX_SOLVES) {
      moving = false; sweep++;
      pairs.forEach(function (pair) {
        var r = seek(pair);
        pair.result = r;
        if (r.moved) { moving = true; acted = true; }
      });
    }
    if (moving) {
      warnings.push({
        code: 'CONTROL_UNSETTLED',
        message: 'The controlled devices were still moving after ' + sweep +
                 ' sweeps. The last answer is reported; check whether two ' +
                 'devices are working against each other on the same setpoint.'
      });
    }

    var devices = pairs.map(function (pair) {
      var r = pair.result || {};
      var l = cur.thermal && cur.thermal.links && cur.thermal.links[pair.equip.id];
      var d = {
        pipe: pair.act.pipe.id, tag: pair.act.pipe.tag || null,
        kind: pair.act.kind, quantity: pair.act.quantity,
        equip: pair.equip.id, equipTag: pair.equip.tag || null,
        target: pair.target,
        actual: l && isFinite(l.tOut) ? l.tOut : null,
        error: r.error === undefined ? null : r.error,
        value: pair.act.get(), min: pair.act.min,
        state: r.state || 'on'
      };
      var name = d.tag || d.pipe, eqName = d.equipTag || d.equip;
      var off = (d.error === null) ? null :
        Math.abs(d.error).toFixed(1) + ' K ' + (d.error > 0 ? 'above' : 'below');
      if (d.state === 'at-min') {
        warnings.push({
          code: 'CONTROL_AT_LIMIT', pipe: d.pipe, equip: d.equip,
          message: name + ' is at its minimum ' + pair.act.quantity + ' (' +
                   pair.act.label(d.value) + ') and ' + eqName + ' is still ' +
                   off + ' its ' + pair.target.toFixed(1) + ' °C setpoint.'
        });
      } else if (d.state === 'at-max') {
        warnings.push({
          code: 'CONTROL_AT_LIMIT', pipe: d.pipe, equip: d.equip,
          message: name + ' is at full ' + pair.act.quantity + ' and ' + eqName +
                   ' is ' + off + ' its ' + pair.target.toFixed(1) +
                   ' °C setpoint — backing off would not bring it closer.'
        });
      } else if (d.state === 'no-flow') {
        warnings.push({
          code: 'CONTROL_NO_FLOW', pipe: d.pipe, equip: d.equip,
          message: eqName + ' carries no flow, so ' + name + ' has nothing to ' +
                   'control to.'
        });
      }
      return d;
    });

    return {
      /* Always true once there is anything to control: `cur` is the solve that
       * matches the model as it now stands, and `core` may have been computed
       * with the modulation the previous solve left behind. */
      acted: true, moved: acted,
      core: cur,
      warnings: warnings,
      report: { devices: devices, sweeps: sweep, solves: solves, tol: tol }
    };
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

      var pd = (p.equip.pdRated || 0) * ratio * ratio;
      out.push({
        code: 'EQUIP_OFF_RATING', pipe: p.id, ratio: ratio,
        message: (p.tag || p.id) + ' is rated for ' + (qr * 1000).toFixed(2) +
                 ' L/s but is carrying ' + (q * 1000).toFixed(2) + ' L/s (' +
                 (ratio >= 1 ? ratio.toFixed(1) + '×' : '1/' + (1 / ratio).toFixed(1)) +
                 ' its rating). Its pressure drop follows the square of that, so ' +
                 'it is ' + (pd / 1000).toFixed(0) + ' kPa against a rated ' +
                 ((p.equip.pdRated || 0) / 1000).toFixed(0) + ' kPa. Check its ' +
                 'design flow, load and ΔT — they are one equation.'
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
          ? 'Pump ' + p.id + ' carries no flow — node ' + deadEnd[0] + ' is a dead end, so ' +
            'nothing can pass through the pump. Connect it to a source or to the rest of ' +
            'the pipework.'
          : 'Pump ' + p.id + ' carries no flow, so it is having no effect on the system.'
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
        message: 'Source is insufficient for outflow (' +
                 (worst.available / 1000).toFixed(1) + ' kPa at ' + worst.node + ', short by ' +
                 (worst.shortPa / 1000).toFixed(1) + ' kPa). ' +
                 deficient.length + ' outflow' + (deficient.length > 1 ? 's' : '') +
                 ' cannot be met as drawn.'
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
      // closed circuit: the heaviest piece of equipment is the index terminal
      var worst = null;
      net.links.forEach(function (l) {
        if (l.kind !== 'equip') return;
        var q = res.flow[l.id];
        if (q === undefined) return;
        var dp = Math.abs(FD.hydraulics.linkLoss(l, q));
        if (!worst || dp > worst.dp) worst = { dp: dp, link: l };
      });
      if (worst) {
        target = { node: worst.link.to, residual: null, kind: 'equipment',
                   link: worst.link.id };
      }
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

    var sections = [], seen = {}, cur = target.node, guard = 0;
    seen[cur] = true;
    while (!origins[cur] && guard++ < 500) {
      var best = null;
      (adj[cur] || []).forEach(function (l) {
        var other = (l.from === cur) ? l.to : l.from;
        if (seen[other]) return;
        var dh = (res.head[other] === undefined || res.head[cur] === undefined)
          ? -Infinity : res.head[other] - res.head[cur];
        if (!best || dh > best.dh) best = { link: l, other: other, dh: dh };
      });
      if (!best) break;
      sections.unshift({ link: best.link.id, from: best.other, to: cur });
      seen[best.other] = true;
      cur = best.other;
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
            message: 'Nodes ' + a.id + ' and ' + b.id + ' are ' +
                     (d < 1e-9 ? 'in exactly the same place' :
                      (d * 1000).toFixed(0) + ' mm apart') +
                     ' but are not joined. The drawing looks continuous; the network is not.'
          });
        }
      }
    })();

    /* 2. Nodes with no pipe at all. */
    m.nodes.forEach(function (n) {
      if (deg[n.id] === 0) {
        issues.push({
          code: 'ORPHAN_NODE', nodes: [n.id], severity: 'warn',
          message: 'Node ' + n.id + ' has no pipe connected to it.'
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
        issues.push({
          code: 'ISLAND', nodes: c, severity: 'error',
          message: c.length + ' node(s) form a separate island with no pipe ' +
                   'connecting them to the main network.'
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
        message: 'Pipe ' + p.id + ' (' + p.a + ' → ' + p.b + ') rises ' +
                 Math.abs(rise).toFixed(3) + ' m between its ends. Pipes in the ' +
                 'layout must be level — use a riser to change height. Its ' +
                 'length is being reported as the horizontal distance.'
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
                   ' has nowhere to discharge: from its outlet (' + p.b + ') there is ' +
                   'no route back to its inlet (' + p.a + '), and no outflow or source ' +
                   'to reach. Nothing can flow through it.'
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
    /* A control link would fight the speed being imposed here, so the sweep
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

    var sweep = speeds || SYSTEM_SWEEP;
    sweep.forEach(probe);

    /* REFINE when the coarse sweep came back thin.
     *
     * Against a STATIC LIFT the pump passes nothing at all until it can raise
     * the head, so most of a linear speed sweep lands on zero flow and is
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
       * disagreeing with the solver about the same pump.
       *
       * `pctOfDesign` follows the scaled duty point deliberately: runout is
       * about where on its own curve a pump is sitting, and at reduced speed
       * that curve is the scaled one. */
      var curve = M.pumpCurve(m, p);
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
        row.pctOfDesign = curve.Qd > 0 ? q / curve.Qd : null;
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
                   (pp.pctOfDesign * 100).toFixed(1) + '% of its design flow, past the ' +
                   runoutPct + '% limit. Check motor loading and NPSH available at this duty.'
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

  FD.network = {
    build: build,
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
    fittingsAtNode: fittingsAtNode,
    isSymmetricSplit: isSymmetricSplit,
    fittingsByPipe: fittingsByPipe,
    deviation: deviation,
    dirFrom: dirFrom,
    pickRunPair: pickRunPair
  };
})(window.FD = window.FD || {});
