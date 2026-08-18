/* FreePipeCalc — domestic-water plumbing data (IPC 2018 Appendix E)
 *
 * The Domestic Water module sizes a plumbing branch from FIXTURE UNITS, not from
 * a continuity solve: each fixture contributes a cold-water supply fixture unit
 * (FU), the FUs downstream of a pipe are summed, and the total is converted to a
 * probable simultaneous DEMAND through a diversity curve. The curve is
 * deliberately sub-additive — two 10-FU branches do not add to a 20-FU flow —
 * which is why a plumbing network legitimately does NOT balance. See
 * docs/DW-MODULE.md.
 *
 * ============================================================================
 * PROVENANCE — verified per table
 * ============================================================================
 * Transcribed from the International Plumbing Code 2018, Appendix E:
 *   - fixture cold FU: Table E103.3(2), "FV (Cold)" column only;
 *   - the demand curves: Table E103.3(3), the GALLONS-PER-MINUTE columns for the
 *     two systems (predominantly flush tanks / predominantly flushometer valves).
 * The CFM column is not carried (gpm is what sizing needs). Nothing here is
 * derived or interpolated at rest, only transcribed.
 *
 * `FD.plumbing.verified` is PER TABLE: { fixtures, demand, supply }. Michael
 * signed off all three — fixtures E103.3(2) on 2026-08-16, and the demand curves
 * E103.3(3) + the 604.3 supply outlets on 2026-08-18. The tables stay editable
 * per model on the HYDRAULIC tab; an in-app edit overrides a cell for that model
 * but does not change the shipped default.
 *
 * A fixture that the table splits by occupancy and/or supply control carries one
 * VARIATION per row (Private / Public, flush tank / flush valve), each with its
 * own FU; the engineer picks the variation on the outflow. `Custom` carries no
 * variation — the FU is typed. Two rows of Table E103.3(2) are NOT carried
 * because their FV (Cold) is blank ("—"): the dishwashing machine.
 *
 * ONE TRANSCRIPTION FIX, flagged not silent: the supplied table labelled the
 * private water-closet flush-tank row's Variation "Ppublic (Flush Tank)", while
 * its Occupancy column reads Private and the value 2.2 is the private flush-tank
 * figure. Read as a typo for "Private (Flush Tank)". Michael to confirm.
 */
