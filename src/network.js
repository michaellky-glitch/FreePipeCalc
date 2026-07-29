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

    // --- tee (3 pipes) or cross (4+) ---
    if (pipes.length > 3 && warnings) {
      warnings.push({
        code: 'CROSS',
        message: pipes.length + ' pipes meet at one node — modelled as two tee branches.',
        node: nodeId
      });
    }

    var runPair = pickRunPair(m, nodeId, pipes, flows);

    pipes.forEach(function (p) {
      if (!isDownstream(p)) return;            // EL belongs to the downstream leg only
      var isRun = (p.id === runPair[0] || p.id === runPair[1]);
      out.push({ pipe: p.id, type: isRun ? 'TRUN' : 'TBRANCH' });
    });
    return out;
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
    m.pipes.forEach(function (p) { byPipe[p.id] = { el: 0, types: [] }; });

    m.nodes.forEach(function (n) {
      fittingsAtNode(m, n.id, flows, warnings).forEach(function (f) {
        var p = M.pipe(m, f.pipe);
        if (!p || !byPipe[p.id]) return;
        var bore_mm = M.pipeBore(m, p) * 1000;
        byPipe[p.id].el += FD.fittings.el(f.type, bore_mm, m.settings.fittingLD);
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
  function build(m, prev) {
    var warnings = [];
    var flows = prev && prev.flow ? prev.flow : null;
    var simulating = (m.settings.calcMode === 'simulation');
    M.riserPipes(m);                       // materialise vertical riser links
    var fits = fittingsByPipe(m, flows, warnings);
    var method = FD.hydraulics.method(m.settings.frictionMethod);
    var s = m.settings;
    var rho = (s.fluid && s.fluid.density) || 998;

    /* Context handed to the loss model: editable coefficients, fluid
     * properties, roughness, and (for Darcy) the previous pass's flow so the
     * friction factor can be refreshed. */
    function ctxFor(p, q) {
      return {
        hw: s.hw,
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
        // Infinite reservoir at 0 gauge, at its own altitude (spec §8.1)
        fixedHead = z;
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
         * the system — that IS the operating point, for the whole network. */
        link.kind = 'pump';
        link.curve = p.pump.curve;
        link.head = FD.pumps.head(p.pump.curve, flows ? (flows[p.id] || 0) : 0);
      } else if (p.kind === 'pump' && p.pump && p.pump.mode === 'off') {
        /* An OFF pump is isolated, not an open pipe.
         *
         * Modelling it as zero head leaves a frictionless path straight through
         * the casing, and in a parallel pump set the running pump then
         * short-circuits backwards through its idle neighbours — the test model
         * pushed 392 L/s round the pump hall to deliver 21 L/s to the load.
         * A standby pump in reality sits behind a closed isolating valve or a
         * check valve, so it is modelled as blocked. */
        link.kind = 'valve';
        link.n = 2;
        link.r = FD.valves.CLOSED_R;
        link._pumpOff = true;
      } else if (p.kind === 'pump' && p.pump) {
        link.kind = 'pump';
        link.head = p.pump.head || 0;
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
      } else if (p.kind === 'equip' && p.equip) {
        link.kind = 'equip';
        link.n = 2;
        link.r = FD.hydraulics.equipmentR(p.equip.pdRated || 0, p.equip.qRated || 0, rho);
      } else {
        link.r = method.r(L + el, d, p.C, ctx);
      }

      // Cached for the calculation sheet — not read by the solver.
      link._L = L;
      link._el = el;
      link._Leff = L + el;
      link._d = d;
      link._rActual = (link.kind === 'pipe') ? method.r(L, d, p.C, ctx) : 0;
      link._types = fits[p.id] ? fits[p.id].types : [];
      link._rho = rho;
      return link;
    });

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

    return { nodes: nodes, links: links, warnings: warnings, rho: rho };
  }

  // --------------------------------------------------------------- solve
  /* Two-pass solve (spec §3.3): the tee run/branch split depends on flow
   * direction, but flow direction is an output of the solve. Solve with a
   * geometric guess, reassign the fittings from the solved directions, solve
   * again. Converges in one or two passes; if the assignment keeps flipping we
   * keep the last result and warn rather than looping forever.
   */
  function solveModel(m, maxPasses) {
    /* 3 is plenty for tee reassignment alone; check valves can need another
     * round or two to seat, so the ceiling is a little higher. */
    maxPasses = maxPasses || 5;
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

    res.warnings = (res.warnings || []).concat(net.warnings || []);
    res.warnings = res.warnings.concat(flowRegimeWarnings(m, net, res));
    res.warnings = res.warnings.concat(supplyWarnings(m, net, res));

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

    /* When the network cannot meet its demands, the demand-driven answer above
     * is still the right one to REPORT — the negative pressures are the size
     * of the shortfall. But it is not what would physically happen, so a
     * second pressure-driven pass works out what the system would actually
     * deliver, for display in brackets. */
    res.actual = actualDelivery(m, net, res);
    res.critical = criticalPath(m, net, res);
    res.simulation = simulationReport(m, net, res);
    return res;
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
    var usingHW = (m.settings.frictionMethod || 'HW') === 'HW';

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
        var dp = Math.abs(FD.hydraulics.headloss(l.r, q, l.n));
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
      else friction += Math.abs(FD.hydraulics.headloss(l.r, res.flow[l.id], l.n));
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
      var actPa = link ? FD.hydraulics.headloss(link.r, q, link.n) * rho * 9.81 : null;
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
      var curve = p.pump && p.pump.curve;
      var off = !p.pump || p.pump.mode === 'off';
      var row = { pipe: p.id, tag: p.tag || null, mode: p.pump && p.pump.mode,
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

    if (sources > 0) {
      return { type: 'open', sources: sources, pumps: pumps,
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
    detectSystemType: detectSystemType,
    actualDelivery: actualDelivery,
    autoSizePumps: autoSizePumps,
    worstShortfall: worstShortfall,
    solveModel: solveModel,
    fittingsAtNode: fittingsAtNode,
    fittingsByPipe: fittingsByPipe,
    deviation: deviation,
    dirFrom: dirFrom,
    pickRunPair: pickRunPair
  };
})(window.FD = window.FD || {});
