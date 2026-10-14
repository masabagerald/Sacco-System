// ── LOAN REPAYMENT ROWS ───────────────────────────────────────────────────────
// Loan Repayments rows are only ever appended. Each has a reference (RPY-000001, ...). A reversal is
// a row with the negative amount and "Reverses" set to the original's reference, so every total that
// sums the rows (loan balances, dashboard, statements, Loan Insights) nets the pair off.

function _nextRepaymentRef(rows) {
  let max = 0;
  rows.forEach(r => { const m = String(r['Reference']||'').trim().match(/^RPY-([0-9]+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'RPY-' + String(max + 1).padStart(6, '0');
}

// Appends one row. tx: { date, loanId, memberNo, amount, recordedBy, notes, reverses }. Caller holds the
// script lock. Returns the new reference ('' on a sheet that has no Reference column yet).
function _appendRepaymentRow(tx) {
  const { sh, headers, hRow, rows } = readSheet(SH_REPAY,'loanid');
  const hasRef = ci(headers,'reference') > -1;
  if (tx.reverses && (!hasRef || ci(headers,'reverses') < 0))
    throw new Error('Loan Repayments needs the Reference and Reverses columns. Run setupFinanceSchema() once from the script editor.');
  const ref = hasRef ? _nextRepaymentRef(rows) : '';
  const row = emptyRow(sh, hRow, ci(headers,'loanid'));
  const s = (c,v) => { if (c > -1) sh.getRange(row, c+1).setValue(v); };
  s(ci(headers,'date'), tx.date); s(ci(headers,'timestamp'), now_ts());
  s(ci(headers,'loanid'), tx.loanId); s(ci(headers,'memberno'), tx.memberNo);
  s(ci(headers,'amount'), tx.amount); s(ci(headers,'total amount'), tx.amount); s(ci(headers,'recorded'), tx.recordedBy);
  s(ci(headers,'notes'), tx.notes || '');
  s(ci(headers,'reference'), ref); s(ci(headers,'reverses'), tx.reverses || '');
  return ref;
}

// A repayment can be reversed once; a reversal cannot be reversed. Returns an error message, or ''.
function _repaymentReversalError(rows, reference) {
  if (!reference) return 'Choose the repayment to reverse.';
  const orig = rows.find(r => String(r['Reference']||'').trim() === reference);
  if (!orig) return 'Repayment ' + reference + ' was not found.';
  if (String(orig['Reverses']||'').trim() || num(_pick(orig,['Amount (UGX)','Total Amount Paid'])) <= 0) return 'A reversal cannot itself be reversed.';
  if (rows.some(r => String(r['Reverses']||'').trim() === reference)) return 'Repayment ' + reference + ' has already been reversed.';
  return '';
}

// Setup (run by setupFinanceSchema): adds the Reference and Reverses columns to Loan Repayments and
// gives every existing repayment a reference, in date order, so it can be reversed. Only blank
// Reference cells are filled; amounts, dates and every other cell are left exactly as they are.
function _setupRepaymentReferences() {
  const { sh, hRow } = readSheet(SH_REPAY, 'loanid');
  if (hRow < 0) throw new Error('Could not find the header row on the ' + SH_REPAY + ' tab.');
  ['Reference', 'Reverses'].forEach(name => {
    const hdr = sh.getRange(hRow + 1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
    if (!hdr.some(h => h.startsWith(name.toLowerCase()))) sh.getRange(hRow + 1, sh.getLastColumn() + 1).setValue(name);
  });
  const { headers, rows } = readSheet(SH_REPAY, 'loanid');
  const cRef = ci(headers, 'reference');
  const blank = rows.filter(r => String(r['LoanID']||'').trim() && !String(r['Reference']||'').trim())
    .sort((a, b) => _dstr(a['Date']).localeCompare(_dstr(b['Date'])) || a._row - b._row);
  blank.forEach(r => {
    const ref = _nextRepaymentRef(rows);
    sh.getRange(r._row, cRef + 1).setValue(ref);
    r['Reference'] = ref;
  });
  if (blank.length) auditLog('Repayment References Assigned', '', 'System',
    blank.length + ' existing repayment(s) given references ' + blank[0]['Reference'] + ' to ' + blank[blank.length - 1]['Reference'] + '. No amounts or dates changed.', '');
}
