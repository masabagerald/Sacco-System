// Capacity benchmark, run locally: node --max-old-space-size=8192 bench/run-local.js [--quick]
//
// Loads every src/**/*.gs file (the real server code) into one VM context with the in-memory Apps Script
// fakes from tests/gas-fakes.js, fills the fake spreadsheet with synthetic data (bench/gas/BenchData.gs)
// at each tier, and runs the heavy operations. It touches no Google service.
//
// What is MEASURED here: the JavaScript work of each operation (Node wall time minus time spent inside
// the fakes), and the exact number of spreadsheet calls, cells read and written, rows appended, date
// conversions, cache/property calls and emails each operation makes.
// What is ESTIMATED: the Apps Script time, from those counts and the per-call costs in COST below.
// Replace the estimates with real timings by running bench/gas/Bench.gs on a copy (see bench/README.md).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const { createGasFakes, FakeSheet } = require('../tests/gas-fakes');

const ROOT = path.join(__dirname, '..');
const QUICK = process.argv.includes('--quick');
const END_YMD = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

// â”€â”€ Apps Script cost model (milliseconds). low / central / high. â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sources: Google's Apps Script best-practices guidance (batch reads, every call is a round trip) and
// commonly reported timings; NOT measured in this run. Bench.gs on a copy measures the real thing.
const COST = {
  low:     { cpuFactor: 2, readCall: 20, readCell: 0.003, writeCall: 10, writeCell: 0.0005, append: 80,  light: 2,  fmtDate: 0.005, cache: 8,  prop: 10, lock: 15, email: 200,  rtt: 300 },
  central: { cpuFactor: 3, readCall: 40, readCell: 0.006, writeCall: 25, writeCell: 0.001,  append: 150, light: 5,  fmtDate: 0.010, cache: 15, prop: 20, lock: 30, email: 400,  rtt: 600 },
  high:    { cpuFactor: 5, readCall: 80, readCell: 0.012, writeCall: 60, writeCell: 0.002,  append: 400, light: 15, fmtDate: 0.030, cache: 40, prop: 50, lock: 80, email: 1000, rtt: 1500 }
};
const LOCK_WAIT_MS = 15000;          // withScriptLock_: lock.waitLock(15000)
// A run longer than this (Node time) is stopped and extrapolated from the last tier where it finished.
// An operation that has not finished at any tier yet gets the long budget, so there is a baseline.
const NODE_BUDGET_MS = QUICK ? 15000 : 30000;
const NODE_BASELINE_BUDGET_MS = 600000;

// How an operation's cost grows, from the tier's sizes, for extrapolating a stopped run.
// s: { M members, S savings rows, L loans, R repayments, LR loan requests, F surcharges }
const GROWTH = {
  members: s => s.M * s.S, csv: s => s.M * s.S, jobStatements: s => s.M * s.S,   // Savings re-read once per member
  loanReqs: s => s.LR * s.S,                                                      // Savings re-read once per loan request
  requestLoan: s => s.L * s.R, approveLoan: s => s.L * s.R,                       // every loan recomputed over every repayment, several times
  dashboard: s => s.L * s.R, activeLoans: s => s.L * s.R, insights: s => s.L * s.R, fundLedger: s => s.L * s.R,
  jobDueDates: s => s.L * (s.R + s.M), jobRepayRem: s => s.M * s.L,
  fines: s => s.F * s.M, wdReqs: s => s.M * s.S,
  default: s => s.S + s.R + s.L
};

function modelMs(c, cpuMs, k, web) {
  const p = COST[k];
  return p.cpuFactor * cpuMs + c.readCalls * p.readCall + c.cellsRead * p.readCell + c.writeCalls * p.writeCall
    + c.cellsWritten * p.writeCell + c.appends * p.append + c.light * p.light + c.fmtDate * p.fmtDate
    + c.cache * p.cache + c.props * p.prop + c.locks * p.lock + c.emails * p.email + (web ? p.rtt : 0);
}

// â”€â”€ Instrumented project â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function zero() { return { readCalls: 0, cellsRead: 0, writeCalls: 0, cellsWritten: 0, appends: 0, light: 0, fmtDate: 0, cache: 0, props: 0, locks: 0, emails: 0, fakeMs: 0 }; }
const C = { cur: zero(), deadline: Infinity, beforeWrite: null };
class Budget extends Error {}

