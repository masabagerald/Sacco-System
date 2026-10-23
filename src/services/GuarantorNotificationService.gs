// ── GUARANTOR NOTIFICATIONS ───────────────────────────────────────────────────
// Both guarantors of a running loan are emailed, for information only, when the borrower repays, pays
// interest, a surcharge or a fine, has a repayment reversed, falls overdue or has a charge raised, and
// when the loan is cleared. Guarantors receive no money: these are notices, not payments.
// Every notice sent is one row on the Guarantor Notifications tab, keyed by an event key (for example
// "repayment|RPY-000012"). A notice whose key is already on the tab for that guarantor is never sent
// again, so a retried trigger or a repeated call sends nothing twice. Notices stop once the loan is
// cleared, except the clearance notice itself (and the notices of the payment that cleared it).
const GUARANTOR_NOTICE_HEADERS = ['Timestamp','Event Key','LoanID','BorrowerNo','GuarantorNo','Event','Amount (UGX)',
  'Transaction Date','Remaining Balance (UGX)','Sent To'];

// The Guarantor Notifications tab, created on first use if setupGuaranteeSchema() has not been run
function _guarantorNoticeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SH_GUARANTOR_NOTICES);
  if (!sh) sh = ss.insertSheet(SH_GUARANTOR_NOTICES);
  if (sh.getLastRow() === 0) sh.appendRow(GUARANTOR_NOTICE_HEADERS);
  return sh;
}

// Guarantor memberNos linked to an issued loan (rows that consented, or legacy admin-issued rows)
function _loanGuarantorNos(loanId) {
  const id = String(loanId||'').trim();
  const { rows } = readSheet(SH_GUARANTORS, 'requestid');
  return [...new Set(rows
    .filter(r => String(r['LoanID']||'').trim() === id && String(r['Response']||'').trim() !== 'Declined')
    .map(r => String(r['GuarantorNo']||'').trim()).filter(Boolean))];
}

// Emails each guarantor of loanId at most once for ev.key.
// ev: { key, event, amount, date, balance, message, final }
// The email holds only what a guarantor needs: whose loan, what happened, the amount, the date and
// what is still owed (their exposure). The borrower's member number, references, the fee/interest/
// principal split and surcharge or fine reasons are not sent.
// Skipped while the loan is not running, unless ev.final (the clearing payment and the clearance notice).
// Email failures never block the transaction that triggered the notice. Returns the number sent.
function _notifyGuarantors(loanId, ev) {
  const id = String(loanId||'').trim();
  const loan = readSheet(SH_LOANS, 'loanid').rows.find(l => String(l['LoanID']||'').trim() === id);
  if (!loan) return 0;
  const c = _computeLoan(loan, readSheet(SH_REPAY, 'loanid').rows);
  if (c.status !== LOAN_STATUS.ACTIVE && !ev.final) return 0;
  const guarantors = _loanGuarantorNos(id);
  if (!guarantors.length) return 0;

  _guarantorNoticeSheet();
  const { sh, headers, rows } = readSheet(SH_GUARANTOR_NOTICES, 'event key');
  const sent = {};
  rows.forEach(r => { sent[String(r['Event Key']||'').trim() + '|' + String(r['GuarantorNo']||'').trim()] = true; });
  const { rows: members } = readSheet(SH_MEMBERS, 'memberno');
  const borrowerNo = String(loan['MemberNo']||'').trim();
  const borrower = _memberName(borrowerNo, members);
  const balance = ev.balance === undefined ? c.outstandingBalance : ev.balance;
  const table = [['Borrower', borrower], ['Loan ID', id], ['Event', ev.event]]
    .concat(ev.amount ? [['Amount', fmtUGX(ev.amount)]] : [])
    .concat([['Date', human_date(ev.date || today())], ['Remaining loan balance', fmtUGX(balance)]]);
  let count = 0;
  guarantors.forEach(g => {
    if (sent[ev.key + '|' + g]) return;
    const m = members.find(x => String(x['MemberNo']||'').trim() === g);
    const email = m ? String(m['Email']||'').trim() : '';
    if (email) _sendEmail(email, 'Guarantor notice: ' + ev.event + ' on ' + id, table,
      'Hello ' + (m['Full Name'] || g) + ', you guarantee this loan. ' + ev.message
      + ' This notice is for your information only; no action is needed and no money is paid to you.');
    else Logger.log('No email for guarantor ' + g + '; notice ' + ev.key + ' recorded without sending.');
    const row = headers.map(h => ({ 'timestamp': now_ts(), 'event key': ev.key, 'loanid': id, 'borrowerno': borrowerNo,
      'guarantorno': g, 'event': ev.event, 'amount (ugx)': ev.amount || '', 'transaction date': ev.date || today(),
      'remaining balance (ugx)': balance, 'sent to': email })[String(h).trim().toLowerCase()]);
    sh.appendRow(row.map(v => v === undefined ? '' : v));
    count++;
  });
  return count;
}

// Running loans of a borrower that have guarantors (Sec 7 allows only one at a time)
function _guaranteedLoansOf(memberNo) {
  const mNo = String(memberNo||'').trim();
  const { rows: loans } = readSheet(SH_LOANS, 'loanid');
  const { rows: reps } = readSheet(SH_REPAY, 'loanid');
  return loans.filter(l => String(l['MemberNo']||'').trim() === mNo && String(l['LoanID']||'').trim())
    .map(l => _computeLoan(l, reps)).filter(c => c.status === LOAN_STATUS.ACTIVE)
    .map(c => String(c.loanId).trim()).filter(id => _loanGuarantorNos(id).length);
}

// A charge or payment that belongs to the borrower rather than to one loan (fines, loan-related
// surcharges paid into savings): sent to the guarantors of the borrower's running guaranteed loan.
function _notifyGuarantorsOfBorrower(memberNo, ev) {
  return _guaranteedLoansOf(memberNo).reduce((n, id) => n + _notifyGuarantors(id, Object.assign({}, ev, { key: ev.key + '|' + id })), 0);
}

// After a repayment is recorded. wasActive: the loan was running before this payment.
function _notifyGuarantorsOfRepayment(loanId, reference, amount, date, updated, wasActive) {
  if (!wasActive) return;
  const key = reference || (loanId + '|' + now_ts() + '|' + amount);
  const cleared = updated.status === LOAN_STATUS.CLEARED;
  _notifyGuarantors(loanId, { key: 'repayment|' + key, event: 'Loan repayment', amount, date, balance: updated.outstandingBalance,
    final: true, message: 'The borrower has made a loan repayment.' });
  if (cleared)
    _notifyGuarantors(loanId, { key: 'cleared|' + loanId + '|' + key, event: 'Loan cleared', amount: 0, date, balance: 0, final: true,
      message: 'The loan is now fully cleared, and your guarantee has ended. You will receive no further notices about it.' });
}
