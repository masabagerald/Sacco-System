// ── NEW CLUB SETUP ────────────────────────────────────────────────────────────
// setupNewClub(): run once from the Apps Script editor in a new club's spreadsheet (see README →
// "Setting up for a new club"). Creates every tab the app needs, with its header row, then runs
// setupGuaranteeSchema() for the remaining tabs and columns. If the Members tab has no members yet,
// the person running it becomes the first member: an active Admin (Founder Member), so they can sign
// in and add everyone else. Existing tabs, rows and columns are never changed or removed, so it is
// safe to run again (and on a spreadsheet that already has data, it only adds what is missing).

// The core tabs, with every column the app uses. The other tabs (Guarantors, Loan Fund Ledger,
// Investments, Loan Waivers, Assets, ...) are created by setupGuaranteeSchema(). A function, not a
// constant: Config.gs (the SH_* names) loads after this file.
function _coreTabs() {
  return [
    [SH_MEMBERS, 'memberno', ['MemberNo', 'Full Name', 'Email', 'Phone', 'Role', 'Membership Type', 'Date Joined', 'Status', 'Committee Role']],
    [SH_SAVINGS, 'memberno', ['Date', 'Timestamp', 'MemberNo', 'Deposit Type', 'Amount (UGX)', 'Recorded By', 'Reference', 'Notes',
      'Payment Category', 'Surcharge Reason', 'Deposit Account', 'Reverses']],
    [SH_LOANS, 'loanid', ['LoanID', 'Timestamp', 'MemberNo', 'Date Issued', 'Principal (UGX)', 'Status', 'Issued By', 'Purpose', 'Override Reason',
      'Loan Model', 'Processing Fee (UGX)', 'Interest Rate (%)', 'Term (months)', 'Term (days)', 'Due Date', 'Overdue Surcharge (UGX)', 'Last Notice']],
    [SH_REPAY, 'loanid', ['LoanID', 'Date', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Recorded By', 'Notes', 'Reference', 'Reverses']],
    [SH_FINES, 'fineid', ['FineID', 'Timestamp', 'MemberNo', 'Date', 'Amount (UGX)', 'Reason', 'Status', 'Recorded By']],
    [SH_LOAN_REQ, 'requestid', ['RequestID', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Repayment Term', 'Purpose', 'Status', 'Decision Notes',
      'Decided By', 'Initiated By', 'Guarantor 1', 'Guarantor 2', 'Total Due', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At',
      'Guarantor Override', 'Limit Override']],
    [SH_WD_REQ, 'requestid', ['RequestID', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Reason', 'Status', 'Decision Notes', 'Decided By',
      'Initiated By', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Deposit Account']],
    [SH_AUDIT, 'timestamp', ['Timestamp', 'Action', 'Member (Affected)', 'Performed By', 'Details', 'Reference ID']]
  ];
}

function setupNewClub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script is not attached to a spreadsheet. Create it from the spreadsheet: Extensions → Apps Script.');
  const created = [];
  _coreTabs().forEach(([name, hint, headers]) => {
    if (!ss.getSheetByName(name)) created.push(name);
    _ensureTab(name, hint, headers);
  });
  setupGuaranteeSchema();  // Guarantors, notices, loan fund, investments, waivers, assets, and any missing columns

  const me = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  let first = '';
  if (!readSheet(SH_MEMBERS, 'memberno').rows.some(r => String(r['MemberNo'] || '').trim())) {
    if (!me) throw new Error('Could not read your email address. Add yourself to the Members tab by hand: MemberNo ' + MEMBER_NO_PREFIX + '0001, Role Admin, Membership Type Founder Member, Status Active.');
    first = _nextMemberNo();
    _appendByHeaders(SH_MEMBERS, 'memberno', { 'MemberNo': first, 'Full Name': me.split('@')[0], 'Email': me, 'Phone': '',
      'Role': 'Admin', 'Membership Type': 'Founder Member', 'Date Joined': today(), 'Status': 'Active', 'Committee Role': '' });
    auditLog('Club Set Up', first, first, 'New club spreadsheet set up by ' + me + '. First administrator added.', first);
  }
  const msg = 'Setup complete for ' + SACCO_NAME + '. '
    + (created.length ? 'Created tabs: ' + created.join(', ') + '. ' : 'All core tabs already existed. ')
    + (first ? 'You (' + me + ') are member ' + first + ', an Admin: put your full name in the Full Name cell on the Members tab. ' : '')
    + 'Next: run createAllTriggers, then deploy the web app.';
  Logger.log(msg);
  return msg;
}