function instrument() {
  if (FakeSheet.prototype._benched) return;
  FakeSheet.prototype._benched = true;
  const RangeProto = Object.getPrototypeOf(new FakeSheet('x', [[1]]).getRange(1, 1, 1, 1));
  const timed = (fn, count) => function (...a) {
    if (performance.now() > C.deadline) { C.budgetHit = true; throw new Budget('budget'); }
    const t = performance.now();
    try { count.call(this, ...a); return fn.apply(this, a); } finally { C.cur.fakeMs += performance.now() - t; }
  };
  const gv = RangeProto.getValues;
  RangeProto.getValues = timed(gv, function () { C.cur.readCalls++; C.cur.cellsRead += this.numRows * this.numCols; });
  const sv = RangeProto.setValue;
  RangeProto.setValue = timed(function (v) { if (C.beforeWrite) C.beforeWrite(this.sheet); return sv.call(this, v); }, function () { C.cur.writeCalls++; C.cur.cellsWritten++; });
  const svs = RangeProto.setValues;
  RangeProto.setValues = timed(function (v) { if (C.beforeWrite) C.beforeWrite(this.sheet); return svs.call(this, v); },
    function (v) { C.cur.writeCalls++; C.cur.cellsWritten += v.length * (v[0] || []).length; });
  const snf = RangeProto.setNumberFormat;
  RangeProto.setNumberFormat = timed(snf, function () { C.cur.writeCalls++; });
  const ar = FakeSheet.prototype.appendRow;
  FakeSheet.prototype.appendRow = timed(ar, function (v) { C.cur.appends++; C.cur.cellsWritten += v.length; });
  ['getLastRow', 'getLastColumn'].forEach(n => { const f = FakeSheet.prototype[n]; FakeSheet.prototype[n] = timed(f, function () { C.cur.readCalls++; }); });
}

function loadProject() {
  instrument();
  const fakes = createGasFakes();
  const G = fakes.globals;
  const ss = G.SpreadsheetApp.getActiveSpreadsheet();
  ['getSheetByName', 'getSpreadsheetTimeZone', 'getSheets'].forEach(n => { const f = ss[n]; ss[n] = (...a) => { C.cur.light++; return f(...a); }; });
  // A native call in Apps Script: its cost is modelled (fmtDate), so the fake's own JS time is not app CPU
  const fd = G.Utilities.formatDate;
  G.Utilities.formatDate = (...a) => { C.cur.fmtDate++; const t = performance.now(); try { return fd(...a); } finally { C.cur.fakeMs += performance.now() - t; } };
  const sc = G.CacheService.getScriptCache();
  const cache = { get: k => { C.cur.cache++; return sc.get(k); }, put: (k, v) => { C.cur.cache++; sc.put(k, v); }, remove: k => { C.cur.cache++; sc.remove(k); } };
  G.CacheService = { getScriptCache: () => cache };
  const sp = G.PropertiesService.getScriptProperties();
  const props = { getProperty: k => { C.cur.props++; return sp.getProperty(k); }, setProperty: (k, v) => { C.cur.props++; sp.setProperty(k, v); },
    deleteProperty: k => { C.cur.props++; sp.deleteProperty(k); } };
  G.PropertiesService = { getScriptProperties: () => props, getUserProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) };
  // The lock: counts acquisitions and records what happens while it is held (the critical section)
  const lockLog = [];
  G.LockService = { getScriptLock: () => ({
    waitLock() { C.cur.locks++; this._t = performance.now(); this._c = Object.assign({}, C.cur); },
    releaseLock() { const d = diff(C.cur, this._c); lockLog.push({ counters: d, ms: performance.now() - this._t }); } }) };
  const context = vm.createContext(Object.assign({ console }, G));
  const gsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? gsFiles(p) : (e.name.endsWith('.gs') ? [p] : []);
  });
  const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
  gsFiles(path.join(ROOT, 'src')).filter(f => !f.endsWith(path.join('models', 'test.gs'))).sort((a, b) => rel(a).localeCompare(rel(b)))
    .concat([path.join(__dirname, 'gas', 'BenchData.gs')])
    .forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: rel(f) }));
  // Email: everything goes through sendHtmlEmail_ (EmailService.gs). Count the sends; build the HTML as usual.
  context.sendHtmlEmail_ = () => { C.cur.emails++; };
  context.MailApp = { sendEmail: () => { C.cur.emails++; } };
  return { g: context, fakes, lockLog, CDate: vm.runInContext('Date', context), val: n => vm.runInContext(n, context) };
}

