/* FreePipeCalc — fitting resistance coefficients K (for Darcy-Weisbach)
 *
 * Darcy-Weisbach charges fitting losses as velocity heads rather than as
 * equivalent lengths:
 *
 *     Δp = K · ρ · V²/2        h = K · V²/2g
 *
 * SOURCE: 2021 ASHRAE Handbook — Fundamentals (SI), Chapter 22 "Pipe Design",
 * Table 3 (threaded steel fittings) and Table 4 (flanged welded steel
 * fittings). Both cite Engineering Data Book, Hydraulic Institute (1990).
 *
 * Transcribed 2026-07-31 from Michael's printed copy — the FIRST time this
 * data has had a verified source. Every value below was diffed against that
 * copy; 133 of 144 matched the previous guesses exactly, and the two columns
 * that did not are recorded here because both were wrong in the app:
 *
 *  1. Threaded 45° elbow WAS DERIVED, and was wrong by up to 250 %. The old
 *     file could not read the column and synthesised it as 0.53 × the 90°
 *     value, the ratio implied by the Crane L/D basis (16 D vs 30 D). The real
 *     ASHRAE column is nearly FLAT with size (0.38 → 0.28) while the 90° column
 *     falls steeply (2.5 → 0.70), so the invented values ran from 1.33 (vs
 *     0.38) at DN10 to 0.37 (vs 0.28) at DN100. This is the "never invent
 *     engineering data" rule earning its keep — the invention was plausible,
 *     documented, flagged, and still off by 3.5x.
 *
 *     NOTE FOR REVIEW: the threaded 45° column behaves unlike the flanged one,
 *     where 45°/90° = 0.22/0.43 = 0.51, close to the L/D expectation. Flat and
 *     0.15 of the 90° at DN10 is worth a second look at the printed page.
 *
 *  2. Flanged/welded GATE VALVE was shifted one row: the app had 0.34 at DN40,
 *     ASHRAE has it at DN50, and so on down the column. Every size therefore
 *     UNDER-stated gate loss by 17–38 % (DN100: app 0.10 vs ASHRAE 0.16).
 *
 * Confirmed by the same check: threaded DN50 tee-branch is 1.4, not 1.6 — the
 * old file picked 1.4 on a monotonicity argument and was right.
 *
 * UNCERTAINTY (Table 5, "Approximate Range of Variation"). These are not
 * precise numbers and ASHRAE says so: 90° threaded elbow ±20 % above 50 mm and
 * ±40 % below; threaded tee (line or branch) ±25 %, flanged ±35 %; globe ±25 %;
 * gate threaded ±25 %, flanged ±50 %; check threaded ±50 %, flanged +200/−80 %.
 * The flanged check valve range is not a typo — treat any check valve figure as
 * indicative only.
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

  /* ASHRAE Table 3 — threaded (screwed) steel fittings */
  var THREADED = {
    E90:     curve([[0.375, 2.5], [0.5, 2.1], [0.75, 1.7], [1, 1.5], [1.25, 1.3],
                    [1.5, 1.2], [2, 1.0], [2.5, 0.85], [3, 0.80], [4, 0.70]]),
    // Transcribed, no longer derived — see provenance note 1.
    E45:     curve([[0.375, 0.38], [0.5, 0.37], [0.75, 0.35], [1, 0.34], [1.25, 0.33],
                    [1.5, 0.32], [2, 0.31], [2.5, 0.30], [3, 0.29], [4, 0.28]]),
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
  /* ASHRAE Table 4 — flanged / welded steel fittings */
  var FLANGED = {
    E90:     curve([[1, 0.43], [1.25, 0.41], [1.5, 0.40], [2, 0.38], [2.5, 0.35],
                    [3, 0.34], [4, 0.31], [6, 0.29], [8, 0.27], [10, 0.25], [12, 0.24]]),
    E45:     curve([[1, 0.22], [1.25, 0.22], [1.5, 0.21], [2, 0.20], [2.5, 0.19],
                    [3, 0.18], [4, 0.18], [6, 0.17], [8, 0.17], [10, 0.16], [12, 0.16]]),
    TRUN:    curve([[1, 0.26], [1.25, 0.25], [1.5, 0.23], [2, 0.20], [2.5, 0.18],
                    [3, 0.17], [4, 0.15], [6, 0.12], [8, 0.10], [10, 0.09], [12, 0.08]]),
    TBRANCH: curve([[1, 1.0], [1.25, 0.95], [1.5, 0.90], [2, 0.84], [2.5, 0.79],
                    [3, 0.76], [4, 0.70], [6, 0.62], [8, 0.58], [10, 0.53], [12, 0.50]]),
    /* Was shifted one row smaller — see provenance note 2. ASHRAE tabulates no
     * flanged gate valve below DN50. */
    GATE:    curve([[2, 0.34], [2.5, 0.27], [3, 0.22], [4, 0.16], [6, 0.10],
                    [8, 0.08], [10, 0.06], [12, 0.05]]),
    GLOBE:   curve([[1, 13], [1.25, 12], [1.5, 10], [2, 9], [2.5, 8], [3, 7],
                    [4, 6.5], [6, 6], [8, 5.7], [10, 5.7], [12, 5.7]]),
    CHECK:   curve([[1, 2.0], [1.25, 2.0], [1.5, 2.0], [2, 2.0], [2.5, 2.0], [3, 2.0],
                    [4, 2.0], [6, 2.0], [8, 2.0], [10, 2.0], [12, 2.0]])
  };

  var SETS = {
    threaded: { name: 'Threaded / screwed (ASHRAE Table 3)', data: THREADED },
    flanged:  { name: 'Flanged / welded (ASHRAE Table 4)',   data: FLANGED }
  };

  /* ---------------------------------------------------------------- TEES
   * 2021 ASHRAE Fundamentals Ch 22, Table 7 — "Summary of Test Data for Loss
   * Coefficients K for Steel Pipe Tees". ASHRAE research RP-968 / RP-1034
   * (Rahmeyer 1999b, 2002b; Ding et al. 2005), measured at 1.2 / 2.4 / 3.6 m/s.
   *
   * This is the data the project has been blocked on: Tables 3 and 4 give ONE
   * undifferentiated tee-line / tee-branch pair, but this table separates
   * DIVERTING flow ("100% branch", "100% line") from MIXING flow ("100% mix"),
   * which is the converging case.
   *
   * Recorded here as measured, NOT yet wired into the calculation, because two
   * things need Michael's judgement first:
   *
   *   a) What "100% mix" is the K of. Read literally it is the whole tee under
   *      full mixing; the app charges a combining tee's two INLETS separately
   *      (TRUN_CONV, TBRANCH_CONV), so mapping one measured number onto two
   *      coefficients is an interpretation, not a transcription.
   *   b) K here is a velocity head. The Hazen-Williams path in this app charges
   *      fittings as equivalent LENGTH. Mixing the two needs the composite-loss
   *      work described in ROADMAP.
   *
   * What the data already settles, whatever the mapping:
   *   - Mixing generally costs MORE than diverting through the branch
   *     (mix/branch ≈ 0.86, 1.57, 1.32, 1.48, 1.14, 1.35 at DN100…400), so the
   *     ordering the placeholders asserted is supported — average ≈ 1.3, against
   *     the 1.5 that was guessed.
   *   - Line (straight-through) loss is small and falls steeply with size,
   *     0.19 at DN50 threaded down to 0.028 at DN400 welded.
   * Velocity dependence is weak above 100 mm: DN300 branch reads 0.70 / 0.63 /
   * 0.62 across 1.2 / 2.4 / 3.6 m/s, so a flat value per size is defensible.
   */
  var TEES = {
    source: '2021 ASHRAE Fundamentals Ch 22, Table 7 (RP-968 / RP-1034)',
    /* dn_mm: { joint, branch:{v: K}, line:{v: K}, mix:{v: K} }  — v in m/s.
     * `past` is the pre-research published range, kept for comparison. */
    data: [
      { dn: 50,  joint: 'thread',
        branch: { 1.2: 0.93 }, line: { 1.2: 0.19 }, mix: { 1.2: 1.19 },
        past: { branch: [1.20, 1.80, 1.4], line: [0.50, 0.90, 0.90] } },
      { dn: 100, joint: 'weld',
        branch: { 2.4: 0.57 }, line: { 2.4: 0.06 }, mix: { 2.4: 0.49 },
        past: { branch: [0.70, 1.02, 0.70], line: [0.15, 0.34, 0.15] } },
      { dn: 150, joint: 'weld',
        branch: { 2.4: 0.56 }, line: { 2.4: 0.12 }, mix: { 2.4: 0.88 } },
      { dn: 200, joint: 'weld',
        branch: { 2.4: 0.53 }, line: { 2.4: 0.08 }, mix: { 2.4: 0.70 } },
      { dn: 250, joint: 'weld',
        branch: { 2.4: 0.52 }, line: { 2.4: 0.06 }, mix: { 2.4: 0.77 } },
      { dn: 300, joint: 'weld',
        branch: { 1.2: 0.70, 2.4: 0.63, 3.6: 0.62 },
        line:   { 1.2: 0.062, 2.4: 0.091, 3.6: 0.096 },
        mix:    { 1.2: 0.88, 2.4: 0.72, 3.6: 0.72 },
        past: { branch: [0.52], line: [0.09] } },
      { dn: 400, joint: 'weld',
        branch: { 1.2: 0.54, 2.4: 0.55, 3.6: 0.54 },
        line:   { 1.2: 0.032, 2.4: 0.028, 3.6: 0.028 },
        mix:    { 1.2: 0.74, 2.4: 0.74, 3.6: 0.76 },
        past: { branch: [0.47], line: [0.07] } }
    ]
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
    tees: TEES,

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
