/* FreePipeCalc — control valve sizes, against the printed data sheets.
 * Run:  node test/controlvalves.test.js
 *
 * The numbers in `data/controlvalves.js` were transcribed by eye from
 * manufacturer technical data sheets, which is exactly the step that goes wrong
 * quietly. They get the same discipline as the Idel'chik tee diagrams:
 * individual cells asserted against the page.
 *
 * The sheets themselves are held locally and are deliberately not in this
 * repository; `docs_internal` records which ones. No model or brand names are
 * carried here or in the data module.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['data/controlvalves.js']);
const CV = FD.controlValves;

section('Threaded range, DN20-50 — as printed');
{
  /* Type overview, row by row: DN, Kvs [m3/h], PN. Several coefficients share
   * a nominal size, which is normal and is why the table is a list of products
   * rather than a lookup by size. */
  const page = [
    [20, 4,    40],
    [20, 6.3,  40],
    [25, 25,   40],
    [32, 10,   40],
    [32, 20,   40],
    [32, 25,   25],
    [40, 16,   25],
    [40, 25,   25],
    [40, 40,   25],
    [50, 25,   25],
    [50, 40,   25],
    [50, 58,   25],
    [50, 70,   25]
  ];
  ok('thirteen threaded entries',
     CV.sizes.filter(s => s.body === 'threaded').length === 13,
     String(CV.sizes.filter(s => s.body === 'threaded').length));
  page.forEach(([dn, kvs, pn]) => {
    const e = CV.find(dn, kvs);
    ok(`DN${dn} Kvs ${kvs} is on the sheet`, !!e, 'missing');
    if (e) ok(`DN${dn} Kvs ${kvs} is PN${pn}`, e.pn === pn, String(e.pn));
  });

  const L = CV.limits.threaded;
  near('close-off is 1400 kPa', L.dpClose, 1400e3, 1);
  near('maximum differential is 350 kPa', L.dpMax, 350e3, 1);
  near('low-noise differential is 200 kPa', L.dpLowNoise, 200e3, 1);
}

section('Flanged range, DN65-150 — as printed');
{
  const page = [
    [65,  63,  16],
    [80,  100, 16],
    [100, 140, 16],
    [125, 230, 16],
    [150, 320, 16]
  ];
  ok('five flanged entries',
     CV.sizes.filter(s => s.body === 'flanged').length === 5,
     String(CV.sizes.filter(s => s.body === 'flanged').length));
  page.forEach(([dn, kvs, pn]) => {
    const e = CV.find(dn, kvs);
    ok(`DN${dn} Kvs ${kvs} is on the sheet`, !!e, 'missing');
    if (e) ok(`DN${dn} Kvs ${kvs} is PN${pn}`, e.pn === pn, String(e.pn));
  });

  /* The flanged sheet splits its limits by size: DN150 takes less than the
   * rest. Both figures are carried because using the DN65 number at DN150
   * would overstate what the valve can take. */
  const L = CV.limits.flanged;
  near('DN65-125 close-off is 700 kPa', L.dpClose, 700e3, 1);
  near('DN150 close-off is 400 kPa', L.dpCloseDN150, 400e3, 1);
  near('DN65-125 maximum differential is 350 kPa', L.dpMax, 350e3, 1);
  near('DN150 maximum differential is 250 kPa', L.dpMaxDN150, 250e3, 1);
}

section('Shape of the range');
{
  ok('eighteen valves in all', CV.sizes.length === 18, String(CV.sizes.length));
  ok('ten nominal sizes, DN20 to DN150',
     CV.nominalSizes().join(',') === '20,25,32,40,50,65,80,100,125,150',
     CV.nominalSizes().join(','));
  /* The two bodies meet without a gap or an overlap, so the selector reads as
   * one continuous range. */
  ok('threaded stops at DN50, flanged starts at DN65',
     CV.sizes.filter(s => s.body === 'threaded').every(s => s.dn <= 50) &&
     CV.sizes.filter(s => s.body === 'flanged').every(s => s.dn >= 65));
  ok('every coefficient is positive', CV.sizes.every(s => s.kvs > 0));
  /* THE COEFFICIENT DOES NOT RISE MONOTONICALLY ACROSS THE WHOLE RANGE, and
   * that is the printed data rather than a transcription error. The largest
   * threaded DN50 is Kvs 70; the smallest flanged DN65 is Kvs 63. They are
   * different body styles from different sheets, and a threaded ball valve at
   * its top coefficient genuinely passes more than the next flanged size at its
   * only one. Worth knowing when stepping down a size: DN65 -> DN50 can INCREASE
   * the coefficient.
   *
   * So monotonicity is asserted WITHIN each body, which is where it must hold —
   * a swapped pair inside one sheet would break this. */
  const topsOf = body => CV.sizes.filter(s => s.body === body)
    .reduce((acc, s) => { acc[s.dn] = Math.max(acc[s.dn] || 0, s.kvs); return acc; }, {});
  const thr = topsOf('threaded'), fla = topsOf('flanged');
  const thrVals = Object.keys(thr).map(Number).sort((a, b) => a - b).map(d => thr[d]);
  const flaVals = Object.keys(fla).map(Number).sort((a, b) => a - b).map(d => fla[d]);
  ok('within the threaded bodies the top coefficient never falls',
     thrVals.every((v, i) => i === 0 || v >= thrVals[i - 1]), thrVals.join(','));
  ok('within the flanged bodies it rises strictly',
     flaVals.every((v, i) => i === 0 || v > flaVals[i - 1]), flaVals.join(','));
  ok('the join is the one place it steps DOWN, as printed',
     Math.max(...CV.atSize(50).map(s => s.kvs)) > Math.max(...CV.atSize(65).map(s => s.kvs)),
     '50 -> ' + Math.max(...CV.atSize(50).map(s => s.kvs)) +
     ', 65 -> ' + Math.max(...CV.atSize(65).map(s => s.kvs)));
  ok('the range is equal percentage',
     /Equal percentage/i.test(CV.characteristic), CV.characteristic);
  /* NO PRODUCT IDENTITY IS SHIPPED — Michael, 2026-08-31. The vendor and model
   * patterns appear HERE, in the assertion that forbids them, and nowhere in
   * the data. That is deliberate: the guard has to name what it is looking for. */
  ok('no model or brand name is carried',
     !/belimo|EP0\d|EV\d|R2\d{3}|R6\d/i.test(JSON.stringify(CV)),
     'a product identifier leaked into the data');
}