function diff(a, b) { const o = {}; Object.keys(a).forEach(k => { o[k] = a[k] - (b[k] || 0); }); return o; }

// â”€â”€ Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildTier(members, years) {
  const P = loadProject();
  const { g, fakes, CDate, val } = P;
  fakes.hostAs('host@club.org');
  fakes.asOwner(() => g.setupNewClub());
  const cfg = g.benchCfg_(members, years, END_YMD, 'host@club.org');
  const mkDate = (y, m, d, h, mi, s) => new CDate(y, m, d, h, mi, s);
  const byName = {};
  const push = (name, objs) => { (byName[name] = byName[name] || []).push(...objs); };
  const st = g.benchStaticRows_(cfg, mkDate);
  Object.keys(st).forEach(n => push(n, st[n]));
  for (let k = 0; k < cfg.months; k++) { const mr = g.benchMonthRows_(cfg, k, mkDate); Object.keys(mr).forEach(n => push(n, mr[n])); }
  const stats = {};
  Object.keys(byName).forEach(name => {
    const sh = fakes.sheet(name);
    if (!sh) throw new Error('No tab ' + name);
    const headers = sh.data[0].map(String);
    sh.data = [sh.data[0]].concat(g.benchToArrays_(headers, byName[name]));
  });
  // every tab, for the cell budget
  fakes.globals.SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(sh => {
    const rows = sh.data.length, cols = sh._width();
    stats[sh.getName()] = { rows: Math.max(0, rows - 1), cols, usedCells: rows * cols,
      gridCells: Math.max(rows, 1000) * Math.max(cols, 26) };
  });
  const mm = g.benchMembers_(cfg);
  return Object.assign(P, { cfg, mm, stats });
}

function tierCells(stats) {
  return Object.values(stats).reduce((a, s) => ({ used: a.used + s.usedCells, grid: a.grid + s.gridCells, rows: a.rows + s.rows }), { used: 0, grid: 0, rows: 0 });
}

// â”€â”€ Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// as: 'member' | 'admin' | 'owner'. web: called from the page (adds one round trip).
// prep(P, run) returns the arguments (not timed). check(res) throws if the call failed.
const okRes = r => { if (r && r.ok === false) throw new Error(r.error || JSON.stringify(r).slice(0, 200)); };
function sheetRows(P, name) { return P.fakes.sheet(name).records(name === P.val('SH_GUARANTOR_NOTICES') ? 'event key' : name === P.val('SH_AUDIT') ? 'timestamp' : name === P.val('SH_LOANS') || name === P.val('SH_REPAY') ? 'loanid' : name === P.val('SH_FINES') ? 'fineid' : /Requests|Guarantors/.test(name) ? 'requestid' : 'memberno'); }
function activeMemberLoan(P, run) {
  const reps = {};
  sheetRows(P, P.val('SH_REPAY')).forEach(r => { reps[r.LoanID] = true; });
  const act = sheetRows(P, P.val('SH_LOANS')).filter(l => l.Status === 'Active' && l['Loan Model'] === 'Member');
  return act[run % act.length].LoanID;
}
const triple = (P, t) => { const c = P.mm.clean; return [c[3 * t], c[3 * t + 1], c[3 * t + 2]]; };

