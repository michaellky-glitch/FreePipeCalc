/* FreePipeCalc — pressure independent control valve sizes and coefficients.
 *
 * SOURCE: Belimo technical data sheets, supplied by Michael 2026-08-31.
 *
 *   EP..R2+BAC   "Characterised control valve with sensor-operated flow
 *                control, 2-way, Internal and external thread, PN 25 (EPIV)"
 *                en-gb, 2026-05-13. DN 15 to DN 50.
 *
 *   EV..F+BAC    "Characterised control valve with sensor-operated flow rate or
 *                power control, power and energy-monitoring function, 2-way,
 *                Flange, PN 16 (Energy Valve)"
 *                en-gb, 2026-06-09. DN 65 to DN 150.
 *
 * WHY Kvs IS THE RIGHT NUMBER TO USE, and it is the manufacturer who says so.
 * Both sheets print a column headed "Kvs theor." with the footnote:
 *
 *     "Kvs theor.: theoretical Kvs value for pressure drop calculation"
 *
 * So Belimo publish this figure FOR the calculation this program does. A
 * pressure independent valve holds its flow by moving its own opening as the
 * differential across it changes, but the pressure drop through the control
 * element at a given flow is still a Kv relation, and this is the Kv to use.
 *
 * WHAT THIS TABLE IS NOT. It is a SIZE-to-COEFFICIENT lookup for selecting a
 * valve. It does NOT make the engine model pressure independence — the solver
 * still charges dP = (Q/Kv)^2 through the valve, which is the pressure
 * DEPENDENT relation. Modelling the flow-limiting behaviour of a PICV is a
 * separate question and is not decided. See docs_internal/WORKLIST.md.
 *
 * V'nom is the nominal flow the valve is rated to pass, and is carried because
 * it is what a selection is actually made on: you pick the valve whose V'nom
 * covers the design flow, then read its Kvs. It is NOT used by the engine.
 *
 * TRANSCRIPTION CHECK. Each sheet prints V'nom in l/s, l/min and m3/h, so the
 * three are redundant and any transcription error shows up as a mismatch.
 * `test/picv.test.js` asserts the individual cells against the printed page and
 * checks l/s against m3/h/3.6 for every row.
 */
