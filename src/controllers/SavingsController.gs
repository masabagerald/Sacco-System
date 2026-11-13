// â”€â”€ SAVINGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getMySavings() {
  const auth = caller_(); if (!auth.ok) return auth;
  return mySavingsFor_(auth.member);
}

// The signed-in member's savings (the caller has checked who they are)
function mySavingsFor_(member) {
  if (member.membershipType === 'Non-Member') return { ok: false, nonMember: true, error: 'Non-Members do not use the savings/deposit function.' };
  const no = String(member.memberNo).trim();
  const { rows } = readSheet_(SH_SAVINGS, 'memberno');
  const history = rows
    .filter(r => String(r['MemberNo']||'').trim() === no)
    .map(r => ({ date: r['Date'], type: txType_(r), account: accountOf_(r), category: r['Payment Category']||'', surchargeReason: r['Surcharge Reason']||'', amount: num(r['Amount (UGX)']), reference: r['Reference']||'', notes: r['Notes']||'', reverses: r['Reverses']||'' }))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const accounts = accountBalancesFromRows_(rows, no);
  const { rows: reqs } = readSheet_(SH_WD_REQ, 'requestid');
  const available = {};
  DEPOSIT_ACCOUNTS.forEach(a => { available[a] = withdrawalAvailable_(rows, reqs, no, a); });
  return { ok: true, balance: accounts.total, accounts, contributions: contributionsFromRows_(rows, no), pooled: POOLED_ACCOUNTS,
    available, canWithdraw: canWithdraw_(member.membershipType), history };
}

// Admin records a deposit into, or a withdrawal from, one of a member's deposit accounts.
function recordSavings(memberNo, type, amount, account, category, surchargeReason, notes, txDate) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const v = validateContribution_({ type, amount, account, category, surchargeReason, notes, txDate }); if (!v.ok) return v;
  const tx = v.tx;
  memberNo = String(memberNo||'').trim();
  const m = memberByNo_(memberNo);
  if (!m) return { ok: false, error: 'Member not found.' };
  if (String(m['Membership Type']||'').trim() === 'Non-Member') return { ok: false, error: 'Non-Members do not use the savings/deposit function.' };
  const res = appendSavingsTxs_([Object.assign({ memberNo, recordedBy: auth.member.memberNo }, tx)]);
  if (!res.ok) return res;
  const reference = res.references[0];
  const bal = accountBalancesFromRows_(res.rows, memberNo);
  // Withdrawal emails never show savings balances (the member sees them after signing in)
  const isDeposit = tx.type === TX_DEPOSIT;
  sendEmail_(m['Email'], tx.type + ' Confirmation', [
    ['Member', (m['Full Name']||memberNo) + ' (' + memberNo + ')'],
    ['Type', tx.type], ['Account', tx.account], ['Category', tx.category || '-'], ['Amount', fmtUGX(tx.amount)]
  ].concat(isDeposit ? [[tx.account + ' balance', fmtUGX(bal[tx.account])], ['Total savings', fmtUGX(bal.total)]] : [])
   .concat([['Reference', reference], ['Date', human_date(tx.date)]]),
    isDeposit ? 'Your ' + tx.account + ' account has been updated.' : 'Your withdrawal has been recorded. Sign in to see your balance.');
  auditLog_(tx.type, memberNo, auth.member.memberNo,
    tx.type + ' of ' + fmtUGX(tx.amount) + ' (' + tx.account + ' account' + (tx.category ? ', ' + tx.category : '') + ', dated ' + tx.date + ')'
    + (tx.notes ? '. Note: ' + tx.notes : '') + '. New ' + tx.account + ' balance: ' + fmtUGX(bal[tx.account]) + '. Total savings: ' + fmtUGX(bal.total), reference);
  // A surcharge on an unpaid loan or its interest concerns the borrower's guarantors too
  if (tx.type === TX_DEPOSIT && tx.category === 'Surcharge' && /loan|interest/i.test(tx.surchargeReason || ''))
    notifyGuarantorsOfBorrower_(memberNo, { key: 'surcharge-paid|' + reference, event: 'Surcharge paid', amount: tx.amount, date: tx.date,
      message: 'The borrower has paid a surcharge.' });
  return { ok: true, reference, newBalance: bal.total, accountBalance: bal[tx.account] };
}

