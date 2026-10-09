// ── SAVINGS LEDGER ─────────────────────────────────────────────────────────────
// Every Savings row belongs to one deposit account (Principal, Operations, Welfare). Balances and
// dashboard totals are always derived from the rows, so they cannot drift from the ledger.
// The helpers that take `rows` are pure (no Sheet calls) so they can be tested directly.

function _txType(row) { return String(_pick(row, ['Deposit Type', 'Type'])).trim(); }

// +1 adds to the account balance, -1 takes from it, 0 for an unrecognised type
function _txSign(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'deposit': case 'withdrawal reversal': return 1;
    case 'withdrawal': case 'deposit reversal': return -1;
    default: return 0;
  }
}

// Account a payment category is filed under ('' if the category is unknown)
function _categoryAccount(category) {
  category = String(category || '').trim();
  return DEPOSIT_ACCOUNTS.find(a => ACCOUNT_CATEGORIES[a].indexOf(category) > -1) || '';
}

// Account of a ledger row. Rows saved before accounts existed are placed by payment category.
function _accountOf(row) {
  const a = String(row['Deposit Account'] || '').trim();
  if (DEPOSIT_ACCOUNTS.indexOf(a) > -1) return a;
  return _categoryAccount(row['Payment Category']) || 'Principal';
}

// { Principal, Operations, Welfare, total } for one member
function _accountBalancesFromRows(rows, memberNo) {
  const no = String(memberNo).trim();
  const b = {};
  DEPOSIT_ACCOUNTS.forEach(a => { b[a] = 0; });
  rows.forEach(r => {
    if (String(r['MemberNo'] || '').trim() !== no) return;
    const sign = _txSign(_txType(r)); if (!sign) return;
    b[_accountOf(r)] += sign * num(r['Amount (UGX)']);
  });
  DEPOSIT_ACCOUNTS.forEach(a => { b[a] = r2(b[a]); });
  b.total = r2(DEPOSIT_ACCOUNTS.reduce((s, a) => s + b[a], 0));
  return b;
}

function _accountBalances(memberNo) {
  return _accountBalancesFromRows(readSheet(SH_SAVINGS, 'memberno').rows, memberNo);
}

// Total across all three accounts (used by loan limits, guarantor checks, statements)
function _savingsBalance(memberNo) { return _accountBalances(memberNo).total; }

// Dashboard figures per account. contributions = deposits less reversed deposits;
// withdrawals = withdrawals less reversed withdrawals; balance = contributions - withdrawals.
// month ('yyyy-MM') adds contributionsThisMonth. nameOf maps memberNo -> name.
function _depositAccountSummary(rows, nameOf, month) {
  const acc = {};
  DEPOSIT_ACCOUNTS.forEach(a => { acc[a] = { account: a, contributions: 0, withdrawals: 0, contributionsThisMonth: 0, members: {} }; });
  rows.forEach(r => {
    const no = String(r['MemberNo'] || '').trim(); if (!no) return;
    const t = _txType(r).toLowerCase(), amt = num(r['Amount (UGX)']);
    let c = 0, w = 0;
    if (t === 'deposit') c = amt; else if (t === 'deposit reversal') c = -amt;
    else if (t === 'withdrawal') w = amt; else if (t === 'withdrawal reversal') w = -amt;
    else return;
    const a = acc[_accountOf(r)];
    const m = a.members[no] || (a.members[no] = { memberNo: no, name: (nameOf || {})[no] || '', contributions: 0, withdrawals: 0 });
    a.contributions += c; a.withdrawals += w; m.contributions += c; m.withdrawals += w;
    if (month && String(r['Date'] || '').indexOf(month) === 0) a.contributionsThisMonth += c;
  });
  return DEPOSIT_ACCOUNTS.map(name => {
    const a = acc[name];
    const members = Object.keys(a.members).sort().map(k => {
      const m = a.members[k];
      return { memberNo: m.memberNo, name: m.name, contributions: r2(m.contributions), withdrawals: r2(m.withdrawals), balance: r2(m.contributions - m.withdrawals) };
    });
    return { account: name, contributions: r2(a.contributions), withdrawals: r2(a.withdrawals),
      balance: r2(a.contributions - a.withdrawals), contributionsThisMonth: r2(a.contributionsThisMonth), members };
  });
}

