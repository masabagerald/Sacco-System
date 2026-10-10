// ── DEPOSIT ACCOUNT TESTS ──────────────────────────────────────────────────────
// Ledger rules for the Principal / Operations / Welfare accounts, exercised on in-memory rows
// (the helpers under test take rows and make no Sheet calls). Run runDepositAccountTests() from
// the Apps Script editor, or `npm test` locally. Throws on the first failure.

function assertTrue_(cond, label) {
  Logger.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) throw new Error('Assertion failed: ' + label);
}

function savRow_(memberNo, type, amount, account, category, ref, reverses, date) {
  return { MemberNo: memberNo, 'Deposit Type': type, 'Amount (UGX)': amount, 'Deposit Account': account || '',
    'Payment Category': category || '', Reference: ref || '', Reverses: reverses || '', Date: date || '2026-01-15' };
}

function ledger_() {
  return [
    savRow_('M001', 'Deposit', 100000, 'Principal', 'Monthly Premium', 'DEP-000001'),
    savRow_('M001', 'Deposit', 20000, 'Operations', 'Operations Fee', 'DEP-000002'),
    savRow_('M001', 'Deposit', 15000, 'Welfare', 'Welfare Fee', 'DEP-000003'),
    savRow_('M001', 'Withdrawal', 5000, 'Welfare', '', 'WDL-000001'),
    savRow_('M002', 'Deposit', 50000, 'Principal', 'Membership Fee', 'DEP-000004'),
    savRow_('M002', 'Deposit', 8000, 'Welfare', 'Welfare Fee', 'DEP-000005'),
    savRow_('M002', 'Deposit Reversal', 8000, 'Welfare', 'Welfare Fee', 'REV-000001', 'DEP-000005')
  ];
}

function test_accountOf_placesLegacyRowsByCategory() {
  assertTrue_(_accountOf({ 'Payment Category': 'Operations Fee' }) === 'Operations', 'legacy Operations Fee row is Operations');
  assertTrue_(_accountOf({ 'Payment Category': 'Welfare Fee' }) === 'Welfare', 'legacy Welfare Fee row is Welfare');
  assertTrue_(_accountOf({ 'Payment Category': 'Monthly Premium' }) === 'Principal', 'legacy Monthly Premium row is Principal');
  assertTrue_(_accountOf({ 'Payment Category': '' }) === 'Principal', 'legacy uncategorised row (e.g. old withdrawal) is Principal');
  assertTrue_(_accountOf({ 'Deposit Account': 'Welfare', 'Payment Category': '' }) === 'Welfare', 'explicit account wins');
}

function test_balances_keepAccountsDistinct() {
  const b = _accountBalancesFromRows(ledger_(), 'M001');
  assertEqual_(b.Principal, 100000, 'M001 Principal balance');
  assertEqual_(b.Operations, 20000, 'M001 Operations balance');
  assertEqual_(b.Welfare, 10000, 'M001 Welfare balance is deposits less the Welfare withdrawal');
  assertEqual_(b.total, 130000, 'M001 total is the sum of the three accounts');
  const b2 = _accountBalancesFromRows(ledger_(), 'M002');
  assertEqual_(b2.Welfare, 0, 'a reversed deposit no longer counts');
  assertEqual_(b2.Principal, 50000, 'M002 Principal untouched by the Welfare reversal');
}

function test_balances_legacyTotalUnchanged() {
  // Rows from before accounts existed: no Deposit Account column, lowercase types.
  const rows = [
    { MemberNo: 'M009', Type: 'deposit', 'Amount (UGX)': 40000, 'Payment Category': 'Monthly Premium' },
    { MemberNo: 'M009', Type: 'deposit', 'Amount (UGX)': 6000, 'Payment Category': 'Welfare Fee' },
    { MemberNo: 'M009', Type: 'withdrawal', 'Amount (UGX)': 10000 }
  ];
  const b = _accountBalancesFromRows(rows, 'M009');
  assertEqual_(b.total, 36000, 'legacy total = deposits - withdrawals, as before accounts existed');
  assertEqual_(b.Welfare, 6000, 'legacy Welfare Fee deposit lands in Welfare');
  assertEqual_(b.Principal, 30000, 'legacy withdrawal is taken from Principal');
}

