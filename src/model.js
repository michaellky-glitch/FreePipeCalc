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
      /* DOMESTIC WATER: which IPC E103.3 demand curve a plumbing branch uses,
       * chosen on the HYDRAULIC tab. Only relevant once a Plumbing outflow
       * exists; harmless otherwise. */
      plumbing: { system: 'flushTank' },   // 'flushTank' | 'flushometer'

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
        /* INSULATION THICKNESS, decoupled from the schedule (2026-08-10,
         * Michael). `insulation_mm` is the global default for the whole model;
         * `insulation` is a per-SIZE table the user can fill in (keyed by
         * nominal label, e.g. 'DN50', so it is schedule-independent), editable
         * on the Thermal tab. A pipe's own `insulation_mm` still overrides both,
         * INCLUDING 0 for a bare pipe. This replaced the "25 mm below DN50,
         * 50 mm above" rule that lived on the schedule — 50 mm is the larger of
         * those two, his standard. Files saved before this pick up the 50 mm
         * default and re-solve against it. */
        insulation_mm: 50,             // mm — global default lagging
        insulation: {},                // per-size overrides: { 'DN50': 40, … }

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
        tol: 0.05,                     // K

        /* How many network solves the control loop may spend. 0 = automatic,
         * which scales with the number of controlled devices (40 + 30 each,
         * capped at 400). One solve is a few milliseconds on a model of a few
         * dozen pipes, so the automatic ceiling is of the order of a second in
         * the worst case — and only a model that is genuinely hunting gets
         * near it. Raise it to give an awkward model more room; lower it if a
         * large model feels sluggish while you are drawing. */
        maxSolves: 0
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

      /* THE SHAPE OF A GENERATED PUMP CURVE, as percentages of the duty point.
       * Auto and Manual sizing build a three-point curve from the design duty:
       * shutoff head at Q = 0, the duty point itself, and a runout point.
       *
       * The defaults are the shape the TOOLS generator has always used and the
       * one the NFPA 20 worked example follows. They are a REPRESENTATIVE
       * shape, not manufacturer data — a real curve differs, and Curve sizing
       * exists for when you have one. Tweakable at Michael's request
       * (2026-08-05) because how peaked a curve is changes where a VSD lands
       * and how a parallel set shares. */
      pumpCurve: {
        shutoffPct: 140,      // % of duty head at zero flow
        runoutFlowPct: 150,   // % of duty flow at the runout point
        runoutHeadPct: 65     // % of duty head there
      },
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
      /* `valveOversized` — a CONTROL valve throttling below this much of its
       * travel is doing all its work near the seat, where a small movement is
       * a large change in Kv. That is a selection problem, not a setting one:
       * the valve is too big. Isolation valves are exempt; a cracked-open
       * isolating valve is a deliberate act. */
      /* `heatBalance` is how much of the circulating duty may be quietly
       * absorbed at a source or pinned datum before it is called out, as a
       * PERCENTAGE. A fill connection legitimately carries a trickle; a plant
       * that cannot keep up hides in the same place, and used to do so
       * silently. */
      /* `maxStatic` — IPC 604.8: where the static pressure exceeds 80 psi
       * (552 kPa) a pressure-reducing valve is required. Held as an EDITABLE
       * limit rather than a hard rule (other codes differ, and the figure is
       * Michael's to confirm), checked only in a plumbing file where "static
       * pressure at a fixture" is a defined thing. 0 disables it. */
      warn: { velocity: 2.4, pdm: 400, laminar: true, pumpRunout: 120,
              equipFlowRatio: 2, maxComponentPD: 2000e3, maxStatic: 552e3,
              valveOversized: 10, heatBalance: 2 },
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
        /* Downstream cold FIXTURE UNITS on the pipe — a plumbing-discipline label
         * only (there are no fixture units in a hydronic model). */
        pipeFU: false,
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
      /* DISCIPLINE — a file is ONE discipline (DW re-architecture, 2026-08-16).
       * 'hydronic' (default) is everything the app has always done: the GGA,
       * thermal, controls. 'plumbing' is fixture-unit domestic water, sized by
       * M.plumbingSizing and NEVER by the GGA. Sits a layer above the tab bar,
       * on the repurposed loop-type chip. See docs/DW-MODULE.md → Architecture
       * v2. The two share geometry but not device semantics. */
      discipline: 'hydronic',      // 'hydronic' | 'plumbing'
      settings: defaultSettings(),
      customSchedules: {},
      levels: [],
      nodes: [],
      pipes: [],
      risers: [],
      /* ANNOTATION THAT IS NOT PART OF THE MODEL — free lines and text notes.
       *
       * Michael, 2026-08-07: "These lines do not interact with the model at
       * all, to allow user to draw boxes to represent equipment or rooms."
       * That is the whole specification and it is why they live in their own
       * collections rather than as a kind of pipe: nothing in `network.js`,
       * `thermal.js` or any warning ever looks at them, so there is no path by
       * which a room outline can change an answer. A piece of equipment is
       * 0.5 m on the drawing and a plant room is fifteen; the drawing needs a
       * way to say the second without the calculation hearing it. */
      details: [],
      notes: [],
      _seq: { level: 0, node: 0, pipe: 0, riser: 0, detail: 0, note: 0 }
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
    /* THE SENSOR WAS THE ONE DEVICE THIS DID NOT CARRY, and it was silent.
     *
     * Michael, 2026-08-09: "Using DP sensor is still creating Temperature
     * Sensor." `sensorClick` picks the right default and hands it to
     * `insertInline` → `addPipe`, which copied equip, pump and valve and
     * dropped `sensor` on the floor. The pipe arrived as `kind: 'sensor'` with
     * no sensor object at all, and the properties panel then filled one in with
     * its temperature default — so EVERY sensor came out a temperature sensor
     * whichever button was pressed.
     *
     * It hid well because the rest of the tool worked: `sensorClick` still
     * armed the second-pipe pick for a differential, so a dP sensor asked for
     * its reference pipe and then reported a temperature. */
    if (opts.sensor) p.sensor = opts.sensor; // {mode, tSet, qSet, dpSet, ref}
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
  /* ============================== WHAT A RISER MARKER HAS TO SAY
   *
   * Michael's notation, 2026-08-09, from his own drawings. Two facts, and the
   * symbol carries both at once:
   *
   *   WHICH WAY THE WATER GOES     a chevron: V down, Λ up
   *   WHERE THE COLUMN STOPS       a bar across the end that terminates
   *
   * So on any floor the marker reads:
   *
   *     ‾V   bar above, one chevron   the column starts here and drops:
   *                                   "riser does not go up, flow goes down"
   *     V
   *     V    two chevrons, no bar     it passes straight through, going down
   *     V_   one chevron, bar below   it ends here: "flow from above,
   *                                   riser does not go down"
   *
   * and the mirror of each with Λ for a column carrying water upwards.
   *
   * The bar is NOT decoration: on a floor plan the one thing you cannot see is
   * whether the pipe carries on past this storey, and that is exactly what an
   * engineer reading the plan needs to know.
   *
   * Returns { up, down, capTop, capBottom, dir } or null when this column does
   * not touch the level. `dir` is 'up', 'down' or null when nothing is solved
   * yet — a chevron is a statement about flow and there is none to make. */
  function riserNotation(m, riser, levelId, flows) {
    if (!riser || !riser.attachments) return null;
    var idx = -1;
    riser.attachments.forEach(function (a, i) { if (a.level === levelId) idx = i; });
    if (idx < 0) return null;

    /* Attachments are sorted TOP FIRST (see `attachRiser`), so anything before
     * this one is above it and anything after is below. */
    var hasAbove = idx > 0;
    var hasBelow = idx < riser.attachments.length - 1;

    /* The flow, from whichever segment touches this attachment. A riser pipe is
     * built a = UPPER, b = LOWER (see `riserPipes`), so a POSITIVE flow runs
     * a→b, which is DOWNWARD. Getting that backwards would draw every arrow the
     * wrong way up, so it is spelled out. */
    var dir = null;
    if (flows) {
      var node = riser.attachments[idx].node;
      m.pipes.forEach(function (p) {
        if (dir !== null) return;
        if (p.kind !== 'riser' || p.riser !== riser.id) return;
        if (p.a !== node && p.b !== node) return;
        var q = flows[p.id];
        if (q === undefined || !isFinite(q) || Math.abs(q) < 1e-9) return;
        dir = (q > 0) ? 'down' : 'up';
      });
    }
    return { up: hasAbove, down: hasBelow,
             capTop: !hasAbove, capBottom: !hasBelow, dir: dir };
  }

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
      /* ONE size for the whole column, resolved before any segment is made.
       * Doing it per segment made the answer depend on the order the segments
       * happened to be created in — attachments run top-down, so a column
       * materialised in one go would have inherited from the TOP floor's
       * branch and carried that all the way to the plant. */
      var inherited = null;
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
        if (!r.size && inherited === null) inherited = inheritRiserSize(m, r);
        var p = addPipe(m, top.node, bot.node, {
          kind: 'riser', riser: r.id,
          size: r.size || inherited,
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

  /* ============================ A COLUMN IS INHERITED FROM, NOT JUST A SEGMENT
   *
   * Michael, 2026-08-24: "flow seems to be going through 50 mm vertical pipes...
   * fluid should be following risers, which are 100 mm."
   *
   * It was following the risers. A new segment took the largest bore of the
   * horizontals at its OWN two ends, and nothing above the plantroom has a
   * DN100 horizontal on it — the floors are DN50 branches. So the L0→L1 segment
   * came out DN100 (the plant header is on it) and every segment copied above
   * it came out DN50: a five-storey column carrying the whole building's flow
   * through 50 mm, silently, with a PDM warning as the only sign. Adding a
   * floor is not a decision to reduce the riser.
   *
   * The column's own segments are now part of what a new segment inherits
   * from, so a riser keeps the size it was established at as floors are added
   * on top. Largest bore still wins, which is the rule the panel already
   * states, applied to the COLUMN rather than to one link of it.
   *
   * Only NEW segments are computed — `riserPipes` never re-inherits one that
   * exists — so a taper somebody set deliberately, per segment or with the
   * column override, is untouched. */
  function inheritRiserSize(m, r) {
    var best = null, bestBore = -1;
    var consider = function (size, schedule) {
      var bore = FD.schedules.size(schedule, size, m.customSchedules).id_mm;
      if (bore > bestBore) { bestBore = bore; best = size; }
    };
    r.attachments.forEach(function (att) {
      pipesAt(m, att.node).forEach(function (p) {
        if (p.kind === 'riser') return;
        consider(p.size, p.schedule);
      });
    });
    m.pipes.forEach(function (p) {
      if (p.kind === 'riser' && p.riser === r.id) consider(p.size, p.schedule);
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

  /* WHICH FLAGS DEFAULT ON for this object.
   *
   * A default-ON flag is NOT stored in `obj.show` — `setDisplayFlag` deletes a
   * value equal to its default, to keep the model sparse — so an EMPTY `show`
   * does not mean "nothing is drawn". A plumbing outflow's Tag was invisible
   * for exactly that reason (Michael, 2026-08-18): the renderer bailed on
   * `Object.keys(show).length === 0` before it reached the tag, so the tag only
   * appeared once some OTHER switch had put a key in `show`.
   *
   * Anything that reads `displayFlags` to decide whether there is work to do
   * must ask this too. */
  function displayDefaults(m, obj) {
    var def = {};
    var dev = obj && obj.device;
    if (m && m.discipline === 'plumbing' && dev && dev.kind === 'demand' &&
        dev.demandType === 'plumbing') def.tag = true;
    return def;
  }

  /* Is `key` drawn for this object — the explicit switch if there is one, the
   * default otherwise. */
  function displayShown(m, obj, key) {
    var show = displayFlags(obj);
    return (key in show) ? !!show[key] : !!displayDefaults(m, obj)[key];
  }

  /* `def` is the flag's default (for keys that default ON, e.g. a plumbing
   * outflow's Tag). Setting a flag back to its default deletes it (so the model
   * stays sparse); setting it away from the default stores the explicit value —
   * which for a default-ON key means storing `false`. */
  function setDisplayFlag(obj, key, on, def) {
    if (!obj) return;
    if (!obj.show) obj.show = {};
    if (on === !!def) delete obj.show[key];
    else obj.show[key] = on;
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
  /* ======================================================= COPY AND PASTE
   *
   * A FRAGMENT is a closed piece of drawing: some pipes, every node they touch,
   * and nothing that points outside itself. Michael, 2026-08-09 — "copy one set
   * of PWP, CT, CHWP, ACCH and the pipes up to where it joins the loop."
   *
   * IT IS TWO PURE FUNCTIONS AND A GESTURE, in that order of importance.
   * `extract` and `insert` are model-only and hand-checkable with no browser;
   * the canvas work on top is the easy half. Everything that has ever gone
   * wrong in this project went wrong in the part that could not be tested
   * headlessly, so that is the part this keeps small.
   *
   * THE FOUR KINDS OF REFERENCE, and they are the whole problem:
   *
   *     pipe.a / pipe.b                     the nodes it runs between
   *     pump.control.equip / valve.…        the sensor or machine it follows
   *     sensor.ref                          a differential's second tapping
   *     pump.sync / valve.sync              the device whose position it copies
   *
   * A reference INSIDE the fragment is remapped. A reference OUTSIDE it is
   * DROPPED and reported. Keeping it is worse: the new pump would follow the
   * ORIGINAL's sensor, and two pumps on one sensor is the degenerate case
   * `CONTROL_GANGED` exists to complain about. Dropping it silently is worse
   * again — `CONTROL_TARGET_GONE` is the precedent for saying so.
   *
   * AND EVERYTHING IS DEEP-CLONED WHOLESALE, never field by field. `addPipe`
   * enumerated what to carry and silently dropped `sensor` for as long as
   * differential sensors have existed (fixed v0.16.11); `copyLevel` had the
   * same bug and lost every sensor and every control link on a copied floor.
   * Listing the fields is how that happens, so this lists the fields NOT to
   * copy instead — a much shorter and much more stable list. */

  /* Keys that must never travel with a copy: identity, and solved state. */
  var FRAG_PIPE_SKIP = { id: 1, a: 1, b: 1 };
  var FRAG_NODE_SKIP = { id: 1, level: 1 };

  function cloneBut(o, skip) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) {
      if (skip[k]) return;
      out[k] = (o[k] && typeof o[k] === 'object')
        ? JSON.parse(JSON.stringify(o[k])) : o[k];
    });
    return out;
  }

  /* Every id this pipe points at, and where it lives, so one loop can both
   * report and rewrite them. */
  function pipeRefs(p) {
    var refs = [];
    var host = (p.kind === 'pump') ? p.pump : (p.kind === 'valve') ? p.valve : null;
    if (host && host.control && host.control.equip) {
      refs.push({ kind: 'control', get: function () { return host.control.equip; },
                  set: function (v) { host.control.equip = v; },
                  clear: function () { delete host.control; } });
    }
    if (host && host.sync) {
      refs.push({ kind: 'sync', get: function () { return host.sync; },
                  set: function (v) { host.sync = v; },
                  clear: function () { delete host.sync; } });
    }
    if (p.kind === 'sensor' && p.sensor && p.sensor.ref) {
      refs.push({ kind: 'sensorRef', get: function () { return p.sensor.ref; },
                  set: function (v) { p.sensor.ref = v; },
                  clear: function () { delete p.sensor.ref; } });
    }
    return refs;
  }

  /* ---- EXTRACT. Selection in, closed fragment out.
   *
   * The selection is normalised to PIPES PLUS THE NODES THEY TOUCH, because a
   * pipe without its ends is not a thing that can be drawn. A node selected on
   * its own comes too, so a lone source can be copied.
   *
   * `anchor` is the node the paste will be placed BY. A boundary node — one
   * that a copied pipe and an uncopied pipe both touch — is the natural choice:
   * it is where the fragment met the rest of the drawing, so it is where the
   * copy will want to meet it again. Failing that, the lowest-then-leftmost
   * node, so the answer is stable rather than dependent on selection order. */
  function extractFragment(m, selection) {
    var pickPipe = {}, pickNode = {}, pickDetail = {}, pickNote = {};
    (selection || []).forEach(function (s) {
      if (s.kind === 'pipe') pickPipe[s.id] = true;
      else if (s.kind === 'node') pickNode[s.id] = true;
      else if (s.kind === 'detail') pickDetail[s.id] = true;
      else if (s.kind === 'note') pickNote[s.id] = true;
    });

    var pipes = m.pipes.filter(function (p) {
      /* A RISER LINK IS NOT COPYABLE ON ITS OWN — it is generated from the
       * column, not drawn, and half a column is not a thing. */
      return pickPipe[p.id] && p.kind !== 'riser';
    });
    pipes.forEach(function (p) { pickNode[p.a] = true; pickNode[p.b] = true; });

    var nodes = m.nodes.filter(function (n) { return pickNode[n.id]; });
    var details = (m.details || []).filter(function (d) { return pickDetail[d.id]; });
    var notes = (m.notes || []).filter(function (n) { return pickNote[n.id]; });
    /* Annotation on its own is a valid fragment — detail lines and notes carry
     * no pipework and still copy (Michael, 2026-08-10). */
    if (!nodes.length && !details.length && !notes.length) return null;

    var inSet = {};
    pipes.forEach(function (p) { inSet[p.id] = true; });

    /* What points outside, so the caller can say so rather than discover it. */
    var dropped = [];
    pipes.forEach(function (p) {
      pipeRefs(p).forEach(function (r) {
        var t = r.get();
        if (!inSet[t]) {
          dropped.push({ pipe: p.id, tag: p.tag || null, kind: r.kind, target: t });
        }
      });
    });

    /* BOUNDARY: a copied node that an UNCOPIED pipe also touches. */
    var degreeOut = {};
    m.pipes.forEach(function (p) {
      if (inSet[p.id]) return;
      if (pickNode[p.a]) degreeOut[p.a] = (degreeOut[p.a] || 0) + 1;
      if (pickNode[p.b]) degreeOut[p.b] = (degreeOut[p.b] || 0) + 1;
    });
    var boundary = nodes.filter(function (n) { return degreeOut[n.id]; });
    var anchorFrom = boundary.length ? boundary : nodes.slice();
    anchorFrom.sort(function (a, b) {
      return (a.y - b.y) || (a.x - b.x) || (a.id < b.id ? -1 : 1);
    });

    /* THE FOLLOW POINT. A pipework fragment follows the pointer by an anchor
     * NODE; an annotation-only fragment has no node, so it follows by the
     * lowest-leftmost corner of the detail lines and notes it carries. */
    var anchorNode = anchorFrom.length ? anchorFrom[0] : null;
    var anchorPt;
    if (anchorNode) {
      anchorPt = { x: anchorNode.x, y: anchorNode.y };
    } else {
      var xs = [], ys = [];
      details.forEach(function (d) { (d.pts || []).forEach(function (q) { xs.push(q.x); ys.push(q.y); }); });
      notes.forEach(function (n) { xs.push(n.x); ys.push(n.y); });
      anchorPt = { x: xs.length ? Math.min.apply(null, xs) : 0,
                   y: ys.length ? Math.min.apply(null, ys) : 0 };
    }

    return {
      formatVersion: FORMAT_VERSION,
      level: nodes.length ? nodes[0].level
           : (details.length ? details[0].level : notes[0].level),
      anchor: anchorNode ? anchorNode.id : null,
      anchorPt: anchorPt,
      boundary: boundary.map(function (n) { return n.id; }),
      nodes: nodes.map(function (n) {
        var c = cloneBut(n, FRAG_NODE_SKIP);
        c.id = n.id;                       // kept only as the fragment's own key
        return c;
      }),
      pipes: pipes.map(function (p) {
        var c = cloneBut(p, FRAG_PIPE_SKIP);
        c.id = p.id; c.a = p.a; c.b = p.b;
        return c;
      }),
      details: details.map(function (d) { return JSON.parse(JSON.stringify(d)); }),
      notes: notes.map(function (n) { return JSON.parse(JSON.stringify(n)); }),
      dropped: dropped
    };
  }

  /* ---- INSERT. A fragment, a place to put it, and new ids throughout.
   *
   *   level    which floor it lands on (defaults to the fragment's own)
   *   dx, dy   how far to move it
   *   joinTo   { fragmentNodeId: existingNodeId } — nodes NOT created, reused
   *
   * `joinTo` is how a paste attaches: the anchor is not duplicated, it becomes
   * the existing node, and every pipe that touched it now touches that. Which
   * is exactly what dragging a node onto another already does (§ mergeDropped),
   * done up front instead of afterwards. */
  function insertFragment(m, frag, opts) {
    if (!frag) return null;
    var hasGeom = frag.nodes && frag.nodes.length;
    var hasAnno = (frag.details && frag.details.length) ||
                  (frag.notes && frag.notes.length);
    if (!hasGeom && !hasAnno) return null;
    frag.nodes = frag.nodes || [];
    frag.pipes = frag.pipes || [];
    opts = opts || {};
    var lvl = opts.level || frag.level || m.activeLevel;
    var dx = opts.dx || 0, dy = opts.dy || 0;
    var joinTo = opts.joinTo || {};

    var map = {}, newNodes = [], newPipes = [], retagged = [];

    frag.nodes.forEach(function (n) {
      if (joinTo[n.id]) { map[n.id] = joinTo[n.id]; return; }   // reuse, do not copy
      var c = addNode(m, lvl, n.x + dx, n.y + dy, { dz: n.dz || 0 });
      Object.keys(n).forEach(function (k) {
        if (k === 'id' || k === 'x' || k === 'y' || k === 'level' || k === 'dz') return;
        c[k] = (n[k] && typeof n[k] === 'object')
          ? JSON.parse(JSON.stringify(n[k])) : n[k];
      });
      map[n.id] = c.id;
      newNodes.push(c);
    });

    frag.pipes.forEach(function (p) {
      if (map[p.a] === undefined || map[p.b] === undefined) return;
      var np = addPipe(m, map[p.a], map[p.b], { kind: p.kind, schedule: p.schedule,
                                                size: p.size, C: p.C });
      Object.keys(p).forEach(function (k) {
        if (k === 'id' || k === 'a' || k === 'b' || k === 'riser') return;
        np[k] = (p[k] && typeof p[k] === 'object')
          ? JSON.parse(JSON.stringify(p[k])) : p[k];
      });
      np.riser = null;                    // a copy is never part of a column
      newPipes.push(np);
    });

    /* REFERENCES, once every new id exists. Inside the fragment they are
     * remapped; outside it they go, because a copy that follows the original's
     * sensor is two devices on one measurement. */
    var idMap = {};
    frag.pipes.forEach(function (p, i) { if (newPipes[i]) idMap[p.id] = newPipes[i].id; });
    newPipes.forEach(function (np) {
      pipeRefs(np).forEach(function (r) {
        var t = r.get();
        if (idMap[t]) r.set(idMap[t]); else r.clear();
      });
      /* A SETTLED VFD POSITION IS NOT A DESIGN INPUT. It came out of a solve of
       * a different piece of plant; the control loop resets to full travel
       * anyway, and carrying it makes the copy look like it has already run. */
      if (np.pump && np.pump.speed !== undefined) np.pump.speed = 1;
      /* AND THE TAG MUST BE UNIQUE — on a PASTE.
       *
       * Not on a floor copy, and the difference is the point. A paste drops a
       * second lineup beside the first, where two CHWP-01 is unambiguous
       * nonsense and CHWP-02 is what you would have typed. A floor copy carries
       * a whole storey, where the tags usually encode the floor — AHU-10-01
       * wants to become AHU-11-01, which is a pattern rename this cannot guess,
       * and +1 on the trailing number would give AHU-10-02: worse than leaving
       * it alone and letting the engineer renumber deliberately. */
      if (opts.retag && np.tag) {
        var t2 = uniqueTag(m, np.tag, np.id);
        if (t2 !== np.tag) { retagged.push({ from: np.tag, to: t2, pipe: np.id }); np.tag = t2; }
      }
    });
    newNodes.forEach(function (n) {
      if (!opts.retag || !n.tag) return;
      var t3 = uniqueTag(m, n.tag, n.id);
      if (t3 !== n.tag) { retagged.push({ from: n.tag, to: t3, node: n.id }); n.tag = t3; }
    });

    /* ANNOTATION rides along on the same offset (2026-08-10). New ids, so a
     * copy is its own object; nothing in the engine reads details or notes, so
     * there are no references to remap. */
    var newDetails = [], newNotes = [];
    (frag.details || []).forEach(function (d) {
      var pts = (d.pts || []).map(function (q) { return { x: q.x + dx, y: q.y + dy }; });
      newDetails.push(addDetail(m, lvl, pts, { colour: d.colour, width: d.width }));
    });
    (frag.notes || []).forEach(function (nt) {
      newNotes.push(addNote(m, lvl, nt.x + dx, nt.y + dy, nt.text,
                            { colour: nt.colour, size: nt.size }));
    });

    return { nodes: newNodes, pipes: newPipes, details: newDetails, notes: newNotes,
             map: map, retagged: retagged, dropped: (frag.dropped || []).slice() };
  }

  /* The next free variant of a tag: CHWP-01 -> CHWP-02 -> CHWP-03.
   *
   * Only the TRAILING NUMBER moves, and its width is kept, so CHWP-01 does not
   * become CHWP-2. A tag with no trailing number gets one appended. Anything
   * generated is checked against `looksMangled` before it is returned — the one
   * thing this must never do is manufacture the very shape the repair exists to
   * undo. */
  function uniqueTag(m, tag, selfId) {
    if (!tagTaken(m, tag, selfId)) return tag;
    var mm = String(tag).match(/^(.*?)(\d+)$/);
    var stem = mm ? mm[1] : String(tag) + '-';
    var width = mm ? mm[2].length : 1;
    var n = mm ? parseInt(mm[2], 10) : 1;
    for (var i = 0; i < 999; i++) {
      n++;
      var num = String(n);
      while (num.length < width) num = '0' + num;
      var cand = stem + num;
      if (!tagTaken(m, cand, selfId) && !looksMangled(cand)) return cand;
    }
    return tag;
  }

  function tagTaken(m, tag, selfId) {
    var hit = false;
    m.pipes.forEach(function (p) { if (p.id !== selfId && p.tag === tag) hit = true; });
    m.nodes.forEach(function (n) { if (n.id !== selfId && n.tag === tag) hit = true; });
    return hit;
  }

  /* Every tag used more than once, for the warning in `network.js`. */
  function duplicateTags(m) {
    var seen = {}, dup = {};
    function note(o) {
      if (!o.tag) return;
      if (seen[o.tag]) dup[o.tag] = (dup[o.tag] || [seen[o.tag]]).concat([o.id]);
      else seen[o.tag] = o.id;
    }
    m.pipes.forEach(note);
    m.nodes.forEach(note);
    return Object.keys(dup).map(function (t) { return { tag: t, ids: dup[t] }; });
  }

  /* A WHOLE FLOOR, through the same two functions as a copy-paste.
   *
   * It used to enumerate the fields to carry — kind, schedule, size, C, tag,
   * equip, pump, valve — and therefore dropped every SENSOR and every CONTROL
   * LINK on a copied floor, silently, for as long as sensors have existed.
   * That is the same bug `addPipe` had (v0.16.11), from the same cause, and it
   * is why `extractFragment` clones wholesale instead.
   *
   * The trace is deliberately NOT copied: it is a picture of the floor it came
   * from, and duplicating it onto another level would be actively misleading.
   * A SOURCE is not copied either — a second supply would change the hydraulics
   * without being asked for. */
  /* THE NAME THE NEXT FLOOR UP WANTS. Michael, 2026-08-09: "copying level 10
   * should suggest Level 11."
   *
   * The trailing number is stepped and its printed WIDTH kept, so `Level 09`
   * gives `Level 10` rather than `Level 9`, and `L2` gives `L3`. A name with no
   * number in it gets " 2" appended and then steps normally — `Roof`, `Roof 2`,
   * `Roof 3` — which is ugly and unambiguous, and better than two floors called
   * Roof. Anything already taken steps again. */
  function nextLevelName(m, fromName) {
    var base = String(fromName || 'Level');
    var mm = base.match(/^(.*?)(\d+)(\D*)$/);
    var taken = {};
    m.levels.forEach(function (l) { taken[l.name] = true; });
    if (!mm) {
      var n0 = 2;
      while (taken[base + ' ' + n0] && n0 < 999) n0++;
      return base + ' ' + n0;
    }
    var width = mm[2].length, n = parseInt(mm[2], 10);
    for (var i = 0; i < 999; i++) {
      n++;
      var num = String(n);
      while (num.length < width) num = '0' + num;
      var cand = mm[1] + num + mm[3];
      if (!taken[cand]) return cand;
    }
    return base + ' copy';
  }

  /* ===================================================== NAMING CONVENTION
   *
   * Michael, 2026-08-21. Equipment tags follow a format the engineer sets, so a
   * drawing matches the office standard instead of the program's own habit.
   *
   *     [Prefix 1][Number 1]-[Prefix 2][Number 2]
   *
   * Each PREFIX is 'none' or 'tag' — 'tag' meaning the text the engineer typed,
   * which may contain and end with spaces: "[AHU ][Floor]" gives "AHU 1".
   * Each NUMBER is 'none', 'floor' or 'seq'.
   *
   *   floor — the level's own number, taken from its position in the stack.
   *   seq   — counts up within everything that shares the same rest-of-tag, so
   *           two coils on one floor are 01 and 02 and the count restarts on
   *           the next floor. That is what makes L0-AHU01 / L1-AHU01 work.
   *
   * The separator is dropped when the second half says nothing, so a format of
   * [AHU][Sequence] with nothing after it gives "AHU01", not "AHU01-".
   *
   * Held per model and per equipment kind, so a chiller and a coil can be named
   * differently. `hydronic` only: a plumbing fixture is tagged from its own IPC
   * prefix, which is a different rule with a different reason. */
  var NAMING_DEFAULT = {
    exchanger: { p1: 'none', p1Text: '', n1: 'none',
                 p2: 'tag',  p2Text: 'HX', n2: 'seq' },
    source:    { p1: 'none', p1Text: '', n1: 'none',
                 p2: 'tag',  p2Text: 'HS', n2: 'seq' }
  };

  function namingFor(m, kind) {
    var all = (m.settings && m.settings.naming) || {};
    var d = NAMING_DEFAULT[kind] || NAMING_DEFAULT.exchanger;
    return Object.assign({}, d, all[kind] || {});
  }

  /* The floor NUMBER of a level: its index in the stack, counting from the
   * bottom. Not the name — a level called "Ground" still sits at 0 — and not
   * the altitude, which is a length. */
  function levelNumber(m, levelId) {
    var order = m.levels.map(function (lv) { return lv; })
      .sort(function (a, b) { return (a.altitude || 0) - (b.altitude || 0); });
    for (var i = 0; i < order.length; i++) {
      if (order[i].id === levelId) return i;
    }
    return 0;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* Build one half of a tag. `seq` is filled in by the caller. */
  function namePart(prefixMode, prefixText, numberMode, floorNo, seqNo) {
    var out = (prefixMode === 'tag') ? String(prefixText || '') : '';
    if (numberMode === 'floor') out += String(floorNo);
    else if (numberMode === 'seq') out += (seqNo === null ? '' : pad2(seqNo));
    return out;
  }

  /* The tag a new piece of equipment of `kind` on `levelId` should carry.
   *
   * `seq` counts only within tags that match everything else in the format, so
   * the sequence restarts per floor when the floor is part of the name and runs
   * continuously when it is not. */
  function equipmentTag(m, kind, levelId) {
    var f = namingFor(m, kind);
    var floorNo = levelNumber(m, levelId);
    var left  = namePart(f.p1, f.p1Text, f.n1, floorNo, null);
    var right = namePart(f.p2, f.p2Text, f.n2, floorNo, null);
    var joiner = (left && right) ? '-' : '';

    /* Nothing counts up — the format is a fixed string, so it is the tag. */
    if (f.n1 !== 'seq' && f.n2 !== 'seq') return left + joiner + right;

    /* Otherwise find the lowest free number for this stem. */
    var used = {};
    var reLeft  = left.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var reRight = right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = (f.n1 === 'seq')
      ? new RegExp('^' + reLeft + '(\\d+)' + (right ? '-' + reRight : '') + '$')
      : new RegExp('^' + (left ? reLeft + '-' : '') + reRight + '(\\d+)$');
    m.pipes.forEach(function (p) {
      if (!p.tag) return;
      var mm = String(p.tag).match(re);
      if (mm) used[parseInt(mm[1], 10)] = true;
    });
    var i = 1;
    while (used[i]) i++;

    left  = namePart(f.p1, f.p1Text, f.n1, floorNo, i);
    right = namePart(f.p2, f.p2Text, f.n2, floorNo, i);
    return left + ((left && right) ? '-' : '') + right;
  }

  /* Re-tag every piece of equipment on a level to the current convention.
   *
   * Used after a floor is copied: the copies arrive carrying the tags of the
   * floor they came from, which is the one thing about a duplicated floor that
   * is never right. Equipment only — a pump, valve or sensor keeps its own tag,
   * and so does anything the convention has nothing to say about. */
  function retagLevelEquipment(m, levelId) {
    var done = 0;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'equip' || !p.equip) return;
      var t = p.equip.equipType;
      if (t !== 'exchanger' && t !== 'source') return;
      var host = node(m, p.a);
      if (!host || host.level !== levelId) return;
      var next = equipmentTag(m, t, levelId);
      if (next && next !== p.tag) { p.tag = next; done++; }
    });
    return done;
  }

  function copyLevel(m, fromLevelId, toLevelId) {
    var src = level(m, fromLevelId), dst = level(m, toLevelId);
    if (!src || !dst || src.id === dst.id) return null;

    var here = m.nodes.filter(function (n) { return n.level === fromLevelId; });
    var sel = m.pipes.filter(function (p) {
      if (p.kind === 'riser') return false;
      var a = node(m, p.a), b = node(m, p.b);
      return a && b && a.level === fromLevelId && b.level === fromLevelId;
    }).map(function (p) { return { kind: 'pipe', id: p.id }; })
      .concat(here.map(function (n) { return { kind: 'node', id: n.id }; }));

    var frag = extractFragment(m, sel);
    if (!frag) return { nodes: 0, pipes: 0, risers: 0 };

    /* A SOURCE TRAVELS WITH THE REST. Suppressing it was tried and rejected —
     * forgetting to delete a duplicated source is ordinary user error with an
     * easy way out, whereas silently dropping part of the layout is the worse
     * surprise. (The copy DIALOG claimed the opposite for a long time and the
     * code never did it; the dialog was wrong and is fixed.) */
    var res = insertFragment(m, frag, { level: toLevelId });
    if (!res) return { nodes: 0, pipes: 0, risers: 0 };

    /* Extend any riser column that touches the source floor, so the stack stays
     * connected. Risers are rebuilt from the column, never copied as links. */
    var extended = 0;
    m.risers.forEach(function (r) {
      if (r.attachments.some(function (a) { return a.level === toLevelId; })) return;
      var at = r.attachments.filter(function (a) { return a.level === fromLevelId; })[0];
      if (!at) return;
      var target = res.map[at.node];
      if (target === undefined) return;
      attachRiser(m, r.id, toLevelId, target);
      extended++;
    });
    riserPipes(m);

    return { nodes: res.nodes.length, pipes: res.pipes.length, risers: extended,
             retagged: res.retagged, dropped: res.dropped };
  }

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
        demandType: 'generic',         // 'generic' | 'plumbing' (Domestic Water)
        flow: flow || 0,               // m³/s
        reqPressure: reqPressure || 0, // Pa
        include: true                  // spec §8.2
      };
      /* In a PLUMBING file an outflow is a fixture, so default it to a plumbing
       * outflow (Michael, 2026-08-17) — a water closet, the commonest, with the
       * first variation. The user changes the fixture; they no longer have to
       * switch the type first. */
      if (m.discipline === 'plumbing') {
        n.device.demandType = 'plumbing';
        n.device.fixture = 'waterCloset';
        var vs = FD.plumbing.variations('waterCloset');
        n.device.variation = vs.length ? vs[0].id : null;
        n.device.count = 1;
      }
    }
    return n;
  }

  /* The cold-water FIXTURE UNITS a Plumbing outflow contributes: its per-fixture
   * FU (from IPC E103.3(2), the flush-tank or flushometer value per the HYDRAULIC
   * setting, or a Custom value) times how many of it. A generic outflow, or a
   * missing device, contributes nothing. This is what the DW solver (Phase 2)
   * will accumulate downstream; here it drives the panel and the display tag. */
  function outflowFU(m, dev) {
    if (!dev || dev.kind !== 'demand' || dev.demandType !== 'plumbing') return 0;
    var count = dev.count > 0 ? dev.count : 1;
    /* The per-fixture cold FU now comes from the chosen VARIATION (occupancy ×
     * supply control), not the model-wide system — the HYDRAULIC system setting
     * only picks the FU→flow demand CURVE. Custom carries a typed FU. */
    var per = (dev.fixture === 'custom' || !dev.fixture)
      ? (Number(dev.fu) || 0)
      : plumbingFixtureFU(m, dev.fixture, dev.variation);
    return count * per;
  }

  /* ---- effective (override-aware) plumbing data accessors ----
   * The plumbing HYDRAULIC tab lets the engineer edit the IPC tables per model.
   * Edits live sparsely on `m.settings.plumbing`: `fu` overrides individual
   * fixture-variation FU values, `demand` replaces a whole system's FU→flow
   * curve. These helpers are the ONE place that resolves an override against the
   * shipped default, so sizing, the panel and the sheet cannot disagree. */
  function plumbingFUKey(fixtureId, variationId) {
    return fixtureId + '.' + (variationId || '');
  }
  function plumbingFixtureFU(m, fixtureId, variationId) {
    var ov = m.settings.plumbing && m.settings.plumbing.fu;
    if (ov) {
      var k = plumbingFUKey(fixtureId, variationId);
      if (isFinite(ov[k])) return Number(ov[k]);
    }
    return FD.plumbing.fixtureFU(fixtureId, variationId) || 0;
  }
  /* The user-edited FU→flow curve for a system, or null to use the shipped IPC
   * curve. Stored as [[fu, gpm], …], the same shape and unit as the default, so
   * the interpolator treats an override identically. */
  function plumbingDemandCurve(m, system) {
    var d = m.settings.plumbing && m.settings.plumbing.demand;
    return (d && d[system] && d[system].length) ? d[system] : null;
  }
  /* Total downstream FU → probable simultaneous demand (SI, m³/s), honouring an
   * edited curve. `system` defaults to the model's plumbing system. */
  function plumbingFuToFlow(m, fu, system) {
    system = system || (m.settings.plumbing && m.settings.plumbing.system) || 'flushTank';
    return FD.plumbing.fuToFlow(fu, system, plumbingDemandCurve(m, system));
  }

  /* ---- undiversified fixture supply (IPC Table 604.3) ----
   * The flow ONE fixture supply outlet draws, and the pressure it needs, used by
   * a plumbing SIMULATION (each fixture is a K-terminal at this design point) and
   * by the residual check. Per-model edits to the raw 604.3 outlets live on
   * m.settings.plumbing.supply keyed by id, same as the other tables. */
  function plumbingSupplyValue(m, supplyId) {
    var base = FD.plumbing.fixtureSupply(supplyId) || { gpm: 0, psi: 0 };
    var ov = m.settings.plumbing && m.settings.plumbing.supply;
    var o = ov && ov[supplyId];
    return {
      gpm: (o && isFinite(o.gpm)) ? Number(o.gpm) : base.gpm,
      psi: (o && isFinite(o.psi)) ? Number(o.psi) : base.psi
    };
  }

  /* The DEFAULT design flow & pressure a plumbing outflow takes, from Michael's
   * 604.3 mapping (FD.plumbing.defaultSpec). Returns
   *   { gpm, psi, estimated, label }
   * resolved against the model's (editable) 604.3 values, so an ESTIMATE tracks
   * edits to the outlets it is built from. An explicit `dev.supply` still wins.
   * `estimated` is true for the entries 604.3 does not list directly (shown in
   * red). Custom / unmapped → zero. */
  function plumbingFixtureDefault(m, dev) {
    if (!dev || dev.demandType !== 'plumbing') return { gpm: 0, psi: 0, estimated: false, label: '—' };
    if (dev.supply === 'none') return { gpm: 0, psi: 0, estimated: false, label: '(none)' };

    var res;
    if (dev.supply) {
      var sv0 = plumbingSupplyValue(m, dev.supply);
      var s0 = FD.plumbing.fixtureSupply(dev.supply);
      res = { gpm: sv0.gpm, psi: sv0.psi, estimated: false, label: s0 ? s0.name : dev.supply };
    } else {
      res = specDefault(m, dev);
    }
    /* PER-FIXTURE override from the merged table on the HYDRAULIC tab
     * (m.settings.plumbing.design keyed by fixture.variation). Edited values win
     * over the 604.3 mapping; the `estimated` flag (whether the row was in 604.3)
     * is unchanged, so an edited estimate stays flagged. */
    var ov = m.settings.plumbing && m.settings.plumbing.design;
    var o = ov && ov[dev.fixture + '.' + dev.variation];
    if (o) {
      if (isFinite(o.gpm)) res.gpm = Number(o.gpm);
      if (isFinite(o.psi)) res.psi = Number(o.psi);
    }
    return res;
  }

  /* The 604.3-mapped default before any per-fixture override: a direct outlet or
   * a computed estimate (see FD.plumbing.defaultSpec). */
  function specDefault(m, dev) {
    var spec = FD.plumbing.defaultSpec(dev.fixture, dev.variation);
    if (!spec) return { gpm: 0, psi: 0, estimated: false, label: '—' };
    if (spec.id) {
      var sv = plumbingSupplyValue(m, spec.id);
      var s = FD.plumbing.fixtureSupply(spec.id);
      return { gpm: sv.gpm, psi: sv.psi, estimated: false, label: s ? s.name : spec.id };
    }
    if (spec.estimate === 'ratio') {
      var base = plumbingSupplyValue(m, spec.of);
      var denom = plumbingFixtureFU(m, dev.fixture, spec.denom);
      var r = denom > 0 ? (plumbingFixtureFU(m, dev.fixture, spec.numer) / denom) : 1;
      return { gpm: r * base.gpm, psi: base.psi, estimated: true, label: spec.label };
    }
    if (spec.estimate === 'flowAtP') {
      var b2 = plumbingSupplyValue(m, spec.flowOf);
      return { gpm: b2.gpm, psi: spec.psiPa / FD.plumbing.PSI_TO_PA, estimated: true, label: spec.label };
    }
    if (spec.estimate === 'group') {
      var parts = spec.parts.map(function (id) { return plumbingSupplyValue(m, id); });
      var flows = parts.map(function (p) { return p.gpm; }).sort(function (a, b) { return b - a; });
      var psi = Math.max.apply(null, parts.map(function (p) { return p.psi; }));
      return { gpm: (flows[0] || 0) + (flows[1] || 0), psi: psi, estimated: true, label: spec.label };
    }
    return { gpm: 0, psi: 0, estimated: false, label: '—' };
  }

  /* Undiversified flow of a plumbing outflow (SI, m³/s): the default outlet flow
   * × count. A generic outflow keeps its own flow; a fixture with no default
   * (custom / unmapped) contributes zero. */
  function plumbingUndivFlow(m, dev) {
    if (!dev || dev.kind !== 'demand' || dev.include === false) return 0;
    if (dev.demandType !== 'plumbing') return dev.flow || 0;
    var count = dev.count > 0 ? dev.count : 1;
    return plumbingFixtureDefault(m, dev).gpm * FD.plumbing.GPM_TO_M3S * count;
  }
  /* Required flow pressure at the outlet (SI, Pa). */
  function plumbingReqPressure(m, dev) {
    if (!dev || dev.demandType !== 'plumbing') return (dev && dev.reqPressure) || 0;
    return plumbingFixtureDefault(m, dev).psi * FD.plumbing.PSI_TO_PA;
  }

  /* ===================================================== DOMESTIC-WATER SIZING
   *
   * A plumbing branch is NOT sized by continuity. A pipe's design flow is the
   * GENERIC demand downstream of it (summed linearly) PLUS the diversity flow of
   * the cold FIXTURE UNITS downstream of it — and the FU→flow curve is
   * deliberately sub-additive (IPC Table E103.3), so a plumbing network
   * legitimately does not balance. See docs/DW-MODULE.md.
   *
   * "Downstream" is only defined on a TREE rooted at the source. A plumbing
   * component with a loop, with no source, or with more than one source cannot
   * be sized this way and is returned as an error — never guessed.
   *
   * PURE. It materialises risers (as the GGA build does) and walks the graph; it
   * writes nothing back to the model. The main solve is untouched — this runs
   * ALONGSIDE it for models that carry plumbing outflows, and returns
   *   { ok, error, byPipe, roots, totalFU, totalFlow }
   * where byPipe[pipeId] = { fu, generic, flow } are the DOWNSTREAM totals and
   * the sized flow (SI, m³/s). `error` is a {code, message, nodes?, pipes?}
   * or null. When no plumbing outflow is present, ok:true with an empty byPipe.
   */
  function plumbingSizing(m) {
    var byPipe = {};
    /* ANY OUTFLOW COUNTS, not only a fixture (Michael, 2026-08-19: "Calculation
     * should work with just normal outflows (in which case no FU)"). A branch of
     * generic outflows is a perfectly ordinary domestic-water job — a plant
     * room, a set of hose reels, a process draw — and it was sized as nothing at
     * all because the walk only started from components containing a PLUMBING
     * fixture. Those outflows contribute 0 FU and their flow accumulates
     * linearly, which is already what `ownGeneric` does; the only thing missing
     * was permission to start. */
    var plumbingNodes = m.nodes.filter(function (n) {
      var d = n.device;
      return d && d.kind === 'demand' && d.include !== false;
    });
    if (!plumbingNodes.length) {
      return { ok: true, error: null, byPipe: byPipe, roots: [], totalFU: 0, totalFlow: 0 };
    }

    var system = (m.settings.plumbing && m.settings.plumbing.system) || 'flushTank';
    var demandCurve = plumbingDemandCurve(m, system);   // user-edited, or null

    riserPipes(m);                          // complete the topology (vertical links)
    var pipes = m.pipes;

    // Undirected adjacency, keyed by node id.
    var adj = {};
    m.nodes.forEach(function (n) { adj[n.id] = []; });
    pipes.forEach(function (p) {
      if (!adj[p.a] || !adj[p.b]) return;   // a pipe dangling off a removed node
      adj[p.a].push({ pipe: p.id, to: p.b });
      adj[p.b].push({ pipe: p.id, to: p.a });
    });

    // Own contribution of a node: cold FU if a plumbing outflow, else the
    // generic demand flow if an included generic outflow.
    function ownFU(n) {
      var d = n.device;
      return (d && d.kind === 'demand' && d.include !== false && d.demandType === 'plumbing')
        ? outflowFU(m, d) : 0;
    }
    function ownGeneric(n) {
      var d = n.device;
      return (d && d.kind === 'demand' && d.include !== false && d.demandType !== 'plumbing')
        ? (d.flow || 0) : 0;
    }

    var isSource = {};
    m.nodes.forEach(function (n) { isSource[n.id] = !!(n.device && n.device.kind === 'source'); });

    /* Which connected component each node is in (undirected flood). */
    var comp = {}, comps = [];
    m.nodes.forEach(function (n) {
      if (comp[n.id] !== undefined) return;
      var cid = comps.length, stack = [n.id], members = [];
      comp[n.id] = cid;
      while (stack.length) {
        var u = stack.pop(); members.push(u);
        adj[u].forEach(function (e) {
          if (comp[e.to] === undefined) { comp[e.to] = cid; stack.push(e.to); }
        });
      }
      comps.push(members);
    });

    var roots = [], totalFU = 0, totalFlow = 0, error = null;
    var plumbComps = {};
    plumbingNodes.forEach(function (n) { plumbComps[comp[n.id]] = true; });

    Object.keys(plumbComps).forEach(function (cidStr) {
      if (error) return;
      var cid = Number(cidStr);
      var members = comps[cid];
      var memberSet = {};
      members.forEach(function (id) { memberSet[id] = true; });

      // exactly one source in the component
      var srcs = members.filter(function (id) { return isSource[id]; });
      if (srcs.length === 0) {
        error = { code: 'DW_NO_SOURCE', message:
          'A plumbing branch has no source. Connect a source to the system or ' +
          'check for disconnects.',
          nodes: members.filter(function (id) { return plumbCarrier(id); }) };
        return;
      }
      if (srcs.length > 1) {
        error = { code: 'DW_MULTI_SOURCE', message:
          'Multiple sources are not supported for plumbing systems. Consider ' +
          'splitting the system or use Hydronic mode.', nodes: srcs };
        return;
      }

      // a tree is connected with edges == nodes − 1; more means a loop
      var pipesIn = pipes.filter(function (p) { return memberSet[p.a] && memberSet[p.b]; });
      if (pipesIn.length !== members.length - 1) {
        error = { code: 'DW_LOOP', message:
          'Plumbing loops are not supported. Remove the loop or use generic ' +
          'outflows in Hydronic mode.', pipes: pipesIn.map(function (p) { return p.id; }) };
        return;
      }

      function plumbCarrier(id) {
        var n = node(m, id); return n && ownFU(n) > 0;
      }

      // root at the single source; BFS parent + child order
      var root = srcs[0];
      roots.push(root);
      var parentPipe = {}, order = [], seen = {};
      var q = [root]; seen[root] = true;
      while (q.length) {
        var u = q.shift(); order.push(u);
        adj[u].forEach(function (e) {
          if (!memberSet[e.to] || seen[e.to]) return;
          seen[e.to] = true; parentPipe[e.to] = e.pipe; q.push(e.to);
        });
      }

      // post-order accumulation: subtree totals, leaves first
      var subFU = {}, subGen = {};
      members.forEach(function (id) {
        var n = node(m, id); subFU[id] = ownFU(n); subGen[id] = ownGeneric(n);
      });
      for (var i = order.length - 1; i >= 0; i--) {
        var childId = order[i];
        var pp = parentPipe[childId];
        if (pp === undefined) continue;      // the root has no parent pipe
        var flow = subGen[childId] + FD.plumbing.fuToFlow(subFU[childId], system, demandCurve);
        // fold the child's subtree into its parent
        var parentId = other(pipeById(pipes, pp), childId);
        /* `from`/`to` are the flow DIRECTION on this pipe — source-ward parent to
         * downstream child. The report uses them to sign the flow (for arrows)
         * and to walk the tree for the residual-pressure pass. */
        byPipe[pp] = { fu: subFU[childId], generic: subGen[childId], flow: flow,
                       from: parentId, to: childId };
        subFU[parentId] += subFU[childId];
        subGen[parentId] += subGen[childId];
      }
      totalFU += subFU[root];
      totalFlow += subGen[root] + FD.plumbing.fuToFlow(subFU[root], system, demandCurve);
    });

    if (error) return { ok: false, error: error, byPipe: {}, roots: [], totalFU: 0, totalFlow: 0 };
    return { ok: true, error: null, byPipe: byPipe, roots: roots, totalFU: totalFU, totalFlow: totalFlow };
  }

  function pipeById(pipes, id) {
    for (var i = 0; i < pipes.length; i++) if (pipes[i].id === id) return pipes[i];
    return null;
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
  /* ================================ SET, MIN OR MAX — THE COMPARATOR ON A SETPOINT
   *
   * Michael, 2026-08-25: "The main use case I am foreseeing is for bypass
   * control valves that maintain a minimum flow through chillers. I.e. if the
   * main flow drops below MIN due to downstream valves closing, the bypass
   * valve will open to maintain MIN flow through the chillers."
   *
   *   SET  hold this value. What every setpoint did before, and the default.
   *   MIN  a FLOOR. The controller acts only when the reading is BELOW it, and
   *        otherwise sits wherever it does least — a bypass valve sits shut.
   *   MAX  a CEILING. The mirror: act only when the reading is above it.
   *
   * A MIN is not a target expressed differently. On a bypass valve holding a
   * chiller's minimum flow, SET would demand flow EQUAL to the minimum — and
   * when the system is busy and the flow is comfortably above it, SET cannot
   * get down to it, reports the setpoint lost and parks the valve WIDE OPEN.
   * MIN is satisfied, says nothing, and leaves it shut. That difference is the
   * whole feature.
   *
   * STORED WHERE THE SETPOINT IS, not on the controller: a chiller's minimum
   * flow is a property of the chiller, whichever valve happens to be watching
   * it. Sparse, and absent means SET, so no file needs migrating. */
  var COMPARATORS = ['set', 'min', 'max'];

  /* ==================== THE CRITICAL PATH, CHOSEN BY HAND INSTEAD OF FOUND
   *
   * Michael, 2026-08-25: "to fully resolve the Design calculation issue, we
   * will need to allow the user to select calculating between 2 points (and
   * back) in addition to the current auto method. Otherwise non-obvious things
   * may trip up the users and they will be unable to verify."
   *
   * That is the real argument for it. The automatic index is a defensible
   * choice made from numbers the reader cannot see, and on a model with
   * fourteen near-identical circuits the difference between first and last is
   * under a percent. An engineer who wants to check a specific run against a
   * hand calculation has to be able to NAME it.
   *
   * Stored as two node ids. One of them must sit on a pump, because the tally
   * only means anything as a circuit: out along the run and back to the
   * machine that drives it. Absent means automatic, which is the default and
   * what every existing file does. */
  function criticalManual(m) {
    var c = m && m.settings && m.settings.criticalManual;
    if (!c || !c.a || !c.b) return null;
    if (!node(m, c.a) || !node(m, c.b)) return null;
    return { a: c.a, b: c.b };
  }

  /* Is this node an end of a pump? The rule the picker enforces and the sheet
   * states, in one place so they cannot disagree. */
  function nodeOnPump(m, nodeId) {
    return m.pipes.some(function (p) {
      return p.kind === 'pump' && (p.a === nodeId || p.b === nodeId);
    });
  }

  function setCriticalManual(m, aId, bId) {
    if (!aId || !bId || aId === bId) { delete m.settings.criticalManual; return null; }
    if (!node(m, aId) || !node(m, bId)) return null;
    /* The PUMP end is stored first, whichever the user clicked first — the
     * trace runs from the pump out to the far point and back, and asking the
     * reader to click them in a particular order would be a rule with no
     * reason behind it. */
    var pumpFirst = nodeOnPump(m, aId);
    if (!pumpFirst && !nodeOnPump(m, bId)) return null;
    m.settings.criticalManual = pumpFirst ? { a: aId, b: bId } : { a: bId, b: aId };
    return m.settings.criticalManual;
  }

  function setpointCmp(p, key) {
    if (!p) return 'set';
    var c = null;
    if (p.kind === 'sensor' && p.sensor) c = p.sensor.cmp;
    else if (p.kind === 'equip' && p.equip && p.equip.cmp) c = p.equip.cmp[key];
    return COMPARATORS.indexOf(c) > 0 ? c : 'set';
  }

  function setSetpointCmp(p, key, cmp) {
    if (!p) return null;
    var v = COMPARATORS.indexOf(cmp) > 0 ? cmp : 'set';
    if (p.kind === 'sensor' && p.sensor) {
      if (v === 'set') delete p.sensor.cmp; else p.sensor.cmp = v;
      return v;
    }
    if (p.kind === 'equip' && p.equip) {
      if (v === 'set') {
        if (p.equip.cmp) {
          delete p.equip.cmp[key];
          if (!Object.keys(p.equip.cmp).length) delete p.equip.cmp;
        }
      } else {
        p.equip.cmp = p.equip.cmp || {};
        p.equip.cmp[key] = v;
      }
      return v;
    }
    return null;
  }

  function controlOptions(m, id) {
    var p = pipe(m, id);
    if (!p) return [];
    if (p.kind === 'sensor') {
      var sp = sensorSetpoint(p);
      return sp ? [{ key: 'set', pipe: p, mode: sp.mode, value: sp.value,
                     ref: sp.ref, cmp: setpointCmp(p, 'set'),
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
                   cmp: setpointCmp(p, 'lwt'), label: 'Design LWT' });
      }
      var dtm = Math.abs(Number(e.dTMax));
      if (isFinite(dtm) && dtm > 0) {
        out.push({ key: 'dt', pipe: p, mode: 'dT', value: dtm,
                   cmp: setpointCmp(p, 'dt'), label: 'Design ΔT' });
      }
      return out;
    }

    // heat exchanger — the flow it needs first, the difference second
    if (e.qRated > 0) {
      out.push({ key: 'flow', pipe: p, mode: 'flow', value: e.qRated,
                 cmp: setpointCmp(p, 'flow'), label: 'Design flow' });
    }
    var dt = Math.abs(equipDTFromDuty(m, p, Number(e.duty) || 0));
    if (isFinite(dt) && dt > 1e-9) {
      out.push({ key: 'dt', pipe: p, mode: 'dT', value: dt,
                 cmp: setpointCmp(p, 'dt'), label: 'Design ΔT' });
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

  /* WHERE THE DUTY COMES FROM — 'auto', 'manual' or 'curve'. See ARCHITECTURE
   * §16C.
   *
   * Derived here rather than read straight off `p.pump.sizing`, because a pump
   * that has never had its panel opened does not have one: `insertInline`
   * creates `{mode:'auto', head:20}` and the panel used to be the only thing
   * that filled the field in. Every reader must derive it the same way or they
   * disagree about a pump nobody has clicked on yet — which is exactly how an
   * auto-sized pump reached SIMULATION with no curve (Michael, 2026-08-06). */
  function pumpSizing(p) {
    if (!p || !p.pump) return 'auto';
    if (p.pump.sizing) return p.pump.sizing;
    if (p.pump.curve && p.pump.curve.source === 'fitted') return 'curve';
    return p.pump.mode === 'auto' ? 'auto' : 'manual';
  }

  /* The mode a RUNNING pump should be in for its sizing. 'auto' hands it to
   * `autoSizePumps`; anything else holds the duty it was given. */
  function pumpRunMode(p) { return pumpSizing(p) === 'auto' ? 'auto' : 'fixed'; }

  /* THE THREE-POINT CURVE GENERATED FROM A DESIGN POINT.
   *
   * Shutoff, the duty, and a runout point — the shape an engineer sketches when
   * no manufacturer data is to hand, with the three percentages on SETTINGS.
   *
   * It lives here, not in the panel, because SIMULATION requires a curve and
   * the panel is not always visited: an auto-sized pump drawn and left alone
   * had no curve at all, and the mode switch refused to run. The sizer now
   * calls this itself, so a solve in DESIGN always leaves an auto pump ready to
   * simulate. Michael, 2026-08-06.
   *
   * Never generated for sizing 'curve' — a pasted manufacturer curve is data,
   * not something to be recomputed. Returns the curve, or null if the design
   * point is not yet known. */
  function generateCurve(m, p) {
    if (!p || !p.pump) return null;
    if (pumpSizing(p) === 'curve') return p.pump.curve || null;
    var q = p.pump.qDesign;
    /* ON AUTO THE HEAD IS THE DUTY — `pump.head` is what the sizer just wrote
     * and what the solver ran on, so read it directly. `hDesign` is a REPORT of
     * that, written back after the solve, and reading it here would build the
     * curve from the previous duty on any path that regenerates without solving
     * first (the panel's Re-size button). On manual and curve it is the other
     * way round: `hDesign` is what was typed. */
    var h = (pumpSizing(p) === 'auto')
      ? (p.pump.head > 0 ? p.pump.head : p.pump.hDesign)
      : ((p.pump.hDesign >= 0) ? p.pump.hDesign : p.pump.head);
    if (!(q > 0) || !(h > 0)) { delete p.pump.curve; return null; }
    var shape = (m && m.settings && m.settings.pumpCurve) || {};
    var so = (shape.shutoffPct > 100) ? shape.shutoffPct / 100 : 1.40;
    var rq = (shape.runoutFlowPct > 100) ? shape.runoutFlowPct / 100 : 1.50;
    var rh = (shape.runoutHeadPct > 0 && shape.runoutHeadPct < 100)
      ? shape.runoutHeadPct / 100 : 0.65;
    var c = FD.pumps.fit([
      { q: 0,       h: h * so },
      { q: q,       h: h },
      { q: q * rq,  h: h * rh }
    ]);
    if (!c) { delete p.pump.curve; return null; }
    c.Qd = q;
    c.Hd = h;
    c.source = 'generated';
    p.pump.curve = c;
    return c;
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

  /* ============================================ SYNC: FOLLOW ANOTHER DEVICE
   *
   * Michael, 2026-08-08. The answer to CONTROL_GANGED: link ONE pump to the
   * sensor, and have the rest hold whatever position it lands on.
   *
   * It is a different relationship from a control link and deliberately a much
   * simpler one. A control link says "modulate to hold that setpoint" and needs
   * a search. A sync says "be whatever that one is" — no search, no setpoint,
   * no possibility of two loops disagreeing, which is exactly the failure it
   * exists to avoid.
   *
   * ONLY LIKE TO LIKE. A pump can sync a pump's speed and a valve a valve's
   * opening; a pump cannot sync a valve, because a percentage of travel and a
   * percentage of speed are not the same quantity and pretending otherwise
   * would produce a number with no meaning. */
  function canSync(a, b) {
    if (!a || !b || a === b) return false;
    if (a.kind === 'pump' && b.kind === 'pump') return true;
    if (a.kind === 'valve' && b.kind === 'valve') {
      return canControl(a) && canControl(b);      // globe to globe
    }
    /* HEAT EXCHANGERS SYNC THEIR PART LOAD — Michael, 2026-08-09. Fourteen AHUs
     * on one floor are all at the same percentage on a given day, and setting
     * that fourteen times is the sort of tedium sync exists for. Like to like,
     * as everywhere else: a percentage of duty and a percentage of travel are
     * not the same quantity. */
    if (a.kind === 'equip' && b.kind === 'equip') {
      return !!(a.equip && b.equip &&
                a.equip.equipType === 'exchanger' && b.equip.equipType === 'exchanger');
    }
    return false;
  }

  /* ============================ AN INTEGRATED CONTROL VALVE IS AUTO OR MANUAL
   *
   * Michael, 2026-08-25: "I do want to have a way for the user to do manual
   * balancing if they so wish. Repurpose the ICV toggle to be Manual/Auto. Auto
   * works as it currently does, Manual unlocks (at 100% treat as no valve)."
   *
   *   AUTO    the machine's own controller holds its Design ΔT. The position is
   *           an OUTPUT — the loop writes it in SIMULATION, and DESIGN charges
   *           the valve at full travel (DS.1). The slider is read-only.
   *   MANUAL  a balancing valve set by hand. The position is an INPUT and is
   *           read in BOTH modes, exactly like a drawn valve with no control
   *           link. AT FULL TRAVEL IT IS TREATED AS NO VALVE AT ALL, which is
   *           what the old on/off switch's "off" meant.
   *
   * That last rule is what makes this backward compatible without a migration.
   * A file with no `icv` at all is manual-at-100 by definition: no valve, no
   * resistance, nothing to control. A file WITH an `icv` and no `mode` is the
   * behaviour that shipped, which is Auto. Both read correctly with no data
   * change, so an old file opened here and saved again is unchanged. */
  function icvMode(p) {
    var icv = p && p.equip && p.equip.icv;
    if (!icv) return 'manual';
    return icv.mode === 'manual' ? 'manual' : 'auto';
  }

  /* The opening a MANUAL valve is set to, defaulting to full travel. */
  function icvOpening(p) {
    var icv = p && p.equip && p.equip.icv;
    if (!icv) return 100;
    var o = Number(icv.opening);
    return isFinite(o) ? Math.max(0, Math.min(100, o)) : 100;
  }

  /* Is there a valve in the circuit at all? A manual valve at full travel is
   * not one — see above. Auto always is: DESIGN charges it at full travel and
   * that is a real resistance, deliberately. */
  function icvActive(p) {
    var icv = p && p.equip && p.equip.icv;
    if (!icv || !(icv.kv > 0)) return false;
    if (icvMode(p) !== 'manual') return true;
    return icvOpening(p) < 100;
  }

  function setSync(m, p, leaderId) {
    var host = (p.kind === 'pump') ? p.pump
             : (p.kind === 'valve') ? p.valve
             : (p.kind === 'equip') ? p.equip : null;
    if (!host) return null;
    if (!leaderId) { delete host.sync; return null; }
    var lead = pipe(m, leaderId);
    if (!canSync(p, lead)) return null;
    /* A device cannot sync to something that is itself syncing, or a chain
     * could close on itself and there would be no position to copy. Follow the
     * chain to its head and sync THAT — which is what the user means anyway.
     *
     * THROUGH `syncOf`, which knows all three kinds. This read `head.pump` and
     * `head.valve` and never `head.equip`, so a chain of EXCHANGERS was not
     * collapsed: sync coil C to coil B while B already follows A, and C was
     * left pointing at B. `applySyncedDesign` resolves exactly one level of
     * `syncOf`, so C then copied B's duty in the same pass that B was copying
     * A's — a follower following a follower, one build behind, which is the
     * ganged-set discrepancy sync exists to remove. Pumps and valves were
     * always collapsed correctly; only equipment fell through. */
    /* AND A CHAIN THAT LEADS BACK HERE IS REFUSED, not joined.
     *
     * The walk detected both ways a group can close on itself — the chain
     * arriving back at `p`, and a cycle already in the file — and then broke
     * out and assigned the sync anyway. So syncing the HEAD of a chain to its
     * TAIL built exactly the cycle this code exists to prevent: A leads B, sync
     * A to B, and now A follows B while B follows A. Nothing settles — every
     * build copies each one's position onto the other — and `autoSizePumps`
     * skips anything with a sync, so NEITHER machine gets sized. Refusing is
     * the honest answer: there is no head to this group, so there is no
     * position to copy. */
    var seen = {}, head = lead, closes = false;
    while (head) {
      var nextId = syncOf(head);
      if (!nextId) break;
      if (seen[head.id]) { closes = true; break; }
      seen[head.id] = true;
      var nxt = pipe(m, nextId);
      if (!nxt) break;
      if (nxt.id === p.id) { closes = true; break; }
      head = nxt;
    }
    if (closes || head.id === p.id) return null;
    host.sync = head.id;
    /* A synced device follows a position; it cannot also chase a setpoint. */
    delete host.control;
    return host.sync;
  }

  function syncOf(p) {
    if (!p) return null;
    var host = (p.kind === 'pump') ? p.pump
             : (p.kind === 'valve') ? p.valve
             : (p.kind === 'equip') ? p.equip : null;
    return (host && host.sync) || null;
  }

  /* The position a synced device should be at: its leader's. Returns null when
   * there is no sync, so callers can leave the device alone. */
  function syncedPosition(m, p) {
    var lead = pipe(m, syncOf(p));
    if (!lead) return null;
    if (p.kind === 'pump' && lead.kind === 'pump') {
      var s = Number(lead.pump && lead.pump.speed);
      return isFinite(s) && s > 0 ? Math.min(1, s) : 1;
    }
    if (p.kind === 'valve' && lead.kind === 'valve') {
      var o = Number(lead.valve && lead.valve.opening);
      return isFinite(o) ? Math.max(0, Math.min(100, o)) / 100 : 1;
    }
    /* A COIL COPIES ITS LEADER'S PART LOAD. Reported as a fraction like the
     * others so callers do not have to know which kind they are looking at;
     * `applySyncs` puts it back as a percentage. */
    if (p.kind === 'equip' && lead.kind === 'equip') {
      var pc = Number(lead.equip && lead.equip.loadPct);
      return isFinite(pc) ? Math.max(0, pc) / 100 : null;
    }
    return null;
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
  var CTRL_OFFSET = 1;                  // metres, the default step off the pipe

  /* THE Z (OR C) BETWEEN TWO FIXED POINTS. Three orthogonal segments, and
   * exactly ONE degree of freedom — which is geometry, not a limitation: with
   * both ends pinned, where the middle segment sits determines both bends. Move
   * either one and the other must follow.
   *
   * `axis` names WHICH COORDINATE `mid` is, and therefore which way the middle
   * segment runs:
   *
   *     'h'  mid is an X — the middle segment is VERTICAL
   *     'v'  mid is a  Y — the middle segment is HORIZONTAL
   *
   * One meaning throughout, so the renderer, the drag handler and the stored
   * value cannot disagree. They did until 2026-08-05: the level-ends case below
   * built its route from the OTHER coordinate while the drag handler still
   * wrote this one, so the first drag made the route jump. Michael reported it
   * as "hits some limits or snaps oddly".
   *
   * A C is the same route with `mid` outside the span of the two ends, so both
   * end segments leave the same way. No special case.
   *
   * `midSeg` is the middle segment BEFORE collapsed bends are dropped, so
   * anything that wants to sit on it — the ΔP bubble does — has a well-defined
   * place to sit even when the route has degenerated to an L. */
  /* WAYPOINTS: a route the user has taken over.
   *
   * `zRoute` gives one degree of freedom, which is all a Z between two fixed
   * points HAS. Michael, 2026-08-07, wants more: drag the bends where he likes,
   * and add more of them. So a route may instead carry `pts` — a list of world
   * points between the two ends — and then it is drawn exactly as given.
   *
   * The two live side by side on purpose. Every link starts as a Z, because
   * that needs no decisions and is right most of the time; the first drag of a
   * waypoint, or the first insertion, converts it. Nothing is lost by the
   * conversion (the Z's own bends become the first waypoints) and nothing has
   * to be migrated on load.
   *
   * ORTHOGONALITY IS NOT ENFORCED between waypoints. It cannot be: with three
   * or more free bends there is no unique orthogonal path through them, and
   * snapping each drag to an axis fights the hand that is placing it. The
   * default route is orthogonal and stays so until someone deliberately moves a
   * point off it. */
  function waypointRoute(a, b, pts) {
    var mids = [];
    (pts || []).forEach(function (q) {
      if (q && isFinite(q.x) && isFinite(q.y)) mids.push({ x: q.x, y: q.y });
    });
    var all = [a].concat(mids, [b]);
    /* Drop a point that has landed on its neighbour, so a dragged-together pair
     * does not leave a zero-length segment behind. */
    var out = [all[0]];
    for (var i = 1; i < all.length; i++) {
      var last = out[out.length - 1];
      if (Math.abs(all[i].x - last.x) > 1e-9 || Math.abs(all[i].y - last.y) > 1e-9) {
        out.push(all[i]);
      }
    }
    /* `midSeg` is what carries the ΔP bubble. With waypoints there is no single
     * "middle segment", so it is the middle of the whole run by length — the
     * place a label sits most naturally on any polyline. */
    var mid = midSegmentOf(out);
    return { points: out, waypoints: mids, axis: null, mid: null,
             midSeg: mid, from: a, to: b };
  }

  /* The segment containing the halfway point BY LENGTH along a polyline. */
  function midSegmentOf(pts) {
    if (pts.length < 2) return [pts[0], pts[0]];
    var total = 0, i;
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    var want = total / 2, run = 0;
    for (i = 1; i < pts.length; i++) {
      var d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (run + d >= want || i === pts.length - 1) return [pts[i - 1], pts[i]];
      run += d;
    }
    return [pts[0], pts[1]];
  }

  function zRoute(a, b, axis, mid, pts) {
    if (pts && pts.length) return waypointRoute(a, b, pts);
    var horiz = axis === 'h' ? true
              : axis === 'v' ? false
              /* No stored axis: run the middle segment across the LONGER
               * delta, which is the Z that reads as one gesture rather than as
               * a detour. */
              : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

    /* AN AXIS WHOSE MIDDLE SEGMENT WOULD HAVE ZERO LENGTH IS NOT A ROUTE.
     *
     * With `axis` 'h' the middle segment spans a.y→b.y, so it vanishes when the
     * ends are level; with 'v' it spans a.x→b.x and vanishes when they share a
     * vertical. Either way the three segments collapse into a line that runs
     * out and straight back along itself — which is what two tappings on the
     * same riser produced when the axis was flipped onto them.
     *
     * The stored `mid` goes with it: it is a coordinate on the OTHER axis and
     * would place the route somewhere unrelated. */
    var levelY = Math.abs(a.y - b.y) < 1e-6;
    var levelX = Math.abs(a.x - b.x) < 1e-6;
    if (horiz && levelY && !levelX) { horiz = false; mid = null; }
    else if (!horiz && levelX && !levelY) { horiz = true; mid = null; }

    if (mid === null || mid === undefined) {
      /* THE DEFAULT STEPS 1 m OFF THE PIPE when the two ends are level with
       * each other. Halfway between two devices on the same run puts the middle
       * segment straight down the pipe, where a dashed line is unreadable
       * against the pipework it is meant to be distinguished from.
       *
       * The AXIS for that case was decided above — it is the same condition, so
       * deciding it twice is how the two came to disagree. What is left here is
       * only how far off: 1 m, giving "step off, along, and back". Two tappings
       * on the same vertical riser — the commonest ΔP there is — come out as
       * exactly the C Michael asked for. */
      if (levelY && !horiz) mid = a.y + CTRL_OFFSET;
      else if (levelX && horiz) mid = a.x + CTRL_OFFSET;
      else mid = horiz ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
    }

    var pts = horiz
      ? [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]
      : [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
    /* Drop a bend that has collapsed onto its neighbour, so an L really is
     * three points and not four with a zero-length segment. */
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var q = pts[i], last = out[out.length - 1];
      if (Math.abs(q.x - last.x) > 1e-9 || Math.abs(q.y - last.y) > 1e-9) out.push(q);
    }
    return { points: out, axis: horiz ? 'h' : 'v', mid: mid,
             midSeg: [pts[1], pts[2]], from: a, to: b };
  }

  /* TAKE OVER A ROUTE: freeze whatever it currently draws as waypoints, so the
   * first drag or insertion starts from exactly what is on screen rather than
   * from a default the user has never seen. */
  function routeWaypoints(route) {
    if (!route || !route.points || route.points.length < 3) return [];
    return route.points.slice(1, -1).map(function (q) { return { x: q.x, y: q.y }; });
  }

  /* Add a bend at the midpoint of the LONGEST segment — the one with room for
   * it, and the one a user reaching for "give me another point" is looking at.
   * Returns the new waypoint list. */
  function insertWaypoint(route) {
    var pts = (route && route.points) || [];
    if (pts.length < 2) return routeWaypoints(route);
    var best = 1, bestD = -1;
    for (var i = 1; i < pts.length; i++) {
      var d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (d > bestD) { bestD = d; best = i; }
    }
    var mid = { x: (pts[best].x + pts[best - 1].x) / 2,
                y: (pts[best].y + pts[best - 1].y) / 2 };
    var w = routeWaypoints(route);
    /* `best` indexes into `points`, whose interior is `w` offset by one. */
    w.splice(best - 1, 0, mid);
    return w;
  }

  /* ===================================== IS THIS ENTITY'S TAG DRAWN?
   *
   * Michael, 2026-08-09. A tag is the one label you cannot turn off per item:
   * the "Show on drawing" checkboxes control the VALUE BOX beside a device, and
   * the tag above it was always there. On a dense floor that is a lot of text
   * nobody asked for, and the answer is not to delete the tag — the tag is
   * real, the schedule needs it — but to stop DRAWING it.
   *
   * OFF hides it everywhere except ANNOTATION, where it stays visible in grey
   * and stays selectable. Hiding it there too would leave no way to turn it
   * back on: the only handle on a hidden thing is the mode whose job is
   * arranging hidden things.
   *
   * Stored as `tagOff` rather than `tagOn`, so every existing model — where the
   * key is absent — keeps showing its tags. */
  function tagVisible(o) { return !(o && o.tagOff === true); }
  function setTagVisible(o, on) {
    if (!o) return;
    if (on) delete o.tagOff; else o.tagOff = true;
  }

  /* Which floor a pipe is drawn on. Both ends are always on the same level —
   * a riser is its own kind — so the `a` end answers for it. */
  function pipeLevel(m, p) {
    var n = p && node(m, p.a);
    return n ? n.level : null;
  }

  /* ================================ A CONTROL LINK THAT CHANGES FLOOR
   *
   * Michael, 2026-08-09. A pump on the plant floor following a sensor two
   * storeys up is an ordinary arrangement, and until now it was drawn as
   * NOTHING AT ALL: `drawControlLinks` refused any link whose two ends were not
   * both on the level being drawn, because a straight dashed line between them
   * would cut across a floor it has no business on.
   *
   * So it gets a RISER, exactly as pipework does. One point in world XY where
   * the signal changes floor, drawn on BOTH floors at the same place — on the
   * device's floor a dashed line runs from the device out to it, and on the
   * target's floor another runs from it to the sensor. Read together the two
   * halves meet at the same spot on the plan, which is what makes them legible
   * as one link.
   *
   * It is ANNOTATION, not model: the engine never reads it, and moving it
   * cannot change a number. Stored on the control object beside the routing
   * that is already there. */
  function controlRiser(m, p) {
    var c = controlOf(p);
    if (!c) return null;
    var tgt = pipe(m, c.equip);
    if (!tgt) return null;
    var la = pipeLevel(m, p), lb = pipeLevel(m, tgt);
    if (!la || !lb || la === lb) return null;          // same floor: no riser
    if (c.riser && isFinite(Number(c.riser.x)) && isFinite(Number(c.riser.y))) {
      return { x: Number(c.riser.x), y: Number(c.riser.y) };
    }
    /* DEFAULT: halfway between the two devices in plan. Symmetric, so neither
     * half of the link is a long reach and the other a stub, and it lands
     * somewhere the eye is already looking. */
    var a = deviceMid(m, p), b = deviceMid(m, tgt);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function setControlRiser(m, p, x, y) {
    var c = controlOf(p);
    if (!c || !isFinite(x) || !isFinite(y)) return null;
    c.riser = { x: x, y: y };
    return c.riser;
  }

  /* Does this link cross floors, and which way round? Null when it does not. */
  function controlSpan(m, p) {
    var c = controlOf(p);
    if (!c) return null;
    var tgt = pipe(m, c.equip);
    if (!tgt) return null;
    var la = pipeLevel(m, p), lb = pipeLevel(m, tgt);
    if (!la || !lb || la === lb) return null;
    var riser = controlRiser(m, p);
    return riser ? { device: la, target: lb, riser: riser, targetPipe: tgt } : null;
  }

  /* THE ROUTE, FOR THE FLOOR BEING DRAWN.
   *
   * Same floor, or no level asked for: unchanged, and that is every existing
   * caller. Crossing floors: the LEG that belongs to `levelId` — device to
   * riser, or riser to target — and null for any other floor, so a link that
   * has nothing to do with this plan draws nothing.
   *
   * Without a `levelId` a crossing link returns null rather than the straight
   * A-to-B route it used to compute: that route ran across a floor it does not
   * belong to, and returning it would put it back on the drawing. */
  function controlRoute(m, p, levelId) {
    var c = controlOf(p);
    if (!c) return null;
    var tgt = pipe(m, c.equip);
    var a = deviceMid(m, p), b = deviceMid(m, tgt);
    if (!a || !b) return null;

    var span = controlSpan(m, p);
    if (!span) {
      /* SAME FLOOR — and it must be THIS floor. Michael, 2026-08-09: "control
       * links seem to be visible on all levels (e.g. L0 links visible at L2)."
       *
       * A regression from v0.16.9, and mine. The filtering used to be written
       * out at both call sites — "both ends on the level being drawn" — and
       * moving it in here dropped the level test for the ordinary case, because
       * a link that does not span has no span to check it against. Asked
       * without a floor it still answers, which is what the printer and the
       * bend-adding button need. */
      if (levelId && pipeLevel(m, p) !== levelId) return null;
      return zRoute(a, b, c.axis, c.mid, c.pts);
    }
    if (!levelId) return null;
    if (levelId === span.device) return zRoute(a, span.riser, c.axis, c.mid, c.pts);
    if (levelId === span.target) {
      /* The far leg keeps its own routing, or the two halves would share one
       * axis and one mid and fight over them. */
      var f = c.far || {};
      return zRoute(span.riser, b, f.axis, f.mid, f.pts);
    }
    return null;
  }

  /* THE DIFFERENTIAL SENSOR'S ROUTE — the same Z, between the two tappings.
   *
   * Michael, 2026-08-06: "Could we just draw a C/Z between the 2 points and put
   * the dP symbol at the geometric center of the middle section?" That replaces
   * a bubble hung off the sensor's own pipe plus a separate reference line —
   * two leaders that had to be kept from colliding with each other, and did not
   * manage it. One route between the two things being measured says what a ΔP
   * is far better, and it is the same object the control link already is.
   *
   * Null when the sensor is not differential or has no reference yet. */
  /* WHERE THE SECOND TAPPING SITS ON ITS PIPE. `refT` is the fraction along it,
   * defaulting to the middle.
   *
   * A tapping is a physical point on a run and the middle is rarely where you
   * would actually fit one — Michael, 2026-08-06: "please also allow the user
   * to drag the second point of the dP/dT sensor along the pipe". It moves the
   * DRAWING only: the reading is taken at the pipe's inlet node either way,
   * because a pipe is one link with one pressure at each end and there is no
   * pressure profile along it to read from. */
  function sensorRefPoint(m, p) {
    var ref = pipe(m, p.sensor.ref);
    if (!ref) return null;
    var a = node(m, ref.a), b = node(m, ref.b);
    if (!a || !b) return null;
    var wa = worldXY(m, a), wb = worldXY(m, b);
    var t = Number(p.sensor.refT);
    if (!isFinite(t)) t = 0.5;
    t = Math.max(0, Math.min(1, t));
    return { x: wa.x + (wb.x - wa.x) * t, y: wa.y + (wb.y - wa.y) * t,
             pipe: ref, t: t };
  }

  function sensorRoute(m, p) {
    if (!p || p.kind !== 'sensor' || !p.sensor) return null;
    var sm = p.sensor.mode;
    if (sm !== 'dP' && sm !== 'dT') return null;
    if (!p.sensor.ref) return null;
    var a = deviceMid(m, p), b = sensorRefPoint(m, p);
    if (!a || !b) return null;
    var r = p.sensor.route || {};
    return zRoute(a, { x: b.x, y: b.y }, r.axis, r.mid, r.pts);
  }

  // ------------------------------------------------- drawing annotation
  /* A FREE LINE. `pts` are world points on ONE level; `colour` is an index into
   * the palette the panel offers, not a CSS string, so a theme change cannot
   * leave a drawing full of colours that vanish against the new background. */
  function addDetail(m, levelId, pts, opts) {
    opts = opts || {};
    var d = {
      id: uid('D', m._seq.detail++),
      level: levelId,
      pts: (pts || []).map(function (q) { return { x: q.x, y: q.y }; }),
      colour: opts.colour || 'line',
      width: opts.width || 1.5
    };
    m.details.push(d);
    return d;
  }

  function addNote(m, levelId, x, y, text, opts) {
    opts = opts || {};
    var n = {
      id: uid('X', m._seq.note++),
      level: levelId,
      x: x, y: y,
      text: text || 'Note',
      colour: opts.colour || 'line',
      size: opts.size || 13
    };
    m.notes.push(n);
    return n;
  }

  function removeDetail(m, id) {
    m.details = m.details.filter(function (d) { return d.id !== id; });
  }
  function removeNote(m, id) {
    m.notes = m.notes.filter(function (n) { return n.id !== id; });
  }

  /* THE PALETTE. Named rather than hex so both themes can answer for
   * themselves, and so a file written in dark mode is legible in light. */
  var DETAIL_COLOURS = ['line', 'ok', 'warn', 'error', 'accent', 'select'];

  /* THE SHORTEST RUN OF PIPEWORK BETWEEN TWO PIPES.
   *
   * Michael, 2026-08-08: shift-click the far end of a run and everything
   * between is selected. Two jobs at once — a quick way to give a whole line
   * the same size, and a CONNECTIVITY CHECK, because if the two ends are not
   * actually joined the selection comes back empty and says so. On a drawing
   * where a tee looks made and is not, that is the fastest test there is.
   *
   * Breadth-first over the NODE graph, so "shortest" means fewest pipes rather
   * than least metres — which is what someone tracing a run is counting. Risers
   * are included: a column IS a connection, and a path that refused to climb
   * would report two floors of one system as unconnected.
   *
   * Returns the pipe ids along the path INCLUDING both ends, or null when there
   * is no path at all. */
  function pathBetween(m, fromId, toId) {
    var from = pipe(m, fromId), to = pipe(m, toId);
    if (!from || !to) return null;
    if (fromId === toId) return [fromId];

    var adj = {};
    m.pipes.forEach(function (p) {
      (adj[p.a] = adj[p.a] || []).push({ pipe: p.id, to: p.b });
      (adj[p.b] = adj[p.b] || []).push({ pipe: p.id, to: p.a });
    });

    /* Start from BOTH ends of the first pipe — a run can be traced in either
     * direction and neither end is privileged. */
    var goal = {}; goal[to.a] = true; goal[to.b] = true;
    var seen = {}, prev = {}, queue = [];
    [from.a, from.b].forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true; prev[id] = null; queue.push(id);
    });

    var hit = null;
    for (var i = 0; i < queue.length && !hit; i++) {
      var here = queue[i];
      if (goal[here] && (here !== from.a && here !== from.b)) { hit = here; break; }
      (adj[here] || []).forEach(function (e) {
        if (seen[e.to] || e.pipe === fromId) return;
        seen[e.to] = true;
        prev[e.to] = { node: here, pipe: e.pipe };
        queue.push(e.to);
        if (goal[e.to] && !hit) hit = e.to;
      });
    }
    /* The two pipes may simply share a node. */
    if (!hit && (goal[from.a] || goal[from.b])) return [fromId, toId];
    if (!hit) return null;

    var out = [toId], at = hit, guard = 0;
    while (prev[at] && guard++ < 10000) {
      if (out.indexOf(prev[at].pipe) < 0) out.push(prev[at].pipe);
      at = prev[at].node;
    }
    if (out.indexOf(fromId) < 0) out.push(fromId);
    return out;
  }

  /* ============================================ MANGLED TAGS
   *
   * A tag with one or more GENERATED tags stuck on the end of it —
   * `CHWP-04PMP-1PMP-1PMP-1`, `CHWP-0AHU-15AHU-152`. Michael has now hit this
   * twice (2026-08-07 and again on 2026-08-08 with the first fix in place), and
   * the route that produces it is still not identified.
   *
   * So it is attacked from the other end as well: whatever writes it, the shape
   * is recognisable and the damage is repairable. `looksMangled` refuses one at
   * the point of entry; `repairTags` puts existing ones right, and says which
   * it touched rather than editing a drawing behind the user's back.
   *
   * The prefixes are exactly the ones `nextTag` can produce, plus `AHU`, which
   * it no longer produces but every file written before 2026-08-23 is full of.
   * A tag that is ITSELF a generated one is left alone — `PMP-1` is a perfectly
   * good tag; it is `<something>PMP-1` that cannot have been typed. */
  var GENERATED_TAG = /(?:PMP|AHU|HX|HS|TS|PS|FS|DPS|DTS|SRC|OF|STR)-\d+/;
  var TRAILING_GENERATED = /^(.+?)((?:(?:PMP|AHU|HX|HS|TS|PS|FS|DPS|DTS|SRC|OF|STR)-\d+)+)$/;
  var PLAIN_GENERATED = /^(?:PMP|AHU|HX|HS|TS|PS|FS|DPS|DTS|SRC|OF|STR)-\d+$/;
  var GENERATED_G = /(?:PMP|AHU|HX|HS|TS|PS|FS|DPS|DTS|SRC|OF|STR)-\d+/g;

  /* ============================== WHAT THE MANGLING ACTUALLY LOOKS LIKE
   *
   * Measured on Michael's data centre, 2026-08-09, and it changed the repair.
   * The old rule assumed a generated tag was APPENDED, and stripped a trailing
   * run. Two of his three tags were not that shape:
   *
   *   CHWP-0AHU-15AHU-152     the real tag is CHWP-02
   *   PWP-04MP-4MP-4…×7       the real tag is PWP-04
   *
   * The first says the generated tag is INSERTED AT A CARET, not appended: the
   * tail of the real tag ("2") is stranded after it, and inserting twice buries
   * it further. Stripping the trailing run gave `CHWP-0` — plausible, wrong,
   * and silently so. Removing the repeated token from WHEREVER IT SITS gives
   * `CHWP-02`, which is the answer.
   *
   * The second says the inserted text can be a TRUNCATED generated tag —
   * `MP-4` is `PMP-4` with its first character absorbed — so matching whole
   * generated tags misses it entirely. A hyphenated group repeated at the end
   * catches it, and nothing legitimate ends in the same hyphenated group twice.
   *
   * TWO RULES, BOTH CONSERVATIVE. A false positive renames a tag that was
   * correct, which is worse than missing one, so both require REPETITION or a
   * trailing position — never a single generated tag sitting in the middle of
   * a name, which is how `SUB-AHU-12-A` stays safe. */

  /* The repaired form of a tag, or null when there is nothing to repair. */
  function repairedTag(tag) {
    if (!tag) return null;
    var t = String(tag);
    if (PLAIN_GENERATED.test(t)) return null;      // a plain generated one

    var out = t;

    /* RULE 1 — a whole generated tag that appears MORE THAN ONCE, removed
     * wherever it sits. Candidates include the digit-truncations of each match,
     * because a greedy match on `CHWP-0AHU-15AHU-152` reads `AHU-152` and the
     * token that actually repeats is `AHU-15`. Longest winning candidate first,
     * so the most specific repeat is the one removed. */
    var cands = {};
    (out.match(GENERATED_G) || []).forEach(function (mt) {
      for (var k = mt.length; k >= 4; k--) {
        var c = mt.slice(0, k);
        if (PLAIN_GENERATED.test(c)) cands[c] = true;
      }
    });
    Object.keys(cands)
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (c) {
        var parts = out.split(c);
        if (parts.length < 3) return;              // fewer than two occurrences
        var joined = parts.join('');
        if (joined.length) out = joined;
      });

    /* RULE 2 — a trailing group repeated, for the truncated case. The unit must
     * contain a hyphen: without that, `AHU-1212` would be read as `12` twice
     * and stripped back to `AHU-`, which is a real tag destroyed. */
    var rep = out.match(/^(.*?)((.*?-\d+)\3+)$/);
    if (rep && rep[1].length && rep[3].indexOf('-') >= 0) out = rep[1];

    /* RULE 3 — the original rule, for a plain appended run, PLUS a guard the
     * original did not have.
     *
     * `B2-AHU-7` is a perfectly good hierarchical tag — block 2, AHU 7 — and
     * the original rule stripped it to `B2-`, because by shape alone it is
     * indistinguishable from `CHWP-04PMP-1`. The discriminator is what the head
     * looks like: a real mangling leaves a COMPLETE tag behind it (`CHWP-04`),
     * a hierarchical name leaves a dangling separator (`B2-`). So the head must
     * end in something that could end a tag.
     *
     * Found by writing the false-positive half of the test, 2026-08-09, and it
     * was there before any of this. */
    var mm = out.match(TRAILING_GENERATED);
    if (mm && mm[1].length && !GENERATED_TAG.test(mm[1] + 'x') &&
        /[A-Za-z0-9]$/.test(mm[1])) out = mm[1];

    return (out !== t && out.length) ? out : null;
  }

  function looksMangled(tag) {
    return repairedTag(tag) !== null;
  }

  /* Put existing tags right. Returns a list of what changed — never silent, and
   * never automatic, because it edits names on a drawing.
   *
   * THE MANGLING IS LOSSY, so a repair is a BEST GUESS and the caller says so:
   * `CHWP-0AHU-15AHU-152` comes back as `CHWP-02` only because the stranded
   * "2" survived, and a mangling that ate it would be unrecoverable. */
  function repairTags(m) {
    var fixed = [];
    function fix(o) {
      if (!o) return;
      var to = repairedTag(o.tag);
      if (to === null) return;
      fixed.push({ id: o.id, from: o.tag, to: to });
      o.tag = to;
    }
    m.pipes.forEach(fix);
    m.nodes.forEach(fix);
    return fixed;
  }

  /* SPLIT A PIPE AT AN EXISTING NODE, making a tee.
   *
   * The pipe becomes two, meeting at `nodeId`, each keeping the original's
   * schedule, size and C — a tee in a run is the same pipe on both sides of it,
   * and inventing a size change would be a statement nobody made. The original
   * is removed rather than shortened so nothing downstream sees a pipe whose
   * ends have quietly changed.
   *
   * Refused on anything that is not a plain pipe: splitting a pump or a coil
   * has no meaning, and a riser link is generated rather than drawn. Refused
   * too when the node is already one of the ends, which would make a
   * zero-length pipe.
   *
   * Returns the two new pipes, or null. */
  function splitPipeAt(m, pipeId, nodeId) {
    var p = pipe(m, pipeId), n = node(m, nodeId);
    if (!p || !n || p.kind !== 'pipe') return null;
    if (p.a === nodeId || p.b === nodeId) return null;
    var a = node(m, p.a), b = node(m, p.b);
    if (!a || !b) return null;
    var opts = { kind: 'pipe', schedule: p.schedule, size: p.size, C: p.C };
    if (p.temperature !== undefined) opts.temperature = p.temperature;
    var aId = p.a, bId = p.b;
    removePipe(m, pipeId);
    return { first: addPipe(m, aId, nodeId, opts),
             second: addPipe(m, nodeId, bId, opts) };
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
    /* Discipline: default 'hydronic' so every file written before the DW
     * re-architecture (2026-08-16) opens as what it was. Only 'plumbing' is the
     * alternative; anything else is coerced to the default. */
    m.discipline = (obj.discipline === 'plumbing') ? 'plumbing' : 'hydronic';
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
    m.settings.pumpCurve = Object.assign(defaultSettings().pumpCurve,
                                         (obj.settings || {}).pumpCurve || {});
    /* Deep-merge plumbing so a file that carries only `system` (or only an
     * edited table) keeps the other keys' defaults, and the editable-table
     * overrides (`fu`, `demand`) survive a round trip. */
    m.settings.plumbing = Object.assign(defaultSettings().plumbing,
                                        (obj.settings || {}).plumbing || {});
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
    m.details = obj.details || [];
    m.notes = obj.notes || [];
    m.activeLevel = obj.activeLevel || (m.levels[0] && m.levels[0].id);
    m._seq = obj._seq || rebuildSeq(m);
    /* A FILE WRITTEN BEFORE DETAILS AND NOTES EXISTED has a `_seq` without
     * counters for them, and `undefined++` is NaN — every annotation added to
     * such a model came out as `DNaN`, all sharing one id and therefore
     * undeletable. Filled in AFTER `_seq` is restored, because restoring it
     * replaces the object wholesale. */
    if (!isFinite(m._seq.detail)) m._seq.detail = m.details.length;
    if (!isFinite(m._seq.note)) m._seq.note = m.notes.length;
    /* 'ASHRAE' was Hazen-Williams with K fittings; the two Hazen-Williams
     * entries were collapsed into one in v0.8.5 and it charges equivalent
     * length. Rewritten rather than left to fall through `method()`, so the
     * saved file and the UI agree about what was used. */
    if (m.settings.frictionMethod === 'ASHRAE') m.settings.frictionMethod = 'HW';
    migrateEquipThermal(m);
    migrateControlIterations(m);
    m.migrations = migrateSourcePressure(m);
    return m;
  }

  /* `control.sweeps` became `control.iterations` (WORKLIST SW.2).
   *
   * The user-facing wording changed to "iteration" back in v0.16.x — Michael,
   * 2026-08-12 — and only the internals were left saying sweep. Renaming the
   * SAVED key is the part that needs care, because a file written before this
   * carries the old one and a bare rename would silently reset everybody's
   * settling count to the default of six. This moves it.
   *
   * The new key wins if both are present: a file round-tripped through this
   * version and then opened in an older one would come back carrying both, and
   * the value the current app wrote is the one the user last chose. */
  function migrateControlIterations(m) {
    var c = m.settings && m.settings.control;
    if (!c) return;
    if (c.iterations === undefined && c.sweeps !== undefined) {
      c.iterations = c.sweeps;
    }
    delete c.sweeps;
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
        message: (n.tag || n.id) + ' static pressure ' +
                 (rho * 9.81 * dz / 1000).toFixed(1) + ' kPa is stored as ' +
                 dz.toFixed(2) + ' m elevation. A vertical pipe was created.'
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
      riser: maxId(m.risers, 'R'),
      detail: maxId(m.details || [], 'D'),
      note:  maxId(m.notes || [], 'X')
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
    riserOpenEnds: riserOpenEnds, riserNotation: riserNotation,
    removeRiser: removeRiser, setRiserProps: setRiserProps,
    copyLevel: copyLevel,
    namingFor: namingFor, levelNumber: levelNumber,
    equipmentTag: equipmentTag, retagLevelEquipment: retagLevelEquipment,
    NAMING_DEFAULT: NAMING_DEFAULT,
    MIN_OUTFLOW_PRESSURE: MIN_OUTFLOW_PRESSURE,
    outflowResistance: outflowResistance,
    setTrace: setTrace, clearTrace: clearTrace, calibrateTrace: calibrateTrace,

    labelOffset: labelOffset, setLabelOffset: setLabelOffset,
    clearLabelOffsets: clearLabelOffsets,
    displayFlags: displayFlags, setDisplayFlag: setDisplayFlag,
    displayDefaults: displayDefaults, displayShown: displayShown,

    setSource: setSource, setDemand: setDemand, outflowFU: outflowFU,
    plumbingSizing: plumbingSizing,
    plumbingFixtureFU: plumbingFixtureFU, plumbingFuToFlow: plumbingFuToFlow,
    plumbingDemandCurve: plumbingDemandCurve, plumbingFUKey: plumbingFUKey,
    plumbingSupplyValue: plumbingSupplyValue, plumbingUndivFlow: plumbingUndivFlow,
    plumbingReqPressure: plumbingReqPressure, plumbingFixtureDefault: plumbingFixtureDefault,
    plumbingSpecDefault: specDefault,
    clearDevice: clearDevice,
    applyFluidPreset: applyFluidPreset,
    controlOf: controlOf, canControl: canControl, setControl: setControl,
    sensorSetpoint: sensorSetpoint,
    controlOptions: controlOptions, controlChoice: controlChoice,
    controlOrdered: controlOrdered,
    canBeControlled: canBeControlled,
    pumpSpeed: pumpSpeed,
    pumpSizing: pumpSizing, pumpRunMode: pumpRunMode, generateCurve: generateCurve, pumpCurve: pumpCurve,
    pumpSpeedIgnored: pumpSpeedIgnored, pumpHead: pumpHead,
    pathBetween: pathBetween,
    looksMangled: looksMangled, repairedTag: repairedTag, repairTags: repairTags,
    canSync: canSync, setSync: setSync, syncOf: syncOf,
    syncedPosition: syncedPosition,
    COMPARATORS: COMPARATORS,
    setpointCmp: setpointCmp, setSetpointCmp: setSetpointCmp,
    criticalManual: criticalManual, setCriticalManual: setCriticalManual,
    nodeOnPump: nodeOnPump,
    icvMode: icvMode, icvOpening: icvOpening, icvActive: icvActive,
    addDetail: addDetail, addNote: addNote,
    removeDetail: removeDetail, removeNote: removeNote,
    DETAIL_COLOURS: DETAIL_COLOURS,
    controlRoute: controlRoute, sensorRoute: sensorRoute, zRoute: zRoute,
    extractFragment: extractFragment, insertFragment: insertFragment,
    splitPipeAt: splitPipeAt,
    nextLevelName: nextLevelName,
    uniqueTag: uniqueTag, duplicateTags: duplicateTags,
    controlRiser: controlRiser, setControlRiser: setControlRiser,
    tagVisible: tagVisible, setTagVisible: setTagVisible,
    controlSpan: controlSpan, pipeLevel: pipeLevel,
    routeWaypoints: routeWaypoints, insertWaypoint: insertWaypoint,
    sensorRefPoint: sensorRefPoint,
    deviceMid: deviceMid,
    equipRatedC: equipRatedC,
    equipDutyFromDT: equipDutyFromDT,
    equipDTFromDuty: equipDTFromDuty,
    setEquipTrio: setEquipTrio, equipTrioOrder: equipTrioOrder,
    trioFields: trioFields,
    flowForDutyAndDT: flowForDutyAndDT,
    migrateEquipThermal: migrateEquipThermal,
    migrateSourcePressure: migrateSourcePressure,
    migrateControlIterations: migrateControlIterations,

    toJSON: toJSON, fromJSON: fromJSON
  };
})(window.FD = window.FD || {});
