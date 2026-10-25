// Reference numbers: every record type gets CODE-000001 (six digits, one counter per type). References
// made before this format (L007, R003, AST-0004, LF002, IT005, INV001) stay valid, and numbering carries
// on after the highest one, so no number is ever reused.
const assert = require('assert');
const { EMAIL, seed, ok } = require('./fixtures');

module.exports = {
  'new references use CODE-000001 for every record type'(c) {
    const { g } = seed(c);
    const fmt = /^[A-Z]{2,3}-[0-9]{6}$/;
    ['loan', 'loanRequest', 'withdrawal', 'surcharge', 'fundEntry', 'investment', 'investmentTx', 'asset', 'deposit', 'savingsOut', 'reversal', 'repayment']
      .forEach(k => assert.match(g._nextRef(k, []), fmt, k));
    assert.deepStrictEqual(['loan', 'loanRequest', 'withdrawal', 'surcharge', 'fundEntry', 'investment', 'investmentTx', 'asset'].map(k => g._nextRef(k, [])),
      ['LN-000001', 'LRQ-000001', 'WRQ-000001', 'SUR-000001', 'LFE-000001', 'INV-000001', 'IVT-000001', 'AST-000001']);
  },

  'numbering continues after references in the older format, which stay valid'(c) {
    const { g } = seed(c);
    assert.strictEqual(g._nextRef('loan', ['L001', 'L007', 'LN-000003']), 'LN-000008', 'after L007');
    assert.strictEqual(g._nextRef('loanRequest', ['R012']), 'LRQ-000013');
    assert.strictEqual(g._nextRef('surcharge', ['F002', 'SUR-000009']), 'SUR-000010');
    assert.strictEqual(g._nextRef('asset', ['AST-0004']), 'AST-000005');
    assert.strictEqual(g._nextRef('investment', ['INV002']), 'INV-000003');
    assert.strictEqual(g._nextRef('investmentTx', ['IT005', 'INV-000009']), 'IVT-000006', 'an investment ID is not an investment transaction');
    assert.strictEqual(g._nextRef('loan', ['LFE-000050', 'LRQ-000040']), 'LN-000001', 'other types never count');
    // Loan fund and investment-transaction IDs are recognised in both formats
    assert.deepStrictEqual(['LF003', 'LFE-000004', 'IT002', 'IVT-000007', 'INV-000001', 'L001'].map(g._ledgerKeyOf), ['fund', 'fund', 'inv', 'inv', '', '']);
  },

  'records created through the app get the new references, after existing ones'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    // An existing club: loans and surcharges numbered the old way
    const loans = fakes.sheet(val('SH_LOANS'));
    loans.data.push(['L007', '', 'M004', '2024-02-01', 1000, 'Cleared']);
    fakes.sheet(val('SH_FINES')).data.push(['F004', 'M004', 1000, 'Paid']);
    assert.strictEqual(g.nextId(val('SH_LOANS'), 'loanid', 'loan'), 'LN-000008');
    fakes.signInAs(EMAIL.ALICE);
    assert.strictEqual(ok(g.issueFine('M004', 2000, 'Late'), 'surcharge').fineId, 'SUR-000005');
    fakes.signInAs(EMAIL.EVE);
    assert.strictEqual(ok(g.getMyWithdrawalRequests(), 'list').requests.length, 0);
    fakes.signInAs(EMAIL.ALICE);
    ok(g.recordSavings('M005', 'Deposit', 50000, 'Operations', 'Operations Fee', '', '', '2024-01-01'), 'deposit');
    fakes.signInAs(EMAIL.EVE);
    assert.strictEqual(ok(g.requestWithdrawal(1000, 'Dividends', '', 'Operations'), 'withdrawal').requestId, 'WRQ-000001');
    // The old references still work everywhere: the old surcharge can be found and is listed with the new one
    fakes.signInAs(EMAIL.ALICE);
    assert.strictEqual(JSON.stringify(g.getAllFinesForAdmin().map(f => f.fineId).sort()), JSON.stringify(['F004', 'SUR-000005']));
  },

  'assets are listed in number order across both formats'(c) {
    const { g } = seed(c);
    const views = ['AST-000010', 'AST-0009', 'AST-000002'].map(id => ({ id, tag: '', serial: '', make: '', model: '', description: '', type: '',
      condition: '', availability: '', location: '', dateAcquired: '', verification: '', disposed: false }));
    const f = { q: '', type: '', condition: '', availability: '', location: '', from: '', to: '', verification: '', disposal: '' };
    assert.deepStrictEqual(Array.from(g._filterAssets(views, f)).map(a => a.id), ['AST-000002', 'AST-0009', 'AST-000010']);
  }
};