(function (FD) {
  'use strict';

  /* Belimo EP..R2+BAC — EPIV, threaded, PN 25.
   * dn      nominal size
   * vnom_m3h  nominal flow as PRINTED in m3/h. The sheets give V'nom three
   *           times — l/s, l/min and m3/h — and the m3/h column carries the
   *           round design figures (1.5, 2.5, 3.5, 6, 10, 15) of which the
   *           others are rounded derivatives. So m3/h is transcribed and the
   *           rest are derived, never the other way round: taking the 2-decimal
   *           l/s column as primary puts V'nom out by up to 1.2%, which is what
   *           `test/picv.test.js` caught on the first run.
   * kvs     "Kvs theor." [m3/h] — for pressure drop calculation
   * dpMax   maximum differential pressure [Pa]
   * dpClose close-off pressure [Pa] */
  var EPIV = [
    { dn: 15, model: 'EP015R2+BAC', vnom_m3h: 1.5,  kvs: 3.2 },
    { dn: 20, model: 'EP020R2+BAC', vnom_m3h: 2.5,  kvs: 5.3 },
    { dn: 25, model: 'EP025R2+BAC', vnom_m3h: 3.5,  kvs: 8.8 },
    { dn: 32, model: 'EP032R2+BAC', vnom_m3h: 6,    kvs: 14.1 },
    { dn: 40, model: 'EP040R2+BAC', vnom_m3h: 10,   kvs: 19.2 },
    { dn: 50, model: 'EP050R2+BAC', vnom_m3h: 15,   kvs: 30.4 }
  ];

  /* Belimo EV..F+BAC — Energy Valve, flanged EN 1092-2, PN 16. */
  var ENERGY = [
    { dn: 65,  model: 'EV065F+BAC', vnom_m3h: 28.8,  kvs: 50 },
    { dn: 80,  model: 'EV080F+BAC', vnom_m3h: 39.6,  kvs: 75 },
    { dn: 100, model: 'EV100F+BAC', vnom_m3h: 72,    kvs: 127 },
    { dn: 125, model: 'EV125F+BAC', vnom_m3h: 111.6, kvs: 195 },
    { dn: 150, model: 'EV150F+BAC', vnom_m3h: 162, kvs: 254 }
  ];

  /* Per-range properties that are the same for every size in that range. */
  var RANGES = {
    epiv: {
      key: 'epiv',
      name: 'Belimo EPIV (EP..R2+BAC)',
      connection: 'Internal and external thread',
      pn: 25,
      dpMax: 350000,          // Pa — "Differential pressure dpmax 350 kPa"
      dpLowNoise: 200000,     // Pa — "200 kPa for low-noise operation"
      dpClose: 1400000,       // Pa — "Close-off pressure dps 1400 kPa"
      vmaxMinPct: 25,         // "V'max adjustable 25...100% of V'nom"
      sizes: EPIV
    },
    energy: {
      key: 'energy',
      name: 'Belimo Energy Valve (EV..F+BAC)',
      connection: 'Flange EN 1092-2',
      pn: 16,
      dpMax: 340000,          // Pa — "Differential pressure dpmax 340 kPa"
      dpLowNoise: null,       // not stated on this sheet
      dpClose: 690000,        // Pa — "Close-off pressure dps 690 kPa"
      vmaxMinPct: 30,         // "V'max adjustable 30...100% of V'nom"
      sizes: ENERGY
    }
  };

  /* Every size across both ranges, ascending. The two ranges meet at DN50/DN65
   * and do not overlap, so this reads as one continuous DN15-DN150 selection —
   * which is how an engineer picks one. */
  var ALL = [];
  ['epiv', 'energy'].forEach(function (k) {
    RANGES[k].sizes.forEach(function (s) {
      ALL.push({
        dn: s.dn, model: s.model,
        vnom_m3h: s.vnom_m3h,
        vnom: s.vnom_m3h / 3600,          // m3/s, derived
        kvs: s.kvs,
        range: k, rangeName: RANGES[k].name,
        pn: RANGES[k].pn, dpMax: RANGES[k].dpMax, dpClose: RANGES[k].dpClose
      });
    });
  });

  /* The entry for a nominal size, or null. EXACT match only: a PICV is a
   * product you order, not an interpolation, so there is no DN37. */
  function bySize(dn) {
    var n = Number(dn);
    for (var i = 0; i < ALL.length; i++) if (ALL[i].dn === n) return ALL[i];
    return null;
  }

  /* Nominal size out of a size LABEL such as 'DN50'. Returns null for anything
   * that is not a DN label — an imperial or an HDPE size has no PICV row, and
   * guessing one from the bore would invent a product. */
  function dnOfLabel(label) {
    var m = /^DN\s*(\d+)$/i.exec(String(label || '').trim());
    return m ? Number(m[1]) : null;
  }

  /* The valve that MATCHES a pipe size, which is what a newly placed control
   * valve takes (Michael, 2026-08-31: "when placing CVs is to follow Pipe
   * Size"). Line size is deliberately NOT the same as a selection: the rule of
   * thumb is a PICV one size below the pipe, adjusted for control authority,
   * and that sizing method is not decided yet. */
  function forPipeSize(label) {
    var dn = dnOfLabel(label);
    return dn === null ? null : bySize(dn);
  }

  FD.picv = {
    ranges: RANGES,
    sizes: ALL,
    bySize: bySize,
    dnOfLabel: dnOfLabel,
    forPipeSize: forPipeSize,
    source: 'Belimo EP..R2+BAC (EPIV, PN 25, DN 15-50), en-gb 2026-05-13; ' +
            'Belimo EV..F+BAC (Energy Valve, PN 16, DN 65-150), en-gb ' +
            '2026-06-09. Kvs is the sheets’ "Kvs theor.", published for ' +
            'pressure drop calculation.'
  };
})(window.FD = window.FD || {});
