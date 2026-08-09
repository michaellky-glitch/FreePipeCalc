/* FreePipeCalc — TOOLS tab
 *
 * Standalone calculators that produce something you paste back into the model.
 * They deliberately do NOT reach into the network: a tool takes numbers in and
 * gives numbers out, so it can be checked against a hand calculation without
 * a model open at all.
 *
 * Tool 1 — Generic Pump Curve.
 *
 * The app used to generate a pump curve for you from the calculated duty, on
 * the EPANET single-point assumption (shutoff at 133%, runout at 200%). That
 * was removed: it is one manufacturer-agnostic guess presented as if it were
 * the answer, and it silently disagrees with the shapes engineers actually
 * work to. NFPA 20, for one, requires shutoff no more than 140% and at least
 * 65% of rated head at 150% of rated flow — a curve the single-point
 * assumption cannot produce.
 *
 * So the three defining points are stated instead, and the curve is
 * interpolated exactly through them.
 */
(function (FD) {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function field(host, label, ctrl, hint) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', '', label));
    wrap.appendChild(ctrl);
    if (hint) wrap.appendChild(el('span', 'hint', hint));
    host.appendChild(wrap);
    return wrap;
  }

  function num(value, step) {
    var i = el('input');
    i.type = 'text';
    i.value = value;
    if (step) i.step = step;
    return i;
  }

  /* Defaults are the NFPA 20 fire-pump envelope, because it is the most
   * commonly specified generic shape and gives the tool a sensible starting
   * point rather than a blank form. */
  var DEFAULTS = {
    fp1Flow: 0, fp1Press: 140,
    fp2Flow: 150, fp2Press: 65
  };

  var state = null;

  // ------------------------------------------------------ generic pump curve
  function renderPumpCurveTool(host, app) {
    var m = app.model;
    var fu = m.settings.display.flow;
    var pu = m.settings.display.pressure;

    var card = el('div', 'tool-card');
    card.appendChild(el('h2', '', 'Pump Curve Generator'));

    var grid = el('div', 'tool-grid');

    var left = el('div', 'tool-col');
    left.appendChild(el('h3', '', 'Design point'));
    var qIn = num(state.qDesign === null ? '' : state.qDesign);
    var hIn = num(state.hDesign === null ? '' : state.hDesign);
    field(left, 'Design flow (' + fu + ')', qIn);
    field(left, 'Design pressure (' + pu + ')', hIn);

    var mid = el('div', 'tool-col');
    mid.appendChild(el('h3', '', 'Fit point 1'));
    var f1q = num(state.fp1Flow);
    var f1h = num(state.fp1Press);
    field(mid, 'Flow (% of design)', f1q);
    field(mid, 'Pressure (% of design)', f1h);
    mid.appendChild(el('p', 'hint', 'Usually shutoff: 0% flow.'));

    var right = el('div', 'tool-col');
    right.appendChild(el('h3', '', 'Fit point 2'));
    var f2q = num(state.fp2Flow);
    var f2h = num(state.fp2Press);
    field(right, 'Flow (% of design)', f2q);
    field(right, 'Pressure (% of design)', f2h);
    right.appendChild(el('p', 'hint', 'Usually runout: 150% flow.'));

    grid.appendChild(left); grid.appendChild(mid); grid.appendChild(right);
    card.appendChild(grid);

    /* ONE row: the preset, the generate button, and — once there is something
     * to copy — Copy and its info marker. They were three stacked rows with
     * Copy at the bottom of the result table, so taking the curve away meant
     * scrolling past sixteen rows to reach the button that gives it to you
     * (Michael, 2026-08-02). */
    var actions = el('div', 'btn-row');

    var nfpa = el('button', 'btn', 'NFPA 20');
    nfpa.title = 'NFPA 20 fire-pump envelope: shutoff not more than 140% of ' +
                 'rated head; not less than 65% of rated head at 150% of rated flow.';
    nfpa.addEventListener('click', function () {
      state.fp1Flow = 0; state.fp1Press = 140;
      state.fp2Flow = 150; state.fp2Press = 65;
      state.result = null;
      render(app);
    });
    actions.appendChild(nfpa);

    var gen = el('button', 'btn primary', 'Generic');
    gen.title = 'Build the curve through the design point and the two fit points above.';
    gen.addEventListener('click', function () {
      state.qDesign = FD.units.parse(qIn.value);
      state.hDesign = FD.units.parse(hIn.value);
      state.fp1Flow = FD.units.parse(f1q.value);
      state.fp1Press = FD.units.parse(f1h.value);
      state.fp2Flow = FD.units.parse(f2q.value);
      state.fp2Press = FD.units.parse(f2h.value);
      state.result = generate(state, m);
      render(app);
    });
    actions.appendChild(gen);

    if (state.result && !state.result.error) addCopy(actions, state.result, m);
    card.appendChild(actions);

    if (state.result) renderResult(card, state.result, m);
    host.appendChild(card);
  }

  /* Everything below works in DISPLAY units, not SI. The tool is a calculator
   * the engineer reads directly, and converting to SI and back would only add
   * rounding between what was typed and what is shown. */
  function generate(st, m) {
    if (!(st.qDesign > 0)) return { error: 'Design flow must be greater than zero.' };
    if (!(st.hDesign > 0)) return { error: 'Design pressure must be greater than zero.' };
    var pcts = [st.fp1Flow, st.fp1Press, st.fp2Flow, st.fp2Press];
    for (var i = 0; i < pcts.length; i++) {
      if (!isFinite(pcts[i]) || pcts[i] < 0) {
        return { error: 'Fit point percentages must be zero or greater.' };
      }
    }

    var p0 = { q: st.qDesign * st.fp1Flow / 100, h: st.hDesign * st.fp1Press / 100 };
    var p1 = { q: st.qDesign, h: st.hDesign };
    var p2 = { q: st.qDesign * st.fp2Flow / 100, h: st.hDesign * st.fp2Press / 100 };

    var qc = FD.pumps.threePoint(p0, p1, p2);
    if (!qc) {
      return { error: 'Those three points do not define a curve. Two of them share ' +
                      'the same flow, so there is no single head at that flow — check ' +
                      'the fit point percentages against 100%.' };
    }

    var warnings = FD.pumps.quadWarnings(qc, st.qDesign);

    /* 0–150% of design in 10% steps, but stopped at the flow where head
     * reaches zero: a pump delivers nothing past that, and tabulating negative
     * head would be inviting someone to paste it into the solver. */
    var qZero = FD.pumps.quadMaxFlow(qc);
    var rows = [];
    for (var pct = 0; pct <= 150; pct += 10) {
      var q = st.qDesign * pct / 100;
      if (q > qZero + 1e-12) break;
      rows.push({ pct: pct, q: q, h: FD.pumps.quadHead(qc, q) });
    }

    return { qc: qc, rows: rows, warnings: warnings, qZero: qZero,
             points: [p0, p1, p2], design: { q: st.qDesign, h: st.hDesign } };
  }

  function renderResult(host, r, m) {
    if (r.error) {
      var e = el('div', 'notice warn-notice');
      e.appendChild(el('p', '', r.error));
      host.appendChild(e);
      return;
    }
    var fu = m.settings.display.flow;
    var pu = m.settings.display.pressure;

    /* THE CURVE ITSELF, FIRST. Michael, 2026-08-09: the shape is the thing you
     * are judging — flat, steep, or bending the wrong way — and it was below
     * three readouts and a sixteen-row table. */
    host.appendChild(curveChart(r, m));

    host.appendChild(el('h3', '', 'Result'));

    var ro = el('div', 'readout');
    function kv(k, v) {
      var row = el('div', 'kv');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      ro.appendChild(row);
    }
    var qc = r.qc;
    kv('Curve', 'h(q) = ' + fmt(qc.a) + signed(qc.b) + '·q' + signed(qc.c) + '·q²' +
                '   (q in ' + fu + ', h in ' + pu + ')');
    kv('Shutoff head', fmt(FD.pumps.quadHead(qc, 0)) + ' ' + pu);
    kv('Head at design flow', fmt(FD.pumps.quadHead(qc, r.design.q)) + ' ' + pu);
    kv('Flow at zero head', isFinite(r.qZero) ? fmt(r.qZero) + ' ' + fu : 'beyond the table');
    host.appendChild(ro);

    r.warnings.forEach(function (w) {
      var n = el('div', 'notice warn-notice');
      n.appendChild(el('p', '', w));
      host.appendChild(n);
    });

    var t = el('table', 'sheet');
    t.innerHTML = '<thead><tr><th>% of design</th><th>Flow (' + fu + ')</th>' +
                  '<th>Head (' + pu + ')</th></tr></thead>';
    var tb = el('tbody');
    r.rows.forEach(function (row) {
      var tr = el('tr');
      if (row.pct === 100) tr.className = 'index-row';
      tr.appendChild(el('td', '', row.pct + '%'));
      tr.appendChild(el('td', '', fmt(row.q)));
      tr.appendChild(el('td', '', fmt(row.h)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    host.appendChild(t);
    

  }

  /* Copy sits in the button ROW at the top, beside NFPA 20 and Generic.
   *
   * ONE payload: the three stated duties. The full 16-row table was the other
   * option and it refits to r² ≈ 0.9997, shifting all three stated duties by
   * ~1% — so the button that looked more thorough gave the less exact answer.
   * Removed rather than explained.
   *
   * The reasoning behind that lives on the info marker rather than the page: it
   * matters (the solver stores H0 - a*Q^b, which has no linear term, so a refit
   * moves the stated duties) but it is a footnote, not an instruction. */
  /* The generated curve, drawn, with the three stated duties marked — so what
   * the interpolation did between them is visible rather than described. */
  function curveChart(r, m) {
    var fu = m.settings.display.flow, pu = m.settings.display.pressure;
    var W = 360, H = 190, PADL = 46, PADB = 30, PADT = 10, PADR = 10;
    var cv = el('canvas');
    cv.width = W; cv.height = H;
    cv.style.width = '100%'; cv.style.height = 'auto';
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return cv;

    function css(n) {
      return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    }
    var line = css('--line') || '#444', text = css('--text-mute') || '#999';
    var accent = css('--ok') || '#46d17f', mark = css('--select') || '#ffb340';

    var qMax = 0, hMax = 0;
    r.rows.forEach(function (row) {
      if (row.q > qMax) qMax = row.q;
      if (row.h > hMax) hMax = row.h;
    });
    (r.points || []).forEach(function (p) { if (p.h > hMax) hMax = p.h; });
    if (!(qMax > 0) || !(hMax > 0)) return cv;
    qMax *= 1.04; hMax *= 1.08;
    function X(q) { return PADL + (q / qMax) * (W - PADL - PADR); }
    function Y(h) { return H - PADB - (h / hMax) * (H - PADB - PADT); }

    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADL, PADT); ctx.lineTo(PADL, H - PADB); ctx.lineTo(W - PADR, H - PADB);
    ctx.stroke();

    ctx.fillStyle = text; ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(hMax), PADL - 5, Y(hMax));
    ctx.fillText('0', PADL - 5, Y(0));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(fmt(qMax) + ' ' + fu, W - PADR, H - PADB + 5);
    ctx.save();
    ctx.translate(11, (H - PADB) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Head (' + pu + ')', 0, 0);
    ctx.restore();

    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath();
    r.rows.forEach(function (row, i) {
      var x = X(row.q), y = Y(row.h);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = mark;
    (r.points || []).forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p.q), Y(p.h), 3.5, 0, Math.PI * 2); ctx.fill();
    });
    return cv;
  }

  function addCopy(row, r, m) {
    var payload = r.points.map(function (p) {
      return fmt(p.q) + '\t' + fmt(p.h);
    }).join('\n');

    var b = el('button', 'btn', 'Copy');
    b.title = 'Copy the three stated duties as flow/head rows, ready to paste ' +
              'into a pump\u2019s Paste curve data.';
    b.addEventListener('click', function () {
      copyText(payload);
      var was = b.textContent;
      b.textContent = 'Copied';
      setTimeout(function () { b.textContent = was; }, 1500);
    });
    row.appendChild(b);

    var info = el('span', 'info-mark', '\u24D8');
    info.title = 'Copies the three stated duties as flow/head rows — paste into ' +
      'pump properties. Only these three points are copied because the solver ' +
      'stores a curve as H0 - a*Q^b, which has no linear term: refitting the ' +
      'full table spreads the error and shifts all three stated duties by ~1%. ' +
      'Three points, three parameters, exact.';
    row.appendChild(info);
    void m;
  }

  /* " + -0.02" is how a machine writes it; an engineer writes " - 0.02". */
  function signed(v) {
    if (!isFinite(v)) return ' + ?';
    return (v < 0 ? ' \u2212 ' : ' + ') + fmt(Math.abs(v));
  }

  /* Four significant figures is what a pump schedule is quoted to; more just
   * makes the table harder to read and implies precision the curve has not got. */
  function fmt(v) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    var mag = Math.abs(v);
    if (mag >= 100) return v.toFixed(1);
    if (mag >= 1) return v.toFixed(2);
    if (mag >= 0.01) return v.toFixed(4);
    return v.toExponential(3);
  }

  /* Same fallback as the rest of the app: navigator.clipboard needs a secure
   * context and file:// is not one, so execCommand is the path that actually
   * works in the deployment this program is built for. */
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText &&
          window.isSecureContext) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) { /* fall through */ }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* nothing else to try */ }
    document.body.removeChild(ta);
  }

  /* ============================== Tool 2 — Insulation Critical Radius
   *
   * ONE THING TO KNOW BEFORE READING THE OUTPUT, and it is the reason this
   * tool says more than it was asked to:
   *
   *     THE CRITICAL RADIUS DOES NOT DEPEND ON TEMPERATURE.
   *
   * r_cr = k / h. That is the whole of it — the conductivity of the insulation
   * over the outside film coefficient. Ambient and fluid temperature do not
   * appear, and cannot: the critical radius is the radius at which ADDING
   * insulation stops increasing the surface area faster than it adds
   * resistance, which is a geometry-and-materials question. Doubling the
   * temperature difference doubles the heat flow at every radius and moves the
   * turning point not at all.
   *
   * Michael asked for ambient and fluid temperature as inputs (2026-08-02).
   * They are taken, and they are USED — for the surface temperature and the
   * heat loss at the chosen thickness, which is what those two numbers really
   * govern. Silently ignoring them would have been worse than saying this.
   *
   * The practical answer is almost always the same: with polyurethane at
   * k = 0.02 and still air at h = 8, r_cr = 2.5 mm. Every pipe in every
   * schedule this app carries is larger than that, so insulation always
   * reduces the loss and the critical radius never binds. It matters for thin
   * wires and small tubes, which is where the textbook example comes from.
   *
   * The condensation-control thickness — the one that actually governs a
   * chilled-water job — is a DIFFERENT calculation and needs the room's
   * humidity, which this app does not hold. The surface temperature below is
   * the input to it: compare it against your dew point.
   */
  var critState = null;

  function critDefaults(app) {
    var t = (app.model.settings && app.model.settings.thermal) || {};
    return {
      ambient: t.ambient !== undefined ? t.ambient : 20,
      fluid: t.supplyTemp !== undefined ? t.supplyTemp : 6,
      od: 60.3,
      k: t.insulationK > 0 ? t.insulationK : 0.02,
      h: t.surfaceCoeff > 0 ? t.surfaceCoeff : 8
    };
  }

  function renderCriticalTool(host, app) {
    if (!critState) critState = critDefaults(app);
    var st = critState;

    var card = el('div', 'tool-card');
    card.appendChild(el('h2', '', 'Insulation Critical Radius  (BETA)'));

    var grid = el('div', 'tool-grid');
    var left = el('div', 'tool-col');
    left.appendChild(el('h3', '', 'Pipe'));
    var odIn = num(st.od);
    field(left, 'Outside diameter (mm)', odIn);
    var kIn = num(st.k);
    field(left, 'Insulation k (W/m·K)', kIn);
    var hIn = num(st.h);
    field(left, 'Surface coefficient h (W/m²·K)', hIn);

    var mid = el('div', 'tool-col');
    mid.appendChild(el('h3', '', 'Temperatures'));
    var taIn = num(st.ambient);
    field(mid, 'Ambient (°C)', taIn);
    var tfIn = num(st.fluid);
    field(mid, 'Fluid (°C)', tfIn);

    grid.appendChild(left); grid.appendChild(mid);
    card.appendChild(grid);

    var row = el('div', 'btn-row');
    var go = el('button', 'btn primary', 'Calculate');
    go.addEventListener('click', function () {
      st.od = FD.units.parse(odIn.value);
      st.k = FD.units.parse(kIn.value);
      st.h = FD.units.parse(hIn.value);
      st.ambient = FD.units.parse(taIn.value);
      st.fluid = FD.units.parse(tfIn.value);
      st.result = critical(st);
      render(app);
    });
    row.appendChild(go);
    var reset = el('button', 'btn', 'Reset to model');
    reset.addEventListener('click', function () {
      critState = critDefaults(app); render(app);
    });
    row.appendChild(reset);
    card.appendChild(row);

    if (st.result) renderCritical(card, st.result);
    host.appendChild(card);
  }

  /* r_cr = k/h. The "critical thickness" is that radius less the pipe's own,
   * and it is NEGATIVE whenever the pipe is already bigger than r_cr — which
   * is the normal case, and is the useful answer: any insulation at all
   * reduces the loss. */
  function critical(st) {
    if (!(st.od > 0)) return { error: 'Outside diameter must be greater than zero.' };
    if (!(st.k > 0)) return { error: 'Conductivity must be greater than zero.' };
    if (!(st.h > 0)) return { error: 'Surface coefficient must be greater than zero.' };

    var r_pipe = st.od / 2000;                 // m
    var r_cr = st.k / st.h;                    // m
    var tCrit = (r_cr - r_pipe) * 1000;        // mm, negative when it does not bind
    /* Rounded UP to the next 25 mm, not to the nearest: rounding a critical
     * thickness DOWN would leave you below it, which is the one place you must
     * not be. Never less than 25 mm — no one specifies 0 mm of lagging. */
    var tRound = Math.max(25, Math.ceil(Math.max(0, tCrit) / 25) * 25);

    var dT = st.fluid - st.ambient;
    function at(t_mm) {
      var t = t_mm / 1000;
      var U = FD.thermal.lossPerMetreK(st.od / 1000, t, st.k, st.h);
      var q = U * dT;                          // W/m, signed with the fluid
      var r_o = r_pipe + t;
      /* Surface temperature: the outside film carries the same heat, so
       *     T_s = T_amb + q / (2.pi.r_o.h)
       * with q signed the same way. This is the number to compare against the
       * dew point on a chilled system. */
      var Ts = st.ambient + q / (2 * Math.PI * r_o * st.h);
      return { U: U, q: q, Ts: Ts, t: t_mm };
    }

    return {
      r_pipe_mm: r_pipe * 1000,
      r_cr_mm: r_cr * 1000,
      tCrit_mm: tCrit,
      binds: tCrit > 0,
      tRound_mm: tRound,
      bare: at(0),
      atRound: at(tRound),
      dT: dT
    };
  }

  function renderCritical(host, r) {
    if (r.error) {
      var e = el('div', 'notice warn-notice');
      e.appendChild(el('p', '', r.error));
      host.appendChild(e);
      return;
    }
    host.appendChild(el('h3', '', 'Result'));

    var ro = el('div', 'readout');
    function kv(k, v) {
      var row = el('div', 'kv');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      ro.appendChild(row);
    }
    kv('Pipe radius', r.r_pipe_mm.toFixed(2) + ' mm');
    kv('Critical radius  r_cr = k/h', r.r_cr_mm.toFixed(2) + ' mm');
    kv('Critical thickness', r.binds
      ? r.tCrit_mm.toFixed(2) + ' mm'
      : 'none — the pipe is already larger than r_cr');
    kv('Rounded thickness', r.tRound_mm.toFixed(0) + ' mm');
    host.appendChild(ro);

    var verdict = el('div', 'notice ' + (r.binds ? 'warn-notice' : 'info-notice'));
    verdict.appendChild(el('p', 'notice-head',
      r.binds ? 'The critical radius BINDS on this pipe'
              : 'The critical radius does not bind'));
    verdict.appendChild(el('p', '', r.binds
      ? 'This pipe is smaller than r_cr, so a thin layer of insulation would ' +
        'INCREASE the heat loss. Go past ' + r.tCrit_mm.toFixed(1) + ' mm or do ' +
        'not insulate at all.'
      : 'The pipe is already larger than r_cr = ' + r.r_cr_mm.toFixed(2) + ' mm, ' +
        'so any thickness reduces the loss and more is always better. This is ' +
        'the normal case for building services pipework — the critical radius ' +
        'matters for thin wires and small tubes.'));
    host.appendChild(verdict);

    var t = el('table', 'sheet');
    t.innerHTML = '<thead><tr><th class="txt"></th><th>Thickness (mm)</th>' +
                  '<th>Loss (W/m·K)</th><th>Heat flow (W/m)</th>' +
                  '<th>Surface temp (°C)</th></tr></thead>';
    var tb = el('tbody');
    [['Bare', r.bare], ['At rounded thickness', r.atRound]].forEach(function (pair) {
      var tr = el('tr');
      tr.appendChild(el('td', 'txt', pair[0]));
      tr.appendChild(el('td', '', pair[1].t.toFixed(0)));
      tr.appendChild(el('td', '', pair[1].U.toFixed(3)));
      tr.appendChild(el('td', '', (pair[1].q >= 0 ? '+' : '') + pair[1].q.toFixed(1)));
      tr.appendChild(el('td', '', pair[1].Ts.toFixed(2)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    host.appendChild(t);

    host.appendChild(el('p', 'legend',
      'Heat flow is signed with the FLUID: negative loses heat, positive gains ' +
      'it. Surface temperature is the number to compare against your DEW POINT ' +
      'on a chilled system — condensation control usually governs the thickness, ' +
      'and it is a different calculation from this one, needing the room’s ' +
      'humidity which this app does not hold.'));
    host.appendChild(el('p', 'legend',
      'r_cr = k/h contains NO temperature. Ambient and fluid temperature set ' +
      'the heat flow and the surface temperature above, but they cannot move ' +
      'the critical radius: doubling the temperature difference doubles the ' +
      'heat flow at every radius and shifts the turning point not at all.'));
  }

  /* ==================================================== PIPE VELOCITY & FRICTION
   *
   * Q3, Michael: "enter any two, get the third."
   *
   * The three are FLOW, BORE and VELOCITY, tied by the only relation there is:
   *
   *     Q = v · A,   A = π·d²/4
   *
   * Whichever two are filled in, the third follows — and the friction gradient
   * follows from all three, through the same `FD.hydraulics` the model uses, so
   * the tool and the network can never give different answers for the same
   * pipe. That is the whole reason it reads the app's friction method and fluid
   * rather than carrying its own.
   *
   * THE THIRD IS COMPUTED, NEVER TYPED. Filling in all three would state a
   * relation that is over-determined and usually wrong; the box for the derived
   * one is read-only and says which it is.
   *
   * SIZING FALLS OUT OF IT. Give a flow and the velocity you are prepared to
   * run at, and the bore you get back is the bore you need — so the nearest
   * schedule size above it is the answer to "what do I pick?", and that is
   * shown beside it.
   */
  var velState = null;
  function velDefaults() {
    return { known: 'qv', flow: '4', bore: '', vel: '1.5', result: null };
  }

  function renderVelocityTool(host, app) {
    var m = app.model, d = m.settings.display;
    if (!velState) velState = velDefaults();
    var st = velState;

    host.appendChild(el('h3', '', 'Pipe velocity & friction'));

    /* SOLVE FOR, naming the OUTPUT rather than the inputs — Michael,
     * 2026-08-09. "Flow + velocity → bore" made you read a sentence to find the
     * one word you were choosing. */
    var SOLVE = [['qv', 'Pipe diameter'], ['qd', 'Velocity'], ['dv', 'Flow']];
    var pick = el('select');
    SOLVE.forEach(function (o) {
      var opt = el('option', '', o[1]); opt.value = o[0];
      if (o[0] === st.known) opt.selected = true;
      pick.appendChild(opt);
    });
    field(host, 'Solve for', pick);
    pick.addEventListener('change', function () {
      st.known = pick.value; st.result = null; render(app);
    });

    function box(key, label, unit, derived) {
      var i = num(st[key] === null || st[key] === undefined ? '' : st[key]);
      if (derived) {
        i.readOnly = true;
        i.value = (st.result && st.result[key] !== null && st.result[key] !== undefined)
          ? fmt(st.result[key]) : '';
        i.placeholder = 'calculated';
      }
      field(host, label + ' (' + unit + ')', i);
      if (!derived) {
        i.addEventListener('input', function () { st[key] = i.value; });
        i.addEventListener('change', function () { st[key] = i.value; });
      }
    }

    /* THE ONE BEING SOLVED FOR GOES LAST, so the eye runs inputs → answer. */
    var FIELDS = {
      flow: ['flow', 'Flow', d.flow],
      bore: ['bore', 'Pipe diameter', 'mm'],
      vel:  ['vel', 'Velocity', 'm/s']
    };
    var solved = { qv: 'bore', qd: 'vel', dv: 'flow' }[st.known];
    ['flow', 'bore', 'vel'].filter(function (k) { return k !== solved; })
      .concat([solved])
      .forEach(function (k) {
        var f = FIELDS[k];
        box(f[0], f[1], f[2], k === solved);
      });

    var row = el('div', 'btn-row');
    var go = el('button', 'btn primary', 'Calculate');
    go.addEventListener('click', function () {
      st.result = velocity(st, m);
      render(app);
    });
    var reset = el('button', 'btn', 'Reset');
    reset.addEventListener('click', function () { velState = velDefaults(); render(app); });
    row.appendChild(go); row.appendChild(reset);
    host.appendChild(row);

    if (st.result) renderVelocityResult(host, st.result, m);
  }

  /* The arithmetic, separated from the form so it can be tested with no DOM.
   * SI throughout; the display units are converted at the edges only. */
  function velocity(st, m) {
    var d = m.settings.display;
    var out = { flow: null, bore: null, vel: null, errors: [] };
    var fluid = FD.fluids.resolve(m.settings);

    var qIn = FD.units.parse(st.flow), dIn = FD.units.parse(st.bore),
        vIn = FD.units.parse(st.vel);
    var Q = isFinite(qIn) ? FD.units.toSIFlow(qIn, d.flow) : NaN;   // m3/s
    var D = isFinite(dIn) ? dIn / 1000 : NaN;                        // m
    var V = isFinite(vIn) ? vIn : NaN;                               // m/s

    if (st.known === 'qv') {
      if (!(Q > 0) || !(V > 0)) { out.errors.push('Enter a flow and a velocity, both above zero.'); return out; }
      D = Math.sqrt(4 * Q / (Math.PI * V));
      out.bore = D * 1000;
    } else if (st.known === 'qd') {
      if (!(Q > 0) || !(D > 0)) { out.errors.push('Enter a flow and a bore, both above zero.'); return out; }
      V = Q / (Math.PI * D * D / 4);
      out.vel = V;
    } else {
      if (!(D > 0) || !(V > 0)) { out.errors.push('Enter a bore and a velocity, both above zero.'); return out; }
      Q = V * Math.PI * D * D / 4;
      out.flow = Q;
    }

    out.Q = Q; out.D = D; out.V = V;

    /* THE GRADIENT COMES OUT OF THE APP'S OWN HYDRAULICS, assembled exactly as
     * `network.build` assembles it for a pipe: the same method, the same
     * context, the same C. A tool that re-derives friction is a second
     * implementation, and the two disagree the day one of them is edited.
     *
     * One metre of pipe with no fittings, so `r` IS the resistance per metre
     * and `pdPerMetre` returns the gradient directly. */
    var s2 = m.settings;
    var ctx = {
      hw: s2.hw, ashrae: s2.ashrae, fluid: s2.fluid,
      frictionFactor: s2.dw && s2.dw.frictionFactor,
      roughness_mm: s2.dw && s2.dw.roughness_mm,
      q: Q
    };
    var method = FD.hydraulics.method(s2.frictionMethod);
    var nExp = FD.hydraulics.exponent(s2.frictionMethod, ctx);
    var r1 = method.r(1, D, s2.C, ctx);
    out.pdm = FD.hydraulics.pdPerMetre(r1, Q, nExp, 1, fluid.density);
    out.method = s2.frictionMethod;

    /* Reynolds takes the FLOW, not the velocity — it derives the velocity from
     * the bore itself. */
    out.Re = FD.hydraulics.reynolds(Q, D, fluid.kinematicViscosity);
    out.regime = FD.hydraulics.isLaminar(out.Re) ? 'laminar'
               : FD.hydraulics.isTransitional(out.Re) ? 'transitional' : 'turbulent';
    out.velHead = V * V / (2 * FD.units.G);

    /* THE SIZE YOU WOULD ACTUALLY BUY. A calculated bore is a number; the pipe
     * on the shelf is the answer. `sizeForFlow` is the schedule's own rule —
     * the same one the sizer uses — so the tool cannot recommend a size the
     * model would not have chosen. */
    if (FD.schedules && FD.schedules.sizeForFlow && Q > 0 && V > 0) {
      var lbl = FD.schedules.sizeForFlow(s2.schedule, Q, V, m.customSchedules);
      var sz = lbl && FD.schedules.size(s2.schedule, lbl, m.customSchedules);
      if (sz) out.pick = { name: lbl, bore: sz.id_mm / 1000 };
    }
    return out;
  }

  function renderVelocityResult(host, r, m) {
    var d = m.settings.display;
    if (r.errors.length) {
      var w = el('div', 'notice warn-notice');
      r.errors.forEach(function (t) { w.appendChild(el('p', '', t)); });
      host.appendChild(w);
      return;
    }
    var box = el('div', 'readout');
    function kv(k, v) {
      var row = el('div', 'kv');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      box.appendChild(row);
    }
    kv('Flow', FD.units.fmtFlow(r.Q, d.flow, true));
    kv('Bore', (r.D * 1000).toFixed(1) + ' mm');
    kv('Velocity', r.V.toFixed(3) + ' m/s');
    kv('Velocity head', r.velHead.toFixed(3) + ' m');
    kv('Reynolds', Math.round(r.Re).toLocaleString() + '  (' + r.regime + ')');
    kv('Friction gradient', FD.units.fmtPdm(r.pdm, d.pdm, true));
    kv('Over 100 m', FD.units.fmtPressure(r.pdm * 100, d.pressure, true));
    if (r.pick) {
      kv('Nearest size up', r.pick.name + '  (' + (r.pick.bore * 1000).toFixed(1) + ' mm)');
    }
    host.appendChild(box);
    if (r.regime === 'laminar') {
    }
  }

  /* ============================================================ HEAT TRANSFER
   *
   * Q = ṁ·Cp·ΔT, the most-used line in building services, with the same
   * "any two give the third" shape as the velocity tool — and the same relation
   * the equipment panel enforces between capacity, design flow and ΔT.
   */
  var heatState = null;
  function heatDefaults() {
    return { known: 'qdt', duty: '50', flow: '', dT: '5', result: null };
  }

  function renderHeatTool(host, app) {
    var m = app.model, d = m.settings.display;
    if (!heatState) heatState = heatDefaults();
    var st = heatState;
    var fluid = FD.fluids.resolve(m.settings);

    host.appendChild(el('h3', '', 'Heat transfer'));
    if (!fluid.verified) {
      var nv = el('div', 'notice warn-notice');
      nv.appendChild(el('p', '', fluid.name + ': these fluid properties are NOT ' +
        'verified against a printed table.'));
      host.appendChild(nv);
    }

    var pick = el('select');
    [['qdt', 'Flow'], ['qf', '\u0394T'], ['fdt', 'Duty']].forEach(function (o) {
      var opt = el('option', '', o[1]); opt.value = o[0];
      if (o[0] === st.known) opt.selected = true;
      pick.appendChild(opt);
    });
    field(host, 'Solve for', pick);
    pick.addEventListener('change', function () {
      st.known = pick.value; st.result = null; render(app);
    });

    function box(key, label, unit, derived) {
      var i = num(st[key] === null || st[key] === undefined ? '' : st[key]);
      if (derived) {
        i.readOnly = true;
        i.value = (st.result && st.result[key] !== null && st.result[key] !== undefined)
          ? fmt(st.result[key]) : '';
        i.placeholder = 'calculated';
      }
      field(host, label + ' (' + unit + ')', i);
      if (!derived) {
        i.addEventListener('input', function () { st[key] = i.value; });
        i.addEventListener('change', function () { st[key] = i.value; });
      }
    }
    var FIELDS = {
      duty: ['duty', 'Duty', 'kW'],
      flow: ['flow', 'Flow', d.flow],
      dT:   ['dT', '\u0394T', 'K']
    };
    var solved = { qdt: 'flow', qf: 'dT', fdt: 'duty' }[st.known];
    ['duty', 'flow', 'dT'].filter(function (k) { return k !== solved; })
      .concat([solved])
      .forEach(function (k) {
        var f = FIELDS[k];
        box(f[0], f[1], f[2], k === solved);
      });

    var row = el('div', 'btn-row');
    var go = el('button', 'btn primary', 'Calculate');
    go.addEventListener('click', function () { st.result = heat(st, m); render(app); });
    var reset = el('button', 'btn', 'Reset');
    reset.addEventListener('click', function () { heatState = heatDefaults(); render(app); });
    row.appendChild(go); row.appendChild(reset);
    host.appendChild(row);

    if (st.result) {
      var r = st.result;
      if (r.errors.length) {
        var wbox = el('div', 'notice warn-notice');
        r.errors.forEach(function (t) { wbox.appendChild(el('p', '', t)); });
        host.appendChild(wbox);
      } else {
        var out = el('div', 'readout');
        function kv(k, v) {
          var rr = el('div', 'kv');
          rr.appendChild(el('span', 'k', k));
          rr.appendChild(el('span', 'v', v));
          out.appendChild(rr);
        }
        kv('Duty', (r.Q / 1000).toFixed(2) + ' kW');
        kv('Flow', FD.units.fmtFlow(r.q, d.flow, true));
        kv('Mass flow', r.mdot.toFixed(3) + ' kg/s');
        kv('\u0394T', r.dTv.toFixed(2) + ' K');
        kv('Capacity rate', (r.C).toFixed(0) + ' W/K');
        host.appendChild(out);
      }
    }
  }

  function heat(st, m) {
    var d = m.settings.display;
    var fluid = FD.fluids.resolve(m.settings);
    var rho = fluid.density, cp = fluid.specificHeat;
    var out = { duty: null, flow: null, dT: null, errors: [] };

    var qIn = FD.units.parse(st.duty), fIn = FD.units.parse(st.flow),
        tIn = FD.units.parse(st.dT);
    var Q = isFinite(qIn) ? qIn * 1000 : NaN;                        // W
    var q = isFinite(fIn) ? FD.units.toSIFlow(fIn, d.flow) : NaN;    // m3/s
    var dT = isFinite(tIn) ? tIn : NaN;                              // K

    if (st.known === 'qdt') {
      if (!isFinite(Q) || Q === 0 || !(Math.abs(dT) > 0)) {
        out.errors.push('Enter a duty and a ΔT, neither of them zero.'); return out;
      }
      q = Math.abs(Q) / (rho * cp * Math.abs(dT));
      out.flow = FD.units.flow(q, d.flow);
    } else if (st.known === 'qf') {
      if (!isFinite(Q) || Q === 0 || !(q > 0)) {
        out.errors.push('Enter a duty and a flow, neither of them zero.'); return out;
      }
      dT = Math.abs(Q) / (rho * q * cp);
      out.dT = dT;
    } else {
      if (!(q > 0) || !(Math.abs(dT) > 0)) {
        out.errors.push('Enter a flow and a ΔT, neither of them zero.'); return out;
      }
      Q = rho * q * cp * dT;
      out.duty = Q / 1000;
    }
    out.Q = Math.abs(Q); out.q = q; out.dTv = Math.abs(dT);
    out.mdot = rho * q;
    out.C = rho * q * cp;
    return out;
  }

  /* ==================================================================== CONVERT
   *
   * Michael, 2026-08-09. TWO WAY: type in either box and the other follows, so
   * there is no direction to choose and no button to press. That is the whole
   * behaviour — a converter you have to tell which way round to go is a form,
   * not a converter.
   *
   * THE TWO TEMPERATURE ROWS ARE DIFFERENT CONVERSIONS and are separate rows
   * for that reason. An ABSOLUTE temperature carries the 32° offset;
   * a DIFFERENCE does not — 5 K is 9 °F of difference, not 41. Putting them in
   * one row with a units dropdown is how a ΔT of 5 K becomes 41 °F on a
   * schedule, so they are named and kept apart.
   *
   * The pressure and flow factors come from `FD.units`, which is where the rest
   * of the app converts, so the tool cannot drift from the drawing. mm Hg and
   * ft wg are the two this app does not otherwise use; they are stated here
   * against the same SI base (Pa) as the others.
   */
  var CONV_PRESSURE = [
    ['kPa', 1000], ['bar', 100000], ['psi', 6894.757], ['m H2O', 9806.65],
    ['mm Hg', 133.3224], ['ft wg', 2989.067]
  ];
  var CONV_FLOW = [
    ['L/s', 0.001], ['L/min', 0.001 / 60], ['m³/h', 1 / 3600], ['gpm (US)', 0.0000630902]
  ];

  var convState = null;
  function convDefaults() {
    return {
      cAbs: '20', fAbs: '', absLast: 'c',
      cDif: '5', fDif: '', difLast: 'c',
      pFrom: 'kPa', pTo: 'psi', pA: '100', pB: '', pLast: 'a',
      qFrom: 'L/s', qTo: 'm³/h', qA: '4', qB: '', qLast: 'a'
    };
  }

  function factorOf(table, name) {
    for (var i = 0; i < table.length; i++) if (table[i][0] === name) return table[i][1];
    return 1;
  }

  /* Every row is the same shape: two boxes and, where it makes sense, a unit
   * beside each. Whichever box was typed in last is the SOURCE, so a value the
   * user entered is never rewritten under their hands by a rounded round trip. */
  function convRow(host, opts) {
    var wrap = el('div', 'conv-row');
    wrap.appendChild(el('div', 'conv-title', opts.title));

    var line = el('div', 'conv-line');
    function side(which) {
      var cell = el('div', 'conv-cell');
      if (opts.units) {
        var sel = el('select');
        opts.units.forEach(function (u) {
          var o = el('option', '', u[0]); o.value = u[0];
          if (u[0] === opts.unitOf(which)) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          opts.setUnit(which, sel.value); opts.recompute(); opts.rerender();
        });
        cell.appendChild(sel);
      } else {
        cell.appendChild(el('span', 'conv-unit', opts.labelOf(which)));
      }
      var i = num(opts.valueOf(which));
      i.addEventListener('input', function () {
        opts.setValue(which, i.value);
        opts.recompute();
        opts.rerender();
      });
      cell.appendChild(i);
      return cell;
    }
    line.appendChild(side('a'));
    line.appendChild(el('span', 'conv-eq', '='));
    line.appendChild(side('b'));
    wrap.appendChild(line);
    host.appendChild(wrap);
  }

  function renderConvertTool(host, app) {
    if (!convState) convState = convDefaults();
    var st = convState;
    var rr = function () { render(app); };

    host.appendChild(el('h3', '', 'Convert'));

    /* ---- ABSOLUTE TEMPERATURE. F = C×9/5 + 32 */
    convRow(host, {
      title: 'Temperature (absolute)',
      labelOf: function (w) { return w === 'a' ? '°C' : '°F'; },
      valueOf: function (w) { return w === 'a' ? st.cAbs : st.fAbs; },
      setValue: function (w, v) {
        if (w === 'a') { st.cAbs = v; st.absLast = 'c'; }
        else { st.fAbs = v; st.absLast = 'f'; }
      },
      recompute: function () {
        if (st.absLast === 'c') {
          var c = FD.units.parse(st.cAbs);
          st.fAbs = isFinite(c) ? fmt(c * 9 / 5 + 32) : '';
        } else {
          var f = FD.units.parse(st.fAbs);
          st.cAbs = isFinite(f) ? fmt((f - 32) * 5 / 9) : '';
        }
      },
      rerender: rr
    });

    /* ---- A DIFFERENCE. No offset: 1 K is 1.8 °F of difference. */
    convRow(host, {
      title: 'Temperature difference (ΔT)',
      labelOf: function (w) { return w === 'a' ? 'K / °C' : '°F'; },
      valueOf: function (w) { return w === 'a' ? st.cDif : st.fDif; },
      setValue: function (w, v) {
        if (w === 'a') { st.cDif = v; st.difLast = 'c'; }
        else { st.fDif = v; st.difLast = 'f'; }
      },
      recompute: function () {
        if (st.difLast === 'c') {
          var c = FD.units.parse(st.cDif);
          st.fDif = isFinite(c) ? fmt(c * 9 / 5) : '';
        } else {
          var f = FD.units.parse(st.fDif);
          st.cDif = isFinite(f) ? fmt(f * 5 / 9) : '';
        }
      },
      rerender: rr
    });

    /* ---- PRESSURE and FLOW: both ends pick their own unit. */
    function scaled(table, fromKey, toKey, aKey, bKey, lastKey, title) {
      convRow(host, {
        title: title,
        units: table,
        unitOf: function (w) { return w === 'a' ? st[fromKey] : st[toKey]; },
        setUnit: function (w, u) { if (w === 'a') st[fromKey] = u; else st[toKey] = u; },
        valueOf: function (w) { return w === 'a' ? st[aKey] : st[bKey]; },
        setValue: function (w, v) {
          if (w === 'a') { st[aKey] = v; st[lastKey] = 'a'; }
          else { st[bKey] = v; st[lastKey] = 'b'; }
        },
        recompute: function () {
          var fa = factorOf(table, st[fromKey]), fb = factorOf(table, st[toKey]);
          if (st[lastKey] === 'a') {
            var a = FD.units.parse(st[aKey]);
            st[bKey] = isFinite(a) ? fmt(a * fa / fb) : '';
          } else {
            var b = FD.units.parse(st[bKey]);
            st[aKey] = isFinite(b) ? fmt(b * fb / fa) : '';
          }
        },
        rerender: rr
      });
    }
    scaled(CONV_PRESSURE, 'pFrom', 'pTo', 'pA', 'pB', 'pLast', 'Pressure');
    scaled(CONV_FLOW, 'qFrom', 'qTo', 'qA', 'qB', 'qLast', 'Flow');

    var row = el('div', 'btn-row');
    var reset = el('button', 'btn', 'Reset');
    reset.addEventListener('click', function () { convState = convDefaults(); rr(); });
    row.appendChild(reset);
    host.appendChild(row);
  }

  // ---------------------------------------------------------------- rendering
  /* Q2, Michael: four tools, one at a time, chosen from a tab strip.
   *
   * They used to be stacked down a full-width pane, which worked while there
   * were two of them and does not with four — and the window they now live in
   * is 400 px wide, so stacking would put the tool you want three screens down.
   * One at a time, and the strip says what else is there. */
  var TABS = [
    { key: 'pump',  label: 'Pump curve',   render: renderPumpCurveTool },
    { key: 'crit',  label: 'Critical radius', render: renderCriticalTool },
    { key: 'vel',   label: 'Velocity & friction', render: renderVelocityTool },
    { key: 'heat',  label: 'Heat transfer', render: renderHeatTool },
    { key: 'conv',  label: 'Convert',       render: renderConvertTool }
  ];

  function render(app) {
    var host = document.getElementById('tools-body');
    var strip = document.getElementById('tools-tabs');
    if (!host) return;
    ensureState();
    if (!TABS.some(function (t) { return t.key === state.tab; })) state.tab = 'pump';

    if (strip) {
      strip.innerHTML = '';
      TABS.forEach(function (t) {
        var b = el('button', 'tool-tab' + (t.key === state.tab ? ' active' : ''), t.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          state.tab = t.key;
          render(app);
        });
        strip.appendChild(b);
      });
    }
    host.innerHTML = '';
    TABS.forEach(function (t) { if (t.key === state.tab) t.render(host, app); });
  }

  /* Arrive from a pump with its design duty already in the boxes.
   *
   * The generator's first two questions are the design flow and pressure, and
   * a pump that needs a curve has just been sized to exactly those. Values are
   * strings in the caller's DISPLAY units, which is what the tool works in
   * throughout (see generate()) — no conversion happens on the way in. Any
   * previous result is cleared: it belonged to the old design point. */
  function prefill(qDesign, hDesign) {
    ensureState();
    state.qDesign = qDesign;
    state.hDesign = hDesign;
    state.result = null;
  }

  function ensureState() {
    if (!state) {
      state = {
        qDesign: null, hDesign: null,
        fp1Flow: DEFAULTS.fp1Flow, fp1Press: DEFAULTS.fp1Press,
        fp2Flow: DEFAULTS.fp2Flow, fp2Press: DEFAULTS.fp2Press,
        result: null,
        tab: 'pump'
      };
    }
  }

  FD.tools = {
    render: render,
    generate: generate,
    prefill: prefill,
    critical: critical,
    velocity: velocity,
    heat: heat,
    convert: { pressure: CONV_PRESSURE, flow: CONV_FLOW },
    _reset: function () { state = null; critState = null; velState = null;
                          heatState = null; convState = null; }
  };
})(window.FD = window.FD || {});
