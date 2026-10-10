// Regenerates the user-guide screenshots in docs/images: `npm run screenshots`.
// Builds the real web app page from src/webapp (resolving the include() tags), replaces the
// Apps Script server with the fictional data in mock-data.js, and captures each scene in
// headless Chrome. The guarantor page is rendered by the real server code (GuarantorWeb.gs)
// against the in-memory test spreadsheet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sacco-shots-'));
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('Chrome or Edge not found. Set CHROME_PATH.'); process.exit(1); }

// [file name, scene, width, height]
const SHOTS = [
  ['01-sign-in.png', 'sign-in', 900, 620],
  ['02-my-account.png', 'my-account', 1280, 1560],
  ['03-request-withdrawal.png', 'request-withdrawal', 1280, 760],
  ['04-request-soft-loan.png', 'request-soft-loan', 1280, 1080],
  ['06-admin-deposit-accounts.png', 'admin-deposit-accounts', 1280, 800],
  ['07-record-savings.png', 'record-savings', 1280, 820],
  ['08-savings-transactions.png', 'savings-transactions', 1280, 640],
  ['09-adjust-transaction.png', 'adjust-transaction', 1280, 900],
  ['10-withdrawal-approvals.png', 'withdrawal-approvals', 1280, 560],
  ['11-loan-approvals.png', 'loan-approvals', 1280, 560],
  ['12-propose-loan.png', 'propose-loan', 1280, 1080],
  ['13-audit-log.png', 'audit-log', 1280, 760]
];

// The page doGet() serves, with include() tags resolved and the server swapped for mock data
function buildAppPage() {
  const include = rel => {
    const html = fs.readFileSync(path.join(ROOT, rel + '.html'), 'utf8');
    return html.replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (_, f) => include(f));
  };
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  return include('src/webapp/index')
    .replace(/<\?!=\s*JSON\.stringify\(guideUrl\)\s*\?>/, JSON.stringify('#guide'))
    .replace('<head>', '<head>\n<script>' + read('mock-data.js') + '</script>')
    .replace('</body>', '<script>' + read('scenes.js') + '</script>\n</body>');
}

// Guarantor "decline" confirmation page, rendered by GuarantorWeb.gs for a sample Soft Loan request
function buildGuarantorPage() {
  const { createGasFakes } = require('../../tests/gas-fakes');
  const { seed } = require('../../tests/fixtures');
  const fakes = createGasFakes();
  const g = vm.createContext(Object.assign({ console }, fakes.globals));
  const gsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? gsFiles(path.join(dir, e.name)) : (e.name.endsWith('.gs') ? [path.join(dir, e.name)] : []));
  gsFiles(path.join(ROOT, 'src')).filter(f => !f.endsWith('test.gs'))
    .sort((a, b) => (b.includes('Config.gs') - a.includes('Config.gs')) || a.localeCompare(b))
    .forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), g, { filename: f }));
  fakes.install(g);
  const val = n => vm.runInContext(n, g);
  const ctx = seed({ g, fakes, val });
  const names = { M004: 'Peter Wanyama', M006: 'Nancy Achieng', M007: 'Ruth Atim' };
  fakes.sheet(val('SH_MEMBERS')).data.forEach(r => { if (names[r[0]]) r[1] = names[r[0]]; });
  fakes.signInAs('alice@x.org');
  ['M004', 'M007'].forEach(no => g.recordSavings(no, 'Deposit', 100000, 'Principal', 'Monthly Premium', '', '', ''));
  fakes.signInAs('nan@x.org');
  const req = g.requestLoan(100000, '2w', 'Stock for shop', ['M004', 'M007']);
  const tok = ctx.guarantors().find(r => r.RequestID === req.requestId && r.GuarantorNo === 'M007').Token;
  return g._guarantorHandle(tok, 'decline', '', '').getContent();
}

function shoot(file, url, w, h) {
  const out = path.join(OUT, file);
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + w + ',' + h, '--virtual-time-budget=8000', '--screenshot=' + out, url], { encoding: 'utf8', timeout: 60000 });
  const okay = fs.existsSync(out) && fs.statSync(out).size > 0;
  console.log((okay ? '  ✓ ' : '  ✗ ') + file + (okay ? '' : '  ' + (r.stderr || r.error || '').toString().slice(0, 300)));
  return okay;
}

fs.mkdirSync(OUT, { recursive: true });
const app = path.join(TMP, 'app.html'), guar = path.join(TMP, 'guarantor.html');
fs.writeFileSync(app, buildAppPage());
fs.writeFileSync(guar, buildGuarantorPage());
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/');
let failed = 0;
SHOTS.forEach(([file, scene, w, h]) => { if (!shoot(file, fileUrl(app) + '?scene=' + scene, w, h)) failed++; });
if (!shoot('05-guarantor-decline.png', fileUrl(guar), 640, 760)) failed++;
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
