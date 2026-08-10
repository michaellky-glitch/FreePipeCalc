/* FreePipeCalc — unit conversion (display layer only)
 *
 * Spec §1/§9: ALL model state and ALL computation is SI —
 *   length m · flow m³/s · pressure Pa · head m · diameter m (mm in tables)
 * Nothing in this file may be called from the solver. It exists purely to
 * format SI values for the screen and to parse what the user types back.
 */
(function (FD) {
  'use strict';

  var RHO = 998;      // kg/m³, water ~20 °C
  var G = 9.81;       // m/s²

  // factor = how many SI units in one display unit
  var FLOW = {
    'L/s':  { factor: 1e-3,        dp: 2, label: 'L/s' },
    'm3/h': { factor: 1 / 3600,    dp: 2, label: 'm³/h' },
    'GPM':  { factor: 6.30902e-5,  dp: 1, label: 'GPM' }
  };

  var PRESSURE = {
    'kPa': { factor: 1000,          dp: 1, label: 'kPa' },
    'm':   { factor: RHO * G,       dp: 2, label: 'm hd' },   // metres of water
    'psi': { factor: 6894.757,      dp: 1, label: 'psi' },
    'ft':  { factor: RHO * G * 0.3048, dp: 1, label: 'ft hd' }
  };

  var PDM = {
    'Pa/m':     { factor: 1,        dp: 0, label: 'Pa/m' },
    'ft/100ft': { factor: RHO * G,  dp: 2, label: 'ft/100ft' } // m/m -> ft/100ft is 1:1 ratio x100
  };

  var LENGTH = {
    'm':  { factor: 1,      dp: 2, label: 'm' },
    'ft': { factor: 0.3048, dp: 2, label: 'ft' }
  };

  function conv(table, key) {
    return table[key] || table[Object.keys(table)[0]];
  }

  function round(v, dp) {
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  FD.units = {
    RHO: RHO,
    G: G,

    flowUnits: Object.keys(FLOW),
    pressureUnits: Object.keys(PRESSURE),
    pdmUnits: Object.keys(PDM),
    lengthUnits: Object.keys(LENGTH),

    // --- SI -> display -------------------------------------------------
    flow:     function (si, u) { var c = conv(FLOW, u);     return si / c.factor; },
    pressure: function (si, u) { var c = conv(PRESSURE, u); return si / c.factor; },
    length:   function (si, u) { var c = conv(LENGTH, u);   return si / c.factor; },

    /* PD/m is special: ft/100ft is a dimensionless slope x100, not a simple
     * division, so it gets its own branch. */
    pdm: function (si_Pa_per_m, u) {
      if (u === 'ft/100ft') return (si_Pa_per_m / (RHO * G)) * 100;
      return si_Pa_per_m;
    },

    // --- display -> SI -------------------------------------------------
    /* The inverse of `pdm` above, and it needs its own branch for the same
     * reason: ft/100ft is a slope, not a scaled pressure. */
    toSIPdm: function (v, u) {
      if (u === 'ft/100ft') return (v / 100) * RHO * G;
      return v;
    },
    toSIFlow:     function (v, u) { return v * conv(FLOW, u).factor; },
    toSIPressure: function (v, u) { return v * conv(PRESSURE, u).factor; },
    toSILength:   function (v, u) { return v * conv(LENGTH, u).factor; },

    // --- formatting ----------------------------------------------------
    fmtFlow: function (si, u, withUnit) {
      var c = conv(FLOW, u);
      return round(si / c.factor, c.dp).toFixed(c.dp) + (withUnit ? ' ' + c.label : '');
    },
    fmtPressure: function (si, u, withUnit) {
      var c = conv(PRESSURE, u);
      return round(si / c.factor, c.dp).toFixed(c.dp) + (withUnit ? ' ' + c.label : '');
    },
    fmtLength: function (si, u, withUnit) {
      var c = conv(LENGTH, u);
      return round(si / c.factor, c.dp).toFixed(c.dp) + (withUnit ? ' ' + c.label : '');
    },
    fmtPdm: function (si, u, withUnit) {
      var c = conv(PDM, u);
      var v = FD.units.pdm(si, u);
      return round(v, c.dp).toFixed(c.dp) + (withUnit ? ' ' + c.label : '');
    },
    fmtVelocity: function (v, metric) {
      return metric ? v.toFixed(2) + ' m/s' : (v / 0.3048).toFixed(2) + ' ft/s';
    },

    /* Nominal size label for display — DN mm as stored, or converted to an
     * NPS inch label when the user picks imperial sizing. */
    fmtSize: function (label, sizeUnit) {
      if (sizeUnit !== 'NPS') return label;
      var m = /^DN(\d+)/.exec(label);
      if (!m) return label;
      var NPS = { 15: '1/2"', 20: '3/4"', 25: '1"', 32: '1-1/4"', 40: '1-1/2"',
                  50: '2"', 65: '2-1/2"', 80: '3"', 100: '4"', 125: '5"',
                  150: '6"', 200: '8"', 250: '10"', 300: '12"' };
      return NPS[+m[1]] || label;
    },

    /* Compact size label for drawing annotations: "50⌀" rather than "DN50".
     * On a drawing the diameter symbol carries the meaning without spending
     * width on a standards prefix. */
    sizeLabel: function (label, sizeUnit) {
      if (sizeUnit === 'NPS') return FD.units.fmtSize(label, 'NPS');
      var m = /(\d+(?:\.\d+)?)/.exec(String(label));
      return m ? m[1] + '⌀' : String(label);
    },

    /* Parse a number the user typed, tolerating a trailing unit and either
     * decimal separator. Returns NaN if unparseable. */
    parse: function (text) {
      if (typeof text === 'number') return text;
      if (!text) return NaN;
      var s = String(text).trim().replace(/[^\d.,+\-eE]/g, '');
      // If both separators appear, the LAST one is the decimal point.
      var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
      if (lastComma > -1 && lastDot > -1) {
        s = lastComma > lastDot
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
      } else if (lastComma > -1) {
        s = s.replace(',', '.');
      }
      var v = parseFloat(s);
      return isFinite(v) ? v : NaN;
    },

    /* Head [m] <-> pressure [Pa].
     *
     * The bare forms assume water at 998 kg/m³ and exist for display maths
     * where the fluid is not in scope. Anything reporting a RESULT must use
     * the -With forms and pass the model's fluid density, or a non-water
     * fluid silently reports water numbers. */
    headToPa: function (h) { return RHO * G * h; },
    paToHead: function (p) { return p / (RHO * G); },
    headToPaWith: function (h, rho) { return (rho || RHO) * G * h; },
    paToHeadWith: function (p, rho) { return p / ((rho || RHO) * G); }
  };
})(window.FD = window.FD || {});