function savingsRowByRef_(rows, reference) {
  reference = String(reference||'').trim();
  return reference ? rows.find(r => String(r['Reference']||'').trim() === reference) || null : null;
}

// Cancels a deposit or withdrawal by adding a reversal row. The original row is kept unchanged.
function reverseSavingsTransaction(reference, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  reason = String(reason).trim(); reference = String(reference||'').trim();
  const orig = savingsRowByRef_(readSheet_(SH_SAVINGS, 'memberno').rows, reference);
  if (!orig) return { ok: false, error: 'Transaction ' + reference + ' was not found.' };
  const memberNo = String(orig['MemberNo']).trim(), account = accountOf_(orig), amount = num(orig['Amount (UGX)']);
  const origType = txType_(orig);
  const res = appendSavingsTxs_([{ memberNo, type: origType.toLowerCase() === 'withdrawal' ? TX_WITHDRAWAL_REVERSAL : TX_DEPOSIT_REVERSAL,
    amount, account, category: orig['Payment Category']||'', surchargeReason: orig['Surcharge Reason']||'', date: today(),
    notes: 'Reversal of ' + reference + ': ' + reason, recordedBy: auth.member.memberNo, reverses: reference }]);
  if (!res.ok) return res;
  const bal = accountBalancesFromRows_(res.rows, memberNo);
  const m = memberByNo_(memberNo);
  const wasWithdrawal = origType.toLowerCase() === 'withdrawal';  // withdrawal emails show no savings balances
  sendEmail_(m?.['Email'], 'Savings Transaction Reversed', [
    ['Reversed', origType + ' ' + reference], ['Account', account], ['Amount', fmtUGX(amount)], ['Reason', reason]
  ].concat(wasWithdrawal ? [] : [[account + ' balance', fmtUGX(bal[account])], ['Total savings', fmtUGX(bal.total)]])
   .concat([['Reference', res.references[0]]]), 'A transaction on your savings has been reversed.');
  auditLog_('Savings Reversal', memberNo, auth.member.memberNo,
    'Reversed ' + origType + ' ' + reference + ' of ' + fmtUGX(amount) + ' (' + account + ' account, dated ' + (orig['Date']||'-') + '). Reason: ' + reason
    + '. New ' + account + ' balance: ' + fmtUGX(bal[account]), res.references[0]);
  return { ok: true, reference: res.references[0], newBalance: bal.total };
}

