/* FreePipeCalc — model state
 *
 * The single source of truth. Everything is SI (spec §2): metres, m³/s, Pa.
 * The drawing layer reads and mutates this; the network builder translates it
 * for the solver. Nothing here knows about pixels, canvases or units.
 *
 * Coordinates: node x,y are LEVEL-LOCAL metres. A level's (dx,dy) offset is
 * applied only at render and hit-test time, so aligning floors never touches
 * geometry or lengths (spec §7.1).
 */
(function (FD) {
  'use strict';

  var FORMAT_VERSION = 1;

  /* An outflow with zero required pressure is physically meaningless — water
   * does not leave a pipe against nothing — and it makes the terminal
   * characteristic K = Q/sqrt(dP) undefined, which SIMULATION depends on.
   * 0.1 kPa is the smallest value that still carries meaning. */
  var MIN_OUTFLOW_PRESSURE = 100;   // Pa

  function uid(prefix, seq) { return prefix + (seq); }

  // ------------------------------------------------------------ defaults
  function defaultSettings() {
    return {
      units: 'metric',              // 'metric' | 'ip'
      display: {
        flow: 'L/s', pressure: 'kPa', pdm: 'Pa/m', length: 'm', size: 'DN'
      },
      /* DESIGN: outflows state a required flow, pump duty is calculated.
       * SIMULATION: the pump curve is the input, outflow becomes a resistance
       * derived from its design point, and flow is the result. */
      calcMode: 'design',           // 'design' | 'simulation'
      frictionMethod: 'HW',         // 'HW' | 'DW' (Darcy is experimental)
      systemType: 'open',           // 'open' | 'closed' (spec §3.4)

      /* Hazen-Williams coefficients, user-editable. Jurisdictions differ on
       * these, so rather than shipping a menu of codes the app ships the
       * ASHRAE SI values and lets them be overridden. */
      hw: { A: 10.67, a: 1.852, b: 1.852, e: 4.8704 },

      /* Darcy-Weisbach settings. frictionFactor is PENDING a decision — all
       * correlations are implemented and selectable. */
      dw: { frictionFactor: 'colebrook', roughness_mm: 0.045, kSet: 'threaded' },

      /* Fluid properties. Only density is used by the current solver; the
       * others are stored and shown so the model is complete, and are marked
       * as unused in the UI. Kinematic viscosity becomes live with Darcy. */
      fluid: {
        name: 'Water',
        density: 998,                  // kg/m³    — used
        kinematicViscosity: 1.004e-6,  // m²/s     — used by Darcy only
        temperature: 20,               // °C       — not implemented
        /* Specific heat capacity. Not used by the hydraulics at all — it is
         * here for the heating/cooling power work coming next, where
         * Q = ṁ·Cp·ΔT. Stored and shown, clearly marked as unused. */
        specificHeat: 4187             // J/(kg·K) — not implemented
      },

      /* Fitting equivalent lengths on an L/D basis (spec §3.3), editable.
       * Used by Hazen-Williams. */
      fittingLD: { E90: 30, E45: 16, TRUN: 20, TBRANCH: 60,
                   TRUN_DIV: 20, TBRANCH_DIV: 60,
                   /* Placeholders — see the provenance note in data/fittings.js
                    * and the list in the HYDRAULIC tab. */
                   TRUN_CONV: 20, TBRANCH_CONV: 90,
                   GATE: 8, GLOBE: 340, CHECK: 100 },

      /* Fitting K overrides for Darcy. Empty means "use the ASHRAE size
       * curve"; a number here pins that fitting to a flat K. */
      fittingK: {},
      schedule: 'sch40',
      lastSize: null,               // last size drawn; new pipes inherit it (§5)
      C: 120,
      defaultC: {},                 // per-schedule overrides
      /* Default 0. Most engineers apply their own margin after the calculation,
       * and a built-in default silently compounds with it. The factor is a
       * reported SELECTION duty at the pump only — it never enters the solve,
       * so it cannot inflate flow or friction (spec Q12.11, Q12.12). */
      pumpSafetyPct: 0,
      theme: 'dark',
      warn: { velocity: 2.4, pdm: 400, laminar: true, pumpRunout: 120 },
      floorToFloor: 3.5,
      grid: { minor: 0.5, major: 5, snap: true },

      /* What gets annotated on the drawing and on printed level plans.
       * Pipe labels read "50⌀/12.5m/2.40L/s"; node labels read "N3 T".
       * Fitting type codes: EL elbow · T tee · S source · P pump · D demand. */
      annotate: {
        pipeDiameter: true,
        pipeLength: true,
        pipeFlow: true,
        pipeVelocity: false,
        pipePD: false,
        fitType: true,
        fitPD: false,
        nodeNumbers: true
      },
      /* Presentation. Arrow and label sizes are separated from the UI font so a
       * drawing can be tuned for print without changing the app chrome. */
      presentation: {
        arrowSize: 1.0,        // multiplier on the flow-direction arrows
        labelSize: 11,         // px, drawing annotations (screen and print)
        uiFontSize: 14         // px, application chrome
      },
      csv: { delimiter: ',', decimal: '.' },
      exportImage: 'svg',           // 'svg' | 'png'
      meta: {
        project: '', system: '', engineer: '', company: '',
        date: '', revision: ''
      }
    };
  }

  // --------------------------------------------------------------- model
  function create() {
    var m = {
      formatVersion: FORMAT_VERSION,
      appVersion: FD.VERSION || '0.1.0-dev',
      settings: defaultSettings(),
      customSchedules: {},
      levels: [],
      nodes: [],
      pipes: [],
      risers: [],
      _seq: { level: 0, node: 0, pipe: 0, riser: 0 }
    };
    addLevel(m, { name: 'Level 0', altitude: 0 });
    m.activeLevel = m.levels[0].id;
    return m;
  }

  // --------------------------------------------------------------- levels
  function addLevel(m, opts) {
    opts = opts || {};
    var lv = {
      id: uid('L', m._seq.level++),
      name: opts.name || ('Level ' + m._seq.level),
      altitude: opts.altitude !== undefined ? opts.altitude : 0,
      dx: 0, dy: 0,
      lookDir: opts.lookDir || 'down',     // which neighbour renders faded
      /* trace: a background drawing to trace over, or absent. Per LEVEL,
       * because each floor is traced from a different drawing.
       *   { src, x, y, width, aspect, opacity, invert, locked }
       * x/y/width are in world metres; height follows from aspect. */
      trace: null
    };
    m.levels.push(lv);
    sortLevels(m);
    return lv;
  }

  function sortLevels(m) {
    m.levels.sort(function (a, b) { return b.altitude - a.altitude; });  // top first
  }

  function level(m, id) {
    return m.levels.find(function (l) { return l.id === id; }) || null;
  }

  function removeLevel(m, id) {
    if (m.levels.length <= 1) return false;
    m.nodes.filter(function (n) { return n.level === id; })
           .forEach(function (n) { removeNode(m, n.id); });
    m.levels = m.levels.filter(function (l) { return l.id !== id; });
    m.risers.forEach(function (r) {
      r.attachments = r.attachments.filter(function (a) { return a.level !== id; });
    });
    m.risers = m.risers.filter(function (r) { return r.attachments.length > 0; });
    if (m.activeLevel === id) m.activeLevel = m.levels[0].id;
    return true;
  }

  /* Changing a level's altitude shifts everything on it (spec §7). Because
   * altitude is stored on the level and pipes carry only an OFFSET, this is a
   * one-field edit — no geometry is touched. */
  function setLevelAltitude(m, id, altitude) {
    var lv = level(m, id);
    if (!lv) return;
    lv.altitude = altitude;
    sortLevels(m);
  }

  // ---------------------------------------------------------------- nodes
  function addNode(m, levelId, x, y, opts) {
    opts = opts || {};
    var n = {
      id: uid('N', m._seq.node++),
      level: levelId,
      x: x, y: y,
      dz: opts.dz || 0,            // offset from level altitude
      device: opts.device || null, // {kind:'source'} | {kind:'demand',...}
      tag: opts.tag || undefined   // equipment reference, as on in-line devices
    };
    m.nodes.push(n);
    return n;
  }

  function node(m, id) {
    return m.nodes.find(function (n) { return n.id === id; }) || null;
  }

  function removeNode(m, id) {
    m.pipes = m.pipes.filter(function (p) { return p.a !== id && p.b !== id; });
    m.nodes = m.nodes.filter(function (n) { return n.id !== id; });
    m.risers.forEach(function (r) {
      r.attachments = r.attachments.filter(function (a) { return a.node !== id; });
    });
  }

  /* World position of a node — level-local coords plus the level offset. */
  function worldXY(m, n) {
    var lv = level(m, n.level);
    return { x: n.x + (lv ? lv.dx : 0), y: n.y + (lv ? lv.dy : 0) };
  }

  /* Elevation of a node: level altitude + per-node offset. */
  function elevation(m, n) {
    var lv = level(m, n.level);
    return (lv ? lv.altitude : 0) + (n.dz || 0);
  }

  // ---------------------------------------------------------------- pipes
  function addPipe(m, aId, bId, opts) {
    opts = opts || {};
    var p = {
      id: uid('P', m._seq.pipe++),
      a: aId, b: bId,
      kind: opts.kind || 'pipe',        // 'pipe' | 'riser' | 'equip' | 'pump'
      schedule: opts.schedule || m.settings.schedule,
      size: opts.size || null,          // null -> resolved to schedule's default
      C: opts.C !== undefined ? opts.C : m.settings.C,
      riser: opts.riser || null         // riser column id, for riser links
    };
    if (opts.equip) p.equip = opts.equip;   // {qRated, pdRated, qOut}
    if (opts.pump)  p.pump  = opts.pump;    // {mode, head, flow}
    if (opts.valve) p.valve = opts.valve;   // {type, kv, opening}
    /* Equipment tag — the plant reference an engineer actually works from
     * ("CHW-P-01"). Shown on the drawing and in the calculation sheet. */
    if (opts.tag) p.tag = opts.tag;
    /* Per-section fluid temperature. Not used hydraulically yet; it is the
     * hook for the heating/cooling power calculations, where flow and ΔT
     * across a section give the duty. Undefined means "use the system fluid
     * temperature". */
    if (opts.temperature !== undefined) p.temperature = opts.temperature;
    /* Size resolution order (spec §5: "new segments inherit size (last used)"):
     * explicit → last used on this schedule → the schedule's sane default. */
    if (!p.size) {
      p.size = validSize(m, p.schedule, m.settings.lastSize) ||
               FD.schedules.defaultSize(p.schedule, m.customSchedules);
    }
    m.settings.lastSize = p.size;
    m.pipes.push(p);
    return p;
  }

  /* Is `label` a real size in this schedule? Guards against carrying a size
   * across a schedule change, where the label may not exist. */
  function validSize(m, scheduleKey, label) {
    if (!label) return null;
    var sch = FD.schedules.get(scheduleKey, m.customSchedules);
    return sch.sizes.some(function (s) { return s.label === label; }) ? label : null;
  }

  function pipe(m, id) {
    return m.pipes.find(function (p) { return p.id === id; }) || null;
  }

  function removePipe(m, id) {
    m.pipes = m.pipes.filter(function (p) { return p.id !== id; });
  }

  function pipesAt(m, nodeId) {
    return m.pipes.filter(function (p) { return p.a === nodeId || p.b === nodeId; });
  }

  function other(p, nodeId) { return p.a === nodeId ? p.b : p.a; }

  /* Drawn length of a pipe [m]. Horizontal pipes use plan distance plus any
   * elevation difference; riser links are purely vertical. */
  function pipeLength(m, p) {
    var na = node(m, p.a), nb = node(m, p.b);
    if (!na || !nb) return 0;
    var dz = elevation(m, nb) - elevation(m, na);
    if (p.kind === 'riser') return Math.abs(dz);
    var wa = worldXY(m, na), wb = worldXY(m, nb);
    var dx = wb.x - wa.x, dy = wb.y - wa.y;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function pipeBore(m, p) {
    return FD.schedules.size(p.schedule, p.size, m.customSchedules).id_mm / 1000;
  }

  // ---------------------------------------------------------------- risers
  function addRiser(m, x, y) {
    var r = { id: uid('R', m._seq.riser++), x: x, y: y, attachments: [] };
    m.risers.push(r);
    return r;
  }

  function attachRiser(m, riserId, levelId, nodeId) {
    var r = m.risers.find(function (x) { return x.id === riserId; });
    if (!r) return null;
    if (r.attachments.some(function (a) { return a.level === levelId; })) return null;
    r.attachments.push({ level: levelId, node: nodeId });
    // keep sorted by altitude, top first, so consecutive pairs are contiguous
    r.attachments.sort(function (a, b) {
      return (level(m, b.level).altitude) - (level(m, a.level).altitude);
    });
    return r;
  }

  /* A level attached to two or more riser columns has a locked offset —
   * moving it would break one of the columns' fixed world XY (spec §7.2.3). */
  function isLevelLocked(m, levelId) {
    var count = 0;
    m.risers.forEach(function (r) {
      if (r.attachments.some(function (a) { return a.level === levelId; })) count++;
    });
    return count >= 2;
  }

  /* Riser columns contribute vertical links between consecutive attachments.
   * Size defaults to the LARGER connected horizontal pipe (spec §7.2). */
  /* Delete a riser column: its materialised pipes go with it, and so do the
   * attachment records. The nodes it attached TO are left alone — they are
   * ordinary pipework nodes on their own levels and usually still wanted.
   *
   * Previously there was no way to remove one at all: the column is drawn as a
   * marker rather than a line, so it could be neither clicked nor deleted. */
  function removeRiser(m, riserId) {
    m.pipes = m.pipes.filter(function (p) {
      return !(p.kind === 'riser' && p.riser === riserId);
    });
    m.risers = m.risers.filter(function (r) { return r.id !== riserId; });
    return m;
  }

  function riserPipes(m) {
    var out = [];
    m.risers.forEach(function (r) {
      for (var i = 0; i < r.attachments.length - 1; i++) {
        var top = r.attachments[i], bot = r.attachments[i + 1];
        var existing = m.pipes.find(function (p) {
          return p.kind === 'riser' && p.riser === r.id &&
                 ((p.a === top.node && p.b === bot.node) ||
                  (p.a === bot.node && p.b === top.node));
        });
        if (existing) { out.push(existing); continue; }
        var p = addPipe(m, top.node, bot.node, {
          kind: 'riser', riser: r.id, size: inheritRiserSize(m, top.node, bot.node)
        });
        out.push(p);
      }
    });
    return out;
  }

  function inheritRiserSize(m, aId, bId) {
    var best = null, bestBore = -1;
    [aId, bId].forEach(function (id) {
      pipesAt(m, id).forEach(function (p) {
        if (p.kind === 'riser') return;
        var bore = FD.schedules.size(p.schedule, p.size, m.customSchedules).id_mm;
        if (bore > bestBore) { bestBore = bore; best = p.size; }
      });
    });
    /* A free-standing riser with nothing horizontal attached yet has nothing to
     * inherit from — fall back to the schedule default rather than the smallest
     * size, which would silently model a DN15 riser. */
    return best || FD.schedules.defaultSize(m.settings.schedule, m.customSchedules);
  }

  /* Attach a background drawing to a level. Placed centred on the given world
   * point at a default width, because a freshly pasted image has no meaningful
   * scale until it is calibrated. */
  function setTrace(m, levelId, img, centreX, centreY, defaultWidth) {
    var lv = level(m, levelId);
    if (!lv) return null;
    var w = defaultWidth || 40;
    lv.trace = {
      src: img.src,
      aspect: img.aspect,
      x: (centreX || 0) - w / 2,
      y: (centreY || 0) + (w * img.aspect) / 2,   // y is the TOP edge (y grows up)
      width: w,
      opacity: 0.6,
      /* The grid is drawn over the trace and at working zoom it obscures a
       * surprising amount of the drawing — over a third of sampled pixels in
       * testing. While tracing, the drawing IS the reference, so the grid goes
       * off by default. */
      hideGrid: true,
      /* Inverted by default on the dark theme: a PDF screenshot is black on
       * white, which on a dark canvas is a glaring slab with the pipework lost
       * inside it. Inverted, the paper goes dark and the linework goes light. */
      invert: (m.settings.theme !== 'light'),
      locked: false
    };
    return lv.trace;
  }

  function clearTrace(m, levelId) {
    var lv = level(m, levelId);
    if (lv) lv.trace = null;
  }

  /* Scale a trace so two points on it sit `realDistance` apart in model space,
   * holding `anchor` still. This is what makes traced geometry worth keeping —
   * without it the user is eyeballing scale and every length has to be retyped.
   */
  function calibrateTrace(m, levelId, ax, ay, bx, by, realDistance) {
    var lv = level(m, levelId);
    if (!lv || !lv.trace) return null;
    var measured = Math.hypot(bx - ax, by - ay);
    if (!(measured > 1e-9) || !(realDistance > 0)) return null;

    var k = realDistance / measured;
    var t = lv.trace;
    // scale about the first clicked point so it stays under the cursor
    t.x = ax + (t.x - ax) * k;
    t.y = ay + (t.y - ay) * k;
    t.width *= k;
    return { factor: k, measured: measured, real: realDistance };
  }

  /* LAYOUT mode: manual label placement.
   *
   * Auto-placed annotations collide with pipework on anything busy, and on a
   * printed drawing that is the difference between readable and not. Offsets
   * are stored in SCREEN PIXELS rather than metres so a label stays the same
   * distance from its owner at every zoom level — which is what "tidy" means
   * on a drawing, and what carries over to print. */
  function labelOffset(obj) {
    return (obj && obj.labelOffset) || { dx: 0, dy: 0 };
  }

  function setLabelOffset(obj, dx, dy) {
    if (!obj) return;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) delete obj.labelOffset;
    else obj.labelOffset = { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 };
  }

  function clearLabelOffsets(m) {
    m.nodes.forEach(function (n) { delete n.labelOffset; });
    m.pipes.forEach(function (p) { delete p.labelOffset; });
  }

  /* Which of a device's properties are echoed on the drawing, in a box beside
   * it. Off by default — a drawing covered in every value is unreadable. */
  function displayFlags(obj) {
    return (obj && obj.show) || {};
  }

  function setDisplayFlag(obj, key, on) {
    if (!obj) return;
    if (!obj.show) obj.show = {};
    if (on) obj.show[key] = true; else delete obj.show[key];
    if (!Object.keys(obj.show).length) delete obj.show;
  }

  /* Copy everything drawn on `fromLevelId` onto `toLevelId`, at the same
   * level-local coordinates (spec §6, Copy Up/Down).
   *
   * EVERYTHING comes across, sources included. Suppressing the source was
   * tried and rejected: forgetting to delete a duplicated source is ordinary
   * user error, and the workflow around it is easy (copy the lowest floor,
   * delete the source on the copy, copy upward from there). Silently dropping
   * part of the layout is the worse surprise.
   *
   * Riser columns touching the source floor are extended to the new floor as
   * well, so a stack of identical floors stays connected instead of arriving
   * as an island.
   */
  function copyLevel(m, fromLevelId, toLevelId) {
    var src = level(m, fromLevelId), dst = level(m, toLevelId);
    if (!src || !dst || src.id === dst.id) return null;

    /* The trace is deliberately NOT copied: it is a picture of the floor it
     * came from, and duplicating it onto another level would be actively
     * misleading. */
    var map = {}, copiedNodes = [], copiedPipes = [];

    m.nodes.filter(function (n) { return n.level === fromLevelId; }).forEach(function (n) {
      var copy = addNode(m, toLevelId, n.x, n.y, { dz: n.dz || 0 });
      if (n.device) copy.device = JSON.parse(JSON.stringify(n.device));
      if (n.labelOffset) copy.labelOffset = { dx: n.labelOffset.dx, dy: n.labelOffset.dy };
      if (n.show) copy.show = JSON.parse(JSON.stringify(n.show));
      map[n.id] = copy.id;
      copiedNodes.push(copy);
    });

    m.pipes.slice().forEach(function (p) {
      if (p.kind === 'riser') return;                 // risers are rebuilt, not copied
      if (map[p.a] === undefined || map[p.b] === undefined) return;
      var opts = { kind: p.kind, schedule: p.schedule, size: p.size, C: p.C };
      if (p.tag) opts.tag = p.tag;
      if (p.temperature !== undefined) opts.temperature = p.temperature;
      if (p.equip) opts.equip = JSON.parse(JSON.stringify(p.equip));
      if (p.pump) opts.pump = JSON.parse(JSON.stringify(p.pump));
      if (p.valve) opts.valve = JSON.parse(JSON.stringify(p.valve));
      var np = addPipe(m, map[p.a], map[p.b], opts);
      if (p.labelOffset) np.labelOffset = { dx: p.labelOffset.dx, dy: p.labelOffset.dy };
      if (p.show) np.show = JSON.parse(JSON.stringify(p.show));
      copiedPipes.push(np);
    });

    // extend any riser column that touches the source floor
    var extended = 0;
    m.risers.forEach(function (r) {
      if (r.attachments.some(function (a) { return a.level === toLevelId; })) return;
      var here = r.attachments.filter(function (a) { return a.level === fromLevelId; })[0];
      if (!here) return;
      var target = map[here.node];
      if (target === undefined) return;
      attachRiser(m, r.id, toLevelId, target);
      extended++;
    });
    riserPipes(m);

    return { nodes: copiedNodes.length, pipes: copiedPipes.length, risers: extended };
  }

  // ----------------------------------------------------------- devices
  function setSource(m, nodeId) {
    var n = node(m, nodeId);
    if (n) n.device = { kind: 'source' };
    return n;
  }

  /* Terminal characteristic derived from the design point: a terminal passing
   * Q_d at dP_d has K = Q_d / sqrt(dP_d), which as a solver resistance is
   * r = dP_d / (rho*g*Q_d^2) — the same quadratic form equipment uses. */
  function outflowResistance(m, n) {
    if (!n.device || n.device.kind !== 'demand') return null;
    var q = n.device.flow, dp = n.device.reqPressure;
    if (!(q > 0) || !(dp > 0)) return null;
    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    return dp / (rho * 9.81 * q * q);
  }

  function setDemand(m, nodeId, flow, reqPressure) {
    var n = node(m, nodeId);
    if (n) {
      n.device = {
        kind: 'demand',
        flow: flow || 0,               // m³/s
        reqPressure: reqPressure || 0, // Pa
        include: true                  // spec §8.2
      };
    }
    return n;
  }

  function clearDevice(m, nodeId) {
    var n = node(m, nodeId);
    if (n) n.device = null;
  }

  // ------------------------------------------------- serialise / restore
  function toJSON(m) {
    var copy = JSON.parse(JSON.stringify(m));
    copy.formatVersion = FORMAT_VERSION;
    copy.appVersion = FD.VERSION || '0.1.0-dev';
    copy.savedAt = new Date().toISOString();
    return copy;
  }

  function fromJSON(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Not a FreePipeCalc model file.');
    if (!obj.formatVersion) throw new Error('Missing formatVersion — not a .pnet.json file.');
    if (obj.formatVersion > FORMAT_VERSION) {
      throw new Error('This file was saved by a newer version of FreePipeCalc (format ' +
                      obj.formatVersion + ', this build reads ' + FORMAT_VERSION + ').');
    }
    var m = create();
    // Merge rather than replace, so files written by older builds pick up any
    // settings added since without becoming invalid.
    m.settings = Object.assign(defaultSettings(), obj.settings || {});
    m.settings.display = Object.assign(defaultSettings().display, (obj.settings || {}).display || {});
    m.settings.warn = Object.assign(defaultSettings().warn, (obj.settings || {}).warn || {});
    m.settings.grid = Object.assign(defaultSettings().grid, (obj.settings || {}).grid || {});
    m.settings.meta = Object.assign(defaultSettings().meta, (obj.settings || {}).meta || {});
    m.settings.hw = Object.assign(defaultSettings().hw, (obj.settings || {}).hw || {});
    m.settings.dw = Object.assign(defaultSettings().dw, (obj.settings || {}).dw || {});
    m.settings.fluid = Object.assign(defaultSettings().fluid, (obj.settings || {}).fluid || {});
    if (!m.settings.calcMode) m.settings.calcMode = 'design';
    m.settings.presentation = Object.assign(defaultSettings().presentation,
                                            (obj.settings || {}).presentation || {});
    m.settings.annotate = Object.assign(defaultSettings().annotate,
                                        (obj.settings || {}).annotate || {});
    m.settings.fittingLD = Object.assign(defaultSettings().fittingLD,
                                         (obj.settings || {}).fittingLD || {});
    m.settings.fittingK = (obj.settings || {}).fittingK || {};
    m.customSchedules = obj.customSchedules || {};
    m.levels = obj.levels || m.levels;
    m.nodes = obj.nodes || [];
    m.pipes = obj.pipes || [];
    m.risers = obj.risers || [];
    m.activeLevel = obj.activeLevel || (m.levels[0] && m.levels[0].id);
    m._seq = obj._seq || rebuildSeq(m);
    return m;
  }

  /* If a file was hand-edited and lost its counters, rebuild them from the
   * highest id in use so newly created objects cannot collide. */
  function rebuildSeq(m) {
    function maxId(list, prefix) {
      return list.reduce(function (mx, o) {
        var n = parseInt(String(o.id).slice(prefix.length), 10);
        return isFinite(n) ? Math.max(mx, n + 1) : mx;
      }, 0);
    }
    return {
      level: maxId(m.levels, 'L'),
      node:  maxId(m.nodes, 'N'),
      pipe:  maxId(m.pipes, 'P'),
      riser: maxId(m.risers, 'R')
    };
  }

  FD.model = {
    FORMAT_VERSION: FORMAT_VERSION,
    create: create,
    defaultSettings: defaultSettings,

    addLevel: addLevel, removeLevel: removeLevel, level: level,
    setLevelAltitude: setLevelAltitude, sortLevels: sortLevels,
    isLevelLocked: isLevelLocked,

    addNode: addNode, node: node, removeNode: removeNode,
    worldXY: worldXY, elevation: elevation,

    addPipe: addPipe, pipe: pipe, removePipe: removePipe,
    pipesAt: pipesAt, other: other, pipeLength: pipeLength, pipeBore: pipeBore,

    addRiser: addRiser, attachRiser: attachRiser, riserPipes: riserPipes,
    removeRiser: removeRiser,
    copyLevel: copyLevel,
    MIN_OUTFLOW_PRESSURE: MIN_OUTFLOW_PRESSURE,
    outflowResistance: outflowResistance,
    setTrace: setTrace, clearTrace: clearTrace, calibrateTrace: calibrateTrace,

    labelOffset: labelOffset, setLabelOffset: setLabelOffset,
    clearLabelOffsets: clearLabelOffsets,
    displayFlags: displayFlags, setDisplayFlag: setDisplayFlag,

    setSource: setSource, setDemand: setDemand, clearDevice: clearDevice,

    toJSON: toJSON, fromJSON: fromJSON
  };
})(window.FD = window.FD || {});
