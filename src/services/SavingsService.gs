// ── SAVINGS LEDGER ─────────────────────────────────────────────────────────────
// Every Savings row belongs to one deposit account (Principal, Operations, Welfare). Balances and
// dashboard totals are always derived from the rows, so they cannot drift from the ledger.
// The helpers that take `rows` are pure (no Sheet calls) so they can be tested directly.

function txType_(row) { return String(pick_(row, ['Deposit Type', 'Type'])).trim(); }

// +1 adds to the account balance, -1 takes from it, 0 for an unrecognised type
function txSign_(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'deposit': case 'withdrawal reversal': return 1;
    case 'withdrawal': case 'deposit reversal': return -1;
    default: return 0;
  }
}

// Account a payment category is filed under ('' if the category is unknown)
function categoryAccount_(category) {
  category = String(category || '').trim();
  return DEPOSIT_ACCOUNTS.find(a => ACCOUNT_CATEGORIES[a].indexOf(category) > -1) || '';
}

// Account of a ledger row. Rows saved before accounts existed are placed by payment category.
function accountOf_(row) {
  const a = String(row['Deposit Account'] || '').trim();
  if (DEPOSIT_ACCOUNTS.indexOf(a) > -1) return a;
  return categoryAccount_(row['Payment Category']) || 'Principal';
}

// { Principal, Operations, Welfare, total } for one member
function accountBalancesFromRows_(rows, memberNo) {
  const no = String(memberNo).trim();
  const b = {};
  DEPOSIT_ACCOUNTS.forEach(a => { b[a] = 0; });
  rows.forEach(r => {
    if (String(r['MemberNo'] || '').trim() !== no) return;
    const sign = txSign_(txType_(r)); if (!sign) return;
    b[accountOf_(r)] += sign * num(r['Amount (UGX)']);
  });
  DEPOSIT_ACCOUNTS.forEach(a => { b[a] = r2(b[a]); });
  b.total = r2(DEPOSIT_ACCOUNTS.reduce((s, a) => s + b[a], 0));
  return b;
}

// Every member's balances from one pass over the ledger: { memberNo: { Principal, Operations, Welfare, total } }.
// Same figures as accountBalancesFromRows_ for each member; use it instead of that in a loop over members.
function memberBalances_(rows) {
  const out = {};
  rows.forEach(r => {
    const no = String(r['MemberNo'] || '').trim(); if (!no) return;
    const sign = txSign_(txType_(r)); if (!sign) return;
    const b = out[no] || (out[no] = { Principal: 0, Operations: 0, Welfare: 0 });
    b[accountOf_(r)] += sign * num(r['Amount (UGX)']);
  });
  Object.keys(out).forEach(no => {
    const b = out[no];
    DEPOSIT_ACCOUNTS.forEach(a => { b[a] = r2(b[a]); });
    b.total = r2(DEPOSIT_ACCOUNTS.reduce((s, a) => s + b[a], 0));
  });
  return out;
}

// One member's balances from memberBalances_ (zero for a member with no ledger rows)
function balanceOf_(balances, memberNo) {
  const b = balances[String(memberNo == null ? '' : memberNo).trim()];
  if (b) return b;
  const z = { total: 0 }; DEPOSIT_ACCOUNTS.forEach(a => { z[a] = 0; });
  return z;
}

function accountBalances_(memberNo) {
  return accountBalancesFromRows_(readSheet_(SH_SAVINGS, 'memberno').rows, memberNo);
}

// Total across all three accounts (statements and member lists)
function savingsBalance_(memberNo) { return accountBalances_(memberNo).total; }

// A member's individual savings: their Principal balance. Used for loan limits, the guarantor
// savings rule and the 12-month saving rule. Operations and Welfare are club pools, not savings.
function principalBalance_(memberNo) { return accountBalances_(memberNo).Principal; }

function isPooled_(account) { return POOLED_ACCOUNTS.indexOf(account) > -1; }

