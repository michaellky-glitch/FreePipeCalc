/* FreePipeCalc — fitting resistance coefficients K (for Darcy-Weisbach)
 *
 * Darcy-Weisbach charges fitting losses as velocity heads rather than as
 * equivalent lengths:
 *
 *     Δp = K · ρ · V²/2        h = K · V²/2g
 *
 * SOURCE: ASHRAE Handbook — Fundamentals, Pipe Sizing chapter, Table 1
 * (threaded fittings) and Table 2 (flanged/welded fittings). Transcribed from
 * two independent copies of the chapter and cross-checked.
 *
 * PROVENANCE WARNINGS — read before trusting these numbers:
 *
 *  1. Threaded 45° elbow. Both transcriptions returned a column identical to
 *     the 90° elbow, which is physically wrong (a 45° bend is roughly half a
 *     90°) and is almost certainly a column-duplication artifact in the
 *     extraction. Rather than ship a value known to be wrong, the threaded 45°
 *     row here is DERIVED as 0.53 × the 90° value — the ratio implied by the
 *     Crane TP-410 L/D basis (16 D vs 30 D). Flagged `derived: true`.
 *     Replace from a printed copy of the table when one is to hand.
 *
 *  2. Threaded 2 in tee-branch. One copy reads 1.4, the other 1.6. 1.4 is used
 *     because it keeps the column monotonic (2.7 → 1.1 across the range);
 *     1.6 would create an implausible plateau against the 1.5 in value of 1.6.
 *
 * Everything else agreed between both copies.
 *
 * K is size-dependent, so each fitting carries a curve against nominal bore
 * and is interpolated. ASHRAE notes threaded 90° elbows vary ±20 % above 2 in
 * and ±40 % below 2 in depending on the exact fitting pattern — so treat all
 * of this as indicative, and override per project where it matters.
 */
