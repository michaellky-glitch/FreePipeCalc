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
      if (p.kind !== 'pump' && p.kind !== 'valve' && p.kind !== 'equip') return;
      var a = M.node(m, p.a), b = M.node(m, p.b);
      if (!a || !b || a.level !== m.activeLevel || b.level !== m.activeLevel) return;
      var wa = M.worldXY(m, a), wb = M.worldXY(m, b);
      var mx = (wa.x + wb.x) / 2, my = (wa.y + wb.y) / 2;
      var d = Math.hypot(mx - wx, my - wy);
      if (d < rad && d < bestD) { bestD = d; best = p; }
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
    if (p.kind === 'pump') p.pump.mode = off ? 'auto' : 'off';
    else if (off) delete p.equip.off; else p.equip.off = true;
    return !off ? true : false;
  };

  /* A riser marker sits directly on top of the node it attaches to, so a click
   * on the marker selects that NODE and the riser column is unreachable. The
   * fix is a dedicated select handle — a small triangle drawn beside the marker
   * — hit-tested in SCREEN space and given priority over the node underneath. */
  var RISER_HANDLE_DX = 16;      // screen px, right of the marker centre
  View.prototype.riserHandleAt = function (sx, sy) {
    var m = this.getModel(), self = this, best = null, bestD = Infinity;
    m.risers.forEach(function (r) {
      var s = self.toScreen(r.x, r.y);
      var d = Math.hypot(sx - (s.x + RISER_HANDLE_DX), sy - s.y);
      if (d < 10 && d < bestD) { bestD = d; best = r; }
    });
    return best;
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

  /* Constrain a point to 15° increments from an anchor (Shift disables). */
  View.prototype.angleSnap = function (ax, ay, wx, wy) {
    if (this.shiftDown) return { x: wx, y: wy };
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
    var touched = {};
    this.selection.forEach(function (s) {
      if (s.kind === 'pipe') {
        var p = M.pipe(m, s.id);
        if (p) { touched[p.a] = true; touched[p.b] = true; }
        M.removePipe(m, s.id);
      } else if (s.kind === 'riser') M.removeRiser(m, s.id);
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

  View.prototype.changed = function () {
    this.onChange();
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
      var r = c.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var w = self.toWorld(sx, sy);
      var m0 = self.getModel();

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
          self.calibrating.points.push({ x: w.x, y: w.y });
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
      if (self.controlPick) {
        var pickHit = self.deviceAt(w.x, w.y) || (self.pipeAt(w.x, w.y) || {}).pipe;
        var src = M.pipe(m0, self.controlPick.pipeId);
        self.controlPick = null;
        if (pickHit && pickHit.kind === 'equip' && src) {
          self.onBeforeEdit();
          M.setControl(m0, src, pickHit.id);
          self.onMessage('Control linked to ' + (pickHit.tag || pickHit.id) + '.');
        } else {
          self.onMessage('Nothing linked — pick a piece of equipment.', 'error');
        }
        self.changed();
        return;
      }

      if (self.tool === 'view') {
        var ch = self.controlHandleAt(sx, sy);
        if (ch) {
          self.dragControl = { pipe: ch.pipe, axis: ch.axis };
          c.setPointerCapture(e.pointerId);
          return;
        }
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
          var loKey = (lab.kind === 'warn' || lab.kind === 'box') ? lab.kind : null;
          var lo = M.labelOffset(lab.obj, loKey);
          self.dragLabel = { target: lab.obj, sx: sx, sy: sy, key: loKey,
                             ox: lo.dx, oy: lo.dy,
                             ax: lab.x - lo.dx, ay: lab.y - lo.dy };
          /* A value box belongs to its entity, so grabbing one selects THAT —
           * `kind: 'box'` would select nothing and empty the properties panel
           * at the moment you are using it. */
          var selKind = lab.kind === 'box'
            ? (lab.obj.a !== undefined ? 'pipe' : 'node')   // only a pipe has ends
            : lab.kind;
          self.selection = [{ kind: selKind, id: lab.obj.id }];
          c.setPointerCapture(e.pointerId);
          self.changed();
          return;
        }
        /* No label under the pointer: fall through to ordinary selection rather
         * than clearing it.
         *
         * VIEW is where the "Show on drawing" checkboxes live, but a click here
         * used to deselect — so the only way to reach a pump's display options
         * was to select it in EDIT and then switch modes. Selecting in the mode
         * that owns the controls is the whole point. Dragging a NODE is still
         * not offered here; VIEW arranges the drawing, it does not move
         * geometry. */
        var vd = self.deviceAt(w.x, w.y);
        if (vd) { self.selection = [{ kind: 'pipe', id: vd.id }]; self.changed(); return; }
        var vn = self.nodeAt(w.x, w.y);
        if (vn) { self.selection = [{ kind: 'node', id: vn.id }]; self.changed(); return; }
        var vp = self.pipeAt(w.x, w.y);
        if (vp) { self.selection = [{ kind: 'pipe', id: vp.pipe.id }]; self.changed(); return; }
        var vr = self.riserAt(w.x, w.y);
        self.selection = vr ? [{ kind: 'riser', id: vr.id }] : [];
        self.changed();
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
      if (self.tool === 'pipe') { self.drawClick(w); return; }
      if (self.tool === 'source' || self.tool === 'demand') { self.deviceClick(w); return; }
      if (self.tool === 'pump') { self.pumpClick(w); return; }
      if (self.tool === 'valve') { self.valveClick(w); return; }
      if (self.tool === 'equip') { self.equipClick(w); return; }
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
        self.changed();
        return;
      }

      var s = self.snap(w.x, w.y);
      /* Device before node: its glyph sits between two nodes only a few hundred
       * millimetres apart, so a click in the middle would otherwise always grab
       * an end node and shear the device instead of moving it. */
      var dev = self.deviceAt(w.x, w.y);
      var n = dev ? null : self.nodeAt(w.x, w.y);
      if (dev) {
        var mSel = self.getModel();
        var da = M.node(mSel, dev.a), db = M.node(mSel, dev.b);
        self.selection = [{ kind: 'pipe', id: dev.id }];
        self.dragDevice = {
          pipe: dev, startX: w.x, startY: w.y,
          ax: da.x, ay: da.y, bx: db.x, by: db.y
        };
        c.setPointerCapture(e.pointerId);
        self.changed();
        return;
      }
      if (n) {
        self.selection = [{ kind: 'node', id: n.id }];
        self.dragNode = { id: n.id, startX: w.x, startY: w.y };
      } else {
        var hit = self.pipeAt(w.x, w.y);
        if (hit) {
          self.selection = [{ kind: 'pipe', id: hit.pipe.id }];
        } else {
          /* Riser last: its marker sits on top of the node it attaches to, so
           * testing it first would make the node underneath unreachable. */
          var rs = self.riserAt(w.x, w.y);
          if (rs) self.selection = [{ kind: 'riser', id: rs.id }];
          else { self.selection = []; self.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; }
        }
      }
      c.setPointerCapture(e.pointerId);
      self.changed();
    });

    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var w = self.toWorld(sx, sy);
      self.cursor = w;

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
      if (self.dragControl) {
        /* Slide the whole middle segment. `mid` is a WORLD coordinate, so the
         * route stays where it was put through zoom and pan. Presentation
         * only — nothing here reaches the calculation. */
        var dc = self.dragControl;
        var host = (dc.pipe.kind === 'pump') ? dc.pipe.pump : dc.pipe.valve;
        if (host && host.control) {
          host.control.mid = (dc.axis === 'h') ? w.x : w.y;
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
        if (g && g.snap && !self.shiftDown) {
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
        if (gA && gA.snap && !self.shiftDown) {
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
         * its length and orientation. Snapping is applied to the MIDPOINT and
         * the same shift is given to both ends — snapping each end separately
         * would stretch or rotate the device as the two ends landed on
         * different grid lines. */
        var dd = self.dragDevice;
        var mdl = self.getModel();
        var lvd = M.level(mdl, mdl.activeLevel);
        var dx = w.x - dd.startX, dy = w.y - dd.startY;
        var midX = (dd.ax + dd.bx) / 2 + dx, midY = (dd.ay + dd.by) / 2 + dy;
        var snapped = self.snap(midX + lvd.dx, midY + lvd.dy);
        dx += (snapped.x - lvd.dx) - midX;
        dy += (snapped.y - lvd.dy) - midY;
        var na = M.node(mdl, dd.pipe.a), nb = M.node(mdl, dd.pipe.b);
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
      if (self.tool === 'pump' || self.tool === 'valve' || self.tool === 'equip') {
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
      if (self.dragTrace) { self.dragTrace = null; self.changed(); return; }
      if (self.dragControl) { self.dragControl = null; self.changed(); return; }
      if (self.dragLabel) { self.dragLabel = null; self.changed(); return; }
      if (self.dragAlign) { self.dragAlign = null; self.changed(); return; }
      if (self.dragDevice) { self.dragDevice = null; self.changed(); return; }
      if (self.dragNode) {
        var dropped = self.dragNode.id;
        self.dragNode = null;
        self.mergeDroppedNode(dropped);
        self.changed();
        return;
      }
      if (self.marquee) {
        self.applyMarquee();
        self.marquee = null;
        self.changed();
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
        if (self.controlPick) { self.controlPick = null; self.onMessage('Cancelled.'); self.render(); }
        else if (self.calibrating) self.cancelCalibration();
        else if (self.lengthEntry) { self.lengthEntry = null; self.render(); }
        else if (self.draft) self.endDraft();
        /* A pinned probe is dropped before the tool is, so Escape clears the
         * reading you are finished with rather than the whole mode. */
        else if (self.probe) { self.probe = null; self.render(); }
        else { self.setTool('edit'); }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (self.selection.length) { e.preventDefault(); self.deleteSelection(); }
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'Shift') self.shiftDown = false;
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
    if (!target) return;

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
    this.canvas.style.cursor = (tool === 'edit') ? 'default'
                            : (tool === 'view' || tool === 'trace' || tool === 'align') ? 'move'
                            : 'crosshair';
    if (this.onToolChange) this.onToolChange();
    this.onChange();
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
  var TAG_PREFIX = { source: 'SRC', demand: 'OF', pump: 'PMP', equip: 'AHU' };

  View.prototype.nextTag = function (kind) {
    var m = this.getModel();
    var prefix = TAG_PREFIX[kind];
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

  View.prototype.equipClick = function (w) {
    var eq = this.insertInline(w, 'equip', {
      equip: { qRated: 0.02, pdRated: 200000, qOut: 0.02 }
    }, 'equipment');
    if (eq && !eq.tag) { eq.tag = this.nextTag('equip'); this.changed(); }
  };

  View.prototype.valveClick = function (w) {
    var m = this.getModel();
    var hit = this.pipeAt(w.x, w.y, DEVICE_SNAP_PX);
    var bore = hit ? M.pipeBore(m, hit.pipe) * 1000 : 50;
    var type = this.valveType || 'gate';
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
      /* The ACTIVE level is authoritative: every other floor already on this
       * column slides so its attachment lands underneath the point just
       * clicked. Moving a level is an OFFSET change only — no geometry and no
       * pipe length is touched (spec §7.1). */
      var result = alignColumn(m, col, wn);
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

    var span = scale.max - scale.min;
    var at = function (v) { return span > 1e-12 ? (v - scale.min) / span : 0; };
    var ca = vizColour(at(pa)), cb = vizColour(at(pb));
    var mid = vizColour(at((pa + pb) / 2));

    if (Math.abs(sa.x - sb.x) < 0.5 && Math.abs(sa.y - sb.y) < 0.5) {
      return { stroke: ca, mid: mid };
    }
    var g = this.ctx.createLinearGradient(sa.x, sa.y, sb.x, sb.y);
    if (p.kind === 'pump' || p.kind === 'valve' || p.kind === 'equip') {
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
      if (p.kind === 'pump' || p.kind === 'valve' || p.kind === 'equip') {
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
        if (q !== undefined && Math.abs(q) > 1e-9) self.drawArrow(sa, sb, q, colour);
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
  View.prototype.drawRisers = function () {
    var m = this.getModel(), ctx = this.ctx, self = this;
    m.risers.forEach(function (r) {
      var here = r.attachments.some(function (a) { return a.level === m.activeLevel; });
      var s = self.toScreen(r.x, r.y);
      var sel = self.selection.some(function (x) {
        return x.kind === 'riser' && x.id === r.id;
      });
      ctx.save();
      if (sel) {
        ctx.strokeStyle = self.theme.select;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.stroke();
      }
      if (here) {
        ctx.strokeStyle = self.theme.flow;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.strokeStyle = self.theme.mute;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();

      /* Select handle: a small triangle beside the marker. The marker sits on
       * the attached node, so this gives a spot to click that selects the
       * COLUMN (to size it) rather than the node underneath. */
      ctx.save();
      var hx = s.x + RISER_HANDLE_DX, hy = s.y;
      ctx.fillStyle = sel ? self.theme.select : (here ? self.theme.flow : self.theme.mute);
      ctx.beginPath();
      ctx.moveTo(hx - 4, hy - 5);
      ctx.lineTo(hx + 4, hy);
      ctx.lineTo(hx - 4, hy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (m.settings.annotate.fitType) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = here ? self.theme.flow : self.theme.mute;
        ctx.fillText('R' + r.attachments.length, s.x, s.y - 13);
      }
    });
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
      /* Check valve: the standard flapper — a seat bar across the pipe with a
       * hinged disc swinging onto it, per the symbol Michael supplied. It is
       * not a bowtie, and drawing it as one made a check valve look like an
       * isolating valve.
       *
       * Drawn LARGER than the bowtie valves on purpose: the whole point of the
       * symbol is that it states a direction, and at bowtie size the flapper
       * was too small to read which way it swings. */
      var cw = w * 1.6, ch = h * 1.5;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cw, -ch - 2); ctx.lineTo(cw, ch + 2);        // seat
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-cw + 1, -ch - 2); ctx.lineTo(-cw + 1, ch + 2); // hinge post
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-cw + 1, -ch);  ctx.lineTo(cw - 1, ch);      // flapper
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-cw + 1, -ch, 3.2, 0, Math.PI * 2);             // hinge pin
      ctx.fillStyle = colour; ctx.fill();
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
    if (label) ctx.fillText(label, mx, my - 15);
  };

  /* Equipment glyph: a square box straddling the pipe — a coil, chiller,
   * heat exchanger, anything with a rated flow and pressure drop. */
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
    if (p.tag) {
      var ctx = this.ctx;
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.theme.text;
      var tx = x + off.dx, ty = y - 16 + off.dy;
      ctx.fillText(p.tag, tx, ty);
      var w = ctx.measureText(p.tag).width;
      this.registerLabel('pipe', p, tx - w / 2 - 3, ty - size, w + 6, size + 5);
      if (this.tool === 'view') this.labelHandle(tx - w / 2 - 3, ty - size, w + 6, size + 5);
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

    ctx.font = (size - 1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.mute;
    ctx.fillText(text, x, y);

    var w = ctx.measureText(text).width;
    this.registerLabel('node', n, x - w / 2 - 3, y - size, w + 6, size + 6);
    if (this.tool === 'view') this.labelHandle(x - w / 2 - 3, y - size, w + 6, size + 6);

    this.drawDeviceBox(n, s);
  };

  View.prototype.labelSize = function () {
    var p = this.getModel().settings.presentation || {};
    return p.labelSize || 11;
  };

  /* Faint outline round a draggable label, so VIEW mode shows what can be
   * grabbed without cluttering the drawing in every other mode. */
  View.prototype.labelHandle = function (x, y, w, h) {
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme.select;
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
          var pOff = obj.pump.mode === 'off';
          var pq = Math.abs((res && res.flow[obj.id]) || 0);
          var pSp = M.pumpSpeed(obj);
          var hNow = pOff ? 0
            : (m.settings.calcMode === 'simulation' && obj.pump.curve)
              ? FD.pumps.head(M.pumpCurve(obj), pq)
              : (obj.pump.head || 0) * pSp * pSp;
          lines.push('H ' + FD.units.fmtPressure(
            FD.units.headToPaWith(hNow, m.settings.fluid.density), d.pressure, true));
          /* A modulating pump reads its speed on the plate. Only when it is
           * off full — "100%" on every pump is clutter. */
          if (!pOff && pSp < 0.999) lines.push('N ' + Math.round(pSp * 100) + '%');
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
          lines.push(tl.tIn.toFixed(1) + ' → ' + tl.tOut.toFixed(1) + '\u00b0C');
        }
        if (flags.dT) lines.push('ΔT ' + (tl.dT >= 0 ? '+' : '') + tl.dT.toFixed(1) + ' K');
        if (flags.duty) {
          lines.push('Q ' + (tl.qW >= 0 ? '+' : '') + (tl.qW / 1000).toFixed(1) + ' kW');
          if (tl.limit) lines.push('(' + tl.limit + ')');
        }
      }
      if (flags.setpoint && obj.equip && obj.equip.equipType === 'source' &&
          obj.equip.tSet !== undefined && obj.equip.tSet !== null) {
        lines.push('SP ' + Number(obj.equip.tSet).toFixed(1) + '\u00b0C');
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
      var a = this.toScreen(pts[0].x, pts[0].y);
      var b = this.toScreen(this.cursor.x, this.cursor.y);
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      var span = Math.hypot(this.cursor.x - pts[0].x, this.cursor.y - pts[0].y);
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
    var device = (p.kind === 'pump' || p.kind === 'valve' || p.kind === 'equip');

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
  View.prototype.drawControlLinks = function () {
    this._controlHandles = [];
    if (!this.showControl) return;
    var m = this.getModel(), ctx = this.ctx, self = this;

    m.pipes.forEach(function (p) {
      var r = M.controlRoute(m, p);
      if (!r) return;
      var target = M.pipe(m, M.controlOf(p).equip);
      if (!target) return;
      /* Both ends must be on the level being drawn, or the route would cut
       * across a floor it does not belong to. */
      var na = M.node(m, p.a), nb = M.node(m, target.a);
      if (!na || !nb || na.level !== m.activeLevel || nb.level !== m.activeLevel) return;

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

      /* A small ring at the equipment end says which way the signal runs. */
      var end = pts[pts.length - 1];
      ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      if (self.tool === 'view' && pts.length > 2) {
        /* One handle per bend; both slide the same mid line, which is what
         * makes the route stay orthogonal however it is dragged. */
        for (var j = 1; j < pts.length - 1; j++) {
          self.labelHandle(pts[j].x - 5, pts[j].y - 5, 10, 10);
          self._controlHandles.push({
            pipe: p, axis: r.axis,
            x: pts[j].x - 6, y: pts[j].y - 6, w: 12, h: 12
          });
        }
      }
    });
  };

  View.prototype.controlHandleAt = function (sx, sy) {
    var hs = this._controlHandles || [];
    for (var i = hs.length - 1; i >= 0; i--) {
      var h = hs[i];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h;
    }
    return null;
  };

  FD.View = View;
})(window.FD = window.FD || {});