// Corrects a recorded deposit. The original is reversed and the corrected deposit recorded in one
// step, so the ledger keeps both the original entry and the change.
function correctContribution(reference, amount, account, category, surchargeReason, txDate, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  reason = String(reason).trim(); reference = String(reference||'').trim();
  const orig = savingsRowByRef_(readSheet_(SH_SAVINGS, 'memberno').rows, reference);
  if (!orig) return { ok: false, error: 'Transaction ' + reference + ' was not found.' };
  if (txType_(orig).toLowerCase() !== 'deposit') return { ok: false, error: 'Only deposits can be corrected. Reverse a withdrawal instead.' };
  const origDate = String(orig['Date']||'');
  const v = validateContribution_({ type: TX_DEPOSIT, amount, account, category, surchargeReason,
    txDate: txDate || origDate, notes: 'Correction of ' + reference + ': ' + reason }); if (!v.ok) return v;
  const tx = v.tx;
  const before = { amount: num(orig['Amount (UGX)']), account: accountOf_(orig), category: String(orig['Payment Category']||''),
    surchargeReason: String(orig['Surcharge Reason']||''), date: origDate };
  if (tx.amount === before.amount && tx.account === before.account && tx.category === before.category
      && tx.surchargeReason === before.surchargeReason && tx.date === before.date)
    return { ok: false, error: 'Nothing to change: the corrected deposit matches the original.' };
  const memberNo = String(orig['MemberNo']).trim();
  const res = appendSavingsTxs_([
    { memberNo, type: TX_DEPOSIT_REVERSAL, amount: before.amount, account: before.account, category: before.category,
      surchargeReason: before.surchargeReason, date: today(), notes: 'Reversal of ' + reference + ' (corrected): ' + reason,
      recordedBy: auth.member.memberNo, reverses: reference },
    Object.assign({ memberNo, recordedBy: auth.member.memberNo }, tx)
  ]);
  if (!res.ok) return res;
  const reversalRef = res.references[0], newRef = res.references[1];
  const describe = d => fmtUGX(d.amount) + ' in ' + d.account + ' (' + (d.category||'-') + (d.surchargeReason ? ': ' + d.surchargeReason : '') + ', dated ' + d.date + ')';
  const bal = accountBalancesFromRows_(res.rows, memberNo);
  const m = memberByNo_(memberNo);
  sendEmail_(m?.['Email'], 'Contribution Corrected', [
    ['Original', reference + ': ' + describe(before)], ['Corrected', newRef + ': ' + describe(tx)], ['Reason', reason],
    ['Total savings', fmtUGX(bal.total)]
  ], 'A contribution on your account has been corrected.');
  auditLog_('Contribution Corrected', memberNo, auth.member.memberNo,
    reference + ' corrected. Before: ' + describe(before) + '. After: ' + describe(tx) + '. Reversal ' + reversalRef + ', replacement ' + newRef + '. Reason: ' + reason, newRef);
  return { ok: true, reversalRef, reference: newRef, newBalance: bal.total };
}

// Admin view of the savings ledger, filtered by member, type, account, payment category and date range.
// Dates are yyyy-MM-dd, so string comparison orders them correctly.
function getSavingsTransactions(filters) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const f = filters || {};
  const memberNo = String(f.memberNo || '').trim();
  const type = String(f.type || '').trim();
  const account = String(f.account || '').trim();
  const category = String(f.category || '').trim();
  const from = String(f.from || '').trim();
  const to = String(f.to || '').trim();
  const { rows } = readSheet_(SH_SAVINGS, 'memberno');
  const { rows: members } = readSheet_(SH_MEMBERS, 'memberno');
  const nameOf = {};
  members.forEach(m => { nameOf[String(m['MemberNo'] || '').trim()] = m['Full Name'] || ''; });
  const reversedBy = {};
  rows.forEach(r => { const o = String(r['Reverses'] || '').trim(); if (o) reversedBy[o] = String(r['Reference'] || ''); });
  let net = 0;
  const out = rows
    .filter(r => String(r['MemberNo'] || '').trim() !== '')
    .filter(r => !memberNo || String(r['MemberNo']).trim() === memberNo)
    .filter(r => !type || txType_(r).toLowerCase() === type.toLowerCase())
    .filter(r => !account || accountOf_(r) === account)
    .filter(r => !category || String(r['Payment Category'] || '').trim() === category)
    .filter(r => !from || String(r['Date'] || '') >= from)
    .filter(r => !to || String(r['Date'] || '') <= to)
    .map(r => {
      const no = String(r['MemberNo']).trim();
      const amount = num(r['Amount (UGX)']);
      const t = txType_(r), ref = String(r['Reference'] || '');
      net += txSign_(t) * amount;
      return { date: String(r['Date'] || ''), member: no, name: nameOf[no] || '', type: t, account: accountOf_(r),
        category: String(r['Payment Category'] || ''), surchargeReason: String(r['Surcharge Reason'] || ''), reference: ref,
        amount: amount, sign: txSign_(t), notes: String(r['Notes'] || ''), recordedBy: String(r['Recorded By'] || ''),
        reverses: String(r['Reverses'] || ''), reversedBy: reversedBy[ref] || '' };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { ok: true, rows: out, net: r2(net) };
}
