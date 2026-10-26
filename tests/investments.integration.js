// Investment Tracker: records, two-admin approval of transactions, income earned vs received,
// valuations, fees/taxes, transfers to and from the loan fund (never income, never double-counted),
// reversals and admin-only access. Real controllers against an in-memory spreadsheet.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN } = EMAIL;

function setup(c) {
  const ctx = seed(c);
  ctx.g.setupFinanceSchema();
  // Alice proposes everything; Bob and Carol approve
  ctx.approve = id => { ctx.fakes.signInAs(BOB); ok(ctx.g.approveFinanceEntry(id), 'first ' + id); ctx.fakes.signInAs(CAROL); ok(ctx.g.approveFinanceEntry(id), 'final ' + id); ctx.fakes.signInAs(ALICE); };
  ctx.propose = (...a) => { ctx.fakes.signInAs(ALICE); const r = ok(ctx.g.proposeInvestmentTx(...a), 'propose ' + a[1]); ctx.approve(r.txId); return r.txId; };
  ctx.dash = f => { ctx.fakes.signInAs(ALICE); return ok(ctx.g.getInvestmentDashboard(f || {}), 'dashboard'); };
  ctx.inv = (f, id) => ctx.dash(f).investments.find(i => i.id === (id || 'INV-000001'));
  return ctx;
}

// INV-000001 unit trust: 1,000,000 on 10 Jan 2025; 20,000 earned (Feb), the same 20,000 received (Mar);
// valued at 1,050,000 on 31 Mar; a 5,000 fee taken from the balance and 1,000 tax paid separately (Apr).
function portfolio(ctx) {
  const { g, fakes } = ctx;
  fakes.signInAs(ALICE);
  const c = ok(g.createInvestment({ name: 'Money Market Fund', type: 'Unit Trust', provider: 'UAP Old Mutual', startDate: '2025-01-10',
    accountRef: '12345678', initialAmount: 1000000, reference: 'UT-1', fundSource: 'Others', fundSourceOther: 'Club reserves' }), 'create');
  assert.ok(c.txId, 'initial investment proposed with the record');
  ctx.approve(c.txId);
  ctx.propose('INV-000001', 'Income Earned', 20000, '2025-02-28', '', 'February return', '');
  ctx.propose('INV-000001', 'Income Received', 20000, '2025-03-05', 'STMT-03', 'Paid out', '');
  ctx.propose('INV-000001', 'Valuation', 1050000, '2025-03-31', '', 'Statement value', '');
  ctx.propose('INV-000001', 'Fee', 5000, '2025-04-10', '', 'Management fee', 'Investment balance');
  ctx.propose('INV-000001', 'Tax', 1000, '2025-04-10', '', 'WHT', 'Paid separately');
}

// Principal savings so the loan fund has cash
function fundCash(ctx, amount) {
  ctx.fakes.signInAs(ALICE);
  ok(ctx.g.recordSavings('M001', 'Deposit', amount, 'Principal', 'Monthly Premium', '', '', '2025-01-02'), 'savings');
}

