// ── SAVINGS BALANCE ────────────────────────────────────────────────────────────

function _savingsBalance(memberNo) {
  const { rows } = readSheet(SH_SAVINGS, 'memberno');
  let bal = 0;
  rows.forEach(r => {
    if (String(r['MemberNo']||'').trim() !== String(memberNo).trim()) return;
    const t = String(_pick(r,['Deposit Type','Type'])).trim().toLowerCase();
    if (t === 'deposit') bal += num(r['Amount (UGX)']);
    else if (t === 'withdrawal') bal -= num(r['Amount (UGX)']);
  });
  return r2(bal);
}

// Auto-generated savings reference: DEP-000001 for deposits, WDL-000001 for withdrawals.
function _nextSavingsRef(type) {
  const prefix = type === 'Deposit' ? 'DEP' : 'WDL';
  const { rows } = readSheet(SH_SAVINGS, 'memberno');
  let max = 0;
  rows.forEach(r => {
    const m = String(r['Reference']||'').trim().match(new RegExp('^' + prefix + '-([0-9]+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + String(max + 1).padStart(6, '0');
}

// Appends one savings row with an auto-generated reference. Returns the reference.
function _addSavingsRow(memberNo, type, amount, recordedBy, notes, txDate) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ref = _nextSavingsRef(type);
    const { sh, headers, hRow } = readSheet(SH_SAVINGS, 'memberno');
    const row = emptyRow(sh, hRow, ci(headers, 'memberno'));
    const s = (c, v) => { if (c > -1) sh.getRange(row, c + 1).setValue(v); };
    s(ci(headers,'date'), txDate || today()); s(ci(headers,'timestamp'), now_ts());
    s(ci(headers,'memberno'), memberNo);
    s(ci(headers,'deposit type') > -1 ? ci(headers,'deposit type') : ci(headers,'type'), type);
    s(ci(headers,'amount'), amount); s(ci(headers,'recorded'), recordedBy);
    s(ci(headers,'reference'), ref); s(ci(headers,'notes'), notes || '');
    return ref;
  } finally { lock.releaseLock(); }
}
