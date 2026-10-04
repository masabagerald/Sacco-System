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
