/* FreePipeCalc — Belimo PICV sizes, against the printed data sheets.
 * Run:  node test/picv.test.js
 *
 * The numbers in `data/picv.js` were transcribed by eye from two PDFs, which is
 * exactly the step that goes wrong quietly. They get the same discipline as the
 * Idel'chik tee diagrams: individual cells asserted against the page.
 *
 * THE SHEETS CARRY THEIR OWN CHECK. Each prints V'nom three times — l/s, l/min
 * and m3/h — so the columns are redundant and a mistyped digit shows up as a
 * mismatch between them. Every row is checked that way below.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['data/picv.js']);
const P = FD.picv;

section('Belimo EP..R2+BAC — EPIV, threaded, PN 25');
{
  const r = P.ranges.epiv;
  ok('six sizes, DN15 to DN50', r.sizes.length === 6, String(r.sizes.length));
  ok('PN 25', r.pn === 25, String(r.pn));
  /* "Close-off pressure  dps 1400 kPa" and "Differential pressure dpmax 350 kPa". */
  near('close-off is 1400 kPa', r.dpClose, 1400e3, 1);
  near('maximum differential is 350 kPa', r.dpMax, 350e3, 1);
  near('low-noise differential is 200 kPa', r.dpLowNoise, 200e3, 1);
  ok("V'max adjusts down to 25%", r.vmaxMinPct === 25, String(r.vmaxMinPct));

  /* The Type Overview table, row by row: DN, V'nom [m3/h], Kvs theor. [m3/h]. */
  const page = [
    [15, 'EP015R2+BAC', 1.5, 3.2],
    [20, 'EP020R2+BAC', 2.5, 5.3],
    [25, 'EP025R2+BAC', 3.5, 8.8],
    [32, 'EP032R2+BAC', 6, 14.1],
    [40, 'EP040R2+BAC', 10, 19.2],
    [50, 'EP050R2+BAC', 15, 30.4]
  ];
  page.forEach(([dn, model, m3h, kvs]) => {
    const e = P.bySize(dn);
    ok(`DN${dn} is ${model}`, e && e.model === model, e && e.model);
    near(`DN${dn} Kvs theor. is ${kvs}`, e.kvs, kvs, 1e-9);
    near(`DN${dn} V'nom is ${m3h} m3/h`, e.vnom * 3600, m3h, 0.005);
  });
}

section('Belimo EV..F+BAC — Energy Valve, flanged, PN 16');
{
  const r = P.ranges.energy;
  ok('five sizes, DN65 to DN150', r.sizes.length === 5, String(r.sizes.length));
  ok('PN 16', r.pn === 16, String(r.pn));
  /* "Close-off pressure dps 690 kPa" and "Differential pressure dpmax 340 kPa". */
  near('close-off is 690 kPa', r.dpClose, 690e3, 1);
  near('maximum differential is 340 kPa', r.dpMax, 340e3, 1);
  ok("V'max adjusts down to 30%", r.vmaxMinPct === 30, String(r.vmaxMinPct));

  const page = [
    [65,  'EV065F+BAC', 28.8, 50],
    [80,  'EV080F+BAC', 39.6, 75],
    [100, 'EV100F+BAC', 72, 127],
    [125, 'EV125F+BAC', 111.6, 195],
    [150, 'EV150F+BAC', 162, 254]
  ];
  page.forEach(([dn, model, m3h, kvs]) => {
    const e = P.bySize(dn);
    ok(`DN${dn} is ${model}`, e && e.model === model, e && e.model);
    near(`DN${dn} Kvs theor. is ${kvs}`, e.kvs, kvs, 1e-9);
    near(`DN${dn} V'nom is ${m3h} m3/h`, e.vnom * 3600, m3h, 0.005);
  });
}

section('The sheets’ own redundancy — l/s against m3/h');
{
  /* Printed l/s for every row, in the sheets' order. If a Kvs or a V'nom was
   * mistyped this is where it shows, because these came off a different column
   * of the same page. */
  const printedLs = [0.42, 0.69, 0.97, 1.67, 2.78, 4.17,   // EPIV
                     8, 11, 20, 31, 45];                    // Energy Valve
  ok('one l/s figure per size', printedLs.length === P.sizes.length,
     printedLs.length + ' vs ' + P.sizes.length);
  P.sizes.forEach((s, i) => {
    /* The sheet rounds l/s to 2 dp, so 6 thousandths of a l/s is the tolerance
     * a correct transcription must sit inside. */
    near(`DN${s.dn}: ${printedLs[i]} l/s agrees with ${(s.vnom * 3600)} m3/h`,
         s.vnom * 1000, printedLs[i], 0.006);
  });
}

section('Shape of the range');
{
  ok('eleven sizes in all', P.sizes.length === 11, String(P.sizes.length));
  ok('ascending by size', P.sizes.every((s, i) => i === 0 || s.dn > P.sizes[i - 1].dn));
  /* A bigger valve must pass more and resist less. Both columns are monotonic
   * on the page, and a swapped pair would break this without breaking any
   * single-cell assertion above. */
  ok('Kvs rises with size',
     P.sizes.every((s, i) => i === 0 || s.kvs > P.sizes[i - 1].kvs));
  ok("V'nom rises with size",
     P.sizes.every((s, i) => i === 0 || s.vnom > P.sizes[i - 1].vnom));
  /* The two ranges meet without a gap or an overlap: EPIV ends at DN50, the
   * Energy Valve starts at DN65, so the list reads as one selection. */
  ok('EPIV covers DN15-50, Energy Valve DN65-150',
     P.sizes.filter(s => s.range === 'epiv').every(s => s.dn <= 50) &&
     P.sizes.filter(s => s.range === 'energy').every(s => s.dn >= 65));

  /* THE SANITY CHECK THAT MATTERS FOR SIZING. At its own nominal flow, the
   * pressure drop through the Kvs is dP = (Q/Kvs)^2 bar. For a control element
   * that should land in the tens of kPa — enough authority to control with,
   * nowhere near the 340-350 kPa the valves are rated to take. */
  P.sizes.forEach(s => {
    const dpBar = Math.pow(s.vnom * 3600 / s.kvs, 2);
    ok(`DN${s.dn} drops a sensible ${(dpBar * 100).toFixed(1)} kPa at V'nom`,
       dpBar * 1e5 > 10e3 && dpBar * 1e5 < 60e3, (dpBar * 100).toFixed(1) + ' kPa');
    ok(`DN${s.dn} is well inside its own dP rating`,
       dpBar * 1e5 < s.dpMax, (dpBar * 100).toFixed(1) + ' vs ' + s.dpMax / 1000);
  });
}

section('Lookup');
{
  ok('an unlisted size returns null', P.bySize(90) === null);
  ok('a nonsense size returns null', P.bySize('banana') === null);
  ok('DN50 label resolves', (P.forPipeSize('DN50') || {}).dn === 50);
  ok('DN100 label resolves', (P.forPipeSize('DN100') || {}).dn === 100);
  /* A NON-DN LABEL HAS NO PICV ROW. An HDPE "110 mm" is an outside diameter,
   * and picking a DN off it would invent a product selection. */
  ok('a non-DN label resolves to nothing', P.forPipeSize('110 mm') === null);
  ok('DN90 has no PICV in these ranges', P.forPipeSize('DN90') === null);
  ok('the source names both sheets',
     /EP\.\.R2\+BAC/.test(P.source) && /EV\.\.F\+BAC/.test(P.source), P.source);
}

report();
