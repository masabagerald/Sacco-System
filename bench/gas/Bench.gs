// ── CAPACITY BENCHMARK FOR A COPY (never a live club) ─────────────────────────
// Pushed by bench/push-to-copy.ps1 into a SEPARATE test project, as src/zz_bench/ (loaded last, so the
// declarations below replace the app's email sender and sign-in lookup in the copy only).
// See bench/README.md for the steps. Results go to the "Bench Results" tab.
//
// Safety:
//   - benchInit refuses unless the spreadsheet's name starts with "BENCH" and it has no member data yet.
//   - Every other bench function refuses until benchInit has marked this project as a bench copy.
//   - No email is sent: sendHtmlEmail_ below replaces the real one (every app email goes through it).
//   - The app's scheduled jobs are never created (setup is done without setupNewClub's triggers).
//   - Synthetic members use @example.invalid addresses, which cannot receive mail.

// ── Overrides (copy only) ──
var BENCH_EMAILS_ = 0;
function sendHtmlEmail_(to, subject, html) { BENCH_EMAILS_++; }
var BENCH_AS_ = '';
// Sign-in as a synthetic member for the timed call. Same lookup as the app (reads the Members tab).
function signedInMember_() {
  if (!BENCH_AS_) return { ok: false, error: 'Bench: no member set.' };
  return lookupMember_(BENCH_AS_);
}

const BENCH_RESULTS = 'Bench Results';
const BENCH_SLICE_MS = 4.5 * 60 * 1000;   // stop and continue in a new execution before the 6-minute limit

function benchProps_() { return PropertiesService.getScriptProperties(); }
function benchGuard_() {
  if (benchProps_().getProperty('BENCH_COPY') !== 'yes') throw new Error('Not a bench copy. Run benchInit() first (on a spreadsheet named "BENCH ...").');
  if (!/^BENCH/i.test(SpreadsheetApp.getActiveSpreadsheet().getName())) throw new Error('The spreadsheet name must start with BENCH.');
}
function benchCfgNow_() {
  const c = JSON.parse(benchProps_().getProperty('BENCH_CFG') || 'null');
  if (!c) throw new Error('Run benchSetTier(members, years) first.');
  return c;
}

// 1. Run once on a NEW, empty spreadsheet named "BENCH ..." (File > Rename).
function benchInit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!/^BENCH/i.test(ss.getName())) throw new Error('Rename this spreadsheet so its name starts with BENCH, then run again. (Safety check: this must never run on a live club.)');
  const mem = ss.getSheetByName(SH_MEMBERS);
  if (mem && mem.getLastRow() > 2 && benchProps_().getProperty('BENCH_COPY') !== 'yes')
    throw new Error('This spreadsheet already has members. Use a new, empty spreadsheet.');
  benchProps_().setProperty('BENCH_COPY', 'yes');
  benchProps_().setProperty('setupVersion', SETUP_VERSION);   // the web page will not run setup (and its triggers)
  benchProps_().setProperty('BENCH_SECRET', Utilities.getUuid());
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction().indexOf('bench') !== 0).forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Bench copy ready. Next: benchSetTier(100, 1) then benchGenerate().');
}

// 2. Choose the tier. Clears the previous tier's data. trimColumns: delete unused columns (A-Z grid) so
//    larger tiers fit under the 10M-cell limit; it does not change any timing.
function benchSetTier(members, years, trimColumns) {
  benchGuard_();
  members = members || 100; years = years || 1;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const keep = ss.getSheetByName(BENCH_RESULTS) || ss.insertSheet(BENCH_RESULTS);
  ss.getSheets().forEach(sh => { if (sh.getSheetId() !== keep.getSheetId()) ss.deleteSheet(sh); });
  coreTabs_().forEach(([name, hint, headers]) => ensureTab_(name, hint, headers));
  setupGuaranteeSchema();
  const end = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  benchProps_().setProperty('BENCH_CFG', JSON.stringify(Object.assign(benchCfg_(members, years, end, hostEmail_()), { trim: trimColumns !== false })));
  benchProps_().setProperty('BENCH_GEN_NEXT', '-1');
  benchProps_().deleteProperty('BENCH_RUN_STATE');
  Logger.log('Tier set: ' + members + ' members x ' + years + ' years. Next: benchGenerate() (it continues by itself until done).');
}

