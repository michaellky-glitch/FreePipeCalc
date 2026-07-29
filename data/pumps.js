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

    var best = null;
    for (var b = 1.2; b <= 3.001; b += 0.02) {
      var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < pts.length; i++) {
        var x = Math.pow(pts[i].q, b), y = pts[i].h;
        n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      var den = n * sxx - sx * sx;
      if (Math.abs(den) < 1e-30) continue;
      var slopeA = (n * sxy - sx * sy) / den;      // this is −a
      var H0 = (sy - slopeA * sx) / n;
      var a = -slopeA;
      if (!(a > 0) || !(H0 > 0)) continue;         // must fall with flow

      var sse = 0, maxDev = 0;
      for (var j = 0; j < pts.length; j++) {
        var pred = H0 - a * Math.pow(pts[j].q, b);
        var d = pred - pts[j].h;
        sse += d * d;
        maxDev = Math.max(maxDev, Math.abs(d));
      }
      if (!best || sse < best.sse) {
        best = { H0: H0, a: a, b: b, sse: sse, maxDev: maxDev };
      }
    }
    if (!best) return null;

    var mean = pts.reduce(function (s, p) { return s + p.h; }, 0) / pts.length;
    var sst = pts.reduce(function (s, p) { return s + (p.h - mean) * (p.h - mean); }, 0);
    var r2 = sst > 1e-30 ? 1 - best.sse / sst : 1;

    return {
      H0: best.H0,
      a: best.a,
      b: Math.round(best.b * 1000) / 1000,
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

  /* Parse pasted Q,H data. Same tolerant approach as the pipe-schedule parser:
   * tabs, commas, semicolons or spaced columns, header row skipped. */
  function parseCurve(text, flowUnit, headUnit) {
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
        h: FD.units.toSIPressure(h, headUnit || 'kPa') / (998 * 9.81)
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
    head: head,
    slope: slope,
    maxFlow: maxFlow,
    shutoffHead: shutoffHead,
    fit: fit,
    parseCurve: parseCurve,
    table: table
  };
})(window.FD = window.FD || {});
