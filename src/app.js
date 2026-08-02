/* FreePipeCalc — application shell
 *
 * Wires the model, the canvas view and the DOM together: toolbar, level panel,
 * property panel, calculation sheet, settings, persistence.
 */
(function (FD) {
  'use strict';

  var M = FD.model;
  var STORAGE_KEY = 'freepipecalc.model';
  var SCHEDULE_KEY = 'freepipecalc.customSchedules';
  // Pre-rename keys, read once so an in-progress model survives the rebrand.
  var LEGACY_KEYS = { model: 'frictiondrop.model', schedules: 'frictiondrop.customSchedules' };

  var app = {
    model: null,
    view: null,
    results: null,
    undoStack: [],
    redoStack: [],
    saveTimer: null,
    solveTimer: null
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------ history
  function snapshot() {
    return JSON.stringify(M.toJSON(app.model));
  }

  /* Undo stores the state BEFORE an edit, which is harder than it sounds
   * because the two callers snapshot at different moments: a property-panel
   * edit calls pushUndo() before mutating, but a canvas gesture mutates first
   * and only then reports through changed(). Snapshotting inside changed()
   * therefore captured the model WITH the new pump already in it, so the first
   * press of Undo restored an identical state and it took two presses to
   * remove anything (reported 2026-07-31).
   *
   * So the pre-edit state is kept in `lastSnap` and that is what gets pushed,
   * whichever way round the caller works. `snapshotTaken` stops one logical
   * edit pushing twice when both paths fire. */
  var lastSnap = null;
  var snapshotTaken = false;
  var marking = false;

  function markClean() {
    lastSnap = snapshot();
    snapshotTaken = false;
  }

  function pushUndo() {
    if (lastSnap === null) lastSnap = snapshot();
    app.undoStack.push(lastSnap);
    if (app.undoStack.length > 60) app.undoStack.shift();
    app.redoStack.length = 0;
    snapshotTaken = true;
    updateHistoryButtons();
  }

  /* Refresh the pre-edit baseline once the current burst of edits has settled.
   * Coalesced to the end of the tick because one gesture can report through
   * changed() more than once. */
  function scheduleMarkClean() {
    if (marking) return;
    marking = true;
    setTimeout(function () { marking = false; markClean(); }, 0);
  }

  function undo() {
    if (!app.undoStack.length) return;
    app.redoStack.push(snapshot());
    app.model = M.fromJSON(JSON.parse(app.undoStack.pop()));
    afterModelSwap();
  }

  function redo() {
    if (!app.redoStack.length) return;
    app.undoStack.push(snapshot());
    app.model = M.fromJSON(JSON.parse(app.redoStack.pop()));
    afterModelSwap();
  }

  function updateHistoryButtons() {
    $('btn-undo').disabled = !app.undoStack.length;
    $('btn-redo').disabled = !app.redoStack.length;
  }

  function afterModelSwap() {
    app.view.selection = [];
    app.results = null;
    app.view.results = null;
    /* The model has been REPLACED (undo, redo, load, new), so the pre-edit
     * baseline must follow it — otherwise the next edit would push a snapshot
     * of a model that is no longer on screen. */
    markClean();
    renderLevels();
    renderProperties();
    applyTheme();
    applyPresentation();
    updateSystemChip();
    updateModeChip();
    app.view.render();
    scheduleSolve();
    scheduleSave();
    updateHistoryButtons();
  }

  // -------------------------------------------------------- persistence
  function scheduleSave() {
    clearTimeout(app.saveTimer);
    app.saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, snapshot());
        localStorage.setItem(SCHEDULE_KEY, JSON.stringify(app.model.customSchedules || {}));
        app.traceAutosaveDropped = false;
      } catch (e) {
        /* Almost always quota, and almost always a trace image. Retry without
         * the image data rather than losing the autosave entirely: the model is
         * the valuable part, a background drawing can be pasted again. */
        try {
          var lean = M.toJSON(app.model);
          var dropped = 0;
          (lean.levels || []).forEach(function (lv) {
            if (lv.trace && lv.trace.src) { delete lv.trace.src; dropped++; }
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(lean));
          if (dropped && !app.traceAutosaveDropped) {
            app.traceAutosaveDropped = true;
            toast('Autosave is too large for this browser — background traces were ' +
                  'left out of it. Use SAVE to keep them.', 'error');
          }
        } catch (e2) {
          console.warn('Autosave failed:', e2.message);
        }
      }
    }, 600);
  }

  function loadAutosave() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEYS.model);
      if (!raw) return null;
      return M.fromJSON(JSON.parse(raw));
    } catch (e) {
      console.warn('Could not restore autosave:', e.message);
      return null;
    }
  }

  function saveModelFile() {
    var data = JSON.stringify(M.toJSON(app.model), null, 2);
    var name = (app.model.settings.meta.project || 'network')
      .replace(/[^\w\-]+/g, '_').toLowerCase() || 'network';
    download(name + '.pnet.json', data, 'application/json');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadModelFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        var loaded = M.fromJSON(obj);
        pushUndo();
        app.model = loaded;
        afterModelSwap();
        app.view.zoomToFit();
        toast('Loaded ' + file.name);
        /* A migration that CHANGES GEOMETRY has to be said out loud. The
         * source-pressure fix puts a node back where it was drawn, which
         * shortens every pipe on it — correcting a length the engineer may
         * have read off the panel and written down. A toast is too easy to
         * miss for that. */
        if (loaded.migrations && loaded.migrations.length) {
          FD.dialog.alert({
            title: 'This file was updated as it loaded',
            message: loaded.migrations.map(function (x) { return x.message; })
                       .join('\n\n') +
                     '\n\nCheck the pipe lengths before you issue anything from ' +
                     'this model, then save it again.'
          });
        }
      } catch (e) {
        toast('Could not load: ' + e.message, 'error');
      }
    };
    reader.onerror = function () { toast('Could not read the file.', 'error'); };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------- toast
  function toast(msg, kind) {
    var host = $('toasts');
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 3200);
    setTimeout(function () { if (t.parentNode) host.removeChild(t); }, 3700);
  }

  // -------------------------------------------------------------- solve
  function scheduleSolve() {
    clearTimeout(app.solveTimer);
    app.solveTimer = setTimeout(solveNow, 250);
  }

  function solveNow() {
    try {
      var res = FD.network.solveModel(app.model);
      app.results = res;
      app.view.results = res;
      app.view.render();
      updateStatusChip(res);
      updateSystemChip();
      updateModeChip();
      refreshPropertyReadouts();
      return res;
    } catch (e) {
      console.error(e);
      updateStatusChip(null, e.message);
      return null;
    }
  }

  function updateStatusChip(res, errMsg) {
    var chip = $('status-chip');
    if (errMsg) { chip.textContent = 'Error: ' + errMsg; chip.className = 'chip error'; return; }
    if (!res) { chip.textContent = 'not solved'; chip.className = 'chip'; return; }

    var m = app.model;
    var hasNetwork = m.pipes.length > 0;
    if (!hasNetwork) { chip.textContent = 'empty model'; chip.className = 'chip'; return; }

    if (res.errors && res.errors.length) {
      chip.textContent = res.errors[0].message;
      chip.className = 'chip error';
      return;
    }
    /* A hydraulic error is not one warning among many — the system as drawn
     * cannot do what is asked of it, and every number on the sheet is
     * conditional on that. It gets the chip to itself, in red. */
    var hyd = (res.warnings || []).filter(function (w) {
      return w.code === 'SUPPLY_INSUFFICIENT' || w.code === 'PUMP_DEAD_END' ||
             w.code === 'PUMP_NO_FLOW' || w.code === 'NO_SOURCE';
    });
    if (hyd.length) {
      /* Supply insufficiency outranks a dead pump: it is the one that says the
       * system cannot serve its terminals. A dead pump is often a symptom. */
      var order = ['NO_SOURCE', 'SUPPLY_INSUFFICIENT'];
      var headline = null;
      order.forEach(function (c) {
        if (!headline) headline = hyd.filter(function (w) { return w.code === c; })[0];
      });
      headline = headline || hyd[0];
      chip.textContent =
        headline.code === 'NO_SOURCE' ? 'Hydraulic error — no water source'
      : headline.code === 'SUPPLY_INSUFFICIENT' ? 'Hydraulic error — supply insufficient'
      : 'Hydraulic error — pump has no flow';
      chip.className = 'chip error';
      chip.title = hyd.map(function (w) { return w.message; }).join('\n\n');
      return;
    }
    chip.title = '';

    var list = computeWarnings(res);
    var warn = list.length;
    if (warn) {
      chip.textContent = warn + ' warning' + (warn > 1 ? 's' : '');
      chip.className = 'chip warn';
      /* Hovering previews WHAT is wrong, so the count does not have to be taken
       * on trust or chased into the CALCULATION tab. Capped, because a badly
       * oversized model can raise dozens and a tooltip that fills the screen
       * gets dismissed unread. */
      var PREVIEW = 8;
      var lines = list.slice(0, PREVIEW).map(function (w) {
        return '• ' + (w.message || w.code);
      });
      if (warn > PREVIEW) lines.push('… and ' + (warn - PREVIEW) + ' more');
      lines.push('', 'Click to highlight the affected pipes on the drawing.');
      chip.title = lines.join('\n');
      chip.style.cursor = 'pointer';
    } else {
      chip.textContent = 'Solved · ' + res.iterations + ' iterations';
      chip.className = 'chip ok';
      chip.title = '';
      chip.style.cursor = '';
      app.view.warnHighlight = null;
    }
  }

  /* Clicking the status chip highlights whatever the warnings name. A toggle,
   * not a one-shot: the point is to keep the marks visible while the drawing is
   * being fixed, the same reasoning as SHOW DISCONNECT. */
  function initStatusChip() {
    var chip = $('status-chip');
    if (!chip) return;
    chip.addEventListener('click', function () {
      if (app.view.warnHighlight) {
        app.view.warnHighlight = null;
        app.view.render();
        toast('Warning highlight off.');
        return;
      }
      var list = computeWarnings(app.results);
      if (!list.length) { toast('No warnings to highlight.'); return; }
      var pipes = {}, nodes = {}, nP = 0, nN = 0;
      list.forEach(function (w) {
        if (w.pipe && !pipes[w.pipe]) { pipes[w.pipe] = true; nP++; }
        (w.nodes || []).forEach(function (id) { if (!nodes[id]) { nodes[id] = true; nN++; } });
        if (w.node && !nodes[w.node]) { nodes[w.node] = true; nN++; }
      });
      if (!nP && !nN) { toast('These warnings do not point at a particular pipe.'); return; }
      app.view.warnHighlight = { pipes: pipes, nodes: nodes };
      app.view.render();
      toast('Highlighted ' + nP + ' pipe' + (nP === 1 ? '' : 's') +
            (nN ? ' and ' + nN + ' node' + (nN === 1 ? '' : 's') : '') +
            '. Click the chip again to clear.');
    });
  }

  /* The property panel shows solved values (flow, velocity, pressure), so it
   * goes stale every time the background solve runs. It cannot simply be
   * re-rendered: the solve is debounced 250 ms behind editing, so rebuilding
   * the inputs would yank focus out from under someone mid-type. Skip the
   * refresh while a field in the panel has focus — the panel is rebuilt anyway
   * on the next selection change or committed edit. */
  function refreshPropertyReadouts() {
    var panel = $('prop-body');
    if (!panel) return;
    if (panel.contains(document.activeElement) &&
        /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    renderProperties();
  }

  /* Single source of truth for warnings, so the status chip's count and the
   * list printed on the sheet can never disagree. */
  function computeWarnings(res) {
    if (!res) return [];
    var m = app.model, d = m.settings.display;
    /* Velocity and friction-rate breaches are DETECTED in the engine, so that
     * every consumer of a solve sees them — not just this renderer. Here they
     * are only reformatted into the user's display units. Do NOT re-derive
     * them from the sheet rows: that made solveModel() report "no warnings"
     * for a network running at 12 m/s. */
    /* The WHERE is carried through, not just the message. Reformatting used to
     * drop `pipe`/`node`, which left the warning list unable to point at
     * anything on the drawing — so the chip could count problems it could not
     * show you. */
    var out = (res.warnings || []).map(function (w) {
      var where = { code: w.code, pipe: w.pipe, node: w.node, nodes: w.nodes };
      if (w.code === 'PDM' && w.pdm !== undefined) {
        where.message = 'Section ' + w.section + ': friction rate ' +
          FD.units.fmtPdm(w.pdm, d.pdm, true) + ' exceeds the ' +
          FD.units.fmtPdm(w.limit, d.pdm, true) + ' limit.';
        return where;
      }
      where.message = w.message;
      return where;
    });

    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      if (res.pressure[n.id] === undefined) return;
      if (isUnreachable(res.pressure[n.id])) {
        out.push({ code: 'UNREACHABLE', node: n.id,
                   message: 'Outflow ' + n.id + ' cannot be reached — it is isolated by a shut ' +
                            'valve or not connected to a source.' });
        return;
      }
      var short = res.pressure[n.id] - (n.device.reqPressure || 0);
      if (short < 0) {
        out.push({ code: 'OUTFLOW_SHORT', node: n.id,
          message: 'Outflow ' + n.id + ' is ' +
          FD.units.fmtPressure(-short, d.pressure, true) + ' short of its required pressure.' });
      }
    });
    return out;
  }

  /* A node behind a shut valve solves to an astronomical negative pressure —
   * R·Q² with a deliberately enormous R. No real system reaches ±100 bar, so a
   * magnitude past that means "no flow path", not "very low pressure". Report
   * it as unreachable rather than printing nine digits of nonsense. */
  var UNREACHABLE_PA = 1e7;
  function isUnreachable(pa) {
    return !isFinite(pa) || Math.abs(pa) > UNREACHABLE_PA;
  }

  function countWarnings(res) { return computeWarnings(res).length; }

  // ----------------------------------------------------- calculation sheet
  /* Head [m of working fluid] → pressure [Pa], using the model's fluid density
   * rather than the 998 baked into units.js. Anything reporting a pressure
   * derived from a head must go through here, or a non-water fluid silently
   * reports water numbers. */
  function headToPa(h) {
    var rho = (app.model && app.model.settings.fluid &&
               app.model.settings.fluid.density) || 998;
    return rho * 9.81 * h;
  }

  /* One row per pipe section, oriented along the direction of flow. */
  function sheetRows(res) {
    if (!res || !res.network) return [];
    var m = app.model;
    var rows = [];

    /* Spec §10: the index circuit comes first. It is the path that sets the
     * pump duty, so it is what an engineer checks before anything else; the
     * remaining branches are context. Order within the index circuit follows
     * the water, source → terminal. */
    var ix = res.critical;
    var order = {}, ixSet = {};
    if (ix) {
      ix.sections.forEach(function (sec, i) { order[sec.link] = i; ixSet[sec.link] = true; });
    }
    var ordered = res.network.links.slice().sort(function (a, b) {
      var ia = (order[a.id] === undefined) ? Infinity : order[a.id];
      var ib = (order[b.id] === undefined) ? Infinity : order[b.id];
      return ia - ib;
    });

    ordered.forEach(function (l) {
      // virtual terminal links are a modelling device, not pipework
      if (l._virtual) return;
      var q = res.flow[l.id];
      if (q === undefined) return;
      var from = l.from, to = l.to;
      if (q < 0) { from = l.to; to = l.from; q = -q; }

      var nFrom = M.node(m, from), nTo = M.node(m, to);
      if (!nFrom || !nTo) return;
      var v = FD.hydraulics.velocity(q, l._d);
      var pdm = (l.kind === 'pipe' && l._L > 1e-9)
        ? headToPa(Math.abs(FD.hydraulics.headloss(l._rActual, q, l.n)) / l._L) : 0;
      var pd = headToPa(Math.abs(
        l.kind === 'pump' ? -l.head : FD.hydraulics.linkLoss(l, q)));
      var dz = M.elevation(m, nTo) - M.elevation(m, nFrom);

      /* A shut valve has a deliberately enormous resistance, so ΔP = R·Q² comes
       * out in the hundreds of millions of kPa. That figure is arithmetically
       * correct and completely meaningless — a fixed-flow demand behind a shut
       * valve is an unsatisfiable model, not a very high pressure. Flag it so
       * the sheet prints "shut" instead of a nonsense number. */
      var shut = (l.kind === 'valve' && l.r >= FD.valves.CLOSED_R);

      var pipeObj = M.pipe(m, l.id);
      rows.push({
        shut: shut,
        index: !!ixSet[l.id],
        tag: (pipeObj && pipeObj.tag) || '',
        id: l.id, kind: l.kind,
        section: from + ' → ' + to,
        size: M.pipe(m, l.id) ? M.pipe(m, l.id).size : '—',
        id_mm: l._d * 1000,
        L: l._L, el: l._el, Leff: l._Leff,
        codes: FD.fittings.summarise(l._types),
        q: q, v: v,
        vWarn: v > m.settings.warn.velocity,
        pdm: pdm,
        pdmWarn: pdm > m.settings.warn.pdm,
        pd: l.kind === 'pump' ? -pd : pd,
        stat: -headToPa(dz),
        pOut: res.pressure[to]
      });
    });
    return rows;
  }

  /* A render failure part-way through leaves a plausible-looking but truncated
   * calculation sheet, which is far more dangerous than an obvious error — so
   * any exception replaces the sheet outright rather than leaving a fragment. */
  function renderCalculation() {
    try {
      renderCalculationInner();
    } catch (e) {
      console.error(e);
      var host = $('calc-body');
      host.innerHTML = '';
      var box = el('div', 'notice error-notice');
      box.appendChild(el('p', 'notice-head', 'The calculation sheet could not be rendered'));
      box.appendChild(el('p', '', e.message));
      box.appendChild(el('p', '', 'Do not use any partial figures. See the browser console ' +
                                  'for details.'));
      host.appendChild(box);
      updateStatusChip(null, 'sheet render failed');
    }
  }

  function renderCalculationInner() {
    var host = $('calc-body');
    host.innerHTML = '';
    var res = app.results || solveNow();
    var m = app.model;
    /* Declared up here because the hydraulic-error block below needs it, and a
     * `var` further down only looks like it is in scope. */
    var d = m.settings.display;

    if (!m.pipes.length) {
      host.appendChild(el('p', '', 'Nothing to calculate yet — draw a network on the PIPING NETWORK tab.'));
      return;
    }

    /* Collapsible sections.
     *
     * A <details> element rather than a hand-rolled toggle: it is the browser's
     * own disclosure widget, so it keyboards and screen-reads correctly for
     * free. Collapsing is not just tidying — a collapsed section does not
     * PRINT (see the @media print rule in styles.css), which makes the sheet
     * itself the place you choose what to issue, instead of a separate export
     * dialog nobody would find. */
    function calcSection(title, opts) {
      opts = opts || {};
      var det = el('details', 'calc-section' + (opts.cls ? ' ' + opts.cls : ''));
      if (opts.open !== false) det.open = true;
      var sum = el('summary', '', title);
      if (opts.note) sum.appendChild(el('span', 'sec-note', opts.note));
      det.appendChild(sum);
      var body = el('div', 'calc-section-body');
      det.appendChild(body);
      host.appendChild(det);
      return body;
    }

    /* Project metadata, edited HERE.
     *
     * It used to live on the SETTINGS tab, which meant filling in the header of
     * a document while looking at a different page. These fields are part of
     * the deliverable, so they belong on the deliverable. */
    var meta = m.settings.meta;
    var head = el('div', 'sheet-head');
    function metaField(label, key, placeholder) {
      var wrap = el('div', 'kv');
      wrap.appendChild(el('span', 'k', label));
      var i = el('input', 'meta-input');
      i.type = 'text';
      i.value = meta[key] || '';
      i.placeholder = placeholder || '';
      i.addEventListener('change', function () {
        pushUndo();
        meta[key] = i.value.trim();
        scheduleSave();
      });
      wrap.appendChild(i);
      head.appendChild(wrap);
    }
    function metaRead(label, value) {
      var wrap = el('div', 'kv');
      wrap.appendChild(el('span', 'k', label));
      wrap.appendChild(el('span', 'v', value));
      head.appendChild(wrap);
    }
    metaField('Project', 'project', 'Project name');
    metaField('System', 'system', 'e.g. CHW');
    metaField('Engineer', 'engineer', 'Your name');
    metaField('Company', 'company', '');
    metaField('Date', 'date', new Date().toISOString().slice(0, 10));
    metaField('Revision', 'revision', '');
    metaRead('System type', systemTypeLabel());
    metaRead('Method', FD.hydraulics.method(m.settings.frictionMethod).name);
    /* A method still in BETA has to say so on the sheet itself, not only in
     * the tab where it was chosen — the sheet is what gets issued. */
    if (FD.hydraulics.method(m.settings.frictionMethod).experimental) {
      metaRead('Status', 'BETA — verify before issue');
    }
    metaRead('Fluid', (m.settings.fluid && m.settings.fluid.name) || 'Water');
    metaRead('App version', FD.VERSION);
    host.appendChild(head);

    if (res && res.errors && res.errors.length) {
      var errBox = el('div', 'notice error-notice');
      res.errors.forEach(function (e) { errBox.appendChild(el('p', '', e.message)); });
      host.appendChild(errBox);
    }

    /* Hydraulic errors — the system as drawn cannot do what is asked of it.
     * These sit above the sheet because every number below is conditional on
     * them: the tabulated pressures assume all demands draw their full flow,
     * which is exactly what is not happening. */
    var hydraulic = (res && res.warnings || []).filter(function (w) {
      return w.code === 'SUPPLY_INSUFFICIENT' || w.code === 'PUMP_DEAD_END' ||
             w.code === 'PUMP_NO_FLOW' || w.code === 'NO_SOURCE';
    });
    if (hydraulic.length) {
      var hbox = el('div', 'notice error-notice');
      hbox.appendChild(el('p', 'notice-head', 'Hydraulic error'));
      hydraulic.forEach(function (w) {
        hbox.appendChild(el('p', '', w.message));
        if (w.detail) hbox.appendChild(el('p', 'hint', w.detail));
      });
      if (res.actual) {
        hbox.appendChild(el('p', '',
          'Tabulated pressures below are the demand-driven result — every demand ' +
          'drawing its full flow — so the negative values show how much head is missing. ' +
          'The figures in brackets in the Demands table are what the system would ' +
          'actually deliver: ' +
          FD.units.fmtFlow(res.actual.totalDelivered, d.flow, true) + ' of ' +
          FD.units.fmtFlow(res.actual.totalDemanded, d.flow, true) + '.'));
      }
      host.appendChild(hbox);
    }

    var rows = sheetRows(res);

    // ============================================================ 1. ALL PIPES
    var secAll = calcSection('All Pipes');
    /* Tag only earns a column when something in the model actually has one —
     * an empty column on every row of a plain pipe network is just noise. */
    var anyTag = rows.some(function (r) { return r.tag; });
    var cols = ['Section'].concat(anyTag ? ['Tag'] : [])
      .concat(['Size', 'ID mm', 'L ' + d.length, 'Fittings', 'EL ' + d.length,
                'L eff ' + d.length, 'Flow ' + d.flow, 'V m/s', 'PD/m ' + d.pdm,
                'Section PD ' + d.pressure, 'Static ' + d.pressure, 'Pressure ' + d.pressure]);

    function pipeTable(list) {
      var table = el('table', 'sheet');
      var thead = el('thead'), htr = el('tr');
      cols.forEach(function (c) {
        htr.appendChild(el('th', (c === 'Section' || c === 'Tag' || c === 'Fittings') ? 'txt' : '', c));
      });
      thead.appendChild(htr); table.appendChild(thead);
      var tb = el('tbody');
      list.forEach(function (r) {
        var tr = el('tr', r.index ? 'index-row' : '');
        function cell(t, cls) { tr.appendChild(el('td', cls, t)); }
        cell(r.section);
        if (anyTag) cell(r.tag || '—', 'txt' + (r.tag ? '' : ' dim'));
        cell(FD.units.fmtSize(r.size, d.size));
        cell(r.id_mm.toFixed(2), 'dim');
        cell(FD.units.fmtLength(r.L, d.length));
        cell(r.codes || '—', 'txt dim');
        cell(FD.units.fmtLength(r.el, d.length), 'dim');
        cell(FD.units.fmtLength(r.Leff, d.length));
        cell(FD.units.fmtFlow(r.q, d.flow));
        cell(r.v.toFixed(2), r.vWarn ? 'bad' : '');
        cell(FD.units.fmtPdm(r.pdm, d.pdm), r.pdmWarn ? 'bad' : '');
        cell(r.shut ? 'SHUT' : FD.units.fmtPressure(r.pd, d.pressure), r.shut ? 'bad' : '');
        cell(FD.units.fmtPressure(r.stat, d.pressure), 'dim');
        var deadEnd = r.shut || isUnreachable(r.pOut);
        cell(deadEnd ? '—' : FD.units.fmtPressure(r.pOut, d.pressure),
             deadEnd || r.pOut < 0 ? 'bad' : '');
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      return table;
    }
    secAll.appendChild(pipeTable(rows));

    // ========================================================= 2. CRITICAL PATH
    if (res && res.critical && res.critical.sections.length) {
      var ix2 = res.critical;
      var secCrit = calcSection('Critical Path');
      secCrit.appendChild(el('p', 'notice-head',
        'Critical Path from ' + ix2.origin + ' to ' + ix2.target));

      /* The critical-path sections are repeated here in full, deliberately.
       * They duplicate rows from All Pipes, which is the point: this is the
       * route that sets the pump duty and an engineer checking the duty wants
       * it on its own, not highlighted among everything else. */
      var critRows = rows.filter(function (r) { return r.index; });
      secCrit.appendChild(pipeTable(critRows));

      var grid = el('div', 'index-grid');
      function kv(k, v) {
        var d2 = el('div', 'kv');
        d2.appendChild(el('span', 'k', k));
        d2.appendChild(el('span', 'v', v));
        grid.appendChild(d2);
      }
      kv('Sections', String(ix2.sections.length));
      kv('Total friction drop', FD.units.fmtPressure(headToPa(ix2.frictionHead), d.pressure, true));
      kv('Static', FD.units.fmtPressure(headToPa(ix2.staticHead), d.pressure, true));
      if (ix2.pumpHead) kv('Pump head', FD.units.fmtPressure(headToPa(ix2.pumpHead), d.pressure, true));
      if (ix2.residual !== null && ix2.residual !== undefined) {
        kv('Residual at terminal', FD.units.fmtPressure(ix2.residual, d.pressure, true));
      }
      secCrit.appendChild(grid);
    }

    // ============================================================ 3. DEVICE FLOW
    /* Every device that moves or consumes water, in ONE section with a single
     * column layout so the tables line up: what it is actually doing against
     * what it was designed for. Pumps sit here with the terminals rather than
     * in a table of their own — they are part of the same question. */
    (function () {
      var sim = res && res.simulation;
      var devCols = ['Node', 'Actual flow ' + d.flow, 'Design flow ' + d.flow, '% of design',
                     'Actual pressure ' + d.pressure, 'Design pressure ' + d.pressure, '% of design'];
      var groups = [];

      function pct(a, b) { return (b > 0) ? (a / b * 100) : null; }
      function row(name, aF, dF, aP, dP) {
        return { name: name, aF: aF, dF: dF, aP: aP, dP: dP,
                 fPct: pct(aF, dF), pPct: pct(aP, dP) };
      }

      // sources
      var srcRows = m.nodes.filter(function (n) {
        return n.device && n.device.kind === 'source';
      }).map(function (n) {
        var pa = res && res.pressure ? res.pressure[n.id] : null;
        return row(n.tag || n.id, null, null, pa, (n.device.pressure || 0));
      });
      if (srcRows.length) groups.push({ title: 'Sources', rows: srcRows });

      // pumps
      var pumpRows = m.pipes.filter(function (p) { return p.kind === 'pump'; })
        .map(function (p) {
          var off = !p.pump || p.pump.mode === 'off';
          var q = res && res.flow ? Math.abs(res.flow[p.id] || 0) : null;
          var hd = off ? 0 : (p.pump && p.pump.curve
            ? FD.pumps.head(p.pump.curve, q || 0) : (p.pump && p.pump.head) || 0);
          var design = p.pump && p.pump.curve ? p.pump.curve.Qd : null;
          var r2 = row((p.tag || p.id) + (off ? ' (off)' : ''), off ? 0 : q, design,
                       headToPa(hd), null);
          return r2;
        });
      if (pumpRows.length) groups.push({ title: 'Pumps', rows: pumpRows });

      // equipment
      var eqRows = m.pipes.filter(function (p) { return p.kind === 'equip' && p.equip; })
        .map(function (p) {
          var q = res && res.flow ? Math.abs(res.flow[p.id] || 0) : null;
          var link = res && res.network
            ? res.network.links.filter(function (l) { return l.id === p.id; })[0] : null;
          var aP = link ? headToPa(Math.abs(FD.hydraulics.linkLoss(link, q || 0))) : null;
          return row(p.tag || p.id, q, p.equip.qRated || null, aP, p.equip.pdRated || null);
        });
      if (eqRows.length) groups.push({ title: 'Equipment', rows: eqRows });

      // outflows
      var ofRows = m.nodes.filter(function (n) {
        return n.device && n.device.kind === 'demand' && n.device.include !== false;
      }).map(function (n) {
        var dev = n.device;
        var simRow = sim && sim.terminals
          ? sim.terminals.filter(function (t) { return t.node === n.id; })[0] : null;
        var aF = simRow ? simRow.actualFlow
               : (res && res.actual && res.actual.flow ? res.actual.flow[n.id] : dev.flow);
        var aP = res && res.pressure ? res.pressure[n.id] : null;
        return row(n.tag || n.id, aF, dev.flow, aP, dev.reqPressure || null);
      });
      if (ofRows.length) groups.push({ title: 'Outflows', rows: ofRows });

      if (!groups.length) return;
      var secDev = calcSection('Device Flow');

      groups.forEach(function (g) {
        /* Pumps are exempt from the under-delivery highlight. A pump running
         * below its curve's design flow is riding its curve where the system
         * put it — that is what a pump does, not a fault. The red is for
         * terminals that are not getting what they were sized for. */
        var flagUnder = (g.title !== 'Pumps' && g.title !== 'Sources');
        secDev.appendChild(el('h3', 'sub', g.title));
        var t = el('table', 'sheet device-flow');
        var th = el('thead'), htr2 = el('tr');
        devCols.forEach(function (c, i) {
          htr2.appendChild(el('th', i === 0 ? 'txt' : '', c));
        });
        th.appendChild(htr2); t.appendChild(th);
        var tb2 = el('tbody');
        g.rows.forEach(function (r) {
          var tr = el('tr');
          function c(t2, cls) { tr.appendChild(el('td', cls, t2)); }
          /* Under-delivery is the failure this table exists to expose, so it is
           * red — a device quietly running below its design flow is the thing
           * that does not announce itself. */
          var under = flagUnder && (r.fPct !== null && r.fPct < 99.5);
          c(r.name, 'txt' + (under ? ' bad' : ''));
          c(r.aF === null ? '—' : FD.units.fmtFlow(r.aF, d.flow), under ? 'bad' : '');
          c(r.dF === null ? '—' : FD.units.fmtFlow(r.dF, d.flow), 'dim');
          c(r.fPct === null ? '—' : r.fPct.toFixed(1) + '%', under ? 'bad' : '');
          c(r.aP === null ? '—' : FD.units.fmtPressure(r.aP, d.pressure));
          c(r.dP === null ? '—' : FD.units.fmtPressure(r.dP, d.pressure), 'dim');
          c(r.pPct === null ? '—' : r.pPct.toFixed(1) + '%');
          tb2.appendChild(tr);
        });
        t.appendChild(tb2);
        secDev.appendChild(t);
      });
    })();

    // ============================================================ 4. PUMP CURVE
    (function () {
      var pumps = m.pipes.filter(function (p) { return p.kind === 'pump'; });
      if (!pumps.length) return;
      var secCurve = calcSection('Pump Curve', { note: 'WIP' });
      secCurve.appendChild(el('p', 'hint',
        'Work in progress — the presentation for more than one pump is not ' +
        'settled yet. Shown for the first pump with a curve.'));
      var withCurve = pumps.filter(function (p) { return p.pump && p.pump.curve; })[0];
      if (!withCurve) {
        secCurve.appendChild(el('p', 'hint', 'No pump has a curve set.'));
        return;
      }
      var c = withCurve.pump.curve;
      var qNow = res && res.flow ? Math.abs(res.flow[withCurve.id] || 0) : 0;
      var qMax = Math.max(FD.pumps.maxFlow(c) || 0, qNow * 1.2);
      var W = 420, H = 200, PAD = 34;
      var svgNS = 'http://www.w3.org/2000/svg';
      function svgEl(tag, attrs) {
        var e = document.createElementNS(svgNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        return e;
      }
      var hMax = FD.pumps.head(c, 0) || 1;
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'pump-curve' });
      function X(q) { return PAD + (q / (qMax || 1)) * (W - PAD - 12); }
      function Y(h) { return (H - PAD) - (h / hMax) * (H - PAD - 12); }
      svg.appendChild(svgEl('line', { x1: PAD, y1: H - PAD, x2: W - 8, y2: H - PAD,
                                      stroke: 'currentColor', 'stroke-width': 1, opacity: .5 }));
      svg.appendChild(svgEl('line', { x1: PAD, y1: 8, x2: PAD, y2: H - PAD,
                                      stroke: 'currentColor', 'stroke-width': 1, opacity: .5 }));
      var pts = [];
      for (var i = 0; i <= 40; i++) {
        var q = qMax * i / 40;
        pts.push(X(q).toFixed(1) + ',' + Y(Math.max(0, FD.pumps.head(c, q))).toFixed(1));
      }
      svg.appendChild(svgEl('polyline', { points: pts.join(' '), fill: 'none',
                                          stroke: 'currentColor', 'stroke-width': 2 }));
      // the operating point the system actually settled at
      var op = svgEl('circle', { cx: X(qNow), cy: Y(FD.pumps.head(c, qNow)), r: 4,
                                 fill: 'currentColor' });
      svg.appendChild(op);
      var lbl = svgEl('text', { x: X(qNow) + 7, y: Y(FD.pumps.head(c, qNow)) - 6,
                                'font-size': 11, fill: 'currentColor' });
      lbl.textContent = FD.units.fmtFlow(qNow, d.flow, true) + ' @ ' +
                        FD.units.fmtPressure(headToPa(FD.pumps.head(c, qNow)), d.pressure, true);
      svg.appendChild(lbl);
      secCurve.appendChild(el('p', 'hint', withCurve.tag || withCurve.id));
      secCurve.appendChild(svg);
    })();

    // =============================================================== WARNINGS
    /* Threshold exceedances are highlighted red in the tables AND listed here,
     * because a red cell says WHERE but not WHAT. computeWarnings is the single
     * source shared with the status chip, so the two cannot disagree. */
    var warnings = computeWarnings(res);
    if (warnings.length) {
      var secWarn = calcSection('Warnings', { note: String(warnings.length) });
      var ul = el('ul');
      warnings.forEach(function (w) { ul.appendChild(el('li', '', w.message)); });
      secWarn.appendChild(ul);
    }

    // =============================================================== 5. APPENDIX
    /* The hydraulic parameters the numbers above were produced with. A sheet
     * that does not state its own assumptions cannot be checked, and this is
     * the one place they travel with the result — including any edit made to
     * the Hazen-Williams constants. */
    (function () {
      var secApp = calcSection('Appendix — Hydraulic Parameters', { open: false });
      var meth = FD.hydraulics.method(m.settings.frictionMethod);
      var g = el('div', 'index-grid');
      function kv2(k, v) {
        var r = el('div', 'kv');
        r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v));
        g.appendChild(r);
      }
      kv2('Method', meth.name);
      if (meth.source) kv2('Source', meth.source);
      if (m.settings.frictionMethod === 'ASHRAE') {
        var ka = m.settings.ashrae || FD.hydraulics.ASHRAE_DEFAULTS;
        var der = meth.derive({ ashrae: ka });
        kv2('Formula (as printed)',
            'Δh = ' + ka.K + ' · L · (V/C)^' + ka.a + ' · (1/D)^' + ka.e);
        kv2('Solved as', 'Δh = ' + der.A.toFixed(4) + ' · L · Q^' + der.a +
                         ' / ( C^' + der.b + ' · d^' + der.e.toFixed(4) + ' )');
        kv2('Fittings', 'K velocity heads (Ch 22 Eq 7), ' +
            FD.ktable.sets[(m.settings.dw && m.settings.dw.kSet) || 'threaded'].name);
        var defA = FD.hydraulics.ASHRAE_DEFAULTS;
        if (ka.K !== defA.K || ka.a !== defA.a || ka.e !== defA.e) {
          kv2('NOTE', 'Constants have been EDITED from the ASHRAE defaults.');
        }
      } else if (m.settings.frictionMethod === 'HW') {
        var kh = m.settings.hw;
        kv2('Formula', 'hf = ' + kh.A + ' · L · Q^' + kh.a +
                       ' / ( C^' + kh.b + ' · d^' + kh.e + ' )');
        kv2('Fittings', 'Equivalent length (L/D basis)');
        var defH = FD.hydraulics.HW_DEFAULTS;
        if (kh.A !== defH.A || kh.a !== defH.a || kh.b !== defH.b || kh.e !== defH.e) {
          kv2('NOTE', 'Constants have been EDITED from the ASHRAE defaults.');
        }
      } else {
        var ffKey = (m.settings.dw && m.settings.dw.frictionFactor) || 'swameejain';
        var ff = FD.hydraulics.frictionFactors[ffKey];
        kv2('Formula', 'hf = f · (L/d) · V²/2g');
        kv2('Friction factor', ff ? ff.name : ffKey);
        kv2('Roughness', ((m.settings.dw && m.settings.dw.roughness_mm) || 0.045) + ' mm');
        kv2('Fittings', 'Equivalent length (L/D basis)');
        kv2('NOTE', 'BETA. ' + (ffKey === 'swameejain'
          ? 'Swamee-Jain is an explicit fit to Colebrook-White, measured in the test ' +
            'suite against an independent iteration of Colebrook: within 0.9% over ' +
            'Re 1e4–1e7 with ε/d up to 1e-3, and up to 2.8% at Re 5000 with ε/d 1e-2. '
          : '') +
          'Verify against your own reference before issue.');
      }
      var fl = m.settings.fluid || {};
      kv2('Fluid', (fl.name || 'Water') + ', ρ = ' + (fl.density || 998) + ' kg/m³');
      kv2('Default C factor', String(m.settings.C));
      kv2('Velocity limit', (m.settings.warn && m.settings.warn.velocity) + ' m/s');
      kv2('Friction rate limit', (m.settings.warn && m.settings.warn.pdm) + ' Pa/m');
      secApp.appendChild(g);
    })();

    /* Disclaimer, always shown and always printed. Supplied verbatim by
     * Michael — do not paraphrase it. */
    host.appendChild(el('p', 'legend disclaimer',
      'Disclaimer: All calculation results generated by this software must be ' +
      'independently verified and validated by a qualified professional engineer ' +
      'prior to use. The outputs have not been evaluated or approved by any ' +
      'certification body or Authority Having Jurisdiction. Furthermore, the ' +
      'underlying software is provided "as is," without express or implied ' +
      'warranties of any kind, including merchantability or fitness for a ' +
      'particular purpose. In no event shall the software creator be held liable ' +
      'for any direct, indirect, or consequential damages, claims, or other ' +
      'liability arising out of or in connection with the use of these results ' +
      'or the software.'));
  }

  function exportCSV() {
    var m = app.model, res = app.results || solveNow();
    var rows = sheetRows(res);
    var delim = m.settings.csv.delimiter;
    var dec = m.settings.csv.decimal;
    var d = m.settings.display;

    function num(v) {
      var s = String(v);
      return dec === ',' ? s.replace('.', ',') : s;
    }
    function field(v) {
      var s = String(v);
      return (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    var lines = [];
    var meta = m.settings.meta;
    lines.push('# ' + FD.APP_NAME + ' ' + FD.VERSION + ' — piping friction loss calculation');
    lines.push('# Project: ' + (meta.project || '—'));
    lines.push('# Engineer: ' + (meta.engineer || '—') + '  Company: ' + (meta.company || '—'));
    lines.push('# Date: ' + (meta.date || new Date().toISOString().slice(0, 10)) +
               '  Revision: ' + (meta.revision || '—'));
    lines.push('# Method: Hazen-Williams (ASHRAE). System: ' + systemTypeLabel() + '.');
    lines.push('# Pressures are gauge; velocity pressure neglected.');
    lines.push('# For preliminary design assistance only. Results must be verified by a ' +
               'qualified engineer. No warranty; no liability.');

    lines.push(['Section', 'Tag', 'Size', 'ID mm', 'L ' + d.length, 'Fittings', 'EL ' + d.length,
                'L eff ' + d.length, 'Flow ' + d.flow, 'Velocity m/s', 'PD/m ' + d.pdm,
                'Section PD ' + d.pressure, 'Static ' + d.pressure, 'Pressure ' + d.pressure]
               .map(field).join(delim));

    rows.forEach(function (r) {
      lines.push([
        r.section, r.tag || '', r.size, num(r.id_mm.toFixed(2)),
        num(FD.units.fmtLength(r.L, d.length)), r.codes || '',
        num(FD.units.fmtLength(r.el, d.length)),
        num(FD.units.fmtLength(r.Leff, d.length)),
        num(FD.units.fmtFlow(r.q, d.flow)),
        num(r.v.toFixed(2)),
        num(FD.units.fmtPdm(r.pdm, d.pdm)),
        num(FD.units.fmtPressure(r.pd, d.pressure)),
        num(FD.units.fmtPressure(r.stat, d.pressure)),
        num(FD.units.fmtPressure(r.pOut, d.pressure))
      ].map(field).join(delim));
    });

    var name = (meta.project || 'calculation').replace(/[^\w\-]+/g, '_').toLowerCase();
    download(name + '.csv', lines.join('\r\n'), 'text/csv');
    toast('Calculation exported as CSV');
  }

  // -------------------------------------------------------- level panel
  function renderLevels() {
    var host = $('level-list');
    host.innerHTML = '';
    var m = app.model;

    m.levels.forEach(function (lv, idx) {
      var row = el('div', 'level-row' + (lv.id === m.activeLevel ? ' active' : ''));
      row.draggable = true;
      row.dataset.index = idx;

      row.appendChild(el('span', 'level-grip', '⠿'));
      row.appendChild(el('span', 'level-name', lv.name));
      row.appendChild(el('span', 'level-alt',
        (lv.altitude >= 0 ? '+' : '') + lv.altitude.toFixed(2) + ' m'));

      if (M.isLevelLocked(m, lv.id)) {
        var lock = el('span', 'level-lock', '⚿');
        lock.title = 'Offset locked — anchored by two or more riser columns.';
        row.appendChild(lock);
      }

      var copy = el('button', 'btn tiny level-edit', 'C');
      copy.title = 'Copy this level\u2019s layout to another level';
      copy.addEventListener('click', function (e) { e.stopPropagation(); copyLevelTo(lv); });
      row.appendChild(copy);

      var edit = el('button', 'btn tiny level-edit', 'E');
      edit.title = 'Edit level properties';
      edit.addEventListener('click', function (e) { e.stopPropagation(); editLevel(lv); });
      row.appendChild(edit);

      row.addEventListener('click', function () {
        m.activeLevel = lv.id;
        renderLevels();
        app.view.render();
        scheduleSave();
      });
      row.addEventListener('dblclick', function () { editLevel(lv); });

      // ---- drag to rearrange ----
      row.addEventListener('dragstart', function (e) {
        app.dragLevel = idx;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      });
      row.addEventListener('dragend', function () {
        app.dragLevel = null;
        renderLevels();
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drop-target');
        var from = app.dragLevel;
        if (from === null || from === undefined || from === idx) return;
        reorderLevels(from, idx);
      });

      host.appendChild(row);
    });
  }

  /* Dragging a level to a new position in the list changes its ALTITUDE, since
   * the list is ordered by altitude — there is no independent ordering to
   * store. The dragged level takes a height between its new neighbours, or one
   * floor-to-floor beyond the end of the stack. */
  function reorderLevels(from, to) {
    var m = app.model;
    var moving = m.levels[from];
    if (!moving) return;

    var others = m.levels.filter(function (_, i) { return i !== from; });
    var above = others[to - 1];        // list is top-first, so lower index = higher up
    var below = others[to];
    var f2f = m.settings.floorToFloor || 3.5;

    var alt;
    if (above && below) alt = (above.altitude + below.altitude) / 2;
    else if (below) alt = below.altitude + f2f;       // dropped at the top
    else if (above) alt = above.altitude - f2f;       // dropped at the bottom
    else return;

    pushUndo();
    moving.altitude = Math.round(alt * 1000) / 1000;
    M.sortLevels(m);
    renderLevels();
    changed();
    toast(moving.name + ' moved to ' + moving.altitude.toFixed(2) + ' m');
  }

  /* Copy this level's layout onto another. Offered as part of level properties
   * rather than as a toolbar action, because it is a property OF a level. */
  function copyLevelTo(lv) {
    var m = app.model;
    var targets = m.levels.filter(function (o) { return o.id !== lv.id; });
    if (!targets.length) {
      FD.dialog.alert({ title: 'Nothing to copy to',
                        message: 'Add another level first.' });
      return;
    }
    FD.dialog.form({
      title: 'Copy ' + lv.name + ' layout',
      ok: 'Copy',
      message: 'Everything drawn on ' + lv.name + ' is copied to the target level at the ' +
               'same coordinates. Riser columns touching this floor are extended to the ' +
               'target so the stack stays connected.\n\n' +
               'A SOURCE is deliberately not copied — a second supply would change the ' +
               'hydraulics without being asked for.',
      fields: [{
        key: 'to', label: 'Copy to', type: 'select',
        value: targets[0].id,
        options: targets.map(function (o) {
          return [o.id, o.name + '  (' + (o.altitude >= 0 ? '+' : '') +
                  o.altitude.toFixed(2) + ' m)'];
        })
      }]
    }).then(function (v) {
      if (!v) return;
      var dst = M.level(m, v.to);
      var existing = m.nodes.filter(function (n) { return n.level === v.to; }).length;
      var go = function () {
        pushUndo();
        var r = M.copyLevel(m, lv.id, v.to);
        renderLevels();
        changed();
        toast('Copied ' + r.nodes + ' nodes and ' + r.pipes + ' pipes to ' + dst.name +
              (r.risers ? ', extended ' + r.risers + ' riser column' +
                          (r.risers > 1 ? 's' : '') : '') + '.');
      };
      if (existing) {
        FD.dialog.confirm({
          title: dst.name + ' is not empty',
          message: dst.name + ' already has ' + existing + ' node' +
                   (existing > 1 ? 's' : '') + '. The copy is ADDED alongside — ' +
                   'nothing is removed, so you may end up with overlapping pipework.',
          ok: 'Copy anyway'
        }).then(function (yes) { if (yes) go(); });
      } else { go(); }
    });
  }

  function editLevel(lv) {
    var m = app.model;
    FD.dialog.form({
      title: 'Level properties',
      ok: 'Apply',
      fields: [
        { key: 'name', label: 'Name', type: 'text', value: lv.name },
        { key: 'altitude', label: 'Elevation (' + m.settings.display.length + ')',
          type: 'text', value: FD.units.fmtLength(lv.altitude, m.settings.display.length) },
        /* View Direction drives two things: which neighbouring level renders
         * faded, and which way a new riser is run from this floor. */
        { key: 'lookDir', label: 'View Direction', type: 'select', value: lv.lookDir,
          options: [['down', 'Look Down'], ['up', 'Look Up']] }
      ]
    }).then(function (v) {
      if (!v) return;
      var alt = FD.units.parse(v.altitude);
      if (!isFinite(alt)) {
        FD.dialog.alert({ title: 'Invalid elevation',
          message: '"' + v.altitude + '" is not a number.' });
        return;
      }
      pushUndo();
      lv.name = v.name || lv.name;
      lv.lookDir = v.lookDir;
      M.setLevelAltitude(m, lv.id, FD.units.toSILength(alt, m.settings.display.length));
      renderLevels();
      changed();
    });
  }

  // ----------------------------------------------------- property panel
  function renderProperties() {
    var host = $('prop-body');
    host.innerHTML = '';
    var m = app.model;
    var sel = app.view.selection;

    // TRACE mode shows the background drawing's own controls instead
    if (app.view.tool === 'trace') { renderTraceProps(host); return; }
    if (app.showAnnotations) { renderAnnotationProps(host); return; }
    if (app.view.tool === 'align') {
      host.appendChild(el('h3', '', 'Align model'));
      host.appendChild(el('p', 'hint',
        'Drag any node: the whole model moves with it and the grabbed point ' +
        'snaps to the grid. Use it to put a known node back on the grid after ' +
        'the drawing has drifted. Hold Shift for free placement.'));
      host.appendChild(el('p', 'hint',
        'Only level offsets change, so no geometry and no pipe length is ' +
        'touched — the calculation is unaffected.'));
      return;
    }

    if (!sel.length) {
      host.appendChild(el('p', 'hint', 'Nothing selected. Click a pipe or node to edit it.'));
      return;
    }
    if (sel.length > 1) { renderBulkProps(host, sel); return; }

    var s = sel[0];
    if (s.kind === 'pipe') renderPipeProps(host, M.pipe(m, s.id));
    else if (s.kind === 'riser') renderRiserProps(host, m.risers.find(function (r) { return r.id === s.id; }));
    else renderNodeProps(host, M.node(m, s.id));
  }

  /* Drawing annotations, offered from the VIEW ribbon.
   *
   * These decide what is written on the drawing and on printed level plans, so
   * they belong with the drawing rather than on the SETTINGS tab where they
   * used to be — you could not see what you were turning on. Rendered into the
   * properties panel, which is already the place VIEW puts its controls. */
  function renderAnnotationProps(host) {
    var m = app.model;
    var a = m.settings.annotate;
    host.appendChild(el('h3', '', 'Drawing annotations'));
    host.appendChild(el('p', 'hint',
      'What is labelled on the drawing and on printed level plans. Pipe labels ' +
      'read like "50⌀/12.50m/2.40L/s"; node labels read like "N3 T".'));

    function toggle(label, key) {
      switchRow(host, label, !!a[key], function (on) {
        a[key] = on; redrawAll(); renderProperties();
      });
    }

    host.appendChild(el('h3', 'sub', 'Pipes'));
    toggle('Lengths', 'pipeLength');
    toggle('Nom. diameter', 'pipeDiameter');
    toggle('Flow', 'pipeFlow');
    toggle('Velocity', 'pipeVelocity');
    toggle('PD', 'pipePD');
    toggle('PD/m', 'pipePDM');

    /* "Node", not "Pipe fittings": everything here is drawn at a NODE, and one
     * of them (pressure) is not a fitting property at all. */
    host.appendChild(el('h3', 'sub', 'Node'));
    toggle('Type (EL, T, S, P, OF)', 'fitType');
    toggle('Fitting PD', 'fitPD');
    toggle('Pressure', 'nodePressure');
    toggle('Node numbers', 'nodeNumbers');

    var done = el('button', 'btn', 'Done');
    done.addEventListener('click', function () {
      app.showAnnotations = false;
      renderProperties();
    });
    host.appendChild(done);
  }

  /* Multi-selection: change size / schedule / C on every selected pipe at once.
   *
   * Marquee-select a floor's worth of pipework and resize it in one gesture —
   * without this, changing twenty pipes meant twenty selections. Applied on an
   * explicit button rather than on every field change, because a mass edit is
   * not something to trigger by brushing a dropdown. Blank means "leave alone",
   * so one field can be changed without disturbing the others.
   *
   * Risers go through setRiserProps so their materialised segments follow;
   * setting `size` on the column alone would be overwritten on the next
   * rebuild. */
  function renderBulkProps(host, sel) {
    var m = app.model;
    var pipes = [], risers = [], nodes = 0;
    sel.forEach(function (s) {
      if (s.kind === 'pipe') { var p = M.pipe(m, s.id); if (p) pipes.push(p); }
      else if (s.kind === 'riser') {
        var r = m.risers.find(function (x) { return x.id === s.id; });
        if (r) risers.push(r);
      } else nodes++;
    });

    host.appendChild(el('h3', '', sel.length + ' items selected'));
    var bits = [];
    if (pipes.length) bits.push(pipes.length + ' pipe' + (pipes.length > 1 ? 's' : ''));
    if (risers.length) bits.push(risers.length + ' riser' + (risers.length > 1 ? 's' : ''));
    if (nodes) bits.push(nodes + ' node' + (nodes > 1 ? 's' : ''));
    host.appendChild(el('p', 'hint', bits.join(', ') + '.'));

    var targets = pipes.length + risers.length;
    if (targets) {
      host.appendChild(el('h3', 'sub', 'Change on all ' + targets + ''));

      // Is there a single schedule across the selection? Sizes are per schedule,
      // so a mixed selection has no meaningful size list until one is chosen.
      var scheds = {};
      pipes.forEach(function (p) { scheds[p.schedule] = true; });
      risers.forEach(function (r) {
        scheds[r.schedule || (m.settings.schedule)] = true;
      });
      var schedKeys = Object.keys(scheds);
      var common = schedKeys.length === 1 ? schedKeys[0] : null;

      var UNCHANGED = '— unchanged —';

      var schSel = el('select');
      var keep = el('option', '', UNCHANGED); keep.value = ''; schSel.appendChild(keep);
      var all = FD.schedules.all(m.customSchedules);
      Object.keys(all).forEach(function (k) {
        var o = el('option', '', all[k].name); o.value = k;
        schSel.appendChild(o);
      });
      field(host, 'Schedule' + (common ? '' : ' (mixed)'), schSel);

      var sizeSel = el('select');
      function fillSizes() {
        sizeSel.innerHTML = '';
        var k0 = el('option', '', UNCHANGED); k0.value = ''; sizeSel.appendChild(k0);
        var sched = schSel.value || common;
        if (!sched) {
          sizeSel.disabled = true;
          var none = el('option', '', 'pick a schedule first'); none.value = '';
          sizeSel.appendChild(none);
          return;
        }
        sizeSel.disabled = false;
        FD.schedules.get(sched, m.customSchedules).sizes.forEach(function (sz) {
          var o = el('option', '', sz.label + '  (' + sz.id_mm.toFixed(1) + ' mm)');
          o.value = sz.label;
          sizeSel.appendChild(o);
        });
      }
      fillSizes();
      schSel.addEventListener('change', fillSizes);
      field(host, 'Size', sizeSel);

      var cIn = el('input'); cIn.type = 'number'; cIn.step = '1'; cIn.value = '';
      cIn.placeholder = 'unchanged';
      field(host, 'C factor', cIn);

      /* Applied on change — pressing Enter or tabbing out of a field commits
       * it — rather than behind an Apply button. The button was there because a
       * mass edit felt like it wanted confirming, but it made the common case
       * (change one field on a marquee selection) a two-step, and undo already
       * covers the mistake. */
      function applyBulk(sched, size, C) {
        if (!sched && !size && C === null) return;
        pushUndo();
        pipes.forEach(function (p) {
          if (sched) p.schedule = sched;
          if (size) p.size = size;
          if (C !== null) p.C = C;
          if (!FD.schedules.get(p.schedule, m.customSchedules).sizes
                .some(function (x) { return x.label === p.size; })) {
            p.size = FD.schedules.defaultSize(p.schedule, m.customSchedules);
          }
        });
        risers.forEach(function (r) {
          var props = {};
          if (sched) props.schedule = sched;
          if (size) props.size = size;
          if (C !== null) props.C = C;
          M.setRiserProps(m, r.id, props);
        });
        changed();
        toast('Updated ' + targets + ' item' + (targets > 1 ? 's' : '') + '.');
      }

      schSel.addEventListener('change', function () {
        if (schSel.value) { applyBulk(schSel.value, null, null); renderProperties(); }
      });
      sizeSel.addEventListener('change', function () {
        if (sizeSel.value) { applyBulk(null, sizeSel.value, null); renderProperties(); }
      });
      cIn.addEventListener('change', function () {
        var raw = cIn.value.trim();
        if (raw === '') return;
        var C = FD.units.parse(raw);
        if (!isFinite(C) || C <= 0) { toast('C factor must be a positive number.', 'error'); return; }
        applyBulk(null, null, C);
        renderProperties();
      });
    }

    var delBtn = el('button', 'btn danger', 'Delete selection');
    delBtn.addEventListener('click', function () { pushUndo(); app.view.deleteSelection(); });
    host.appendChild(delBtn);
  }

  /* Riser column properties. A column materialises one or more vertical pipes
   * between the floors it joins; by default they inherit the size of the
   * largest horizontal pipe they connect to. This panel lets the size, schedule
   * and C be pinned explicitly — the reason a riser needs to be selectable at
   * all. */
  function renderRiserProps(host, r) {
    if (!r) return;
    var m = app.model;
    host.appendChild(el('h3', '', 'Riser ' + r.id));

    var segs = m.pipes.filter(function (p) { return p.kind === 'riser' && p.riser === r.id; });
    var sample = segs[0];
    // Current resolved values: the override if set, else what a segment shows.
    var curSchedule = r.schedule || (sample && sample.schedule) || m.settings.schedule;
    var curSize = r.size || (sample && sample.size) ||
                  FD.schedules.defaultSize(curSchedule, m.customSchedules);
    var curC = (r.C !== undefined && r.C !== null) ? r.C
             : (sample ? sample.C : m.settings.C);

    host.appendChild(el('p', 'hint',
      'Connects ' + r.attachments.length + ' level' + (r.attachments.length === 1 ? '' : 's') +
      (r.size ? '. Size pinned.' : '. Size inherited from the largest connected pipe.')));

    // schedule
    var schSel = el('select');
    var all = FD.schedules.all(m.customSchedules);
    Object.keys(all).forEach(function (k) {
      var o = el('option', '', all[k].name); o.value = k;
      if (k === curSchedule) o.selected = true;
      schSel.appendChild(o);
    });
    field(host, 'Schedule', schSel).addEventListener('change', function () {
      pushUndo();
      var sched = schSel.value;
      var size = curSize;
      if (!FD.schedules.get(sched, m.customSchedules).sizes
            .some(function (x) { return x.label === size; })) {
        size = FD.schedules.defaultSize(sched, m.customSchedules);
      }
      M.setRiserProps(m, r.id, { schedule: sched, size: size });
      renderProperties(); changed();
    });

    // size
    var sizeSel = el('select');
    FD.schedules.get(curSchedule, m.customSchedules).sizes.forEach(function (sz) {
      var o = el('option', '', sz.label + '  (' + sz.id_mm.toFixed(1) + ' mm)');
      o.value = sz.label;
      if (sz.label === curSize) o.selected = true;
      sizeSel.appendChild(o);
    });
    field(host, 'Size', sizeSel).addEventListener('change', function () {
      pushUndo(); M.setRiserProps(m, r.id, { size: sizeSel.value }); changed();
    });

    // C factor
    var cIn = el('input'); cIn.type = 'number'; cIn.value = curC; cIn.step = '1';
    field(host, 'C factor', cIn).addEventListener('change', function () {
      var v = FD.units.parse(cIn.value);
      if (isFinite(v) && v > 0) { pushUndo(); M.setRiserProps(m, r.id, { C: v }); changed(); }
      else { cIn.value = curC; toast('C factor must be a positive number.', 'error'); }
    });

    var del = el('button', 'btn danger', 'Delete riser column');
    del.addEventListener('click', function () {
      pushUndo(); M.removeRiser(m, r.id);
      app.view.selection = []; changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* TRACE panel: everything to do with the background drawing for this level. */
  function renderTraceProps(host) {
    var m = app.model;
    var lv = M.level(m, m.activeLevel);
    host.appendChild(el('h3', '', 'Trace — ' + lv.name));

    if (!lv.trace) {
      host.appendChild(el('p', 'hint',
        'Copy a screen snip of the drawing (Ctrl+V), or drag an image file onto the ' +
        'canvas. One drawing per level.'));
      host.appendChild(el('p', 'hint',
        'Then set the scale from a known distance, lock it, and trace over it in ' +
        'DRAW PIPE.'));
      return;
    }
    var t = lv.trace;

    // --- scale ---
    var cal = el('button', 'btn primary', 'Set scale from a known distance');
    cal.addEventListener('click', function () {
      app.view.startCalibration();
      toast('Click two points a known distance apart on the drawing. Esc cancels.');
    });
    host.appendChild(cal);
    host.appendChild(el('p', 'hint',
      'Click two points whose real separation you know — a gridline spacing, a ' +
      'dimensioned run, a column grid — then type that distance. Without this the ' +
      'scale is guesswork and every traced length has to be retyped.'));

    var wIn = el('input'); wIn.type = 'text';
    wIn.value = FD.units.fmtLength(t.width, m.settings.display.length);
    field(host, 'Drawing width (' + m.settings.display.length + ')', wIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(wIn.value);
        if (isFinite(v) && v > 0) {
          pushUndo();
          t.width = FD.units.toSILength(v, m.settings.display.length);
          changed();
        } else { wIn.value = FD.units.fmtLength(t.width, m.settings.display.length); }
      });

    // --- appearance ---
    var op = el('input'); op.type = 'range';
    op.min = '0.05'; op.max = '1'; op.step = '0.05';
    op.value = String(t.opacity === undefined ? 0.6 : t.opacity);
    field(host, 'Opacity', op).addEventListener('input', function () {
      t.opacity = parseFloat(op.value);
      app.view.render();
    });
    op.addEventListener('change', function () { scheduleSave(); });

    function toggle(label, key, note) {
      switchRow(host, label, !!t[key], function (on) {
        pushUndo(); t[key] = on; changed(); renderProperties();
      });
      if (note) host.appendChild(el('p', 'hint', note));
    }
    toggle('Hide grid while this trace is shown', 'hideGrid',
      'The grid is drawn over the trace and obscures a good deal of it at working ' +
      'zoom. While tracing, the drawing is the reference.');
    toggle('Invert colours', 'invert',
      'A PDF screenshot is black on white. Inverted, the paper goes dark and the ' +
      'linework goes light, so pipes stay readable on the dark theme.');
    toggle('Lock position', 'locked',
      'Locked once the scale is right, so drawing over it cannot nudge it.');

    // --- readout ---
    var info = el('div', 'readout');
    function ro(k, v) {
      var r = el('div', 'kv');
      r.appendChild(el('span', 'k', k));
      r.appendChild(el('span', 'v', v));
      info.appendChild(r);
    }
    ro('Size in model', FD.units.fmtLength(t.width, m.settings.display.length, true) +
       ' × ' + FD.units.fmtLength(t.width * t.aspect, m.settings.display.length, true));
    ro('Stored', FD.trace.sizeKB(t) + ' KB');
    host.appendChild(info);

    var del = el('button', 'btn danger', 'Discard trace');
    del.addEventListener('click', function () {
      FD.dialog.confirm({
        title: 'Discard the trace on ' + lv.name + '?',
        message: 'The drawing is removed from this level and from the saved model. ' +
                 'Anything you have already traced stays.',
        ok: 'Discard', danger: true
      }).then(function (yes) {
        if (!yes) return;
        pushUndo();
        M.clearTrace(m, lv.id);
        FD.trace.forget(lv.id);
        renderProperties(); renderLevels(); changed();
      });
    });
    host.appendChild(del);
  }

  function field(host, label, control) {
    var f = el('div', 'field');
    f.appendChild(el('label', '', label));
    f.appendChild(control);
    host.appendChild(f);
    return control;
  }

  /* The design K factor of anything that behaves as a resistance: an outflow,
   * a pump's design duty, a piece of equipment. K = Q_d/√ΔP_d — the same
   * design point the solver turns into r = ΔP_d/(ρ·g·Q_d²), stated the way an
   * engineer reads a terminal.
   *
   * Quoted in the MODEL'S OWN display units, with the unit written out, at
   * Michael's choice (2026-08-02). The sprinkler convention (L/min per √bar)
   * and the valve convention (Kv, m³/h at 1 bar) are different numbers for the
   * same thing, and a bare "K = 0.1" that silently meant one of the three
   * would be worse than no number at all. So the unit is never omitted.
   *
   * Returns null when the design point is incomplete — K is undefined at zero
   * pressure, which is the same reason an outflow refuses a zero design
   * pressure in the first place. */
  function designKRow(box, qSI, paSI) {
    var d = app.model.settings.display;
    if (!(qSI > 0) || !(paSI > 0)) {
      box.ro('K factor', '—');
      return null;
    }
    var q = FD.units.flow(qSI, d.flow);
    var p = FD.units.pressure(paSI, d.pressure);
    var k = q / Math.sqrt(p);
    var row = box.ro('K factor',
      (k >= 100 ? k.toFixed(1) : k >= 1 ? k.toFixed(3) : k.toPrecision(3)) +
      ' ' + d.flow + '/√' + d.pressure);
    row.title = 'K = design flow / √(design pressure) = ' +
                q.toPrecision(4) + ' / √' + p.toPrecision(4) + ', in this ' +
                'model’s display units. Not the sprinkler K (L/min per √bar) ' +
                'and not a valve Kv — convert before comparing with either.';
    return k;
  }

  /* An option as a sliding switch rather than a tick box (Michael, 2026-08-02).
   *
   * Same control as the pump's Running switch, and it replaces every checkbox
   * in the panels — a row of tick boxes and a row of switches in the same panel
   * read as two different kinds of setting when they are not.
   *
   * The OFF colour is muted rather than red, which is the one deliberate
   * difference from statusToggle. Red means a fault everywhere else in this
   * app; an unticked "show the tag on the drawing" is not a fault. Red/green
   * stays where off really is a state of the plant — a stopped pump, isolated
   * equipment. */
  function switchRow(host, label, checked, onChange) {
    var sw = el('button', 'switch plain' + (checked ? ' on' : ' off'));
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', checked ? 'true' : 'false');
    sw.appendChild(el('span', 'switch-track', ''));
    sw.appendChild(el('span', 'switch-label', label));
    sw.addEventListener('click', function () { onChange(!checked); });
    host.appendChild(sw);
    return sw;
  }

  function renderPipeProps(host, p) {
    if (!p) return;
    var m = app.model;
    if (p.kind === 'pump') { renderPumpProps(host, p); return; }
    if (p.kind === 'valve') { renderValveProps(host, p); return; }
    if (p.kind === 'equip') { renderEquipProps(host, p); return; }
    host.appendChild(el('h3', '', 'Pipe ' + p.id));

    // schedule
    var schSel = el('select');
    var all = FD.schedules.all(m.customSchedules);
    Object.keys(all).forEach(function (k) {
      var o = el('option', '', all[k].name); o.value = k;
      if (k === p.schedule) o.selected = true;
      schSel.appendChild(o);
    });
    field(host, 'Schedule', schSel).addEventListener('change', function () {
      pushUndo();
      p.schedule = schSel.value;
      if (!FD.schedules.get(p.schedule, m.customSchedules).sizes
            .some(function (x) { return x.label === p.size; })) {
        p.size = FD.schedules.defaultSize(p.schedule, m.customSchedules);
      }
      renderProperties(); changed();
    });

    // size
    var sizeSel = el('select');
    FD.schedules.get(p.schedule, m.customSchedules).sizes.forEach(function (sz) {
      var o = el('option', '', sz.label + '  (' + sz.id_mm.toFixed(1) + ' mm)');
      o.value = sz.label;
      if (sz.label === p.size) o.selected = true;
      sizeSel.appendChild(o);
    });
    field(host, 'Size', sizeSel).addEventListener('change', function () {
      pushUndo(); p.size = sizeSel.value; changed();
    });

    // C factor
    var cIn = el('input'); cIn.type = 'number'; cIn.value = p.C; cIn.step = '1';
    field(host, 'C factor', cIn).addEventListener('change', function () {
      var v = FD.units.parse(cIn.value);
      if (isFinite(v) && v > 0) { pushUndo(); p.C = v; changed(); }
      else { cIn.value = p.C; toast('C factor must be a positive number.', 'error'); }
    });

    // length (read-only derived, but editable for straight pipes)
    var len = M.pipeLength(m, p);
    var lenIn = el('input');
    lenIn.type = 'text';
    lenIn.value = FD.units.fmtLength(len, m.settings.display.length);
    field(host, 'Length (' + m.settings.display.length + ')', lenIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(lenIn.value);
        if (!isFinite(v) || v <= 0) { lenIn.value = FD.units.fmtLength(len, m.settings.display.length); return; }
        pushUndo();
        var ok = setPipeLength(p, FD.units.toSILength(v, m.settings.display.length));
        if (!ok) {
          app.undoStack.pop();
          lenIn.value = FD.units.fmtLength(len, m.settings.display.length);
        }
        changed();
      });

    // derived read-outs
    var res = app.results;
    if (res && res.network) {
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      var q = res.flow[p.id];
      if (link && q !== undefined) {
        var info = el('div', 'readout');
        function ro(k, v) {
          var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
          r.appendChild(el('span', 'v', v)); info.appendChild(r);
        }
        ro('L drawn', FD.units.fmtLength(link._L, m.settings.display.length, true));
        ro('EL fittings', FD.units.fmtLength(link._el, m.settings.display.length, true) +
                          (link._types.length ? '  (' + FD.fittings.summarise(link._types) + ')' : ''));
        ro('L effective', FD.units.fmtLength(link._Leff, m.settings.display.length, true));
        ro('Flow', FD.units.fmtFlow(Math.abs(q), m.settings.display.flow, true));
        ro('Velocity', FD.hydraulics.velocity(q, link._d).toFixed(2) + ' m/s');

        /* Pressure drop and friction rate — the two numbers a pipe is sized
         * against, and they were the only ones missing from this panel.
         *
         * PD is over the EFFECTIVE length (fittings included), because that is
         * the loss the section actually contributes. PD/m is over the ACTUAL
         * drawn length excluding fittings, which is the basis of the ~400 Pa/m
         * rule and of the PDM warning — the two figures are deliberately on
         * different lengths, so they are labelled to say so. */
        var rho = (m.settings.fluid && m.settings.fluid.density) || 998;
        var pdPa = FD.units.headToPaWith(
          Math.abs(FD.hydraulics.linkLoss(link, q)), rho);
        ro('Actual PD', FD.units.fmtPressure(pdPa, m.settings.display.pressure, true) +
                            '  (incl. fittings)');
        if (link._L > 1e-9) {
          var pdmVal = FD.hydraulics.pdPerMetre(link._rActual, q, link.n, link._L, rho);
          ro('PD/m', FD.units.fmtPdm(pdmVal, m.settings.display.pdm, true) +
                     '  (pipe only)');
        }
        host.appendChild(info);
      }
    }

    var del = el('button', 'btn danger', 'Delete pipe');
    del.addEventListener('click', function () {
      pushUndo(); M.removePipe(app.model, p.id);
      app.view.selection = []; changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* VIEW mode: which of this entity's values are echoed on the drawing.
   * Only offered in VIEW, because that is the mode for arranging a drawing
   * for print — in EDIT they would be noise. */
  function displayChecks(host, obj, opts) {
    if (app.view.tool !== 'view') return;
    host.appendChild(el('h3', 'sub', 'Show on drawing'));
    opts.forEach(function (o) {
      switchRow(host, o.label, !!M.displayFlags(obj)[o.key], function (on) {
        pushUndo();
        M.setDisplayFlag(obj, o.key, on);
        changed(); renderProperties();
      });
    });
  }

  /* Equipment tag. Shared by every in-line device — it is the reference the
   * engineer works from on site, so it belongs on all of them, not just
   * equipment. */
  function tagField(host, p) {
    var i = el('input'); i.type = 'text'; i.value = p.tag || '';
    i.placeholder = 'e.g. CHW-P-01';
    field(host, 'Tag', i).addEventListener('change', function () {
      pushUndo();
      var v = i.value.trim();
      if (v) p.tag = v; else delete p.tag;
      changed();
    });
  }

  /* Spec §8.3 — an in-line device with a rated flow and pressure drop.
   * ΔP scales as (Q/Q_rated)². */
  function renderEquipProps(host, p) {
    var m = app.model, d = m.settings.display;
    host.appendChild(el('h3', '', 'Equipment ' + p.id));
    tagField(host, p);
    flipField(host, p);

    /* Isolating equipment is a break in the circuit, not a bypass — same as a
     * stopped pump. Without this the only way to take a chiller out of a model
     * was to delete it and redraw it later. */
    statusToggle(host, !p.equip.off, 'In service', 'Isolated (no flow)',
      function (on) {
        pushUndo();
        if (on) delete p.equip.off; else p.equip.off = true;
        renderProperties(); changed();
      });

    var qIn = el('input'); qIn.type = 'text';
    qIn.value = FD.units.fmtFlow(p.equip.qRated || 0, d.flow);
    field(host, 'Design flow (' + d.flow + ')', qIn).addEventListener('change', function () {
      var v = FD.units.parse(qIn.value);
      if (isFinite(v) && v > 0) {
        pushUndo(); p.equip.qRated = FD.units.toSIFlow(v, d.flow); changed();
      } else { qIn.value = FD.units.fmtFlow(p.equip.qRated || 0, d.flow); }
    });

    var pdIn = el('input'); pdIn.type = 'text';
    pdIn.value = FD.units.fmtPressure(p.equip.pdRated || 0, d.pressure);
    field(host, 'Design pressure drop (' + d.pressure + ')', pdIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(pdIn.value);
        if (isFinite(v) && v >= 0) {
          pushUndo(); p.equip.pdRated = FD.units.toSIPressure(v, d.pressure); changed();
        } else { pdIn.value = FD.units.fmtPressure(p.equip.pdRated || 0, d.pressure); }
      });

    designKRow(readoutBox(host, null), p.equip.qRated, p.equip.pdRated);

    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      var q = res.flow[p.id];
      var info = el('div', 'readout');
      function ro(k, v) {
        var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v)); info.appendChild(r);
      }
      ro('Actual flow', FD.units.fmtFlow(Math.abs(q), d.flow, true));
      if (link) {
        ro('Actual PD', FD.units.fmtPressure(
          headToPa(Math.abs(FD.hydraulics.linkLoss(link, q))), d.pressure, true));
      }
      host.appendChild(info);
    }
    displayChecks(host, p, [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'pd', label: 'Pressure drop' }
    ]);

    var del = el('button', 'btn danger', 'Remove equipment');
    del.addEventListener('click', function () {
      pushUndo(); p.kind = 'pipe'; delete p.equip;
      changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* Valves are sized by flow coefficient. Kv and Cv are the same number in
   * different units, so editing either updates the other — the model always
   * stores Kv. */
  function renderValveProps(host, p) {
    var m = app.model;
    var v = p.valve;
    var t = FD.valves.type(v.type);
    host.appendChild(el('h3', '', 'Valve ' + p.id));
    tagField(host, p);
    if (t && t.checkValve) flipField(host, p);

    var typeSel = el('select');
    Object.keys(FD.valves.types).forEach(function (k) {
      var o = el('option', '', FD.valves.types[k].name); o.value = k;
      if (k === v.type) o.selected = true;
      typeSel.appendChild(o);
    });
    field(host, 'Type', typeSel).addEventListener('change', function () {
      pushUndo();
      v.type = typeSel.value;
      // Re-default Kv for the new type unless the user has clearly set it.
      v.kv = FD.valves.defaultKv(v.type, M.pipeBore(m, p) * 1000);
      renderProperties(); changed();
    });

    /* Opening as a SLIDER snapped to the five documented positions. A dropdown
     * hid the fact that this is a continuum being sampled, and made comparing
     * positions a menu-open away; a slider shows travel at a glance, which is
     * what "how far open is that valve" means. */
    if (t.adjustable) {
      var openWrap = el('div', 'field');
      var openLbl = el('label', '', 'Opening');
      openWrap.appendChild(openLbl);
      var slider = el('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '25';
      slider.value = String(v.opening === undefined ? 100 : v.opening);
      var readout = el('span', 'hint', slider.value + '% open' +
                       (Number(slider.value) === 0 ? ' (shut)' : ''));
      slider.addEventListener('input', function () {
        readout.textContent = slider.value + '% open' +
          (Number(slider.value) === 0 ? ' (shut)' : '');
      });
      slider.addEventListener('change', function () {
        pushUndo(); v.opening = parseInt(slider.value, 10);
        renderProperties(); changed();
      });
      openWrap.appendChild(slider);
      openWrap.appendChild(readout);
      host.appendChild(openWrap);
    } else {
      host.appendChild(el('p', 'hint',
        'A check valve is not user-positioned — it opens with forward flow and ' +
        'seats against reverse flow automatically.'));
    }

    /* ONE coefficient, not both. Kv and Cv are the same quantity in different
     * units, so showing both invited typing into the one being ignored. Which
     * one appears is a display choice (SETTINGS ▸ Display units), defaulting to
     * Kv. */
    var useCv = (m.settings.display.valveCoef === 'Cv');
    var coefIn = el('input'); coefIn.type = 'text';
    coefIn.value = useCv ? FD.valves.kvToCv(v.kv).toFixed(1) : String(v.kv);
    field(host, useCv ? 'Cv (US gpm at 1 psi)' : 'Kv (m³/h at 1 bar)', coefIn)
      .addEventListener('change', function () {
        var val = FD.units.parse(coefIn.value);
        if (isFinite(val) && val > 0) {
          pushUndo();
          v.kv = useCv ? Math.round(FD.valves.cvToKv(val) * 10) / 10 : val;
          renderProperties(); changed();
        } else {
          coefIn.value = useCv ? FD.valves.kvToCv(v.kv).toFixed(1) : String(v.kv);
          toast((useCv ? 'Cv' : 'Kv') + ' must be a positive number.', 'error');
        }
      });

    var reset = el('button', 'btn', 'Reset ' + (useCv ? 'Cv' : 'Kv') + ' for this size');
    reset.addEventListener('click', function () {
      pushUndo();
      v.kv = FD.valves.defaultKv(v.type, M.pipeBore(m, p) * 1000);
      renderProperties(); changed();
    });
    host.appendChild(reset);

    // effective Kv and the resulting drop
    var info = el('div', 'readout');
    function ro(k, val) {
      var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
      r.appendChild(el('span', 'v', val)); info.appendChild(r);
    }
    var effKv = FD.valves.effectiveKv(v.type, v.kv, v.opening);
    ro('Effective ' + (useCv ? 'Cv' : 'Kv'),
       (useCv ? FD.valves.kvToCv(effKv) : effKv).toFixed(1) +
       (v.opening < 100 ? '  (' + v.opening + '% open)' : ''));

    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var q = res.flow[p.id];
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      ro('Flow', FD.units.fmtFlow(Math.abs(q), m.settings.display.flow, true));
      if (link) {
        if (link.r >= FD.valves.CLOSED_R) {
          ro('Actual PD', 'Shut — no flow path');
        } else {
          var pd = headToPa(Math.abs(FD.hydraulics.linkLoss(link, q)));
          ro('Actual PD', FD.units.fmtPressure(pd, m.settings.display.pressure, true));
        }
        if (link._checkShut) ro('State', 'Seated (holding back-flow)');
      }
    }
    host.appendChild(info);

    host.appendChild(el('p', 'hint',
      'Default Kv values are derived from typical resistance coefficients, not ' +
      'manufacturer data. Replace with published Kv for real design work.'));

    displayChecks(host, p, [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'pd', label: 'Pressure drop' }
    ]);

    var del = el('button', 'btn danger', 'Remove valve');
    del.addEventListener('click', function () {
      pushUndo(); p.kind = 'pipe'; delete p.valve;
      changed(); renderProperties();
    });
    host.appendChild(del);
  }


  /* A boxed group of read-only values — the same shape the equipment panel
   * already uses for its actual duty. Returns the box plus a `ro(k, v)` to add
   * rows with; the box is appended straight away so buttons can follow the
   * rows inside it. */
  function readoutBox(host, title) {
    var box = el('div', 'readout');
    if (title) box.appendChild(el('h4', 'readout-title', title));
    host.appendChild(box);
    return {
      box: box,
      ro: function (k, v) {
        var r = el('div', 'kv');
        r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v));
        box.appendChild(r);
        return r;
      }
    };
  }

  /* Explanation behind a marker rather than on the panel, for the same reason
   * as the info marker in TOOLS: it matters, but it is a footnote read once,
   * and as body text it was longer than the controls it sat above. */
  function infoMark(host, text) {
    var i = el('span', 'info-mark', '🛈');
    i.title = text;
    host.appendChild(i);
    return i;
  }

  /* The design duty this pump was sized for.
   *
   * Recorded onto the pump by every DESIGN solve (network.recordDesignPoint),
   * because in SIMULATION nothing re-sizes it and the panel still has to show
   * what it was selected FOR beside what it is doing. The live fallback covers
   * the moment before the first solve of a freshly placed pump. */
  function pumpDesignPoint(p) {
    var res = app.results;
    var q = p.pump.qDesign;
    if (!(q >= 0) && res && res.flow && res.flow[p.id] !== undefined) {
      q = Math.abs(res.flow[p.id]);
    }
    var h = p.pump.hDesign;
    if (!(h >= 0)) h = p.pump.head;
    return { q: q >= 0 ? q : null, h: h >= 0 ? h : null };
  }

  /* What the pump is ACTUALLY doing, which is the question in front of you when
   * a pump is selected, plus the ways to give it a curve.
   *
   * Shutoff head, max flow, the stored form, the curve's provenance and the fit
   * statistics were all shown here once; they describe the curve rather than
   * the duty, and pushed the two numbers that matter off the bottom. The
   * fit-quality warning is kept — a curve that does not fit must stay visible. */
  function renderPumpCurve(host, p) {
    var m = app.model;
    var pu = m.settings.display.pressure, fu = m.settings.display.flow;

    var c = p.pump.curve;
    {
      var d = readoutBox(host, 'Actual').box;
      function ro(k, v) {
        var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v)); d.appendChild(r);
      }
      var pres = app.results;
      var pOff = p.pump.mode === 'off';
      var qNow = pOff ? 0
               : (pres && pres.flow && pres.flow[p.id] !== undefined
                  ? Math.abs(pres.flow[p.id]) : null);
      /* A stopped pump develops no head. Reading its curve at Q = 0 would
       * report shutoff head, which is what it WOULD make if it were running.
       * With no curve the pump IS its fixed head — what the solver used. */
      var hNow = pOff ? 0
               : qNow === null ? null
               : c ? FD.pumps.head(c, qNow) : (p.pump.head || 0);
      ro('Actual flow', qNow === null ? '—' : FD.units.fmtFlow(qNow, fu, true));
      ro('Actual pressure', hNow === null ? '—'
         : FD.units.fmtPressure(headToPa(hNow), pu, true));
      if (c && c.fit) {
        /* A bad fit must be visible. A manufacturer curve that does not take
         * this form should be the engineer's problem to see, not a silent
         * error in the answers. */
        if (c.fit.r2 < 0.98 || c.fit.maxDev > 1) {
          d.appendChild(el('p', 'hint warn',
            'This curve does not fit H = H\u2080 \u2212 a\u00b7Q^b well. Check the pasted data.'));
        }
      }
    }

    var row = el('div', 'btn-row');

    /* With no curve, the way to GET one is the offer \u2014 not a paragraph saying
     * where to look. The generator opens pre-filled with this pump's design
     * duty, which is the first thing it asks for. */
    if (!c) {
      var gen = el('button', 'btn', 'New curve\u2026');
      gen.title = 'Open TOOLS \u25b8 Pump Curve Generator, pre-filled with this ' +
                  'pump\u2019s design duty.';
      gen.addEventListener('click', function () {
        var dp = pumpDesignPoint(p);
        if (FD.tools && FD.tools.prefill) {
          FD.tools.prefill(
            dp.q === null ? '' : FD.units.fmtFlow(dp.q, fu),
            dp.h === null ? '' : FD.units.fmtPressure(headToPa(dp.h), pu));
        }
        if (app.showTab) app.showTab('pane-tools');
        if (FD.tools) FD.tools.render(app);
      });
      row.appendChild(gen);
    }

    var paste = el('button', 'btn', 'Paste curve data\u2026');
    paste.addEventListener('click', function () {
      FD.dialog.form({
        title: 'Paste pump curve',
        message: 'Two columns: flow then head. Tab, comma, semicolon or spaced columns — ' +
                 'paste straight from a spreadsheet. A header row is skipped.\n\n' +
                 'Units are taken as ' + fu + ' and ' + pu + '.',
        fields: [{ key: 'data', label: 'Flow (' + fu + ')   Head (' + pu + ')',
                   type: 'textarea', rows: 10, value: '' }]
      }).then(function (v) {
        if (!v || !v.data || !v.data.trim()) return;
        var parsed = FD.pumps.parseCurve(v.data, fu, pu, m.settings.fluid && m.settings.fluid.density);
        if (parsed.points.length < 3) {
          FD.dialog.alert({ title: 'Not enough points',
            message: 'Read ' + parsed.points.length + ' usable point(s). At least three are ' +
                     'needed to fit a curve — two only ever fit perfectly and tell you nothing.' });
          return;
        }
        var curve = FD.pumps.fit(parsed.points);
        if (!curve) {
          FD.dialog.alert({ title: 'Cannot fit a curve',
            message: 'The points do not describe a head that falls with flow. Check the ' +
                     'column order — flow first, head second.' });
          return;
        }
        /* Keep the design duty for the 0-150% table: the fit itself has no
         * opinion about which point on it is the duty. */
        var res = app.results;
        curve.Qd = res && res.flow[p.id] !== undefined ? Math.abs(res.flow[p.id]) : undefined;
        if (!curve.Qd) curve.Qd = FD.pumps.maxFlow(curve) / 2;
        curve.Hd = FD.pumps.head(curve, curve.Qd);
        pushUndo();
        p.pump.curve = curve;
        renderProperties(); changed();
        if (parsed.skipped.length) {
          FD.dialog.alert({ title: 'Curve fitted',
            message: 'Fitted ' + curve.fit.n + ' points (r\u00b2 = ' + curve.fit.r2.toFixed(5) +
                     '). ' + parsed.skipped.length + ' line(s) could not be read and were ignored.' });
        }
      });
    });
    row.appendChild(paste);

    if (c) {
      var tbl = el('button', 'btn', 'Show table');
      tbl.addEventListener('click', function () {
        var rows = FD.pumps.table(c);
        var lines = ['   %      Flow (' + fu + ')      Head (' + pu + ')'].concat(
          rows.map(function (r) {
            return String(r.pct).padStart(4) + '   ' +
                   FD.units.fmtFlow(r.q, fu).padStart(12) + '   ' +
                   FD.units.fmtPressure(headToPa(r.h), pu).padStart(14);
          }));
        FD.dialog.report({
          title: 'Pump curve \u2014 ' + (p.tag || p.id),
          message: 'Generated from H = H\u2080 \u2212 a\u00b7Q^b, 0\u2013150% of design flow.',
          rows: lines
        });
      });
      row.appendChild(tbl);

      var clr = el('button', 'btn', 'Clear');
      clr.addEventListener('click', function () {
        pushUndo(); delete p.pump.curve; renderProperties(); changed();
      });
      row.appendChild(clr);
    }
    host.appendChild(row);
  }

  /* On/off as a sliding switch rather than a dropdown, red when off and green
   * when running. Whether a pump or a chiller is in service is a state you scan
   * for on a busy model, and a two-item dropdown reads as neither state until
   * you look at the words in it. Shared by pumps and equipment so the two
   * cannot drift apart, and mirrored by the on/off button on the drawing. */
  function statusToggle(host, isOn, onLabel, offLabel, apply) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', '', 'Status'));
    var sw = el('button', 'switch' + (isOn ? ' on' : ' off'));
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', isOn ? 'true' : 'false');
    sw.appendChild(el('span', 'switch-track', ''));
    sw.appendChild(el('span', 'switch-label', isOn ? onLabel : offLabel));
    sw.addEventListener('click', function () { apply(!isOn); });
    wrap.appendChild(sw);
    host.appendChild(wrap);
    return sw;
  }

  /* Devices have a direction and none of them pass flow backwards, so there has
   * to be a way to turn one round without redrawing it. Swapping the pipe's own
   * endpoints is the whole operation — every direction-sensitive rule in the
   * engine reads a→b. */
  function flipField(host, p) {
    var kindName = p.kind === 'pump' ? 'Pump'
                 : p.kind === 'equip' ? 'Equipment' : 'Valve';
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', '', 'Direction'));
    var box = el('div', 'btn-row');
    var lbl = el('span', 'hint', p.a + ' \u2192 ' + p.b);
    var btn = el('button', 'btn tiny', '\u2039 \u203a');
    btn.title = 'Flip ' + kindName.toLowerCase() + ' direction (no flow is allowed ' +
                'against it)';
    btn.addEventListener('click', function () {
      pushUndo();
      M.flipPipe(app.model, p.id);
      renderProperties(); changed();
    });
    box.appendChild(btn);
    box.appendChild(lbl);
    wrap.appendChild(box);
    host.appendChild(wrap);
  }

  var PUMP_INFO =
    'In DESIGN mode the pump is automatically sized to meet the demand of ' +
    'Outflow or Equipment. A pump curve with at least 3 points is required for ' +
    'pipe simulation (see TOOLS>Pump Curve Generator).';

  /* Spec §8.4, restructured 2026-08-02.
   *
   * Head is no longer a settable parameter. It never was one in practice —
   * DESIGN auto-sizes it and SIMULATION reads it off the curve — so the box
   * sat there permanently disabled, carrying a change handler that could not
   * fire and inviting the question "why can I not type in this?".
   *
   * What replaces it is the same two-box shape equipment uses: what the pump
   * was SIZED FOR, and what it is DOING. In DESIGN those agree by
   * construction; in SIMULATION the gap between them is the whole answer. */
  function renderPumpProps(host, p) {
    var m = app.model, d = m.settings.display;
    var h3 = el('h3', '', 'Pump ' + p.id);
    infoMark(h3, PUMP_INFO);
    host.appendChild(h3);

    tagField(host, p);
    /* Not in the requested order, but a pump that cannot be turned round has to
     * be redrawn to be reversed. Kept between Tag and Status. */
    flipField(host, p);

    /* Just running or not. There is no sizing choice to make: DESIGN always
     * auto-sizes, and SIMULATION always reads the curve. A 'fixed head' option
     * only ever meant 'a pump that ignores its own curve', which is not a thing
     * worth being able to model. */
    statusToggle(host, p.pump.mode !== 'off', 'Running', 'Off (isolated, no flow)',
      function (on) {
        pushUndo();
        p.pump.mode = on ? 'auto' : 'off';
        if (on) autoSizePump(p);
        renderProperties(); changed();
      });

    // ---- design: what this pump was sized for ----
    var dp = pumpDesignPoint(p);
    var db = readoutBox(host, 'Design');
    db.ro('Design flow', dp.q === null ? '—' : FD.units.fmtFlow(dp.q, d.flow, true));
    db.ro('Design pressure', dp.h === null ? '—'
          : FD.units.fmtPressure(headToPa(dp.h), d.pressure, true) +
            '  (' + dp.h.toFixed(2) + ' m)');
    /* The safety factor is a SELECTION margin, not part of the hydraulics.
     * Baking it into the solve made a 10% margin push 21 L/s through equipment
     * rated for 20, so it is reported here instead. */
    var pct = m.settings.pumpSafetyPct || 0;
    if (pct && dp.h !== null) {
      var dutyH = dp.h * (1 + pct / 100);
      db.ro('Select against (+' + pct + '%)',
            FD.units.fmtPressure(headToPa(dutyH), d.pressure, true) +
            '  (' + dutyH.toFixed(2) + ' m)');
    }
    /* A pump's design duty read as a resistance, so it can be compared with the
     * terminals it is feeding on the same basis. */
    designKRow(db, dp.q, dp.h === null ? 0 : headToPa(dp.h));
    if (p.pump.mode === 'auto') {
      var rrow = el('div', 'btn-row');
      var btn = el('button', 'btn', 'Re-size');
      if (m.settings.calcMode === 'simulation') {
        btn.disabled = true;
        btn.title = 'Sizing is a DESIGN operation — in SIMULATION the curve ' +
                    'decides the operating point.';
      }
      btn.addEventListener('click', function () {
        pushUndo(); autoSizePump(p); renderProperties(); changed();
      });
      rrow.appendChild(btn);
      db.box.appendChild(rrow);
    }

    // ---- actual: what it is doing, and where a curve comes from ----
    /* The curve is the INPUT to SIMULATION, so it has to be enterable in
     * DESIGN. Gating it behind SIMULATION created a deadlock: you could not
     * reach SIMULATION without a curve, and could not add a curve without
     * being in SIMULATION. It stays reachable on an OFF pump for the same
     * reason — the deadlock would just move. */
    renderPumpCurve(host, p);

    if (p.pump.mode === 'off') {
      host.appendChild(el('p', 'hint',
        'An off pump is modelled as isolated — no flow passes through it. Without this, ' +
        'a running pump short-circuits backwards through its idle neighbours.'));
    }

    displayChecks(host, p, [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'head', label: 'Head' }
    ]);

    var del = el('button', 'btn danger', 'Remove pump');
    del.addEventListener('click', function () {
      pushUndo();
      p.kind = 'pipe'; delete p.pump;
      changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* Auto-size: solve, find the largest demand shortfall, raise the pump by that
   * much plus the safety factor, and re-solve until it stops moving. */
  function autoSizePump(p) {
    var m = app.model;
    for (var i = 0; i < 12; i++) {
      var res = FD.network.solveModel(m);
      var worst = 0;
      m.nodes.forEach(function (n) {
        if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
        if (res.pressure[n.id] === undefined) return;
        var short = (n.device.reqPressure || 0) - res.pressure[n.id];
        if (short > worst) worst = short;
      });
      if (worst <= 1) break;                            // within 1 Pa — done
      var add = FD.units.paToHeadWith(worst, m.settings.fluid && m.settings.fluid.density) *
                (1 + (m.settings.pumpSafetyPct || 0) / 100);
      p.pump.head = (p.pump.head || 0) + add;
    }
    toast('Pump sized to ' + (p.pump.head || 0).toFixed(2) + ' m head.');
  }

  /* Spec §6: changing a pipe's length translates everything on the far side
   * rigidly, so no other pipe's length changes. The heavy lifting lives in
   * FD.geometry (UI-free and unit-tested); this only decides what to show when
   * the change cannot be made rigidly.
   *
   * Returns true if applied synchronously; false if refused or if a dialog
   * took over (the caller must not assume the model changed). */
  function setPipeLength(p, newLen) {
    var result = FD.geometry.changeLength(app.model, p.id, newLen);
    if (result.ok) {
      app.view.conflict = null;
      return true;
    }

    if (result.code === 'LOOP' || result.code === 'RISER_TORN') {
      showGeometryConflict(p, newLen, result);
      return false;
    }
    toast(result.message || 'Length could not be changed.', 'error');
    return false;
  }

  /* Geometry conflict: highlight the offending loop and offer a way out.
   * Cancel leaves the model alone, Delete removes the pipe (which breaks the
   * loop), Repair adjusts the opposing member so the requested length fits. */
  function showGeometryConflict(p, newLen, result) {
    var m = app.model;
    app.view.conflict = result.conflict || [];
    app.view.render();

    var lenTxt = FD.units.fmtLength(newLen, m.settings.display.length, true);
    var current = FD.units.fmtLength(M.pipeLength(m, p), m.settings.display.length, true);

    FD.dialog.choose({
      title: 'Geometry error',
      message: (result.message || '') + '\n\n' +
               'Pipe ' + p.id + ' (' + p.a + ' → ' + p.b + ')  ' +
               current + ' → ' + lenTxt + '\n' +
               'The highlighted sections form the loop that blocks the change.',
      cancelValue: 'cancel',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete pipe', cls: 'danger-solid', value: 'delete' },
        { label: 'Repair', cls: 'primary', value: 'repair' }
      ]
    }).then(function (choice) {
      app.view.conflict = null;

      if (choice === 'delete') {
        pushUndo();
        M.removePipe(m, p.id);
        app.view.selection = [];
        renderProperties();
        changed();
        toast('Pipe ' + p.id + ' deleted.');
        return;
      }

      if (choice === 'repair') {
        pushUndo();
        var rep = FD.geometry.repairLength(m, p.id, newLen);
        if (!rep.ok) {
          app.undoStack.pop();
          updateHistoryButtons();
          FD.dialog.alert({ title: 'Repair failed', message: rep.message });
          app.view.render();
          return;
        }
        renderProperties();
        changed();
        showRepairReport(rep);
        return;
      }

      app.view.render();          // cancelled — just clear the highlight
    });
  }

  /* Repair log. The heuristic in FD.geometry can only be trusted if what it
   * did is visible, so every length it moved is listed with node numbers and
   * old → new, and can be copied out for the record. */
  function showRepairReport(rep) {
    var m = app.model, u = m.settings.display.length;
    var rows = rep.changes.map(function (c) {
      return c.pipe + '   ' + c.from + ' → ' + c.to + '   ' +
             FD.units.fmtLength(c.oldLength, u) + ' → ' +
             FD.units.fmtLength(c.newLength, u) + ' ' + u;
    });

    var header = ['Section  Nodes           Old → New (' + u + ')',
                  '-'.repeat(46)];

    FD.dialog.report({
      title: 'Repair complete',
      message: rep.changes.length + ' pipe section' + (rep.changes.length === 1 ? '' : 's') +
               ' changed length.',
      rows: header.concat(rows),
      text: ['FreePipeCalc geometry repair',
             'Project: ' + (m.settings.meta.project || '—'),
             'Date: ' + new Date().toISOString().slice(0, 19).replace('T', ' '),
             ''].concat(header, rows).join('\n'),
      footer: 'Repair adjusts the member of the loop most parallel to the pipe you edited. ' +
              'Check the list above against your intent before relying on it.'
    }).then(function (r) {
      if (r === 'copied') {
        toast('Repair list copied to the clipboard.');
        showRepairReport(rep);      // Copy should not dismiss the window
      }
    });
  }

  function renderNodeProps(host, n) {
    if (!n) return;
    var m = app.model;
    host.appendChild(el('h3', '', 'Node ' + n.id));
    if (n.device) {
      var tIn = el('input'); tIn.type = 'text'; tIn.value = n.tag || '';
      tIn.placeholder = 'e.g. AHU-01';
      field(host, 'Tag', tIn).addEventListener('change', function () {
        pushUndo();
        var v = tIn.value.trim();
        if (v) n.tag = v; else delete n.tag;
        changed();
      });
    }

    var dev = n.device;
    /* The Type selector is for turning a PLAIN node into a device. Once it is
     * already an outflow the row only offers ways to destroy it by accident,
     * and Delete does that deliberately when it is meant. */
    if (!(dev && dev.kind === 'demand')) {
      var kindSel = el('select');
      [['', 'Junction'], ['source', 'Source (reservoir)'], ['demand', 'Outflow']]
        .forEach(function (kv) {
          var o = el('option', '', kv[1]); o.value = kv[0];
          if ((dev ? dev.kind : '') === kv[0]) o.selected = true;
          kindSel.appendChild(o);
        });
      field(host, 'Type', kindSel).addEventListener('change', function () {
        pushUndo();
        if (kindSel.value === 'source') M.setSource(m, n.id);
        else if (kindSel.value === 'demand') M.setDemand(m, n.id, 0.001, 100000);
        else M.clearDevice(m, n.id);
        renderProperties(); changed();
      });
    }

    if (dev && dev.kind === 'demand') {
      var simulating = (m.settings.calcMode === 'simulation');

      /* Presented like EQUIPMENT: the design point in one group, what the
       * terminal actually does in another.
       *
       * The design point stays EDITABLE in SIMULATION, which is the change
       * here. It is not a result there — it is the input the terminal's
       * characteristic is derived from, K = Q_d/sqrt(ΔP_d) — so disabling it
       * hid the one number driving the simulated flow, and showed the actual
       * flow in a box labelled as the design flow. */
      var fIn = el('input'); fIn.type = 'text';
      fIn.value = FD.units.fmtFlow(dev.flow, m.settings.display.flow);
      field(host, 'Design flow (' + m.settings.display.flow + ')', fIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(fIn.value);
          if (isFinite(v) && v >= 0) {
            pushUndo();
            dev.flow = FD.units.toSIFlow(v, m.settings.display.flow);
            changed();
          } else { fIn.value = FD.units.fmtFlow(dev.flow, m.settings.display.flow); }
        });

      var pIn = el('input'); pIn.type = 'text';
      pIn.value = FD.units.fmtPressure(dev.reqPressure, m.settings.display.pressure);
      field(host, 'Design pressure (' + m.settings.display.pressure + ')', pIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(pIn.value);
          if (!isFinite(v)) {
            pIn.value = FD.units.fmtPressure(dev.reqPressure, m.settings.display.pressure);
            return;
          }
          var pa = FD.units.toSIPressure(v, m.settings.display.pressure);
          /* Zero is not a low number here, it is a physical impossibility:
           * water does not leave a pipe against nothing. It also leaves the
           * terminal characteristic K = Q/sqrt(dP) undefined, which SIMULATION
           * is built on. */
          if (pa < M.MIN_OUTFLOW_PRESSURE) {
            var minTxt = FD.units.fmtPressure(M.MIN_OUTFLOW_PRESSURE,
                                              m.settings.display.pressure, true);
            FD.dialog.alert({
              title: 'Outflow pressure cannot be zero',
              message: 'Outflow ' + (n.tag || n.id) + ' is set to ' +
                       FD.units.fmtPressure(pa, m.settings.display.pressure, true) + '. ' +
                       'If no pressure is required, set it to a minimum of ' + minTxt + '.'
            });
            pIn.value = FD.units.fmtPressure(dev.reqPressure, m.settings.display.pressure);
            return;
          }
          pushUndo();
          dev.reqPressure = pa;
          changed();
        });

      /* The terminal characteristic the design point above defines. This is the
       * number SIMULATION actually runs on, so it belongs beside the two inputs
       * it comes from rather than only inside the engine. */
      designKRow(readoutBox(host, null), dev.flow, dev.reqPressure);

      switchRow(host, 'Include in calculation', dev.include !== false, function (on) {
        pushUndo(); dev.include = on; changed(); renderProperties();
      });
      /* In SIMULATION the terminal is a resistance derived from the design
       * point above, so its flow is an OUTPUT: Q = Q_d·sqrt(P_node/ΔP_d),
       * with P_node set by the pump curve through the solve. Reported in its
       * own box, exactly as equipment reports its actual duty. */
      if (simulating) {
        var sim = app.results && app.results.simulation;
        var act = sim && sim.terminals.filter(function (t2) {
          return t2.node === n.id; })[0];
        var ab = readoutBox(host, 'Actual');
        ab.ro('Actual flow', act ? FD.units.fmtFlow(act.actualFlow, m.settings.display.flow, true)
                                 : '—');
        ab.ro('Actual pressure',
              act && act.actualPressure !== undefined && act.actualPressure !== null
                ? FD.units.fmtPressure(act.actualPressure, m.settings.display.pressure, true)
                : '—');
        /* No "% of design" and no balancing Kv here (Michael, 2026-08-02).
         * Both are comparisons across the whole system rather than properties
         * of this terminal, and both are already on the calculation sheet,
         * which is where a set of them can be read against each other. */
        if (dev.include === false) {
          ab.box.appendChild(el('p', 'hint',
            'Excluded from the calculation, so it draws nothing.'));
        }
      }
    }

    /* Only a SOURCE states a static pressure. On an outflow the same field
     * read as if it set the terminal's own pressure, which it does not — the
     * outflow's number is its DESIGN pressure, edited above. */
    if (n.device && n.device.kind === 'source') {
      /* Stated as a PRESSURE and stored as one, on the DEVICE.
       *
       * It used to be stored as the node's `dz` — a height — because a tank
       * raised 20 m does provide 200 kPa. Downstream that was right, but `dz`
       * is a real elevation, so entering a pressure physically lifted the node
       * and stretched every pipe on it in 3D: a 50 m run became 54.01 m and
       * could not be typed back (Michael, 2026-08-02). Pressure and elevation
       * are separate properties and are now stored separately. */
      var spUnit = m.settings.display.pressure;
      var spIn = el('input'); spIn.type = 'text';
      var readSp = function () {
        return FD.units.fmtPressure(n.device.pressure || 0, spUnit);
      };
      spIn.value = readSp();
      field(host, 'Static pressure (' + spUnit + ')', spIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(spIn.value);
          if (isFinite(v)) {
            pushUndo();
            n.device.pressure = FD.units.toSIPressure(v, spUnit);
            changed();
          } else { spIn.value = readSp(); }
        });
    }

    var res = app.results;
    if (res && res.pressure[n.id] !== undefined) {
      var info = el('div', 'readout');
      var r1 = el('div', 'kv');
      r1.appendChild(el('span', 'k', 'Elevation'));
      r1.appendChild(el('span', 'v', FD.units.fmtLength(M.elevation(m, n), m.settings.display.length, true)));
      info.appendChild(r1);
      /* Not repeated when the Actual box above has already stated it — the same
       * number twice in one panel reads as two different numbers that happen to
       * agree. Elevation still belongs to every node. */
      if (!(dev && dev.kind === 'demand' && m.settings.calcMode === 'simulation')) {
        var r2 = el('div', 'kv');
        r2.appendChild(el('span', 'k', 'Pressure'));
        r2.appendChild(el('span', 'v', FD.units.fmtPressure(res.pressure[n.id], m.settings.display.pressure, true)));
        info.appendChild(r2);
      }
      host.appendChild(info);
    }

    if (dev && dev.kind === 'demand') {
      displayChecks(host, n, [
        { key: 'flow', label: 'Flow' },
        { key: 'required', label: 'Required pressure' },
        { key: 'available', label: 'Available pressure' }
      ]);
    } else if (dev && dev.kind === 'source') {
      displayChecks(host, n, [
        { key: 'elevation', label: 'Elevation' },
        { key: 'available', label: 'Pressure' }
      ]);
    }

    var del = el('button', 'btn danger', 'Delete node');
    del.addEventListener('click', function () {
      pushUndo(); M.removeNode(m, n.id);
      app.view.selection = []; changed(); renderProperties();
    });
    host.appendChild(del);
  }

  function changed() {
    scheduleSolve();
    scheduleSave();
    app.view.render();
  }

  // --------------------------------------------------------- renumbering
  /* Renumber nodes N1, N2, ... following the water: breadth-first from the
   * source(s) so numbers increase along the direction of flow and the
   * calculation sheet reads in a sensible order.
   *
   * Nodes unreachable from a source keep going at the end of the sequence
   * rather than being dropped — a half-drawn branch still needs an id. */
  function renumberNodes() {
    var m = app.model;
    var sources = m.nodes.filter(function (n) { return n.device && n.device.kind === 'source'; });

    /* A closed circuit legitimately has neither a source nor an outflow — the
     * data centre models are pump-and-equipment only — so requiring both made
     * renumbering impossible on exactly the systems that most need it.
     *
     * All that is actually needed is somewhere to start walking from. Prefer a
     * source; failing that a pump inlet, which is where an engineer reads a
     * closed circuit from anyway; failing that any node at all. */
    var roots = sources.map(function (n) { return n.id; });
    if (!roots.length) {
      var pumps = m.pipes.filter(function (p) { return p.kind === 'pump'; });
      roots = pumps.map(function (p) { return p.a; });
    }
    if (!roots.length && m.nodes.length) roots = [m.nodes[0].id];
    if (!roots.length) {
      FD.dialog.alert({
        title: 'Cannot renumber',
        message: 'There is nothing to renumber — the model has no nodes yet.'
      });
      return;
    }

    // Breadth-first from every root at once.
    var order = [], seen = {};
    var queue = roots.slice();
    queue.forEach(function (id) { seen[id] = true; });
    while (queue.length) {
      var cur = queue.shift();
      order.push(cur);
      M.pipesAt(m, cur).forEach(function (p) {
        var o = M.other(p, cur);
        if (!seen[o]) { seen[o] = true; queue.push(o); }
      });
    }
    m.nodes.forEach(function (n) { if (!seen[n.id]) order.push(n.id); });

    pushUndo();

    /* Two-phase rename: assign temporary ids first, so a new id that collides
     * with an as-yet-unrenamed node cannot clobber it. */
    var mapping = {};
    order.forEach(function (oldId, i) { mapping[oldId] = 'N' + (i + 1); });

    var tmp = {};
    m.nodes.forEach(function (n, i) { tmp[n.id] = '~tmp' + i; });
    applyNodeIdMap(m, tmp);
    var second = {};
    Object.keys(mapping).forEach(function (oldId) { second[tmp[oldId]] = mapping[oldId]; });
    applyNodeIdMap(m, second);

    // Store the nodes in their new numeric order too, so saved files and any
    // listing read N1, N2, N3… rather than in creation order.
    m.nodes.sort(function (a, b) {
      return (parseInt(a.id.slice(1), 10) || 0) - (parseInt(b.id.slice(1), 10) || 0);
    });

    // keep the id counter clear of the names now in use
    m._seq.node = Math.max(m._seq.node, m.nodes.length + 1);

    app.view.selection = [];
    renderProperties();
    changed();
    toast('Renumbered ' + order.length + ' nodes from the source.');
  }

  function applyNodeIdMap(m, map) {
    m.nodes.forEach(function (n) { if (map[n.id]) n.id = map[n.id]; });
    m.pipes.forEach(function (p) {
      if (map[p.a]) p.a = map[p.a];
      if (map[p.b]) p.b = map[p.b];
    });
    m.risers.forEach(function (r) {
      r.attachments.forEach(function (att) { if (map[att.node]) att.node = map[att.node]; });
    });
  }

  // ------------------------------------------------------------ settings
  function renderSettings() {
    var m = app.model, host = $('settings-body');
    host.innerHTML = '';

    function group(title) {
      host.appendChild(el('h2', '', title));
      return group2();
    }
    function group2() {
      var g = el('div', 'settings-grid');
      host.appendChild(g);
      return g;
    }
    function sel(g, label, options, current, onChange) {
      var s = el('select');
      options.forEach(function (o) {
        var opt = el('option', '', o[1]); opt.value = o[0];
        if (o[0] === current) opt.selected = true;
        if (o[2]) opt.disabled = true;
        s.appendChild(opt);
      });
      s.addEventListener('change', function () { onChange(s.value); });
      var f = el('div', 'field'); f.appendChild(el('label', '', label)); f.appendChild(s);
      g.appendChild(f);
      return s;
    }
    function num(g, label, value, onChange, step) {
      var i = el('input'); i.type = 'number'; i.value = value; i.step = step || 'any';
      i.addEventListener('change', function () {
        var v = FD.units.parse(i.value);
        if (isFinite(v)) onChange(v); else i.value = value;
      });
      var f = el('div', 'field'); f.appendChild(el('label', '', label)); f.appendChild(i);
      g.appendChild(f);
    }
    function text(g, label, value, onChange) {
      var i = el('input'); i.type = 'text'; i.value = value || '';
      i.addEventListener('input', function () { onChange(i.value); });
      var f = el('div', 'field'); f.appendChild(el('label', '', label)); f.appendChild(i);
      g.appendChild(f);
    }

    var g1 = group('Display units');
    sel(g1, 'Flow', FD.units.flowUnits.map(function (u) { return [u, u]; }),
        m.settings.display.flow, function (v) { m.settings.display.flow = v; redrawAll(); });
    sel(g1, 'Pressure', FD.units.pressureUnits.map(function (u) { return [u, u]; }),
        m.settings.display.pressure, function (v) { m.settings.display.pressure = v; redrawAll(); });
    sel(g1, 'PD/m', FD.units.pdmUnits.map(function (u) { return [u, u]; }),
        m.settings.display.pdm, function (v) { m.settings.display.pdm = v; redrawAll(); });
    sel(g1, 'Length', FD.units.lengthUnits.map(function (u) { return [u, u]; }),
        m.settings.display.length, function (v) { m.settings.display.length = v; redrawAll(); });
    sel(g1, 'Size', [['DN', 'DN mm'], ['NPS', 'NPS inch']],
        m.settings.display.size, function (v) { m.settings.display.size = v; redrawAll(); });
    /* Kv and Cv are the same quantity in different units, so only one is ever
     * shown — offering both invited entering a number into the one being
     * ignored. Stored Kv either way; Cv is a display conversion. */
    sel(g1, 'Valve coefficient', [['Kv', 'Kv (m³/h at 1 bar)'], ['Cv', 'Cv (US gpm at 1 psi)']],
        m.settings.display.valveCoef || 'Kv',
        function (v) { m.settings.display.valveCoef = v; redrawAll(); });

    /* Pump safety factor removed 2026-07-31 at Michael's request: the margin
     * is the engineer's judgement and belongs after the calculation, not as a
     * setting that quietly compounds with the margins already sitting in the C
     * factor, fitting allowances and equipment ratings. */

    // ---- presentation ----
    host.appendChild(el('h2', '', 'Display'));
    host.appendChild(el('p', 'hint',
      'Drawing sizes are separate from the interface font so a drawing can be tuned for ' +
      'print without changing the app chrome.'));
    var gp = group2();
    num(gp, 'UI font size (px)', m.settings.presentation.uiFontSize, function (v) {
      m.settings.presentation.uiFontSize = Math.max(10, Math.min(22, v));
      applyPresentation(); redrawAll();
    }, '1');
    num(gp, 'Drawing label size (px)', m.settings.presentation.labelSize, function (v) {
      m.settings.presentation.labelSize = Math.max(6, Math.min(24, v));
      redrawAll();
    }, '1');
    num(gp, 'Flow arrow size (×)', m.settings.presentation.arrowSize, function (v) {
      m.settings.presentation.arrowSize = Math.max(0.3, Math.min(4, v));
      redrawAll();
    }, '0.1');

    var clr = el('button', 'btn', 'Reset all label positions');
    clr.addEventListener('click', function () {
      pushUndo(); M.clearLabelOffsets(m); redrawAll();
      toast('Label positions reset.');
    });
    host.appendChild(clr);

    var g4 = group('Drawing');
    num(g4, 'Floor-to-floor default (m)', m.settings.floorToFloor,
        function (v) { m.settings.floorToFloor = v; redrawAll(); }, '0.1');
    num(g4, 'Grid minor (m)', m.settings.grid.minor,
        function (v) { m.settings.grid.minor = v; redrawAll(); }, '0.1');
    num(g4, 'Grid major (m)', m.settings.grid.major,
        function (v) { m.settings.grid.major = v; redrawAll(); }, '1');

    var g5 = group('Appearance');
    sel(g5, 'Theme', [['dark', 'Dark'], ['light', 'Light']], m.settings.theme,
        function (v) { m.settings.theme = v; applyTheme(); redrawAll(); });

    var g6 = group('CSV export');
    sel(g6, 'Delimiter / decimal',
        [[',', 'Comma  ·  1234.5'], [';', 'Semicolon  ·  1234,5']],
        m.settings.csv.delimiter, function (v) {
          m.settings.csv.delimiter = v;
          m.settings.csv.decimal = (v === ';') ? ',' : '.';
          scheduleSave();
        });

    /* Project metadata moved to the CALCULATION tab 2026-07-31: those fields
     * are the header of the deliverable, so they are edited on the deliverable
     * rather than on a different tab. */
  }

  // ----------------------------------------------------- HYDRAULIC tab
  /* Builds an editable coefficient input sized to its content, for dropping
   * directly into a rendered formula. */
  function coefInput(value, onChange, title) {
    var i = el('input', 'coef');
    i.type = 'text';
    i.value = value;
    if (title) i.title = title;
    i.size = Math.max(3, String(value).length);
    i.addEventListener('change', function () {
      var v = FD.units.parse(i.value);
      if (isFinite(v)) onChange(v); else i.value = value;
    });
    return i;
  }

  /* A fraction rendered as a real two-line stack: numerator, rule, denominator.
   * Plain text can only manage "a / (b · c)", which is exactly the form an
   * engineer has to decode rather than read. */
  function fraction(numParts, denParts) {
    var f = el('span', 'frac');
    var n = el('span', 'frac-n');
    numParts.forEach(function (x) { n.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    var d = el('span', 'frac-d');
    denParts.forEach(function (x) { d.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    f.appendChild(n);
    f.appendChild(d);
    return f;
  }

  function sup(x) {
    var e = el('sup');
    e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    return e;
  }

  function renderHydraulic() {
    var m = app.model, host = $('hydraulic-body');
    host.innerHTML = '';

    function h2(t) { host.appendChild(el('h2', '', t)); }
    function h3(t) { host.appendChild(el('h3', 'sub', t)); }
    function hint(t) { host.appendChild(el('p', 'hint', t)); }
    function grid() { var g = el('div', 'settings-grid'); host.appendChild(g); return g; }

    function numField(g, label, value, onChange, suffix) {
      var i = el('input'); i.type = 'text'; i.value = value;
      i.addEventListener('change', function () {
        var v = FD.units.parse(i.value);
        if (isFinite(v)) onChange(v); else i.value = value;
      });
      var f = el('div', 'field');
      f.appendChild(el('label', '', label + (suffix ? '  ' + suffix : '')));
      f.appendChild(i);
      g.appendChild(f);
      return i;
    }
    function textField(g, label, value, onChange) {
      var i = el('input'); i.type = 'text'; i.value = value || '';
      i.addEventListener('change', function () { onChange(i.value); });
      var f = el('div', 'field');
      f.appendChild(el('label', '', label));
      f.appendChild(i);
      g.appendChild(f);
      return i;
    }
    function selField(g, label, options, current, onChange) {
      var sel = el('select');
      options.forEach(function (o) {
        var opt = el('option', '', o[1]); opt.value = o[0];
        if (o[0] === current) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { onChange(sel.value); });
      var f = el('div', 'field');
      f.appendChild(el('label', '', label));
      f.appendChild(sel);
      g.appendChild(f);
      return sel;
    }

    // ============================================ 1. FLUID PROPERTIES (top)
    h2('Fluid Properties');
    hint('The fluid being calculated. Defaults are water at 20 °C.');
    var fg = grid();
    textField(fg, 'Fluid name', m.settings.fluid.name,
      function (v) { pushUndo(); m.settings.fluid.name = v; redrawAll(); });
    numField(fg, 'Density ρ', m.settings.fluid.density,
      function (v) { pushUndo(); m.settings.fluid.density = v; redrawAll(); }, '(kg/m³)');
    numField(fg, 'Kinematic viscosity ν', m.settings.fluid.kinematicViscosity,
      function (v) { pushUndo(); m.settings.fluid.kinematicViscosity = v; redrawAll(); }, '(m²/s)');
    numField(fg, 'Temperature', m.settings.fluid.temperature,
      function (v) { pushUndo(); m.settings.fluid.temperature = v; redrawAll(); }, '(°C)');
    numField(fg, 'Specific heat capacity Cp', m.settings.fluid.specificHeat,
      function (v) { pushUndo(); m.settings.fluid.specificHeat = v; redrawAll(); }, '(J/kg·K)');

    var isDW = m.settings.frictionMethod === 'DW';
    /* WHICH fitting table to show follows the method's BASIS, not whether it
     * happens to be Darcy. Gating on isDW meant that once ASHRAE became the
     * default the K table — and with it the threaded/flanged choice —
     * disappeared while the calculation was using K. That choice is worth 3.5x
     * on a DN25 elbow (threaded 1.5 against flanged 0.43). */
    var usesK = FD.hydraulics.method(m.settings.frictionMethod).fittingMode === 'K';
    var usage = el('ul', 'usage-list');
    usage.appendChild(el('li', '', 'Density — used: converts head to pressure everywhere.'));
    usage.appendChild(el('li', '', 'Kinematic viscosity — ' + (isDW
      ? 'used: sets Reynolds number and the friction factor.'
      : 'used for the laminar-flow check; fully live under Darcy-Weisbach.')));
    usage.appendChild(el('li', 'unused',
      'Temperature — not implemented in this version. It does not drive density ' +
      'or viscosity; those are entered independently.'));
    usage.appendChild(el('li', 'unused',
      'Specific heat capacity — not implemented in this version. Stored for the ' +
      'heating/cooling power calculations to come (Q = ṁ·Cp·ΔT).'));
    host.appendChild(usage);

    // =================================================== 2. SYSTEM (detected)
    h2('System');
    var det = FD.network.detectSystemType(m);
    var box = el('div', 'notice ' + (det.type === 'closed' ? 'info-notice' : ''));
    box.appendChild(el('p', 'notice-head', 'System type: ' +
      (det.type === 'open' ? 'Open loop'
       : det.type === 'closed' ? 'Closed loop' : 'No supply yet')));
    host.appendChild(box);

    // ======================================= 3. HYDRAULIC PARAMETERS
    h2('Hydraulic Parameters');
    var mg = grid();
    selField(mg, 'Calculation method',
      [['HW', 'Hazen-Williams'], ['DW', 'Darcy-Weisbach (Experimental)']],
      m.settings.frictionMethod, function (v) {
        pushUndo(); m.settings.frictionMethod = v; renderHydraulic(); redrawAll();
      });

    // ---- the formula, with the coefficients editable in place ----
    var fbox = el('div', 'formula-box');
    var eq = el('div', 'formula-eq');

    var isASHRAE = (m.settings.frictionMethod === 'ASHRAE');
    if (isASHRAE) {
      /* Shown in ASHRAE's own VELOCITY form, with the printed constants
       * editable, so an engineer spot-checking against Ch 22 Eq (6) sees the
       * numbers that are on the page rather than a flow-form rearrangement.
       * The solver derives its coefficients from these — see
       * hydraulics.methods.ASHRAE.derive — so editing them here really does
       * change the calculation. */
      var ka = m.settings.ashrae || FD.hydraulics.ASHRAE_DEFAULTS;
      function setA(field) {
        return function (v) {
          pushUndo();
          m.settings.ashrae = Object.assign({}, ka);
          m.settings.ashrae[field] = v;
          renderHydraulic(); redrawAll();
        };
      }
      eq.appendChild(el('span', 'fvar', 'Δh'));
      eq.appendChild(el('span', 'fop', '='));
      eq.appendChild(coefInput(ka.K, setA('K'), 'ASHRAE leading coefficient'));
      eq.appendChild(el('span', 'fop', '·'));
      eq.appendChild(el('span', 'fvar', 'L'));
      eq.appendChild(el('span', 'fop', '·'));
      eq.appendChild(document.createTextNode('('));
      eq.appendChild(el('span', 'fvar', 'V/C'));
      eq.appendChild(document.createTextNode(')'));
      eq.appendChild(sup(coefInput(ka.a, setA('a'), 'Velocity / C exponent')));
      eq.appendChild(el('span', 'fop', '·'));
      eq.appendChild(document.createTextNode('(1/'));
      eq.appendChild(el('span', 'fvar', 'D'));
      eq.appendChild(document.createTextNode(')'));
      eq.appendChild(sup(coefInput(ka.e, setA('e'), 'Diameter exponent')));
      fbox.appendChild(eq);

      var eq2 = el('div', 'formula-eq');
      eq2.appendChild(el('span', 'fop', '+'));
      eq2.appendChild(el('span', 'fop', ' Σ '));
      eq2.appendChild(el('span', 'fvar', 'K'));
      eq2.appendChild(el('span', 'fop', '·'));
      eq2.appendChild(fraction([el('span', 'fvar', 'V'), sup(document.createTextNode('2'))],
                               [document.createTextNode('2'), el('span', 'fvar', 'g')]));
      fbox.appendChild(eq2);

      var legA = el('div', 'formula-legend');
      var der = FD.hydraulics.methods.ASHRAE.derive({ ashrae: ka });
      legA.innerHTML =
        '<b>Δh</b> head loss (m) &nbsp;·&nbsp; <b>L</b> length (m) &nbsp;·&nbsp; ' +
        '<b>V</b> velocity (m/s) &nbsp;·&nbsp; <b>C</b> roughness coefficient &nbsp;·&nbsp; ' +
        '<b>D</b> inner diameter (m) &nbsp;·&nbsp; <b>K</b> fitting coefficient<br>' +
        'Solved as Δh = ' + der.A.toFixed(4) + ' · L · Q<sup>' + der.a +
        '</sup> / ( C<sup>' + der.b + '</sup> · d<sup>' + der.e.toFixed(4) +
        '</sup> ), derived from the above by V = 4Q/πD².';
      fbox.appendChild(legA);
      host.appendChild(fbox);

      var resetA = el('button', 'btn', 'Reset to ASHRAE (2021) constants');
      resetA.addEventListener('click', function () {
        pushUndo();
        m.settings.ashrae = Object.assign({}, FD.hydraulics.ASHRAE_DEFAULTS);
        renderHydraulic(); redrawAll();
        toast('Reset to the 2021 ASHRAE Ch 22 constants.');
      });
      host.appendChild(resetA);

    } else if (!isDW) {
      var k = m.settings.hw;
      eq.appendChild(el('span', 'fvar', 'h'));
      eq.appendChild(el('sub', '', 'f'));
      eq.appendChild(el('span', 'fop', '='));
      eq.appendChild(fraction(
        [coefInput(k.A, function (v) { pushUndo(); m.settings.hw.A = v; renderHydraulic(); redrawAll(); },
                   'Leading coefficient'),
         document.createTextNode(' · '), el('span', 'fvar', 'L'),
         document.createTextNode(' · '), el('span', 'fvar', 'Q'),
         sup(coefInput(k.a, function (v) { pushUndo(); m.settings.hw.a = v; renderHydraulic(); redrawAll(); },
                       'Flow exponent'))],
        [el('span', 'fvar', 'C'),
         sup(coefInput(k.b, function (v) { pushUndo(); m.settings.hw.b = v; renderHydraulic(); redrawAll(); },
                       'C-factor exponent')),
         document.createTextNode(' · '), el('span', 'fvar', 'd'),
         sup(coefInput(k.e, function (v) { pushUndo(); m.settings.hw.e = v; renderHydraulic(); redrawAll(); },
                       'Diameter exponent'))]
      ));
      fbox.appendChild(eq);
      var leg = el('div', 'formula-legend');
      leg.innerHTML = '<b>h<sub>f</sub></b> head loss (m) &nbsp;·&nbsp; ' +
        '<b>L</b> effective length (m) &nbsp;·&nbsp; <b>Q</b> flow (m³/s) &nbsp;·&nbsp; ' +
        '<b>C</b> roughness coefficient &nbsp;·&nbsp; <b>d</b> inner diameter (m)';
      fbox.appendChild(leg);
      host.appendChild(fbox);

      var reset = el('button', 'btn', 'Reset to ASHRAE SI defaults');
      reset.addEventListener('click', function () {
        pushUndo();
        m.settings.hw = Object.assign({}, FD.hydraulics.HW_DEFAULTS);
        renderHydraulic(); redrawAll();
        toast('Hazen-Williams coefficients reset to ASHRAE SI.');
      });
      host.appendChild(reset);

    } else {
      eq.appendChild(el('span', 'fvar', 'h'));
      eq.appendChild(el('sub', '', 'f'));
      eq.appendChild(el('span', 'fop', '='));
      eq.appendChild(el('span', 'fvar', 'f'));
      eq.appendChild(el('span', 'fop', '·'));
      eq.appendChild(fraction([el('span', 'fvar', 'L')], [el('span', 'fvar', 'd')]));
      eq.appendChild(el('span', 'fop', '·'));
      eq.appendChild(fraction(
        [el('span', 'fvar', 'V'), sup('2')],
        [document.createTextNode('2 '), el('span', 'fvar', 'g')]));
      fbox.appendChild(eq);
      var leg2 = el('div', 'formula-legend');
      leg2.innerHTML = '<b>f</b> friction factor &nbsp;·&nbsp; <b>L</b> effective length (m) ' +
        '&nbsp;·&nbsp; <b>d</b> inner diameter (m) &nbsp;·&nbsp; <b>V</b> velocity (m/s) ' +
        '&nbsp;·&nbsp; <b>g</b> 9.81 m/s²';
      fbox.appendChild(leg2);
      host.appendChild(fbox);

      /* Name the correlation ACTUALLY in use, not the one that is now the
       * default. A model saved before 2026-08-02 carries its own choice and
       * keeps it — a stored calculation is not re-specified behind the
       * engineer's back — so a notice hard-coded to Swamee-Jain would have been
       * describing a different calculation from the one on the screen. */
      var ffNow = (m.settings.dw && m.settings.dw.frictionFactor) || 'swameejain';
      var ffDef = FD.hydraulics.frictionFactors[ffNow];
      host.appendChild(el('div', 'notice warn-notice',
        'BETA. Friction factor: ' + (ffDef ? ffDef.name : ffNow) + '. ' +
        (ffNow === 'swameejain'
          ? 'Measured against an independent iteration of Colebrook-White in the test ' +
            'suite: within 0.9% over Re 1e4–1e7 with ε/d up to 1e-3, which is the ' +
            'envelope building-services pipework sits in, rising to 2.8% at Re 5000 ' +
            'with ε/d 1e-2. '
          : 'Swamee-Jain is the correlation this build selects for new models; this ' +
            'one keeps the choice it was saved with. ') +
        'Calculations issued from this method carry a BETA note on the sheet.'));

      var dg = grid();
      selField(dg, 'Friction factor correlation',
        Object.keys(FD.hydraulics.frictionFactors).map(function (kk) {
          return [kk, FD.hydraulics.frictionFactors[kk].name];
        }), m.settings.dw.frictionFactor, function (v) {
          pushUndo(); m.settings.dw.frictionFactor = v; renderHydraulic(); redrawAll();
        });
      numField(dg, 'Absolute roughness ε', m.settings.dw.roughness_mm,
        function (v) { pushUndo(); m.settings.dw.roughness_mm = v; redrawAll(); }, '(mm)');
      hint(FD.hydraulics.frictionFactors[m.settings.dw.frictionFactor].note +
           '  Laminar (Re < 2300) uses f = 64/Re; the transitional band is blended so the ' +
           'solver sees a continuous curve.');
    }

    // -------------------------------------------------- pipe schedules
    h2('Pipe schedules');
    var schGrid = grid();
    var all = FD.schedules.all(m.customSchedules);
    selField(schGrid, 'Default schedule for new pipes',
      Object.keys(all).map(function (kk) { return [kk, all[kk].name]; }),
      m.settings.schedule, function (v) {
        pushUndo(); m.settings.schedule = v; renderHydraulic(); redrawAll();
      });
    numField(schGrid, 'Default C factor', m.settings.C,
      function (v) { pushUndo(); m.settings.C = v; redrawAll(); });

    var schTable = el('table', 'sheet');
    schTable.innerHTML = '<thead><tr><th class="txt">Schedule</th><th>Sizes</th>' +
                         '<th class="txt">Bore range (mm)</th><th>Default C</th>' +
                         '<th class="txt">Source</th><th></th></tr></thead>';
    var schBody = el('tbody');
    Object.keys(all).forEach(function (kk) {
      var sc = all[kk], first = sc.sizes[0], last = sc.sizes[sc.sizes.length - 1];
      var custom = !!(m.customSchedules && m.customSchedules[kk]);
      var tr = el('tr');
      if (kk === m.settings.schedule) tr.className = 'active-row';
      tr.innerHTML = '<td class="txt">' + sc.name + '</td><td>' + sc.sizes.length + '</td>' +
        '<td class="txt dim">' + first.label + ' (' + first.id_mm.toFixed(1) + ') … ' +
        last.label + ' (' + last.id_mm.toFixed(1) + ')</td><td>' + sc.defaultC + '</td>' +
        '<td class="txt dim">' + (custom ? 'custom' : 'built-in') + '</td>';
      var act = el('td', 'txt');
      if (custom) {
        var ed = el('button', 'btn tiny', 'Edit');
        ed.addEventListener('click', function () { editSchedule(kk); });
        act.appendChild(ed);
        var rm = el('button', 'btn tiny', '✕');
        rm.title = 'Delete this schedule';
        rm.addEventListener('click', function () { deleteSchedule(kk); });
        act.appendChild(rm);
      }
      tr.appendChild(act);
      schBody.appendChild(tr);
    });
    schTable.appendChild(schBody);
    host.appendChild(schTable);

    var addSch = el('button', 'btn', 'New custom schedule');
    addSch.addEventListener('click', function () { editSchedule(null); });
    host.appendChild(addSch);
    host.appendChild(el('p', 'legend',
      'Note: Custom schedules are stored in model & browser storage. ' +
      'Recommend to keep an offline copy.'));

    // ------------------------------------------------ fitting data
    /* Only the table the active method actually uses is shown. Displaying both
     * invites entering numbers into the one that is being ignored. */
    if (!usesK) {
      h2('Fitting equivalent lengths');
      hint('Used by Hazen-Williams. Charged to the downstream pipe as ' +
           'EL = (L/D) × inner diameter. A dividing tee is charged to its ' +
           'outlets; a combining tee is charged to its inlets.');

      /* The unsourced coefficients, named out loud. These are placeholders and
       * the engineer has to know which ones before issuing anything. */
      var unsrc = FD.fittings.unsourced ? FD.fittings.unsourced() : [];
      if (unsrc.length) {
        var note = el('div', 'notice warn-notice');
        note.appendChild(el('p', '',
          unsrc.length + ' of these coefficients are PLACEHOLDERS, not sourced data:'));
        var ul = el('ul');
        unsrc.forEach(function (u) {
          var li = el('li');
          li.innerHTML = '<strong>' + u.label + '</strong> (L/D ' + u.ld + ') — ' + u.note;
          ul.appendChild(li);
        });
        note.appendChild(ul);
        note.appendChild(el('p', '',
          'Real tee losses depend on the flow ratio Qb/Qc and vary by more than ' +
          'an order of magnitude across it, so no flat number is right everywhere. ' +
          'Enter values from ASHRAE Fundamentals for your case before issuing ' +
          'calculations through heavily-branched pipework.'));
        host.appendChild(note);
      }
      var elTable = el('table', 'sheet editable');
      elTable.innerHTML = '<thead><tr><th class="txt">Fitting</th><th>Code</th>' +
                          '<th>L/D</th><th>EL at DN50 (m)</th></tr></thead>';
      var elBody = el('tbody');
      Object.keys(FD.fittings.types).forEach(function (t) {
        var tr = el('tr');
        var nm = el('td', 'txt', FD.fittings.label(t));
        /* Flag the placeholders in the table itself. A number the user can see
         * and edit but cannot tell is a guess is worse than no number. */
        if (FD.fittings.types[t].sourced === false) {
          nm.appendChild(el('span', 'flag', ' placeholder'));
          nm.title = FD.fittings.types[t].note || 'Not sourced data.';
          tr.className = 'warn-row';
        }
        tr.appendChild(nm);
        tr.appendChild(el('td', '', FD.fittings.code(t)));
        var tdIn = el('td');
        var inp = el('input', 'cell-input'); inp.type = 'text';
        inp.value = (m.settings.fittingLD[t] !== undefined)
          ? m.settings.fittingLD[t] : FD.fittings.types[t].ld;
        inp.addEventListener('change', function () {
          var v = FD.units.parse(inp.value);
          if (isFinite(v) && v >= 0) {
            pushUndo(); m.settings.fittingLD[t] = v; renderHydraulic(); redrawAll();
          } else { inp.value = m.settings.fittingLD[t]; }
        });
        tdIn.appendChild(inp);
        tr.appendChild(tdIn);
        tr.appendChild(el('td', 'dim', FD.fittings.el(t, 52.48, m.settings.fittingLD).toFixed(3)));
        elBody.appendChild(tr);
      });
      elTable.appendChild(elBody);
      host.appendChild(elTable);
      var resetLD = el('button', 'btn', 'Reset equivalent lengths');
      resetLD.addEventListener('click', function () {
        pushUndo(); m.settings.fittingLD = FD.fittings.defaultLD();
        renderHydraulic(); redrawAll();
      });
      host.appendChild(resetLD);

    } else {
      h2('Fitting Coefficients K');
      hint('Based on ASHRAE (2021) method: h = K · V²/2g (Ch 22 Eq 7).');
      hint('Connection type: a DN25 threaded elbow is K = 1.5 where the flanged ' +
           'equivalent is 0.43.');
      var kg = grid();
      selField(kg, 'Connection type',
        Object.keys(FD.ktable.sets).map(function (kk) { return [kk, FD.ktable.sets[kk].name]; }),
        m.settings.dw.kSet, function (v) {
          pushUndo(); m.settings.dw.kSet = v; renderHydraulic(); redrawAll();
        });

      var kTable = el('table', 'sheet editable');
      kTable.innerHTML = '<thead><tr><th class="txt">Fitting</th><th>K at DN25</th>' +
                         '<th>K at DN50</th><th>K at DN100</th><th>Override K</th></tr></thead>';
      var kBody = el('tbody');
      ['E90', 'E45', 'TRUN', 'TBRANCH', 'GATE', 'GLOBE', 'CHECK'].forEach(function (t) {
        var tr = el('tr');
        var nameCell = el('td', 'txt', FD.fittings.label(t));
        if (FD.ktable.isDerived(t, m.settings.dw.kSet)) {
          nameCell.appendChild(el('span', 'flag', ' derived'));
          nameCell.title = 'Not transcribed from the table — derived from the 90° elbow. ' +
                           'See the provenance note in data/ktable.js.';
        }
        tr.appendChild(nameCell);
        [25, 50, 100].forEach(function (dn) {
          tr.appendChild(el('td', 'dim', FD.ktable.k(t, dn, m.settings.dw.kSet, null).toFixed(3)));
        });
        var tdIn = el('td');
        var inp = el('input', 'cell-input'); inp.type = 'text'; inp.placeholder = 'curve';
        inp.value = (m.settings.fittingK[t] !== undefined) ? m.settings.fittingK[t] : '';
        inp.addEventListener('change', function () {
          pushUndo();
          if (inp.value.trim() === '') delete m.settings.fittingK[t];
          else {
            var v = FD.units.parse(inp.value);
            if (isFinite(v) && v >= 0) m.settings.fittingK[t] = v;
          }
          renderHydraulic(); redrawAll();
        });
        tdIn.appendChild(inp);
        tr.appendChild(tdIn);
        kBody.appendChild(tr);
      });
      kTable.appendChild(kBody);
      host.appendChild(kTable);
      host.appendChild(el('p', 'legend',
        'K source: ASHRAE Handbook — Fundamentals, Pipe Sizing, Table 1 (threaded) and ' +
        'Table 2 (flanged/welded), transcribed from two independent copies. The threaded ' +
        '45° elbow row is DERIVED from the 90° value — both copies returned a column ' +
        'identical to the 90° elbow, which is physically wrong. ASHRAE notes threaded 90° ' +
        'elbows vary ±20% above 2 in and ±40% below, so treat all of this as indicative.'));
    }

    // ------------------------------------------------------- warnings
    h2('Warning thresholds');
    var wg = grid();
    numField(wg, 'Max velocity', m.settings.warn.velocity,
      function (v) { pushUndo(); m.settings.warn.velocity = v; redrawAll(); }, '(m/s)');
    numField(wg, 'Max friction rate', m.settings.warn.pdm,
      function (v) { pushUndo(); m.settings.warn.pdm = v; redrawAll(); }, '(Pa/m)');

    switchRow(host, 'Warn on laminar / transitional flow',
              m.settings.warn.laminar !== false, function (on) {
      pushUndo(); m.settings.warn.laminar = on; redrawAll(); renderHydraulic();
    });
  }

  /* Create or edit a custom schedule. The editable content is a plain
   * "label, inner diameter" list — spec §9 calls those the two governing
   * fields, and everything hydraulic derives from the bore. */
  function editSchedule(key) {
    var m = app.model;
    var existing = key ? m.customSchedules[key] : null;
    var seedRows = existing
      ? existing.sizes.map(function (z) {
          return z.label + '\t' + z.id_mm +
                 (z.insulation_mm !== undefined ? '\t' + z.insulation_mm : '');
        }).join('\n')
      : '';

    FD.dialog.form({
      title: existing ? 'Edit schedule' : 'New custom schedule',
      ok: existing ? 'Save' : 'Create',
      message: 'Paste three columns straight from a spreadsheet:\n' +
               '    nominal label   ·   inner diameter (mm)   ·   insulation thickness (mm)\n\n' +
               'ALL DIAMETERS AND THICKNESSES ARE IN MILLIMETRES. Insulation may be left ' +
               'blank — it is stored for the thermal module and is not used by the ' +
               'hydraulics. Tabs, commas or spaced columns all work, and a header row is ' +
               'skipped automatically.',
      fields: [
        { key: 'name', label: 'Schedule name', type: 'text',
          value: existing ? existing.name : 'My schedule' },
        { key: 'C', label: 'Default C factor', type: 'text',
          value: existing ? existing.defaultC : 120 },
        { key: 'sizes', label: 'Sizes  —  label / bore mm / insulation mm',
          type: 'textarea', rows: 10, value: seedRows,
          placeholder: 'DN15\t16.0\t25' }
      ]
    }).then(function (v) {
      if (!v) return;
      var name = (v.name || '').trim();
      if (!name) {
        FD.dialog.alert({ title: 'Name required',
                          message: 'Give the schedule a name so it can be told apart.' });
        return;
      }
      var C = FD.units.parse(v.C);
      if (!isFinite(C) || C <= 0) C = 120;

      var parsed = FD.schedules.parseSizeTable(v.sizes);
      if (!parsed.sizes.length) {
        FD.dialog.alert({
          title: 'No usable sizes',
          message: 'Every line needs a label and a positive inner diameter in mm, ' +
                   'for example:\n\n    DN50    53.0    40'
        });
        return;
      }

      pushUndo();
      var id = key || ('custom_' + Date.now().toString(36));
      m.customSchedules[id] = { name: name, defaultC: C, sizes: parsed.sizes };
      saveCustomSchedules();
      renderHydraulic();
      redrawAll();

      var insCount = parsed.sizes.filter(function (z) {
        return z.insulation_mm !== undefined;
      }).length;
      toast('Schedule "' + name + '" saved — ' + parsed.sizes.length + ' sizes' +
            (insCount ? ', ' + insCount + ' with insulation' : '') + '.');

      if (parsed.skipped.length) {
        FD.dialog.report({
          title: parsed.skipped.length + ' line(s) could not be read',
          message: 'These were left out. Everything else was saved.',
          rows: parsed.skipped.map(function (k) {
            return 'line ' + k.line + ':  ' + k.text + '   — ' + k.why;
          })
        });
      }
    });
  }

  function deleteSchedule(key) {
    var m = app.model;
    var sc = m.customSchedules[key];
    if (!sc) return;
    var inUse = m.pipes.filter(function (p) { return p.schedule === key; }).length;
    FD.dialog.confirm({
      title: 'Delete "' + sc.name + '"?',
      message: inUse
        ? inUse + ' pipe' + (inUse > 1 ? 's' : '') + ' currently use this schedule. They ' +
          'will fall back to the default schedule, which will change their bore and ' +
          'therefore the calculation.'
        : 'This schedule is not used by any pipe in this model.',
      ok: 'Delete', danger: true
    }).then(function (yes) {
      if (!yes) return;
      pushUndo();
      delete m.customSchedules[key];
      if (m.settings.schedule === key) m.settings.schedule = 'sch40';
      m.pipes.forEach(function (p) {
        if (p.schedule === key) {
          p.schedule = m.settings.schedule;
          p.size = FD.schedules.defaultSize(p.schedule, m.customSchedules);
        }
      });
      saveCustomSchedules();
      renderHydraulic();
      redrawAll();
      toast('Schedule deleted.');
    });
  }

  function saveCustomSchedules() {
    try {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(app.model.customSchedules || {}));
    } catch (e) { console.warn('Could not persist custom schedules:', e.message); }
  }

  function redrawAll() {
    scheduleSave();
    solveNow();
    renderProperties();
    if ($('pane-calculation').dataset.active === 'true') renderCalculation();
    /* Deliberately does NOT rebuild the HYDRAULIC tab. Its controls call
     * renderHydraulic() themselves where a refresh is actually needed;
     * rebuilding it here as well would double-render and yank focus out of
     * the field being edited. */
    app.view.render();
  }

  /* Detected system type, cached off the last solve. Written back onto
   * settings.systemType so the saved model and the CSV agree with what is on
   * screen — the field is now a record of what was detected, not a question
   * the user has to answer. */
  function systemTypeLabel() {
    var d = FD.network.detectSystemType(app.model);
    app.model.settings.systemType = (d.type === 'none') ? 'open' : d.type;
    return d.type === 'open' ? 'Open loop'
         : d.type === 'closed' ? 'Closed loop'
         : 'Not yet determined';
  }

  /* DESIGN and SIMULATE are ribbon MODES now, not a chip toggle: the same
   * drawing answers two different questions and a terminal is a different
   * object in each, which is a mode-sized distinction rather than a status
   * indicator. This keeps the buttons in step with settings.calcMode. */
  function updateModeChip() {
    /* Only ONE of DESIGN / SIMULATE / VIEW reads as active at a time. The
     * calcMode is still whatever it was while you are in VIEW — it has to be,
     * the sheet keeps rendering — but lighting the button up made it look as
     * though clicking VIEW had not taken effect. */
    var inView = (app.view && (app.view.tool === 'view' || app.view.tool === 'trace' ||
                               app.view.tool === 'align' || app.view.tool === 'probe'));
    [].slice.call(document.querySelectorAll('[data-mode]')).forEach(function (b) {
      b.classList.toggle('active',
        !inView && b.dataset.mode === app.model.settings.calcMode);
    });
  }

  /* Outflows without a required pressure have no characteristic K = Q/sqrt(dP),
   * so SIMULATION cannot work out what flow they would take. Refuse to guess. */
  function outflowsWithoutCharacteristic(m) {
    return m.nodes.filter(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false &&
             !(n.device.reqPressure >= M.MIN_OUTFLOW_PRESSURE);
    });
  }

  function setCalcMode(mode) {
    var m = app.model;
    if (m.settings.calcMode === mode) return;
    if (mode === 'simulation') {
      var bad = outflowsWithoutCharacteristic(m);
      if (bad.length) {
        var minTxt = FD.units.fmtPressure(M.MIN_OUTFLOW_PRESSURE,
                                          m.settings.display.pressure, true);
        FD.dialog.alert({
          title: 'Outflow pressure cannot be zero',
          message: bad.map(function (n) {
            return 'Outflow ' + (n.tag || n.id) + ' is set to ' +
                   FD.units.fmtPressure(n.device.reqPressure || 0,
                                        m.settings.display.pressure, true) + '.';
          }).join('\n') +
          '\n\nIf no pressure is required, set a minimum of ' + minTxt + '.' +
          '\n\nSIMULATION works out flow from each outflow\u2019s resistance, and that ' +
          'resistance comes from the design point: K = Q / \u221A\u0394P. With \u0394P = 0 ' +
          'there is no resistance to derive.'
        });
        return;
      }

      /* Same reasoning as the engine check in network.js: without a curve the
       * pump is a constant head and flow stops responding to the system, which
       * is the entire point of the mode. Caught here too so the user is told
       * before they see a screen of numbers rather than after. */
      var noCurve = m.pipes.filter(function (p) {
        return p.kind === 'pump' && p.pump && p.pump.mode !== 'off' && !p.pump.curve;
      });
      if (noCurve.length) {
        FD.dialog.alert({
          title: 'Pump curve required',
          message: 'Pump curve is required to simulate. If no manufacturer data is ' +
                   'available, please see the TOOLS tab.\n\n' +
                   'Without a curve: ' +
                   noCurve.map(function (p) { return p.tag || p.id; }).join(', ') + '.'
        });
        return;
      }
    }
    pushUndo();
    m.settings.calcMode = mode;
    updateModeChip();
    renderProperties();
    changed();
  }

  function updateSystemChip() {
    var chip = $('system-chip');
    if (!chip) return;
    var d = FD.network.detectSystemType(app.model);
    app.model.settings.systemType = (d.type === 'none') ? 'open' : d.type;
    chip.textContent = d.type === 'open' ? 'OPEN LOOP'
                     : d.type === 'closed' ? 'CLOSED LOOP'
                     : 'NO SUPPLY';
    chip.className = 'chip system-chip ' +
      (d.type === 'open' ? 'ok' : d.type === 'closed' ? 'info' : 'warn');
    chip.title = d.reason;
  }

  function initModeChip() {
    [].slice.call(document.querySelectorAll('[data-mode]')).forEach(function (b) {
      b.addEventListener('click', function () {
        /* Selecting a mode also returns to the drawing tool: SIMULATE offers
         * exactly the same drawing tools as DESIGN, so it must not leave you
         * in VIEW. setCalcMode carries the guards (a running pump needs a
         * curve; an outflow needs a required pressure). */
        if (app.view.tool === 'view' || app.view.tool === 'trace' ||
            app.view.tool === 'align' || app.view.tool === 'probe') {
          app.view.setTool('edit');
        }
        setCalcMode(b.dataset.mode);
        updateModeChip();
      });
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = app.model.settings.theme;
  }

  /* UI font size drives a CSS custom property rather than a stylesheet rewrite,
   * so every rule that uses it scales together. */
  function applyPresentation() {
    var p = (app.model.settings && app.model.settings.presentation) || {};
    document.documentElement.style.setProperty('--ui-font', (p.uiFontSize || 14) + 'px');
  }

  // ---------------------------------------------------------------- init
  var docsReady = false;

  function init() {
    FD.VERSION = FD.VERSION || '0.1.0-dev';
    $('app-version').textContent = 'v' + FD.VERSION;

    var restored = loadAutosave();
    app.model = restored || M.create();
    try {
      var cs = localStorage.getItem(SCHEDULE_KEY) || localStorage.getItem(LEGACY_KEYS.schedules);
      if (cs) app.model.customSchedules = Object.assign(JSON.parse(cs), app.model.customSchedules || {});
    } catch (e) { /* ignore */ }

    applyTheme();
    applyPresentation();
    initModeChip();
    initStatusChip();

    app.view = new FD.View($('canvas'), function () { return app.model; }, function () {
      renderProperties();
      renderLevels();
      scheduleSolve();
      scheduleSave();
    });
    // Canvas tools report back through the app's toast system rather than
    // reaching into the DOM themselves.
    app.view.onMessage = function (msg, kind) { toast(msg, kind); };
    /* Lets a canvas gesture snapshot the model for undo without the canvas
     * knowing the undo stack exists. */
    app.view.onBeforeEdit = function () { pushUndo(); };

    // ---- tabs ----
    var tabs = [].slice.call(document.querySelectorAll('.tab[data-pane]'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (o) {
          var on = (o === t);
          o.setAttribute('aria-selected', on ? 'true' : 'false');
          $(o.dataset.pane).dataset.active = on ? 'true' : 'false';
        });
        if (t.dataset.pane === 'pane-calculation') renderCalculation();
        if (t.dataset.pane === 'pane-settings') renderSettings();
        if (t.dataset.pane === 'pane-hydraulic') renderHydraulic();
        if (t.dataset.pane === 'pane-tools' && FD.tools) FD.tools.render(app);
        if (t.dataset.pane === 'pane-docs' && FD.docs && !docsReady) {
          FD.docs.init(); docsReady = true;
        }
        if (t.dataset.pane === 'pane-network') { app.view.resize(); }
      });
    });

    function showTab(paneId) {
      tabs.forEach(function (o) {
        var on = o.dataset.pane === paneId;
        o.setAttribute('aria-selected', on ? 'true' : 'false');
        $(o.dataset.pane).dataset.active = on ? 'true' : 'false';
      });
    }
    /* Published so a panel can send the user somewhere — the pump's "New
     * curve…" button opens TOOLS. It only switches panes; the caller renders
     * the destination, because the tab click handler above does the same. */
    app.showTab = showTab;

    // ---- tools ----
    var toolButtons = [].slice.call(document.querySelectorAll('[data-tool]'));
    function syncToolButtons() {
      toolButtons.forEach(function (o) {
        if (o.dataset.tool === 'disconnect') {
          o.classList.toggle('active', !!app.view.showDisconnects);
        } else {
          if (o.dataset.tool !== 'disconnect') {
          o.classList.toggle('active', o.dataset.tool === app.view.tool);
        }
        }
      });
    }
    toolButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        /* SHOW DISCONNECT is a view overlay, not a drawing tool: it toggles and
         * stays on while you switch to EDIT and actually join the pipe. Making
         * it a tool meant the markers vanished the moment you went to fix
         * anything, which is precisely when they are needed. */
        if (b.dataset.tool === 'disconnect') {
          app.view.showDisconnects = !app.view.showDisconnects;
          syncToolButtons();
          app.view.render();
          return;
        }
        app.view.setTool(b.dataset.tool);
        syncToolButtons();
      });
    });
    var MODE_HINTS = {
      edit:   'Click to select · drag a node to move it · Delete removes the selection',
      /* 'edit' is the internal tool id for both DESIGN and SIMULATE. */
      pipe:   'Click to place vertices · type a length + Enter · scroll = pipe size · Shift = free angle · Esc = finish',
      view:   'Drag any label to reposition it for printing · tick properties in the panel to show them on the drawing · TRACE adds a background drawing',
      align:  'Drag any node to move the WHOLE model · grid-snaps · Shift for free placement',
      trace:  'Ctrl+V a screen snip, or drag an image in · drag to move, corners to scale · set the scale, then lock it',
      probe:  'Move along any pipe to read pressure, flow and velocity at that point · click to pin the reading · Esc clears it',
      riser:  'Click this floor\u2019s pipework to place or join a riser column',
      source: 'Click to place a source (tank, mains, or expansion vessel)',
      demand: 'Click to place a demand',
      pump:   'Click a pipe to insert a pump into it',
      equip:  'Click a pipe to insert equipment into it',
      valve:  'Click a pipe to insert a valve into it'
    };
    /* VIEW and DRAW are alternatives, not companions: VIEW is for arranging a
     * finished drawing, and the placement tools do not apply there. Showing
     * both meant the ribbon offered PIPE and RISER while in a mode where a
     * click drags a label instead. TRACE lives in VIEW because tracing IS
     * arranging the background you then draw over. */
    function syncToolGroups() {
      var inView = (app.view.tool === 'view' || app.view.tool === 'trace' ||
                    app.view.tool === 'align' || app.view.tool === 'probe');
      var setDraw = $('set-draw'), setView = $('set-view'), group = $('group-tools');
      if (setDraw) setDraw.hidden = inView;
      if (setView) setView.hidden = !inView;
      /* The label stays COMMAND either way: the section is "what you can do
       * right now", and renaming it as well as swapping its contents made the
       * ribbon feel like it was rearranging itself. */
      if (group) group.dataset.group = 'COMMAND';
    }

    function refreshToolButtons() {
      toolButtons.forEach(function (o) {
        if (o.dataset.tool !== 'disconnect') {
          o.classList.toggle('active', o.dataset.tool === app.view.tool);
        }
      });
      /* ANNOTATIONS is a panel belonging to VIEW, not a sticky mode. Leaving it
       * up after switching to EDIT meant the properties panel showed annotation
       * checkboxes while you were selecting pipework — the panel has to follow
       * the mode you are actually in. */
      app.showAnnotations = false;
      updateModeChip();
      syncToolGroups();
      var hint = MODE_HINTS[app.view.tool] || '';
      $('mode-hint').textContent = hint +
        '  \u00b7  scroll = zoom, middle-drag = pan';
    }
    app.view.onToolChange = refreshToolButtons;
    toolButtons.forEach(function (b) {
      b.addEventListener('click', refreshToolButtons);
    });
    refreshToolButtons();

    // ---- toolbar actions ----
    /* There is no CALCULATE button. Every edit already triggers a debounced
     * solve, so the button only forced something that was going to happen
     * 250 ms later anyway — and switching tabs on top of that took the user
     * away from the drawing they were working on. The CALCULATION tab renders
     * from the latest solve whenever it is opened. */

    $('btn-new').addEventListener('click', function () {
      if (!app.model.pipes.length) { doNew(); return; }
      FD.dialog.confirm({
        title: 'Discard current model?',
        message: 'Unsaved changes will be lost.',
        ok: 'Discard', cancel: 'Cancel', danger: true
      }).then(function (yes) { if (yes) doNew(); });
    });

    function doNew() {
      pushUndo();
      app.model = M.create();
      afterModelSwap();
      app.view.zoomToFit();
    }

    $('btn-annotations').addEventListener('click', function () {
      app.showAnnotations = !app.showAnnotations;
      renderProperties();
    });

    /* Visualisers colour the drawing by a solved quantity. They are overlays,
     * not modes: clicking the active one switches it off, and only one can be
     * on at a time because they compete for the same colour. */
    var vizButtons = [].slice.call(document.querySelectorAll('[data-viz]'));
    function syncVizButtons() {
      vizButtons.forEach(function (b) {
        b.classList.toggle('active', app.view.viz === b.dataset.viz);
      });
    }
    vizButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        app.view.viz = (app.view.viz === b.dataset.viz) ? null : b.dataset.viz;
        syncVizButtons();
        if (app.view.viz && !app.results) {
          toast('Nothing solved yet — draw a network first.');
        }
        app.view.render();
      });
    });
    syncVizButtons();

    /* Resizable side panel. The width is a UI preference, not model data, so it
     * lives in localStorage rather than in the .pnet.json — a model file should
     * not carry someone else's panel width. The canvas must be told to resize
     * afterwards or it keeps its old backing-store size and the drawing
     * stretches. */
    (function () {
      var panel = document.querySelector('.panel-left');
      var split = $('panel-splitter');
      if (!panel || !split) return;
      var MIN = 170, MAX = 640, DEFAULT = 210;

      function setWidth(px, remember) {
        var w = Math.max(MIN, Math.min(MAX, px));
        panel.style.width = w + 'px';
        if (remember) {
          try { localStorage.setItem('fpc.panelWidth', String(w)); } catch (e) {}
        }
        app.view.resize();
      }

      try {
        var saved = parseFloat(localStorage.getItem('fpc.panelWidth'));
        if (isFinite(saved)) setWidth(saved, false);
      } catch (e) {}

      var drag = null;
      split.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, w: panel.getBoundingClientRect().width };
        split.setPointerCapture(e.pointerId);
        split.classList.add('dragging');
        document.body.classList.add('resizing-panel');
        e.preventDefault();
      });
      split.addEventListener('pointermove', function (e) {
        if (!drag) return;
        setWidth(drag.w + (e.clientX - drag.x), false);
      });
      function end() {
        if (!drag) return;
        drag = null;
        split.classList.remove('dragging');
        document.body.classList.remove('resizing-panel');
        setWidth(panel.getBoundingClientRect().width, true);
      }
      split.addEventListener('pointerup', end);
      split.addEventListener('pointercancel', end);
      split.addEventListener('dblclick', function () { setWidth(DEFAULT, true); });
      // Keyboard, so the divider is not mouse-only.
      split.addEventListener('keydown', function (e) {
        var w = panel.getBoundingClientRect().width;
        if (e.key === 'ArrowLeft') { setWidth(w - 16, true); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { setWidth(w + 16, true); e.preventDefault(); }
      });
    })();

    $('btn-renumber').addEventListener('click', renumberNodes);

    // Which valve the VALVE tool places; also switches the tool on.
    $('valve-type').addEventListener('change', function () {
      app.view.valveType = $('valve-type').value;
      app.view.setTool('valve');
      toolButtons.forEach(function (o) {
        if (o.dataset.tool !== 'disconnect') {
          o.classList.toggle('active', o.dataset.tool === app.view.tool);
        }
      });
    });
    app.view.valveType = $('valve-type').value;

    $('btn-save').addEventListener('click', saveModelFile);
    $('btn-save-2').addEventListener('click', saveModelFile);
    $('btn-csv').addEventListener('click', exportCSV);
    /* PRINT means different things on the two tabs: the network tab prints the
     * drawing (one page per level), the calculation tab prints the sheet. A
     * body class picks which, and is cleared afterwards so the next print is
     * not poisoned by the last one. */
    function printAs(mode) {
      if (mode === 'plans') {
        if (!app.model.pipes.length) { toast('Nothing to print — the model is empty.', 'error'); return; }
        FD.printer.renderPlans(app.model, app.results || solveNow());
      } else {
        renderCalculation();
      }
      document.body.classList.add('printing-' + mode);
      var cleanup = function () {
        document.body.classList.remove('printing-plans', 'printing-sheet');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      // Safety net for browsers that fire afterprint unreliably.
      setTimeout(cleanup, 60000);
      window.print();
    }

    $('btn-print').addEventListener('click', function () { printAs('plans'); });
    $('btn-print-2').addEventListener('click', function () { printAs('sheet'); });

    $('btn-load').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadModelFile(e.target.files[0]);
      e.target.value = '';
    });

    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);
    $('btn-fit').addEventListener('click', function () { app.view.zoomToFit(); });

    $('btn-add-level').addEventListener('click', function () {
      pushUndo();
      var m = app.model;
      var top = m.levels[0];
      M.addLevel(m, { name: 'Level ' + m.levels.length, altitude: top.altitude + m.settings.floorToFloor });
      renderLevels(); scheduleSave();
    });
    $('btn-del-level').addEventListener('click', function () {
      var m = app.model;
      if (m.levels.length <= 1) { toast('The last level cannot be removed.', 'error'); return; }
      var lv = M.level(m, m.activeLevel);
      var count = m.nodes.filter(function (n) { return n.level === m.activeLevel; }).length;
      FD.dialog.confirm({
        title: 'Remove ' + lv.name + '?',
        message: count
          ? count + ' node' + (count > 1 ? 's' : '') + ' and their pipes will be deleted.'
          : 'This level is empty.',
        ok: 'Remove', danger: true
      }).then(function (yes) {
        if (!yes) return;
        pushUndo();
        M.removeLevel(m, m.activeLevel);
        renderLevels(); changed();
      });
    });

    /* Paste and drop capture.
     *
     * The paste EVENT is used rather than navigator.clipboard.read(), which
     * needs a secure context — a file:// origin is not one, and that is the
     * deployment this app exists for. */
    function acceptImage(file, how) {
      if (!file) return;
      FD.trace.fromBlob(file).then(function (img) {
        pushUndo();
        var lv = M.level(app.model, app.model.activeLevel);
        var c = app.view.toWorld(app.view.cssW / 2, app.view.cssH / 2);
        // default width: about two thirds of the visible canvas
        var defW = (app.view.cssW * 0.66) / app.view.scale;
        M.setTrace(app.model, lv.id, img, c.x, c.y, defW);
        FD.trace.forget(lv.id);
        app.view.setTool('trace');
        renderProperties();
        renderLevels();
        changed();
        toast('Drawing ' + how + ' onto ' + lv.name + ' (' +
              img.width + '×' + img.height + ', ' +
              FD.trace.sizeKB(lv.trace) + ' KB)' +
              (img.scaled ? ', downscaled' : '') +
              '. Set the scale next.');
      }).catch(function (err) {
        toast(err.message || 'That image could not be read.', 'error');
      });
    }

    window.addEventListener('paste', function (e) {
      // never hijack a paste aimed at a text field
      var t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (FD.dialog.isOpen()) return;
      if ($('pane-network').dataset.active !== 'true') return;
      var file = FD.trace.imageFromEvent(e);
      if (!file) return;
      e.preventDefault();
      acceptImage(file, 'pasted');
    });

    var canvasEl = $('canvas');
    ['dragenter', 'dragover'].forEach(function (n) {
      canvasEl.addEventListener(n, function (e) { e.preventDefault(); });
    });
    canvasEl.addEventListener('drop', function (e) {
      var file = FD.trace.imageFromEvent(e);
      if (!file) return;
      e.preventDefault();
      acceptImage(file, 'dropped');
    });

    // two-point scale calibration
    app.view.onCalibrate = function (a, b) {
      var m = app.model;
      var measured = Math.hypot(b.x - a.x, b.y - a.y);
      FD.dialog.prompt({
        title: 'Set the drawing scale',
        message: 'Those two points are currently ' + measured.toFixed(2) + ' m apart in ' +
                 'the model. What is the real distance between them?',
        label: 'Real distance (' + m.settings.display.length + ')',
        value: ''
      }).then(function (v) {
        if (v === null) return;
        var real = FD.units.parse(v);
        if (!isFinite(real) || real <= 0) {
          toast('That is not a distance.', 'error');
          return;
        }
        pushUndo();
        var r = M.calibrateTrace(m, m.activeLevel, a.x, a.y, b.x, b.y,
          FD.units.toSILength(real, m.settings.display.length));
        if (!r) { toast('Could not set the scale.', 'error'); return; }
        renderProperties();
        changed();
        toast('Scale set — drawing resized ×' + r.factor.toFixed(3) + '.');
      });
    };

    window.addEventListener('resize', function () { app.view.resize(); });
    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveModelFile();
      }
    });

    /* Canvas gestures mutate the model and then report through changed(), so
     * the snapshot pushed here is the PRE-edit one held in lastSnap — see the
     * note on pushUndo. */
    var origChanged = app.view.changed.bind(app.view);
    app.view.changed = function () {
      if (!snapshotTaken) pushUndo();
      origChanged();
      scheduleMarkClean();
    };

    renderLevels();
    renderProperties();
    updateSystemChip();
    app.view.resize();
    app.view.zoomToFit();
    solveNow();
    updateHistoryButtons();

    if (restored && restored.pipes.length) {
      toast('Restored your last model from this browser.');
    }
  }

  FD.app = app;
  FD.initApp = init;
})(window.FD = window.FD || {});
