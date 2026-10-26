// Investments funded from the Operations or Welfare pool: approved contributions come off the pool's
// balance, redemptions go back into it, reversals undo either. A contribution the pool can't cover is
// refused, both when proposed and at the final approval. Withdrawal limits and the dashboard follow.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN } = EMAIL;

function setup(c) {
  const ctx = seed(c), { g, fakes } = ctx;
  g.setupFinanceSchema();
  ctx.as = e => fakes.signInAs(e);
  ctx.approve = id => { ctx.as(BOB); ok(g.approveFinanceEntry(id), 'first ' + id); ctx.as(CAROL); ok(g.approveFinanceEntry(id), 'final ' + id); ctx.as(ALICE); };
  ctx.pool = account => { ctx.as(ALICE); return ok(g.getAdminDashboard(), 'dashboard').depositAccounts.find(a => a.account === account); };
  // Welfare pool: 500,000 from two members; Operations: 80,000
  ctx.as(ALICE);
  ok(g.recordSavings('M004', 'Deposit', 300000, 'Welfare', 'Welfare Fee', '', '', '2024-01-01'), 'welfare 1');
  ok(g.recordSavings('M005', 'Deposit', 200000, 'Welfare', 'Welfare Fee', '', '', '2024-01-01'), 'welfare 2');
  ok(g.recordSavings('M004', 'Deposit', 80000, 'Operations', 'Operations Fee', '', '', '2024-01-01'), 'operations');
  return ctx;
}

const FD = { type: 'Fixed Deposit', provider: 'Stanbic', startDate: '2025-01-01' };