// Club-wide balance of an account: every member's deposits less every withdrawal (with reversals)
// Club-wide balance of a pool (Operations, Welfare): every member's deposits less withdrawals, less the
// money invested from the pool (net of redemptions back into it; InvestmentService.gs)
function poolBalanceFromRows_(rows, account) {
  let bal = 0;
  rows.forEach(r => {
    if (!String(r['MemberNo'] || '').trim() || accountOf_(r) !== account) return;
    bal += txSign_(txType_(r)) * num(r['Amount (UGX)']);
  });
  return r2(bal - poolInvestmentFlows_(account).net);
}

// What a member has paid into each account: deposits less reversed deposits
function contributionsFromRows_(rows, memberNo) {
  const no = String(memberNo).trim();
  const c = {};
  DEPOSIT_ACCOUNTS.forEach(a => { c[a] = 0; });
  rows.forEach(r => {
    if (String(r['MemberNo'] || '').trim() !== no) return;
    const t = txType_(r).toLowerCase();
    if (t === 'deposit') c[accountOf_(r)] += num(r['Amount (UGX)']);
    else if (t === 'deposit reversal') c[accountOf_(r)] -= num(r['Amount (UGX)']);
  });
  DEPOSIT_ACCOUNTS.forEach(a => { c[a] = r2(c[a]); });
  return c;
}

// Dashboard figures per account. contributions = deposits less reversed deposits;
// withdrawals = withdrawals less reversed withdrawals; balance = contributions - withdrawals.
// month ('yyyy-MM') adds contributionsThisMonth. nameOf maps memberNo -> name.
function depositAccountSummary_(rows, nameOf, month) {
  const acc = {};
  DEPOSIT_ACCOUNTS.forEach(a => { acc[a] = { account: a, contributions: 0, withdrawals: 0, contributionsThisMonth: 0, members: {} }; });
  rows.forEach(r => {
    const no = String(r['MemberNo'] || '').trim(); if (!no) return;
    const t = txType_(r).toLowerCase(), amt = num(r['Amount (UGX)']);
    let c = 0, w = 0;
    if (t === 'deposit') c = amt; else if (t === 'deposit reversal') c = -amt;
    else if (t === 'withdrawal') w = amt; else if (t === 'withdrawal reversal') w = -amt;
    else return;
    const a = acc[accountOf_(r)];
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
    const inv = poolInvestmentFlows_(name);   // pools only: money invested from the pool, net of redemptions
    return { account: name, pooled: isPooled_(name), contributions: r2(a.contributions), withdrawals: r2(a.withdrawals),
      invested: inv.invested, redeemed: inv.redeemed,
      balance: r2(a.contributions - a.withdrawals - inv.net), contributionsThisMonth: r2(a.contributionsThisMonth), members };
  });
}