(function (FD) {
  'use strict';

  // Nominal size (in) → nominal DN (mm), for keying the curves.
  var DN = {
    0.375: 10, 0.5: 15, 0.75: 20, 1: 25, 1.25: 32, 1.5: 40,
    2: 50, 2.5: 65, 3: 80, 4: 100, 6: 150, 8: 200, 10: 250, 12: 300
  };

  function curve(pairs) {
    // pairs: [[nominal_in, K], ...] → [[dn_mm, K], ...] sorted ascending
    return pairs.map(function (p) { return [DN[p[0]], p[1]]; })
                .sort(function (a, b) { return a[0] - b[0]; });
  }

  /* ASHRAE Table 1 — threaded (screwed) fittings */
  var THREADED = {
    E90:     curve([[0.375, 2.5], [0.5, 2.1], [0.75, 1.7], [1, 1.5], [1.25, 1.3],
                    [1.5, 1.2], [2, 1.0], [2.5, 0.85], [3, 0.80], [4, 0.70]]),
    TRUN:    curve([[0.375, 0.90], [0.5, 0.90], [0.75, 0.90], [1, 0.90], [1.25, 0.90],
                    [1.5, 0.90], [2, 0.90], [2.5, 0.90], [3, 0.90], [4, 0.90]]),
    TBRANCH: curve([[0.375, 2.7], [0.5, 2.4], [0.75, 2.1], [1, 1.8], [1.25, 1.7],
                    [1.5, 1.6], [2, 1.4], [2.5, 1.3], [3, 1.2], [4, 1.1]]),
    GATE:    curve([[0.375, 0.40], [0.5, 0.33], [0.75, 0.28], [1, 0.24], [1.25, 0.22],
                    [1.5, 0.19], [2, 0.17], [2.5, 0.16], [3, 0.14], [4, 0.12]]),
    GLOBE:   curve([[0.375, 20], [0.5, 14], [0.75, 10], [1, 9], [1.25, 8.5],
                    [1.5, 8], [2, 7], [2.5, 6.5], [3, 6], [4, 5.7]]),
    CHECK:   curve([[0.375, 8.0], [0.5, 5.5], [0.75, 3.7], [1, 3.0], [1.25, 2.7],
                    [1.5, 2.5], [2, 2.3], [2.5, 2.2], [3, 2.1], [4, 2.0]])
  };
  // Derived, not transcribed — see provenance note 1 above.
  THREADED.E45 = THREADED.E90.map(function (p) {
    return [p[0], Math.round(p[1] * 0.53 * 100) / 100];
  });

  /* ASHRAE Table 2 — flanged / welded fittings */
  var FLANGED = {
    E90:     curve([[1, 0.43], [1.25, 0.41], [1.5, 0.40], [2, 0.38], [2.5, 0.35],
                    [3, 0.34], [4, 0.31], [6, 0.29], [8, 0.27], [10, 0.25], [12, 0.24]]),
    E45:     curve([[1, 0.22], [1.25, 0.22], [1.5, 0.21], [2, 0.20], [2.5, 0.19],
                    [3, 0.18], [4, 0.18], [6, 0.17], [8, 0.17], [10, 0.16], [12, 0.16]]),
    TRUN:    curve([[1, 0.26], [1.25, 0.25], [1.5, 0.23], [2, 0.20], [2.5, 0.18],
                    [3, 0.17], [4, 0.15], [6, 0.12], [8, 0.10], [10, 0.09], [12, 0.08]]),
    TBRANCH: curve([[1, 1.0], [1.25, 0.95], [1.5, 0.90], [2, 0.84], [2.5, 0.79],
                    [3, 0.76], [4, 0.70], [6, 0.62], [8, 0.58], [10, 0.53], [12, 0.50]]),
    GATE:    curve([[1.5, 0.34], [2, 0.27], [2.5, 0.22], [3, 0.16], [4, 0.10],
                    [6, 0.08], [8, 0.06], [10, 0.05], [12, 0.05]]),
    GLOBE:   curve([[1, 13], [1.25, 12], [1.5, 10], [2, 9], [2.5, 8], [3, 7],
                    [4, 6.5], [6, 6], [8, 5.7], [10, 5.7], [12, 5.7]]),
    CHECK:   curve([[1, 2.0], [1.25, 2.0], [1.5, 2.0], [2, 2.0], [2.5, 2.0], [3, 2.0],
                    [4, 2.0], [6, 2.0], [8, 2.0], [10, 2.0], [12, 2.0]])
  };

  var SETS = {
    threaded: { name: 'Threaded / screwed (ASHRAE Table 1)', data: THREADED },
    flanged:  { name: 'Flanged / welded (ASHRAE Table 2)',   data: FLANGED }
  };

  /* Linear interpolation on nominal bore, clamped at both ends — K curves are
   * shallow and nearly flat at the large end, so extrapolating would add error
   * for no benefit. */
  function interp(points, dn_mm) {
    if (!points || !points.length) return 0;
    if (dn_mm <= points[0][0]) return points[0][1];
    var last = points[points.length - 1];
    if (dn_mm >= last[0]) return last[1];
    for (var i = 1; i < points.length; i++) {
      if (dn_mm <= points[i][0]) {
        var a = points[i - 1], b = points[i];
        var t = (dn_mm - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  FD.ktable = {
    sets: SETS,
    DN: DN,

    /* K for `type` at nominal bore `dn_mm`, from the chosen connection set.
     * `overrides` is the user's edited table (settings.fittingK), keyed
     * type → flat K, which wins over the curve when present. */
    k: function (type, dn_mm, setKey, overrides) {
      if (overrides && overrides[type] !== undefined && overrides[type] !== null &&
          overrides[type] !== '') {
        return Number(overrides[type]);
      }
      var set = SETS[setKey] || SETS.threaded;
      return interp(set.data[type], dn_mm);
    },

    /* The size-interpolated defaults, for showing in an editable table. */
    defaults: function (setKey, dn_mm) {
      var set = SETS[setKey] || SETS.threaded;
      var out = {};
      Object.keys(set.data).forEach(function (t) {
        out[t] = Math.round(interp(set.data[t], dn_mm) * 1000) / 1000;
      });
      return out;
    },

    isDerived: function (type, setKey) {
      return (setKey || 'threaded') === 'threaded' && type === 'E45';
    },

    interp: interp
  };
})(window.FD = window.FD || {});