function test_dashboardTotals_matchLedger() {
  const rows = ledger_().concat([savRow_('M002', 'Deposit', 7000, 'Operations', 'Operations Fee', 'DEP-000006', '', '2026-02-03')]);
  const s = _depositAccountSummary(rows, { M001: 'Alice', M002: 'Bob' }, '2026-02');
  const by = {}; s.forEach(a => { by[a.account] = a; });
  assertTrue_(s.map(a => a.account).join(',') === 'Principal,Operations,Welfare', 'one summary per account, in order');
  assertEqual_(by.Principal.contributions, 150000, 'Principal contributions');
  assertEqual_(by.Operations.contributions, 27000, 'Operations contributions');
  assertEqual_(by.Welfare.contributions, 15000, 'Welfare contributions net of the reversed deposit');
  assertEqual_(by.Welfare.withdrawals, 5000, 'Welfare withdrawals');
  assertEqual_(by.Welfare.balance, 10000, 'Welfare balance = contributions - withdrawals');
  assertEqual_(by.Operations.contributionsThisMonth, 7000, 'this-month figure only counts the selected month');
  ['M001', 'M002'].forEach(no => {
    const b = _accountBalancesFromRows(rows, no);
    s.forEach(a => {
      const m = a.members.find(x => x.memberNo === no);
      assertEqual_(m ? m.balance : 0, b[a.account], 'dashboard ' + a.account + ' balance for ' + no + ' matches the member balance');
    });
  });
}

function test_validateContribution() {
  const ok = _validateContribution({ type: 'Deposit', amount: '25000', account: 'Welfare', category: 'Welfare Fee', txDate: '2026-01-02', notes: ' slip 7 ' });
  assertTrue_(ok.ok && ok.tx.amount === 25000 && ok.tx.account === 'Welfare' && ok.tx.notes === 'slip 7', 'valid Welfare deposit is accepted and cleaned');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 100, category: 'Welfare Fee' }).ok, 'deposit without an account is rejected');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 100, account: 'Savings', category: 'Welfare Fee' }).ok, 'unknown account is rejected');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 100, account: 'Principal', category: 'Welfare Fee' }).ok, 'Welfare Fee cannot be filed under Principal');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 0, account: 'Principal', category: 'Monthly Premium' }).ok, 'zero amount is rejected');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 100, account: 'Principal', category: 'Surcharge' }).ok, 'surcharge needs a reason');
  assertTrue_(!_validateContribution({ type: 'Deposit', amount: 100, account: 'Principal', category: 'Monthly Premium', txDate: '2999-01-01' }).ok, 'future date is rejected');
  const wd = _validateContribution({ type: 'Withdrawal', amount: 100, account: 'Operations', category: 'Welfare Fee' });
  assertTrue_(wd.ok && wd.tx.category === '', 'withdrawal needs an account but no category');
}

function test_ledgerRules_principalIsIndividual() {
  const rows = ledger_();
  const wd = (memberNo, amount) => [{ memberNo, type: 'Withdrawal', amount, account: 'Principal' }];
  assertTrue_(_checkSavingsTxs(rows, wd('M002', 50000)) === '', 'a member can withdraw their whole Principal balance');
  assertTrue_(_checkSavingsTxs(rows, wd('M002', 50001)) !== '', 'Principal withdrawal above the member\'s own balance is blocked, though M001 has more');
}

function test_ledgerRules_poolsIgnoreIndividualContributions() {
  // Club pools: Operations = 20,000 (all from M001); Welfare = 15,000 + 8,000 - 5,000 - 8,000 = 10,000
  const rows = ledger_();
  assertEqual_(_poolBalanceFromRows(rows, 'Operations'), 20000, 'club Operations balance');
  assertEqual_(_poolBalanceFromRows(rows, 'Welfare'), 10000, 'club Welfare balance');
  const wd = (memberNo, account, amount) => [{ memberNo, type: 'Withdrawal', amount, account }];
  assertTrue_(_checkSavingsTxs(rows, wd('M002', 'Operations', 20000)) === '', 'M002 paid nothing into Operations but may withdraw from the pool');
  assertTrue_(_checkSavingsTxs(rows, wd('M002', 'Welfare', 10000)) === '', 'M002 (net zero Welfare) may withdraw the whole Welfare pool');
  assertTrue_(_checkSavingsTxs(rows, wd('M002', 'Welfare', 10001)) !== '', 'a pooled withdrawal cannot exceed the club balance');
}

