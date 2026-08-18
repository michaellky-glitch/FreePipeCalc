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

  var IN_LINE_KIND = { pump: true, valve: true, equip: true, sensor: true };

  /* The value box an in-line device shows on screen, rebuilt for the page.
   * Kept deliberately short — the plan is a drawing, and the numbers behind it
   * are in the calculation sheet. */
  function deviceLines(m, p, flags, results) {
    var d = m.settings.display, out = [];
    var q = results && results.flow ? results.flow[p.id] : undefined;
    /* A tag switched off does not print either — that is most of the point of
     * switching it off. `tagVisible` is the one definition, shared with the
     * canvas, so the paper and the screen cannot disagree. */
    if (flags.tag && p.tag && M.tagVisible(p)) out.push(p.tag);
    if (flags.flow && q !== undefined) {
      out.push('Q ' + FD.units.fmtFlow(Math.abs(q), d.flow, true));
    }
    if (flags.head && p.pump) {
      var h = M.pumpHead(m, p, Math.abs(q || 0));
      out.push('H ' + FD.units.fmtPressure(
        FD.units.headToPaWith(h, m.settings.fluid.density), d.pressure, true));
    }
    if (flags.vfd && p.pump && p.pump.mode !== 'off') {
      out.push('VFD ' + Math.round(M.pumpSpeed(m, p) * 100) + '%');
    }
    if (flags.opening && p.valve && p.valve.opening !== undefined) {
      out.push(Math.round(p.valve.opening) + '% open');
    }
    var tl = results && results.thermal && results.thermal.links[p.id];
    if (tl) {
      if (flags.temp) out.push(tl.tIn.toFixed(1) + ' \u2192 ' + tl.tOut.toFixed(1) + '\u00b0C');
      if (flags.dT) out.push('\u0394T ' + (tl.dT >= 0 ? '+' : '') + tl.dT.toFixed(1) + ' K');
      if (flags.duty) {
        out.push((tl.qW < 0 ? 'Cool ' : 'Heat ') + (Math.abs(tl.qW) / 1000).toFixed(1) + ' kW');
      }
    }
    return out;
  }

  function pipeLabel(m, p, results) {
    var a = m.settings.annotate, d = m.settings.display;
    var link = (results && results.network)
      ? results.network.links.find(function (l) { return l.id === p.id; }) : null;
    var q = results && results.flow ? results.flow[p.id] : undefined;

    var parts = [];
    /* A PIPE'S OWN NAME, first, exactly as the canvas draws it. `pipeLabelText`
     * puts `p.tag` at the head of the label and this did not, so a named run
     * (CHW-S-01) was on screen and missing from the printed plan. Same
     * `tagVisible` rule — a tag switched off does not print either. */
    if (p.tag && M.tagVisible(p)) parts.push(p.tag);
    /* DOWNSTREAM FIXTURE UNITS, plumbing only — the same annotation the canvas
     * draws, and it was missing here, so the printed plan dropped a label the
     * screen was showing (Michael, 2026-08-18). `res.byPipe` only exists on a
     * plumbing report, so the branch is inert in a hydronic file. */
    if (a.pipeFU && m.discipline === 'plumbing' &&
        results && results.byPipe && results.byPipe[p.id]) {
      parts.push(results.byPipe[p.id].fu.toFixed(1) + 'FU');
    }
    if (a.pipeDiameter) parts.push(FD.units.sizeLabel(p.size, d.size));
    if (a.pipeLength) parts.push(FD.units.fmtLength(M.pipeLength(m, p), d.length) +
                                 (d.length === 'm' ? 'm' : 'ft'));
    if (a.pipeFlow && q !== undefined) parts.push(FD.units.fmtFlow(Math.abs(q), d.flow) + d.flow);
    if (a.pipeVelocity && link && q !== undefined) {
      parts.push(FD.hydraulics.velocity(q, link._d).toFixed(2) + 'm/s');
    }
    if (a.pipePD && link && q !== undefined) {
      var pd = FD.units.headToPaWith(Math.abs(FD.hydraulics.linkLoss(link, q)),
                                     m.settings.fluid && m.settings.fluid.density);
      parts.push(FD.units.fmtPressure(pd, d.pressure) + d.pressure);
    }
    // Friction rate, same basis as the canvas label and the PDM warning.
    if (a.pipePDM && link && q !== undefined && link._L > 1e-9) {
      var pdm = FD.hydraulics.pdPerMetre(link._rActual, q, link.n, link._L,
                                         m.settings.fluid && m.settings.fluid.density);
      parts.push(FD.units.fmtPdm(pdm, d.pdm) + d.pdm);
    }
    return parts.join('/');
  }

  /* Render one level as an <svg> element. */
  /* THE PALETTE, for print. Detail lines carry a palette NAME, and the plan is
   * black on white — so the screen theme's colours would be unreadable. Mapped
   * to print-safe equivalents instead of dropped, because the colour is usually
   * carrying a distinction (a room outline against a plant box). */
  var PRINT_COLOUR = {
    line: '#444', ok: '#0a7a3d', warn: '#a06000',
    error: '#b21f2d', accent: '#12509e', select: '#12509e'
  };

  function levelPlan(m, level, tf, results, view) {
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
    /* THE SAME NOTATION AS THE SCREEN: a circle on the connection, a leader out
     * to a box, and inside it a chevron for the flow direction and a bar across
     * whichever end the column terminates at. `M.riserNotation` decides; this
     * only draws. The paper and the screen go through the one definition so
     * they cannot disagree. */
    m.risers.forEach(function (r) {
      var here = r.attachments.some(function (att) { return att.level === level.id; });
      var x0 = tf.x(r.x), y0 = tf.y(r.y);
      var R = 7, GAP = 10, BOX = 20, k = Math.SQRT1_2;
      var c = svgEl('circle', {
        cx: x0, cy: y0, r: R,
        fill: 'none', stroke: '#000', 'stroke-width': here ? 1.4 : 0.8
      });
      if (!here) c.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(c);

      var bx = x0 + (R + GAP) * k, by = y0 + (R + GAP) * k;
      var lead = svgEl('line', {
        x1: x0 + R * k, y1: y0 + R * k, x2: bx, y2: by,
        stroke: '#000', 'stroke-width': here ? 1.2 : 0.7
      });
      if (!here) lead.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(lead);
      var box = svgEl('rect', {
        x: bx, y: by, width: BOX, height: BOX,
        fill: 'none', stroke: '#000', 'stroke-width': here ? 1.2 : 0.7
      });
      if (!here) box.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(box);

      var note = M.riserNotation
        ? M.riserNotation(m, r, level.id, results && results.flow) : null;
      if (!note) return;
      var cx = bx + BOX / 2, cy = by + BOX / 2;
      var W = 10, H = 5.5, G = 2.5;
      var up = (note.dir === 'up');
      function chev(yTop) {
        svg.appendChild(svgEl('polyline', {
          points: up
            ? [(cx - W / 2) + ',' + (yTop + H), cx + ',' + yTop,
               (cx + W / 2) + ',' + (yTop + H)].join(' ')
            : [(cx - W / 2) + ',' + yTop, cx + ',' + (yTop + H),
               (cx + W / 2) + ',' + yTop].join(' '),
          fill: 'none', stroke: '#000', 'stroke-width': 1.4
        }));
      }
      function bar(y) {
        svg.appendChild(svgEl('line', {
          x1: cx - W / 2 - 1, y1: y, x2: cx + W / 2 + 1, y2: y,
          stroke: '#000', 'stroke-width': 1.4
        }));
      }
      if (note.dir === null) {
        if (note.capTop) bar(cy - H / 2 - G);
        if (note.capBottom) bar(cy + H / 2 + G);
      } else if (note.up && note.down) {
        chev(cy - H - G / 2); chev(cy + G / 2);
      } else if (note.capTop) {
        bar(cy - H / 2 - G); chev(cy - H / 2 + 1);
      } else {
        chev(cy - H / 2 - 1); bar(cy + H / 2 + G);
      }
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

    /* ================================================ AS SHOWN ON SCREEN
     *
     * Michael, 2026-08-07: "Printing should print the system as-shown (Whatever
     * tags, control links) which are visible at the time of printing."
     *
     * The plan used to draw pipework, nodes and pipe labels and nothing else,
     * so every device tag, every value box and every control link — the things
     * that make a drawing say what it is FOR — were on screen and absent from
     * the paper. `view` carries the switches the ribbon holds; without one, the
     * model's own settings still decide the rest. */
    var showControl = !view || view.showControl !== false;

    // ---- detail lines: drawn UNDER everything, as on screen ----
    (m.details || []).forEach(function (d) {
      if (d.level !== level.id || !d.pts || d.pts.length < 2) return;
      svg.insertBefore(svgEl('polyline', {
        points: d.pts.map(function (q) {
          return tf.x(q.x).toFixed(2) + ',' + tf.y(q.y).toFixed(2);
        }).join(' '),
        fill: 'none',
        stroke: PRINT_COLOUR[d.colour] || PRINT_COLOUR.line,
        'stroke-width': d.width || 1.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }), svg.firstChild.nextSibling);
    });

    // ---- in-line device tags and their value boxes ----
    m.pipes.forEach(function (p) {
      if (!IN_LINE_KIND[p.kind]) return;
      var na = M.node(m, p.a), nb = M.node(m, p.b);
      if (!na || !nb || na.level !== level.id || nb.level !== level.id) return;
      var mid = M.deviceMid(m, p);
      if (!mid) return;
      var x = tf.x(mid.x), y = tf.y(mid.y);

      var flags = M.displayFlags(p);
      var lines = deviceLines(m, p, flags, results);
      if (p.tag && !flags.tag && M.tagVisible(p)) lines.unshift(p.tag);
      if (!lines.length) return;
      var off = M.labelOffset(p, 'box');
      lines.forEach(function (t, i) {
        var tx = svgEl('text', {
          x: x + 10 + (off.dx || 0), y: y - 6 + (off.dy || 0) + i * 11,
          'font-size': 9.5, fill: '#000'
        });
        tx.textContent = t;
        svg.appendChild(tx);
      });
    });

    // ---- control links and differential routes ----
    if (showControl) {
      m.pipes.forEach(function (p) {
        /* PER FLOOR, so a link that changes floor prints its own half on each
         * plan with the riser where the two meet — the same thing the canvas
         * draws. `controlRoute` returns null for a floor the link has nothing
         * to do with, which is the whole of the filtering that used to be
         * written out here. */
        var r = M.controlRoute(m, p, level.id);
        if (r) {
          svg.appendChild(svgEl('polyline', {
            points: r.points.map(function (q) {
              return tf.x(q.x).toFixed(2) + ',' + tf.y(q.y).toFixed(2);
            }).join(' '),
            fill: 'none', stroke: '#0a7a3d', 'stroke-width': 1,
            'stroke-dasharray': '6,4'
          }));
          var span = M.controlSpan(m, p);
          var e = r.points[r.points.length - 1];
          if (!(span && level.id === span.device)) {
            svg.appendChild(svgEl('circle', {
              cx: tf.x(e.x), cy: tf.y(e.y), r: 3,
              fill: 'none', stroke: '#0a7a3d', 'stroke-width': 1
            }));
          }
          if (span) {
            var far = (level.id === span.device) ? span.targetPipe : p;
            var fl = M.level(m, (level.id === span.device) ? span.target : span.device);
            svg.appendChild(svgEl('circle', {
              cx: tf.x(span.riser.x), cy: tf.y(span.riser.y), r: 5,
              fill: '#fff', stroke: '#0a7a3d', 'stroke-width': 1.5
            }));
            var rt = svgEl('text', {
              x: tf.x(span.riser.x) + 9, y: tf.y(span.riser.y) + 3,
              'font-size': 8, fill: '#0a7a3d'
            });
            rt.textContent = '\u2191 ' + (far.tag || far.id) +
                             (fl ? ' (' + (fl.name || fl.id) + ')' : '');
            svg.appendChild(rt);
          }
        }
        var sr = M.sensorRoute(m, p);
        if (sr) {
          var rp = M.pipe(m, p.sensor.ref);
          var nr = rp && M.node(m, rp.a), ns = M.node(m, p.a);
          if (nr && ns && nr.level === level.id && ns.level === level.id) {
            svg.appendChild(svgEl('polyline', {
              points: sr.points.map(function (q) {
                return tf.x(q.x).toFixed(2) + ',' + tf.y(q.y).toFixed(2);
              }).join(' '),
              fill: 'none', stroke: '#a06000', 'stroke-width': 1,
              'stroke-dasharray': '2,3'
            }));
            [sr.points[0], sr.points[sr.points.length - 1]].forEach(function (q) {
              svg.appendChild(svgEl('rect', {
                x: tf.x(q.x) - 3.5, y: tf.y(q.y) - 3.5, width: 7, height: 7,
                fill: 'none', stroke: '#a06000', 'stroke-width': 1
              }));
            });
            var c2 = { x: (sr.midSeg[0].x + sr.midSeg[1].x) / 2,
                       y: (sr.midSeg[0].y + sr.midSeg[1].y) / 2 };
            svg.appendChild(svgEl('circle', {
              cx: tf.x(c2.x), cy: tf.y(c2.y), r: 8,
              fill: '#fff', stroke: '#a06000', 'stroke-width': 1.2
            }));
            var lt = svgEl('text', { x: tf.x(c2.x), y: tf.y(c2.y) + 3,
                                     'font-size': 8, fill: '#a06000',
                                     'text-anchor': 'middle' });
            lt.textContent = p.sensor.mode === 'dT' ? '\u0394T' : '\u0394P';
            svg.appendChild(lt);
          }
        }
      });
    }

    // ---- text notes, on top of everything ----
    (m.notes || []).forEach(function (n) {
      if (n.level !== level.id) return;
      String(n.text || '').split('\n').forEach(function (t, i) {
        var tx = svgEl('text', {
          x: tf.x(n.x), y: tf.y(n.y) + i * ((n.size || 13) * 1.05),
          'font-size': (n.size || 13) * 0.8,
          fill: PRINT_COLOUR[n.colour] || '#000'
        });
        tx.textContent = t;
        svg.appendChild(tx);
      });
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
    /* The calibrated bar only. The "1:NNN approx" ratio alongside it invited
     * being read as a drawing scale, which it is not — it depends on how the
     * page is printed. The bar is measurable on the paper; the ratio was not. */
    st.textContent = barM + ' m';
    svg.appendChild(st);

    var dis = svgEl('text', { x: PAGE_W - PAD, y: PAGE_H - 22, 'font-size': 8.5, fill: '#444',
                              'text-anchor': 'end' });
    dis.textContent = 'Disclaimer: All calculation results generated by this software must be ' +
      'independently verified and validated by a qualified professional engineer prior to use. ' +
      'The software is provided "as is," without express or implied warranties of any kind, ' +
      'including merchantability or fitness for a particular purpose.';
    svg.appendChild(dis);

    return svg;
  }

  /* Build all level plans into the hidden print container. */
  function renderPlans(m, results, view) {
    var host = document.getElementById('print-plans');
    host.innerHTML = '';
    var tf = fitTransform(m);

    m.levels.forEach(function (lv) {
      var page = document.createElement('div');
      page.className = 'plan-page';
      page.appendChild(levelPlan(m, lv, tf, results, view));
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
