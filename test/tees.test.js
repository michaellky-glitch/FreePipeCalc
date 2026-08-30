/* FreePipeCalc — Idel'chik tee coefficients, against the printed page.
 * Run:  node test/tees.test.js
 *
 * The numbers in `data/tees.js` were transcribed from a 1966 scan whose OCR
 * emits the tables as COLUMN blocks and prints the 0.6–1.0 columns physically
 * above the caption introducing 0.1–0.5. De-scrambling that by eye is exactly
 * the sort of step that goes wrong quietly, so the corner and interior cells
 * are asserted here against the page — the same discipline the ASHRAE K tables
 * get in engine.test.js.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['data/tees.js']);
const T = FD.tees;

section('Idel’chik Diagram 7-25 — diverging tee, branch');
{
  const t = T.dividingBranch;
  ok('seven area-ratio rows', t.length === 7, String(t.length));
  ok('ten flow-ratio columns', t.every(r => r.length === 10),
     t.map(r => r.length).join(','));

  /* The four corners of the printed grid. */
  near('Fb/Fc 0.09, Qb/Qc 0.1 is 2.80', t[0][0], 2.80, 1e-9);
  near('Fb/Fc 0.09, Qb/Qc 1.0 is 24.7', t[0][9], 24.7, 1e-9);
  near('Fb/Fc 1.00, Qb/Qc 0.1 is 0.90', t[6][0], 0.90, 1e-9);
  near('Fb/Fc 1.00, Qb/Qc 1.0 is 2.30', t[6][9], 2.30, 1e-9);
  /* Interior cells, one per row, to catch a shifted column. */
  near('row 0.19 at 0.5 is 3.97', t[1][4], 3.97, 1e-9);
  near('row 0.27 at 0.8 is 6.00', t[2][7], 6.00, 1e-9);
  near('row 0.35 at 0.3 is 1.90', t[3][2], 1.90, 1e-9);
  near('row 0.44 at 0.6 is 2.38', t[4][5], 2.38, 1e-9);
  near('row 0.55 at 0.9 is 2.68', t[5][8], 2.68, 1e-9);

  /* SHAPE. A diverging branch always costs something, and costs more as it
   * takes more of the flow and as it gets narrower relative to the main. */
  ok('every diverging value is positive', t.every(r => r.every(v => v > 0)));
  ok('each row rises with the flow ratio',
     t.every(r => r.every((v, i) => i === 0 || v >= r[i - 1])),
     'a row is not monotonic');
  ok('a narrower branch costs more at the same flow ratio',
     t.every((r, i) => i === 0 || r[9] <= t[i - 1][9]),
     'the last column is not ordered by area ratio');
}

section('Idel’chik Diagram 7-16 — converging tee, branch');
{
  const t = T.combiningBranch;
  ok('seven area-ratio rows', t.length === 7, String(t.length));
  ok('ten flow-ratio columns', t.every(r => r.length === 10),
     t.map(r => r.length).join(','));

  near('Fb/Fc 0.09, Qb/Qc 0.1 is -0.50', t[0][0], -0.50, 1e-9);
  near('Fb/Fc 0.09, Qb/Qc 1.0 is 136', t[0][9], 136, 1e-9);
  near('Fb/Fc 1.00, Qb/Qc 0.1 is -0.65', t[6][0], -0.65, 1e-9);
  near('Fb/Fc 1.00, Qb/Qc 1.0 is 2.30', t[6][9], 2.30, 1e-9);
  near('row 0.19 at 0.4 is 4.23', t[1][3], 4.23, 1e-9);
  near('row 0.27 at 0.2 is 0.00', t[2][1], 0.00, 1e-9);
  near('row 0.35 at 0.7 is 5.20', t[3][6], 5.20, 1e-9);
  near('row 0.55 at 0.3 is 0.00', t[5][2], 0.00, 1e-9);

  /* NEGATIVE VALUES ARE THE SOURCE'S, NOT A TYPO. Idel'chik §7-2: in a
   * converging tee the faster stream gives kinetic energy to the slower, so one
   * leg shows a gain. Every value at Qb/Qc = 0.1 is negative on this page. */
  ok('the whole first column is negative', t.every(r => r[0] < 0),
     t.map(r => r[0]).join(','));
  ok('...and the last column is positive', t.every(r => r[9] > 0));
  ok('each row rises with the flow ratio',
     t.every(r => r.every((v, i) => i === 0 || v >= r[i - 1])),
     'a row is not monotonic');

  /* A converging branch at a small area ratio is far more expensive than a
   * diverging one — the stream must turn AND merge with flow already moving. */
  ok('converging costs much more than diverging at 0.09 / full flow',
     t[0][9] > T.dividingBranch[0][9] * 4,
     t[0][9] + ' vs ' + T.dividingBranch[0][9]);
}

section('Interpolation on both axes');
{
  /* ON a tabulated point the lookup must return the printed value untouched. */
  near('exact grid point, diverging', T.branchK(0.5, 0.27, true), 3.40, 1e-9);
  near('exact grid point, converging', T.branchK(0.4, 0.35, false), 1.31, 1e-9);

  /* HALFWAY between two columns is the mean of them. */
  near('midway on the flow axis',
       T.branchK(0.25, 0.19, true), (2.00 + 2.50) / 2, 1e-9);
  /* HALFWAY between two rows, at a tabulated column. */
  near('midway on the area axis',
       T.branchK(1.0, (0.44 + 0.55) / 2, true), (4.75 + 3.30) / 2, 1e-9);

  /* CLAMPED, NOT EXTRAPOLATED. Past either end of a measured table there is no
   * data, and a curve that is visibly steepening must not be continued by a
   * straight line. */
  near('below the first area ratio clamps', T.branchK(0.5, 0.01, true), 9.40, 1e-9);
  near('above the last area ratio clamps', T.branchK(0.5, 5.0, true), 1.40, 1e-9);
  near('below the first flow ratio clamps', T.branchK(0.0, 0.27, true), 1.37, 1e-9);
  near('above the last flow ratio clamps', T.branchK(2.0, 0.27, true), 8.90, 1e-9);

  ok('a non-numeric ratio returns null', T.branchK(NaN, 0.5, true) === null);
  ok('the source is recorded on the module', /Idel/.test(T.source), T.source);
}

report();