function test_ledgerRules_reversals() {
  const rows = ledger_();
  const rev = (ref, type, account, amount, memberNo) => [{ memberNo: memberNo || 'M001', type, amount, account, reverses: ref }];
  assertTrue_(_checkSavingsTxs(rows, rev('DEP-000002', 'Deposit Reversal', 'Operations', 20000)) === '', 'an unspent deposit can be reversed');
  assertTrue_(_checkSavingsTxs(rows, rev('DEP-000005', 'Deposit Reversal', 'Welfare', 8000, 'M002')) !== '', 'a deposit cannot be reversed twice');
  assertTrue_(_checkSavingsTxs(rows, rev('REV-000001', 'Deposit Reversal', 'Welfare', 8000, 'M002')) !== '', 'a reversal cannot itself be reversed');
  assertTrue_(_checkSavingsTxs(rows, rev('DEP-999999', 'Deposit Reversal', 'Welfare', 1)) !== '', 'unknown reference is rejected');
  assertTrue_(_checkSavingsTxs(rows, rev('DEP-000003', 'Deposit Reversal', 'Welfare', 15000)) !== '', 'reversing a deposit that was partly withdrawn would overdraw Welfare, so it is blocked');
  // Correction: reverse 20,000 Operations and re-record 12,000 in Operations — net effect only.
  const correction = [{ memberNo: 'M001', type: 'Deposit Reversal', amount: 20000, account: 'Operations', reverses: 'DEP-000002' },
                      { memberNo: 'M001', type: 'Deposit', amount: 12000, account: 'Operations' }];
  assertTrue_(_checkSavingsTxs(rows, correction) === '', 'a correction is checked on its net effect');
}

function test_nextSavingsRef() {
  const rows = ledger_();
  assertTrue_(_nextSavingsRef(rows, 'Deposit') === 'DEP-000006', 'next deposit reference');
  assertTrue_(_nextSavingsRef(rows, 'Withdrawal') === 'WDL-000002', 'next withdrawal reference');
  assertTrue_(_nextSavingsRef(rows, 'Deposit Reversal') === 'REV-000002', 'reversals share the REV sequence');
}

function test_withdrawalEligibilityAndAvailability() {
  assertTrue_(_canWithdraw('Founder Member') && _canWithdraw('Delegate Member'), 'Founder and Delegate Members may request withdrawals');
  assertTrue_(!_canWithdraw('Non-Member') && !_canWithdraw(''), 'Non-Members and unset types may not');
  const rows = ledger_(); // Principal: M001 100,000, M002 50,000. Pools: Operations 20,000, Welfare 10,000
  const reqs = [
    { MemberNo: 'M001', 'Deposit Account': 'Welfare', 'Amount (UGX)': 4000, Status: 'Pending' },
    { MemberNo: 'M002', 'Deposit Account': 'Welfare', 'Amount (UGX)': 1000, Status: 'Partially Approved' },
    { MemberNo: 'M001', 'Deposit Account': 'Welfare', 'Amount (UGX)': 9000, Status: 'Rejected' },
    { MemberNo: 'M001', 'Amount (UGX)': 30000, Status: 'Pending' },
    { MemberNo: 'M002', 'Deposit Account': 'Principal', 'Amount (UGX)': 5000, Status: 'Pending' }
  ];
  assertEqual_(_withdrawalAvailable(rows, reqs, 'M002', 'Welfare'), 5000, 'pool: club balance less every member\'s open requests on it');
  assertEqual_(_withdrawalAvailable(rows, reqs, 'M001', 'Welfare'), 5000, 'pool: the same figure for every member');
  assertEqual_(_withdrawalAvailable(rows, reqs, 'M002', 'Operations'), 20000, 'pool: a member with no Operations contributions still sees the club balance');
  assertEqual_(_withdrawalAvailable(rows, reqs, 'M001', 'Principal'), 70000, 'Principal: own balance less own open requests (pre-account requests draw on Principal)');
  assertEqual_(_withdrawalAvailable(rows, reqs, 'M002', 'Principal'), 45000, 'Principal: other members\' requests do not count');
}

