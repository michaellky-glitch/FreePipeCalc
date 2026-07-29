/* Friction Drop — fitting equivalent lengths (ASHRAE equivalent-length method)
 *
 * Spec §3.3. Fittings are never placed by the user; they are inferred from the
 * drawn geometry at each node and charged to the DOWNSTREAM pipe.
 *
 * Equivalent length is generated on an L/D basis against the pipe INNER diameter:
 *     EL [m] = (L/D) x d [m]
 * with the L/D values given in the spec:
 *     90 deg elbow  ~ 30 D
 *     45 deg elbow  ~ 16 D
 *     tee, run      ~ 20 D
 *     tee, branch   ~ 60 D
 *
 * Sizes below DN50 run slightly higher L/D in the ASHRAE tables; the
 * `sizeFactor` curve below nudges small bores up so the generated table tracks
 * the published values instead of being flat.
 */
(function (FD) {
  'use strict';

  var LD = {
    E90:    { ld: 30, code: 'E90',  label: '90° elbow' },
    E45:    { ld: 16, code: 'E45',  label: '45° elbow' },
    /* Tees, split four ways: a dividing tee and a combining tee are different
     * fittings hydraulically and ASHRAE tabulates them separately.
     *
     * PROVENANCE — the two combining values are PLACEHOLDERS, not data.
     * `sourced: false` marks them, FD.fittings.unsourced() lists them, and the
     * HYDRAULIC tab shows the list. See docs/ENGINE.md.
     *
     *  - TRUN_DIV / TBRANCH_DIV carry the spec §3.3 values (20 D and 60 D),
     *    which are the tee-run and tee-branch figures already in use and were
     *    always implicitly the DIVIDING case: they were applied to the outlets
     *    of a tee, which is where a dividing tee charges.
     *
     *  - TRUN_CONV is assumed EQUAL to the dividing run. A stream passing
     *    straight through a tee is disturbed similarly either way. Plausible,
     *    unverified.
     *
     *  - TBRANCH_CONV is assumed 1.5x the dividing branch (90 D). The only
     *    thing asserted here with any confidence is the ORDERING — a stream
     *    entering through the branch of a combining tee loses more than one
     *    leaving through the branch of a dividing tee, because it must turn
     *    AND merge with a stream already moving. The MAGNITUDE is a guess.
     *
     * Real tee coefficients are a function of the flow ratio Qb/Qc and vary by
     * more than an order of magnitude across it. No flat number can be right
     * everywhere; these are placeholders that keep the model structurally
     * correct and the ordering sensible until a sourced set is entered. */
    TRUN:    { ld: 20, code: 'T-run',  label: 'Tee, straight through' },
    TBRANCH: { ld: 60, code: 'T-br',   label: 'Tee, branch' },
    TRUN_DIV:    { ld: 20, code: 'T-run-d', label: 'Tee, dividing — through run',
                   sourced: true },
    TBRANCH_DIV: { ld: 60, code: 'T-br-d',  label: 'Tee, dividing — to branch',
                   sourced: true },
    TRUN_CONV:   { ld: 20, code: 'T-run-c', label: 'Tee, combining — through run',
                   sourced: false,
                   note: 'Placeholder: assumed equal to the dividing run.' },
    TBRANCH_CONV:{ ld: 90, code: 'T-br-c',  label: 'Tee, combining — from branch',
                   sourced: false,
                   note: 'Placeholder: assumed 1.5x the dividing branch. Only the ' +
                         'ordering (worse than a dividing branch) is asserted; the ' +
                         'magnitude is a guess.' },
    // Not auto-detected in v1, but the table carries them for future use.
    GATE:   { ld: 8,  code: 'GV',   label: 'Gate valve, open' },
    GLOBE:  { ld: 340,code: 'GLV',  label: 'Globe valve, open' },
    CHECK:  { ld: 100,code: 'CV',   label: 'Swing check valve' },
    ENTRY:  { ld: 20, code: 'ENT',  label: 'Sharp entry' },
    EXIT:   { ld: 35, code: 'EXT',  label: 'Exit to atmosphere' }
  };

  /* NOTE (spec Q12.1): the real ASHRAE tables are not flat with size — small
   * bores run a higher L/D than large ones. A size correction was trialled and
   * deliberately REMOVED: the curve shape could not be sourced from ASHRAE, and
   * an invented correction is not defensible to a checking engineer. The flat
   * L/D basis written into spec §3.3 is used verbatim.
   *
   * To reintroduce a correction later, multiply in one factor inside el() —
   * that is the only place size would enter beyond the diameter itself. */

  /* Every coefficient that is a placeholder rather than sourced data, so the
   * app can say so out loud instead of the user having to read this file. */
  function unsourced() {
    return Object.keys(LD)
      .filter(function (k) { return LD[k].sourced === false; })
      .map(function (k) {
        return { key: k, label: LD[k].label, ld: LD[k].ld, note: LD[k].note || '' };
      });
  }

  FD.fittings = {
    types: LD,
    unsourced: unsourced,

    /* Equivalent length in metres for one fitting of `type` on a pipe of
     * inner diameter `id_mm`.
     *
     * `overrides` is settings.fittingLD — the user's editable L/D table. The
     * built-in values are only the starting point; jurisdictions and in-house
     * standards differ, so whatever is in settings wins. */
    el: function (type, id_mm, overrides) {
      var ld = (overrides && overrides[type] !== undefined && overrides[type] !== '')
        ? Number(overrides[type])
        : (LD[type] ? LD[type].ld : 0);
      if (!isFinite(ld)) return 0;
      return ld * (id_mm / 1000);
    },

    /* Default L/D values as a plain object, for seeding the editable table. */
    defaultLD: function () {
      var out = {};
      Object.keys(LD).forEach(function (k) { out[k] = LD[k].ld; });
      return out;
    },

    /* Head loss [m] for one fitting under Darcy-Weisbach, which charges
     * velocity heads rather than equivalent length:  h = K · V²/2g
     *
     * TWO diameters are needed and they are not interchangeable:
     *   nominal_mm — the size DESIGNATION, which is what the ASHRAE K table is
     *                keyed on (DN50, "110 mm", …)
     *   bore_mm    — the actual inner diameter, which sets the velocity
     * Using the bore for the lookup is subtly wrong for steel and badly wrong
     * for plastics, where the designation is an outside diameter: HDPE
     * "110 mm" has a 90 mm bore, which would land two rows off in the table. */
    headlossK: function (type, nominal_mm, bore_mm, q, setKey, overrides) {
      var d = bore_mm / 1000;
      if (!(d > 0)) return 0;
      var K = FD.ktable.k(type, nominal_mm, setKey, overrides);
      var v = Math.abs(q) / (Math.PI * d * d / 4);
      return K * v * v / (2 * 9.81);
    },

    code: function (type) {
      return LD[type] ? LD[type].code : type;
    },

    label: function (type) {
      return LD[type] ? LD[type].label : type;
    },

    /* Classify the elbow implied by an angle between two pipes.
     * `angleDeg` is the deviation from straight (0 = collinear, 90 = square). */
    elbowForAngle: function (angleDeg) {
      var a = Math.abs(angleDeg);
      if (a < 8) return null;               // effectively straight — no fitting
      if (a <= 75) return 'E45';            // 15-75 deg band per spec
      return 'E90';
    },

    /* Render a list of fitting types as the compact code string used in the
     * calculation sheet, e.g. "2xE90, T-br". */
    summarise: function (list) {
      if (!list || !list.length) return '';
      var counts = {};
      list.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      return Object.keys(counts).map(function (t) {
        var n = counts[t];
        return (n > 1 ? n + '×' : '') + FD.fittings.code(t);
      }).join(', ');
    }
  };
})(window.FD = window.FD || {});
