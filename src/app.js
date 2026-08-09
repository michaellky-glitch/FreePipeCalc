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

  /* DXF EXPORT — experimental, and the toast says so.
   *
   * Geometry and text only, at Michael's scope: no properties, no results, no
   * calculation sheet. Model space in metres at true size, with real Z, so a
   * riser opens as a vertical line rather than a marker to be interpreted.
   *
   * FLAGGED EXPERIMENTAL because the structure is verified but the file has
   * never been opened in a real CAD package from this environment — the same
   * "no pixels" limit that governs every visual item, one step further out.
   * Until someone opens it in AutoCAD or BricsCAD, "it should work" is the
   * strongest claim available. */
  function exportDxf() {
    if (!FD.dxf) { toast('DXF export is not loaded.', 'error'); return; }
    var m = app.model;
    if (!m.pipes.length) { toast('Nothing to export.', 'error'); return; }
    var name = (m.settings.meta.project || 'network')
      .replace(/[^\w\-]+/g, '_').toLowerCase() || 'network';
    try {
      download(name + '.dxf', FD.dxf.build(m), 'application/dxf');
      toast('DXF exported (experimental) — geometry and text only. ' +
            'Please check it opens correctly in your CAD.');
    } catch (e) {
      toast('DXF export failed: ' + e.message, 'error');
    }
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
    /* ANY NEW REQUEST INVALIDATES A SOLVE ALREADY IN FLIGHT.
     *
     * New in v0.16.8 and it is the hazard that comes WITH the fix: while the
     * solve blocked the page, nothing could be edited underneath it. Now that
     * it yields, it can be — and the generator holds a live reference to the
     * model and writes actuator positions into it as it searches. A solve that
     * started before an edit is answering a question about a model that no
     * longer exists, so it must be abandoned rather than allowed to finish and
     * overwrite the answer with a stale one.
     *
     * A counter rather than a flag: two edits in quick succession must not
     * leave the second one thinking it owns the run. */
    app.solveEpoch = (app.solveEpoch || 0) + 1;
    app.solveTimer = setTimeout(solveSliced, 250);
  }

  /* The progress bar. Kept immediately beside the only thing that uses it, so
   * a future edit that moves `solveSliced` cannot leave these behind — which is
   * exactly what happened on 2026-08-09 and is why the simulation stopped
   * running at all. */
  function showSolveProgress(frac, label) {
    var bar = $('solve-progress');
    if (!bar) return;
    bar.hidden = false;
    var fill = bar.querySelector('.solve-bar-fill');
    var text = bar.querySelector('.solve-bar-text');
    if (fill) fill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    if (text) text.textContent = label || 'Simulating\u2026';
  }
  function hideSolveProgress() {
    var bar = $('solve-progress');
    if (bar) bar.hidden = true;
  }

  /* THE SOLVE NO LONGER BLOCKS THE PAGE  (S3, v0.16.8)
   *
   * `FD.network.solveModelGen` yields once per network solve — about 100 ms on
   * Michael's data centre, 455 of them over a 40-second simulation. This steps
   * it, handing the browser back between steps, so the bar paints, the tab
   * answers, and a 40-second answer feels like a 40-second answer rather than a
   * hung window.
   *
   * WHAT WAS TRIED AND BACKED OUT, so it is not tried again: slicing at the
   * DEVICE boundary. One device is a probe, a scan, a descent and a bisection —
   * fifteen or so solves, seconds at a time — so it still froze, and each
   * resumed slice re-ran the non-control work on top. And a Web Worker, which
   * is the obvious answer and is refused twice over from `file://`: the null
   * origin blocks `new Worker`, and even past that a worker cannot
   * `importScripts` the engine, so the source would have to be inlined as a
   * string — a build step.
   *
   * THE BUDGET IS DELIBERATELY SMALLER THAN ONE SOLVE. `do/while` runs at least
   * one `next()` and then checks the clock, so a 24 ms budget means exactly one
   * network solve per turn: the finest granularity available. Raising it would
   * only batch solves back together and give the page less air.
   *
   * `requestAnimationFrame` is NOT used to resume: it does not fire in a hidden
   * or backgrounded tab, and a solve that only runs while you are looking at it
   * is a solve that silently never finishes.
   */
  var STEP_BUDGET_MS = 24;

  function solveSliced() {
    if (app.solving) { app.solveAgain = true; return; }
    var heavy = app.model.settings.calcMode === 'simulation' &&
                app.model.pipes.length > 60;
    if (!heavy) { solveNow(); return; }

    /* THE LATCH IS RELEASED WHATEVER HAPPENS.
     *
     * `app.solving` guards against two solves at once, and it used to be set
     * before a call that could throw — so when `showSolveProgress` went missing
     * in an edit, the throw left the latch ON and every later solve returned
     * immediately at the line above. The model simply stopped simulating, with
     * no error on screen, for the rest of the session. Michael, 2026-08-09.
     *
     * A latch that only clears on the happy path is a bug waiting for its
     * first exception. This one now clears on every path, including the
     * abandoned one. */
    var epoch = app.solveEpoch || 0;
    var gen;
    app.solving = true;
    try {
      showSolveProgress(0.02, 'Simulating\u2026');
      gen = FD.network.solveModelGen(app.model);
    } catch (e) {
      app.solving = false;
      if (window.console) window.console.error('starting the solve', e);
      solveNow();
      return;
    }

    var t0 = Date.now();

    function release() {
      app.solving = false;
      try { hideSolveProgress(); } catch (e2) { /* never strand the latch */ }
    }

    function step() {
      /* SUPERSEDED. An edit landed while this was running — which is now
       * possible, because the page is alive — so this answer is about a model
       * that has moved. Drop it; `scheduleSolve` has already queued the next
       * one. */
      if ((app.solveEpoch || 0) !== epoch) { release(); return; }

      var r, started = Date.now();
      try {
        do { r = gen.next(); } while (!r.done && Date.now() - started < STEP_BUDGET_MS);
      } catch (e) {
        release();
        console.error(e);
        updateStatusChip(null, e.message);
        if (app.solveAgain) { app.solveAgain = false; scheduleSolve(); }
        return;
      }

      if (!r.done) {
        var p = r.value || {};
        try {
          /* "sweep 2 of 6" beside the device, because the bar can only show
           * the WORST case and will therefore finish early on a model that
           * settles quickly. The sentence explains the bar; without it a run
           * that stops at a third looks like something went wrong. */
          showSolveProgress(p.fraction || 0,
            'Simulating\u2026 sweep ' + (p.sweep || 1) + ' of ' + (p.sweeps || 6) +
            (p.device ? ' \u00b7 ' + p.device : ''));
        } catch (e3) { /* the bar is not worth failing the solve for */ }
        setTimeout(step, 0);
        return;
      }

      release();
      applyResult(r.value);
      if (Date.now() - t0 > 1500) {
        toast('Simulated in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.');
      }
      if (app.solveAgain) { app.solveAgain = false; scheduleSolve(); }
    }

    setTimeout(step, 0);
  }

  /* Everything that happens to a finished result, wherever it came from — the
   * stepped path above and the synchronous `solveNow` must not drift apart. */
  function applyResult(res) {
    app.results = res;
    app.view.results = res;
    app.view.render();
    updateStatusChip(res);
    updateSystemChip();
    updateModeChip();
    refreshPropertyReadouts();
    return res;
  }

  function solveNow() {
    try {
      return applyResult(FD.network.solveModel(app.model));
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
    /* DEFECTS OUTRANK WARNINGS on the chip (Michael, 2026-08-05). "Your drawing
     * does not mean what it looks like" and "this pipe is a bit fast" were
     * counted together, and only one of them means the answer is about a
     * different system than the one you drew. */
    var defects = list.filter(function (w) { return w.level === 'defect'; });
    var warn = list.length;
    if (defects.length) {
      chip.textContent = defects.length + ' model defect' +
                         (defects.length > 1 ? 's' : '') +
                         (warn > defects.length
                           ? ', ' + (warn - defects.length) + ' warning' +
                             (warn - defects.length > 1 ? 's' : '') : '');
      chip.className = 'chip defect';
      chip.title = defects.map(function (w) { return w.message; }).join('\n\n') +
                   '\n\nClick to highlight the affected pipes on the drawing.';
      chip.style.cursor = 'pointer';
      /* NO TAB JUMP. This used to set `chip.onclick` to open CALCULATION — and
       * never cleared it, so once a model had raised a defect ONCE the chip
       * jumped to the sheet for the rest of the session instead of highlighting
       * anything. Michael, 2026-08-07: "Clicking warnings sends you to
       * CALCULATION tab instead of highlighting problems."
       *
       * Highlighting is the right answer from the drawing anyway: you are
       * looking at the model, and the useful thing is WHERE. The listener in
       * `initStatusChip` does it for every severity. */
      return;
    }
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
      where.level = w.level || 'warning';
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
      /* No "what would actually be delivered" figure any more — DESIGN answers
       * DESIGN's question (2026-08-06). What the negative pressures MEAN still
       * needs saying, because a negative gauge pressure reads as an error
       * rather than as a measurement. */
      if (m.settings.calcMode !== 'simulation') {
        hbox.appendChild(el('p', '',
          'Tabulated pressures are the demand-driven result — every demand drawing ' +
          'its full flow — so a negative value is how much head is MISSING at that ' +
          'point, which is what to size against. Switch to SIMULATE to see what the ' +
          'system would actually deliver.'));
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
          /* The head the SOLVE used — M.pumpHead has the one definition, and
           * the sheet must not disagree with the panel or the drawing. */
          var pc = M.pumpCurve(m, p);
          var hd = off ? 0 : M.pumpHead(m, p, q || 0);
          var design = pc ? pc.Qd : null;
          var sp = M.pumpSpeed(m, p);
          var r2 = row((p.tag || p.id) + (off ? ' (off)' : '') +
                       (!off && sp < 0.999 ? ' (' + Math.round(sp * 100) + '% speed)' : ''),
                       off ? 0 : q, design, headToPa(hd), null);
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
        /* In SIMULATION the terminal's own report says what it delivered; in
         * DESIGN the demand IS the flow, by definition of the mode. The third
         * case — `res.actual` — is gone with the pressure-driven pass. */
        var aF = simRow ? simRow.actualFlow : dev.flow;
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
    /* ONE CHART PER PUMP (Michael, 2026-08-04). It used to draw the first pump
     * with a curve and apologise for the rest, which is no use on a job with a
     * duty and a standby, let alone a pump hall.
     *
     * Each chart carries four things:
     *   - the RATED curve, solid;
     *   - the 90 / 80 / 70 / 60 / 50% speed family, dotted (affinity-scaled,
     *     §17C — always true for the pump, whatever the system is doing);
     *   - the SYSTEM curve in red, SOLVED rather than assumed (FD.network
     *     .systemCurve). The parabola through the origin that gets drawn as a
     *     system curve is only right with no static lift, no second pump and a
     *     square law everywhere;
     *   - the operating point, where the two meet.
     *
     * The family and the system curve intersect at each dotted curve, which is
     * the picture that makes a VSD legible: run down the red line, not along
     * the black one. */
    (function () {
      var pumps = m.pipes.filter(function (p) {
        return p.kind === 'pump' && p.pump && p.pump.curve;
      });
      if (!pumps.length) {
        if (m.pipes.some(function (p) { return p.kind === 'pump'; })) {
          calcSection('Pump Curve').appendChild(
            el('p', 'hint', 'No pump has a curve set.'));
        }
        return;
      }
      var secCurve = calcSection('Pump Curve');
      pumps.forEach(function (p) {
        var built = pumpCurveSvg(m, res, p, { family: true, system: true });
        if (!built) return;
        secCurve.appendChild(built.caption);
        secCurve.appendChild(built.svg);
      });

      var key = el('p', 'hint',
        'Solid: rated curve. Dotted: 90–50% speed. Red: system curve. ' +
        'Plotted to 200% of duty flow. ');
      infoMark(key, 'The system curve is SOLVED, not assumed — each point is a ' +
                    'real solve of the network. The parabola through the origin ' +
                    'that usually gets drawn is only right with no static lift, ' +
                    'no second pump and a square law everywhere.');
      secCurve.appendChild(key);
    })();

    // =============================================================== WARNINGS
    /* Threshold exceedances are highlighted red in the tables AND listed here,
     * because a red cell says WHERE but not WHAT. computeWarnings is the single
     * source shared with the status chip, so the two cannot disagree. */
    var warnings = computeWarnings(res);
    if (warnings.length) {
      /* SPLIT BY LEVEL. The two questions an engineer asks — "is my drawing
       * right?" and "is my design right?" — stopped sharing one list on
       * 2026-08-05. Notices are things that need no action at all and go last. */
      var secWarn = calcSection('Warnings', { note: String(warnings.length) });
      [['defect', 'Model defects', 'What was drawn is not what was meant. ' +
                                   'The arithmetic is sound; the model is not.'],
       ['warning', 'Warnings', 'The answer stands — worth an engineer’s eye.'],
       ['notice', 'Notices', 'Nothing to do. Stated so a number is not a puzzle.']
      ].forEach(function (grp) {
        var rows = warnings.filter(function (w) {
          return (w.level || 'warning') === grp[0];
        });
        if (!rows.length) return;
        secWarn.appendChild(el('h4', 'warn-group ' + grp[0],
                               grp[1] + ' (' + rows.length + ')'));
        secWarn.appendChild(el('p', 'hint', grp[2]));
        var ul = el('ul');
        rows.forEach(function (w) { ul.appendChild(el('li', '', w.message)); });
        secWarn.appendChild(ul);
      });
    }

    // =============================================================== 5. APPENDIX
    /* The hydraulic parameters the numbers above were produced with. A sheet
     * that does not state its own assumptions cannot be checked, and this is
     * the one place they travel with the result — including any edit made to
     * the Hazen-Williams constants. */
    /* ------------------------------------------------------------ THERMAL
     * Its own section, collapsible like the rest — and a collapsed section
     * does not print, which is how the engineer chooses what to issue. Absent
     * entirely when nothing is flowing, rather than printing a table of
     * dashes. */
    (function () {
      var th = res && res.thermal;
      if (!th) return;
      var fluid = th.fluid;
      var secT = calcSection('Thermal', {
        open: false,
        note: (th.totals.equipDuty / 1000).toFixed(1) + ' kW equipment · ' +
              (th.totals.pipeLoss / 1000).toFixed(2) + ' kW pipes'
      });

      secT.appendChild(el('p', 'legend',
        'Q = ṁ·Cp·ΔT. Sign is about the FLUID: negative removes heat from it, ' +
        'positive adds it — so a chilled-water coil reads positive. Ambient ' +
        (m.settings.thermal.ambient).toFixed(1) + ' °C, ' + fluid.name +
        ' at Cp = ' + fluid.specificHeat.toFixed(0) + ' J/(kg·K).'));

      if (!fluid.verified) {
        secT.appendChild(el('div', 'notice warn-notice')).appendChild(el('p', '',
          fluid.name + ': the fluid properties used here are NOT verified ' +
          'against a printed table. Specific heat scales every duty below ' +
          'linearly. Check before issue.'));
      }
      /* Insulation thickness is now the engineer's own — set on the schedule,
       * or per pipe — so it is no longer flagged. The surface coefficient
       * still is: it is a default, and on a BARE pipe it is the entire
       * resistance. */
      secT.appendChild(el('p', 'legend',
        'Pipe gains and losses use the insulation on each pipe’s schedule ' +
        '(overridden per pipe where set) and an outside surface coefficient of ' +
        (m.settings.thermal.surfaceCoeff).toFixed(1) + ' W/(m²·K), which is a ' +
        'DEFAULT rather than sourced data — on a bare pipe it is the whole of ' +
        'the resistance.'));
      if (th.pinned) {
        secT.appendChild(el('p', 'legend',
          'No source, so ' + m.settings.thermal.supplyTemp.toFixed(1) + ' °C was ' +
          'pinned at ' + th.pinned.node + '. Every temperature is relative to that.'));
      }

      /* ---------------------------------------------------- HEAT BALANCE
       *
       * At steady state everything put into the water has to come out of it.
       * That is not a check on the arithmetic, it is the DEFINITION of steady
       * state — and it needs no reference temperature and no hand calculation
       * to read, which is what makes it the one figure worth putting first.
       *
       * A residual that is not near zero means the answer has not settled,
       * whatever the temperatures say. Michael asked for this section,
       * 2026-08-05. */
      var heatIn = 0, heatOut = 0;
      Object.keys(th.links).forEach(function (id) {
        var q = th.links[id].qW;
        if (!isFinite(q)) return;
        if (q > 0) heatIn += q; else heatOut += q;
      });

      secT.appendChild(el('h4', 'sheet-sub', 'Heat balance'));
      var bt = el('table', 'sheet');
      bt.innerHTML = '<thead><tr><th class="txt">Into the water</th><th>kW</th>' +
                     '<th class="txt">Out of the water</th><th>kW</th></tr></thead>';
      var btb = el('tbody');
      function bRow(a, av, b, bv, cls) {
        var tr = el('tr');
        if (cls) tr.className = cls;
        tr.appendChild(el('td', 'txt', a));
        tr.appendChild(el('td', '', av));
        tr.appendChild(el('td', 'txt', b));
        tr.appendChild(el('td', '', bv));
        btb.appendChild(tr);
      }
      bRow('Gained (loads, warm ambient)', '+' + (heatIn / 1000).toFixed(2),
           'Removed (plant, cold ambient)', (heatOut / 1000).toFixed(2));
      bRow('Equipment', (th.totals.equipDuty >= 0 ? '+' : '') +
                        (th.totals.equipDuty / 1000).toFixed(2),
           'Pipework', (th.totals.pipeLoss >= 0 ? '+' : '') +
                       (th.totals.pipeLoss / 1000).toFixed(3));
      /* THE TWO TERMS THAT ARE NOT LINK DUTIES, and without which an open or
       * fill-connected system never appears to balance.
       *
       * A SOURCE holds its stated temperature whatever arrives, so it is a heat
       * source in its own right — an infinite reservoir does not warm up. On a
       * closed circuit with a fill connection this is where a plant shortfall
       * shows up: the fill quietly absorbs it.
       *
       * BOUNDARY is the energy water carries out of an open system when it
       * leaves at a different temperature from the one it entered at. */
      if (Math.abs(th.sourceDuty || 0) > 1) {
        bRow('At the source / fill', (th.sourceDuty >= 0 ? '+' : '') +
             (th.sourceDuty / 1000).toFixed(3), '', '', 'index-row');
      }
      if (Math.abs(th.boundary || 0) > 1) {
        bRow('', '', 'Carried out by the water',
             (th.boundary / 1000).toFixed(3), 'index-row');
      }
      bt.appendChild(btb);
      secT.appendChild(bt);

      var g0 = el('div', 'index-grid');
      function kv0(k, v, cls) {
        var r = el('div', 'kv' + (cls ? ' ' + cls : ''));
        r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v));
        g0.appendChild(r);
        return r;
      }
      /* The residual, and whether it is small enough to mean anything. A
       * watt on a 100 kW system is noise; a kilowatt is not. */
      /* `residual`, not `imbalance`: the latter is link duties only, which never
       * balances once a source is holding a temperature or water is leaving the
       * system carrying heat with it. */
      var resid = (th.residual !== undefined) ? th.residual : th.imbalance;
      var scale = Math.max(Math.abs(heatIn), Math.abs(heatOut), 1);
      var tight = Math.abs(resid) < Math.max(1, scale * 1e-4);
      kv0('Residual', (resid >= 0 ? '+' : '') +
          (resid / 1000).toFixed(3) + ' kW' +
          (tight ? '  — balanced' : '  — NOT balanced'),
          tight ? '' : 'deficit');
      if (Math.abs(th.sourceDuty || 0) > 1) {
        kv0('Absorbed at the source', (th.sourceDuty / 1000).toFixed(2) + ' kW' +
            (th.sourceDuty < 0 ? '  — the plant is short by this much'
                               : '  — the fill is making this up'), 'deficit');
      }
      kv0('Temperature range', th.totals.min === null ? '—'
        : th.totals.min.toFixed(2) + ' … ' + th.totals.max.toFixed(2) + ' °C');
      secT.appendChild(g0);
      secT.appendChild(el('p', 'legend',
        'At steady state everything put into the water comes out of it, so the ' +
        'residual is zero by definition — it needs no reference temperature and ' +
        'no hand calculation to read. A source holds its stated temperature ' +
        'whatever arrives, so it counts as a duty of its own: on a sealed ' +
        'circuit with a fill connection, a plant that cannot keep up shows as ' +
        'heat absorbed there.'));

      /* ------------------------------------------------------- EQUIPMENT */
      var eqRowsT = m.pipes.filter(function (p) {
        return p.kind === 'equip' && th.links[p.id];
      });
      if (eqRowsT.length) {
        secT.appendChild(el('h4', 'sheet-sub', 'Equipment duty'));
        var t = el('table', 'sheet');
        t.innerHTML = '<thead><tr><th class="txt">Tag</th><th class="txt">Type</th>' +
                      '<th>Flow (' + d.flow + ')</th>' +
                      '<th>In (°C)</th><th>Out (°C)</th><th>ΔT (K)</th>' +
                      '<th>Q (kW)</th><th class="txt">Limited by</th></tr></thead>';
        var tb = el('tbody');
        eqRowsT.forEach(function (p) {
          var l = th.links[p.id];
          var tr = el('tr');
          tr.className = 'index-row';
          tr.appendChild(el('td', 'txt', p.tag || p.id));
          tr.appendChild(el('td', 'txt',
            p.equip.equipType === 'source' ? 'Source / sink'
            : p.equip.equipType === 'adiabatic' ? 'Adiabatic' : 'Heat exchanger'));
          tr.appendChild(el('td', '', FD.units.fmtFlow(l.mdot / (th.fluid.density || 998),
                                                       d.flow)));
          tr.appendChild(el('td', '', l.tIn.toFixed(2)));
          tr.appendChild(el('td', '', l.tOut.toFixed(2)));
          tr.appendChild(el('td', '', (l.dT >= 0 ? '+' : '') + l.dT.toFixed(2)));
          tr.appendChild(el('td', '', (l.qW >= 0 ? '+' : '') + (l.qW / 1000).toFixed(2)));
          tr.appendChild(el('td', 'txt', l.limit || ''));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        secT.appendChild(t);
      }

      /* -------------------------------------------------- PLANT SCHEDULE
       *
       * Michael, 2026-08-09. Not a duplicate of Equipment duty above: that one
       * reports what every device DID, and this one answers the question asked
       * at the front end of a job — what do I have to buy?
       *
       * SOURCES AND SINKS ONLY, because they are the only machines the question
       * arises for. An exchanger STATES its load; the load is the answer and
       * there is nothing to size. Absent entirely when there is no plant in the
       * model, rather than printing an empty table.
       *
       * `Required` is the engine's own `qNeed` — the duty needed to sit on
       * setpoint at the flow the machine actually has. `Selected` is the
       * nameplate, blank on Auto. The margin is quoted against the requirement,
       * which is how a selection is quoted. */
      var plantRows = m.pipes.filter(function (p) {
        return p.kind === 'equip' && p.equip &&
               p.equip.equipType === 'source' && !p.equip.off &&
               th.links[p.id] && th.links[p.id].qNeed !== null &&
               th.links[p.id].qNeed !== undefined && isFinite(th.links[p.id].qNeed);
      });
      if (plantRows.length) {
        secT.appendChild(el('h4', 'sheet-sub', 'Plant schedule'));
        secT.appendChild(el('p', 'legend',
          'What each machine has to do, against what is selected for it. ' +
          'REQUIRED is the duty needed to hold its setpoint at the flow it is ' +
          'actually getting — Q = ṁ·Cp·(setpoint − entering) — so it moves with ' +
          'the system, not with the schedule. A blank capacity is sized here ' +
          'rather than limited: the machine holds its setpoint and the duty it ' +
          'lands on IS the selection. Design ΔT is a design-point figure and ' +
          'does not limit anything.'));
        var pt = el('table', 'sheet');
        pt.innerHTML = '<thead><tr><th class="txt">Tag</th>' +
                       '<th>Design flow (' + d.flow + ')</th>' +
                       '<th>Actual flow (' + d.flow + ')</th>' +
                       '<th>Design ΔT (K)</th><th>Actual ΔT (K)</th>' +
                       '<th>Required (kW)</th><th>Selected (kW)</th>' +
                       '<th>Margin</th></tr></thead>';
        var ptb = el('tbody');
        plantRows.forEach(function (p) {
          var l = th.links[p.id], eq = p.equip;
          var selW = Number(eq.qMax);
          var hasSel = isFinite(selW) && selW !== 0;
          var tr = el('tr');
          tr.className = 'index-row';
          tr.appendChild(el('td', 'txt', p.tag || p.id));
          tr.appendChild(el('td', '', isFinite(Number(eq.qRated))
            ? FD.units.fmtFlow(Number(eq.qRated), d.flow) : '—'));
          tr.appendChild(el('td', '',
            FD.units.fmtFlow(l.mdot / (th.fluid.density || 998), d.flow)));
          tr.appendChild(el('td', '', isFinite(Number(eq.dTMax))
            ? Math.abs(Number(eq.dTMax)).toFixed(2) : '—'));
          tr.appendChild(el('td', '', Math.abs(l.dT).toFixed(2)));
          tr.appendChild(el('td', '', (Math.abs(l.qNeed) / 1000).toFixed(2)));
          tr.appendChild(el('td', hasSel ? '' : 'txt',
            hasSel ? (Math.abs(selW) / 1000).toFixed(2) : 'Auto'));
          var mtd = el('td', '');
          if (hasSel && Math.abs(l.qNeed) > 1) {
            var mg = (Math.abs(selW) / Math.abs(l.qNeed) - 1) * 100;
            mtd.textContent = (mg >= 0 ? '+' : '') + mg.toFixed(1) + '%';
            if (mg < 0) mtd.className = 'bad';
          } else {
            mtd.textContent = '—';
          }
          tr.appendChild(mtd);
          ptb.appendChild(tr);
        });
        pt.appendChild(ptb);
        secT.appendChild(pt);
      }

      /* ------------------------------- PIPEWORK HEAT GAIN / LOSS
       *
       * The one Michael named. On a chilled system this is the gain that has to
       * be added to the coil load; on LTHW it is the loss that has to be made
       * up. EVERY pipe is listed, including the ones that move nothing —
       * a zero row on a well-insulated main is a result, not clutter, and
       * leaving it out makes the total impossible to check by adding up. */
      var pipeRows = m.pipes.filter(function (p) {
        return (p.kind === 'pipe' || p.kind === 'riser') && th.links[p.id];
      });
      if (pipeRows.length) {
        secT.appendChild(el('h4', 'sheet-sub', 'Pipework heat gain / loss'));
        var pt = el('table', 'sheet');
        pt.innerHTML = '<thead><tr><th class="txt">Section</th><th class="txt">Size</th>' +
                       '<th>L (m)</th><th>Ins (mm)</th><th>U′ (W/m·K)</th>' +
                       '<th>In (°C)</th><th>Out (°C)</th><th>Q (W)</th></tr></thead>';
        var ptb = el('tbody');
        var gain = 0, loss = 0;
        pipeRows.forEach(function (p) {
          var l = th.links[p.id];
          var ins = FD.thermal.thicknessOf(m, p) * 1000;
          var tr = el('tr');
          tr.appendChild(el('td', 'txt', (p.tag ? p.tag + ' · ' : '') + p.a + ' → ' + p.b));
          tr.appendChild(el('td', 'txt', FD.units.fmtSize(p.size, d.size)));
          tr.appendChild(el('td', '', (l.length || 0).toFixed(2)));
          tr.appendChild(el('td', '', ins.toFixed(0)));
          tr.appendChild(el('td', '', (l.UperM || 0).toFixed(3)));
          tr.appendChild(el('td', '', l.tIn.toFixed(2)));
          tr.appendChild(el('td', '', l.tOut.toFixed(2)));
          tr.appendChild(el('td', '', (l.qW >= 0 ? '+' : '') + l.qW.toFixed(1)));
          ptb.appendChild(tr);
          if (l.qW > 0) gain += l.qW; else loss += l.qW;
        });
        pt.appendChild(ptb);
        secT.appendChild(pt);

        var g2 = el('div', 'index-grid');
        function kv2T(k, v) {
          var r = el('div', 'kv');
          r.appendChild(el('span', 'k', k));
          r.appendChild(el('span', 'v', v));
          g2.appendChild(r);
        }
        kv2T('Pipework gain', '+' + (gain / 1000).toFixed(3) + ' kW');
        kv2T('Pipework loss', (loss / 1000).toFixed(3) + ' kW');
        kv2T('Net', (th.totals.pipeLoss >= 0 ? '+' : '') +
             (th.totals.pipeLoss / 1000).toFixed(3) + ' kW');
        /* As a fraction of the load it has to be added to or made up from —
         * the number an engineer actually uses it for. */
        var loadMag = Math.abs(th.totals.equipDuty);
        if (loadMag > 1) {
          kv2T('As % of equipment duty',
               (Math.abs(th.totals.pipeLoss) / loadMag * 100).toFixed(1) + '%');
        }
        secT.appendChild(g2);
      }
    })();

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
      if (m.settings.frictionMethod !== 'DW') {
        var ka = m.settings.ashrae || FD.hydraulics.ASHRAE_DEFAULTS;
        var der = meth.derive({ ashrae: ka });
        kv2('Formula (as printed)',
            'Δh = ' + ka.K + ' · L · (V/C)^' + ka.a + ' · (1/D)^' + ka.e);
        kv2('Solved as', 'Δh = ' + der.A.toFixed(4) + ' · L · Q^' + der.a +
                         ' / ( C^' + der.b + ' · d^' + der.e.toFixed(4) + ' )');
        var eset = FD.fittings.elSet(m.settings);
        kv2('Fittings', 'Equivalent length — ' + eset.source);
        /* Where one row of a table is not from that table, the sheet has to say
         * so too. A sheet naming a single source for a mixed one is misleading,
         * and the sheet is what gets issued. */
        if (eset.note) kv2('NOTE', eset.note);
        if (eset.key === 'custom') {
          kv2('NOTE', 'Equivalent lengths are USER-DEFINED and are not a ' +
                      'published table. Check them before issue.');
        }
        var defA = FD.hydraulics.ASHRAE_DEFAULTS;
        if (ka.K !== defA.K || ka.a !== defA.a || ka.e !== defA.e) {
          kv2('NOTE', 'Constants have been EDITED from the ASHRAE defaults.');
        }
      } else {
        var ffKey = (m.settings.dw && m.settings.dw.frictionFactor) || 'swameejain';
        var ff = FD.hydraulics.frictionFactors[ffKey];
        kv2('Formula', 'hf = f · (L/d) · V²/2g   +   Σ K · V²/2g');
        kv2('Friction factor', ff ? ff.name : ffKey);
        kv2('Roughness', ((m.settings.dw && m.settings.dw.roughness_mm) || 0.045) + ' mm');
        /* K velocity heads, not equivalent length — Darcy is itself a
         * velocity-head equation, so the two match (Ch 22 Eq 7). */
        kv2('Fittings', 'K velocity heads (Ch 22 Eq 7), ' +
            FD.ktable.sets[(m.settings.dw && m.settings.dw.kSet) || 'threaded'].name);
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
  /* THE PANEL IS BUILT INSIDE A GUARD.
   *
   * It is assembled top to bottom into a host that has just been emptied, so a
   * throw anywhere in the middle leaves a panel missing everything below the
   * failure — and looking exactly like the model has lost it. That is what a
   * missing `return` in one readout helper did to the Control section
   * (2026-08-08), and the shape of the failure is worse than the failure: it
   * accuses the model of losing data it still holds.
   *
   * It also escaped into `changed()`, so the autosave, the clean-snapshot
   * bookkeeping and the solve schedule were all skipped whenever it fired.
   *
   * Guarded rather than merely fixed, because the next one will be some other
   * helper: say so on the panel, log it, and let everything else carry on. */
  function renderProperties() {
    try { renderPropertiesInner(); }
    catch (err) {
      var h = $('prop-body');
      if (h) {
        h.innerHTML = '';
        h.appendChild(el('h3', '', 'Panel error'));
        h.appendChild(el('p', 'hint warn',
          'This panel could not be drawn. Nothing in the model has changed — ' +
          'the drawing and the calculation are unaffected. Please report it: ' +
          String(err && err.message || err)));
      }
      if (window.console) window.console.error('renderProperties', err);
    }
  }

  /* EVERY PANEL RENDER GETS A TOKEN, and every field handler captures it.
   *
   * The panel is rebuilt from scratch whenever the selection changes. An input
   * that is FOCUSED when that happens is detached while dirty, and the browser
   * then fires its `change` — after the rebuild, with a closure still pointing
   * at the device that is no longer selected. So an edit begun on one pump was
   * committed to it from a box that had already been replaced on screen by
   * another pump's, with no way for the user to see it happen.
   *
   * Michael, 2026-08-08, reported it as silent data corruption, and it is
   * exactly that: a write to an object nobody is looking at. Naming and tags
   * showed it worst because they are the fields most often half-typed when
   * attention moves to the next device.
   *
   * `commit()` wraps a handler so it does nothing once its render is stale.
   * Cheap, and it covers every field rather than the one that was noticed. */
  var renderToken = 0;

  function commit(fn) {
    var mine = renderToken;
    return function () {
      if (mine !== renderToken) return;      // this panel is gone; not our edit
      return fn.apply(this, arguments);
    };
  }

  function renderPropertiesInner() {
    var host = $('prop-body');
    renderToken++;
    host.innerHTML = '';
    var m = app.model;
    var sel = app.view.selection;

    // TRACE mode shows the background drawing's own controls instead
    if (app.view.tool === 'trace') { renderTraceProps(host); return; }
    /* THE DETAIL TOOL'S OWN PANEL — what the NEXT line will be, since with the
     * tool active there is nothing selected to describe. Michael, 2026-08-08.
     * The same palette the per-line panel offers, so the control does not
     * change shape depending on how you got to it. */
    if (app.view.tool === 'detail') { renderDetailToolProps(host); return; }
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
    else if (s.kind === 'detail') renderDetailProps(host, (m.details || []).find(function (d) { return d.id === s.id; }));
    else if (s.kind === 'note') renderNoteProps(host, (m.notes || []).find(function (n) { return n.id === s.id; }));
    else renderNodeProps(host, M.node(m, s.id));
  }

  /* ============================================ L1: DRAWING ANNOTATION
   *
   * A detail line and a text note are the same panel with a different middle:
   * both are Details (what it is) and a colour, and neither has a Design, an
   * Actual or a Control — they are not part of the model and never will be.
   * That absence is the point, so the panel says it. */
  function annotationColourRow(sec, obj, noUndo) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', '', 'Colour'));
    var row = el('div', 'btn-row');
    M.DETAIL_COLOURS.forEach(function (name) {
      var sw = el('button', 'swatch sw-' + name + (obj.colour === name ? ' on' : ''));
      sw.type = 'button';
      sw.title = name;
      sw.addEventListener('click', function () {
        /* Changing the TOOL's colour is not a model edit and must not push an
         * undo step — undo should take back the line you drew, not the colour
         * you were about to draw it in. */
        if (!noUndo) pushUndo();
        obj.colour = name;
        if (!noUndo) changed();
        renderProperties();
      });
      row.appendChild(sw);
    });
    wrap.appendChild(row);
    sec.box.appendChild(wrap);
  }

  function renderDetailToolProps(host) {
    var v = app.view;
    if (!v.detailColour_) v.detailColour_ = 'line';
    if (!v.detailWidth_) v.detailWidth_ = 1.5;
    host.appendChild(el('h3', '', 'Detail line'));
    var sec = section(host, 'Details');
    /* A plain object rather than a model item — these are the tool's settings,
     * not a thing on the drawing, and `annotationColourRow` only needs
     * something with a `colour`. */
    var proxy = {
      get colour() { return v.detailColour_; },
      set colour(c) { v.detailColour_ = c; }
    };
    annotationColourRow(sec, proxy, true);
    var wIn = el('input'); wIn.type = 'text'; wIn.value = String(v.detailWidth_);
    field(sec.box, 'Line width (px)', wIn).addEventListener('change', commit(function () {
      var n = FD.units.parse(wIn.value);
      if (isFinite(n) && n > 0) v.detailWidth_ = Math.min(8, n);
      renderProperties();
    }));
    sec.box.appendChild(el('p', 'hint',
      'Click to place vertices \u2014 they snap to 15\u00b0 and to the grid, ' +
      'Shift frees both. Esc finishes. Clicking an existing line erases it.'));
    sec.box.appendChild(el('p', 'hint',
      'Drawing only. Nothing in the calculation ever reads these.'));
  }

  function renderDetailProps(host, d) {
    if (!d) return;
    host.appendChild(el('h3', '', 'Detail line'));
    var sec = section(host, 'Details');
    sec.ro('Internal tag', d.id);
    sec.ro('Vertices', String((d.pts || []).length));
    annotationColourRow(sec, d);
    var wIn = el('input'); wIn.type = 'text'; wIn.value = String(d.width || 1.5);
    field(sec.box, 'Line width (px)', wIn).addEventListener('change', function () {
      var v = FD.units.parse(wIn.value);
      if (isFinite(v) && v > 0) { pushUndo(); d.width = Math.min(8, v); changed(); }
      renderProperties();
    });
    sec.box.appendChild(el('p', 'hint',
      'Drawing only. Detail lines are not part of the model — nothing in the ' +
      'calculation, and no warning, ever looks at them.'));
    var del = el('button', 'btn danger', 'Remove line');
    del.addEventListener('click', function () {
      pushUndo(); M.removeDetail(app.model, d.id);
      app.view.selection = []; changed(); renderProperties();
    });
    host.appendChild(del);
  }

  function renderNoteProps(host, n) {
    if (!n) return;
    host.appendChild(el('h3', '', 'Text note'));
    var sec = section(host, 'Details');
    sec.ro('Internal tag', n.id);
    var ta = el('textarea'); ta.rows = 4; ta.value = n.text || '';
    field(sec.box, 'Text', ta).addEventListener('change', function () {
      pushUndo(); n.text = ta.value.replace(/\r/g, ''); changed();
    });
    annotationColourRow(sec, n);
    var sIn = el('input'); sIn.type = 'text'; sIn.value = String(n.size || 13);
    field(sec.box, 'Text size (px)', sIn).addEventListener('change', function () {
      var v = FD.units.parse(sIn.value);
      if (isFinite(v) && v >= 6) { pushUndo(); n.size = Math.min(48, v); changed(); }
      renderProperties();
    });
    var del = el('button', 'btn danger', 'Remove note');
    del.addEventListener('click', function () {
      pushUndo(); M.removeNote(app.model, n.id);
      app.view.selection = []; changed(); renderProperties();
    });
    host.appendChild(del);
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
    toggle('Temperature', 'nodeTemperature');
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
    /* Applied HERE so it covers every field on every panel, not just the ones
     * anybody remembered. See `noAutofill`. */
    if (control && control.tagName === 'INPUT' && control.type === 'text') {
      noAutofill(control);
    }
    return control;
  }

  /* The <label> of a field, for hanging an info marker on. `field` returns the
   * CONTROL — that is what callers wire their change handler to — so reaching
   * the label means going back up one. Worth a name, because doing it inline
   * reads as though `field` returned the wrapper, and it does not. */
  function fieldLabel(control) {
    return control && control.parentNode
      ? control.parentNode.querySelector('label') : null;
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

  /* Control link: a pump or globe valve takes its setpoint from a piece of
   * equipment. Click to pick the target on the drawing; click again to clear.
   *
   * Picking on the CANVAS rather than from a dropdown, because "which chiller"
   * is a question about the drawing and a list of P-numbers is not an answer
   * to it. */
  /* RECOVERING A ROUTE THAT HAS BEEN DRAGGED SOMEWHERE USELESS.
   *
   * A Z between two fixed points has one degree of freedom, and it can be slid
   * far enough away that its handles are off screen — or onto an axis where it
   * collapses — and then there is nothing left to grab to get it back. Michael,
   * 2026-08-06. Clearing `axis` and `mid` puts it back on the default the route
   * would have had when it was made; nothing else about the link changes. */
  function resetRouteBtn(route) {
    var b = el('button', 'btn', 'Reset route');
    b.title = 'Put the dashed route back where it started. Does not change ' +
              'what is linked.';
    b.addEventListener('click', function () {
      pushUndo();
      delete route.axis;
      delete route.mid;
      changed(); renderProperties(); app.view.render();
    });
    return b;
  }

  function controlField(host, p) {
    if (!M.canControl(p)) return;
    var m = app.model;
    var c = M.controlOf(p);
    var target = c ? M.pipe(m, c.equip) : null;

    /* L2 CONTROL. `Monitoring` names what it watches, `Holding` lists the
     * setpoints it may chase. Renamed at Michael's request, 2026-08-06: "Clear
     * control" and "Reset route" are what they do to the MODEL, and the panel
     * should say what they do to the link. */
    var sec = section(host, 'Control');
    var picking = !!(app.view.controlPick && app.view.controlPick.pipeId === p.id);

    /* ---- SYNC: FOLLOW ANOTHER DEVICE ---------------------------------
     *
     * The answer to "multiple equipment connected to a single sensor": link one
     * to the sensor, and set the rest to follow it. Offered above the control
     * link because it is the simpler relationship — no setpoint, no search, no
     * two loops to disagree — and because a device that is syncing has no use
     * for the rest of this section. */
    var syncId = M.syncOf(p);
    var candidates = m.pipes.filter(function (q) { return M.canSync(p, q); });
    if (candidates.length) {
      var syncSel = el('select');
      var none = el('option', '', '\u2014 not synced \u2014'); none.value = '';
      syncSel.appendChild(none);
      candidates.forEach(function (q) {
        var o = el('option', '', q.tag || q.id); o.value = q.id;
        if (q.id === syncId) o.selected = true;
        syncSel.appendChild(o);
      });
      field(sec.box, 'Sync ' + (p.kind === 'pump' ? 'VFD %' : 'opening %') + ' with',
            syncSel);
      infoMark(fieldLabel(syncSel),
               'Hold whatever position that device lands on. Use it when several ' +
               'machines share a header: link ONE to the sensor and sync the ' +
               'rest to it, rather than pointing them all at the same sensor.');
      syncSel.addEventListener('change', commit(function () {
        pushUndo();
        M.setSync(m, p, syncSel.value || null);
        changed(); renderProperties();
      }));
    }
    if (syncId) {
      var lead = M.pipe(m, syncId);
      sec.ro('Monitoring', lead ? (lead.tag || lead.id) : syncId);
      var pos = M.syncedPosition(m, p);
      sec.ro('Now holding',
             (p.kind === 'pump' ? 'VFD ' : 'Opening ') +
             Math.round((pos === null ? 1 : pos) * 100) + '%');
      sec.box.appendChild(el('p', 'hint',
        'Synced devices do not chase a setpoint of their own \u2014 clear the ' +
        'sync to give this one its own control link.'));
      return;
    }

    sec.ro('Monitoring', target ? (target.tag || target.id) : '\u2014');
    var row = el('div', 'btn-row');
    if (!c || picking) {
      var link = el('button', 'btn' + (picking ? ' active' : ''),
        picking ? 'Pick a target\u2026' : 'Link sensor');
      link.title = 'Follow a sensor\u2019s setpoint, or a machine\u2019s own';
      link.addEventListener('click', function () {
        if (picking) { app.view.controlPick = null; }
        else { app.view.controlPick = { pipeId: p.id };
               toast('Click the sensor or equipment to follow.'); }
        renderProperties(); app.view.render();
      });
      row.appendChild(link);
    } else {
      var rm = el('button', 'btn', 'Remove control');
      rm.addEventListener('click', function () {
        pushUndo(); M.setControl(m, p, null); changed();
        renderProperties(); app.view.render();
      });
      row.appendChild(rm);
      var rl = resetRouteBtn(c);
      rl.textContent = 'Reset link';
      row.appendChild(rl);
    }
    sec.box.appendChild(row);
    if (!target) {
      infoMark(sec.box.querySelector('.kv .k'),
               'Modulate to hold a setpoint. Shown as a dashed green line on ' +
               'the drawing.');
      return;
    }
    host = sec.box;

    /* WHAT IT IS HOLDING — one switch per setpoint the target offers, in the
     * order they are chased. Michael's structure, 2026-08-04.
     *
     * More than one can be on, and the ORDER is a fallback rather than a blend:
     * chase the first, and only if it turns out to be unreachable chase the
     * next. One actuator cannot hold two things at once, and pretending it can
     * is how a control loop starts oscillating. */
    /* Rendered in the order the engine will chase them, which is the stored
     * one if there is one — the list and the solve must not disagree about
     * which is primary. */
    var opts = M.controlOrdered(m, p);
    if (!opts.length) {
      host.appendChild(el('p', 'hint',
        (target.tag || target.id) + ' states no setpoint to hold.'));
      return;
    }
    /* Absent a stored choice, the FIRST option is on — the list is already in
     * priority order, so that is the sensible default rather than a guess. */
    if (!c.use) { c.use = {}; c.use[opts[0].key] = true; }

    var res = app.results;
    var dev = res && res.controls
      ? res.controls.devices.filter(function (x) { return x.pipe === p.id; })[0] : null;

    /* DRAG TO SET PRIORITY, the same gesture as the LEVELS list (Michael,
     * 2026-08-04). The order IS the meaning here — top is chased first, the
     * rest are fallbacks — so a list you rearrange says it better than a pair
     * of radio buttons ever would. The chosen order is stored on the CONTROLLER
     * as `control.order`, beside the toggles, because two pumps following one
     * machine may legitimately rank its setpoints differently. */
    host.appendChild(el('div', 'kv-head', 'Holding'));
    var listWrap = el('div', 'setpoint-list');
    opts.forEach(function (o, i) {
      var row = el('div', 'setpoint-row');
      row.draggable = true;
      row.appendChild(el('span', 'level-grip', '\u283f'));

      var sw = el('button', 'switch plain' + (c.use[o.key] ? ' on' : ' off'));
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', c.use[o.key] ? 'true' : 'false');
      sw.appendChild(el('span', 'switch-track', ''));
      sw.appendChild(el('span', 'switch-label',
        o.label + '  ' + fmtSetpoint(o)));
      sw.addEventListener('click', function () {
        pushUndo();
        c.use[o.key] = !c.use[o.key];
        /* Never leave a control link with nothing to hold: turning the last
         * one off is a request to stop controlling, so the link goes too. */
        if (!opts.some(function (x) { return c.use[x.key]; })) {
          M.setControl(m, p, null);
        }
        renderProperties(); changed();
      });
      row.appendChild(sw);
      row.appendChild(el('span', 'setpoint-rank',
        opts.length > 1 ? (i === 0 ? 'primary' : 'secondary') : ''));

      row.addEventListener('dragstart', function (e) {
        app.dragSetpoint = i;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      row.addEventListener('dragend', function () {
        app.dragSetpoint = null; renderProperties();
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('drop-target');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drop-target');
        var from = app.dragSetpoint;
        if (from === null || from === undefined || from === i) return;
        pushUndo();
        var keys = opts.map(function (x) { return x.key; });
        keys.splice(i, 0, keys.splice(from, 1)[0]);
        c.order = keys;
        renderProperties(); changed();
      });
      listWrap.appendChild(row);
    });
    host.appendChild(listWrap);

    if (opts.length > 1) {
      var pr = el('p', 'hint', 'Drag to set priority. ');
      infoMark(pr, 'The top one is held; the rest are fallbacks. One actuator ' +
                   'cannot hold two setpoints at once, so if the first cannot ' +
                   'be reached the next is chased instead.');
      host.appendChild(pr);
    }

    if (dev) {
      var ab = readoutBox(host, null);
      /* WHICH of the switches above it actually ended up chasing, which is the
       * fallback rule's visible outcome — not a second "Holding" heading. */
      ab.ro('Now holding', (dev.holding || '—') +
            (dev.fellBack ? ' (fallback)' : ''));
      /* WHO IT IS MODULATING WITH. Devices sharing one setpoint run at a common
       * position — a common header from one command, as real plant does — and a
       * panel showing a position nobody on this device chose, without saying
       * where it came from, would be its own little mystery. */
      if (dev.gangedWith && dev.gangedWith.length > 1) {
        var others = dev.gangedWith.filter(function (t) { return t !== (p.tag || p.id); });
        var gr = ab.ro('Modulating with', others.join(', '));
        infoMark(gr.querySelector('.k'),
                 'These all hold the same setpoint, so they move together at ' +
                 'one ' + dev.quantity + '. Give them separate setpoints if you ' +
                 'want them staged instead.');
      }
      ab.ro(dev.quantity === 'speed' ? 'Speed' : 'Opening',
            Math.round(dev.value * 100) + '%' +
            (dev.state === 'at-min' ? ' — at minimum'
             : dev.state === 'at-max' ? ' — at maximum'
             : dev.state === 'unsettled' ? ' — not holding' : ''));
    }
  }

  /* ONE PUMP CHART, shared by the calculation sheet and the pump panel.
   *
   * Returns { svg, caption } or null. `opts.family` draws the 90–50% speed
   * curves, `opts.system` the solved system curve — the sheet wants both, the
   * panel's quick look wants neither. Written once because the two were about
   * to drift: a chart that disagrees with itself in two places is worse than
   * no chart.
   *
   * The chart carries:
   *   - the RATED curve, solid;
   *   - the speed family, dotted (affinity-scaled, §17C — always true for the
   *     pump, whatever the system is doing);
   *   - the SYSTEM curve in red, SOLVED rather than assumed
   *     (FD.network.systemCurve). The parabola through the origin that usually
   *     gets drawn is only right with no static lift, no second pump and a
   *     square law everywhere;
   *   - the operating point, where the two meet.
   */
  function pumpCurveSvg(m, res, p, opts) {
    opts = opts || {};
    var d = m.settings.display;
    var simulating = (m.settings.calcMode === 'simulation');
    var svgNS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs) {
      var e = document.createElementNS(svgNS, tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      return e;
    }
    var FAMILY = opts.family ? [0.9, 0.8, 0.7, 0.6, 0.5] : [];
    if (!p || !p.pump || !p.pump.curve) return null;

    var c = p.pump.curve;
    var off = p.pump.mode === 'off';
    var sp = M.pumpSpeed(m, p);
    var cRun = M.pumpCurve(m, p) || c;
    var qNow = res && res.flow ? Math.abs(res.flow[p.id] || 0) : 0;
    var hNow = M.pumpHead(m, p, qNow);

    /* The system curve is a handful of extra solves, so it is only asked
     * for where it means something. */
    var sys = (opts.system && simulating && !off && FD.network.systemCurve)
      ? FD.network.systemCurve(m, p.id) : null;

    /* CUT OFF AT 200% OF DESIGN FLOW (Michael, 2026-08-04). The axis used
     * to run to wherever the curve reached zero head, which is 200% exactly
     * for the single-point assumption but wanders with a FITTED curve — his
     * own runs to 224%. Nobody selects a pump on what it does past twice
     * duty, and letting the axis follow the fit made two pumps on the same
     * sheet unreadable against each other. */
    var qMax = (c.Qd > 0) ? c.Qd * 2 : (FD.pumps.maxFlow(c) || 0);
    var hMax = FD.pumps.head(c, 0) || 1;
    if (sys) {
      sys.forEach(function (pt) {
        if (pt.q <= qMax && pt.h > hMax) hMax = pt.h;
      });
    }
    if (!(qMax > 0) || !(hMax > 0)) return;

    var W = 440, H = 220, PADL = 40, PADB = 34;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'pump-curve' });
    function X(q) { return PADL + (q / qMax) * (W - PADL - 14); }
    function Y(h) { return (H - PADB) - (h / hMax) * (H - PADB - 14); }

    // axes
    svg.appendChild(svgEl('line', { x1: PADL, y1: H - PADB, x2: W - 8, y2: H - PADB,
                                    stroke: 'currentColor', 'stroke-width': 1, opacity: .5 }));
    svg.appendChild(svgEl('line', { x1: PADL, y1: 8, x2: PADL, y2: H - PADB,
                                    stroke: 'currentColor', 'stroke-width': 1, opacity: .5 }));
    function axisLabel(x, y, txt, anchor) {
      var t = svgEl('text', { x: x, y: y, 'font-size': 10, fill: 'currentColor',
                              opacity: .7, 'text-anchor': anchor || 'middle' });
      t.textContent = txt; svg.appendChild(t);
    }
    axisLabel(W - 8, H - PADB + 22, d.flow, 'end');
    axisLabel(PADL, 8, d.pressure, 'end');
    axisLabel(X(qMax), H - PADB + 12, FD.units.fmtFlow(qMax, d.flow), 'end');
    axisLabel(PADL - 4, Y(hMax) + 4, FD.units.fmtPressure(headToPa(hMax), d.pressure), 'end');

    function curvePts(cc) {
      var pts = [];
      for (var i = 0; i <= 60; i++) {
        var q = qMax * i / 60;
        var h = FD.pumps.head(cc, q);
        if (h < 0) break;                 // past the end of the curve
        pts.push(X(q).toFixed(1) + ',' + Y(h).toFixed(1));
      }
      return pts.join(' ');
    }

    // --- the speed family, dotted
    FAMILY.forEach(function (n) {
      var cs = FD.pumps.atSpeed(c, n);
      if (!cs) return;
      svg.appendChild(svgEl('polyline', {
        points: curvePts(cs), fill: 'none', stroke: 'currentColor',
        'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: .5
      }));
      /* Label the family at its own shutoff, which is where the curves are
       * furthest apart and nothing else is drawn. */
      var t = svgEl('text', { x: X(0) + 3, y: Y(FD.pumps.head(cs, 0)) - 2,
                              'font-size': 9, fill: 'currentColor', opacity: .6 });
      t.textContent = Math.round(n * 100) + '%';
      svg.appendChild(t);
    });

    // --- the rated curve, solid
    svg.appendChild(svgEl('polyline', {
      points: curvePts(c), fill: 'none', stroke: 'currentColor', 'stroke-width': 2
    }));

    /* --- the curve it is ACTUALLY on, when that is neither the rated one
     * nor one of the dotted family. */
    if (sp < 0.999 && FAMILY.indexOf(Math.round(sp * 100) / 100) < 0) {
      svg.appendChild(svgEl('polyline', {
        points: curvePts(cRun), fill: 'none', stroke: 'currentColor',
        'stroke-width': 1.5, 'stroke-dasharray': '6 3', opacity: .85
      }));
    }

    // --- the system curve, red
    var shown = sys ? sys.filter(function (pt) { return pt.q <= qMax; }) : null;
    if (shown && shown.length >= 2) {
      svg.appendChild(svgEl('polyline', {
        points: shown.map(function (pt) {
          return X(pt.q).toFixed(1) + ',' + Y(pt.h).toFixed(1);
        }).join(' '),
        fill: 'none', stroke: 'var(--error)', 'stroke-width': 2, opacity: .9
      }));
      var end = shown[shown.length - 1];
      var sl = svgEl('text', { x: X(end.q) - 4, y: Y(end.h) - 6,
                               'font-size': 10, fill: 'var(--error)', 'text-anchor': 'end' });
      sl.textContent = 'system';
      svg.appendChild(sl);
    }

    // --- the operating point
    if (!off && qNow > 0) {
      svg.appendChild(svgEl('circle', { cx: X(qNow), cy: Y(hNow), r: 4,
                                        fill: 'currentColor' }));
      var lbl = svgEl('text', { x: X(qNow) + 7, y: Y(hNow) - 6,
                                'font-size': 11, fill: 'currentColor' });
      lbl.textContent = FD.units.fmtFlow(qNow, d.flow, true) + ' @ ' +
                        FD.units.fmtPressure(headToPa(hNow), d.pressure, true);
      svg.appendChild(lbl);
    }

    var cap = (p.tag || p.id) +
      (off ? ' — stopped'
           : sp < 0.999 ? ' — ' + Math.round(sp * 100) + '% speed' : '');
    var ch = el('p', 'hint', cap + ' ');
    if (!simulating) {
      infoMark(ch, 'The system curve is a SIMULATION result — it is traced ' +
                   'by solving the network at a range of pump speeds. In ' +
                   'DESIGN the demands impose the flow, so there is nothing ' +
                   'to trace.');
    } else if (!shown || shown.length < 2) {
      infoMark(ch, 'No system curve: the network did not settle at enough ' +
                   'distinct flows below 200% of duty to trace one.');
    }

    var cap = (p.tag || p.id) +
      (off ? ' — stopped'
           : sp < 0.999 ? ' — ' + Math.round(sp * 100) + '% speed' : '');
    var ch = el('p', 'hint', cap + ' ');
    if (opts.system && !simulating) {
      infoMark(ch, 'The system curve is a SIMULATION result — it is traced ' +
                   'by solving the network at a range of pump speeds. In ' +
                   'DESIGN the demands impose the flow, so there is nothing ' +
                   'to trace.');
    } else if (opts.system && (!shown || shown.length < 2)) {
      infoMark(ch, 'No system curve: the network did not settle at enough ' +
                   'distinct flows below 200% of duty to trace one.');
    }
    return { svg: svg, caption: ch };
  }

  /* A setpoint written the way its own quantity reads. */
  /* Every mode gets its own units. The fall-through used to be °C, so the three
   * modes the SENSOR added — pressure, and the two differentials — all came out
   * as temperatures: a pump holding 200 kPa read "Differential pressure
   * 200000.0 °C" on its own switch. Found 2026-08-06 while checking the reset
   * button, which is the only reason it was on screen. */
  function fmtSetpoint(o) {
    var d = app.model.settings.display;
    if (o.mode === 'flow') return FD.units.fmtFlow(o.value, d.flow, true);
    if (o.mode === 'pressure' || o.mode === 'dPdiff') {
      return FD.units.fmtPressure(o.value, d.pressure, true);
    }
    /* A DIFFERENCE is in kelvin, an absolute temperature in °C — and 'dTdiff'
     * is a difference between two pipes, not a temperature. */
    if (o.mode === 'dT' || o.mode === 'dTdiff') return o.value.toFixed(1) + ' K';
    return o.value.toFixed(1) + ' °C';
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
    if (p.kind === 'sensor') { renderSensorProps(host, p); return; }
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

    /* ---- thermal: insulation ----
     * A pipe's OWN thickness always wins, including 0 for a bare pipe — a
     * blank falls back to its schedule. That distinction matters: a
     * deliberately uninsulated pipe must not silently pick up 50 mm. */
    var nominal = FD.schedules.nominalMm ? FD.schedules.nominalMm(p.size) : 0;
    var insDefault = FD.schedules.insulationFor(p.schedule, p.size, nominal,
                                               m.settings.insulation);
    var insIn = el('input'); insIn.type = 'text';
    insIn.value = (p.insulation_mm === undefined || p.insulation_mm === null ||
                   p.insulation_mm === '') ? '' : p.insulation_mm;
    insIn.placeholder = insDefault.toFixed(0) + ' (default)';
    field(host, 'Insulation (mm)', insIn).addEventListener('change', function () {
      var raw = insIn.value.trim();
      pushUndo();
      if (raw === '') delete p.insulation_mm;
      else {
        var v = FD.units.parse(raw);
        if (isFinite(v) && v >= 0) p.insulation_mm = v;
        else { insIn.value = p.insulation_mm === undefined ? '' : p.insulation_mm; }
      }
      renderProperties(); changed();
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

    /* What this pipe did thermally. Separate box, because it answers a
     * different question from the pressure drop above it. */
    var tl = res && res.thermal && res.thermal.links[p.id];
    if (tl) {
      var tb = readoutBox(host, 'Thermal');
      tb.ro('Inlet', tl.tIn.toFixed(2) + ' °C');
      tb.ro('Outlet', tl.tOut.toFixed(2) + ' °C');
      tb.ro('Gain / loss', (tl.qW >= 0 ? '+' : '') + tl.qW.toFixed(1) + ' W');
      tb.ro('Loss coefficient', (tl.UperM || 0).toFixed(3) + ' W/(m·K)');
      tb.box.appendChild(el('p', 'hint', '+ gains from the room · − loses to it.'));
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
  /* L2 DISPLAY — what this item writes on the drawing.
   *
   * It used to appear only while the VIEW tool was active, which meant the
   * switches were somewhere you had to already know about: you cannot discover
   * a control by being in a different mode from it. As a collapsible section it
   * is always in the same place and costs one line when closed. Michael's UI
   * pass, 2026-08-06. */
  function displayChecks(host, obj, opts) {
    var sec = section(host, 'Display');
    opts.forEach(function (o) {
      switchRow(sec.box, o.label, !!M.displayFlags(obj)[o.key], function (on) {
        pushUndo();
        M.setDisplayFlag(obj, o.key, on);
        changed(); renderProperties();
      });
    });
  }

  /* The id the model knows this item by — P7, N33. Not the user's tag: it is
   * what every message, the calculation sheet and any debug file refer to, so
   * it belongs on the panel rather than only in the heading. */
  function idRow(sec, p) { sec.ro('Internal tag', p.id); }

  /* ONLINE / OFFLINE rather than Running / Off (Michael, 2026-08-06). One pair
   * of words for every device, so a pump, a coil and a valve all read the same
   * way — and "Off (isolated, no flow)" was describing the modelling rather
   * than the state. What it MEANS stays behind the marker. */
  function onlineToggle(host, isOn, apply, why) {
    var sw = statusToggle(host, isOn, 'Online', 'Offline', apply);
    var lbl = sw.parentNode && sw.parentNode.querySelector('label');
    if (lbl && why) infoMark(lbl, why);
    return sw;
  }

  /* Equipment tag. Shared by every in-line device — it is the reference the
   * engineer works from on site, so it belongs on all of them, not just
   * equipment. */
  /* THE TAG'S OWN VISIBILITY SWITCH (Michael, 2026-08-09).
   *
   * Separate from the "Show on drawing" checkboxes, which control the VALUE BOX
   * beside a device. This is the tag itself — the one label that could not be
   * turned off per item, and on a dense floor that is a lot of text nobody
   * asked for.
   *
   * OFF hides it in every mode EXCEPT Annotation, where it stays in grey and
   * stays selectable — otherwise a hidden tag would have no handle left to turn
   * it back on with. */
  function tagVisibleRow(host, o) {
    if (!o || !o.tag) return;
    var on = M.tagVisible(o);
    var sw = switchRow(host, 'Tag visible: ' + (on ? 'ON' : 'OFF'), on, function (next) {
      pushUndo();
      M.setTagVisible(o, next);
      renderProperties();
      /* Presentation, not geometry: redraw and save, never re-solve. */
      scheduleSave();
      app.view.render();
    });
    infoMark(sw, 'Hides the tag on the drawing and on prints. It stays visible ' +
                 'in ANNOTATION — greyed, and still selectable — so it can be ' +
                 'turned back on.');
  }

  function tagField(host, p) {
    var i = el('input'); i.type = 'text'; i.value = p.tag || '';
    i.placeholder = 'e.g. CHW-P-01';
    noAutofill(i);
    field(host, 'Tag', i).addEventListener('change', commit(function () {
      var v = i.value.trim();
      if (v === (p.tag || '')) return;       // nothing typed; do not push undo
      /* A SECOND, INDEPENDENT LOCK: the field may only write to something that
       * is STILL SELECTED. The render token already refuses a commit from a
       * panel that has been replaced, and the corruption came back anyway
       * (v0.15.8, `20260808-DC-broken`), so this does not rely on the same
       * signal. If the device this box belongs to is no longer what the user is
       * looking at, the edit is not theirs to make. */
      var owned = (app.view.selection || []).some(function (x) {
        return x.kind === 'pipe' && x.id === p.id;
      });
      if (!owned) return;
      /* AND IT MAY NEVER APPEND A GENERATED TAG. Every corrupted value seen so
       * far is `<a real tag><a freshly generated one>` — `CHWP-04PMP-1PMP-1…`,
       * `CHWP-0AHU-15AHU-152`. Whatever route produces that, a tag box has no
       * business committing one, so it is refused and reported rather than
       * written and discovered days later. */
      if (M.looksMangled(v)) {
        toast('That tag looks like two tags run together — not saved.', 'error');
        renderProperties();
        return;
      }
      pushUndo();
      if (v) p.tag = v; else delete p.tag;
      changed();
    }));
  }

  /* KEEP THE BROWSER OUT OF FIELDS THE APP OWNS.
   *
   * A nameless `<input type="text">` joins the browser's own autofill pool, and
   * every tag box in this app looks identical to it — so a pump's Tag field was
   * being offered, and sometimes given, values typed into an AHU's. That is
   * where `CHWP-04PMP-1` and `PWP-04MP-4MP-4…` came from: not the app
   * concatenating anything, the browser filling a box it had no business in.
   *
   * `autocomplete="off"` alone is widely ignored by Chrome; a nonsense token it
   * has no heuristic for is what actually works, and `data-1p-ignore` /
   * `data-lpignore` ask the two commonest password managers to stay out too. */
  function noAutofill(i) {
    i.setAttribute('autocomplete', 'new-password');
    i.setAttribute('autocorrect', 'off');
    i.setAttribute('autocapitalize', 'off');
    i.setAttribute('spellcheck', 'false');
    i.setAttribute('data-1p-ignore', '');
    i.setAttribute('data-lpignore', 'true');
    return i;
  }

  /* Spec §8.3 — an in-line device with a rated flow and pressure drop.
   * ΔP scales as (Q/Q_rated)². */
  /* PIPE SENSOR — an instrument, and the panel says so by what it does NOT
   * offer: no design point, no duty, no in-service switch. It states one
   * setpoint and nothing else.
   *
   * Michael, 2026-08-04. The case is thermostatic mixing: put a sensor
   * downstream of a blend, set the temperature you want, and Control-link a
   * valve or a pump to it. */
  function renderSensorProps(host, p) {
    var m = app.model, d = m.settings.display;
    if (!p.sensor) p.sensor = { mode: 'temperature', tSet: 45 };
    var sn = p.sensor;
    host.appendChild(el('h3', '', 'Sensor ' + p.id));
    tagField(host, p);
    tagVisibleRow(host, p);

    var modeSel = el('select');
    [['temperature', 'Temperature'], ['flow', 'Flow'],
     ['pressure', 'Pressure'], ['dP', 'Differential pressure'],
     ['dT', 'Differential temperature']].forEach(function (o) {
      var opt = el('option', '', o[1]); opt.value = o[0];
      if (o[0] === sn.mode) opt.selected = true;
      modeSel.appendChild(opt);
    });
    field(host, 'Measures', modeSel).addEventListener('change', function () {
      pushUndo(); sn.mode = modeSel.value; renderProperties(); changed();
    });

    if (sn.mode === 'flow') {
      var qIn = el('input'); qIn.type = 'text';
      qIn.value = sn.qSet ? FD.units.fmtFlow(sn.qSet, d.flow) : '';
      field(host, 'Flow setpoint (' + d.flow + ')', qIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(qIn.value);
          pushUndo();
          sn.qSet = (isFinite(v) && v > 0) ? FD.units.toSIFlow(v, d.flow) : undefined;
          renderProperties(); changed();
        });
    } else if (sn.mode === 'pressure') {
      var pIn = el('input'); pIn.type = 'text';
      pIn.value = sn.pSet ? FD.units.fmtPressure(sn.pSet, d.pressure) : '';
      var pf = field(host, 'Pressure setpoint (' + d.pressure + ')', pIn);
      infoMark(pIn.parentNode.querySelector('label'),
               'Read at the sensor\u2019s inlet — the water arriving, which is ' +
               'what a tapping on that pipe would read.');
      pf.addEventListener('change', function () {
        var v = FD.units.parse(pIn.value);
        pushUndo();
        sn.pSet = (isFinite(v) && v > 0) ? FD.units.toSIPressure(v, d.pressure) : undefined;
        renderProperties(); changed();
      });
    } else if (sn.mode === 'dP' || sn.mode === 'dT') {
      /* TWO PIPES, one sensor. The sensor sits in the first; the second is
       * picked on the drawing, the same gesture as a control link — "which
       * pipe" is a question about the drawing, and a menu of P-numbers is not
       * an answer to it (§17B). */
      var isDP = (sn.mode === 'dP');
      var dIn = el('input'); dIn.type = 'text';
      dIn.value = isDP
        ? (sn.dpSet ? FD.units.fmtPressure(sn.dpSet, d.pressure) : '')
        : (sn.dtSet === undefined || sn.dtSet === null ? '' : sn.dtSet);
      field(host, isDP ? 'Δp setpoint (' + d.pressure + ')' : 'ΔT setpoint (K)', dIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(dIn.value);
          pushUndo();
          if (isDP) {
            sn.dpSet = (isFinite(v) && v > 0)
              ? FD.units.toSIPressure(v, d.pressure) : undefined;
          } else {
            sn.dtSet = isFinite(v) ? Math.abs(v) : undefined;
          }
          renderProperties(); changed();
        });

      var refPipe = sn.ref ? M.pipe(m, sn.ref) : null;
      var rrow = el('div', 'btn-row');
      var picking = !!(app.view.refPick && app.view.refPick.pipeId === p.id);
      var rb = el('button', 'btn' + (picking ? ' active' : ''),
        picking ? 'Pick pipe…' : (refPipe ? 'Clear reference' : 'Reference pipe…'));
      rb.addEventListener('click', function () {
        if (picking) { app.view.refPick = null; }
        else if (refPipe) { pushUndo(); delete sn.ref; changed(); }
        else { app.view.refPick = { pipeId: p.id };
               toast('Click the second pipe to measure against.'); }
        renderProperties(); app.view.render();
      });
      rrow.appendChild(rb);
      /* Same recovery as a control link — the ΔP route is the same Z and can be
       * dragged just as far out of reach. */
      if (refPipe) rrow.appendChild(resetRouteBtn(sn.route || (sn.route = {})));
      if (refPipe) rrow.appendChild(el('span', 'hint', refPipe.tag || refPipe.id));
      host.appendChild(rrow);
      if (!refPipe) {
        host.appendChild(el('p', 'hint',
          'A differential needs two pipes. Pick the second one.'));
      }
    } else {
      var tIn = el('input'); tIn.type = 'text';
      tIn.value = (sn.tSet === undefined || sn.tSet === null) ? '' : sn.tSet;
      field(host, 'Temperature setpoint (°C)', tIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(tIn.value);
          pushUndo();
          sn.tSet = isFinite(v) ? v : undefined;
          renderProperties(); changed();
        });
    }

    var hint = el('p', 'hint', 'Link a pump or globe valve to it with Control. ');
    infoMark(hint, 'The sensor states a setpoint; the linked device modulates ' +
                   'to hold it. Nothing happens without a link, and the ' +
                   'modulation runs in SIMULATION only.');
    host.appendChild(hint);

    /* Who is following it, and what they settled at. A setpoint with nothing
     * wired to it is the failure this panel has to make visible. */
    var followers = m.pipes.filter(function (q) {
      var c = M.controlOf(q);
      return c && c.equip === p.id;
    });
    var box = readoutBox(host, 'Actual');
    var res = app.results;
    var tl = res && res.thermal && res.thermal.links[p.id];
    if (sn.mode === 'flow') {
      var qa = res && res.flow ? res.flow[p.id] : undefined;
      box.ro('Flow', qa === undefined ? '—'
             : FD.units.fmtFlow(Math.abs(qa), d.flow, true));
    } else if (sn.mode === 'pressure') {
      var pa = res && res.pressure ? res.pressure[p.a] : undefined;
      box.ro('Pressure', pa === undefined ? '—'
             : FD.units.fmtPressure(pa, d.pressure, true));
    } else if (sn.mode === 'dP' || sn.mode === 'dT') {
      var rp = sn.ref ? M.pipe(m, sn.ref) : null;
      var v1, v2, txt = '—';
      if (rp && res) {
        if (sn.mode === 'dP' && res.pressure) {
          v1 = res.pressure[p.a]; v2 = res.pressure[rp.a];
          if (isFinite(v1) && isFinite(v2)) {
            txt = FD.units.fmtPressure(Math.abs(v1 - v2), d.pressure, true);
          }
        } else if (res.thermal) {
          v1 = res.thermal.temperature[p.a]; v2 = res.thermal.temperature[rp.a];
          if (isFinite(v1) && isFinite(v2)) txt = Math.abs(v1 - v2).toFixed(2) + ' K';
        }
      }
      box.ro(sn.mode === 'dP' ? 'Δp' : 'ΔT', txt);
    } else {
      box.ro('Temperature', tl && isFinite(tl.tIn) ? tl.tIn.toFixed(2) + ' °C' : '—');
    }
    /* "Linked to", not "Controlled by": the SENSOR is the thing doing the
     * controlling — it states the setpoint. Michael, 2026-08-04. */
    if (!followers.length) {
      box.ro('Linked to', 'nothing');
    } else {
      followers.forEach(function (q) {
        var dev = res && res.controls
          ? res.controls.devices.filter(function (x) { return x.pipe === q.id; })[0] : null;
        box.ro(q.tag || q.id, dev
          ? (dev.quantity === 'speed'
              ? Math.round(dev.value * 100) + '% speed'
              : Math.round(dev.value * 100) + '% open') +
            (dev.state === 'at-min' ? ' (at minimum)'
             : dev.state === 'at-max' ? ' (at maximum)'
             : dev.state === 'unsettled' ? ' (not holding)' : '')
          : 'linked');
      });
    }

    /* THE LIST OFFERS WHAT THIS SENSOR MEASURES, and nothing else.
     *
     * Michael, 2026-08-09: "dP sensor Display properties should show dP instead
     * of Temperature." It was a fixed list — Tag, Flow, Temperature, Setpoint —
     * whatever the instrument was, so a differential pressure sensor offered to
     * draw the water temperature at its tapping and did not offer the one
     * quantity it exists to report. Same for ΔT, which he asked me to check.
     *
     * FLOW stays on every mode: a sensor is a piece of pipe and the flow
     * through it is always a real reading. */
    var readKey = { flow: 'flow', pressure: 'pressure', dP: 'dP', dT: 'dTdiff' };
    var readLabel = { flow: 'Flow', pressure: 'Pressure',
                      dP: 'Differential pressure',
                      dT: 'Differential temperature' };
    var checks = [{ key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' }];
    if (sn.mode === 'temperature') {
      checks.push({ key: 'temp', label: 'Temperature' });
    } else if (readKey[sn.mode] && sn.mode !== 'flow') {
      checks.push({ key: readKey[sn.mode], label: readLabel[sn.mode] });
    }
    checks.push({ key: 'setpoint', label: 'Setpoint' });
    displayChecks(host, p, checks);

    var del = el('button', 'btn danger', 'Remove sensor');
    del.addEventListener('click', function () {
      pushUndo(); p.kind = 'pipe'; delete p.sensor;
      changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* ============================================ L1: EQUIPMENT
   *
   * Three shapes off one function, because they are three devices (Michael,
   * 2026-08-06):
   *
   *   HEAT SOURCE / SINK  states a LEAVING TEMPERATURE; duty follows
   *   HEAT EXCHANGER      states a LOAD; temperature follows
   *   ADIABATIC           states neither — a strainer, a filter, a meter
   *
   * They share Details, Design, Actual and Display; what is IN Design is what
   * differs, which is exactly what the three types mean.
   */
  function renderEquipProps(host, p) {
    var m = app.model, d = m.settings.display;
    var e = p.equip;
    if (e.equipType !== 'source' && e.equipType !== 'exchanger' &&
        e.equipType !== 'adiabatic') {
      e.equipType = 'exchanger';
    }
    var isSource = (e.equipType === 'source');
    var isAdiabatic = (e.equipType === 'adiabatic');
    var title = isSource ? 'Heat source / sink'
              : isAdiabatic ? 'Other' : 'Heat exchanger';
    host.appendChild(el('h3', '', title + ' ' + (p.tag || p.id)));

    // ---------------------------------------------------------- L2 DETAILS
    var det = section(host, 'Details');
    idRow(det, p);
    tagField(det.box, p);
    tagVisibleRow(det.box, p);

    var typeSel = el('select');
    [['source', 'Heat source / sink'], ['exchanger', 'Heat exchanger'],
     ['adiabatic', 'Other (no thermal behaviour)']].forEach(function (o) {
      var opt = el('option', '', o[1]); opt.value = o[0];
      if (o[0] === e.equipType) opt.selected = true;
      typeSel.appendChild(opt);
    });
    field(det.box, 'Equipment type', typeSel).addEventListener('change', function () {
      pushUndo(); e.equipType = typeSel.value; renderProperties(); changed();
    });

    flipField(det.box, p);
    onlineToggle(det.box, !e.off, function (on) {
      pushUndo();
      if (on) delete e.off; else e.off = true;
      renderProperties(); changed();
    }, 'Offline is a BREAK in the circuit, not a bypass — the same as a stopped ' +
       'pump. Without it the only way to take a chiller out of a model was to ' +
       'delete it and redraw it later.');

    // ----------------------------------------------------------- L2 DESIGN
    var des = section(host, 'Design');

    /* Design flow is one of the THREE locked by Q = ṁ·Cp·ΔT, so it goes through
     * the same helper as the load and ΔT. A re-render follows because the edit
     * may have moved one of the other two, and a stale figure left sitting in
     * the panel is exactly how a 0.8 L/s coil ends up carrying 20 L/s. */
    var qIn = el('input'); qIn.type = 'text';
    qIn.value = FD.units.fmtFlow(e.qRated || 0, d.flow);
    field(des.box, 'Flow (' + d.flow + ')', qIn);
    if (!isAdiabatic) {
      infoMark(fieldLabel(qIn),
               'Flow, load and ΔT are one equation. Changing this moves ' +
               'whichever of the other two you set least recently.');
    }
    qIn.addEventListener('change', function () {
      var v = FD.units.parse(qIn.value);
      if (isFinite(v) && v > 0) {
        pushUndo();
        M.setEquipTrio(m, p, 'qRated', FD.units.toSIFlow(v, d.flow));
        renderProperties(); changed();
      } else { qIn.value = FD.units.fmtFlow(e.qRated || 0, d.flow); }
    });

    var pdIn = el('input'); pdIn.type = 'text';
    pdIn.value = FD.units.fmtPressure(e.pdRated || 0, d.pressure);
    field(des.box, 'Pressure drop (' + d.pressure + ')', pdIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(pdIn.value);
        if (isFinite(v) && v >= 0) {
          pushUndo(); e.pdRated = FD.units.toSIPressure(v, d.pressure); changed();
        } else { pdIn.value = FD.units.fmtPressure(e.pdRated || 0, d.pressure); }
      });
    /* K FACTOR, which on an adiabatic item is the whole of what it is: a
     * strainer is a resistance and nothing else. Stated for the others too,
     * because it is the one basis on which a coil and a terminal compare. */
    designKRow(des, e.qRated, e.pdRated);

    renderEquipThermal(des, p);

    // ----------------------------------------------------------- L2 ACTUAL
    var res = app.results;
    var thL = res && res.thermal && res.thermal.links[p.id];
    if ((res && res.flow[p.id] !== undefined) || thL) {
      var act = section(host, 'Actual');
      if (res && res.flow[p.id] !== undefined) {
        var link = res.network.links.find(function (l) { return l.id === p.id; });
        act.ro('Flow', FD.units.fmtFlow(Math.abs(res.flow[p.id]), d.flow, true));
        if (link) {
          act.ro('Pressure drop', FD.units.fmtPressure(
            headToPa(Math.abs(FD.hydraulics.linkLoss(link, res.flow[p.id]))),
            d.pressure, true));
        }
      }
      if (thL && !isAdiabatic) {
        act.ro('EWT', thL.tIn.toFixed(2) + ' °C');
        act.ro('LWT', thL.tOut.toFixed(2) + ' °C');
        act.ro('ΔT', (thL.dT >= 0 ? '+' : '') + thL.dT.toFixed(2) + ' K');
        act.ro(loadLabel(thL.qW), fmtLoad(thL.qW));
        /* % LOAD against the nameplate. Signed capacity makes this positive
         * whenever the machine is working in its own direction, which is the
         * only time the ratio means anything. */
        var cap = isSource ? Number(e.qMax) : Number(e.duty);
        act.ro('% Load',
               (isFinite(cap) && cap !== 0)
                 ? (thL.qW / cap * 100).toFixed(1) + '%' : '—');
        if (thL.limit) act.ro('Limited by', thL.limit);

        /* REQUIRED CAPACITY — the sizing answer (Michael, 2026-08-09).
         *
         * On Auto this is the whole point of the machine being unlimited: it
         * held its setpoint, and this is what that took. On Manual it is worth
         * as much again, because it is the number to compare the nameplate
         * with — and when a capacity binds it is the ONLY place the shortfall
         * is stated, since the reported duty is then the nameplate rather than
         * the demand. */
        if (thL.qNeed !== null && thL.qNeed !== undefined && isFinite(thL.qNeed)) {
          act.ro('Required capacity', fmtLoad(thL.qNeed));
          if (isFinite(cap) && cap !== 0) {
            /* MARGIN against what is selected, as a percentage of the
             * requirement — which is the way a selection is quoted. Negative
             * means the machine is short, and it is shown in red for the same
             * reason the setpoint deficit is. */
            var marg = (Math.abs(cap) / Math.abs(thL.qNeed) - 1) * 100;
            var mrow = act.ro('Margin on selection',
              (marg >= 0 ? '+' : '') + marg.toFixed(1) + '%  (' +
              fmtLoad(cap) + ' selected)');
            if (marg < 0) mrow.classList.add('deficit');
          } else {
            act.box.appendChild(el('p', 'hint',
              'Sizing is Auto, so this is the capacity to select. Switch ' +
              'Sizing to Manual to lock it in as the nameplate.'));
          }
        }

        /* THE DEFICIT, in red (Michael, 2026-08-05). A source/sink that misses
         * its setpoint still REPORTS a leaving temperature, and read on its own
         * that number looks like an achieved result. The gap between what it
         * was asked for and what it managed is what an engineer needs to see. */
        if (isSource && isFinite(Number(e.tSet))) {
          var miss = thL.tOut - Number(e.tSet);
          if (Math.abs(miss) > 0.05) {
            var mr = act.ro('Setpoint deficit',
              (miss > 0 ? '+' : '') + miss.toFixed(2) + ' K ' +
              (miss > 0 ? 'above' : 'below') + ' ' + Number(e.tSet).toFixed(1) + ' °C');
            mr.classList.add('deficit');
            act.box.appendChild(el('p', 'hint warn', 'Not reaching setpoint' +
              (thL.limit ? ' — limited by ' + thL.limit : '') + '.'));
          }
        }
      }
    }

    // ---------------------------------------------------------- L2 CONTROL
    if (!isAdiabatic) equipControlSection(host, p);

    // ---------------------------------------------------------- L2 DISPLAY
    displayChecks(host, p, isAdiabatic ? [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'pd', label: 'ΔP' }
    ] : [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'temp', label: 'EWT / LWT' },
      { key: 'dT', label: 'ΔT' },
      { key: 'pd', label: 'ΔP' },
      { key: 'duty', label: 'Heating/Cooling load' },
      { key: 'load', label: 'Design load' },
      { key: 'pctload', label: '% Load' },
      { key: 'setpoint', label: 'Setpoint' }
    ]);

    var del = el('button', 'btn danger', 'Remove equipment');
    del.addEventListener('click', function () {
      pushUndo(); p.kind = 'pipe'; delete p.equip;
      changed(); renderProperties();
    });
    host.appendChild(del);
  }

  /* ============================================ L2 CONTROL, ON EQUIPMENT
   *
   * Michael, 2026-08-08. Two controls, and they are different KINDS of thing:
   *
   *   INTEGRATED CONTROL VALVE  a valve that is part of the machine rather than
   *                             drawn beside it, holding that machine's own ΔT.
   *                             It is what an AHU actually ships with, and
   *                             drawing the valve, the sensor and the link by
   *                             hand for every coil on a 60-coil model is three
   *                             gestures that never say anything different.
   *
   *   CAPACITY OVERRIDE         a percentage on the stated duty. Not a control
   *                             at all in the plant sense — a way of asking
   *                             "what if this coil were at 40%?" without
   *                             retyping the load and losing the design figure.
   */
  function equipControlSection(host, p) {
    var m = app.model, e = p.equip;
    var sec = section(host, 'Control');

    /* ---- INTEGRATED CONTROL VALVE ------------------------------------- */
    var hasICV = !!e.icv;
    switchRow(sec.box, 'Integrated control valve', hasICV, function (on) {
      pushUndo();
      if (on) {
        /* Same defaults a drawn control valve gets, so the two behave
         * identically — this is a placement convenience, not a second kind of
         * valve with its own rules. */
        e.icv = { kv: FD.valves.defaultKv('globe', M.pipeBore(m, p) * 1000),
                  opening: 100 };
      } else {
        delete e.icv;
      }
      changed(); renderProperties();
    });
    if (hasICV) {
      infoMark(sec.box.lastChild,
               'A globe valve built into the machine, holding this machine\u2019s ' +
               'own Design ΔT. Equivalent to drawing a control valve in the ' +
               'branch and linking it here — it just saves doing that on every ' +
               'coil.');
      var useCv = (m.settings.display.valveCoef === 'Cv');
      var kvIn = el('input'); kvIn.type = 'text';
      kvIn.value = useCv ? FD.valves.kvToCv(e.icv.kv).toFixed(1) : String(e.icv.kv);
      field(sec.box, useCv ? 'Valve Cv' : 'Valve Kv', kvIn)
        .addEventListener('change', commit(function () {
          var val = FD.units.parse(kvIn.value);
          if (!(isFinite(val) && val > 0)) { renderProperties(); return; }
          pushUndo();
          e.icv.kv = useCv ? Math.round(FD.valves.cvToKv(val) * 10) / 10 : val;
          changed(); renderProperties();
        }));
      pctSlider(sec.box, 'Valve position (%)',
                e.icv.opening === undefined ? 100 : e.icv.opening,
                function (n) { pushUndo(); e.icv.opening = n; changed(); renderProperties(); },
                (m.settings.calcMode === 'simulation')
                  ? 'Held by the machine\u2019s own \u0394T in SIMULATION — the solve writes it.'
                  : null);
      sec.ro('Holding', 'Design \u0394T of ' + (p.tag || p.id));
    }

    /* ---- CAPACITY OVERRIDE -------------------------------------------- */
    var ovOn = (e.loadPct !== undefined && e.loadPct !== null);
    switchRow(sec.box, 'Capacity override', ovOn, function (on) {
      pushUndo();
      if (on) e.loadPct = 100; else delete e.loadPct;
      changed(); renderProperties();
    });
    if (ovOn) {
      pctSlider(sec.box, 'Capacity (%)', e.loadPct, function (n) {
        pushUndo(); e.loadPct = n; changed(); renderProperties();
      }, 'Scales the stated load. The DESIGN figure above is untouched, so the ' +
         'machine is still on the schedule at its full duty — this only asks ' +
         'what it does at part load.');
      var full = Number(e.equipType === 'source' ? e.qMax : e.duty) || 0;
      sec.ro('Effective', ((Math.abs(full) * e.loadPct / 100) / 1000).toFixed(2) +
             ' kW ' + (full < 0 ? 'cooling' : 'heating'));
    }
  }

  /* A 0-100% slider with an exact-entry box beside it. The same control the
   * valve panel uses; named so the three places that want one agree. */
  function pctSlider(host, label, value, apply, note) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', '', label));
    var row = el('div', 'slider-row');
    var sl = el('input');
    sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
    sl.value = String(Math.round(value));
    var box = el('input', 'cell-input tiny-num');
    box.type = 'text'; box.value = sl.value;
    function set(v) {
      var n = Math.max(0, Math.min(100, Math.round(Number(v))));
      if (!isFinite(n)) return;
      sl.value = String(n); box.value = String(n);
      apply(n);
    }
    sl.addEventListener('input', function () { box.value = sl.value; });
    sl.addEventListener('change', commit(function () { set(sl.value); }));
    box.addEventListener('change', commit(function () { set(box.value); }));
    row.appendChild(sl); row.appendChild(box);
    wrap.appendChild(row);
    if (note) wrap.appendChild(el('span', 'hint', note));
    host.appendChild(wrap);
    return { slider: sl, box: box };
  }

  /* A COOLING LOAD READS POSITIVE (Michael, 2026-08-06): "Cooling Load : xxx
   * kW", not "−xxx kW". The sign convention is about the FLUID and it is right
   * — negative means heat removed — but nobody writes a chiller's duty with a
   * minus sign on a schedule, and a panel that does looks like an error.
   *
   * DISPLAY ONLY. The stored value keeps its sign, and every calculation,
   * message and export still sees it, because the convention is what makes the
   * heat balance add up (ARCHITECTURE §18). */
  function loadLabel(w) { return (w < 0 ? 'Cooling' : 'Heating') + ' load'; }
  function fmtLoad(w) { return (Math.abs(w) / 1000).toFixed(2) + ' kW'; }

  /* Equipment's thermal side.
   *
   * TWO TYPES, split on what you know at design (Michael, 2026-08-03):
   *
   *   Source / Sink   chiller, boiler, tower. State a leaving temperature;
   *                   duty follows, limited by capacity, ΔT and a physical
   *                   temperature limit.
   *   Heat Exchanger  AHU, FCU, HX. State a load; temperature follows,
   *                   limited by ΔT and the same temperature limit.
   *
   * On an exchanger Q, ΔT and ṁ are locked by Q = ṁ·Cp·ΔT, so both are offered
   * and each rewrites the other — the model stores the duty, so the engine
   * only ever sees one quantity. */
  /* ================================================= EARLY-DESIGN SIZING
   *
   * Michael, 2026-08-09, and it falls straight out of Design ΔT no longer
   * clamping: a machine with no stated capacity holds its setpoint whatever
   * that takes, so THE DUTY IT LANDS ON IS THE ANSWER TO WHAT TO BUY. Exactly
   * the pattern `autoSizePumps` has always used, applied to plant.
   *
   * Both of these read the ENGINE's own figure rather than working anything out
   * here — `thermal.links[].qNeed` is `C·(tSet − tIn)`, the duty needed to sit
   * on setpoint at the flow the machine actually has. A panel that derives its
   * own physics is a second answer waiting to disagree with the first. */
  function requiredCapacityOf(p) {
    var res = app.results;
    var l = res && res.thermal && res.thermal.links && res.thermal.links[p.id];
    return (l && l.qNeed !== null && l.qNeed !== undefined && isFinite(l.qNeed))
      ? l.qNeed : NaN;
  }

  /* THE DESIGN POINT, for a model that has not been simulated: ρ·q·cp·ΔT on
   * the machine's OWN scheduled flow and difference, signed from its setpoint
   * against the system supply temperature. It is the same relation
   * `M.setEquipTrio` keeps between the three fields, so it cannot disagree
   * with what the panel shows. */
  function designPointDuty(m, p) {
    var e = p.equip || {};
    var C = M.equipRatedC(m, p);
    var dT = Math.abs(Number(e.dTMax));
    if (!(C > 0) || !isFinite(dT) || dT <= 0) return NaN;
    /* Which direction it works in — inferred, never selected (§18). A setpoint
     * below the water it is given is cooling. */
    var set = Number(e.tSet);
    var amb = Number((m.settings.thermal || {}).supplyTemp);
    var cooling = isFinite(set) && isFinite(amb) ? (set < amb) : true;
    return (cooling ? -1 : 1) * C * dT;
  }

  function renderEquipThermal(sec, p) {
    var m = app.model;
    var host = sec.box;
    var e = p.equip;
    var isSource = (e.equipType === 'source');

    function num(label, get, set, hoverText) {
      var i = el('input'); i.type = 'text';
      var v = get();
      i.value = (v === undefined || v === null || v === '') ? '' : v;
      var f = field(host, label, i);
      if (hoverText) infoMark(f.parentNode.querySelector('label'), hoverText);
      i.addEventListener('change', function () {
        var raw = i.value.trim();
        pushUndo();
        if (raw === '') set(undefined);
        else {
          var n = FD.units.parse(raw);
          if (!isFinite(n)) { renderProperties(); return; }
          set(n);
        }
        renderProperties(); changed();
      });
      return i;
    }

    /* One wording for both optional limits. Michael's instruction, 2026-08-03:
     * the field either has a number in it or it does not, and that is all the
     * marker needs to say. What each limit MEANS is in ARCHITECTURE §18. */
    var OPTIONAL = 'Optional — leave blank for unlimited.';
    /* The sign convention, identical on the load and the capacity because they
     * are the same quantity read from two directions. */
    var SIGN = 'Positive value indicates heat entering fluid. Negative value ' +
               'indicates heat removed from fluid.';

    /* ADIABATIC has no thermal side at all — a filter, a strainer, a flow
     * meter. It keeps its hydraulics (a filter has a real pressure drop) and
     * offers nothing else, which is the whole point of the type. */
    if (e.equipType === 'adiabatic') {
      var ah = el('p', 'hint', 'No thermal properties. ');
      infoMark(ah, 'A filter, strainer or meter: real pipework with a real ' +
                   'pressure drop, and water that leaves as it arrived. It ' +
                   'states no setpoint, so nothing can control to it.');
      host.appendChild(ah);
      return;
    }

    /* HEATING / COOLING AS A TOGGLE, with the magnitude typed beside it
     * (Michael, 2026-08-06). The stored value is signed and stays signed —
     * that convention is what makes the heat balance add up — but typing a
     * minus sign to mean "chiller" is a convention you have to be told,
     * whereas a switch that says Cooling is one you can read.
     *
     * Typing a signed number still works and MOVES THE TOGGLE, because someone
     * who knows the convention should not be fought. */
    function signedField(key, label, getW, setW, hoverText) {
      var w = getW();
      var has = (w !== undefined && w !== null && w !== '' && isFinite(Number(w)));
      /* THE DIRECTION IS A UI INTENT UNTIL THERE IS A NUMBER.
       *
       * A signed number cannot say "cooling, magnitude not yet decided" — zero
       * has no sign — so with the box empty the switch had nothing to write and
       * toggling it did nothing at all. Michael, 2026-08-07: "Unable to change
       * heating/cooling mode without entering load."
       *
       * Kept OUT of the model deliberately: the stored value is the single
       * source of truth whenever it exists, and this only fills the gap before
       * it does. Keyed by device and field, so two machines do not share one. */
      var intentKey = p.id + ':' + key;
      var cooling = has ? Number(w) < 0 : !!signIntent[intentKey];

      var wrap = el('div', 'field');
      var lab = el('label', '', label);
      infoMark(lab, hoverText);
      wrap.appendChild(lab);

      var row = el('div', 'btn-row');
      var sw = el('button', 'switch plain sign ' + (cooling ? 'cooling' : 'heating'));
      sw.type = 'button';
      sw.appendChild(el('span', 'switch-track', ''));
      sw.appendChild(el('span', 'switch-label', cooling ? 'Cooling' : 'Heating'));
      var box = el('input', 'cell-input num-left');
      box.type = 'text';
      box.value = has ? String(Math.abs(Number(w)) / 1000) : '';
      /* BLANK MEANS UNLIMITED, and the box now says so. Michael, 2026-08-08:
       * "Unlimited & Auto are equivalent as far as the user's expectations." An
       * empty box reads as a field nobody has filled in yet rather than as a
       * decision, and the difference matters on a machine that is deliberately
       * left to modulate freely. Grey, because it is not a value. */
      if (!has) box.placeholder = 'Auto';

      function commit(kW, isCooling) {
        pushUndo();
        signIntent[intentKey] = isCooling;
        setW(kW === undefined ? undefined
                              : (isCooling ? -Math.abs(kW) : Math.abs(kW)) * 1000);
        renderProperties(); changed();
      }
      sw.addEventListener('click', function () {
        var n = FD.units.parse(box.value);
        commit(isFinite(n) ? n : undefined, !cooling);
      });
      box.addEventListener('change', function () {
        var raw = box.value.trim();
        if (raw === '') { commit(undefined, cooling); return; }
        var n = FD.units.parse(raw);
        if (!isFinite(n)) { renderProperties(); return; }
        /* A typed sign WINS — it is a more specific statement than the switch
         * position, and silently discarding it is how you teach someone the
         * app does not listen. */
        commit(Math.abs(n), /^\s*-/.test(raw) ? true : (n < 0 ? true : cooling));
      });
      row.appendChild(sw);
      row.appendChild(box);
      wrap.appendChild(row);
      host.appendChild(wrap);
    }

    if (isSource) {
      /* ORDER: Type, Capacity, % Load, LWT Setpoint, Design ΔT (Michael,
       * 2026-08-03 and 2026-08-04). Capacity first because it is the machine's
       * nameplate; the setpoint is what you ask OF it and reads better after.
       *
       * T limit is GONE at Michael's instruction, 2026-08-04: "let the engineer
       * evaluate". It was a hard clamp on a physical bound — wet bulb on a
       * tower, ambient on an economizer — and the judgement of whether an
       * answer is achievable belongs to the person reading it.
       *
       * Capacity, design flow and ΔT are ONE equation here exactly as they are
       * on an exchanger, so they go through the same helper. */
      /* SIZING, and it is the same question the pump panel asks (Michael,
       * 2026-08-09). Blank capacity means the machine holds its setpoint
       * whatever that takes — so the duty it lands on IS the answer to what to
       * buy, and the Actual section reports it as `Required capacity`. Naming
       * that state AUTO rather than leaving it as an empty box is the whole
       * feature: an engineer at the front end of a job wants to be asked "shall
       * I size this for you?", not to discover that an unfilled field happens
       * to behave that way. */
      var eAuto = !isFinite(Number(e.qMax)) || Number(e.qMax) === 0;
      var szSel = el('select');
      [['auto', 'Auto'], ['manual', 'Manual']].forEach(function (o) {
        var opt = el('option', '', o[1]); opt.value = o[0];
        if ((o[0] === 'auto') === eAuto) opt.selected = true;
        szSel.appendChild(opt);
      });
      field(host, 'Sizing', szSel);
      infoMark(fieldLabel(szSel),
               'Auto: it holds its setpoint whatever that takes, and the duty ' +
               'it lands on is the capacity you need — read it off Required ' +
               'capacity below. Manual: you state the nameplate, and it is held ' +
               'to it.');
      szSel.addEventListener('change', function () {
        pushUndo();
        if (szSel.value === 'auto') {
          M.setEquipTrio(m, p, 'duty', undefined);
        } else {
          /* SEEDED FROM THE ANSWER THE SOLVE ALREADY HAS, which is the point of
           * having asked. The design point is the fallback for a model that has
           * not been simulated, and an empty box the last resort — never a
           * number nobody derived. Design flow is HELD while the capacity is
           * written, so it is the ΔT that follows: with a capacity and a flow
           * stated, the difference is arithmetic. */
          var seed = requiredCapacityOf(p);
          if (!(isFinite(seed) && seed !== 0)) seed = designPointDuty(m, p);
          if (isFinite(seed) && seed !== 0) {
            e.lastEdited = ['duty', 'qRated'];
            M.setEquipTrio(m, p, 'duty', seed);
          }
        }
        renderProperties(); changed();
      });

      signedField('qMax', 'Capacity (kW)',
          function () { return e.qMax; },
          function (w) { M.setEquipTrio(m, p, 'duty', w); },
          SIGN + ' Blank = Auto: unlimited, and sized by the solve.');

      num('LWT setpoint (°C)', function () { return e.tSet; },
          function (v) { e.tSet = v; },
          'Leaving water temperature the machine modulates to hold.');
      num('ΔT (K)',
          function () {
            return e.dTMax === undefined || e.dTMax === null || e.dTMax === ''
              ? '' : e.dTMax;
          },
          function (v) { M.setEquipTrio(m, p, 'dT', v); },
          'Flow, capacity and ΔT are one equation. Changing this moves ' +
          'whichever of the other two you set least recently. ' + OPTIONAL);
    } else {
      /* Load, design flow and ΔT are ONE equation. Editing any of the three
       * moves whichever was touched least recently — M.setEquipTrio, and the
       * reason it is not simply "ΔT rewrites the load" is `debug/20260803-1`. */
      signedField('duty', 'Capacity (kW)',
          function () { return e.duty; },
          function (w) { M.setEquipTrio(m, p, 'duty', w); },
          SIGN);
      var C = M.equipRatedC(m, p);
      num('ΔT (K)',
          function () {
            return C > 0 ? Math.round(M.equipDTFromDuty(m, p, e.duty || 0) * 1000) / 1000 : '';
          },
          function (v) { if (v !== undefined) M.setEquipTrio(m, p, 'dT', v); },
          'Flow, load and ΔT are one equation. Changing this moves ' +
          'whichever of the other two you set least recently.');
      num('ΔT max (K)', function () { return e.dTMax; },
          function (v) { e.dTMax = v; }, OPTIONAL);

      /* TEMPERATURE LIMIT, with a MAX/MIN switch (Michael, 2026-08-06). One
       * number cannot say which side it binds on: 12 °C is a floor on a chilled
       * coil and a ceiling on a heating one, and the engine works it out from
       * which side the machine is approaching from. Saying it explicitly is
       * both clearer to read and the thing you check when a limit binds
       * unexpectedly. Stored as the same single `tLimit`; the switch is a
       * statement of intent shown beside it. */
      var tlWrap = el('div', 'field');
      var tlLab = el('label', '', 'Temperature limit (°C)');
      infoMark(tlLab, 'The temperature the machine cannot take the water past — ' +
                      'a tower cannot cool below wet bulb. Whether it is a ' +
                      'maximum or a minimum follows from which side the water ' +
                      'is approaching from; the switch says which you meant. ' +
                      OPTIONAL);
      tlWrap.appendChild(tlLab);
      var tlRow = el('div', 'btn-row');
      var isMax = (Number(e.duty) || 0) >= 0;
      var tlSw = el('button', 'switch plain ' + (isMax ? 'on' : 'off'));
      tlSw.type = 'button';
      tlSw.disabled = true;
      tlSw.title = 'Follows the load direction: a heating coil is limited by a ' +
                   'MAXIMUM, a cooling coil by a MINIMUM.';
      tlSw.appendChild(el('span', 'switch-track', ''));
      tlSw.appendChild(el('span', 'switch-label', isMax ? 'Max' : 'Min'));
      var tlIn = el('input', 'cell-input num-left');
      tlIn.type = 'text';
      tlIn.value = (e.tLimit === undefined || e.tLimit === null) ? '' : e.tLimit;
      tlIn.addEventListener('change', function () {
        var raw = tlIn.value.trim();
        pushUndo();
        if (raw === '') e.tLimit = undefined;
        else {
          var n = FD.units.parse(raw);
          if (!isFinite(n)) { renderProperties(); return; }
          e.tLimit = n;
        }
        renderProperties(); changed();
      });
      tlRow.appendChild(tlSw); tlRow.appendChild(tlIn);
      tlWrap.appendChild(tlRow);
      host.appendChild(tlWrap);
    }

  }

  /* Valves are sized by flow coefficient. Kv and Cv are the same number in
   * different units, so editing either updates the other — the model always
   * stores Kv. */
  /* ============================================ L1: VALVE
   *
   * TWO PANELS, because they are two different devices (Michael, 2026-08-06):
   *
   *   CONTROL VALVE    a globe valve. Has a POSITION, and may be linked to a
   *                    setpoint. No status toggle — its state is its position.
   *   ISOLATION VALVE  a gate valve. Open or shut, and that IS its status.
   *
   * A check valve is neither: it has no position anyone sets and no status
   * anyone chooses, so it gets the isolation shape without the switch.
   */
  function renderValveProps(host, p) {
    var m = app.model, d = m.settings.display;
    var v = p.valve;
    var t = FD.valves.type(v.type);
    /* GLOBE = control valve, matching `M.canControl` — the same test the engine
     * uses to decide what a controller may drive. NOT `t.adjustable`, which a
     * gate valve also has: a gate valve CAN sit part-open (the solver
     * interpolates its Kv) but it is not a regulating device, and offering it a
     * 1% slider invites modelling something nobody installs. */
    var isControl = (v.type === 'globe');
    var isCheck = !!(t && t.checkValve);
    /* An existing gate valve left part-open keeps its slider, so nothing is
     * silently lost from a model drawn before this. New ones are open or shut. */
    var partOpen = !isControl && !isCheck &&
                   v.opening !== undefined && v.opening > 0 && v.opening < 100;
    var title = isControl ? 'Control valve' : isCheck ? 'Check valve' : 'Isolation valve';
    host.appendChild(el('h3', '', title + ' ' + (p.tag || p.id)));

    // ---------------------------------------------------------- L2 DETAILS
    var det = section(host, 'Details');
    idRow(det, p);
    tagField(det.box, p);
    tagVisibleRow(det.box, p);
    if (isCheck) flipField(det.box, p);

    /* The TYPE selector stays, because a valve drawn as the wrong kind should
     * be correctable without deleting it — but it is a Details field now
     * rather than the second thing on the panel. */
    var typeSel = el('select');
    Object.keys(FD.valves.types).forEach(function (k2) {
      var o = el('option', '', FD.valves.types[k2].name); o.value = k2;
      if (k2 === v.type) o.selected = true;
      typeSel.appendChild(o);
    });
    field(det.box, 'Type', typeSel).addEventListener('change', function () {
      pushUndo();
      v.type = typeSel.value;
      // Re-default Kv for the new type unless the user has clearly set it.
      v.kv = FD.valves.defaultKv(v.type, M.pipeBore(m, p) * 1000);
      renderProperties(); changed();
    });

    /* AN ISOLATION VALVE'S STATUS IS OPEN OR SHUT, and it is the same control
     * every other device gets — not a slider that happens to have two useful
     * ends. A gate valve is not a regulating device (ARCHITECTURE §11), so
     * offering it 1% steps invited modelling something that does not exist. */
    if (!isControl && !isCheck) {
      var isOpen = (v.opening === undefined ? 100 : v.opening) > 0;
      statusToggle(det.box, isOpen, 'Open', 'Closed', function (on) {
        pushUndo();
        v.opening = on ? 100 : 0;
        renderProperties(); changed();
      });
    }

    // ----------------------------------------------------------- L2 DESIGN
    var des = section(host, 'Design');
    /* ONE coefficient, not both. Kv and Cv are the same quantity in different
     * units, so showing both invited typing into the one being ignored. Which
     * one appears is a display choice (SETTINGS ▸ Display units). */
    var useCv = (d.valveCoef === 'Cv');
    var coefIn = el('input'); coefIn.type = 'text';
    coefIn.value = useCv ? FD.valves.kvToCv(v.kv).toFixed(1) : String(v.kv);
    field(des.box, useCv ? 'Cv (US gpm at 1 psi)' : 'Kv (m³/h at 1 bar)', coefIn)
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
    var reset = el('button', 'btn', 'Reset for this size');
    reset.title = 'Back to the default ' + (useCv ? 'Cv' : 'Kv') + ' for this bore';
    reset.addEventListener('click', function () {
      pushUndo();
      v.kv = FD.valves.defaultKv(v.type, M.pipeBore(m, p) * 1000);
      renderProperties(); changed();
    });
    var rrow = el('div', 'btn-row'); rrow.appendChild(reset);
    des.box.appendChild(rrow);

    /* VALVE POSITION, on a control valve only. Full range in 1% steps
     * (Michael, 2026-08-03): it snapped to five positions, which is not how a
     * regulating valve is set — a balancing valve lands wherever it lands. */
    if (isControl || partOpen) {
      var openWrap = el('div', 'field');
      openWrap.appendChild(el('label', '', 'Valve position (%)'));
      if (partOpen) {
        openWrap.appendChild(el('span', 'hint',
          'This isolation valve is throttled. Set it to 0 or 100 and the ' +
          'slider goes away — a gate valve is not a regulating device.'));
      }
      var openRow = el('div', 'slider-row');
      var slider = el('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
      slider.value = String(v.opening === undefined ? 100 : v.opening);
      var box = el('input', 'cell-input tiny-num');
      box.type = 'text'; box.value = slider.value;
      function setOpen(val, rerender) {
        var n = Math.max(0, Math.min(100, Math.round(Number(val))));
        if (!isFinite(n)) return;
        slider.value = String(n); box.value = String(n);
        if (rerender) { pushUndo(); v.opening = n; renderProperties(); changed(); }
      }
      slider.addEventListener('input', function () { box.value = slider.value; });
      slider.addEventListener('change', function () { setOpen(slider.value, true); });
      box.addEventListener('change', function () { setOpen(box.value, true); });
      openRow.appendChild(slider);
      openRow.appendChild(box);
      openWrap.appendChild(openRow);
      if (Number(slider.value) === 0) openWrap.appendChild(el('span', 'hint', 'Shut.'));
      /* A controlled valve's position is an OUTPUT, so the controls are
       * DISABLED rather than merely annotated (Michael, 2026-08-04). Leaving
       * them live invites setting a number the next solve overwrites, which
       * reads as the app ignoring you. */
      if (M.controlOf(p) && m.settings.calcMode === 'simulation') {
        slider.disabled = true; box.disabled = true;
        openRow.classList.add('is-disabled');
        var vh = el('span', 'hint', 'Set by the control link. ');
        infoMark(vh, 'The valve modulates to hold its linked setpoint, so this ' +
                     'position is written by the solve. Clear the control link ' +
                     'to set it by hand.');
        openWrap.appendChild(vh);
      }
      des.box.appendChild(openWrap);
    } else if (isCheck) {
      des.box.appendChild(el('p', 'hint',
        'Opens with forward flow, seats against reverse. Not user-positioned.'));
    }

    var effKv = FD.valves.effectiveKv(v.type, v.kv, v.opening);
    des.ro('Effective ' + (useCv ? 'Cv' : 'Kv'),
           (useCv ? FD.valves.kvToCv(effKv) : effKv).toFixed(1) +
           (v.opening < 100 ? '  (' + v.opening + '% open)' : ''));
    des.box.appendChild(el('p', 'hint',
      'Default Kv values are derived from typical resistance coefficients, not ' +
      'manufacturer data. Replace with published Kv for real design work.'));

    // ----------------------------------------------------------- L2 ACTUAL
    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var act = section(host, 'Actual');
      var q = res.flow[p.id];
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      act.ro('Position', (v.opening === undefined ? 100 : v.opening) + '%');
      act.ro('Flow', FD.units.fmtFlow(Math.abs(q), d.flow, true));
      if (link) {
        if (link.r >= FD.valves.CLOSED_R) {
          act.ro('Pressure drop', 'Shut — no flow path');
        } else {
          var pd = headToPa(Math.abs(FD.hydraulics.linkLoss(link, q)));
          act.ro('Pressure drop', FD.units.fmtPressure(pd, d.pressure, true));
        }
        if (link._checkShut) act.ro('State', 'Seated (holding back-flow)');
      }
    }

    // ---------------------------------------------------------- L2 CONTROL
    if (isControl) controlField(host, p);

    // ---------------------------------------------------------- L2 DISPLAY
    displayChecks(host, p, [
      { key: 'tag', label: 'Tag' },
      { key: 'opening', label: 'Position %' },
      { key: 'flow', label: 'Flow' },
      { key: 'pd', label: 'ΔP' }
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
  /* ============================================ L2: A COLLAPSIBLE CATEGORY
   *
   * Michael's three levels (2026-08-06):
   *
   *     L1  what is selected        the panel heading
   *     L2  a category of data      this
   *     L3  the individual fields
   *
   * Every device panel is built from the same sections in the same order —
   * Details, Design, Actual, Control, Display — so the panel does not
   * rearrange itself as you click around a model, and "the flow it is actually
   * doing" is in the same place on a pump as on a coil.
   *
   * OPEN/CLOSED IS REMEMBERED PER SECTION NAME, not per device. `renderProperties`
   * rebuilds this DOM from scratch on every solve, so the state cannot live in
   * the elements; and keyed by name it means collapsing "Display" collapses it
   * for everything, which is what someone who does not use it wants. */
  /* Which way a Heating/Cooling switch is pointing while its box is empty. See
   * `signedField` — it is a UI intent, not model state, and it is discarded the
   * moment a real signed number exists. */
  var signIntent = {};

  var sectionOpen = {};
  try {
    var storedSections = window.localStorage.getItem('fpc.sections');
    if (storedSections) sectionOpen = JSON.parse(storedSections) || {};
  } catch (e) { /* private browsing, or no storage. Defaults are fine. */ }

  function section(host, name) {
    var closed = sectionOpen[name] === false;
    var wrap = el('div', 'sect' + (closed ? ' closed' : ''));
    var head = el('button', 'sect-head');
    head.type = 'button';
    var caret = el('span', 'sect-caret', closed ? '\u25b8' : '\u25be');
    head.appendChild(caret);
    head.appendChild(el('span', 'sect-name', name));
    var body = el('div', 'sect-body');
    head.addEventListener('click', function () {
      var nowClosed = !wrap.classList.contains('closed');
      wrap.classList.toggle('closed', nowClosed);
      caret.textContent = nowClosed ? '\u25b8' : '\u25be';
      sectionOpen[name] = !nowClosed;
      try {
        window.localStorage.setItem('fpc.sections', JSON.stringify(sectionOpen));
      } catch (e2) { /* nothing to do; the panel still works for this session */ }
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    host.appendChild(wrap);

    /* The same `ro` a readout box offers, so an existing panel body moves into
     * a section without being rewritten around a different helper. */
    return {
      box: body,
      ro: function (k, v) {
        var r = el('div', 'kv');
        r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v));
        body.appendChild(r);
        return r;
      }
    };
  }

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
  /* L2 ACTUAL — what the pump is doing right now, as against what it was sized
   * for. The two sit in fixed places so they can be read against each other. */
  function pumpActualSection(host, p) {
    var m = app.model;
    var pu = m.settings.display.pressure, fu = m.settings.display.flow;
    var c = p.pump.curve;
    var sec = section(host, 'Actual');
    var d = sec.box;
    {
      /* RETURNS THE ROW. It did not, and `pumpActualSection` hangs an info
       * marker off the VFD row — so `infoMark(undefined, …)` threw, from
       * inside `renderProperties`, HALF WAY THROUGH BUILDING THE PANEL.
       *
       * That is Michael's "controls get intermittently dropped or reset
       * silently (entire section disappears)", 2026-08-08: Details and Design
       * are appended before the throw and Control and Display never are, so
       * the section is not dropped from the MODEL — it was never drawn. And
       * because the exception escapes `changed()`, everything after it in that
       * call is skipped too: the autosave, the clean-snapshot bookkeeping, the
       * solve schedule.
       *
       * It fires exactly when a pump carries a speed below 1 and the mode is
       * DESIGN — which is what switching out of SIMULATE produces on every
       * modulating pump at once. */
      function ro(k, v) {
        var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v)); d.appendChild(r);
        return r;
      }
      var pres = app.results;
      var pOff = p.pump.mode === 'off';
      var qNow = pOff ? 0
               : (pres && pres.flow && pres.flow[p.id] !== undefined
                  ? Math.abs(pres.flow[p.id]) : null);
      /* A stopped pump develops no head. Reading its curve at Q = 0 would
       * report shutoff head, which is what it WOULD make if it were running.
       * With no curve the pump IS its fixed head — what the solver used. */
      var sp = M.pumpSpeed(m, p);
      /* M.pumpHead, not the curve directly. In DESIGN the solver runs on the
       * fixed head and the curve is not in the calculation — reading it here
       * reported a head the answer never used, and one that RISES as the pump
       * backs off because a curve read at a lower flow always reads up. */
      var hNow = pOff ? 0 : qNow === null ? null : M.pumpHead(m, p, qNow);
      ro('Actual flow', qNow === null ? '—' : FD.units.fmtFlow(qNow, fu, true));
      ro('Actual pressure', hNow === null ? '—'
         : FD.units.fmtPressure(headToPa(hNow), pu, true));
      /* VFD speed is shown ALWAYS, at Michael's instruction (2026-08-03). It
       * was hidden at 100% on the argument that a line reading "100%" is noise;
       * he wants it on every pump, because "is this pump on full?" is a
       * question you ask of a pump that is NOT modulating just as often. Where
       * something is holding it down, the line says what: a number the engineer
       * did not type needs a reason beside it. */
      if (!pOff) {
        var ctl = app.results && app.results.controls;
        var dev = ctl ? ctl.devices.filter(function (x) { return x.pipe === p.id; })[0] : null;
        var vrow = ro('VFD speed', Math.round(sp * 100) + '%' +
           (dev ? ' — holding ' + (dev.equipTag || dev.equip) +
                  (dev.state === 'at-min' ? ' (at minimum)' : '') : ''));
        /* A stored speed that is not being applied is the one state worth
         * explaining: the number is on the pump and does nothing. */
        if (M.pumpSpeedIgnored(m, p)) {
          infoMark(vrow, 'Speed applies in SIMULATION only. In DESIGN the ' +
                         'demands impose the flow, so slowing the pump cannot ' +
                         'reduce it — the sizer would just specify a bigger pump.');
        }
      }
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
  }

  /* The curve controls, which belong with DESIGN because a curve IS the design
   * statement on a pump sized from one. Renamed at Michael's request: Input /
   * Show / Clear, three verbs of one word rather than "Paste curve data…". */
  function pumpCurveButtons(host, p) {
    var m = app.model;
    var pu = m.settings.display.pressure, fu = m.settings.display.flow;
    var c = p.pump.curve;
    var row = el('div', 'btn-row');

    /* With no curve, the way to GET one is the offer \u2014 not a paragraph saying
     * where to look. The generator opens pre-filled with this pump's design
     * duty, which is the first thing it asks for. */
    /* No jump to TOOLS any more (Michael, 2026-08-05). The Sizing selector in
     * the Design box generates a curve from the duty this pump already has, so
     * the round trip through the generator — retyping a number the app just
     * calculated — is gone. The generator stays on the TOOLS tab for anyone who
     * wants to build a curve from scratch. */
    if (!c) {
      host.appendChild(el('p', 'hint',
        'No curve. Set Sizing to Auto or Manual above to generate one from the ' +
        'design duty, or paste a manufacturer curve below.'));
    }

    var paste = el('button', 'btn', 'Input');
    paste.title = 'Paste a manufacturer curve: two columns, flow then head';
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
      var tbl = el('button', 'btn', 'Show');
      tbl.title = 'Plot the curve with the operating point on it';
      tbl.addEventListener('click', function () {
        var rows = FD.pumps.table(c);
        var lines = ['   %      Flow (' + fu + ')      Head (' + pu + ')'].concat(
          rows.map(function (r) {
            return String(r.pct).padStart(4) + '   ' +
                   FD.units.fmtFlow(r.q, fu).padStart(12) + '   ' +
                   FD.units.fmtPressure(headToPa(r.h), pu).padStart(14);
          }));
        /* THE CURVE, not just the numbers (Michael, 2026-08-05). A table of
         * twelve rows does not tell you the shape, and the shape is the whole
         * reason to look — where the duty sits on it, and how far it is from
         * the knee. The operating point is drawn on it. Same builder as the
         * calculation sheet, so the two cannot disagree. */
        var built = pumpCurveSvg(app.model, app.results, p, {});
        FD.dialog.report({
          title: 'Pump curve \u2014 ' + (p.tag || p.id),
          message: 'Generated from H = H\u2080 \u2212 a\u00b7Q^b, 0\u2013150% of design flow.',
          rows: lines,
          prepend: built ? built.svg : null
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
                 : p.kind === 'equip' ? 'Equipment'
                 : p.kind === 'sensor' ? 'Sensor' : 'Valve';
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
  /* ============================================ L1: PUMP
   *
   * Michael's structure, 2026-08-06 — the same five sections every device gets:
   *
   *   DETAILS  what it is        DESIGN  what it was sized for
   *   ACTUAL   what it is doing  CONTROL what it follows
   *   DISPLAY  what it writes on the drawing
   *
   * The order is deliberate and fixed: the panel must not rearrange itself
   * between one device and the next, or the eye has to re-find everything each
   * time you click.
   */
  function renderPumpProps(host, p) {
    var m = app.model, d = m.settings.display;
    var h3 = el('h3', '', 'Pump ' + (p.tag || p.id));
    infoMark(h3, PUMP_INFO);
    host.appendChild(h3);

    // ---------------------------------------------------------- L2 DETAILS
    var det = section(host, 'Details');
    idRow(det, p);
    tagField(det.box, p);
    tagVisibleRow(det.box, p);
    flipField(det.box, p);
    onlineToggle(det.box, p.pump.mode !== 'off', function (on) {
      pushUndo();
      /* Turning a pump back ON restores the mode ITS SIZING implies. It used
       * to switch every pump to 'auto' and re-size it, so isolating a
       * manually-sized pump and putting it back threw the duty away —
       * Michael, 2026-08-06. */
      p.pump.mode = on ? M.pumpRunMode(p) : 'off';
      if (on && M.pumpSizing(p) === 'auto') autoSizePump(p);
      renderProperties(); changed();
    }, 'Offline is modelled as ISOLATED — no flow passes through it at all. ' +
       'Without that, a running pump short-circuits backwards through its idle ' +
       'neighbours.');

    // ----------------------------------------------------------- L2 DESIGN
    var dp = pumpDesignPoint(p);
    var des = section(host, 'Design');

    /* HOW THE DUTY IS ARRIVED AT. Three ways, and the difference is only WHERE
     * the numbers come from — the curve is generated the same way in the first
     * two:
     *
     *   AUTO    the solve sizes the pump, and the curve follows from the duty
     *           it lands on. Nothing to type.
     *   MANUAL  you state the design flow and pressure; the curve follows.
     *   CURVE   you paste a manufacturer's curve and neither is derived.
     */
    if (!p.pump.sizing) p.pump.sizing = M.pumpSizing(p);
    var sizeSel = el('select');
    [['auto', 'Auto'], ['manual', 'Manual'], ['curve', 'Curve']].forEach(function (o) {
      var opt = el('option', '', o[1]); opt.value = o[0];
      if (o[0] === p.pump.sizing) opt.selected = true;
      sizeSel.appendChild(opt);
    });
    field(des.box, 'Sizing', sizeSel);
    infoMark(fieldLabel(sizeSel),
             'Auto: the solve sizes it. Manual: you state the duty. Curve: you ' +
             'paste a manufacturer curve. Auto and Manual generate a curve from ' +
             'the design point so the model can be simulated.');
    sizeSel.addEventListener('change', function () {
      pushUndo();
      p.pump.sizing = sizeSel.value;
      if (p.pump.mode !== 'off') p.pump.mode = M.pumpRunMode(p);
      if (p.pump.sizing === 'auto') autoSizePump(p);
      regenerateCurve(p);
      renderProperties(); changed();
    });

    /* THE DUTY IS ALWAYS TWO BOXES, whichever sizing mode is on — editable on
     * Manual, shown but not yours to type on Auto and Curve (Michael,
     * 2026-08-06). Hiding them made the panel change height and shuffle
     * everything below it every time the dropdown moved, and left you unable to
     * read the duty the sizer had chosen without switching to Manual. */
    var manual = (p.pump.sizing === 'manual');
    var mq = el('input'); mq.type = 'text';
    mq.value = dp.q === null ? '' : FD.units.fmtFlow(dp.q, d.flow);
    if (!manual) mq.readOnly = true;
    field(des.box, 'Design flow (' + d.flow + ')', mq)
      .addEventListener('change', function () {
        if (!manual) return;
        var v = FD.units.parse(mq.value);
        if (!(isFinite(v) && v > 0)) { renderProperties(); return; }
        pushUndo();
        p.pump.qDesign = FD.units.toSIFlow(v, d.flow);
        regenerateCurve(p); renderProperties(); changed();
      });

    var mh = el('input'); mh.type = 'text';
    mh.value = dp.h === null ? '' : FD.units.fmtPressure(headToPa(dp.h), d.pressure);
    if (!manual) mh.readOnly = true;
    field(des.box, 'Design pressure (' + d.pressure + ')', mh)
      .addEventListener('change', function () {
        if (!manual) return;
        var v = FD.units.parse(mh.value);
        if (!(isFinite(v) && v > 0)) { renderProperties(); return; }
        pushUndo();
        var pa = FD.units.toSIPressure(v, d.pressure);
        p.pump.head = pa / (m.settings.fluid.density * 9.81);
        p.pump.hDesign = p.pump.head;
        regenerateCurve(p); renderProperties(); changed();
      });

    if (dp.h !== null) des.ro('Design head', dp.h.toFixed(2) + ' m');
    /* The safety factor is a SELECTION margin, not part of the hydraulics.
     * Baking it into the solve made a 10% margin push 21 L/s through equipment
     * rated for 20, so it is reported here instead. */
    var pct = m.settings.pumpSafetyPct || 0;
    if (pct && dp.h !== null) {
      var dutyH = dp.h * (1 + pct / 100);
      des.ro('Select against (+' + pct + '%)',
             FD.units.fmtPressure(headToPa(dutyH), d.pressure, true) +
             '  (' + dutyH.toFixed(2) + ' m)');
    }
    /* A pump's design duty read as a resistance, so it can be compared with the
     * terminals it is feeding on the same basis. */
    designKRow(des, dp.q, dp.h === null ? 0 : headToPa(dp.h));

    if (p.pump.sizing === 'auto') {
      var rrow = el('div', 'btn-row');
      var rbtn = el('button', 'btn', 'Re-size');
      if (m.settings.calcMode === 'simulation') {
        rbtn.disabled = true;
        rbtn.title = 'Sizing is a DESIGN operation — in SIMULATION the curve ' +
                     'decides the operating point.';
      }
      rbtn.addEventListener('click', function () {
        pushUndo(); autoSizePump(p); regenerateCurve(p);
        renderProperties(); changed();
      });
      rrow.appendChild(rbtn);
      des.box.appendChild(rrow);
    }
    /* The curve is the INPUT to SIMULATION, so it has to be enterable in
     * DESIGN. Gating it behind SIMULATION created a deadlock: you could not
     * reach SIMULATION without a curve, and could not add a curve without
     * being in SIMULATION. It stays reachable on an OFF pump for the same
     * reason — the deadlock would just move. */
    pumpCurveButtons(des.box, p);

    // ----------------------------------------------------------- L2 ACTUAL
    pumpActualSection(host, p);

    // ---------------------------------------------------------- L2 CONTROL
    controlField(host, p);

    /* NO CONTROL LINK? THEN THE SPEED IS YOURS TO SET. Michael, 2026-08-08.
     * A pump with nothing to follow ran at whatever `speed` happened to hold,
     * and the only way to change it was to type into the model by hand. With a
     * link the position is an OUTPUT and the slider would be a lie, so it is
     * offered only when there is nothing writing it — the same rule the control
     * valve's position follows. */
    if (!M.controlOf(p) && p.pump.mode !== 'off') {
      var spSec = section(host, 'Speed');
      var sim = m.settings.calcMode === 'simulation';
      pctSlider(spSec.box, 'VFD speed (%)',
                Math.round((Number(p.pump.speed) > 0 ? Number(p.pump.speed) : 1) * 100),
                function (n) {
                  pushUndo();
                  p.pump.speed = Math.max(0.01, n / 100);
                  changed(); renderProperties();
                },
                sim ? null
                    : 'Speed applies in SIMULATION only. In DESIGN the demands ' +
                      'impose the flow, so slowing the pump cannot reduce it.');
    }

    // ---------------------------------------------------------- L2 DISPLAY
    displayChecks(host, p, [
      { key: 'tag', label: 'Tag' }, { key: 'flow', label: 'Flow' },
      { key: 'head', label: 'Pressure' }, { key: 'vfd', label: 'VFD %' }
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
  /* A CURVE FROM THE DESIGN POINT.
   *
   * SIMULATION needs a curve, and until now the only way to get one was to go
   * to TOOLS, retype the duty, and paste the result back — for a duty the app
   * had just calculated. Michael, 2026-08-05.
   *
   * Three points, the shape the TOOLS generator has always used and the one the
   * NFPA 20 worked example follows: shutoff at 140% of duty head, the duty
   * point itself, and 65% of duty head at 150% of duty flow. They are then
   * FITTED to H = H0 − a·Q^b, which is the form the solver consumes, so the
   * curve behaves exactly like a pasted one.
   *
   * It is NOT a substitute for a manufacturer's curve and the panel says so.
   * But it is a great deal better than being unable to simulate at all, and a
   * generated curve that passes through the duty point is right about the one
   * thing the model actually knows. */
  /* The generation itself is `M.generateCurve` — the SIZER calls it too, and
   * two copies of the shape would drift. This only supplies the design point
   * the panel is showing, which on an auto pump that has not been solved yet
   * comes from the last results rather than from the pump. */
  function regenerateCurve(p) {
    if (!p || !p.pump) return null;
    if (M.pumpSizing(p) === 'curve') return p.pump.curve || null;
    var dp = pumpDesignPoint(p);
    if (!(p.pump.qDesign > 0) && dp.q > 0) p.pump.qDesign = dp.q;
    if (!(p.pump.hDesign > 0) && dp.h > 0) p.pump.hDesign = dp.h;
    return M.generateCurve(app.model, p);
  }

  /* What travels when properties are copied. Everything a device IS, and
   * nothing about where it sits. */
  var PROP_KEYS = {
    pipe:   ['size', 'schedule', 'C', 'insulation_mm'],
    pump:   ['pump'],
    valve:  ['valve'],
    equip:  ['equip'],
    sensor: ['sensor']
  };

  function selectedPipe() {
    var sel = app.view.selection || [];
    if (sel.length !== 1 || sel[0].kind !== 'pipe') return null;
    return M.pipe(app.model, sel[0].id);
  }

  function copyProps() {
    var p = selectedPipe();
    if (!p) { toast('Select one pipe or device to copy from.', 'error'); return; }
    var keys = PROP_KEYS.pipe.concat(PROP_KEYS[p.kind] || []);
    var out = { kind: p.kind };
    keys.forEach(function (k) {
      if (p[k] !== undefined) out[k] = JSON.parse(JSON.stringify(p[k]));
    });
    /* A control LINK points at one specific machine, so it is not a property
     * of the device — it is a relationship on the drawing. */
    ['pump', 'valve'].forEach(function (k) { if (out[k]) delete out[k].control; });
    app.propClipboard = out;
    toast('Copied ' + (p.tag || p.id) + ' properties.');
  }

  function pasteProps() {
    var src = app.propClipboard;
    if (!src) { toast('Nothing copied yet.', 'error'); return; }
    var sel = (app.view.selection || []).filter(function (x) { return x.kind === 'pipe'; });
    if (!sel.length) { toast('Select the pipes to paste onto.', 'error'); return; }
    pushUndo();
    var n = 0;
    sel.forEach(function (s2) {
      var p = M.pipe(app.model, s2.id);
      if (!p) return;
      PROP_KEYS.pipe.forEach(function (k) {
        if (src[k] !== undefined) p[k] = src[k];
      });
      /* Device properties only land on the same KIND of device. Pasting a
       * pump's curve onto a valve is not a thing anyone means. */
      if (src.kind === p.kind) {
        (PROP_KEYS[p.kind] || []).forEach(function (k) {
          if (src[k] !== undefined) {
            var copy = JSON.parse(JSON.stringify(src[k]));
            if (p[k] && p[k].control) copy.control = p[k].control;   // keep its own link
            p[k] = copy;
          }
        });
      }
      n++;
    });
    renderProperties(); changed();
    toast('Pasted onto ' + n + ' item' + (n === 1 ? '' : 's') + '.');
  }

  /* Rebuild every generated curve after the shape changes. A PASTED curve is
   * left alone — the setting describes what the app generates, not what a
   * manufacturer published. */
  function regenerateAllCurves() {
    var m = app.model, n = 0;
    m.pipes.forEach(function (p) {
      if (p.kind !== 'pump' || !p.pump) return;
      if (M.pumpSizing(p) === 'curve') return;
      if (p.pump.curve && p.pump.curve.source === 'fitted') return;
      if (regenerateCurve(p)) n++;
    });
    redrawAll();
    if (n) toast('Regenerated ' + n + ' pump curve' + (n === 1 ? '' : 's') + '.');
  }

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
      tagVisibleRow(host, n);
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
        { key: 'available', label: 'Available pressure' },
        { key: 'temperature', label: 'Temperature' }
      ]);
    } else if (dev && dev.kind === 'source') {
      displayChecks(host, n, [
        { key: 'elevation', label: 'Elevation' },
        { key: 'available', label: 'Pressure' },
        { key: 'temperature', label: 'Temperature' }
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

    /* THE SHAPE OF A GENERATED CURVE. Three percentages of the duty point,
     * because how peaked a curve is changes where a VSD lands and how a
     * parallel set shares — and the defaults are a representative shape rather
     * than anyone's product. */
    host.appendChild(el('h2', '', 'Generated pump curve'));
    var gpc = group2();
    var pc = m.settings.pumpCurve || (m.settings.pumpCurve =
      { shutoffPct: 140, runoutFlowPct: 150, runoutHeadPct: 65 });
    num(gpc, 'Shutoff head (% of duty)', pc.shutoffPct, function (v) {
      pc.shutoffPct = Math.max(101, Math.min(250, v)); regenerateAllCurves();
    }, '1');
    num(gpc, 'Runout flow (% of duty)', pc.runoutFlowPct, function (v) {
      pc.runoutFlowPct = Math.max(101, Math.min(300, v)); regenerateAllCurves();
    }, '1');
    num(gpc, 'Runout head (% of duty)', pc.runoutHeadPct, function (v) {
      pc.runoutHeadPct = Math.max(1, Math.min(99, v)); regenerateAllCurves();
    }, '1');
    var pch = el('p', 'hint',
      'Applies to pumps sized Auto or Manual. ');
    infoMark(pch, 'A representative shape, not manufacturer data. The defaults ' +
                  '(140 / 150 / 65) are the ones the TOOLS generator uses and ' +
                  'the NFPA 20 worked example follows. A pasted curve is not ' +
                  'touched.');
    host.appendChild(pch);

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
    /* Michael, 2026-08-09: the control-link nodes and the cross-floor riser
     * were hard to hit. Measured in GRID SQUARES so the target holds its size
     * relative to the drawing instead of shrinking with the zoom. */
    num(g4, 'Annotation handle size (grids)',
        m.settings.pickGrid === undefined ? 0.5 : m.settings.pickGrid,
        function (v) {
          m.settings.pickGrid = Math.max(0.1, Math.min(2, v));
          redrawAll();
        }, '0.1');

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

  /* ============================================================= THERMAL
   *
   * Everything that decides a TEMPERATURE, where HYDRAULIC decides a pressure.
   * The split is Michael's (v0.10.0) and it is the same split the engine
   * already had: FD.network solves flow, FD.thermal then carries temperature
   * along it. Fluid PROPERTIES stay on HYDRAULIC — they set density, which is
   * a hydraulic quantity — and the Cp that follows from the chosen fluid is
   * echoed here, read-only, so the number driving Q = ṁ·Cp·ΔT is visible on
   * the tab that uses it.
   */
  function renderThermal() {
    var m = app.model, host = $('thermal-body');
    if (!host) return;
    host.innerHTML = '';

    function h2(t) { host.appendChild(el('h2', '', t)); }
    function hint(t) { host.appendChild(el('p', 'hint', t)); }
    function grid() { var g = el('div', 'settings-grid'); host.appendChild(g); return g; }

    function numField(g, label, value, onChange, suffix) {
      var f = el('div', 'field');
      f.appendChild(el('label', '', label + (suffix ? '  ' + suffix : '')));
      var i = el('input'); i.type = 'text'; i.value = value;
      i.addEventListener('change', function () {
        var v = FD.units.parse(i.value);
        if (isFinite(v)) { pushUndo(); onChange(v); } else { i.value = value; }
      });
      f.appendChild(i); g.appendChild(f);
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

    var th = m.settings.thermal;
    var fluid = FD.fluids.resolve(m.settings);

    // ------------------------------------------------- 1. sign convention
    var sh = el('h2', '', 'Sign');
    infoMark(sh, 'Q is about the fluid. −Q removes heat from it (chiller, hot ' +
                 'pipe losing). +Q adds heat to it (boiler, CHW coil).');
    host.appendChild(sh);
    host.appendChild(el('p', 'hint', '−Q removes heat from the fluid · +Q adds it. ' +
                                     'A CHW coil is +.'));

    // ------------------------------------------------- 2. fluid (read-only)
    var fh = el('h2', '', 'Fluid');
    infoMark(fh, 'Set on HYDRAULIC — the same properties drive density. Shown ' +
                 'here for Cp.');
    host.appendChild(fh);
    var fb = readoutBox(host, null);
    fb.ro('Fluid', fluid.name);
    fb.ro('Specific heat', fluid.specificHeat.toFixed(0) + ' J/(kg·K)');
    fb.ro('Density', fluid.density.toFixed(1) + ' kg/m³');
    fb.ro('Properties quoted at', fluid.refTemp.toFixed(1) + ' °C');
    if (!fluid.verified) {
      var fw = el('div', 'notice warn-notice');
      var fp = el('p', '', fluid.name + ': properties unverified. Check before issue.');
      infoMark(fp, 'Not transcribed from a printed table. Cp scales every duty ' +
                   'linearly — 5% out on Cp is 5% out on every kW.');
      fw.appendChild(fp);
      host.appendChild(fw);
    }

    // ------------------------------------------------- 3. parameters
    h2('Conditions');
    var g1 = grid();
    numField(g1, 'Ambient air temperature', th.ambient,
      function (v) { m.settings.thermal.ambient = v; renderThermal(); redrawAll(); },
      '(°C)');
    numField(g1, 'Source Water Temperature', th.supplyTemp,
      function (v) { m.settings.thermal.supplyTemp = v; renderThermal(); redrawAll(); },
      '(°C)');
    var ch = el('p', 'hint', 'Flow temperature is the reference. ');
    infoMark(ch, 'A source without its own temperature holds it. A sealed ' +
                 'circuit — no source, no ambient exchange — has it pinned at ' +
                 'the outlet of whatever moves the most heat.');
    host.appendChild(ch);

    h2('Insulation');
    var g2 = grid();
    numField(g2, 'Thermal conductivity', th.insulationK,
      function (v) { m.settings.thermal.insulationK = v; renderThermal(); redrawAll(); },
      '(W/m·K)');
    numField(g2, 'Outside surface coefficient', th.surfaceCoeff,
      function (v) { m.settings.thermal.surfaceCoeff = v; renderThermal(); redrawAll(); },
      '(W/m²·K)');
    var ah = el('p', 'hint', 'h = 0 means adiabatic. ');
    infoMark(ah, 'No exchange with the room at all — the only way to say that, ' +
                 'and what makes a sealed circuit need a pinned reference.');
    host.appendChild(ah);

    h2('Plausibility band');
    var g3 = grid();
    numField(g3, 'Minimum temperature', th.tempMin,
      function (v) { m.settings.thermal.tempMin = v; renderThermal(); redrawAll(); },
      '(°C)');
    numField(g3, 'Maximum temperature', th.tempMax,
      function (v) { m.settings.thermal.tempMax = v; renderThermal(); redrawAll(); },
      '(°C)');
    var pb = el('p', 'hint', 'Outside the band is an error, not a printed value. ');
    infoMark(pb, 'The solve is exact — but a load with nowhere to go settles ' +
                 'somewhere ridiculous, which is about the design, not the ' +
                 'arithmetic.');
    host.appendChild(pb);
    if ((th.tempMax || 0) <= 60) {
      host.appendChild(el('p', 'hint', 'Suits chilled water. LTHW at 80 °C ' +
                                       'flow will trip it — raise the maximum.'));
    }
    /* SETPOINT CONTROL. Terse, per §17A: three fields, one hint line, the rest
     * behind the 🛈. */
    h2('Setpoint control');
    var ctl = m.settings.control || (m.settings.control =
      { minSpeed: 0.25, minOpening: 10, tol: 0.05 });
    var g4 = grid();
    numField(g4, 'Minimum pump speed', Math.round((ctl.minSpeed || 0.25) * 100),
      function (v) {
        m.settings.control.minSpeed = Math.min(100, Math.max(1, v)) / 100;
        renderThermal(); redrawAll();
      }, '(%)');
    numField(g4, 'Minimum valve opening', ctl.minOpening,
      function (v) {
        m.settings.control.minOpening = Math.min(100, Math.max(1, v));
        renderThermal(); redrawAll();
      }, '(%)');
    numField(g4, 'Deadband', ctl.tol,
      function (v) { m.settings.control.tol = v; renderThermal(); redrawAll(); },
      '(K)');
    numField(g4, 'Max control solves', ctl.maxSolves || 0,
      function (v) {
        m.settings.control.maxSolves = Math.max(0, Math.round(v));
        renderThermal(); redrawAll();
      }, '(0 = auto)');
    var ch = el('p', 'hint', 'SIMULATION only. Sitting on a minimum is reported. ');
    infoMark(ch, 'In DESIGN the flows are imposed by the demands, so there is ' +
                 'nothing for a controller to move. Max control solves is how ' +
                 'much work the loop may do: automatic is 40 + 30 per ' +
                 'controlled device, capped at 400, and one solve is a few ' +
                 'milliseconds on a model of a few dozen pipes.');
    host.appendChild(ch);

    var uh = el('p', 'hint', 'U′ = 1 / [ ln(r₀/rᵢ)/(2πk) + 1/(2πr₀h) ]. ');
    infoMark(uh, 'Insulation and outside film in series. rᵢ is the pipe OD — ' +
                 'insulation wraps the outside, not the bore.');
    host.appendChild(uh);

    /* THICKNESS lives on the schedule, not here (v0.10.1). It is a physical
     * property of the pipe alongside bore and outside diameter, and having it
     * in a table of its own meant looking in two places for one pipe. */
    var th2 = el('p', 'hint', 'Thickness: HYDRAULIC ▸ schedule table. ');
    infoMark(th2, '25 mm below DN50, 50 mm from DN50 up. Any pipe overrides ' +
                  'it, including 0 for bare.');
    host.appendChild(th2);

    var hw = el('div', 'notice warn-notice');
    var hp = el('p', '', 'Surface coefficient is a default, not sourced. ');
    infoMark(hp, 'On a bare pipe it is the ENTIRE resistance, so the answer is ' +
                 'only as good as this number.');
    hw.appendChild(hp);
    host.appendChild(hw);

    /* What the current schedule's thicknesses actually cost, so the two
     * numbers above can be seen doing something. */
    var allS = FD.schedules.all(m.customSchedules);
    var curS = allS[m.settings.schedule] || allS[Object.keys(allS)[0]];
    var tbl = el('table', 'sheet');
    tbl.innerHTML = '<thead><tr><th class="txt">' + curS.name + '</th>' +
                    '<th>Insulation (mm)</th><th>Loss (W/m·K)</th></tr></thead>';
    var tb = el('tbody');
    curS.sizes.forEach(function (sz) {
      var nominal = FD.schedules.nominalMm ? FD.schedules.nominalMm(sz.label) : 0;
      var t = FD.schedules.insulationFor(m.settings.schedule, sz.label, nominal,
                                         m.settings.insulation);
      var od = (sz.od_mm || sz.id_mm) / 1000;
      var tr = el('tr');
      tr.appendChild(el('td', 'txt', sz.label));
      tr.appendChild(el('td', '', t.toFixed(0)));
      tr.appendChild(el('td', 'dim', od > 0
        ? FD.thermal.lossPerMetreK(od, t / 1000, th.insulationK, th.surfaceCoeff).toFixed(3)
        : '—'));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    host.appendChild(tbl);

    // ------------------------------------------------- 4. what it found
    var res = app.results;
    if (res && res.thermal) {
      h2('Last solve');
      var t2 = res.thermal;
      var rb = readoutBox(host, null);
      var d = m.settings.display;
      rb.ro('Temperature range', t2.totals.min === null ? '—'
        : t2.totals.min.toFixed(2) + ' … ' + t2.totals.max.toFixed(2) + ' °C');
      rb.ro('Equipment duty', (t2.totals.equipDuty / 1000).toFixed(2) + ' kW');
      rb.ro('Pipe gain / loss', (t2.totals.pipeLoss / 1000).toFixed(3) + ' kW');
      /* At steady state everything in comes out. Reported because it is the
       * one number that says the answer is finished — and on a system with no
       * heat rejection, where the loop finds its own level against ambient, it
       * IS the statement being solved. */
      rb.ro('Energy balance', Math.abs(t2.imbalance) < 1
        ? 'closes' : (t2.imbalance / 1000).toFixed(3) + ' kW out');
      if (t2.floating) {
        rb.ro('Reference', 'ambient — the system finds its own level');
      }
      void d;
      if (t2.pinned) {
        host.appendChild(el('p', 'hint',
          'No source, so ' + th.supplyTemp.toFixed(1) + ' °C was pinned at ' +
          t2.pinned.node + ', the outlet of ' + t2.pinned.pipe + '. Every other ' +
          'temperature is relative to that.'));
      }
    } else {
      hint('Nothing solved yet, or nothing is flowing.');
    }
  }

  function renderHydraulic() {
    var m = app.model, host = $('hydraulic-body');
    host.innerHTML = '';

    /* Lengths in this tab follow the model's display unit. Metric is the model
     * and the stored value; imperial is a conversion at the edge, so the feet
     * shown are a conversion of the stored metres and NOT the source's own feet
     * column — the two are independent roundings of each other in the printed
     * table (13 ft is printed as 4 m). */
    var lenUnit = (m.settings.display && m.settings.display.length) || 'm';
    var lenUnitName = lenUnit;
    function fmtLen(si) {
      if (si === null || si === undefined || si === '') return '';
      var v = FD.units.length(Number(si), lenUnit);
      /* Up to 3 dp, trailing zeros stripped: the printed metric column needs
       * one, an edited value may need more, and 0.300 reads as false
       * precision. */
      return String(Math.round(v * 1000) / 1000);
    }
    function toLenSI(v) { return FD.units.toSILength(Number(v), lenUnit); }

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
    var fPreset = (m.settings.fluid && m.settings.fluid.preset) || 'water';
    var fDef = FD.fluids.get(fPreset);
    var fEditable = FD.fluids.isEditable(fPreset);

    var fg = grid();
    selField(fg, 'Fluid',
      FD.fluids.keys().map(function (k) { return [k, FD.fluids.get(k).name]; }),
      fPreset, function (v) {
        pushUndo(); M.applyFluidPreset(m, v);
        renderHydraulic(); redrawAll();
      });

    /* A named fluid's properties are READ-ONLY. Typing over them would leave
     * the sheet naming "20% Propylene Glycol" beside numbers that are not that
     * fluid's — the same reason the published equivalent-length tables are
     * locked. Custom is the way to enter your own. */
    function fluidField(label, key, suffix, dp) {
      var f = el('div', 'field');
      f.appendChild(el('label', '', label + (suffix ? '  ' + suffix : '')));
      var v = m.settings.fluid[key];
      if (!fEditable) {
        var ro = el('div', 'locked-value',
          dp !== undefined ? Number(v).toFixed(dp) : String(v));
        f.appendChild(ro);
      } else {
        var i = el('input'); i.type = 'text'; i.value = v;
        i.addEventListener('change', function () {
          var nv = FD.units.parse(i.value);
          if (isFinite(nv) && nv > 0) {
            pushUndo(); m.settings.fluid[key] = nv; renderHydraulic(); redrawAll();
          } else { i.value = v; }
        });
        f.appendChild(i);
      }
      fg.appendChild(f);
    }
    fluidField('Density ρ', 'density', '(kg/m³)', 1);
    fluidField('Kinematic viscosity ν', 'kinematicViscosity', '(m²/s)');
    fluidField('Specific heat capacity Cp', 'specificHeat', '(J/kg·K)', 0);
    fluidField('Properties quoted at', 'temperature', '(°C)', 1);

    if (!fEditable) hint('Read-only. Choose Custom to enter your own.');
    if (fDef.verified === false) {
      var fnote = el('div', 'notice warn-notice');
      var fnp = el('p', '', fDef.name + ': properties unverified. Check before issue. ');
      infoMark(fnp, fDef.source + ' Cp scales every thermal duty linearly.');
      fnote.appendChild(fnp);
      host.appendChild(fnote);
    }

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
    usage.appendChild(el('li', '',
      'Specific heat capacity — used: it is what Q = ṁ·Cp·ΔT runs on. See the ' +
      'THERMAL tab.'));
    usage.appendChild(el('li', 'unused',
      'Temperature — the temperature the three properties above are QUOTED at, ' +
      'not a result and not a driver. Nothing recalculates density or viscosity ' +
      'from it, so a glycol circuit run at 6 °C is being given 20 °C properties.'));
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
    /* Built from the method registry, not hand-listed.
     *
     * The hand-written list held HW and DW only, while the DEFAULT method is
     * ASHRAE — so a new model showed "Hazen-Williams" in a box that was
     * actually set to ASHRAE, and picking either option was a one-way door with
     * no route back. Both faults come from restating in the UI something the
     * engine already knows. */
    selField(mg, 'Calculation method',
      Object.keys(FD.hydraulics.methods)
        .filter(function (k2) { return FD.hydraulics.methods[k2].available !== false; })
        .map(function (k2) { return [k2, FD.hydraulics.methods[k2].name]; }),
      m.settings.frictionMethod, function (v) {
        pushUndo(); m.settings.frictionMethod = v; renderHydraulic(); redrawAll();
      });

    // ---- the formula, with the coefficients editable in place ----
    var fbox = el('div', 'formula-box');
    var eq = el('div', 'formula-eq');

    if (!isDW) {
      /* Shown in ASHRAE's own VELOCITY form, with the printed constants
       * editable, so an engineer spot-checking against Ch 22 Eq (6) sees the
       * numbers that are on the page rather than a flow-form rearrangement.
       * The solver derives its coefficients from these — see
       * hydraulics.methods.HW.derive — so editing them here really does
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

      /* No second line. This method charges fittings as EQUIVALENT LENGTH —
       * they enter through L, not as a separate velocity-head term — so the
       * "+ Σ K·V²/2g" that used to sit here belonged to a different method. */
      var legA = el('div', 'formula-legend');
      var der = FD.hydraulics.methods.HW.derive({ ashrae: ka });
      legA.innerHTML =
        '<b>Δh</b> head loss (m) &nbsp;·&nbsp; <b>L</b> effective length (m), ' +
        'drawn length plus fitting equivalent lengths &nbsp;·&nbsp; ' +
        '<b>V</b> velocity (m/s) &nbsp;·&nbsp; <b>C</b> roughness coefficient &nbsp;·&nbsp; ' +
        '<b>D</b> inner diameter (m)<br>' +
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
    /* The ACTIVE schedule's own size data, not a list of schedules.
     *
     * The list told you a schedule existed and how many sizes it had, which is
     * not a question anyone asks. What an engineer wants is the pipe: its bore,
     * its outside diameter, and what it is lagged with. Insulation lives here
     * (v0.10.1) because it is a physical property of the pipe alongside those
     * two, and having it in a table of its own meant looking in two places for
     * one pipe. */
    h2('Pipe schedule');
    var all = FD.schedules.all(m.customSchedules);
    var curKey = all[m.settings.schedule] ? m.settings.schedule
                                          : Object.keys(all)[0];
    var cur = all[curKey];
    var isCustom = !!(m.customSchedules && m.customSchedules[curKey]);

    var schGrid = grid();
    selField(schGrid, 'Current schedule',
      Object.keys(all).map(function (kk) { return [kk, all[kk].name]; }),
      curKey, function (v) {
        pushUndo(); m.settings.schedule = v; renderHydraulic(); redrawAll();
      });
    numField(schGrid, 'Default C factor', m.settings.C,
      function (v) { pushUndo(); m.settings.C = v; redrawAll(); });

    var schBtns = el('div', 'btn-row');
    var addSch = el('button', 'btn', 'Add Custom Schedule');
    addSch.addEventListener('click', function () { editSchedule(null); });
    schBtns.appendChild(addSch);

    var copySch = el('button', 'btn', 'Copy Current Schedule');
    copySch.title = 'Start a new custom schedule from ' + cur.name +
                    ', so the sizes are there to edit rather than to retype.';
    copySch.addEventListener('click', function () { editSchedule(null, curKey); });
    schBtns.appendChild(copySch);

    if (isCustom) {
      var edSch = el('button', 'btn', 'Edit sizes');
      edSch.addEventListener('click', function () { editSchedule(curKey); });
      schBtns.appendChild(edSch);
      var rmSch = el('button', 'btn danger', 'Delete');
      rmSch.style.marginTop = '0';
      rmSch.addEventListener('click', function () { deleteSchedule(curKey); });
      schBtns.appendChild(rmSch);
    }
    host.appendChild(schBtns);

    /* Everything except INSULATION is read-only. Bore and outside diameter are
     * the published dimensions of a standard pipe — typing over them would
     * leave the sheet naming "ASME Schedule 40" beside numbers that are not
     * schedule 40. Copy the schedule to change them. */
    var schWrap = el('div', 'table-scroll');
    var schTable = el('table', 'sheet editable');
    schTable.innerHTML = '<thead><tr><th class="txt">Nominal</th>' +
                         '<th>Inside dia (mm)</th><th>Outside dia (mm)</th>' +
                         '<th>Wall (mm)</th><th>Insulation (mm)</th></tr></thead>';
    var schBody = el('tbody');
    cur.sizes.forEach(function (sz) {
      var nominal = FD.schedules.nominalMm ? FD.schedules.nominalMm(sz.label) : 0;
      var tr = el('tr');
      tr.appendChild(el('td', 'txt', sz.label));
      tr.appendChild(el('td', '', sz.id_mm.toFixed(2)));
      tr.appendChild(el('td', '', sz.od_mm ? sz.od_mm.toFixed(2) : '—'));
      tr.appendChild(el('td', 'dim', sz.od_mm
        ? ((sz.od_mm - sz.id_mm) / 2).toFixed(2) : '—'));

      var td = el('td');
      var ovRow = m.settings.insulation[curKey] || {};
      var stored = ovRow[sz.label];
      var deflt = FD.schedules.defaultInsulation(nominal);
      var inp = el('input', 'cell-input'); inp.type = 'text';
      inp.value = (stored === undefined || stored === null || stored === '')
        ? '' : stored;
      inp.placeholder = deflt.toFixed(0);
      if (stored !== undefined && stored !== null && stored !== '') {
        td.className = 'edited';
        inp.title = 'Edited. The default for this size is ' + deflt + ' mm.';
      }
      inp.addEventListener('change', function () {
        var raw = inp.value.trim();
        pushUndo();
        if (!m.settings.insulation[curKey]) m.settings.insulation[curKey] = {};
        if (raw === '') {
          delete m.settings.insulation[curKey][sz.label];
        } else {
          var v = FD.units.parse(raw);
          if (!isFinite(v) || v < 0) { renderHydraulic(); return; }
          m.settings.insulation[curKey][sz.label] = v;
        }
        renderHydraulic(); redrawAll();
      });
      td.appendChild(inp);
      tr.appendChild(td);
      schBody.appendChild(tr);
    });
    schTable.appendChild(schBody);
    schWrap.appendChild(schTable);
    host.appendChild(schWrap);

    var sch1 = el('p', 'hint', 'Insulation is editable; dimensions are not. ');
    infoMark(sch1, 'Blank takes the default: 25 mm below DN50, 50 mm from DN50 ' +
                   'up. A pipe overrides it, including 0 for bare. Copy the ' +
                   'schedule to change dimensions.');
    host.appendChild(sch1);
    host.appendChild(el('p', 'legend',
      'Source: ' + (isCustom ? 'custom schedule.' : cur.name + ', published dimensions.')));
    host.appendChild(el('p', 'legend',
      'Note: Custom schedules are stored in model & browser storage. ' +
      'Recommend to keep an offline copy.'));

    // ------------------------------------------------ fitting data
    /* Only the table the active method actually uses is shown. Displaying both
     * invites entering numbers into the one that is being ignored. */
    if (!usesK) {
      h2('Fitting equivalent lengths');
      hint('Read against NOMINAL size, in ' + lenUnitName + '.');

      var elKey = FD.fittings.elSetKey(m.settings);
      var elSet = FD.fittings.EL_SETS[elKey];

      var esg = grid();
      selField(esg, 'Equivalent length table',
        Object.keys(FD.fittings.EL_SETS).map(function (k2) {
          return [k2, FD.fittings.EL_SETS[k2].name];
        }),
        elKey, function (v) {
          pushUndo();
          /* Switching INTO custom seeds every cell from whatever was showing,
           * so the engineer starts from the numbers they were just looking at
           * rather than an empty grid. Switching back to a published set drops
           * the custom values — they belong to 'custom', and silently applying
           * them on top of a table labelled NFPA 13 would make the source line
           * a lie. */
          if (v === 'custom' && elKey !== 'custom') {
            m.settings.fittingEL = FD.fittings.elSnapshot(elKey);
          } else if (v !== 'custom') {
            m.settings.fittingEL = {};
          }
          m.settings.elSet = v;
          renderHydraulic(); redrawAll();
        });

      var wrapEl = el('div', 'table-scroll');
      var elTable = el('table', 'sheet editable');
      var head = '<thead><tr><th class="txt">Fitting</th>';
      FD.fittings.EL_DN.forEach(function (dn) { head += '<th>DN' + dn + '</th>'; });
      elTable.innerHTML = head + '</tr></thead>';
      var elBody = el('tbody');
      var editable = (elKey === 'custom');

      FD.fittings.elTypes().forEach(function (t) {
        var tr = el('tr');
        /* A row from a source other than the one in the heading carries an
         * asterisk, and the note under the table says which source. A page
         * headed by one source with a row from another has to say so ON the
         * page. */
        var alt = elSet.alt && elSet.alt[t];
        var nameCell = el('td', 'txt', FD.fittings.label(t) + (alt ? ' *' : ''));
        if (alt) nameCell.title = 'Source: ' + alt + ' — not ' + elSet.name + '.';
        tr.appendChild(nameCell);

        var published = FD.fittings.publishedRow(t, elKey);
        FD.fittings.EL_DN.forEach(function (dn, i) {
          var td = el('td');
          var ovRow = m.settings.fittingEL[t] || {};
          var stored = ovRow[dn];
          var pub = published ? published[i] : null;
          var siNow = (stored === undefined || stored === null || stored === '')
            ? pub : Number(stored);

          if (!editable) {
            /* A published table is READ-ONLY. It used to be editable in every
             * mode, which meant a value could be typed over while the line
             * underneath still said "Source: NFPA 13". Choose Custom to change
             * anything. */
            td.appendChild(document.createTextNode(
              (siNow === null || siNow === undefined) ? '—' : fmtLen(siNow)));
            tr.appendChild(td);
            return;
          }

          var inp = el('input', 'cell-input'); inp.type = 'text';
          inp.value = (siNow === null || siNow === undefined) ? '' : fmtLen(siNow);
          inp.addEventListener('change', function () {
            var raw = inp.value.trim();
            pushUndo();
            if (!m.settings.fittingEL[t]) m.settings.fittingEL[t] = {};
            if (raw === '') {
              delete m.settings.fittingEL[t][dn];
            } else {
              var v = FD.units.parse(raw);
              if (!isFinite(v) || v < 0) { renderHydraulic(); return; }
              m.settings.fittingEL[t][dn] = toLenSI(v);
            }
            renderHydraulic(); redrawAll();
          });
          td.appendChild(inp);
          tr.appendChild(td);
        });
        elBody.appendChild(tr);
      });
      elTable.appendChild(elBody);
      wrapEl.appendChild(elTable);
      host.appendChild(wrapEl);

      /* Michael's wording, verbatim, on the set it belongs to. */
      if (elSet.note) {
        host.appendChild(el('p', 'hint source-line', elSet.note));
      }
      host.appendChild(el('p', 'hint source-line', 'Source: ' + elSet.source));

      if (editable) {
        var resetEL = el('button', 'btn', 'Reset to ' +
          FD.fittings.EL_SETS[FD.fittings.DEFAULT_EL_SET].name);
        resetEL.addEventListener('click', function () {
          pushUndo();
          m.settings.fittingEL = FD.fittings.elSnapshot(FD.fittings.DEFAULT_EL_SET);
          renderHydraulic(); redrawAll();
          toast('Custom values reset to ' +
                FD.fittings.EL_SETS[FD.fittings.DEFAULT_EL_SET].name + '.');
        });
        host.appendChild(resetEL);
      }

    } else {
      h2('Fitting Coefficients K');
      hint('ASHRAE (2021) Ch 22 Eq (7): Δp = K·ρ·V²/2, or h = K·V²/2g.');
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
        tr.appendChild(el('td', 'txt', FD.fittings.label(t)));
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
      /* Michael's wording, verbatim. The provenance detail that used to follow
       * it — the ±20/40% range of variation, and the history of the threaded
       * 45° elbow column — lives in data/ktable.js and ARCHITECTURE §7 instead.
       *
       * Worth knowing when reading this line: the values in the app are
       * transcribed from the page Michael supplied on 2026-08-02, which is
       * headed Ch 22 Tables 3 and 4 (p.22.6). The citation here says Tables 1
       * and 2 because that is the wording he asked for. Both are asserted
       * cell-by-cell in engine.test.js against that page. */
      host.appendChild(el('p', 'legend',
        'K source: ASHRAE Handbook — Fundamentals, Pipe Sizing, Table 1 (threaded) ' +
        'and Table 2'));
    }

    // ------------------------------------------------------- warnings
    h2('Warning thresholds');
    var wg = grid();
    numField(wg, 'Max velocity', m.settings.warn.velocity,
      function (v) { pushUndo(); m.settings.warn.velocity = v; redrawAll(); }, '(m/s)');
    numField(wg, 'Max friction rate', m.settings.warn.pdm,
      function (v) { pushUndo(); m.settings.warn.pdm = v; redrawAll(); }, '(Pa/m)');
    numField(wg, 'Equipment flow ratio', m.settings.warn.equipFlowRatio,
      function (v) { pushUndo(); m.settings.warn.equipFlowRatio = v; redrawAll(); },
      '(×rated)');
    numField(wg, 'Heat balance tolerance', m.settings.warn.heatBalance,
      function (v) { pushUndo(); m.settings.warn.heatBalance = v; redrawAll(); },
      '(%)');
    numField(wg, 'Min control valve opening', m.settings.warn.valveOversized,
      function (v) { pushUndo(); m.settings.warn.valveOversized = v; redrawAll(); },
      '(%)');
    numField(wg, 'Max component pressure', (m.settings.warn.maxComponentPD || 0) / 1000,
      function (v) {
        pushUndo(); m.settings.warn.maxComponentPD = v * 1000; redrawAll();
      }, '(kPa)');
    var pl = el('p', 'hint',
      'Past the pressure limit the answer is an ERROR, not a warning. ');
    infoMark(pl, 'The solve is exact — but a component at 1252 bar describes a ' +
                 'system nobody will build, and the usual cause is equipment ' +
                 'carrying far more than its rated flow. 0 disables it.');
    host.appendChild(pl);

    switchRow(host, 'Warn on laminar / transitional flow',
              m.settings.warn.laminar !== false, function (on) {
      pushUndo(); m.settings.warn.laminar = on; redrawAll(); renderHydraulic();
    });
  }

  /* Create or edit a custom schedule. The editable content is a plain
   * "label, inner diameter" list — spec §9 calls those the two governing
   * fields, and everything hydraulic derives from the bore. */
  /* `copyFrom` seeds a NEW custom schedule from an existing one, so "Copy
   * Current Schedule" gives you the sizes to edit rather than to retype. */
  function editSchedule(key, copyFrom) {
    var m = app.model;
    var existing = key ? m.customSchedules[key] : null;
    var seed = existing;
    if (!seed && copyFrom) {
      seed = FD.schedules.all(m.customSchedules)[copyFrom];
    }
    var seedRows = seed
      ? seed.sizes.map(function (z) {
          return z.label + '\t' + z.id_mm +
                 (z.od_mm ? '\t' + z.od_mm : '');
        }).join('\n')
      : '';

    FD.dialog.form({
      title: existing ? 'Edit schedule' : 'New custom schedule',
      ok: existing ? 'Save' : 'Create',
      message: 'Paste three columns straight from a spreadsheet:\n' +
               '    nominal label   ·   inner diameter (mm)   ·   outside diameter (mm)\n\n' +
               'ALL DIAMETERS ARE IN MILLIMETRES. The outside diameter may be left ' +
               'blank, in which case the bore is used — but the thermal module needs ' +
               'it, because insulation wraps the OUTSIDE of the pipe, and leaving it ' +
               'out understates the heat loss. Insulation itself is set in the ' +
               'schedule table on this tab, not here. Tabs, commas or spaced columns ' +
               'all work, and a header row is skipped automatically.',
      fields: [
        { key: 'name', label: 'Schedule name', type: 'text',
          value: existing ? existing.name : 'My schedule' },
        { key: 'C', label: 'Default C factor', type: 'text',
          value: existing ? existing.defaultC : 120 },
        { key: 'sizes', label: 'Sizes  —  label / bore mm / outside dia mm',
          type: 'textarea', rows: 10, value: seedRows,
          placeholder: 'DN15\t16.0\t21.3' }
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
                   'for example:\n\n    DN50    53.0    60.3'
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
    /* `app.uiMode` is the single answer to "where am I", and the buttons are
     * lit from it. This used to light DESIGN/SIMULATE off `calcMode`, which was
     * the same fact told twice — and told differently, since VIEW had to be
     * special-cased out of it.
     *
     * What still has to happen here is the other direction: a calcMode that
     * changed from somewhere else (loading a file, an undo) must move the
     * ribbon, or SIMULATE's tools sit over a design calculation. */
    if (app.model && app.model.settings) {
      var want = app.model.settings.calcMode === 'simulation' ? 'simulate' : 'design';
      /* Only when the current mode DISAGREES about the calculation. CONTROL and
       * ANNOTATION carry no calculation of their own and must not be kicked out
       * of. */
      if (app.uiMode === 'design' || app.uiMode === 'simulate' || !app.uiMode) {
        app.uiMode = want;
      }
    }
    if (app.syncUIMode) app.syncUIMode();
    if (app.syncSimMode) app.syncSimMode();
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

  /* The mode buttons are wired in `initToolbar`, beside the tool sets they
   * switch — one place that knows what a mode is. */
  function initModeChip() {}

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
    /* SELECTION IS NOT AN EDIT — no solve, no save. Clicking a pipe on a model
     * with five control loops was scheduling a fifty-second solve for an answer
     * that cannot have changed. */
    app.view.onSelect = function () {
      renderProperties();
      renderLevels();
    };
    /* ARRANGING THE DRAWING IS NOT CALCULATING IT. A label dragged, a note
     * moved, the TRACE image repositioned, a control leader bent, the model
     * slid onto the grid with ALIGN: all real document changes that must be
     * SAVED, none of which can move a number. So save, do not solve. */
    app.view.onArrange = function () {
      renderProperties();
      renderLevels();
      scheduleSave();
    };
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
        if (t.dataset.pane === 'pane-thermal') renderThermal();
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

    var ctlBtn = $('btn-control-links');
    if (ctlBtn) {
      ctlBtn.classList.toggle('active', app.view.showControl !== false);
      ctlBtn.addEventListener('click', function () {
        app.view.showControl = (app.view.showControl === false);
        ctlBtn.classList.toggle('active', app.view.showControl);
        app.view.render();
      });
    }

    // ---- tools ----
    var toolButtons = [].slice.call(document.querySelectorAll('[data-tool]'));
    function syncToolButtons() {
      toolButtons.forEach(function (o) {
        if (o.dataset.tool === 'disconnect') {
          o.classList.toggle('active', !!app.view.showDisconnects);
          return;
        }
        /* The VARIANT is part of what is active: with one button per valve
         * type, lighting all three whenever the valve tool is on says nothing
         * about which one the next click places. */
        o.classList.toggle('active',
          o.dataset.tool === app.view.tool &&
          (o.dataset.variant || null) === (app.view.toolVariant || null));
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
        /* WHICH KIND, carried on the button. One tool with a variant rather
         * than eight tools, because everything downstream of the click —
         * hit-testing, insertion, the mode hint — is identical whichever
         * equipment or valve or sensor it turns out to be. */
        app.view.toolVariant = b.dataset.variant || null;
        app.view.setTool(b.dataset.tool);
        syncToolButtons();
      });
    });
    var MODE_HINTS = {
      edit:   'Click to select · drag a node to move it · drag a device to slide it along its run (Alt frees it) · Delete removes the selection',
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
      valve:  'Click a pipe to insert a valve into it',
      sensor: 'Click a pipe to place a sensor \u00b7 a differential then needs a second pipe picking',
      link:   'Click a pump or control valve, then the sensor or equipment it should follow',
      detail: 'Click to place vertices \u00b7 Esc finishes \u00b7 click an existing line to erase it \u00b7 these lines are not part of the model',
      text:   'Click to place a note \u00b7 click an existing one to edit it'
    };
    /* A variant makes the hint say WHICH, since the ribbon button is no longer
     * on screen once you have moved the mouse to the drawing. */
    var VARIANT_HINTS = {
      'equip:source':      'Click a pipe to insert a heat source or sink \u00b7 it holds a leaving temperature',
      'equip:exchanger':   'Click a pipe to insert a heat exchanger \u00b7 it states a load',
      'equip:adiabatic':   'Click a pipe to insert a strainer, filter or meter \u00b7 pressure drop only',
      'valve:globe':       'Click a pipe to insert a control valve',
      'valve:gate':        'Click a pipe to insert an isolation valve',
      'valve:check':       'Click a pipe to insert a check valve',
      'sensor:temperature':'Click a pipe to place a temperature sensor',
      'sensor:flow':       'Click a pipe to place a flow sensor',
      'sensor:pressure':   'Click a pipe to place a pressure sensor',
      'sensor:dP':         'Click a pipe to place it, then pick the second pipe to measure against',
      'sensor:dT':         'Click a pipe to place it, then pick the second pipe to measure against'
    };
    /* ============================================== THE FOUR MODES
     *
     * DESIGN draw it · CONTROL wire it up · SIMULATE run it · ANNOTATION
     * arrange it for print. Michael's UI pass, 2026-08-06.
     *
     * A mode is a TOOL PALETTE. Two of them also set the calculation mode,
     * because DESIGN and SIMULATE are genuinely the two questions the drawing
     * answers and it would be strange for the button named SIMULATE not to
     * simulate. CONTROL and ANNOTATION deliberately leave it alone: a control
     * link only does anything in SIMULATION, so forcing CONTROL back to DESIGN
     * would blank every valve position at the moment you went to look at them.
     *
     * Which tool each mode lands on is the one you almost always want first —
     * SELECT everywhere except CONTROL, where you have come to place a sensor
     * but might equally be re-selecting one. */
    var UI_MODES = {
      design:   { calc: 'design',     tool: 'edit' },
      control:  { calc: null,         tool: 'edit' },
      simulate: { calc: 'simulation', tool: 'edit' },
      annotate: { calc: null,         tool: 'view' }
    };
    /* Which mode a tool belongs to, so picking a tool by keyboard or by any
     * other route still moves the ribbon to the set the tool is in. */
    var TOOL_MODE = {
      edit: null, pipe: 'design', riser: 'design', source: 'design',
      demand: 'design', pump: 'design', equip: 'design', valve: 'design',
      sensor: 'control', link: 'control',
      probe: 'simulate',
      view: 'annotate', trace: 'annotate', align: 'annotate',
      detail: 'annotate', text: 'annotate'
    };

    function setUIMode(name, opts) {
      if (!UI_MODES[name]) return;
      app.uiMode = name;
      var def = UI_MODES[name];
      if (def.calc && app.model.settings.calcMode !== def.calc) {
        /* Through setCalcMode, so its guards still apply — a running pump
         * without a curve must still stop the switch to SIMULATION. */
        setCalcMode(def.calc);
        if (app.model.settings.calcMode !== def.calc) {
          /* Refused. Stay where we were rather than showing SIMULATE's tools
           * over a design calculation. */
          app.uiMode = (app.model.settings.calcMode === 'simulation')
            ? 'simulate' : 'design';
          syncUIMode();
          return;
        }
      }
      if (!(opts && opts.keepTool)) app.view.setTool(def.tool);
      syncUIMode();
    }

    function syncUIMode() {
      [].slice.call(document.querySelectorAll('[data-uimode]')).forEach(function (b) {
        b.classList.toggle('active', b.dataset.uimode === app.uiMode);
      });
      [].slice.call(document.querySelectorAll('[data-uiset]')).forEach(function (g) {
        g.hidden = g.dataset.uiset !== app.uiMode;
      });
    }

    function syncToolGroups() {
      /* A tool chosen from anywhere moves the ribbon to the mode it lives in,
       * so the palette and the tool can never disagree about which mode you
       * are in. */
      var want = TOOL_MODE[app.view.tool];
      if (want && want !== app.uiMode) { app.uiMode = want; }
      syncUIMode();
      var group = $('group-tools');
      if (group) group.dataset.group = 'COMMAND';
    }

    [].slice.call(document.querySelectorAll('[data-uimode]')).forEach(function (b) {
      b.addEventListener('click', function () { setUIMode(b.dataset.uimode); });
    });
    /* ============================================ STATIC / DYNAMIC
     *
     * Static is the default and the point of it is performance: on a big model
     * every geometry change costs a full re-solve, and most of the time spent
     * in SIMULATE is spent reading.
     *
     * THIS WIRING WAS LOST between v0.16.0 and v0.16.1 — the buttons shipped
     * with no JavaScript behind them, so neither lit up and clicking DYNAMIC
     * did nothing at all. Michael, 2026-08-09. */
    function syncSimMode() {
      var inSim = app.model.settings.calcMode === 'simulation';
      [].slice.call(document.querySelectorAll('[data-simmode]')).forEach(function (b) {
        b.classList.toggle('active',
          (b.dataset.simmode === 'static') === !!app.view.simStatic);
      });
      /* The panel greys its editable fields to match, so the state is visible
       * where you would try to type rather than only on the ribbon. */
      document.body.classList.toggle('sim-static', app.view.locked());
      var run = $('btn-run-sim');
      if (run) {
        /* RUN SIMULATION only means something in STATIC — in DYNAMIC every edit
         * re-solves already, so a button that re-solves what is already solved
         * would just be a way to wait. */
        run.disabled = !inSim || !app.view.simStatic;
        run.title = run.disabled
          ? 'Not needed here \u2014 in DYNAMIC every edit re-solves as you make it'
          : 'Re-solve the model now';
      }
    }

    [].slice.call(document.querySelectorAll('[data-simmode]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var wasStatic = app.view.simStatic;
        app.view.simStatic = (b.dataset.simmode === 'static');
        syncSimMode();
        renderProperties();
        app.view.render();
        if (wasStatic === app.view.simStatic) return;
        toast(app.view.simStatic
          ? 'STATIC \u2014 the model is locked; use RUN SIMULATION to re-solve.'
          : 'DYNAMIC \u2014 edits re-solve as you make them.');
        /* Leaving STATIC takes a fresh answer, because whatever was changed
         * while locked has not been solved for. */
        if (!app.view.simStatic) scheduleSolve();
      });
    });

    var runBtn = $('btn-run-sim');
    if (runBtn) runBtn.addEventListener('click', function () {
      if (runBtn.disabled) return;
      /* Straight to the solve rather than through the debounce: this is an
       * explicit "go", and waiting 250 ms after a deliberate click reads as the
       * button not having worked. */
      clearTimeout(app.solveTimer);
      solveSliced();
    });

    app.setUIMode = setUIMode;
    app.syncUIMode = syncUIMode;
    app.syncSimMode = syncSimMode;
    if (!app.uiMode) {
      app.uiMode = app.model.settings.calcMode === 'simulation' ? 'simulate' : 'design';
    }
    syncUIMode();
    syncSimMode();

    function refreshToolButtons() {
      syncToolButtons();
      /* ANNOTATIONS is a panel belonging to VIEW, not a sticky mode. Leaving it
       * up after switching to EDIT meant the properties panel showed annotation
       * checkboxes while you were selecting pipework — the panel has to follow
       * the mode you are actually in. */
      app.showAnnotations = false;
      updateModeChip();
      syncToolGroups();
      var hint = VARIANT_HINTS[app.view.tool + ':' + app.view.toolVariant] ||
                 MODE_HINTS[app.view.tool] || '';
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

    /* ===================================================== THE TOOLS WINDOW
     *
     * Q1, Michael: a moveable window with a button in Design, Control and
     * Simulate, rather than a whole tab. A tool answers a question you have
     * WHILE drawing — "what size do I need for 4 L/s?" — and a tab took the
     * drawing off the screen in order to answer it.
     *
     * Position and open state are a UI PREFERENCE, so they live in
     * localStorage, not in the .pnet.json: a model file should not carry
     * someone else's window position any more than it carries their panel
     * width. */
    (function () {
      var win = $('tools-window'), bar = $('tools-drag'), closeBtn = $('tools-close');
      if (!win || !bar) return;

      function place(x, y) {
        var w = win.offsetWidth || 380, h = win.offsetHeight || 300;
        /* Kept on screen. A window dragged off the edge and then reopened at
         * the same place is a window you cannot get back. */
        x = Math.max(4, Math.min(window.innerWidth - Math.min(w, 200) - 4, x));
        y = Math.max(4, Math.min(window.innerHeight - 40, y));
        win.style.left = x + 'px';
        win.style.top = y + 'px';
        try { localStorage.setItem('fpc.toolsPos', JSON.stringify({ x: x, y: y })); }
        catch (e) {}
      }
      try {
        var saved = JSON.parse(localStorage.getItem('fpc.toolsPos') || 'null');
        if (saved && isFinite(saved.x)) { win.style.left = saved.x + 'px'; win.style.top = saved.y + 'px'; }
      } catch (e) {}

      function open(on) {
        win.hidden = !on;
        if (on && FD.tools) FD.tools.render(app);
        [].slice.call(document.querySelectorAll('[data-tools-open]')).forEach(function (b) {
          b.classList.toggle('active', !!on);
        });
        try { localStorage.setItem('fpc.toolsOpen', on ? '1' : '0'); } catch (e) {}
      }
      app.toolsOpen = open;

      [].slice.call(document.querySelectorAll('[data-tools-open]')).forEach(function (b) {
        b.addEventListener('click', function () { open(win.hidden); });
      });
      if (closeBtn) closeBtn.addEventListener('click', function () { open(false); });

      /* Dragged by its bar only, so a click inside a tool cannot move it. */
      var drag = null;
      bar.addEventListener('pointerdown', function (e) {
        if (e.target === closeBtn) return;
        var r = win.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        bar.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      bar.addEventListener('pointermove', function (e) {
        if (!drag) return;
        place(e.clientX - drag.dx, e.clientY - drag.dy);
      });
      bar.addEventListener('pointerup', function () { drag = null; });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !win.hidden &&
            !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) open(false);
      });

      try { if (localStorage.getItem('fpc.toolsOpen') === '1') open(true); } catch (e) {}
    })();

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

    /* ADD A BEND to whatever route the selection carries — a pump or valve's
     * control link, or a differential sensor's. Michael, 2026-08-07: "add a
     * button under annotate to add another node to the lines so the user can
     * arrange as they see fit." A button rather than a double-click on the
     * line, because the line is already covered in drag handles and one more
     * gesture on it would be a guess. */
    var linkNodeBtn = $('btn-link-node');
    if (linkNodeBtn) linkNodeBtn.addEventListener('click', function () {
      /* ARMED, rather than acting immediately: the next click on any route puts
       * a bend exactly there. Michael, 2026-08-08 — the button used to add one
       * at the longest segment's midpoint, which is a fine default and not what
       * you want when you can see where it should go. Selecting the device
       * first still works, so nothing that used to be possible has gone. */
      var sel = (app.view.selection || []).filter(function (x) { return x.kind === 'pipe'; });
      if (sel.length !== 1) {
        app.view.addLinkNode = true;
        app.view.setTool('view');
        toast('Click anywhere on a control link or ΔP route to put a bend there.');
        return;
      }
      var p = M.pipe(app.model, sel[0].id);
      var host = p && (p.kind === 'sensor' ? p.sensor
                     : p.kind === 'pump' ? p.pump
                     : p.kind === 'valve' ? p.valve : null);
      var key = (p && p.kind === 'sensor') ? 'route' : 'control';
      var route = (p && p.kind === 'sensor') ? M.sensorRoute(app.model, p)
                                             : M.controlRoute(app.model, p);
      if (!host || !route) { toast('That item has no link to bend.', 'error'); return; }
      pushUndo();
      var holder = host[key] || (host[key] = {});
      holder.pts = M.insertWaypoint(route);
      delete holder.axis; delete holder.mid;
      changed(); app.view.render();
      toast('Bend added — drag it where you want it.');
    });

    /* REPAIR TAGS. Never silent and never automatic: it edits names on a
     * drawing, so it says exactly what it changed and does nothing if there is
     * nothing to change. */
    var repairBtn = $('btn-repair');
    if (repairBtn) repairBtn.addEventListener('click', function () {
      var found = [];
      app.model.pipes.concat(app.model.nodes).forEach(function (o) {
        if (M.looksMangled(o.tag)) found.push(o);
      });
      if (!found.length) { toast('No mangled tags found.'); return; }
      FD.dialog.confirm({
        title: 'Repair ' + found.length + ' tag' + (found.length === 1 ? '' : 's') + '?',
        message: found.slice(0, 12).map(function (o) {
          return o.id + ':  ' + o.tag + '   \u2192   ' +
                 String(o.tag).match(/^(.+?)((?:(?:PMP|AHU|TS|SRC|OF|STR)-\d+)+)$/)[1];
        }).join('\n') + (found.length > 12 ? '\n\u2026 and ' + (found.length - 12) + ' more' : '')
      }).then(function (yes) {
        if (!yes) return;
        pushUndo();
        var fixed = M.repairTags(app.model);
        changed(); renderProperties();
        toast('Repaired ' + fixed.length + ' tag' + (fixed.length === 1 ? '' : 's') + '.');
      });
    });

    $('btn-renumber').addEventListener('click', renumberNodes);

    /* The valve type used to be a dropdown beside one VALVE button, and the
     * equipment type was not choosable at all — you placed generic equipment
     * and then found the Type field in the panel. Both are BUTTONS now, one per
     * kind, because "what am I placing?" is the question the ribbon should
     * answer and a dropdown makes you open it to find out what it currently
     * says. Michael's UI pass, 2026-08-06. */

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
        /* The VIEW goes with it, so the page shows what the screen shows —
         * control links included, or not, exactly as they are on the ribbon. */
        FD.printer.renderPlans(app.model, app.results || solveNow(), app.view);
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

    $('btn-dxf').addEventListener('click', exportDxf);
    $('btn-print').addEventListener('click', function () { printAs('plans'); });
    $('btn-print-2').addEventListener('click', function () { printAs('sheet'); });

    $('btn-load').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadModelFile(e.target.files[0]);
      e.target.value = '';
    });

    /* COPY / PASTE PROPERTIES (Michael, 2026-08-05). Drawing a run of six
     * identical coils means typing the same six numbers six times; this copies
     * the properties of whatever is selected and stamps them onto the next
     * selection.
     *
     * GEOMETRY IS NEVER COPIED. A pipe's ends, its riser column, its id and its
     * tag stay where they are — pasting a size and a schedule onto a run is
     * useful, pasting one pipe's endpoints onto another would move it. And a
     * tag is a unique reference on a drawing: duplicating one would be worse
     * than leaving it blank. */
    $('btn-copy-props').addEventListener('click', copyProps);
    $('btn-paste-props').addEventListener('click', pasteProps);
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