const OPS = [
  // member (each runs as a long-standing saving member with loans)
  { id: 'auth', name: 'Sign-in check on every request (getCurrentMember)', as: 'member', web: true, fn: g => g.getCurrentMember() },
  { id: 'mySavings', name: 'My savings (getMySavings)', as: 'member', web: true, fn: g => g.getMySavings() },
  { id: 'myLoans', name: 'My loans (getMyLoans)', as: 'member', web: true, fn: g => g.getMyLoans() },
  { id: 'myPage', name: 'Member home page: 5 calls in parallel (slowest)', as: 'member', web: true, group: ['getMySavings', 'getMyLoans', 'getMyLoanRequests', 'getMyWithdrawalRequests', 'getMyFines'] },
  { id: 'statement', name: 'Member statement data (getMemberStatementData, before PDF)', as: 'member', web: true, fn: g => g.getMemberStatementData() },
  // admin
  { id: 'dashboard', name: 'Admin dashboard (getAdminDashboard)', as: 'admin', web: true, fn: g => g.getAdminDashboard() },
  { id: 'members', name: 'Members list with balances (getAllMembersSummary)', as: 'admin', web: true, fn: g => g.getAllMembersSummary() },
  { id: 'loanReqs', name: 'Loan requests list (getLoanRequests)', as: 'admin', web: true, fn: g => g.getLoanRequests() },
  { id: 'activeLoans', name: 'Active loans / portfolio (getActiveLoans)', as: 'admin', web: true, fn: g => g.getActiveLoans() },
  { id: 'repayments', name: 'Repayments list (getRepayments)', as: 'admin', web: true, fn: g => g.getRepayments() },
  { id: 'wdReqs', name: 'Withdrawal requests (getWithdrawalRequests)', as: 'admin', web: true, fn: g => g.getWithdrawalRequests() },
  { id: 'fines', name: 'Surcharges list (getAllFinesForAdmin)', as: 'admin', web: true, fn: g => g.getAllFinesForAdmin() },
  { id: 'savingsTx', name: 'Savings ledger, unfiltered (getSavingsTransactions)', as: 'admin', web: true, fn: g => g.getSavingsTransactions({}) },
  { id: 'insights', name: 'Loan Insights, all time (getLoanInsights)', as: 'admin', web: true, fn: g => g.getLoanInsights({}) },
  { id: 'fundLedger', name: 'Loan fund trace, all time (getLoanFundLedger)', as: 'admin', web: true, fn: g => g.getLoanFundLedger({}) },
  { id: 'auditLog', name: 'Audit log, first page (getAuditLog)', as: 'admin', web: true, fn: g => g.getAuditLog({ pageSize: 100 }) },
  { id: 'csv', name: 'Ledger CSV export (exportAdminCSV)', as: 'admin', web: true, fn: g => g.exportAdminCSV() },
  // writes
  { id: 'recordSavings', name: 'Post a deposit (recordSavings)', as: 'admin', web: true, write: true,
    prep: P => [P.mm.list[10].no], fn: (g, a) => g.recordSavings(a[0], 'Deposit', 50000, 'Principal', 'Monthly Premium', '', 'bench', '') },
  { id: 'recordRepayment', name: 'Post a loan repayment (recordRepayment)', as: 'admin', web: true, write: true,
    prep: (P, r) => [activeMemberLoan(P, r)], fn: (g, a) => g.recordRepayment(a[0], 1000, 'bench', '', { allowOverpayment: true, confirmDuplicate: true }) },
  { id: 'requestWithdrawal', name: 'Member requests a withdrawal (requestWithdrawal)', as: 'clean', web: true, write: true,
    fn: g => g.requestWithdrawal(5000, 'Dividends', '', 'Principal') },
  { id: 'requestLoan', name: 'Member requests a loan (requestLoan)', as: 'tripleApplicant', web: true, write: true,
    prep: (P, r) => triple(P, r).map(m => m.no), fn: (g, a) => g.requestLoan(100000, '3', 'bench', [a[1], a[2]]) },
  { id: 'approveLoan', name: 'Final loan approval, issues the loan (approveLoanRequest)', as: 'admin3', web: true, write: true,
    prep: (P, r) => prepApprovable(P, 3 + r), fn: (g, a) => g.approveLoanRequest(a[0], 'bench override') },
  { id: 'issueFine', name: 'Record a surcharge (issueFine)', as: 'admin', web: true, write: true,
    prep: P => [P.mm.list[11].no], fn: (g, a) => g.issueFine(a[0], 5000, 'bench') },
  // scheduled jobs
  { id: 'jobStatements', name: 'Monthly statements job (sendMonthlyStatements)', as: 'owner', fn: g => g.sendMonthlyStatements() },
  { id: 'jobDueDates', name: 'Daily due-date job (processLoanDueDates)', as: 'owner', fn: g => g.processLoanDueDates() },
  { id: 'jobPending', name: 'Daily pending-action reminders (sendPendingActionReminders_)', as: 'owner', fn: g => g.sendPendingActionReminders_(Date.now()) },
  { id: 'jobRepayRem', name: 'Daily repayment reminders (sendRepaymentReminders_)', as: 'owner', fn: g => g.sendRepaymentReminders_() }
];

