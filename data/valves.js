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
    gate: {
      key: 'gate',
      name: 'Gate valve',
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
      name: 'Globe valve',
      code: 'GLV',
      K: 6.0,
      adjustable: true,
      curve: { 0: 0, 25: 0.30, 50: 0.55, 75: 0.80, 100: 1 }
    },
    check: {
      key: 'check',
      name: 'Check valve (swing)',
      code: 'CV',
      K: 2.0,
      adjustable: false,      // a check valve's position is not user-set
      checkValve: true,       // blocks reverse flow — see network.js
      curve: { 0: 0, 25: 0.12, 50: 0.38, 75: 0.72, 100: 1 }
    }
  };

  var OPENINGS = [0, 25, 50, 75, 100];

  /* Resistance high enough that a shut valve passes no meaningful flow, but
   * still FINITE — an infinite resistance would make the solver matrix
   * singular, whereas a very stiff link just drives the flow to ~0 and keeps
   * the network solvable so the rest of the model can still be read. */
  var CLOSED_R = 1e12;

  FD.valves = {
    types: TYPES,
    openings: OPENINGS,
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

    /* Effective Kv at a given opening percentage. */
    effectiveKv: function (typeKey, kv, opening) {
      var t = this.type(typeKey);
      var f = t.curve[opening];
      if (f === undefined) f = t.curve[100];
      return kv * f;
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
