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
        flow: 'L/s', pressure: 'kPa', pdm: 'Pa/m', length: 'm', size: 'DN',
        /* Which valve flow coefficient to show. They are the same quantity in
         * different units (Cv ≈ 1.156·Kv), so showing both invites entering a
         * number into the one that is being ignored. */
        valveCoef: 'Kv'
      },
      /* DESIGN: outflows state a required flow, pump duty is calculated.
       * SIMULATION: the pump curve is the input, outflow becomes a resistance
       * derived from its design point, and flow is the result. */
      calcMode: 'design',           // 'design' | 'simulation'
      /* Two methods, and the fitting basis follows the method:
       *   'HW' — Hazen-Williams (ASHRAE Ch 22 Eq 6) with equivalent-length
       *          fittings from the table chosen on the HYDRAULIC tab.
       *   'DW' — Darcy-Weisbach (BETA) with K velocity-head fittings (Eq 7).
       * There was a third, 'ASHRAE', which was the same equation as 'HW' with
       * the other fitting basis; it is migrated to 'HW' on load. */
      frictionMethod: 'HW',         // 'HW' | 'DW'
      systemType: 'open',           // 'open' | 'closed' (spec §3.4)

      /* Hazen-Williams coefficients, user-editable. Jurisdictions differ on
       * these, so rather than shipping a menu of codes the app ships the
       * ASHRAE SI values and lets them be overridden. */
      hw: { A: 10.67, a: 1.852, b: 1.852, e: 4.8704 },

      /* ASHRAE Ch 22 Eq (6) as printed, velocity form. The solver's flow-form
       * coefficients are derived from these, so editing what the Handbook
       * prints actually changes the calculation. */
      ashrae: { K: 6.819, a: 1.852, e: 1.167 },

      /* Darcy-Weisbach settings. Swamee-Jain is the chosen correlation
       * (2026-08-02); the others stay selectable for comparison. */
      dw: { frictionFactor: 'swameejain', roughness_mm: 0.045, kSet: 'threaded' },

      /* Fluid. `preset` names one of data/fluids.js; the four numbers below
       * are only read when the preset is 'custom', because a named fluid's
       * properties belong to the fluid rather than to this file. All four are
       * live now: density everywhere, viscosity under Darcy, and specific heat
       * throughout the thermal module. */
      fluid: {
        preset: 'water',
        name: 'Water',
        density: 998,                  // kg/m³
        kinematicViscosity: 1.004e-6,  // m²/s
        temperature: 20,               // °C — the temperature the properties
                                       //      are quoted at, not a result
        specificHeat: 4187             // J/(kg·K)
      },

      /* Insulation thickness overrides, by schedule and size:
       * { 'sch40': { 'DN50': 40 } }. Empty means "use the rule" — 25 mm below
       * DN50, 50 mm from DN50 up. Edited on the HYDRAULIC tab, in the active
       * schedule's own size table, because that is where a pipe's physical
       * properties live. */
      insulation: {},

      /* THERMAL tab. Ambient is what an uninsulated or insulated pipe loses
       * to; supplyTemp is the system flow temperature, used as the reference
       * where nothing else states one. surfaceCoeff is the outside film — a
       * DEFAULT, not sourced data, and the UI says so. */
      thermal: {
        ambient: 20,                   // °C
        /* SOURCE WATER TEMPERATURE (renamed 2026-08-05, was "system flow
         * temperature"). What a SOURCE node holds when it does not state a
         * temperature of its own, and the level a fully adiabatic circuit is
         * pinned at when nothing else sets one. It is a default for the water
         * arriving, not a setpoint — setpoints live on the equipment. */
        supplyTemp: 6,                 // °C — chilled water by default
        insulationK: 0.02,             // W/(m·K) — polyurethane
        surfaceCoeff: 8,               // W/(m²·K) — still indoor air

        /* Plausibility band for the solved temperature. Outside it, the answer
         * is reported as an ERROR rather than printed — Michael's runaway
         * guard, 2026-08-02, and adjustable because what is absurd depends on
         * the system. ±50 °C suits chilled water, which is the default here;
         * an LTHW circuit at 80 °C flow needs tempMax raised, and the fields
         * are on the THERMAL tab for exactly that. */
        tempMin: -50,                  // °C
        tempMax: 50                    // °C
      },

      /* Setpoint control — how far a linked pump or globe valve is allowed to
       * modulate, and how close to the setpoint counts as arrived. All three
       * are DEFAULTS a user can change, not transcribed data.
       *
       * `minSpeed` is the VSD floor. Real drives are not run below roughly a
       * quarter speed, and a pump at no flow makes the thermal solve singular,
       * so the floor is a numerical necessity as much as a plant one. Sitting
       * on it is REPORTED rather than hidden — see CONTROL_AT_LIMIT.
       *
       * `tol` is in kelvin. 0.05 K is far tighter than any real sensor and
       * loose enough that the search stops in a handful of solves. */
      control: {
        minSpeed: 0.25,                // fraction of rated pump speed
        minOpening: 10,                // % open, globe valve
        tol: 0.05                      // K
      },

      /* Which equivalent-length table Hazen-Williams reads: 'carrier' (Carrier
       * Design Handbook Table 11, the default), 'nfpa13' (NFPA 13 Table
       * 27.2.3.1.1, with the straight-through tee from Carrier because NFPA has
       * no such row), or 'custom'. Only Hazen-Williams uses any of them —
       * ASHRAE and Darcy charge fittings as K velocity heads. */
      elSet: 'carrier',

      /* Custom equivalent lengths, in METRES against nominal size:
       * { type: { dn: metres } }. Written when the set is 'custom', seeded
       * from whichever published set was showing at the time. */
      fittingEL: {},

      /* SUPERSEDED by fittingEL. The old L/D ratio basis, kept so a model saved
       * before 2026-08-02 still loads with its settings intact rather than
       * looking corrupt. Nothing reads it. */
      fittingLD: { E90: 30, E45: 16, TRUN: 20, TBRANCH: 60,
                   TRUN_DIV: 20, TBRANCH_DIV: 60,
                   /* Combining values equal the dividing ones: ASHRAE Ch 22
                    * does not split the two cases. See data/fittings.js. */
                   TRUN_CONV: 20, TBRANCH_CONV: 60,
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
      /* `equipFlowRatio` is how far a piece of equipment may sit from its
       * rated flow before it is called out. Its pressure drop goes as the
       * SQUARE of this, so 2× flow is already 4× the rated drop. */
      /* `maxComponentPD` is a PLAUSIBILITY band, not a warning threshold: past
       * it the answer is reported as an ERROR, the same way a temperature
       * outside thermal.tempMin/tempMax is. 2000 kPa is a judgement — building
       * services pipework is PN16, PN25 on tall risers, so a single component
       * dropping more than 20 bar is not a building services problem. A fire
       * main may want it raised. 0 disables the check. */
      /* `valveAuthority` — a CONTROL valve throttling below this much of its
       * travel is doing all its work near the seat, where a small movement is
       * a large change in Kv. That is a selection problem, not a setting one:
       * the valve is too big. Isolation valves are exempt; a cracked-open
       * isolating valve is a deliberate act. */
      warn: { velocity: 2.4, pdm: 400, laminar: true, pumpRunout: 120,
              equipFlowRatio: 2, maxComponentPD: 2000e3, valveAuthority: 10 },
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
        /* Friction RATE (Pa/m) as distinct from pipePD, the whole section's
         * drop. This is the figure checked against the ~400 Pa/m rule, so it
         * is the one an engineer sizes against. */
        pipePDM: false,
        fitType: true,
        fitPD: false,
        /* Gauge pressure AT the node, as distinct from fitPD (the loss charged
         * to fittings there). This is the number an engineer reads off a
         * drawing to check a terminal has enough to work with. */
        nodePressure: false,
        /* Gauge temperature at the node, from the thermal module. */
        nodeTemperature: false,
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

  /* Drawn length of a pipe [m].
   *
   * A pipe in the layout is HORIZONTAL by rule (Michael, v0.7.8-dev): both its
   * ends sit at the same z, and the only thing that changes level is a riser.
   * So its length is the plan distance, full stop.
   *
   * The elevation term used to be included, and it is what turned a source's
   * mis-stored 20.43 m "static pressure" into a 50 m run reading 54.01 m
   * (debug/20260802-1.json). Removing it is not a workaround for that bug —
   * the storage bug is fixed separately — it is the rule the layout was always
   * drawn to, now stated.
   *
   * It holds forward, too: even once pipe gradients are modelled in v2 or v3,
   * the length an engineer wants off a layout is the horizontal one. A plan
   * pipe whose ends differ in elevation is therefore reported as a `SLOPED_PIPE`
   * error rather than silently measured along its slope. */
  function pipeLength(m, p) {
    var na = node(m, p.a), nb = node(m, p.b);
    if (!na || !nb) return 0;
    if (p.kind === 'riser') return Math.abs(elevation(m, nb) - elevation(m, na));
    var wa = worldXY(m, na), wb = worldXY(m, nb);
    var dx = wb.x - wa.x, dy = wb.y - wa.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Elevation difference across a plan pipe. Zero for every pipe that obeys the
   * rule above; non-zero is the defect `SLOPED_PIPE` reports. */
  function pipeRise(m, p) {
    var na = node(m, p.a), nb = node(m, p.b);
    if (!na || !nb || p.kind === 'riser') return 0;
    return elevation(m, nb) - elevation(m, na);
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

  /* A riser END that connects to nothing.
   *
   * The top and bottom attachments of a column are where it hands over to
   * horizontal pipework. If that node carries NO other pipe, the column stops
   * in mid-air: water arrives at the top of the riser and has nowhere to go.
   * It is the riser form of the disconnection the ⚠️ glyph already catches on
   * the flat, and it is invisible on a level plan because the riser is drawn as
   * a marker rather than a line (Michael, 2026-08-05).
   *
   * Reported for the ENDS only. A middle attachment with nothing else on it is
   * a pass-through: the column simply continues, which is ordinary. */
  function riserOpenEnds(m) {
    var out = [];
    m.risers.forEach(function (r) {
      if (r.attachments.length < 2) return;
      [[r.attachments[0], 'top'],
       [r.attachments[r.attachments.length - 1], 'bottom']].forEach(function (pair) {
        var att = pair[0];
        var others = m.pipes.filter(function (p) {
          if (p.kind === 'riser') return false;
          return p.a === att.node || p.b === att.node;
        });
        if (others.length) return;
        out.push({ riser: r.id, end: pair[1], level: att.level, node: att.node });
      });
    });
    return out;
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
        if (existing) {
          /* Propagate an explicit column override onto pipes already
           * materialised. With no override the first-resolved inherited size
           * is left untouched, so auto-sized risers keep behaving as before. */
          if (r.size) existing.size = r.size;
          if (r.schedule) existing.schedule = r.schedule;
          if (r.C !== undefined && r.C !== null) existing.C = r.C;
          out.push(existing); continue;
        }
        var p = addPipe(m, top.node, bot.node, {
          kind: 'riser', riser: r.id,
          size: r.size || inheritRiserSize(m, top.node, bot.node),
          schedule: r.schedule, C: r.C
        });
        out.push(p);
      }
    });
    return out;
  }

  /* Join `dropId` onto `keepId`: every pipe on the dropped node is moved to the
   * kept one and the dropped node is removed.
   *
   * This is what dragging one node onto another should mean. Leaving two nodes
   * on the same spot is the exact failure `disconnections()` exists to catch —
   * the drawing looks continuous and the network is not — so the drawing
   * gesture that produces it should resolve it instead.
   *
   * Pipes that would run from the node to itself are dropped rather than kept
   * as zero-length loops. */
  function mergeNodes(m, keepId, dropId) {
    if (keepId === dropId) return null;
    var keep = node(m, keepId), drop = node(m, dropId);
    if (!keep || !drop) return null;

    m.pipes.forEach(function (p) {
      if (p.a === dropId) p.a = keepId;
      if (p.b === dropId) p.b = keepId;
    });
    m.pipes = m.pipes.filter(function (p) { return p.a !== p.b; });

    // A device that was attached to the dropped node keeps working: it now
    // hangs off the kept node instead.
    if (!keep.device && drop.device) keep.device = drop.device;

    // Riser attachments must follow, or the column points at a deleted node.
    m.risers.forEach(function (r) {
      r.attachments.forEach(function (att) {
        if (att.node === dropId) att.node = keepId;
      });
    });

    m.nodes = m.nodes.filter(function (n) { return n.id !== dropId; });
    return keep;
  }

  /* If a node is now nothing but a joint in the middle of a straight run,
   * dissolve it so the run is one continuous pipe.
   *
   * Deliberately conservative — it REFUSES unless the two pipes are genuinely
   * interchangeable and genuinely straight:
   *   - both plain pipes (a device or a riser is not a joint to dissolve)
   *   - same schedule, size and C, because a node where the size changes is a
   *     real feature of the model and dissolving it would silently re-size
   *     pipework
   *   - no device on the node
   *   - collinear within the same tolerance the fitting detector uses to say
   *     "no elbow here", so dissolving cannot remove a fitting that was being
   *     charged
   * Returns the surviving pipe, or null if it declined. */
  function dissolveNode(m, nodeId, straightTolDeg) {
    var n = node(m, nodeId);
    if (!n || n.device) return null;
    var ps = pipesAt(m, nodeId);
    if (ps.length !== 2) return null;
    var p1 = ps[0], p2 = ps[1];
    if (p1.kind !== 'pipe' || p2.kind !== 'pipe') return null;
    if (p1.schedule !== p2.schedule || p1.size !== p2.size || p1.C !== p2.C) return null;

    var farA = other(p1, nodeId), farB = other(p2, nodeId);
    if (!farA || !farB || farA === farB) return null;

    var here = worldXY(m, n);
    var wa = worldXY(m, node(m, farA)), wb = worldXY(m, node(m, farB));
    var v1 = { x: wa.x - here.x, y: wa.y - here.y };
    var v2 = { x: wb.x - here.x, y: wb.y - here.y };
    var l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) return null;
    var dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    dot = Math.max(-1, Math.min(1, dot));
    // Collinear through the node means the two directions are OPPOSITE.
    var devDeg = 180 - Math.acos(dot) * 180 / Math.PI;
    if (Math.abs(devDeg) > (straightTolDeg === undefined ? 8 : straightTolDeg)) return null;

    // Keep p1, stretch it across the join, drop p2 and the node.
    if (p1.a === nodeId) p1.a = farB; else p1.b = farB;
    m.pipes = m.pipes.filter(function (p) { return p.id !== p2.id; });
    m.nodes = m.nodes.filter(function (x) { return x.id !== nodeId; });
    return p1;
  }

  /* Turn a directional device round. Swapping the pipe's own endpoints IS the
   * whole operation — every direction-sensitive rule in the engine reads a→b —
   * so both the properties panel and the on-drawing button call this rather
   * than each swapping the fields themselves. */
  function flipPipe(m, id) {
    var p = pipe(m, id);
    if (!p) return null;
    var t = p.a; p.a = p.b; p.b = t;
    return p;
  }

  /* Is this device one that only passes flow one way? A gate valve is not
   * directional; a pump, a piece of equipment and a check valve are. */
  function isDirectional(p) {
    if (!p) return false;
    if (p.kind === 'pump' || p.kind === 'equip') return true;
    return p.kind === 'valve' && !!(p.valve && p.valve.type === 'check');
  }

  /* Set an explicit size / schedule / C override on a riser column, and push it
   * onto every pipe already materialised for that column. An empty size or
   * schedule clears the override (back to inherit / the settings default). */
  function setRiserProps(m, riserId, props) {
    var r = m.risers.find(function (x) { return x.id === riserId; });
    if (!r) return;
    if (props.size !== undefined) r.size = props.size || undefined;
    if (props.schedule !== undefined) r.schedule = props.schedule || undefined;
    if (props.C !== undefined) r.C = props.C;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'riser' || p.riser !== riserId) return;
      if (r.size) p.size = r.size;
      if (r.schedule) p.schedule = r.schedule;
      if (r.C !== undefined && r.C !== null) p.C = r.C;
    });
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

  /* VIEW mode: manual label placement.
   *
   * Auto-placed annotations collide with pipework on anything busy, and on a
   * printed drawing that is the difference between readable and not. Offsets
   * are stored in SCREEN PIXELS rather than metres so a label stays the same
   * distance from its owner at every zoom level — which is what "tidy" means
   * on a drawing, and what carries over to print. */
  /* An entity can carry more than one draggable annotation, so the offset is
   * keyed. The default (no key) is the main label, kept on `labelOffset` so
   * every model saved before this still loads; the disconnection warning glyph
   * uses key 'warn' and stores on `warnOffset`. Sharing one offset meant
   * dragging the warning also moved the node number. */
  function labelOffset(obj, key) {
    if (!obj) return { dx: 0, dy: 0 };
    return obj[key ? key + 'Offset' : 'labelOffset'] || { dx: 0, dy: 0 };
  }

  function setLabelOffset(obj, dx, dy, key) {
    if (!obj) return;
    var prop = key ? key + 'Offset' : 'labelOffset';
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) delete obj[prop];
    else obj[prop] = { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 };
  }

  /* "Reset label positions" has to clear EVERY offset key, or the ones it
   * misses stay put while everything around them snaps back — which reads as
   * the reset having half worked. `warn` is the disconnection glyph, `box` the
   * "Show on drawing" value box. */
  function clearLabelOffsets(m) {
    var keys = ['labelOffset', 'warnOffset', 'boxOffset', 'sensorOffset'];
    var strip = function (o) { keys.forEach(function (k) { delete o[k]; }); };
    m.nodes.forEach(strip);
    m.pipes.forEach(strip);
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
  /* A source's static pressure is a property of the DEVICE, in pascals — not
   * an elevation.
   *
   * It was stored as the node's `dz` until v0.7.7-dev, on the reasoning that a
   * tank raised 20 m provides 200 kPa. Hydraulically that is true, and
   * downstream every number came out right. Geometrically it is a disaster:
   * `dz` is a real elevation offset, `pipeLength` is a 3D distance, so setting
   * 200 kPa on a source silently stretched a 50 m run to 54.01 m — and the
   * length could not be typed back, because `changeLength` was comparing the
   * requested 3D length against a PLAN length and concluded there was nothing
   * to do (debug/20260802-1.json). Pressure and elevation are now independent,
   * which is what they always were. */
  function setSource(m, nodeId, pressure) {
    var n = node(m, nodeId);
    if (n) n.device = { kind: 'source', pressure: pressure || 0 };
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

  /* Apply a named fluid's published properties onto the model.
   *
   * The numbers are COPIED onto settings.fluid rather than looked up on every
   * read. Twenty-odd call sites already read settings.fluid.density directly,
   * and rewriting them all to resolve a preset would have been a large change
   * for no gain — and a saved file that carries its own numbers is readable
   * without this app. `preset` records which fluid they came from so the UI
   * can lock them and the sheet can name it.
   *
   * 'custom' is the exception: it leaves the numbers alone, because they are
   * the engineer's. */
  function applyFluidPreset(m, key) {
    var f = FD.fluids.get(key);
    m.settings.fluid = m.settings.fluid || {};
    m.settings.fluid.preset = f.key;
    if (f.editable) return m.settings.fluid;
    m.settings.fluid.name = f.name;
    m.settings.fluid.density = f.density;
    m.settings.fluid.kinematicViscosity = f.kinematicViscosity;
    m.settings.fluid.specificHeat = f.specificHeat;
    return m.settings.fluid;
  }

  /* Q_load, ΔT and ṁ are locked by Q = ṁ·Cp·ΔT. At design the rated flow is
   * known, so stating any two gives the third — and the ENGINE only ever sees
   * the duty, so there is one quantity to solve with rather than two ways of
   * saying the same thing.
   *
   * The rated flow, not the solved flow: ΔT stated at design means "at design
   * flow", and deriving from a part-load flow would silently restate it. */
  function equipRatedC(m, p) {
    var f = FD.fluids.resolve(m.settings);
    var q = (p.equip && p.equip.qRated) || 0;
    return f.density * q * f.specificHeat;         // W/K
  }
  function equipDutyFromDT(m, p, dT) { return equipRatedC(m, p) * dT; }
  function equipDTFromDuty(m, p, duty) {
    var C = equipRatedC(m, p);
    return C > 0 ? duty / C : 0;
  }

  /* ------------------------------- design flow, load and ΔT are ONE equation
   *
   * Q = ṁ·Cp·ΔT ties the three together, so only two of them are ever
   * independent. Michael's rule, 2026-08-03: editing one recomputes the one
   * you touched LEAST recently, holding the other. Set the flow, then the load,
   * and ΔT follows; then change ΔT and the FLOW moves, because the load is what
   * you said most recently.
   *
   * The alternative — always rewriting the same partner — is what produced the
   * runaway in `debug/20260803-1.json`. A 50 kW coil was given a 15 K ΔT, which
   * silently rewrote its design flow from 20 to 0.8 L/s, and the pump was then
   * sized to push 20 L/s through a machine rated for 0.8. Its ΔP goes as the
   * square, so 625× the rating, and the duty came out at 12 791 m. Every step
   * of that was arithmetically correct.
   *
   * `lastEdited` is the two most recent keys, newest first. It is UI state but
   * it is stored ON THE MODEL deliberately: reopening a file must not silently
   * change which field moves next. Absent, it reads as ['qRated', 'duty'],
   * which is how the panel behaved before this existed: ΔT rewrote the load and
   * left the design flow alone.
   */
  var EQUIP_TRIO = ['qRated', 'duty', 'dT'];

  function equipTrioOrder(e) {
    var prev = (e && e.lastEdited) || [];
    var order = [];
    prev.forEach(function (k) {
      if (EQUIP_TRIO.indexOf(k) >= 0 && order.indexOf(k) < 0) order.push(k);
    });
    ['qRated', 'duty', 'dT'].forEach(function (k) {   // the historic default
      if (order.indexOf(k) < 0) order.push(k);
    });
    return order;
  }

  /* WHERE EACH OF THE THREE LIVES, per equipment type.
   *
   * An exchanger stores the flow and the duty, and ΔT is derived — two of three
   * are enough. A SOURCE/SINK stores all three, because all three are on its
   * panel as nameplate figures: design flow, Heating/Cooling Capacity and
   * Design ΔT. Storing all three means they can drift apart, which is exactly
   * what this helper exists to prevent: every edit rewrites the third.
   *
   * Capacity is SIGNED (§18) and ΔT is a magnitude, so the sign is carried
   * through rather than recomputed — a chiller that is re-flowed is still a
   * chiller. */
  function trioFields(p) {
    var e = (p && p.equip) || {};
    return (e.equipType === 'source')
      ? { duty: 'qMax', dT: 'dTMax' }
      : { duty: 'duty', dT: null };          // dT derived from the pair
  }

  /* Apply an edit to one of the three. Returns the key that was recomputed, or
   * null when nothing needed to move. Mutates `p.equip`. */
  function setEquipTrio(m, p, key, value) {
    var e = p.equip;
    if (!e || EQUIP_TRIO.indexOf(key) < 0) return null;

    /* Clearing a field stores the blank and stops. Recomputing from an empty
     * value would let "I deleted the load" wipe the design flow as well, and a
     * field the user emptied is not a statement about the other two. */
    if (value === undefined || value === null || value === '') {
      /* Through the FIELD MAP, not the raw key. A source/sink keeps its
       * capacity in `qMax`, so clearing it was writing `duty = undefined` and
       * leaving the capacity untouched — "blank = unlimited" simply did not
       * take. Michael, 2026-08-05. */
      var Fc = trioFields(p);
      if (key === 'duty') e[Fc.duty] = undefined;
      else if (key === 'qRated') e.qRated = undefined;
      else if (Fc.dT) e[Fc.dT] = undefined;
      return null;
    }

    var order = equipTrioOrder(e);
    var hold = (order[0] === key) ? order[1] : order[0];
    var third = EQUIP_TRIO.filter(function (k) {
      return k !== key && k !== hold;
    })[0];

    var F = trioFields(p);
    /* THE SIGN IS CARRIED WHEN RECOMPUTING, AND TYPED WHEN TYPED.
     *
     * A duty's sign is the DIRECTION the machine works in (§18), so re-flowing
     * a chiller must leave it a chiller — that is what carrying it is for. But
     * when the engineer types the duty, the sign they typed IS the statement,
     * and applying the stored one over the top makes a cooling load impossible
     * to enter. Michael, 2026-08-05, and it blocked all his testing: typing
     * −60 kW into a coil that held +50 kW came back as +60 kW. */
    var sign = (Number(e[F.duty]) < 0) ? -1 : 1;
    if (key === 'duty' && value !== undefined && value !== null && value !== '') {
      var typed = Number(value);
      if (isFinite(typed) && typed !== 0) sign = (typed < 0) ? -1 : 1;
    }
    function getDuty() { return Math.abs(Number(e[F.duty]) || 0); }
    function setDuty(v) {
      e[F.duty] = (v === undefined) ? undefined : sign * Math.abs(v);
    }
    /* ΔT: stored on a source/sink, derived on an exchanger. Either way it is
     * read BEFORE the edit lands, so the value being held is the one that was
     * on the panel. */
    function getDT() {
      if (F.dT) {
        var d0 = Math.abs(Number(e[F.dT]));
        if (isFinite(d0) && d0 > 0) return d0;
      }
      return Math.abs(equipDTFromDuty(m, p, getDuty()));
    }
    function setDT(v) { if (F.dT) e[F.dT] = (v === undefined) ? undefined : Math.abs(v); }

    var dTBefore = getDT();

    if (key === 'qRated') e.qRated = value;
    else if (key === 'duty') setDuty(value);
    else { dTBefore = Math.abs(value); setDT(dTBefore); }

    if (key === 'dT') {
      if (third === 'duty') setDuty(equipDutyFromDT(m, p, dTBefore));
      else e.qRated = flowForDutyAndDT(m, getDuty(), dTBefore);
    } else if (third === 'duty') {
      setDuty(equipDutyFromDT(m, p, dTBefore));
    } else if (third === 'qRated') {
      e.qRated = flowForDutyAndDT(m, getDuty(), dTBefore);
    } else if (third === 'dT') {
      /* Stored ΔT must be rewritten to stay consistent with the pair; a derived
       * one needs nothing, because it IS the pair. */
      setDT(Math.abs(equipDTFromDuty(m, p, getDuty())));
    }

    e.lastEdited = [key, hold];
    return third;
  }

  /* q = Q / (ρ·Cp·ΔT). Guarded, because a zero ΔT is an infinite flow and a
   * zero load is a zero flow — neither is a pipe. */
  function flowForDutyAndDT(m, duty, dT) {
    var f = FD.fluids.resolve(m.settings);
    var den = f.density * f.specificHeat * dT;
    if (!isFinite(den) || Math.abs(den) < 1e-9) return undefined;
    var q = duty / den;
    return (isFinite(q) && q > 0) ? q : undefined;
  }

  /* ---------------------------------------------------------- pipe sensor
   *
   * An INSTRUMENT, not a device. It reads the water where it sits and states a
   * setpoint for something else to hold. Michael, 2026-08-04, and the case that
   * drove it is THERMOSTATIC MIXING: the quantity being held is a temperature
   * downstream of a blend, and the thing holding it is a valve on one leg or a
   * pump on one branch.
   *
   *   sensor = { mode: 'temperature' | 'flow', tSet: °C, qSet: m³/s }
   *
   * IT IS A PIPE IN EVERY HYDRAULIC SENSE. It has a length, a bore and ordinary
   * friction, and adds NO resistance of its own — a pocket welded into a run is
   * a piece of pipe. That is why `network.build` needs no branch for it: a
   * sensor falls through to the pipe treatment and gets exactly the friction
   * its own 0.5 m earns.
   *
   * The two rejected alternatives are worth recording. Modelling it as
   * EQUIPMENT would give it a design point and therefore a pressure drop that
   * does not exist, and would leak it into everything that treats equipment as
   * plant — the off-rating check, the terminal list, the duty columns. Modelling
   * it as a ZERO-RESISTANCE link would put a singular row in the Jacobian for
   * no benefit at all.
   *
   * It carries no temperature either: it passes straight through, like a pump
   * or a valve (§18). A thermometer that changed the reading would not be one. */
  function sensorSetpoint(p) {
    if (!p || p.kind !== 'sensor' || !p.sensor) return null;
    var sn = p.sensor;
    if (sn.mode === 'flow') {
      var q = Number(sn.qSet);
      return isFinite(q) && q > 0 ? { mode: 'flow', value: q } : null;
    }
    /* PRESSURE (2026-08-05). The commonest real control signal of the three: a
     * pump holding a differential or a header pressure. Read at the sensor's
     * inlet node, so it is the pressure of the water arriving — which is what a
     * tapping on that pipe would read. */
    if (sn.mode === 'pressure') {
      var pr = Number(sn.pSet);
      return isFinite(pr) && pr > 0 ? { mode: 'pressure', value: pr } : null;
    }
    /* DIFFERENTIAL — dP or dT between THIS sensor and a referenced pipe.
     *
     * Michael, 2026-08-05, asked for a floating box that probes two pipes. It
     * is built as a second PIPE REFERENCE on the ordinary in-line sensor
     * instead: the sensor is already a pipe, already drawn, already a valid
     * control target, and already carries a setpoint. Adding "and compare with
     * that pipe" reuses all of it, where a free-standing object would need its
     * own storage, hit-testing, drawing and control wiring for the same
     * measurement.
     *
     * The reading is taken at each sensor's INLET node — the water arriving —
     * so a dP across a set of coils is the difference between the two tappings
     * you would actually fit. */
    if (sn.mode === 'dP' || sn.mode === 'dT') {
      if (!sn.ref) return null;
      var dv = Number(sn.mode === 'dP' ? sn.dpSet : sn.dtSet);
      /* Reported as 'dPdiff'/'dTdiff' rather than 'dP'/'dT'. A piece of
       * EQUIPMENT already offers a setpoint called 'dT' — its own Design ΔT —
       * and the two are different measurements: one is the difference across a
       * single machine, the other between two separate pipes. Sharing a name
       * routed the equipment's ΔT into the differential reader, which then
       * looked for a reference pipe that was never going to be there. */
      return isFinite(dv)
        ? { mode: sn.mode + 'diff', value: Math.abs(dv), ref: sn.ref } : null;
    }
    var t = Number(sn.tSet);
    return isFinite(t) ? { mode: 'temperature', value: t } : null;
  }

  /* WHAT A CONTROLLER MAY FOLLOW, in PRIORITY ORDER.
   *
   * Michael, 2026-08-04. A machine states more than one thing worth holding,
   * and which of them a controller chases is an engineering decision rather
   * than something the app should pick:
   *
   *   SOURCE / SINK    Design LWT, then Design ΔT
   *   HEAT EXCHANGER   Design flow, then Design ΔT
   *   SENSOR           its one setpoint
   *
   * "First, then" is a fallback, not a blend: chase the first, and if it turns
   * out to be unreachable — the actuator on a stop, or backing off making it
   * worse — chase the next instead. Chasing two setpoints at once with one
   * actuator has no answer in general, and pretending otherwise is how a
   * control loop starts oscillating.
   *
   * Each option is toggled on the CONTROLLER (`control.use`), because two pumps
   * following the same machine may legitimately hold different things.
   *
   * `mode` is what gets MEASURED: 'temperature' reads the leaving temperature,
   * 'flow' the flow through the link, 'dT' the magnitude of the difference
   * across it. */
  function controlOptions(m, id) {
    var p = pipe(m, id);
    if (!p) return [];
    if (p.kind === 'sensor') {
      var sp = sensorSetpoint(p);
      return sp ? [{ key: 'set', pipe: p, mode: sp.mode, value: sp.value,
                     ref: sp.ref,
                     label: sp.mode === 'flow' ? 'Flow setpoint'
                          : sp.mode === 'pressure' ? 'Pressure setpoint'
                          : sp.mode === 'dPdiff' ? 'Differential pressure'
                          : sp.mode === 'dTdiff' ? 'Differential temperature'
                          : 'Temperature setpoint' }]
                : [];
    }
    if (p.kind !== 'equip' || !p.equip || p.equip.off) return [];
    var e = p.equip, out = [];

    /* ADIABATIC states nothing to hold — a filter has no setpoint — so it is
     * not a control target at all. */
    if (e.equipType === 'adiabatic') return out;

    if (e.equipType === 'source') {
      var lwt = Number(e.tSet);
      if (isFinite(lwt)) {
        out.push({ key: 'lwt', pipe: p, mode: 'temperature', value: lwt,
                   label: 'Design LWT' });
      }
      var dtm = Math.abs(Number(e.dTMax));
      if (isFinite(dtm) && dtm > 0) {
        out.push({ key: 'dt', pipe: p, mode: 'dT', value: dtm,
                   label: 'Design ΔT' });
      }
      return out;
    }

    // heat exchanger — the flow it needs first, the difference second
    if (e.qRated > 0) {
      out.push({ key: 'flow', pipe: p, mode: 'flow', value: e.qRated,
                 label: 'Design flow' });
    }
    var dt = Math.abs(equipDTFromDuty(m, p, Number(e.duty) || 0));
    if (isFinite(dt) && dt > 1e-9) {
      out.push({ key: 'dt', pipe: p, mode: 'dT', value: dt, label: 'Design ΔT' });
    }
    return out;
  }

  /* The options a given CONTROLLER is actually chasing, in order. Absent a
   * stored choice the FIRST option is on, which is the priority the list is
   * already in. */
  function controlChoice(m, controller) {
    var c = controlOf(controller);
    if (!c) return [];
    var opts = controlOptions(m, c.equip);
    if (!opts.length) return [];

    /* THE USER'S ORDER WINS. `controlOptions` returns a sensible default
     * priority, but which setpoint matters more is an engineering judgement, so
     * the panel lets it be dragged and stores the result as `control.order`.
     * Anything the stored order does not mention keeps its natural position
     * after the ones it does — a machine that grows a new setpoint must not
     * silently drop off the list. */
    var ordered = opts;
    if (c.order && c.order.length) {
      var rank = {};
      c.order.forEach(function (k, i) { rank[k] = i; });
      ordered = opts.slice().sort(function (a, b) {
        var ra = rank[a.key], rb = rank[b.key];
        if (ra === undefined && rb === undefined) return 0;
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return ra - rb;
      });
    }
    var use = c.use;
    if (!use) return [ordered[0]];
    return ordered.filter(function (o) { return use[o.key]; });
  }

  /* Every option this controller could hold, in the order it would chase them —
   * toggles ignored. The panel needs the full list; the engine needs only the
   * ones switched on. */
  function controlOrdered(m, controller) {
    var c = controlOf(controller);
    if (!c) return [];
    var saved = c.use;
    c.use = null;
    var all = controlOptions(m, c.equip);
    c.use = saved;
    if (!all.length || !c.order || !c.order.length) return all;
    var rank = {};
    c.order.forEach(function (k, i) { rank[k] = i; });
    return all.slice().sort(function (a, b) {
      var ra = rank[a.key], rb = rank[b.key];
      if (ra === undefined && rb === undefined) return 0;
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    });
  }

  function canBeControlled(p) {
    if (!p) return false;
    if (p.kind === 'sensor') return true;
    return p.kind === 'equip' && !!p.equip &&
           p.equip.equipType !== 'adiabatic';
  }

  /* ------------------------------------------------------- control links
   *
   * A pump or globe valve can take its setpoint from a piece of equipment: the
   * valve or the pump modulates to hold that machine's leaving temperature.
   * Stored on the CONTROLLER, not the equipment, because one machine's setpoint
   * can be served by more than one device but a device follows exactly one.
   *
   *   control = { equip: pipeId, axis: 'h'|'v', mid: worldCoord }
   *
   * `axis` and `mid` are PRESENTATION only — where the orthogonal route bends.
   * They never touch the calculation, which is why they can be dragged freely.
   * `mid` is a WORLD coordinate rather than a screen offset, because it is an
   * absolute position on the drawing: a label offset follows its owner, a route
   * bend stays where it was put. */
  function controlOf(p) {
    if (!p) return null;
    var c = (p.pump && p.pump.control) || (p.valve && p.valve.control) || null;
    return (c && c.equip) ? c : null;
  }

  /* ------------------------------------------------------ pump speed
   *
   * `pump.speed` is a fraction of rated speed, 1 when absent. It is written by
   * the control loop (network.js) when the pump follows a setpoint, and can be
   * set by hand for a pump that is simply run slow.
   *
   * SPEED APPLIES IN SIMULATION ONLY, and this is the whole of the rule — it is
   * not a UI nicety, it is where the physics is (Michael, 2026-08-03).
   *
   * At part load a pump rides DOWN THE SYSTEM CURVE: less flow, and less head,
   * by n and n². That only happens where the flow is free to respond, which is
   * SIMULATION. In DESIGN the demands IMPOSE the flow, and `autoSizePumps`
   * holds the rated duty on top of that — so scaling the head there does not
   * slow anything down. The sizer simply specifies a bigger pump to overcome
   * the throttling it has been given, and the reported duty goes UP as the
   * speed comes down: 44.8 m at 100% became 179.4 m at 50% on Michael's own
   * model, with the flow pinned at 20.00 L/s throughout. Exactly backwards.
   *
   * That is the same "two controllers on one actuator" conflict that made the
   * control loop SIMULATION-only in v0.11.1 (ARCHITECTURE §17C). The loop was
   * fenced off then and a hand-typed speed was not, which left the conflict
   * reachable through the one door still open.
   *
   * The stored speed is KEPT rather than cleared, so switching back to
   * SIMULATION restores it. It is only ignored.
   *
   * Everything that reads a pump curve must go through `pumpCurve`, or the
   * drawing, the panel and the sheet will each report the RATED curve while the
   * solver runs a scaled one — the same class of mistake as reading `link.r`
   * without the fittings (HANDOVER §2). */
  function pumpSpeed(m, p) {
    if (!p || !p.pump) return 1;
    if (p.pump.mode === 'off') return 0;
    if (!m || !m.settings || m.settings.calcMode !== 'simulation') return 1;
    var s = Number(p.pump.speed);
    if (!isFinite(s) || s <= 0) return 1;
    return Math.min(1, s);
  }

  /* True when a speed is stored but is not being applied, which is the one
   * state worth explaining on the panel: the number is there and does nothing. */
  function pumpSpeedIgnored(m, p) {
    if (!p || !p.pump || p.pump.mode === 'off') return false;
    var s = Number(p.pump.speed);
    if (!isFinite(s) || s <= 0 || s >= 1) return false;
    return !m || !m.settings || m.settings.calcMode !== 'simulation';
  }

  /* THE HEAD THIS PUMP IS ACTUALLY DEVELOPING, at flow q.
   *
   * ONE definition, because three separate readouts have each disagreed with
   * the solver at least once: the drawing did in v0.8.0, the panel and the
   * calculation sheet did until v0.11.3.
   *
   * The rule is "report what the solve used", and it splits on mode:
   *
   *   SIMULATION  the curve IS the input, so the head is the (speed-scaled)
   *               curve read at the solved flow. That point is the intersection
   *               with the system curve, so as speed falls the pump rides DOWN
   *               the system curve — Q by n, H by n².
   *
   *   DESIGN      the solver runs on `pump.head`, and the curve is not in the
   *               calculation at all. Reading the curve here reports a head the
   *               answer never used.
   *
   * That second case is the one Michael caught (2026-08-03). In DESIGN the flow
   * is IMPOSED by the demands, so it does not fall when the pump slows — and a
   * curve read at an unchanged flow gives a HIGHER head as the pump backs off,
   * which is the opposite of riding down the system curve. A pump curve falls
   * with flow, so reading it at a reduced flow always reads UP; that only
   * describes a real machine when the flow reduced because the curve moved. */
  function pumpHead(m, p, q) {
    if (!p || !p.pump || p.pump.mode === 'off') return 0;
    var sim = m && m.settings && m.settings.calcMode === 'simulation';
    if (sim && p.pump.curve) return FD.pumps.head(pumpCurve(m, p), Math.abs(q || 0));
    return p.pump.head || 0;
  }

  function pumpCurve(m, p) {
    if (!p || !p.pump || !p.pump.curve) return null;
    var s = pumpSpeed(m, p);
    if (!(s > 0)) return null;
    return FD.pumps.atSpeed(p.pump.curve, s);
  }

  function canControl(p) {
    if (!p) return false;
    if (p.kind === 'pump') return true;
    /* Only a GLOBE valve. A gate valve is an isolating valve — it is not a
     * regulating device and modulating one is not what it is for. A check
     * valve has no position to set at all. */
    return p.kind === 'valve' && p.valve && p.valve.type === 'globe';
  }

  function setControl(m, p, equipId) {
    if (!canControl(p)) return null;
    /* The target may be a piece of equipment OR a pipe sensor — the link is
     * "follow this setpoint", and a sensor is the general way to state one. */
    var host = (p.kind === 'pump') ? p.pump : p.valve;
    if (!equipId) { delete host.control; return null; }
    var a = deviceMid(m, p), b = deviceMid(m, pipe(m, equipId));
    host.control = {
      equip: equipId,
      axis: (a && b && Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) ? 'h' : 'v',
      mid: null                       // null = halfway, worked out at draw time
    };
    return host.control;
  }

  /* Where an in-line device sits on the drawing: the midpoint of its link. */
  function deviceMid(m, p) {
    if (!p) return null;
    var a = node(m, p.a), b = node(m, p.b);
    if (!a || !b) return null;
    var wa = worldXY(m, a), wb = worldXY(m, b);
    return { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 };
  }

  /* The orthogonal route as a list of world points. One bend is an L, two is a
   * Z — and an L is just the Z whose middle segment has collapsed, so there is
   * one code path and `mid` alone decides which you get. */
  function controlRoute(m, p) {
    var c = controlOf(p);
    if (!c) return null;
    var a = deviceMid(m, p), b = deviceMid(m, pipe(m, c.equip));
    if (!a || !b) return null;
    var horiz = (c.axis !== 'v');
    /* THE MIDDLE SEGMENT IS OFFSET BY 1 m (Michael, 2026-08-05). Halfway
     * between two devices on the SAME run puts the middle segment straight down
     * the pipe, where it is unreadable — a dashed green line lying on top of
     * the pipework it is meant to be distinguished from. One metre off is
     * enough to read and small enough not to look like a route of its own.
     *
     * Only the DEFAULT moves. A `mid` that has been dragged is left exactly
     * where it was put. */
    var CTRL_OFFSET = 1;
    var mid;
    if (c.mid === null || c.mid === undefined) {
      mid = horiz ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
      var along = horiz ? Math.abs(a.y - b.y) : Math.abs(a.x - b.x);
      /* Only when the two ends are level with each other — that is the case
       * where the route would otherwise lie along the pipe. */
      if (along < 1e-6) mid = (horiz ? a.y : a.x) + CTRL_OFFSET;
    } else {
      mid = c.mid;
    }
    /* When the ends are level the offset is PERPENDICULAR to the run, so the
     * route steps off the pipe, along, and back. Otherwise `mid` is the
     * ordinary Z bend along the chosen axis. */
    var level = horiz ? (Math.abs(a.y - b.y) < 1e-6) : (Math.abs(a.x - b.x) < 1e-6);
    var pts;
    if (level && (c.mid === null || c.mid === undefined)) {
      pts = horiz
        ? [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]
        : [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
    } else {
      pts = horiz
        ? [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]
        : [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
    }
    /* Drop a bend that has collapsed onto its neighbour, so an L really is
     * three points and not four with a zero-length segment. */
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var q = pts[i], last = out[out.length - 1];
      if (Math.abs(q.x - last.x) > 1e-9 || Math.abs(q.y - last.y) > 1e-9) out.push(q);
    }
    return { points: out, axis: horiz ? 'h' : 'v', mid: mid, from: a, to: b };
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
    m.settings.thermal = Object.assign(defaultSettings().thermal,
                                       (obj.settings || {}).thermal || {});
    m.settings.control = Object.assign(defaultSettings().control,
                                       (obj.settings || {}).control || {});
    /* Per schedule AND per size, so a shallow merge would replace a whole
     * schedule's row when the file only edited one size of it. */
    m.settings.insulation = {};
    var savedIns = (obj.settings || {}).insulation || {};
    Object.keys(savedIns).forEach(function (k) {
      m.settings.insulation[k] = Object.assign({}, savedIns[k]);
    });
    /* Re-apply the named fluid, so a file cannot carry a preset of '20%
     * Propylene Glycol' with water's properties beside it — whether from a
     * hand edit or from a correction to the published values since it was
     * saved. Custom is left exactly as written. */
    if (m.settings.fluid.preset && m.settings.fluid.preset !== 'custom') {
      applyFluidPreset(m, m.settings.fluid.preset);
    }
    if (!m.settings.calcMode) m.settings.calcMode = 'design';
    m.settings.presentation = Object.assign(defaultSettings().presentation,
                                            (obj.settings || {}).presentation || {});
    m.settings.annotate = Object.assign(defaultSettings().annotate,
                                        (obj.settings || {}).annotate || {});
    m.settings.fittingLD = Object.assign(defaultSettings().fittingLD,
                                         (obj.settings || {}).fittingLD || {});
    /* Per-size, so a shallow merge would replace a whole fitting's row when the
     * file only edited one column of it. */
    m.settings.fittingEL = {};
    var savedEL = (obj.settings || {}).fittingEL || {};
    Object.keys(savedEL).forEach(function (t) {
      m.settings.fittingEL[t] = Object.assign({}, savedEL[t]);
    });
    m.settings.fittingK = (obj.settings || {}).fittingK || {};
    m.customSchedules = obj.customSchedules || {};
    m.levels = obj.levels || m.levels;
    m.nodes = obj.nodes || [];
    m.pipes = obj.pipes || [];
    m.risers = obj.risers || [];
    m.activeLevel = obj.activeLevel || (m.levels[0] && m.levels[0].id);
    m._seq = obj._seq || rebuildSeq(m);
    /* 'ASHRAE' was Hazen-Williams with K fittings; the two Hazen-Williams
     * entries were collapsed into one in v0.8.5 and it charges equivalent
     * length. Rewritten rather than left to fall through `method()`, so the
     * saved file and the UI agree about what was used. */
    if (m.settings.frictionMethod === 'ASHRAE') m.settings.frictionMethod = 'HW';
    migrateEquipThermal(m);
    m.migrations = migrateSourcePressure(m);
    return m;
  }

  /* Files written before v0.7.7-dev carry a source's static pressure in the
   * node's `dz`, which also moved the node in 3D and therefore lengthened
   * every pipe attached to it (see setSource). Move it onto the device and put
   * the node back where it was drawn.
   *
   * This CHANGES PIPE LENGTHS on load — that is the point, it is the fix — so
   * it reports what it did rather than doing it quietly. A source whose `dz`
   * is genuinely an elevation cannot be told apart from one carrying a
   * pressure, because until now the panel offered no way to set the former. */
  /* Equipment had two thermal MODES — state ΔT, or state Q — which v0.10.3
   * replaced with two TYPES: Source/Sink (state a leaving temperature) and
   * Heat Exchanger (state a load). Both old modes were load-led, so both
   * become an exchanger; a stated ΔT is converted to the duty it means at the
   * rated flow, which is the same number said the other way. */
  function migrateEquipThermal(m) {
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip) return;
      var e = p.equip;
      if (!e.equipType) e.equipType = 'exchanger';
      if (e.thermalMode === 'dT' && e.duty === undefined && e.dT !== undefined) {
        e.duty = equipDutyFromDT(m, p, Number(e.dT) || 0);
      }
      delete e.thermalMode;
    });
  }

  function migrateSourcePressure(m) {
    var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
    var notes = [];
    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'source') return;
      if (n.device.pressure !== undefined) return;      // already migrated
      var dz = n.dz || 0;
      n.device.pressure = rho * 9.81 * dz;
      if (!dz) return;
      n.dz = 0;
      notes.push({
        code: 'SOURCE_PRESSURE_MOVED', node: n.id,
        message: 'Source ' + (n.tag || n.id) + ': its ' +
                 (rho * 9.81 * dz / 1000).toFixed(1) + ' kPa static pressure was ' +
                 'stored as a ' + dz.toFixed(2) + ' m elevation, which was ' +
                 'stretching every pipe on it. The pressure is unchanged; the ' +
                 'node is back at its drawn level, so those pipes are now their ' +
                 'true drawn length.'
      });
    });
    return notes;
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
    flipPipe: flipPipe, isDirectional: isDirectional,
    mergeNodes: mergeNodes, dissolveNode: dissolveNode,
    pipesAt: pipesAt, other: other, pipeLength: pipeLength, pipeRise: pipeRise,
    pipeBore: pipeBore,

    addRiser: addRiser, attachRiser: attachRiser, riserPipes: riserPipes,
    riserOpenEnds: riserOpenEnds,
    removeRiser: removeRiser, setRiserProps: setRiserProps,
    copyLevel: copyLevel,
    MIN_OUTFLOW_PRESSURE: MIN_OUTFLOW_PRESSURE,
    outflowResistance: outflowResistance,
    setTrace: setTrace, clearTrace: clearTrace, calibrateTrace: calibrateTrace,

    labelOffset: labelOffset, setLabelOffset: setLabelOffset,
    clearLabelOffsets: clearLabelOffsets,
    displayFlags: displayFlags, setDisplayFlag: setDisplayFlag,

    setSource: setSource, setDemand: setDemand, clearDevice: clearDevice,
    applyFluidPreset: applyFluidPreset,
    controlOf: controlOf, canControl: canControl, setControl: setControl,
    sensorSetpoint: sensorSetpoint,
    controlOptions: controlOptions, controlChoice: controlChoice,
    controlOrdered: controlOrdered,
    canBeControlled: canBeControlled,
    pumpSpeed: pumpSpeed, pumpCurve: pumpCurve,
    pumpSpeedIgnored: pumpSpeedIgnored, pumpHead: pumpHead,
    controlRoute: controlRoute, deviceMid: deviceMid,
    equipRatedC: equipRatedC,
    equipDutyFromDT: equipDutyFromDT,
    equipDTFromDuty: equipDTFromDuty,
    setEquipTrio: setEquipTrio, equipTrioOrder: equipTrioOrder,
    trioFields: trioFields,
    flowForDutyAndDT: flowForDutyAndDT,
    migrateEquipThermal: migrateEquipThermal,
    migrateSourcePressure: migrateSourcePressure,

    toJSON: toJSON, fromJSON: fromJSON
  };
})(window.FD = window.FD || {});
