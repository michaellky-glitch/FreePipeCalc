/* FreePipeCalc — the shipped example models
 *
 * The catalogue only. Nothing here loads anything: it names the files in
 * `examples/` and says what each one is, so the picker can be built without
 * reading 122 kB off the disk to find out.
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

  FD.examples = [
    {
      file: 'Tutorial 01 - Basics.json',
      name: 'Tutorial 01 — Basics',
      blurb: 'One level, a source and a short branched run — the smallest ' +
             'complete design. The finished model from the tutorial.',
      scale: 'small'
    },
    {
      file: 'Tutorial 02 - Hydronic System.json',
      name: 'Tutorial 02 — Hydronic System',
      blurb: 'Six levels and two riser columns, saved in Simulation with ' +
             'Darcy-Weisbach. The finished model from the tutorial.',
      scale: 'small'
    },
    {
      file: 'GGA example.json',
      name: 'GGA example',
      blurb: 'Eleven pipes and three outflows — small enough to check by ' +
             'hand, and the worked example in DOCUMENTATION ▸ Engine.',
      scale: 'small'
    },
    {
      file: 'Data Hall & Yard.json',
      name: 'Data Hall & Yard',
      blurb: 'Four levels, 278 pipes, fifty riser columns. A real-sized ' +
             'model, and it is slow on purpose: the solve is minutes of ' +
             'genuine work, not a hang.',
      /* The one flag the picker acts on. The data hall's simulation is 634
       * control solves and takes tens of seconds on this machine — long
       * enough that a user who was not told would reach for the reload. */
      scale: 'large'
    }
  ];

  /* The folder every `file` above is relative to. Separated so a caller never
   * has to know the layout, and so the tests can join it the same way. */
  FD.examplesDir = 'examples/';

})(window.FD = window.FD || {});
