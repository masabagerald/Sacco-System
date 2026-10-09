// Local test runner: `npm test`.
// Loads every src/**/*.gs file into one shared VM context (as Apps Script does), with small
// in-memory fakes for the Apps Script services, then runs:
//   1. the .gs test suites (functions named run*Tests in src/tests), and
//   2. the controller-level integration tests in tests/*.integration.js.
// Not pushed to Apps Script (.claspignore only pushes src/).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasFakes } = require('./gas-fakes');

const ROOT = path.join(__dirname, '..');

function gsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return gsFiles(p);
    return e.name.endsWith('.gs') ? [p] : [];
  });
}

// Fresh context per suite so tests cannot leak sheet state into each other.
function loadProject() {
  const fakes = createGasFakes();
  const context = vm.createContext(Object.assign({ console }, fakes.globals));
  // Config first: other files' top-level constants may refer to it.
  const files = gsFiles(path.join(ROOT, 'src'))
    .filter(f => !f.endsWith(path.join('models', 'test.gs')))
    .sort((a, b) => (b.includes('Config.gs') - a.includes('Config.gs')) || a.localeCompare(b));
  files.forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: path.relative(ROOT, f) }));
  fakes.install(context);
  // Script-level consts are not properties of the global object; val() reads them by name.
  return { g: context, fakes, val: name => vm.runInContext(name, context) };
}

const results = [];
function record(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e }); }
}

// 1. .gs suites
const suites = Object.keys(loadProject().g).filter(k => /^run\w+Tests$/.test(k)).sort();
suites.forEach(name => record(name + ' (.gs)', () => {
  const { g, fakes } = loadProject();
  try { g[name](); }
  finally { if (process.env.VERBOSE) fakes.logs.forEach(l => console.log('   ' + l)); }
}));

// 2. integration tests
fs.readdirSync(__dirname).filter(f => f.endsWith('.integration.js')).sort().forEach(f => {
  const tests = require(path.join(__dirname, f));
  Object.keys(tests).forEach(name => record(f + ' › ' + name, () => tests[name](loadProject())));
});

let failed = 0;
results.forEach(r => {
  if (r.ok) console.log('  ✓ ' + r.name);
  else { failed++; console.log('  ✗ ' + r.name + '\n      ' + (r.error && r.error.stack || r.error).toString().split('\n').slice(0, 4).join('\n      ')); }
});
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
