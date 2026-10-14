// End-to-end tests for the two-guarantor rule and guarantor notifications: exactly two consenting
// Founder Member guarantors for every membership type, no admin approval before both consent, two
// different admins, and notices to both guarantors for repayments, surcharges, fines, overdue loans
// and clearance -- each sent once, even when a job is retried. Real controllers, in-memory sheets.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN } = EMAIL;

// Seeds the club, with the fuller Loan Repayments and Surcharge tabs, and records each email's rows
function setup(c) {
  const ctx = seed(c), { g, fakes, val } = ctx;
  fakes.addSheet(val('SH_REPAY'), [['LoanID', 'Date', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Recorded By', 'Notes', 'Reference', 'Reverses']]);
  fakes.addSheet(val('SH_FINES'), [['FineID', 'Timestamp', 'MemberNo', 'Date', 'Amount (UGX)', 'Reason', 'Status', 'Recorded By']]);
  g._sendEmail = (to, subject, rows, message) => { if (to) fakes.emails.push({ to, subject, rows, message }); };
  ctx.notices = () => { const sh = fakes.sheet(val('SH_GUARANTOR_NOTICES')); return sh ? sh.records('event key') : []; };
  ctx.guarantorMail = event => fakes.emails.filter(e => e.subject.startsWith('Guarantor notice: ' + event + ' on '));
  return ctx;
}

function fund(ctx, memberNo, amount) {
  ctx.fakes.signInAs(ALICE);
  ok(ctx.g.recordSavings(memberNo, 'Deposit', amount, 'Principal', 'Monthly Premium', '', '', '2024-01-01'), 'fund ' + memberNo);
}

function respond(ctx, requestId, guarantorNo, decide, reason) {
  const row = ctx.guarantors().find(r => r.RequestID === requestId && r.GuarantorNo === guarantorNo);
  assert.ok(row, 'guarantor row for ' + guarantorNo);
  return ctx.g._guarantorHandle(row.Token, decide, '1', reason || '');
}

const rowValue = (mail, label) => { const r = (mail.rows || []).find(x => x[0] === label); return r ? r[1] : undefined; };

// One applicant of each membership type. Guarantors: Alice (M001) and Dan (M004). Approvers: Bob, then Carol.
const APPLICANTS = [
  { type: 'Founder Member', email: EMAIL.FAY, no: 'M007', term: 3, total: 60000 },
  { type: 'Delegate Member', email: EMAIL.EVE, no: 'M005', term: 3, total: 60000 },
  { type: 'Non-Member', email: EMAIL.NAN, no: 'M006', term: '1w', total: 62500 }
];
const GUARANTORS = ['M001', 'M004'];

function prepare(ctx, a) {
  fund(ctx, 'M001', 100000); fund(ctx, 'M004', 100000); fund(ctx, 'M007', 100000);
  if (a.type !== 'Non-Member' && a.no !== 'M007') fund(ctx, a.no, 200000);
}

// A running loan for applicant a: both guarantors consent, then Bob and Carol approve
function issuedLoan(ctx, a) {
  const { g, fakes } = ctx;
  prepare(ctx, a);
  fakes.signInAs(a.email);
  const id = ok(g.requestLoan(50000, a.term, 'Stock', GUARANTORS), 'request').requestId;
  GUARANTORS.forEach(no => respond(ctx, id, no, 'approve'));
  fakes.signInAs(BOB); ok(g.approveLoanRequest(id, ''), 'first approval');
  fakes.signInAs(CAROL); const fin = ok(g.approveLoanRequest(id, ''), 'final approval');
  return { requestId: id, loanId: fin.loanId };
}

const tests = {};

APPLICANTS.forEach(a => {
  tests[a.type + ': exactly two guarantors, both consent, then two different admins'] = c => {
    const ctx = setup(c), { g, fakes } = ctx;
    prepare(ctx, a);
    fakes.signInAs(a.email);
    fails(g.requestLoan(50000, a.term, 'Stock', ['M001']), /Exactly 2 guarantors are required \(1 chosen\)/, 'one guarantor');
    fails(g.requestLoan(50000, a.term, 'Stock', ['M001', 'M004', 'M002']), /Exactly 2 guarantors are required \(3 chosen\)/, 'three guarantors');
    fails(g.requestLoan(50000, a.term, 'Stock', ['M001', 'M001']), /Exactly 2 guarantors/, 'the same guarantor twice');
    fails(g.requestLoan(50000, a.term, 'Stock', ['M001', 'M003']), /M003 must be a Founder Member/, 'a Delegate Member as guarantor');
    fakes.signInAs(CAROL);
    fails(g.issueLoan(a.no, 50000, 'Stock', ['M001', 'M004', 'M002'], a.term, ''), /Exactly 2 guarantors/, 'an admin proposal is held to the same rule');

    fakes.signInAs(a.email);
    const id = ok(g.requestLoan(50000, a.term, 'Stock', GUARANTORS), 'request').requestId;
    const req = () => ctx.loanReqs().find(r => r.RequestID === id);
    assert.deepStrictEqual([req()['Guarantor 1'], req()['Guarantor 2']], GUARANTORS);
    assert.deepStrictEqual(fakes.emails.filter(e => /guarantor request/.test(e.subject)).map(e => e.to).sort(), [ALICE, DAN], 'both guarantors asked');

    fakes.signInAs(BOB);
    fails(g.approveLoanRequest(id, ''), /Waiting for guarantor M001/, 'before any consent');
    respond(ctx, id, 'M001', 'approve');
    fails(g.approveLoanRequest(id, ''), /Waiting for guarantor M004/, 'after one consent');
    assert.strictEqual(req()['Approver 1'], '', 'no approval recorded');
    respond(ctx, id, 'M004', 'approve');
    const rows = ctx.guarantors().filter(r => r.RequestID === id);
    assert.ok(rows.every(r => r.Response === 'Accepted' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(r['Responded At']))), 'consent and its time recorded');

    assert.strictEqual(ok(g.approveLoanRequest(id, ''), 'first').stage, 'first');
    fails(g.approveLoanRequest(id, ''), /already gave the first approval/, 'the same admin cannot give both approvals');
    fakes.signInAs(a.email);
    fails(g.approveLoanRequest(id, ''), /Admin access required/, 'the applicant cannot approve');
    fakes.signInAs(CAROL);
    const fin = ok(g.approveLoanRequest(id, ''), 'second');
    assert.strictEqual(fin.stage, 'final');
    const loan = ctx.loans()[0];
    assert.deepStrictEqual([loan.MemberNo, loan['Issued By']], [a.no, 'M003']);
    assert.deepStrictEqual(ctx.guarantors().filter(r => r.LoanID === fin.loanId).map(r => r.GuarantorNo).sort(), GUARANTORS, 'loan linked to both guarantors');
  };

  tests[a.type + ': a guarantor who declines stops the application'] = c => {
    const ctx = setup(c), { g, fakes } = ctx;
    prepare(ctx, a);
    fakes.signInAs(a.email);
    const id = ok(g.requestLoan(50000, a.term, 'Stock', GUARANTORS), 'request').requestId;
    respond(ctx, id, 'M001', 'approve');
    respond(ctx, id, 'M004', 'decline', 'Cannot commit');
    assert.ok(!fakes.emails.some(e => /Guarantors all accepted/.test(e.subject)), 'not treated as consented');
    fakes.signInAs(BOB);
    fails(g.approveLoanRequest(id, ''), /M004 declined/, 'approval after a decline');
    assert.strictEqual(respond(ctx, id, 'M004', 'approve') && ctx.guarantors().find(r => r.RequestID === id && r.GuarantorNo === 'M004').Response, 'Declined', 'a decline cannot be flipped by reusing the link');
    fails(g.approveLoanRequest(id, ''), /declined/, 'still blocked');
    ok(g.rejectLoanRequest(id, 'Guarantor declined'), 'reject');
    assert.strictEqual(ctx.loans().length, 0, 'no loan');
    // The guarantors are free again once the request is closed
    fakes.signInAs(a.email);
    ok(g.requestLoan(50000, a.term, 'Stock', GUARANTORS), 'a new request with the same guarantors');
  };

  tests[a.type + ': both guarantors are told of repayments, fines and clearance, and notices stop after clearance'] = c => {
    const ctx = setup(c), { g, fakes } = ctx;
    const { loanId } = issuedLoan(ctx, a);
    fakes.signInAs(ALICE);
    const rep = ok(g.recordRepayment(loanId, 20000, '', ''), 'part repayment');
    const mails = ctx.guarantorMail('Loan repayment');
    assert.deepStrictEqual(mails.map(m => m.to).sort(), [ALICE, DAN], 'both guarantors, nobody else');
    const m = mails[0];
    assert.strictEqual(rowValue(m, 'Amount'), 'UGX 20,000');
    assert.strictEqual(rowValue(m, 'Remaining loan balance'), 'UGX ' + (a.total - 20000).toLocaleString('en-US'));
    assert.strictEqual(rowValue(m, 'Reference'), rep.reference);
    assert.ok(rowValue(m, 'Applied to interest'), 'shows the interest paid');
    assert.match(m.message, /including interest/);
    assert.match(m.message, /no money is paid to you/);
    // Guarantors receive nothing: the payment is the borrower's, and no ledger row names a guarantor
    assert.ok(fakes.sheet(ctx.val('SH_REPAY')).records('loanid').every(r => r.MemberNo === a.no));
    assert.ok(!ctx.ledger().some(r => GUARANTORS.includes(r.MemberNo) && r['Date'] !== '2024-01-01'), 'no savings movement for a guarantor');

    const fine = ok(g.issueFine(a.no, 3000, 'Late repayment'), 'fine');
    assert.deepStrictEqual(ctx.guarantorMail('Surcharge / fine charged').map(m => m.to).sort(), [ALICE, DAN]);
    ok(g.markFinePaid(fine.fineId), 'fine paid');
    assert.deepStrictEqual(ctx.guarantorMail('Surcharge / fine paid').map(m => m.to).sort(), [ALICE, DAN]);
    ok(g.issueFine('M002', 3000, 'Late to meeting'), 'a fine for someone with no guaranteed loan');
    assert.strictEqual(ctx.guarantorMail('Surcharge / fine charged').length, 2, 'their fine tells no guarantor');

    ok(g.recordRepayment(loanId, a.total - 20000, 'Final', ''), 'clearing payment');
    assert.strictEqual(ctx.loans()[0].Status, 'Cleared');
    assert.strictEqual(ctx.guarantorMail('Loan repayment').length, 4, 'the clearing payment is reported');
    const cleared = ctx.guarantorMail('Loan cleared');
    assert.deepStrictEqual(cleared.map(m => m.to).sort(), [ALICE, DAN], 'final clearance notice');
    assert.strictEqual(rowValue(cleared[0], 'Remaining loan balance'), 'UGX 0');

    const before = ctx.notices().length;
    ok(g.issueFine(a.no, 2000, 'Late to meeting'), 'a fine after clearance');
    ok(g.recordRepayment(loanId, 1000, 'Overpayment', ''), 'a payment on the cleared loan');
    assert.strictEqual(ctx.notices().length, before, 'no notices once the loan is cleared');

    const log = ctx.notices();
    assert.ok(log.every(n => n.LoanID === loanId && n.BorrowerNo === a.no && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(n.Timestamp))), 'each notice logged with its loan and time');
    assert.deepStrictEqual([...new Set(log.map(n => n.Event))].sort(),
      ['Loan cleared', 'Loan repayment', 'Surcharge / fine charged', 'Surcharge / fine paid']);
  };
});

Object.assign(tests, {
  'an overdue loan is reported to both guarantors once, even when the job is retried'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    const { loanId } = issuedLoan(ctx, APPLICANTS[2]);              // Nan's Soft Loan: 50,000 + 2,500 + 10,000
    const sh = fakes.sheet(val('SH_LOANS')), hdr = sh.data[0], row = sh.data.find(r => r[0] === loanId);
    row[hdr.indexOf('Due Date')] = g.fmt_date(g._addDays(new Date(), -2));
    g.processLoanDueDates();
    const overdue = ctx.guarantorMail('Loan overdue: surcharge charged');
    assert.deepStrictEqual(overdue.map(m => m.to).sort(), [ALICE, DAN]);
    assert.strictEqual(rowValue(overdue[0], 'Amount'), 'UGX 5,250', '10% of loan + interest');
    assert.strictEqual(rowValue(overdue[0], 'Remaining loan balance'), 'UGX 67,750');
    // A retry that crashed before marking the loan: the job runs the whole branch again
    row[hdr.indexOf('Last Notice')] = ''; row[hdr.indexOf('Overdue Surcharge (UGX)')] = '';
    g.processLoanDueDates();
    g.processLoanDueDates();
    assert.strictEqual(ctx.guarantorMail('Loan overdue: surcharge charged').length, 2, 'still one notice per guarantor');
    assert.strictEqual(ctx.notices().filter(n => n['Event Key'] === 'overdue|' + loanId).length, 2);

    fakes.signInAs(ALICE);
    ok(g.recordRepayment(loanId, 20000, '', ''), 'repayment');
    const m = ctx.guarantorMail('Loan repayment')[0];
    assert.strictEqual(rowValue(m, 'Applied to surcharge / penalty'), 'UGX 5,250', 'the surcharge paid is shown');
    assert.match(m.message, /including interest, including a surcharge/);
  },

  'the same notice is never sent twice for one event'(c) {
    const ctx = setup(c), { g } = ctx;
    const { loanId } = issuedLoan(ctx, APPLICANTS[0]);
    const ev = { key: 'test|1', event: 'Loan repayment', amount: 100, date: g.today(), message: 'Test.' };
    assert.strictEqual(g._notifyGuarantors(loanId, ev), 2);
    assert.strictEqual(g._notifyGuarantors(loanId, ev), 0, 'a retried call sends nothing');
    assert.strictEqual(ctx.notices().length, 2);
  },

  'a loan surcharge paid into savings is reported; an unrelated surcharge is not'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    issuedLoan(ctx, APPLICANTS[1]);                                   // Eve, a Delegate Member, has savings
    fakes.signInAs(ALICE);
    ok(g.recordSavings('M005', 'Deposit', 4000, 'Principal', 'Surcharge', 'Surcharge on Unpaid Loan Balance', '', ''), 'loan surcharge');
    const mails = ctx.guarantorMail('Surcharge paid');
    assert.deepStrictEqual(mails.map(m => m.to).sort(), [ALICE, DAN]);
    assert.strictEqual(rowValue(mails[0], 'Surcharge reason'), 'Surcharge on Unpaid Loan Balance');
    ok(g.recordSavings('M005', 'Deposit', 4000, 'Principal', 'Surcharge', 'Surcharge on Unpaid Premium', '', ''), 'premium surcharge');
    assert.strictEqual(ctx.guarantorMail('Surcharge paid').length, 2, 'premium surcharges are not loan charges');
  },

  'a reversed repayment is reported and reopens a cleared loan'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    const { loanId } = issuedLoan(ctx, APPLICANTS[0]);
    fakes.signInAs(ALICE);
    const rep = ok(g.recordRepayment(loanId, 60000, '', ''), 'clearing payment');
    assert.strictEqual(ctx.guarantorMail('Loan cleared').length, 2);
    fakes.signInAs(BOB);
    ok(g.reverseRepayment(rep.reference, 'Cheque bounced'), 'reverse');
    const mails = ctx.guarantorMail('Repayment reversed');
    assert.deepStrictEqual(mails.map(m => m.to).sort(), [ALICE, DAN]);
    assert.strictEqual(rowValue(mails[0], 'Remaining loan balance'), 'UGX 60,000');
    // Paid again later: a new clearance notice (its key is tied to the new payment)
    ok(g.recordRepayment(loanId, 60000, '', ''), 'paid again');
    assert.strictEqual(ctx.guarantorMail('Loan cleared').length, 4);
  },

  'a Soft Loan request whose applicant has since become a Founder Member gives a clear error'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    prepare(ctx, APPLICANTS[2]);
    fakes.signInAs(EMAIL.NAN);
    const id = ok(g.requestLoan(50000, '1w', 'Stock', GUARANTORS), 'Soft Loan request').requestId;
    GUARANTORS.forEach(no => respond(ctx, id, no, 'approve'));
    fakes.signInAs(BOB);
    ok(g.updateMember('M006', 'Member', 'Founder Member', 'Active', ''), 'Nan becomes a Founder Member');
    fails(g.approveLoanRequest(id, ''), /made as a Non-Member Soft Loan \(1 week\), but the member is now a Founder Member/, 'approval');
    ok(g.rejectLoanRequest(id, 'Membership type changed; apply again'), 'reject');
  },

  'a guarantor of an outstanding loan cannot guarantee another'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    issuedLoan(ctx, APPLICANTS[2]);                                   // Alice and Dan guarantee Nan's running loan
    fund(ctx, 'M005', 200000); fund(ctx, 'M002', 100000);
    fakes.signInAs(EMAIL.EVE);
    fails(g.requestLoan(50000, 3, 'Stock', ['M004', 'M002']), /M004 is already guaranteeing another loan/, 'Dan is taken');
    ok(g.requestLoan(50000, 3, 'Stock', ['M007', 'M002']), 'two free guarantors');
  },

  'the admin loan list shows each loan\'s guarantors, consent and notices'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    const { loanId } = issuedLoan(ctx, APPLICANTS[0]);
    fakes.signInAs(ALICE);
    ok(g.recordRepayment(loanId, 1000, '', ''), 'repayment');
    const l = ok(g.getActiveLoans(), 'list').loans.find(x => x.loanId === loanId);
    assert.strictEqual(JSON.stringify(l.guarantors.map(x => [x.memberNo, x.response])), JSON.stringify([['M001', 'Accepted'], ['M004', 'Accepted']]));
    assert.ok(l.guarantors.every(x => x.respondedAt && x.name));
    assert.strictEqual(l.guarantorNotices.count, 2);
  }
});

module.exports = tests;