function test_contributionsFromRows() {
  const c = _contributionsFromRows(ledger_(), 'M002');
  assertEqual_(c.Principal, 50000, 'Principal contributions');
  assertEqual_(c.Welfare, 0, 'a reversed contribution is netted out');
  const c1 = _contributionsFromRows(ledger_(), 'M001');
  assertEqual_(c1.Welfare, 15000, 'withdrawals do not reduce contributions');
}

function test_loanSpecs() {
  const soft = _loanSpecFor('Non-Member', '2w');
  assertTrue_(soft.ok && soft.spec.guarantorsRequired === true, 'Non-Member Soft Loans need guarantors');
  assertTrue_(soft.spec.savingsLimit === false, 'Soft Loans have no savings cap (Non-Members have no savings)');
  assertEqual_(soft.spec.rate, 0.10, '2-week Soft Loan rate is 10%');
  assertEqual_(soft.spec.fee, 10000, 'Soft Loan processing fee is UGX 10,000');
  assertEqual_(_loanSpecFor('Non-Member', '1w').spec.rate, 0.05, '1-week Soft Loan rate is 5%');
  assertEqual_(_loanSpecFor('Non-Member', '3w').spec.rate, 0.15, '3-week Soft Loan rate is 15%');
  assertEqual_(_loanSpecFor('Non-Member', '1m').spec.rate, 0.15, '4-week (1 month) Soft Loan rate is 15%');
  const member = _loanSpecFor('Delegate Member', 3);
  assertTrue_(member.ok && member.spec.guarantorsRequired && member.spec.savingsLimit, 'Delegate member loans keep guarantors and the savings cap');
  assertTrue_(!_loanSpecFor('Non-Member', '').ok, 'a Soft Loan needs a valid term');
}

// Shared by loan and withdrawal approvals
function test_approvalRestrictions() {
  const req = { MemberNo: 'M001', 'Initiated By': 'M001', Status: 'Pending', 'Approver 1': '' };
  assertTrue_(_approvalDutyError(req, 'M001') !== '', 'the initiator cannot approve their own request');
  assertTrue_(_approvalDutyError(req, 'M002') === '', 'a different admin can give the first approval');
  const onBehalf = { MemberNo: 'M005', 'Initiated By': 'M003', Status: 'Pending' };
  assertTrue_(_approvalDutyError(onBehalf, 'M003') !== '', 'whoever initiated it cannot approve, even for another member');
  assertTrue_(_approvalDutyError(onBehalf, 'M005') !== '', 'the applicant / account holder cannot approve their own request');
  const partial = { MemberNo: 'M001', 'Initiated By': 'M001', Status: 'Partially Approved', 'Approver 1': 'M002' };
  assertTrue_(_approvalDutyError(partial, 'M002') !== '', 'the first approver cannot also give the second approval');
  assertTrue_(_approvalDutyError(partial, 'M003') === '', 'a second, different admin can give the final approval');
  assertTrue_(_approvalDutyError({ MemberNo: 'M001', Status: 'Approved' }, 'M003') !== '', 'a decided request cannot be approved again');
  assertTrue_(_approvalDutyError({ MemberNo: 'M001', Status: 'Rejected' }, 'M003') !== '', 'a rejected request cannot proceed');
}

function runDepositAccountTests() {
  test_accountOf_placesLegacyRowsByCategory();
  test_balances_keepAccountsDistinct();
  test_balances_legacyTotalUnchanged();
  test_dashboardTotals_matchLedger();
  test_validateContribution();
  test_ledgerRules_principalIsIndividual();
  test_ledgerRules_poolsIgnoreIndividualContributions();
  test_ledgerRules_reversals();
  test_nextSavingsRef();
  test_withdrawalEligibilityAndAvailability();
  test_contributionsFromRows();
  test_loanSpecs();
  test_approvalRestrictions();
  Logger.log('All DepositAccount tests passed.');
}
