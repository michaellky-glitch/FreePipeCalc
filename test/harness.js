/* FreePipeCalc — Node.js shim so the browser sources can be unit-tested.
 *
 * The app ships as classic <script> files that attach to a global `FD`
 * (ES modules cannot be loaded from file://, see docs/ENGINE.md). This shim
 * fabricates a `window`, evaluates the same files in order, and hands back FD.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const FILES = [
  'data/schedules.js',
  'data/fittings.js',
  'data/valves.js',
  'data/ktable.js',
  'data/pumps.js',
  'src/units.js',
  'src/hydraulics.js',
  'src/solver.js'
];

function load(extra) {
  const sandbox = { console, Math, JSON, Object, Array, isFinite, parseFloat, parseInt };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const f of FILES.concat(extra || [])) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }
  return sandbox.window.FD;
}

// ------------------------------------------------------------ assertions
let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push({ name, detail }); }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '\n          ' + detail}`);
}

function near(name, actual, expected, tol) {
  const t = tol === undefined ? Math.abs(expected) * 1e-3 + 1e-9 : tol;
  const d = Math.abs(actual - expected);
  ok(name, d <= t, `expected ${expected}, got ${actual} (Δ ${d.toExponential(2)}, tol ${t.toExponential(2)})`);
}

function section(title) { console.log(`\n${title}`); }

function report() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.name}\n    ${f.detail || ''}`));
  }
  process.exitCode = failed ? 1 : 0;
}

module.exports = { load, ok, near, section, report };
