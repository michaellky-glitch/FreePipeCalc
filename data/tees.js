/* FreePipeCalc — tee loss coefficients as a function of the flow ratio.
 *
 * SOURCE: I.E. Idel'chik, "Handbook of Hydraulic Resistance — Coefficients of
 * Local Resistance and of Friction", translated from Russian, AEC-TR-6630
 * (1966). Section Seven, "Stream junctions and divisions (resistance
 * coefficients of wyes, tees, and crosses)".
 *
 *   Diagram 7-25  Standard threaded malleable-iron DIVERGING tee, a = 90 deg
 *   Diagram 7-16  Standard threaded malleable-iron CONVERGING tee, a = 90 deg
 *
 * Both are of type Fs + Fb > Fc with Fs = Fc — the branch is a take-off from a
 * through-run of constant section, which is what this program's geometry
 * detector produces. They are the threaded malleable-iron fitting specifically,
 * not a generic wye, so they are the right page for the fittings this app
 * charges.
 *
 * REFERENCED TO THE COMMON-CHANNEL VELOCITY. Idel'chik's own symbol list
 * (Section 7-1) defines these as "resistance coefficients of the branch and the
 * main passage expressed in terms of the velocity in the common channel", so
 *
 *     dH = zeta_c * (w_c^2 / 2g)
 *
 * and a caller working in the frame of one leg must convert:
 *
 *     zeta_i = zeta_c * (w_c/w_i)^2 = zeta_c * (Q_c/Q_i)^2 * (A_i/A_c)^2
 *
 * That conversion is the whole of the reference-velocity problem recorded in
 * `docs_internal/TEE-LOSSES.md` section 3.2, and it is exact. Getting it wrong —
 * dropping a combined-velocity number into an equivalent-length slot in each
 * leg — is what defeated the earlier attempt.
 *
 * TRANSCRIPTION NOTE, and it matters. The 1966 scan OCRs its tables as COLUMN
 * blocks, not rows, and prints columns 0.6-1.0 physically ABOVE the "Values of
 * zeta" caption that introduces columns 0.1-0.5. The arrays below are
 * de-scrambled into ROW order (one row per area ratio, ten columns of flow
 * ratio). `test/tees.test.js` asserts individual cells against the printed page
 * so the de-scrambling is checkable rather than trusted.
 *
 * NEGATIVE VALUES ARE REAL, not a transcription error. In a converging tee the
 * faster stream gives kinetic energy to the slower one, so one leg can show an
 * energy gain; Idel'chik section 7-2 states it explicitly and the total loss
 * across the fitting stays positive.
 */
