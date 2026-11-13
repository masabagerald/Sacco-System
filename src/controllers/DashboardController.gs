// ── ADMIN DASHBOARD & AUDIT LOG VIEWER ────────────────────────────────────────

function getAdminDashboard() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { rows: members }  = readSheet_(SH_MEMBERS,'memberno');
  const { rows: loans }    = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }     = readSheet_(SH_REPAY,'loanid');
  const { rows: fines }    = readSheet_(SH_FINES,'fineid');
  const { rows: loanReqs } = readSheet_(SH_LOAN_REQ,'requestid');
  const { rows: wdReqs }   = readSheet_(SH_WD_REQ,'requestid');
  const { rows: savRows }  = readSheet_(SH_SAVINGS,'memberno');
  const month = fmt_date(new Date()).slice(0,7);  // yyyy-MM
  const active = members.filter(m=>String(m['MemberNo']||'').trim()!=='');
  const balances = memberBalances_(savRows);
  const totalSavings = active.reduce((s,m)=>s+balanceOf_(balances,m['MemberNo']).total,0);
  const nameOf = {}; active.forEach(m => { nameOf[String(m['MemberNo']).trim()] = m['Full Name'] || ''; });
  const computedLoans = loans.filter(l=>String(l['LoanID']||'').trim()!=='').map(l=>computeLoan_(l,reps));
  const activeLoans = computedLoans.filter(l=>l.status==='Active');
  const totalOutstanding = activeLoans.reduce((s,l)=>s+l.outstandingBalance,0);
  const overdueLoans = activeLoans.filter(l=>l.overdue);
  // Surcharge register: each item is wholly Unpaid or Paid (markFinePaid settles the full amount; there
  // are no part-payments). Other statuses (blank, or set by hand on the sheet) count in neither card.
  const fineStatus = f => String(f['Status']||'').trim().toLowerCase();
  const fineItems = fines.filter(f=>String(f['FineID']||'').trim()!=='');
  const unpaidFineItems = fineItems.filter(f=>fineStatus(f)==='unpaid');
  const paidFineItems = fineItems.filter(f=>fineStatus(f)==='paid');
  const unpaidFines = unpaidFineItems.reduce((s,f)=>s+num(f['Amount (UGX)']),0);
  const paidFines = paidFineItems.reduce((s,f)=>s+num(f['Amount (UGX)']),0);
  const pendingLoanReqs = loanReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&['Pending',REQ_PENDING_WAIVER].indexOf(String(r['Status']||'').trim())>-1).length;  // waivers wait on admins too
  const pendingWdReqs   = wdReqs.filter(r=>String(r['RequestID']||'').trim()!==''&&String(r['Status']||'').trim()==='Pending').length;
  // Savings this month, by type and by payment category (reversals posted this month net off)
  let deposits = 0, withdrawals = 0;
  const byCategory = {};
  PAYMENT_CATEGORIES.forEach(c => { byCategory[c] = 0; });
  byCategory['Uncategorised'] = 0;
  savRows.filter(r => String(r['Date']||'').indexOf(month) === 0).forEach(r => {
    const amt = num(r['Amount (UGX)']);
    const t = txType_(r).toLowerCase();
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
    .reduce((s,r) => s + num(pick_(r,['Amount (UGX)','Total Amount Paid'])), 0);
  const issuedThisMonth = loans.filter(l => String(l['Date Issued']||'').indexOf(month) === 0 && String(l['LoanID']||'').trim() !== '');
  const overdueAmount = overdueLoans.reduce((s,l) => s + l.outstandingBalance, 0);
  const unpaidFineCount = unpaidFineItems.length;
  return { ok:true, totalMembers:active.length, totalSavings:r2(totalSavings),
    month: month, depositsThisMonth: r2(deposits), withdrawalsThisMonth: r2(withdrawals),
    repaymentsThisMonth: r2(repaid), loansIssuedThisMonth: issuedThisMonth.length,
    loansIssuedAmountThisMonth: r2(issuedThisMonth.reduce((s,l) => s + num(l['Principal (UGX)']), 0)),
    overdueCount: overdueLoans.length, overdueAmount: r2(overdueAmount), unpaidSurchargeCount: unpaidFineCount,
    categoryTotals: Object.keys(byCategory).map(k => ({ category: k, amount: r2(byCategory[k]) })),
    depositAccounts: depositAccountSummary_(savRows, nameOf, month),
    totalLoansOutstanding:r2(totalOutstanding), activeLoanCount:activeLoans.length,
    unpaidFinesTotal:r2(unpaidFines), paidFinesTotal:r2(paidFines), paidSurchargeCount:paidFineItems.length, pendingLoanRequests:pendingLoanReqs, pendingWithdrawalRequests:pendingWdReqs,
    overdueLoans:overdueLoans.map(l=>({loanId:l.loanId,memberNo:l.memberNo,
      memberName:nameOf[String(l.memberNo||'').trim()]||l.memberNo,
      outstandingBalance:l.outstandingBalance,progressLabel:l.progressLabel})) };
}

// One page of the audit log, newest first, searched and filtered on the server (AuditService.gs), so
// any entry in years of history can be found. filters: { from, to, member, category, sensitive, q,
// page (0 = newest), pageSize }, or just a page size. Timestamps are 'yyyy-MM-dd HH:mm:ss' in the script
// timezone (the zone now_ts() writes in); entries made on the same second keep their sheet order (later row first).
function getAuditLog(filters) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  if (!filters || typeof filters !== 'object') filters = { pageSize: filters };
  const f = auditFilters_(filters); if (f.error) return { ok:false, error:f.error };
  const pageSize = Math.min(500, Math.max(1, Math.floor(num(filters.pageSize)) || 100));
  const page = Math.max(0, Math.floor(num(filters.page)));
  const sh = getSheet_(SH_AUDIT), members = auditMembers_(), names = auditNameMap_(members);
  const hits = auditFind_(sh, f, names).sort((a,b)=>b.ts.localeCompare(a.ts) || b.row-a.row);
  const entries = auditRead_(sh, hits.slice(page * pageSize, (page + 1) * pageSize)).map(e => auditView_(e, names));
  return { ok:true, entries, total: hits.length, page, pageSize, timeZone: Session.getScriptTimeZone(),
    categories: AUDIT_CATEGORY_NAMES, members };
}
