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

  /* ---------------------------------------------------- NFPA 13 equivalent length
   *
   * SOURCE: NFPA 13 (2019), Table 27.2.3.1.1 "Equivalent Schedule 40 Steel Pipe
   * Length Chart". Supplied by Michael 2026-08-02 and transcribed from that
   * page; re-transcribed independently into engine.test.js so a drift here
   * fails a test.
   *
   * This REPLACES the L/D basis for Hazen-Williams. The table gives an
   * equivalent length in metres directly against NOMINAL size — it is not a
   * ratio — so nothing is multiplied by a bore. The metric column is stored,
   * not the feet column: the model is metric throughout and imperial is a
   * display conversion (spec §2). Note the two are the source's own roundings
   * of each other (13 ft is printed as 4 m), so converting one into the other
   * would not reproduce the page.
   *
   * WHAT IS NOT HERE, and why (Michael, 2026-08-02):
   *
   *   - 90° long-turn elbow, butterfly valve, gate valve, vane-type flow
   *     switch and swing check are all in the printed table and are left out.
   *     The app does not infer any of them from geometry, and VALVES are
   *     modelled by flow coefficient (Kv, data/valves.js), not by equivalent
   *     length. Carrying rows the calculation cannot reach would invite
   *     entering numbers into something that is being ignored.
   *
   *   - Sizes below 25 mm. The printed table has ½ in (15 mm) and ¾ in (20 mm)
   *     columns; the app's table starts at 25 mm at Michael's instruction.
   *     A pipe smaller than 25 mm therefore CLAMPS to the 25 mm value, which
   *     overstates it — NFPA gives 0.3 m for a 15 mm 90° elbow against 0.6 m at
   *     25 mm. The steel schedules do offer DN15 and DN20, so this is worth
   *     revisiting; the UI says so rather than leaving it to be discovered.
   *
   *   - Tee or cross with flow STRAIGHT THROUGH. NFPA 13 charges only "flow
   *     turned 90°" and has no row for the run, because a sprinkler
   *     calculation does not need one. That row therefore comes from a
   *     DIFFERENT SOURCE — the Carrier Design Handbook, supplied by Michael
   *     2026-08-02 — and is marked with an asterisk in the UI and named in a
   *     note above the NFPA source line. It is the one row on the page that is
   *     not NFPA 13, and it must stay visibly so. */
  var NFPA_DN = [25, 32, 40, 50, 65, 80, 90, 100, 125, 150, 200, 250, 300];

  /* Metres, in NFPA_DN order. `null` = not tabulated / awaiting a value. */
  var NFPA_EL = {
    // 45° elbow
    E45:     [0.3, 0.3, 0.6, 0.6, 0.9, 0.9, 0.9, 1.2, 1.5, 2.1, 2.7, 3.3, 4.0],
    // 90° standard elbow
    E90:     [0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 3.0, 3.7, 4.3, 5.5, 6.7, 8.2],
    // Tee or cross (flow turned 90°)
    TBRANCH: [1.5, 1.8, 2.4, 3.0, 3.7, 4.6, 5.2, 6.1, 7.6, 9.1, 10.7, 15.2, 18.3],
    /* Tee or cross, flow STRAIGHT THROUGH — Carrier Design Handbook, not
     * NFPA 13. Supplied by Michael 2026-08-02, in metres as given. NFPA has no
     * such row: a sprinkler calculation does not need one.
     *
     * Sanity check on the mapping, worth recording. Carrier's own
     * "T (Flow Thru)" column is the SAME data as NFPA's "flow turned 90°" row
     * at most sizes — 1.52 against 1.5 m at DN25, 18.29 against 18.3 at DN300,
     * i.e. 5 ft and 60 ft in both — so Carrier's "T (Straight)" is
     * unambiguously the run, and it is the smaller of the two throughout. */
    TRUN:    [0.52, 0.70, 0.79, 1.01, 1.25, 1.52, 1.80, 2.04, 2.50, 3.05, 3.96, 4.88, 5.79]
  };

  var NFPA_SOURCE = 'NFPA 13 (2019) Table 27.2.3.1.1';

  /* Rows whose values do NOT come from NFPA_SOURCE, and where they do come
   * from. The UI asterisks these and names the source. */
  var EL_ALT_SOURCE = {
    TRUN: 'Carrier Design Handbook'
  };

  /* All four tee variants read the same two NFPA rows: the table gives one
   * "flow turned 90°" figure and does not split dividing from combining, the
   * same position ASHRAE Tables 3/4 take (see ktableType). */
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
   * K tables already do. A `null` cell reads as "not charged". */
  function elLookup(row, dn_mm) {
    if (!row) return 0;
    var pts = [];
    for (var i = 0; i < NFPA_DN.length; i++) {
      if (row[i] !== null && row[i] !== undefined && row[i] !== '') {
        pts.push([NFPA_DN[i], Number(row[i])]);
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

  /* The user's edits, merged over the printed values. `overrides` is
   * settings.fittingEL — { type: { dn: metres, ... }, ... }. */
  function elRow(type, overrides) {
    var key = elTableType(type);
    var base = NFPA_EL[key];
    if (!base) return null;
    var ov = overrides && overrides[key];
    if (!ov) return base;
    return NFPA_DN.map(function (dn, i) {
      var v = ov[dn];
      if (v === undefined || v === null || v === '') return base[i];
      return isFinite(Number(v)) ? Number(v) : base[i];
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

    NFPA_DN: NFPA_DN,
    NFPA_EL: NFPA_EL,
    NFPA_SOURCE: NFPA_SOURCE,
    EL_ALT_SOURCE: EL_ALT_SOURCE,
    EL_NOTE: 'Note: Equivalent Length for Straight-Through tees taken from ' +
             'Carrier Design Handbook as not required for NFPA calculations',
    elTableType: elTableType,
    elRow: elRow,

    /* Which fittings the equivalent-length table actually offers, in the order
     * they are shown. Valves are absent on purpose — they are modelled by flow
     * coefficient, not equivalent length. */
    elTypes: function () { return ['E45', 'E90', 'TBRANCH', 'TRUN']; },

    /* Equivalent length in metres for one fitting of `type` on a pipe of
     * NOMINAL size `nominal_mm`.
     *
     * NOMINAL, not bore — the same trap as the K tables. These are different
     * numbers and confusing them is a real hazard: HDPE "110 mm" is an OUTSIDE
     * diameter with a 90 mm bore, so keying on the bore lands two rows off.
     * Under the old L/D basis the bore was correct, because the answer was a
     * multiple of it; under a table keyed on designation it is not.
     *
     * `overrides` is settings.fittingEL. */
    el: function (type, nominal_mm, overrides) {
      var v = elLookup(elRow(type, overrides), nominal_mm);
      return isFinite(v) ? v : 0;
    },

    /* Printed NFPA values as a fresh table, for the Reset button. */
    defaultEL: function () {
      var out = {};
      Object.keys(NFPA_EL).forEach(function (t) {
        out[t] = {};
        NFPA_DN.forEach(function (dn, i) { out[t][dn] = NFPA_EL[t][i]; });
      });
      return out;
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
