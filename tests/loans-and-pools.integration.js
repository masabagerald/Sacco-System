// End-to-end tests for the club pools (Operations/Welfare), Non-Member restrictions, Soft Loan
// guarantors and consent, approval restrictions, the guarantor-restriction override, and
// duplicate-free due-date notices. Real controllers against an in-memory spreadsheet.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN, EVE, NAN } = EMAIL;

// Records a deposit as Alice. date: 'yyyy-MM-dd' (blank = today)
function fund(ctx, memberNo, account, amount, date) {
  const cat = { Principal: 'Monthly Premium', Operations: 'Operations Fee', Welfare: 'Welfare Fee' }[account];
  ctx.fakes.signInAs(ALICE);
  ok(ctx.g.recordSavings(memberNo, 'Deposit', amount, account, cat, '', '', date || ''), 'fund ' + memberNo + ' ' + account);
}

// Guarantor responds through the emailed link (confirm page included)
function respond(ctx, requestId, guarantorNo, decide, reason) {
  const row = ctx.guarantors().find(r => r.RequestID === requestId && r.GuarantorNo === guarantorNo);
  assert.ok(row, 'guarantor row for ' + guarantorNo);
  return ctx.g._guarantorHandle(row.Token, decide, '1', reason || '');
}
const responseOf = (ctx, requestId, guarantorNo) => ctx.guarantors().find(r => r.RequestID === requestId && r.GuarantorNo === guarantorNo);

// A running Soft Loan for Nan, guaranteed by Dan (M004) and Fay (M007), approved by Alice then Bob.
function runningSoftLoan(ctx) {
  fund(ctx, 'M004', 'Principal', 100000); fund(ctx, 'M007', 'Principal', 100000);
  ctx.fakes.signInAs(NAN);
  const req = ok(ctx.g.requestLoan(50000, '1w', 'Stock', ['M004', 'M007']), 'Soft Loan request');
  respond(ctx, req.requestId, 'M004', 'approve'); respond(ctx, req.requestId, 'M007', 'approve');
  ctx.fakes.signInAs(ALICE); ok(ctx.g.approveLoanRequest(req.requestId, ''), 'first approval');
  ctx.fakes.signInAs(BOB); const fin = ok(ctx.g.approveLoanRequest(req.requestId, ''), 'final approval');
  return { requestId: req.requestId, loanId: fin.loanId };
}

