/* FreePipeCalc — working fluids
 *
 * A fluid is four numbers the rest of the app needs: density, kinematic
 * viscosity, specific heat capacity, and the temperature they are quoted at.
 * Density drives every head-to-pressure conversion, viscosity drives Reynolds
 * number under Darcy-Weisbach, and Cp drives the whole thermal module
 * (Q = ṁ·Cp·ΔT).
 *
 * ============================================================================
 * PROVENANCE — READ THIS BEFORE TRUSTING THE GLYCOL NUMBERS
 * ============================================================================
 *
 * WATER is not in question: 998 kg/m³, 4187 J/(kg·K) and 1.004e-6 m²/s. These
 * are the values this app has always used, and they are kept EXACTLY rather
 * than nudged to the textbook 998.2 / 4182 for 20 °C. The difference is 0.02%
 * and 0.12%, which is nothing on its own — but it would have moved every
 * pressure and every duty in every existing model, and the handover's own
 * worked note (1 m wg = 998 × 9.81 = 9.79 kPa) with them. A change nobody
 * asked for that shifts every number in the app is not worth 0.02%.
 *
 * The PROPYLENE GLYCOL rows are NOT transcribed from a page in front of
 * anyone. They were written from recollection of the ASHRAE Fundamentals Ch 31
 * secondary-coolant tables, at Michael's instruction and on the explicit
 * understanding that they are flagged until he checks them (2026-08-02).
 *
 * That is a deliberate exception to this project's "never invent engineering
 * data" rule, and the rule exists because it has been broken twice with
 * consequences — a synthesised 45° elbow column was 250% wrong, and a shifted
 * gate-valve column understated every size by 17–38%. So the exception is
 * carried with teeth:
 *
 *   - every glycol row has `verified: false`;
 *   - `FD.fluids.unverified()` lists them, and the UI shows the flag beside the
 *     fluid selector, on the THERMAL tab, and on the CALCULATION SHEET, which
 *     is the thing that gets issued;
 *   - all four values stay editable through the Custom fluid.
 *
 * Cp is the one to check first. It scales the thermal answer LINEARLY: a Cp
 * that is 5% out puts every duty 5% out, and unlike a friction factor there is
 * nothing downstream to absorb it.
 *
 * Values are for AQUEOUS PROPYLENE glycol by MASS, at 20 °C. Propylene rather
 * than ethylene at Michael's choice — the usual one in building services,
 * where toxicity matters. Note that propylene is the more viscous and the
 * lower-Cp of the two, so the two are not interchangeable in either direction.
 *
 * Temperature dependence is NOT modelled. Every fluid is quoted at one
 * temperature and used at that value everywhere, which is what the hydraulics
 * did before the thermal module existed. It matters more now: glycol viscosity
 * roughly doubles between 20 °C and 0 °C, so a chilled circuit run at 6 °C is
 * being given 20 °C properties. Logged in KNOWN-ISSUES.
 */
(function (FD) {
  'use strict';

  var REF_C = 20;

  var FLUIDS = {
    water: {
      key: 'water',
      name: 'Water',
      density: 998,                 // kg/m³
      kinematicViscosity: 1.004e-6, // m²/s
      specificHeat: 4187,           // J/(kg·K)
      refTemp: REF_C,
      freezePoint: 0,               // °C
      verified: true,
      source: 'Standard properties for water at 20 °C.'
    },

    /* --- propylene glycol, aqueous, by mass. UNVERIFIED — see the header. --- */
    pg10: {
      key: 'pg10',
      name: '10% Propylene Glycol',
      density: 1005,
      kinematicViscosity: 1.29e-6,
      specificHeat: 4060,
      refTemp: REF_C,
      freezePoint: -3,
      verified: false,
      source: 'Propylene glycol 10% by mass at 20 °C — NOT verified against a ' +
              'printed table. Check against ASHRAE Fundamentals Ch 31 or the ' +
              'manufacturer’s data before issuing anything.'
    },
    pg20: {
      key: 'pg20',
      name: '20% Propylene Glycol',
      density: 1015,
      kinematicViscosity: 1.73e-6,
      specificHeat: 3960,
      refTemp: REF_C,
      freezePoint: -7,
      verified: false,
      source: 'Propylene glycol 20% by mass at 20 °C — NOT verified against a ' +
              'printed table. Check against ASHRAE Fundamentals Ch 31 or the ' +
              'manufacturer’s data before issuing anything.'
    },
    pg30: {
      key: 'pg30',
      name: '30% Propylene Glycol',
      density: 1024,
      kinematicViscosity: 2.44e-6,
      specificHeat: 3850,
      refTemp: REF_C,
      freezePoint: -13,
      verified: false,
      source: 'Propylene glycol 30% by mass at 20 °C — NOT verified against a ' +
              'printed table. Check against ASHRAE Fundamentals Ch 31 or the ' +
              'manufacturer’s data before issuing anything.'
    },

    /* Custom is the escape hatch, and the only fluid whose numbers are
     * editable. Everything else is a published property set: letting it be
     * typed over would leave the sheet naming a fluid whose properties are not
     * that fluid's. */
    custom: {
      key: 'custom',
      name: 'Custom',
      density: 998,
      kinematicViscosity: 1.004e-6,
      specificHeat: 4187,
      refTemp: REF_C,
      freezePoint: null,
      verified: true,          // the engineer's own numbers, not ours to doubt
      editable: true,
      source: 'User-defined.'
    }
  };

  FD.fluids = {
    all: FLUIDS,
    REF_C: REF_C,

    get: function (key) { return FLUIDS[key] || FLUIDS.water; },

    keys: function () { return Object.keys(FLUIDS); },

    /* Every fluid whose properties have not been checked against a source. The
     * UI asks for this rather than reading `verified` itself, so there is one
     * place to change when Michael confirms them. */
    unverified: function () {
      return Object.keys(FLUIDS)
        .filter(function (k) { return FLUIDS[k].verified === false; })
        .map(function (k) { return FLUIDS[k]; });
    },

    isEditable: function (key) { return !!(FLUIDS[key] && FLUIDS[key].editable); },

    /* Settings → the four numbers, honouring a Custom fluid's own values.
     * A named fluid ignores whatever is stored on the model: the properties
     * belong to the fluid, not to the file. */
    resolve: function (settings) {
      var f = (settings && settings.fluid) || {};
      var base = FLUIDS[f.preset] || FLUIDS.water;
      if (!base.editable) {
        return {
          key: base.key, name: base.name,
          density: base.density,
          kinematicViscosity: base.kinematicViscosity,
          specificHeat: base.specificHeat,
          refTemp: base.refTemp,
          verified: base.verified !== false
        };
      }
      return {
        key: 'custom',
        name: f.name || base.name,
        density: f.density > 0 ? f.density : base.density,
        kinematicViscosity: f.kinematicViscosity > 0
          ? f.kinematicViscosity : base.kinematicViscosity,
        specificHeat: f.specificHeat > 0 ? f.specificHeat : base.specificHeat,
        refTemp: f.temperature !== undefined ? f.temperature : base.refTemp,
        verified: true
      };
    }
  };
})(window.FD = window.FD || {});
