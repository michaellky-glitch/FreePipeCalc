/* FreePipeCalc — canvas drawing surface (spec §4–§6)
 *
 * Canvas 2D view over the model. Owns the world↔screen transform, rendering,
 * and pointer interaction. It mutates the model through FD.model only, and
 * tells the app when something changed via onChange.
 *
 * World units are METRES throughout; pixels appear only inside toScreen /
 * toWorld and the hit-test radii.
 */
(function (FD) {
  'use strict';

  var M = FD.model;

  var SNAP_PX = 10;         // snap to a pipe within this many screen px (§5)
  var ENDPOINT_PX = 15;     // endpoint zone wins inside this radius (§5)
  /* Placing an in-line device is a coarser gesture than drawing: you are aiming
   * at a whole pipe run, not a coordinate, and missing costs an error message
   * and another click. Generous on purpose. */
  var DEVICE_SNAP_PX = 28;

  /* Every in-line device is exactly this long, in metres.
   *
   * A device has to occupy SOME length — it is a link with its own two nodes,
   * which is what lets the runs either side keep their own sizes and lengths.
   * Making it a constant (rather than the old min(0.35, len/4), which varied
   * with the host pipe) means the amount to subtract from a drawn run is always
   * the same number, and 0.5 m sits on the default grid. */
  var DEVICE_LEN = 0.5;
  /* Q4, Michael: an in-line device slides ALONG its run — and it lands on the
   * GRID, not on a multiple of travel.
   *
   * The first attempt quantised the DISTANCE MOVED to 0.1 m, which is a
   * different thing and reads wrong: where the device ends up then depends on
   * where it started, so two valves nudged along the same main do not line up
   * with each other or with anything else on the drawing. Michael, 2026-08-09:
   * "they should snap align with 1/2 grid, not lengths along the pipe."
   *
   * So the POSITION is snapped, to half a minor grid square. On an
   * axis-aligned run — which is nearly all of them — that is exactly grid
   * alignment, and two devices on the same main line up with each other because
   * they are both on the lattice rather than both 0.1 m from wherever they
   * happened to be. */
  var DEVICE_SLIDE_FRACTION = 0.5;          // of the minor grid
  /* HOW BIG AN ANNOTATION HANDLE IS TO CLICK ON, in GRID squares.
   *
   * Michael, 2026-08-09: control-link nodes and the cross-floor riser were both
   * "hard to select". They were a flat 22 px box, which is fine at the zoom you
   * place them at and far too small at the zoom you review a floor at — the
   * target shrank as the drawing did, because it was measured in pixels while
   * everything you are aiming at is measured in metres.
   *
   * Measured in GRID SQUARES instead, so it holds its size relative to the
   * drawing, with a pixel FLOOR so it never becomes unclickable when zoomed
   * right out. Adjustable in SETTINGS; 2 grids is the ceiling, beyond which
   * handles start swallowing each other. */
  var PICK_GRID_DEFAULT = 0.5;
  var PICK_GRID_MAX = 2;
  var PICK_FLOOR_PX = 18;                 // half-width at the DEFAULT setting
  var ANGLE_SNAP = 15;      // degrees (§5)

  /* Risers use much larger radii than drawing does. A riser belongs on existing
   * pipework; at the 10 px drawing tolerance most clicks fell through to the
   * grid instead, planting the column next to the pipe rather than on it. */
  var RISER_NODE_PX = 24;
  var RISER_PIPE_PX = 20;
  /* PROBE aims at a point ALONG a run rather than at the run itself, so it
   * takes a wider catch than a snap does. */
  var PROBE_PX = 24;

  function View(canvas, getModel, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getModel = getModel;
    this.onChange = onChange || function () {};

    this.scale = 24;                 // pixels per metre
    this.originX = 60;               // screen px of world (0,0)
    this.originY = 60;

    this.tool = 'edit';              // edit | pipe | riser | source | demand | equip | pump
    this.draft = null;               // in-progress run: {points:[{x,y}], fromNode}
    this.detailDraft = null;         // in-progress DETAIL line: {pts:[{x,y}]}
    this.dragDetail = null;          // moving a whole detail (box): {startW, items}
    this.dragDetailNode = null;      // moving a detail vertex: {verts:[{pts,index}]}
    this.dragNote = null;            // moving a note: {note, startW, ox, oy}
    this.dragRiserNote = null;       // moving a riser callout box: {riser, level, gwx, gwy}
    /* STATIC SIMULATION: the drawing is locked against anything that would
     * change the answer. Not a permission system — a performance one, and the
     * default because that is how a finished model is READ. See `locked`. */
    this.simStatic = true;
    this.cursor = null;              // world position of the pointer
    this.hover = null;               // {kind:'node'|'pipe', id}
    /* PROBE: `probeHover` follows the pointer, `probe` is pinned by a click so
     * the value can be read with the mouse out of the way. */
    this.probe = null;
    this.probeHover = null;
    /* Control links: dashed green routes from a pump or globe valve to the
     * equipment whose setpoint it follows. On by default — a hidden control
     * relationship is a surprise waiting to happen. */
    this.showControl = true;
    this.controlPick = null;          // {pipeId} while picking a target
    this.refPick = null;              // {pipeId} while picking a differential's 2nd pipe
    this.selection = [];             // [{kind,id}]
    this.marquee = null;
    this.conflict = null;          // pipe ids highlighted red by a geometry conflict
    /* Pipes/nodes the warning chip is pointing at. Kept separate from
     * `conflict`: a geometry conflict is an error that blocks an edit, a
     * warning is advisory, and they are drawn in different colours. */
    this.warnHighlight = null;     // {pipes:{id:true}, nodes:{id:true}}
    /* Which quantity, if any, is being colour-mapped over the drawing:
     * null | 'flow' | 'velocity' | 'pressure'. A VIEW overlay. */
    this.viz = null;
    this.dragTrace = null;         // in-progress trace move/scale
    this.calibrating = null;       // {points:[]} while picking two scale points
    this.results = null;             // last solve, for colouring & tooltips
    this.drawSize = null;            // size badge during DRAW
    this.lengthEntry = null;         // digits typed mid-run, committed on Enter
    this.shiftDown = false;
    this.altDown = false;

    this._bind();
    this.resize();
  }

  // ------------------------------------------------------------ transform
  View.prototype.toScreen = function (wx, wy) {
    return { x: wx * this.scale + this.originX, y: -wy * this.scale + this.originY };
  };
  View.prototype.toWorld = function (sx, sy) {
    return { x: (sx - this.originX) / this.scale, y: -(sy - this.originY) / this.scale };
  };
  View.prototype.pxToM = function (px) { return px / this.scale; };

  View.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = r.width; this.cssH = r.height;
    /* WHERE THE WORK AREA STARTS, published for anything that floats over it.
     *
     * Michael, 2026-08-09: the simulation bar overlapped the ribbon. It was
     * pinned at a hard-coded 96 px from the top, and the ribbon is not 96 px
     * tall — it WRAPS, so its height depends on the window width and on which
     * mode's tools are showing. Measured from the canvas itself, which is the
     * only thing that knows. */
    try {
      document.documentElement.style.setProperty('--work-top', Math.round(r.top) + 'px');
      document.documentElement.style.setProperty('--work-left', Math.round(r.left) + 'px');
      document.documentElement.style.setProperty('--work-width', Math.round(r.width) + 'px');
    } catch (e) { /* no document in a test harness */ }
    this.render();
  };

  View.prototype.zoomAt = function (sx, sy, factor) {
    var before = this.toWorld(sx, sy);
    this.scale = Math.max(2, Math.min(400, this.scale * factor));
    var after = this.toWorld(sx, sy);
    // keep the point under the cursor fixed (spec §4: cursor-centred zoom)
    this.originX += (after.x - before.x) * this.scale;
    this.originY -= (after.y - before.y) * this.scale;
    this.render();
  };

  /* Put a world point in the middle of the canvas, keeping the zoom. Used by
   * FIND: changing the magnification as well as the position loses the sense of
   * where you were. */
  View.prototype.centreOn = function (wx, wy) {
    this.originX = this.cssW / 2 - wx * this.scale;
    this.originY = this.cssH / 2 + wy * this.scale;
    this.render();
  };

  View.prototype.zoomToFit = function () {
    var m = this.getModel();
    var pts = m.nodes.filter(function (n) { return n.level === m.activeLevel; })
                     .map(function (n) { return M.worldXY(m, n); });
    if (!pts.length) { this.scale = 24; this.originX = 60; this.originY = this.cssH - 60; this.render(); return; }
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var w = Math.max(maxX - minX, 4), h = Math.max(maxY - minY, 4);
    var pad = 70;
    this.scale = Math.max(2, Math.min(400,
      Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / h)));
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.originX = this.cssW / 2 - cx * this.scale;
    this.originY = this.cssH / 2 + cy * this.scale;
    this.render();
  };

  // ------------------------------------------------------------ hit tests
  View.prototype.nodeAt = function (wx, wy, radiusPx) {
    var m = this.getModel(), best = null, bestD = Infinity;
    var rad = this.pxToM(radiusPx === undefined ? ENDPOINT_PX : radiusPx);
    m.nodes.forEach(function (n) {
      if (n.level !== m.activeLevel) return;
      var w = M.worldXY(m, n);
      var d = Math.hypot(w.x - wx, w.y - wy);
      if (d < rad && d < bestD) { bestD = d; best = n; }
    });
    return best;
  };

  /* An in-line device — pump, valve, equipment — is drawn as a glyph straddling
   * the midpoint of its own short pipe. Grabbing that glyph should move the
   * whole device, not just whichever end node happened to be nearest. */
  View.prototype.deviceAt = function (wx, wy, radiusPx) {
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    var rad = this.pxToM(radiusPx === undefined ? 13 : radiusPx);
    m.pipes.forEach(function (p) {
      if (!IN_LINE[p.kind]) return;
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var mx = (wa.x + wb.x) / 2, my = (wa.y + wb.y) / 2;
      var d = Math.hypot(mx - wx, my - wy);
      if (d < rad && d < bestD) { bestD = d; best = p; }
    });
    return best;
  };

  /* THE NEAREST DEVICE A CONTROLLER COULD BE, within a generous radius.
   *
   * Picking one used to be `deviceAt(13px) || pipeAt(10px)`, and a pump sits IN
   * a pipe with more pipe running away from it in both directions — so a click
   * a few pixels off the symbol found the plain pipe first, `M.canControl` said
   * no, and the answer was "click a pump or a control valve first" while the
   * pointer was on the pump. Michael, 2026-08-08: "CHWP-1 was easy to select
   * for other things like changing properties, but couldn't click it to add a
   * control link."
   *
   * Devices are searched FIRST and at the radius the eye works to, and a pipe
   * is only considered if it is itself controllable. Nothing that cannot be a
   * controller can win. */
  View.prototype.controllableAt = function (wx, wy) {
    var d = this.deviceAt(wx, wy, 26);
    if (d && M.canControl(d)) return d;
    var hit = this.pipeAt(wx, wy);
    if (hit && M.canControl(hit.pipe)) return hit.pipe;
    /* One more sweep, wider, because a control valve on a busy header can be
     * under a label or a route. Still only ever returns something linkable. */
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    var rad = this.pxToM(40);
    m.pipes.forEach(function (p) {
      if (!M.canControl(p)) return;
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var dd = Math.hypot((wa.x + wb.x) / 2 - wx, (wa.y + wb.y) / 2 - wy);
      if (dd < rad && dd < bestD) { bestD = dd; best = p; }
    });
    return best;
  };

  View.prototype.pipeAt = function (wx, wy, radiusPx) {
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    var rad = this.pxToM(radiusPx === undefined ? SNAP_PX : radiusPx);
    m.pipes.forEach(function (p) {
      if (p.kind === 'riser') return;
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var d = self._distToSeg(wx, wy, wa, wb);
      if (d.dist < rad && d.dist < bestD) { bestD = d.dist; best = { pipe: p, t: d.t, point: d.point }; }
    });
    return best;
  };

  /* Riser column near a world point, in screen-pixel tolerance. Columns are
   * level-independent, so this deliberately ignores the active level. */
  View.prototype.riserAt = function (wx, wy, radiusPx) {
    var m = this.getModel(), best = null, bestD = Infinity;
    var rad = this.pxToM(radiusPx === undefined ? ENDPOINT_PX : radiusPx);
    m.risers.forEach(function (r) {
      var d = Math.hypot(r.x - wx, r.y - wy);
      if (d < rad && d < bestD) { bestD = d; best = r; }
    });
    return best;
  };

  /* Reverse-direction button for the SELECTED directional device.
   *
   * Flipping was only reachable through the properties panel, which means
   * looking away from the drawing to fix something you are looking AT. The
   * button sits just off the device, offset along the perpendicular so it never
   * lands on the pipe itself — beside a vertical riser-mounted pump it appears
   * to one side, which is where the space is.
   *
   * Offered only when the device is selected: one on every pump at all times
   * would clutter a pump hall. */
  var FLIP_BTN = { w: 18, h: 26, off: 24 };
  View.prototype.flipButtonBox = function (p) {
    var m = this.getModel();
    if (!M.isDirectional(p)) return null;
    var a = M.node(m, p.a), b = M.node(m, p.b);
    if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return null;
    var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
    var sa = this.toScreen(wa.x, wa.y), sb = this.toScreen(wb.x, wb.y);
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var dx = sb.x - sa.x, dy = sb.y - sa.y;
    var len = Math.hypot(dx, dy) || 1;
    // unit normal to the device axis
    var nx = -dy / len, ny = dx / len;
    var cx = mx + nx * FLIP_BTN.off, cy = my + ny * FLIP_BTN.off;
    return { x: cx - FLIP_BTN.w / 2, y: cy - FLIP_BTN.h / 2,
             w: FLIP_BTN.w, h: FLIP_BTN.h, cx: cx, cy: cy,
             ang: Math.atan2(dy, dx) };
  };

  /* The selected device's flip button under this screen point, if any. */
  View.prototype.flipButtonAt = function (sx, sy) {
    var m = this.getModel(), self = this, found = null;
    this.selection.forEach(function (s) {
      if (s.kind !== 'pipe' || found) return;
      var p = M.pipe(m, s.id);
      var box = p && self.flipButtonBox(p);
      if (!box) return;
      if (sx >= box.x && sx <= box.x + box.w && sy >= box.y && sy <= box.y + box.h) {
        found = p;
      }
    });
    return found;
  };

  /* On/off button, alongside the flip button and offset a little further out.
   * Whether a pump is running is the thing most often toggled while looking at
   * a redundancy scheme, and reaching into the properties panel for it means
   * looking away from the drawing. Pumps and equipment both have one. */
  View.prototype.canToggle = function (p) {
    return !!p && ((p.kind === 'pump' && p.pump) || (p.kind === 'equip' && p.equip));
  };

  View.prototype.isDeviceOff = function (p) {
    if (!p) return false;
    if (p.kind === 'pump') return !!(p.pump && p.pump.mode === 'off');
    if (p.kind === 'equip') return !!(p.equip && p.equip.off);
    return false;
  };

  View.prototype.powerButtonBox = function (p) {
    if (!this.canToggle(p)) return null;
    var base = this.flipButtonBox(p);
    var m = this.getModel();
    if (!base) {
      /* Equipment and pumps are directional so flipButtonBox normally exists;
       * fall back to a plain perpendicular offset if it ever does not. */
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return null;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var sa = this.toScreen(wa.x, wa.y), sb = this.toScreen(wb.x, wb.y);
      var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
      var dx = sb.x - sa.x, dy = sb.y - sa.y, len = Math.hypot(dx, dy) || 1;
      base = { cx: mx + (-dy / len) * FLIP_BTN.off, cy: my + (dx / len) * FLIP_BTN.off,
               ang: Math.atan2(dy, dx), w: FLIP_BTN.w, h: FLIP_BTN.h };
    }
    // one button-width further along the same perpendicular
    var nx = Math.cos(base.ang + Math.PI / 2), ny = Math.sin(base.ang + Math.PI / 2);
    var cx = base.cx + nx * (FLIP_BTN.w + 6), cy = base.cy + ny * (FLIP_BTN.w + 6);
    return { x: cx - FLIP_BTN.w / 2, y: cy - FLIP_BTN.h / 2,
             w: FLIP_BTN.w, h: FLIP_BTN.h, cx: cx, cy: cy, ang: base.ang };
  };

  View.prototype.powerButtonAt = function (sx, sy) {
    var m = this.getModel(), self = this, found = null;
    this.selection.forEach(function (s) {
      if (s.kind !== 'pipe' || found) return;
      var p = M.pipe(m, s.id);
      var box = p && self.powerButtonBox(p);
      if (!box) return;
      if (sx >= box.x && sx <= box.x + box.w && sy >= box.y && sy <= box.y + box.h) {
        found = p;
      }
    });
    return found;
  };

  /* Toggle a device in or out of service. Pumps carry mode, equipment carries
   * an `off` flag; both mean the same thing to the network builder, which omits
   * the link entirely rather than modelling a huge resistance. */
  View.prototype.toggleDevice = function (p) {
    if (!this.canToggle(p)) return false;
    var off = this.isDeviceOff(p);
    /* Back into service in the mode ITS SIZING implies, not always 'auto' — a
     * manually-sized pump toggled off and on would otherwise be handed to the
     * sizer and lose its duty. */
    if (p.kind === 'pump') p.pump.mode = off ? M.pumpRunMode(p) : 'off';
    else if (off) delete p.equip.off; else p.equip.off = true;
    return !off ? true : false;
  };

  /* A riser marker sits directly on top of the node it attaches to, so a click
   * on the marker selects that NODE and the riser column is unreachable.
   *
   * THE NOTATION BOX IS THE HANDLE. It used to be a small triangle beside the
   * circle, which existed only because the circle sits on the node and the node
   * wins the click. The box is a bigger, more obvious target and it is already
   * off the pipework, so the workaround is gone with the thing it worked
   * around. */
  View.prototype.riserHandleAt = function (sx, sy) {
    var bs = this._riserBoxes || [];
    for (var i = bs.length - 1; i >= 0; i--) {
      var b = bs[i];
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.riser;
    }
    return null;
  };


  View.prototype._distToSeg = function (px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = a.x + t * dx, qy = a.y + t * dy;
    return { dist: Math.hypot(px - qx, py - qy), t: t, point: { x: qx, y: qy } };
  };

  /* Resolve a pointer position into a snap target (spec §5):
   * endpoint wins inside 15 px, then mid-pipe (which will insert a tee),
   * then grid, then raw.
   *
   * `allowGrid` MUST be false for every click after the first in a run.
   * Grid snapping and 15° angle snapping are mutually exclusive: rounding an
   * angle-constrained point to the nearest grid intersection throws the bearing
   * away, so a "horizontal" pipe drawn at 15° lands a few centimetres off and
   * later runs never meet it cleanly — tees stop forming. Angle wins once a run
   * has a direction; the grid only places the very first vertex. */
  View.prototype.snap = function (wx, wy, allowGrid) {
    var m = this.getModel();
    var n = this.nodeAt(wx, wy, ENDPOINT_PX);
    if (n) {
      var w = M.worldXY(m, n);
      return { kind: 'node', node: n, x: w.x, y: w.y };
    }
    var hit = this.pipeAt(wx, wy, SNAP_PX);
    if (hit) return { kind: 'pipe', pipe: hit.pipe, x: hit.point.x, y: hit.point.y };

    if (allowGrid !== false && m.settings.grid.snap) {
      var g = m.settings.grid.minor;
      return { kind: 'grid', x: Math.round(wx / g) * g, y: Math.round(wy / g) * g };
    }
    return { kind: 'free', x: wx, y: wy };
  };

  /* The point a draw click will actually land on, given the run so far.
   * Shared by drawClick and drawDraft so the preview cannot disagree with
   * what the click commits. */
  View.prototype.drawTarget = function (w) {
    var m = this.getModel();
    var anchor = this.draft ? this.draft.last : null;

    // First click of a run: no bearing to preserve, so ordinary snapping.
    if (!anchor) return this.snap(w.x, w.y, true);

    var pt = this.angleSnap(anchor.x, anchor.y, w.x, w.y);

    /* Priority is node > pipe > grid. Node and pipe are resolved on the
     * angle-constrained point, so connecting always wins over the bearing. */
    var s = this.snap(pt.x, pt.y, false);
    if (s.kind === 'node' || s.kind === 'pipe') return s;

    /* Grid comes third — but it CANNOT be applied as an absolute position, or
     * it rounds the angle-constrained point onto the nearest intersection and
     * throws the bearing away. That was the original tee bug: a "horizontal"
     * run drawn at 15° landed centimetres off and later runs never met it.
     *
     * So the grid constrains the LENGTH ALONG THE RAY instead. The bearing is
     * preserved exactly, and lengths still come out in tidy grid multiples —
     * which is what the grid is actually for while drawing. */
    /* With a trace present the user is following the drawing, not the grid, so
     * grid snapping is dropped — it would pull every vertex off the line being
     * traced. Angle and connection snapping stay: pipework is mostly
     * orthogonal, and connecting is still connecting. */
    var lvT = M.level(m, m.activeLevel);
    var tracing = !!(lvT && lvT.trace);

    if (m.settings.grid.snap && !tracing) {
      var dx = pt.x - anchor.x, dy = pt.y - anchor.y;
      var len = Math.hypot(dx, dy);
      if (len > 1e-9) {
        var g = m.settings.grid.minor;
        var snapped = Math.round(len / g) * g;
        if (snapped > 1e-9) {
          return { kind: 'grid', x: anchor.x + dx / len * snapped,
                   y: anchor.y + dy / len * snapped };
        }
      }
    }
    return s;
  };

  /* ONE MODIFIER FOR "LET ME" — Michael, 2026-08-09: "standardise Alt for
   * unconstrained movement (e.g. also for pipe angles)."
   *
   * ALT frees any constraint. Shift keeps working here because it has always
   * freed the 15° snap and the fingers know it, but Alt is the one that means
   * it everywhere: on a DEVICE drag Shift was already taken — it selects the
   * run between — so a single rule was only ever going to be Alt.
   *
   * Read from the pointer event on both down and move (§4), so it cannot go
   * stale in another window. */
  View.prototype.freeform = function () { return this.altDown || this.shiftDown; };

  /* Constrain a point to 15° increments from an anchor (Alt or Shift frees). */
  View.prototype.angleSnap = function (ax, ay, wx, wy) {
    if (this.freeform()) return { x: wx, y: wy };
    var dx = wx - ax, dy = wy - ay;
    var len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x: wx, y: wy };
    var ang = Math.atan2(dy, dx) * 180 / Math.PI;
    var snapped = Math.round(ang / ANGLE_SNAP) * ANGLE_SNAP;
    var rad = snapped * Math.PI / 180;
    return { x: ax + Math.cos(rad) * len, y: ay + Math.sin(rad) * len };
  };

  // ------------------------------------------------------- model editing
  /* Return an existing node at this snap point, or create one — splitting a
   * pipe into a tee if the point landed mid-pipe (spec §5). */
  View.prototype.nodeForSnap = function (s) {
    var m = this.getModel();
    if (s.kind === 'node') return s.node;
    if (s.kind === 'pipe') return this.splitPipe(s.pipe, s.x, s.y);

    /* A riser snap may land on a point where this level already has a node
     * (the floor below was drawn first) — reuse it rather than stacking a
     * duplicate node on top. */
    if (s.kind === 'riser') {
      var here = this.nodeAt(s.x, s.y, ENDPOINT_PX);
      if (here) return here;
    }

    /* s.x/s.y are WORLD coordinates but node coordinates are level-local, so
     * the level offset has to come back off before storing. */
    var lv = M.level(m, m.activeLevel);
    return M.addNode(m, m.activeLevel, s.x - (lv ? lv.dx : 0), s.y - (lv ? lv.dy : 0));
  };

  /* Insert a tee: replace pipe a—b with a—t and t—b, preserving properties. */
  View.prototype.splitPipe = function (p, wx, wy) {
    var m = this.getModel();
    var lv = M.level(m, m.activeLevel);
    var t = M.addNode(m, m.activeLevel, wx - lv.dx, wy - lv.dy);
    var opts = { schedule: p.schedule, size: p.size, C: p.C, kind: p.kind };
    var a = p.a, b = p.b;
    M.removePipe(m, p.id);
    M.addPipe(m, a, t.id, opts);
    M.addPipe(m, t.id, b, opts);
    return t;
  };

  View.prototype.deleteSelection = function () {
    var m = this.getModel();
    /* An annotation-only selection is still deletable while locked — it cannot
     * change the answer. Anything else is refused. */
    if (this.locked() && this.selection.some(function (s) {
      return s.kind !== 'detail' && s.kind !== 'note';
    })) { this.refuseLocked('Deleting'); return; }
    var touched = {};
    this.selection.forEach(function (s) {
      if (s.kind === 'pipe') {
        var p = M.pipe(m, s.id);
        if (p) { touched[p.a] = true; touched[p.b] = true; }
        M.removePipe(m, s.id);
      } else if (s.kind === 'riser') M.removeRiser(m, s.id);
      /* ANNOTATION IS DELETABLE TOO — Michael, 2026-08-09. Both kinds fell
       * through to `removeNode`, which quietly did nothing because no node has
       * their id, so Delete appeared to be broken on exactly the two things
       * ANNOTATION exists to place. */
      else if (s.kind === 'detail') M.removeDetail(m, s.id);
      else if (s.kind === 'note') M.removeNote(m, s.id);
      else M.removeNode(m, s.id);
    });

    /* Deleting a pipe used to leave its end nodes behind as bare dots with
     * nothing attached. They are not useful — they draw as orphans, they are
     * reported by the disconnection check, and they get in the way of snapping.
     * A node that still carries a DEVICE is kept: a source or an outflow is
     * deliberate, and losing it because its pipe was redrawn would be worse
     * than a stray dot. Riser attachments are kept for the same reason. */
    var riserNodes = {};
    m.risers.forEach(function (r) {
      r.attachments.forEach(function (a) { riserNodes[a.node] = true; });
    });
    Object.keys(touched).forEach(function (id) {
      var n = M.node(m, id);
      if (!n || n.device || riserNodes[id]) return;
      if (M.pipesAt(m, id).length === 0) M.removeNode(m, id);
    });

    this.selection = [];
    this.changed();
  };

  /* IS THIS EDIT LOCKED OUT?
   *
   * Michael, 2026-08-08: in STATIC you can view every property and move control
   * nodes, but you cannot move pipes, equipment or controls — anything that
   * changes the simulated result. The purpose is performance: on a model with
   * five control loops every geometry nudge costs a fifty-second re-solve, and
   * most of the time in SIMULATE you are reading, not drawing.
   *
   * So the test is exactly "would this change the answer?" — annotation,
   * labels, control-link ROUTES and the selection are all free, because none of
   * them reaches the solver. */
  View.prototype.locked = function () {
    var m = this.getModel();
    return !!(this.simStatic && m && m.settings &&
              m.settings.calcMode === 'simulation');
  };

  /* Say so once, rather than silently ignoring the gesture — a drawing that
   * does not respond and does not explain is indistinguishable from a bug. */
  View.prototype.refuseLocked = function (what) {
    this.onMessage && this.onMessage(
      (what || 'That') + ' is locked in STATIC simulation. Switch to DYNAMIC on ' +
      'the ribbon to edit while simulating.', 'error');
    return true;
  };

  View.prototype.changed = function () {
    this.onChange();
    this.render();
  };

  /* ARRANGING IS NOT CALCULATING.
   *
   * Between an EDIT (`changed` — the answer may have moved, so solve and save)
   * and a SELECTION (`selectionChanged` — nothing about the document moved at
   * all) there is a third thing, and it had nowhere to go: a change to the
   * DRAWING that the solver cannot see. Dragging a label, moving a note,
   * repositioning the TRACE image, bending a control-link leader, sliding the
   * whole model onto the grid with ALIGN. Every one of those is a real document
   * change and must be SAVED — and not one of them can alter a single number,
   * so scheduling a forty-second solve for it is pure waste.
   *
   * Michael, 2026-08-09: "Clicking on pipes in static mode & selecting probe is
   * still causing recalculates." The single-click selection path was fixed in
   * v0.16.0; these were not, and neither was the tool change.
   *
   * Falls back to `onChange` when a host has not wired `onArrange`, so an
   * unaware embedder still gets correct behaviour — just the slow kind. */
  View.prototype.arranged = function () {
    if (this.onArrange) this.onArrange(); else this.onChange();
    this.render();
  };

  /* SELECTING SOMETHING IS NOT AN EDIT.
   *
   * Every selection went through `changed()`, which re-renders the panel AND
   * schedules a solve AND schedules a save. On a 275-pipe model with five
   * control loops that is a fifty-second solve triggered by clicking a pipe —
   * Michael, 2026-08-08: "Selecting something also causes a short freeze."
   *
   * Nothing about the answer depends on what is selected, so this reports the
   * panel and redraws and stops there. */
  View.prototype.selectionChanged = function () {
    if (this.onSelect) this.onSelect();
    this.render();
  };

  // ------------------------------------------------------------- events
  View.prototype._bind = function () {
    var self = this, c = this.canvas;

    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (self.tool === 'pipe' && !e.ctrlKey) {
        // Scroll steps pipe size during DRAW; Ctrl+scroll still zooms (§5)
        var m = self.getModel();
        var cur = self.drawSize || m.settings.lastSize ||
                  FD.schedules.defaultSize(m.settings.schedule, m.customSchedules);
        self.drawSize = FD.schedules.step(m.settings.schedule, cur,
                                          e.deltaY < 0 ? 1 : -1, m.customSchedules);
        self.render();
        return;
      }
      var r = c.getBoundingClientRect();
      self.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    c.addEventListener('pointerdown', function (e) {
      /* Shift, from the event that is happening — see the note on pointermove.
       * Read here too so the FIRST click of a gesture cannot act on a stale
       * modifier: a detail line's opening vertex is placed by a pointerdown
       * with no pointermove of its own, and it was snapping or not according to
       * whatever the last move had seen. Michael, 2026-08-09. */
      self.shiftDown = e.shiftKey;
      self.altDown = e.altKey;
      var r = c.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var w = self.toWorld(sx, sy);
      var m0 = self.getModel();
      self.shiftDown = e.shiftKey;            // authoritative — see pointermove
      self.altDown = e.altKey;

      if (e.button === 1) {                       // middle drag = pan (§4)
        self.panning = { sx: sx, sy: sy, ox: self.originX, oy: self.originY };
        c.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button === 2) {                       // right click ends a run (§5)
        if (self.draft) { self.endDraft(); }
        return;
      }
      if (e.button !== 0) return;

      if (self.tool === 'trace') {
        /* Calibration takes precedence: while it is armed, clicks are
         * measurement points, not manipulation. */
        if (self.calibrating) {
          var cpt = { x: w.x, y: w.y };
          /* The SECOND point snaps to 15° from the first, so a scale set along a
           * known horizontal, vertical or diagonal run lands true. Shift or Alt
           * frees the snap, the same as drawing a pipe. */
          if (self.calibrating.points.length === 1) {
            var a0 = self.calibrating.points[0];
            cpt = self.angleSnap(a0.x, a0.y, w.x, w.y);
          }
          self.calibrating.points.push(cpt);
          if (self.calibrating.points.length === 2) {
            var pts = self.calibrating.points;
            self.calibrating = null;
            if (self.onCalibrate) self.onCalibrate(pts[0], pts[1]);
          }
          self.render();
          return;
        }
        var thit = self.traceHitAt(sx, sy);
        if (thit) {
          self.dragTrace = {
            part: thit.part, trace: thit.trace,
            sx: sx, sy: sy,
            x0: thit.trace.x, y0: thit.trace.y, w0: thit.trace.width
          };
          c.setPointerCapture(e.pointerId);
        }
        return;
      }
      /* Picking a control target: the next click on a piece of equipment
       * links it. Anything else cancels, so a mis-click does not leave the
       * canvas in a mode the user cannot see. */
      /* Picking the SECOND pipe for a differential sensor — same gesture as a
       * control link, and cancelled the same way. */
      if (self.refPick) {
        var refHit = (self.pipeAt(w.x, w.y) || {}).pipe;
        var refSrc = M.pipe(m0, self.refPick.pipeId);
        self.refPick = null;
        if (refHit && refSrc && refSrc.sensor && refHit.id !== refSrc.id) {
          self.onBeforeEdit();
          refSrc.sensor.ref = refHit.id;
          self.onMessage('Measuring against ' + (refHit.tag || refHit.id) + '.');
        } else {
          self.onMessage('Reference cancelled.', 'error');
        }
        self.changed();
        return;
      }
      if (self.controlPick) {
        /* THE SECOND CLICK, whichever end it is. Started from a device, this
         * looks for a target; started from a target, for a device. One
         * implementation of "what may be linked to what" either way. */
        var startedAtTarget = (self.controlPick.from === 'target');
        var pickHit, src;
        if (startedAtTarget) {
          src = self.controllableAt(w.x, w.y);
          pickHit = M.pipe(m0, self.controlPick.targetId);
        } else {
          pickHit = self.deviceAt(w.x, w.y, 26) || (self.pipeAt(w.x, w.y) || {}).pipe;
          src = M.pipe(m0, self.controlPick.pipeId);
        }
        self.controlPick = null;
        if (startedAtTarget && !src) {
          self.onMessage('Nothing linked — pick a pump or a control valve.', 'error');
          self.changed();
          return;
        }
        if (pickHit && M.canBeControlled(pickHit) && src) {
          self.onBeforeEdit();
          M.setControl(m0, src, pickHit.id);
          self.onMessage('Control linked to ' + (pickHit.tag || pickHit.id) + '.');
        } else {
          self.onMessage('Nothing linked — pick a piece of equipment.', 'error');
        }
        self.changed();
        return;
      }

      /* A DETAIL LINE or a NOTE is selectable in either arranging tool, so its
       * colour can be changed and it can be deleted. Tried BEFORE the model's
       * own hit tests in VIEW, and after them in EDIT: while arranging you are
       * reaching for the annotation, while editing you are reaching for the
       * pipework underneath it. */
      function pickAnnotation() {
        var n2 = self.noteAt(sx, sy);
        if (n2) { self.selection = [{ kind: 'note', id: n2.id }]; self.selectionChanged(); return true; }
        var d2 = self.detailAt(w.x, w.y, 8);
        if (d2) { self.selection = [{ kind: 'detail', id: d2.id }]; self.selectionChanged(); return true; }
        return false;
      }

      if (self.tool === 'view') {
        /* ARMED BY "ADD LINK NODE": the next click on a route puts a bend where
         * it landed, then disarms. One click, one bend — arming that stayed on
         * would scatter them. */
        if (self.addLinkNode) {
          var adding = (self.addLinkNode !== 'remove');
          var rp = adding ? self.routePointAt(w.x, w.y)
                          : self.routeVertexAt(w.x, w.y);
          self.addLinkNode = false;
          self.linkNodeHover = null;
          if (rp) {
            self.onBeforeEdit();
            if (adding) self.addRouteNodeAt(rp); else self.removeRouteNodeAt(rp);
            self.onMessage(adding ? 'Node added — drag it where you want it.'
                                  : 'Node removed.');
            /* ARRANGING, NOT EDITING. Michael, 2026-08-09: "adding a link node
             * triggered a simulation, should not." A bend in a dashed leader
             * cannot move a number. */
            self.arranged();
          } else {
            self.onMessage(adding ? 'No control link or ΔP route there.'
                                  : 'No link node there to remove.', 'error');
            self.render();
          }
          return;
        }
        /* The riser first: it sits ON the end of the route, so a bend handle
         * at the same spot would win and drag the wrong thing. */
        var crh = self.controlRiserAt(sx, sy);
        if (crh) {
          self.onBeforeEdit();
          self.dragControlRiser = { pipe: crh.pipe };
          c.setPointerCapture(e.pointerId);
          return;
        }
        var ch = self.controlHandleAt(sx, sy);
        if (ch) {
          self.dragControl = { pipe: ch.pipe, host: ch.host, key: ch.key,
                               axis: ch.axis, from: ch.from, to: ch.to,
                               tap: ch.tap, vertex: ch.vertex, route: ch.route,
                               startW: w };
          c.setPointerCapture(e.pointerId);
          return;
        }
        /* THE RISER NOTATION BOX MOVES HERE, its leader staying attached to the
         * circle on the pipework (Michael, 2026-08-10). The box is the callout;
         * the circle is fixed on the connection. */
        var rbox = self.riserHandleAt(sx, sy);
        if (rbox) {
          self.onBeforeEdit();
          var sc = self.toScreen(rbox.x, rbox.y);
          var noff0 = rbox.noteOffset && rbox.noteOffset[self.getModel().activeLevel];
          var defc = (RISER_R + RISER_GAP) * Math.SQRT1_2 + RISER_BOX / 2;
          var cx0 = sc.x + (noff0 ? noff0.dx : defc);
          var cy0 = sc.y + (noff0 ? noff0.dy : defc);
          self.dragRiserNote = { riser: rbox, level: self.getModel().activeLevel,
                                 gwx: cx0 - sx, gwy: cy0 - sy };
          self.selection = [{ kind: 'riser', id: rbox.id }];
          c.setPointerCapture(e.pointerId);
          self.selectionChanged();
          return;
        }
        /* DETAIL LINES AND THEIR NODES MOVE HERE (Michael, 2026-08-10). A vertex
         * under the pointer moves on its own — together with any vertex exactly
         * coincident with it, so a shared corner, or the doubled first/last point
         * of a closed box, stays joined. A segment moves the WHOLE connected
         * detail: every line that shares a corner with it, i.e. the whole box. */
        var dnode = self.detailNodeAt(sx, sy, 8);
        if (dnode) {
          self.onBeforeEdit();
          self.dragDetailNode = { verts: self.coincidentDetailVertices(dnode.x, dnode.y) };
          self.selection = [{ kind: 'detail', id: dnode.detail.id }];
          c.setPointerCapture(e.pointerId);
          self.selectionChanged();
          return;
        }
        /* A NOTE moves as a whole — it has no vertices. */
        var nHit = self.noteAt(sx, sy);
        if (nHit) {
          self.onBeforeEdit();
          self.dragNote = { note: nHit, startW: w, ox: nHit.x, oy: nHit.y };
          self.selection = [{ kind: 'note', id: nHit.id }];
          c.setPointerCapture(e.pointerId);
          self.selectionChanged();
          return;
        }
        var dline = self.detailAt(w.x, w.y, 8);
        if (dline) {
          self.onBeforeEdit();
          self.dragDetail = {
            startW: w,
            items: self.connectedDetails(dline).map(function (d) {
              return { detail: d, orig: d.pts.map(function (q) { return { x: q.x, y: q.y }; }) };
            })
          };
          self.selection = [{ kind: 'detail', id: dline.id }];
          c.setPointerCapture(e.pointerId);
          self.selectionChanged();
          return;
        }
        if (pickAnnotation()) return;
        var lab = self.labelAt(sx, sy);
        if (lab) {
          /* Anchor = where the label would sit with zero offset. Kept in SCREEN
           * pixels because that is what labelOffset stores, and recovered by
           * subtracting the current offset from the label box the renderer just
           * registered. Needed so the label can be snapped to the world grid
           * rather than only moved by a pixel delta. */
          /* Anything with its own offset key moves independently of the
           * entity's own label: the disconnection ⚠️, and the "Show on
           * drawing" value box. */
          var loKey = (lab.kind === 'warn' || lab.kind === 'box' ||
                       lab.kind === 'sensor') ? lab.kind : null;
          var lo = M.labelOffset(lab.obj, loKey);
          self.dragLabel = { target: lab.obj, sx: sx, sy: sy, key: loKey,
                             ox: lo.dx, oy: lo.dy,
                             ax: lab.x - lo.dx, ay: lab.y - lo.dy };
          /* A value box belongs to its entity, so grabbing one selects THAT —
           * `kind: 'box'` would select nothing and empty the properties panel
           * at the moment you are using it. */
          var selKind = (lab.kind === 'box' || lab.kind === 'sensor')
            ? (lab.obj.a !== undefined ? 'pipe' : 'node')   // only a pipe has ends
            : lab.kind;
          self.selection = [{ kind: selKind, id: lab.obj.id }];
          c.setPointerCapture(e.pointerId);
          self.selectionChanged();
          return;
        }
        /* No label under the pointer.
         *
         * ANNOTATION DOES NOT SELECT PIPEWORK. Michael, 2026-08-09: "in
         * Annotation mode, make pipes unselectable — prioritise annotation
         * nodes, tags, etc." Everything this mode can move sits ON TOP of the
         * drawing, and the pipe underneath was winning clicks aimed at the
         * thing above it. So plain pipes, nodes and risers are not selectable
         * here at all, and a click that finds no annotation clears instead.
         *
         * A DEVICE STILL IS, because VIEW is where the "Show on drawing"
         * checkboxes live: without it the only way to reach a pump's display
         * options is to select it in EDIT and switch modes, which is the
         * complaint that put selection here in the first place. Dragging a node
         * is still not offered — VIEW arranges the drawing, it does not move
         * geometry. */
        var vd = self.deviceAt(w.x, w.y);
        if (vd) { self.selection = [{ kind: 'pipe', id: vd.id }]; self.selectionChanged(); return; }
        self.selection = [];
        self.selectionChanged();
        return;
      }
      /* PROBE: a click PINS the reading, so you can take the mouse off the
       * drawing to write the number down. Clicking off any pipe clears it. */
      if (self.tool === 'probe') {
        var pp = self.pipeAt(w.x, w.y, PROBE_PX);
        self.probe = pp ? { pipe: pp.pipe, t: pp.t, point: pp.point } : null;
        self.render();
        return;
      }
      /* DROP THE PASTE. Before every other tool, because while a placement is in
       * flight that is the only thing a click can mean. */
      if (self.pasting) {
        var ps = self.pasting;
        if (!ps.at) { ps.at = self.snapWorld(w); }
        self.onBeforeEdit();
        var frag = ps.frag, mdl = self.getModel();
        var anchorNode = null;
        frag.nodes.forEach(function (n) { if (n.id === frag.anchor) anchorNode = n; });
        /* The follow point: the anchor node for pipework, else the annotation's
         * own corner (`anchorPt`), so a details-and-notes fragment lands where
         * the pointer is too. */
        var ax = anchorNode ? anchorNode.x : (frag.anchorPt ? frag.anchorPt.x : 0);
        var ay = anchorNode ? anchorNode.y : (frag.anchorPt ? frag.anchorPt.y : 0);
        var join = {};
        if (ps.onto && frag.anchor) join[frag.anchor] = ps.onto;
        var res = M.insertFragment(mdl, frag, {
          level: mdl.activeLevel,
          dx: ps.at.x - ax,
          dy: ps.at.y - ay,
          joinTo: join,
          retag: true
        });
        var ontoPipe = ps.ontoPipe;
        self.pasting = null;
        if (!res) { self.onMessage('Nothing pasted.', 'error'); self.render(); return; }
        /* TEE INTO THE PIPE the anchor landed on. The anchor was placed on the
         * pipe line above, so splitting there gives a clean junction — the same
         * result as dragging a node onto a run. Skipped when the anchor joined an
         * existing node instead (join), or when the fragment has no anchor. */
        var teedInto = null;
        if (ontoPipe && frag.anchor && res.map && res.map[frag.anchor] && M.splitPipeAt) {
          teedInto = M.splitPipeAt(mdl, ontoPipe, res.map[frag.anchor]);
        }
        /* The copy becomes the selection, so it can be moved or deleted
         * immediately — a paste you cannot undo by eye is a paste you have to
         * hunt for. */
        self.selection = res.pipes.map(function (p) { return { kind: 'pipe', id: p.id }; })
          .concat((res.details || []).map(function (d) { return { kind: 'detail', id: d.id }; }))
          .concat((res.notes || []).map(function (n) { return { kind: 'note', id: n.id }; }));
        var bits = [];
        if (res.pipes.length) bits.push(res.pipes.length + ' pipe' + (res.pipes.length === 1 ? '' : 's'));
        var anno = (res.details || []).length + (res.notes || []).length;
        if (anno) bits.push(anno + ' annotation' + (anno === 1 ? '' : 's'));
        var msg = (bits.length ? bits.join(' · ') : 'Nothing') + ' pasted';
        var extra = [];
        if (teedInto) extra.push('teed into ' + ontoPipe);
        if (res.retagged.length) extra.push(res.retagged.length + ' retagged');
        if (res.dropped.length) extra.push(res.dropped.length + ' link' +
          (res.dropped.length === 1 ? '' : 's') + ' dropped');
        if (extra.length) msg += ' · ' + extra.join(' · ');
        self.onMessage(msg + '.');
        /* A pipework paste is an edit — it solves. An annotation-only paste is a
         * drawing change and nothing more, so it saves without a solve (the
         * three-verb rule, §4). */
        if (res.pipes.length || res.nodes.length) self.changed();
        else self.arranged();
        return;
      }

      /* THE CONTROL LINK TOOL. Click the controller, then its target — the
       * same two-click gesture the panel button already started, but reachable
       * without first selecting the pump and finding the button. Michael's UI
       * pass, 2026-08-06: linking is a thing you DO on the drawing, so it
       * belongs on the ribbon beside the sensors it links to.
       *
       * The second click is handled by the `controlPick` branch above, so there
       * is one implementation of "what may be linked to what". */
      if (self.tool === 'link') {
        /* EITHER ORDER. Michael, 2026-08-09: "Add Control should allow reverse
         * direction (sensor → pump/valve as well as pump/valve → sensor)."
         *
         * You point at the two things and the app works out which is which —
         * a pump can only ever be the FOLLOWER and a sensor only ever the
         * TARGET, so there is nothing ambiguous to resolve and no reason to
         * make the hand remember an order. Starting from the sensor is the
         * natural gesture when the sensor is what you just placed. */
        var lp = self.controllableAt(w.x, w.y);
        if (lp) {
          self.controlPick = { pipeId: lp.id, from: 'device' };
          self.onMessage('Now click the sensor or equipment ' +
                         (lp.tag || lp.id) + ' should follow.');
          self.render();
          return;
        }
        var tp = self.deviceAt(w.x, w.y, 26) || (self.pipeAt(w.x, w.y) || {}).pipe;
        if (tp && M.canBeControlled(tp)) {
          self.controlPick = { targetId: tp.id, from: 'target' };
          self.onMessage('Now click the pump or valve that should follow ' +
                         (tp.tag || tp.id) + '.');
          self.render();
          return;
        }
        self.onMessage('Click a pump, a valve, or the sensor they should follow.',
                       'error');
        return;
      }
      /* DETAIL: a free line that the model never sees. Click to place vertices,
       * Esc or a click on the last point to finish. Clicking an EXISTING detail
       * line erases it — Michael asked for "draw & erase" as one tool, and a
       * separate eraser would be a second mode to be in. */
      if (self.tool === 'detail') {
        var hitD = self.detailAt(w.x, w.y, 8);
        if (hitD && !self.detailDraft) {
          self.onBeforeEdit();
          M.removeDetail(m0, hitD.id);
          self.onMessage('Detail line erased.');
          self.changed();
          return;
        }
        /* SNAPPED, like pipework (Michael, 2026-08-08). A detail line is
         * drawing a room or a plant box over a drawing that is entirely
         * orthogonal, so a free-hand vertex is almost never what is wanted.
         * The first point takes the grid; every one after also takes the 15°
         * constraint from the point before it, and Shift frees both — the same
         * two rules the PIPE tool has, so the hand does not have to learn a
         * second set. */
        var dp = self.detailTarget(w);
        if (!self.detailDraft) self.detailDraft = { pts: [dp] };
        else {
          var lastP = self.detailDraft.pts[self.detailDraft.pts.length - 1];
          if (Math.hypot(dp.x - lastP.x, dp.y - lastP.y) < 1e-9) {
            self.endDetail();
            return;
          }
          self.detailDraft.pts.push(dp);
        }
        self.render();
        return;
      }
      /* TEXT BOX: click to place, click an existing one to re-edit it. */
      if (self.tool === 'text') {
        var hitN = self.noteAt(sx, sy);
        if (hitN) { self.editNote(hitN); return; }
        var np = self.snapWorld(w);
        self.onBeforeEdit();
        var note = M.addNote(m0, m0.activeLevel, np.x, np.y, 'Note');
        self.changed();
        self.editNote(note, true);
        return;
      }
      /* EVERY PLACEMENT TOOL IS AN EDIT. Annotation is not — DETAIL and TEXT
       * draw on top of the model and the solver never sees them, so they stay
       * available while a simulation is locked. */
      if (self.locked() &&
          /^(pipe|riser|source|demand|pump|equip|valve|sensor|link|align)$/.test(self.tool)) {
        return self.refuseLocked('Drawing');
      }
      if (self.tool === 'pipe') { self.drawClick(w); return; }
      if (self.tool === 'source' || self.tool === 'demand') { self.deviceClick(w); return; }
      if (self.tool === 'pump') { self.pumpClick(w); return; }
      if (self.tool === 'valve') { self.valveClick(w); return; }
      if (self.tool === 'equip') { self.equipClick(w); return; }
      if (self.tool === 'sensor') { self.sensorClick(w); return; }
      if (self.tool === 'riser') { self.riserClick(w); return; }

      /* ALIGN: grab any node and the WHOLE model follows.
       *
       * Drawn geometry drifts off the grid — a run gets nudged, a riser
       * alignment slides a floor — and after that every new vertex snaps to a
       * lattice the drawing no longer sits on. Rather than move everything by
       * hand, grab a node you know the true position of and drag; the model
       * moves under it and the grab point lands on the grid.
       *
       * Implemented as a LEVEL OFFSET change on every level, not a coordinate
       * rewrite: offsets are exactly the field that exists for moving a floor
       * in world space without touching geometry or lengths (spec §7.1), so
       * nothing about the hydraulics can change. */
      if (self.tool === 'align') {
        var an = self.nodeAt(w.x, w.y, ENDPOINT_PX * 1.6);
        if (an) {
          var wn0 = M.worldXY(self.getModel(), an);
          self.dragAlign = {
            node: an.id,
            grabX: w.x, grabY: w.y,
            offX: wn0.x - w.x, offY: wn0.y - w.y,
            base: self.getModel().levels.map(function (l) {
              return { id: l.id, dx: l.dx || 0, dy: l.dy || 0 };
            })
          };
          c.setPointerCapture(e.pointerId);
          self.render();
        } else {
          self.onMessage && self.onMessage(
            'Grab a node to move the whole model with it.', 'error');
        }
        return;
      }

      // EDIT: select, or start a marquee

      /* The selected device's reverse button takes precedence over everything:
       * it deliberately sits close to the device it belongs to, so any other
       * test would swallow the click. */
      var pb = self.powerButtonAt(sx, sy);
      if (pb) {
        if (self.locked()) return self.refuseLocked('Isolating a device');
        if (self.onBeforeEdit) self.onBeforeEdit();
        self.toggleDevice(pb);
        self.onMessage && self.onMessage(
          (pb.tag || pb.id) + ' is now ' +
          (self.isDeviceOff(pb) ? 'OFF (isolated — no flow)' : 'running') + '.');
        self.changed();
        return;
      }

      var fb = self.flipButtonAt(sx, sy);
      if (fb) {
        if (self.locked()) return self.refuseLocked('Reversing a device');
        if (self.onBeforeEdit) self.onBeforeEdit();
        M.flipPipe(self.getModel(), fb.id);
        self.onMessage && self.onMessage(
          'Reversed ' + (fb.tag || fb.id) + ' — now ' + fb.a + ' → ' + fb.b + '.');
        self.changed();
        return;
      }

      /* Riser select handle first: the marker sits on top of a node, so without
       * a dedicated handle the node always wins and the column cannot be
       * selected to size it. */
      var rh = self.riserHandleAt(sx, sy);
      if (rh) {
        self.selection = [{ kind: 'riser', id: rh.id }];
        c.setPointerCapture(e.pointerId);
        self.selectionChanged();
        return;
      }

      var s = self.snap(w.x, w.y);
      /* Device before node: its glyph sits between two nodes only a few hundred
       * millimetres apart, so a click in the middle would otherwise always grab
       * an end node and shear the device instead of moving it. */
      /* TWO MODIFIERS, TWO JOBS (Michael, 2026-08-08).
       *
       *   CTRL   add this one to the selection, or take it back out if it is
       *          already in — building a set by hand.
       *   SHIFT  select the whole RUN between what is selected and this, by
       *          shortest path.
       *
       * The second does two things at once: it is the quick way to give a
       * whole line one size, and it is a CONNECTIVITY CHECK — if the two ends
       * are not actually joined, nothing is selected and it says so. On a
       * drawing where a tee looks made and is not, that is the fastest test
       * available.
       *
       * Cmd counts as Ctrl, because on a Mac it is the same gesture.
       *
       * NEITHER STARTS A DRAG. Moving a device or a node while assembling a
       * selection is not a gesture anyone means, and it would silently move
       * geometry during what reads as a selection. Declared HERE, above the
       * device branch, because that branch selects too. */
      var adding = !!(e.ctrlKey || e.metaKey);
      var pathing = !!e.shiftKey && !adding;
      var modifying = adding || pathing;

      function pick(kind, id) {
        if (pathing && kind === 'pipe') {
          /* From the last PIPE in the selection — the one most recently
           * clicked, which is the end of the run you are tracing. */
          var fromId = null;
          for (var i = self.selection.length - 1; i >= 0; i--) {
            if (self.selection[i].kind === 'pipe') { fromId = self.selection[i].id; break; }
          }
          if (!fromId) { self.selection = [{ kind: 'pipe', id: id }]; return; }
          var run = M.pathBetween(self.getModel(), fromId, id);
          if (!run) {
            self.onMessage && self.onMessage(
              'No pipework connects those two — they are on separate systems.',
              'error');
            return;
          }
          self.selection = run.map(function (pid) { return { kind: 'pipe', id: pid }; });
          self.onMessage && self.onMessage(
            run.length + ' pipe' + (run.length === 1 ? '' : 's') + ' along that run.');
          return;
        }
        if (!adding) { self.selection = [{ kind: kind, id: id }]; return; }
        var at = -1;
        self.selection.forEach(function (x, i) {
          if (x.kind === kind && x.id === id) at = i;
        });
        if (at >= 0) self.selection.splice(at, 1);
        else self.selection = self.selection.concat([{ kind: kind, id: id }]);
      }

      var dev = self.deviceAt(w.x, w.y);
      var n = dev ? null : self.nodeAt(w.x, w.y);
      if (dev) {
        var mSel = self.getModel();
        var da = M.node(mSel, dev.a), db = M.node(mSel, dev.b);
        pick('pipe', dev.id);
        if (!modifying && !self.locked()) {
          self.dragDevice = {
            pipe: dev, startX: w.x, startY: w.y,
            ax: da.x, ay: da.y, bx: db.x, by: db.y,
            axis: self.deviceSlideAxis(dev)
          };
          c.setPointerCapture(e.pointerId);
        }
        self.selectionChanged();
        return;
      }
      if (n) {
        pick('node', n.id);
        if (!modifying && !self.locked()) self.dragNode = { id: n.id, startX: w.x, startY: w.y };
      } else {
        var hit = self.pipeAt(w.x, w.y);
        if (hit) {
          pick('pipe', hit.pipe.id);
        } else {
          /* Riser last: its marker sits on top of the node it attaches to, so
           * testing it first would make the node underneath unreachable. */
          var rs = self.riserAt(w.x, w.y);
          if (rs) pick('riser', rs.id);
          /* A DETAIL LINE OR A NOTE, if nothing in the model was under the
           * click. A4, Michael 2026-08-08: details were not selectable, and
           * this is why — `pickAnnotation` says in its own comment that it is
           * tried "before the model's own hit tests in VIEW, and after them in
           * EDIT", and the second half was never wired. It existed, it was
           * documented, and it was called from exactly one place.
           *
           * AFTER the model, deliberately: while editing you are reaching for
           * the pipework underneath the annotation, not for the annotation. And
           * only on a plain click — with Ctrl or Shift held you are assembling
           * a selection by hand, and a stray detail line should not replace it. */
          else if (!modifying && pickAnnotation()) return;
          else if (!modifying) {
            self.selection = [];
            self.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
          }
        }
      }
      c.setPointerCapture(e.pointerId);
      self.selectionChanged();
    });

    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var w = self.toWorld(sx, sy);
      self.cursor = w;
      /* THE POINTER EVENT IS THE AUTHORITY ON SHIFT, not the key handlers.
       *
       * `shiftDown` was set on keydown and cleared on keyup, and a keyup that
       * arrives somewhere else never clears it — hold Shift, Alt+Tab away
       * (Shift+Alt+Tab IS the reverse app switch), come back, and it is stuck
       * true forever. Shift suppresses 15° snapping, so the symptom is
       * "pipes stopped snapping to 15 degree angles" with nothing in the model
       * to explain it. Michael, 2026-08-06.
       *
       * Every pointer event carries the modifier state as it actually is at
       * that instant, so reading it here cannot go stale — and a pointermove
       * always precedes the click that would use it. */
      self.shiftDown = e.shiftKey;
      self.altDown = e.altKey;

      if (self.panning) {
        self.originX = self.panning.ox + (sx - self.panning.sx);
        self.originY = self.panning.oy + (sy - self.panning.sy);
        self.render();
        return;
      }
      if (self.dragTrace) {
        var d0 = self.dragTrace, t0 = d0.trace;
        var dxm = (sx - d0.sx) / self.scale, dym = -(sy - d0.sy) / self.scale;
        if (d0.part === 'body') {
          t0.x = d0.x0 + dxm;
          t0.y = d0.y0 + dym;
        } else {
          /* Corner drag scales about the OPPOSITE corner, aspect always
           * locked — a background stretched out of proportion is worse than
           * useless for tracing. */
          var anchorX = (d0.part === 'nw' || d0.part === 'sw') ? d0.x0 + d0.w0 : d0.x0;
          var anchorY = (d0.part === 'nw' || d0.part === 'ne')
            ? d0.y0 - d0.w0 * t0.aspect : d0.y0;
          var wx = self.toWorld(sx, sy).x;
          var newW = Math.abs(wx - anchorX);
          if (newW > 0.05) {
            t0.width = newW;
            t0.x = Math.min(anchorX, wx);
            t0.y = (d0.part === 'nw' || d0.part === 'ne')
              ? anchorY + newW * t0.aspect : anchorY;
          }
        }
        self.render();
        return;
      }
      /* THE PASTE FOLLOWS THE POINTER, by its anchor. */
      if (self.pasting) {
        var pw = self.snapWorld(w);
        /* SNAP ONTO AN EXISTING NODE if there is one under the anchor. That is
         * how the copy joins the drawing, and it is the same endpoint radius
         * every other join uses. Failing a node, snap onto a PIPE under the
         * anchor so the paste TEES INTO the run — the same rule as dragging a
         * node onto a pipe (Michael, 2026-08-16: paste onto a pipe did not
         * connect). The anchor lands on the pipe line so the tee is clean. */
        var onto = self.nodeAt(w.x, w.y, ENDPOINT_PX);
        if (onto) {
          self.pasting.at = M.worldXY(self.getModel(), onto);
          self.pasting.onto = onto.id;
          self.pasting.ontoPipe = null;
        } else {
          var hitp = self.pipeAt(w.x, w.y, SNAP_PX);
          if (hitp && hitp.pipe && hitp.pipe.kind === 'pipe') {
            self.pasting.at = hitp.point;
            self.pasting.onto = null;
            self.pasting.ontoPipe = hitp.pipe.id;
          } else {
            self.pasting.at = pw;
            self.pasting.onto = null;
            self.pasting.ontoPipe = null;
          }
        }
        self.render();
        return;
      }
      /* WHERE THE NODE WOULD GO. Michael asked to see it before committing —
       * with a small handle and a dashed line to aim at, "click anywhere on the
       * route" is a promise the eye cannot check. */
      if (self.addLinkNode) {
        var prevH = self.linkNodeHover;
        self.linkNodeHover = (self.addLinkNode === 'remove')
          ? self.routeVertexAt(w.x, w.y)
          : self.routePointAt(w.x, w.y);
        var pa = prevH && prevH.point, pb = self.linkNodeHover && self.linkNodeHover.point;
        if (!pa !== !pb || (pa && pb && (Math.abs(pa.x - pb.x) > 1e-9 ||
                                         Math.abs(pa.y - pb.y) > 1e-9))) self.render();
        return;
      }
      if (self.dragRiserNote) {
        /* The box follows the pointer; the leader is redrawn from the circle to
         * it every frame, so it stays attached. Snapped to the grid in WORLD,
         * like a label, and freed by Shift/Alt. Offset kept in screen pixels
         * relative to the circle, so it holds through zoom. */
        var drn = self.dragRiserNote;
        var sc2 = self.toScreen(drn.riser.x, drn.riser.y);
        var bcx = sx + drn.gwx, bcy = sy + drn.gwy;
        var gR = self.getModel().settings.grid;
        if (gR && gR.snap && !self.freeform()) {
          var wp = self.toWorld(bcx, bcy);
          var stepR = gR.minor || 0.5;
          var sp = self.toScreen(Math.round(wp.x / stepR) * stepR,
                                 Math.round(wp.y / stepR) * stepR);
          bcx = sp.x; bcy = sp.y;
        }
        if (!drn.riser.noteOffset) drn.riser.noteOffset = {};
        drn.riser.noteOffset[drn.level] = { dx: bcx - sc2.x, dy: bcy - sc2.y };
        self.render();
        return;
      }
      if (self.dragDetailNode) {
        /* One vertex (and any coincident with it) follows the pointer, snapped
         * like a node. Shift/Alt frees the snap, as everywhere. */
        var gpN = self.snapWorld(w);
        self.dragDetailNode.verts.forEach(function (v) {
          v.pts[v.index].x = gpN.x; v.pts[v.index].y = gpN.y;
        });
        self.render();
        return;
      }
      if (self.dragDetail) {
        /* The whole detail slides rigidly. The DELTA is snapped, not each point,
         * so the box keeps its shape and lands on the lattice by its grabbed
         * offset rather than distorting. */
        var ddD = self.dragDetail;
        var ddx = w.x - ddD.startW.x, ddy = w.y - ddD.startW.y;
        var gD = self.getModel().settings.grid;
        if (gD && gD.snap && !self.freeform()) {
          var stepD = gD.minor || 0.5;
          ddx = Math.round(ddx / stepD) * stepD;
          ddy = Math.round(ddy / stepD) * stepD;
        }
        ddD.items.forEach(function (it) {
          it.detail.pts.forEach(function (q, i) {
            q.x = it.orig[i].x + ddx; q.y = it.orig[i].y + ddy;
          });
        });
        self.render();
        return;
      }
      if (self.dragNote) {
        /* A note is one point; snap its WORLD position like a label. */
        var dnN = self.dragNote;
        var nx = dnN.ox + (w.x - dnN.startW.x), ny = dnN.oy + (w.y - dnN.startW.y);
        var gN = self.getModel().settings.grid;
        if (gN && gN.snap && !self.freeform()) {
          var stepN = gN.minor || 0.5;
          nx = Math.round(nx / stepN) * stepN;
          ny = Math.round(ny / stepN) * stepN;
        }
        dnN.note.x = nx; dnN.note.y = ny;
        self.render();
        return;
      }
      if (self.dragControlRiser) {
        /* The riser is a plain point on the plan, so it snaps like one. Both
         * halves of the link follow it, on both floors, because there is only
         * one of it — a control cable rising through a shaft is in one place. */
        var rp = self.snapWorld(w);
        M.setControlRiser(self.getModel(), self.dragControlRiser.pipe, rp.x, rp.y);
        self.render();
        return;
      }
      if (self.dragControl) {
        /* Slide the whole middle segment. `mid` is a WORLD coordinate, so the
         * route stays where it was put through zoom and pan. Presentation
         * only — nothing here reaches the calculation.
         *
         * DRAGGABLE IN ALL FOUR DIRECTIONS (Michael, 2026-08-05). The axis used
         * to be fixed when the link was made, so the segment could only ever
         * slide one way and a drag across it did nothing — it read as hitting a
         * limit. Pull it far enough across and the route SWITCHES axis: a Z
         * that bends the other way is the same route seen from ninety degrees,
         * and it is the shape you want when the devices are diagonal to each
         * other.
         *
         * The 1.6 ratio is hysteresis. Flipping on the first pixel that crosses
         * would make the route snap back and forth while the mouse wanders
         * along the segment it is already on. */
        var dc = self.dragControl;
        /* The handle names its own route holder — `pump.control`,
         * `valve.control` or `sensor.route`. Resolving it from the pipe's KIND
         * worked while only pumps and valves had routes; the differential
         * sensor has one too now, and one route object is one drag handler. */
        /* THE FAR TAPPING: projected onto its pipe and stored as a fraction
         * along, so it stays ON the run however far off it the mouse strays. */
        if (dc.host && dc.tap) {
          var rpp = M.pipe(self.getModel(), dc.host.ref);
          var rna = rpp && M.node(self.getModel(), rpp.a);
          var rnb = rpp && M.node(self.getModel(), rpp.b);
          if (rna && rnb) {
            var wa2 = M.worldXY(self.getModel(), rna), wb2 = M.worldXY(self.getModel(), rnb);
            var vx = wb2.x - wa2.x, vy = wb2.y - wa2.y;
            var l2 = vx * vx + vy * vy;
            var t2 = l2 > 0 ? ((w.x - wa2.x) * vx + (w.y - wa2.y) * vy) / l2 : 0.5;
            dc.host.refT = Math.max(0, Math.min(1, t2));
            self.render();
          }
          return;
        }
        /* A BEND DRAGGED FREELY (Michael, 2026-08-07: "Allow the user to drag
         * Control Link nodes around"). The first such drag TAKES OVER the
         * route: whatever the Z was drawing becomes the waypoint list, and from
         * then on the points are simply where they were put. Starting from what
         * is on screen means the link does not jump on the first grab. */
        if (dc.host && dc.vertex !== null && dc.vertex !== undefined) {
          var rt2 = dc.host[dc.key] || (dc.host[dc.key] = {});
          if (!rt2.pts || !rt2.pts.length) {
            rt2.pts = M.routeWaypoints(dc.route);
            delete rt2.axis; delete rt2.mid;
          }
          if (rt2.pts[dc.vertex]) {
            var gp = self.snapWorld(w);
            rt2.pts[dc.vertex] = { x: gp.x, y: gp.y };
            self.render();
          }
          return;
        }
        if (dc.host) {
          var route = dc.host[dc.key] || (dc.host[dc.key] = {});
          var dx = Math.abs(w.x - dc.startW.x), dy = Math.abs(w.y - dc.startW.y);
          var axis = (route.axis || dc.axis) === 'v' ? 'v' : 'h';
          if (axis === 'h' && dy > dx * 1.6) axis = 'v';
          else if (axis === 'v' && dx > dy * 1.6) axis = 'h';
          /* REFUSE A FLIP THAT HAS NO SHAPE. Two tappings on the same riser
           * have no horizontal middle segment to offer, so flipping to 'v'
           * collapses the route onto the pipe and straight back. The segment
           * just keeps sliding along the axis it has, which is the honest
           * answer: there is nothing to flip TO. */
          if (dc.from && dc.to) {
            var levY = Math.abs(dc.from.y - dc.to.y) < 1e-6;
            var levX = Math.abs(dc.from.x - dc.to.x) < 1e-6;
            if (axis === 'h' && levY && !levX) axis = 'v';
            else if (axis === 'v' && levX && !levY) axis = 'h';
          }
          route.axis = axis;
          route.mid = (axis === 'h') ? w.x : w.y;
          self.render();
        }
        return;
      }
      if (self.dragLabel) {
        var d = self.dragLabel;
        var nox = d.ox + (sx - d.sx), noy = d.oy + (sy - d.sy);

        /* Snap the label's WORLD position to the grid, not its offset. Snapping
         * the offset would give every label its own lattice hung off its own
         * anchor, so two labels could look aligned on screen and sit on
         * different grid lines. Shift overrides, as everywhere else. */
        var mm = self.getModel();
        var g = mm.settings.grid;
        if (g && g.snap && !self.freeform()) {
          var wpt = self.toWorld(d.ax + nox, d.ay + noy);
          var step = g.minor || 0.5;
          var swx = Math.round(wpt.x / step) * step;
          var swy = Math.round(wpt.y / step) * step;
          var spt = self.toScreen(swx, swy);
          nox = spt.x - d.ax;
          noy = spt.y - d.ay;
        }
        M.setLabelOffset(d.target, nox, noy, d.key);
        self.render();
        return;
      }
      if (self.dragAlign) {
        /* The grabbed node follows the pointer, snapped to the grid, and every
         * level shifts by the same delta so the model moves rigidly. */
        var da = self.dragAlign, mA = self.getModel();
        var tx = w.x + da.offX, ty = w.y + da.offY;
        var gA = mA.settings.grid;
        if (gA && gA.snap && !self.freeform()) {
          var step = gA.minor || 0.5;
          tx = Math.round(tx / step) * step;
          ty = Math.round(ty / step) * step;
        }
        var startW = { x: da.grabX + da.offX, y: da.grabY + da.offY };
        var ddx = tx - startW.x, ddy = ty - startW.y;
        da.base.forEach(function (b) {
          var lv2 = M.level(mA, b.id);
          if (lv2) { lv2.dx = b.dx + ddx; lv2.dy = b.dy + ddy; }
        });
        self.render();
        return;
      }
      if (self.marquee) { self.marquee.x1 = w.x; self.marquee.y1 = w.y; self.render(); return; }
      if (self.dragDevice) {
        /* Both endpoints move together by the same delta, so the device keeps
         * its length and orientation. */
        var dd = self.dragDevice;
        var mdl = self.getModel();
        var lvd = M.level(mdl, mdl.activeLevel);
        var dx = w.x - dd.startX, dy = w.y - dd.startY;
        var na = M.node(mdl, dd.pipe.a), nb = M.node(mdl, dd.pipe.b);
        /* Read off the event as it actually is at this instant, for the same
         * reason `shiftDown` is (§4): a modifier released in another window
         * never sends its keyup here. */
        dd.free = !!e.altKey;

        /* ---- Q4: IT SLIDES ALONG THE RUN, AND THE RUN STAYS STRAIGHT.
         *
         * Michael: "drag-snap to grid intersections along the pipe (0.1 m) —
         * presentation only; the pipe stays straight."
         *
         * A device is two nodes spliced into a run, so dragging it anywhere but
         * along that run puts a dog-leg in the pipework either side of it: the
         * neighbours stretch to follow, and a straight main becomes a Z. That
         * is a drawing defect produced by a gesture that means "put the valve a
         * bit further along", which is a POSITIONING intent, not a geometry
         * one.
         *
         * So the drag is projected onto the device's own axis and quantised to
         * 0.1 m of travel. The two neighbour pipes lengthen and shorten by the
         * same amount, the run stays collinear, and nothing else in the model
         * moves. Lengths change, so it is still an EDIT — the friction in those
         * two pipes really did change.
         *
         * ALT FREES IT, giving back the old unconstrained move for the times you
         * genuinely want the device somewhere else. NOT Shift, which is the
         * convention everywhere else in this app — on a device Shift is already
         * "select the run between", and it does not merely mean something else,
         * it stops the drag STARTING (`modifying` suppresses it), so a
         * Shift-freed move could never have worked. Found by trying it. */
        if (dd.axis && !dd.free) {
          var t = dx * dd.axis.ux + dy * dd.axis.uy;
          /* SNAP THE POSITION, NOT THE TRAVEL. The device's `a` end is put on
           * the lattice along the axis: its along-axis coordinate, measured from
           * the origin, is rounded to half a grid square. `t0` is where that end
           * already sits, so the rounding is absolute rather than relative to
           * where the drag began. */
          var gmin = (mdl.settings.grid && mdl.settings.grid.minor) || 0.5;
          var step = gmin * DEVICE_SLIDE_FRACTION;
          if (step > 0) {
            var t0 = dd.ax * dd.axis.ux + dd.ay * dd.axis.uy;
            t = Math.round((t0 + t) / step) * step - t0;
          }
          t = Math.max(dd.axis.min, Math.min(dd.axis.max, t));
          na.x = dd.ax + dd.axis.ux * t; na.y = dd.ay + dd.axis.uy * t;
          nb.x = dd.bx + dd.axis.ux * t; nb.y = dd.by + dd.axis.uy * t;
          self.render();
          return;
        }

        /* FREE MOVE (Alt, or a device with no axis to slide along). Snapping
         * is applied to the MIDPOINT and the same shift given to both ends —
         * snapping each end separately would stretch or rotate the device as
         * the two ends landed on different grid lines. */
        var midX = (dd.ax + dd.bx) / 2 + dx, midY = (dd.ay + dd.by) / 2 + dy;
        var snapped = self.snap(midX + lvd.dx, midY + lvd.dy);
        dx += (snapped.x - lvd.dx) - midX;
        dy += (snapped.y - lvd.dy) - midY;
        na.x = dd.ax + dx; na.y = dd.ay + dy;
        nb.x = dd.bx + dx; nb.y = dd.by + dy;
        self.render();
        return;
      }
      if (self.dragNode) {
        var m = self.getModel();
        var n = M.node(m, self.dragNode.id);
        var lv = M.level(m, m.activeLevel);
        var s = self.snap(w.x, w.y);
        n.x = s.x - lv.dx; n.y = s.y - lv.dy;
        self.render();
        return;
      }

      /* PROBE follows the pointer along whatever pipe it is over. A generous
       * radius: you are aiming at a point ALONG a run, not at the run itself,
       * and the pipe under the cursor is unambiguous at working zoom. */
      if (self.tool === 'probe') {
        var ph = self.pipeAt(w.x, w.y, PROBE_PX);
        var same = (ph && self.probeHover && ph.pipe.id === self.probeHover.pipe.id &&
                    Math.abs(ph.t - self.probeHover.t) < 1e-4);
        self.probeHover = ph;
        if (!same) self.render();
        return;
      }

      /* While a device tool is armed, track the pipe it would land in so the
       * canvas can show it. Without this the only feedback that you missed is
       * an error toast after the click. */
      if (self.tool === 'pump' || self.tool === 'valve' || self.tool === 'equip' ||
          self.tool === 'sensor') {
        var cand = self.pipeAt(w.x, w.y, DEVICE_SNAP_PX);
        var candId = cand && cand.pipe.kind === 'pipe' ? cand.pipe.id : null;
        var candT = cand ? cand.point : null;
        if (candId !== (self.deviceHover && self.deviceHover.id)) {
          self.deviceHover = candId ? { id: candId, point: candT } : null;
          self.render();
        } else if (self.deviceHover) {
          self.deviceHover.point = candT;
          self.render();
        }
        return;
      }
      self.deviceHover = null;

      // hover for the node tooltip (spec §10) and snap preview
      var hn = self.nodeAt(w.x, w.y);
      var hp = hn ? null : self.pipeAt(w.x, w.y);
      var next = hn ? { kind: 'node', id: hn.id } : (hp ? { kind: 'pipe', id: hp.pipe.id } : null);
      var changed = JSON.stringify(next) !== JSON.stringify(self.hover);
      self.hover = next;
      if (changed || self.draft || self.tool !== 'edit') self.render();
    });

    window.addEventListener('pointerup', function (e) {
      if (self.panning) { self.panning = null; return; }
      /* THE FIRST FIVE ARE ARRANGEMENT, NOT GEOMETRY — see `arranged` above.
       * The background image, a control-link leader's bend, a note, a label,
       * and ALIGN (which moves every level by the same offset and is documented
       * as unable to touch a length). Saved, never re-solved. */
      if (self.dragTrace) { self.dragTrace = null; self.arranged(); return; }
      if (self.dragRiserNote) { self.dragRiserNote = null; self.arranged(); return; }
      if (self.dragDetailNode) { self.dragDetailNode = null; self.arranged(); return; }
      if (self.dragDetail) { self.dragDetail = null; self.arranged(); return; }
      if (self.dragControlRiser) { self.dragControlRiser = null; self.arranged(); return; }
      if (self.dragControl) { self.dragControl = null; self.arranged(); return; }
      if (self.dragNote) { self.dragNote = null; self.arranged(); return; }
      if (self.dragLabel) { self.dragLabel = null; self.arranged(); return; }
      if (self.dragAlign) { self.dragAlign = null; self.arranged(); return; }
      /* A device or a node IS geometry, and the answer moves with it. */
      if (self.dragDevice) { self.dragDevice = null; self.changed(); return; }
      if (self.dragNode) {
        var dropped = self.dragNode.id;
        self.dragNode = null;
        self.mergeDroppedNode(dropped);
        self.changed();
        return;
      }
      if (self.marquee) {
        /* A MARQUEE ONLY SELECTS. `applyMarquee` writes `this.selection` and
         * nothing else, so this is the same "selecting is not an edit" rule the
         * single click already follows — it was simply left behind when that
         * was fixed in v0.16.0. It is also the path a click on EMPTY SPACE
         * takes, which is how Michael kept meeting it: every click that missed
         * a pipe scheduled a solve and a save. */
        self.applyMarquee();
        self.marquee = null;
        self.selectionChanged();
      }
    });

    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Shift') self.shiftDown = true;

      /* Typing a length while drawing.
       *
       * Clicking sets a length by eye; an engineer usually KNOWS it. So digits
       * typed mid-run are collected and Enter commits a pipe of exactly that
       * length along the bearing the preview is already pointing — the bearing
       * stays a mouse gesture (with its 15° snapping) and only the magnitude is
       * typed. Handled before the Backspace/Delete branch below so editing the
       * number cannot delete the selection. */
      if (self.tool === 'pipe' && self.draft) {
        if (/^[0-9]$/.test(e.key) || e.key === '.') {
          self.lengthEntry = (self.lengthEntry || '') + e.key;
          e.preventDefault(); self.render(); return;
        }
        if (e.key === 'Backspace' && self.lengthEntry) {
          self.lengthEntry = self.lengthEntry.slice(0, -1) || null;
          e.preventDefault(); self.render(); return;
        }
        if (e.key === 'Enter' && self.lengthEntry) {
          e.preventDefault(); self.commitTypedLength(); return;
        }
      }

      if (e.key === 'Escape') {
        if (self.pasting) {
          self.pasting = null;
          self.onMessage('Paste cancelled.'); self.render();
        }
        else if (self.controlPick || self.refPick) {
          self.controlPick = null; self.refPick = null;
          self.onMessage('Cancelled.'); self.render();
        }
        else if (self.calibrating) self.cancelCalibration();
        else if (self.lengthEntry) { self.lengthEntry = null; self.render(); }
        else if (self.detailDraft) self.endDetail();
        else if (self.draft) self.endDraft();
        /* A pinned probe is dropped before the tool is, so Escape clears the
         * reading you are finished with rather than the whole mode. */
        else if (self.probe) { self.probe = null; self.render(); }
        else { self.setTool('edit'); }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (self.selection.length) { e.preventDefault(); self.deleteSelection(); }
      }

      /* COPY AND PASTE. Michael, 2026-08-09: one set of PWP, CT, CHWP, ACCH and
       * the pipes up to where it joins the loop, dropped somewhere else.
       *
       * Ctrl+C takes the selection as a FRAGMENT — a closed piece of drawing
       * that points at nothing outside itself (M.extractFragment). Ctrl+V arms
       * a placement: the fragment follows the pointer by its ANCHOR, and the
       * next click drops it. Esc cancels.
       *
       * NOT the system clipboard: reading it needs `navigator.clipboard.read`,
       * which a `file://` page is refused (§3). This is an in-app clipboard,
       * which is also what makes it able to carry a subgraph rather than text. */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (!self.selection.length) return;
        var frag = M.extractFragment(self.getModel(), self.selection);
        if (!frag) { self.onMessage('Nothing there to copy.', 'error'); return; }
        e.preventDefault();
        self.clipboard = frag;
        var lost = (frag.dropped || []).length;
        var cbits = [];
        if (frag.pipes.length) cbits.push(frag.pipes.length + ' pipe' + (frag.pipes.length === 1 ? '' : 's'));
        if (frag.nodes.length) cbits.push(frag.nodes.length + ' node' + (frag.nodes.length === 1 ? '' : 's'));
        var canno = (frag.details || []).length + (frag.notes || []).length;
        if (canno) cbits.push(canno + ' annotation' + (canno === 1 ? '' : 's'));
        self.onMessage((cbits.length ? cbits.join(' and ') : 'Nothing') +
          ' copied' + (lost ? ' — ' + lost + ' link' + (lost === 1 ? '' : 's') +
          ' to items outside the selection will be dropped' : '') + '.');
        return;
      }
      /* WHILE A PASTE IS IN FLIGHT: Tab picks which end joins, R turns it.
       * Michael, 2026-08-09. Both act on the fragment being placed, so they are
       * only live while there is one — no mode, no button. */
      if (self.pasting && e.key === 'Tab') {
        e.preventDefault();
        var cands = (self.pasting.frag.boundary && self.pasting.frag.boundary.length)
          ? self.pasting.frag.boundary
          : self.pasting.frag.nodes.map(function (n) { return n.id; });
        if (!cands.length) return;             // annotation-only: nothing to join by
        var at = cands.indexOf(self.pasting.frag.anchor);
        self.pasting.frag.anchor = cands[(at + 1) % cands.length];
        self.onMessage('Joining by ' + self.pasting.frag.anchor + '.');
        self.render();
        return;
      }
      if (self.pasting && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        self.rotatePasting();
        self.render();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (!self.clipboard) { self.onMessage('Nothing copied yet.', 'error'); return; }
        /* Annotation-only paste is allowed while locked — it cannot move a
         * number, the same reason annotation is deletable while locked. */
        var cb = self.clipboard;
        var annoOnly = !(cb.nodes && cb.nodes.length) && !(cb.pipes && cb.pipes.length);
        if (self.locked() && !annoOnly) return self.refuseLocked('Pasting');
        e.preventDefault();
        /* CONTEXT-AWARE: a single copied device pasted with a same-kind device
         * selected stamps its properties onto that device instead of placing a
         * new object (Michael, 2026-08-12). onPasteProps returns true when it
         * consumed the paste that way. */
        if (self.onPasteProps && self.onPasteProps(self.clipboard)) return;
        self.pasting = { frag: self.clipboard, at: null };
        self.setTool('edit');
        self.onMessage('Click to place. The first node snaps onto an existing ' +
                       'one if there is one under it. Esc cancels.');
        self.render();
        return;
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'Shift') self.shiftDown = false;
      if (e.key === 'Alt') self.altDown = false;
    });
    /* Losing the window is the case the keyup never covers: the release
     * happens in whatever took focus. Belt and braces beside the pointer
     * events, which are what actually make this correct. */
    window.addEventListener('blur', function () {
      self.shiftDown = false; self.altDown = false;
    });
  };

  /* A node dropped on top of another one JOINS it.
   *
   * Two nodes at the same coordinates that are not connected is precisely the
   * defect disconnections() exists to report: the drawing looks continuous and
   * the network is not. Since dragging one onto another is how that happens, it
   * is also where it should be resolved — silently leaving the break for the
   * user to discover later is the worse behaviour.
   *
   * After joining, a node that has become a plain joint mid-run is dissolved so
   * the run is one continuous pipe. M.dissolveNode refuses when the two pipes
   * differ in size, schedule or C, or when they are not actually straight, so a
   * size transition or a real elbow is never quietly removed. */
  View.prototype.mergeDroppedNode = function (id) {
    var m = this.getModel();
    var n = M.node(m, id);
    if (!n) return;
    var here = M.worldXY(m, n);

    // Nearest OTHER node on this level within the endpoint snap radius.
    var rad = this.pxToM(ENDPOINT_PX);
    var target = null, bestD = Infinity;
    m.nodes.forEach(function (o) {
      if (o.id === id || o.level !== m.activeLevel) return;
      var w = M.worldXY(m, o);
      var d = Math.hypot(w.x - here.x, w.y - here.y);
      if (d < rad && d < bestD) { bestD = d; target = o; }
    });

    /* NO NODE THERE — BUT MAYBE A PIPE. Michael, 2026-08-09: "dragging the end
     * node of a pipe onto a pipe should create a tee. Elbow seems to work."
     *
     * The elbow worked because that is node-onto-node. Dropping onto the MIDDLE
     * of a run had no meaning at all, so the node was left sitting on top of
     * the pipe, touching nothing — which is exactly the silent break
     * `disconnections()` exists to report, made by hand.
     *
     * So the run is SPLIT at the drop point and the dropped node becomes the
     * junction. Refused when the pipe is one the dragged node already belongs
     * to: splitting a pipe with its own end is a zero-length pipe and a
     * nonsense. */
    if (!target) {
      var hit = this.pipeAt(here.x, here.y, SNAP_PX);
      if (hit && hit.pipe && hit.pipe.kind === 'pipe' &&
          hit.pipe.a !== id && hit.pipe.b !== id && M.splitPipeAt) {
        var tee = M.splitPipeAt(m, hit.pipe.id, id);
        if (tee) {
          this.selection = [{ kind: 'node', id: id }];
          this.onMessage && this.onMessage('Tee made in ' + hit.pipe.id + '.');
          return;
        }
      }
      return;
    }

    // Already joined by a pipe? Then this is a zero-length pipe, not a merge.
    var joined = M.pipesAt(m, id).some(function (p) {
      return M.other(p, id) === target.id;
    });

    var keptId = target.id;
    M.mergeNodes(m, keptId, id);
    var dissolved = M.dissolveNode(m, keptId);

    this.selection = dissolved
      ? [{ kind: 'pipe', id: dissolved.id }]
      : [{ kind: 'node', id: keptId }];

    this.onMessage && this.onMessage(
      dissolved
        ? 'Nodes joined and the run made continuous.'
        : (joined ? 'Nodes joined.' : 'Nodes joined at ' + keptId + '.'));
  };

  View.prototype.applyMarquee = function () {
    var m = this.getModel(), q = this.marquee;
    var x0 = Math.min(q.x0, q.x1), x1 = Math.max(q.x0, q.x1);
    var y0 = Math.min(q.y0, q.y1), y1 = Math.max(q.y0, q.y1);
    var sel = [];
    m.nodes.forEach(function (n) {
      if (n.level !== m.activeLevel) return;
      var w = M.worldXY(m, n);
      if (w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1) sel.push({ kind: 'node', id: n.id });
    });
    m.pipes.forEach(function (p) {
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var inA = wa.x >= x0 && wa.x <= x1 && wa.y >= y0 && wa.y <= y1;
      var inB = wb.x >= x0 && wb.x <= x1 && wb.y >= y0 && wb.y <= y1;
      if (inA || inB) sel.push({ kind: 'pipe', id: p.id });   // partial inclusion (§6)
    });
    this.selection = sel;
  };

  // --------------------------------------------------------------- draw
  View.prototype.setTool = function (tool) {
    if (this.draft) this.endDraft();
    if (tool !== 'probe') { this.probe = null; this.probeHover = null; }
    this.tool = tool;
    this.calibrating = null;
    /* A half-finished pick belongs to the tool that started it. Leaving one
     * armed across a tool change meant the next click anywhere linked something
     * you had stopped trying to link. */
    this.controlPick = null;
    this.refPick = null;
    /* A placement in flight belongs to the gesture that started it. */
    if (tool !== 'edit') this.pasting = null;
    if (tool !== 'view') { this.addLinkNode = false; this.linkNodeHover = null; }
    if (this.detailDraft && tool !== 'detail') this.endDetail();
    this.canvas.style.cursor = (tool === 'edit') ? 'default'
                            : (tool === 'view' || tool === 'trace' || tool === 'align') ? 'move'
                            : 'crosshair';
    if (this.onToolChange) this.onToolChange();
    /* A TOOL CHANGE IS NOT AN EDIT. It called `onChange`, which schedules a
     * solve AND a save — so picking up the PROBE re-solved the model, and so
     * did every mode button on the ribbon, because CONTROL and ANNOTATION both
     * select a tool on the way in. Michael, 2026-08-09, on both counts.
     *
     * The panel still has to be rebuilt: TRACE, DETAIL and the annotation modes
     * each put their own controls in it. That is `onSelect`'s job — refresh the
     * panel and the level list, touch nothing else. */
    if (this.onSelect) this.onSelect();
    this.render();
  };

  View.prototype.drawClick = function (w) {
    var m = this.getModel();
    var s = this.drawTarget(w);
    var node = this.nodeForSnap(s);
    var wn = M.worldXY(m, node);

    if (!this.draft) {
      this.draft = { fromNode: node.id, last: { x: wn.x, y: wn.y } };
    } else {
      if (node.id !== this.draft.fromNode) {
        M.addPipe(m, this.draft.fromNode, node.id, {
          size: this.drawSize || undefined,
          schedule: m.settings.schedule,
          C: m.settings.C
        });
        this.draft.fromNode = node.id;
        this.draft.last = { x: wn.x, y: wn.y };
      }
    }
    this.changed();
  };

  /* Commit the detail line being drawn. Two points is the minimum that means
   * anything; a single click is a mis-click and is discarded silently. */
  /* WHERE A DETAIL VERTEX LANDS.
   *
   * The same two rules the PIPE tool follows, and for the same reason: the
   * bearing is 15°-constrained, and the GRID then constrains the LENGTH ALONG
   * THAT BEARING rather than the position. Snapping the position instead pulls
   * the point off the angle — a 15° aim came out at 14.04° — because the nearest
   * grid intersection is almost never on the ray. Preserving the bearing and
   * quantising the distance keeps both promises at once.
   *
   * The first vertex has no bearing to keep, so it simply takes the grid.
   * Shift frees both, as everywhere else. */
  View.prototype.detailTarget = function (w) {
    if (!this.detailDraft || !this.detailDraft.pts.length) return this.snapWorld(w);
    var a = this.detailDraft.pts[this.detailDraft.pts.length - 1];
    var aim = this.angleSnap(a.x, a.y, w.x, w.y);
    var m = this.getModel(), g = m.settings.grid;
    if (this.freeform() || !g || !g.snap || !(g.minor > 0)) return aim;
    var dx = aim.x - a.x, dy = aim.y - a.y;
    var len = Math.hypot(dx, dy);
    if (!(len > 1e-9)) return aim;
    var snapped = Math.round(len / g.minor) * g.minor;
    if (!(snapped > 1e-9)) return aim;
    return { x: a.x + dx / len * snapped, y: a.y + dy / len * snapped };
  };

  View.prototype.endDetail = function () {
    var d = this.detailDraft;
    this.detailDraft = null;
    if (d && d.pts.length >= 2) {
      var m = this.getModel();
      this.onBeforeEdit();
      M.addDetail(m, m.activeLevel, d.pts,
                  { colour: this.detailColour_ || 'line',
                    width: this.detailWidth_ || 1.5 });
      this.changed();
    } else {
      this.render();
    }
  };

  /* The note's text, asked for in a dialog. `isNew` so cancelling a
   * just-placed note removes it rather than leaving an empty box behind. */
  View.prototype.editNote = function (note, isNew) {
    var self = this, m = this.getModel();
    if (!FD.dialog || !FD.dialog.form) return;
    FD.dialog.form({
      title: isNew ? 'Add a note' : 'Edit note',
      fields: [{ key: 'text', label: 'Text', type: 'textarea', rows: 4,
                 value: isNew ? '' : (note.text || '') }]
    }).then(function (v) {
      if (!v || !String(v.text || '').trim()) {
        if (isNew) { M.removeNote(m, note.id); self.changed(); }
        return;
      }
      self.onBeforeEdit();
      note.text = String(v.text).replace(/\r/g, '');
      self.changed();
    });
  };

  View.prototype.endDraft = function () {
    this.draft = null;
    this.lengthEntry = null;
    this.render();
    this.onChange();
  };

  /* Unit vector from the run's anchor towards the live preview point. This is
   * the bearing a typed length is laid along, and it is taken from drawTarget()
   * so the committed pipe cannot disagree with the dashed preview (including
   * its 15° angle snapping). Returns null when there is no direction yet. */
  View.prototype.draftDirection = function () {
    if (!this.draft || !this.cursor) return null;
    var a = this.draft.last;
    var t = this.drawTarget(this.cursor);
    var dx = t.x - a.x, dy = t.y - a.y;
    var d = Math.hypot(dx, dy);
    if (d < 1e-9) return null;
    return { x: dx / d, y: dy / d };
  };

  /* The typed length in SI metres, or null if it is not a usable number. */
  View.prototype.typedLength = function () {
    if (!this.lengthEntry) return null;
    var v = FD.units.parse(this.lengthEntry);
    if (!isFinite(v) || v <= 0) return null;
    return FD.units.toSILength(v, this.getModel().settings.display.length);
  };

  /* Commit a pipe of exactly the typed length along the preview bearing. */
  View.prototype.commitTypedLength = function () {
    var m = this.getModel();
    if (!this.draft) return false;
    var len = this.typedLength();
    if (len === null) {
      this.onMessage && this.onMessage(
        '"' + this.lengthEntry + '" is not a length.', 'error');
      this.lengthEntry = null; this.render();
      return false;
    }
    var dir = this.draftDirection();
    if (!dir) {
      this.onMessage && this.onMessage(
        'Move the pointer to aim the run first, then type the length.', 'error');
      return false;
    }

    var a = this.draft.last;
    var target = { x: a.x + dir.x * len, y: a.y + dir.y * len };

    /* Land on a node already there rather than stacking a second one on top,
     * which would look connected and not be. */
    var node = this.nodeAt(target.x, target.y, ENDPOINT_PX) ||
               this.nodeForSnap({ kind: 'free', x: target.x, y: target.y });

    if (node.id !== this.draft.fromNode) {
      M.addPipe(m, this.draft.fromNode, node.id, {
        size: this.drawSize || undefined,
        schedule: m.settings.schedule,
        C: m.settings.C
      });
      var wn = M.worldXY(m, node);
      this.draft.fromNode = node.id;
      this.draft.last = { x: wn.x, y: wn.y };
    }
    this.lengthEntry = null;
    this.changed();
    return true;
  };


  /* Default equipment tags. An engineer works from the tag, not the node id, so
   * a device that arrives untagged has to be named before it means anything —
   * and in practice that step gets skipped. The number is the next free one for
   * that prefix, so deleting PMP-2 and drawing another gives PMP-2 back rather
   * than climbing forever. */
  var TAG_PREFIX = { source: 'SRC', demand: 'OF', pump: 'PMP', equip: 'AHU',
                     adiabatic: 'STR', sensor: 'TS' };
  /* A SENSOR'S TAG SAYS WHAT IT MEASURES. Michael, 2026-08-09: a ΔP sensor came
   * out as TS-1, which reads as a thermostat on the drawing and in the
   * schedule. The prefixes are the ones an engineer writes: T, P, F, DP, DT. */
  var SENSOR_PREFIX = { temperature: 'TS', pressure: 'PS', flow: 'FS',
                        dP: 'DPS', dT: 'DTS' };

  /* In-line 2-port devices: they sit IN a pipe rather than at a node, are drawn
   * as a point symbol on a short link, and are hit-tested at their midpoint. */
  var IN_LINE = { pump: true, valve: true, equip: true, sensor: true };

  View.prototype.nextTag = function (kind, forcePrefix) {
    var m = this.getModel();
    var prefix = forcePrefix || TAG_PREFIX[kind];
    if (!prefix) return null;
    var used = {};
    function note(tag) {
      var mm = tag && String(tag).match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (mm) used[parseInt(mm[1], 10)] = true;
    }
    m.pipes.forEach(function (p) { note(p.tag); });
    m.nodes.forEach(function (n) { note(n.tag); });
    var i = 1;
    while (used[i]) i++;
    return prefix + '-' + i;
  };

  View.prototype.deviceClick = function (w) {
    var m = this.getModel();
    var s = this.snap(w.x, w.y);
    var node = this.nodeForSnap(s);
    if (this.tool === 'source') {
      M.setSource(m, node.id);
      if (!node.tag) node.tag = this.nextTag('source');
    } else {
      M.setDemand(m, node.id, 0.001, 100000);   // 1 L/s @ 100 kPa, editable
      if (!node.tag) node.tag = this.nextTag('demand');
    }
    this.selection = [{ kind: 'node', id: node.id }];
    this.changed();
  };

  /* PUMP: convert an existing pipe into a pump link (spec §8.4). A pump is an
   * in-line 2-port device, so it needs a pipe to sit in — clicking empty space
   * has nothing to convert. */
  /* Insert an in-line 2-port device (pump, valve) into an existing pipe.
   *
   * The pipe is split into three: the short middle piece becomes the device,
   * so it gets its own inlet and outlet nodes while the runs either side keep
   * their own lengths, sizes and C factors. Returns the new device pipe, or
   * null with a message if it could not be placed. */
  View.prototype.insertInline = function (w, kind, extra, label) {
    var m = this.getModel();
    var hit = this.pipeAt(w.x, w.y, DEVICE_SNAP_PX);
    if (!hit) {
      this.onMessage && this.onMessage('Click on a pipe to place a ' + label + ' in it.', 'error');
      return null;
    }
    var p = hit.pipe;
    if (p.kind !== 'pipe') {
      this.onMessage && this.onMessage('That pipe already holds a ' + p.kind + '.', 'error');
      return null;
    }

    var a = M.node(m, p.a), b = M.node(m, p.b);
    var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
    var lv = M.level(m, m.activeLevel);
    var len = Math.hypot(wb.x - wa.x, wb.y - wa.y);
    if (len < DEVICE_LEN * 2) {
      this.onMessage && this.onMessage(
        'Pipe is too short to hold a ' + label + ' — it needs at least ' +
        (DEVICE_LEN * 2).toFixed(1) + ' m.', 'error');
      return null;
    }

    var ux = (wb.x - wa.x) / len, uy = (wb.y - wa.y) / len;
    var half = DEVICE_LEN / 2;
    var t = Math.max(half, Math.min(len - half, hit.t * len));

    var opts = { schedule: p.schedule, size: p.size, C: p.C };
    var n1 = M.addNode(m, m.activeLevel,
      wa.x + ux * (t - half) - lv.dx, wa.y + uy * (t - half) - lv.dy);
    var n2 = M.addNode(m, m.activeLevel,
      wa.x + ux * (t + half) - lv.dx, wa.y + uy * (t + half) - lv.dy);
    var aId = p.a, bId = p.b;

    M.removePipe(m, p.id);
    M.addPipe(m, aId, n1.id, opts);
    var device = M.addPipe(m, n1.id, n2.id,
      Object.assign({ kind: kind, schedule: p.schedule, size: p.size, C: p.C }, extra));
    M.addPipe(m, n2.id, bId, opts);

    this.selection = [{ kind: 'pipe', id: device.id }];
    this.changed();
    return device;
  };

  View.prototype.pumpClick = function (w) {
    var pmp = this.insertInline(w, 'pump', { pump: { mode: 'auto', head: 20, flow: 0 } }, 'pump');
    if (pmp && !pmp.tag) { pmp.tag = this.nextTag('pump'); this.changed(); }
  };

  /* SENSOR: an instrument dropped into a run. `toolVariant` says WHICH, from
   * the ribbon — one button per measurement rather than a generic sensor you
   * then have to retype in the panel (Michael's UI pass, 2026-08-06). The
   * setpoint default goes with it, since a flow sensor defaulting to 45 °C was
   * never going to be right.
   *
   * A DIFFERENTIAL is placed without a reference and asks for the second pipe
   * straight away: it is not a usable sensor until it has one, so waiting for
   * the user to find the button in the panel is a step with no decision in it. */
  var SENSOR_DEFAULT = {
    temperature: { mode: 'temperature', tSet: 45 },
    flow:        { mode: 'flow' },
    pressure:    { mode: 'pressure' },
    dP:          { mode: 'dP' },
    dT:          { mode: 'dT' }
  };
  View.prototype.sensorClick = function (w) {
    var def = SENSOR_DEFAULT[this.toolVariant] || SENSOR_DEFAULT.temperature;
    var sn = this.insertInline(w, 'sensor', {
      sensor: JSON.parse(JSON.stringify(def))
    }, 'sensor');
    if (!sn) return;
    if (!sn.tag) {
      sn.tag = this.nextTag('sensor', SENSOR_PREFIX[def.mode] || 'TS');
      this.changed();
    }
    if (def.mode === 'dP' || def.mode === 'dT') {
      this.refPick = { pipeId: sn.id };
      this.onMessage && this.onMessage('Now click the second pipe to measure against.');
      this.render();
    }
  };

  /* EQUIPMENT, likewise one button per TYPE. The defaults differ because the
   * two types state different things: a source/sink states a leaving
   * temperature, an exchanger states a load, and an adiabatic item states
   * neither. */
  var EQUIP_DEFAULT = {
    source:    { qRated: 0.02, pdRated: 200000, qOut: 0.02,
                 equipType: 'source', tSet: 6, dTMax: 6 },
    exchanger: { qRated: 0.02, pdRated: 200000, qOut: 0.02,
                 equipType: 'exchanger', duty: 20000 },
    adiabatic: { qRated: 0.02, pdRated: 20000, qOut: 0.02,
                 equipType: 'adiabatic' }
  };
  View.prototype.equipClick = function (w) {
    var def = EQUIP_DEFAULT[this.toolVariant] || EQUIP_DEFAULT.exchanger;
    var eq = this.insertInline(w, 'equip', {
      equip: JSON.parse(JSON.stringify(def))
    }, 'equipment');
    if (eq && !eq.tag) {
      eq.tag = this.nextTag(def.equipType === 'adiabatic' ? 'adiabatic' : 'equip');
      this.changed();
    }
  };

  View.prototype.valveClick = function (w) {
    var m = this.getModel();
    var hit = this.pipeAt(w.x, w.y, DEVICE_SNAP_PX);
    var bore = hit ? M.pipeBore(m, hit.pipe) * 1000 : 50;
    var type = this.toolVariant || this.valveType || 'gate';
    this.insertInline(w, 'valve', {
      valve: {
        type: type,
        kv: FD.valves.defaultKv(type, bore),
        opening: 100
      }
    }, 'valve');
  };

  /* ADD RISER: place a riser column at the clicked point on the active level
   * (spec §7.2). Snapping to an existing column on another level extends it. */
  /* Snap resolution for the RISER tool specifically.
   *
   * A riser almost always belongs ON existing pipework — landing it on a bare
   * grid intersection is nearly never what is wanted, and the ordinary 10 px
   * pipe tolerance made that the common outcome. So the radii here are
   * deliberately generous and the grid is the LAST resort, not an equal
   * competitor. */
  View.prototype.riserSnap = function (wx, wy) {
    var m = this.getModel();

    var n = this.nodeAt(wx, wy, RISER_NODE_PX);
    if (n) {
      var w = M.worldXY(m, n);
      return { kind: 'node', node: n, x: w.x, y: w.y };
    }
    var hit = this.pipeAt(wx, wy, RISER_PIPE_PX);
    if (hit) return { kind: 'pipe', pipe: hit.pipe, x: hit.point.x, y: hit.point.y };

    var col = this.riserAt(wx, wy, RISER_NODE_PX);
    if (col) return { kind: 'riser', x: col.x, y: col.y };

    if (m.settings.grid.snap) {
      var g = m.settings.grid.minor;
      return { kind: 'grid', x: Math.round(wx / g) * g, y: Math.round(wy / g) * g };
    }
    return { kind: 'free', x: wx, y: wy };
  };

  View.prototype.riserClick = function (w) {
    var m = this.getModel();

    // Where the riser lands on the ACTIVE level — real geometry wins over grid.
    var s = this.riserSnap(w.x, w.y);
    var node = this.nodeForSnap(s);
    var wn = M.worldXY(m, node);

    /* Which column is this click joining?
     *
     * First choice is positional — the click landed on a column or its stub.
     *
     * But the common workflow is to click this floor's OWN pipework, which may
     * sit nowhere near the column: that is the whole point of aligning. So if
     * nothing was hit positionally and exactly ONE column is missing an
     * attachment on this level, that column is unambiguous and gets joined.
     * With two or more candidates there is no safe guess, so a new column is
     * started instead of silently picking the wrong one. */
    var col = this.riserAt(w.x, w.y, RISER_NODE_PX) ||
              this.riserAt(wn.x, wn.y, RISER_NODE_PX);
    var ambiguous = false;

    if (!col) {
      var candidates = m.risers.filter(function (rr) {
        return !rr.attachments.some(function (a) { return a.level === m.activeLevel; });
      });
      if (candidates.length === 1) col = candidates[0];
      else if (candidates.length > 1) ambiguous = true;
    }

    if (col) {
      if (col.attachments.some(function (a) { return a.level === m.activeLevel; })) {
        this.onMessage && this.onMessage('This level is already on that riser column.', 'error');
        return;
      }
      /* RISERS STACK (Michael, 2026-08-05). A column that already joins two
       * floors is an established vertical line, so a THIRD floor joins it
       * where it is — the column position wins, and the new attachment is made
       * at that point rather than wherever the click landed.
       *
       * The align-everything-to-the-click behaviour below was written for the
       * SECOND attachment, where there is no established line yet and the two
       * floors have to be brought into agreement. Applying it to a third floor
       * is what stopped risers stacking: with two columns in a model both
       * lower levels are locked, nothing could move, and the column was
       * dragged to the new click anyway — breaking the two attachments it
       * already had. */
      var result = { moved: [], blocked: [] };
      if (col.attachments.length >= 2) {
        var joinNode = this.nodeOnLevelAt(M.level(m, m.activeLevel), col.x, col.y);
        M.attachRiser(m, col.id, m.activeLevel, joinNode.id);
        M.riserPipes(m);
        this.selection = [{ kind: 'node', id: joinNode.id }];
        this.onMessage && this.onMessage(
          'Riser column extended to this level, on the column line.');
        this.changed();
        return;
      }

      /* The ACTIVE level is authoritative: every other floor already on this
       * column slides so its attachment lands underneath the point just
       * clicked. Moving a level is an OFFSET change only — no geometry and no
       * pipe length is touched (spec §7.1). */
      result = alignColumn(m, col, wn);
      col.x = wn.x;
      col.y = wn.y;
      M.attachRiser(m, col.id, m.activeLevel, node.id);
      M.riserPipes(m);

      if (result.blocked.length) {
        this.onMessage && this.onMessage(
          'Riser connected, but ' + result.blocked.join(', ') +
          ' could not move — anchored by another riser column.', 'error');
      } else if (result.moved.length) {
        this.onMessage && this.onMessage(
          'Riser connected. Aligned ' + result.moved.join(', ') + ' to this level.');
      } else {
        this.onMessage && this.onMessage('Riser column extended to this level.');
      }
    } else {
      var r = M.addRiser(m, wn.x, wn.y);
      M.attachRiser(m, r.id, m.activeLevel, node.id);

      /* A riser between ONE level is not a riser — it materialises no pipe at
       * all, so placing one used to mean switching level and clicking again in
       * the same spot. The floor it should run to is already stated: it is the
       * level the View Direction points at, the one drawn faded underneath.
       * So carry it there automatically. */
      var far = adjacentLevel(m, m.activeLevel);
      if (far) {
        var farNode = this.nodeOnLevelAt(far, wn.x, wn.y);
        M.attachRiser(m, r.id, far.id, farNode.id);
      }
      M.riserPipes(m);

      this.onMessage && this.onMessage(ambiguous
        ? 'New riser column started. Several existing columns are free on this ' +
          'level, so click directly on a riser stub to join that one instead.'
        : far
          ? 'Riser column placed, running to ' + far.name +
            ' (View Direction). Change it in Level properties.'
          : 'Riser column placed. There is no level in the View Direction, so ' +
            'click this floor’s pipework on another level to connect it.');
    }

    this.selection = [{ kind: 'node', id: node.id }];
    this.changed();
  };

  /* The level the active floor's View Direction points at — the one rendered
   * faded, and the one a new riser runs to. `m.levels` is ordered top-first, so
   * looking UP is one index back. Shared with drawFadedLevel deliberately: if
   * these two disagreed, a riser would run to a different floor than the one
   * shown underneath it. Returns null at the top/bottom of the stack. */
  function adjacentLevel(m, levelId) {
    var lv = M.level(m, levelId);
    if (!lv) return null;
    var idx = m.levels.indexOf(lv);
    return m.levels[lv.lookDir === 'up' ? idx - 1 : idx + 1] || null;
  }

  /* A node on `lv` at world point (wx,wy) — reusing one already there rather
   * than stacking a duplicate on top of it, which would read as a coincident-
   * node break. Node coordinates are level-local, so the level offset comes
   * off before storing. */
  View.prototype.nodeOnLevelAt = function (lv, wx, wy) {
    var m = this.getModel();
    var rad = this.pxToM(ENDPOINT_PX);
    var found = null, bestD = Infinity;
    m.nodes.forEach(function (n) {
      if (n.level !== lv.id) return;
      var w = M.worldXY(m, n);
      var d = Math.hypot(w.x - wx, w.y - wy);
      if (d < rad && d < bestD) { bestD = d; found = n; }
    });
    if (found) return found;
    return M.addNode(m, lv.id, wx - (lv.dx || 0), wy - (lv.dy || 0));
  };

  /* Slide every level attached to `col` (other than the active one) so that its
   * attachment node sits exactly at world point `target`.
   *
   * A level held by two or more columns has no freedom left — moving it would
   * break the other column — so it is reported instead of silently distorted
   * (spec §7.2 step 3). */
  function alignColumn(m, col, target) {
    var moved = [], blocked = [];

    col.attachments.forEach(function (att) {
      if (att.level === m.activeLevel) return;
      var lv = M.level(m, att.level);
      var nd = M.node(m, att.node);
      if (!lv || !nd) return;

      var cur = M.worldXY(m, nd);
      var dx = target.x - cur.x, dy = target.y - cur.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;   // already aligned

      if (M.isLevelLocked(m, att.level)) { blocked.push(lv.name); return; }

      lv.dx += dx;
      lv.dy += dy;
      moved.push(lv.name);
    });

    return { moved: moved, blocked: blocked };
  }

  // ------------------------------------------------------------- render
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  View.prototype.render = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var W = this.cssW, H = this.cssH;
    ctx.clearRect(0, 0, W, H);

    this.theme = {
      bg: css('--bg-panel'), minor: css('--grid-minor'), major: css('--grid-major'),
      flow: css('--flow'), noflow: css('--noflow'), select: css('--select'),
      text: css('--text'), dim: css('--text-dim'), mute: css('--text-mute'),
      warn: css('--warn'), error: css('--error'), ok: css('--ok'), accent: css('--accent')
    };

    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);

    /* Every label drawn this frame records its screen box, so VIEW mode can
     * hit-test them without re-deriving the layout. */
    this._labelBoxes = [];

    this.drawTrace();
    this.drawGrid();
    this.drawFadedLevel();
    /* Cleared HERE, not in `drawControlLinks`, because the differential sensor
     * route registers handles too and the sensors are drawn first — resetting
     * the list later threw them away. */
    this._controlHandles = [];
    /* Cleared beside the control handles rather than inside
     * `drawControlLinks`, which returns early when links are hidden —
     * leaving stale handles behind that are still draggable. */
    this._riserHandles = [];
    this._riserBoxes = [];
    /* UNDER the model. Detail lines are a backdrop — a room outline, a plant
     * box — and pipework must never be hidden behind one. */
    this.drawDetails();
    this.drawRisers();
    this.drawPipes();
    this.drawNodes();
    this.drawDraft();
    this.drawMarquee();
    this.drawDeviceHover();
    this.drawCalibration();
    var vs = this.vizScale();
    this.drawVizNodes(vs);
    this.drawVizLegend(vs);
    this.drawWarnHighlight();
    this.drawControlLinks();
    this.drawSyncLinks();
    this.drawNotes();
    this.drawLinkNodePreview();
    this.drawPastePreview();
    this.drawDisconnects();
    this.drawFlipButton();
    this.drawScaleBar();
    this.drawTooltip();
    this.drawProbe();
  };

  /* Highlight the pipe an in-line device would be inserted into, and mark the
   * exact point. Placement always did snap to a pipe; with no preview the snap
   * was invisible, so a near miss just produced an error and looked like the
   * snapping was not working. */
  View.prototype.drawDeviceHover = function () {
    var h = this.deviceHover;
    if (!h) return;
    var m = this.getModel(), ctx = this.ctx;
    var p = m.pipes.filter(function (x) { return x.id === h.id; })[0];
    if (!p) return;
    var a = M.node(m, p.a), b = M.node(m, p.b);
    if (!a || !b) return;
    var sa = this.toScreen(M.worldXY(m, a).x, M.worldXY(m, a).y);
    var sb = this.toScreen(M.worldXY(m, b).x, M.worldXY(m, b).y);

    ctx.save();
    ctx.strokeStyle = this.theme.select;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = this.pipeWidth(p) + 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();

    if (h.point) {
      var sp = this.toScreen(h.point.x, h.point.y);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };

  /* SHOW DISCONNECT — ring the places where the drawing lies.
   *
   * The failure this exists for: two nodes at exactly the same coordinates,
   * not joined. On screen it is one continuous run; hydraulically it is two
   * separate networks, and the solve returns zero flow with no error at all.
   * Nothing short of drawing attention to the spot will find that.
   */
  /* Disconnections are marked with a warning glyph, ALWAYS, in every mode.
   *
   * They used to be behind a SHOW DISCONNECT toggle. That was the wrong shape
   * for the problem: a break is not a view you opt into, it is a defect in the
   * model — the drawing looks continuous and the network is not — and the whole
   * reason it needs marking is that you would otherwise never think to look.
   * The toggle is gone and the markers are permanent.
   *
   * The glyph is registered as a draggable label, so in VIEW it can be nudged
   * off whatever it is covering, exactly like every other annotation.
   */
  View.prototype.drawDisconnects = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    if (!FD.network || !FD.network.disconnections) return;

    var issues = FD.network.disconnections(m);
    if (!issues.length) return;
    var lv = m.activeLevel;

    /* One marker per node, carrying the worst severity reported against it —
     * two issues on the same node used to stack two glyphs in the same place. */
    var worst = {};
    issues.forEach(function (iss) {
      (iss.nodes || []).forEach(function (id) {
        if (!worst[id] || iss.severity === 'error') {
          worst[id] = { severity: iss.severity, message: iss.message };
        }
      });
    });

    Object.keys(worst).forEach(function (id) {
      var n = M.node(m, id);
      if (!n || n.level !== lv) return;
      var w = M.worldXY(m, n);
      var p = self.toScreen(w.x, w.y);
      var off = M.labelOffset(n, 'warn');
      var x = p.x + 14 + off.dx, y = p.y - 12 + off.dy;

      ctx.save();
      ctx.font = '15px system-ui, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚠️', x, y);
      ctx.restore();

      self.registerLabel('warn', n, x - 10, y - 10, 20, 20);
      if (self.tool === 'view') self.labelHandle(x - 10, y - 10, 20, 20);
    });
  };

  /* ------------------------------------------------------------ visualisers
   *
   * Colour the drawing by a solved quantity, so the shape of the answer can be
   * read at a glance instead of section by section off the sheet: where the
   * flow concentrates, which runs are fast, where the pressure has gone.
   *
   * A VIEW overlay rather than a mode — it changes nothing and blocks nothing,
   * and it is switched off by clicking the same button again.
   *
   * Blue → green → amber → red across the range. For VELOCITY the scale is
   * pinned to the WARNING LIMIT rather than to the range present, so the colour
   * means "fast" in absolute terms and does not rescale as the model changes;
   * for flow and pressure there is no such limit, so the range in the model is
   * used and the legend states it.
   */
  var VIZ_STOPS = [
    { t: 0.00, c: [77, 163, 255] },   // blue
    { t: 0.45, c: [70, 209, 127] },   // green
    { t: 0.75, c: [255, 159, 67] },   // amber
    { t: 1.00, c: [255, 95, 86] }     // red
  ];

  function vizColour(t) {
    if (!isFinite(t)) return 'rgb(107,119,133)';
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < VIZ_STOPS.length; i++) {
      if (t <= VIZ_STOPS[i].t) {
        var a = VIZ_STOPS[i - 1], b = VIZ_STOPS[i];
        var f = (t - a.t) / (b.t - a.t);
        return 'rgb(' + Math.round(a.c[0] + f * (b.c[0] - a.c[0])) + ',' +
                        Math.round(a.c[1] + f * (b.c[1] - a.c[1])) + ',' +
                        Math.round(a.c[2] + f * (b.c[2] - a.c[2])) + ')';
      }
    }
    return 'rgb(255,95,86)';
  }

  /* Range and formatting for the active visualiser. Returns null when there is
   * nothing to show, so the caller can fall back to ordinary rendering rather
   * than painting a scale with no data behind it. */
  View.prototype.vizScale = function () {
    var m = this.getModel(), res = this.results;
    if (!this.viz || !res) return null;
    var d = m.settings.display;
    var vals = [];

    if (this.viz === 'temperature') {
      /* Nodal, like pressure — and the pipes ramp between their two ends for
       * the same reason: along a level pipe in a constant ambient the profile
       * really is monotonic between the two node values. */
      if (!res.thermal) return null;
      var tv = [];
      m.nodes.forEach(function (n) {
        var t = res.thermal.temperature[n.id];
        if (t !== undefined && isFinite(t)) tv.push(t);
      });
      if (!tv.length) return null;
      var tmin = Math.min.apply(null, tv), tmax = Math.max.apply(null, tv);
      if (tmax - tmin < 1e-9) tmax = tmin + 1;
      return { kind: 'node', field: 'temperature', min: tmin, max: tmax,
               label: 'TEMPERATURE',
               fmt: function (v) { return v.toFixed(1) + ' \u00b0C'; } };
    }
    if (this.viz === 'pressure') {
      m.nodes.forEach(function (n) {
        var pa = res.pressure && res.pressure[n.id];
        if (pa !== undefined && isFinite(pa)) vals.push(pa);
      });
      if (!vals.length) return null;
      return {
        kind: 'node', min: Math.min.apply(null, vals), max: Math.max.apply(null, vals),
        label: 'PRESSURE',
        fmt: function (v) { return FD.units.fmtPressure(v, d.pressure, true); }
      };
    }

    var self = this;
    (res.network ? res.network.links : []).forEach(function (l) {
      if (l._virtual) return;
      var q = res.flow[l.id];
      if (q === undefined) return;
      if (self.viz === 'flow') vals.push(Math.abs(q));
      else if (l.kind === 'pipe' && l._d > 0) {
        vals.push(FD.hydraulics.velocity(q, l._d));
      }
    });
    if (!vals.length) return null;

    if (this.viz === 'velocity') {
      /* Pinned to the warning limit so the colour has an absolute meaning. If
       * the model exceeds it, the top of the scale follows the worst section so
       * nothing is clipped off the end. */
      var lim = (m.settings.warn && m.settings.warn.velocity) || 2.4;
      var worst = Math.max.apply(null, vals);
      return {
        kind: 'pipe', min: 0, max: Math.max(lim, worst), limit: lim,
        label: 'VELOCITY',
        fmt: function (v) { return v.toFixed(2) + ' m/s'; }
      };
    }
    return {
      kind: 'pipe', min: 0, max: Math.max.apply(null, vals),
      label: 'FLOW',
      fmt: function (v) { return FD.units.fmtFlow(v, d.flow, true); }
    };
  };

  /* The colour a link should take under the active visualiser, or null. */
  View.prototype.vizPipeColour = function (p, scale) {
    if (!scale || scale.kind !== 'pipe') return null;
    var res = this.results;
    var q = res && res.flow ? res.flow[p.id] : undefined;
    if (q === undefined) return null;
    var link = res.network &&
      res.network.links.filter(function (l) { return l.id === p.id; })[0];
    var v;
    if (this.viz === 'flow') v = Math.abs(q);
    else {
      if (!link || !(link._d > 0) || link.kind !== 'pipe') return null;
      v = FD.hydraulics.velocity(q, link._d);
    }
    var span = scale.max - scale.min;
    return vizColour(span > 1e-12 ? (v - scale.min) / span : 0);
  };

  /* Pressure along a pipe, as a gradient between the colours of its two end
   * nodes. Returns a CanvasGradient (or a plain colour for a degenerate line),
   * or null when this is not the pressure visualiser.
   *
   * Colouring the run for pressure was refused once, on the grounds that
   * pressure is a nodal quantity and a colour along the pipe would imply a
   * value the solve does not produce. That was over-cautious for a plain pipe.
   * Friction loss per metre is constant along a uniform run carrying a constant
   * flow, and elevation varies linearly between the ends, so the head profile
   * between two nodes IS a straight line — the ramp is the answer, not an
   * invention. (Fittings are charged as lumped equivalent length, so the true
   * profile has small steps where they sit; both endpoints are exact either
   * way, and the discs still show them.)
   *
   * A DEVICE is the case where it would be a lie: a pump, a valve or a piece of
   * equipment puts its entire change at one point. Those get a hard step at the
   * symbol rather than a ramp, so the discontinuity stays visible. */
  View.prototype.vizPipeGradient = function (p, scale, sa, sb) {
    if (!scale || (this.viz !== 'pressure' && this.viz !== 'temperature')) return null;
    var res = this.results;
    var field = (this.viz === 'temperature')
      ? (res && res.thermal && res.thermal.temperature)
      : (res && res.pressure);
    if (!field) return null;
    var pa = field[p.a], pb = field[p.b];
    if (pa === undefined || pb === undefined) return null;
    if (!isFinite(pa) || !isFinite(pb)) return null;

    /* TEMPERATURE IS SAMPLED INSIDE THE PIPE, NOT AT THE NODES.
     *
     * A node temperature at a tee is the MIXTURE of everything arriving. A pipe
     * arriving there never contains that mixture — it delivers its own outlet
     * temperature INTO it — so colouring the run up to the node value smears a
     * discontinuity that is real and interesting back down the pipe. Michael,
     * 2026-08-07: "Temperature gradients down pipes are not capturing
     * discontinuities (e.g. mixing points where the temperature suddenly
     * jumps)."
     *
     * His fix, and it is the right one: read half a metre in from each end and
     * paint that gradient across the whole run. Half a metre is inside the pipe
     * by any reckoning, so it is that pipe's own water; the colour still
     * reaches the node, so the jump appears exactly where it happens — AT the
     * tee, as a step between two pipes rather than a ramp along one.
     *
     * The link's `tIn`/`tOut` are oriented by FLOW, not by a→b, so the
     * direction has to be resolved before they are used. */
    if (this.viz === 'temperature' && res.thermal && res.thermal.links) {
      var tl = res.thermal.links[p.id];
      var q = res.flow ? res.flow[p.id] : undefined;
      if (tl && isFinite(tl.tIn) && isFinite(tl.tOut) && q !== undefined) {
        var fwd = q >= 0;                       // a→b
        var tAtA = fwd ? tl.tIn : tl.tOut;
        var tAtB = fwd ? tl.tOut : tl.tIn;
        /* Half a metre in, as a fraction of the run. On a pipe shorter than a
         * metre the two samples would cross, so the ends are used as they are —
         * there is no room for a gradient to say anything anyway. */
        var L = M.pipeLength(this.getModel(), p);
        if (L > 1) {
          var f = 0.5 / L;
          pa = tAtA + (tAtB - tAtA) * f;
          pb = tAtA + (tAtB - tAtA) * (1 - f);
        } else {
          pa = tAtA; pb = tAtB;
        }
      }
    }

    var span = scale.max - scale.min;
    var at = function (v) { return span > 1e-12 ? (v - scale.min) / span : 0; };
    var ca = vizColour(at(pa)), cb = vizColour(at(pb));
    var mid = vizColour(at((pa + pb) / 2));

    if (Math.abs(sa.x - sb.x) < 0.5 && Math.abs(sa.y - sb.y) < 0.5) {
      return { stroke: ca, mid: mid };
    }
    var g = this.ctx.createLinearGradient(sa.x, sa.y, sb.x, sb.y);
    if (IN_LINE[p.kind]) {
      g.addColorStop(0, ca); g.addColorStop(0.5, ca);
      g.addColorStop(0.5, cb); g.addColorStop(1, cb);
    } else {
      g.addColorStop(0, ca); g.addColorStop(1, cb);
    }
    return { stroke: g, mid: mid };
  };

  /* Pressure visualiser: a filled disc at each node, over the gradient above.
   * The ramp shows the fall along a run; the disc is the exact solved value at
   * the node, which is the number the calculation sheet reports. */
  View.prototype.drawVizNodes = function (scale) {
    if (!scale || scale.kind !== 'node') return;
    var m = this.getModel(), ctx = this.ctx, self = this, res = this.results;
    var span = scale.max - scale.min;
    ctx.save();
    /* Whichever nodal field the scale names. PRESSURE was the only one when
     * this was written, so it read res.pressure directly. */
    var field = (scale.field === 'temperature')
      ? (res.thermal && res.thermal.temperature) : res.pressure;
    if (!field) return;
    m.nodes.forEach(function (n) {
      if (n.level !== m.activeLevel) return;
      var pa = field[n.id];
      if (pa === undefined || !isFinite(pa)) return;
      var w = M.worldXY(m, n);
      var s = self.toScreen(w.x, w.y);
      ctx.fillStyle = vizColour(span > 1e-12 ? (pa - scale.min) / span : 0);
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = self.theme.bg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.restore();
  };

  /* Legend for the active visualiser: the gradient, the two ends of the range,
   * and for velocity a tick where the warning limit sits. Without the numbers a
   * colour map is decorative. */
  View.prototype.drawVizLegend = function (scale) {
    if (!scale) return;
    var ctx = this.ctx;
    var W = 150, H = 9;
    var x = 14, y = this.cssH - 54;

    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = this.theme.text;
    ctx.fillText(scale.label, x, y - 6);

    for (var i = 0; i <= W; i++) {
      ctx.fillStyle = vizColour(i / W);
      ctx.fillRect(x + i, y, 1, H);
    }
    ctx.strokeStyle = this.theme.line || this.theme.mute;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, W, H);

    ctx.fillStyle = this.theme.dim;
    ctx.fillText(scale.fmt(scale.min), x, y + H + 12);
    ctx.textAlign = 'right';
    ctx.fillText(scale.fmt(scale.max), x + W, y + H + 12);

    if (scale.limit !== undefined && scale.max > scale.min) {
      var lx = x + W * (scale.limit - scale.min) / (scale.max - scale.min);
      ctx.strokeStyle = this.theme.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, y - 2); ctx.lineTo(lx, y + H + 2);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = this.theme.text;
      ctx.fillText('limit', lx, y - 6);
    }
    ctx.restore();
  };

  /* Halo the pipes and nodes the warning chip is reporting.
   *
   * A count of warnings tells you there is a problem but not WHERE, and finding
   * "section N12 → N13" by eye on a busy drawing is the slow part. Drawn as a
   * wide translucent amber stroke under the pipe so the pipe's own colour and
   * annotation stay readable on top. */
  View.prototype.drawWarnHighlight = function () {
    var h = this.warnHighlight;
    if (!h) return;
    var m = this.getModel(), ctx = this.ctx, self = this;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.theme.warn;
    ctx.lineCap = 'round';
    m.pipes.forEach(function (p) {
      if (!h.pipes || !h.pipes[p.id]) return;
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b) return;
      if (a.level !== m.activeLevel && b.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var sa = self.toScreen(wa.x, wa.y), sb = self.toScreen(wb.x, wb.y);
      ctx.lineWidth = self.pipeWidth(p) + 8;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    m.nodes.forEach(function (n) {
      if (!h.nodes || !h.nodes[n.id] || n.level !== m.activeLevel) return;
      var w = M.worldXY(m, n);
      var s = self.toScreen(w.x, w.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();
  };

  /* The reverse-direction button beside the selected device: a rounded box
   * carrying two opposed chevrons, drawn along the device's own axis so the
   * arrows point the two ways flow could go. */
  View.prototype.drawFlipButton = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    this.selection.forEach(function (s) {
      if (s.kind !== 'pipe') return;
      var p = M.pipe(m, s.id);
      var box = p && self.flipButtonBox(p);
      if (!box) return;

      ctx.save();
      ctx.translate(box.cx, box.cy);
      ctx.fillStyle = self.theme.bg;
      ctx.strokeStyle = self.theme.select;
      ctx.lineWidth = 2;
      var w = box.w / 2, h = box.h / 2, r = 3;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-w, -h, box.w, box.h, r);
      else ctx.rect(-w, -h, box.w, box.h);
      ctx.fill(); ctx.stroke();

      /* Chevrons along the device axis: one each way, so the button reads as
       * "reverse" rather than as a direction in its own right. */
      ctx.rotate(box.ang + Math.PI / 2);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-4, -3); ctx.lineTo(0, -8); ctx.lineTo(4, -3);
      ctx.moveTo(-4, 3);  ctx.lineTo(0, 8);  ctx.lineTo(4, 3);
      ctx.stroke();
      ctx.restore();

      // ---- on/off button, just beyond the flip button ----
      var pbox = self.powerButtonBox(p);
      if (!pbox) return;
      var off = self.isDeviceOff(p);
      ctx.save();
      ctx.translate(pbox.cx, pbox.cy);
      ctx.fillStyle = self.theme.bg;
      ctx.strokeStyle = off ? self.theme.error : self.theme.ok;
      ctx.lineWidth = 2;
      var pw = pbox.w / 2, ph = pbox.h / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-pw, -ph, pbox.w, pbox.h, 3);
      else ctx.rect(-pw, -ph, pbox.w, pbox.h);
      ctx.fill(); ctx.stroke();
      /* The IEC power mark: a broken ring with a stem. Reads as "power" at this
       * size where a word would not fit. */
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 1, 5, -Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(0, -1);
      ctx.stroke();
      ctx.restore();
    });
  };

  /* The pulse needs repainting; one frame at a time so an idle canvas is
   * still idle. */
  View.prototype.requestAnimation = function () {
    var self = this;
    if (this._anim) return;
    this._anim = requestAnimationFrame(function () {
      self._anim = null;
      self.render();
    });
  };

  /* Background drawing, under everything else. */
  View.prototype.drawTrace = function () {
    var m = this.getModel(), ctx = this.ctx;
    var lv = M.level(m, m.activeLevel);
    if (!lv || !lv.trace) return;
    var t = lv.trace;
    var self = this;
    var img = FD.trace.imageFor(lv, function () { self.render(); });

    var tl = this.toScreen(t.x, t.y);
    var w = t.width * this.scale;
    var h = t.width * t.aspect * this.scale;

    if (!img) {
      // still decoding: show the footprint so the canvas does not look empty
      ctx.save();
      ctx.strokeStyle = this.theme.mute;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(tl.x, tl.y, w, h);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = (t.opacity === undefined ? 0.6 : t.opacity);
    /* ctx.filter is how invert is done — cheaper and sharper than reading the
     * pixels back and flipping them by hand, and it composites on the GPU. */
    if (t.invert) ctx.filter = 'invert(1)';
    ctx.drawImage(img, tl.x, tl.y, w, h);
    ctx.restore();

    // frame + handles, only while the trace tool is active and it is unlocked
    if (this.tool === 'trace') {
      ctx.save();
      ctx.strokeStyle = t.locked ? this.theme.mute : this.theme.select;
      ctx.lineWidth = 1.5;
      if (t.locked) ctx.setLineDash([6, 4]);
      ctx.strokeRect(tl.x, tl.y, w, h);
      ctx.restore();
      if (!t.locked) this.drawTraceHandles(tl, w, h);
    }
  };

  var HANDLE = 9;

  View.prototype.traceCorners = function (tl, w, h) {
    return [
      { id: 'nw', x: tl.x,     y: tl.y },
      { id: 'ne', x: tl.x + w, y: tl.y },
      { id: 'se', x: tl.x + w, y: tl.y + h },
      { id: 'sw', x: tl.x,     y: tl.y + h }
    ];
  };

  View.prototype.drawTraceHandles = function (tl, w, h) {
    var ctx = this.ctx, self = this;
    this.traceCorners(tl, w, h).forEach(function (c) {
      ctx.fillStyle = self.theme.select;
      ctx.strokeStyle = self.theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
      ctx.fill(); ctx.stroke();
    });
  };

  /* Which part of the trace is under this screen point: a corner handle, the
   * body, or nothing. */
  View.prototype.traceHitAt = function (sx, sy) {
    var m = this.getModel();
    var lv = M.level(m, m.activeLevel);
    if (!lv || !lv.trace || lv.trace.locked) return null;
    var t = lv.trace;
    var tl = this.toScreen(t.x, t.y);
    var w = t.width * this.scale, h = t.width * t.aspect * this.scale;

    var corners = this.traceCorners(tl, w, h);
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      if (Math.abs(sx - c.x) <= HANDLE && Math.abs(sy - c.y) <= HANDLE) {
        return { part: c.id, trace: t };
      }
    }
    if (sx >= tl.x && sx <= tl.x + w && sy >= tl.y && sy <= tl.y + h) {
      return { part: 'body', trace: t };
    }
    return null;
  };

  View.prototype.drawGrid = function () {
    var m = this.getModel(), ctx = this.ctx;
    var lvG = M.level(m, m.activeLevel);
    if (lvG && lvG.trace && lvG.trace.hideGrid !== false) return;
    var g = m.settings.grid;
    var W = this.cssW, H = this.cssH;
    var tl = this.toWorld(0, 0), br = this.toWorld(W, H);

    function lines(step, colour, width) {
      if (step * self.scale < 6) return;          // too dense to be useful
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.beginPath();
      var x0 = Math.floor(tl.x / step) * step, x1 = br.x;
      for (var x = x0; x <= x1; x += step) {
        var s = self.toScreen(x, 0);
        ctx.moveTo(Math.round(s.x) + 0.5, 0); ctx.lineTo(Math.round(s.x) + 0.5, H);
      }
      var y0 = Math.floor(br.y / step) * step, y1 = tl.y;
      for (var y = y0; y <= y1; y += step) {
        var s2 = self.toScreen(0, y);
        ctx.moveTo(0, Math.round(s2.y) + 0.5); ctx.lineTo(W, Math.round(s2.y) + 0.5);
      }
      ctx.stroke();
    }
    var self = this;
    lines(g.minor, this.theme.minor, 1);
    lines(g.major, this.theme.major, 1);
  };

  /* Adjacent level renders faded ~30%, non-interactive (spec §7). */
  View.prototype.drawFadedLevel = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var lv = M.level(m, m.activeLevel);
    if (!lv) return;
    var idx = m.levels.indexOf(lv);
    var nb = m.levels[lv.lookDir === 'up' ? idx - 1 : idx + 1];
    if (!nb) return;

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = this.theme.mute;
    ctx.lineWidth = 1.5;
    m.pipes.forEach(function (p) {
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== nb.id || b.level !== nb.id) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var sa = self.toScreen(wa.x, wa.y), sb = self.toScreen(wb.x, wb.y);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    });
    ctx.restore();
  };

  View.prototype.pipeWidth = function (p) {
    var m = this.getModel();
    var bore = M.pipeBore(m, p) * 1000;
    return Math.max(1.5, Math.min(7, 1.5 + bore / 40));
  };

  View.prototype.drawPipes = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var res = this.results;
    var selIds = {};
    this.selection.forEach(function (s) { if (s.kind === 'pipe') selIds[s.id] = true; });
    var conflictIds = {};
    (this.conflict || []).forEach(function (id) { conflictIds[id] = true; });
    var vizScale = this.vizScale();

    m.pipes.forEach(function (p) {
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b) return;
      var onLevel = (a.level === m.activeLevel || b.level === m.activeLevel);
      if (!onLevel) return;

      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var sa = self.toScreen(wa.x, wa.y), sb = self.toScreen(wb.x, wb.y);

      // Pipes are blue when carrying flow, grey when not (spec §4)
      var q = res && res.flow ? res.flow[p.id] : undefined;
      var colour = (q === undefined || Math.abs(q) < 1e-9) ? self.theme.noflow : self.theme.flow;
      // A visualiser overrides the flow/no-flow colouring for plain pipes.
      var vc = self.vizPipeColour(p, vizScale);
      if (vc) colour = vc;

      /* The pressure visualiser paints a GRADIENT rather than one colour, so
       * `colour` becomes the mid value — arrows, glyphs and the riser ring all
       * take a single colour and the midpoint is the honest one for them. */
      var grad = self.vizPipeGradient(p, vizScale, sa, sb);
      if (grad) colour = grad.mid;
      var strokeStyle = grad ? grad.stroke : colour;

      if (p.kind === 'riser' && a.level !== b.level) {
        // A riser seen in plan is a point — draw it as a ring, not a line
        self.drawRiserGlyph(sa, colour, selIds[p.id]);
        return;
      }

      /* Geometry-conflict highlight sits UNDER the pipe and over the selection,
       * so the loop that blocks an edit reads as red at a glance. */
      if (conflictIds[p.id]) {
        ctx.strokeStyle = self.theme.error;
        ctx.lineWidth = self.pipeWidth(p) + 7;
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /* An in-line device reads as a POINT, not as a length of pipe.
       *
       * Hydraulically it IS a short link with its own two nodes (that is what
       * lets the runs either side keep their own lengths), but stroking that
       * link at full pipe width drew a fat stub with a symbol on top, so a
       * pump looked like a piece of pipe — and at high zoom it looked like a
       * long one. Drawing a thin connector instead, with a fixed-size symbol
       * at the midpoint, is how an engineer expects a valve or a pump to
       * appear on a plan: a symbol sitting on continuous pipework.
       *
       * The symbol is sized in SCREEN pixels, so it stays a point at every
       * zoom rather than growing with the link. */
      if (IN_LINE[p.kind]) {
        if (selIds[p.id]) {
          var msx = (sa.x + sb.x) / 2, msy = (sa.y + sb.y) / 2;
          ctx.strokeStyle = self.theme.select;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(msx, msy, 15, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = Math.min(2, self.pipeWidth(p));
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();

        if (p.kind === 'pump') self.drawPumpGlyph(p, sa, sb, selIds[p.id], q || 1);
        else if (p.kind === 'valve') self.drawValveGlyph(p, sa, sb, selIds[p.id]);
        else if (p.kind === 'sensor') self.drawSensorGlyph(p, sa, sb, selIds[p.id]);
        else self.drawEquipGlyph(p, sa, sb, selIds[p.id]);
        return;
      }

      if (selIds[p.id]) {
        ctx.strokeStyle = self.theme.select;
        ctx.lineWidth = self.pipeWidth(p) + 4;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      }
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = self.pipeWidth(p);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();

      {
        /* NO FLOW, NO ARROW. 1e-9 m³/s is a numerical zero, not a hydraulic
         * one: a shut branch settles at 1e-7 or so and still drew an arrow,
         * stating a direction the model does not have. Q_MIN is the threshold
         * the solver itself uses to decide a link carries water at all, so the
         * drawing and the calculation now agree about what "no flow" means. */
        if (q !== undefined && Math.abs(q) >= FD.hydraulics.Q_MIN) {
          self.drawArrow(sa, sb, q, colour);
        }
        if (self.scale > 12) self.drawPipeLabel(p, sa, sb);
      }
    });
  };

  View.prototype.drawRiserGlyph = function (s, colour, selected) {
    var ctx = this.ctx;
    ctx.strokeStyle = selected ? this.theme.select : colour;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  };

  /* Riser columns. A column that does not reach the active level still renders,
   * hollow and dashed, as a "riser stub" — it is the snap target you click to
   * complete the connection from this floor (spec §7.2 step 2). */
  /* ==================================== THE RISER MARKER, AS MICHAEL DRAWS IT
   *
   * A CIRCLE where the column meets this floor's pipework, a short leader out
   * to a SQUARE, and the notation inside the square:
   *
   *     ‾V   the column starts here and drops     V    passes through,
   *     V_   it ends here, fed from above         V    going down
   *
   * and the mirror with Λ for water going up. The chevron is the flow
   * direction; the BAR marks the end that terminates. `M.riserNotation` works
   * out which — the drawing only draws it.
   *
   * The circle sits on the node, because that is where the pipework actually
   * connects; the box is offset so the symbol does not sit on top of the
   * junction it is describing. That is the arrangement on his own drawings.
   */
  var RISER_R = 9;                 // circle radius, px
  var RISER_BOX = 26;              // box side, px
  var RISER_GAP = 13;              // leader length, px

  View.prototype.drawRisers = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var res = this.results;
    /* Which columns stop in mid-air, and at which end. Drawn on the level the
     * open end is ON, so it appears where the fix has to be made. */
    var open = {};
    (M.riserOpenEnds ? M.riserOpenEnds(m) : []).forEach(function (o) {
      if (o.level !== m.activeLevel) return;
      if (!open[o.riser]) open[o.riser] = [];
      open[o.riser].push(o.end);
    });
    m.risers.forEach(function (r) {
      var here = r.attachments.some(function (a) { return a.level === m.activeLevel; });
      var s = self.toScreen(r.x, r.y);
      var sel = self.selection.some(function (x) {
        return x.kind === 'riser' && x.id === r.id;
      });
      var colour = sel ? self.theme.select : (here ? self.theme.flow : self.theme.mute);

      /* ---- the circle, on the connection itself. */
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = here ? 2.5 : 1.5;
      if (!here) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(s.x, s.y, RISER_R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      /* ---- the leader and the box. The default is down-right on a 45°, which
       * is how it is drawn on paper and keeps the box clear of the pipework
       * running through the node. The user can DRAG the box anywhere in
       * ANNOTATION and the leader follows, staying attached to the circle
       * (Michael, 2026-08-10). The offset is per level and in SCREEN pixels, so
       * the callout keeps its size and place through zoom, like a label. */
      var k = Math.SQRT1_2;
      var half = RISER_BOX / 2;
      var defC = (RISER_R + RISER_GAP) * k + half;
      var noff = r.noteOffset && r.noteOffset[m.activeLevel];
      var cx = s.x + (noff ? noff.dx : defC);
      var cy = s.y + (noff ? noff.dy : defC);
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = here ? 2 : 1.2;
      if (!here) ctx.setLineDash([3, 3]);
      /* Leader: circle edge in the box's direction, to where the line enters the
       * box, so it touches the box rather than crossing into it. Skipped if the
       * box has been dragged onto the circle — there is nothing to point. */
      var ldx = cx - s.x, ldy = cy - s.y, llen = Math.hypot(ldx, ldy);
      if (llen > RISER_R + 2) {
        var ex = s.x + RISER_R * ldx / llen, ey = s.y + RISER_R * ldy / llen;
        var tX = ldx !== 0 ? ((cx - Math.sign(ldx) * half) - s.x) / ldx : -Infinity;
        var tY = ldy !== 0 ? ((cy - Math.sign(ldy) * half) - s.y) / ldy : -Infinity;
        var tEnt = Math.max(0, Math.min(1, Math.max(tX, tY)));
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(s.x + ldx * tEnt, s.y + ldy * tEnt);
        ctx.stroke();
      }
      ctx.strokeRect(cx - half, cy - half, RISER_BOX, RISER_BOX);
      ctx.restore();

      /* ---- the notation inside it. */
      var note = M.riserNotation
        ? M.riserNotation(m, r, m.activeLevel, res && res.flow)
        : null;
      if (note) self.drawRiserNotation(cx, cy, note, colour, here);

      /* The box IS the select handle now: a big, obvious target that is not on
       * top of the node underneath, which is what the little triangle was
       * working around. */
      self._riserBoxes.push({ riser: r, x: cx - half, y: cy - half,
                              w: RISER_BOX, h: RISER_BOX });

      if (m.settings.annotate.fitType) {
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = colour;
        ctx.fillText('R' + r.attachments.length, s.x, s.y - RISER_R - 4);
        ctx.restore();
      }

      /* AN OPEN END. The column hands over to horizontal pipework at its top
       * and bottom; if that node carries nothing else, the riser stops in mid
       * air. Marked in the warning colour — it is a modelling error, not a
       * fault of the plant. */
      if (open[r.id] && open[r.id].length) {
        ctx.save();
        ctx.strokeStyle = self.theme.warn;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(s.x, s.y, RISER_R + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = self.theme.warn;
        ctx.fillText(open[r.id].join('/') + ' open', s.x, s.y - RISER_R - 16);
        ctx.restore();
      }
    });
  };

  /* The chevrons and the bar, centred in the box.
   *
   * A chevron is drawn as two strokes rather than a filled triangle: it is a
   * DIRECTION mark on a drawing, not an arrowhead on a line, and Michael's
   * drawings have it open. With no solved flow there is no direction to state,
   * so a bar alone is drawn on whichever ends terminate and nothing else —
   * saying "down" because nothing has been calculated would be an invention. */
  View.prototype.drawRiserNotation = function (cx, cy, note, colour, solid) {
    var ctx = this.ctx;
    var W = 13, H = 7, GAP = 3;
    var up = (note.dir === 'up');
    var pass = note.up && note.down;

    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = solid ? 2.2 : 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function chevron(yTop) {
      /* Drawn from its top edge; points DOWN unless the flow is up. */
      ctx.beginPath();
      if (up) {
        ctx.moveTo(cx - W / 2, yTop + H);
        ctx.lineTo(cx, yTop);
        ctx.lineTo(cx + W / 2, yTop + H);
      } else {
        ctx.moveTo(cx - W / 2, yTop);
        ctx.lineTo(cx, yTop + H);
        ctx.lineTo(cx + W / 2, yTop);
      }
      ctx.stroke();
    }
    function bar(y) {
      ctx.beginPath();
      ctx.moveTo(cx - W / 2 - 1, y);
      ctx.lineTo(cx + W / 2 + 1, y);
      ctx.stroke();
    }

    if (note.dir === null) {
      /* Nothing solved: state only what the geometry says. */
      if (note.capTop) bar(cy - H / 2 - GAP);
      if (note.capBottom) bar(cy + H / 2 + GAP);
      if (note.capTop || note.capBottom) { ctx.restore(); return; }
      ctx.restore();
      return;
    }

    if (pass) {
      /* Two chevrons, no bar — it carries on both ways. */
      chevron(cy - H - GAP / 2);
      chevron(cy + GAP / 2);
    } else if (note.capTop) {
      /* Bar above, one chevron: the column starts on this floor. */
      bar(cy - H / 2 - GAP);
      chevron(cy - H / 2 + 1);
    } else {
      /* One chevron, bar below: the column ends on this floor. */
      chevron(cy - H / 2 - 1);
      bar(cy + H / 2 + GAP);
    }
    ctx.restore();
  };

  /* Valve glyph: the standard opposed-triangles bowtie, drawn along the pipe.
   * Filled when shut, hollow when fully open, part-filled in between — so how
   * far open a valve is can be read off the drawing without selecting it. */
  View.prototype.drawValveGlyph = function (p, sa, sb, selected) {
    var ctx = this.ctx, m = this.getModel();
    var v = p.valve || { type: 'gate', opening: 100 };
    var t = FD.valves.type(v.type);
    var shut = FD.valves.isClosed(v.type, v.opening);
    var open = (v.opening === undefined ? 100 : v.opening);

    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    var colour = selected ? this.theme.select
               : shut ? this.theme.error
               : (open < 100 ? this.theme.warn : this.theme.ok);

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;

    var w = 8, h = 7;

    if (t.checkValve) {
      /* Check valve: an ARROWHEAD pointing the way flow is ALLOWED, with a SEAT
       * BAR across its tip — the standard non-return symbol Michael asked for
       * (2026-08-10), replacing the swing flapper. The valve holds against flow
       * b→a (it shuts when the head at a falls below b, see network.js), so it
       * passes a→b, which is local +x here — the arrow points that way.
       *
       * Drawn LARGER than the bowtie valves on purpose: the whole point of the
       * symbol is that it states a direction, and it has to read at a glance. */
      var aw = w * 1.4, ah = h * 1.4;          // arrowhead half-length / half-height
      ctx.lineWidth = 2.5;
      ctx.beginPath();                         // the arrowhead, apex toward b
      ctx.moveTo(-aw, -ah);
      ctx.lineTo(aw, 0);
      ctx.lineTo(-aw, ah);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();                         // the seat bar across the tip
      ctx.moveTo(aw + 2, -ah - 2);
      ctx.lineTo(aw + 2, ah + 2);
      ctx.stroke();
      ctx.lineWidth = 2;
    } else {
      // Bowtie body, shared by gate and globe.
      ctx.beginPath();
      ctx.moveTo(-w, -h); ctx.lineTo(0, 0); ctx.lineTo(-w, h); ctx.closePath();
      ctx.moveTo(w, -h); ctx.lineTo(0, 0); ctx.lineTo(w, h); ctx.closePath();

      // fill proportion = how far CLOSED the valve is
      var frac = 1 - open / 100;
      if (frac > 0) {
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.75 * frac;
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();

      /* A globe valve carries a FILLED disc at the throat (a ball valve's is
       * hollow) — the convention in Michael's reference sheet, and what tells
       * the two apart on a drawing. */
      if (v.type === 'globe') {
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }
    ctx.restore();

    /* Position is shown ABOVE the valve whenever it is throttled, independently
     * of the fitting-type annotation: how far open a regulating valve is set is
     * a number you want on the drawing even when codes are switched off. */
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = colour;
    var codeTxt = m.settings.annotate.fitType ? t.code : '';
    var posTxt = t.adjustable ? open + '%' : '';
    var label = [codeTxt, posTxt].filter(Boolean).join(' ');
    /* BELOW the glyph, because the space above belongs to the tag. It used to
     * sit at −15, which is where drawTag puts the tag — and drawTag was never
     * called here at all, so a valve showed neither its tag nor its flow and PD
     * value box while every other in-line device did. Michael, 2026-08-04. */
    if (label) ctx.fillText(label, mx, my + 20);

    this.drawTag(p, mx, my);
  };

  /* Equipment glyph: a square box straddling the pipe — a coil, chiller,
   * heat exchanger, anything with a rated flow and pressure drop. */
  /* SENSOR: an instrument, so it must NOT read as plant.
   *
   * A small hollow circle with a stem to the pipe — the instrument bubble every
   * P&ID uses — rather than the filled ring a pump and a chiller share. It
   * carries no flow decision and no duty, and the symbol should say so at a
   * glance: this thing measures, it does not do anything to the water.
   *
   * Amber rather than green/red, because green and red are the in-service /
   * isolated pair on the devices that HAVE a service state. A sensor has none. */
  /* A right-angle Z between two screen points, in the same convention as
   * `M.controlRoute`: `horiz` true means the MIDDLE segment is vertical, so the
   * route leaves and arrives horizontally. Bends that collapse onto a
   * neighbour are dropped, so a straight run really is two points and an L is
   * three — a zero-length segment puts a doubled dot on a dotted line. */
  function orthoRoute(ax, ay, bx2, by2, horiz) {
    var pts = horiz
      ? [{ x: ax, y: ay }, { x: (ax + bx2) / 2, y: ay },
         { x: (ax + bx2) / 2, y: by2 }, { x: bx2, y: by2 }]
      : [{ x: ax, y: ay }, { x: ax, y: (ay + by2) / 2 },
         { x: bx2, y: (ay + by2) / 2 }, { x: bx2, y: by2 }];
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var q = out[out.length - 1];
      if (Math.abs(pts[i].x - q.x) > 0.5 || Math.abs(pts[i].y - q.y) > 0.5) out.push(pts[i]);
    }
    return out;
  }

  /* Pull the last point of a route back along its final segment, so a leader
   * stops short of the bubble it points at instead of running under it. */
  function trimLast(pts, by) {
    if (pts.length < 2) return pts;
    var b = pts[pts.length - 1], a = pts[pts.length - 2];
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (!(d > 0)) return pts;
    var k = Math.max(0, d - by) / d;
    pts[pts.length - 1] = { x: a.x + dx * k, y: a.y + dy * k };
    /* If trimming collapsed the last segment, drop the point rather than leave
     * a zero-length one — it puts a doubled dot on a dotted line. */
    if (pts.length > 2 && Math.hypot(dx * k, dy * k) < 0.5) pts.pop();
    return pts;
  }

  View.prototype.drawSensorGlyph = function (p, sa, sb, selected) {
    var ctx = this.ctx, m = this.getModel(), self = this;
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var colour = selected ? this.theme.select : this.theme.warn;
    /* WHAT IT MEASURES, on the bubble. A differential says so — Michael,
     * 2026-08-05: a ΔP sensor was showing 'T', which is the one letter it is
     * not. Two-character labels get a smaller font so they still fit the
     * instrument bubble rather than spilling out of it. */
    var sm = (p.sensor && p.sensor.mode) || 'temperature';
    var mode = sm === 'flow' ? 'F'
             : sm === 'pressure' ? 'P'
             : sm === 'dP' ? '\u0394P'
             : sm === 'dT' ? '\u0394T' : 'T';

    /* ================================================ A DIFFERENTIAL
     *
     * ONE ROUTE BETWEEN THE TWO TAPPINGS, with the bubble at the centre of its
     * middle segment. Michael, 2026-08-06: "Could we just draw a C/Z between
     * the 2 points and put the dP symbol at the geometric center of the middle
     * section?"
     *
     * What it replaces is the lesson. A bubble hung off the sensor's own pipe
     * plus a SEPARATE reference line to the far tapping is two leaders that
     * have to be kept from colliding — and over three attempts they did not
     * manage it: the reference line ran diagonally, then it retraced the stem,
     * then it retraced it only when the bubble was dragged across the pipe. One
     * route has nothing to collide with, and it says what a ΔP is far better:
     * the symbol sits BETWEEN the two things being measured.
     *
     * Drawn only when both ends are on the level being shown; a route to a
     * tapping on another floor would cut across pipework it has nothing to do
     * with, and then the plain bubble below is the fallback. */
    var route = M.sensorRoute(m, p);
    if (route) {
      var refPipe = M.pipe(m, p.sensor.ref);
      var rn = M.node(m, refPipe.a), on2 = M.node(m, p.a);
      if (!rn || !on2 || rn.level !== m.activeLevel || on2.level !== m.activeLevel) route = null;
    }

    if (route) {
      var rp = route.points.map(function (q) { return self.toScreen(q.x, q.y); });
      var ms = route.midSeg.map(function (q) { return self.toScreen(q.x, q.y); });
      var cx = (ms[0].x + ms[1].x) / 2, cy = (ms[0].y + ms[1].y) / 2;
      var R2 = 10;

      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      /* Dotted rather than the control link's dash, so the two do not read as
       * the same thing: that one carries a signal to a device, this one only
       * says what the reading is taken across. */
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(rp[0].x, rp[0].y);
      for (var ri = 1; ri < rp.length; ri++) ctx.lineTo(rp[ri].x, rp[ri].y);
      ctx.stroke();
      ctx.setLineDash([]);

      /* An open square at EACH tapping — both ends are measurement points and
       * neither is the sender, which is exactly the difference from the control
       * link's one-ended ring. */
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rp[0].x - 3.5, rp[0].y - 3.5, 7, 7);
      var lastP = rp[rp.length - 1];
      ctx.strokeRect(lastP.x - 3.5, lastP.y - 3.5, 7, 7);

      // the bubble, at the geometric centre of the middle segment
      ctx.fillStyle = this.theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = colour;
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(mode, cx, cy);
      ctx.restore();

      /* EVERY VERTEX IS A HANDLE, and so is the bubble. With both tappings
       * pinned to their pipes the route has exactly one degree of freedom —
       * where the middle segment sits — so whichever you grab, the same thing
       * moves. That is the shape, not a shortcut: any orthogonal three-segment
       * path between two fixed points is determined by its middle segment. */
      if (this.tool === 'view') {
        var grabs = [{ x: cx, y: cy }];
        for (var gj = 1; gj < rp.length - 1; gj++) grabs.push(rp[gj]);
        var sh = self.pickHalf();
        grabs.forEach(function (g, gi) {
          self.labelHandle(g.x - 5, g.y - 5, 10, 10);
          self._controlHandles.push({
            pipe: p, host: p.sensor, key: 'route', axis: route.axis,
            from: route.from, to: route.to, route: route,
            /* Which BEND this is, so a free drag knows what it is moving. The
             * bubble (index 0 in `grabs`) is not a bend — it rides the middle
             * segment — so it keeps the old whole-route behaviour. */
            vertex: gi === 0 ? null : gi - 1,
            /* A ROUTE HANDLE OFTEN SITS ON A PIPE, and a small target under a
             * pipe that is also asking for the click is hard to hit — Michael,
             * 2026-08-08, and again 2026-08-09. Sized in GRID SQUARES now
             * (`pickHalf`) so it holds its size relative to the drawing rather
             * than shrinking with the zoom. */
            x: g.x - sh, y: g.y - sh, w: sh * 2, h: sh * 2
          });
        });
        /* AND THE FAR TAPPING SLIDES ALONG ITS OWN PIPE (Michael, 2026-08-06).
         * A separate kind of handle because it has a different freedom: the
         * route's vertices move the annotation, this one moves WHERE ON THE
         * PIPE the reading is taken from. Constrained to the pipe, so it cannot
         * be dragged off the thing it is measuring. */
        self.labelHandle(lastP.x - 5, lastP.y - 5, 10, 10);
        self._controlHandles.push({
          pipe: p, host: p.sensor, key: 'refT', tap: true,
          x: lastP.x - sh, y: lastP.y - sh, w: sh * 2, h: sh * 2
        });
      }

      this.drawTag(p, mx, my);
      return;
    }

    /* ================================================ EVERYTHING ELSE
     *
     * PERPENDICULAR TO THE PIPE (Michael, 2026-08-04). It used to stand
     * straight up in screen space, which reads as perpendicular only on a
     * horizontal run and sits ON the pipe on a vertical one. The normal is
     * taken from the run itself, and the side is chosen so the bubble goes
     * UPWARD on screen wherever possible — a consistent default beats a
     * geometrically arbitrary one.
     *
     * A stored `sensorOffset` overrides it, so it can be dragged to the other
     * side in VIEW like any other annotation. */
    var dx = sb.x - sa.x, dy = sb.y - sa.y;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }          // prefer the upward normal
    var off = M.labelOffset(p, 'sensor');
    var R = 9, REACH = 18;
    var bx = mx + nx * REACH + off.dx, by = my + ny * REACH + off.dy;

    /* The stem is orthogonal too: undragged it is a single short segment either
     * way, and once the bubble has been moved a diagonal leader across a
     * drawing of horizontal and vertical runs is an eyesore. It leaves
     * PERPENDICULAR to the pipe, which is where an instrument bubble stands. */
    var stem = orthoRoute(mx, my, bx, by, Math.abs(nx) > Math.abs(ny));
    trimLast(stem, R);            // stop short of the bubble, outline stays clean

    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(stem[0].x, stem[0].y);
    for (var si = 1; si < stem.length; si++) ctx.lineTo(stem[si].x, stem[si].y);
    ctx.stroke();
    ctx.fillStyle = this.theme.bg;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font = '600 ' + (mode.length > 1 ? 9 : 11) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mode, bx, by);
    ctx.restore();

    /* Draggable in VIEW, on its own offset key so it moves independently of
     * the tag above it. */
    this.registerLabel('sensor', p, bx - R, by - R, R * 2, R * 2);
    if (this.tool === 'view') this.labelHandle(bx - R, by - R, R * 2, R * 2);

    this.drawTag(p, mx, my);
  };

  View.prototype.drawEquipGlyph = function (p, sa, sb, selected) {
    var ctx = this.ctx;
    var off = !!(p.equip && p.equip.off);
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);

    /* Equipment reads as a NODE on the run, the same as a pump does — it was
     * an unfilled box that merged into the pipework and did not look like a
     * device sitting at a point. Green in service, red isolated, matching the
     * pump so the two can be scanned together. */
    var colour = selected ? this.theme.select
               : off ? this.theme.error : this.theme.ok;
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = colour;
    ctx.fillStyle = this.theme.bg;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.rotate(ang);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (off) {
      /* A bar ACROSS the pipe, not along it: it reads as a blank/isolation
       * plate stopping flow. Drawn along the run it looked like a dash. */
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
    } else {
      // Square box inside the ring — the equipment symbol, still a point.
      ctx.rect(-5, -5, 10, 10);
    }
    ctx.stroke();
    ctx.restore();
    this.drawTag(p, mx, my);
  };

  /* Equipment tag, drawn above the device glyph. This is the reference an
   * engineer actually works from, so it takes priority over the geometry
   * annotations and is always shown when set. */
  View.prototype.drawTag = function (p, x, y) {
    var off = M.labelOffset(p);
    var size = this.labelSize();
    /* HIDDEN TAGS STILL DRAW IN ANNOTATION, greyed, so there is something left
     * to click on and turn back on. Everywhere else they are simply gone. */
    var shown = M.tagVisible(p), arranging = (this.tool === 'view');
    if (p.tag && (shown || arranging)) {
      var ctx = this.ctx;
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = shown ? this.theme.text : this.theme.mute;
      var tx = x + off.dx, ty = y - 16 + off.dy;
      ctx.save();
      if (!shown) ctx.globalAlpha = 0.55;
      ctx.fillText(p.tag, tx, ty);
      ctx.restore();
      var w = ctx.measureText(p.tag).width;
      this.registerLabel('pipe', p, tx - w / 2 - 3, ty - size, w + 6, size + 5);
      if (arranging) this.labelHandle(tx - w / 2 - 3, ty - size, w + 6, size + 5, !shown);
    }
    this.drawDeviceBox(p, { x: x, y: y });
  };

  /* Pump glyph: a circle with a chevron pointing along the flow. */
  View.prototype.drawPumpGlyph = function (p, sa, sb, selected, q) {
    var ctx = this.ctx;
    var off = !!(p.pump && p.pump.mode === 'off');
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x) + (q < 0 ? Math.PI : 0);
    ctx.save();
    ctx.translate(mx, my);
    /* A stopped pump is RED with a bar, not green with a chevron. The chevron
     * states a flow direction, and a pump that is off has none — showing one
     * invited reading a standby pump as running. */
    ctx.strokeStyle = selected ? this.theme.select
                    : off ? this.theme.error : this.theme.ok;
    ctx.fillStyle = this.theme.bg;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath();
    if (off) {
      /* Bar ACROSS the run, not along it — it reads as flow being stopped
       * rather than as a dash. */
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
    } else {
      ctx.moveTo(-3, -5); ctx.lineTo(5, 0); ctx.lineTo(-3, 5);
    }
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    /* Pumps carry a tag exactly as equipment does — CHW-P-01 is the reference
     * the engineer works from. This call was simply missing, so the tag was
     * stored, editable, and never drawn. */
    this.drawTag(p, mx, my);
  };

  /* Below this, a pipe is not carrying anything and gets NO ARROW. An arrow on
   * a dead leg states a direction the model does not have — Michael,
   * 2026-08-08 — and on a standby branch it is actively misleading. The same
   * threshold the solver uses to decide a link carries water at all. */
  View.prototype.drawArrow = function (sa, sb, q, colour) {
    var ctx = this.ctx;
    var k = (this.getModel().settings.presentation || {}).arrowSize || 1;
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x) + (q < 0 ? Math.PI : 0);
    ctx.save();
    ctx.translate(mx, my); ctx.rotate(ang); ctx.scale(k, k);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(-4, 4.5); ctx.lineTo(-4, -4.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  /* Pipe annotation, e.g. "50⌀/12.50m/2.40L/s" — fields toggled in SETTINGS. */
  View.prototype.pipeLabelText = function (p) {
    var m = this.getModel(), a = m.settings.annotate, d = m.settings.display;
    var res = this.results;
    var link = (res && res.network)
      ? res.network.links.find(function (l) { return l.id === p.id; }) : null;
    var q = res && res.flow ? res.flow[p.id] : undefined;

    var parts = [];
    /* A PLAIN PIPE CAN CARRY A TAG TOO — Michael, 2026-08-09: "pipes & fittings
     * should also have Tag Visible options". A run is a thing you name
     * ("CHW-S-01") just as much as the plant on it, and it had nowhere to put
     * the name. First in the label, so it reads as the name of the thing rather
     * than as one more annotation on it, and switched off by the same per-item
     * rule as every other tag. */
    if (p.tag && (M.tagVisible(p) || this.tool === 'view')) parts.push(p.tag);
    /* Downstream FIXTURE UNITS — plumbing only, from the sizing pass (res.byPipe).
     * There are no fixture units in a hydronic model, so the option does nothing
     * there. First after the tag: it is the load the pipe carries, the plumbing
     * analogue of flow. */
    if (a.pipeFU && m.discipline === 'plumbing' && res && res.byPipe && res.byPipe[p.id]) {
      parts.push(res.byPipe[p.id].fu.toFixed(1) + 'FU');
    }
    if (a.pipeDiameter) parts.push(FD.units.sizeLabel(p.size, d.size));
    if (a.pipeLength) parts.push(FD.units.fmtLength(M.pipeLength(m, p), d.length) +
                                 (d.length === 'm' ? 'm' : 'ft'));
    if (a.pipeFlow && q !== undefined) parts.push(FD.units.fmtFlow(Math.abs(q), d.flow) + d.flow);
    if (a.pipeVelocity && link && q !== undefined) {
      parts.push(FD.hydraulics.velocity(q, link._d).toFixed(2) + 'm/s');
    }
    if (a.pipePD && link && q !== undefined) {
      var pd = FD.units.headToPaWith(Math.abs(FD.hydraulics.linkLoss(link, q)),
                                     m.settings.fluid && m.settings.fluid.density);
      parts.push(FD.units.fmtPressure(pd, d.pressure) + d.pressure);
    }
    /* Friction RATE, on the actual length and excluding fitting equivalent
     * length — the same basis as the PDM warning, so the drawing and the
     * warning cannot quote different numbers for the same pipe. */
    if (a.pipePDM && link && q !== undefined && link._L > 1e-9) {
      var pdm = FD.hydraulics.pdPerMetre(link._rActual, q, link.n, link._L,
                                         m.settings.fluid && m.settings.fluid.density);
      parts.push(FD.units.fmtPdm(pdm, d.pdm) + d.pdm);
    }
    return parts.join('/');
  };

  View.prototype.drawPipeLabel = function (p, sa, sb) {
    var ctx = this.ctx;
    var text = this.pipeLabelText(p);
    if (!text) return;
    var len = Math.hypot(sb.x - sa.x, sb.y - sa.y);

    ctx.font = this.labelSize() + 'px system-ui, sans-serif';
    if (ctx.measureText(text).width + 8 > len) return;   // would overflow the pipe

    var off = M.labelOffset(p);
    var mx = (sa.x + sb.x) / 2 + off.dx, my = (sa.y + sb.y) / 2 + off.dy;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;     // keep text upright
    ctx.save();
    ctx.translate(mx, my); ctx.rotate(ang); ctx.translate(0, -9);
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.dim;
    ctx.fillText(text, 0, 0);
    ctx.restore();

    /* The label is drawn ROTATED along the pipe, so its hit box has to be
     * rotated too. Registering an unrotated box left a vertical pipe's label
     * sitting inside a wide, flat rectangle that matched nothing on screen.
     *
     * Rather than carry a rotated polygon around, the axis-aligned bounding
     * box of the rotated text is used: correct for horizontal and vertical
     * runs (the overwhelming majority), and never wildly wrong on a diagonal. */
    var w = ctx.measureText(text).width;
    var size = this.labelSize();
    var cx = mx - Math.sin(ang) * -9;
    var cy = my + Math.cos(ang) * -9;
    var box = rotatedBox(cx, cy, w + 6, size + 8, ang);
    this.registerLabel('pipe', p, box.x, box.y, box.w, box.h);
    if (this.tool === 'view') this.labelHandle(box.x, box.y, box.w, box.h);
  };

  /* Axis-aligned bounding box of a w×h rectangle centred on (cx,cy) and
   * rotated by `ang`. The centre is offset along the rotated axis first, so
   * the box tracks the text where it is actually drawn. */
  function rotatedBox(cx, cy, w, h, ang) {
    var c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
    var bw = w * c + h * s;
    var bh = w * s + h * c;
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  }

  View.prototype.drawNodes = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var selIds = {};
    this.selection.forEach(function (s) { if (s.kind === 'node') selIds[s.id] = true; });
    var supply = this.supplyProblem();

    m.nodes.forEach(function (n) {
      if (n.level !== m.activeLevel) return;
      var w = M.worldXY(m, n);
      var s = self.toScreen(w.x, w.y);
      var dev = n.device;
      var degree = M.pipesAt(m, n.id).length;

      if (selIds[n.id]) {
        ctx.strokeStyle = self.theme.select; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.stroke();
      }

      if (dev && dev.kind === 'source') {
        /* A source that cannot meet the demands drawn on it is the single most
         * useful thing to see at a glance, so it turns red and carries the
         * shortfall next to it rather than only appearing in a warnings list. */
        var bad = supply && supply.sources.indexOf(n.id) >= 0;
        ctx.fillStyle = bad ? self.theme.error : self.theme.ok;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x + 8, s.y + 5); ctx.lineTo(s.x - 8, s.y + 5);
        ctx.closePath(); ctx.fill();

        if (bad) {
          ctx.strokeStyle = self.theme.error;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2); ctx.stroke();
          self.label(s, 'SRC', self.theme.error);
          self.errorBadge(s.x + 12, s.y + 20,
            'Insufficient − ' + FD.units.fmtPressure(supply.worstShortPa,
              m.settings.display.pressure, true));
        } else {
          self.label(s, 'SRC', self.theme.ok);
        }
      } else if (dev && dev.kind === 'demand') {
        var active = dev.include !== false;
        ctx.strokeStyle = active ? self.theme.accent : self.theme.mute;
        ctx.fillStyle = active ? self.theme.accent : 'transparent';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 6.5, 0, Math.PI * 2);
        if (active) ctx.fill(); else ctx.stroke();      // hollow when excluded (§8.2)
        var txt = FD.units.fmtFlow(dev.flow, m.settings.display.flow, true);
        self.label(s, txt, active ? self.theme.accent : self.theme.mute);
      } else if (degree !== 2) {
        // junctions and ends get a dot; plain elbows do not need one
        ctx.fillStyle = self.theme.dim;
        ctx.beginPath(); ctx.arc(s.x, s.y, degree > 2 ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      }

      self.drawNodeLabel(n, s);
    });
  };

  /* Node annotation: number and fitting-type code, e.g. "N3 T".
   * Sits below the node so it cannot collide with the pipe labels above. */
  View.prototype.drawNodeLabel = function (n, s) {
    var m = this.getModel(), a = m.settings.annotate, ctx = this.ctx;
    var parts = [];
    if (a.nodeNumbers) parts.push(n.id);
    if (a.fitType) {
      var code = FD.network.nodeTypeCode(m, n.id);
      if (code) parts.push(code);
    }
    if (a.fitPD && this.results && this.results.network) {
      // fitting PD at this node = sum of the fitting EL losses charged here
      var pd = this.fittingPDAt(n.id);
      if (pd > 0) parts.push(FD.units.fmtPressure(pd, m.settings.display.pressure) +
                             m.settings.display.pressure);
    }
    /* Gauge pressure at the node, straight from the solve. Shown even when it
     * is negative or zero — a shortfall is exactly what you want to see on the
     * drawing, so it must not be filtered out the way fitting PD is. */
    if (a.nodePressure && this.results && this.results.pressure) {
      var pa = this.results.pressure[n.id];
      if (pa !== undefined && isFinite(pa)) {
        parts.push(FD.units.fmtPressure(pa, m.settings.display.pressure) +
                   m.settings.display.pressure);
      }
    }
    /* Temperature at the node, from the thermal module. Like pressure, shown
     * whatever the value — a temperature that has run away from where it
     * should be is exactly the thing you want to see on the drawing. */
    if (a.nodeTemperature && this.results && this.results.thermal) {
      var tC = this.results.thermal.temperature[n.id];
      if (tC !== undefined && isFinite(tC)) parts.push(tC.toFixed(1) + '\u00b0C');
    }
    if (!parts.length) return;

    var off = M.labelOffset(n);
    var size = this.labelSize();
    var x = s.x + off.dx, y = s.y + 17 + off.dy;
    var text = parts.join(' ');

    var nShown = M.tagVisible(n), nArranging = (this.tool === 'view');
    if (!nShown && !nArranging) { this.drawDeviceBox(n, s); return; }

    ctx.font = (size - 1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.mute;
    ctx.save();
    if (!nShown) ctx.globalAlpha = 0.55;
    ctx.fillText(text, x, y);
    ctx.restore();

    var w = ctx.measureText(text).width;
    this.registerLabel('node', n, x - w / 2 - 3, y - size, w + 6, size + 6);
    if (nArranging) this.labelHandle(x - w / 2 - 3, y - size, w + 6, size + 6, !nShown);

    this.drawDeviceBox(n, s);
  };

  View.prototype.labelSize = function () {
    var p = this.getModel().settings.presentation || {};
    return p.labelSize || 11;
  };

  /* Faint outline round a draggable label, so VIEW mode shows what can be
   * grabbed without cluttering the drawing in every other mode. */
  /* `muted` draws the dashed box in grey rather than the orange selection
   * colour. Michael, 2026-08-09: a switched-OFF equipment tag looked almost
   * identical to a node's own label, because both are grey text — and the
   * orange handle round it read as "selected" rather than as "hidden". Grey
   * box, grey text: hidden. Orange box: something you can grab that is on. */
  View.prototype.labelHandle = function (x, y, w, h, muted) {
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = muted ? this.theme.mute : this.theme.select;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 2]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  };

  /* Device values echoed beside the entity in a box, one line per property the
   * user ticked in VIEW mode. */
  /* The "Show on drawing" value box.
   *
   * It carries its OWN offset ('box'), not the entity's label offset, and it is
   * registered as a draggable in VIEW. Sharing the label's offset meant moving
   * a tag dragged the value box with it and the box could not be grabbed at all
   * — so a tag and its values could never be placed on opposite sides of a
   * fitting, which is exactly what a busy drawing needs (Michael, 2026-08-02).
   * The disconnection ⚠️ already worked this way, under the 'warn' key. */
  View.prototype.drawDeviceBox = function (obj, s) {
    var flags = M.displayFlags(obj);
    var keys = Object.keys(flags);
    if (!keys.length) return;
    var off = M.labelOffset(obj, 'box');

    var m = this.getModel(), d = m.settings.display, res = this.results, ctx = this.ctx;
    var lines = [];
    var dev = obj.device;

    if (dev && dev.kind === 'demand') {
      if (flags.flow) lines.push('Q ' + FD.units.fmtFlow(dev.flow, d.flow, true));
      if (flags.actualFlow) {
        /* What the terminal actually draws: the solved terminal flow in
         * SIMULATION, the design demand in DESIGN (where it is imposed). */
        var sim = res && res.simulation;
        var term = sim && sim.terminals.filter(function (t) { return t.node === obj.id; })[0];
        var qa = term ? term.actualFlow
               : (m.settings.calcMode !== 'simulation' ? dev.flow : null);
        if (qa !== null && qa !== undefined && isFinite(qa)) {
          lines.push('Qa ' + FD.units.fmtFlow(qa, d.flow, true));
        }
      }
      if (flags.required) lines.push('Req ' + FD.units.fmtPressure(dev.reqPressure, d.pressure, true));
      if (flags.available && res && res.pressure[obj.id] !== undefined) {
        lines.push('Avail ' + FD.units.fmtPressure(res.pressure[obj.id], d.pressure, true));
      }
    } else if (dev && dev.kind === 'source') {
      if (flags.elevation) lines.push('El ' + FD.units.fmtLength(M.elevation(m, obj), d.length, true));
      if (flags.available && res && res.pressure[obj.id] !== undefined) {
        lines.push('P ' + FD.units.fmtPressure(res.pressure[obj.id], d.pressure, true));
      }
      if (flags.temperature && res && res.thermal) {
        var tn = res.thermal.temperature[obj.id];
        if (tn !== undefined && isFinite(tn)) lines.push('T ' + tn.toFixed(1) + '\u00b0C');
      }
    } else {
      // in-line device (pump / equipment / valve)
      if (flags.tag && obj.tag) lines.push(obj.tag);
      if (res && res.flow[obj.id] !== undefined) {
        if (flags.flow) lines.push('Q ' + FD.units.fmtFlow(Math.abs(res.flow[obj.id]), d.flow, true));
        if (flags.head && obj.pump) {
          /* What the pump is ACTUALLY developing, which in SIMULATION is its
           * curve read at the solved flow — not `pump.head`, which is the
           * DESIGN duty and the number the drawing was wrongly showing
           * (Michael, 2026-08-02). The properties panel had this right and the
           * drawing did not, so the same model reported two different heads.
           *
           * Only in SIMULATION: in DESIGN the solver runs on `pump.head` even
           * when a curve is present, so reading the curve there would report a
           * head the calculation did not use. A stopped pump develops nothing —
           * reading its curve at Q = 0 would give shutoff head, the opposite of
           * the truth. */
          var pq = Math.abs((res && res.flow[obj.id]) || 0);
          var hNow = M.pumpHead(m, obj, pq);
          lines.push('H ' + FD.units.fmtPressure(
            FD.units.headToPaWith(hNow, m.settings.fluid.density), d.pressure, true));
        }
        /* VFD speed, on its own toggle rather than riding on the head one.
         * Shown at 100% too (Michael, 2026-08-03) — "is this pump on full?" is
         * a question you ask of a pump that is NOT modulating just as often. */
        if (flags.vfd && obj.pump && obj.pump.mode !== 'off') {
          lines.push('VFD ' + Math.round(M.pumpSpeed(m, obj) * 100) + '%');
        }
        /* VALVE POSITION — the toggle existed in the panel from 2026-08-06 and
         * nothing drew it. On a balanced circuit the positions ARE the answer,
         * so they are the one thing you want on the drawing. */
        if (flags.opening && obj.valve &&
            obj.valve.opening !== undefined && obj.valve.opening !== null) {
          lines.push(Math.round(obj.valve.opening) + '% open');
        }
        if (flags.pd) {
          var link = res.network && res.network.links.find(function (l) { return l.id === obj.id; });
          if (link && link.r !== undefined) {
            lines.push('ΔP ' + FD.units.fmtPressure(FD.units.headToPaWith(
              Math.abs(FD.hydraulics.linkLoss(link, res.flow[obj.id])),
              m.settings.fluid.density), d.pressure, true));
          }
        }
      }
      /* Thermal, from the thermal pass rather than the hydraulic one. Read
       * separately because a device can carry flow with no thermal result —
       * nothing sets a temperature — and the box should show what it has. */
      var tl = res && res.thermal && res.thermal.links[obj.id];
      if (tl) {
        if (flags.temp) {
          /* AN INSTRUMENT READS ONE TEMPERATURE. A sensor passes water straight
           * through, so its inlet and outlet are the same number and "35.4 →
           * 35.4 °C" is that number written twice with an arrow between it —
           * Michael, 2026-08-08. A device that actually does something thermal
           * still gets both, because there the two differ and the difference is
           * the point. */
          var sameT = Math.abs(tl.tOut - tl.tIn) < 0.05;
          lines.push(sameT ? tl.tIn.toFixed(1) + '\u00b0C'
                           : tl.tIn.toFixed(1) + ' → ' + tl.tOut.toFixed(1) + '\u00b0C');
        }
        if (flags.dT) lines.push('ΔT ' + (tl.dT >= 0 ? '+' : '') + tl.dT.toFixed(1) + ' K');
        if (flags.duty) {
          /* A COOLING LOAD READS POSITIVE, with the word doing the work the
           * minus sign used to (Michael, 2026-08-06). The stored value keeps
           * its sign — the convention is what makes the heat balance add up. */
          lines.push((tl.qW < 0 ? 'Cool ' : 'Heat ') +
                     (Math.abs(tl.qW) / 1000).toFixed(1) + ' kW');
          if (tl.limit) lines.push('(' + tl.limit + ')');
        }
        /* % LOAD against the nameplate — offered as a toggle from 2026-08-06
         * and drawn here, or the switch would do nothing. */
        if (flags.pctload && obj.equip) {
          var capW = obj.equip.equipType === 'source'
            ? Number(obj.equip.qMax) : Number(obj.equip.duty);
          if (isFinite(capW) && capW !== 0) {
            lines.push((tl.qW / capW * 100).toFixed(0) + '% load');
          }
        }
      }
      /* SETPOINT, for anything that states one — it used to be source/sink
       * only, so the toggle did nothing on a sensor (Michael, 2026-08-05). */
      if (flags.setpoint) {
        if (obj.equip && obj.equip.equipType === 'source' &&
            obj.equip.tSet !== undefined && obj.equip.tSet !== null) {
          lines.push('SP ' + Number(obj.equip.tSet).toFixed(1) + '\u00b0C');
        }
        if (obj.sensor) {
          var sp = M.sensorSetpoint(obj);
          if (sp) {
            /* EVERY MODE ITS OWN UNITS. The two DIFFERENTIAL modes fell through
             * to °C, so a ΔP sensor's setpoint was labelled as a temperature on
             * the drawing — Michael, 2026-08-08. Same fall-through that put
             * "200000.0 °C" on a pump's switch in v0.15.1; this was the other
             * place it hid. */
            lines.push('SP ' + (
                sp.mode === 'flow' ? FD.units.fmtFlow(sp.value, d.flow, true)
              : (sp.mode === 'pressure' || sp.mode === 'dPdiff')
                  ? FD.units.fmtPressure(sp.value, d.pressure, true)
              : sp.mode === 'dTdiff' ? sp.value.toFixed(1) + ' K'
              : sp.value.toFixed(1) + '\u00b0C'));
          }
        }
      }
      /* WHAT AN INSTRUMENT IS READING. Its own toggle per mode, so ticking
       * "Differential pressure" on a ΔP sensor draws the differential — the
       * quantity the instrument exists to report — instead of the water
       * temperature at its tapping, which is what the old fixed Temperature
       * toggle drew. Michael, 2026-08-09.
       *
       * The reading comes from `FD.network.sensorReading`, the same definition
       * the control loop settles against, so the number on the drawing and the
       * number the controller is holding cannot disagree. */
      if (obj.kind === 'sensor' && obj.sensor && res &&
          (flags.pressure || flags.dP || flags.dTdiff)) {
        var rd = FD.network.sensorReading(m, obj, res);
        if (rd) {
          if (flags.pressure && rd.mode === 'pressure') {
            lines.push(FD.units.fmtPressure(rd.value, d.pressure, true));
          }
          if (flags.dP && rd.mode === 'dP') {
            lines.push('ΔP ' + FD.units.fmtPressure(rd.value, d.pressure, true));
          }
          if (flags.dTdiff && rd.mode === 'dT') {
            lines.push('ΔT ' + rd.value.toFixed(1) + ' K');
          }
        }
      }
      /* THE DESIGN LOAD on an exchanger — what it was sized for, beside what it
       * is doing. Michael, 2026-08-05. */
      /* THE DESIGN FIGURE, wherever the machine keeps it. Michael, 2026-08-09:
       * "Display > Design Load does not pop up anything." It was drawn only for
       * an EXCHANGER, whose design figure is `duty` — a source/sink keeps its
       * on `qMax`, so on a chiller or a tower the switch did nothing at all. */
      if (flags.load && obj.equip) {
        var dsn = (obj.equip.equipType === 'source') ? obj.equip.qMax : obj.equip.duty;
        if (dsn !== undefined && dsn !== null && isFinite(Number(dsn))) {
          lines.push('Q\u1d48 ' + (Number(dsn) >= 0 ? '+' : '') +
                     (Number(dsn) / 1000).toFixed(1) + ' kW');
        }
      }
    }
    if (!lines.length) return;

    var size = this.labelSize();
    ctx.font = size + 'px system-ui, sans-serif';
    var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 12;
    var h = lines.length * (size + 3) + 8;
    var x = s.x + 14 + (off ? off.dx : 0), y = s.y + 22 + (off ? off.dy : 0);

    ctx.save();
    ctx.fillStyle = this.theme.bg;
    ctx.strokeStyle = this.theme.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.theme.text;
    ctx.textAlign = 'left';
    lines.forEach(function (l, i) { ctx.fillText(l, x + 6, y + size + 2 + i * (size + 3)); });
    ctx.restore();

    this.registerLabel('box', obj, x, y, w, h);
    if (this.tool === 'view') this.labelHandle(x, y, w, h);
  };

  /* Pressure drop attributable to the fittings charged at this node.
   *
   * How it is worked out depends on how the active method CHARGES fittings,
   * and the two are not interchangeable:
   *
   *   K  (ASHRAE, Darcy-Weisbach) — the fitting loss is its own quantity,
   *      K·V²/2g at the velocity in the pipe it is charged to. Direct.
   *
   *   EL (Hazen-Williams) — the fitting is extra LENGTH folded into the pipe's
   *      resistance, so its share is the pipe's loss times the fraction of
   *      effective length it contributes.
   *
   * Only the EL branch existed, and under a K method it divided by `_Leff`,
   * which under K is the drawn length with no fitting allowance in it at all —
   * so the answer was the pipe's own loss scaled by an unrelated ratio. That
   * was wrong for ASHRAE, which is the DEFAULT method, from the day the K
   * method landed. */
  View.prototype.fittingPDAt = function (nodeId) {
    var m = this.getModel(), res = this.results;
    if (!res || !res.network) return 0;
    var method = FD.hydraulics.method(m.settings.frictionMethod);
    var usesK = (method.fittingMode === 'K');
    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    var kSet = (m.settings.dw && m.settings.dw.kSet) || 'threaded';
    var fits = FD.network.fittingsAtNode(m, nodeId, res.flow, []);
    var total = 0;
    fits.forEach(function (f) {
      var link = res.network.links.find(function (l) { return l.id === f.pipe; });
      if (!link) return;
      var q = res.flow[link.id];
      if (q === undefined) return;
      var pipe = M.pipe(m, f.pipe);
      if (!pipe) return;

      if (usesK) {
        if (!(link._d > 0)) return;
        var nominal_mm = FD.schedules.nominalMm
          ? FD.schedules.nominalMm(pipe.size) : link._d * 1000;
        var K = FD.ktable.k(FD.fittings.ktableType(f.type), nominal_mm, kSet,
                            m.settings.fittingK);
        var v = FD.hydraulics.velocity(q, link._d);
        total += FD.units.headToPaWith(K * v * v / (2 * 9.81), rho);
        return;
      }

      if (!link._Leff) return;
      /* Keyed on the DESIGNATION, matching the NFPA 13 table — see
       * fittings.el. The bore is only the velocity's business. */
      var nominal = FD.schedules.nominalMm
        ? FD.schedules.nominalMm(pipe.size) : M.pipeBore(m, pipe) * 1000;
      var elen = FD.fittings.el(f.type, nominal, m.settings);
      var loss = FD.units.headToPaWith(Math.abs(FD.hydraulics.linkLoss(link, q)), rho);
      total += loss * (elen / link._Leff);
    });
    return total;
  };

  /* The SUPPLY_INSUFFICIENT warning from the last solve, if any. */
  View.prototype.supplyProblem = function () {
    var res = this.results;
    if (!res || !res.warnings) return null;
    for (var i = 0; i < res.warnings.length; i++) {
      if (res.warnings[i].code === 'SUPPLY_INSUFFICIENT') return res.warnings[i];
    }
    return null;
  };

  /* Small red callout drawn beside a node. */
  View.prototype.errorBadge = function (x, y, text) {
    var ctx = this.ctx;
    ctx.font = '11px system-ui, sans-serif';
    var w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeStyle = this.theme.error;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - 12, w, 20, 4); else ctx.rect(x, y - 12, w, 20);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.theme.error;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 7, y + 2);
  };

  /* Register a label’s screen box so it can be picked up in VIEW mode. */
  View.prototype.registerLabel = function (kind, obj, x, y, w, h) {
    if (!this._labelBoxes) this._labelBoxes = [];
    this._labelBoxes.push({ kind: kind, obj: obj, x: x, y: y, w: w, h: h });
  };

  View.prototype.labelAt = function (sx, sy) {
    var boxes = this._labelBoxes || [];
    for (var i = boxes.length - 1; i >= 0; i--) {
      var b = boxes[i];
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b;
    }
    return null;
  };

  View.prototype.label = function (s, text, colour, dy) {
    var ctx = this.ctx;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = colour;
    ctx.fillText(text, s.x + 10, s.y - (dy === undefined ? 8 : -dy));
  };

  View.prototype.drawDraft = function () {
    if (!this.cursor) return;

    /* The snap preview is shown for every tool that LANDS on geometry, not just
     * DRAW PIPE. A riser or a source snaps to a node or a pipe exactly as a
     * pipe vertex does, but showed no marker, so there was no way to tell
     * whether the click was going to attach to the run or drop next to it —
     * which is precisely the mistake that produces a coincident-but-unjoined
     * node. RISER resolves its snap differently (much larger radii, grid last),
     * so it previews through its own function. */
    if (this.tool === 'riser') {
      var rs = this.riserSnap(this.cursor.x, this.cursor.y);
      this.snapPreview(this.toScreen(rs.x, rs.y), rs.kind);
      return;
    }
    if (this.tool === 'source' || this.tool === 'demand') {
      var ds = this.snap(this.cursor.x, this.cursor.y);
      this.snapPreview(this.toScreen(ds.x, ds.y), ds.kind);
      return;
    }
    if (this.tool !== 'pipe') return;

    var ctx = this.ctx, m = this.getModel();
    var s = this.drawTarget(this.cursor);
    var sb = this.toScreen(s.x, s.y);

    // Snap preview: an open circle wherever the pipe would attach.
    this.snapPreview(sb, s.kind);

    if (!this.draft) return;

    var a = this.draft.last;
    var sa = this.toScreen(a.x, a.y);

    /* While a length is being typed, the preview shows THAT length along the
     * current bearing — so the dashed line is what Enter will commit, not where
     * the mouse happens to be. */
    var typed = this.typedLength();
    if (typed !== null) {
      var td = this.draftDirection();
      if (td) {
        s = { kind: 'typed', x: a.x + td.x * typed, y: a.y + td.y * typed };
        sb = this.toScreen(s.x, s.y);
      }
    }

    ctx.save();
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    ctx.restore();

    // length readout + size badge at the cursor (spec §5)
    var len = Math.hypot(s.x - a.x, s.y - a.y);
    var size = this.drawSize || m.settings.lastSize ||
               FD.schedules.defaultSize(m.settings.schedule, m.customSchedules);
    var bearing = (Math.atan2(s.y - a.y, s.x - a.x) * 180 / Math.PI + 360) % 360;
    var text = FD.units.fmtLength(len, m.settings.display.length, true) + '  ·  ' +
               FD.units.sizeLabel(size, m.settings.display.size) + '  ·  ' +
               bearing.toFixed(0) + '°';
    this.badge(sb.x + 16, sb.y - 16, text);

    if (this.lengthEntry) {
      this.badge(sb.x + 16, sb.y + 6,
        'length ' + this.lengthEntry + ' ' + m.settings.display.length +
        (this.typedLength() === null ? '  — not a number' : '   ↵ to draw'));
    } else if (s.kind === 'pipe') this.badge(sb.x + 16, sb.y + 6, 'insert tee');
    else if (s.kind === 'node') this.badge(sb.x + 16, sb.y + 6, 'connect');
  };

  /* Open circle showing where the next click will land, colour-coded by what
   * it will do: connect to a node, split a pipe into a tee, or free/grid. */
  View.prototype.snapPreview = function (sb, kind) {
    var ctx = this.ctx;
    var colour = (kind === 'node') ? this.theme.ok
               : (kind === 'pipe') ? this.theme.select
               : this.theme.accent;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sb.x, sb.y, kind === 'pipe' ? 8 : 7, 0, Math.PI * 2);
    ctx.stroke();
    if (kind === 'pipe') {
      // a small cross-tick to say "this becomes a tee"
      ctx.beginPath();
      ctx.moveTo(sb.x - 12, sb.y); ctx.lineTo(sb.x + 12, sb.y);
      ctx.moveTo(sb.x, sb.y - 12); ctx.lineTo(sb.x, sb.y + 12);
      ctx.globalAlpha = 0.5;
      ctx.stroke();
    }
    ctx.restore();
  };

  View.prototype.badge = function (x, y, text) {
    var ctx = this.ctx;
    ctx.font = '11px system-ui, sans-serif';
    var w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - 12, w, 19, 4); else ctx.rect(x, y - 12, w, 19);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y + 2);
  };

  /* Rubber band between the two calibration picks. */
  View.prototype.drawCalibration = function () {
    if (!this.calibrating) return;
    var ctx = this.ctx, pts = this.calibrating.points, self = this;

    if (!pts.length) {
      var c0 = this.cursor ? this.toScreen(this.cursor.x, this.cursor.y) : null;
      if (c0) this.badge(c0.x + 14, c0.y - 14, 'pick the 1st point of a known distance');
      return;
    }

    ctx.save();
    ctx.strokeStyle = this.theme.select;
    ctx.fillStyle = this.theme.select;
    ctx.lineWidth = 2;
    pts.forEach(function (p) {
      var s2 = self.toScreen(p.x, p.y);
      ctx.beginPath(); ctx.arc(s2.x, s2.y, 5, 0, Math.PI * 2); ctx.fill();
    });
    if (pts.length === 1 && this.cursor) {
      /* Preview the SNAPPED point so the 15° constraint is visible as you aim. */
      var cur = this.angleSnap(pts[0].x, pts[0].y, this.cursor.x, this.cursor.y);
      var a = this.toScreen(pts[0].x, pts[0].y);
      var b = this.toScreen(cur.x, cur.y);
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      var span = Math.hypot(cur.x - pts[0].x, cur.y - pts[0].y);
      this.badge(b.x + 14, b.y - 14,
        'pick the 2nd point  ·  currently ' + span.toFixed(2) + ' m');
      return;
    }
    ctx.restore();
  };

  View.prototype.startCalibration = function () {
    this.calibrating = { points: [] };
    this.render();
  };

  View.prototype.cancelCalibration = function () {
    this.calibrating = null;
    this.render();
  };

  View.prototype.drawMarquee = function () {
    if (!this.marquee) return;
    var ctx = this.ctx, q = this.marquee;
    var a = this.toScreen(q.x0, q.y0), b = this.toScreen(q.x1, q.y1);
    ctx.save();
    ctx.strokeStyle = this.theme.select;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  };

  View.prototype.drawScaleBar = function () {
    var ctx = this.ctx;
    // pick a round world length that lands near 100 px
    var target = 100 / this.scale;
    var pow = Math.pow(10, Math.floor(Math.log10(target)));
    var mult = [1, 2, 5, 10].find(function (k) { return pow * k >= target; }) || 10;
    var len = pow * mult;
    var px = len * this.scale;
    var x = 16, y = this.cssH - 18;

    ctx.strokeStyle = this.theme.dim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = this.theme.dim;
    ctx.textAlign = 'left';
    ctx.fillText(FD.units.fmtLength(len, this.getModel().settings.display.length, true), x + px + 8, y + 1);
  };

  /* Minimal node tooltip: number, elevation, gauge pressure, and each connected
   * pipe's flow with direction — the "useful at tees" case in spec §10. */
  View.prototype.drawTooltip = function () {
    if (!this.hover || this.hover.kind !== 'node' || !this.results) return;
    var m = this.getModel(), res = this.results, ctx = this.ctx;
    var n = M.node(m, this.hover.id);
    if (!n) return;
    var w = M.worldXY(m, n), s = this.toScreen(w.x, w.y);

    var lines = [
      'Node ' + n.id,
      'Elev  ' + FD.units.fmtLength(M.elevation(m, n), m.settings.display.length, true),
      'Press ' + (res.pressure[n.id] !== undefined
        ? FD.units.fmtPressure(res.pressure[n.id], m.settings.display.pressure, true) : '—')
    ];
    M.pipesAt(m, n.id).forEach(function (p) {
      var q = res.flow[p.id];
      if (q === undefined) return;
      var leaving = (p.a === n.id) ? q > 0 : q < 0;
      lines.push((leaving ? '→ out ' : '← in  ') + p.id + '  ' +
                 FD.units.fmtFlow(Math.abs(q), m.settings.display.flow, true));
    });

    void ctx;
    this.drawInfoBox(lines, s.x, s.y);
  };

  /* ------------------------------------------------------------------ PROBE
   *
   * Read pressure, flow and velocity at any POINT along a run, rather than only
   * at the nodes. Pressure is the one that varies — flow and velocity are
   * constant along a uniform pipe — and it is the reason the tool exists: the
   * calculation sheet gives you node values, and the question in front of an
   * engineer is often "what is the pressure at the tee I have not drawn yet".
   *
   * Pressure at a fraction t along a pipe is a straight-line interpolation
   * between its two end pressures, and that is the real profile, not a
   * convenience:
   *
   *   - Both ends are at the same elevation, by the layout rule, so there is no
   *     static term varying along the run.
   *   - The flow is the same at every point of the pipe, and the bore is
   *     uniform, so friction loss per metre is CONSTANT.
   *
   * The one caveat, and it is stated in the readout: fittings are charged as
   * lumped equivalent length spread over the whole pipe, so where a real
   * fitting sits there is a small step that the straight line averages out.
   * The end values are exact either way.
   *
   * A DEVICE is the case where interpolating would be a lie — a pump, valve or
   * piece of equipment puts its entire pressure change at one point. Those
   * report both sides and the change across, and no interpolated value. */
  View.prototype.probeData = function (hit) {
    var m = this.getModel(), res = this.results;
    if (!hit || !hit.pipe || !res || !res.pressure) return null;
    var p = hit.pipe;
    var pa = res.pressure[p.a], pb = res.pressure[p.b];
    if (pa === undefined || pb === undefined) return null;

    var q = res.flow[p.id];
    var link = res.network && res.network.links
      ? res.network.links.filter(function (l) { return l.id === p.id; })[0] : null;
    var device = !!IN_LINE[p.kind];

    var out = {
      pipe: p, t: hit.t, point: hit.point, device: device,
      flow: q, pressureA: pa, pressureB: pb,
      pressure: device ? null : pa + hit.t * (pb - pa),
      velocity: null, distance: null
    };
    if (!device && link && link._d > 0 && q !== undefined) {
      out.velocity = FD.hydraulics.velocity(q, link._d);
    }
    if (!device) out.distance = hit.t * M.pipeLength(m, p);

    /* Temperature at the probed point.
     *
     * NOT a straight line between the two ends, which is what pressure gets.
     * The profile along a pipe is exponential — the difference driving the
     * heat exchange shrinks as the water approaches ambient — so the same
     * closed form the engine uses is re-solved for the part-length. A linear
     * interpolation would read low near the inlet and high near the outlet,
     * and on a long run at low flow it would walk straight past ambient.
     *
     * A DEVICE puts its whole change at one point, so it reports both sides
     * and no value along it, exactly as it does for pressure. */
    var th = res.thermal;
    out.temperature = null;
    if (th && th.links[p.id]) {
      var tl = th.links[p.id];
      out.thermal = tl;
      if (!device) {
        /* `hit.t` runs a -> b along the DRAWN segment; the water may be going
         * the other way. Measure from the inlet, not from the a-end. */
        var frac = (q >= 0) ? hit.t : (1 - hit.t);
        out.temperature = FD.thermal.pipeOutlet(
          tl.tIn, th.ambient, tl.UperM || 0, (tl.length || 0) * frac,
          tl.mdot, th.fluid.specificHeat);
      }
    }
    return out;
  };

  View.prototype.probeLines = function (d) {
    var m = this.getModel(), disp = m.settings.display;
    var lines = [];
    if (d.device) {
      var name = d.pipe.kind === 'pump' ? 'Pump' : d.pipe.kind === 'valve' ? 'Valve' : 'Equip';
      lines.push(name + ' ' + (d.pipe.tag || d.pipe.id));
      lines.push('In    ' + FD.units.fmtPressure(d.pressureA, disp.pressure, true));
      lines.push('Out   ' + FD.units.fmtPressure(d.pressureB, disp.pressure, true));
      lines.push('Delta ' + FD.units.fmtPressure(d.pressureB - d.pressureA, disp.pressure, true));
      if (d.flow !== undefined) {
        lines.push('Flow  ' + FD.units.fmtFlow(Math.abs(d.flow), disp.flow, true));
      }
      if (d.thermal) {
        lines.push('Temp  ' + d.thermal.tIn.toFixed(1) + ' \u2192 ' +
                   d.thermal.tOut.toFixed(1) + ' \u00b0C');
        lines.push('Duty  ' + (d.thermal.qW >= 0 ? '+' : '') +
                   (d.thermal.qW / 1000).toFixed(2) + ' kW');
      }
      lines.push('(steps at the device — not read along it)');
      return lines;
    }
    lines.push('Pipe ' + d.pipe.id + '  at ' +
               FD.units.fmtLength(d.distance, disp.length, true) +
               ' of ' + FD.units.fmtLength(M.pipeLength(m, d.pipe), disp.length, true));
    lines.push('Press ' + FD.units.fmtPressure(d.pressure, disp.pressure, true));
    /* Flow and velocity are the same at every point of a uniform pipe. That was
     * spelled out beside each of them once; it made a four-line readout read
     * like a warning, and it is not news to anyone reading it. */
    lines.push('Flow  ' + (d.flow === undefined ? '—'
      : FD.units.fmtFlow(Math.abs(d.flow), disp.flow, true)));
    lines.push('Vel   ' + (d.velocity === null ? '—'
      : FD.units.fmtVelocity(d.velocity, disp.length !== 'ft')));
    /* Temperature varies along a pipe for the same reason pressure does, and
     * the profile is EXPONENTIAL rather than straight: the driving difference
     * to ambient shrinks as the water approaches it. Interpolating linearly
     * between the two ends would read low near the inlet and high near the
     * outlet, so the probe re-solves the same closed form the engine uses. */
    if (d.temperature !== null && d.temperature !== undefined) {
      lines.push('Temp  ' + d.temperature.toFixed(2) + ' \u00b0C');
    }
    return lines;
  };

  View.prototype.drawProbe = function () {
    if (this.tool !== 'probe') return;
    /* The pinned reading wins the box. A live hover still draws its marker, so
     * you can see where a second click would land without losing the first. */
    var pinned = this.probeData(this.probe);
    var live = this.probeData(this.probeHover);
    var ctx = this.ctx, self = this;

    function marker(d, solid) {
      var s = self.toScreen(d.point.x, d.point.y);
      ctx.save();
      ctx.strokeStyle = self.theme.select;
      ctx.lineWidth = 1.5;
      if (!solid) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
      ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10);
      ctx.stroke();
      ctx.restore();
      return s;
    }

    if (live && (!pinned || live.pipe.id !== pinned.pipe.id ||
                 Math.abs(live.t - pinned.t) > 1e-6)) {
      marker(live, false);
    }
    var show = pinned || live;
    if (!show) return;
    var at = marker(show, !!pinned);
    this.drawInfoBox(this.probeLines(show), at.x, at.y);
  };

  /* The dark readout box, shared by the node tooltip and the probe so the two
   * cannot drift apart. Flips to stay on screen. */
  View.prototype.drawInfoBox = function (lines, sx, sy) {
    var ctx = this.ctx;
    ctx.save();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    var wid = Math.max.apply(null, lines.map(function (l) {
      return ctx.measureText(l).width;
    })) + 16;
    var hgt = lines.length * 15 + 10;
    var x = sx + 16, y = sy + 12;
    if (x + wid > this.cssW) x = sx - wid - 16;
    if (y + hgt > this.cssH) y = this.cssH - hgt - 4;

    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, wid, hgt, 5); else ctx.rect(x, y, wid, hgt);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    lines.forEach(function (l, i) { ctx.fillText(l, x + 8, y + 18 + i * 15); });
    ctx.restore();
  };

  /* ------------------------------------------------------- control links
   *
   * A dashed GREEN orthogonal route from a pump or globe valve to the
   * equipment whose setpoint it follows. Green and dashed so it reads as a
   * signal rather than as pipework — it carries no water, and nothing about it
   * enters the calculation.
   *
   * Orthogonal, L or Z, because a diagonal across a floor plan reads as a pipe
   * run. The bend is draggable in VIEW and is presentation only. */
  /* A palette name resolved against the CURRENT theme, so a drawing made in
   * dark mode stays legible in light. */
  /* THE PALETTE'S DEFAULT IS 'line', AND THE THEME HAS NEVER HAD A `line`.
   *
   * A2, Michael 2026-08-08: the TEXT BOX tool created a note, on the right
   * level, with the right text, and nothing appeared on the drawing. This is
   * why, and it is nastier than a wrong colour.
   *
   * `t.line` is `undefined`. Assigning `undefined` to `fillStyle` or
   * `strokeStyle` is INVALID, and the canvas spec says an invalid assignment is
   * IGNORED — so the context silently keeps whatever colour it was last set to.
   * In `drawNotes` that is `theme.bg`, set two lines earlier for the note's own
   * backing panel: the text was painted in the background colour on top of a
   * background-coloured rectangle. Drawn perfectly, and perfectly invisible.
   *
   * A detail line took whatever the previous draw call happened to leave, which
   * is why THOSE were visible — in an arbitrary colour nobody chose.
   *
   * `text` is the theme's neutral foreground and is what 'line' always meant:
   * the ordinary drawing colour. Both themes define it. */
  View.prototype.detailColour = function (name) {
    var t = this.theme;
    return (name === 'ok') ? t.ok : (name === 'warn') ? t.warn
         : (name === 'error') ? t.error : (name === 'accent') ? t.accent
         : (name === 'select') ? t.select : t.text;
  };

  View.prototype.drawDetails = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    (m.details || []).forEach(function (d) {
      if (d.level !== m.activeLevel || !d.pts || d.pts.length < 2) return;
      var sel = self.selection.some(function (x) {
        return x.kind === 'detail' && x.id === d.id;
      });
      ctx.save();
      ctx.strokeStyle = sel ? self.theme.select : self.detailColour(d.colour);
      ctx.lineWidth = (d.width || 1.5) * (sel ? 2 : 1);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      var p0 = self.toScreen(d.pts[0].x, d.pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (var i = 1; i < d.pts.length; i++) {
        var q = self.toScreen(d.pts[i].x, d.pts[i].y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.restore();
    });
    /* The run being drawn right now, dashed so it reads as provisional. */
    if (this.detailDraft && this.detailDraft.pts.length) {
      ctx.save();
      ctx.strokeStyle = this.theme.select;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      var d0 = this.toScreen(this.detailDraft.pts[0].x, this.detailDraft.pts[0].y);
      ctx.moveTo(d0.x, d0.y);
      for (var j = 1; j < this.detailDraft.pts.length; j++) {
        var dq = this.toScreen(this.detailDraft.pts[j].x, this.detailDraft.pts[j].y);
        ctx.lineTo(dq.x, dq.y);
      }
      if (this.cursor) {
        /* The preview obeys the same rule as the click, or the line jumps when
         * you commit it. */
        var aimD = this.detailTarget(this.cursor);
        var cq = this.toScreen(aimD.x, aimD.y);
        ctx.lineTo(cq.x, cq.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  View.prototype.drawNotes = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    this._noteBoxes = [];
    (m.notes || []).forEach(function (n) {
      if (n.level !== m.activeLevel) return;
      var s = self.toScreen(n.x, n.y);
      var sel = self.selection.some(function (x) {
        return x.kind === 'note' && x.id === n.id;
      });
      ctx.save();
      ctx.font = '500 ' + (n.size || 13) + 'px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      var lines = String(n.text || '').split('\n');
      var wMax = 0;
      lines.forEach(function (t) { wMax = Math.max(wMax, ctx.measureText(t).width); });
      var lh = (n.size || 13) * 1.25;
      var h = lh * lines.length;
      /* A backing panel, so a note over pipework stays readable. */
      ctx.fillStyle = self.theme.bg;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(s.x - 3, s.y - 3, wMax + 6, h + 6);
      ctx.globalAlpha = 1;
      if (sel) {
        ctx.strokeStyle = self.theme.select; ctx.lineWidth = 1.5;
        ctx.strokeRect(s.x - 3, s.y - 3, wMax + 6, h + 6);
      }
      ctx.fillStyle = sel ? self.theme.select : self.detailColour(n.colour);
      lines.forEach(function (t, i) { ctx.fillText(t, s.x, s.y + i * lh); });
      ctx.restore();
      self._noteBoxes.push({ note: n, x: s.x - 3, y: s.y - 3, w: wMax + 6, h: h + 6 });
    });
  };

  /* WHERE THE LINK NODE WOULD LAND, or which one would go. Michael, 2026-08-09.
   * Green for add, red for remove — the two colours the rest of the app already
   * uses for "this will appear" and "this will go". Drawn over everything, so
   * it is never behind the line it is describing. */
  View.prototype.drawLinkNodePreview = function () {
    if (!this.addLinkNode) return;
    var hit = this.linkNodeHover;
    var ctx = this.ctx;
    var removing = (this.addLinkNode === 'remove');
    if (!hit || !hit.point) return;
    var s = this.toScreen(hit.point.x, hit.point.y);
    var r = Math.max(7, this.pickHalf() * 0.45);
    ctx.save();
    ctx.strokeStyle = removing ? this.theme.error : this.theme.ok;
    ctx.fillStyle = this.theme.bg;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (removing) {
      /* A cross: this one goes. */
      var k = r * 0.5;
      ctx.moveTo(s.x - k, s.y - k); ctx.lineTo(s.x + k, s.y + k);
      ctx.moveTo(s.x + k, s.y - k); ctx.lineTo(s.x - k, s.y + k);
    } else {
      /* A plus: one appears here. */
      ctx.moveTo(s.x - r * 0.55, s.y); ctx.lineTo(s.x + r * 0.55, s.y);
      ctx.moveTo(s.x, s.y - r * 0.55); ctx.lineTo(s.x, s.y + r * 0.55);
    }
    ctx.stroke();
    ctx.restore();
  };

  /* THE FRAGMENT IN FLIGHT, drawn as an outline that follows the pointer.
   *
   * Ghosted rather than solid: it is not on the drawing yet, and something that
   * looks placed but is not is the worst kind of preview. The ANCHOR gets a
   * ring — filled when it is over an existing node, so "this will join here" is
   * visible before the click rather than discovered after it. */
  /* TURN THE FRAGMENT A QUARTER TURN CLOCKWISE, about its anchor.
   *
   * Screen y runs DOWN while world y runs up, so "clockwise on the drawing" is
   * (x, y) -> (y, -x) in world terms. Getting that backwards is the classic
   * way to ship a rotate that turns the wrong way, so it is written out.
   *
   * Only the GEOMETRY turns. Label offsets are stored in screen pixels and
   * route bends in world coordinates; rotating those as well is a bigger job
   * than this is worth, so they are dropped rather than left pointing the wrong
   * way — a leader that has to be re-dragged is better than one that lies. */
  View.prototype.rotatePasting = function () {
    var ps = this.pasting;
    if (!ps) return;
    var frag = ps.frag, anchor = null;
    frag.nodes.forEach(function (n) { if (n.id === frag.anchor) anchor = n; });
    /* Rotate about the anchor node, or the annotation corner when there is no
     * pipework. */
    var ax = anchor ? anchor.x : (frag.anchorPt ? frag.anchorPt.x : 0);
    var ay = anchor ? anchor.y : (frag.anchorPt ? frag.anchorPt.y : 0);
    frag.nodes.forEach(function (n) {
      var rx = n.x - ax, ry = n.y - ay;
      n.x = ax + ry; n.y = ay - rx;
      if (n.labelOffset) delete n.labelOffset;
    });
    frag.pipes.forEach(function (p) {
      if (p.labelOffset) delete p.labelOffset;
      var host = (p.kind === 'pump') ? p.pump : (p.kind === 'valve') ? p.valve : null;
      if (host && host.control) { delete host.control.pts; delete host.control.mid;
                                  delete host.control.axis; delete host.control.far; }
      if (p.sensor && p.sensor.route) delete p.sensor.route;
    });
    /* Detail lines turn with everything else; notes only move (text stays
     * upright, like a pipework label offset). */
    (frag.details || []).forEach(function (d) {
      (d.pts || []).forEach(function (q) {
        var rx = q.x - ax, ry = q.y - ay;
        q.x = ax + ry; q.y = ay - rx;
      });
    });
    (frag.notes || []).forEach(function (nt) {
      var rx = nt.x - ax, ry = nt.y - ay;
      nt.x = ax + ry; nt.y = ay - rx;
    });
    ps.rot = ((ps.rot || 0) + 90) % 360;
    this.onMessage('Rotated ' + ps.rot + '°.');
  };

  View.prototype.drawPastePreview = function () {
    var ps = this.pasting;
    if (!ps || !ps.at) return;
    var frag = ps.frag, ctx = this.ctx, self = this;
    var anchor = null;
    frag.nodes.forEach(function (n) { if (n.id === frag.anchor) anchor = n; });
    /* The follow point is the anchor node for pipework, else the annotation's
     * own corner — so an annotation-only paste still shows a ghost. */
    var ax = anchor ? anchor.x : (frag.anchorPt ? frag.anchorPt.x : ps.at.x);
    var ay = anchor ? anchor.y : (frag.anchorPt ? frag.anchorPt.y : ps.at.y);
    var dx = ps.at.x - ax, dy = ps.at.y - ay;
    var at = {};
    frag.nodes.forEach(function (n) { at[n.id] = self.toScreen(n.x + dx, n.y + dy); });

    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    frag.pipes.forEach(function (p) {
      var a = at[p.a], b = at[p.b];
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    /* Detail lines ghosted as their own polyline. */
    (frag.details || []).forEach(function (d) {
      var pts = d.pts || [];
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(function (q, i) {
        var s = self.toScreen(q.x + dx, q.y + dy);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = this.theme.accent;
    frag.nodes.forEach(function (n) {
      var s = at[n.id];
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    /* Notes ghosted as their text, upright. */
    ctx.textAlign = 'left';
    (frag.notes || []).forEach(function (nt) {
      var s = self.toScreen(nt.x + dx, nt.y + dy);
      ctx.font = (nt.size || 13) + 'px system-ui, sans-serif';
      ctx.fillText(nt.text || 'Note', s.x, s.y);
    });
    ctx.restore();

    /* The anchor: hollow while it is loose, filled once it is over a node it
     * would join OR a pipe it would tee into (pipework only — annotation has
     * nothing to snap onto). */
    var s0 = self.toScreen(ax + dx, ay + dy);
    var snapped = ps.onto || ps.ontoPipe;
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = snapped ? this.theme.ok : this.theme.accent;
    ctx.fillStyle = snapped ? this.theme.ok : this.theme.bg;
    ctx.beginPath(); ctx.arc(s0.x, s0.y, 7, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  View.prototype.noteAt = function (sx, sy) {
    var bs = this._noteBoxes || [];
    for (var i = bs.length - 1; i >= 0; i--) {
      var b = bs[i];
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.note;
    }
    return null;
  };

  /* The detail line nearest a click, within a screen tolerance. Used both to
   * select one and to erase it. */
  View.prototype.detailAt = function (wx, wy, tolPx) {
    var m = this.getModel(), best = null, bestD = Infinity, self = this;
    var tol = (tolPx || 8) / this.scale;
    (m.details || []).forEach(function (d) {
      if (d.level !== m.activeLevel || !d.pts || d.pts.length < 2) return;
      for (var i = 1; i < d.pts.length; i++) {
        var r = self._distToSeg(wx, wy, d.pts[i - 1], d.pts[i]);
        if (r.dist < tol && r.dist < bestD) { bestD = r.dist; best = d; }
      }
    });
    return best;
  };

  /* The detail VERTEX nearest a click, within a screen tolerance — the "node"
   * that moves on its own. Vertices beat lines: a corner grabs before the two
   * segments meeting at it. */
  View.prototype.detailNodeAt = function (sx, sy, tolPx) {
    var m = this.getModel(), self = this, tol = tolPx || 8, best = null, bd = Infinity;
    (m.details || []).forEach(function (d) {
      if (d.level !== m.activeLevel) return;
      (d.pts || []).forEach(function (q, i) {
        var s = self.toScreen(q.x, q.y);
        var dd = Math.hypot(s.x - sx, s.y - sy);
        if (dd <= tol && dd < bd) { bd = dd; best = { detail: d, index: i, x: q.x, y: q.y }; }
      });
    });
    return best;
  };

  /* Every detail vertex EXACTLY on a given point — so dragging a shared corner
   * (or the doubled first/last point of a closed box) moves them all at once and
   * the box stays joined. Exact match, because a corner is drawn by snapping to
   * the same point, not by landing near it. */
  View.prototype.coincidentDetailVertices = function (x, y) {
    var m = this.getModel(), eps = 1e-6, out = [];
    (m.details || []).forEach(function (d) {
      if (d.level !== m.activeLevel) return;
      (d.pts || []).forEach(function (q, i) {
        if (Math.abs(q.x - x) < eps && Math.abs(q.y - y) < eps) out.push({ pts: d.pts, index: i });
      });
    });
    return out;
  };

  /* Every detail connected to `start` by a shared corner — the whole box,
   * whether it was drawn as one closed polyline or as several lines meeting at
   * their ends. A box moves as one because its lines share corners. */
  View.prototype.connectedDetails = function (start) {
    var m = this.getModel(), eps = 1e-6;
    var pool = (m.details || []).filter(function (d) { return d.level === m.activeLevel; });
    function shares(a, b) {
      for (var i = 0; i < (a.pts || []).length; i++)
        for (var j = 0; j < (b.pts || []).length; j++)
          if (Math.abs(a.pts[i].x - b.pts[j].x) < eps &&
              Math.abs(a.pts[i].y - b.pts[j].y) < eps) return true;
      return false;
    }
    var comp = [start], seen = {}; seen[start.id] = true;
    var changed = true;
    while (changed) {
      changed = false;
      pool.forEach(function (d) {
        if (seen[d.id]) return;
        if (comp.some(function (c) { return shares(c, d); })) {
          comp.push(d); seen[d.id] = true; changed = true;
        }
      });
    }
    return comp;
  };

  /* SYNC, DRAWN ONLY FOR THE SELECTION (Michael, 2026-08-08).
   *
   *   select a MASTER  a dotted line out to each device following it
   *   select a SLAVE   one dotted line back to the master
   *
   * Straight, not orthogonal, and only while selected — deliberately. A control
   * link is a permanent statement about the plant and earns its route on the
   * drawing; a sync is a relationship you check and move on from, and eight
   * pumps' worth of permanent leaders would bury the pipework. Straight lines
   * also read as "these are the same thing" rather than as another signal
   * being carried somewhere.
   *
   * A different mark again from the control link's dash and the ΔP route's
   * dot: long dash-dot, which is the drawing convention for "same as". */
  View.prototype.drawSyncLinks = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    var sel = {};
    (this.selection || []).forEach(function (x) {
      if (x.kind === 'pipe') sel[x.id] = true;
    });
    if (!Object.keys(sel).length) return;

    var pairs = [];
    m.pipes.forEach(function (p) {
      var lead = M.syncOf(p);
      if (!lead) return;
      if (sel[p.id]) pairs.push([M.pipe(m, lead), p]);        // slave selected
      else if (sel[lead]) pairs.push([M.pipe(m, lead), p]);   // master selected
    });
    if (!pairs.length) return;

    ctx.save();
    ctx.strokeStyle = this.theme.select;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([9, 3, 2, 3]);
    pairs.forEach(function (pr) {
      var a = pr[0] && M.deviceMid(m, pr[0]), b = pr[1] && M.deviceMid(m, pr[1]);
      if (!a || !b) return;
      /* Both ends must be on the level being drawn, like every other link. */
      var na = M.node(m, pr[0].a), nb = M.node(m, pr[1].a);
      if (!na || !nb || na.level !== m.activeLevel || nb.level !== m.activeLevel) return;
      var sa = self.toScreen(a.x, a.y), sb = self.toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      /* An open arrowhead at the FOLLOWER, so which way the position travels is
       * on the drawing rather than only in the panel. */
      var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
      var hx = sb.x - Math.cos(ang) * 9, hy = sb.y - Math.sin(ang) * 9;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(hx - Math.cos(ang - 0.5) * 7, hy - Math.sin(ang - 0.5) * 7);
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - Math.cos(ang + 0.5) * 7, hy - Math.sin(ang + 0.5) * 7);
      ctx.stroke();
      ctx.setLineDash([9, 3, 2, 3]);
    });
    ctx.restore();
  };

  View.prototype.drawControlLinks = function () {
    if (!this.showControl) return;
    var m = this.getModel(), ctx = this.ctx, self = this;

    m.pipes.forEach(function (p) {
      var target = M.pipe(m, (M.controlOf(p) || {}).equip);
      if (!target) return;
      /* THE ROUTE FOR THIS FLOOR. Same-level links are unchanged; a link that
       * changes floor comes back as the LEG belonging to the level being drawn,
       * and as null on any floor it has nothing to do with. */
      var r = M.controlRoute(m, p, m.activeLevel);
      if (!r) return;
      var span = M.controlSpan(m, p);

      var pts = r.points.map(function (q) { return self.toScreen(q.x, q.y); });
      ctx.save();
      ctx.strokeStyle = self.theme.ok;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);

      /* A small ring at the equipment end says which way the signal runs. On
       * the device's floor of a crossing link that end IS the riser, and the
       * riser draws its own marker below — so the ring is skipped there rather
       * than drawn inside it. */
      var end = pts[pts.length - 1];
      var endIsRiser = span && m.activeLevel === span.device;
      if (!endIsRiser) {
        ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();

      /* ---- THE RISER NODE, where the link changes floor.
       *
       * Drawn on BOTH floors at the same plan position, which is what makes the
       * two halves read as one link. The ring echoes a pipework riser — same
       * shape, control colour — and the label says where the signal is going,
       * because "up to what?" is the question the marker raises. */
      if (span) {
        var rs = self.toScreen(span.riser.x, span.riser.y);
        var onDeviceFloor = (m.activeLevel === span.device);
        /* The far end's name, and the floor it is on. */
        var far = onDeviceFloor ? span.targetPipe : p;
        var farLevel = M.level(m, onDeviceFloor ? span.target : span.device);
        var going = (far.tag || far.id) +
                    (farLevel ? '  (' + (farLevel.name || farLevel.id) + ')' : '');

        ctx.save();
        ctx.strokeStyle = self.theme.ok;
        ctx.fillStyle = self.theme.bg;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(rs.x, rs.y, 8, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        /* A dot in the middle: this is a point on the plan, not a hole. */
        ctx.fillStyle = self.theme.ok;
        ctx.beginPath(); ctx.arc(rs.x, rs.y, 2.5, 0, Math.PI * 2); ctx.fill();

        var size = self.labelSize();
        ctx.font = size + 'px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var txt = '↑ ' + going;
        var tw = ctx.measureText(txt).width;
        ctx.fillStyle = self.theme.bg;
        ctx.globalAlpha = 0.82;
        ctx.fillRect(rs.x + 11, rs.y - size * 0.7, tw + 6, size * 1.4);
        ctx.globalAlpha = 1;
        ctx.fillStyle = self.theme.ok;
        ctx.fillText(txt, rs.x + 14, rs.y);
        ctx.restore();

        /* DRAGGABLE WHILE ARRANGING — the `view` tool, which is what the
         * ANNOTATION ribbon selects. Registered whichever floor you are on, so
         * it can be placed from either end of the link. */
        if (self.tool === 'view') {
          var hh = self.pickHalf();
          self._riserHandles.push({
            pipe: p, x: rs.x - hh, y: rs.y - hh, w: hh * 2, h: hh * 2
          });
        }
      }

      if (self.tool === 'view' && pts.length > 2) {
        /* One handle per bend; both slide the same mid line, which is what
         * makes the route stay orthogonal however it is dragged. */
        var bh = self.pickHalf();
        /* The leg being drawn, so a bend dragged here moves THIS floor's line. */
        var legHolder = self.controlLegHolder(p) ||
                        { host: (p.kind === 'pump') ? p.pump : p.valve, key: 'control' };
        for (var j = 1; j < pts.length - 1; j++) {
          self.labelHandle(pts[j].x - 5, pts[j].y - 5, 10, 10);
          self._controlHandles.push({
            pipe: p, host: legHolder.host, key: legHolder.key,
            axis: r.axis, from: r.from, to: r.to, route: r,
            vertex: j - 1,
            x: pts[j].x - bh, y: pts[j].y - bh, w: bh * 2, h: bh * 2
          });
        }
      }
    });
  };

  /* THE NEAREST handle, not the last one drawn.
   *
   * Handles overlap — a sensor's tapping can sit under a control link's bend —
   * and "whichever was pushed last" made which one you got depend on draw
   * order, which is not something the user can see. Nearest centre is the
   * answer they would predict from where they clicked. */
  /* A world point snapped to the grid, unless Shift says otherwise. Used where
   * something is being POSITIONED by hand rather than derived — a control link
   * waypoint — so it lines up with the drawing it sits on. */
  View.prototype.snapWorld = function (w) {
    var m = this.getModel();
    var g = m.settings.grid;
    if (this.freeform() || !g || !g.snap || !(g.minor > 0)) return { x: w.x, y: w.y };
    return { x: Math.round(w.x / g.minor) * g.minor,
             y: Math.round(w.y / g.minor) * g.minor };
  };

  /* THE POINT ON A CONTROL OR ΔP ROUTE NEAREST A CLICK.
   *
   * Michael, 2026-08-08: "User should be able to click on any point on any link
   * (with snap) to add a node there." Adding a bend at the longest segment's
   * midpoint is a reasonable default, but the useful gesture is putting one
   * exactly where you are pointing.
   *
   * Returns what is needed to insert it: the route's owner, which segment was
   * hit, and the snapped world point. */
  /* WHICH OBJECT HOLDS THE ROUTING for the leg of a control link drawn on the
   * floor being looked at.
   *
   * A link that changes floor has TWO legs and they route independently: the
   * near one on `control` itself, the far one on `control.far`. Everything that
   * edits a route — adding a bend, removing one, dragging one — wrote to the
   * NEAR leg whatever floor you were on, so working on the upper floor put the
   * node on the lower one. Michael, 2026-08-09: "creating link node on upper
   * level creates node on lower levels instead."
   *
   * Returns { host, key } for `host[key].pts`. */
  View.prototype.controlLegHolder = function (p) {
    var m = this.getModel();
    var host = (p.kind === 'pump') ? p.pump : p.valve;
    var c = M.controlOf(p);
    if (!host || !c) return null;
    var span = M.controlSpan(m, p);
    if (span && m.activeLevel === span.target) {
      if (!c.far) c.far = {};
      return { host: c, key: 'far' };
    }
    return { host: host, key: 'control' };
  };

  View.prototype.routePointAt = function (wx, wy, tolPx) {
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    /* THE SAME TARGET SIZE AS EVERY OTHER ANNOTATION HANDLE. It was a flat
     * 12 px, which is why placing a link node was "hard, especially between
     * PWP-01 and DP-02" — Michael, 2026-08-09. */
    var tol = this.pxToM(tolPx || this.pickHalf());
    function consider(p, host, key, route) {
      if (!route) return;
      for (var i = 1; i < route.points.length; i++) {
        var r = self._distToSeg(wx, wy, route.points[i - 1], route.points[i]);
        if (r.dist < tol && r.dist < bestD) {
          bestD = r.dist;
          best = { pipe: p, host: host, key: key, route: route, seg: i,
                   point: self.snapWorld(r.point) };
        }
      }
    }
    m.pipes.forEach(function (p) {
      if (p.kind === 'sensor' && p.sensor) {
        var sn = M.node(m, p.a);
        if (sn && sn.level === m.activeLevel) {
          consider(p, p.sensor, 'route', M.sensorRoute(m, p));
        }
      }
      var c = M.controlOf(p);
      if (c) {
        /* THROUGH THE LEVEL-AWARE ROUTE, and into the leg that belongs to this
         * floor. `controlRoute` does the floor filtering; `controlLegHolder`
         * says which of the two legs a bend placed here belongs to. */
        var lg = self.controlLegHolder(p);
        if (lg) consider(p, lg.host, lg.key, M.controlRoute(m, p, m.activeLevel));
      }
    });
    return best;
  };

  /* An EXISTING bend under the pointer, for removing one. Only the interior
   * points are candidates: the two ends are the devices themselves. */
  View.prototype.routeVertexAt = function (wx, wy, tolPx) {
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    var tol = this.pxToM(tolPx || this.pickHalf());
    function consider(p, host, key, route) {
      if (!route || !route.points || route.points.length < 3) return;
      for (var i = 1; i < route.points.length - 1; i++) {
        var q = route.points[i];
        var d = Math.hypot(wx - q.x, wy - q.y);
        if (d < tol && d < bestD) {
          bestD = d;
          best = { pipe: p, host: host, key: key, route: route,
                   vertex: i - 1, point: { x: q.x, y: q.y } };
        }
      }
    }
    m.pipes.forEach(function (p) {
      if (p.kind === 'sensor' && p.sensor) {
        var sn = M.node(m, p.a);
        if (sn && sn.level === m.activeLevel) {
          consider(p, p.sensor, 'route', M.sensorRoute(m, p));
        }
      }
      var c = M.controlOf(p);
      if (c) {
        /* THROUGH THE LEVEL-AWARE ROUTE, and into the leg that belongs to this
         * floor. `controlRoute` does the floor filtering; `controlLegHolder`
         * says which of the two legs a bend placed here belongs to. */
        var lg = self.controlLegHolder(p);
        if (lg) consider(p, lg.host, lg.key, M.controlRoute(m, p, m.activeLevel));
      }
    });
    return best;
  };

  /* Take a bend back out. The route falls back to its plain Z when the last
   * hand-placed point goes, which is where it started. */
  View.prototype.removeRouteNodeAt = function (hit) {
    if (!hit) return false;
    var holder = hit.host[hit.key] || (hit.host[hit.key] = {});
    var pts = M.routeWaypoints(hit.route);
    if (hit.vertex < 0 || hit.vertex >= pts.length) return false;
    pts.splice(hit.vertex, 1);
    if (pts.length) holder.pts = pts;
    else { delete holder.pts; delete holder.axis; delete holder.mid; }
    return true;
  };

  /* Put a bend exactly where the click landed. */
  View.prototype.addRouteNodeAt = function (hit) {
    if (!hit) return false;
    var holder = hit.host[hit.key] || (hit.host[hit.key] = {});
    var pts = M.routeWaypoints(hit.route);
    /* `seg` indexes into `points`, whose interior is `pts` offset by one. */
    pts.splice(hit.seg - 1, 0, { x: hit.point.x, y: hit.point.y });
    holder.pts = pts;
    delete holder.axis; delete holder.mid;
    return true;
  };

  /* The control-link riser under the pointer, if any. Registered by
   * `drawControlLinks` while the `view` tool is active — the same rule the bend
   * handles follow, because both are arranging rather than editing. */
  /* WHERE AN IN-LINE DEVICE MAY SLIDE TO, worked out once when the drag starts.
   *
   * The direction is the device's OWN axis — the line through its two nodes —
   * because that is the run it was spliced into. The travel is bounded by the
   * neighbour at each end: slide far enough and the device would pass through
   * the node it is joined to and turn its neighbour pipe inside out, which is a
   * negative length and a nonsense drawing.
   *
   * Both limits are measured by PROJECTING the neighbour onto the axis, so a
   * run that bends at the device still gives a sane answer rather than none.
   * A margin of one device length is left at each end so the device cannot be
   * driven exactly onto a tee.
   *
   * Returns null when there is nothing to slide along — a device with no
   * neighbours, or one whose two nodes are on top of each other. */
  View.prototype.deviceSlideAxis = function (dev) {
    var m = this.getModel();
    var a = M.node(m, dev.a), b = M.node(m, dev.b);
    if (!a || !b) return null;
    var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
    var L = Math.hypot(wb.x - wa.x, wb.y - wa.y);
    if (!(L > 1e-9)) return null;
    var ux = (wb.x - wa.x) / L, uy = (wb.y - wa.y) / L;

    /* The far end of whatever pipe is attached at each of the device's nodes. */
    function beyond(nodeId) {
      var best = null;
      M.pipesAt(m, nodeId).forEach(function (q) {
        if (q.id === dev.id) return;
        var other = M.node(m, q.a === nodeId ? q.b : q.a);
        if (!other) return;
        var wo = M.worldXY(m, other);
        /* Distance along the axis from the device's `a` node, signed. */
        var t = (wo.x - wa.x) * ux + (wo.y - wa.y) * uy;
        if (best === null || Math.abs(t) < Math.abs(best)) best = t;
      });
      return best;
    }
    var back = beyond(dev.a);      // negative side, normally
    var fwd = beyond(dev.b);       // positive side, normally
    var margin = DEVICE_LEN;
    /* `t` in the drag is an OFFSET from where the device already is, so the
     * limits are relative too. Unbounded on a side with no neighbour. */
    var min = (back === null) ? -Infinity : Math.min(0, back + margin);
    var max = (fwd === null) ? Infinity : Math.max(0, fwd - L - margin);
    return { ux: ux, uy: uy, min: min, max: max, length: L };
  };

  /* Half-width of an annotation handle, in SCREEN pixels. */
  View.prototype.pickHalf = function () {
    var m = this.getModel();
    var g = (m.settings.grid && m.settings.grid.minor) || 0.5;
    var k = Number(m.settings.pickGrid);
    if (!isFinite(k) || k <= 0) k = PICK_GRID_DEFAULT;
    k = Math.min(PICK_GRID_MAX, k);
    /* THE FLOOR SCALES WITH THE SETTING TOO, and it has to.
     *
     * On a data centre at 8 px/m, half of 0.5 grid is under two pixels — the
     * floor governs at every zoom anyone actually works at, so a setting that
     * only moved the grid term would appear to do nothing. Scaling both means
     * turning it up is felt immediately, and zooming in still grows the target
     * on its own. */
    return Math.max(PICK_FLOOR_PX * (k / PICK_GRID_DEFAULT), k * g * this.scale / 2);
  };

  View.prototype.controlRiserAt = function (sx, sy) {
    var hs = this._riserHandles || [];
    for (var i = hs.length - 1; i >= 0; i--) {
      var h = hs[i];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h;
    }
    return null;
  };

  View.prototype.controlHandleAt = function (sx, sy) {
    var hs = this._controlHandles || [], best = null, bestD = Infinity;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (sx < h.x || sx > h.x + h.w || sy < h.y || sy > h.y + h.h) continue;
      var d = Math.hypot(sx - (h.x + h.w / 2), sy - (h.y + h.h / 2));
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  };

  FD.View = View;
})(window.FD = window.FD || {});
