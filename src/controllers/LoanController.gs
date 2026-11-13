// ── LOANS ─────────────────────────────────────────────────────────────────────

function getMyLoans() {
  const auth = caller_(); if (!auth.ok) return auth;
  return myLoansFor_(auth.member);
}

function myLoansFor_(member) {
  const { rows: loans } = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet_(SH_REPAY,'loanid');
  const result = loans
    .filter(l => String(l['MemberNo']||'').trim()===member.memberNo)
    .map(l => computeLoan_(l,reps));
  return { ok: true, loans: result };
}

// Every member's running loan, for the admin Loans page (where repayments are recorded)
function getActiveLoans() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { rows: loans } = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet_(SH_REPAY,'loanid');
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const byNo = {};
  members.forEach(m => { byNo[String(m['MemberNo']||'').trim()] = m; });
  const gByLoan = guarantorsByLoan_();
  const noticeSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_GUARANTOR_NOTICES);
  const notices = {};
  if (noticeSh) readSheet_(SH_GUARANTOR_NOTICES, 'event key').rows.forEach(n => {
    const id = String(n['LoanID']||'').trim(), ts = String(n['Timestamp']||'');
    const cur = notices[id] || (notices[id] = { count: 0, last: '' });
    cur.count++; if (ts > cur.last) cur.last = ts;
  });
  return { ok: true, loans: loans
    .filter(l => String(l['LoanID']||'').trim())
    .map(l => computeLoan_(l, reps))
    .filter(l => l.status === LOAN_STATUS.ACTIVE)
    .map(l => {
      const m = byNo[String(l.memberNo||'').trim()] || {};
      return { loanId: l.loanId, memberNo: l.memberNo, name: m['Full Name'] || '', membershipType: String(m['Membership Type']||''),
        dateIssued: l.dateIssued, dueDate: l.dueDate || '', principal: l.principal, totalDue: l.totalDue || 0, totalRepaid: l.totalRepaid,
        outstandingBalance: l.outstandingBalance, overdue: l.overdue, progressLabel: l.progressLabel,
        guarantors: (gByLoan[String(l.loanId).trim()] || []).map(g => Object.assign({ name: (byNo[g.memberNo] || {})['Full Name'] || g.memberNo }, g)),
        guarantorNotices: notices[String(l.loanId).trim()] || { count: 0, last: '' } };
    })
    .sort((a, b) => (b.overdue - a.overdue) || String(a.dueDate).localeCompare(String(b.dueDate))) };
}

// An admin proposing a loan on a member's behalf. This does NOT create the loan -- it creates a
// Pending request, exactly like a member's own request, that still needs two different admins
// (neither of them the proposer) to approve before the loan exists. Segregation of duties.
// guarantorOverride: reason for letting a member who is guaranteeing a running loan take one (Sec 8).
function issueLoan(memberNo, principal, purpose, guarantorNos, termInput, guarantorOverride) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  principal=num(principal);
  const lv = validateLoanIssue(principal); if (!lv.ok) return lv;
  return submitLoanRequest_(String(memberNo||'').trim(), auth.member.memberNo, auth.member.name + ' (admin)', principal, termInput, purpose, guarantorNos,
    String(guarantorOverride||'').trim());
}

// Breakdown shown on the Record Repayment form: each part of the loan (principal, interest, processing
// fee, any surcharge) with what was charged, paid so far, outstanding, and how `amount` paid on
// `txDate` would be applied. amount 0 shows the loan as it stands.
function getRepaymentPreview(loanId, amount, txDate) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  amount = r2(num(amount));
  if (amount < 0) return { ok: false, field: 'amount', error: 'The amount cannot be negative.' };
  const dv = validateTxDate(txDate); if (!dv.ok) return Object.assign({ field: 'date' }, dv);
  const loan = readSheet_(SH_LOANS,'loanid').rows.find(l => String(l['LoanID']||'').trim() === String(loanId||'').trim());
  if (!loan) return { ok: false, error: 'Loan not found.' };
  const m = memberByNo_(loan['MemberNo']);
  return Object.assign({ ok: true, memberName: m ? (m['Full Name'] || '') : '' },
    repaymentPreview_(loan, readSheet_(SH_REPAY,'loanid').rows, amount, dv.date));
}