module.exports = {
  'money invested from Welfare comes off the Welfare pool once approved, and redemptions put it back'(c) {
    const ctx = setup(c), { g } = ctx;
    const inv = ok(g.createInvestment(Object.assign({ name: 'Welfare FD', fundSource: 'Welfare', initialAmount: 300000 }, FD)), 'create');
    assert.ok(inv.txId, 'initial amount proposed');
    assert.strictEqual(ctx.pool('Welfare').balance, 500000, 'nothing comes off before approval');
    // ...but a withdrawal can't use money already promised to the investment
    ctx.as(DAN);
    fails(g.requestWithdrawal(250000, 'Welfare', '', 'Welfare'), /exceeds the available club Welfare balance \(UGX 200,000/, 'pending investment counted');
    ctx.approve(inv.txId);
    const w = ctx.pool('Welfare');
    assert.deepStrictEqual([w.balance, w.invested, w.redeemed, w.contributions], [200000, 300000, 0, 500000], 'approved: 300,000 off the pool');
    assert.strictEqual(ctx.pool('Operations').balance, 80000, 'Operations is not touched');
    ctx.as(DAN);
    assert.strictEqual(ok(g.getMySavings(), 'mine').available.Welfare, 200000, 'members see the lower pool balance');

    // Redeeming 100,000 returns it to Welfare
    ctx.as(ALICE);
    ctx.approve(ok(g.proposeInvestmentTx(inv.investmentId, 'Redemption', 100000, '', 'RED-1', '', ''), 'redeem').txId);
    const w2 = ctx.pool('Welfare');
    assert.deepStrictEqual([w2.balance, w2.invested, w2.redeemed], [300000, 300000, 100000]);
  },

  'a contribution the pool cannot cover is refused, when proposed and at the final approval'(c) {
    const ctx = setup(c), { g } = ctx;
    const r = g.createInvestment(Object.assign({ name: 'Ops FD', fundSource: 'Operations', initialAmount: 90000 }, FD));
    assert.ok(r.ok && !r.txId && /Not enough money in the club Operations pool: UGX 80,000 available/.test(r.txError), JSON.stringify(r));
    const id = r.investmentId;
    fails(g.proposeInvestmentTx(id, 'Initial Investment', 90000, '', '', '', ''), /Not enough money in the club Operations pool/, 'over the pool');
    const tx = ok(g.proposeInvestmentTx(id, 'Initial Investment', 60000, '', '', '', ''), 'within the pool').txId;
    fails(g.proposeInvestmentTx(id, 'Additional Contribution', 30000, '', '', '', ''), /UGX 20,000 available \(after withdrawals and investments awaiting approval\)/, 'pending counted');
    // The pool shrinks before the approval: the final approval checks again
    ok(g.recordSavings('M004', 'Withdrawal', 50000, 'Operations', '', '', '', ''), 'admin pays 50,000 out of Operations');
    ctx.as(BOB); ok(g.approveFinanceEntry(tx), 'first approval');
    ctx.as(CAROL); fails(g.approveFinanceEntry(tx), /Not enough money in the club Operations pool: UGX 30,000 available/, 'final approval re-checks');
    assert.strictEqual(ctx.pool('Operations').balance, 30000, 'nothing invested');
  },

  'a reversed contribution goes back to the pool; the pool never goes below zero'(c) {
    const ctx = setup(c), { g } = ctx;
    const inv = ok(g.createInvestment(Object.assign({ name: 'W', fundSource: 'Welfare', initialAmount: 500000 }, FD)), 'create');
    ctx.approve(inv.txId);
    assert.strictEqual(ctx.pool('Welfare').balance, 0);
    fails(g.recordSavings('M004', 'Withdrawal', 1, 'Welfare', '', '', '', ''), /Insufficient balance in the club Welfare account/, 'nothing left to withdraw');
    const rev = ok(g.reverseFinanceEntry(inv.txId, 'Entered against the wrong pool'), 'reverse');
    assert.strictEqual(ctx.pool('Welfare').balance, 0, 'a reversal counts only once approved');
    rev.ids.forEach(ctx.approve);
    const w = ctx.pool('Welfare');
    assert.deepStrictEqual([w.balance, w.invested], [500000, 0], 'the money is back in the pool');
  },

  'the source of funds is locked once money has moved; recording it on an older investment takes its money off the pool'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    const inv = ok(g.createInvestment(Object.assign({ name: 'W', fundSource: 'Welfare', initialAmount: 100000 }, FD)), 'create');
    ctx.approve(inv.txId);
    const det = ok(g.getInvestment(inv.investmentId), 'get').investment;
    const sw = g.updateInvestment(inv.investmentId, Object.assign({}, det, { fundSource: 'Operations' }), 'Wrong pool');
    assert.ok(!sw.ok && sw.field === 'fundSource' && /can't be changed after money has been paid/.test(sw.error), JSON.stringify(sw));
    ok(g.updateInvestment(inv.investmentId, Object.assign({}, det, { notes: 'Renewed yearly' }), 'Note'), 'other details can still change');

    // An investment entered before the source existed (60,000 paid in): recording Operations takes it off that pool
    const old = ok(g.createInvestment(Object.assign({ name: 'Old', fundSource: 'Principal', initialAmount: 60000 }, FD)), 'old').investmentId;
    const tx = fakes.sheet(val('SH_INV_TX')).records('txid').find(r => r.InvestmentID === old).TxID;
    ctx.approve(tx);
    const sh = fakes.sheet(val('SH_INVESTMENTS')), hdr = sh.data.findIndex(r => r.includes('InvestmentID'));
    const col = sh.data[hdr].indexOf('Source of Funds');
    sh.data.find(r => r[0] === old)[col] = '';                         // as it was before the field existed
    const oldDet = ok(g.getInvestment(old), 'get old').investment;
    assert.strictEqual(oldDet.fundSource, '');
    ok(g.updateInvestment(old, Object.assign({}, oldDet, { fundSource: 'Operations' }), 'Source recorded'), 'source recorded for the first time');
    assert.strictEqual(ctx.pool('Operations').balance, 20000, '60,000 of the 80,000 Operations pool was in it');
  }
};
