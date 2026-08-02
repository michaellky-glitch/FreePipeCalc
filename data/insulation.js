/* FreePipeCalc — insulation thickness
 *
 * Thickness against NOMINAL pipe size, in millimetres, used with the thermal
 * conductivity on the THERMAL tab to work out a pipe's heat loss.
 *
 * ============================================================================
 * PROVENANCE — THESE ARE PLACEHOLDERS, NOT A STANDARD
 * ============================================================================
 *
 * Michael asked for default thicknesses "based on the relevant standards"
 * (2026-08-02). The honest position is that there is no single relevant
 * standard to read off, and the table below is therefore FLAGGED and editable
 * rather than presented as sourced data.
 *
 * The reason is worth stating, because it is not pedantry. Insulation
 * thickness is not a property of the PIPE — two DN50 sch40 pipes on the same
 * job routinely carry different thicknesses. It is set by:
 *
 *   - the SERVICE and its temperature. Chilled water at 6 °C is insulated to
 *     stop condensation, and the thickness that achieves that depends on the
 *     room's humidity. LTHW at 80 °C is insulated to limit heat loss, and the
 *     economic thickness is a different calculation entirely.
 *   - the AMBIENT it runs through — a ceiling void, a riser, outdoors.
 *   - the JURISDICTION. BS 5422 in the UK, ASHRAE 90.1 tables in the US, and
 *     local energy codes elsewhere, all giving different numbers for the same
 *     pipe.
 *
 * So a number keyed on size alone cannot be right for every case, and the app
 * says so rather than implying it read one off a page. What is here is a
 * plausible mid-range for insulated building services pipework, rising with
 * size as every standard does, to give the module something to run on.
 *
 * `verified: false` drives the flag in the UI and on the CALCULATION SHEET.
 * Set your own values on the THERMAL tab, or per pipe — a pipe's own
 * `insulation_mm` always wins, including 0 for a bare pipe.
 */
(function (FD) {
  'use strict';

  var DN = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300];

  var SETS = {
    /* Rising with size, as every published table does, and stopping at 50 mm
     * because thicknesses beyond that are usually a specific calculation
     * rather than a table lookup. */
    standard: {
      key: 'standard',
      name: 'Default (placeholder)',
      verified: false,
      mm: [25, 25, 25, 30, 30, 30, 40, 40, 40, 50, 50, 50, 50, 50]
    },
    /* Everything bare. Not a fallback for "unknown" — a deliberate choice for
     * a system that genuinely has no insulation, where the pipe's own surface
     * film is the whole resistance. */
    none: {
      key: 'none',
      name: 'Uninsulated',
      verified: true,
      mm: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  };

  var DEFAULT_SET = 'standard';

  function interp(mm, dn) {
    if (dn <= DN[0]) return mm[0];
    if (dn >= DN[DN.length - 1]) return mm[mm.length - 1];
    for (var i = 1; i < DN.length; i++) {
      if (dn <= DN[i]) {
        var t = (dn - DN[i - 1]) / (DN[i] - DN[i - 1]);
        return mm[i - 1] + t * (mm[i] - mm[i - 1]);
      }
    }
    return mm[mm.length - 1];
  }

  FD.insulation = {
    DN: DN,
    SETS: SETS,
    DEFAULT_SET: DEFAULT_SET,

    setKey: function (key) { return SETS[key] ? key : DEFAULT_SET; },
    set: function (key) { return SETS[SETS[key] ? key : DEFAULT_SET]; },

    /* Thickness in MILLIMETRES for a nominal size. */
    defaultThickness: function (nominal_mm, setKey) {
      var set = SETS[setKey] || SETS[DEFAULT_SET];
      if (!(nominal_mm > 0)) return set.mm[0];
      return interp(set.mm, nominal_mm);
    },

    unverified: function () {
      return Object.keys(SETS)
        .filter(function (k) { return SETS[k].verified === false; })
        .map(function (k) { return SETS[k]; });
    }
  };
})(window.FD = window.FD || {});
