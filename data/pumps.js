/* FreePipeCalc — pump curves
 *
 * A pump curve is stored as  H = H0 − a·Q^b  (H in metres, Q in m³/s).
 * That form is what the solver wants: it has a clean derivative
 * dH/dQ = −b·a·Q^(b−1), which is what keeps the Newton iteration fast.
 *
 * Default is the EPANET single-point assumption, generated from one design
 * duty (H_d at Q_d):
 *
 *     H = (4/3)·H_d − (1/3)·H_d·(Q/Q_d)²
 *
 * i.e. shutoff head at 133% of design and maximum flow at 200% of design.
 * Checked: it returns exactly H_d at Q_d, (4/3)H_d at Q = 0, and zero at 2·Q_d.
 */
(function (FD) {
  'use strict';

  /* Curve from a single design point — the EPANET assumption. */
  function singlePoint(Hd, Qd) {
    if (!(Hd > 0) || !(Qd > 0)) return null;
    return {
      H0: (4 / 3) * Hd,
      a: (1 / 3) * Hd / (Qd * Qd),
      b: 2,
      Hd: Hd,
      Qd: Qd,
      source: 'single-point'
    };
  }

  function head(curve, q) {
    if (!curve) return 0;
    var aq = Math.abs(q);
    return curve.H0 - curve.a * Math.pow(aq, curve.b);
  }

  /* dH/dQ, always returned as a positive resistance-like slope for the solver.
   * Floored because it vanishes at shutoff: dH/dQ = −b·a·Q^(b−1) → 0 as Q → 0
   * for b > 1, which is the same singularity a fixed-head pump has and would
   * make the Newton step blow up in exactly the same way. */
  function slope(curve, q, floor) {
    if (!curve) return floor || 1;
    var aq = Math.max(Math.abs(q), 1e-9);
    var s = curve.b * curve.a * Math.pow(aq, curve.b - 1);
    return Math.max(s, floor || 0.5);
  }

  /* Flow at which the curve reaches zero head — the pump can deliver no more
   * than this against any system. */
  function maxFlow(curve) {
    if (!curve || !(curve.a > 0)) return Infinity;
    return Math.pow(curve.H0 / curve.a, 1 / curve.b);
  }

  function shutoffHead(curve) {
    return curve ? curve.H0 : 0;
  }

  /* The same pump at a fraction `s` of rated speed — the affinity laws.
   *
   *     Q ∝ N        H ∝ N²        so   H_s(Q) = s²·H(Q/s)
   *
   * Substituted into H = H0 − a·Q^b that comes out in the SAME form, which is
   * the whole reason the scaling can be done on the stored curve rather than
   * anywhere in the solver:
   *
   *     H_s(Q) = s²·[ H0 − a·(Q/s)^b ] = s²·H0 − a·s^(2−b)·Q^b
   *
   * so  H0' = s²·H0,  a' = a·s^(2−b),  b' = b  — and the duty point rides the
   * affinity parabola to (s·Qd, s²·Hd), which is where it has to be.
   *
   * Sanity checks, both hand-verifiable: at s = 1 nothing moves; and for the
   * default b = 2 the exponent term is s⁰ = 1, so `a` is unchanged and the
   * curve simply drops — which is the familiar picture of a VSD family.
   *
   * The affinity laws are textbook, not fitted here: they are the similarity
   * relations for a fixed impeller, exact for the ideal machine and the basis
   * of every published VSD family. Efficiency is NOT scaled — the app does not
   * carry a power curve, so there is nothing to be wrong about. */
  function atSpeed(curve, s) {
    if (!curve) return null;
    if (!(s > 0)) return null;                 // a stopped pump is not a curve
    if (Math.abs(s - 1) < 1e-12) return curve;
    return {
      H0: curve.H0 * s * s,
      a: curve.a * Math.pow(s, 2 - curve.b),
      b: curve.b,
      Hd: (curve.Hd || 0) * s * s,
      Qd: (curve.Qd || 0) * s,
      speed: s,
      source: curve.source
    };
  }

  /* Least-squares fit of H = H0 − a·Q^b to pasted points.
   *
   * b enters non-linearly, so it is swept over a plausible range and, for each
   * candidate, H0 and a are solved by ordinary linear least squares against
   * x = Q^b. Cheap, robust, and no dependence on a starting guess — which
   * matters because manufacturer curves vary a lot in shape.
   *
   * Returns the curve plus fit quality, because a curve that does not fit this
   * form should be visible to the engineer rather than silently wrong.
   */
  function fit(points) {
    var pts = (points || []).filter(function (p) {
      return isFinite(p.q) && isFinite(p.h) && p.q >= 0 && p.h >= 0;
    });
    if (pts.length < 2) return null;

    /* For a FIXED b the problem is linear in H0 and a, so b is swept and each
     * candidate solved exactly. A coarse sweep locates the basin; a refinement
     * pass then narrows it, because the residual is shallow near the optimum
     * and a 0.02 grid was leaving visible error — on an NFPA 20 curve the
     * analytic answer is b = 1.5504 and the coarse grid returned 1.54, worth
     * about 0.4 kPa at the design point. */
    function tryB(b) {
      var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < pts.length; i++) {
        var x = Math.pow(pts[i].q, b), y = pts[i].h;
        n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      var den = n * sxx - sx * sx;
      if (Math.abs(den) < 1e-30) return null;
      var slopeA = (n * sxy - sx * sy) / den;      // this is −a
      var H0 = (sy - slopeA * sx) / n;
      var a = -slopeA;
      if (!(a > 0) || !(H0 > 0)) return null;      // must fall with flow

      var sse = 0, maxDev = 0;
      for (var j = 0; j < pts.length; j++) {
        var pred = H0 - a * Math.pow(pts[j].q, b);
        var d = pred - pts[j].h;
        sse += d * d;
        maxDev = Math.max(maxDev, Math.abs(d));
      }
      return { H0: H0, a: a, b: b, sse: sse, maxDev: maxDev };
    }

    var best = null, b;
    for (b = 1.2; b <= 3.001; b += 0.02) {
      var cand = tryB(b);
      if (cand && (!best || cand.sse < best.sse)) best = cand;
    }
    if (!best) return null;

    // Golden-section-free refinement: two bisection passes around the winner.
    var lo = best.b - 0.02, hi = best.b + 0.02, step;
    for (var pass = 0; pass < 3; pass++) {
      step = (hi - lo) / 20;
      for (b = lo; b <= hi + 1e-12; b += step) {
        var c2 = tryB(b);
        if (c2 && c2.sse < best.sse) best = c2;
      }
      lo = best.b - step; hi = best.b + step;
    }

    var mean = pts.reduce(function (s, p) { return s + p.h; }, 0) / pts.length;
    var sst = pts.reduce(function (s, p) { return s + (p.h - mean) * (p.h - mean); }, 0);
    var r2 = sst > 1e-30 ? 1 - best.sse / sst : 1;

    return {
      H0: best.H0,
      a: best.a,
      b: Math.round(best.b * 100000) / 100000,
      source: 'fitted',
      points: pts,
      fit: {
        r2: r2,
        maxDev: best.maxDev,
        rms: Math.sqrt(best.sse / pts.length),
        n: pts.length
      }
    };
  }

  /* Exact quadratic through three points, h(q) = a + b·q + c·q².
   *
   * Newton's divided differences rather than a 3x3 solve — same answer, but no
   * matrix and no pivoting to get wrong:
   *
   *     m01 = (h1−h0)/(q1−q0)        m12 = (h2−h1)/(q2−q1)
   *     c   = (m12 − m01)/(q2 − q0)
   *     b   = m01 − c(q0 + q1)
   *     a   = h0 − b·q0 − c·q0²
   *
   * This is an INTERPOLATION, not a fit: it passes through all three points
   * exactly, which is the point. A generic curve is defined by three stated
   * duties (shutoff, design, runout), so there is nothing to average.
   *
   * Note the linear term. The solver's own form, H₀ − a·Q^b, has none, so the
   * two are not interchangeable — see genericTable() and the note in
   * docs/SIMULATION-design.md §3.4.
   */
  function threePoint(p0, p1, p2) {
    var pts = [p0, p1, p2];
    for (var i = 0; i < 3; i++) {
      if (!pts[i] || !isFinite(pts[i].q) || !isFinite(pts[i].h)) return null;
      if (pts[i].q < 0 || pts[i].h < 0) return null;
    }
    pts.sort(function (x, y) { return x.q - y.q; });
    var q0 = pts[0].q, h0 = pts[0].h;
    var q1 = pts[1].q, h1 = pts[1].h;
    var q2 = pts[2].q, h2 = pts[2].h;

    // Two points at the same flow have no single head — the curve is undefined.
    if (q1 - q0 < 1e-12 || q2 - q1 < 1e-12) return null;

    var m01 = (h1 - h0) / (q1 - q0);
    var m12 = (h2 - h1) / (q2 - q1);
    var c = (m12 - m01) / (q2 - q0);
    var b = m01 - c * (q0 + q1);
    var a = h0 - b * q0 - c * q0 * q0;

    return { a: a, b: b, c: c, points: pts, source: 'three-point' };
  }

  function quadHead(qc, q) {
    if (!qc) return 0;
    var aq = Math.abs(q);
    return qc.a + qc.b * aq + qc.c * aq * aq;
  }

  /* Flow at which a quadratic reaches zero head — solving a + bq + cq² = 0 and
   * taking the smallest positive root. A pump curve must end somewhere, and
   * the table should not run past it. */
  function quadMaxFlow(qc) {
    if (!qc) return Infinity;
    var a = qc.a, b = qc.b, c = qc.c;
    if (Math.abs(c) < 1e-30) return b < 0 ? -a / b : Infinity;
    var disc = b * b - 4 * c * a;
    if (disc < 0) return Infinity;
    var r = Math.sqrt(disc);
    var roots = [(-b + r) / (2 * c), (-b - r) / (2 * c)].filter(function (x) {
      return x > 0;
    });
    if (!roots.length) return Infinity;
    return Math.min.apply(null, roots);
  }

  /* Sanity checks an engineer would apply by eye. These are not arbitrary
   * limits — each one describes a curve that is not a pump. */
  function quadWarnings(qc, qDesign) {
    var out = [];
    if (!qc) return out;
    if (qc.a <= 0) out.push('Shutoff head is zero or negative — the curve does not describe a pump.');
    // Head must fall as flow rises, everywhere in the working range.
    var qMax = Math.min(quadMaxFlow(qc), qDesign * 1.5);
    var steps = 30, rising = null;
    for (var i = 1; i <= steps; i++) {
      var qa = qMax * (i - 1) / steps, qb2 = qMax * i / steps;
      if (quadHead(qc, qb2) > quadHead(qc, qa) + 1e-12) {
        rising = qa;
        break;
      }
    }
    if (rising !== null) {
      out.push('Head RISES with flow somewhere below ' +
               (100 * rising / qDesign).toFixed(0) + '% of design flow. ' +
               'Check the two fit points — a pump curve must fall throughout.');
    }
    if (qc.c > 0) {
      out.push('The curve is concave up. Most pump curves steepen towards runout, ' +
               'not flatten — check the 150% point.');
    }
    return out;
  }

  /* Parse pasted Q,H data. Same tolerant approach as the pipe-schedule parser:
   * tabs, commas, semicolons or spaced columns, header row skipped. */
  function parseCurve(text, flowUnit, headUnit, rho) {
    var out = [], skipped = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      var cols = (line.indexOf('\t') >= 0) ? line.split('\t')
               : (line.indexOf(',') >= 0)  ? line.split(',')
               : (line.indexOf(';') >= 0)  ? line.split(';')
               : line.split(/\s{2,}|\s+/);
      var q = FD.units.parse(cols[0]);
      var h = FD.units.parse(cols[1]);
      if (!isFinite(q) || !isFinite(h)) {
        if (!out.length && !skipped.length) return;      // header row
        skipped.push({ line: i + 1, text: line });
        return;
      }
      out.push({
        q: FD.units.toSIFlow(q, flowUnit || 'L/s'),
        /* Pressure → head via the ACTUAL fluid density, matching the manual
         * pump-head field (app.js paToHeadWith). Using a hard-coded 998 here
         * meant a pasted curve and a typed duty disagreed for glycol. A head
         * unit ('m'/'ft') round-trips as before, since it is defined as
         * metres-of-water pressure in units.js. */
        h: FD.units.paToHeadWith(FD.units.toSIPressure(h, headUnit || 'kPa'), rho)
      });
    });
    out.sort(function (a, b) { return a.q - b.q; });
    return { points: out, skipped: skipped };
  }

  /* Tabulated curve for display: 0–150% of design flow in 10% steps. */
  function table(curve) {
    if (!curve) return [];
    var Qd = curve.Qd || (maxFlow(curve) / 2);
    var rows = [];
    for (var pct = 0; pct <= 150; pct += 10) {
      var q = Qd * pct / 100;
      rows.push({ pct: pct, q: q, h: Math.max(0, head(curve, q)) });
    }
    return rows;
  }

  FD.pumps = {
    singlePoint: singlePoint,
    threePoint: threePoint,
    quadHead: quadHead,
    quadMaxFlow: quadMaxFlow,
    quadWarnings: quadWarnings,
    head: head,
    slope: slope,
    maxFlow: maxFlow,
    shutoffHead: shutoffHead,
    atSpeed: atSpeed,
    fit: fit,
    parseCurve: parseCurve,
    table: table
  };
})(window.FD = window.FD || {});
