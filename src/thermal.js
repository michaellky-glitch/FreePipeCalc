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
 *   3. EQUIPMENT adding or removing heat, in one of two modes. The SAME
 *      toggle serves DESIGN and SIMULATION, which is worth knowing because it
 *      looked like two features:
 *          dT mode — ΔT is the stated quantity.  Q = ṁ·Cp·ΔT follows.
 *                    In SIMULATION this is the coil under perfect control:
 *                    ΔT held, duty floats with flow.
 *          dQ mode — Q is the stated quantity.   ΔT = Q/(ṁ·Cp) follows.
 *                    In SIMULATION this is a fixed load — IT equipment, a
 *                    process, an electric heater: duty held, ΔT floats.
 *      Those two are not arbitrary. They are the asymptotes of the real
 *      effectiveness model, Q = ṁCp(T_in−T_sec)(1−e^(−UA/ṁCp)): at high flow
 *      it tends to constant duty, at low flow to constant ΔT. So they bracket
 *      the truth, and each is exact for a real class of plant.
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

  var MAX_ITER = 200;
  var TOL_K = 1e-9;

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
      h: t.surfaceCoeff > 0 ? t.surfaceCoeff : 8,
      supply: t.supplyTemp !== undefined ? t.supplyTemp : 6
    };
  }

  /* Insulation thickness in metres for a pipe: its own value if set, else the
   * default for its nominal size. */
  function thicknessOf(m, p) {
    if (p.insulation_mm !== undefined && p.insulation_mm !== null &&
        p.insulation_mm !== '') {
      return Math.max(0, Number(p.insulation_mm)) / 1000;
    }
    var t = (m.settings && m.settings.thermal) || {};
    var nominal = FD.schedules.nominalMm ? FD.schedules.nominalMm(p.size) : 0;
    return FD.insulation.defaultThickness(nominal, t.insulationSet) / 1000;
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
  function referenceNodes(m, res, prm) {
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

    var best = null, bestQ = 0;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip || p.equip.off) return;
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
   * above and for the dQ mode below. `C` is ṁ·Cp when a ΔT has to be turned
   * into a duty. */
  function statedDuty(m, p, res, C) {
    var e = p.equip || {};
    if (e.thermalMode === 'dT') {
      return (e.dT || 0) * C;
    }
    return e.duty || 0;                  // watts, signed
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

    var ref = referenceNodes(m, res, prm);
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
    var T = {};
    m.nodes.forEach(function (n) {
      T[n.id] = (ref.refs[n.id] !== undefined) ? ref.refs[n.id] : prm.supply;
    });

    /* Outlet temperature of one link, given its inlet. */
    function outletOf(c, tIn) {
      var p = c.pipe;
      if (p.kind === 'pipe' || p.kind === 'riser') {
        return pipeOutlet(tIn, prm.ambient, c.UperM, c.L, c.mdot, cp);
      }
      if (p.kind === 'equip' && p.equip && !p.equip.off) {
        var e = p.equip;
        if (e.thermalMode === 'dT') return tIn + (e.dT || 0);
        return tIn + (c.C > 0 ? (e.duty || 0) / c.C : 0);
      }
      /* Pumps, valves, isolated equipment: straight through. */
      return tIn;
    }

    // ---- iterate: mixing and transport are mutually dependent round a loop ----
    var iterations = 0, converged = false;
    for (var it = 0; it < MAX_ITER; it++) {
      iterations = it + 1;
      var worst = 0;
      m.nodes.forEach(function (n) {
        if (ref.refs[n.id] !== undefined) { T[n.id] = ref.refs[n.id]; return; }
        var arriving = inTo[n.id];
        if (!arriving || !arriving.length) return;   // nothing feeds it; leave it
        var num = 0, den = 0;
        arriving.forEach(function (c) {
          var t = outletOf(c, T[c.from]);
          num += c.mdot * t;
          den += c.mdot;
        });
        if (!(den > 0)) return;
        var next = num / den;
        var d = Math.abs(next - T[n.id]);
        if (d > worst) worst = d;
        T[n.id] = next;
      });
      if (worst < TOL_K) { converged = true; break; }
    }
    if (!converged) {
      warnings.push({
        code: 'THERMAL_NOT_CONVERGED',
        message: 'Temperatures did not settle in ' + MAX_ITER + ' passes. The ' +
                 'reported values are the last iteration.'
      });
    }

    // ---- report per link ----
    var links = {};
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
        UperM: c.UperM, length: c.L
      };
      if (c.pipe.kind === 'pipe' || c.pipe.kind === 'riser') pipeLoss += qW;
      else if (c.pipe.kind === 'equip') equipDuty += qW;
    });

    var temps = Object.keys(T).map(function (k) { return T[k]; })
      .filter(function (v) { return isFinite(v); });

    return {
      temperature: T,
      links: links,
      fluid: fluid,
      ambient: prm.ambient,
      pinned: ref.pinned,
      converged: converged,
      iterations: iterations,
      warnings: warnings,
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
    pipeOD: pipeOD,
    MAX_ITER: MAX_ITER
  };
})(window.FD = window.FD || {});
