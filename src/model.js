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

  function uid(prefix, seq) { return prefix + (seq); }

  // ------------------------------------------------------------ defaults
  function defaultSettings() {
    return {
      units: 'metric',              // 'metric' | 'ip'
      display: {
        flow: 'L/s', pressure: 'kPa', pdm: 'Pa/m', length: 'm', size: 'DN'
      },
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
        density: 998,                  // kg/m³   — used
        kinematicViscosity: 1.004e-6,  // m²/s    — used by Darcy only
        temperature: 20                // °C      — not implemented
      },

      /* Fitting equivalent lengths on an L/D basis (spec §3.3), editable.
       * Used by Hazen-Williams. */
      fittingLD: { E90: 30, E45: 16, TRUN: 20, TBRANCH: 60,
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
      warn: { velocity: 2.4, pdm: 400, laminar: true },
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
      lookDir: opts.lookDir || 'down'      // which neighbour renders faded
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
      device: opts.device || null  // {kind:'source'} | {kind:'demand',...}
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

  // ----------------------------------------------------------- devices
  function setSource(m, nodeId) {
    var n = node(m, nodeId);
    if (n) n.device = { kind: 'source' };
    return n;
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

    setSource: setSource, setDemand: setDemand, clearDevice: clearDevice,

    toJSON: toJSON, fromJSON: fromJSON
  };
})(window.FD = window.FD || {});
