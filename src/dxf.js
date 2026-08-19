/* FreePipeCalc — DXF export  (EXPERIMENTAL)
 *
 * Writes the DRAWING: pipework, risers, device symbols and text. No properties,
 * no results, no calculation sheet — Michael's scope, 2026-08-05.
 *
 * ============================================================ WHY R12 ASCII
 *
 * DXF R12 is a plain text format: group-code / value pairs, one per line, and a
 * fixed section order. That matters more here than anywhere else, because this
 * app has no build step and must run from `file://` — a binary writer or a
 * library dependency would break the one constraint everything else is shaped
 * around (ARCHITECTURE §2.1).
 *
 * R12 rather than a later revision because it is the most widely readable and
 * needs no object handles, no class table and no extended entity data. The
 * entities used are the four every reader has supported since 1990: LINE,
 * CIRCLE, ARC and TEXT.
 *
 * ============================================================ COORDINATES
 *
 * MODEL SPACE, IN METRES, AT TRUE SIZE — no transform at all. The app already
 * stores world coordinates in metres, which is exactly what DXF wants, so this
 * exporter is simpler than the SVG one in `printer.js`: that has to fit a
 * building onto a page, this does not.
 *
 * Z IS REAL. A node's elevation becomes its Z, so risers come out as genuine
 * vertical lines and the model opens as a 3D layout rather than a stack of
 * unrelated plans. Michael's choice.
 *
 * ============================================================ WHAT IS NOT DONE
 *
 * Marked EXPERIMENTAL in the UI, and honestly so: the file structure is
 * verified here, but nothing in this environment can open it in AutoCAD or
 * BricsCAD. Until it has been opened in a real CAD package, "it should work" is
 * the strongest claim available. See `docs/MESSAGES.md` §6 and Human-Test.
 *
 * No dimensions, no hatching, no line weights, no paper space. Text is single
 * line, left-aligned, at a fixed model height.
 */