// opts (from the Record Repayment form): { stateKey, allowOverpayment, confirmDuplicate } -- see
// repaymentCheckError_. The checks and the new row are made under one script lock, so two admins (or
// a double click) cannot both record against the same balance.
function recordRepayment(loanId, amount, notes, txDate, opts) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  amount = r2(num(amount));
  const av = validateRepaymentAmount(amount); if (!av.ok) return av;
  const dv = validateTxDate(txDate); if (!dv.ok) return dv;
  loanId = String(loanId||'').trim();
  const saved = withScriptLock_(() => {
    const loan = readSheet_(SH_LOANS,'loanid').rows.find(l => String(l['LoanID']||'').trim() === loanId);
    if (!loan) return {ok:false,error:'Loan not found.'};
    const repRd = readSheet_(SH_REPAY,'loanid'), reps = repRd.rows;
    const refused = repaymentCheckError_(loan, reps, amount, dv.date, opts); if (refused) return refused;
    const wasActive = computeLoan_(loan, reps).status === LOAN_STATUS.ACTIVE;
    const reference = appendRepaymentRow_({ date: dv.date, loanId, memberNo: loan['MemberNo'], amount,
      recordedBy: auth.member.memberNo, notes: notes||'' }, repRd);
    return { ok: true, loan, wasActive, reference };
  });
  if (!saved.ok) return saved;
  const { loan, wasActive, reference } = saved;
  const { rows: reps2 } = readSheet_(SH_REPAY,'loanid');
  const updated = computeLoan_(loan, reps2);
  // How this payment was applied, from the same split every report uses
  const alloc = reference ? loanBreakdown_(loan, reps2).allocations.find(a => a.ref === reference) || null : null;
  const allocation = alloc ? { fee: alloc.fee, interest: alloc.interest, penalty: alloc.penalty, principal: alloc.principal, overpaid: alloc.overpaid } : null;
  const splitText = allocation ? ' Applied: fee '+fmtUGX(allocation.fee)+', interest '+fmtUGX(allocation.interest)
    +(allocation.penalty?', surcharge/penalty '+fmtUGX(allocation.penalty):'')+', principal '+fmtUGX(allocation.principal)
    +(allocation.overpaid?', held as credit '+fmtUGX(allocation.overpaid):'')+'.' : '';
  if (updated.outstandingBalance<=0.5) setLoanStatus_(loanId,LOAN_STATUS.CLEARED);
  const m = memberByNo_(loan['MemberNo']);
  sendEmail_(m?.['Email'],'Repayment Received: '+loanId,[
    ['Loan ID',loanId],['Amount Paid',fmtUGX(amount)],
    ['New Outstanding',fmtUGX(updated.outstandingBalance)],['Status',updated.status]
  ].concat(reference?[['Reference',reference]]:[]), updated.status===LOAN_STATUS.CLEARED?'Congratulations — this loan is now fully cleared!':'Your repayment has been recorded. Thank you.');
  auditLog_('Loan Repayment', loan['MemberNo'], auth.member.memberNo,
    'Repayment of '+fmtUGX(amount)+(reference?' ('+reference+', dated '+dv.date+')':'')+'. Outstanding: '+fmtUGX(updated.outstandingBalance)+'.'+splitText, loanId);
  notifyGuarantorsOfRepayment_(loanId, reference, amount, dv.date, updated, wasActive);
  return { ok: true, loan: updated, reference, allocation };
}

