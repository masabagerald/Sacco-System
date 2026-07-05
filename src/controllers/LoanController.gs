// ── LOANS ─────────────────────────────────────────────────────────────────────

function getMyLoans() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet(SH_REPAY,'loanid');
  const result = loans
    .filter(l => String(l['MemberNo']||'').trim()===auth.member.memberNo)
    .map(l => { const c=_computeLoan(l,reps); const p=_schedule(c.principal,c.monthlyRate,c.term); return {...c,...p}; });
  return { ok: true, loans: result };
}

function issueLoan(memberNo, principal, monthlyRate, termMonths, purpose, overrideReason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  principal=num(principal); monthlyRate=num(monthlyRate); termMonths=num(termMonths);
  const lv = validateLoanIssue(principal, monthlyRate); if (!lv.ok) return lv;
  const lc = _checkLimit(memberNo, principal);
  if (!lc.withinLimit && !String(overrideReason||'').trim())
    return {ok:false,error:'Exceeds loan-to-savings limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide an override reason to proceed.',limitCheck:lc};
  const newId = _createLoanRow(memberNo, principal, monthlyRate, termMonths, purpose, auth.member.memberNo, overrideReason);
  const m = _memberByNo(memberNo);
  const proj = _schedule(principal, monthlyRate, termMonths);
  _sendEmail(m?.['Email'],'Loan Issued: '+newId,[
    ['Loan ID',newId],['Principal',fmtUGX(principal)],['Monthly Rate',monthlyRate+'%'],
    ['Term',termMonths+' months'],['Est. Monthly Payment',fmtUGX(proj.monthlyPayment)],['Purpose',purpose||'-']
  ],'Your loan has been issued. The estimated monthly payment is a guide based on equal reducing-balance payments.');
  auditLog('Loan Issued', memberNo, auth.member.memberNo,
    'Principal: '+fmtUGX(principal)+', Rate: '+monthlyRate+'%, Term: '+termMonths+' months'+(overrideReason?' [OVERRIDE: '+overrideReason+']':''), newId);
  return { ok: true, loanId: newId };
}

function recordRepayment(loanId, amount, notes) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  amount = num(amount);
  const av = validateRepaymentAmount(amount); if (!av.ok) return av;
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const loan = loans.find(l => String(l['LoanID']||'').trim()===String(loanId).trim());
  if (!loan) return {ok:false,error:'Loan not found.'};
  const { sh, headers, hRow } = readSheet(SH_REPAY,'loanid');
  const row = emptyRow(sh, hRow, ci(headers,'loanid'));
  const s=(c,v)=>{if(c>-1) sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'date'),today()); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'loanid'),loanId); s(ci(headers,'memberno'),loan['MemberNo']);
  s(ci(headers,'amount'),amount); s(ci(headers,'recorded'),auth.member.memberNo);
  s(ci(headers,'notes'),notes||'');
  const { rows: reps2 } = readSheet(SH_REPAY,'loanid');
  const updated = _computeLoan(loan, reps2);
  if (updated.outstandingBalance<=0.5) _setLoanStatus(loanId,LOAN_STATUS.CLEARED);
  const m = _memberByNo(loan['MemberNo']);
  _sendEmail(m?.['Email'],'Repayment Received: '+loanId,[
    ['Loan ID',loanId],['Amount Paid',fmtUGX(amount)],
    ['New Outstanding',fmtUGX(updated.outstandingBalance)],['Status',updated.status]
  ], updated.status===LOAN_STATUS.CLEARED?'Congratulations — this loan is now fully cleared!':'Your repayment has been recorded. Thank you.');
  auditLog('Loan Repayment', loan['MemberNo'], auth.member.memberNo,
    'Repayment of '+fmtUGX(amount)+'. Outstanding: '+fmtUGX(updated.outstandingBalance), loanId);
  return { ok: true, loan: updated };
}