(function (FD) {
  'use strict';

  /* Flow ratio Qb/Qc — the column headings of both diagrams. */
  var QRATIO = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  /* Area ratio Fb/Fc — the row headings of both diagrams. */
  var ARATIO = [0.09, 0.19, 0.27, 0.35, 0.44, 0.55, 1.00];

  /* Diagram 7-25, branch: zeta_c.b for a DIVIDING (diverging) tee. */
  var DIVIDING_BRANCH = [
    [2.80, 4.50, 6.00, 7.88, 9.40, 11.1, 13.0, 15.8, 20.0, 24.7],   // Fb/Fc 0.09
    [1.41, 2.00, 2.50, 3.20, 3.97, 4.95, 6.50, 8.45, 10.8, 13.3],   //        0.19
    [1.37, 1.81, 2.30, 2.83, 3.40, 4.07, 4.80, 6.00, 7.18, 8.90],   //        0.27
    [1.10, 1.54, 1.90, 2.35, 2.73, 3.22, 3.80, 4.32, 5.28, 6.53],   //        0.35
    [1.22, 1.45, 1.67, 1.89, 2.11, 2.38, 2.58, 3.04, 3.84, 4.75],   //        0.44
    [1.09, 1.20, 1.40, 1.59, 1.65, 1.77, 1.94, 2.20, 2.68, 3.30],   //        0.55
    [0.90, 1.00, 1.13, 1.20, 1.40, 1.50, 1.60, 1.80, 2.06, 2.30]    //        1.00
  ];

  /* Diagram 7-16, branch: zeta_c.b for a COMBINING (converging) tee. */
  var COMBINING_BRANCH = [
    [-0.50, 2.97, 9.90, 19.7, 32.4, 48.8, 66.5, 86.9, 110, 136],    // Fb/Fc 0.09
    [-0.53, 0.53, 2.14, 4.23, 7.30, 11.4, 15.6, 20.3, 25.8, 31.8],  //        0.19
    [-0.69, 0.00, 1.11, 2.18, 3.76, 5.90, 8.38, 11.3, 14.6, 18.4],  //        0.27
    [-0.65, -0.09, 0.59, 1.31, 2.24, 3.52, 5.20, 7.28, 9.23, 12.2], //        0.35
    [-0.80, -0.27, 0.26, 0.84, 1.59, 2.66, 4.00, 5.73, 7.40, 9.12], //        0.44
    [-0.83, -0.48, 0.00, 0.53, 1.15, 1.89, 2.92, 4.00, 5.36, 6.60], //        0.55
    [-0.65, -0.40, -0.24, 0.10, 0.50, 0.83, 1.13, 1.47, 1.86, 2.30] //        1.00
  ];

  /* Linear interpolation on a sorted axis, clamped at both ends.
   *
   * CLAMPED, NOT EXTRAPOLATED. Off the end of a measured table there is no
   * data, and a straight line drawn past the last point of a curve that is
   * visibly steepening would invent a number nobody measured. The 0.09 row is
   * already a 30:1 area ratio; anything smaller is not a tee anyone details. */
  function span(axis, v) {
    if (!(v > axis[0])) return { i: 0, j: 0, t: 0 };
    var last = axis.length - 1;
    if (v >= axis[last]) return { i: last, j: last, t: 0 };
    for (var i = 0; i < last; i++) {
      if (v <= axis[i + 1]) {
        return { i: i, j: i + 1, t: (v - axis[i]) / (axis[i + 1] - axis[i]) };
      }
    }
    return { i: last, j: last, t: 0 };
  }

  /* zeta for the BRANCH, referenced to the common-channel velocity.
   *
   *   qRatio  Qb/Qc, the share of the combined flow the branch carries
   *   aRatio  Fb/Fc, DERIVED FROM THE BORES (Michael, 2026-08-30) — the model
   *           knows both diameters, so the area ratio is not a guess.
   *   dividing  true for one-in-two-out, false for two-in-one-out
   *
   * Bilinear between the two axes. */
  function branchK(qRatio, aRatio, dividing) {
    var table = dividing ? DIVIDING_BRANCH : COMBINING_BRANCH;
    if (!isFinite(qRatio) || !isFinite(aRatio)) return null;
    var a = span(ARATIO, aRatio);
    var q = span(QRATIO, qRatio);
    function row(r) {
      return table[r][q.i] + (table[r][q.j] - table[r][q.i]) * q.t;
    }
    var lo = row(a.i), hi = row(a.j);
    return lo + (hi - lo) * a.t;
  }

  FD.tees = {
    qRatios: QRATIO,
    areaRatios: ARATIO,
    dividingBranch: DIVIDING_BRANCH,
    combiningBranch: COMBINING_BRANCH,
    branchK: branchK,
    source: 'Idel’chik, Handbook of Hydraulic Resistance, AEC-TR-6630 (1966), ' +
            'Section VII, Diagrams 7-25 (diverging) and 7-16 (converging) — ' +
            'standard threaded malleable-iron tee, α = 90°, ' +
            'Fs + Fb > Fc with Fs = Fc. Referenced to the common-channel velocity.'
  };
})(window.FD = window.FD || {});
