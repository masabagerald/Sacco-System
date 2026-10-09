// End-to-end tests for deposit accounts: real controllers against an in-memory spreadsheet.
const assert = require('assert');

const ALICE = 'alice@x.org', BOB = 'bob@x.org', CAROL = 'carol@x.org', DAN = 'dan@x.org', EVE = 'eve@x.org', NAN = 'nan@x.org';

function seed({ g, fakes, val }) {
  fakes.addSheet(val('SH_MEMBERS'), [
    ['MemberNo', 'Full Name', 'Email', 'Phone', 'Role', 'Membership Type', 'Date Joined', 'Status'],
    ['M001', 'Alice', ALICE, '', 'Admin', 'Founder Member', '2024-01-01', 'Active'],
    ['M002', 'Bob', BOB, '', 'Admin', 'Founder Member', '2024-01-01', 'Active'],
    ['M003', 'Carol', CAROL, '', 'Admin', 'Delegate Member', '2024-01-01', 'Active'],
    ['M004', 'Dan', DAN, '', 'Member', 'Founder Member', '2024-01-01', 'Active'],
    ['M005', 'Eve', EVE, '', 'Member', 'Delegate Member', '2024-01-01', 'Active'],
    ['M006', 'Nan', NAN, '', 'Member', 'Non-Member', '2024-01-01', 'Active']
  ]);
  // Title rows above the header, as on the real tabs
  fakes.addSheet(val('SH_SAVINGS'), [['Savings Ledger'], [],
    ['Date', 'Timestamp', 'MemberNo', 'Deposit Type', 'Amount (UGX)', 'Recorded By', 'Reference', 'Notes', 'Payment Category', 'Surcharge Reason', 'Deposit Account', 'Reverses']]);
  fakes.addSheet(val('SH_WD_REQ'), [['RequestID', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Reason', 'Status', 'Decision Notes', 'Decided By',
    'Initiated By', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Deposit Account']]);
  fakes.addSheet(val('SH_AUDIT'), [['Timestamp', 'Action', 'Member (Affected)', 'Performed By', 'Details', 'Reference ID']]);
  fakes.addSheet(val('SH_LOANS'), [['LoanID', 'MemberNo', 'Date Issued', 'Principal (UGX)', 'Status']]);
  fakes.addSheet(val('SH_REPAY'), [['LoanID', 'Date', 'Amount (UGX)']]);
  fakes.addSheet(val('SH_FINES'), [['FineID', 'MemberNo', 'Amount (UGX)', 'Status']]);
  fakes.addSheet(val('SH_LOAN_REQ'), [['RequestID', 'MemberNo', 'Status']]);
  return { g, fakes, val, ledger: () => fakes.sheet(val('SH_SAVINGS')).records('memberno'),
    audit: () => fakes.sheet(val('SH_AUDIT')).records('timestamp'), wdReqs: () => fakes.sheet(val('SH_WD_REQ')).records('requestid') };
}

function ok(res, label) { assert.ok(res && res.ok, label + ': ' + JSON.stringify(res)); return res; }
function fails(res, pattern, label) {
  assert.ok(res && !res.ok, label + ' should fail but returned ' + JSON.stringify(res));
  if (pattern) assert.match(res.error, pattern, label);
}
const accountsOf = g => { const d = g.getAdminDashboard(); const o = {}; d.depositAccounts.forEach(a => { o[a.account] = a; }); return o; };

// Gives Dan (Founder) 100,000 Principal and 10,000 Welfare, recorded by Alice.
function fundDan(g, fakes) {
  fakes.signInAs(ALICE);
  ok(g.recordSavings('M004', 'Deposit', 100000, 'Principal', 'Monthly Premium', '', '', ''), 'Principal deposit');
  ok(g.recordSavings('M004', 'Deposit', 10000, 'Welfare', 'Welfare Fee', '', '', ''), 'Welfare deposit');
}

module.exports = {
  'recording a contribution updates only its account and the dashboard'(ctx) {
    const { g, fakes, ledger, audit } = seed(ctx);
    fakes.signInAs(ALICE);
    const res = ok(g.recordSavings('M004', 'Deposit', 50000, 'Operations', 'Operations Fee', '', 'slip 17', ''), 'record');
    assert.strictEqual(res.accountBalance, 50000);
    const rows = ledger();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['Deposit Account'], 'Operations');
    assert.strictEqual(rows[0]['Recorded By'], 'M001');
    assert.strictEqual(rows[0]['Notes'], 'slip 17');
    const acc = accountsOf(g);
    assert.strictEqual(acc.Operations.contributions, 50000);
    assert.strictEqual(acc.Operations.contributionsThisMonth, 50000);
    assert.strictEqual(acc.Principal.contributions, 0);
    assert.strictEqual(acc.Welfare.contributions, 0);
    const a = audit().find(e => e.Action === 'Deposit');
    assert.ok(a && a['Performed By'] === 'M001' && /Operations account/.test(a.Details), 'audit entry names the admin and the account');
  },

  'contribution recording is validated on the server'(ctx) {
    const { g, fakes, ledger } = seed(ctx);
    fakes.signInAs(DAN);
    fails(g.recordSavings('M004', 'Deposit', 1000, 'Principal', 'Monthly Premium', '', '', ''), /Admin access/, 'non-admin');
    fakes.signInAs(ALICE);
    fails(g.recordSavings('M004', 'Deposit', 1000, '', 'Monthly Premium', '', '', ''), /deposit account/, 'missing account');
    fails(g.recordSavings('M004', 'Deposit', 1000, 'Principal', 'Welfare Fee', '', '', ''), /cannot be filed under the Principal/, 'category in the wrong account');
    fails(g.recordSavings('M999', 'Deposit', 1000, 'Principal', 'Monthly Premium', '', '', ''), /Member not found/, 'unknown member');
    fails(g.recordSavings('M006', 'Deposit', 1000, 'Principal', 'Monthly Premium', '', '', ''), /Non-Members/, 'non-member');
    fundDan(g, fakes);
    fails(g.recordSavings('M004', 'Withdrawal', 20000, 'Welfare', '', '', '', ''), /Insufficient balance in the Welfare/, 'withdrawal over the Welfare balance though the total is enough');
    assert.strictEqual(ledger().length, 2, 'rejected entries write nothing');
  },

  'correcting a contribution keeps the original and moves the dashboard totals'(ctx) {
    const { g, fakes, ledger, audit } = seed(ctx);
    fakes.signInAs(ALICE);
    const dep = ok(g.recordSavings('M004', 'Deposit', 30000, 'Principal', 'Monthly Premium', '', '', ''), 'record');
    fakes.signInAs(BOB);
    const fix = ok(g.correctContribution(dep.reference, 25000, 'Welfare', 'Welfare Fee', '', '', 'Wrong account and amount'), 'correct');
    const rows = ledger();
    assert.strictEqual(rows.length, 3, 'original + reversal + corrected entry');
    assert.strictEqual(rows[0].Reference, dep.reference);
    assert.strictEqual(rows[0]['Amount (UGX)'], 30000, 'original amount untouched');
    assert.strictEqual(rows[0]['Deposit Account'], 'Principal', 'original account untouched');
    assert.strictEqual(rows[1]['Deposit Type'], 'Deposit Reversal');
    assert.strictEqual(rows[1].Reverses, dep.reference);
    assert.strictEqual(rows[2].Reference, fix.reference);
    assert.strictEqual(rows[2]['Recorded By'], 'M002');
    const acc = accountsOf(g);
    assert.strictEqual(acc.Principal.contributions, 0);
    assert.strictEqual(acc.Welfare.contributions, 25000);
    const a = audit().find(e => e.Action === 'Contribution Corrected');
    assert.ok(a, 'correction is audited');
    assert.strictEqual(a['Performed By'], 'M002');
    assert.match(a.Details, /Before: UGX 30,000 in Principal.*After: UGX 25,000 in Welfare.*Reason: Wrong account and amount/);
    fails(g.correctContribution(dep.reference, 20000, 'Welfare', 'Welfare Fee', '', '', 'again'), /already been reversed/, 'second correction of the same entry');
    fails(g.correctContribution(fix.reference, 25000, 'Welfare', 'Welfare Fee', '', '', 'no-op'), /Nothing to change/, 'unchanged correction');
    fails(g.correctContribution(fix.reference, 1, 'Welfare', 'Welfare Fee', '', '', ''), /reason/, 'correction without a reason');
  },

  'reversing a contribution updates the dashboard and cannot be repeated'(ctx) {
    const { g, fakes, ledger } = seed(ctx);
    fundDan(g, fakes);
    const welfareDep = ledger()[1].Reference;
    const rev = ok(g.reverseSavingsTransaction(welfareDep, 'Recorded against the wrong member'), 'reverse');
    assert.strictEqual(accountsOf(g).Welfare.contributions, 0);
    assert.strictEqual(accountsOf(g).Principal.contributions, 100000);
    fails(g.reverseSavingsTransaction(welfareDep, 'again'), /already been reversed/, 'double reversal');
    fails(g.reverseSavingsTransaction(rev.reference, 'undo'), /Only deposits and withdrawals/, 'reversing a reversal');
  },

  'a Founder withdraws from one account after two different admins approve'(ctx) {
    const { g, fakes, ledger, wdReqs } = seed(ctx);
    fundDan(g, fakes);
    fakes.signInAs(DAN);
    const mine = ok(g.getMySavings(), 'my savings');
    assert.deepStrictEqual([mine.accounts.Principal, mine.accounts.Operations, mine.accounts.Welfare, mine.canWithdraw], [100000, 0, 10000, true]);
    fails(g.requestWithdrawal(20000, 'Welfare', '', 'Welfare'), /exceeds the available Welfare balance/, 'more than the Welfare balance');
    fails(g.requestWithdrawal(5000, 'Welfare', ''), /account to withdraw from/, 'no account chosen');
    const req = ok(g.requestWithdrawal(8000, 'Welfare', '', 'Welfare'), 'request');
    fails(g.requestWithdrawal(3000, 'Welfare', '', 'Welfare'), /after requests still awaiting approval/, 'pending request is set aside');
    assert.strictEqual(wdReqs()[0]['Deposit Account'], 'Welfare');
    fails(g.approveWithdrawal(req.requestId), /Admin access/, 'member approving');

    fakes.signInAs(ALICE);
    assert.strictEqual(ok(g.approveWithdrawal(req.requestId), 'first').stage, 'first');
    fails(g.approveWithdrawal(req.requestId), /already gave the first approval/, 'same admin twice');
    assert.strictEqual(ledger().length, 2, 'no funds released after one approval');

    fakes.signInAs(BOB);
    assert.strictEqual(ok(g.approveWithdrawal(req.requestId), 'final').stage, 'final');
    const wd = ledger()[2];
    assert.deepStrictEqual([wd['Deposit Type'], wd['Deposit Account'], wd['Amount (UGX)'], wd['Recorded By']], ['Withdrawal', 'Welfare', 8000, 'M002']);
    const r = wdReqs()[0];
    assert.deepStrictEqual([r.Status, r['Approver 1'], r['Approver 2']], ['Approved', 'M001', 'M002']);
    fakes.signInAs(DAN);
    const after = g.getMySavings();
    assert.deepStrictEqual([after.accounts.Principal, after.accounts.Welfare], [100000, 2000], 'only Welfare is reduced');
    const acc = accountsOf((fakes.signInAs(ALICE), g));
    assert.strictEqual(acc.Welfare.withdrawals, 8000);
    assert.strictEqual(acc.Welfare.balance, 2000);
    assert.strictEqual(acc.Welfare.contributions, 10000, 'withdrawals do not reduce contributions');
    fakes.signInAs(CAROL);
    fails(g.approveWithdrawal(req.requestId), /Already decided/, 'approving a finished request');
  },

  'an admin cannot approve a withdrawal they initiated'(ctx) {
    const { g, fakes } = seed(ctx);
    fakes.signInAs(BOB);
    ok(g.recordSavings('M001', 'Deposit', 40000, 'Operations', 'Operations Fee', '', '', ''), 'fund Alice');
    fakes.signInAs(ALICE);
    const req = ok(g.requestWithdrawal(10000, 'Dividends', '', 'Operations'), 'Alice requests');
    fails(g.approveWithdrawal(req.requestId), /You initiated this request/, 'initiator approving');
    fakes.signInAs(BOB);
    ok(g.approveWithdrawal(req.requestId), 'Bob first');
    fails(g.approveWithdrawal(req.requestId), /already gave the first approval/, 'Bob second');
    fakes.signInAs(ALICE);
    fails(g.approveWithdrawal(req.requestId), /You initiated this request/, 'initiator giving the final approval');
    fakes.signInAs(CAROL);
    assert.strictEqual(ok(g.approveWithdrawal(req.requestId), 'Carol final').stage, 'final');
  },

  'withdrawal requests are limited to eligible membership types'(ctx) {
    const { g, fakes, val } = seed(ctx);
    fakes.signInAs(ALICE);
    ok(g.recordSavings('M005', 'Deposit', 40000, 'Principal', 'Monthly Premium', '', '', ''), 'fund Eve');
    fakes.signInAs(EVE);
    const delegateAllowed = val('WITHDRAWAL_MEMBERSHIP_TYPES').indexOf('Delegate Member') > -1;
    assert.strictEqual(g.getMySavings().canWithdraw, delegateAllowed);
    const res = g.requestWithdrawal(1000, 'Dividends', '', 'Principal');
    if (delegateAllowed) ok(res, 'Delegate request'); else fails(res, /open to Founder Member/, 'Delegate request');
    fakes.signInAs(NAN);
    fails(g.requestWithdrawal(1000, 'Dividends', '', 'Principal'), /open to/, 'Non-Member request');
  },

  'final approval re-checks the account balance'(ctx) {
    const { g, fakes } = seed(ctx);
    fundDan(g, fakes);
    fakes.signInAs(DAN);
    const req = ok(g.requestWithdrawal(8000, 'Welfare', '', 'Welfare'), 'request');
    fakes.signInAs(ALICE);
    ok(g.approveWithdrawal(req.requestId), 'first');
    ok(g.recordSavings('M004', 'Withdrawal', 5000, 'Welfare', '', '', 'cash paid at meeting', ''), 'direct Welfare withdrawal meanwhile');
    fakes.signInAs(BOB);
    fails(g.approveWithdrawal(req.requestId), /Insufficient Welfare balance/, 'final approval after the balance dropped');
  }
};