// Checks an admin's deposit/withdrawal entry. Returns { ok, tx } with cleaned values, or { ok:false, error }.
function validateContribution_(input) {
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
// may go below zero -- the member's own balance for Principal, the club-wide balance for the
// pooled accounts. Returns an error message, or '' when the batch is allowed.
function checkSavingsTxs_(rows, txs) {
  for (const tx of txs) {
    if (!tx.reverses) continue;
    const orig = rows.find(r => String(r['Reference'] || '').trim() === tx.reverses);
    if (!orig) return 'Transaction ' + tx.reverses + ' was not found.';
    const t = txType_(orig).toLowerCase();
    if (t !== 'deposit' && t !== 'withdrawal') return 'Only deposits and withdrawals can be reversed.';
    if (rows.some(r => String(r['Reverses'] || '').trim() === tx.reverses)) return 'Transaction ' + tx.reverses + ' has already been reversed.';
  }
  const delta = {};
  txs.forEach(tx => {
    const k = (isPooled_(tx.account) ? '' : tx.memberNo) + '|' + tx.account;
    delta[k] = (delta[k] || 0) + txSign_(tx.type) * num(tx.amount);
  });
  for (const k of Object.keys(delta)) {
    if (delta[k] >= 0) continue;
    const parts = k.split('|');
    const pooled = !parts[0];
    const bal = pooled ? poolBalanceFromRows_(rows, parts[1]) : accountBalancesFromRows_(rows, parts[0])[parts[1]];
    if (bal + delta[k] < -0.005)
      return 'Insufficient balance in the ' + (pooled ? 'club ' : '') + parts[1] + ' account (' + fmtUGX(bal) + ').';
  }
  return '';
}

// Auto-generated savings reference: DEP-000001, WDL-000001, REV-000001 (reversals).
function nextSavingsRef_(rows, type) {
  return nextRef_(type === TX_DEPOSIT ? 'deposit' : type === TX_WITHDRAWAL ? 'savingsOut' : 'reversal', rows.map(r => r['Reference']));
}

// Appends ledger rows under the script lock, re-checking the ledger rules against the latest rows
// first so two admins cannot overdraw an account at the same time. Rows are only ever appended.
// Each tx: { memberNo, type, amount, account, category, surchargeReason, date, notes, recordedBy, reverses }
// Returns { ok, references, rows } or { ok:false, error }. rows: the ledger including the new rows, so the
// caller can work out the new balances without reading the sheet again.
function appendSavingsTxs_(txs) { return withScriptLock_(() => appendSavingsTxsLocked_(txs)); }

// Same as appendSavingsTxs_, for callers that already hold the script lock.
function appendSavingsTxsLocked_(txs) {
  const rd = readSheet_(SH_SAVINGS, 'memberno');
  const { sh, headers, rows } = rd;
  if (ci(headers, 'payment category') < 0 || ci(headers, 'deposit account') < 0 || ci(headers, 'reverses') < 0)
    throw new Error('Savings sheet needs the Payment Category, Deposit Account and Reverses columns. Run setupGuaranteeSchema() once from the script editor.');
  const err = checkSavingsTxs_(rows, txs); if (err) return { ok: false, error: err };
  const nextRow = freeRowFinder_(rd, ci(headers, 'memberno'));
  const references = txs.map(tx => {
    const ref = nextSavingsRef_(rows, tx.type);
    writeCells_(sh, nextRow(), headers.length, [
      [ci(headers, 'date'), tx.date || today()], [ci(headers, 'timestamp'), now_ts()], [ci(headers, 'memberno'), tx.memberNo],
      [ci(headers, 'deposit type') > -1 ? ci(headers, 'deposit type') : ci(headers, 'type'), tx.type],
      [ci(headers, 'amount'), tx.amount], [ci(headers, 'recorded'), tx.recordedBy], [ci(headers, 'reference'), ref],
      [ci(headers, 'notes'), tx.notes || ''], [ci(headers, 'payment category'), tx.category || ''],
      [ci(headers, 'surcharge reason'), tx.surchargeReason || ''], [ci(headers, 'deposit account'), tx.account],
      [ci(headers, 'reverses'), tx.reverses || '']]);
    rows.push({ MemberNo: tx.memberNo, Reference: ref, 'Deposit Type': tx.type, 'Amount (UGX)': tx.amount,
      'Deposit Account': tx.account, 'Payment Category': tx.category || '', Reverses: tx.reverses || '' });
    return ref;
  });
  return { ok: true, references, rows };
}

// ── WITHDRAWAL RULES ──────────────────────────────────────────────────────────

function canWithdraw_(membershipType) {
  return WITHDRAWAL_MEMBERSHIP_TYPES.indexOf(String(membershipType || '').trim()) > -1;
}

// Account a withdrawal request draws on. Requests made before accounts existed draw on Principal.
function requestAccount_(req) {
  const a = String(req['Deposit Account'] || '').trim();
  return DEPOSIT_ACCOUNTS.indexOf(a) > -1 ? a : 'Principal';
}

// What a member can still request from an account, less requests already awaiting approval.
// Principal: the member's own balance less their open Principal requests.
// Pooled accounts: the club-wide balance less every member's open requests on that account --
// what the member personally contributed plays no part.
function withdrawalAvailable_(savRows, requests, memberNo, account) {
  const no = String(memberNo).trim();
  const pooled = isPooled_(account);
  const bal = pooled ? poolBalanceFromRows_(savRows, account) : accountBalancesFromRows_(savRows, no)[account];
  const pending = requests
    .filter(r => requestAccount_(r) === account && isOpenRequest_(r) && (pooled || String(r['MemberNo'] || '').trim() === no))
    .reduce((s, r) => s + num(r['Amount (UGX)']), 0)
    + (pooled ? poolInvestmentFlows_(account).pending : 0);   // investments from the pool awaiting approval
  return r2(bal - pending);
}
