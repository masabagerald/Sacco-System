// ── LOAN REPAYMENT ROWS ───────────────────────────────────────────────────────
// Loan Repayments rows are only ever appended. Each has a reference (RPY-000001, ...). A reversal is
// a row with the negative amount and "Reverses" set to the original's reference, so every total that
// sums the rows (loan balances, dashboard, statements, Loan Insights) nets the pair off.

function _nextRepaymentRef(rows) { return _nextRef('repayment', rows.map(r => r['Reference'])); }

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

// ── REPAYMENT BREAKDOWN (Record Repayment screen) ─────────────────────────────
// Shows an admin, before saving, what is owed on each part of the loan and how a payment would be
// applied. Nothing new is stored: a repayment is still one total, and the split is worked out by
// _loanBreakdown / _allocateRepayments (the same split Loan Insights and guarantor reports use), in
// REPAYMENT_ALLOCATION_ORDER. The admin cannot choose a different split: that would be a new policy.
// The processing fee is one charge made when the loan is issued, so it can never be collected twice.

const REPAYMENT_PARTS = ['principal', 'interest', 'fee', 'penalty'];  // display order
const REPAYMENT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;  // same loan, amount and date this recently: likely a double entry

function _loanRepaymentRows(reps, loanId) {
  const id = String(loanId||'').trim();
  return reps.filter(r => String(r['LoanID']||'').trim() === id);
}

// Charged and paid so far for each part, and the credit held on the loan (negative: a reversal took
// back credit that had already been used, so it is owed again)
function _partTotals(b) {
  const parts = {};
  REPAYMENT_PARTS.forEach(p => { parts[p] = { charged: 0, paid: 0 }; });
  b.charges.forEach(ch => { parts[ch.part].charged = r2(parts[ch.part].charged + ch.amount); });
  b.allocations.forEach(a => REPAYMENT_PARTS.forEach(p => { parts[p].paid = r2(parts[p].paid + (a[p] || 0)); }));
  return { parts, credit: r2(b.allocations.reduce((s, a) => s + a.overpaid, 0)) };
}

// Changes whenever anything that moves the balance changes (a repayment, a reversal, a surcharge), so
// a save made from an out-of-date breakdown is refused rather than silently applied.
function _repaymentStateKey(loan, reps) {
  const mine = _loanRepaymentRows(reps, loan['LoanID']);
  const cash = mine.reduce((s, r) => s + num(_pick(r, ['Amount (UGX)', 'Total Amount Paid'])), 0);
  return [mine.length, r2(cash), r2(_computeLoan(loan, reps).outstandingBalance)].join('|');
}

// Repayments on this loan, not reversed, with the same amount and payment date
function _similarRepayments(reps, loanId, amount, date) {
  const reversed = {};
  reps.forEach(r => { const o = String(r['Reverses']||'').trim(); if (o) reversed[o] = true; });
  return _loanRepaymentRows(reps, loanId)
    .filter(r => !String(r['Reverses']||'').trim() && !reversed[String(r['Reference']||'').trim()]
      && _dstr(r['Date']) === date && Math.abs(num(_pick(r, ['Amount (UGX)', 'Total Amount Paid'])) - amount) < 0.005)
    .map(r => ({ reference: String(r['Reference']||''), date, amount: r2(amount), timestamp: String(r['Timestamp']||''), recordedBy: String(r['Recorded By']||'') }));
}

