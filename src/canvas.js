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
  var ANGLE_SNAP = 15;      // degrees (§5)

  /* Risers use much larger radii than drawing does. A riser belongs on existing
   * pipework; at the 10 px drawing tolerance most clicks fell through to the
   * grid instead, planting the column next to the pipe rather than on it. */
  var RISER_NODE_PX = 24;
  var RISER_PIPE_PX = 20;

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
    this.selection = [];             // [{kind,id}]
    this.marquee = null;
    this.conflict = null;          // pipe ids highlighted red by a geometry conflict
    this.dragTrace = null;         // in-progress trace move/scale
    this.calibrating = null;       // {points:[]} while picking two scale points
    this.results = null;             // last solve, for colouring & tooltips
    this.drawSize = null;            // size badge during DRAW
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
    this.selection.forEach(function (s) {
      if (s.kind === 'pipe') M.removePipe(m, s.id);
      else M.removeNode(m, s.id);
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
      if (self.tool === 'layout') {
        var lab = self.labelAt(sx, sy);
        if (lab) {
          self.dragLabel = { target: lab.obj, sx: sx, sy: sy,
                             ox: M.labelOffset(lab.obj).dx,
                             oy: M.labelOffset(lab.obj).dy };
          self.selection = [{ kind: lab.kind, id: lab.obj.id }];
          c.setPointerCapture(e.pointerId);
          self.changed();
        } else {
          self.selection = [];
          self.changed();
        }
        return;
      }
      if (self.tool === 'pipe') { self.drawClick(w); return; }
      if (self.tool === 'source' || self.tool === 'demand') { self.deviceClick(w); return; }
      if (self.tool === 'pump') { self.pumpClick(w); return; }
      if (self.tool === 'valve') { self.valveClick(w); return; }
      if (self.tool === 'equip') { self.equipClick(w); return; }
      if (self.tool === 'riser') { self.riserClick(w); return; }

      // EDIT: select, or start a marquee
      var s = self.snap(w.x, w.y);
      var n = self.nodeAt(w.x, w.y);
      if (n) {
        self.selection = [{ kind: 'node', id: n.id }];
        self.dragNode = { id: n.id, startX: w.x, startY: w.y };
      } else {
        var hit = self.pipeAt(w.x, w.y);
        if (hit) self.selection = [{ kind: 'pipe', id: hit.pipe.id }];
        else { self.selection = []; self.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; }
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
      if (self.dragLabel) {
        var d = self.dragLabel;
        M.setLabelOffset(d.target, d.ox + (sx - d.sx), d.oy + (sy - d.sy));
        self.render();
        return;
      }
      if (self.marquee) { self.marquee.x1 = w.x; self.marquee.y1 = w.y; self.render(); return; }
      if (self.dragNode) {
        var m = self.getModel();
        var n = M.node(m, self.dragNode.id);
        var lv = M.level(m, m.activeLevel);
        var s = self.snap(w.x, w.y);
        n.x = s.x - lv.dx; n.y = s.y - lv.dy;
        self.render();
        return;
      }

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
      if (self.dragLabel) { self.dragLabel = null; self.changed(); return; }
      if (self.dragNode) { self.dragNode = null; self.changed(); return; }
      if (self.marquee) {
        self.applyMarquee();
        self.marquee = null;
        self.changed();
      }
    });

    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Shift') self.shiftDown = true;
      if (e.key === 'Escape') {
        if (self.calibrating) self.cancelCalibration();
        else if (self.draft) self.endDraft();
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
    this.tool = tool;
    this.calibrating = null;
    this.canvas.style.cursor = (tool === 'edit') ? 'default'
                            : (tool === 'layout' || tool === 'trace') ? 'move'
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
    this.render();
    this.onChange();
  };

  View.prototype.deviceClick = function (w) {
    var m = this.getModel();
    var s = this.snap(w.x, w.y);
    var node = this.nodeForSnap(s);
    if (this.tool === 'source') M.setSource(m, node.id);
    else M.setDemand(m, node.id, 0.001, 100000);   // 1 L/s @ 100 kPa, editable
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
    var hit = this.pipeAt(w.x, w.y, SNAP_PX * 2);
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
    if (len < 0.5) {
      this.onMessage && this.onMessage('Pipe is too short to hold a ' + label + '.', 'error');
      return null;
    }

    var ux = (wb.x - wa.x) / len, uy = (wb.y - wa.y) / len;
    var half = Math.min(0.35, len / 4);
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
    this.insertInline(w, 'pump', { pump: { mode: 'auto', head: 20, flow: 0 } }, 'pump');
  };

  View.prototype.equipClick = function (w) {
    this.insertInline(w, 'equip', {
      equip: { qRated: 0.02, pdRated: 200000, qOut: 0.02 }
    }, 'equipment');
  };

  View.prototype.valveClick = function (w) {
    var m = this.getModel();
    var hit = this.pipeAt(w.x, w.y, SNAP_PX * 2);
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
      M.riserPipes(m);
      this.onMessage && this.onMessage(ambiguous
        ? 'New riser column started. Several existing columns are free on this ' +
          'level, so click directly on a riser stub to join that one instead.'
        : 'Riser column placed. Click this floor\'s pipework on another level to connect it.');
    }

    this.selection = [{ kind: 'node', id: node.id }];
    this.changed();
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

    /* Every label drawn this frame records its screen box, so LAYOUT mode can
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
    this.drawCalibration();
    this.drawDisconnects();
    this.drawScaleBar();
    this.drawTooltip();
  };

  /* SHOW DISCONNECT — ring the places where the drawing lies.
   *
   * The failure this exists for: two nodes at exactly the same coordinates,
   * not joined. On screen it is one continuous run; hydraulically it is two
   * separate networks, and the solve returns zero flow with no error at all.
   * Nothing short of drawing attention to the spot will find that.
   */
  View.prototype.drawDisconnects = function () {
    if (this.tool !== 'disconnect') return;
    var m = this.getModel(), ctx = this.ctx, self = this;
    if (!FD.network || !FD.network.disconnections) return;

    var issues = FD.network.disconnections(m);
    var lv = m.activeLevel;
    var t = performance.now() / 1000;
    var pulse = 0.55 + 0.45 * Math.sin(t * 3);      // makes a 0 mm gap findable

    var shown = 0;
    issues.forEach(function (iss) {
      (iss.nodes || []).forEach(function (id) {
        var n = M.node(m, id);
        if (!n || n.level !== lv) return;
        var w = M.worldXY(m, n);
        var p = self.toScreen(w.x, w.y);
        var col = iss.severity === 'error' ? self.theme.error : self.theme.warn;
        shown++;

        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();
        /* A cross as well as a ring: two coincident nodes draw two identical
         * rings on top of each other, and the ring alone would look like one. */
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 22, p.y - 22); ctx.lineTo(p.x - 12, p.y - 12);
        ctx.moveTo(p.x + 22, p.y - 22); ctx.lineTo(p.x + 12, p.y - 12);
        ctx.moveTo(p.x - 22, p.y + 22); ctx.lineTo(p.x - 12, p.y + 12);
        ctx.moveTo(p.x + 22, p.y + 22); ctx.lineTo(p.x + 12, p.y + 12);
        ctx.stroke();
        ctx.restore();
      });
    });

    // Legend, so the mode explains itself rather than needing to be remembered.
    ctx.save();
    ctx.font = '12px ' + (this.fontFamily || 'sans-serif');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    var errs = issues.filter(function (i) { return i.severity === 'error'; }).length;
    var msg = issues.length
      ? errs + ' break' + (errs === 1 ? '' : 's') + ' found' +
        (shown ? '' : ' — none on this level')
      : 'No breaks found';
    ctx.fillStyle = issues.length ? this.theme.error : this.theme.ok || this.theme.text;
    ctx.fillText('SHOW DISCONNECT: ' + msg, 12, 12);
    ctx.fillStyle = this.theme.mute;
    ctx.fillText('Details are listed in the CALCULATION tab.', 12, 30);
    ctx.restore();

    if (issues.length) this.requestAnimation();
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
      if (selIds[p.id]) {
        ctx.strokeStyle = self.theme.select;
        ctx.lineWidth = self.pipeWidth(p) + 4;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = self.pipeWidth(p);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();

      if (p.kind === 'pump') {
        self.drawPumpGlyph(p, sa, sb, selIds[p.id], q || 1);
      } else if (p.kind === 'valve') {
        self.drawValveGlyph(p, sa, sb, selIds[p.id]);
      } else if (p.kind === 'equip') {
        self.drawEquipGlyph(p, sa, sb, selIds[p.id]);
      } else {
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
      ctx.save();
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

    // check valves get a bar on the seat side to show they are directional
    if (t.checkValve) {
      ctx.beginPath();
      ctx.moveTo(w + 2, -h); ctx.lineTo(w + 2, h);
      ctx.stroke();
    }
    ctx.restore();

    if (m.settings.annotate.fitType) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = colour;
      ctx.fillText(t.code + (open < 100 ? ' ' + open + '%' : ''), mx, my - 13);
    }
  };

  /* Equipment glyph: a square box straddling the pipe — a coil, chiller,
   * heat exchanger, anything with a rated flow and pressure drop. */
  View.prototype.drawEquipGlyph = function (p, sa, sb, selected) {
    var ctx = this.ctx;
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    ctx.save();
    ctx.translate(mx, my); ctx.rotate(ang);
    ctx.fillStyle = this.theme.bg;
    ctx.strokeStyle = selected ? this.theme.select : this.theme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.rect(-11, -8, 22, 16);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11, -8); ctx.lineTo(11, 8); ctx.stroke();
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
      if (this.tool === 'layout') this.labelHandle(tx - w / 2 - 3, ty - size, w + 6, size + 5);
    }
    this.drawDeviceBox(p, { x: x, y: y }, off);
  };

  /* Pump glyph: a circle with a chevron pointing along the flow. */
  View.prototype.drawPumpGlyph = function (p, sa, sb, selected, q) {
    var ctx = this.ctx;
    var mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    var ang = Math.atan2(sb.y - sa.y, sb.x - sa.x) + (q < 0 ? Math.PI : 0);
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = selected ? this.theme.select : this.theme.ok;
    ctx.fillStyle = this.theme.bg;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-3, -5); ctx.lineTo(5, 0); ctx.lineTo(-3, 5);
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
      var pd = FD.units.headToPaWith(Math.abs(FD.hydraulics.headloss(link.r, q, link.n)),
                                     m.settings.fluid && m.settings.fluid.density);
      parts.push(FD.units.fmtPressure(pd, d.pressure) + d.pressure);
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
    if (this.tool === 'layout') this.labelHandle(box.x, box.y, box.w, box.h);
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
    if (this.tool === 'layout') this.labelHandle(x - w / 2 - 3, y - size, w + 6, size + 6);

    this.drawDeviceBox(n, s, off);
  };

  View.prototype.labelSize = function () {
    var p = this.getModel().settings.presentation || {};
    return p.labelSize || 11;
  };

  /* Faint outline round a draggable label, so LAYOUT mode shows what can be
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
   * user ticked in LAYOUT mode. */
  View.prototype.drawDeviceBox = function (obj, s, off) {
    var flags = M.displayFlags(obj);
    var keys = Object.keys(flags);
    if (!keys.length) return;

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
    } else {
      // in-line device (pump / equipment / valve)
      if (flags.tag && obj.tag) lines.push(obj.tag);
      if (res && res.flow[obj.id] !== undefined) {
        if (flags.flow) lines.push('Q ' + FD.units.fmtFlow(Math.abs(res.flow[obj.id]), d.flow, true));
        if (flags.head && obj.pump) {
          lines.push('H ' + FD.units.fmtPressure(
            FD.units.headToPaWith(obj.pump.head || 0, m.settings.fluid.density), d.pressure, true));
        }
        if (flags.pd) {
          var link = res.network && res.network.links.find(function (l) { return l.id === obj.id; });
          if (link && link.r !== undefined) {
            lines.push('ΔP ' + FD.units.fmtPressure(FD.units.headToPaWith(
              Math.abs(FD.hydraulics.headloss(link.r, res.flow[obj.id], link.n)),
              m.settings.fluid.density), d.pressure, true));
          }
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
  };

  /* Pressure drop attributable to the fittings charged at this node. Each
   * fitting's EL rides on its downstream pipe, so the share is the pipe's loss
   * scaled by the fraction of effective length the fittings contribute. */
  View.prototype.fittingPDAt = function (nodeId) {
    var m = this.getModel(), res = this.results;
    if (!res || !res.network) return 0;
    var fits = FD.network.fittingsAtNode(m, nodeId, res.flow, []);
    var total = 0;
    fits.forEach(function (f) {
      var link = res.network.links.find(function (l) { return l.id === f.pipe; });
      if (!link || !link._Leff) return;
      var q = res.flow[link.id];
      if (q === undefined) return;
      var pipe = M.pipe(m, f.pipe);
      if (!pipe) return;
      var el = FD.fittings.el(f.type, M.pipeBore(m, pipe) * 1000);
      var loss = FD.units.headToPaWith(Math.abs(FD.hydraulics.headloss(link.r, q, link.n)),
                                       m.settings.fluid && m.settings.fluid.density);
      total += loss * (el / link._Leff);
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

  /* Register a label's screen box so it can be picked up in LAYOUT mode. */
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
    if (this.tool !== 'pipe' || !this.cursor) return;
    var ctx = this.ctx, m = this.getModel();
    var s = this.drawTarget(this.cursor);
    var sb = this.toScreen(s.x, s.y);

    // Snap preview: an open circle wherever the pipe would attach.
    this.snapPreview(sb, s.kind);

    if (!this.draft) return;

    var a = this.draft.last;
    var sa = this.toScreen(a.x, a.y);

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

    if (s.kind === 'pipe') this.badge(sb.x + 16, sb.y + 6, 'insert tee');
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

    ctx.font = '11px ui-monospace, monospace';
    var wid = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 16;
    var hgt = lines.length * 15 + 10;
    var x = s.x + 16, y = s.y + 12;
    if (x + wid > this.cssW) x = s.x - wid - 16;
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
  };

  FD.View = View;
})(window.FD = window.FD || {});
