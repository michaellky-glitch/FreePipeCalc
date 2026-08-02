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
    card.appendChild(el('p', 'hint',
      'Builds a pump curve from three stated duties: the design point plus two ' +
      'fit points given.'));

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

  // ---------------------------------------------------------------- rendering
  function render(app) {
    var host = document.getElementById('tools-body');
    if (!host) return;
    host.innerHTML = '';
    ensureState();
    renderPumpCurveTool(host, app);
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
        result: null
      };
    }
  }

  FD.tools = {
    render: render,
    generate: generate,
    prefill: prefill,
    _reset: function () { state = null; }
  };
})(window.FD = window.FD || {});
