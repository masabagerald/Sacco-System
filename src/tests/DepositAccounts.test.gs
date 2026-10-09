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

function test_ledgerRules_blockOverdraftPerAccount() {
  const rows = ledger_();
  const wd = (account, amount) => [{ memberNo: 'M001', type: 'Withdrawal', amount, account }];
  assertTrue_(_checkSavingsTxs(rows, wd('Welfare', 10000)) === '', 'withdrawing the whole Welfare balance is allowed');
  assertTrue_(_checkSavingsTxs(rows, wd('Welfare', 10001)) !== '', 'Welfare withdrawal above the Welfare balance is blocked even though the total is enough');
  assertTrue_(_checkSavingsTxs(rows, wd('Operations', 20000)) === '', 'Operations withdrawal within its own balance is allowed');
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
  assertTrue_(_canWithdraw('Founder Member'), 'Founder Members may request withdrawals');
  assertTrue_(!_canWithdraw('Non-Member') && !_canWithdraw(''), 'Non-Members and unset types may not');
  assertTrue_(_canWithdraw('Delegate Member') === (WITHDRAWAL_MEMBERSHIP_TYPES.indexOf('Delegate Member') > -1), 'Delegate eligibility follows WITHDRAWAL_MEMBERSHIP_TYPES');
  const bal = { Principal: 100000, Operations: 20000, Welfare: 10000 };
  const reqs = [
    { MemberNo: 'M001', 'Deposit Account': 'Welfare', 'Amount (UGX)': 4000, Status: 'Pending' },
    { MemberNo: 'M001', 'Deposit Account': 'Welfare', 'Amount (UGX)': 1000, Status: 'Partially Approved' },
    { MemberNo: 'M001', 'Deposit Account': 'Welfare', 'Amount (UGX)': 9000, Status: 'Rejected' },
    { MemberNo: 'M002', 'Deposit Account': 'Welfare', 'Amount (UGX)': 9000, Status: 'Pending' },
    { MemberNo: 'M001', 'Amount (UGX)': 30000, Status: 'Pending' }
  ];
  assertEqual_(_withdrawalAvailable(bal, reqs, 'M001', 'Welfare'), 5000, 'open requests on the same account are set aside');
  assertEqual_(_withdrawalAvailable(bal, reqs, 'M001', 'Operations'), 20000, 'requests on other accounts do not reduce Operations');
  assertEqual_(_withdrawalAvailable(bal, reqs, 'M001', 'Principal'), 70000, 'requests made before accounts existed draw on Principal');
}

function test_withdrawalApprovalRestrictions() {
  const req = { MemberNo: 'M001', 'Initiated By': 'M001', Status: 'Pending', 'Approver 1': '' };
  assertTrue_(_withdrawalApprovalError(req, 'M001') !== '', 'the initiator cannot approve their own request');
  assertTrue_(_withdrawalApprovalError(req, 'M002') === '', 'a different admin can give the first approval');
  const onBehalf = { MemberNo: 'M005', 'Initiated By': 'M003', Status: 'Pending' };
  assertTrue_(_withdrawalApprovalError(onBehalf, 'M003') !== '', 'whoever initiated it cannot approve, even for another member');
  assertTrue_(_withdrawalApprovalError(onBehalf, 'M005') !== '', 'the account holder cannot approve a withdrawal from their own account');
  const partial = { MemberNo: 'M001', 'Initiated By': 'M001', Status: 'Partially Approved', 'Approver 1': 'M002' };
  assertTrue_(_withdrawalApprovalError(partial, 'M002') !== '', 'the first approver cannot also give the second approval');
  assertTrue_(_withdrawalApprovalError(partial, 'M003') === '', 'a second, different admin can give the final approval');
  assertTrue_(_withdrawalApprovalError({ MemberNo: 'M001', Status: 'Approved' }, 'M003') !== '', 'a decided request cannot be approved again');
}

function runDepositAccountTests() {
  test_accountOf_placesLegacyRowsByCategory();
  test_balances_keepAccountsDistinct();
  test_balances_legacyTotalUnchanged();
  test_dashboardTotals_matchLedger();
  test_validateContribution();
  test_ledgerRules_blockOverdraftPerAccount();
  test_ledgerRules_reversals();
  test_nextSavingsRef();
  test_withdrawalEligibilityAndAvailability();
  test_withdrawalApprovalRestrictions();
  Logger.log('All DepositAccount tests passed.');
}
