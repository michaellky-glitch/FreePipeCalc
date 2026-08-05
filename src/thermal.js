/* FreePipeCalc — thermal module
 *
 * Temperature is transported by the water, so this runs AFTER the hydraulic
 * solve and reads its flows. Nothing here feeds back into the hydraulics:
 * fluid properties are fixed at one temperature (see data/fluids.js), so a
 * warmer pipe does not change its own friction. That is a real simplification
 * and it is recorded in KNOWN-ISSUES rather than hidden.
 *
 * =============================================================== SIGN
 * Michael's convention, and it is about the FLUID, not the room:
 *
 *     Q < 0   heat REMOVED from the fluid   (a chiller, a pipe losing heat)
 *     Q > 0   heat ADDED to the fluid       (a CHW coil picking up room load,
 *                                            a boiler, a pipe gaining heat)
 *
 * So a chilled-water coil is POSITIVE — the water gets warmer — even though
 * the room is being cooled. Everything below follows from that.
 *
 * ======================================================== WHAT IT SOLVES
 * Three things, and they are coupled, which is why it iterates:
 *
 *   1. MIXING at a junction — rule of mixtures, mass-weighted:
 *          T = Σ(ṁᵢ·Tᵢ) / Σ(ṁᵢ)   over the streams ARRIVING
 *      Weighted by mass flow rather than volume because it is energy that
 *      mixes; with one fluid and constant Cp the Cp cancels and this is exact.
 *
 *   2. A PIPE losing or gaining heat to ambient. For constant ambient and a
 *      constant overall coefficient this has a closed form and needs no
 *      stepping along the pipe:
 *          T_out = T_amb + (T_in − T_amb)·exp( −U'·L / (ṁ·Cp) )
 *      U' is the loss per metre per kelvin, from the insulation geometry.
 *
 *   3. EQUIPMENT adding or removing heat, as one of two TYPES — see
 *      `equipOutlet` below and ARCHITECTURE §18. Split on what you know at
 *      design:
 *          SOURCE / SINK   chiller, boiler, tower. State a LEAVING
 *                          TEMPERATURE; duty follows, limited by capacity,
 *                          Design ΔT. (The physical T limit was removed
 *                          on 2026-08-04 — see clampToLimit.)
 *          HEAT EXCHANGER  AHU, FCU, plate HX. State a LOAD; temperature
 *                          follows, limited by Design ΔT and a T limit.
 *      (Until v0.10.3 this was a dT/dQ toggle instead. Both were load-led, so
 *      both became an exchanger; a stated ΔT converts to the duty it means at
 *      the rated flow, and `migrateEquipThermal` does that on load.)
 *
 * Pumps and valves pass temperature straight through — Michael's instruction,
 * 2026-08-02. A pump does put its shaft work into the water, but at typical
 * duties that is hundredths of a kelvin and stating it would imply a precision
 * the rest of this does not have.
 *
 * ================================================== THE REFERENCE TEMPERATURE
 * Something has to be known, or every temperature floats. A source holds its
 * supply temperature. A CLOSED circuit has no source — the same problem the
 * hydraulic solver has with pressure — so one node is pinned, preferring the
 * outlet of whatever removes the most heat, because in a chilled or heating
 * circuit that is the plant and its leaving temperature is the flow
 * temperature an engineer would quote. Reported, never silent.
 */
