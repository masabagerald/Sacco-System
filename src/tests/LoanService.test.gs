// ── LOAN SERVICE TESTS ─────────────────────────────────────────────────────────
// _schedule and _computeLoan are pure functions (only Date/Math, no Sheet/GAS
// service calls), so they're exercised directly here with in-memory fixtures.
// Run runLoanServiceTests() from the Apps Script editor; it throws on failure
// so a red run is unambiguous, and logs a line per assertion either way.

function assertEqual_(actual, expected, label) {
  const pass = Math.abs(actual - expected) < 0.01;
  Logger.log((pass ? 'PASS' : 'FAIL') + ' — ' + label + ' (expected ' + expected + ', got ' + actual + ')');
  if (!pass) throw new Error('Assertion failed: ' + label + ' — expected ' + expected + ', got ' + actual);
}

function monthsAgo_(n) {
  const d = new Date();
  d.setDate(1); // anchor to the 1st so setMonth can't roll over into the wrong month (e.g. Jan 31 - 1 month)
  d.setMonth(d.getMonth() - n);
  return d;
}

function test_schedule_lastRowClosesToZero() {
  const { monthlyPayment, schedule } = _schedule(120000, 5, 6);
  assertEqual_(schedule.length, 6, 'schedule has 6 rows for a 6-month term');
  assertEqual_(schedule[5].closing, 0, 'final row closes to zero');
  assertEqual_(monthlyPayment > 0 ? 1 : 0, 1, 'monthly payment is positive');
}

function test_schedule_zeroRateSplitsPrincipalEvenly() {
  const { schedule } = _schedule(90000, 0, 3);
  assertEqual_(schedule[0].payment, 30000, 'zero-rate payment is principal/term');
  assertEqual_(schedule[2].closing, 0, 'zero-rate schedule still fully repays by the last month');
}

function test_computeLoan_accruesInterestWithNoRepayments() {
  const loan = {
    LoanID: 'TEST1', MemberNo: 'M999', 'Principal (UGX)': 100000, 'Monthly Rate (%)': 5,
    'Date Issued': monthsAgo_(3), 'Term (months)': 6, Status: 'Active'
  };
  const result = _computeLoan(loan, []);
  // Manual reducing-balance walk for 3 months at 5%/mo, matching _computeLoan's algorithm.
  let expectedBalance = 100000;
  for (let i = 0; i < 3; i++) expectedBalance += expectedBalance * 0.05;
  assertEqual_(result.outstandingBalance, r2(expectedBalance), 'outstanding balance compounds monthly with no repayments');
  assertEqual_(result.status === LOAN_STATUS.ACTIVE ? 1 : 0, 1, 'loan with a live balance stays Active');
  assertEqual_(result.overdue ? 1 : 0, 0, 'loan within its term is not overdue');
}

function test_computeLoan_clearsWhenFullyRepaid() {
  const issued = monthsAgo_(1);
  const loan = {
    LoanID: 'TEST2', MemberNo: 'M999', 'Principal (UGX)': 50000, 'Monthly Rate (%)': 5,
    'Date Issued': issued, 'Term (months)': 6, Status: 'Active'
  };
  const repayments = [{ LoanID: 'TEST2', Date: new Date(), 'Amount (UGX)': 100000 }];
  const result = _computeLoan(loan, repayments);
  assertEqual_(result.outstandingBalance, 0, 'overpaying a loan leaves zero outstanding balance');
  assertEqual_(result.status === LOAN_STATUS.CLEARED ? 1 : 0, 1, 'fully repaid loan is marked Cleared');
}

function runLoanServiceTests() {
  test_schedule_lastRowClosesToZero();
  test_schedule_zeroRateSplitsPrincipalEvenly();
  test_computeLoan_accruesInterestWithNoRepayments();
  test_computeLoan_clearsWhenFullyRepaid();
  Logger.log('All LoanService tests passed.');
}