module.exports = {
  'a Delegate withdraws from Operations without having contributed to it'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fund(ctx, 'M004', 'Operations', 30000);           // only Dan has paid into Operations
    fakes.signInAs(EVE);
    const mine = ok(g.getMySavings(), 'Eve savings');
    assert.strictEqual(mine.contributions.Operations, 0);
    assert.strictEqual(mine.available.Operations, 30000, 'Eve sees the club balance, not her own contributions');
    const req = ok(g.requestWithdrawal(12000, 'Others', 'Club event', 'Operations'), 'Eve requests from the pool');
    fails(g.requestWithdrawal(18001, 'Dividends', '', 'Operations'), /exceeds the available club Operations balance.*awaiting approval/, 'pool less pending request');
    fakes.signInAs(ALICE); ok(g.approveWithdrawal(req.requestId), 'first');
    fakes.signInAs(BOB); assert.strictEqual(ok(g.approveWithdrawal(req.requestId), 'final').stage, 'final');
    const wd = ctx.ledger().find(r => r['Deposit Type'] === 'Withdrawal');
    assert.deepStrictEqual([wd.MemberNo, wd['Deposit Account'], wd['Amount (UGX)']], ['M005', 'Operations', 12000]);
    const ops = g.getAdminDashboard().depositAccounts.find(a => a.account === 'Operations');
    assert.deepStrictEqual([ops.pooled, ops.contributions, ops.withdrawals, ops.balance], [true, 30000, 12000, 18000]);
    assert.strictEqual(ops.members.find(m => m.memberNo === 'M004').contributions, 30000, "Dan's contributions are untouched");
  },

  'a Founder withdraws from Welfare without having contributed to it'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fund(ctx, 'M005', 'Welfare', 9000);               // Eve funds Welfare; Fay has paid nothing in
    fakes.signInAs(EMAIL.FAY);
    ok(g.requestWithdrawal(9000, 'Welfare', '', 'Welfare'), 'Fay requests the whole Welfare pool');
  },

  'Principal withdrawals are limited to the member\'s own Principal'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fund(ctx, 'M005', 'Principal', 40000); fund(ctx, 'M005', 'Operations', 50000); fund(ctx, 'M004', 'Principal', 900000);
    fakes.signInAs(EVE);
    assert.strictEqual(g.getMySavings().available.Principal, 40000, 'Operations contributions are not Principal savings');
    fails(g.requestWithdrawal(40001, 'Dividends', '', 'Principal'), /exceeds the available Principal balance/, 'over own Principal');
    ok(g.requestWithdrawal(40000, 'Dividends', '', 'Principal'), 'whole own Principal');
  },

  'Non-Members have no savings or withdrawal access'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fakes.signInAs(NAN);
    const s = g.getMySavings();
    assert.ok(!s.ok && s.nonMember, 'savings refused');
    for (const acc of ['Principal', 'Operations', 'Welfare'])
      fails(g.requestWithdrawal(1000, 'Dividends', '', acc), /open to Founder Member and Delegate Members only/, 'Non-Member ' + acc + ' withdrawal');
    fakes.signInAs(ALICE);
    fails(g.recordSavings('M006', 'Deposit', 1000, 'Principal', 'Monthly Premium', '', '', ''), /Non-Members/, 'deposit for a Non-Member');
  },

  'a Non-Member Soft Loan needs consenting Founder Member guarantors'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fund(ctx, 'M004', 'Principal', 100000); fund(ctx, 'M007', 'Principal', 100000); fund(ctx, 'M005', 'Principal', 100000);
    fakes.signInAs(NAN);
    fails(g.requestLoan(100000, '2w', 'School fees', []), /At least 2 guarantors/, 'no guarantors');
    fails(g.requestLoan(100000, '2w', 'School fees', ['M004', 'M005']), /M005 must be a Founder Member/, 'Delegate as guarantor');
    fails(g.requestLoan(100000, '2w', 'School fees', ['M004', 'M006']), /cannot guarantee their own loan/, 'applicant as guarantor');
    fails(g.requestLoan(500000, '2w', 'School fees', ['M004', 'M007']), /Principal savings of UGX 100,000 but needs at least UGX 125,000/, 'guarantor savings rule');
    const req = ok(g.requestLoan(100000, '2w', 'School fees', ['M004', 'M007']), 'valid request');
    assert.strictEqual(ctx.loanReqs()[0]['Total Due'], 120000, '10% interest + UGX 10,000 fee');
    const asked = fakes.emails.filter(e => /guarantor request/.test(e.subject)).map(e => e.to).sort();
    assert.deepStrictEqual(asked, [DAN, EMAIL.FAY], 'both guarantors are emailed');

    fakes.signInAs(ALICE);
    fails(g.approveLoanRequest(req.requestId, ''), /Waiting for guarantor/, 'approval before consent');

    // Opening the link alone records nothing
    g._guarantorHandle(responseOf(ctx, req.requestId, 'M004').Token, 'approve', '', '');
    assert.strictEqual(responseOf(ctx, req.requestId, 'M004').Response, 'Pending');
    respond(ctx, req.requestId, 'M004', 'approve');
    const dan = responseOf(ctx, req.requestId, 'M004');
    assert.strictEqual(dan.Response, 'Accepted');
    assert.match(String(dan['Responded At']), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.ok(ctx.audit().some(a => a.Action === 'Guarantor Consent Given' && a['Performed By'] === 'M004'));

    respond(ctx, req.requestId, 'M007', 'decline', '');                      // no reason given
    assert.strictEqual(responseOf(ctx, req.requestId, 'M007').Response, 'Pending', 'a decline needs a reason');
    respond(ctx, req.requestId, 'M007', 'decline', 'Cannot commit this month');
    const fay = responseOf(ctx, req.requestId, 'M007');
    assert.deepStrictEqual([fay.Response, fay['Decline Reason']], ['Declined', 'Cannot commit this month']);
    assert.ok(ctx.audit().some(a => a.Action === 'Guarantor Declined' && /Cannot commit this month/.test(a.Details)));
    assert.ok(fakes.emails.some(e => e.to === 'admins' && /Guarantor declined/.test(e.subject)));

    fails(g.approveLoanRequest(req.requestId, ''), /declined/, 'approval after a decline');
    fakes.signInAs(BOB);
    ok(g.rejectLoanRequest(req.requestId, 'Guarantor declined'), 'reject');
    fakes.signInAs(CAROL);
    fails(g.approveLoanRequest(req.requestId, ''), /Already decided/, 'a rejected request cannot proceed');
    assert.strictEqual(ctx.loans().length, 0, 'no loan was created');
  },

  'an approved Soft Loan follows consent then two different admins'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const { requestId, loanId } = runningSoftLoan(ctx);
    assert.ok(fakes.emails.some(e => /Ready for approval/.test(e.subject)), 'admins told once all guarantors consent');
    assert.ok(fakes.emails.some(e => /Second approval needed/.test(e.subject)), 'admins told a second approval is needed');
    const loan = ctx.loans()[0];
    assert.deepStrictEqual([loan.LoanID, loan.MemberNo, loan['Loan Model'], loan['Processing Fee (UGX)'], loan['Interest Rate (%)'], loan['Term (days)']],
      [loanId, 'M006', 'Term', 10000, 5, 7]);
    assert.ok(ctx.guarantors().filter(r => r.RequestID === requestId).every(r => r.LoanID === loanId), 'guarantors linked to the loan');
    const r = ctx.loanReqs()[0];
    assert.deepStrictEqual([r.Status, r['Approver 1'], r['Approver 2']], ['Approved', 'M001', 'M002']);
  },

  'an admin cannot approve a loan for themselves or one they proposed'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fund(ctx, 'M002', 'Principal', 200000, '2024-01-01');
    fund(ctx, 'M004', 'Principal', 100000); fund(ctx, 'M007', 'Principal', 100000);
    fakes.signInAs(ALICE);
    const req = ok(g.issueLoan('M002', 50000, 'Roof', ['M004', 'M007'], 3, ''), 'Alice proposes a loan for Bob');
    fakes.signInAs(BOB);
    fails(g.approveLoanRequest(req.requestId, ''), /your own account/, 'Bob approving his own loan');
    fakes.signInAs(ALICE);
    fails(g.approveLoanRequest(req.requestId, ''), /You initiated this request/, 'Alice approving her proposal');
    fakes.signInAs(CAROL);
    fails(g.approveLoanRequest(req.requestId, ''), /Waiting for guarantor/, 'Carol is an eligible approver; only consent is missing');
  },

  'a guarantor of a running loan needs an admin override to borrow'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    runningSoftLoan(ctx);                              // Dan now guarantees Nan's running loan
    fund(ctx, 'M004', 'Principal', 50000, '2024-01-01');
    fund(ctx, 'M001', 'Principal', 100000); fund(ctx, 'M002', 'Principal', 100000);
    fakes.signInAs(DAN);
    fails(g.requestLoan(20000, 3, 'Repairs', ['M001', 'M002']), /currently guaranteeing another loan/, 'Dan on his own');
    fakes.signInAs(CAROL);
    fails(g.issueLoan('M004', 20000, 'Repairs', ['M001', 'M002'], 3, ''), /currently guaranteeing another loan/, 'admin proposal without an override');
    const req = ok(g.issueLoan('M004', 20000, 'Repairs', ['M001', 'M002'], 3, 'Committee minute 12/2026'), 'admin proposal with an override');
    const row = ctx.loanReqs().find(r => r.RequestID === req.requestId);
    assert.strictEqual(row['Guarantor Override'], 'Committee minute 12/2026');
    const a = ctx.audit().find(x => x.Action === 'Guarantor Restriction Override');
    assert.ok(a && a['Performed By'] === 'M003' && /Committee minute 12\/2026/.test(a.Details), 'override is audited with the admin and reason');
    respond(ctx, req.requestId, 'M001', 'approve'); respond(ctx, req.requestId, 'M002', 'approve');
    fails(g.approveLoanRequest(req.requestId, ''), /You initiated this request/, 'the proposer cannot approve');
    fakes.signInAs(ALICE); ok(g.approveLoanRequest(req.requestId, ''), 'first');
    fakes.signInAs(BOB); assert.strictEqual(ok(g.approveLoanRequest(req.requestId, ''), 'final').stage, 'final');
    assert.ok(ctx.audit().some(x => x.Action === 'Loan Request Fully Approved' && /Guarantor restriction override: Committee minute/.test(x.Details)));
  },

  'the loan cap counts Principal savings only'(c) {
    const ctx = seed(c), { g } = ctx;
    fund(ctx, 'M004', 'Principal', 100000, '2024-01-01'); fund(ctx, 'M004', 'Operations', 500000);
    const lc = g._checkLimit('M004', 60000);
    assert.deepStrictEqual([lc.savings, lc.maxLoan, lc.withinLimit], [100000, 50000, false]);
  },

  'due-date notices are not sent twice when the job is retried'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    const { loanId } = runningSoftLoan(ctx);
    const sh = fakes.sheet(val('SH_LOANS'));
    const hdr = sh.data[0], row = sh.data.find(r => r[0] === loanId);
    row[hdr.indexOf('Due Date')] = g.today();
    const dueToday = () => fakes.emails.filter(e => /Loan Due Today/.test(e.subject)).length;
    g.processLoanDueDates();
    g.processLoanDueDates();
    assert.strictEqual(dueToday(), 1, 'one notice despite two runs');
    assert.strictEqual(row[hdr.indexOf('Last Notice')], g.today());
    g.sendRepaymentReminders(); g.sendRepaymentReminders();
    assert.ok(fakes.logs.some(l => /sendRepaymentReminders already ran today/.test(l)), 'second reminder run is skipped');
  }
};
