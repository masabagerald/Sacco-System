// Loan Insights and the Loan Fund Ledger: access, calculations from source rows, repayment
// allocation, borrower counts, two-admin approval of fund entries, reversals and reconciliation.
// Real controllers against an in-memory spreadsheet. Loans and repayments are written straight onto
// the sheets with past dates, so every figure below can be checked by hand.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN, EVE, NAN } = EMAIL;

// Appends a row to a fake sheet, by header name
function addRow(ctx, sheetConst, obj) {
  const sh = ctx.fakes.sheet(ctx.val(sheetConst));
  const h = sh.data.findIndex(r => r.some(v => String(v).trim() !== ''));
  const headers = sh.data[h];
  sh.data.push(headers.map(k => (k in obj ? obj[k] : '')));
}

// Principal savings: M001 600,000 and M002 400,000 in January 2025; M002 withdraws 50,000 in June.
// Loans (all 2025):
//  L001 M004 Founder member loan: 100,000 on 1 Feb, 10%, fee 5,000, 2 months (due 1 Apr).
//       Repaid 50,000 on 15 Mar -> fee 5,000, interest 10,000, principal 35,000. 65,000 principal still owed.
//  L002 M006 Non-Member Soft Loan: 50,000 on 5 Mar, 1 week at 5%, fee 10,000, due 12 Mar, overdue
//       surcharge 5,500 (charged 13 Mar). Repaid 68,000 on 20 Mar -> fully cleared.
//  L003 M004 again: 20,000 on 10 May (repeat borrower), fee 5,000, 10%, 2 months. Not repaid.
function history(ctx) {
  const { g, fakes } = ctx;
  fakes.signInAs(ALICE);
  ok(g.recordSavings('M001', 'Deposit', 600000, 'Principal', 'Monthly Premium', '', '', '2025-01-05'), 'dep M001');
  ok(g.recordSavings('M002', 'Deposit', 400000, 'Principal', 'Monthly Premium', '', '', '2025-01-06'), 'dep M002');
  ok(g.recordSavings('M002', 'Deposit', 70000, 'Operations', 'Operations Fee', '', '', '2025-01-06'), 'ops dep (not loan capital)');
  ok(g.recordSavings('M002', 'Withdrawal', 50000, 'Principal', '', '', '', '2025-06-02'), 'wd M002');
  const loan = (o) => addRow(ctx, 'SH_LOANS', Object.assign({ Status: 'Active', 'Issued By': 'M001' }, o));
  loan({ LoanID: 'L001', MemberNo: 'M004', 'Date Issued': '2025-02-01', 'Principal (UGX)': 100000, 'Loan Model': 'Member',
    'Processing Fee (UGX)': 5000, 'Interest Rate (%)': 10, 'Term (months)': 2, 'Due Date': '2025-04-01' });
  loan({ LoanID: 'L002', MemberNo: 'M006', 'Date Issued': '2025-03-05', 'Principal (UGX)': 50000, 'Loan Model': 'Term',
    'Processing Fee (UGX)': 10000, 'Interest Rate (%)': 5, 'Term (days)': 7, 'Due Date': '2025-03-12', 'Overdue Surcharge (UGX)': 5500, Status: 'Cleared' });
  loan({ LoanID: 'L003', MemberNo: 'M004', 'Date Issued': '2025-05-10', 'Principal (UGX)': 20000, 'Loan Model': 'Member',
    'Processing Fee (UGX)': 5000, 'Interest Rate (%)': 10, 'Term (months)': 2, 'Due Date': '2025-07-10' });
  addRow(ctx, 'SH_REPAY', { LoanID: 'L001', Date: '2025-03-15', MemberNo: 'M004', 'Amount (UGX)': 50000, 'Recorded By': 'M001' });
  addRow(ctx, 'SH_REPAY', { LoanID: 'L002', Date: '2025-03-20', MemberNo: 'M006', 'Amount (UGX)': 68000, 'Recorded By': 'M001' });
}

function setup(c) {
  const ctx = seed(c);
  ctx.g.setupFinanceSchema();
  ctx.fund = () => ctx.fakes.sheet(ctx.val('SH_LOAN_FUND')).records('entryid');
  return ctx;
}

