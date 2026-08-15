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
 * PROVENANCE — verified: false until Michael signs it off
 * ============================================================================
 * Transcribed from the International Plumbing Code 2018, Appendix E:
 *   - fixture cold FU: Table E103.3(2), "FV (Cold)" column only;
 *   - the demand curves: Table E103.3(3), the GALLONS-PER-MINUTE columns for the
 *     two systems (predominantly flush tanks / predominantly flushometer valves).
 * The CFM column is not carried (gpm is what sizing needs). Values are the
 * engineer's to confirm against his own copy of the code — nothing here is
 * derived or interpolated at rest, only transcribed. `FD.plumbing.verified` is
 * false accordingly, the same treatment as the glycol properties.
 *
 * OCCUPANCY ASSUMPTIONS, to confirm. Where the table splits a fixture by
 * occupancy, one representative row was chosen for the short fixture list
 * Michael asked for; Custom covers anything else. The choices are noted per
 * fixture below. Water closet, urinal and bathroom group ALSO vary by supply
 * control (flush tank vs flushometer valve); those carry both values and the
 * one used follows the system chosen on the HYDRAULIC tab.
 */
(function (FD) {
  'use strict';

  /* 1 US gallon per minute in m³/s (SI, as everything else in the engine).
   * 1 US gal = 3.785411784 L, so 1 gpm = 3.785411784 / 60000 m³/s. */
  var GPM_TO_M3S = 3.785411784 / 60000;      // = 6.309019640e-5

  /* Cold-water supply fixture units, Table E103.3(2), "FV (Cold)".
   *   fu    — a fixture with a single value.
   *   tank / valve — a fixture whose FU depends on the supply control; the value
   *                  used follows the HYDRAULIC system setting.
   * `custom` carries no value: the engineer types the FU. */
  var FIXTURES = [
    { id: 'custom',        name: 'Custom' },
    { id: 'bathroomGroup', name: 'Bathroom group',      tank: 2.7, valve: 6.0,  occ: 'private' },
    { id: 'waterCloset',   name: 'Water closet',        tank: 2.2, valve: 6.0,  occ: 'private' },
    { id: 'urinal',        name: 'Urinal',              tank: 3.0, valve: 5.0,  occ: 'public, ¾″ valve' },
    { id: 'bidet',         name: 'Bidet',               fu: 1.5,   occ: 'private' },
    { id: 'shower',        name: 'Shower head',         fu: 1.0,   occ: 'private' },
    { id: 'bathtub',       name: 'Bathtub',             fu: 1.0,   occ: 'private' },
    { id: 'lavPrivate',    name: 'Lavatory (private)',  fu: 0.5 },
    { id: 'lavPublic',     name: 'Lavatory (public)',   fu: 1.5 },
    { id: 'kitchenSink',   name: 'Kitchen sink',        fu: 1.0,   occ: 'private' }
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

  function fixture(id) {
    for (var i = 0; i < FIXTURES.length; i++) if (FIXTURES[i].id === id) return FIXTURES[i];
    return null;
  }

  /* The cold FU of ONE of this fixture, given the system (flush tank /
   * flushometer). A single-value fixture ignores the system; a tank/valve
   * fixture follows it. `custom` returns null — the caller supplies the FU. */
  function fixtureFU(id, system) {
    var f = fixture(id);
    if (!f) return null;
    if (f.fu !== undefined) return f.fu;
    if (f.tank !== undefined) return (system === 'flushometer') ? f.valve : f.tank;
    return null;                              // custom
  }

  /* Total FU → probable demand, in m³/s (SI). Piecewise-linear between the
   * tabulated points; clamped to the ends of the curve (the code does not define
   * beyond them). Zero FU is zero flow. */
  function fuToFlowGpm(totalFU, system) {
    var curve = DEMAND[system] || DEMAND.flushTank;
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

  function fuToFlow(totalFU, system) {
    return fuToFlowGpm(totalFU, system) * GPM_TO_M3S;
  }

  FD.plumbing = {
    verified: false,                          // transcribed from IPC 2018, not yet confirmed
    GPM_TO_M3S: GPM_TO_M3S,
    fixtures: FIXTURES,
    systems: SYSTEMS,
    demand: DEMAND,
    fixture: fixture,
    fixtureFU: fixtureFU,
    fuToFlowGpm: fuToFlowGpm,
    fuToFlow: fuToFlow
  };
})(window.FD = window.FD || {});
