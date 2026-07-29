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

  function pushUndo() {
    app.undoStack.push(snapshot());
    if (app.undoStack.length > 60) app.undoStack.shift();
    app.redoStack.length = 0;
    updateHistoryButtons();
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
    renderLevels();
    renderProperties();
    applyTheme();
    applyPresentation();
    updateSystemChip();
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

    var warn = countWarnings(res);
    if (warn) {
      chip.textContent = warn + ' warning' + (warn > 1 ? 's' : '');
      chip.className = 'chip warn';
    } else {
      chip.textContent = 'Solved · ' + res.iterations + ' iterations';
      chip.className = 'chip ok';
    }
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
    var out = (res.warnings || []).map(function (w) {
      if (w.code === 'PDM' && w.pdm !== undefined) {
        return { message: 'Section ' + w.section + ': friction rate ' +
          FD.units.fmtPdm(w.pdm, d.pdm, true) + ' exceeds the ' +
          FD.units.fmtPdm(w.limit, d.pdm, true) + ' limit.' };
      }
      return { message: w.message };
    });

    m.nodes.forEach(function (n) {
      if (!n.device || n.device.kind !== 'demand' || n.device.include === false) return;
      if (res.pressure[n.id] === undefined) return;
      if (isUnreachable(res.pressure[n.id])) {
        out.push({ message: 'Demand ' + n.id + ' cannot be reached — it is isolated by a shut ' +
                            'valve or not connected to a source.' });
        return;
      }
      var short = res.pressure[n.id] - (n.device.reqPressure || 0);
      if (short < 0) {
        out.push({ message: 'Demand ' + n.id + ' is ' +
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
        l.kind === 'pump' ? -l.head : FD.hydraulics.headloss(l.r, q, l.n)));
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

    // header block (spec §10)
    var meta = m.settings.meta;
    var head = el('div', 'sheet-head');
    [['Project', meta.project || '—'], ['System', meta.system || '—'],
     ['Engineer', meta.engineer || '—'], ['Company', meta.company || '—'],
     ['Date', meta.date || new Date().toISOString().slice(0, 10)],
     ['Revision', meta.revision || '—'],
     ['System type', systemTypeLabel()],
     ['Method', 'Hazen-Williams (ASHRAE)'],
     ['Fluid', 'Water ~20 °C'],
     ['App version', FD.VERSION]
    ].forEach(function (kv) {
      var d = el('div', 'kv');
      d.appendChild(el('span', 'k', kv[0]));
      d.appendChild(el('span', 'v', kv[1]));
      head.appendChild(d);
    });
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
    /* Tag only earns a column when something in the model actually has one —
     * an empty column on every row of a plain pipe network is just noise. */
    var anyTag = rows.some(function (r) { return r.tag; });
    var cols = ['Section'].concat(anyTag ? ['Tag'] : [])
      .concat(['Size', 'ID mm', 'L ' + d.length, 'Fittings', 'EL ' + d.length,
                'L eff ' + d.length, 'Flow ' + d.flow, 'V m/s', 'PD/m ' + d.pdm,
                'Section PD ' + d.pressure, 'Static ' + d.pressure, 'Pressure ' + d.pressure]);

    var table = el('table', 'sheet');
    var thead = el('thead'), htr = el('tr');
    cols.forEach(function (c) {
      htr.appendChild(el('th', (c === 'Section' || c === 'Tag' || c === 'Fittings') ? 'txt' : '', c));
    });
    thead.appendChild(htr); table.appendChild(thead);

    var tb = el('tbody');
    rows.forEach(function (r) {
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
      /* Every node beyond a shut valve inherits the same meaningless pressure,
       * not just the valve's own row — so the test is on the value, not on
       * whether this particular section is the valve. */
      var deadEnd = r.shut || isUnreachable(r.pOut);
      cell(deadEnd ? '—' : FD.units.fmtPressure(r.pOut, d.pressure),
           deadEnd || r.pOut < 0 ? 'bad' : '');
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    host.appendChild(table);

    // ---- index circuit summary (spec §10) ----
    if (res && res.critical && res.critical.sections.length) {
      var ix2 = res.critical;
      var box = el('div', 'notice index-notice');
      box.appendChild(el('p', 'notice-head', 'Critical path'));
      var who = ix2.targetKind === 'demand'
        ? 'demand ' + ix2.target
        : 'equipment at ' + ix2.target;
      box.appendChild(el('p', '',
        'The hydraulically most unfavourable route runs from ' + ix2.origin + ' to ' +
        who + ' — ' + ix2.sections.length + ' sections, highlighted below and listed ' +
        'first. This is the path that sets the pump duty.'));
      var grid = el('div', 'index-grid');
      function kv(k, v) {
        var d2 = el('div', 'kv');
        d2.appendChild(el('span', 'k', k));
        d2.appendChild(el('span', 'v', v));
        grid.appendChild(d2);
      }
      kv('Friction along the path', FD.units.fmtPressure(headToPa(ix2.frictionHead), d.pressure, true));
      kv('Static lift', FD.units.fmtPressure(headToPa(ix2.staticHead), d.pressure, true));
      kv('Total', FD.units.fmtPressure(headToPa(ix2.frictionHead + ix2.staticHead),
                                       d.pressure, true));
      if (ix2.residual !== null && ix2.residual !== undefined) {
        kv('Residual at terminal', FD.units.fmtPressure(ix2.residual, d.pressure, true));
      }
      box.appendChild(grid);
      host.appendChild(box);
    }

    // demand summary: available vs required (spec §8.2)
    var demands = m.nodes.filter(function (n) {
      return n.device && n.device.kind === 'demand' && n.device.include !== false;
    });
    if (demands.length && res) {
      host.appendChild(el('h2', '', 'Demands'));
      var dt = el('table', 'sheet');
      var actual = res.actual;
      dt.innerHTML = '<thead><tr><th class="txt">Node</th>' +
                     '<th>Flow' + (actual ? ' (actual)' : '') + '</th>' +
                     '<th>Required</th><th>Available</th><th>Residual</th></tr></thead>';
      var dtb = el('tbody');
      demands.forEach(function (n) {
        var avail = res.pressure[n.id];
        var req = n.device.reqPressure || 0;
        var residual = avail - req;
        var dead = isUnreachable(avail);
        var tr = el('tr');

        /* When the system cannot deliver, the stated flow is a request, not a
         * result — so the flow the network can actually supply is shown beside
         * it in brackets. */
        var flowCell = FD.units.fmtFlow(n.device.flow, d.flow, true);
        var starved = false;
        if (actual) {
          var got = actual.flow[n.id];
          starved = got < n.device.flow - 1e-9;
          flowCell += '  <span class="' + (starved ? 'bad' : 'dim') + '">(' +
                      FD.units.fmtFlow(got, d.flow) + ')</span>';
        }

        tr.innerHTML = '<td class="txt">' + n.id + '</td>' +
          '<td>' + flowCell + '</td>' +
          '<td>' + FD.units.fmtPressure(req, d.pressure, true) + '</td>' +
          '<td class="' + (dead ? 'bad' : '') + '">' +
            (dead ? 'unreachable' : FD.units.fmtPressure(avail, d.pressure, true)) + '</td>' +
          '<td class="' + (dead || residual < 0 ? 'bad' : '') + '">' +
            (dead ? '—' : FD.units.fmtPressure(residual, d.pressure, true)) + '</td>';
        dtb.appendChild(tr);
      });
      dt.appendChild(dtb);
      host.appendChild(dt);
    }

    /* Threshold exceedances are highlighted red in the table AND listed here,
     * so they survive into print and CSV where colour does not. */
    var warnings = computeWarnings(res);
    if (warnings.length) {
      host.appendChild(el('h2', '', 'Warnings'));
      var ul = el('ul', 'warnlist');
      warnings.forEach(function (w) { ul.appendChild(el('li', '', w.message)); });
      host.appendChild(ul);
    }

    // ---- pump duty summary (spec §8.4) ----
    var pumpPipes = m.pipes.filter(function (p) { return p.kind === 'pump'; });
    if (pumpPipes.length && res) {
      host.appendChild(el('h2', '', 'Pump duty'));
      var pt = el('table', 'sheet');
      var pct = m.settings.pumpSafetyPct || 0;
      pt.innerHTML = '<thead><tr><th class="txt">Pump</th><th class="txt">Tag</th>' +
        '<th>Mode</th><th>Flow</th><th>Head required</th>' +
        '<th>Select against (+' + pct + '%)</th></tr></thead>';
      var ptb = el('tbody');
      pumpPipes.forEach(function (p) {
        var off = p.pump && p.pump.mode === 'off';
        var reqH = (p.pump && p.pump.head) || 0;
        var tr = el('tr');
        tr.innerHTML = '<td class="txt">' + p.id + '</td>' +
          '<td class="txt">' + (p.tag || '—') + '</td>' +
          '<td>' + (p.pump ? p.pump.mode : '—') + '</td>' +
          '<td>' + (off ? '—' : FD.units.fmtFlow(Math.abs(res.flow[p.id] || 0), d.flow, true)) + '</td>' +
          '<td>' + (off ? '—' : FD.units.fmtPressure(headToPa(reqH), d.pressure, true)) + '</td>' +
          '<td>' + (off ? '—' : FD.units.fmtPressure(headToPa(reqH * (1 + pct / 100)),
                                                     d.pressure, true)) + '</td>';
        ptb.appendChild(tr);
      });
      pt.appendChild(ptb);
      host.appendChild(pt);
      host.appendChild(el('p', 'legend',
        'Head required is the hydraulic duty at design flow — the figure the calculation ' +
        'above is based on. Select against includes the safety factor from SETTINGS; it is ' +
        'a specification margin and is deliberately NOT used in the calculation, because ' +
        'extra head on a fixed-speed pump raises flow rather than sitting spare.'));
    }

    host.appendChild(el('p', 'legend',
      'All pressures are gauge at the node; velocity pressure is neglected. ' +
      'PD/m is on drawn length excluding fittings; Section PD includes fitting equivalent length. ' +
      'Not intended for fire protection design (velocity pressure neglected; software not listed ' +
      'for AHJ acceptance). For preliminary design assistance only. Results must be verified by ' +
      'a qualified engineer. No warranty; no liability.'));
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
        { key: 'lookDir', label: 'Show adjacent level', type: 'select', value: lv.lookDir,
          options: [['down', 'Look down (level below)'], ['up', 'Look up (level above)']] }
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

    if (!sel.length) {
      host.appendChild(el('p', 'hint', 'Nothing selected. Click a pipe or node to edit it.'));
      return;
    }
    if (sel.length > 1) {
      host.appendChild(el('p', 'hint', sel.length + ' items selected.'));
      var bulk = el('div', 'field');
      var delBtn = el('button', 'btn danger', 'Delete selection');
      delBtn.addEventListener('click', function () { pushUndo(); app.view.deleteSelection(); });
      bulk.appendChild(delBtn);
      host.appendChild(bulk);
      return;
    }

    var s = sel[0];
    if (s.kind === 'pipe') renderPipeProps(host, M.pipe(m, s.id));
    else renderNodeProps(host, M.node(m, s.id));
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
      var i = el('input'); i.type = 'checkbox'; i.checked = !!t[key];
      var w = el('label', 'check-inline');
      w.appendChild(i); w.appendChild(el('span', '', label));
      host.appendChild(w);
      i.addEventListener('change', function () {
        pushUndo(); t[key] = i.checked; changed(); renderProperties();
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

  /* LAYOUT mode: which of this entity's values are echoed on the drawing.
   * Only offered in LAYOUT, because that is the mode for arranging a drawing
   * for print — in EDIT they would be noise. */
  function displayChecks(host, obj, opts) {
    if (app.view.tool !== 'layout') return;
    host.appendChild(el('h3', 'sub', 'Show on drawing'));
    opts.forEach(function (o) {
      var i = el('input'); i.type = 'checkbox';
      i.checked = !!M.displayFlags(obj)[o.key];
      var w = el('label', 'check-inline');
      w.appendChild(i);
      w.appendChild(el('span', '', o.label));
      host.appendChild(w);
      i.addEventListener('change', function () {
        pushUndo();
        M.setDisplayFlag(obj, o.key, i.checked);
        changed();
      });
    });
    host.appendChild(el('p', 'hint',
      'Ticked values appear in a box beside the entity. Drag the box to place it.'));
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

    var qIn = el('input'); qIn.type = 'text';
    qIn.value = FD.units.fmtFlow(p.equip.qRated || 0, d.flow);
    field(host, 'Rated flow (' + d.flow + ')', qIn).addEventListener('change', function () {
      var v = FD.units.parse(qIn.value);
      if (isFinite(v) && v > 0) {
        pushUndo(); p.equip.qRated = FD.units.toSIFlow(v, d.flow); changed();
      } else { qIn.value = FD.units.fmtFlow(p.equip.qRated || 0, d.flow); }
    });

    var pdIn = el('input'); pdIn.type = 'text';
    pdIn.value = FD.units.fmtPressure(p.equip.pdRated || 0, d.pressure);
    field(host, 'Rated pressure drop (' + d.pressure + ')', pdIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(pdIn.value);
        if (isFinite(v) && v >= 0) {
          pushUndo(); p.equip.pdRated = FD.units.toSIPressure(v, d.pressure); changed();
        } else { pdIn.value = FD.units.fmtPressure(p.equip.pdRated || 0, d.pressure); }
      });

    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      var q = res.flow[p.id];
      var info = el('div', 'readout');
      function ro(k, v) {
        var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v)); info.appendChild(r);
      }
      ro('Flow', FD.units.fmtFlow(Math.abs(q), d.flow, true));
      if (link) {
        ro('Pressure drop', FD.units.fmtPressure(
          headToPa(Math.abs(FD.hydraulics.headloss(link.r, q, link.n))), d.pressure, true));
      }
      host.appendChild(info);
    }
    host.appendChild(el('p', 'hint',
      'Pressure drop scales with the square of flow: ΔP = ΔP_rated × (Q / Q_rated)².'));
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

    var openSel = el('select');
    FD.valves.openings.forEach(function (o) {
      var op = el('option', '', o + '% open' + (o === 0 ? ' (shut)' : ''));
      op.value = String(o);
      if (o === v.opening) op.selected = true;
      openSel.appendChild(op);
    });
    openSel.disabled = !t.adjustable;
    var openField = field(host, 'Opening', openSel);
    openField.addEventListener('change', function () {
      pushUndo(); v.opening = parseInt(openSel.value, 10); renderProperties(); changed();
    });
    if (!t.adjustable) {
      host.appendChild(el('p', 'hint',
        'A check valve is not user-positioned — it opens with forward flow and ' +
        'seats against reverse flow automatically.'));
    }

    var kvIn = el('input'); kvIn.type = 'text'; kvIn.value = String(v.kv);
    field(host, 'Kv (m³/h at 1 bar)', kvIn).addEventListener('change', function () {
      var val = FD.units.parse(kvIn.value);
      if (isFinite(val) && val > 0) { pushUndo(); v.kv = val; renderProperties(); changed(); }
      else { kvIn.value = String(v.kv); toast('Kv must be a positive number.', 'error'); }
    });

    var cvIn = el('input'); cvIn.type = 'text';
    cvIn.value = FD.valves.kvToCv(v.kv).toFixed(1);
    field(host, 'Cv (US gpm at 1 psi)', cvIn).addEventListener('change', function () {
      var val = FD.units.parse(cvIn.value);
      if (isFinite(val) && val > 0) {
        pushUndo(); v.kv = Math.round(FD.valves.cvToKv(val) * 10) / 10;
        renderProperties(); changed();
      } else { cvIn.value = FD.valves.kvToCv(v.kv).toFixed(1); }
    });

    var reset = el('button', 'btn', 'Reset Kv for this size');
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
    ro('Effective Kv', effKv.toFixed(1) + (v.opening < 100 ? '  (' + v.opening + '% open)' : ''));

    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var q = res.flow[p.id];
      var link = res.network.links.find(function (l) { return l.id === p.id; });
      ro('Flow', FD.units.fmtFlow(Math.abs(q), m.settings.display.flow, true));
      if (link) {
        if (link.r >= FD.valves.CLOSED_R) {
          ro('Pressure drop', 'Shut — no flow path');
        } else {
          var pd = headToPa(Math.abs(FD.hydraulics.headloss(link.r, q, link.n)));
          ro('Pressure drop', FD.units.fmtPressure(pd, m.settings.display.pressure, true));
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

  /* Spec §8.4. Head is either user-fixed or auto-sized: auto solves, reads the
   * worst shortfall at any demand, and adds that plus the safety factor. */
  function renderPumpProps(host, p) {
    var m = app.model;
    host.appendChild(el('h3', '', 'Pump ' + p.id));
    tagField(host, p);

    var modeSel = el('select');
    [['auto', 'Running — head calculated'],
     ['fixed', 'Running — head user-fixed'],
     ['off', 'Off (isolated, no flow)']].forEach(function (kv) {
      var o = el('option', '', kv[1]); o.value = kv[0];
      if (p.pump.mode === kv[0]) o.selected = true;
      modeSel.appendChild(o);
    });
    field(host, 'Sizing', modeSel).addEventListener('change', function () {
      pushUndo(); p.pump.mode = modeSel.value;
      if (p.pump.mode === 'auto') autoSizePump(p);
      renderProperties(); changed();
    });

    var hIn = el('input'); hIn.type = 'text';
    hIn.value = FD.units.fmtPressure(headToPa(p.pump.head || 0), m.settings.display.pressure);
    hIn.disabled = (p.pump.mode === 'auto' || p.pump.mode === 'off');
    field(host, 'Head (' + m.settings.display.pressure + ')', hIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(hIn.value);
        if (!isFinite(v)) { return; }
        pushUndo();
        p.pump.head = FD.units.paToHeadWith(FD.units.toSIPressure(v, m.settings.display.pressure),
                                            m.settings.fluid && m.settings.fluid.density);
        changed();
      });

    if (p.pump.mode === 'off') {
      host.appendChild(el('p', 'hint',
        'An off pump is modelled as isolated — no flow passes through it. Without this, ' +
        'a running pump short-circuits backwards through its idle neighbours.'));
    }
    if (p.pump.mode === 'auto') {
      var btn = el('button', 'btn', 'Re-size now');
      btn.addEventListener('click', function () {
        pushUndo(); autoSizePump(p); renderProperties(); changed();
      });
      host.appendChild(btn);
    }

    var res = app.results;
    if (res && res.flow[p.id] !== undefined) {
      var info = el('div', 'readout');
      function ro(k, v) {
        var r = el('div', 'kv'); r.appendChild(el('span', 'k', k));
        r.appendChild(el('span', 'v', v)); info.appendChild(r);
      }
      var pct = m.settings.pumpSafetyPct || 0;
      var reqH = p.pump.head || 0;
      var dutyH = reqH * (1 + pct / 100);
      ro('Duty flow', FD.units.fmtFlow(Math.abs(res.flow[p.id]), m.settings.display.flow, true));
      ro('Head required', FD.units.fmtPressure(headToPa(reqH),
                                               m.settings.display.pressure, true) +
                          '  (' + reqH.toFixed(2) + ' m)');
      /* The safety factor is a SELECTION margin, not part of the hydraulics.
       * Baking it into the solve made a 10% margin push 21 L/s through
       * equipment rated for 20, so it is reported here instead. */
      if (pct) {
        ro('Select against (+' + pct + '%)',
           FD.units.fmtPressure(headToPa(dutyH), m.settings.display.pressure, true) +
           '  (' + dutyH.toFixed(2) + ' m)');
      }
      host.appendChild(info);
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

    var dev = n.device;
    var kindSel = el('select');
    [['', 'Junction'], ['source', 'Source (reservoir)'], ['demand', 'Demand']]
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

    if (dev && dev.kind === 'demand') {
      var fIn = el('input'); fIn.type = 'text';
      fIn.value = FD.units.fmtFlow(dev.flow, m.settings.display.flow);
      field(host, 'Flow (' + m.settings.display.flow + ')', fIn)
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
      field(host, 'Required pressure (' + m.settings.display.pressure + ')', pIn)
        .addEventListener('change', function () {
          var v = FD.units.parse(pIn.value);
          if (isFinite(v)) {
            pushUndo();
            dev.reqPressure = FD.units.toSIPressure(v, m.settings.display.pressure);
            changed();
          } else { pIn.value = FD.units.fmtPressure(dev.reqPressure, m.settings.display.pressure); }
        });

      var inc = el('input'); inc.type = 'checkbox'; inc.checked = dev.include !== false;
      var incWrap = el('label', 'check-inline');
      incWrap.appendChild(inc);
      incWrap.appendChild(el('span', '', 'Include in calculation'));
      host.appendChild(incWrap);
      inc.addEventListener('change', function () {
        pushUndo(); dev.include = inc.checked; changed();
      });
    }

    var dzIn = el('input'); dzIn.type = 'text';
    dzIn.value = FD.units.fmtLength(n.dz || 0, m.settings.display.length);
    field(host, 'Altitude offset (' + m.settings.display.length + ')', dzIn)
      .addEventListener('change', function () {
        var v = FD.units.parse(dzIn.value);
        if (isFinite(v)) {
          pushUndo(); n.dz = FD.units.toSILength(v, m.settings.display.length); changed();
        } else { dzIn.value = FD.units.fmtLength(n.dz || 0, m.settings.display.length); }
      });

    var res = app.results;
    if (res && res.pressure[n.id] !== undefined) {
      var info = el('div', 'readout');
      var r1 = el('div', 'kv');
      r1.appendChild(el('span', 'k', 'Elevation'));
      r1.appendChild(el('span', 'v', FD.units.fmtLength(M.elevation(m, n), m.settings.display.length, true)));
      info.appendChild(r1);
      var r2 = el('div', 'kv');
      r2.appendChild(el('span', 'k', 'Pressure'));
      r2.appendChild(el('span', 'v', FD.units.fmtPressure(res.pressure[n.id], m.settings.display.pressure, true)));
      info.appendChild(r2);
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
    var demands = m.nodes.filter(function (n) { return n.device && n.device.kind === 'demand'; });

    if (!sources.length || !demands.length) {
      FD.dialog.alert({
        title: 'Cannot renumber',
        message: 'Renumbering nodes requires a SOURCE and DEMAND.'
      });
      return;
    }

    // Breadth-first from every source at once.
    var order = [], seen = {};
    var queue = sources.map(function (n) { return n.id; });
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

    /* Friction method, fluid, warning thresholds, fitting tables and pipe
     * schedules all live on the HYDRAULIC tab now — this tab is for how the
     * app behaves, not for how the hydraulics are calculated. */
    var g2 = group('Pump');
    num(g2, 'Pump safety factor %', m.settings.pumpSafetyPct,
        function (v) { m.settings.pumpSafetyPct = v; redrawAll(); });
    host.appendChild(el('p', 'hint',
      'Applied to the pump head only, and only as a reported selection duty — it never ' +
      'enters the calculation, so it cannot compound with the margins already in the ' +
      'C factor, fitting allowances or equipment ratings. Defaults to 0 so you can apply ' +
      'your own margin after the calculation.'));

    // ---- presentation ----
    host.appendChild(el('h2', '', 'Presentation'));
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

    var hydNote = el('p', 'hint',
      'Calculation method, fluid properties, warning thresholds, fitting data and pipe ' +
      'schedules are on the HYDRAULIC tab.');
    host.appendChild(hydNote);

    // ---- print / annotation toggles ----
    host.appendChild(el('h2', '', 'Print & drawing annotations'));
    host.appendChild(el('p', 'hint',
      'Controls what is labelled on the drawing and on printed level plans. ' +
      'Pipe labels read like "50⌀/12.50m/2.40L/s"; node labels read like "N3 T".'));

    var a = m.settings.annotate;
    function toggle(g, label, key) {
      var i = el('input'); i.type = 'checkbox'; i.checked = !!a[key];
      i.addEventListener('change', function () { a[key] = i.checked; redrawAll(); });
      var w = el('label', 'check-inline');
      w.appendChild(i); w.appendChild(el('span', '', label));
      g.appendChild(w);
    }

    host.appendChild(el('h3', 'sub', 'Pipes'));
    var gp = el('div', 'settings-grid'); host.appendChild(gp);
    toggle(gp, 'Lengths', 'pipeLength');
    toggle(gp, 'Nom. diameter', 'pipeDiameter');
    toggle(gp, 'Flow', 'pipeFlow');
    toggle(gp, 'Velocity', 'pipeVelocity');
    toggle(gp, 'PD', 'pipePD');

    host.appendChild(el('h3', 'sub', 'Pipe fittings'));
    var gf = el('div', 'settings-grid'); host.appendChild(gf);
    toggle(gf, 'Type (EL, T, S, P, D)', 'fitType');
    toggle(gf, 'PD', 'fitPD');
    toggle(gf, 'Node numbers', 'nodeNumbers');

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

    var g7 = group('Project metadata');
    ['project', 'system', 'engineer', 'company', 'date', 'revision'].forEach(function (k) {
      text(g7, k.charAt(0).toUpperCase() + k.slice(1), m.settings.meta[k], function (v) {
        m.settings.meta[k] = v; scheduleSave();
      });
    });
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
    box.appendChild(el('p', 'notice-head',
      det.type === 'open' ? 'Open loop' : det.type === 'closed' ? 'Closed loop'
                                                                : 'No supply yet'));
    box.appendChild(el('p', '', det.reason));
    box.appendChild(el('p', 'hint',
      'Detected from the model rather than set by hand — a system fed by a source is ' +
      'open, a sealed circuit driven by a pump is closed. It is shown on the PIPING ' +
      'NETWORK ribbon as you draw. The distinction is informational: the solver carries ' +
      'total head, so static lift falls out of the solution either way.'));
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

    if (!isDW) {
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

      hint('Defaults are the ASHRAE SI values. Some jurisdictions specify different ' +
           'constants, so all four are editable rather than the app carrying a list of codes.');
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

      host.appendChild(el('div', 'notice warn-notice',
        'Darcy-Weisbach is experimental and the friction-factor correlation has not been ' +
        'settled. All four correlations are implemented so they can be compared on a real ' +
        'model. Do not issue calculations from this method until the correlation is confirmed.'));

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
      'Custom schedules are stored in this browser, independent of any one project, AND ' +
      'embedded in every saved model — so a file stays usable on a machine that has never ' +
      'seen the schedule. The two governing fields are the nominal label and the inner ' +
      'diameter; everything else is derived from those.'));

    // ------------------------------------------------ fitting data
    /* Only the table the active method actually uses is shown. Displaying both
     * invites entering numbers into the one that is being ignored. */
    if (!isDW) {
      h2('Fitting equivalent lengths');
      hint('Used by Hazen-Williams. Charged to the downstream pipe as ' +
           'EL = (L/D) × inner diameter.');
      var elTable = el('table', 'sheet editable');
      elTable.innerHTML = '<thead><tr><th class="txt">Fitting</th><th>Code</th>' +
                          '<th>L/D</th><th>EL at DN50 (m)</th></tr></thead>';
      var elBody = el('tbody');
      Object.keys(FD.fittings.types).forEach(function (t) {
        var tr = el('tr');
        tr.appendChild(el('td', 'txt', FD.fittings.label(t)));
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
      h2('Fitting resistance coefficients K');
      hint('Used by Darcy-Weisbach: h = K · V²/2g. Values are ASHRAE Fundamentals ' +
           'Pipe Sizing Tables 1 and 2, interpolated by size. Leave a cell blank to use ' +
           'the size curve, or type a number to pin it flat.');
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
    hint('Sections breaching a limit are flagged red on the calculation sheet and listed ' +
         'as warnings. Typical practice: 1.2–2.4 m/s in occupied areas (up to ~3 m/s in ' +
         'plant rooms and risers), 100–400 Pa/m friction rate.');
    var wg = grid();
    numField(wg, 'Max velocity', m.settings.warn.velocity,
      function (v) { pushUndo(); m.settings.warn.velocity = v; redrawAll(); }, '(m/s)');
    numField(wg, 'Max friction rate', m.settings.warn.pdm,
      function (v) { pushUndo(); m.settings.warn.pdm = v; redrawAll(); }, '(Pa/m)');

    var lam = el('input'); lam.type = 'checkbox';
    lam.checked = m.settings.warn.laminar !== false;
    var lamWrap = el('label', 'check-inline');
    lamWrap.appendChild(lam);
    lamWrap.appendChild(el('span', '', 'Warn on laminar / transitional flow'));
    host.appendChild(lamWrap);
    lam.addEventListener('change', function () {
      pushUndo(); m.settings.warn.laminar = lam.checked; redrawAll();
    });
    hint('Hazen-Williams is an empirical correlation for turbulent water flow. Below ' +
         'Re ≈ 2300 it is not merely imprecise, it is the wrong equation — so a laminar ' +
         'section is a warning about the method, not just the velocity.');
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

    app.view = new FD.View($('canvas'), function () { return app.model; }, function () {
      renderProperties();
      renderLevels();
      scheduleSolve();
      scheduleSave();
    });
    // Canvas tools report back through the app's toast system rather than
    // reaching into the DOM themselves.
    app.view.onMessage = function (msg, kind) { toast(msg, kind); };

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

    // ---- tools ----
    var toolButtons = [].slice.call(document.querySelectorAll('[data-tool]'));
    toolButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        app.view.setTool(b.dataset.tool);
        toolButtons.forEach(function (o) {
          o.classList.toggle('active', o.dataset.tool === app.view.tool);
        });
      });
    });
    var MODE_HINTS = {
      edit:   'Click to select · drag a node to move it · Delete removes the selection',
      pipe:   'Click to place vertices · scroll = pipe size · Shift = free angle · Esc = finish',
      layout: 'Drag any label to reposition it for printing · tick properties in the panel to show them on the drawing',
      trace:  'Ctrl+V a screen snip, or drag an image in · drag to move, corners to scale · set the scale, then lock it',
      riser:  'Click this floor\u2019s pipework to place or join a riser column',
      source: 'Click to place a source (tank, mains, or expansion vessel)',
      demand: 'Click to place a demand',
      pump:   'Click a pipe to insert a pump into it',
      equip:  'Click a pipe to insert equipment into it',
      valve:  'Click a pipe to insert a valve into it'
    };
    function refreshToolButtons() {
      toolButtons.forEach(function (o) {
        o.classList.toggle('active', o.dataset.tool === app.view.tool);
      });
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

    $('btn-renumber').addEventListener('click', renumberNodes);

    // Which valve the VALVE tool places; also switches the tool on.
    $('valve-type').addEventListener('change', function () {
      app.view.valveType = $('valve-type').value;
      app.view.setTool('valve');
      toolButtons.forEach(function (o) {
        o.classList.toggle('active', o.dataset.tool === app.view.tool);
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

    // Push an undo snapshot before each structural edit made on canvas.
    var origChanged = app.view.changed.bind(app.view);
    var pending = false;
    app.view.changed = function () {
      if (!pending) { pushUndo(); pending = true; setTimeout(function () { pending = false; }, 0); }
      origChanged();
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
