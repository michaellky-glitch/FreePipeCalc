/* FreePipeCalc — control valve sizes and flow coefficients.
 *
 * SOURCE: Belimo EXT-TI-H6..XS(P)-.. — "Globe valves, 2-way, with flange PN25",
 * type overview, transcribed by hand from the manufacturer's data sheet.
 *
 * CITED, NOT REPUBLISHED. Michael, 2026-08-31: "We can cite sources and
 * transcribed manufacturer data, just not publish it as we are not the
 * manufacturer." So the range is named and the figures are carried, and the PDF
 * itself stays out of this repository. `docs_internal/VALVE-DATA-SOURCES.md`
 * records the sheet.
 *
 * ONE COEFFICIENT PER NOMINAL SIZE. The sheet lists seventeen products over
 * thirteen sizes, because DN15 alone is sold in five coefficients (0.63, 1,
 * 1.5, 2.5 and 4). Michael's rule, 2026-08-31: where several share a size, take
 * the LARGEST. That gives a strictly rising ladder from DN15 to DN250 and lets
 * the interface offer a plain size rather than a size-and-coefficient pair.
 * The DN15 alternatives are recorded below so that nothing is lost.
 *
 * The range is a globe valve, so the equal-percentage opening characteristic in
 * `data/valves.js` is the right one for it, and the solver's dP = (Q/Kv)^2 is
 * the right relation. Contrast the PICV table at the foot of this file, which
 * is stored and NOT used.
 */
