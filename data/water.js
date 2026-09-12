/* FreePipeCalc — water properties against temperature
 *
 * THREE CORRELATIONS AND NOTHING ELSE. This file computes density, dynamic and
 * kinematic viscosity, and specific heat capacity for liquid water at
 * atmospheric pressure. It is NOT wired into the solve: `data/fluids.js` still
 * hands the engine one set of numbers at 20 °C, and changing that is EQ.5,
 * which is Michael's decision and not taken here.
 *
 * ============================================================================
 * PROVENANCE — every figure below is transcribed or fitted, none invented
 * ============================================================================
 *
 * Michael supplied the sources on 2026-09-12 and the working is written up in
 * `docs_internal/WATER-PROPERTIES.md`, with the PDFs alongside it (untracked,
 * so they stay off GitHub — same treatment as the Idelchik handbook).
 *
 * DENSITY and SPECIFIC HEAT — NISTIR 5078, Allan H. Harvey, "Thermodynamic
 * Properties of Water: Tabulation from the IAPWS Formulation 1995", Table 3,
 * the 0.10 MPa isobar. Density is read straight off. Cp is DERIVED from the
 * same table's enthalpy column as Cp = dh/dT by central differences, because
 * the tabulation does not carry Cp itself.
 *
 *   ONE TRAP, AND IT IS IN THAT TABLE: at 0.10 MPa the saturation temperature
 *   is 99.606 °C, so the 100 °C row of that isobar is SUPERHEATED STEAM,
 *   0.590 kg/m³. The liquid figure at 100 °C (958.35) comes from the 0.11 MPa
 *   isobar, whose saturation temperature is 102.292 °C.
 *
 * VISCOSITY — Anton Paar's published water table, which cites IAPWS 2008. That
 * is the right authority: the NIST/ASME Steam Properties guide states in §A.2
 * that viscosity is computed from "the IAPWS Formulation 2008 for the Viscosity
 * of Ordinary Water Substance" (IAPWS R12-08; Huber et al., J. Phys. Chem. Ref.
 * Data 38, 101, 2009). The Anton Paar table was cross-checked against IAPWS
 * R6-95(2018) Table 7 on its density column and agrees to 0.0011%.
 *
 * WHAT IS VERIFIED, AND WHAT IS NOT:
 *
 *   density            0–100 °C     verified against NISTIR 5078
 *   specific heat      5–90 °C      derived from NISTIR 5078 enthalpy
 *   dynamic viscosity  2–80 °C      verified against Anton Paar / IAPWS 2008
 *   dynamic viscosity  0–2, 80–100  NOT VERIFIED — the fit still returns a
 *                                   value there, and `verifiedAt` says no
 *
 * The unverified viscosity ends are the two Michael is still sourcing. They are
 * reported rather than hidden, exactly as the propylene glycol rows are.
 *
 * ============================================================================
 * WHY POLYNOMIALS AND NOT THE PRIMARY FORMULATION
 * ============================================================================
 *
 * IAPWS-95 itself is a 56-term Helmholtz free-energy equation that yields
 * p(T, ρ) — pressure FROM density — so getting density at a stated temperature
 * and pressure means inverting it numerically at every call, on top of
 * transcribing 56 coefficient rows by hand. That is the precise activity this
 * project's "never invent engineering data" rule exists to prevent.
 *
 * The fits below are to the PUBLISHED TABULATIONS instead, and their deviation
 * from those tables is measured and asserted in `engine.test.js`. For scale:
 * IAPWS-95's own density uncertainty near 0.1 MPa is 0.0001%, so a fit good to
 * 0.0032% is about thirty times coarser than the source — and still far tighter
 * than anything else in this program, where the roughness of a pipe is a
 * judgement call worth several percent.
 */
(function (FD) {
  'use strict';

  /* The span each correlation was fitted over. Outside it the polynomials are
   * extrapolating and will go wrong quickly — a quartic always does. */
  var FIT = {
    density:      { lo: 0, hi: 100 },
    specificHeat: { lo: 5, hi: 90 },
    viscosity:    { lo: 2, hi: 80 }
  };

  /* Where the underlying DATA was checked. Narrower than the fit range for
   * viscosity, and that gap is the honest part. */
  var VERIFIED = {
    density:      { lo: 0, hi: 100 },
    specificHeat: { lo: 5, hi: 90 },
    viscosity:    { lo: 2, hi: 80 }
  };

  function horner(c, x) {
    var v = 0;
    for (var i = 0; i < c.length; i++) v = v * x + c[i];
    return v;
  }

  /* Highest power first, as `numpy.polyfit` returns them and as the write-up
   * quotes them, so the two can be compared without re-ordering anything. */

  /* kg/m³ · max deviation 0.0032% over 0–100 °C against NISTIR 5078. */
  var RHO = [-1.29371790e-07, 4.13494754e-05, -7.50992160e-03,
              5.14510714e-02, 9.99871768e+02];

  /* J/(kg·K) · max deviation 0.045% over 5–90 °C. */
  var CP = [-1.51817452e-04, 3.50653595e-02, -2.03171368e+00, 4.21340033e+03];

  /* ln(μ), μ in Pa·s · max deviation 0.072% over 2–80 °C.
   *
   * A LOG-QUARTIC RATHER THAN THE PUBLISHED VOGEL EQUATION, and the reason is
   * chilled water. Vogel — mu = 2.414e-5 · 10^(247.8/(T + 133.15)), the same
   * equation whether it is written in °C or as 10^(247.8/(T_K − 140)) — is
   * within 0.85% from 10 °C up, which is what its publishers claim. Below that
   * it degrades fast: measured against the source table it is 1.12% out at
   * 5 °C and 1.68% out at 2 °C, and that is exactly where a chilled circuit
   * runs. This fit is 0.072% across the whole span. */
  var LNMU = [8.82420037e-09, -2.34418222e-06, 3.06324154e-04,
             -3.42632736e-02, -6.32624250e+00];

  FD.water = {
    FIT: FIT,
    VERIFIED: VERIFIED,

    density: function (t) { return horner(RHO, t); },              // kg/m³
    specificHeat: function (t) { return horner(CP, t); },          // J/(kg·K)
    dynamicViscosity: function (t) { return Math.exp(horner(LNMU, t)); },  // Pa·s

    /* WHAT THE ENGINE ACTUALLY CONSUMES. `hydraulics.js` asks for kinematic
     * viscosity, so the division belongs here rather than at every call site. */
    kinematicViscosity: function (t) {                             // m²/s
      return FD.water.dynamicViscosity(t) / FD.water.density(t);
    },

    /* The three numbers `fluids.js` hands the engine, in its own shape, so a
     * caller can swap one for the other without translating anything. */
    at: function (t) {
      return {
        density: FD.water.density(t),
        kinematicViscosity: FD.water.kinematicViscosity(t),
        specificHeat: FD.water.specificHeat(t),
        refTemp: t
      };
    },

    /* Whether a temperature is inside the span the DATA was checked over, per
     * property. A caller that wants to warn — and something should, before any
     * of this reaches a printed sheet — asks this rather than hard-coding the
     * numbers. `null` for an unknown property name, so a typo does not read as
     * a confident "yes". */
    verifiedAt: function (t, which) {
      var r = VERIFIED[which];
      if (!r) return null;
      return t >= r.lo && t <= r.hi;
    },

    /* Every property whose verified span does not cover this temperature. */
    unverifiedAt: function (t) {
      return Object.keys(VERIFIED).filter(function (k) {
        return !FD.water.verifiedAt(t, k);
      });
    }
  };
})(window.FD = window.FD || {});