(function (FD) {
  'use strict';

  /* 1 US gallon per minute in m³/s (SI, as everything else in the engine).
   * 1 US gal = 3.785411784 L, so 1 gpm = 3.785411784 / 60000 m³/s. */
  var GPM_TO_M3S = 3.785411784 / 60000;      // = 6.309019640e-5
  /* 1 psi in Pa (IPC 604.3 footnote: 1 psi = 6.895 kPa; exact 6894.757 Pa). */
  var PSI_TO_PA = 6894.757;

  /* Cold-water supply fixture units, Table E103.3(2), "FV (Cold)". Each fixture
   * lists its VARIATIONS (occupancy × supply control); a single-variation
   * fixture still lists one so the UI is uniform. `custom` has none — the
   * engineer types the FU. `tag` is the auto-tag prefix a placed outflow of this
   * fixture takes (Michael, 2026-08-17), e.g. WC-1, UR-1. Order follows the
   * code's alphabetical table. */
  var FIXTURES = [
    { id: 'custom', name: 'Custom', tag: 'OF' },
    { id: 'bathroomGroup', name: 'Bathroom group', tag: 'BG', variations: [
      { id: 'privTank',  name: 'Private (flush tank)',  fu: 2.7 },
      { id: 'privValve', name: 'Private (flush valve)', fu: 6.0 }
    ] },
    { id: 'bathtub', name: 'Bathtub', tag: 'BA', variations: [
      { id: 'priv', name: 'Private', fu: 1.0 },
      { id: 'pub',  name: 'Public',  fu: 3.0 }
    ] },
    { id: 'bidet', name: 'Bidet', tag: 'BT', variations: [
      { id: 'priv', name: 'Private', fu: 1.5 }
    ] },
    { id: 'drinkingFountain', name: 'Drinking fountain', tag: 'DF', variations: [
      { id: 'pub', name: 'Public (⅜″ valve)', fu: 0.25 }
    ] },
    { id: 'kitchenSink', name: 'Kitchen sink', tag: 'KS', variations: [
      { id: 'priv', name: 'Private', fu: 1.0 },
      { id: 'pub',  name: 'Public (hotel/restaurant)', fu: 3.0 }
    ] },
    { id: 'lavatory', name: 'Lavatory/Hand Basin', tag: 'HB', variations: [
      { id: 'priv', name: 'Private', fu: 0.5 },
      { id: 'pub',  name: 'Public',  fu: 1.5 }
    ] },
    { id: 'serviceSink', name: 'Service sink', tag: 'SS', variations: [
      { id: 'pub', name: 'Public', fu: 2.25 }
    ] },
    { id: 'shower', name: 'Shower head', tag: 'SH', variations: [
      { id: 'priv', name: 'Private', fu: 1.0 },
      { id: 'pub',  name: 'Public',  fu: 3.0 }
    ] },
    { id: 'urinal', name: 'Urinal', tag: 'UR', variations: [
      { id: 'pubTank',  name: 'Public (flush tank)',  fu: 3.0 },
      { id: 'pubValve', name: 'Public (1″ flush valve)', fu: 10.0 }
    ] },
    { id: 'washingMachine', name: 'Washing machine', tag: 'WM', variations: [
      { id: 'priv8',  name: 'Private (8 lb)',  fu: 1.0 },
      { id: 'pub15',  name: 'Public (15 lb)',  fu: 3.0 }
    ] },
    /* Dishwashing machine — Table E103.3(2) leaves its cold FV blank ("—"), so it
     * carries no cold fixture units (fu:0) and adds nothing to the diversified
     * FU sizing; it is here for its undiversified 604.3 flow (Michael, 2026-08-17). */
    { id: 'dishwashingMachine', name: 'Dishwashing machine', tag: 'DW', variations: [
      { id: 'priv', name: 'Private', fu: 0 }
    ] },
    { id: 'waterCloset', name: 'Water closet', tag: 'WC', variations: [
      { id: 'privTank',  name: 'Private (flush tank)',  fu: 2.2 },
      { id: 'privValve', name: 'Private (flush valve)', fu: 6.0 },
      { id: 'pubTank',   name: 'Public (flush tank)',   fu: 5.0 },
      { id: 'pubValve',  name: 'Public (flush valve)',  fu: 10.0 }
    ] }
  ];

  /* The two demand curves — Table E103.3(3), [load FU, demand gpm]. The
   * flushometer curve is undefined below 5 FU in the code (a single flushometer
   * valve is already ≥ 5), so it starts there. */
  var DEMAND = {
    flushTank: [
      [1, 3.0], [2, 5.0], [3, 6.5], [4, 8.0], [5, 9.4], [6, 10.7], [7, 11.8],
      [8, 12.8], [9, 13.7], [10, 14.6], [11, 15.4], [12, 16.0], [13, 16.5],
      [14, 17.0], [15, 17.5], [16, 18.0], [17, 18.4], [18, 18.8], [19, 19.2],
      [20, 19.6], [25, 21.5], [30, 23.3], [35, 24.9], [40, 26.3], [45, 27.7],
      [50, 29.1], [60, 32.0], [70, 35.0], [80, 38.0], [90, 41.0], [100, 43.5],
      [120, 48.0], [140, 52.5], [160, 57.0], [180, 61.0], [200, 65.0],
      [225, 70.0], [250, 75.0], [275, 80.0], [300, 85.0], [400, 105.0],
      [500, 124.0], [750, 170.0], [1000, 208.0], [1250, 239.0], [1500, 269.0],
      [1750, 297.0], [2000, 325.0], [2500, 380.0], [3000, 433.0], [4000, 525.0],
      [5000, 593.0]
    ],
    flushometer: [
      [5, 15.0], [6, 17.4], [7, 19.8], [8, 22.2], [9, 24.6], [10, 27.0],
      [11, 27.8], [12, 28.6], [13, 29.4], [14, 30.2], [15, 31.0], [16, 31.8],
      [17, 32.6], [18, 33.4], [19, 34.2], [20, 35.0], [25, 38.0], [30, 42.0],
      [35, 44.0], [40, 46.0], [45, 48.0], [50, 50.0], [60, 54.0], [70, 58.0],
      [80, 61.2], [90, 64.3], [100, 67.5], [120, 73.0], [140, 77.0], [160, 81.0],
      [180, 85.5], [200, 90.0], [225, 95.5], [250, 101.0], [275, 104.5],
      [300, 108.0], [400, 127.0], [500, 143.0], [750, 177.0], [1000, 208.0],
      [1250, 239.0], [1500, 269.0], [1750, 297.0], [2000, 325.0], [2500, 380.0],
      [3000, 433.0], [4000, 525.0], [5000, 593.0]
    ]
  };

  var SYSTEMS = [
    { id: 'flushTank',   name: 'Flush tank' },
    { id: 'flushometer', name: 'Flushometer valve' }
  ];

  /* ==========================================================================
   * FIXTURE SUPPLY OUTLETS — IPC Table 604.3 (transcribed verbatim, verified)
   * ==========================================================================
   * The UNDIVERSIFIED flow a single fixture supply outlet draws, and the flow
   * PRESSURE it needs at the outlet. This is a DIFFERENT taxonomy from the
   * fixture-unit table E103.3(2): sizing uses FU + diversity (E103.3), while a
   * SIMULATION pushes each fixture's undiversified 604.3 flow through the pipes,
   * and the residual-pressure check compares the pressure delivered against the
   * 604.3 flow pressure. A plumbing outflow therefore carries BOTH a fixture
   * (for FU) and a supply outlet (for undiversified flow + required pressure);
   * they are chosen independently rather than mapped, so no correspondence is
   * invented. `gpm`/`psi` are the source units, converted at the edge.
   * SI footnote as printed: 1 psi = 6.895 kPa, 1 gpm = 3.785 L/m. */
  var FIXTURE_SUPPLY = [
    { id: 'none',              name: '(none)',                                          gpm: 0,    psi: 0  },
    { id: 'bathtubMix',        name: 'Bathtub, mixing valve',                           gpm: 4,    psi: 20 },
    { id: 'bidet',             name: 'Bidet, thermostatic mixing valve',                gpm: 2,    psi: 20 },
    { id: 'combination',       name: 'Combination fixture',                             gpm: 4,    psi: 8  },
    { id: 'dishwasher',        name: 'Dishwasher, residential',                         gpm: 2.75, psi: 8  },
    { id: 'drinkingFountain',  name: 'Drinking fountain',                               gpm: 0.75, psi: 8  },
    { id: 'laundryTray',       name: 'Laundry tray',                                    gpm: 4,    psi: 8  },
    { id: 'lavatoryPrivate',   name: 'Lavatory, private',                               gpm: 0.8,  psi: 8  },
    { id: 'lavatoryPrivMix',   name: 'Lavatory, private, mixing valve',                 gpm: 0.8,  psi: 8  },
    { id: 'lavatoryPublic',    name: 'Lavatory, public',                                gpm: 0.4,  psi: 8  },
    { id: 'shower',            name: 'Shower',                                          gpm: 2.5,  psi: 8  },
    { id: 'showerMix',         name: 'Shower, mixing valve',                            gpm: 2.5,  psi: 20 },
    { id: 'sillcock',          name: 'Sillcock, hose bibb',                             gpm: 5,    psi: 8  },
    { id: 'sinkResidential',   name: 'Sink, residential',                               gpm: 1.75, psi: 8  },
    { id: 'sinkService',       name: 'Sink, service',                                   gpm: 3,    psi: 8  },
    { id: 'urinalValve',       name: 'Urinal, valve',                                   gpm: 12,   psi: 25 },
    { id: 'wcBlowoutValve',    name: 'Water closet, blow out, flushometer valve',       gpm: 25,   psi: 45 },
    { id: 'wcFlushometerTank', name: 'Water closet, flushometer tank',                  gpm: 1.6,  psi: 20 },
    { id: 'wcSiphonicValve',   name: 'Water closet, siphonic, flushometer valve',       gpm: 25,   psi: 35 },
    { id: 'wcTankCloseCoupled',name: 'Water closet, tank, close coupled',               gpm: 3,    psi: 20 },
    { id: 'wcTankOnePiece',    name: 'Water closet, tank, one piece',                   gpm: 6,    psi: 20 }
  ];

  function fixtureSupply(id) {
    for (var i = 0; i < FIXTURE_SUPPLY.length; i++) {
      if (FIXTURE_SUPPLY[i].id === id) return FIXTURE_SUPPLY[i];
    }
    return null;
  }

  /* DEFAULT design flow & pressure for each E103.3(2) fixture variation, mapped
   * to Table 604.3 (Michael's spreadsheet, 2026-08-17). Each entry is either a
   * DIRECT map to a 604.3 outlet (`id`), or an ESTIMATE derived from 604.3
   * outlets for fixtures/variations that 604.3 does not list directly:
   *   estimate 'group'   — largest two of the part flows, highest of their psi
   *                        (a bathroom group = lavatory + shower + WC).
   *   estimate 'ratio'   — base outlet flow × (FU of this variation ÷ FU of the
   *                        base variation), at the base outlet's psi.
   *   estimate 'flowAtP' — a base outlet's flow, but at a stated pressure (Pa).
   * The model resolves these against the (editable) 604.3 values, so an estimate
   * tracks edits to the outlets it is built from. Estimated entries are shown in
   * RED with a footnote — they were not in 604.3. */
  var DEFAULT_SPEC = {
    'bathroomGroup.privTank':  { estimate: 'group', parts: ['lavatoryPrivate', 'showerMix', 'wcFlushometerTank'], label: 'Bathroom group (largest 2 of lavatory + shower + WC)' },
    'bathroomGroup.privValve': { estimate: 'group', parts: ['lavatoryPrivate', 'showerMix', 'wcBlowoutValve'],    label: 'Bathroom group (largest 2 of lavatory + shower + WC)' },
    'bathtub.priv': { id: 'bathtubMix' },
    'bathtub.pub':  { id: 'bathtubMix' },
    'bidet.priv':   { id: 'bidet' },
    'drinkingFountain.pub': { id: 'drinkingFountain' },
    'kitchenSink.priv': { id: 'sinkResidential' },
    'kitchenSink.pub':  { estimate: 'ratio', of: 'sinkResidential', numer: 'pub', denom: 'priv', label: 'Estimated — Sink residential × FU ratio' },
    'lavatory.priv': { id: 'lavatoryPrivate' },
    'lavatory.pub':  { id: 'lavatoryPublic' },
    'serviceSink.pub': { id: 'sinkService' },
    'shower.priv': { id: 'showerMix' },
    'shower.pub':  { estimate: 'ratio', of: 'showerMix', numer: 'pub', denom: 'priv', label: 'Estimated — Shower mixing valve × FU ratio' },
    'urinal.pubTank':  { id: 'urinalValve' },
    'urinal.pubValve': { id: 'urinalValve' },
    'washingMachine.priv8': { estimate: 'flowAtP', flowOf: 'lavatoryPrivate', psiPa: 100000, label: 'Estimated — Lavatory flow @ 100 kPa' },
    'washingMachine.pub15': { estimate: 'flowAtP', flowOf: 'sinkService',     psiPa: 100000, label: 'Estimated — Service sink flow @ 100 kPa' },
    'dishwashingMachine.priv': { id: 'dishwasher' },
    'waterCloset.privTank':  { id: 'wcFlushometerTank' },
    'waterCloset.privValve': { id: 'wcBlowoutValve' },
    'waterCloset.pubTank':   { id: 'wcTankCloseCoupled' },
    'waterCloset.pubValve':  { id: 'wcBlowoutValve' }
  };
  function defaultSpec(fixtureId, variationId) {
    return DEFAULT_SPEC[fixtureId + '.' + variationId] || null;
  }

  function fixture(id) {
    for (var i = 0; i < FIXTURES.length; i++) if (FIXTURES[i].id === id) return FIXTURES[i];
    return null;
  }

  /* The auto-tag prefix for an outflow of this fixture (WC, UR, HB, …), falling
   * back to the generic outflow prefix. */
  function tagPrefix(fixtureId) {
    var f = fixture(fixtureId);
    return (f && f.tag) || 'OF';
  }

  /* The variations a fixture offers (empty for custom / unknown). */
  function variations(fixtureId) {
    var f = fixture(fixtureId);
    return (f && f.variations) ? f.variations : [];
  }

  /* Resolve a variation on a fixture. An unknown / missing variation id falls
   * back to the fixture's FIRST variation, so a stale id (e.g. after switching
   * fixture) still yields a defined value rather than nothing. */
  function variation(fixtureId, variationId) {
    var vs = variations(fixtureId);
    if (!vs.length) return null;
    for (var i = 0; i < vs.length; i++) if (vs[i].id === variationId) return vs[i];
    return vs[0];
  }

  /* The cold FU of ONE of this fixture in the chosen variation. `custom` (no
   * variations) returns null — the caller supplies the FU. */
  function fixtureFU(fixtureId, variationId) {
    var v = variation(fixtureId, variationId);
    return v ? v.fu : null;
  }

  /* Total FU → probable demand, in gpm. Piecewise-linear between the tabulated
   * points; clamped to the ends of the curve (the code does not define beyond
   * them). Zero FU is zero flow.
   *
   * `curveOverride` — an optional [[fu, gpm], …] array. When the model carries a
   * user-edited demand curve (the editable table on the plumbing HYDRAULIC tab)
   * the caller passes it here; otherwise the built-in IPC curve for the system
   * is used. data/ stays model-agnostic: it never reaches into settings, it is
   * handed the curve to interpolate. */
  function fuToFlowGpm(totalFU, system, curveOverride) {
    var curve = curveOverride || DEMAND[system] || DEMAND.flushTank;
    if (!curve.length) return 0;
    if (!(totalFU > 0)) return 0;
    if (totalFU <= curve[0][0]) return curve[0][1];
    var last = curve[curve.length - 1];
    if (totalFU >= last[0]) return last[1];
    for (var i = 1; i < curve.length; i++) {
      if (totalFU <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        var t = (totalFU - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  function fuToFlow(totalFU, system, curveOverride) {
    return fuToFlowGpm(totalFU, system, curveOverride) * GPM_TO_M3S;
  }

  FD.plumbing = {
    /* Per-table sign-off. Fixtures (E103.3(2)) verified by Michael 2026-08-16;
     * the demand curves (E103.3(3)) and the supply outlets (604.3) are still
     * transcribed-not-confirmed. */
    verified: { fixtures: true, demand: true, supply: true },
    GPM_TO_M3S: GPM_TO_M3S,
    PSI_TO_PA: PSI_TO_PA,
    fixtures: FIXTURES,
    systems: SYSTEMS,
    demand: DEMAND,
    supplies: FIXTURE_SUPPLY,
    fixture: fixture,
    fixtureSupply: fixtureSupply,
    defaultSpec: defaultSpec,
    tagPrefix: tagPrefix,
    variations: variations,
    variation: variation,
    fixtureFU: fixtureFU,
    fuToFlowGpm: fuToFlowGpm,
    fuToFlow: fuToFlow
  };
})(window.FD = window.FD || {});
