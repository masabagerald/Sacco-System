// System-review improvements: audit log date and time, guarantor and withdrawal email contents,
// contact-detail validation on registration, the Paid / Unpaid Surcharges dashboard cards and the
// repayment breakdown. Real controllers against an in-memory spreadsheet.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN } = EMAIL;
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// Appends a row to a fake sheet, by header name
function addRow(ctx, sheetConst, obj) {
  const sh = ctx.fakes.sheet(ctx.val(sheetConst));
  const h = sh.data.findIndex(r => r.some(v => String(v).trim() !== ''));
  sh.data.push(sh.data[h].map(k => (k in obj ? obj[k] : '')));
}

// Records every email with its rows (the default fakes keep only the subject)
function captureMail(ctx) {
  const { g, fakes } = ctx;
  g._sendEmail = (to, subject, rows, message) => { if (to) fakes.emails.push({ to, subject, rows, message }); };
  g._notifyAdmins = (subject, rows, message) => fakes.emails.push({ to: 'admins', subject, rows, message });
  return subject => fakes.emails.filter(e => subject.test(e.subject));
}
const labels = mail => (mail.rows || []).map(r => String(r[0]));

module.exports = {
  // ── 1. Audit log ────────────────────────────────────────────────────────────
  'the audit log shows the date and exact time of each action, newest first'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    // Sheets turns the written 'yyyy-MM-dd HH:mm:ss' text into a date-time cell: simulate existing rows
    const D = ctx.val('Date');  // the script's own Date, as Sheets returns
    addRow(ctx, 'SH_AUDIT', { Timestamp: new D(2025, 9, 18, 9, 15, 0), Action: 'Morning', 'Performed By': 'M001' });
    addRow(ctx, 'SH_AUDIT', { Timestamp: new D(2025, 9, 18, 14, 30, 5), Action: 'Afternoon', 'Performed By': 'M001' });
    addRow(ctx, 'SH_AUDIT', { Timestamp: '2025-10-17', Action: 'Old date-only row', 'Performed By': 'M001' });
    g.auditLog('Just now', 'M004', 'M001', 'details', 'REF1');
    const written = ctx.audit().find(a => a.Action === 'Just now');
    assert.match(String(written.Timestamp), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'new entries are stamped with date and time');

    fakes.signInAs(DAN);
    fails(g.getAuditLog(10), /Admin access required/, 'members cannot read the audit log');
    fakes.signInAs(ALICE);
    const res = ok(g.getAuditLog(10), 'audit log');
    same(res.entries.map(e => e.action), ['Just now', 'Afternoon', 'Morning', 'Old date-only row'], 'ordered by date and time');
    assert.strictEqual(res.entries[1].timestamp, '2025-10-18 14:30:05', 'the time of an existing row is kept, to the second');
    assert.strictEqual(res.entries[2].timestamp, '2025-10-18 09:15:00');
    assert.strictEqual(res.entries[3].timestamp, '2025-10-17', 'older date-only rows still show');
    assert.strictEqual(res.timeZone, 'Africa/Nairobi', 'the timezone is reported for display');
  },

  'date columns still read as plain dates; only timestamp columns keep the time'(c) {
    const ctx = seed(c), { g } = ctx;
    const D = ctx.val('Date');
    addRow(ctx, 'SH_REPAY', { LoanID: 'L001', Date: new D(2025, 2, 15), Timestamp: new D(2025, 2, 15, 8, 5, 9), 'Amount (UGX)': 1 });
    const row = g.readSheet(ctx.val('SH_REPAY'), 'loanid').rows[0];
    same([row.Date, row.Timestamp], ['2025-03-15', '2025-03-15 08:05:09']);
  },

  // ── 3. Withdrawal emails ────────────────────────────────────────────────────
  'withdrawal emails never show the total savings balance; the approval workflow is unchanged'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const mail = captureMail(ctx);
    fakes.signInAs(ALICE);
    ok(g.recordSavings('M004', 'Deposit', 100000, 'Principal', 'Monthly Premium', '', '', '2025-01-01'), 'deposit');
    const dep = mail(/^Deposit Confirmation/)[0];
    assert.ok(labels(dep).includes('Total savings'), 'deposit emails are out of scope and unchanged');

    fakes.signInAs(DAN);
    const req = ok(g.requestWithdrawal(20000, 'Dividends', '', 'Principal'), 'request').requestId;
    fakes.signInAs(BOB); assert.strictEqual(ok(g.approveWithdrawal(req), 'first').stage, 'first');
    fakes.signInAs(CAROL); assert.strictEqual(ok(g.approveWithdrawal(req), 'final').stage, 'final');
    fakes.signInAs(ALICE);
    const wd = ok(g.recordSavings('M004', 'Withdrawal', 5000, 'Principal', '', '', '', ''), 'admin-recorded withdrawal');
    ok(g.reverseSavingsTransaction(wd.reference, 'Entered twice'), 'withdrawal reversal');

    const sent = mail(/Withdrawal|Savings Transaction Reversed/);
    assert.ok(sent.length >= 5,'request, approvals, confirmation and reversal emails were all sent: ' + sent.map(e => e.subject).join(' / '));
    sent.forEach(e => {
      assert.ok(!labels(e).some(l => /balance|total savings/i.test(l)), e.subject + ' has a balance row: ' + labels(e).join(', '));
      assert.ok(!/UGX 80,000|UGX 75,000|UGX 100,000/.test(JSON.stringify(e.rows)), e.subject + ' shows a balance figure');
    });
    const request = mail(/^Withdrawal Request: /)[0];
    same(labels(request), ['Request ID', 'Member', 'Account', 'Amount', 'Reason'], 'the request can still be identified and reviewed');
    same(labels(mail(/^Withdrawal Approved/)[0]), ['Request ID', 'Account', 'Amount', 'Ledger reference']);
    assert.ok(ctx.ledger().some(r => r['Deposit Type'] === 'Withdrawal' || r.Notes === 'Withdrawal request ' + req + ' approved'), 'the withdrawal reached the ledger');
    assert.strictEqual(ok(g.getWithdrawalRequests(), 'admin screen').requests[0].currentBalance, 80000, 'the admin screen still shows the balance');
  },

  // ── 4. Registration contact details ─────────────────────────────────────────
  'registration rejects malformed emails and phone numbers, on the server too'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    fakes.signInAs(ALICE);
    const count = () => fakes.sheet(val('SH_MEMBERS')).records('memberno').length;
    const before = count();
    ['', 'plain', 'a@b', 'a@@b.com', 'a b@c.com', 'a..b@c.com', '.a@c.com', 'a@-c.com', 'a@c.com.', 'a@c.c0m', 'x'.repeat(65) + '@c.com']
      .forEach(e => {
        const r = g.addMember('New Person', e, '', 'Member', 'Founder Member', '');
        assert.ok(!r.ok && r.field === 'email', 'email ' + JSON.stringify(e) + ' should be refused: ' + JSON.stringify(r));
      });
    ['12345', '0712 345 67', '07123456789', '+256 0712 345 678', '+256 812 345 678', 'abc', '0712-345-67x', '+1 234',
      '1 202 555 0100', '256 71234567', '++256712345678', '0712+345678']
      .forEach(p => {
        const r = g.addMember('New Person', 'new@gmail.com', p, 'Member', 'Founder Member', '');
        assert.ok(!r.ok && r.field === 'phone', 'phone ' + JSON.stringify(p) + ' should be refused: ' + JSON.stringify(r));
      });
    fails(g.addMember('', 'new@gmail.com', '', 'Member', 'Founder Member', ''), /Full name is required/, 'name');
    fails(g.addMember('Dup', 'ALICE@X.ORG', '', 'Member', 'Founder Member', ''), /already registered/, 'duplicate email, any case');
    assert.strictEqual(count(), before, 'nothing was saved');
    fakes.signInAs(DAN);
    fails(g.addMember('New Person', 'new@gmail.com', '', 'Member', '', ''), /Admin access required/, 'members cannot register people');
  },

  'valid Ugandan and international numbers are accepted and saved in one form'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    const cases = [['0712 345 678', '+256712345678'], ['+256-712-345-678', '+256712345678'], ['256712345678', '+256712345678'],
      ['712345678', '+256712345678'], ['(0414) 123 456', '+256414123456'], ['00256 772 123456', '+256772123456'],
      ['+254 712 345 678', '+254712345678'], ['0044 20 7946 0958', '+442079460958'], ['+1 (202) 555-0100', '+12025550100'], ['', '']];
    cases.forEach(([input, want]) => {
      const r = g.normalizePhone(input);
      assert.ok(r.ok, input + ': ' + JSON.stringify(r));
      assert.strictEqual(r.phone, want, input);
    });
    same(['name@gmail.com', 'first.last+club@mail.example.co.ug', "o'neil@x.org"].map(e => g.validateEmail(e).ok), [true, true, true]);

    fakes.signInAs(ALICE);
    const res = ok(g.addMember('New Person', '  New.Person@Gmail.COM ', '0772 123 456', 'Member', 'Founder Member', ''), 'add');
    const sh = fakes.sheet(val('SH_MEMBERS'));
    const m = sh.records('memberno').find(r => r.MemberNo === res.memberNo);
    same([m.Email, m.Phone], ['new.person@gmail.com', '+256772123456'], 'email lower-cased, phone in international form');
    const rowNo = sh.data.findIndex(r => r[0] === res.memberNo) + 1;
    assert.strictEqual(sh.formats[rowNo + ':' + (sh.data[0].indexOf('Phone') + 1)], '@', 'phone saved as text so the + is kept');
    assert.ok(g._lookupMember('NEW.PERSON@gmail.com').ok, 'sign-in still matches the email in any case');
    fails(g.addMember('Again', 'new.person@gmail.com', '', 'Member', 'Founder Member', ''), /already registered/, 'unique email');
  },

  // ── 5. Dashboard surcharge cards ────────────────────────────────────────────
  'the dashboard shows paid and unpaid surcharges separately'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    [['F001', 'Unpaid', 10000], ['F002', 'Paid', 5000], ['F003', 'paid ', 2500], ['F004', 'Unpaid', 3000], ['F005', 'Waived', 9999]]
      .forEach(([id, st, amt]) => addRow(ctx, 'SH_FINES', { FineID: id, MemberNo: 'M004', 'Amount (UGX)': amt, Status: st }));
    fakes.signInAs(DAN);
    fails(g.getAdminDashboard(), /Admin access required/, 'members cannot see it');
    fakes.signInAs(ALICE);
    let d = ok(g.getAdminDashboard(), 'dashboard');
    same([d.unpaidFinesTotal, d.unpaidSurchargeCount, d.paidFinesTotal, d.paidSurchargeCount], [13000, 2, 7500, 2]);
    ok(g.markFinePaid('F001'), 'settle F001');
    d = ok(g.getAdminDashboard(), 'after');
    same([d.unpaidFinesTotal, d.unpaidSurchargeCount, d.paidFinesTotal, d.paidSurchargeCount], [3000, 1, 17500, 3], 'the paid item moves across');
  },

  // ── 6. Repayment breakdown ──────────────────────────────────────────────────
  'the repayment breakdown shows each part, applies the club order, and the fee is never charged twice'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    g.setupFinanceSchema();
    // Founder member loan: 100,000 + 10% interest + 5,000 fee = 115,000
    addRow(ctx, 'SH_LOANS', { LoanID: 'L001', MemberNo: 'M004', 'Date Issued': '2025-02-01', 'Principal (UGX)': 100000, Status: 'Active',
      'Loan Model': 'Member', 'Processing Fee (UGX)': 5000, 'Interest Rate (%)': 10, 'Term (months)': 2, 'Due Date': '2025-04-01' });
    const repRows = () => fakes.sheet(val('SH_REPAY')).records('loanid').length;
    const parts = p => p.components.map(x => [x.label, x.charged, x.paidBefore, x.outstandingBefore, x.allocated, x.balanceAfter, x.status]);

    fakes.signInAs(DAN);
    fails(g.getRepaymentPreview('L001', 0, ''), /Admin access required/, 'admins only');
    fakes.signInAs(ALICE);
    fails(g.getRepaymentPreview('L001', -5, ''), /cannot be negative/, 'negative amount');
    fails(g.getRepaymentPreview('NOPE', 0, ''), /Loan not found/, 'unknown loan');
    fails(g.recordRepayment('L001', -5, '', ''), /greater than zero/, 'negative repayment');

    let p = ok(g.getRepaymentPreview('L001', 0, ''), 'before');
    same(parts(p), [['Principal', 100000, 0, 100000, 0, 100000, 'Outstanding'], ['Interest', 10000, 0, 10000, 0, 10000, 'Outstanding'],
      ['Processing fee', 5000, 0, 5000, 0, 5000, 'Outstanding']], 'no surcharge row when none is charged');
    same([p.totals.outstandingBefore, p.reconciles], [115000, true]);

    p = ok(g.getRepaymentPreview('L001', 12000, '2025-03-01'), '12,000');
    same(parts(p), [['Principal', 100000, 0, 100000, 0, 100000, 'Outstanding'], ['Interest', 10000, 0, 10000, 7000, 3000, 'Outstanding'],
      ['Processing fee', 5000, 0, 5000, 5000, 0, 'Settled by this payment']], 'fee first, then interest');
    same([p.credit.allocated, p.totals.amount, p.totals.outstandingAfter, p.overpayment], [0, 12000, 103000, 0]);
    assert.strictEqual(repRows(), 0, 'a preview records nothing');

    const r1 = ok(g.recordRepayment('L001', 12000, '', '2025-03-01', { stateKey: p.stateKey }), 'record');
    same(r1.allocation, { fee: 5000, interest: 7000, penalty: 0, principal: 0, overpaid: 0 }, 'recorded exactly as previewed');
    assert.ok(ctx.audit().some(a => a.Action === 'Loan Repayment' && /Applied: fee UGX 5,000, interest UGX 7,000, principal UGX 0/.test(a.Details)), 'split in the audit log');

    // The same form submitted again (double click / resubmit): its breakdown is out of date
    const stale = g.recordRepayment('L001', 12000, '', '2025-03-01', { stateKey: p.stateKey });
    assert.ok(!stale.ok && stale.code === 'stale' && stale.preview, 'stale breakdown refused: ' + JSON.stringify(stale.error));
    // Same amount and date again with a fresh breakdown: a likely duplicate, refused until confirmed
    p = ok(g.getRepaymentPreview('L001', 12000, '2025-03-01'), 'again');
    assert.strictEqual(p.similar.length, 1, 'the earlier identical repayment is pointed out');
    const dup = g.recordRepayment('L001', 12000, '', '2025-03-01', { stateKey: p.stateKey });
    assert.ok(!dup.ok && dup.code === 'duplicate', 'duplicate refused: ' + JSON.stringify(dup));
    assert.strictEqual(repRows(), 1, 'nothing recorded by the refused attempts');
    const r2 = ok(g.recordRepayment('L001', 12000, '', '2025-03-01', { stateKey: p.stateKey, confirmDuplicate: true }), 'confirmed second payment');
    same(r2.allocation, { fee: 0, interest: 3000, penalty: 0, principal: 9000, overpaid: 0 }, 'the paid fee is not charged again');

    p = ok(g.getRepaymentPreview('L001', 0, ''), 'after two payments');
    same(parts(p), [['Principal', 100000, 9000, 91000, 0, 91000, 'Outstanding'], ['Interest', 10000, 10000, 0, 0, 0, 'Already paid'],
      ['Processing fee', 5000, 5000, 0, 0, 0, 'Already paid']], 'paid and outstanding amounts kept apart');

    // Overpayment: the club holds the excess as credit, but only when the admin confirms it
    p = ok(g.getRepaymentPreview('L001', 100000, ''), 'overpayment preview');
    same([p.overpayment, p.credit.allocated, p.totals.outstandingAfter], [9000, 9000, 0]);
    const over = g.recordRepayment('L001', 100000, '', '', { stateKey: p.stateKey });
    assert.ok(!over.ok && over.code === 'overpayment' && /UGX 9,000 more than the UGX 91,000 outstanding/.test(over.error), JSON.stringify(over));
    fails(g.recordRepayment('L001', 100000, '', ''), /more than/, 'a direct call cannot skip the check');
    const r3 = ok(g.recordRepayment('L001', 100000, '', '', { stateKey: p.stateKey, allowOverpayment: true }), 'confirmed overpayment');
    same(r3.allocation, { fee: 0, interest: 0, penalty: 0, principal: 91000, overpaid: 9000 });
    assert.strictEqual(r3.loan.status, 'Cleared');
    p = ok(g.getRepaymentPreview('L001', 0, ''), 'cleared');
    same([p.credit.before, p.totals.outstandingBefore, p.reconciles], [9000, 0, true], 'credit shown, nothing owed');

    // A reversal reopens exactly what its repayment paid
    ok(g.reverseRepayment(r1.reference, 'Cheque bounced'), 'reverse the first payment');
    p = ok(g.getRepaymentPreview('L001', 0, ''), 'after reversal');
    assert.ok(p.reconciles, 'still reconciles after a reversal');
    assert.strictEqual(p.totals.outstandingBefore, 3000, '12,000 owed again less the 9,000 credit');
  },

  'every loan model reconciles, and each payment is fully accounted for'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    g.setupFinanceSchema();
    const loan = o => addRow(ctx, 'SH_LOANS', Object.assign({ Status: 'Active', 'Issued By': 'M001' }, o));
    loan({ LoanID: 'F1', MemberNo: 'M004', 'Date Issued': '2025-01-01', 'Principal (UGX)': 100000, 'Loan Model': 'Flat', 'Processing Fee (UGX)': 5000 });
    loan({ LoanID: 'T1', MemberNo: 'M006', 'Date Issued': '2025-03-05', 'Principal (UGX)': 50000, 'Loan Model': 'Term', 'Processing Fee (UGX)': 10000,
      'Interest Rate (%)': 5, 'Term (days)': 7, 'Due Date': '2025-03-12', 'Overdue Surcharge (UGX)': 5500 });
    loan({ LoanID: 'R1', MemberNo: 'M005', 'Date Issued': '2025-01-01', 'Principal (UGX)': 40000, 'Term (months)': 4 });
    addRow(ctx, 'SH_REPAY', { LoanID: 'T1', Date: '2025-03-06', MemberNo: 'M006', 'Amount (UGX)': 20000, Reference: 'RPY-000001' });
    fakes.signInAs(ALICE);

    const f = ok(g.getRepaymentPreview('F1', 0, ''), 'flat');
    same(f.components.map(x => [x.label, x.outstandingBefore]), [['Principal', 100000], ['Interest', 10000], ['Processing fee', 5000], ['Late penalty', 11500]]);
    const t = ok(g.getRepaymentPreview('T1', 0, ''), 'term');
    same(t.components.map(x => [x.label, x.paidBefore, x.outstandingBefore]),
      [['Principal', 7500, 42500], ['Interest', 2500, 0], ['Processing fee', 10000, 0], ['Overdue surcharge', 0, 5500]], 'fee and interest already paid by the first repayment');
    const r = ok(g.getRepaymentPreview('R1', 0, ''), 'reducing');
    assert.strictEqual(r.components.find(x => x.part === 'fee').status, 'Not applicable', 'older loans have no processing fee');

    [['F1', 30000], ['F1', 200000], ['T1', 10000], ['T1', 48000], ['R1', 15000]].forEach(([id, amt]) => {
      const p = ok(g.getRepaymentPreview(id, amt, ''), id + ' ' + amt);
      const applied = p.components.reduce((s, x) => s + x.allocated, 0) + p.credit.allocated;
      assert.strictEqual(Math.round(applied * 100) / 100, amt, id + ': the parts and credit add up to the amount received');
      assert.ok(p.reconciles, id + ' ' + amt + ' reconciles');
      p.components.forEach(x => {
        assert.ok(x.allocated >= 0 && x.allocated <= x.outstandingBefore + 0.001, id + ' ' + x.label + ': never more than is owed');
        assert.ok(Math.abs(x.outstandingBefore - x.allocated - x.balanceAfter) < 0.01, id + ' ' + x.label + ': before - payment = after');
      });
    });

    // Paid in full before week 8: the late penalty falls away, and the breakdown says the charge changed
    const early = ok(g.getRepaymentPreview('F1', 115000, '2025-02-01'), 'flat paid early');
    assert.ok(early.chargeChanged && early.reconciles);
    same([early.totals.outstandingAfter, early.overpayment], [0, 0]);
  }
};
