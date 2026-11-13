// Capacity fixes: each tab is read once per request (not once per member or per row), new records are
// written under the script lock in one call, a full tab grows instead of failing, and emails asked for
// while the lock is held go out after it is released. See docs/CAPACITY_AND_SCOPE_REPORT.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EMAIL, seed, ok } = require('./fixtures');

// Counts full reads of a tab (readSheet_ reads with getDataRange)
function countReads(fakes, name) {
  const sh = fakes.sheet(name), orig = sh.getDataRange.bind(sh);
  let n = 0;
  sh.getDataRange = () => { n++; return orig(); };
  return () => n;
}

function someSavings(ctx) {
  const { g, fakes } = ctx;
  fakes.signInAs(EMAIL.ALICE);
  [['M004', 'Deposit', 300000, 'Principal', 'Monthly Premium'], ['M005', 'Deposit', 120000, 'Principal', 'Monthly Premium'],
   ['M004', 'Deposit', 20000, 'Operations', 'Operations Fee'], ['M007', 'Deposit', 90000, 'Principal', 'Monthly Premium'],
   ['M002', 'Deposit', 400000, 'Principal', 'Monthly Premium'], ['M004', 'Withdrawal', 50000, 'Principal', '']]
    .forEach(([no, type, amt, acc, cat]) => ok(g.recordSavings(no, type, amt, acc, cat, '', '', '2024-01-05'), 'savings ' + no));
  const dep = ctx.ledger().find(r => r.MemberNo === 'M007');
  ok(g.reverseSavingsTransaction(dep.Reference, 'Entered twice'), 'reversal');
}

