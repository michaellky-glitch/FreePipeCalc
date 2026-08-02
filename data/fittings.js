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
    /* Diverting and combining tees are NOT given different coefficients.
     *
     * Michael's decision, 2026-07-31, and it follows the source: 2021 ASHRAE
     * Fundamentals Ch 22 Tables 3 and 4 tabulate a single tee-line and a single
     * tee-branch figure and do not split the two cases. Table 7 does measure
     * them separately, but reports one "100% mix" coefficient where this model
     * charges a combining tee's two inlets independently — mapping one number
     * onto two would be an interpretation, and the previous attempt at exactly
     * that (a guessed 1.5x multiplier) is what left this open for weeks.
     *
     * So the four types stay — they still record WHICH case a tee is, which is
     * worth seeing on the calculation sheet — but the combining values now
     * equal the dividing ones, and nothing here is a placeholder any more.
     *
     * What is NOT collapsed is the charging rule: a dividing tee is charged to
     * its outlets and a combining tee to its inlets. That is a separate, real
     * correction (a combining tee used to charge nothing to its branch inflow,
     * where most of the loss is) and it stands. */
    TRUN_DIV:    { ld: 20, code: 'T-run-d', label: 'Tee, dividing — through run',
                   sourced: true },
    TBRANCH_DIV: { ld: 60, code: 'T-br-d',  label: 'Tee, dividing — to branch',
                   sourced: true },
    TRUN_CONV:   { ld: 20, code: 'T-run-c', label: 'Tee, combining — through run',
                   sourced: true },
    TBRANCH_CONV:{ ld: 60, code: 'T-br-c',  label: 'Tee, combining — from branch',
                   sourced: true },
    // Not auto-detected in v1, but the table carries them for future use.
    GATE:   { ld: 8,  code: 'GV',   label: 'Gate valve, open' },
    GLOBE:  { ld: 340,code: 'GLV',  label: 'Globe valve, open' },
    CHECK:  { ld: 100,code: 'CV',   label: 'Swing check valve' },
    ENTRY:  { ld: 20, code: 'ENT',  label: 'Sharp entry' },
    EXIT:   { ld: 35, code: 'EXT',  label: 'Exit to atmosphere' }
  };

  /* ------------------------------------------ equivalent-length tables
   *
   * THREE sets, chosen on the HYDRAULIC tab (settings.elSet):
   *
   *   'carrier' — Carrier Design Handbook, Table 11. THE DEFAULT.
   *   'nfpa13'  — NFPA 13 (2019) Table 27.2.3.1.1, with the straight-through
   *               tee taken from Carrier because NFPA has no such row.
   *   'custom'  — unlocked, seeded from whichever set was showing.
   *
   * All of them give an equivalent length against NOMINAL size. None is a
   * ratio: nothing is multiplied by a bore.
   *
   * -------------------------------------------------------------- METRIC
   * Carrier Table 11 is printed in FEET ("Fitting Losses in Equivalent Feet of
   * Pipe"), so the feet are stored and the metres derived — ft x 0.3048,
   * rounded to 2 dp. That reproduces Michael's own metric conversion of the
   * same table EXACTLY, cell for cell, which is asserted in engine.test.js.
   * Storing a hand-typed metric column instead would have been a second
   * transcription with nothing to check it against.
   *
   * NFPA 13 prints BOTH a feet and a metre column, and they are the source's
   * own independent roundings of each other (13 ft is printed as 4 m). There
   * the printed METRIC column is stored, because that is the number on the page
   * in the units this app works in.
   */
  var EL_DN = [25, 32, 40, 50, 65, 80, 90, 100, 125, 150, 200, 250, 300];

  /* Carrier Design Handbook, Table 11 — "Fitting Losses in Equivalent Feet of
   * Pipe", screwed / welded / flanged / flared / brazed connections. Supplied
   * by Michael 2026-08-02. In FEET, in EL_DN order (1" ... 12").
   *
   * Column mapping, and it is not guesswork — Michael also supplied a metric
   * extract of this same table, and these four columns reproduce it exactly:
   *   E90     <- "Smooth Bend Elbows, 90 deg Std"
   *   E45     <- "Smooth Bend Elbows, 45 deg Std"
   *   TBRANCH <- "Smooth Bend Tees, Flow-Thru Branch"
   *   TRUN    <- "Smooth Bend Tees, Straight-Thru Flow, No Reduction"
   *
   * The table's other columns — 90 deg Long Rad, 90 deg Street, 45 deg Street,
   * 180 deg Std, and the two REDUCED straight-through cases — are not carried.
   * The app infers a fitting from the angle between two pipes, so it cannot
   * tell a street elbow from a standard one or know a tee's reduction ratio;
   * offering the columns would invite a choice the geometry cannot support. */
  var CARRIER_FT = {
    E90:     [2.6, 3.3, 4.0, 5.0, 6.0, 7.5, 9.0, 10, 13, 16, 20, 25, 30],
    E45:     [1.3, 1.7, 2.1, 2.6, 3.2, 4.0, 4.7, 5.2, 6.5, 7.9, 10, 13, 16],
    TBRANCH: [5.0, 7.0, 8.0, 10, 12, 15, 18, 21, 25, 30, 40, 50, 60],
    TRUN:    [1.7, 2.3, 2.6, 3.3, 4.1, 5.0, 5.9, 6.7, 8.2, 10, 13, 16, 19]
  };

  var FT_TO_M = 0.3048;
  function ftToM(ft) { return Math.round(ft * FT_TO_M * 100) / 100; }

  var CARRIER_M = (function () {
    var out = {};
    Object.keys(CARRIER_FT).forEach(function (t) {
      out[t] = CARRIER_FT[t].map(ftToM);
    });
    return out;
  })();

  /* NFPA 13 (2019) Table 27.2.3.1.1, printed METRIC column, in EL_DN order.
   *
   * The printed table also carries a 90 deg long-turn elbow, a butterfly valve,
   * a gate valve, a vane-type flow switch and a swing check, and 1/2 in and
   * 3/4 in columns. None is carried: valves are modelled by flow coefficient
   * (data/valves.js), not equivalent length, and the app's table starts at
   * 25 mm at Michael's instruction — so a pipe below DN25 clamps to the DN25
   * figure, which overstates it. */
  var NFPA_M = {
    E45:     [0.3, 0.3, 0.6, 0.6, 0.9, 0.9, 0.9, 1.2, 1.5, 2.1, 2.7, 3.3, 4.0],
    E90:     [0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 3.0, 3.7, 4.3, 5.5, 6.7, 8.2],
    TBRANCH: [1.5, 1.8, 2.4, 3.0, 3.7, 4.6, 5.2, 6.1, 7.6, 9.1, 10.7, 15.2, 18.3],
    /* NFPA 13 has NO straight-through tee — a sprinkler calculation does not
     * need one — so this row is Carrier's even in the NFPA set, and is starred
     * and footnoted in the UI. It is the one row on that page from another
     * source, and that has to be visible on the page. */
    TRUN:    CARRIER_M.TRUN
  };

  var EL_SETS = {
    carrier: {
      key: 'carrier',
      name: 'Carrier Design Handbook',
      source: 'Carrier Design Handbook, Table 11 — Fitting Losses in ' +
              'Equivalent Feet of Pipe (converted to metric)',
      data: CARRIER_M,
      alt: {}
    },
    nfpa13: {
      key: 'nfpa13',
      name: 'NFPA 13',
      source: 'NFPA 13 (2019) Table 27.2.3.1.1',
      data: NFPA_M,
      alt: { TRUN: 'Carrier Design Handbook' },
      note: 'Note: Equivalent Length for Straight-Through tees taken from ' +
            'Carrier Design Handbook as not required for NFPA calculations'
    },
    custom: {
      key: 'custom',
      name: 'Custom',
      source: 'User-defined',
      data: null,          // supplied entirely by settings.fittingEL
      alt: {}
    }
  };

  var DEFAULT_EL_SET = 'carrier';

  function elSetKey(settings) {
    var k = settings && settings.elSet;
    return EL_SETS[k] ? k : DEFAULT_EL_SET;
  }

  /* All four tee variants read the same two rows: these tables give one
   * straight-through and one branch figure and do not split dividing from
   * combining, the same position ASHRAE Tables 3/4 take (see ktableType). */
  function elTableType(type) {
    switch (type) {
      case 'TRUN': case 'TRUN_DIV': case 'TRUN_CONV': return 'TRUN';
      case 'TBRANCH': case 'TBRANCH_DIV': case 'TBRANCH_CONV': return 'TBRANCH';
      default: return type;
    }
  }

  /* Interpolate a row against nominal size, clamping at both ends. Same shape
   * as ktable's interpolation, deliberately — a size between two tabulated
   * columns has to land somewhere, and clamping outside the table is what the
   * K tables already do. */
  function elLookup(row, dn_mm) {
    if (!row) return 0;
    var pts = [];
    for (var i = 0; i < EL_DN.length; i++) {
      if (row[i] !== null && row[i] !== undefined && row[i] !== '') {
        pts.push([EL_DN[i], Number(row[i])]);
      }
    }
    if (!pts.length) return 0;
    if (dn_mm <= pts[0][0]) return pts[0][1];
    var last = pts[pts.length - 1];
    if (dn_mm >= last[0]) return last[1];
    for (var j = 1; j < pts.length; j++) {
      if (dn_mm <= pts[j][0]) {
        var a = pts[j - 1], b = pts[j];
        var t = (dn_mm - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  /* The published row for a fitting under the active set, before any custom
   * values. Null for a set that has no published data (custom). */
  function publishedRow(type, setKey) {
    var set = EL_SETS[setKey] || EL_SETS[DEFAULT_EL_SET];
    if (!set.data) return null;
    return set.data[elTableType(type)] || null;
  }

  /* The row actually used: published, with settings.fittingEL over the top.
   *
   * CUSTOM is not a fourth table — it is whatever the engineer typed, seeded
   * from the set that was showing when they switched to it. So in custom mode
   * a missing cell has no published value to fall back to and reads as zero;
   * the UI seeds every cell on the switch so that does not arise in practice. */
  function elRow(type, settings) {
    var key = elSetKey(settings);
    var base = publishedRow(type, key);
    var ov = settings && settings.fittingEL && settings.fittingEL[elTableType(type)];
    if (!ov) return base;
    return EL_DN.map(function (dn, i) {
      var v = ov[dn];
      if (v === undefined || v === null || v === '') return base ? base[i] : null;
      return isFinite(Number(v)) ? Number(v) : (base ? base[i] : null);
    });
  }

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

    EL_DN: EL_DN,
    EL_SETS: EL_SETS,
    DEFAULT_EL_SET: DEFAULT_EL_SET,
    CARRIER_FT: CARRIER_FT,
    elSetKey: elSetKey,
    elTableType: elTableType,
    elRow: elRow,
    publishedRow: publishedRow,

    /* Which fittings the equivalent-length table offers, in display order.
     * Valves are absent on purpose — they are modelled by flow coefficient,
     * not equivalent length. */
    elTypes: function () { return ['E45', 'E90', 'TBRANCH', 'TRUN']; },

    /* The active set's descriptor: name, source line, per-row alternate
     * sources and the footnote, if any. */
    elSet: function (settings) { return EL_SETS[elSetKey(settings)]; },

    /* Every published cell of a set, as { type: { dn: metres } } — for seeding
     * CUSTOM from whatever was showing, and for the Reset button. */
    elSnapshot: function (setKey) {
      var out = {};
      var set = EL_SETS[setKey] || EL_SETS[DEFAULT_EL_SET];
      if (!set.data) return out;
      Object.keys(set.data).forEach(function (t) {
        out[t] = {};
        EL_DN.forEach(function (dn, i) { out[t][dn] = set.data[t][i]; });
      });
      return out;
    },

    /* Equivalent length in metres for one fitting of `type` on a pipe of
     * NOMINAL size `nominal_mm`.
     *
     * NOMINAL, not bore — the same trap as the K tables. These are different
     * numbers and confusing them is a real hazard: HDPE "110 mm" is an OUTSIDE
     * diameter with a 90 mm bore, so keying on the bore lands two rows off.
     * Under the old L/D basis the bore was correct, because the answer was a
     * multiple of it; under a table keyed on designation it is not.
     *
     * `settings` carries elSet and fittingEL; null means the default set with
     * no custom values. */
    el: function (type, nominal_mm, settings) {
      var v = elLookup(elRow(type, settings), nominal_mm);
      return isFinite(v) ? v : 0;
    },

    /* Default L/D values as a plain object. The L/D basis is superseded by the
     * NFPA table for Hazen-Williams and is kept only so an older saved model
     * still loads without its settings looking corrupt. */
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

    /* Which row of the ASHRAE K tables (Ch 22 Tables 3/4) a fitting type reads.
     *
     * Those tables give ONE tee-line and ONE tee-branch figure — they do not
     * split diverting from combining flow — so all four of the app's tee types
     * collapse onto two rows here. That is a faithful reading of the source,
     * not a simplification we invented.
     *
     * Table 7 DOES separate diverting from mixing, and is transcribed in
     * data/ktable.js. It is not used here yet: it reports a single "100% mix"
     * coefficient and the app charges a combining tee's two inlets separately,
     * so mapping it needs an engineering decision rather than a transcription.
     * Until that is settled, a combining tee is charged the same as a dividing
     * one, which is what Tables 3/4 support. */
    ktableType: function (type) {
      switch (type) {
        case 'TRUN': case 'TRUN_DIV': case 'TRUN_CONV': return 'TRUN';
        case 'TBRANCH': case 'TBRANCH_DIV': case 'TBRANCH_CONV': return 'TBRANCH';
        default: return type;       // E90, E45, GATE, GLOBE, CHECK map straight
      }
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