// 3. Fills the tabs month by month. Continues itself (a one-off trigger) until every month is written.
function benchGenerate() {
  benchGuard_();
  const t0 = Date.now(), cfg = benchCfgNow_();
  const mk = (y, m, d, h, mi, s) => new Date(y, m, d, h, mi, s);
  let k = Number(benchProps_().getProperty('BENCH_GEN_NEXT'));
  while (k < cfg.months) {
    const rows = k < 0 ? benchStaticRows_(cfg, mk) : benchMonthRows_(cfg, k, mk);
    Object.keys(rows).forEach(name => benchAppend_(name, rows[name], cfg.trim));
    k++;
    benchProps_().setProperty('BENCH_GEN_NEXT', String(k));
    if (Date.now() - t0 > BENCH_SLICE_MS) { benchContinue_('benchGenerate'); Logger.log('Written up to month ' + k + ' of ' + cfg.months + '; continuing in a minute.'); return; }
  }
  benchStopContinuations_('benchGenerate');
  SpreadsheetApp.flush();
  benchResult_(cfg, 'generate', 0, 0, true, 'done: ' + JSON.stringify(benchInventory_(SpreadsheetApp.getActiveSpreadsheet())));
  Logger.log('Data ready. Next: benchRun().');
}

function benchAppend_(name, objs, trim) {
  if (!objs.length) return;
  const sh = getSheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const data = benchToArrays_(headers, objs);
  const last = sh.getLastRow();
  if (sh.getMaxRows() < last + data.length) sh.insertRowsAfter(sh.getMaxRows(), last + data.length - sh.getMaxRows());
  if (trim && sh.getMaxColumns() > headers.length) sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
  sh.getRange(last + 1, 1, data.length, headers.length).setValues(data);
}

// ── Timed operations: the same set as bench/run-local.js ──
function benchOps_() {
  const cfg = benchCfgNow_(), mm = benchMembers_(cfg);
  const triple = t => [mm.clean[3 * t], mm.clean[3 * t + 1], mm.clean[3 * t + 2]];
  const member = mm.list[10].email, admin = mm.admins[1].email;
  const activeLoan = r => {
    const act = readSheet_(SH_LOANS, 'loanid').rows.filter(l => l['Status'] === 'Active' && l['Loan Model'] === 'Member');
    return act[r % act.length]['LoanID'];
  };
  // { id, who: email or (run => email), prep: run => args (not timed), fn: (run, args) => result }
  const op = (id, who, fn, prep) => ({ id, who, fn, prep });
  return [
    op('auth', member, () => getCurrentMember()),
    op('mySavings', member, () => getMySavings()),
    op('myLoans', member, () => getMyLoans()),
    op('statement', member, () => getMemberStatementData()),
    op('memberPdf', member, () => { const d = getMemberStatementData(); return { ok: true, bytes: brandedPdf_('BENCH statement', 'Member statement', b => statementBody_(b, d)).getBytes().length }; }),
    op('dashboard', admin, () => getAdminDashboard()),
    op('members', admin, () => getAllMembersSummary()),
    op('loanReqs', admin, () => getLoanRequests()),
    op('activeLoans', admin, () => getActiveLoans()),
    op('repayments', admin, () => getRepayments()),
    op('wdReqs', admin, () => getWithdrawalRequests()),
    op('fines', admin, () => getAllFinesForAdmin()),
    op('savingsTx', admin, () => getSavingsTransactions({})),
    op('insights', admin, () => getLoanInsights({})),
    op('fundLedger', admin, () => getLoanFundLedger({})),
    op('auditLog', admin, () => getAuditLog({ pageSize: 100 })),
    op('csv', admin, () => exportAdminCSV()),
    op('adminPdf', admin, () => generateAdminReportPdf()),
    op('recordSavings', admin, () => recordSavings(mm.list[10].no, 'Deposit', 50000, 'Principal', 'Monthly Premium', '', 'bench', '')),
    op('recordRepayment', admin, (r, a) => recordRepayment(a, 1000, 'bench', '', { allowOverpayment: true, confirmDuplicate: true }), r => activeLoan(r)),
    op('requestWithdrawal', r => mm.clean[r].email, () => requestWithdrawal(5000, 'Dividends', '', 'Principal')),
    op('requestLoan', r => triple(r)[0].email, r => requestLoan(100000, '3', 'bench', [triple(r)[1].no, triple(r)[2].no])),
    op('approveLoan', mm.admins[3].email, (r, id) => approveLoanRequest(id, 'bench override'), r => benchApprovable_(triple(3 + r), mm)),
    op('issueFine', admin, () => issueFine(mm.list[11].no, 5000, 'bench')),
    op('jobStatements', '', () => sendMonthlyStatements()),
    op('jobDueDates', '', () => processLoanDueDates()),
    op('jobPending', '', () => sendPendingActionReminders_(Date.now())),
    op('jobRepayRem', '', () => sendRepaymentReminders_())
  ];
}

