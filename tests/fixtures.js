// Shared test data for the integration tests: an in-memory copy of the club spreadsheet.
const assert = require('assert');

const EMAIL = {
  ALICE: 'alice@x.org', BOB: 'bob@x.org', CAROL: 'carol@x.org', DAN: 'dan@x.org',
  EVE: 'eve@x.org', NAN: 'nan@x.org', FAY: 'fay@x.org'
};

// Members:  M001 Alice  Admin  Founder     M002 Bob   Admin  Founder     M003 Carol Admin Delegate
//           M004 Dan    Member Founder     M005 Eve   Member Delegate    M006 Nan   Member Non-Member
//           M007 Fay    Member Founder
function seed({ g, fakes, val }) {
  fakes.addSheet(val('SH_MEMBERS'), [
    ['MemberNo', 'Full Name', 'Email', 'Phone', 'Role', 'Membership Type', 'Date Joined', 'Status'],
    ['M001', 'Alice', EMAIL.ALICE, '', 'Admin', 'Founder Member', '2024-01-01', 'Active'],
    ['M002', 'Bob', EMAIL.BOB, '', 'Admin', 'Founder Member', '2024-01-01', 'Active'],
    ['M003', 'Carol', EMAIL.CAROL, '', 'Admin', 'Delegate Member', '2024-01-01', 'Active'],
    ['M004', 'Dan', EMAIL.DAN, '', 'Member', 'Founder Member', '2024-01-01', 'Active'],
    ['M005', 'Eve', EMAIL.EVE, '', 'Member', 'Delegate Member', '2024-01-01', 'Active'],
    ['M006', 'Nan', EMAIL.NAN, '', 'Member', 'Non-Member', '2024-01-01', 'Active'],
    ['M007', 'Fay', EMAIL.FAY, '', 'Member', 'Founder Member', '2024-01-01', 'Active']
  ]);
  // Title rows above the header, as on the real tabs
  fakes.addSheet(val('SH_SAVINGS'), [['Savings Ledger'], [],
    ['Date', 'Timestamp', 'MemberNo', 'Deposit Type', 'Amount (UGX)', 'Recorded By', 'Reference', 'Notes', 'Payment Category', 'Surcharge Reason', 'Deposit Account', 'Reverses']]);
  fakes.addSheet(val('SH_WD_REQ'), [['RequestID', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Reason', 'Status', 'Decision Notes', 'Decided By',
    'Initiated By', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Deposit Account']]);
  fakes.addSheet(val('SH_AUDIT'), [['Timestamp', 'Action', 'Member (Affected)', 'Performed By', 'Details', 'Reference ID']]);
  fakes.addSheet(val('SH_LOANS'), [['LoanID', 'Timestamp', 'MemberNo', 'Date Issued', 'Principal (UGX)', 'Status', 'Issued By', 'Purpose', 'Override',
    'Loan Model', 'Processing Fee (UGX)', 'Interest Rate (%)', 'Term (months)', 'Term (days)', 'Due Date', 'Overdue Surcharge (UGX)', 'Last Notice']]);
  fakes.addSheet(val('SH_REPAY'), [['LoanID', 'Date', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Recorded By', 'Notes']]);
  fakes.addSheet(val('SH_FINES'), [['FineID', 'MemberNo', 'Amount (UGX)', 'Status']]);
  fakes.addSheet(val('SH_LOAN_REQ'), [['RequestID', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Repayment Term', 'Purpose', 'Status', 'Decision Notes', 'Decided By',
    'Initiated By', 'Guarantor 1', 'Guarantor 2', 'Total Due', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Guarantor Override']]);
  fakes.addSheet(val('SH_GUARANTORS'), [val('GUARANTOR_HEADERS')]);
  const recs = (name, hint) => () => fakes.sheet(val(name)).records(hint);
  return { g, fakes, val,
    ledger: recs('SH_SAVINGS', 'memberno'), audit: recs('SH_AUDIT', 'timestamp'), wdReqs: recs('SH_WD_REQ', 'requestid'),
    loans: recs('SH_LOANS', 'loanid'), loanReqs: recs('SH_LOAN_REQ', 'requestid'), guarantors: recs('SH_GUARANTORS', 'requestid') };
}

function ok(res, label) { assert.ok(res && res.ok, label + ': ' + JSON.stringify(res)); return res; }
function fails(res, pattern, label) {
  assert.ok(res && !res.ok, label + ' should fail but returned ' + JSON.stringify(res));
  if (pattern) assert.match(res.error, pattern, label);
}

module.exports = { EMAIL, seed, ok, fails };
