/* FreePipeCalc — in-app dialogs
 *
 * Replaces window.confirm / prompt / alert. Browser popups are jarring, cannot
 * be themed, and on some platforms are suppressed entirely — which would have
 * silently swallowed the "discard current model?" guard. Everything here stays
 * inside the GUI.
 *
 * All functions return a Promise so callers read like the blocking originals:
 *     if (await FD.dialog.confirm({...})) { ... }
 */
(function (FD) {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var openCount = 0;

  /* Core modal. `build(body, resolve)` populates the body and may wire its own
   * controls; `buttons` are rendered in the footer. */
  function modal(opts) {
    return new Promise(function (resolve) {
      var overlay = el('div', 'modal-overlay');
      var box = el('div', 'modal');
      var head = el('div', 'modal-head', opts.title || '');
      var body = el('div', 'modal-body');
      var foot = el('div', 'modal-foot');

      box.appendChild(head);
      box.appendChild(body);
      box.appendChild(foot);
      overlay.appendChild(box);

      var done = false;
      function close(value) {
        if (done) return;
        done = true;
        openCount--;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('out');
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 160);
        resolve(value);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(opts.cancelValue); }
        if (e.key === 'Enter' && opts.submitOnEnter !== false) {
          /* CTRL+ENTER COMMITS FROM A TEXTAREA — Michael, 2026-08-29: an
           * annotation text box needs "a save button or ctrl-enter to commit,
           * or both". The Save button was always there; this is the keyboard
           * half. A PLAIN Enter still inserts a newline, because a note is
           * multi-line by nature and submitting on it would make a two-line
           * note impossible to type. */
          if (e.target && e.target.tagName === 'TEXTAREA') {
            if (!(e.ctrlKey || e.metaKey)) return;
          }
          e.preventDefault();
          close(typeof opts.onSubmit === 'function' ? opts.onSubmit() : true);
        }
      }

      if (opts.message) {
        String(opts.message).split('\n').forEach(function (line) {
          body.appendChild(el('p', '', line));
        });
      }
      if (typeof opts.build === 'function') opts.onSubmit = opts.build(body, close) || opts.onSubmit;

      (opts.buttons || []).forEach(function (b) {
        var btn = el('button', 'btn ' + (b.cls || ''), b.label);
        btn.addEventListener('click', function () {
          close(typeof b.value === 'function' ? b.value() : b.value);
        });
        foot.appendChild(btn);
      });

      // Click the backdrop to dismiss, but never a drag that started inside.
      overlay.addEventListener('pointerdown', function (e) {
        if (e.target === overlay) close(opts.cancelValue);
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      openCount++;

      // focus the first field, else the last (primary) button
      var first = body.querySelector('input, select, textarea');
      setTimeout(function () {
        if (first) { first.focus(); if (first.select) first.select(); }
        else if (foot.lastChild) foot.lastChild.focus();
      }, 20);
    });
  }

  FD.dialog = {
    isOpen: function () { return openCount > 0; },

    /* Replaces alert(). */
    alert: function (opts) {
      return modal({
        title: opts.title || 'Notice',
        message: opts.message,
        cancelValue: true,
        buttons: [{ label: opts.ok || 'OK', cls: 'primary', value: true }]
      });
    },

    /* Replaces confirm(). Resolves true/false. */
    confirm: function (opts) {
      return modal({
        title: opts.title || 'Confirm',
        message: opts.message,
        cancelValue: false,
        onSubmit: function () { return true; },
        buttons: [
          { label: opts.cancel || 'Cancel', value: false },
          { label: opts.ok || 'OK', cls: opts.danger ? 'danger-solid' : 'primary', value: true }
        ]
      });
    },

    /* Replaces prompt(). Resolves the string, or null on cancel. */
    prompt: function (opts) {
      var input;
      return modal({
        title: opts.title || 'Enter a value',
        message: opts.message,
        cancelValue: null,
        build: function (body) {
          input = el('input');
          input.type = opts.type || 'text';
          input.value = opts.value === undefined ? '' : opts.value;
          if (opts.placeholder) input.placeholder = opts.placeholder;
          var f = el('div', 'field');
          if (opts.label) f.appendChild(el('label', '', opts.label));
          f.appendChild(input);
          body.appendChild(f);
          return function () { return input.value; };
        },
        buttons: [
          { label: 'Cancel', value: null },
          { label: opts.ok || 'OK', cls: 'primary', value: function () { return input.value; } }
        ]
      });
    },

    /* Arbitrary set of buttons — for choices that are not yes/no.
     * `buttons`: [{label, value, cls}]. Resolves the chosen value. */
    choose: function (opts) {
      return modal({
        title: opts.title || '',
        message: opts.message,
        cancelValue: opts.cancelValue !== undefined ? opts.cancelValue : null,
        submitOnEnter: false,
        buttons: opts.buttons || []
      });
    },

    /* A read-only report with a copyable body — used for the repair log.
     * `rows` are plain strings; `text` is what Copy puts on the clipboard
     * (defaults to the rows joined by newlines). */
    report: function (opts) {
      var payload = opts.text || (opts.rows || []).join('\n');
      return modal({
        title: opts.title || 'Report',
        message: opts.message,
        cancelValue: true,
        submitOnEnter: false,
        build: function (body) {
          /* Anything the caller wants ABOVE the text — the pump curve chart
           * uses this to put the picture before the numbers. */
          if (opts.prepend) body.appendChild(opts.prepend);
          if (opts.rows && opts.rows.length) {
            var pre = el('pre', 'report-body');
            pre.textContent = opts.rows.join('\n');
            body.appendChild(pre);
          }
          if (opts.footer) body.appendChild(el('p', 'hint', opts.footer));
        },
        buttons: [
          {
            label: 'Copy', cls: '', value: function () {
              copyToClipboard(payload);
              return 'copied';
            }
          },
          { label: 'Close', cls: 'primary', value: true }
        ]
      });
    },

    /* A form of several labelled fields.
     * `fields`: [{key, label, type:'text'|'number'|'select'|'checkbox', value, options}]
     * Resolves an object of values, or null on cancel. */
    form: function (opts) {
      var inputs = {};
      return modal({
        title: opts.title || '',
        message: opts.message,
        cancelValue: null,
        build: function (body) {
          (opts.fields || []).forEach(function (f) {
            var wrap = el('div', 'field');
            var ctrl;
            if (f.type === 'select') {
              ctrl = el('select');
              (f.options || []).forEach(function (o) {
                var op = el('option', '', o[1]);
                op.value = o[0];
                if (String(o[0]) === String(f.value)) op.selected = true;
                ctrl.appendChild(op);
              });
            } else if (f.type === 'textarea') {
              ctrl = el('textarea');
              ctrl.rows = f.rows || 8;
              ctrl.value = f.value === undefined ? '' : f.value;
              if (f.placeholder) ctrl.placeholder = f.placeholder;
            } else if (f.type === 'checkbox') {
              ctrl = el('input');
              ctrl.type = 'checkbox';
              ctrl.checked = !!f.value;
              wrap.className = 'check-inline';
            } else {
              ctrl = el('input');
              ctrl.type = f.type || 'text';
              if (f.step) ctrl.step = f.step;
              ctrl.value = f.value === undefined ? '' : f.value;
            }
            if (f.type === 'checkbox') {
              wrap.appendChild(ctrl);
              wrap.appendChild(el('span', '', f.label));
            } else {
              wrap.appendChild(el('label', '', f.label));
              wrap.appendChild(ctrl);
            }
            inputs[f.key] = ctrl;
            body.appendChild(wrap);
          });
          return collect;
        },
        buttons: [
          { label: 'Cancel', value: null },
          { label: opts.ok || 'Save', cls: 'primary', value: collect }
        ]
      });

      function collect() {
        var out = {};
        Object.keys(inputs).forEach(function (k) {
          var i = inputs[k];
          out[k] = (i.type === 'checkbox') ? i.checked : i.value;
        });
        return out;
      }
    }
  };

  /* Clipboard write, with a fallback for file:// where the async Clipboard API
   * is frequently unavailable or permission-blocked. */
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to the legacy path */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e2) {
      return false;
    }
  }

  FD.dialog.copyToClipboard = copyToClipboard;
})(window.FD = window.FD || {});
