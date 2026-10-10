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

// An admin proposing a loan on a member's behalf. This does NOT create the loan -- it creates a
// Pending request, exactly like a member's own request, that still needs two different admins
// (neither of them the proposer) to approve before the loan exists. Segregation of duties.
// guarantorOverride: reason for letting a member who is guaranteeing a running loan take one (Sec 8).
function issueLoan(memberNo, principal, purpose, guarantorNos, termInput, guarantorOverride) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  principal=num(principal);
  const lv = validateLoanIssue(principal); if (!lv.ok) return lv;
  return _submitLoanRequest(String(memberNo||'').trim(), auth.member.memberNo, auth.member.name + ' (admin)', principal, termInput, purpose, guarantorNos,
    String(guarantorOverride||'').trim());
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
