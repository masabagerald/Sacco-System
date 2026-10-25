// ── NEW CLUB SETUP ────────────────────────────────────────────────────────────
// A club's spreadsheet sets itself up the first time the web app is opened (doGet → _ensureSetUp), so
// after deploying there is nothing to run by hand. setupNewClub() can also be run from the Apps Script
// editor. Either way it:
//   - creates every tab the app needs, with its header row, and adds any missing columns
//     (setupGuaranteeSchema() covers the guarantor, loan fund, investment, waiver and asset tabs);
//   - schedules the jobs (createAllTriggers) if the project has none yet;
//   - if the Members tab is empty, adds the hosting account -- the Google account the app runs as -- as
//     the first member: "System Administrator", an active Admin with no membership type. That account
//     always stays an active Admin with no membership type (see _hostMemberError).
// Existing tabs, rows and columns are never changed or removed, so it is safe to run again.

// Raise when a release needs setup to run again on clubs that are already live (new tabs or columns).
const SETUP_VERSION = '1';
const HOST_MEMBER_NAME = 'System Administrator';

// The core tabs, with every column the app uses. A function, not a constant: Config.gs (the SH_* names)
// loads after this file.
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

// The Google account the app runs as (the one that deployed it), lower-cased; '' if it can't be read
function _hostEmail() {
  try { return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { return ''; }
}

// Called by doGet: runs setup once per SETUP_VERSION. A failure is logged and the page still loads
// (a live club keeps working); the next visit tries again.
function _ensureSetUp() {
  if (Config.getScriptProp('setupVersion') === SETUP_VERSION) return;
  try { setupNewClub(); }
  catch (e) { Logger.log('Automatic setup did not finish: ' + e); }
}

function setupNewClub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script is not attached to a spreadsheet. Create it from the spreadsheet: Extensions → Apps Script.');
  return _withScriptLock(() => {
    const created = [];
    _coreTabs().forEach(([name, hint, headers]) => {
      if (!ss.getSheetByName(name)) created.push(name);
      _ensureTab(name, hint, headers);
    });
    setupGuaranteeSchema();  // Guarantors, notices, loan fund, investments, waivers, assets, and any missing columns

    const host = _hostEmail();
    let first = '';
    if (!readSheet(SH_MEMBERS, 'memberno').rows.some(r => String(r['MemberNo'] || '').trim())) {
      if (!host) throw new Error('Could not read the hosting account\'s email. Add it to the Members tab by hand: MemberNo ' + MEMBER_NO_PREFIX
        + '0001, Full Name ' + HOST_MEMBER_NAME + ', Role Admin, Membership Type blank, Status Active.');
      first = _nextMemberNo();
      _appendByHeaders(SH_MEMBERS, 'memberno', { 'MemberNo': first, 'Full Name': HOST_MEMBER_NAME, 'Email': host, 'Phone': '',
        'Role': 'Admin', 'Membership Type': '', 'Date Joined': today(), 'Status': 'Active', 'Committee Role': '' });
      auditLog('Club Set Up', first, 'System', 'Spreadsheet set up for ' + SACCO_NAME + '. Hosting account ' + host
        + ' added as ' + first + ' (' + HOST_MEMBER_NAME + '): Admin, no membership type.', first);
    }

    let triggers = '';
    if (!ScriptApp.getProjectTriggers().length) { createAllTriggers(); triggers = 'Scheduled jobs created. '; }

    Config.setScriptProp('setupVersion', SETUP_VERSION);
    const msg = 'Setup complete for ' + SACCO_NAME + '. '
      + (created.length ? 'Created tabs: ' + created.join(', ') + '. ' : 'All core tabs already existed. ')
      + (first ? 'The hosting account (' + host + ') is ' + first + ', ' + HOST_MEMBER_NAME + ' (Admin). ' : '') + triggers;
    Logger.log(msg);
    return msg;
  });
}

// The hosting account's member record always stays an active Admin with no membership type: it runs the
// app and must never be locked out or treated as an ordinary member. Returns an error message, or ''.
function _hostMemberError(row, role, membershipType, status) {
  const host = _hostEmail();
  if (!host || String(row['Email'] || '').trim().toLowerCase() !== host) return '';
  if (role !== 'Admin') return 'This is the hosting account (' + host + '), which runs the app. It must stay an Admin.';
  if (status !== 'Active') return 'This is the hosting account (' + host + '), which runs the app. It must stay Active.';
  // A club set up before this rule may already have one on the hosting account: it can keep it or clear it
  if (membershipType && !String(row['Membership Type'] || '').trim())
    return 'This is the hosting account (' + host + '), which runs the app. It is an administrator only and has no membership type.';
  return '';
}
