// ── SAVINGS ───────────────────────────────────────────────────────────────────

function getMySavings() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_SAVINGS, 'memberno');
  const history = rows
    .filter(r => String(r['MemberNo']||'').trim() === auth.member.memberNo)
    .map(r => ({ date: r['Date'], type: r['Type'], amount: num(r['Amount (UGX)']), reference: r['Reference']||'', notes: r['Notes']||'' }))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  return { ok: true, balance: _savingsBalance(auth.member.memberNo), history };
}

function recordSavings(memberNo, type, amount, reference, notes) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  type = String(type).trim();
  if (type !== 'Deposit' && type !== 'Withdrawal') return { ok: false, error: 'Type must be Deposit or Withdrawal.' };
  amount = num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  if (type === 'Withdrawal') {
    const bal = _savingsBalance(memberNo);
    if (amount > bal) return { ok: false, error: 'Withdrawal exceeds balance (' + fmtUGX(bal) + ').' };
  }
  const { sh, headers, hRow } = readSheet(SH_SAVINGS, 'memberno');
  const row = emptyRow(sh, hRow, ci(headers,'memberno'));
  const s = (c,v) => { if(c>-1) sh.getRange(row,c+1).setValue(v); };
  s(ci(headers,'date'),today()); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'type'),type);
  s(ci(headers,'amount'),amount); s(ci(headers,'recorded'),auth.member.memberNo);
  s(ci(headers,'reference'),reference||''); s(ci(headers,'notes'),notes||'');
  const newBal = _savingsBalance(memberNo);
  const m = _memberByNo(memberNo);
  _sendEmail(m?.['Email'], type + ' Confirmation', [
    ['Member', (m?.['Full Name']||memberNo) + ' (' + memberNo + ')'],
    ['Type', type], ['Amount', fmtUGX(amount)], ['New Balance', fmtUGX(newBal)],
    ['Reference', reference||'-'], ['Date', today()]
  ], type==='Deposit' ? 'Your savings have been updated.' : 'Your withdrawal has been recorded.');
  auditLog(type, memberNo, auth.member.memberNo,
    type + ' of ' + fmtUGX(amount) + '. New balance: ' + fmtUGX(newBal), reference||'');
  return { ok: true, newBalance: newBal };
}
