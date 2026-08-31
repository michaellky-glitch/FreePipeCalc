/* FreePipeCalc — control valve sizes, against the printed type overview.
 * Run:  node test/controlvalves.test.js
 *
 * The numbers in `data/controlvalves.js` were transcribed by hand from Belimo's
 * EXT-TI-H6..XS(P) type overview, which is exactly the step that goes wrong
 * quietly. They get the same discipline as the Idel'chik tee diagrams:
 * individual cells asserted against the page.
 *
 * The sheet is cited, not redistributed — `docs_internal/VALVE-DATA-SOURCES.md`
 * records it and the PDF stays out of the repository.
 */
'use strict';
const { load, ok, near, section, report } = require('./harness');
const FD = load(['data/controlvalves.js']);
const CV = FD.controlValves;

section('The range, as printed');
{
  /* Type overview, one row per NOMINAL SIZE after Michael's rule of taking the
   * largest coefficient where several share a size. Columns: DN, Kvs [m3/h],
   * stroke [mm], close-off [kPa], maximum differential [kPa]. */
  const page = [
    [15,  4,   20, 1000, 500],
    [20,  6.3, 20, 1000, 400],
    [25,  10,  20, 1000, 350],
    [32,  16,  20,  600, 300],   // also offered at 1000/500
    [40,  25,  20, 1600, 1000],
    [50,  40,  20, 1600, 1000],
    [65,  63,  20, 1600, 1000],
    [80,  100, 30, 1600, 1000],
    [100, 160, 40, 1600, 1000],
    [125, 250, 40, 1600, 1000],
    [150, 350, 40, 1600, 1000],
    [200, 520, 40, 1600, 1000],
    [250, 700, 40, 1600, 1000]
  ];
  ok('thirteen nominal sizes', CV.sizes.length === 13, String(CV.sizes.length));
  page.forEach(([dn, kvs, stroke, dpS, dpMax]) => {
    const e = CV.bySize(dn);
    ok(`DN${dn} is in the range`, !!e, 'missing');
    if (!e) return;
    near(`DN${dn} Kvs is ${kvs}`, e.kvs, kvs, 1e-9);
    near(`DN${dn} stroke is ${stroke} mm`, e.stroke, stroke, 1e-9);
    near(`DN${dn} close-off is ${dpS} kPa`, e.dpS, dpS * 1e3, 1);
    near(`DN${dn} maximum differential is ${dpMax} kPa`, e.dpMax, dpMax * 1e3, 1);
  });
}

section('One coefficient per size, taking the largest');
{
  /* DN15 is the only size the sheet sells in more than one coefficient:
   * 0.63, 1, 1.5, 2.5 and 4. The rule is to take the largest. */
  const d15 = CV.bySize(15);
  near('DN15 takes the largest of its five', d15.kvs, 4, 1e-9);
  ok('...and the other four are recorded',
     d15.alternates.join(',') === '0.63,1,1.5,2.5,4', String(d15.alternates));
  ok('...with the largest among them', Math.max(...d15.alternates) === d15.kvs);
  ok('no other size lists alternatives',
     CV.sizes.filter(s => s.alternates).length === 1);

  /* THE POINT OF THE RULE: one coefficient per size gives a ladder that rises
   * strictly, so the interface can offer a plain size. The mixed ranges this
   * replaced did not — a threaded DN50 passed more than a flanged DN65. */
  const kvs = CV.sizes.map(s => s.kvs);
  ok('the ladder rises strictly with size',
     kvs.every((v, i) => i === 0 || v > kvs[i - 1]), kvs.join(','));
  ok('sizes are ascending',
     CV.nominalSizes().join(',') === '15,20,25,32,40,50,65,80,100,125,150,200,250',
     CV.nominalSizes().join(','));
}

section('The DN32 dual pressure class');
{
  /* The sheet prints "600/1000" and "300/500" on this row alone. The LOWER of
   * each is carried: a limit that is too generous is the one that lets a bad
   * selection through. The alternative must not be silently lost. */
  const e = CV.bySize(32);
  near('the conservative close-off is carried', e.dpS, 600e3, 1);
  near('the conservative differential is carried', e.dpMax, 300e3, 1);
  ok('...and the alternative class is noted',
     /1000 kPa/.test(e.dpNote) && /500 kPa/.test(e.dpNote), e.dpNote);
  ok('no other size carries a dual rating',
     CV.sizes.filter(s => s.dpNote).length === 1);
}

