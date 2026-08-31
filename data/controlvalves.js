/* FreePipeCalc — control valve sizes and flow coefficients.
 *
 * TWO TABLES, AND ONLY ONE OF THEM IS WIRED UP.
 *
 *   SIZES   Characterised control valves — ordinary, pressure DEPENDENT ones.
 *           This is the range the CV size selector offers, and the one the
 *           solver's dP = (Q/Kv)^2 describes correctly.
 *
 *   PICV    Pressure independent control valves. Transcribed and kept, NOT
 *           used. Michael, 2026-08-31: "I didn't think PICVs would need such a
 *           rebuild. Store the numbers for later implementation. Meanwhile use
 *           these regular globe valve Kv." Modelling a PICV means modelling a
 *           valve that holds its flow while the differential across it moves,
 *           which the solver cannot express — see WORKLIST CV.1.
 *
 * PROVENANCE. Every figure here is transcribed from a manufacturer's published
 * technical data sheet. The sheets are held locally and are deliberately not in
 * this repository; `docs_internal/` records exactly which ones. NO MODEL OR
 * BRAND NAMES ARE CARRIED HERE (Michael, 2026-08-31) — a size and a coefficient
 * are what the calculation needs, and naming a product in the shipped app would
 * read as an endorsement and would date badly. Nothing here is invented: if a
 * size is not on a sheet, it is not in this file.
 *
 * BOTH RANGES ARE EQUAL PERCENTAGE (VDI/VDE 2173), which is what the opening
 * characteristic in `data/valves.js` already assumes for a control valve.
 *
 * SEVERAL COEFFICIENTS PER SIZE IS NORMAL, and is why this is a list of
 * PRODUCTS rather than a lookup by size. A DN50 body is sold with Kvs 25, 40,
 * 58 and 70; they are different valves in the same pipe. Selecting by size
 * alone would have to pick one, so the selector lists them all.
 */