module.exports = {
  'income earned then received counts once; valuations, fees and taxes are kept apart'(c) {
    const ctx = setup(c);
    portfolio(ctx);
    const feb = ctx.inv({ to: '2025-02-28' }).figures;
    assert.deepStrictEqual([feb.incomeEarned, feb.incomeReceived, feb.accruedIncome, feb.incomeTotal], [20000, 0, 20000, 20000], 'earned, not yet received');
    assert.strictEqual(feb.valued, false);
    assert.strictEqual(feb.value, 1000000, 'no valuation yet: shown at cost');

    const f = ctx.inv({}).figures;
    assert.deepStrictEqual([f.incomeReceived, f.accruedIncome, f.incomeTotal], [20000, 0, 20000], 'received settles the accrual: 20,000, not 40,000');
    assert.deepStrictEqual([f.netInvested, f.value, f.valuationDate], [995000, 1045000, '2025-03-31'], 'the fee came out of the balance after the valuation');
    assert.deepStrictEqual([f.fees, f.taxes, f.costs], [5000, 1000, 6000]);
    assert.strictEqual(f.capitalGain, 50000, 'unrealized: value less net invested');
    assert.strictEqual(f.netReturn, 20000 - 6000 + 50000);

    const d = ctx.dash({});
    assert.deepStrictEqual([d.totals.unrealizedGain, d.totals.realizedGain, d.valuedCount], [50000, 0, 1]);
    assert.ok(d.valuationsAreManual);
    const apr = ctx.dash({ from: '2025-04-01', to: '2025-04-30' }).period;
    assert.deepStrictEqual([apr.costs, apr.netReturn, apr.incomeTotal], [6000, -6000, 0], 'April: only the costs');
    const months = Object.fromEntries(Array.from(d.months).map(m => [m.month, m]));
    assert.deepStrictEqual([months['2025-02'].incomeEarned, months['2025-03'].incomeReceived], [20000, 20000]);
    assert.strictEqual(d.investments[0].accountRef, '•••• 5678', 'account numbers are masked in lists');
    assert.strictEqual(ok(ctx.g.getInvestment('INV-000001'), 'detail').investment.accountRef, '12345678');
  },

  'a transfer to the loan fund is a redemption plus an injection, approved together, never income'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    portfolio(ctx); fundCash(ctx, 400000);
    const cashNow = () => { fakes.signInAs(ALICE); return g.getLoanInsights({}).closing.availableCash; };
    const before = { cash: cashNow(), inv: ctx.inv({}).figures };
    fakes.signInAs(ALICE);
    fails(g.proposeInvestmentTransfer('toLoanFund', 'INV-000001', 1045001, '2025-05-02', '', ''), /more than the investment's current recorded value/, 'over value');
    const t = ok(g.proposeInvestmentTransfer('toLoanFund', 'INV-000001', 300000, '2025-05-02', 'TRF-1', 'Top up loan float'), 'transfer');
    assert.ok(t.fundEntryId, 'a linked loan fund entry is created');
    fakes.signInAs(BOB); ok(g.approveFinanceEntry(t.txId), 'first via the investment side');
    fakes.signInAs(CAROL); ok(g.approveFinanceEntry(t.fundEntryId), 'final via the loan fund side');
    const fund = fakes.sheet(ctx.val('SH_LOAN_FUND')).records('entryid')[0];
    assert.deepStrictEqual([fund['Entry Type'], fund.Status, fund['Linked Entry']], ['Transfer from Investment', 'Approved', t.txId]);

    const after = ctx.inv({}).figures;
    assert.strictEqual(cashNow(), before.cash + 300000, 'loan fund cash up');
    assert.deepStrictEqual([after.redeemed, after.transfersToLoanFund, after.value], [300000, 300000, before.inv.value - 300000], 'investment down');
    assert.deepStrictEqual([after.incomeTotal, after.netReturn], [before.inv.incomeTotal, before.inv.netReturn], 'not income, no change in return');
    fakes.signInAs(ALICE);
    const ins = g.getLoanInsights({ from: '2025-05-01', to: '2025-05-31' });
    assert.deepStrictEqual([ins.period.transfersIn, ins.period.interestCollected, ins.period.injections], [300000, 0, 0], 'a transfer, not a cash injection or loan income');

    // Reversing one side reverses both
    const rv = ok(g.reverseFinanceEntry(t.fundEntryId, 'Entered against the wrong fund'), 'reverse');
    assert.strictEqual(rv.ids.length, 2, 'both sides get a reversal');
    ctx.approve(rv.ids[0]);
    assert.strictEqual(cashNow(), before.cash);
    assert.strictEqual(ctx.inv({}).figures.value, before.inv.value);
  },

  'money paid from the loan fund into an investment needs the cash'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    portfolio(ctx); fundCash(ctx, 100000);
    fakes.signInAs(ALICE);
    fails(g.proposeInvestmentTransfer('fromLoanFund', 'INV-000001', 100001, '', '', ''), /Not enough available loan cash/, 'over cash');
    const t = ok(g.proposeInvestmentTransfer('fromLoanFund', 'INV-000001', 60000, '', '', ''), 'transfer');
    fails(g.proposeInvestmentTransfer('fromLoanFund', 'INV-000001', 50000, '', '', ''), /after entries awaiting approval/, 'pending transfer counts');
    ctx.approve(t.txId);
    const f = ctx.inv({}).figures;
    assert.deepStrictEqual([f.transfersFromLoanFund, f.netInvested], [60000, 995000 + 60000]);
    fakes.signInAs(ALICE);
    assert.strictEqual(g.getLoanInsights({}).closing.availableCash, 40000);
  },

  'transactions need two different admins and are checked before they are proposed'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    portfolio(ctx);
    fakes.signInAs(ALICE);
    fails(g.proposeInvestmentTx('INV-000001', 'Initial Investment', 5, '', '', '', ''), /already has an initial investment/, 'second initial');
    fails(g.proposeInvestmentTx('INV-000001', 'Fee', 5, '', '', '', ''), /deducted from the investment balance or paid separately/, 'fee source');
    fails(g.proposeInvestmentTx('INV999', 'Fee', 5, '', '', '', 'Paid separately'), /Investment not found/, 'unknown investment');
    fails(g.proposeInvestmentTx('INV-000001', 'Income Received', 5, '2999-01-01', '', '', ''), /future/, 'future date');
    const id = ok(g.proposeInvestmentTx('INV-000001', 'Additional Contribution', 50000, '2025-06-01', 'DEP-9', '', ''), 'propose').txId;
    fails(g.proposeInvestmentTx('INV-000001', 'Additional Contribution', 50000, '2025-06-01', 'DEP-9', '', ''), /already used/, 'duplicate');
    const before = ctx.inv({}).figures.netInvested;
    fails(g.approveFinanceEntry(id), /You initiated this request/, 'proposer');
    fakes.signInAs(BOB); ok(g.approveFinanceEntry(id), 'first');
    assert.strictEqual(ctx.inv({}).figures.netInvested, before, 'not counted after one approval');
    fakes.signInAs(BOB); fails(g.approveFinanceEntry(id), /already gave the first approval/, 'same admin twice');
    fakes.signInAs(CAROL); ok(g.approveFinanceEntry(id), 'final');
    assert.strictEqual(ctx.inv({}).figures.netInvested, before + 50000);
    ['Investment Created', 'Investment Transaction Proposed', 'Investment Transaction First Approval', 'Investment Transaction Approved']
      .forEach(a => assert.ok(ctx.audit().some(x => x.Action === a), 'audited: ' + a));
  },

  'a reversed valuation is ignored; edits are audited with a reason'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    portfolio(ctx);
    const val = fakes.sheet(ctx.val('SH_INV_TX')).records('txid').find(r => r['Tx Type'] === 'Valuation').TxID;
    fakes.signInAs(ALICE);
    const rv = ok(g.reverseFinanceEntry(val, 'Wrong statement'), 'reverse valuation');
    ctx.approve(rv.ids[0]);
    const f = ctx.inv({}).figures;
    assert.deepStrictEqual([f.valued, f.value, f.capitalGain], [false, f.netInvested, 0], 'back to cost');

    fakes.signInAs(ALICE);
    const data = Object.assign(ok(g.getInvestment('INV-000001'), 'get').investment, { status: 'Matured', accountRef: '87654321' });
    fails(g.updateInvestment('INV-000001', data, ''), /reason/, 'no reason');
    ok(g.updateInvestment('INV-000001', data, 'Fund matured'), 'update');
    const a = ctx.audit().find(x => x.Action === 'Investment Updated');
    assert.ok(/Status: "Active" -> "Matured"/.test(a.Details) && /•••• 5678.*•••• 4321/.test(a.Details) && !/87654321/.test(a.Details), a.Details);
  },

  'upcoming maturities'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    fakes.signInAs(ALICE);
    const soon = g.fmt_date(g._addDays(new Date(), 30)), far = g.fmt_date(g._addDays(new Date(), 200));
    ok(g.createInvestment({ name: 'FD 1', type: 'Fixed Deposit', provider: 'Stanbic', startDate: '2025-01-01', maturityDate: soon, fundSource: 'Welfare' }), 'fd1');
    ok(g.createInvestment({ name: 'Bond', type: 'Treasury Bond', provider: 'BoU', startDate: '2025-01-01', maturityDate: far, fundSource: 'Principal' }), 'bond');
    fails(g.createInvestment({ name: 'FD 1', type: 'Fixed Deposit', provider: 'Stanbic', startDate: '2025-01-01', fundSource: 'Welfare' }), /already exists/, 'duplicate record');
    fails(g.createInvestment({ name: 'X', type: 'Fixed Deposit', provider: 'Y', startDate: '2025-01-01', currency: 'USD', fundSource: 'Welfare' }), /Only UGX/, 'currency');
    assert.deepStrictEqual(Array.from(ctx.dash().maturities).map(m => m.name), ['FD 1']);
  },

  'only admins can see or change investments'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    portfolio(ctx);
    fakes.signInAs(DAN);                                 // Founder Member: Loan Insights yes, investments no
    fails(g.getInvestmentDashboard({}), /Admin access required/, 'dashboard');
    fails(g.getInvestment('INV-000001'), /Admin access required/, 'detail');
    fails(g.getInvestmentTransactions(''), /Admin access required/, 'transactions');
    fails(g.createInvestment({ name: 'x' }), /Admin access required/, 'create');
    fails(g.proposeInvestmentTx('INV-000001', 'Fee', 5, '', '', '', 'Paid separately'), /Admin access required/, 'propose');
    fails(g.proposeInvestmentTransfer('toLoanFund', 'INV-000001', 5, '', '', ''), /Admin access required/, 'transfer');
    ok(g.getLoanInsights({}), 'Loan Insights still allowed');
  },

  'every investment records its source of funds; only Principal can be paid out of the loan fund'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.fakes.signInAs(ALICE);
    const base = { type: 'Fixed Deposit', provider: 'Stanbic', startDate: '2025-01-01' };
    const r1 = g.createInvestment(Object.assign({ name: 'A' }, base));
    assert.ok(!r1.ok && r1.field === 'fundSource' && /Choose the source of funds: Principal, Operations, Welfare, Others/.test(r1.error), JSON.stringify(r1));
    const r2 = g.createInvestment(Object.assign({ name: 'A', fundSource: 'Savings' }, base));
    assert.ok(!r2.ok && r2.field === 'fundSource', 'unknown source refused');
    const r3 = g.createInvestment(Object.assign({ name: 'A', fundSource: 'Others' }, base));
    assert.ok(!r3.ok && r3.field === 'fundSourceOther' && /where the money came from/.test(r3.error), 'Others needs a description');
    const r4 = g.createInvestment(Object.assign({ name: 'A', fundSource: 'Welfare', initialAmount: 1000, fromLoanFund: true }, base));
    assert.ok(!r4.ok && /Only money from Principal is paid out of the loan fund/.test(r4.error), 'loan fund only for Principal');

    const a = ok(g.createInvestment(Object.assign({ name: 'A', fundSource: 'Others', fundSourceOther: 'Harambee fundraising' }, base)), 'others').investmentId;
    ok(g.createInvestment(Object.assign({ name: 'B', fundSource: 'Welfare', fundSourceOther: 'ignored' }, base)), 'welfare');
    const det = ok(g.getInvestment(a), 'detail').investment;
    assert.deepStrictEqual([det.fundSource, det.fundSourceOther], ['Others', 'Harambee fundraising']);
    const b = ok(g.getInvestment('INV-000002'), 'detail B').investment;
    assert.deepStrictEqual([b.fundSource, b.fundSourceOther], ['Welfare', ''], 'the description is kept only for Others');
    assert.ok(ctx.audit().some(x => x.Action === 'Investment Created' && /funded from Others: Harambee fundraising/.test(x.Details)));

    const dash = ok(g.getInvestmentDashboard({}), 'dashboard');
    assert.strictEqual(dash.investments.find(i => i.id === a).fundSource, 'Others: Harambee fundraising');
    assert.strictEqual(JSON.stringify(dash.bySource.map(x => x.name).sort()), JSON.stringify(['Others: Harambee fundraising', 'Welfare']));

    // A change of source is audited like any other change
    ok(g.updateInvestment(a, Object.assign({}, det, { fundSource: 'Operations', fundSourceOther: '' }), 'Recorded wrongly'), 'update');
    assert.ok(ctx.audit().some(x => x.Action === 'Investment Updated' && /Source of Funds: "Others" -> "Operations"/.test(x.Details)), 'old and new source kept');
  }
};