// Cancels a recorded repayment by adding a reversal row (negative amount, linked by "Reverses").
// The original row is kept unchanged. Every balance that sums the repayment rows nets the two off.
// A loan that the repayment had cleared becomes Active again if money is now owed.
function reverseRepayment(reference, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  reference = String(reference||'').trim(); reason = String(reason).trim();
  const res = withScriptLock_(() => {
    const repRd = readSheet_(SH_REPAY,'loanid'), rows = repRd.rows;
    const err = repaymentReversalError_(rows, reference); if (err) return { ok: false, error: err };
    const orig = rows.find(r => String(r['Reference']||'').trim() === reference);
    const amount = num(pick_(orig,['Amount (UGX)','Total Amount Paid']));
    const ref = appendRepaymentRow_({ date: today(), loanId: String(orig['LoanID']).trim(), memberNo: orig['MemberNo'], amount: -amount,
      recordedBy: auth.member.memberNo, notes: 'Reversal of '+reference+': '+reason, reverses: reference }, repRd);
    return { ok: true, orig, amount, reference: ref };
  });
  if (!res.ok) return res;
  const loanId = String(res.orig['LoanID']).trim();
  const loan = readSheet_(SH_LOANS,'loanid').rows.find(l => String(l['LoanID']||'').trim() === loanId);
  let updated = null;
  if (loan) {
    updated = computeLoan_(Object.assign({}, loan, { Status: LOAN_STATUS.ACTIVE }), readSheet_(SH_REPAY,'loanid').rows);
    if (updated.outstandingBalance > 0.5 && String(loan['Status']||'').trim() === LOAN_STATUS.CLEARED) setLoanStatus_(loanId, LOAN_STATUS.ACTIVE);
  }
  const outstanding = updated ? updated.outstandingBalance : 0;
  const m = memberByNo_(res.orig['MemberNo']);
  sendEmail_(m?.['Email'],'Loan Repayment Reversed: '+loanId,[
    ['Loan ID',loanId],['Reversed',reference+' of '+fmtUGX(res.amount)+' dated '+dstr_(res.orig['Date'])],['Reason',reason],
    ['New Outstanding',fmtUGX(outstanding)],['Reference',res.reference]
  ],'A repayment recorded on your loan has been reversed. Please contact the treasurer if you have any questions.');
  auditLog_('Loan Repayment Reversed', res.orig['MemberNo'], auth.member.memberNo,
    'Reversed '+reference+' of '+fmtUGX(res.amount)+' (dated '+dstr_(res.orig['Date'])+') on '+loanId+' as '+res.reference+'. Reason: '+reason
    +'. Outstanding now: '+fmtUGX(outstanding), loanId);
  notifyGuarantors_(loanId, { key: 'reversal|' + res.reference, event: 'Repayment reversed', amount: res.amount, date: today(), balance: outstanding,
    message: "A repayment recorded on the borrower's loan has been reversed, so the balance has gone up again." });
  return { ok: true, reference: res.reference, outstandingBalance: outstanding };
}

// Every repayment and reversal, newest first, for the admin Repayments list
function getRepayments() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { headers, rows } = readSheet_(SH_REPAY,'loanid');
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const nameOf = {};
  members.forEach(m => { nameOf[String(m['MemberNo']||'').trim()] = m['Full Name'] || ''; });
  const reversedBy = {};
  rows.forEach(r => { const o = String(r['Reverses']||'').trim(); if (o) reversedBy[o] = String(r['Reference']||''); });
  return { ok: true, ready: ci(headers,'reference') > -1 && ci(headers,'reverses') > -1, repayments: rows
    .filter(r => String(r['LoanID']||'').trim())
    .map(r => {
      const ref = String(r['Reference']||'').trim(), no = String(r['MemberNo']||'').trim();
      return { reference: ref, date: dstr_(r['Date']), timestamp: String(r['Timestamp']||''), loanId: String(r['LoanID']).trim(),
        memberNo: no, name: nameOf[no] || '', amount: num(pick_(r,['Amount (UGX)','Total Amount Paid'])),
        notes: String(r['Notes']||''), recordedBy: String(r['Recorded By']||''),
        reverses: String(r['Reverses']||''), reversedBy: ref ? (reversedBy[ref] || '') : '' };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp)) };
}