// A loan request with both guarantors accepted and its first admin approval, ready for the final approval
function prepApprovable(P, t) {
  const [a, g1, g2] = triple(P, t);
  P.fakes.signInAs(a.email);
  const res = P.g.requestLoan(100000, '3', 'bench', [g1.no, g2.no]); okRes(res);
  const gs = P.fakes.sheet(P.val('SH_GUARANTORS'));
  const h = gs.data[0].map(x => String(x).toLowerCase());
  gs.data.forEach(r => { if (r[h.indexOf('requestid')] === res.requestId) r[h.indexOf('response')] = 'Accepted'; });
  P.fakes.signInAs(P.mm.admins[2].email);
  okRes(P.g.approveLoanRequest(res.requestId, 'bench override'));
  return [res.requestId];
}

function identity(P, op, run) {
  const mm = P.mm;
  if (op.as === 'member') return mm.list[10].email;
  if (op.as === 'admin') return mm.admins[1].email;
  if (op.as === 'admin3') return mm.admins[3].email;
  if (op.as === 'clean') return mm.clean[run].email;
  if (op.as === 'tripleApplicant') return triple(P, run)[0].email;
  return null;
}

function runOnce(P, op, run, budget) {
  const args = op.prep ? op.prep(P, run) : [];
  const who = identity(P, op, run);
  if (who) P.fakes.signInAs(who);
  P.lockLog.length = 0;
  const single = fn => {
    C.cur = zero(); C.deadline = performance.now() + budget; C.budgetHit = false;
    const t0 = performance.now();
    let res, aborted = false, error = '';
    try { res = op.as === 'owner' ? P.fakes.asOwner(() => fn()) : fn(); okRes(res); }
    catch (e) { if (e instanceof Budget || C.budgetHit) aborted = true; else error = String(e.message || e).slice(0, 200); }
    if (C.budgetHit) { aborted = true; error = ''; }
    const wall = performance.now() - t0;
    C.deadline = Infinity;
    const counters = C.cur;
    const cpu = Math.max(0, wall - counters.fakeMs);
    const payload = res === undefined ? 0 : Buffer.byteLength(JSON.stringify(res) || '');
    return { wall, cpu, counters, aborted, error, payload };
  };
  if (op.group) {
    // parallel calls from one page: each is its own execution; the page waits for the slowest
    const parts = op.group.map(name => Object.assign({ name }, single(() => P.g[name]())));
    const slow = parts.reduce((a, b) => (modelMs(b.counters, b.cpu, 'central', true) > modelMs(a.counters, a.cpu, 'central', true) ? b : a));
    return Object.assign({}, slow, { slowest: slow.name, aborted: parts.some(p => p.aborted), error: parts.map(p => p.error).filter(Boolean).join('; '),
      parts: parts.map(p => ({ name: p.name, model: modelMs(p.counters, p.cpu, 'central', true), aborted: p.aborted })),
      sumModel: parts.reduce((s, p) => s + modelMs(p.counters, p.cpu, 'central', true), 0) });
  }
  const r = single(() => op.fn(P.g, args));
  // critical section: what ran while the script lock was held
  const lock = P.lockLog.reduce((a, l) => ({ ms: a.ms + l.ms, counters: Object.keys(l.counters).reduce((o, k) => (o[k] = (o[k] || 0) + l.counters[k], o), a.counters) }), { ms: 0, counters: zero() });
  if (P.lockLog.length) r.lockModel = modelMs(lock.counters, Math.max(0, lock.ms - lock.counters.fakeMs), 'central', false);
  return r;
}

const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };

// â”€â”€ Concurrency: what happens when k requests arrive together â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Writes that hold the script lock are serialised by Apps Script: the k-th waits for the k-1 before it,
// and gives up after 15 s ("Lock timeout"). That is modelled from each op's measured critical section.
// Writes WITHOUT the lock are run here with a worst-case interleaving: every request reads (chooses its
// row and its reference) before any of them writes, which is what simultaneous executions can do.
function concurrencyCollision(kind, k) {
  const P = buildTier(100, 1);
  const { g, fakes, mm, val } = P;
  const thunks = [];
  let target = '';
  if (kind === 'issueFine') {
    target = val('SH_FINES');
    for (let j = 0; j < k; j++) thunks.push(() => { fakes.signInAs(mm.admins[1 + (j % 5)].email); return g.issueFine(mm.list[20 + j].no, 1000 + j, 'concurrent ' + j); });
  } else if (kind === 'requestLoan') {
    target = val('SH_LOAN_REQ');
    for (let j = 0; j < k; j++) thunks.push(() => { const t = triple(P, j); fakes.signInAs(t[0].email); return g.requestLoan(100000 + j, '3', 'concurrent ' + j, [t[1].no, t[2].no]); });
  } else if (kind === 'acceptTerms') {
    target = val('SH_TERMS');
    const who = mm.clean.slice(0, k);
    const ts = fakes.sheet(target);
    const h = ts.data[0].map(String);
    ts.data = ts.data.filter((r, i) => i === 0 || !who.some(m => m.no === r[h.indexOf('MemberNo')]));
    for (let j = 0; j < k; j++) thunks.push(() => { fakes.signInAs(who[j].email); return g.acceptTerms({ use: '1' }); });
  }
  const before = fakes.sheet(target).data.length;
  const results = [];
  let next = 0;
  const frames = [];
  C.beforeWrite = sheet => {
    const f = frames[frames.length - 1];
    if (!f || !f.armed || sheet.getName() !== target) return;
    f.armed = false;
    if (next < thunks.length) runThunk();
  };
  function runThunk() {
    const j = next++;
    frames.push({ armed: true });
    try { results[j] = thunks[j](); } catch (e) { results[j] = { ok: false, error: String(e.message || e) }; }
    frames.pop();
  }
  C.cur = zero();
  runThunk();
  C.beforeWrite = null;
  const after = fakes.sheet(target).data.length;
  const okCount = results.filter(r => r && r.ok !== false).length;
  const ids = results.filter(r => r && r.ok !== false).map(r => r.fineId || r.requestId || '').filter(Boolean);
  return { kind, k, reportedOk: okCount, rowsAdded: after - before, distinctIds: new Set(ids).size,
    lost: okCount - (after - before), ids: ids.slice(0, 10) };
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function main() {
  // --tiers=50x0.5,50x1 (members x years) runs only those tiers, into results/local-<tiers>.json
  const tiersArg = (process.argv.find(a => a.startsWith('--tiers=')) || '').slice(8);
  const TIERS = tiersArg ? tiersArg.split(',').map(t => t.split('x').map(Number))
    : QUICK ? [[100, 1], [250, 1]] : [100, 250, 500, 1000, 2000].flatMap(m => [1, 3, 5].map(y => [m, y]));
  const OUT = path.join(__dirname, 'results', tiersArg ? 'local-' + tiersArg.replace(/[^0-9x.,]/g, '').replace(/,/g, '_') + '.json' : QUICK ? 'local-quick.json' : 'local.json');
  const out = { generated: new Date().toISOString(), endYmd: END_YMD, cost: COST, nodeBudgetMs: NODE_BUDGET_MS, tiers: [], concurrency: [] };
  const prevByOp = {};
  for (const [M, Y] of TIERS) {
    const t0 = performance.now();
    let P;
    try { P = buildTier(M, Y); } catch (e) { console.log('tier', M, Y, 'build failed', e.message); continue; }
    const cells = tierCells(P.stats);
    const savingsRows = P.stats[P.val('SH_SAVINGS')].rows;
    const tier = { members: M, years: Y, cells, savingsRows, sheets: P.stats, buildMs: performance.now() - t0, ops: {} };
    console.log(`\n== ${M} members x ${Y}y: ${cells.rows} rows, ${(cells.used / 1e6).toFixed(2)}M used cells, ${(cells.grid / 1e6).toFixed(2)}M grid cells (built in ${(tier.buildMs / 1000).toFixed(1)}s)`);
    out.tiers.push(tier);
    if (cells.used > 10e6) { tier.skipped = 'Used cells exceed the 10M-cell spreadsheet limit: this tier cannot exist in one spreadsheet.'; console.log('  skipped:', tier.skipped); P = null; continue; }
    const st = P.stats, sz = { M, S: savingsRows, L: st[P.val('SH_LOANS')].rows, R: st[P.val('SH_REPAY')].rows,
      LR: st[P.val('SH_LOAN_REQ')].rows, F: st[P.val('SH_FINES')].rows };
    tier.sizes = sz;
    for (const op of OPS) {
      const runs = [];
      const budget = prevByOp[op.id] ? NODE_BUDGET_MS : NODE_BASELINE_BUDGET_MS;
      for (let r = 0; r < 3; r++) {
        let res;
        try { res = runOnce(P, op, r, budget); } catch (e) { res = { error: 'prep: ' + String(e.message || e).slice(0, 200), counters: zero(), cpu: 0, wall: 0 }; }
        runs.push(res);
        if (res.aborted || res.wall > NODE_BUDGET_MS / 4 || res.error) break;
      }
      const ok = runs.filter(r => !r.aborted && !r.error);
      const rec = { name: op.name, web: !!op.web, write: !!op.write, n: ok.length };
      if (ok.length) {
        const mid = ok.slice().sort((a, b) => modelMs(a.counters, a.cpu, 'central', op.web) - modelMs(b.counters, b.cpu, 'central', op.web))[Math.floor((ok.length - 1) / 2)];
        Object.assign(rec, { nodeMs: median(ok.map(r => r.wall)), cpuMs: median(ok.map(r => r.cpu)),
          model: { low: modelMs(mid.counters, mid.cpu, 'low', op.web), central: modelMs(mid.counters, mid.cpu, 'central', op.web), high: modelMs(mid.counters, mid.cpu, 'high', op.web) },
          counters: mid.counters, payload: mid.payload, slowest: mid.slowest, parts: mid.parts, sumModel: mid.sumModel, lockModel: mid.lockModel });
        prevByOp[op.id] = { sz, model: rec.model };
      } else if (runs[0] && runs[0].aborted && prevByOp[op.id]) {
        // stopped: scale the last tier where it finished by how this operation's work grows (GROWTH)
        const p = prevByOp[op.id], grow = GROWTH[op.id] || GROWTH.default, f = grow(sz) / grow(p.sz);
        rec.extrapolated = true; rec.extrapolationFactor = f; rec.extrapolatedFrom = p.sz.M + ' members, ' + p.sz.S + ' savings rows';
        rec.model = { low: p.model.low * f, central: p.model.central * f, high: p.model.high * f };
        rec.counters = runs[0].counters;
      } else rec.error = (runs[0] && (runs[0].error || (runs[0].aborted ? 'stopped at the local time budget, nothing to extrapolate from' : ''))) || 'failed';
      tier.ops[op.id] = rec;
      const m = rec.model;
      console.log(`  ${op.id.padEnd(18)} ${m ? (m.central / 1000).toFixed(2).padStart(8) + ' s' : '       -  '}${rec.extrapolated ? ' (extrapolated x' + rec.extrapolationFactor.toFixed(1) + ')' : ''}  node ${rec.nodeMs ? rec.nodeMs.toFixed(0) : '-'} ms${rec.error ? '  ERROR ' + rec.error : ''}`);
    }
    // The admin page makes 7 calls in parallel and shows when the slowest returns
    const ADMIN_PAGE = ['dashboard', 'members', 'activeLoans', 'repayments', 'loanReqs', 'wdReqs', 'fines'];
    const parts = ADMIN_PAGE.map(id => tier.ops[id]).filter(o => o && o.model);
    if (parts.length === ADMIN_PAGE.length) {
      const slow = parts.reduce((a, b) => (b.model.central > a.model.central ? b : a));
      tier.ops.adminPage = { name: 'Admin page: 7 calls in parallel (slowest)', web: true, derived: true, slowest: slow.name,
        extrapolated: parts.some(p => p.extrapolated),
        model: { low: Math.max(...parts.map(p => p.model.low)), central: slow.model.central, high: Math.max(...parts.map(p => p.model.high)) } };
    }
    P = null;
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
  // concurrency
  for (const k of tiersArg ? [] : [5, 10]) for (const kind of ['issueFine', 'requestLoan', 'acceptTerms']) {
    if (kind === 'requestLoan' && k > 11) continue;
    const r = concurrencyCollision(kind, k);
    out.concurrency.push(r);
    console.log(`  concurrency ${kind} x${k}: ${r.reportedOk} reported success, ${r.rowsAdded} rows added, ${r.distinctIds} distinct ids, ${r.lost} lost`);
  }
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('\nWritten ' + OUT);
}

fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
main();