section('Several coefficients per size');
{
  ok('DN50 offers four valves', CV.atSize(50).length === 4,
     String(CV.atSize(50).length));
  ok('...ordered smallest coefficient first',
     CV.atSize(50).map(s => s.kvs).join(',') === '25,40,58,70',
     CV.atSize(50).map(s => s.kvs).join(','));
  ok('DN25 offers one', CV.atSize(25).length === 1);
  ok('DN40 offers three', CV.atSize(40).length === 3);
  ok('an unlisted size offers none', CV.atSize(90).length === 0);
}

section('The default is one nominal size below the pipe');
{
  /* Michael, 2026-08-31: "Use next size down DN as default." A control valve is
   * not line size — a full-bore valve in the line drops almost nothing and has
   * no authority over the branch. */
  const d50 = CV.defaultForPipe('DN50');
  ok('a DN50 line defaults to a DN40 valve', d50 && d50.dn === 40,
     d50 && String(d50.dn));
  /* Where a size offers several, the SMALLEST coefficient is taken. Too small a
   * Kv still controls and merely costs head; too large a Kv does not control at
   * all, which is the failure worth avoiding. */
  near('...and to the smallest coefficient at that size', d50.kvs, 16, 1e-9);

  ok('a DN100 line defaults to DN80', CV.defaultForPipe('DN100').dn === 80);
  near('...at Kvs 100', CV.defaultForPipe('DN100').kvs, 100, 1e-9);
  ok('a DN25 line defaults to DN20', CV.defaultForPipe('DN25').dn === 20);
  near('...at the smaller of the two DN20 valves',
       CV.defaultForPipe('DN25').kvs, 4, 1e-9);

  /* A pipe size the range does not list steps down to the next valve that
   * EXISTS, not to a valve that does not. */
  ok('a DN90 line steps down to DN80', CV.defaultForPipe('DN90').dn === 80);
  ok('a DN300 line steps down to DN150', CV.defaultForPipe('DN300').dn === 150);

  /* NO SENSIBLE DEFAULT is a real answer, and must not be guessed at. */
  ok('a DN20 line has nothing below it', CV.defaultForPipe('DN20') === null);
  ok('a DN15 line has nothing below it', CV.defaultForPipe('DN15') === null);
  ok('a non-DN label has no default', CV.defaultForPipe('110 mm') === null);
  ok('an empty label has no default', CV.defaultForPipe('') === null);
}

section('Lookup');
{
  ok('an exact pair resolves', CV.find(50, 40) !== null);
  ok('a coefficient that is not offered at that size does not',
     CV.find(50, 41) === null);
  ok('a size that does not exist does not', CV.find(90, 63) === null);
  ok('DN50 resolves from a label', CV.dnOfLabel('DN50') === 50);
  ok('a non-DN label resolves to nothing', CV.dnOfLabel('110 mm') === null);
}

section('Pressure independent valves are stored but not used');
{
  const P = CV.picv;
  ok('the PICV table is present', !!P && !!P.threaded && !!P.flanged);
  ok('six threaded sizes, DN15-50', P.threaded.sizes.length === 6);
  ok('five flanged sizes, DN65-150', P.flanged.sizes.length === 5);
  /* Spot-checked against the sheets, so that picking this up later does not
   * mean reading them again. */
  near('DN15 Kvs theor. is 3.2', P.threaded.sizes[0].kvs, 3.2, 1e-9);
  near('DN50 Kvs theor. is 30.4', P.threaded.sizes[5].kvs, 30.4, 1e-9);
  near('DN65 Kvs theor. is 50', P.flanged.sizes[0].kvs, 50, 1e-9);
  near('DN150 Kvs theor. is 254', P.flanged.sizes[4].kvs, 254, 1e-9);
  /* V'nom is carried in m3/h as printed. The sheets also print l/s, and the two
   * must agree — the check that caught a 1.2% transcription error first time. */
  const printedLs = [0.42, 0.69, 0.97, 1.67, 2.78, 4.17];
  P.threaded.sizes.forEach((s, i) => {
    near(`PICV DN${s.dn}: ${printedLs[i]} l/s agrees with ${s.vnom_m3h} m3/h`,
         s.vnom_m3h / 3.6, printedLs[i], 0.006);
  });
  const printedLsF = [8, 11, 20, 31, 45];
  P.flanged.sizes.forEach((s, i) => {
    near(`PICV DN${s.dn}: ${printedLsF[i]} l/s agrees with ${s.vnom_m3h} m3/h`,
         s.vnom_m3h / 3.6, printedLsF[i], 0.006);
  });

  /* IT IS NOT WIRED UP, and the module says so. */
  ok('the table says it is not in use', /[Nn]ot used/.test(P.note), P.note);
  ok('no model or brand name is carried here either',
     !/belimo|EP0\d|EV\d/i.test(JSON.stringify(P)));
}

report();
