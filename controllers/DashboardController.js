// ── ADMIN DASHBOARD & AUDIT LOG VIEWER ────────────────────────────────────────

function getAdminDashboard() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows: members }  = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }    = readSheet(SH_LOANS,'loanid');
  const { rows: reps }     = readSheet(SH_REPAY,'loanid');
  const { rows: fines }    = readSheet(SH_FINES,'fineid');
  const { rows: loanReqs } = readSheet(SH_LOAN_REQ,'requestid');
  const { rows: wdReqs }   = readSheet(SH_WD_REQ,'requestid');
  const active = members.filter(m=>String(m['MemberNo']||'').trim()!=='');
  const totalSavings = active.reduce((s,m)=>s+_savingsBalance(m['MemberNo']),0);
  const computedLoans = loans.filter(l=>String(l['LoanID']||'').trim()!=='').map(l=>_computeLoan(l,reps));
  const activeLoans = computedLoans.filter(l=>l.status==='Active');
  const totalOutstanding = activeLoans.reduce((s,l)=>s+l.outstandingBalance,0);
  const overdueLoans = activeLoans.filter(l=>l.overdue);
  const unpaidFines = fines.filter(f=>String(f['FineID']||'').trim()!==''&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
  const pendingLoanReqs = loanReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&String(r['Status']||'').trim()==='Pending').length;
  const pendingWdReqs   = wdReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&String(r['Status']||'').trim()==='Pending').length;
  return { ok:true, totalMembers:active.length, totalSavings:r2(totalSavings),
    totalLoansOutstanding:r2(totalOutstanding), activeLoanCount:activeLoans.length,
    unpaidFinesTotal:r2(unpaidFines), pendingLoanRequests:pendingLoanReqs, pendingWithdrawalRequests:pendingWdReqs,
    overdueLoans:overdueLoans.map(l=>({loanId:l.loanId,memberNo:l.memberNo,
      memberName:(_memberByNo(l.memberNo)||{})['Full Name']||l.memberNo,
      outstandingBalance:l.outstandingBalance,monthsElapsed:l.monthsElapsed,term:l.term})) };
}

function getAuditLog(limit) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  limit = num(limit) || 100;
  const { rows } = readSheet(SH_AUDIT,'timestamp');
  const sorted = rows
    .map(r=>({timestamp:r['Timestamp'],action:r['Action'],member:r['Member (Affected)'],
      performedBy:r['Performed By'],details:r['Details'],refId:r['Reference ID']}))
    .sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
  return { ok:true, entries: sorted };
}
