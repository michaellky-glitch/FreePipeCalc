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

  /* ASHRAE Ch 22 Eq (6), as PRINTED — velocity form.
   *     Δh = K · L · (V/C)^a · (1/D)^e
   * The flow-form coefficients used by the solver are derived from these; see
   * methods.HW.derive. */
  var ASHRAE_DEFAULTS = { K: 6.819, a: 1.852, e: 1.167 };

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
   * SWAMEE-JAIN is the selected correlation (Michael, 2026-08-02), and the
   * default. It is an explicit fit to Colebrook-White.
   *
   * Its accuracy is MEASURED in engine.test.js against an independent
   * iteration of Colebrook, not quoted: within **0.9%** over Re 1e4 to 1e7 with
   * eps/d up to 1e-3, which is the envelope every building-services pipe sits
   * in, and up to **2.8%** at the corner of its own published validity (Re 5000
   * with eps/d 1e-2 — barely turbulent flow in a very rough pipe). The
   * often-repeated "within 1%" does not hold there, and saying 1% when it is
   * 2.8% would be worse than saying 3%.
   *
   * Explicit matters here: the solver evaluates
   * the friction factor on every link on every Newton iteration, and an
   * iterative correlation inside an iterative solve is a nested loop with no
   * accuracy to show for it.
   *
   * The other three stay implemented and selectable. Colebrook-White is the
   * reference the others approximate, and `engine.test.js` checks Swamee-Jain
   * against an INDEPENDENT fixed-point iteration of Colebrook written in the
   * test itself — that is what makes the choice auditable rather than asserted.
   */
  var FRICTION_FACTORS = {
    colebrook: {
      key: 'colebrook',
      name: 'Colebrook-White',
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
      name: 'Swamee-Jain',
      note: 'The correlation this app uses. Measured against an iterated ' +
            'Colebrook: within 0.9% over Re 1e4–1e7 and ε/d ≤ 1e-3, rising to ' +
            '2.8% at Re 5000 with ε/d 1e-2.',
      f: function (Re, relRough) {
        var t = Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9));
        return 0.25 / (t * t);
      }
    },
    haaland: {
      key: 'haaland',
      name: 'Haaland',
      note: 'Within ~2% of Colebrook; simplest of the explicit forms.',
      f: function (Re, relRough) {
        var t = -1.8 * Math.log10(Math.pow(relRough / 3.7, 1.11) + 6.9 / Re);
        return 1 / (t * t);
      }
    },
    churchill: {
      key: 'churchill',
      name: 'Churchill',
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
  /* How a method charges fitting losses:
   *   'EL' — equivalent length of straight pipe, folded into the pipe's own
   *          resistance (spec §3.3). One exponent for the whole link.
   *   'K'  — velocity heads, h = K·V²/2g, as a SEPARATE quadratic term. This is
   *          what ASHRAE Ch 22 Eq (7) does, and it means a link carries two
   *          loss terms with different exponents — see solver.js linkLoss.
   */
  var methods = {
    /* The 2021 ASHRAE Handbook — Fundamentals, Ch 22 "Pipe Design" method, and
     * the default.
     *
     * PIPE FRICTION is Hazen-Williams, Eq (6):
     *     Δh = 6.819·L·(V/C)^1.852·(1/D)^1.167
     * Substituting V = 4Q/πD² gives Δh = 10.6663·L·Q^1.852 / (C^1.852·D^4.8710),
     * i.e. exactly the coefficients this app already used (10.67 and 4.8704, to
     * 0.035 % and 0.012 %). Verified against ASHRAE 2026-07-31, so the HW entry
     * below and this one compute pipe loss identically.
     *
     * FITTINGS are charged as EQUIVALENT LENGTH, from the table chosen on the
     * HYDRAULIC tab (Carrier Design Handbook, NFPA 13, or custom — see
     * data/fittings.js).
     *
     * There were THREE methods until v0.8.5 — this one with K fittings, a
     * second Hazen-Williams with equivalent length, and Darcy. The first two
     * computed pipe loss IDENTICALLY (to 0.035%, being two roundings of the
     * same ASHRAE equation) and differed only in how they charged fittings, so
     * the menu offered what looked like two different equations and was really
     * one equation and two fitting bases. Collapsed to two at Michael's
     * instruction: Hazen-Williams charges equivalent length, Darcy-Weisbach
     * charges K velocity heads, and the fitting basis follows the method
     * instead of being a third thing to pick.
     */
    HW: {
      key: 'HW',
      name: 'Hazen-Williams (ASHRAE with Equivalent Lengths)',
      n: 1.852,
      available: true,
      experimental: false,
      fittingMode: 'EL',
      defaults: HW_DEFAULTS,
      source: '2021 ASHRAE Handbook — Fundamentals (SI), Ch 22, Eq (6) and (7)',

      /* The constants are the VELOCITY-form ones ASHRAE actually prints, and
       * the flow-form coefficients are DERIVED from them rather than carried
       * separately. An engineer checking this against the Handbook sees 6.819,
       * 1.852 and 1.167 — the numbers on the page — and the 10.67 that used to
       * be hard-coded now falls out of them:
       *
       *   V = 4Q/πd²  ⇒  A = 6.819·(4/π)^1.852 = 10.6663
       *                  E = 1.167 + 2·1.852   = 4.8710
       *
       * Editing the printed constants therefore flows through to the solve,
       * which it could not when A was stored independently. */
      derive: function (ctx) {
        var k = (ctx && ctx.ashrae) || ASHRAE_DEFAULTS;
        return {
          A: k.K * Math.pow(4 / Math.PI, k.a),
          b: k.a,
          e: k.e + 2 * k.a,
          a: k.a
        };
      },

      r: function (L_eff, d, C, ctx) {
        if (!(d > 0) || !(C > 0)) return 0;
        var k = methods.HW.derive(ctx);
        return k.A * L_eff / (Math.pow(C, k.b) * Math.pow(d, k.e));
      },
      exponent: function (ctx) {
        return methods.HW.derive(ctx).a;
      },
      formula: function (ctx) {
        var k = (ctx && ctx.ashrae) || ASHRAE_DEFAULTS;
        return 'Δh = ' + k.K + ' · L · (V/C)^' + k.a + ' · (1/D)^' + k.e +
               '   (fittings as equivalent length)';
      }
    },

    /* Darcy-Weisbach, with the SAME K-factor fitting treatment as ASHRAE.
     *
     * Fittings were charged as equivalent length here until v0.8.1, and that was
     * inconsistent on its own terms. ASHRAE Ch 22 states the velocity-head form,
     * Δp = Kρ(V²/2) — Eq (7) — and tabulates K in Tables 3 to 6; Darcy-Weisbach
     * is itself a velocity-head equation. Charging its fittings by an L/D
     * equivalent length borrowed from a Hazen-Williams basis mixed two
     * formulations for no reason (Michael, 2026-08-02).
     *
     * Pipe friction here is ALSO exponent 2, so the two terms COULD be folded
     * into one resistance — unlike ASHRAE, where 1.852 and 2 cannot be added.
     * They are still carried separately, through the same `rK` the ASHRAE path
     * uses, so there is one code path for K fittings and the sheet can report
     * the two contributions apart. Identical either way:
     * r·Q² + rK·Q² = (r + rK)·Q². */
    DW: {
      key: 'DW',
      name: 'Darcy-Weisbach',
      n: 2,
      available: true,
      experimental: false,
      fittingMode: 'K',
      source: '2021 ASHRAE Handbook — Fundamentals (SI), Ch 22, Eq (7) and Tables 3–6',

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
        /* Swamee-Jain unless the model says otherwise — see FRICTION_FACTORS. */

        var q = (ctx.q === undefined || ctx.q === null) ? null : Math.abs(ctx.q);
        var area = Math.PI * d * d / 4;
        var v = (q === null || q < Q_MIN) ? 1.0 : q / area;

        var Re = v * d / nu;
        var f = frictionFactor(Re, eps / d, ctx.frictionFactor || 'colebrook');
        return 8 * f * L_eff / (Math.PI * Math.PI * G * Math.pow(d, 5));
      },

      exponent: function () { return 2; },

      formula: function (ctx) {
        var ff = FRICTION_FACTORS[(ctx && ctx.frictionFactor)] || FRICTION_FACTORS.colebrook;
        return 'hf = f · (L/d) · V²/2g   +   Σ K · V²/2g       f from ' + ff.name;
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
    ASHRAE_DEFAULTS: ASHRAE_DEFAULTS,
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

    /* Total head loss for a LINK, in metres, signed with the flow.
     *
     * Anything reconstructing a loss from a link must come through here.
     * Reading `link.r` on its own silently omits the separate velocity-head
     * fitting term that the ASHRAE method adds, and the omission is invisible:
     * the number still looks like a pressure drop, it is just too small. That
     * caught the energy-balance and critical-path reconciliations when the
     * method was introduced. */
    linkLoss: function (link, q) {
      if (!link) return 0;
      var h = FD.hydraulics.headloss(link.r, q, link.n);
      if (link.rK) h += FD.hydraulics.headloss(link.rK, q, 2);
      return h;
    },

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
    },

    /* Fitting resistance on the VELOCITY-HEAD basis (ASHRAE Ch 22 Eq 7).
     *
     *   h = ΣK · V²/2g,  V = Q/A,  A = πd²/4
     *     = [ ΣK / (2g·A²) ] · Q²
     *
     * so it is a quadratic resistance, exponent 2 — which is why it cannot
     * simply be added to a Hazen-Williams pipe resistance (exponent 1.852) and
     * has to ride alongside it as a separate term. */
    fittingR: function (sumK, d) {
      if (!(d > 0) || !(sumK > 0)) return 0;
      var area = Math.PI * d * d / 4;
      return sumK / (2 * G * area * area);
    }
  };
})(window.FD = window.FD || {});