// Checks an admin's deposit/withdrawal entry. Returns { ok, tx } with cleaned values, or { ok:false, error }.
function _validateContribution(input) {
  const type = String(input.type || '').trim();
  if (type !== TX_DEPOSIT && type !== TX_WITHDRAWAL) return { ok: false, error: 'Type must be Deposit or Withdrawal.' };
  const amount = num(input.amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const dv = validateTxDate(input.txDate); if (!dv.ok) return dv;
  const account = String(input.account || '').trim();
  if (DEPOSIT_ACCOUNTS.indexOf(account) < 0) return { ok: false, error: 'Select the deposit account (Principal, Operations or Welfare).' };
  let category = '', surchargeReason = '';
  if (type === TX_DEPOSIT) {
    category = String(input.category || '').trim();
    if (PAYMENT_CATEGORIES.indexOf(category) < 0) return { ok: false, error: 'Select the payment category for this deposit.' };
    if (ACCOUNT_CATEGORIES[account].indexOf(category) < 0) return { ok: false, error: category + ' cannot be filed under the ' + account + ' account.' };
    if (category === 'Surcharge') {
      surchargeReason = String(input.surchargeReason || '').trim();
      if (SURCHARGE_REASONS.indexOf(surchargeReason) < 0) return { ok: false, error: 'Select the reason for this surcharge.' };
    }
  }
  return { ok: true, tx: { type, amount, account, category, surchargeReason, date: dv.date, notes: String(input.notes || '').trim() } };
}

// Ledger rules for a batch of new rows, checked against the current rows: a deposit or withdrawal
// can be reversed once, a reversal cannot be reversed, and no account the batch takes money from
// may go below zero. Returns an error message, or '' when the batch is allowed.
function _checkSavingsTxs(rows, txs) {
  for (const tx of txs) {
    if (!tx.reverses) continue;
    const orig = rows.find(r => String(r['Reference'] || '').trim() === tx.reverses);
    if (!orig) return 'Transaction ' + tx.reverses + ' was not found.';
    const t = _txType(orig).toLowerCase();
    if (t !== 'deposit' && t !== 'withdrawal') return 'Only deposits and withdrawals can be reversed.';
    if (rows.some(r => String(r['Reverses'] || '').trim() === tx.reverses)) return 'Transaction ' + tx.reverses + ' has already been reversed.';
  }
  const delta = {};
  txs.forEach(tx => { const k = tx.memberNo + '|' + tx.account; delta[k] = (delta[k] || 0) + _txSign(tx.type) * num(tx.amount); });
  for (const k of Object.keys(delta)) {
    if (delta[k] >= 0) continue;
    const parts = k.split('|');
    const bal = _accountBalancesFromRows(rows, parts[0])[parts[1]];
    if (bal + delta[k] < -0.005) return 'Insufficient balance in the ' + parts[1] + ' account (' + fmtUGX(bal) + ').';
  }
  return '';
}

// Auto-generated savings reference: DEP-000001, WDL-000001, REV-000001 (reversals).
function _nextSavingsRef(rows, type) {
  const prefix = type === TX_DEPOSIT ? 'DEP' : type === TX_WITHDRAWAL ? 'WDL' : 'REV';
  let max = 0;
  rows.forEach(r => {
    const m = String(r['Reference'] || '').trim().match(new RegExp('^' + prefix + '-([0-9]+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + String(max + 1).padStart(6, '0');
}

// Appends ledger rows under the script lock, re-checking the ledger rules against the latest rows
// first so two admins cannot overdraw an account at the same time. Rows are only ever appended.
// Each tx: { memberNo, type, amount, account, category, surchargeReason, date, notes, recordedBy, reverses }
// Returns { ok, references } or { ok:false, error }.
function _appendSavingsTxs(txs) { return _withScriptLock(() => _appendSavingsTxsLocked(txs)); }

// Same as _appendSavingsTxs, for callers that already hold the script lock.
function _appendSavingsTxsLocked(txs) {
  const { sh, headers, hRow, rows } = readSheet(SH_SAVINGS, 'memberno');
  if (ci(headers, 'payment category') < 0 || ci(headers, 'deposit account') < 0 || ci(headers, 'reverses') < 0)
    throw new Error('Savings sheet needs the Payment Category, Deposit Account and Reverses columns. Run setupGuaranteeSchema() once from the script editor.');
  const err = _checkSavingsTxs(rows, txs); if (err) return { ok: false, error: err };
  const references = txs.map(tx => {
    const ref = _nextSavingsRef(rows, tx.type);
    const row = emptyRow(sh, hRow, ci(headers, 'memberno'));
    const s = (c, v) => { if (c > -1) sh.getRange(row, c + 1).setValue(v); };
    s(ci(headers, 'date'), tx.date || today()); s(ci(headers, 'timestamp'), now_ts());
    s(ci(headers, 'memberno'), tx.memberNo);
    s(ci(headers, 'deposit type') > -1 ? ci(headers, 'deposit type') : ci(headers, 'type'), tx.type);
    s(ci(headers, 'amount'), tx.amount); s(ci(headers, 'recorded'), tx.recordedBy);
    s(ci(headers, 'reference'), ref); s(ci(headers, 'notes'), tx.notes || '');
    s(ci(headers, 'payment category'), tx.category || '');
    s(ci(headers, 'surcharge reason'), tx.surchargeReason || '');
    s(ci(headers, 'deposit account'), tx.account);
    s(ci(headers, 'reverses'), tx.reverses || '');
    rows.push({ MemberNo: tx.memberNo, Reference: ref, 'Deposit Type': tx.type, 'Amount (UGX)': tx.amount,
      'Deposit Account': tx.account, 'Payment Category': tx.category || '', Reverses: tx.reverses || '' });
    return ref;
  });
  return { ok: true, references };
}

// ── WITHDRAWAL RULES ──────────────────────────────────────────────────────────

function _canWithdraw(membershipType) {
  return WITHDRAWAL_MEMBERSHIP_TYPES.indexOf(String(membershipType || '').trim()) > -1;
}

// Account a withdrawal request draws on. Requests made before accounts existed draw on Principal.
function _requestAccount(req) {
  const a = String(req['Deposit Account'] || '').trim();
  return DEPOSIT_ACCOUNTS.indexOf(a) > -1 ? a : 'Principal';
}

function _isOpenRequest(req) {
  const st = String(req['Status'] || '').trim();
  return st === 'Pending' || st === 'Partially Approved';
}

// What a member can still request from an account: its balance less requests awaiting approval.
function _withdrawalAvailable(balances, requests, memberNo, account) {
  const no = String(memberNo).trim();
  const pending = requests
    .filter(r => String(r['MemberNo'] || '').trim() === no && _requestAccount(r) === account && _isOpenRequest(r))
    .reduce((s, r) => s + num(r['Amount (UGX)']), 0);
  return r2(balances[account] - pending);
}

// Segregation of duties: an admin may not approve a withdrawal they initiated, one paid from their
// own account, or give both approvals. Returns an error message, or '' when approverNo may approve.
function _withdrawalApprovalError(req, approverNo) {
  if (!_isOpenRequest(req)) return 'Already decided.';
  const me = String(approverNo || '').trim();
  const member = String(req['MemberNo'] || '').trim();
  const initiatedBy = String(req['Initiated By'] || member).trim();
  if (me === initiatedBy) return 'You initiated this request; a different admin must approve it.';
  if (me === member) return 'This withdrawal is from your own account; a different admin must approve it.';
  if (me === String(req['Approver 1'] || '').trim()) return 'You already gave the first approval; a different admin must give the second.';
  return '';
}