module.exports = {
  'the members list shows the same balances as each member\'s ledger, from one read of Savings'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    someSavings(ctx);
    const reads = countReads(fakes, val('SH_SAVINGS'));
    const res = ok(g.getAllMembersSummary(), 'members');
    assert.strictEqual(reads(), 1, 'Savings read once for all members');
    res.members.forEach(m => {
      const b = g.accountBalances_(m.memberNo);
      assert.strictEqual(m.savingsBalance, b.total, m.memberNo + ' total');
      assert.strictEqual(m.principalBalance, b.Principal, m.memberNo + ' Principal');
    });
    assert.strictEqual(res.members.find(m => m.memberNo === 'M004').principalBalance, 250000);
    assert.strictEqual(res.members.find(m => m.memberNo === 'M007').savingsBalance, 0, 'reversed deposit nets off');
  },

  'the loan request list and the ledger export read Savings once, however many requests and members'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    someSavings(ctx);
    const reqs = fakes.sheet(val('SH_LOAN_REQ'));
    for (let i = 1; i <= 6; i++) reqs.data.push(['LRQ-00000' + i, '2024-02-0' + i + ' 10:00:00', i % 2 ? 'M004' : 'M005', 50000 * i, '2', 'x', 'Rejected', 'n', 'M001', 'M004']);
    fakes.signInAs(EMAIL.ALICE);
    let reads = countReads(fakes, val('SH_SAVINGS'));
    const list = ok(g.getLoanRequests(), 'loan requests');
    assert.strictEqual(reads(), 1, 'getLoanRequests');
    const r = list.requests.find(x => x.requestId === 'LRQ-000001');
    assert.strictEqual(r.savings, g.principalBalance_('M004'), 'limit check uses the member\'s Principal');
    assert.strictEqual(r.maxLoan, g.principalBalance_('M004') * 0.5);
    reads = countReads(fakes, val('SH_SAVINGS'));
    const csv = ok(g.exportAdminCSV(), 'csv').csv;
    assert.strictEqual(reads(), 1, 'exportAdminCSV');
    assert.match(csv, /M004,Dan,dan@x\.org,Member,Active,270000,0,0,0/);
  },

  'surcharges, loan requests and terms acceptance are recorded under the script lock'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fakes.signInAs(EMAIL.ALICE);
    let before = fakes.locks();
    ok(g.issueFine('M004', 2000, 'Late'), 'surcharge');
    assert.ok(fakes.locks() > before, 'issueFine takes the lock');
    before = fakes.locks();
    g.requestLoan(100000, '3', 'x', ['M001', 'M002']);   // refused or not, the checks run under the lock
    assert.ok(fakes.locks() > before, 'requestLoan takes the lock');
    before = fakes.locks();
    g.recordTerms_({ memberNo: 'M004', email: EMAIL.DAN, role: 'Member' }, ['use'], 'Accepted');
    assert.ok(fakes.locks() > before, 'recordTerms_ takes the lock');
  },

  'the lock is re-entrant: a function that holds it can call another that takes it'(c) {
    const { g, fakes } = seed(c);
    const before = fakes.locks();
    const out = g.withScriptLock_(() => g.withScriptLock_(() => 42));
    assert.strictEqual(out, 42);
    assert.strictEqual(fakes.locks() - before, 1, 'acquired once');
    assert.strictEqual(g.LOCK_DEPTH_, 0, 'released');
  },

  'a full tab grows instead of failing when a record is added'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    fakes.signInAs(EMAIL.ALICE);
    ok(g.recordSavings('M004', 'Deposit', 1000, 'Principal', 'Monthly Premium', '', '', '2024-01-05'), 'first');
    // Every grid row used, as on a tab whose 1,000 rows are full
    [val('SH_SAVINGS'), val('SH_FINES'), val('SH_WD_REQ')].forEach(n => { const sh = fakes.sheet(n); sh.maxRows = sh.data.length; });
    ok(g.recordSavings('M004', 'Deposit', 2000, 'Principal', 'Monthly Premium', '', '', '2024-01-06'), 'deposit on a full tab');
    ok(g.issueFine('M004', 2000, 'Late'), 'surcharge on a full tab');
    fakes.signInAs(EMAIL.DAN);
    ok(g.requestWithdrawal(500, 'Dividends', '', 'Principal'), 'withdrawal request on a full tab');
    assert.deepStrictEqual(ctx.ledger().map(r => r['Amount (UGX)']), [1000, 2000]);
    assert.ok(fakes.sheet(val('SH_SAVINGS')).maxRows >= fakes.sheet(val('SH_SAVINGS')).data.length, 'grid grew');
  },

  'a new record goes into the first row with a blank key, as before'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    const fines = fakes.sheet(val('SH_FINES'));
    fines.data.push(['SUR-000001', 'M004', 1000, 'Paid'], ['', '', '', ''], ['SUR-000002', 'M005', 1000, 'Unpaid']);
    fakes.signInAs(EMAIL.ALICE);
    const id = ok(g.issueFine('M007', 3000, 'Late'), 'surcharge').fineId;
    assert.strictEqual(id, 'SUR-000003');
    assert.strictEqual(fines.data[2][0], 'SUR-000003', 'the blank row between is used');
    assert.strictEqual(fines.data.length, 4, 'no row appended');
  },

  'emails asked for while the lock is held are sent after it is released'(c) {
    const { g, fakes } = seed(c);
    // The real sender (the test fakes replace it): load EmailService.gs again over the fakes
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'EmailService.gs'), 'utf8'), g);
    g.logoBlob_ = () => null;
    const sent = [];
    g.MailApp = { sendEmail: o => sent.push(o.to) };
    g.withScriptLock_(() => {
      g.sendHtmlEmail_('a@x.org', 'Subject', '<p>x</p>');
      assert.deepStrictEqual(sent, [], 'not sent while the lock is held');
    });
    assert.deepStrictEqual(sent, ['a@x.org'], 'sent once released');
    g.sendHtmlEmail_('b@x.org', 'Subject', '<p>x</p>');
    assert.deepStrictEqual(sent, ['a@x.org', 'b@x.org'], 'sent at once outside the lock');
    fakes.signInAs(EMAIL.ALICE);
  }
};