(function (FD) {
  'use strict';

  /* dn      nominal size [mm]
   * kvs     flow coefficient at full travel [m3/h]
   * stroke  valve stroke [mm] — carried because it is on the sheet, not used
   * dpS     close-off pressure [Pa]
   * dpMax   maximum differential pressure [Pa]
   *
   * DN32 IS PRINTED WITH TWO PRESSURE CLASSES — "600/1000" close-off and
   * "300/500" maximum differential. The LOWER of each is carried, because a
   * limit that is too generous is the one that lets a bad selection through.
   * The alternative is noted on the row. */
  var SIZES = [
    { dn: 15,  kvs: 4,   stroke: 20, dpS: 1000e3, dpMax: 500e3,
      alternates: [0.63, 1, 1.5, 2.5, 4] },
    { dn: 20,  kvs: 6.3, stroke: 20, dpS: 1000e3, dpMax: 400e3 },
    { dn: 25,  kvs: 10,  stroke: 20, dpS: 1000e3, dpMax: 350e3 },
    { dn: 32,  kvs: 16,  stroke: 20, dpS: 600e3,  dpMax: 300e3,
      dpNote: 'Also offered at 1000 kPa close-off / 500 kPa differential.' },
    { dn: 40,  kvs: 25,  stroke: 20, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 50,  kvs: 40,  stroke: 20, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 65,  kvs: 63,  stroke: 20, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 80,  kvs: 100, stroke: 30, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 100, kvs: 160, stroke: 40, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 125, kvs: 250, stroke: 40, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 150, kvs: 350, stroke: 40, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 200, kvs: 520, stroke: 40, dpS: 1600e3, dpMax: 1000e3 },
    { dn: 250, kvs: 700, stroke: 40, dpS: 1600e3, dpMax: 1000e3 }
  ];

  /* The kinds of valve the interface offers. PICV is listed so an engineer can
   * see it is coming and is not simply missing; selecting it does not change
   * the calculation, and the panel says so. */
  var TYPES = [
    { key: 'cv',   name: 'Control Valve',              implemented: true },
    { key: 'picv', name: 'PICV (Not Implemented Yet)', implemented: false }
  ];

  function nominalSizes() {
    return SIZES.map(function (s) { return s.dn; });
  }

  /* Nominal size out of a size LABEL such as 'DN50'. Anything that is not a DN
   * label returns null: an HDPE "110 mm" is an outside diameter, and reading a
   * nominal size off it would invent a selection. */
  function dnOfLabel(label) {
    var m = /^DN\s*(\d+)$/i.exec(String(label || '').trim());
    return m ? Number(m[1]) : null;
  }

  function bySize(dn) {
    var n = Number(dn);
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].dn === n) return SIZES[i];
    return null;
  }

  /* THE DEFAULT FOR A NEWLY PLACED CONTROL VALVE — one nominal size below the
   * pipe (Michael, 2026-08-31: "Use next size down DN as default").
   *
   * A control valve is not line size. It has to drop enough pressure to have
   * authority over the branch, and a full-bore valve in the line drops almost
   * nothing. This steps against the sizes the RANGE offers, so a DN90 line
   * lands on DN80 — the next valve that exists rather than one that does not.
   *
   * Returns null when the pipe is at or below the smallest valve, or carries a
   * size that is not a DN. Both mean "no sensible default", and the valve is
   * left unselected with its derived coefficient. */
  function defaultForPipe(label) {
    var dn = dnOfLabel(label);
    if (dn === null) return null;
    var below = nominalSizes().filter(function (n) { return n < dn; });
    return below.length ? bySize(below[below.length - 1]) : null;
  }

  /* ---- PRESSURE INDEPENDENT VALVES — stored, NOT used ------------------
   *
   * Michael, 2026-08-31: "I didn't think PICVs would need such a rebuild. Store
   * the numbers for later implementation."
   *
   * Transcribed in full so picking this up later is a code change and not
   * another reading of the sheets. `vnom_m3h` is the nominal flow the valve is
   * rated to pass; `kvs` is those sheets' own "Kvs theor.", which they publish
   * for pressure drop calculation. NOTHING READS THIS — modelling pressure
   * independence needs a valve that holds its flow as the differential moves,
   * which dP = (Q/Kv)^2 cannot express. See WORKLIST CV.1. */
  var PICV = {
    note: 'Transcribed and held for a future implementation. Not used by the ' +
          'engine or the interface.',
    source: 'Belimo EP..R2+BAC (EPIV, PN 25, DN 15-50) and EV..F+BAC ' +
            '(Energy Valve, PN 16, DN 65-150).',
    threaded: {
      pn: 25, dpMax: 350e3, dpLowNoise: 200e3, dpClose: 1400e3, vmaxMinPct: 25,
      sizes: [
        { dn: 15, vnom_m3h: 1.5, kvs: 3.2 },
        { dn: 20, vnom_m3h: 2.5, kvs: 5.3 },
        { dn: 25, vnom_m3h: 3.5, kvs: 8.8 },
        { dn: 32, vnom_m3h: 6,   kvs: 14.1 },
        { dn: 40, vnom_m3h: 10,  kvs: 19.2 },
        { dn: 50, vnom_m3h: 15,  kvs: 30.4 }
      ]
    },
    flanged: {
      pn: 16, dpMax: 340e3, dpLowNoise: null, dpClose: 690e3, vmaxMinPct: 30,
      sizes: [
        { dn: 65,  vnom_m3h: 28.8,  kvs: 50 },
        { dn: 80,  vnom_m3h: 39.6,  kvs: 75 },
        { dn: 100, vnom_m3h: 72,    kvs: 127 },
        { dn: 125, vnom_m3h: 111.6, kvs: 195 },
        { dn: 150, vnom_m3h: 162,   kvs: 254 }
      ]
    }
  };

  FD.controlValves = {
    sizes: SIZES,
    types: TYPES,
    picv: PICV,
    nominalSizes: nominalSizes,
    dnOfLabel: dnOfLabel,
    bySize: bySize,
    defaultForPipe: defaultForPipe,
    characteristic: 'Equal percentage',
    range: 'Belimo EXT-TI-H6..XS(P)',
    source: 'Based on Belimo EXT-TI-H6..XS(P) — globe valves, 2-way, flange ' +
            'PN25. Transcribed from the manufacturer’s type overview; the ' +
            'data sheet itself is not redistributed here.'
  };
})(window.FD = window.FD || {});
