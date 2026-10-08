// ── SAVINGS ───────────────────────────────────────────────────────────────────

function getMySavings() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_SAVINGS, 'memberno');
  const history = rows
    .filter(r => String(r['MemberNo']||'').trim() === auth.member.memberNo)
    .map(r => ({ date: r['Date'], type: _pick(r,['Deposit Type','Type']), category: r['Payment Category']||'', surchargeReason: r['Surcharge Reason']||'', amount: num(r['Amount (UGX)']), reference: r['Reference']||'', notes: r['Notes']||'' }))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  return { ok: true, balance: _savingsBalance(auth.member.memberNo), history };
}

function recordSavings(memberNo, type, amount, category, surchargeReason, notes, txDate) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  type = String(type).trim();
  if (type !== 'Deposit' && type !== 'Withdrawal') return { ok: false, error: 'Type must be Deposit or Withdrawal.' };
  amount = num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const dv = validateTxDate(txDate); if (!dv.ok) return dv;
  category = String(category||'').trim();
  if (type === 'Deposit' && PAYMENT_CATEGORIES.indexOf(category) < 0) return { ok: false, error: 'Select the payment category for this deposit.' };
  surchargeReason = String(surchargeReason||'').trim();
  if (type === 'Deposit' && category === 'Surcharge' && SURCHARGE_REASONS.indexOf(surchargeReason) < 0) return { ok: false, error: 'Select the reason for this surcharge.' };
  const forMember = _memberByNo(memberNo);
  if (forMember && String(forMember['Membership Type']||'').trim() === 'Non-Member') return { ok: false, error: 'Non-Members do not use the savings/deposit function.' };
  if (type === 'Withdrawal') {
    const bal = _savingsBalance(memberNo);
    if (amount > bal) return { ok: false, error: 'Withdrawal exceeds balance (' + fmtUGX(bal) + ').' };
  }
  const reference = _addSavingsRow(memberNo, type, amount, auth.member.memberNo, notes, dv.date, type === 'Deposit' ? category : '', type === 'Deposit' && category === 'Surcharge' ? surchargeReason : '');
  const newBal = _savingsBalance(memberNo);
  const m = _memberByNo(memberNo);
  _sendEmail(m?.['Email'], type + ' Confirmation', [
    ['Member', (m?.['Full Name']||memberNo) + ' (' + memberNo + ')'],
    ['Type', type], ['Category', category || '-'], ['Amount', fmtUGX(amount)], ['New Balance', fmtUGX(newBal)],
    ['Reference', reference||'-'], ['Date', human_date(today())]
  ], type==='Deposit' ? 'Your savings have been updated.' : 'Your withdrawal has been recorded.');
  auditLog(type, memberNo, auth.member.memberNo,
    type + ' of ' + fmtUGX(amount) + '. New balance: ' + fmtUGX(newBal), reference||'');
  return { ok: true, newBalance: newBal };
}

// Admin view of deposits and withdrawals, filtered by member, type, payment category and date range.
// Dates are yyyy-MM-dd, so string comparison orders them correctly.
function getSavingsTransactions(filters) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const f = filters || {};
  const memberNo = String(f.memberNo || '').trim();
  const type = String(f.type || '').trim();
  const category = String(f.category || '').trim();
  const from = String(f.from || '').trim();
  const to = String(f.to || '').trim();
  const { rows } = readSheet(SH_SAVINGS, 'memberno');
  const { rows: members } = readSheet(SH_MEMBERS, 'memberno');
  const nameOf = {};
  members.forEach(m => { nameOf[String(m['MemberNo'] || '').trim()] = m['Full Name'] || ''; });
  let total = 0;
  const out = rows
    .filter(r => String(r['MemberNo'] || '').trim() !== '')
    .filter(r => !memberNo || String(r['MemberNo']).trim() === memberNo)
    .filter(r => !type || String(_pick(r, ['Deposit Type', 'Type'])).trim().toLowerCase() === type.toLowerCase())
    .filter(r => !category || String(r['Payment Category'] || '').trim() === category)
    .filter(r => !from || String(r['Date'] || '') >= from)
    .filter(r => !to || String(r['Date'] || '') <= to)
    .map(r => {
      const no = String(r['MemberNo']).trim();
      const amount = num(r['Amount (UGX)']);
      total += amount;
      return { date: String(r['Date'] || ''), member: no, name: nameOf[no] || '', type: String(_pick(r, ['Deposit Type', 'Type'])),
        category: String(r['Payment Category'] || ''), reference: String(r['Reference'] || ''), amount: amount };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { ok: true, rows: out, total: r2(total) };
}
