/* FreePipeCalc — printed level plans (spec §10.1)
 *
 * Generates one black-on-white SVG plan per level, for printing at one page
 * per level. SVG rather than canvas: it stays crisp at any page size, prints
 * as vector, and costs nothing in file size.
 *
 * Every level is drawn with the SAME transform, derived from the bounding box
 * of the whole building. That means a fixed scale across all sheets (as
 * requested) and, because the origin is shared too, the sheets physically
 * overlay — hold two pages up to the light and the risers line up.
 */
(function (FD) {
  'use strict';

  var M = FD.model;

  // Page geometry in SVG user units (A4 landscape proportions).
  var PAGE_W = 1050;
  var PAGE_H = 742;
  var PAD = 40;
  var TITLE_H = 58;

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /* Bounding box of every node on every level, in world coordinates. */
  function worldBounds(m) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    m.nodes.forEach(function (n) {
      var w = M.worldXY(m, n);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
    });
    m.risers.forEach(function (r) {
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
      minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
    });
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    // never let a degenerate (single-point or single-line) model divide by zero
    if (maxX - minX < 1) { minX -= 0.5; maxX += 0.5; }
    if (maxY - minY < 1) { minY -= 0.5; maxY += 0.5; }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /* One transform shared by every level: autofit the whole building once. */
  function fitTransform(m) {
    var b = worldBounds(m);
    var availW = PAGE_W - PAD * 2;
    var availH = PAGE_H - PAD * 2 - TITLE_H;
    var scale = Math.min(availW / (b.maxX - b.minX), availH / (b.maxY - b.minY));
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return {
      scale: scale,
      x: function (wx) { return PAGE_W / 2 + (wx - cx) * scale; },
      y: function (wy) { return (PAGE_H + TITLE_H) / 2 - (wy - cy) * scale; }
    };
  }

  function pipeLabel(m, p, results) {
    var a = m.settings.annotate, d = m.settings.display;
    var link = (results && results.network)
      ? results.network.links.find(function (l) { return l.id === p.id; }) : null;
    var q = results && results.flow ? results.flow[p.id] : undefined;

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
  }

  /* Render one level as an <svg> element. */
  function levelPlan(m, level, tf, results) {
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + PAGE_W + ' ' + PAGE_H,
      class: 'plan',
      xmlns: 'http://www.w3.org/2000/svg'
    });
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: PAGE_W, height: PAGE_H, fill: '#fff' }));

    var a = m.settings.annotate;

    // ---- title strip ----
    var meta = m.settings.meta;
    var t1 = svgEl('text', { x: PAD, y: 30, 'font-size': 19, 'font-weight': '700', fill: '#000' });
    t1.textContent = level.name + '   ' + (level.altitude >= 0 ? '+' : '') +
                     level.altitude.toFixed(2) + ' m';
    svg.appendChild(t1);

    var t2 = svgEl('text', { x: PAD, y: 49, 'font-size': 12, fill: '#333' });
    t2.textContent = [meta.project || 'Untitled project', meta.system, meta.engineer,
                      meta.revision ? 'Rev ' + meta.revision : '']
                     .filter(Boolean).join('  ·  ');
    svg.appendChild(t2);

    var t3 = svgEl('text', { x: PAGE_W - PAD, y: 30, 'font-size': 12, fill: '#333',
                             'text-anchor': 'end' });
    t3.textContent = FD.APP_NAME + ' ' + FD.VERSION + '  ·  ' +
                     (meta.date || new Date().toISOString().slice(0, 10));
    svg.appendChild(t3);

    svg.appendChild(svgEl('line', { x1: PAD, y1: TITLE_H, x2: PAGE_W - PAD, y2: TITLE_H,
                                    stroke: '#000', 'stroke-width': 1 }));

    // ---- pipes ----
    m.pipes.forEach(function (p) {
      var na = M.node(m, p.a), nb = M.node(m, p.b);
      if (!na || !nb) return;
      if (na.level !== level.id || nb.level !== level.id) return;   // risers drawn separately

      var wa = M.worldXY(m, na), wb = M.worldXY(m, nb);
      var x1 = tf.x(wa.x), y1 = tf.y(wa.y), x2 = tf.x(wb.x), y2 = tf.y(wb.y);
      var bore = M.pipeBore(m, p) * 1000;
      var width = Math.max(1, Math.min(4, 1 + bore / 60));

      svg.appendChild(svgEl('line', {
        x1: x1, y1: y1, x2: x2, y2: y2,
        stroke: '#000', 'stroke-width': width, 'stroke-linecap': 'round'
      }));

      var label = pipeLabel(m, p, results);
      var len = Math.hypot(x2 - x1, y2 - y1);
      if (label && len > label.length * 5.2) {
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
        if (Math.abs(ang) > 90) ang += 180;
        var tx = svgEl('text', {
          x: mx, y: my - 5, 'font-size': 10, fill: '#000', 'text-anchor': 'middle',
          transform: 'rotate(' + ang.toFixed(2) + ' ' + mx.toFixed(2) + ' ' + my.toFixed(2) + ')'
        });
        tx.textContent = label;
        svg.appendChild(tx);
      }
    });

    // ---- riser columns ----
    m.risers.forEach(function (r) {
      var here = r.attachments.some(function (att) { return att.level === level.id; });
      var c = svgEl('circle', {
        cx: tf.x(r.x), cy: tf.y(r.y), r: 7,
        fill: 'none', stroke: '#000', 'stroke-width': here ? 2 : 1
      });
      if (!here) c.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(c);
    });

    // ---- nodes ----
    m.nodes.forEach(function (n) {
      if (n.level !== level.id) return;
      var w = M.worldXY(m, n);
      var x = tf.x(w.x), y = tf.y(w.y);
      var dev = n.device;

      if (dev && dev.kind === 'source') {
        svg.appendChild(svgEl('polygon', {
          points: [x + ',' + (y - 8), (x + 7) + ',' + (y + 5), (x - 7) + ',' + (y + 5)].join(' '),
          fill: '#000'
        }));
      } else if (dev && dev.kind === 'demand') {
        svg.appendChild(svgEl('circle', {
          cx: x, cy: y, r: 5,
          fill: dev.include === false ? '#fff' : '#000', stroke: '#000', 'stroke-width': 1.5
        }));
      } else if (M.pipesAt(m, n.id).length > 2) {
        svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, fill: '#000' }));
      }

      var parts = [];
      if (a.nodeNumbers) parts.push(n.id);
      if (a.fitType) {
        var code = FD.network.nodeTypeCode(m, n.id);
        if (code) parts.push(code);
      }
      if (parts.length) {
        var tx = svgEl('text', { x: x, y: y + 16, 'font-size': 9.5, fill: '#000',
                                 'text-anchor': 'middle' });
        tx.textContent = parts.join(' ');
        svg.appendChild(tx);
      }
    });

    // ---- scale bar ----
    var barTarget = 120 / tf.scale;
    var pow = Math.pow(10, Math.floor(Math.log10(barTarget)));
    var mult = [1, 2, 5, 10].find(function (k) { return pow * k >= barTarget; }) || 10;
    var barM = pow * mult, barPx = barM * tf.scale;
    var bx = PAD, by = PAGE_H - 22;
    svg.appendChild(svgEl('path', {
      d: 'M' + bx + ',' + (by - 6) + ' L' + bx + ',' + by + ' L' + (bx + barPx) + ',' + by +
         ' L' + (bx + barPx) + ',' + (by - 6),
      fill: 'none', stroke: '#000', 'stroke-width': 1.2
    }));
    var st = svgEl('text', { x: bx + barPx + 8, y: by + 3, 'font-size': 10, fill: '#000' });
    st.textContent = barM + ' m   (1:' + Math.round(1000 / tf.scale) * 1 + ' approx)';
    svg.appendChild(st);

    var dis = svgEl('text', { x: PAGE_W - PAD, y: PAGE_H - 22, 'font-size': 8.5, fill: '#444',
                              'text-anchor': 'end' });
    dis.textContent = 'For preliminary design assistance only. Verify results. No warranty; no liability.';
    svg.appendChild(dis);

    return svg;
  }

  /* Build all level plans into the hidden print container. */
  function renderPlans(m, results) {
    var host = document.getElementById('print-plans');
    host.innerHTML = '';
    var tf = fitTransform(m);

    m.levels.forEach(function (lv) {
      var page = document.createElement('div');
      page.className = 'plan-page';
      page.appendChild(levelPlan(m, lv, tf, results));
      host.appendChild(page);
    });
    return m.levels.length;
  }

  FD.printer = {
    renderPlans: renderPlans,
    levelPlan: levelPlan,
    fitTransform: fitTransform,
    worldBounds: worldBounds
  };
})(window.FD = window.FD || {});