// In the copy only: scheduled jobs may be timed from a bench continuation trigger (still bench-copy only)
function ownerOrTrigger_(e) { benchGuard_(); }

// A request with both guarantors accepted and a first approval (prepared outside the timing)
function benchApprovable_(t, mm) {
  BENCH_AS_ = t[0].email;
  const res = requestLoan(100000, '3', 'bench', [t[1].no, t[2].no]);
  if (!res.ok) throw new Error('prep: ' + res.error);
  const { sh, headers, rows } = readSheet_(SH_GUARANTORS, 'requestid');
  rows.filter(r => r['RequestID'] === res.requestId).forEach(r => sh.getRange(r._row, ci(headers, 'response') + 1).setValue('Accepted'));
  BENCH_AS_ = mm.admins[2].email;
  const a1 = approveLoanRequest(res.requestId, 'bench override');
  if (!a1.ok) throw new Error('prep: ' + a1.error);
  BENCH_AS_ = mm.admins[3].email;
  return res.requestId;
}

// 4. Times every operation 3 times (median in the summary). Continues itself across executions; an
//    operation that is still running when Apps Script stops the execution (6 minutes) is recorded as such.
function benchRun() {
  benchGuard_();
  const t0 = Date.now(), cfg = benchCfgNow_(), ops = benchOps_();
  const st = JSON.parse(benchProps_().getProperty('BENCH_RUN_STATE') || '{"i":0,"r":0,"inFlight":null}');
  if (st.inFlight) {   // the previous execution was stopped while this run was going
    benchResult_(cfg, st.inFlight.op, st.inFlight.r, Date.now() - st.inFlight.at, false, 'Execution stopped by Apps Script (6-minute limit) during this run');
    st.i++; st.r = 0; st.inFlight = null;
  }
  while (st.i < ops.length) {
    const { id, who, fn, prep } = ops[st.i];
    if (Date.now() - t0 > BENCH_SLICE_MS - 60000) break;
    st.inFlight = { op: id, r: st.r, at: Date.now() };
    benchProps_().setProperty('BENCH_RUN_STATE', JSON.stringify(st));
    let ms = 0, ok = false, note = '';
    try {
      const args = prep ? prep(st.r) : null;                      // not timed
      BENCH_AS_ = typeof who === 'function' ? who(st.r) : who;
      SpreadsheetApp.flush();
      const t = Date.now();
      const res = fn(st.r, args);
      SpreadsheetApp.flush();
      ms = Date.now() - t;
      ok = !(res && res.ok === false);
      note = ok ? (res ? 'payload ' + JSON.stringify(res).length + ' chars' : '') : String(res.error || '').slice(0, 300);
    } catch (e) { note = String(e && e.message || e).slice(0, 300); }
    SpreadsheetApp.flush();
    benchResult_(cfg, id, st.r, ms, ok, note + ' | emails ' + BENCH_EMAILS_);
    BENCH_EMAILS_ = 0;
    st.inFlight = null;
    st.r++;
    if (st.r >= 3 || !ok || ms > 120000) { st.i++; st.r = 0; }
    benchProps_().setProperty('BENCH_RUN_STATE', JSON.stringify(st));
  }
  if (st.i < ops.length) { benchContinue_('benchRun'); Logger.log('Continuing in a minute (op ' + st.i + ' of ' + ops.length + ').'); return; }
  benchStopContinuations_('benchRun');
  benchProps_().deleteProperty('BENCH_RUN_STATE');
  Logger.log('All operations timed for this tier. See the "' + BENCH_RESULTS + '" tab.');
}