(function (FD) {
  'use strict';

  var M = FD.model;

  /* Text height in METRES of model space. 0.25 m is legible at the scale a
   * building services layout is normally plotted (1:50 to 1:100) and small
   * enough not to swamp a 0.5 m device symbol. */
  var TEXT_H = 0.25;

  /* Device symbols are drawn at a fixed MODEL size, not a screen size. On the
   * canvas they are sized in pixels so they stay readable at every zoom; in a
   * CAD drawing they are objects with a real size, and 0.25 m radius is about
   * what a pump symbol occupies on a plan at 1:50. */
  var SYM_R = 0.25;

  // ------------------------------------------------------------ primitives
  /* A DXF file is pairs of lines: a group code, then its value. Building it as
   * an array of strings and joining once is both the clearest way to read this
   * and the fastest way to write it. */
  function W(out, code, value) { out.push(String(code), String(value)); }

  function line(out, layer, x1, y1, z1, x2, y2, z2) {
    W(out, 0, 'LINE'); W(out, 8, layer);
    W(out, 10, x1); W(out, 20, y1); W(out, 30, z1);
    W(out, 11, x2); W(out, 21, y2); W(out, 31, z2);
  }

  function circle(out, layer, x, y, z, r) {
    W(out, 0, 'CIRCLE'); W(out, 8, layer);
    W(out, 10, x); W(out, 20, y); W(out, 30, z); W(out, 40, r);
  }

  function text(out, layer, x, y, z, h, str) {
    if (str === undefined || str === null || str === '') return;
    W(out, 0, 'TEXT'); W(out, 8, layer);
    W(out, 10, x); W(out, 20, y); W(out, 30, z);
    W(out, 40, h);
    /* Group 1 is the string itself. DXF R12 has no escaping and no UTF-8
     * guarantee, so anything outside plain ASCII is transliterated rather than
     * written raw — a Δ or a ° in a tag would otherwise come out as mojibake in
     * a reader that assumes the drawing's own code page. */
    W(out, 1, ascii(str));
  }

  function ascii(s) {
    return String(s)
      .replace(/[Δδ]/g, 'd')       // Δ δ
      .replace(/°/g, 'deg')             // °
      .replace(/[→–—]/g, '-') // → – —
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7e]/g, '?');
  }

  /* A polyline drawn as separate LINE entities.
   *
   * R12's POLYLINE needs a VERTEX list and a SEQEND and buys nothing here: a
   * device symbol is a handful of segments, and separate lines are readable by
   * everything. Deliberate simplicity, not an oversight. */
  function poly(out, layer, pts, z) {
    for (var i = 1; i < pts.length; i++) {
      line(out, layer, pts[i - 1][0], pts[i - 1][1], z, pts[i][0], pts[i][1], z);
    }
  }

  // ------------------------------------------------------------ layers
  /* One layer per LEVEL, plus a layer per kind of content, so anything can be
   * frozen independently in CAD. Colours are ACI indices — 7 is
   * black-or-white-by-background, which is what a drawing wants for linework. */
  function layerName(kind, levelName) {
    var lv = ascii(levelName || '').replace(/[^A-Za-z0-9_\-]/g, '_') || 'LEVEL';
    return 'FPC-' + lv + '-' + kind;
  }

  var LAYER_COLOUR = {
    PIPE: 7, RISER: 5, SYMBOL: 3, TAG: 2, TEXT: 8, NODE: 8
  };

  // ------------------------------------------------------------ symbols
  /* Every device symbol is circles and straight segments, which is why this
   * export is as small as it is — the canvas glyphs were already built out of
   * exactly those two things. */
  function deviceSymbol(out, layer, kind, mx, my, mz, ang, p) {
    var c = Math.cos(ang), s = Math.sin(ang);
    function at(dx, dy) { return [mx + dx * c - dy * s, my + dx * s + dy * c]; }

    if (kind === 'pump') {
      circle(out, layer, mx, my, mz, SYM_R);
      poly(out, layer, [at(-SYM_R * 0.4, -SYM_R * 0.5), at(SYM_R * 0.5, 0),
                        at(-SYM_R * 0.4, SYM_R * 0.5)], mz);
    } else if (kind === 'valve') {
      // the standard opposed-triangle bowtie, along the run
      poly(out, layer, [at(-SYM_R, -SYM_R * 0.7), at(-SYM_R, SYM_R * 0.7),
                        at(0, 0), at(-SYM_R, -SYM_R * 0.7)], mz);
      poly(out, layer, [at(SYM_R, -SYM_R * 0.7), at(SYM_R, SYM_R * 0.7),
                        at(0, 0), at(SYM_R, -SYM_R * 0.7)], mz);
    } else if (kind === 'sensor') {
      // instrument bubble on a stem, perpendicular to the run
      var bx = mx - s * SYM_R * 2.5, by = my + c * SYM_R * 2.5;
      line(out, layer, mx, my, mz, bx, by, mz);
      circle(out, layer, bx, by, mz, SYM_R * 0.8);
      var sm = (p && p.sensor && p.sensor.mode) || 'temperature';
      var lbl = sm === 'flow' ? 'F' : sm === 'pressure' ? 'P'
              : sm === 'dP' ? 'dP' : sm === 'dT' ? 'dT' : 'T';
      text(out, layer, bx - SYM_R * (lbl.length > 1 ? 0.6 : 0.3),
           by - TEXT_H * 0.4, mz, TEXT_H * 0.7, lbl);
      // where the reference line starts, and which way the stem points
      return { x: bx, y: by, nx: -s, ny: c };
    } else {                                   // equipment
      circle(out, layer, mx, my, mz, SYM_R);
      poly(out, layer, [at(-SYM_R * 0.5, -SYM_R * 0.5), at(SYM_R * 0.5, -SYM_R * 0.5),
                        at(SYM_R * 0.5, SYM_R * 0.5), at(-SYM_R * 0.5, SYM_R * 0.5),
                        at(-SYM_R * 0.5, -SYM_R * 0.5)], mz);
    }
  }

  /* A right-angle route between two model points, in the same convention as
   * `M.controlRoute` and the canvas: `horiz` true means the MIDDLE segment is
   * VERTICAL, so the route leaves and arrives horizontally. A diagonal on
   * a drawing of nothing but horizontal and vertical runs reads as a pipe drawn
   * wrong before it reads as an annotation — Michael, 2026-08-05. */
  function orthoRoute(ax, ay, bx, by, horiz) {
    var pts = horiz
      ? [[ax, ay], [(ax + bx) / 2, ay], [(ax + bx) / 2, by], [bx, by]]
      : [[ax, ay], [ax, (ay + by) / 2], [bx, (ay + by) / 2], [bx, by]];
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var q = out[out.length - 1];
      if (Math.abs(pts[i][0] - q[0]) > 1e-6 || Math.abs(pts[i][1] - q[1]) > 1e-6) out.push(pts[i]);
    }
    return out;
  }

  // ------------------------------------------------------------ the file
  /* `opts.levels` limits the export to a set of level ids (Michael, 2026-08-19:
   * "By Level exports 1 dxf file per level (leave the Z coordinates in)"). The
   * Z ordinates are UNCHANGED — a per-level file is still drawn in world
   * coordinates, so the sheets stack correctly when they are XREF'd back
   * together. Only which levels are written changes. Risers are written with the
   * level they RISE FROM, so a column appears once, on the floor it leaves. */
  function build(m, opts) {
    opts = opts || {};
    var only = opts.levels ? {} : null;
    if (only) (opts.levels || []).forEach(function (id) { only[id] = true; });
    var out = [];
    var layers = {};

    function useLayer(kind, levelName) {
      var name = layerName(kind, levelName);
      if (!layers[name]) layers[name] = LAYER_COLOUR[kind] || 7;
      return name;
    }

    /* ---- collect entities first, so the LAYER table can be written from what
     * was actually used rather than from every level that might exist. */
    var ents = [];

    m.levels.forEach(function (lv) {
      if (only && !only[lv.id]) return;
      var Lpipe = useLayer('PIPE', lv.name);
      var Lsym  = useLayer('SYMBOL', lv.name);
      var Ltag  = useLayer('TAG', lv.name);
      var Lnode = useLayer('NODE', lv.name);

      m.pipes.forEach(function (p) {
        if (p.kind === 'riser') return;               // written once, below
        var na = M.node(m, p.a), nb = M.node(m, p.b);
        if (!na || !nb) return;
        if (na.level !== lv.id || nb.level !== lv.id) return;
        var wa = M.worldXY(m, na), wb = M.worldXY(m, nb);
        var za = M.elevation(m, na), zb = M.elevation(m, nb);
        line(ents, Lpipe, wa.x, wa.y, za, wb.x, wb.y, zb);

        if (p.kind !== 'pipe') {
          var mx = (wa.x + wb.x) / 2, my = (wa.y + wb.y) / 2, mz = (za + zb) / 2;
          var ang = Math.atan2(wb.y - wa.y, wb.x - wa.x);
          var sym = deviceSymbol(ents, Lsym, p.kind, mx, my, mz, ang, p);

          /* A DIFFERENTIAL PROBES TWO PIPES, so the second one is drawn — the
           * same mark as on screen, because "dp 150 kPa" on a drawing does not
           * say across what. R12 has no dotted linetype without a LTYPE table
           * entry, so this is a solid polyline; the open square at the far
           * tapping is what identifies it. */
          var sMode = p.kind === 'sensor' && p.sensor && p.sensor.mode;
          if (sym && (sMode === 'dP' || sMode === 'dT') && p.sensor.ref) {
            var rp = M.pipe(m, p.sensor.ref);
            var rmid = rp ? M.deviceMid(m, rp) : null;
            var rna = rp ? M.node(m, rp.a) : null;
            if (rmid && rna && rna.level === lv.id) {
              var rz = M.elevation(m, rna);
              poly(ents, Lsym,
                   orthoRoute(sym.x, sym.y, rmid.x, rmid.y,
                              Math.abs(sym.nx) > Math.abs(sym.ny)), rz);
              poly(ents, Lsym, [[rmid.x - SYM_R * 0.25, rmid.y - SYM_R * 0.25],
                                [rmid.x + SYM_R * 0.25, rmid.y - SYM_R * 0.25],
                                [rmid.x + SYM_R * 0.25, rmid.y + SYM_R * 0.25],
                                [rmid.x - SYM_R * 0.25, rmid.y + SYM_R * 0.25],
                                [rmid.x - SYM_R * 0.25, rmid.y - SYM_R * 0.25]], rz);
            }
          }
          if (p.tag) text(ents, Ltag, mx + SYM_R * 1.4, my + SYM_R * 1.4, mz, TEXT_H, p.tag);
        } else if (opts.sizes !== false) {
          text(ents, Ltag, (wa.x + wb.x) / 2, (wa.y + wb.y) / 2 + TEXT_H * 0.4,
               (za + zb) / 2, TEXT_H * 0.8, p.size || '');
        }
      });

      m.nodes.forEach(function (n) {
        if (n.level !== lv.id) return;
        var w = M.worldXY(m, n), z = M.elevation(m, n);
        if (n.device) {
          circle(ents, Lsym, w.x, w.y, z, SYM_R * 0.6);
        }
        if (n.tag) text(ents, Lnode, w.x + SYM_R, w.y - SYM_R, z, TEXT_H * 0.8, n.tag);
      });
    });

    /* ---- risers, once each, as the true vertical lines they are. This is the
     * whole reason for exporting with real Z: on a stack of flat plans a riser
     * is a marker you have to interpret, and in 3D it is simply there. */
    var Lris = useLayer('RISER', 'RISERS');
    m.pipes.forEach(function (p) {
      if (p.kind !== 'riser') return;
      var na = M.node(m, p.a), nb = M.node(m, p.b);
      if (!na || !nb) return;
      /* A PER-LEVEL FILE gets the risers that TOUCH that level, so a column is
       * on both sheets it connects rather than on neither. In a 3D export
       * (`only` null) every riser is written once, as before. */
      if (only && !only[na.level] && !only[nb.level]) return;
      var wa = M.worldXY(m, na), wb = M.worldXY(m, nb);
      line(ents, Lris, wa.x, wa.y, M.elevation(m, na),
                       wb.x, wb.y, M.elevation(m, nb));
    });

    // ---- HEADER: just enough for a reader to know the extents and units
    W(out, 0, 'SECTION'); W(out, 2, 'HEADER');
    W(out, 9, '$ACADVER'); W(out, 1, 'AC1009');       // R12
    W(out, 9, '$INSUNITS'); W(out, 70, 6);            // 6 = metres
    W(out, 0, 'ENDSEC');

    // ---- TABLES: the layers, which is the only table R12 needs from us
    W(out, 0, 'SECTION'); W(out, 2, 'TABLES');
    W(out, 0, 'TABLE'); W(out, 2, 'LAYER');
    W(out, 70, Object.keys(layers).length);
    Object.keys(layers).forEach(function (name) {
      W(out, 0, 'LAYER'); W(out, 2, name);
      W(out, 70, 0);                                  // no flags: visible, thawed
      W(out, 62, layers[name]);                       // ACI colour
      W(out, 6, 'CONTINUOUS');
    });
    W(out, 0, 'ENDTAB');
    W(out, 0, 'ENDSEC');

    // ---- ENTITIES
    W(out, 0, 'SECTION'); W(out, 2, 'ENTITIES');
    out = out.concat(ents);
    W(out, 0, 'ENDSEC');
    W(out, 0, 'EOF');

    /* CRLF. The format predates anything else, and every reader copes with it
     * where a few older ones do not cope with bare LF. */
    return out.join('\r\n') + '\r\n';
  }

  FD.dxf = {
    build: build,
    /* Exposed for the test suite, which checks the section order and that the
     * layer count matches the table. */
    ascii: ascii,
    TEXT_H: TEXT_H
  };
})(window.FD = window.FD || {});
