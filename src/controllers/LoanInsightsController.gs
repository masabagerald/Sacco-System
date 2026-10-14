// ── LOAN INSIGHTS & LOAN FUND LEDGER ──────────────────────────────────────────
// getLoanInsights: admins and Founder Members (aggregate figures only for Founders -- no loan,
// member or ledger detail). Everything else here is admin only.

// Dashboard date filter. Returns { ok, from, to } -- from '' means all time; to defaults to today and
// cannot be later than today (balances after today are not known yet).
function _validRange(filters) {
  const f = filters || {};
  const from = String(f.from || '').trim();
  let to = String(f.to || '').trim() || today();
  if (from && !_validYmd(from)) return { ok: false, error: 'Enter a valid start date.' };
  if (!_validYmd(to)) return { ok: false, error: 'Enter a valid end date.' };
  if (to > today()) to = today();
  if (from && from > to) return { ok: false, error: 'The start date must be on or before the end date (and not in the future).' };
  return { ok: true, from, to };
}

function getLoanInsights(filters) {
  const auth = _insightsCaller(); if (!auth.ok) return auth;
  const rg = _validRange(filters); if (!rg.ok) return rg;
  const admin = auth.level === 'admin';
  const res = _loanInsightsFromRows(_loanFundData(), rg.from, rg.to, today(), admin);
  return Object.assign({ ok: true, access: auth.level, allocationOrder: REPAYMENT_ALLOCATION_ORDER, generatedAt: now_ts() }, res);
}

// The cash movements behind "available loan cash", with a running balance (admin only)
function getLoanFundLedger(filters) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rg = _validRange(filters); if (!rg.ok) return rg;
  return Object.assign({ ok: true, from: rg.from, to: rg.to }, _loanFundLedgerFromRows(_loanFundData(), rg.from, rg.to, today()));
}

// Every Loan Fund Ledger entry, in any status, for the approvals list
function getLoanFundEntries() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return { ok: true, entries: _ledgerEntryList('fund'), types: FUND_MANUAL_TYPES, ready: !_readOptional(SH_LOAN_FUND, 'entryid').missing };
}

// Proposes a cash injection into, or another authorized outflow from, the loan fund. It counts once two
// different admins (neither the proposer) approve it. Principal savings, loans and repayments are never
// entered here -- they are read from their own sheets.
function proposeLoanFundEntry(type, amount, txDate, reference, description) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  type = String(type || '').trim();
  if (FUND_MANUAL_TYPES.indexOf(type) < 0) return { ok: false, error: 'Choose Cash Injection or Other Outflow. Transfers are recorded from the Investments page.' };
  amount = num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const dv = validateTxDate(txDate); if (!dv.ok) return dv;
  description = String(description || '').trim();
  if (!description) return { ok: false, error: type === 'Cash Injection' ? 'Describe where the money came from.' : 'Describe what the money was paid for.' };
  const fields = { Date: dv.date, 'Entry Type': type, 'Amount (UGX)': amount, Reference: String(reference || '').trim(), Description: description };
  return _withScriptLock(() => {
    const dup = _duplicateEntryError('fund', fields); if (dup) return { ok: false, error: dup };
    const cashErr = _fundCashError(fields, true); if (cashErr) return { ok: false, error: cashErr };
    const id = _appendLedgerEntriesLocked([{ ledger: 'fund', fields }], auth.member.memberNo, false)[0];
    auditLog('Loan Fund Entry Proposed', '', auth.member.memberNo,
      type + ' of ' + fmtUGX(amount) + ' dated ' + dv.date + (fields.Reference ? ', ref ' + fields.Reference : '') + '. ' + description + '. Needs two admin approvals.', id);
    _notifyAdmins('Loan fund entry awaiting approval: ' + id, [['Entry', id], ['Type', type], ['Amount', fmtUGX(amount)], ['Date', human_date(dv.date)],
      ['Description', description], ['Proposed by', auth.member.name + ' (' + auth.member.memberNo + ')']],
      'Two different admins, neither the proposer, must approve this entry before it counts.');
    return { ok: true, entryId: id };
  });
}

// Approve / reject / reverse an entry of either approval ledger (LF... loan fund, IT... investment)
function approveFinanceEntry(id) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return _withScriptLock(() => _approveLedgerEntryLocked(auth, String(id || '').trim()));
}

function rejectFinanceEntry(id, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  return _withScriptLock(() => _rejectLedgerEntryLocked(auth, String(id || '').trim(), String(reason).trim()));
}

function reverseFinanceEntry(id, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  return _withScriptLock(() => _proposeReversalLocked(auth, String(id || '').trim(), String(reason).trim()));
}