(function (FD) {
  'use strict';

  var M = FD.model;


  /* Heat loss per metre per kelvin for a pipe, W/(m·K).
   *
   *     R' = ln(r_o/r_i)/(2πk)  +  1/(2π·r_o·h_o)          [K·m/W]
   *          \___insulation___/    \__outside surface___/
   *
   * r_i is the pipe's OUTSIDE radius — insulation sits on the pipe, not in the
   * bore — so this is one of the few places that wants od_mm rather than the
   * bore everything else uses. Getting that wrong understates the surface area
   * by the wall thickness, about 7% on the radius at DN50.
   *
   * The pipe wall itself is left out. Steel is ~50 W/(m·K) against 0.02 for
   * insulation, so its resistance is three orders of magnitude smaller; for
   * plastics it is larger but still small beside any real insulation. It is
   * NOT negligible on an uninsulated plastic pipe, which is noted rather than
   * modelled.
   *
   * With no insulation the first term vanishes and the surface film is the
   * whole resistance. */
  function lossPerMetreK(od_m, thickness_m, k, h_o) {
    if (!(od_m > 0)) return 0;
    /* h = 0 is ADIABATIC, not "unset". A perfect insulator outside the pipe
     * exchanges nothing, and someone typing 0 into the surface coefficient
     * means exactly that. Substituting a default there would quietly reinstate
     * heat exchange the engineer had switched off — and it is the only way to
     * express a genuinely sealed circuit, which is the one case that needs a
     * pinned reference temperature. A negative or missing value still falls
     * back to the default. */
    if (h_o === 0) return 0;
    if (!(h_o > 0)) h_o = 8;
    var r_i = od_m / 2;
    var r_o = r_i + Math.max(0, thickness_m || 0);
    var R = 1 / (2 * Math.PI * r_o * h_o);
    if (thickness_m > 0 && k > 0) {
      R += Math.log(r_o / r_i) / (2 * Math.PI * k);
    }
    return R > 0 ? 1 / R : 0;
  }

  /* Outlet temperature of a length of pipe carrying `mdot` at `tIn`.
   *
   * Exponential, not linear: the driving difference shrinks as the water
   * approaches ambient, and on a long run at low flow a linear model can walk
   * the temperature straight past ambient and out the other side. This form
   * cannot — it approaches ambient and stops, which is what water does. */
  function pipeOutlet(tIn, tAmb, UperM, L, mdot, cp) {
    var C = mdot * cp;
    if (!(C > 0) || !(UperM > 0) || !(L > 0)) return tIn;
    var x = UperM * L / C;
    if (x > 60) return tAmb;                    // fully equilibrated
    return tAmb + (tIn - tAmb) * Math.exp(-x);
  }

  /* Thermal settings, with the defaults filled in. */
  function params(m) {
    var t = (m.settings && m.settings.thermal) || {};
    return {
      ambient: t.ambient !== undefined ? t.ambient : 20,
      k: t.insulationK > 0 ? t.insulationK : 0.02,
      h: (t.surfaceCoeff === 0 || t.surfaceCoeff > 0) ? t.surfaceCoeff : 8,
      supply: t.supplyTemp !== undefined ? t.supplyTemp : 6,
      tMin: t.tempMin !== undefined ? t.tempMin : -50,
      tMax: t.tempMax !== undefined ? t.tempMax : 50
    };
  }

  /* Insulation thickness in metres for a pipe.
   *
   * A pipe's OWN value always wins, INCLUDING zero — a deliberately bare pipe
   * must not silently pick up its schedule's figure. With nothing set it takes
   * the value from its SCHEDULE, which is where insulation now lives
   * (v0.10.1): it is a physical property of the pipe, alongside bore and
   * outside diameter, rather than a separate table keyed on size. */
  function thicknessOf(m, p) {
    if (p.insulation_mm !== undefined && p.insulation_mm !== null &&
        p.insulation_mm !== '') {
      return Math.max(0, Number(p.insulation_mm)) / 1000;
    }
    var nominal = FD.schedules.nominalMm ? FD.schedules.nominalMm(p.size) : 0;
    return FD.schedules.insulationFor(p.schedule, p.size, nominal,
                                      m.settings && m.settings.insulation) / 1000;
  }

  function pipeOD(m, p) {
    var sz = FD.schedules.size(p.schedule, p.size, m.customSchedules);
    /* Fall back to the bore when a schedule carries no outside diameter — a
     * custom schedule is entered as bores only. Understates the surface a
     * little, which understates the loss; better than refusing to run. */
    return ((sz && sz.od_mm) || (sz && sz.id_mm) || 0) / 1000;
  }

  /* Which nodes hold a known temperature, and at what.
   *
   * A source holds its own supply temperature, defaulting to the system flow
   * temperature on the THERMAL tab. With no source at all — a sealed circuit —
   * one node is pinned instead, at the OUTLET of whatever removes the most
   * heat. In a chilled or heating circuit that is the plant, and its leaving
   * temperature is the number an engineer quotes as the flow temperature. */
  function referenceNodes(m, res, prm, coupled) {
    var refs = {}, pinned = null;
    var any = false;
    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'source') return;
      var t = (n.device.temperature !== undefined && n.device.temperature !== null)
        ? Number(n.device.temperature) : prm.supply;
      refs[n.id] = t;
      any = true;
    });
    if (any) return { refs: refs, pinned: null };

    /* AMBIENT IS A REFERENCE, and pinning on top of it would be wrong.
     *
     * Michael's case (2026-08-02): a 100 kW load in a sealed loop with no heat
     * rejection at all. That system is NOT indeterminate — the water heats up
     * until the pipes shed 100 kW to the room, and where it settles is the
     * answer. Pinning a node at the flow temperature would have held it there
     * and reported a loop that never warms, which is the opposite of the truth.
     *
     * So a pin is only needed when nothing else sets a level: no source, AND
     * no pipe exchanging heat with ambient. That is a genuinely adiabatic
     * circuit — a balanced chiller and coil round insulated pipework — where
     * the temperature really can sit anywhere and something has to say where. */
    if (coupled) return { refs: refs, pinned: null, floating: true };

    var best = null, bestQ = 0;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
      if (p.equip.equipType === 'adiabatic') return;      // states no temperature
      var q = Math.abs(statedDuty(m, p, res, 1));   // magnitude only, for ranking
      if (best === null || q > bestQ) { best = p; bestQ = q; }
    });
    if (best) {
      /* The outlet is b: devices pass flow a→b and nothing runs them
       * backwards (ARCHITECTURE §4A). */
      refs[best.b] = prm.supply;
      pinned = { node: best.b, pipe: best.id };
    }
    return { refs: refs, pinned: pinned };
  }

  /* The duty a piece of equipment states, in watts, signed. Used for ranking
   * which machine to pin a datum at, and nothing else — the real duty comes
   * out of `equipOutlet` with its limits applied. */
  function statedDuty(m, p, res, C) {
    var e = p.equip || {};
    if (e.equipType === 'source') return Math.abs(e.qMax || 0);
    if (e.thermalMode === 'dT') return (e.dT || 0) * C;
    return e.duty || 0;                  // watts, signed
  }

  /* ===================================================== EQUIPMENT TYPES
   *
   * Two, split on WHAT YOU KNOW AT DESIGN (Michael, 2026-08-03):
   *
   *   SOURCE / SINK   chiller, boiler, cooling tower.
   *                   You state a LEAVING TEMPERATURE and the machine
   *                   modulates its duty to hold it. Limited by capacity
   *                   (qMax), by the maximum difference it can work across
   *                   (dTMax), and by the temperature it physically cannot
   *                   pass (tLimit — a tower cannot go below wet bulb).
   *
   *   HEAT EXCHANGER  AHU, FCU, plate HX.
   *                   You state a LOAD and the temperature follows. Limited by
   *                   dTMax and tLimit; there is no capacity limit because the
   *                   duty IS the stated quantity.
   *
   * Sign is inferred, never selected: a setpoint below the inlet is cooling.
   * qMax and dTMax are magnitudes.
   *
   * Q_load, ΔT and ṁ are locked by Q = ṁ·Cp·ΔT, so at design the exchanger
   * takes any two and derives the third. The UI does that; the engine only
   * ever sees the duty.
   *
   * Returns { tOut, limit } where `limit` names the binding constraint, or
   * null when the machine is doing what it was asked. That name is the useful
   * output — "CH-01 limited by ΔT_max" is the sentence an engineer wants. */
  function equipOutlet(e, tIn, C) {
    var lim = null;

    /* ADIABATIC — a filter, a strainer, a flow meter. Real pipework with a real
     * pressure drop and no thermal properties at all, so the water leaves as it
     * arrived. Michael, 2026-08-05. It is a TYPE rather than a zero duty
     * because "no thermal behaviour" and "a duty that happens to be zero" are
     * different statements: only the first should hide the thermal fields and
     * refuse to be a control target. */
    if (e.equipType === 'adiabatic') return { tOut: tIn, limit: null };

    function clampToLimit(t, from) {
      /* A machine cannot take the fluid PAST its physical limit — a tower
       * cannot cool below wet bulb, an economizer cannot go below ambient.
       * Applied on whichever side the machine is working from.
       *
       * HEAT EXCHANGERS ONLY since v0.12.2. Michael removed it from source/sink
       * on 2026-08-04 — "let the engineer evaluate". Whether a leaving
       * temperature is physically achievable is a judgement about the selection,
       * and clamping it silently produced an answer that looked achieved. Any
       * `tLimit` left on a source/sink by an older file is ignored rather than
       * deleted, so nothing is lost if it comes back. */
      if (e.equipType === 'source') return t;
      if (e.tLimit === undefined || e.tLimit === null || e.tLimit === '') return t;
      var L = Number(e.tLimit);
      if (!isFinite(L)) return t;
      if (from > L && t < L) { lim = 'T limit'; return L; }
      if (from < L && t > L) { lim = 'T limit'; return L; }
      return t;
    }

    if (e.equipType === 'source') {
      var set = Number(e.tSet);
      if (!isFinite(set)) return { tOut: tIn, limit: null };
      var want = set - tIn;                       // the ΔT it would like
      var got = want;

      var dTMax = Math.abs(Number(e.dTMax));
      if (isFinite(dTMax) && dTMax > 0 && Math.abs(got) > dTMax) {
        got = (got < 0 ? -1 : 1) * dTMax;
        lim = 'Design ΔT';
      }
      /* CAPACITY IS SIGNED (Michael, 2026-08-03), on the same convention as a
       * load: + adds heat to the fluid, − removes it. A chiller has a negative
       * capacity and therefore CANNOT heat, however its setpoint is set.
       *
       * That direction is the point of the sign. A machine asked to work the
       * wrong way delivers nothing rather than quietly reversing — reported as
       * 'Capacity (wrong direction)' so it reads as a data problem, which is
       * what it is. Blank is unlimited in BOTH directions, which is what an
       * unstated capacity has always meant.
       *
       * Older files that carry a positive capacity on a cooling machine will
       * hit that branch rather than cooling silently at the wrong sign — see
       * KNOWN-ISSUES. */
      var qCap = Number(e.qMax);
      if (isFinite(qCap) && qCap !== 0 && C > 0) {
        if (got !== 0 && (got > 0) !== (qCap > 0)) {
          got = 0;
          lim = 'Capacity (wrong direction)';
        } else if (Math.abs(got * C) > Math.abs(qCap)) {
          got = (got < 0 ? -1 : 1) * Math.abs(qCap) / C;
          lim = 'Capacity';
        }
      }
      return { tOut: clampToLimit(tIn + got, tIn), limit: lim };
    }

    /* HEAT EXCHANGER — the load is stated, the temperature follows. */
    var dT = (C > 0) ? (Number(e.duty) || 0) / C : 0;
    var dTx = Math.abs(Number(e.dTMax));
    if (isFinite(dTx) && dTx > 0 && Math.abs(dT) > dTx) {
      dT = (dT < 0 ? -1 : 1) * dTx;
      lim = 'Design ΔT';
    }
    return { tOut: clampToLimit(tIn + dT, tIn), limit: lim };
  }

  /* Solve. Returns null when there is nothing to say — no flow anywhere. */
  function solve(m, res) {
    if (!res || !res.flow) return null;
    var prm = params(m);
    var fluid = FD.fluids.resolve(m.settings);
    var cp = fluid.specificHeat > 0 ? fluid.specificHeat : 4182;
    var rho = fluid.density > 0 ? fluid.density : 998;
    var warnings = [];

    /* Links that actually carry water, with their direction resolved from the
     * solved flow. Everything downstream keys off this. */
    var carriers = [];
    m.pipes.forEach(function (p) {
      var q = res.flow[p.id];
      if (q === undefined || !isFinite(q)) return;
      if (Math.abs(q) < FD.hydraulics.Q_MIN) return;
      var from = q > 0 ? p.a : p.b;
      var to = q > 0 ? p.b : p.a;
      carriers.push({ pipe: p, q: Math.abs(q), from: from, to: to,
                      mdot: rho * Math.abs(q) });
    });
    if (!carriers.length) return null;

    /* Does anything tie this system to ambient? Computed before the reference
     * is chosen, because it decides whether one is needed at all. */
    var coupled = carriers.some(function (c) {
      var p = c.pipe;
      if (p.kind !== 'pipe' && p.kind !== 'riser') return false;
      return M.pipeLength(m, p) > 0 &&
             lossPerMetreK(pipeOD(m, p), thicknessOf(m, p), prm.k, prm.h) > 0;
    });

    var ref = referenceNodes(m, res, prm, coupled);
    if (ref.pinned) {
      warnings.push({
        code: 'THERMAL_DATUM', node: ref.pinned.node, pipe: ref.pinned.pipe,
        message: 'No source, so there is no stated supply temperature. ' +
                 (prm.supply).toFixed(1) + ' °C has been pinned at the outlet of ' +
                 ref.pinned.pipe + ', the equipment moving the most heat. Every ' +
                 'other temperature is relative to that.'
      });
    } else if (!Object.keys(ref.refs).length) {
      warnings.push({
        code: 'NO_THERMAL_REFERENCE',
        message: 'Nothing sets a temperature: no source and no equipment. ' +
                 'Temperatures are all at the system flow temperature.'
      });
    }

    // ---- per-link thermal constants, computed once ----
    carriers.forEach(function (c) {
      var p = c.pipe;
      if (p.kind === 'pipe' || p.kind === 'riser') {
        c.L = M.pipeLength(m, p);
        c.UperM = lossPerMetreK(pipeOD(m, p), thicknessOf(m, p), prm.k, prm.h);
      }
      c.C = c.mdot * cp;                 // capacity rate, W/K
    });

    var inTo = {};
    carriers.forEach(function (c) { (inTo[c.to] = inTo[c.to] || []).push(c); });

    // ---- seed ----
    /* Seed. A FLOATING system — no source, no pin, finding its own level
     * against ambient — starts AT ambient, because that is the answer with no
     * load at all and it is the nearest starting point to any answer with one.
     * Seeding it at the flow temperature instead just means more passes. */
    var seed = ref.floating ? prm.ambient : prm.supply;
    var T = {};
    m.nodes.forEach(function (n) {
      T[n.id] = (ref.refs[n.id] !== undefined) ? ref.refs[n.id] : seed;
    });

    /* Outlet temperature of one link, given its inlet. */
    function outletOf(c, tIn) {
      var p = c.pipe;
      if (p.kind === 'pipe' || p.kind === 'riser') {
        return pipeOutlet(tIn, prm.ambient, c.UperM, c.L, c.mdot, cp);
      }
      if (p.kind === 'equip' && p.equip && !p.equip.off &&
          p.equip.equipType !== 'adiabatic') {
        return equipOutlet(p.equip, tIn, c.C).tOut;
      }
      /* Pumps, valves, SENSORS, isolated equipment: straight through. A
       * thermometer that changed the reading would not be one. */
      return tIn;
    }

    /* ---- SOLVE, do not iterate ----------------------------------------
     *
     * Every relation here is AFFINE in temperature:
     *
     *   mixing      T = Σ(ṁᵢTᵢ)/Σṁ                        linear
     *   pipe        T_out = T_amb + (T_in − T_amb)·e^(−x)  affine, e^(−x) fixed
     *   equipment   T_out = T_in + ΔT   or   T_in + Q/C    affine
     *
     * so the whole network is one linear system, A·T = b, and it can be solved
     * exactly in one pass. It used to be swept Gauss-Seidel until the
     * temperatures stopped moving, which worked but converged at a rate set by
     * how strongly the loop is tied to ambient — fine on a system with a
     * source, hopeless on Michael's case of a 100 kW load in a lagged loop with
     * no heat rejection, where 200 passes still left the energy balance 69 kW
     * out. That is not a tolerance to tune: it is the wrong method for a linear
     * problem.
     *
     * Solving it also retires the question "did it converge?", which for a
     * linear system was never a physical question in the first place. */
    var ids = m.nodes.map(function (n) { return n.id; });
    var index = {};
    ids.forEach(function (id, i) { index[id] = i; });
    var N = ids.length;

    /* Row per node. `outletCoef` gives the affine pair for one link, so the
     * matrix is assembled from exactly the same relations the report uses. */
    function outletCoef(c) {
      var p = c.pipe;
      if (p.kind === 'pipe' || p.kind === 'riser') {
        var C2 = c.mdot * cp;
        if (!(C2 > 0) || !(c.UperM > 0) || !(c.L > 0)) return { a: 1, b: 0 };
        var x = c.UperM * c.L / C2;
        if (x > 60) return { a: 0, b: prm.ambient };      // fully equilibrated
        var e = Math.exp(-x);
        return { a: e, b: prm.ambient * (1 - e) };
      }
      if (p.kind === 'equip' && p.equip && !p.equip.off &&
          p.equip.equipType !== 'adiabatic') {
        /* Piecewise linear: which branch applies depends on the inlet
         * temperature, which is what the solve is for. The ACTIVE SET is
         * frozen for this pass — `c.active` — and the outer loop below
         * re-solves until it stops changing. Freezing it is the whole trick,
         * and it is the same lesson check-valve seating taught (ARCHITECTURE
         * §6): decide from a stable quantity, not from the answer you are
         * computing, or it oscillates. */
        var eq = p.equip;
        var act = c.active;
        if (act === 'setpoint') return { a: 0, b: Number(eq.tSet) };
        if (act === 'tlimit') return { a: 0, b: Number(eq.tLimit) };
        if (act === 'dtmax') return { a: 1, b: c.activeDT };
        if (act === 'capacity') return { a: 1, b: c.activeDT };
        /* Load-led with nothing binding: a constant duty. */
        return { a: 1, b: (c.C > 0 ? (Number(eq.duty) || 0) / c.C : 0) };
      }
      return { a: 1, b: 0 };                         // pump, valve, sensor
    }

    /* ---- ACTIVE SET -----------------------------------------------------
     *
     * A clamp makes the system piecewise linear: which branch of an equipment
     * relation applies depends on its inlet temperature, which is what the
     * solve produces. So the active set is FROZEN, the (now linear) system is
     * solved exactly, the set is recomputed from the answer, and it repeats
     * until nothing changes.
     *
     * This is the same shape of problem as check-valve seating, and it carries
     * the same trap (ARCHITECTURE §6): decide from a STABLE quantity, not from
     * the answer being computed. Here the deciding quantity is the inlet
     * temperature, which the previous pass fixes — so a pass cannot flip a
     * limit on the strength of a duty it is itself producing. It settles in
     * two or three passes; the cap exists so a pathological model reports
     * rather than hangs. */
    /* ---- NODES WITH NO FLOW ARRIVING -----------------------------------
     *
     * A dead leg, a shut branch, a standby pump behind a closed valve. Nothing
     * carries a temperature TO them, so the mixing relation has nothing to say
     * and the row needs filling some other way.
     *
     * It used to be filled with the SEED — the source water temperature — which
     * is what Michael saw as "the temperature is resetting at the source and
     * dead-end pipes" (2026-08-05). A dead leg is not at the supply
     * temperature; it is at the temperature of the water it is connected to,
     * because that is the water that is in it.
     *
     * So each such node is tied to a neighbour that DOES have a temperature:
     *
     *     T_dead − T_neighbour = 0
     *
     * still linear, and still exact. His own statement of the rule: "if one end
     * is a tee with flow in another direction, use the temperature of the other
     * end."
     *
     * The neighbour is found by breadth-first search OUTWARD FROM THE LIVE
     * NODES, so every dead node points at something nearer the live water than
     * itself. That ordering is what keeps the system non-singular: two dead
     * nodes pointing at each other would be `T1 − T2 = 0` twice over, which has
     * no unique solution. A node with no path to any live water at all — a
     * completely isolated island — still falls back to the seed, because there
     * genuinely is nothing else to say about it. */
    function deadLegParents() {
      var live = {}, parent = {}, queue = [];
      ids.forEach(function (id) {
        var arriving = inTo[id];
        var den = 0;
        if (arriving) arriving.forEach(function (c) { den += c.mdot; });
        if (ref.refs[id] !== undefined || (arriving && arriving.length && den > 0)) {
          live[id] = true;
          queue.push(id);
        }
      });
      /* Adjacency over EVERY pipe, carrying flow or not — a dead leg is
       * connected by pipework even when no water moves in it. */
      var adj = {};
      m.pipes.forEach(function (p) {
        if (!adj[p.a]) adj[p.a] = [];
        if (!adj[p.b]) adj[p.b] = [];
        adj[p.a].push(p.b);
        adj[p.b].push(p.a);
      });
      for (var qi = 0; qi < queue.length; qi++) {
        var here = queue[qi];
        (adj[here] || []).forEach(function (nb) {
          if (live[nb] || parent[nb] !== undefined) return;
          parent[nb] = here;
          queue.push(nb);
        });
      }
      return parent;
    }
    var deadParent = deadLegParents();

    function assembleAndSolve() {
      var A = [], bvec = [];
      for (var r = 0; r < N; r++) {
        A.push(new Array(N).fill(0));
        bvec.push(0);
      }
      ids.forEach(function (id, i) {
        if (ref.refs[id] !== undefined) {
          A[i][i] = 1; bvec[i] = ref.refs[id];
          return;
        }
        var arriving = inTo[id];
        var den = 0;
        if (arriving) arriving.forEach(function (c) { den += c.mdot; });

        if (!arriving || !arriving.length || !(den > 0)) {
          /* No flow arriving: take the temperature of the water this node is
           * connected to, not the seed. */
          var par = deadParent[id];
          if (par !== undefined && index[par] !== undefined) {
            A[i][i] = 1;
            A[i][index[par]] = -1;
            bvec[i] = 0;
          } else {
            A[i][i] = 1; bvec[i] = seed;      // a genuinely isolated island
          }
          return;
        }

        A[i][i] = 1;
        arriving.forEach(function (c) {
          var co = outletCoef(c);
          var w = c.mdot / den;
          A[i][index[c.from]] -= w * co.a;
          bvec[i] += w * co.b;
        });
      });
      return FD.solver.solveLinear(A, bvec);
    }

    /* Which branch each equipment link is on, from the inlet temperature the
     * last pass produced. Returns a fingerprint so a repeat can be detected. */
    function refreshActiveSet() {
      var sig = [];
      carriers.forEach(function (c) {
        var p = c.pipe;
        if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
        if (p.equip.equipType === 'adiabatic') return;
        var e = p.equip;
        var tIn = T[c.from];
        var r2 = equipOutlet(e, tIn, c.C);
        c.activeDT = r2.tOut - tIn;
        c.limit = r2.limit;
        if (e.equipType === 'source') {
          c.active = r2.limit === 'T limit' ? 'tlimit'
                   : r2.limit === 'Design ΔT' ? 'dtmax'
                   : r2.limit === 'Capacity' ? 'capacity'
                   : 'setpoint';
        } else {
          c.active = r2.limit === 'T limit' ? 'tlimit'
                   : r2.limit === 'Design ΔT' ? 'dtmax'
                   : null;
        }
        sig.push(c.pipe.id + ':' + c.active);
      });
      return sig.join('|');
    }

    var MAX_SETS = 30;
    var solved = null, singular = false, sig = refreshActiveSet(), passes = 0;
    for (var pass = 0; pass < MAX_SETS; pass++) {
      passes = pass + 1;
      solved = assembleAndSolve();
      if (!solved) { singular = true; break; }
      ids.forEach(function (id, i) {
        if (isFinite(solved[i])) T[id] = solved[i];
      });
      var next = refreshActiveSet();
      if (next === sig) break;
      sig = next;
    }
    if (!singular && passes >= MAX_SETS) {
      warnings.push({
        code: 'THERMAL_LIMIT_OSCILLATION',
        message: 'Which equipment limit binds kept changing over ' + MAX_SETS +
                 ' passes. The last answer is reported; check for two machines ' +
                 'fighting for the same setpoint.'
      });
    }
    if (singular) {
      warnings.push({
        code: 'THERMAL_SINGULAR',
        message: 'The temperature field has no unique solution: nothing sets a ' +
                 'level and nothing ties the system to ambient. Give a source a ' +
                 'temperature, or let the pipework exchange heat with the room.'
      });
    }
    var converged = !singular;
    var iterations = passes;

    // ---- report per link ----
    var links = {};
    var limited = [];
    var pipeLoss = 0, equipDuty = 0;
    carriers.forEach(function (c) {
      var tIn = T[c.from];
      var tOut = outletOf(c, tIn);
      /* Q from the temperatures actually reported, not from what was asked
       * for. In dT mode they are the same by construction; in dQ mode they are
       * the same too — but reconstructing it here means the reported duty and
       * the reported temperatures can never disagree. */
      var qW = c.C * (tOut - tIn);
      links[c.pipe.id] = {
        kind: c.pipe.kind, tIn: tIn, tOut: tOut, dT: tOut - tIn,
        qW: qW, mdot: c.mdot, C: c.C,
        UperM: c.UperM, length: c.L,
        /* Which constraint stopped it doing what it was asked, or null. This
         * is the useful output of the whole limit machinery: "CH-01 limited by
         * Design ΔT" beats an unexplained leaving temperature. */
        limit: (c.limit === undefined ? null : c.limit)
      };
      if (c.limit) {
        limited.push({ pipe: c.pipe.id, tag: c.pipe.tag || null, limit: c.limit });
      }
      if (c.pipe.kind === 'pipe' || c.pipe.kind === 'riser') pipeLoss += qW;
      else if (c.pipe.kind === 'equip') equipDuty += qW;
    });

    /* ---- ENERGY CARRIED ACROSS THE BOUNDARY -----------------------------
     *
     * An OPEN system does not balance on link duties alone, and it should not:
     * water enters at a source and leaves at an outflow, carrying energy with
     * it. On the stacked-riser example the coils add 6.12 kW and the pipework
     * 0.18 kW, and every watt of it walks out of the demand node — reporting
     * that as an unbalanced answer would be wrong twice over.
     *
     * At every node, the mass arriving through pipes and the mass leaving
     * through pipes differ by whatever crossed the boundary there. The NET
     * energy that carries is
     *
     *     Σ(ṁ_out·Cp·T_out) − Σ(ṁ_in·Cp·T_in)
     *
     * which is independent of the temperature datum, because mass is conserved
     * and the two sums use the same Cp — an arbitrary offset in T cancels. Only
     * the DIFFERENCE means anything, which is why it is reported as one figure
     * rather than two.
     *
     * For a closed circuit there are no boundary nodes and this is exactly
     * zero, so `imbalance` keeps its old meaning there and every closed-system
     * expectation is untouched. */
    var boundary = 0, sourceDuty = 0;
    (function () {
      var arrive = {}, leave = {};
      carriers.forEach(function (c) {
        arrive[c.to] = (arrive[c.to] || 0) + c.mdot;
        leave[c.from] = (leave[c.from] || 0) + c.mdot;
      });
      Object.keys(T).forEach(function (id) {
        var net = (arrive[id] || 0) - (leave[id] || 0);   // + = leaving the system
        if (Math.abs(net) > 1e-12 && isFinite(T[id])) boundary += net * cp * T[id];
      });

      /* ---- HEAT ADDED OR REMOVED AT A REFERENCE NODE
       *
       * A source HOLDS its stated temperature whatever arrives, which means it
       * is a heat source in its own right: an infinite reservoir does not warm
       * up. The energy involved is the flow through it times the difference
       * between what it holds and what it would otherwise have mixed to, and it
       * belongs in the balance like any other duty.
       *
       * On the stacked-riser example this is where a 6.3 kW residual came from
       * and what it means: with the coils adding 150.2 kW and the chiller only
       * removing 143.9, the fill connection is quietly absorbing the shortfall.
       * That is a real statement about the design — the plant is 6.3 kW short —
       * and reporting it as an unbalanced answer would have hidden it. */
      Object.keys(ref.refs).forEach(function (id) {
        var arriving = inTo[id];
        if (!arriving || !arriving.length) return;
        var den = 0, mixed = 0;
        arriving.forEach(function (c) { den += c.mdot; });
        if (!(den > 0)) return;
        arriving.forEach(function (c) {
          mixed += (c.mdot / den) * outletOf(c, T[c.from]);
        });
        if (!isFinite(mixed) || !isFinite(T[id])) return;
        sourceDuty += den * cp * (T[id] - mixed);
      });
    })();

    var temps = Object.keys(T).map(function (k) { return T[k]; })
      .filter(function (v) { return isFinite(v); });

    /* RUNAWAY GUARD (Michael, 2026-08-02).
     *
     * The solve is exact, so nothing "runs away" numerically — but a correct
     * answer can still be an absurd one. A 100 kW load in a well-lagged loop
     * with no heat rejection genuinely does settle at a ridiculous
     * temperature, and that is a statement about the DESIGN, not about the
     * arithmetic. Reporting 400 °C as though it were a result would be worse
     * than refusing.
     *
     * An ERROR rather than a warning, because every number downstream of it is
     * conditional on a system that cannot exist. The band is adjustable: what
     * counts as absurd depends on the service, and the default ±50 °C suits
     * chilled water rather than LTHW. */
    limited.forEach(function (L) {
      warnings.push({
        code: 'EQUIP_LIMITED', pipe: L.pipe, limit: L.limit,
        message: (L.tag || L.pipe) + ' is limited by ' + L.limit +
                 ' and is not reaching its setpoint.'
      });
    });

    var errors = [];
    var outside = [];
    Object.keys(T).forEach(function (id) {
      var v = T[id];
      if (!isFinite(v)) return;
      if (v < prm.tMin || v > prm.tMax) outside.push({ node: id, t: v });
    });
    if (outside.length) {
      outside.sort(function (a, b) {
        return Math.abs(b.t - prm.ambient) - Math.abs(a.t - prm.ambient);
      });
      var worst = outside[0];
      errors.push({
        code: 'THERMAL_LIMIT', node: worst.node, temperature: worst.t,
        message: 'Temperature at ' + worst.node + ' solves to ' +
                 worst.t.toFixed(1) + ' °C, outside the plausible band ' +
                 prm.tMin.toFixed(0) + ' to ' + prm.tMax.toFixed(0) + ' °C' +
                 (outside.length > 1 ? ' (' + outside.length + ' nodes are outside it)' : '') +
                 '. The heat going in has nowhere to go: check the equipment ' +
                 'duty, the insulation and whether anything rejects heat. Widen ' +
                 'the band on the THERMAL tab if this system really does run ' +
                 'that hot or cold.'
      });
    }

    return {
      temperature: T,
      links: links,
      floating: !!ref.floating,
      limited: limited,
      /* At steady state everything put in has to come out. For a floating
       * system this IS the convergence criterion in physical terms, and it is
       * worth reporting: a residual that is not near zero means the iteration
       * has not finished, whatever the temperature tolerance said. */
      imbalance: pipeLoss + equipDuty,
      /* Net energy the water carries OUT across the system boundary. Zero for
       * a closed circuit. */
      boundary: boundary,
      /* Heat added (+) or removed (−) at a reference node, because a source
       * holds its temperature whatever arrives. */
      sourceDuty: sourceDuty,
      /* What is left once BOTH are accounted for. THIS is the figure that is
       * zero at steady state whatever the system is — `imbalance` is kept
       * beside it because every closed-system expectation in the suite reads
       * it, and for a sealed circuit the two are the same number. */
      residual: pipeLoss + equipDuty + sourceDuty - boundary,
      fluid: fluid,
      ambient: prm.ambient,
      pinned: ref.pinned,
      converged: converged && !errors.length,
      iterations: iterations,
      warnings: warnings,
      errors: errors,
      outside: outside,
      totals: {
        pipeLoss: pipeLoss,          // W, signed — negative when losing heat
        equipDuty: equipDuty,        // W, signed
        min: temps.length ? Math.min.apply(null, temps) : null,
        max: temps.length ? Math.max.apply(null, temps) : null
      }
    };
  }

  FD.thermal = {
    solve: solve,
    lossPerMetreK: lossPerMetreK,
    pipeOutlet: pipeOutlet,
    params: params,
    thicknessOf: thicknessOf,
    pipeOD: pipeOD
  };
})(window.FD = window.FD || {});
