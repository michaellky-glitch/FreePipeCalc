/* FreePipeCalc — "Open this model in the editor", for the documents that
 * name a model.
 *
 * Michael, 2026-09-08: "could the examples be at the top of tutorials? So
 * tutorial 1 has a link to open the relevant file in the editor" — and, on the
 * ribbon button this replaced: "the ribbon is already a bit busy and the user
 * will only really use the tutorials a handful of times before not needing
 * them. Not worth a ribbon spot."
 *
 * A document opts in with one attribute on the element the button should join:
 *
 *     <p class="meta" data-model="Tutorial 01 - Basics.json">…</p>
 *
 * The value is the file's name under `examples/`, exactly as `src/examples.js`
 * lists it. Nothing else is needed and no page carries a copy of this logic —
 * the next tutorial adds the attribute and is done.
 *
 * WHY A MESSAGE AND NOT A FUNCTION CALL. These pages are shown INSIDE the app
 * in an iframe, and the frame is a separate opaque origin: it cannot reach into
 * the app, and the app cannot reach into it. `postMessage` crosses that line;
 * nothing else does. The app looks the name up in its own catalogue and opens
 * it, so what travels here is a KEY, never a path.
 *
 * THE BUTTON IS ONLY DRAWN WHERE IT CAN WORK, which is two conditions:
 *
 *   embed=1        there is an app on the other side to listen. Read on its
 *                  own in a browser tab, this page has nobody to talk to.
 *   not file://    the app opens an example by fetching it, and every browser
 *                  blocks fetch on file:// as a cross-origin read.
 *
 * Where either fails the page is left exactly as it was: the sentence still
 * names the file, and LOAD still opens it. A button that does nothing when
 * pressed would be worse than no button.
 */
(function () {
  'use strict';

  var hosts = document.querySelectorAll('[data-model]');
  if (!hosts.length) return;

  var embedded = false;
  try {
    embedded = new URLSearchParams(location.search).get('embed') === '1';
  } catch (e) {
    return;                       // no URLSearchParams, no button; the text stands
  }
  if (!embedded) return;
  if (String(location.protocol).toLowerCase() === 'file:') return;

  /* The style travels with the script so a document only ever adds the
   * attribute. It borrows the variables every documentation page already
   * defines, so it themes itself with the rest of the page. */
  var css = document.createElement('style');
  css.textContent =
    '.open-model{display:inline-block;margin-left:8px;padding:3px 10px;' +
    'font:inherit;font-size:12px;line-height:1.5;cursor:pointer;' +
    'color:var(--accent);background:transparent;' +
    'border:1px solid var(--accent);border-radius:4px}' +
    '.open-model:hover{color:var(--bg);background:var(--accent)}' +
    '.open-model:focus-visible{outline:2px solid var(--accent);outline-offset:2px}';
  document.head.appendChild(css);

  [].forEach.call(hosts, function (host) {
    var file = host.getAttribute('data-model');
    if (!file) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'open-model';
    btn.textContent = 'Open this model in the editor';
    btn.title = 'Loads ' + file + ' onto the canvas. It replaces what is ' +
                'there, and asks first if you have drawn anything.';
    btn.addEventListener('click', function () {
      /* '*' rather than a named origin deliberately: over file:// the parent's
       * origin is the string "null" and cannot be named, and the payload is a
       * catalogue key with nothing private in it. */
      parent.postMessage({ fpc: 'open-example', file: file }, '*');
    });
    host.appendChild(document.createTextNode(' '));
    host.appendChild(btn);
  });
})();