module.exports = {
  'repayments are split fee, interest, penalty, principal; a credit pays a later charge'(c) {
    const { g } = setup(c);
    const charges = [{ part: 'principal', date: '2025-01-10', amount: 100000 }, { part: 'fee', date: '2025-01-10', amount: 5000 },
      { part: 'interest', date: '2025-01-10', amount: 10000 }, { part: 'penalty', date: '2025-04-01', amount: 2000 }];
    const a = g._allocateRepayments(charges, [{ date: '2025-02-01', ref: 'a', amount: 12000 }, { date: '2025-03-01', ref: 'b', amount: 108000 }]);
    const pick = x => [x.cash, x.fee, x.interest, x.penalty, x.principal, x.overpaid];
    assert.deepStrictEqual(pick(a[0]), [12000, 5000, 7000, 0, 0, 0], 'fee first, then interest');
    assert.deepStrictEqual(pick(a[1]), [108000, 0, 3000, 0, 100000, 5000], 'the penalty is not yet charged, so the rest is held as credit');
    assert.deepStrictEqual(pick(a[2]), [0, 0, 0, 2000, 0, -2000], 'the held credit pays the penalty when it is charged -- no new cash');
    const cash = a.reduce((s, x) => s + x.cash, 0), parts = a.reduce((s, x) => s + x.fee + x.interest + x.penalty + x.principal + x.overpaid, 0);
    assert.strictEqual(cash, parts, 'allocations always add up to the cash received');
  },

  'figures are calculated from the source sheets, assessed kept apart from collected'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(ALICE);
    const r = ok(g.getLoanInsights({ from: '2025-02-01', to: '2025-03-31' }), 'insights');
    const p = r.period;
    assert.deepStrictEqual([p.disbursed, p.loansIssued, p.principalRepaid], [150000, 2, 85000]);
    assert.deepStrictEqual([p.interestCharged, p.interestCollected], [12500, 12500]);
    assert.deepStrictEqual([p.feesCharged, p.feesCollected], [15000, 15000]);
    assert.deepStrictEqual([p.penaltiesCharged, p.penaltiesCollected], [5500, 5500]);
    assert.strictEqual(p.cashReceived, 118000, 'what actually came in: 50,000 + 68,000');
    assert.strictEqual(r.opening.availableCash, 1000000, 'opening fund: Principal savings before February (Operations is not loan capital)');
    const k = r.closing;
    assert.strictEqual(k.availableCash, 1000000 - 150000 + 118000);
    assert.strictEqual(k.outstandingPrincipal, 65000);
    assert.deepStrictEqual([k.interestOutstanding, k.feesOutstanding, k.penaltiesOutstanding], [0, 0, 0]);
    assert.strictEqual(k.fundPosition, k.availableCash + 65000, 'fund position = cash + receivables');
    assert.deepStrictEqual([k.overdueCount, k.activeLoans], [0, 1], 'L001 is not due until 1 April');
    assert.deepStrictEqual(Array.from(r.months).map(m => m.month), ['2025-02', '2025-03']);
    assert.deepStrictEqual(Array.from(r.months).map(m => m.disbursed), [100000, 50000]);
    assert.deepStrictEqual(Array.from(r.months).map(m => m.availableCash), [900000, 968000], 'month-end balances');

    // Point-in-time: after the due date L001 is overdue; L003 adds unpaid interest and fee (charged, not cash)
    const later = ok(g.getLoanInsights({ from: '2025-04-01', to: '2025-06-30' }), 'later');
    assert.deepStrictEqual([later.closing.overdueCount, later.closing.overdueAmount], [1, 65000]);
    assert.deepStrictEqual([later.period.interestCharged, later.period.interestCollected, later.closing.interestOutstanding], [2000, 0, 2000]);
    assert.deepStrictEqual([later.period.feesCharged, later.period.feesCollected, later.closing.feesOutstanding], [5000, 0, 5000]);
    assert.strictEqual(later.closing.availableCash, 968000 - 20000 - 50000, 'L003 paid out; the Principal withdrawal leaves the fund');
    assert.strictEqual(later.period.savingsNet, -50000);
  },

  'a client counts once per period; new and repeat borrowers'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(ALICE);
    const all = ok(g.getLoanInsights({}), 'all time').borrowers;
    assert.deepStrictEqual([all.unique, all.loans, all.newBorrowers, all.repeatBorrowers], [2, 3, 2, 0], 'M004 took two loans but is one client');
    const may = ok(g.getLoanInsights({ from: '2025-05-01', to: '2025-05-31' }), 'May').borrowers;
    assert.deepStrictEqual([may.unique, may.newBorrowers, may.repeatBorrowers], [1, 0, 1], 'M004 had borrowed before');
    const byType = Object.fromEntries(all.byMembershipType.map(x => [x.type, x]));
    assert.deepStrictEqual([byType['Founder Member'].loans, byType['Founder Member'].feesCharged, byType['Non-Member'].feesCharged], [2, 10000, 10000],
      'Founder/Delegate fee 5,000; Non-Member fee 10,000');
  },

  'the ledger trace reconciles to available cash'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(ALICE);
    for (const range of [{}, { from: '2025-03-01', to: '2025-03-31' }, { from: '2025-02-10', to: '2025-06-30' }]) {
      const ins = ok(g.getLoanInsights(range), 'insights');
      const led = ok(g.getLoanFundLedger(range), 'ledger');
      assert.strictEqual(led.closing, ins.closing.availableCash, 'ledger closing = dashboard cash for ' + JSON.stringify(range));
      assert.strictEqual(led.opening, range.from ? ins.opening.availableCash : 0);
      const net = led.rows.reduce((s, x) => s + x.amount, 0);
      assert.strictEqual(Math.round(led.opening + net), led.closing, 'opening + movements = closing');
    }
    const rep = ok(g.getLoanFundLedger({ from: '2025-03-15', to: '2025-03-15' }), 'one day').rows;
    assert.ok(rep.some(x => x.source === 'Loan Repayments' && /fee 5,000, interest 10,000, principal 35,000/.test(x.description)), 'each repayment shows its split');
  },

  'access: admins full, Founder Members aggregate only, everyone else refused'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(CAROL);                                         // Admin role, Delegate membership
    const admin = ok(g.getLoanInsights({}), 'admin');
    assert.strictEqual(admin.access, 'admin');
    assert.ok(Array.isArray(admin.loans) && admin.loans.some(l => l.name === 'Dan'), 'admins get per-loan detail');

    fakes.signInAs(DAN);                                           // Founder Member, not an admin
    const founder = ok(g.getLoanInsights({}), 'founder');
    assert.strictEqual(founder.access, 'aggregate');
    assert.strictEqual(founder.loans, undefined, 'no per-loan rows');
    assert.ok(!/Dan|Nan|M00[1-7]|L00[1-3]/.test(JSON.stringify(founder)), 'no member names, numbers or loan ids anywhere in the response');
    assert.strictEqual(founder.closing.availableCash, admin.closing.availableCash, 'same aggregate figures');
    fails(g.getLoanFundLedger({}), /Admin access required/, 'founder ledger');
    fails(g.getLoanFundEntries(), /Admin access required/, 'founder fund entries');
    fails(g.proposeLoanFundEntry('Cash Injection', 1000, '', '', 'x'), /Admin access required/, 'founder proposing');
    fails(g.approveFinanceEntry('LF001'), /Admin access required/, 'founder approving');

    for (const [who, label] of [[EVE, 'delegate'], [NAN, 'non-member']]) {
      fakes.signInAs(who);
      fails(g.getLoanInsights({}), /administrators and Founder Members only/, label);
      fails(g.getLoanFundLedger({}), /Admin access required/, label + ' ledger');
    }
    fakes.signInAs('');
    fails(g.getLoanInsights({}), /Session expired/, 'signed out');
    fakes.signInAs(ALICE);
    fails(g.getLoanInsights({ from: '2025-05-01', to: '2025-04-01' }), /start date/, 'reversed range');
  },

  'loan fund entries count only after two different admins approve'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    const cash = () => { fakes.signInAs(ALICE); return g.getLoanInsights({}).closing.availableCash; };
    const before = cash();
    fakes.signInAs(ALICE);
    fails(g.proposeLoanFundEntry('Cash Injection', 200000, '2025-07-01', '', ''), /Describe where the money came from/, 'no description');
    fails(g.proposeLoanFundEntry('Transfer from Investment', 1, '', '', 'x'), /Choose Cash Injection or Other Outflow/, 'transfers only via investments');
    const e = ok(g.proposeLoanFundEntry('Cash Injection', 200000, '2025-07-01', 'BANK-77', 'Grant from district'), 'propose');
    fails(g.proposeLoanFundEntry('Cash Injection', 200000, '2025-07-01', 'bank-77', 'Again'), /already used/, 'duplicate reference');
    fails(g.proposeLoanFundEntry('Cash Injection', 200000, '2025-07-01', '', 'Grant from district'), /already awaiting approval/, 'identical pending entry');
    assert.strictEqual(cash(), before, 'a pending entry does not count');
    fakes.signInAs(ALICE); fails(g.approveFinanceEntry(e.entryId), /You initiated this request/, 'proposer approving');
    fakes.signInAs(BOB); assert.strictEqual(ok(g.approveFinanceEntry(e.entryId), 'first').stage, 'first');
    assert.strictEqual(cash(), before, 'one approval is not enough');
    fakes.signInAs(BOB); fails(g.approveFinanceEntry(e.entryId), /already gave the first approval/, 'same admin twice');
    fakes.signInAs(CAROL); assert.strictEqual(ok(g.approveFinanceEntry(e.entryId), 'final').stage, 'final');
    assert.strictEqual(cash(), before + 200000, 'counts once approved');
    fakes.signInAs(ALICE);
    const ins = g.getLoanInsights({ from: '2025-07-01', to: '2025-07-31' });
    assert.deepStrictEqual([ins.period.injections, ins.period.interestCollected], [200000, 0], 'an injection is not income');

    // Outflows cannot overdraw available cash, pending outflows included
    const avail = cash();
    fakes.signInAs(ALICE);
    fails(g.proposeLoanFundEntry('Other Outflow', avail + 1, '', '', 'Too much'), /Not enough available loan cash/, 'overdraw');
    ok(g.proposeLoanFundEntry('Other Outflow', avail - 1000, '', '', 'Bank charges'), 'big outflow pending');
    fails(g.proposeLoanFundEntry('Other Outflow', 2000, '', '', 'Stationery'), /after entries awaiting approval/, 'pending outflows count');

    // Reversal: proposed, approved by two others, and the original row is untouched
    fakes.signInAs(BOB);
    const rv = ok(g.reverseFinanceEntry(e.entryId, 'Grant was cancelled'), 'propose reversal');
    fails(g.reverseFinanceEntry(e.entryId, 'again'), /already has a reversal/, 'second reversal');
    fakes.signInAs(ALICE); ok(g.approveFinanceEntry(rv.ids[0]), 'rev first');
    fakes.signInAs(CAROL); ok(g.approveFinanceEntry(rv.ids[0]), 'rev final');
    assert.strictEqual(cash(), before, 'the reversal cancels the injection');
    const rows = ctx.fund();
    assert.deepStrictEqual([rows[0]['Amount (UGX)'], rows[0].Status, rows[0].Reference], [200000, 'Approved', 'BANK-77'], 'original kept as it was');
    assert.strictEqual(rows.find(r => r.EntryID === rv.ids[0]).Reverses, e.entryId);
    fakes.signInAs(ALICE);
    fails(g.reverseFinanceEntry(rv.ids[0], 'x'), /cannot itself be reversed/, 'reverse a reversal');

    const actions = ctx.audit().map(a => a.Action);
    ['Loan Fund Entry Proposed', 'Loan Fund Entry First Approval', 'Loan Fund Entry Approved', 'Loan Fund Entry Reversal Proposed']
      .forEach(x => assert.ok(actions.indexOf(x) > -1, 'audited: ' + x));
  },

  'a rejected entry never counts and cannot be approved'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(ALICE);
    const e = ok(g.proposeLoanFundEntry('Cash Injection', 5000, '', '', 'Donation'), 'propose');
    fakes.signInAs(BOB);
    fails(g.rejectFinanceEntry(e.entryId, ''), /reason/, 'reject without reason');
    ok(g.rejectFinanceEntry(e.entryId, 'Not received'), 'reject');
    fakes.signInAs(CAROL);
    fails(g.approveFinanceEntry(e.entryId), /Already decided/, 'approve after reject');
    assert.ok(ctx.audit().some(a => a.Action === 'Loan Fund Entry Rejected' && /Not received/.test(a.Details)));
  },

  'admins see every member\'s running loan and record repayments against it'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    history(ctx);
    fakes.signInAs(DAN);
    fails(g.getActiveLoans(), /Admin access required/, 'non-admin');
    fakes.signInAs(CAROL);
    const list = ok(g.getActiveLoans(), 'active loans').loans;
    assert.deepStrictEqual(Array.from(list).map(l => l.loanId), ['L001', 'L003'], 'L002 is cleared; the overdue L001 comes first');
    const l3 = list.find(l => l.loanId === 'L003');
    assert.deepStrictEqual([l3.name, l3.outstandingBalance, l3.overdue], ['Dan', 27000, true], '20,000 + 10% + 5,000 fee');
    const r = ok(g.recordRepayment('L003', 27000, 'Cash to treasurer', '2025-07-01'), 'repayment by another admin');
    assert.strictEqual(r.loan.status, 'Cleared');
    assert.deepStrictEqual(Array.from(ok(g.getActiveLoans(), 'after').loans).map(l => l.loanId), ['L001']);
    assert.ok(ctx.audit().some(a => a.Action === 'Loan Repayment' && a['Reference ID'] === 'L003' && a['Performed By'] === 'M003'));
  },

  'a reversal undoes exactly what its repayment paid, and the charges reopen'(c) {
    const { g } = setup(c);
    const pick = x => [x.cash, x.fee, x.interest, x.penalty, x.principal, x.overpaid];
    const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
    const base = [{ part: 'principal', date: '2025-01-10', amount: 100000 }, { part: 'fee', date: '2025-01-10', amount: 5000 },
      { part: 'interest', date: '2025-01-10', amount: 10000 }];
    const a = Array.from(g._allocateRepayments(base, [{ date: '2025-02-01', ref: 'A', amount: 12000 }, { date: '2025-02-10', ref: 'B', amount: 50000 },
      { date: '2025-03-01', ref: 'RA', amount: -12000, reverses: 'A' }, { date: '2025-03-05', ref: 'C', amount: 20000 }]));
    assert.deepStrictEqual(pick(a[2]), [-12000, -5000, -7000, 0, 0, 0], 'A paid the fee and part of the interest; the reversal takes exactly that back');
    assert.deepStrictEqual(pick(a[3]), [20000, 5000, 7000, 0, 8000, 0], 'the reopened fee and interest are paid first again');
    assert.deepStrictEqual([sum(a, 'fee'), sum(a, 'interest'), sum(a, 'principal'), sum(a, 'cash')], [5000, 10000, 55000, 70000]);

    // A credit that already paid a later penalty is withdrawn: the borrower owes it again
    const pen = [{ part: 'principal', date: '2025-01-10', amount: 100 }, { part: 'penalty', date: '2025-02-01', amount: 20 }];
    const b = Array.from(g._allocateRepayments(pen, [{ date: '2025-01-20', ref: 'P', amount: 110 }, { date: '2025-03-01', ref: 'RP', amount: -110, reverses: 'P' },
      { date: '2025-03-02', ref: 'Q', amount: 120 }]));
    assert.deepStrictEqual(pick(b[2]), [-110, 0, 0, 0, -100, -10], 'the credit that paid the penalty is withdrawn');
    const bd = { charges: pen, allocations: b.slice(0, 3) };
    assert.strictEqual(g._loanOutstandingAt(bd, '2025-03-01'), 120, 'everything is owed again, including the penalty');
    assert.deepStrictEqual(pick(b[3]), [120, 0, 0, 10, 100, 10], 'the next payment makes the withdrawn credit good first, then the rest of the penalty, then principal');
    assert.strictEqual(g._loanOutstandingAt({ charges: pen, allocations: b }, '2025-03-02'), 0);
  },

  'existing repayments get references once, in date order'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    history(ctx);
    g.setupFinanceSchema();
    const reps = () => fakes.sheet(val('SH_REPAY')).records('loanid');
    assert.deepStrictEqual(reps().map(r => [r.LoanID, r.Reference, r['Amount (UGX)']]), [['L001', 'RPY-000001', 50000], ['L002', 'RPY-000002', 68000]]);
    const snap = JSON.stringify(fakes.sheet(val('SH_REPAY')).data);
    g.setupFinanceSchema();
    assert.strictEqual(JSON.stringify(fakes.sheet(val('SH_REPAY')).data), snap, 'a second run changes nothing');
    assert.strictEqual(ctx.audit().filter(a => a.Action === 'Repayment References Assigned').length, 1);
    fakes.signInAs(ALICE);
    assert.strictEqual(ok(g.recordRepayment('L003', 1000, '', '2025-07-01'), 'new repayment').reference, 'RPY-000003');
  },

  'reversing a repayment: the original is kept, the loan reopens and every figure follows'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    history(ctx);
    g.setupFinanceSchema();
    fakes.signInAs(ALICE);
    const before = ok(g.getLoanInsights({}), 'before');
    fakes.signInAs(DAN);
    fails(g.reverseRepayment('RPY-000002', 'x'), /Admin access required/, 'non-admin');
    fails(g.getRepayments(), /Admin access required/, 'non-admin list');
    fakes.signInAs(BOB);
    fails(g.reverseRepayment('RPY-000002', ''), /reason/, 'no reason');
    fails(g.reverseRepayment('RPY-999999', 'x'), /was not found/, 'unknown');
    const r = ok(g.reverseRepayment('RPY-000002', 'Recorded against the wrong loan'), 'reverse L002 repayment');
    assert.strictEqual(r.outstandingBalance, 68000, 'the whole Soft Loan is owed again');

    const rows = fakes.sheet(val('SH_REPAY')).records('loanid');
    assert.deepStrictEqual([rows[1].Reference, rows[1]['Amount (UGX)'], rows[1].Reverses], ['RPY-000002', 68000, ''], 'original untouched');
    const rv = rows.find(x => x.Reference === r.reference);
    assert.deepStrictEqual([rv.LoanID, rv['Amount (UGX)'], rv.Reverses, rv['Recorded By']], ['L002', -68000, 'RPY-000002', 'M002']);
    assert.match(rv.Notes, /Recorded against the wrong loan/);
    assert.strictEqual(fakes.sheet(val('SH_LOANS')).records('loanid').find(l => l.LoanID === 'L002').Status, 'Active', 'cleared loan reopened');
    assert.ok(Array.from(ok(g.getActiveLoans(), 'active').loans).some(l => l.loanId === 'L002'));
    assert.ok(fakes.emails.some(e => /Loan Repayment Reversed: L002/.test(e.subject)), 'member emailed');
    assert.ok(ctx.audit().some(a => a.Action === 'Loan Repayment Reversed' && /RPY-000002/.test(a.Details) && /wrong loan/.test(a.Details)));
    fails(g.reverseRepayment('RPY-000002', 'again'), /already been reversed/, 'twice');
    fails(g.reverseRepayment(r.reference, 'x'), /cannot itself be reversed/, 'a reversal');
    const list = Array.from(ok(g.getRepayments(), 'list').repayments);
    assert.strictEqual(list.find(x => x.reference === 'RPY-000002').reversedBy, r.reference);

    // Loan Insights: cash and collections drop by the reversed split; receivables return; the trace still reconciles
    fakes.signInAs(ALICE);
    const after = ok(g.getLoanInsights({}), 'after');
    assert.strictEqual(after.closing.availableCash, before.closing.availableCash - 68000);
    assert.deepStrictEqual([after.cumulative.interestCollected, after.cumulative.feesCollected, after.cumulative.penaltiesCollected],
      [before.cumulative.interestCollected - 2500, before.cumulative.feesCollected - 10000, before.cumulative.penaltiesCollected - 5500]);
    assert.deepStrictEqual([after.closing.outstandingPrincipal, after.closing.interestOutstanding, after.closing.penaltiesOutstanding],
      [before.closing.outstandingPrincipal + 50000, before.closing.interestOutstanding + 2500, 5500]);
    const march = ok(g.getLoanInsights({ from: '2025-03-01', to: '2025-03-31' }), 'March');
    assert.strictEqual(march.period.cashReceived, 118000, 'March still shows the money recorded then; the reversal is dated when it was made');
    const led = ok(g.getLoanFundLedger({}), 'ledger');
    assert.strictEqual(led.closing, after.closing.availableCash);
    assert.ok(led.rows.some(x => x.kind === 'Repayment reversal' && x.amount === -68000 && /takes back fee 10,000/.test(x.description)));
  },

  'setupFinanceSchema is safe to run again'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    fakes.signInAs(ALICE);
    ok(g.proposeLoanFundEntry('Cash Injection', 5000, '', '', 'Donation'), 'propose');
    const snap = JSON.stringify(fakes.sheet(val('SH_LOAN_FUND')).data);
    g.setupFinanceSchema();
    assert.strictEqual(JSON.stringify(fakes.sheet(val('SH_LOAN_FUND')).data), snap, 'rows and headers unchanged');
  }
};
