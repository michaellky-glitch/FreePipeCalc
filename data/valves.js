/* FreePipeCalc — valve data and loss model
 *
 * Valves are sized by flow coefficient rather than equivalent length:
 *
 *   Kv = flow in m³/h that produces a 1 bar drop across the valve
 *   Cv = flow in US gpm  that produces a 1 psi drop   (Cv ≈ 1.156 · Kv)
 *
 * Pressure drop follows the square law:
 *     ΔP [bar] = (Q [m³/h] / Kv)²
 * which in SI, on a head basis, is  h = r·Q²  with
 *     r = 1e5 · 3600² / (Kv² · ρ · g)
 *
 * NOTE ON THE NUMBERS: the default Kv values and the part-open multipliers
 * below are DERIVED, not manufacturer data — full-open Kv is back-calculated
 * from a typical resistance coefficient K for the valve type, and the opening
 * curve is a representative shape. They are here so the model runs with
 * sensible figures; they are explicitly intended to be replaced by lookup
 * tables of real product data. Anything safety-critical should use the
 * manufacturer's published Kv.
 */
(function (FD) {
  'use strict';

  var RHO = 998, G = 9.81;

  /* Resistance coefficients (velocity heads) for a fully open valve, used only
   * to generate a default Kv when the user has not entered one. */
  var TYPES = {
    /* NAMES vs KEYS. The keys stay 'gate' and 'globe' — they are in every saved
     * file and in every test — while the NAMES say what the valve is FOR
     * (Michael, 2026-08-04). An engineer picks a valve by its job, and
     * "isolation" and "control" are the jobs; the body style is a detail of how
     * that job gets done. */
    gate: {
      key: 'gate',
      name: 'Isolation valve',
      code: 'GV',
      K: 0.15,
      adjustable: true,
      /* Fraction of full-open Kv at each position. A gate valve throttles very
       * unevenly: most of the flow is still there at 75 % travel, and almost
       * all of the restriction happens in the last quarter. */
      curve: { 0: 0, 25: 0.12, 50: 0.38, 75: 0.72, 100: 1 }
    },
    /* A globe valve throttles the same way a gate valve does — position sets a
     * fraction of full-open Kv — so it is handled identically by the solver.
     * What differs is magnitude and shape: the tortuous seat makes it roughly
     * an order of magnitude more resistant when fully open (K ≈ 6 against
     * 0.15), and it throttles far more evenly, which is why it is the valve you
     * regulate with rather than merely isolate with. Same DERIVED-not-measured
     * caveat as the rest of this file. */
    globe: {
      key: 'globe',
      name: 'Control valve',
      code: 'GLV',
      K: 6.0,
      adjustable: true,
      curve: { 0: 0, 25: 0.30, 50: 0.55, 75: 0.80, 100: 1 }
    },
    check: {
      key: 'check',
      name: 'Check valve',
      code: 'CV',
      K: 2.0,
      adjustable: false,      // a check valve's position is not user-set
      checkValve: true,       // blocks reverse flow — see network.js
      curve: { 0: 0, 25: 0.12, 50: 0.38, 75: 0.72, 100: 1 }
    }
  };

  /* Opening is a FULL RANGE, 0-100% in 1% steps (Michael, 2026-08-03). It was
   * five fixed positions, which is not how a regulating valve is set: a
   * balancing valve lands wherever it lands, and quoting the nearest 25% throws
   * away most of the adjustment. The curves above are still tabulated at the
   * quarter points — that is the shape of the data — and anything between them
   * is interpolated. */
  var CURVE_POINTS = [0, 25, 50, 75, 100];

  /* Fraction of full-open Kv at any opening, linear between the tabulated
   * quarter points and clamped outside them. */
  function openFraction(curve, opening) {
    var x = Number(opening);
    if (!isFinite(x)) return 1;
    if (x <= 0) return curve[0];
    if (x >= 100) return curve[100];
    for (var i = 1; i < CURVE_POINTS.length; i++) {
      var lo = CURVE_POINTS[i - 1], hi = CURVE_POINTS[i];
      if (x <= hi) {
        var t = (x - lo) / (hi - lo);
        return curve[lo] + t * (curve[hi] - curve[lo]);
      }
    }
    return curve[100];
  }

  /* Resistance high enough that a shut valve passes no meaningful flow, but
   * still FINITE — an infinite resistance would make the solver matrix
   * singular, whereas a very stiff link just drives the flow to ~0 and keeps
   * the network solvable so the rest of the model can still be read. */
  var CLOSED_R = 1e12;

  FD.valves = {
    types: TYPES,
    curvePoints: CURVE_POINTS,
    openFraction: openFraction,
    CLOSED_R: CLOSED_R,

    type: function (key) { return TYPES[key] || TYPES.gate; },

    kvToCv: function (kv) { return kv * 1.156; },
    cvToKv: function (cv) { return cv / 1.156; },

    /* Default full-open Kv for a valve of this type in a given bore [mm],
     * from ΔP = K·ρ·v²/2 rearranged at ΔP = 1 bar. */
    defaultKv: function (typeKey, bore_mm) {
      var t = this.type(typeKey);
      var d = bore_mm / 1000;
      if (!(d > 0)) return 1;
      var A = Math.PI * d * d / 4;
      var v = Math.sqrt(2e5 / (t.K * RHO));      // velocity at a 1 bar drop
      return Math.round(A * v * 3600 * 10) / 10; // m³/h
    },

    /* Effective Kv at any opening percentage, 0-100. */
    effectiveKv: function (typeKey, kv, opening) {
      var t = this.type(typeKey);
      var o = (opening === undefined || opening === null) ? 100 : Number(opening);
      return kv * openFraction(t.curve, Math.max(0, Math.min(100, o)));
    },

    /* Head-basis resistance for h = r·|Q|·Q, Q in m³/s. */
    resistance: function (typeKey, kv, opening) {
      var eff = this.effectiveKv(typeKey, kv, opening);
      if (!(eff > 0)) return CLOSED_R;
      return 1e5 * 3600 * 3600 / (eff * eff * RHO * G);
    },

    isClosed: function (typeKey, opening) {
      return this.effectiveKv(typeKey, 1, opening) <= 0;
    }
  };
})(window.FD = window.FD || {});