(function (FD) {
  'use strict';

  /* ---- ORDINARY CHARACTERISED CONTROL VALVES — the range in use -------
   *
   * dn    nominal size
   * kvs   flow coefficient [m3/h] at full travel
   * pn    pressure rating
   *
   * Threaded bodies DN20-50, flanged bodies DN65-150. The two meet without a
   * gap, so the selector reads as one DN20-DN150 range. */
  var THREADED = [
    { dn: 20, kvs: 4,    pn: 40 },
    { dn: 20, kvs: 6.3,  pn: 40 },
    { dn: 25, kvs: 25,   pn: 40 },
    { dn: 32, kvs: 10,   pn: 40 },
    { dn: 32, kvs: 20,   pn: 40 },
    { dn: 32, kvs: 25,   pn: 25 },
    { dn: 40, kvs: 16,   pn: 25 },
    { dn: 40, kvs: 25,   pn: 25 },
    { dn: 40, kvs: 40,   pn: 25 },
    { dn: 50, kvs: 25,   pn: 25 },
    { dn: 50, kvs: 40,   pn: 25 },
    { dn: 50, kvs: 58,   pn: 25 },
    { dn: 50, kvs: 70,   pn: 25 }
  ];

  var FLANGED = [
    { dn: 65,  kvs: 63,  pn: 16 },
    { dn: 80,  kvs: 100, pn: 16 },
    { dn: 100, kvs: 140, pn: 16 },
    { dn: 125, kvs: 230, pn: 16 },
    { dn: 150, kvs: 320, pn: 16 }
  ];

  /* Range-wide limits, as printed. */
  var LIMITS = {
    threaded: {
      connection: 'Internal thread',
      dpMax: 350000,        // Pa
      dpLowNoise: 200000,   // Pa — "200 kPa for low-noise operation"
      dpClose: 1400000      // Pa
    },
    flanged: {
      connection: 'Flanged',
      /* The sheet splits these by size: DN65-125 take more than DN150 does. */
      dpMax: 350000,        // Pa, DN65-125 ("<250 kPa" at DN150)
      dpMaxDN150: 250000,
      dpLowNoise: 200000,
      dpClose: 700000,      // Pa, DN65-125
      dpCloseDN150: 400000
    }
  };

  var SIZES = [];
  THREADED.forEach(function (s) {
    SIZES.push({ dn: s.dn, kvs: s.kvs, pn: s.pn, body: 'threaded' });
  });
  FLANGED.forEach(function (s) {
    SIZES.push({ dn: s.dn, kvs: s.kvs, pn: s.pn, body: 'flanged' });
  });

  /* ---- PRESSURE INDEPENDENT VALVES — stored, NOT used ------------------
   *
   * Kept exactly as transcribed so that implementing PICV behaviour later is a
   * code change and not another reading of the sheets. `vnom_m3h` is the
   * nominal flow the valve is rated to pass; `kvs` is the sheets' own
   * "Kvs theor.", which they publish for pressure drop calculation.
   *
   * NOTHING READS THIS. It is here to be picked up when WORKLIST CV.1 is
   * decided. */
  var PICV = {
    note: 'Transcribed and held for a future implementation. Not used by the ' +
          'engine or the interface. Modelling pressure independence needs a ' +
          'valve that holds its flow as the differential moves, which the ' +
          'dP = (Q/Kv)^2 solver cannot express.',
    threaded: {
      pn: 25, dpMax: 350000, dpLowNoise: 200000, dpClose: 1400000,
      vmaxMinPct: 25,
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
      pn: 16, dpMax: 340000, dpLowNoise: null, dpClose: 690000,
      vmaxMinPct: 30,
      sizes: [
        { dn: 65,  vnom_m3h: 28.8,  kvs: 50 },
        { dn: 80,  vnom_m3h: 39.6,  kvs: 75 },
        { dn: 100, vnom_m3h: 72,    kvs: 127 },
        { dn: 125, vnom_m3h: 111.6, kvs: 195 },
        { dn: 150, vnom_m3h: 162,   kvs: 254 }
      ]
    }
  };

  /* Every nominal size the range offers, ascending and without repeats. */
  function nominalSizes() {
    var seen = {}, out = [];
    SIZES.forEach(function (s) {
      if (!seen[s.dn]) { seen[s.dn] = 1; out.push(s.dn); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /* Nominal size out of a size LABEL such as 'DN50'. Anything that is not a DN
   * label returns null: an HDPE "110 mm" is an outside diameter, and reading a
   * DN off it would invent a selection. */
  function dnOfLabel(label) {
    var m = /^DN\s*(\d+)$/i.exec(String(label || '').trim());
    return m ? Number(m[1]) : null;
  }

  /* Every valve offered at one nominal size, smallest coefficient first. */
  function atSize(dn) {
    return SIZES.filter(function (s) { return s.dn === Number(dn); })
                .sort(function (a, b) { return a.kvs - b.kvs; });
  }

  /* THE DEFAULT FOR A NEWLY PLACED CONTROL VALVE — one nominal size below the
   * pipe (Michael, 2026-08-31: "Use next size down DN as default").
   *
   * A control valve is not line size. It has to drop enough pressure to have
   * authority over the branch, and a full-bore valve in the line drops almost
   * nothing. One size down is the rule of thumb, and this applies it against
   * the sizes the range actually offers rather than against the pipe schedule —
   * so a DN90 line steps to DN80, which is the next valve that exists.
   *
   * WHICH COEFFICIENT, where a size offers several: the SMALLEST. That is the
   * conservative direction. A valve with too small a Kv still controls, it just
   * costs pump head; a valve with too large a Kv does not control at all, and
   * the model would show a valve doing nothing while the real one hunted. This
   * is a starting point and not a sizing calculation — the authority-based
   * method is not built (WORKLIST CV.1) and the selector is there to change it.
   *
   * Returns null when the pipe is smaller than the smallest valve, or carries a
   * size that is not a DN. Both mean "no sensible default", and the valve is
   * left on Manual with its derived coefficient. */
  function defaultForPipe(label) {
    var dn = dnOfLabel(label);
    if (dn === null) return null;
    var below = nominalSizes().filter(function (n) { return n < dn; });
    if (!below.length) return null;
    var pick = atSize(below[below.length - 1]);
    return pick.length ? pick[0] : null;
  }

  /* The exact entry for a size and coefficient, which is how a selection is
   * stored and read back. */
  function find(dn, kvs) {
    var n = Number(dn), k = Number(kvs);
    for (var i = 0; i < SIZES.length; i++) {
      if (SIZES[i].dn === n && Math.abs(SIZES[i].kvs - k) < 1e-9) return SIZES[i];
    }
    return null;
  }

  FD.controlValves = {
    sizes: SIZES,
    limits: LIMITS,
    picv: PICV,
    nominalSizes: nominalSizes,
    dnOfLabel: dnOfLabel,
    atSize: atSize,
    defaultForPipe: defaultForPipe,
    find: find,
    characteristic: 'Equal percentage (VDI/VDE 2173)',
    source: 'Manufacturer published data for characterised control valves, ' +
            'DN20-150, equal percentage. Data sheets held locally and recorded ' +
            'in docs_internal; not carried in this repository.'
  };
})(window.FD = window.FD || {});