// ── Concurrency: k simultaneous requests through the deployed copy (Deploy > New deployment > Web app,
//    Execute as: Me, Access: Anyone). url: the copy's /exec URL. op: 'issueFine' | 'recordSavings' |
//    'requestLoan' | 'recordRepayment'. Records successes, lock timeouts and duplicate references.
function benchConcurrency(url, op, k) {
  benchGuard_();
  const cfg = benchCfgNow_(), mm = benchMembers_(cfg), secret = benchProps_().getProperty('BENCH_SECRET');
  k = k || 5;
  const reqs = [];
  for (let j = 0; j < k; j++) reqs.push({ url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify({ secret, op, j }) });
  const t = Date.now();
  const out = UrlFetchApp.fetchAll(reqs).map(r => { try { return JSON.parse(r.getContentText()); } catch (e) { return { ok: false, error: 'HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 120) }; } });
  const wall = Date.now() - t;
  const okList = out.filter(o => o.ok);
  const ids = okList.map(o => o.id).filter(Boolean);
  const dupIds = ids.length - new Set(ids).size;
  let rowsCheck = '';
  if (op === 'issueFine') { const n = readSheet_(SH_FINES, 'fineid').rows.filter(r => /^concurrent/.test(r['Reason'])).length; rowsCheck = 'surcharge rows written: ' + n; }
  if (op === 'requestLoan') { const n = readSheet_(SH_LOAN_REQ, 'requestid').rows.filter(r => /^concurrent/.test(r['Purpose'])).length; rowsCheck = 'loan request rows written: ' + n; }
  benchResult_(cfg, 'concurrency ' + op + ' x' + k, 0, wall, dupIds === 0 && okList.length === k,
    okList.length + '/' + k + ' succeeded; duplicate references: ' + dupIds + '; ' + rowsCheck + '; errors: ' + out.filter(o => !o.ok).map(o => o.error).join(' | ').slice(0, 300));
}

// The copy's web-app handler for benchConcurrency (POST only; needs the secret from benchInit)
function doPost(e) {
  const reply = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    benchGuard_();
    const b = JSON.parse(e.postData.contents);
    if (b.secret !== benchProps_().getProperty('BENCH_SECRET')) return reply({ ok: false, error: 'bad secret' });
    const cfg = benchCfgNow_(), mm = benchMembers_(cfg), j = Number(b.j) || 0;
    const t = Date.now();
    let res;
    if (b.op === 'issueFine') { BENCH_AS_ = mm.admins[1 + j % 5].email; res = issueFine(mm.list[20 + j].no, 1000 + j, 'concurrent ' + j); res.id = res.fineId; }
    else if (b.op === 'recordSavings') { BENCH_AS_ = mm.admins[1 + j % 5].email; res = recordSavings(mm.list[20 + j].no, 'Deposit', 1000 + j, 'Principal', 'Monthly Premium', '', 'concurrent ' + j, ''); res.id = res.reference; }
    else if (b.op === 'requestLoan') { const c = mm.clean; BENCH_AS_ = c[3 * j].email; res = requestLoan(100000 + j, '3', 'concurrent ' + j, [c[3 * j + 1].no, c[3 * j + 2].no]); res.id = res.requestId; }
    else if (b.op === 'recordRepayment') {
      BENCH_AS_ = mm.admins[1 + j % 5].email;
      const act = readSheet_(SH_LOANS, 'loanid').rows.filter(l => l['Status'] === 'Active' && l['Loan Model'] === 'Member');
      res = recordRepayment(act[j % act.length]['LoanID'], 100 + j, 'concurrent ' + j, '', { allowOverpayment: true, confirmDuplicate: true }); res.id = res.reference;
    } else res = { ok: false, error: 'unknown op' };
    res.ms = Date.now() - t;
    return reply(res);
  } catch (err) { return reply({ ok: false, error: String(err && err.message || err) }); }
}

// ── Checks and helpers ──

// Does writing one row below the bottom of a tab's grid work? emptyRow_() in the app writes to
// (last row + 1) with getRange().setValue(); this tells whether that fails once a tab's grid is full.
function benchProbeGridEdge() {
  benchGuard_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet('Bench Probe ' + Date.now());
  sh.deleteRows(6, sh.getMaxRows() - 5);
  sh.getRange(1, 1, 5, 1).setValues([[1], [2], [3], [4], [5]]);
  let note;
  try { sh.getRange(6, 1).setValue('x'); SpreadsheetApp.flush(); note = 'Writing below the grid WORKED: the tab grew to ' + sh.getMaxRows() + ' rows.'; }
  catch (e) { note = 'Writing below the grid FAILED: ' + e.message; }
  ss.deleteSheet(sh);
  benchResult_({ members: 0, years: 0 }, 'probe grid edge', 0, 0, true, note);
  Logger.log(note);
}

// Read-only: rows, columns and grid cells of every tab of any spreadsheet you can open (for example the
// live one, by its ID). Opens it read-only; writes the result to this copy's Bench Results tab.
function benchInventoryOf(spreadsheetId) {
  benchGuard_();
  const inv = benchInventory_(SpreadsheetApp.openById(spreadsheetId));
  benchResult_({ members: 0, years: 0 }, 'inventory ' + spreadsheetId.slice(0, 8) + '…', 0, 0, true, JSON.stringify(inv));
  Logger.log(JSON.stringify(inv, null, 1));
}

function benchInventory_(ss) {
  const tabs = ss.getSheets().map(sh => ({ tab: sh.getName(), rows: sh.getLastRow(), cols: sh.getLastColumn(), gridCells: sh.getMaxRows() * sh.getMaxColumns() }));
  return { tabs, totalGridCells: tabs.reduce((s, t) => s + t.gridCells, 0) };
}

function benchResult_(cfg, op, run, ms, ok, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(BENCH_RESULTS) || ss.insertSheet(BENCH_RESULTS);
  if (sh.getLastRow() === 0) sh.appendRow(['When', 'Members', 'Years', 'Operation', 'Run', 'ms', 'OK', 'Note']);
  sh.appendRow([new Date(), cfg.members, cfg.years, op, run + 1, ms, ok, String(note || '').slice(0, 45000)]);
}

function benchContinue_(fn) {
  benchStopContinuations_(fn);
  ScriptApp.newTrigger(fn).timeBased().after(60 * 1000).create();
}
function benchStopContinuations_(fn) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === fn).forEach(t => ScriptApp.deleteTrigger(t));
}

// Removes every trigger in this copy (bench continuations included)
function benchStop() { ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); Logger.log('All triggers in this copy removed.'); }