section('The default is one nominal size below the pipe');
{
  /* Michael, 2026-08-31: "Use next size down DN as default." A control valve is
   * not line size — a full-bore valve in the line drops almost nothing and has
   * no authority over the branch. */
  ok('a DN50 line defaults to DN40', CV.defaultForPipe('DN50').dn === 40);
  near('...at Kvs 25', CV.defaultForPipe('DN50').kvs, 25, 1e-9);
  ok('a DN100 line defaults to DN80', CV.defaultForPipe('DN100').dn === 80);
  near('...at Kvs 100', CV.defaultForPipe('DN100').kvs, 100, 1e-9);
  ok('a DN20 line defaults to DN15', CV.defaultForPipe('DN20').dn === 15);

  /* A pipe size the range does not list steps to the next valve that EXISTS. */
  ok('a DN90 line steps down to DN80', CV.defaultForPipe('DN90').dn === 80);
  ok('a DN300 line steps down to DN250', CV.defaultForPipe('DN300').dn === 250);

  /* NO SENSIBLE DEFAULT is a real answer and must not be guessed at. */
  ok('a DN15 line has nothing below it', CV.defaultForPipe('DN15') === null);
  ok('a non-DN label has no default', CV.defaultForPipe('110 mm') === null);
  ok('an empty label has no default', CV.defaultForPipe('') === null);
  ok('a missing label has no default', CV.defaultForPipe(undefined) === null);
}

section('Valve types offered');
{
  ok('two types', CV.types.length === 2, String(CV.types.length));
  ok('Control Valve first, and implemented',
     CV.types[0].key === 'cv' && CV.types[0].name === 'Control Valve' &&
     CV.types[0].implemented === true, JSON.stringify(CV.types[0]));
  /* PICV is offered so it reads as coming rather than missing, and is flagged
   * so nothing treats it as working. */
  ok('PICV second, and flagged as not implemented',
     CV.types[1].key === 'picv' && CV.types[1].implemented === false,
     JSON.stringify(CV.types[1]));
  ok('...and says so in its name',
     /Not Implemented Yet/.test(CV.types[1].name), CV.types[1].name);
}

section('Provenance');
{
  ok('the range is named', /EXT-TI-H6\.\.XS\(P\)/.test(CV.range), CV.range);
  ok('the source cites the manufacturer', /Belimo/.test(CV.source), CV.source);
  ok('...and says the sheet is not redistributed',
     /not redistributed/.test(CV.source), CV.source);
  ok('the characteristic is equal percentage',
     /Equal percentage/i.test(CV.characteristic), CV.characteristic);
}

section('Lookup');
{
  ok('DN50 resolves', CV.bySize(50).kvs === 40);
  ok('an unlisted size resolves to nothing', CV.bySize(90) === null);
  ok('a nonsense size resolves to nothing', CV.bySize('banana') === null);
  ok('DN50 resolves from a label', CV.dnOfLabel('DN50') === 50);
  ok('a non-DN label resolves to nothing', CV.dnOfLabel('110 mm') === null);
}

section('Pressure independent valves are stored but not used');
{
  const P = CV.picv;
  ok('the PICV table is present', !!P && !!P.threaded && !!P.flanged);
  ok('six threaded sizes, DN15-50', P.threaded.sizes.length === 6);
  ok('five flanged sizes, DN65-150', P.flanged.sizes.length === 5);
  /* Spot-checked against the sheets so picking this up later does not mean
   * reading them again. */
  near('DN15 Kvs theor. is 3.2', P.threaded.sizes[0].kvs, 3.2, 1e-9);
  near('DN50 Kvs theor. is 30.4', P.threaded.sizes[5].kvs, 30.4, 1e-9);
  near('DN65 Kvs theor. is 50', P.flanged.sizes[0].kvs, 50, 1e-9);
  near('DN150 Kvs theor. is 254', P.flanged.sizes[4].kvs, 254, 1e-9);
  /* V'nom is carried in m3/h as printed. The sheets also print l/s, and the
   * two must agree — the check that caught a 1.2% transcription error. */
  const ls = [0.42, 0.69, 0.97, 1.67, 2.78, 4.17];
  P.threaded.sizes.forEach((s, i) => {
    near(`PICV DN${s.dn}: ${ls[i]} l/s agrees with ${s.vnom_m3h} m3/h`,
         s.vnom_m3h / 3.6, ls[i], 0.006);
  });
  const lsF = [8, 11, 20, 31, 45];
  P.flanged.sizes.forEach((s, i) => {
    near(`PICV DN${s.dn}: ${lsF[i]} l/s agrees with ${s.vnom_m3h} m3/h`,
         s.vnom_m3h / 3.6, lsF[i], 0.006);
  });
  ok('the table says it is not in use', /[Nn]ot used/.test(P.note), P.note);
}

report();
