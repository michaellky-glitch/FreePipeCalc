/* FreePipeCalc — the shipped example models
 *
 * The catalogue only. Nothing here loads anything: it names the four files in
 * `examples/` and gives each a readable name, so a document can ask for one by
 * key and `app.js` can refuse anything that is not on this list.
 *
 * WHY A HARD-CODED LIST RATHER THAN A DIRECTORY READ. A static site cannot
 * list a directory — there is no server-side index to ask — so the list has
 * to be written down somewhere. It is written down HERE rather than in
 * `app.js` so a test can read it without a DOM, and `model.test.js` pins every
 * entry: the file must exist, and it must load through `M.fromJSON`. A stale
 * row cannot survive the suite.
 *
 * `file` is the name under `examples/`, and it is also what the tutorials and
 * `engine.html` quote to the reader, so it must match those pages exactly.
 * Do not rename one without the other.
 */
(function (FD) {
  'use strict';

  /* NAME AND FILE, AND NOTHING ELSE.
   *
   * It carried a blurb and a size flag while EXAMPLES was a ribbon button and
   * the picker had to describe each model. The picker is gone (see `app.js`),
   * the descriptions now live in the user manual beside the buttons that open
   * them, and a second copy here would be a second thing to keep true. The
   * `name` stays because it is what the toast and the discard prompt say, and
   * "Tutorial 01 - Basics.json" is not a sentence.
   *
   * `file` is the name under `examples/`, and it is also what the tutorials,
   * `engine.html` and every `data-model` attribute quote, so it must match
   * those pages exactly. Do not rename one without the others — `model.test.js`
   * checks all of it, both ways. */
  FD.examples = [
    { file: 'Tutorial 01 - Basics.json',           name: 'Tutorial 01 — Basics' },
    { file: 'Tutorial 02 - Hydronic System.json',  name: 'Tutorial 02 — Hydronic System' },
    { file: 'GGA example.json',                    name: 'GGA example' },
    { file: 'Data Hall & Yard.json',               name: 'Data Hall & Yard' }
  ];

  /* The folder every `file` above is relative to. Separated so a caller never
   * has to know the layout, and so the tests can join it the same way. */
  FD.examplesDir = 'examples/';

})(window.FD = window.FD || {});
