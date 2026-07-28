/* FreePipeCalc — pipe loss models
 *
 * The friction method is a swappable module: the solver only ever asks a link
 * for a resistance `r` and an exponent `n` such that h = r·|Q|^(n−1)·Q.
 *
 * Hazen-Williams (default, ASHRAE SI form):
 *     hf = A · L · Q^a / (C^b · d^e)          A=10.67, a=b=1.852, e=4.8704
 * Every constant is user-editable, because jurisdictions differ on the values
 * and the app should not force one authority's numbers (see the HYDRAULIC tab).
 *
 * Darcy-Weisbach (experimental):
 *     hf = f · (L/d) · V²/2g  =  8·f·L·Q² / (π²·g·d⁵)
 * so n = 2 and r = 8·f·L/(π²·g·d⁵). The catch is that f depends on Reynolds
 * number, hence on Q — so r is not constant. It is refreshed between solver
 * passes using the previous pass's flow, reusing the same outer loop that
 * settles tee run/branch assignment.
 */
(function (FD) {
  'use strict';

  var G = 9.81;

  /* Below this flow the power law's derivative vanishes and the Newton step
   * blows up, so the loss curve is replaced by its tangent at Q_MIN. */
  var Q_MIN = 1e-6;

  /* Reynolds number thresholds. Below LAMINAR the flow is laminar and
   * Hazen-Williams — an empirical turbulent correlation — does not apply. */
  var RE_LAMINAR = 2300;
  var RE_TURBULENT = 4000;

  // ------------------------------------------------- Hazen-Williams defaults
  var HW_DEFAULTS = {
    A: 10.67,      // leading coefficient (SI, ASHRAE)
    a: 1.852,      // flow exponent
    b: 1.852,      // C-factor exponent
    e: 4.8704      // diameter exponent
  };

  // ------------------------------------------------------- friction factors
  /* Explicit and implicit correlations for the Darcy friction factor.
   *
   * NOT YET SELECTED — Michael is deciding which of these the app should use.
   * All four are implemented and selectable so the choice can be made by
   * comparing results rather than on paper. Colebrook-White is the reference
   * the other three approximate.
   */
  var FRICTION_FACTORS = {
    colebrook: {
      key: 'colebrook',
      name: 'Colebrook-White (implicit, reference)',
      note: 'The standard against which the others are fitted. Solved iteratively.',
      f: function (Re, relRough) {
        // 1/√f = −2 log₁₀( ε/3.7d + 2.51/(Re√f) )   — fixed-point iteration
        var invSqrtF = -2 * Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9)); // Swamee-Jain seed
        for (var i = 0; i < 40; i++) {
          var next = -2 * Math.log10(relRough / 3.7 + 2.51 * invSqrtF / Re);
          if (Math.abs(next - invSqrtF) < 1e-12) { invSqrtF = next; break; }
          invSqrtF = next;
        }
        return 1 / (invSqrtF * invSqrtF);
      }
    },
    swameejain: {
      key: 'swameejain',
      name: 'Swamee-Jain (explicit)',
      note: 'Within ~1% of Colebrook for 5e3 < Re < 1e8, 1e-6 < ε/d < 1e-2.',
      f: function (Re, relRough) {
        var t = Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9));
        return 0.25 / (t * t);
      }
    },
    haaland: {
      key: 'haaland',
      name: 'Haaland (explicit)',
      note: 'Within ~2% of Colebrook; simplest of the explicit forms.',
      f: function (Re, relRough) {
        var t = -1.8 * Math.log10(Math.pow(relRough / 3.7, 1.11) + 6.9 / Re);
        return 1 / (t * t);
      }
    },
    churchill: {
      key: 'churchill',
      name: 'Churchill (all flow regimes)',
      note: 'Single expression spanning laminar, transitional and turbulent flow.',
      f: function (Re, relRough) {
        var A = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * relRough)), 16);
        var B = Math.pow(37530 / Re, 16);
        return 8 * Math.pow(Math.pow(8 / Re, 12) + 1 / Math.pow(A + B, 1.5), 1 / 12);
      }
    }
  };

  /* Darcy friction factor including the laminar branch.
   * Churchill already covers laminar, so it is left to handle itself. */
  function frictionFactor(Re, relRough, which) {
    if (!(Re > 0)) return 0;
    var corr = FRICTION_FACTORS[which] || FRICTION_FACTORS.colebrook;
    if (corr.key === 'churchill') return corr.f(Re, relRough);
    if (Re < RE_LAMINAR) return 64 / Re;              // Hagen-Poiseuille
    if (Re < RE_TURBULENT) {
      // Transitional: blend laminar and turbulent rather than jump, so the
      // solver sees a continuous curve instead of a step it cannot converge on.
      var fLam = 64 / RE_LAMINAR;
      var fTurb = corr.f(RE_TURBULENT, relRough);
      var t = (Re - RE_LAMINAR) / (RE_TURBULENT - RE_LAMINAR);
      return fLam + t * (fTurb - fLam);
    }
    return corr.f(Re, relRough);
  }

  // -------------------------------------------------------------- methods
  var methods = {
    HW: {
      key: 'HW',
      name: 'Hazen-Williams',
      n: 1.852,
      available: true,
      experimental: false,
      defaults: HW_DEFAULTS,

      /* ctx.hw carries the (possibly user-edited) coefficients. */
      r: function (L_eff, d, C, ctx) {
        var k = (ctx && ctx.hw) || HW_DEFAULTS;
        if (!(d > 0) || !(C > 0)) return 0;
        return k.A * L_eff / (Math.pow(C, k.b) * Math.pow(d, k.e));
      },

      exponent: function (ctx) {
        var k = (ctx && ctx.hw) || HW_DEFAULTS;
        return k.a;
      },

      formula: function (ctx) {
        var k = (ctx && ctx.hw) || HW_DEFAULTS;
        return 'hf = ' + k.A + ' · L · Q^' + k.a +
               ' / ( C^' + k.b + ' · d^' + k.e + ' )';
      }
    },

    DW: {
      key: 'DW',
      name: 'Darcy-Weisbach (Experimental)',
      n: 2,
      available: true,
      experimental: true,

      /* r = 8·f·L / (π²·g·d⁵).
       * f needs Reynolds number, so ctx must carry the fluid properties and
       * the flow estimate from the previous solver pass. With no estimate yet,
       * a nominal 1 m/s is assumed to get the first pass moving. */
      r: function (L_eff, d, C, ctx) {
        if (!(d > 0)) return 0;
        ctx = ctx || {};
        var fluid = ctx.fluid || { kinematicViscosity: 1.004e-6 };
        var nu = fluid.kinematicViscosity || 1.004e-6;
        var eps = (ctx.roughness_mm !== undefined ? ctx.roughness_mm : 0.045) / 1000;

        var q = (ctx.q === undefined || ctx.q === null) ? null : Math.abs(ctx.q);
        var area = Math.PI * d * d / 4;
        var v = (q === null || q < Q_MIN) ? 1.0 : q / area;

        var Re = v * d / nu;
        var f = frictionFactor(Re, eps / d, ctx.frictionFactor);
        return 8 * f * L_eff / (Math.PI * Math.PI * G * Math.pow(d, 5));
      },

      exponent: function () { return 2; },

      formula: function (ctx) {
        var ff = FRICTION_FACTORS[(ctx && ctx.frictionFactor)] || FRICTION_FACTORS.colebrook;
        return 'hf = f · (L/d) · V²/2g       f from ' + ff.name;
      }
    }
  };

  FD.hydraulics = {
    methods: methods,
    frictionFactors: FRICTION_FACTORS,
    Q_MIN: Q_MIN,
    RE_LAMINAR: RE_LAMINAR,
    RE_TURBULENT: RE_TURBULENT,
    HW_DEFAULTS: HW_DEFAULTS,
    G: G,

    method: function (key) { return methods[key] || methods.HW; },
    frictionFactor: frictionFactor,

    /* Exponent n for the chosen method, honouring edited HW coefficients. */
    exponent: function (key, ctx) {
      var m = this.method(key);
      return m.exponent ? m.exponent(ctx) : m.n;
    },

    /* Reynolds number. ν is kinematic viscosity [m²/s]. */
    reynolds: function (q, d, nu) {
      if (!(d > 0) || !(nu > 0)) return 0;
      var v = Math.abs(q) / (Math.PI * d * d / 4);
      return v * d / nu;
    },

    isLaminar: function (Re) { return Re > 0 && Re < RE_LAMINAR; },
    isTransitional: function (Re) { return Re >= RE_LAMINAR && Re < RE_TURBULENT; },

    /* Head loss [m], signed with the flow and linearised below Q_MIN. */
    headloss: function (r, q, n) {
      var aq = Math.abs(q);
      if (aq < Q_MIN) return n * r * Math.pow(Q_MIN, n - 1) * q;
      return r * Math.pow(aq, n - 1) * q;
    },

    /* d(headloss)/dQ — always positive, used for the Newton step. */
    dhdq: function (r, q, n) {
      var aq = Math.max(Math.abs(q), Q_MIN);
      return n * r * Math.pow(aq, n - 1);
    },

    velocity: function (q, d) {
      if (!(d > 0)) return 0;
      return Math.abs(q) / (Math.PI * d * d / 4);
    },

    /* Friction rate [Pa/m] on the ACTUAL length, excluding fitting equivalent
     * length — the figure compared against the ~400 Pa/m rule. */
    pdPerMetre: function (r_per_L_eff, q, n, L_eff, rho) {
      if (!(L_eff > 0)) return 0;
      var hf = Math.abs(FD.hydraulics.headloss(r_per_L_eff, q, n));
      return (rho || 998) * G * (hf / L_eff);
    },

    /* Quadratic resistance for equipment rated ΔP [Pa] at rated flow [m³/s]. */
    equipmentR: function (pd_rated_Pa, q_rated, rho) {
      if (!(q_rated > 0)) return 0;
      return (pd_rated_Pa / ((rho || 998) * G)) / (q_rated * q_rated);
    }
  };
})(window.FD = window.FD || {});
