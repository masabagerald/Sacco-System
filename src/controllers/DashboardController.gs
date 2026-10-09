// ── ADMIN DASHBOARD & AUDIT LOG VIEWER ────────────────────────────────────────

function getAdminDashboard() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows: members }  = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }    = readSheet(SH_LOANS,'loanid');
  const { rows: reps }     = readSheet(SH_REPAY,'loanid');
  const { rows: fines }    = readSheet(SH_FINES,'fineid');
  const { rows: loanReqs } = readSheet(SH_LOAN_REQ,'requestid');
  const { rows: wdReqs }   = readSheet(SH_WD_REQ,'requestid');
  const { rows: savRows }  = readSheet(SH_SAVINGS,'memberno');
  const month = fmt_date(new Date()).slice(0,7);  // yyyy-MM
  const active = members.filter(m=>String(m['MemberNo']||'').trim()!=='');
  const totalSavings = active.reduce((s,m)=>s+_accountBalancesFromRows(savRows,m['MemberNo']).total,0);
  const nameOf = {}; active.forEach(m => { nameOf[String(m['MemberNo']).trim()] = m['Full Name'] || ''; });
  const computedLoans = loans.filter(l=>String(l['LoanID']||'').trim()!=='').map(l=>_computeLoan(l,reps));
  const activeLoans = computedLoans.filter(l=>l.status==='Active');
  const totalOutstanding = activeLoans.reduce((s,l)=>s+l.outstandingBalance,0);
  const overdueLoans = activeLoans.filter(l=>l.overdue);
  const unpaidFines = fines.filter(f=>String(f['FineID']||'').trim()!==''&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
  const pendingLoanReqs = loanReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&String(r['Status']||'').trim()==='Pending').length;
  const pendingWdReqs   = wdReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&String(r['Status']||'').trim()==='Pending').length;
  // Savings this month, by type and by payment category (reversals posted this month net off)
  let deposits = 0, withdrawals = 0;
  const byCategory = {};
  PAYMENT_CATEGORIES.forEach(c => { byCategory[c] = 0; });
  byCategory['Uncategorised'] = 0;
  savRows.filter(r => String(r['Date']||'').indexOf(month) === 0).forEach(r => {
    const amt = num(r['Amount (UGX)']);
    const t = _txType(r).toLowerCase();
    if (t === 'deposit' || t === 'deposit reversal') {
      const signed = t === 'deposit' ? amt : -amt;
      deposits += signed;
      const cat = String(r['Payment Category']||'').trim();
      const key = PAYMENT_CATEGORIES.indexOf(cat) > -1 ? cat : 'Uncategorised';
      byCategory[key] += signed;
    } else if (t === 'withdrawal') withdrawals += amt;
    else if (t === 'withdrawal reversal') withdrawals -= amt;
  });
  const repaid = reps.filter(r => String(r['Date']||'').indexOf(month) === 0)
    .reduce((s,r) => s + num(_pick(r,['Amount (UGX)','Total Amount Paid'])), 0);
  const issuedThisMonth = loans.filter(l => String(l['Date Issued']||'').indexOf(month) === 0 && String(l['LoanID']||'').trim() !== '');
  const overdueAmount = overdueLoans.reduce((s,l) => s + l.outstandingBalance, 0);
  const unpaidFineCount = fines.filter(f => String(f['FineID']||'').trim() !== '' && String(f['Status']||'').toLowerCase() === 'unpaid').length;
  return { ok:true, totalMembers:active.length, totalSavings:r2(totalSavings),
    month: month, depositsThisMonth: r2(deposits), withdrawalsThisMonth: r2(withdrawals),
    repaymentsThisMonth: r2(repaid), loansIssuedThisMonth: issuedThisMonth.length,
    loansIssuedAmountThisMonth: r2(issuedThisMonth.reduce((s,l) => s + num(l['Principal (UGX)']), 0)),
    overdueCount: overdueLoans.length, overdueAmount: r2(overdueAmount), unpaidSurchargeCount: unpaidFineCount,
    categoryTotals: Object.keys(byCategory).map(k => ({ category: k, amount: r2(byCategory[k]) })),
    depositAccounts: _depositAccountSummary(savRows, nameOf, month),
    totalLoansOutstanding:r2(totalOutstanding), activeLoanCount:activeLoans.length,
    unpaidFinesTotal:r2(unpaidFines), pendingLoanRequests:pendingLoanReqs, pendingWithdrawalRequests:pendingWdReqs,
    overdueLoans:overdueLoans.map(l=>({loanId:l.loanId,memberNo:l.memberNo,
      memberName:(_memberByNo(l.memberNo)||{})['Full Name']||l.memberNo,
      outstandingBalance:l.outstandingBalance,progressLabel:l.progressLabel})) };
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
