// ── LOANS ─────────────────────────────────────────────────────────────────────

function getMyLoans() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet(SH_REPAY,'loanid');
  const result = loans
    .filter(l => String(l['MemberNo']||'').trim()===auth.member.memberNo)
    .map(l => _computeLoan(l,reps));
  return { ok: true, loans: result };
}

// Direct issue by an admin. Same rules as a request: eligibility, guarantors, term, savings cap (override allowed).
function issueLoan(memberNo, principal, purpose, overrideReason, guarantorNos, termKey) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  principal=num(principal);
  const lv = validateLoanIssue(principal); if (!lv.ok) return lv;
  const termDef = _termByKey(termKey); if (!termDef) return {ok:false,error:'Choose a repayment term.'};
  const el = _loanEligibility(memberNo); if (!el.ok) return el;
  const gc = _guarantorChecks(memberNo, principal, guarantorNos, ''); if (!gc.ok) return gc;
  const lc = _checkLimit(memberNo, principal);
  if (!lc.withinLimit && !String(overrideReason||'').trim())
    return {ok:false,error:'Exceeds loan-to-savings limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide an override reason to proceed.',limitCheck:lc};
  const newId = _createLoanRow(memberNo, principal, purpose, auth.member.memberNo, overrideReason, termDef);
  _appendGuarantors('', newId, memberNo, gc.guarantors);
  const m = _memberByNo(memberNo);
  const t = _termTerms(principal, termDef);
  _sendEmail(m?.['Email'],'Loan Issued: '+newId,[
    ['Loan ID',newId],['Principal',fmtUGX(principal)],['Interest ('+r2(termDef.rate*100)+'%)',fmtUGX(t.interest)],
    ['Processing fee',fmtUGX(t.fee)],['Total to repay',fmtUGX(t.total)],
    ['Due date',fmt_date(_addDays(new Date(), termDef.days))],['Purpose',purpose||'-']
  ],'Your loan has been issued. The full amount is due on the due date shown.');
  auditLog('Loan Issued', memberNo, auth.member.memberNo,
    'Principal: '+fmtUGX(principal)+' over '+termDef.label+' at '+r2(termDef.rate*100)+'%, fee '+fmtUGX(PROCESSING_FEE)+', guarantors: '+gc.guarantors.join(', ')+(overrideReason?' [OVERRIDE: '+overrideReason+']':''), newId);
  return { ok: true, loanId: newId };
}

function recordRepayment(loanId, amount, notes, txDate) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  amount = num(amount);
  const av = validateRepaymentAmount(amount); if (!av.ok) return av;
  const dv = validateTxDate(txDate); if (!dv.ok) return dv;
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const loan = loans.find(l => String(l['LoanID']||'').trim()===String(loanId).trim());
  if (!loan) return {ok:false,error:'Loan not found.'};
  const { sh, headers, hRow } = readSheet(SH_REPAY,'loanid');
  const row = emptyRow(sh, hRow, ci(headers,'loanid'));
  const s=(c,v)=>{if(c>-1) sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'date'),dv.date); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'loanid'),loanId); s(ci(headers,'memberno'),loan['MemberNo']);
  s(ci(headers,'amount'),amount); s(ci(headers,'total amount'),amount); s(ci(headers,'recorded'),auth.member.memberNo);
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
