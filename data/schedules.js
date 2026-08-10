/* Friction Drop — built-in pipe schedules
 *
 * Every schedule is a list of sizes: { label, id_mm }
 *   label  — nominal designation shown in the UI
 *   id_mm  — inner diameter in millimetres (the only value the hydraulics needs)
 *   od_mm  — outer diameter, informational (used by nothing in v1)
 *
 * Spec §9: ASME Sch 10/40/80 steel, EN 10255 Medium & Heavy, PPR (EN ISO 15874),
 * HDPE PE100 (EN 12201). Copper is deliberately absent — add via Custom.
 */
(function (FD) {
  'use strict';

  // Helper: build size rows from [label, od, wall] triples.
  function fromWall(rows) {
    return rows.map(function (r) {
      return {
        label: r[0],
        od_mm: r[1],
        id_mm: Math.round((r[1] - 2 * r[2]) * 100) / 100
      };
    });
  }

  var SCHEDULES = {
    'sch10': {
      name: 'ASME Schedule 10 (steel)',
      defaultC: 120,
      sizes: fromWall([
        ['DN15',   21.30, 2.11], ['DN20',   26.70, 2.11], ['DN25',   33.40, 2.77],
        ['DN32',   42.20, 2.77], ['DN40',   48.30, 2.77], ['DN50',   60.30, 2.77],
        ['DN65',   73.00, 3.05], ['DN80',   88.90, 3.05], ['DN100', 114.30, 3.05],
        ['DN125', 141.30, 3.40], ['DN150', 168.30, 3.40], ['DN200', 219.10, 3.76],
        ['DN250', 273.00, 4.19], ['DN300', 323.80, 4.57]
      ])
    },

    'sch40': {
      name: 'ASME Schedule 40 (steel)',
      defaultC: 120,
      sizes: fromWall([
        ['DN15',   21.30, 2.77], ['DN20',   26.70, 2.87], ['DN25',   33.40, 3.38],
        ['DN32',   42.20, 3.56], ['DN40',   48.30, 3.68], ['DN50',   60.30, 3.91],
        ['DN65',   73.00, 5.16], ['DN80',   88.90, 5.49], ['DN100', 114.30, 6.02],
        ['DN125', 141.30, 6.55], ['DN150', 168.30, 7.11], ['DN200', 219.10, 8.18],
        ['DN250', 273.00, 9.27], ['DN300', 323.80, 10.31]
      ])
    },

    'sch80': {
      name: 'ASME Schedule 80 (steel)',
      defaultC: 120,
      sizes: fromWall([
        ['DN15',   21.30, 3.73], ['DN20',   26.70, 3.91], ['DN25',   33.40, 4.55],
        ['DN32',   42.20, 4.85], ['DN40',   48.30, 5.08], ['DN50',   60.30, 5.54],
        ['DN65',   73.00, 7.01], ['DN80',   88.90, 7.62], ['DN100', 114.30, 8.56],
        ['DN125', 141.30, 9.53], ['DN150', 168.30, 10.97], ['DN200', 219.10, 12.70],
        ['DN250', 273.00, 15.09], ['DN300', 323.80, 17.48]
      ])
    },

    'en10255m': {
      name: 'EN 10255 Medium (welded steel)',
      defaultC: 120,
      sizes: fromWall([
        ['DN15',   21.30, 2.65], ['DN20',   26.90, 2.65], ['DN25',   33.70, 3.25],
        ['DN32',   42.40, 3.25], ['DN40',   48.30, 3.25], ['DN50',   60.30, 3.65],
        ['DN65',   76.10, 3.65], ['DN80',   88.90, 4.05], ['DN100', 114.30, 4.50],
        ['DN125', 139.70, 4.85], ['DN150', 165.10, 4.85]
      ])
    },

    'en10255h': {
      name: 'EN 10255 Heavy (welded steel)',
      defaultC: 120,
      sizes: fromWall([
        ['DN15',   21.30, 3.25], ['DN20',   26.90, 3.25], ['DN25',   33.70, 4.05],
        ['DN32',   42.40, 4.05], ['DN40',   48.30, 4.05], ['DN50',   60.30, 4.50],
        ['DN65',   76.10, 4.50], ['DN80',   88.90, 4.85], ['DN100', 114.30, 5.40],
        ['DN125', 139.70, 5.40], ['DN150', 165.10, 5.40]
      ])
    },

    'ppr_pn16': {
      name: 'PPR PN16 / SDR 7.4 (EN ISO 15874)',
      defaultC: 150,
      sizes: fromWall([
        ['20 mm',  20.0,  2.8], ['25 mm',  25.0,  3.5], ['32 mm',  32.0,  4.4],
        ['40 mm',  40.0,  5.5], ['50 mm',  50.0,  6.9], ['63 mm',  63.0,  8.6],
        ['75 mm',  75.0, 10.3], ['90 mm',  90.0, 12.3], ['110 mm', 110.0, 15.1]
      ])
    },

    'ppr_pn20': {
      name: 'PPR PN20 / SDR 6 (EN ISO 15874)',
      defaultC: 150,
      sizes: fromWall([
        ['20 mm',  20.0,  3.4], ['25 mm',  25.0,  4.2], ['32 mm',  32.0,  5.4],
        ['40 mm',  40.0,  6.7], ['50 mm',  50.0,  8.3], ['63 mm',  63.0, 10.5],
        ['75 mm',  75.0, 12.5], ['90 mm',  90.0, 15.0], ['110 mm', 110.0, 18.3]
      ])
    },

    'hdpe_sdr11': {
      name: 'HDPE PE100 SDR11 / PN16 (EN 12201)',
      defaultC: 150,
      sizes: fromWall([
        ['20 mm',  20.0,  2.0], ['25 mm',  25.0,  2.3], ['32 mm',  32.0,  3.0],
        ['40 mm',  40.0,  3.7], ['50 mm',  50.0,  4.6], ['63 mm',  63.0,  5.8],
        ['75 mm',  75.0,  6.8], ['90 mm',  90.0,  8.2], ['110 mm', 110.0, 10.0],
        ['125 mm', 125.0, 11.4], ['140 mm', 140.0, 12.7], ['160 mm', 160.0, 14.6],
        ['180 mm', 180.0, 16.4], ['200 mm', 200.0, 18.2], ['225 mm', 225.0, 20.5],
        ['250 mm', 250.0, 22.7], ['280 mm', 280.0, 25.4], ['315 mm', 315.0, 28.6]
      ])
    },

    'hdpe_sdr17': {
      name: 'HDPE PE100 SDR17 / PN10 (EN 12201)',
      defaultC: 150,
      sizes: fromWall([
        ['50 mm',   50.0,  3.0], ['63 mm',  63.0,  3.8], ['75 mm',  75.0,  4.5],
        ['90 mm',   90.0,  5.4], ['110 mm', 110.0,  6.6], ['125 mm', 125.0,  7.4],
        ['140 mm', 140.0,  8.3], ['160 mm', 160.0,  9.5], ['180 mm', 180.0, 10.7],
        ['200 mm', 200.0, 11.9], ['225 mm', 225.0, 13.4], ['250 mm', 250.0, 14.8],
        ['280 mm', 280.0, 16.6], ['315 mm', 315.0, 18.7]
      ])
    }
  };

  /* Parse a pasted size table.
   *
   * Built for copy-and-paste straight out of a spreadsheet, so the separator is
   * whatever the paste happens to use: Excel gives tabs, a CSV export gives
   * commas, a Word table gives runs of spaces. All three are accepted rather
   * than asking the user to reformat.
   *
   * Columns: nominal label, inner diameter (mm), insulation thickness (mm,
   * optional). Insulation is stored but unused — it is for the thermal module.
   *
   * A leading header row is skipped automatically: if the second column of the
   * first line is not a number, it was a heading.
   *
   * Returns { sizes, skipped } — bad lines are reported, never silently
   * dropped, because a quietly missing size is a quietly wrong calculation.
   */
  function parseSizeTable(text) {
    var sizes = [], skipped = [];
    var lines = String(text || '').split(/\r?\n/);

    lines.forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;

      // tab / comma / semicolon / 2+ spaces, in that order of preference
      var cols = (line.indexOf('\t') >= 0) ? line.split('\t')
               : (line.indexOf(',') >= 0)  ? line.split(',')
               : (line.indexOf(';') >= 0)  ? line.split(';')
               : line.split(/\s{2,}|\s+/);

      var label = (cols[0] || '').trim();
      var bore = FD.units ? FD.units.parse(cols[1]) : parseFloat(cols[1]);
      /* Third column is the OUTSIDE diameter, not insulation (v0.10.1).
       * Insulation moved onto the schedule's own editable column on the
       * HYDRAULIC tab, and OD is what was actually missing: without it a
       * custom schedule falls back to the bore for insulation geometry, which
       * understates the surface area and so understates the heat loss. */
      var od = cols.length > 2 && String(cols[2]).trim() !== ''
        ? (FD.units ? FD.units.parse(cols[2]) : parseFloat(cols[2])) : null;

      if (!label) { skipped.push({ line: i + 1, text: line, why: 'no label' }); return; }
      if (!isFinite(bore) || bore <= 0) {
        // a header row on the first non-blank line is expected, not an error
        if (!sizes.length && !skipped.length) return;
        skipped.push({ line: i + 1, text: line, why: 'inner diameter is not a positive number' });
        return;
      }

      /* `od !== null` matters: isFinite(null) is TRUE, because null coerces to
       * 0 — so a blank column would otherwise be stored as an outside diameter
       * of zero. Falls back to the bore, which is what it did before an OD
       * column existed. */
      var row = { label: label, id_mm: bore, od_mm: bore };
      if (od !== null && isFinite(od) && od > bore) row.od_mm = od;
      sizes.push(row);
    });

    // ascending bore: size stepping during DRAW walks the list in order
    sizes.sort(function (a, b) { return a.id_mm - b.id_mm; });
    return { sizes: sizes, skipped: skipped };
  }

  /* INSULATION no longer lives on the schedule (2026-08-10). It was "25 mm
   * below DN50, 50 mm from DN50 up", keyed per schedule and size; it is now a
   * single global thickness in Thermal settings (`thermal.insulation_mm`),
   * overridden per pipe. A schedule is its published dimensions only — bore,
   * outside diameter, wall — because insulation is a specification the engineer
   * sets, not a fixed property of a pipe size. See `thermal.js thicknessOf`. */

  FD.schedules = {
    builtin: SCHEDULES,
    parseSizeTable: parseSizeTable,

    /* All schedules currently available = built-in + user customs.
     * `customs` is the object kept in localStorage / embedded in a model file. */
    all: function (customs) {
      var out = {};
      Object.keys(SCHEDULES).forEach(function (k) { out[k] = SCHEDULES[k]; });
      if (customs) {
        Object.keys(customs).forEach(function (k) { out[k] = customs[k]; });
      }
      return out;
    },

    get: function (key, customs) {
      return this.all(customs)[key] || SCHEDULES.sch40;
    },

    /* Look up a size row; falls back to the nearest available size so a model
     * that references a size the schedule no longer has still solves. */
    size: function (key, label, customs) {
      var sch = this.get(key, customs);
      for (var i = 0; i < sch.sizes.length; i++) {
        if (sch.sizes[i].label === label) return sch.sizes[i];
      }
      return sch.sizes[0];
    },

    /* A sensible starting size for a new pipe.
     *
     * NOT sizes[0]: the smallest entry is DN15, and silently defaulting to it
     * makes any pipe carrying a real flow show absurd friction (2 L/s down a
     * DN15 riser is 183 m of head). The first size at or above a 50 mm bore is
     * an unremarkable building-services default that will not quietly wreck a
     * calculation if the user forgets to set it. */
    defaultSize: function (key, customs) {
      var sch = this.get(key, customs);
      for (var i = 0; i < sch.sizes.length; i++) {
        if (sch.sizes[i].id_mm >= 50) return sch.sizes[i].label;
      }
      return sch.sizes[sch.sizes.length - 1].label;
    },

    /* Nominal size in mm parsed from the designation — "DN50" → 50,
     * "110 mm" → 110. This is what fitting K tables are keyed on, and it is
     * NOT the bore: for plastics the designation is an outside diameter. */
    nominalMm: function (label) {
      var m = /(\d+(?:\.\d+)?)/.exec(String(label || ''));
      return m ? parseFloat(m[1]) : 0;
    },

    /* Step up/down the size list — used by scroll-wheel sizing during DRAW. */
    step: function (key, label, delta, customs) {
      var sch = this.get(key, customs);
      var i = sch.sizes.findIndex(function (s) { return s.label === label; });
      if (i < 0) i = 0;
      i = Math.max(0, Math.min(sch.sizes.length - 1, i + delta));
      return sch.sizes[i].label;
    },

    /* Smallest size whose velocity at `q` (m³/s) is under `vmax` (m/s). */
    sizeForFlow: function (key, q, vmax, customs) {
      var sch = this.get(key, customs);
      for (var i = 0; i < sch.sizes.length; i++) {
        var d = sch.sizes[i].id_mm / 1000;
        if (q / (Math.PI * d * d / 4) <= vmax) return sch.sizes[i].label;
      }
      return sch.sizes[sch.sizes.length - 1].label;
    }
  };
})(window.FD = window.FD || {});