// Breakdown of the loan before and after a payment of `amount` dated `date` ('yyyy-MM-dd').
// "This payment" for each part is the difference the payment makes to what has been paid on that part,
// so before - this payment = after, whatever the payment date. Anything left over is held as credit.
function _repaymentPreview(loan, reps, amount, date) {
  amount = r2(num(amount));
  const before = _loanBreakdown(loan, reps), cBefore = _computeLoan(loan, reps);
  let after = before, cAfter = cBefore;
  if (amount > 0) {
    const hyp = { LoanID: before.loanId, MemberNo: loan['MemberNo'], Date: date, 'Amount (UGX)': amount, Reference: 'PREVIEW', _row: 1e9 };
    after = _loanBreakdown(loan, reps.concat([hyp]));
    cAfter = _computeLoan(loan, reps.concat([hyp]));
  }
  const tb = _partTotals(before), ta = _partTotals(after);
  const label = { principal: 'Principal', interest: 'Interest', fee: 'Processing fee',
    penalty: cBefore.model === 'flat' ? 'Late penalty' : 'Overdue surcharge' };
  const components = REPAYMENT_PARTS
    .filter(p => p !== 'penalty' || tb.parts.penalty.charged > 0 || ta.parts.penalty.charged > 0)
    .map(p => {
      const b = tb.parts[p], a = ta.parts[p];
      const outBefore = r2(b.charged - b.paid), outAfter = r2(a.charged - a.paid);
      const status = b.charged <= 0 && a.charged <= 0 ? 'Not applicable'
        : outBefore <= 0 ? 'Already paid' : outAfter <= 0 ? 'Settled by this payment' : 'Outstanding';
      return { part: p, label: label[p], charged: b.charged, paidBefore: b.paid, outstandingBefore: outBefore,
        allocated: r2(a.paid - b.paid), balanceAfter: outAfter, status,
        chargeChanged: Math.abs(a.charged - b.charged) > 0.004 };
    });
  const allocatedToParts = r2(components.reduce((s, c) => s + c.allocated, 0));
  const credit = { before: tb.credit, allocated: r2(amount - allocatedToParts), after: ta.credit };
  const sumOut = (t, cs) => r2(cs.reduce((s, c) => s + (t === 'before' ? c.outstandingBefore : c.balanceAfter), 0));
  // Part balances less credit must equal the loan's outstanding balance (rounding allowed)
  const reconciles = Math.abs(Math.max(0, sumOut('before', components) - tb.credit) - cBefore.outstandingBalance) <= 1
    && Math.abs(Math.max(0, sumOut('after', components) - ta.credit) - cAfter.outstandingBalance) <= 1;
  return {
    loanId: before.loanId, memberNo: before.memberNo, model: cBefore.model, status: cBefore.status, date, amount,
    allocationOrder: REPAYMENT_ALLOCATION_ORDER.slice(),
    components, credit,
    totals: { outstandingBefore: r2(cBefore.outstandingBalance), amount, outstandingAfter: r2(cAfter.outstandingBalance) },
    overpayment: r2(amount - cBefore.outstandingBalance) > 0.5 ? r2(amount - cBefore.outstandingBalance) : 0,
    similar: amount > 0 ? _similarRepayments(reps, before.loanId, amount, date) : [],
    chargeChanged: components.some(c => c.chargeChanged),
    reconciles, stateKey: _repaymentStateKey(loan, reps)
  };
}

// Checks a repayment about to be saved, against the sheet as it is now (caller holds the script lock).
// opts: { stateKey, allowOverpayment, confirmDuplicate }. Returns null, or a refusal with a `code`
// ('stale' / 'overpayment' / 'duplicate') and the current breakdown for the form to show.
function _repaymentCheckError(loan, reps, amount, date, opts) {
  opts = opts || {};
  const p = _repaymentPreview(loan, reps, amount, date);
  if (opts.stateKey && String(opts.stateKey) !== p.stateKey)
    return { ok: false, code: 'stale', preview: p,
      error: 'This loan changed after the breakdown was shown (a repayment, reversal or charge was recorded). Check the updated breakdown and save again.' };
  // Club rule: an overpayment is held as a credit on the loan. It is accepted only when the admin says so.
  if (p.overpayment > 0 && opts.allowOverpayment !== true)
    return { ok: false, code: 'overpayment', preview: p,
      error: fmtUGX(amount) + ' is ' + fmtUGX(p.overpayment) + ' more than the ' + fmtUGX(p.totals.outstandingBefore) + ' outstanding. Confirm that the excess should be held as credit on the loan, or correct the amount.' };
  const now = Date.now();
  const recent = p.similar.filter(s => {
    const t = new Date(String(s.timestamp).trim().replace(' ', 'T')).getTime();
    return !isNaN(t) && now - t >= 0 && now - t < REPAYMENT_DUPLICATE_WINDOW_MS;
  });
  if (recent.length && opts.confirmDuplicate !== true)
    return { ok: false, code: 'duplicate', preview: p,
      error: 'A repayment of ' + fmtUGX(amount) + ' dated ' + human_date(date) + ' was recorded on this loan a few minutes ago (' + (recent[0].reference || 'no reference') + '). If this is a separate payment, confirm and save again.' };
  return null;
}
