// ── LOAN CALCULATIONS & LOW-LEVEL LOAN ROW HELPERS ────────────────────────────

// Reducing-balance computation: walks month-by-month from issue date to today.
function _computeLoan(loan, allRepayments) {
  const principal = num(loan['Principal (UGX)']);
  const rate = num(loan['Monthly Rate (%)']) / 100;
  const issued = new Date(loan['Date Issued']);
  const now = new Date();
  const reps = allRepayments
    .filter(r => String(r['LoanID']||'').trim() === String(loan['LoanID']||'').trim())
    .map(r => ({ date: new Date(r['Date']), amount: num(r['Amount (UGX)']) }))
    .sort((a,b) => a.date - b.date);
  let balance = principal, totalInterest = 0, totalRepaid = 0, cursor = new Date(issued), ri = 0;
  while (true) {
    const next = new Date(cursor); next.setMonth(next.getMonth()+1);
    if (next > now) break;
    while (ri < reps.length && reps[ri].date <= next) { balance -= reps[ri].amount; totalRepaid += reps[ri].amount; ri++; }
    if (balance < 0) balance = 0;
    const interest = balance * rate; balance += interest; totalInterest += interest;
    cursor = next;
  }
  while (ri < reps.length) { balance -= reps[ri].amount; totalRepaid += reps[ri].amount; ri++; }
  if (balance < 0) balance = 0;
  const term = num(loan['Term (months)']);
  const monthsElapsed = Math.floor((now - issued) / (1000*60*60*24*30.44));
  const status = balance <= 0.5 ? 'Cleared' : String(loan['Status']||'Active');
  const overdue = status === 'Active' && term > 0 && monthsElapsed > term;
  return { loanId: loan['LoanID'], memberNo: loan['MemberNo'], principal, monthlyRate: num(loan['Monthly Rate (%)']),
    term, dateIssued: loan['Date Issued'], purpose: loan['Purpose']||'',
    overrideReason: loan['Override Reason']||'', monthsElapsed, totalInterestAccrued: r2(totalInterest),
    totalRepaid: r2(totalRepaid), outstandingBalance: r2(balance), status, overdue };
}

// Projected amortization schedule (guidance only)
function _schedule(principal, ratePct, termMonths) {
  const rate = num(ratePct)/100, term = Math.max(1, Math.round(num(termMonths)));
  const payment = rate===0 ? r2(principal/term) : r2(principal*rate/(1-Math.pow(1+rate,-term)));
  const sched = []; let bal = principal;
  for (let m=1; m<=term; m++) {
    const interest=r2(bal*rate); let pay=payment; let closing=r2(bal+interest-pay);
    if (m===term||closing<0) { pay=r2(bal+interest); closing=0; }
    sched.push({month:m,opening:r2(bal),interest,payment:pay,closing});
    bal=closing;
  }
  return { monthlyPayment: payment, schedule: sched };
}

function _checkLimit(memberNo, principal) {
  const savings = _savingsBalance(memberNo);
  const maxLoan = r2(savings * LOAN_TO_SAVINGS_LIMIT);
  return { withinLimit: principal <= maxLoan, savings, maxLoan };
}

function _createLoanRow(memberNo, principal, monthlyRate, termMonths, purpose, issuedBy, overrideReason) {
  const { sh, headers, hRow } = readSheet(SH_LOANS,'loanid');
  const newId = nextId(SH_LOANS,'loanid','L');
  const row = emptyRow(sh, hRow, ci(headers,'loanid'));
  const s = (c,v) => { if(c>-1) sh.getRange(row,c+1).setValue(v); };
  s(ci(headers,'loanid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'date issued'),today());
  s(ci(headers,'principal'),principal); s(ci(headers,'monthly rate'),monthlyRate);
  s(ci(headers,'term'),termMonths); s(ci(headers,'status'),'Active');
  s(ci(headers,'issued by'),issuedBy); s(ci(headers,'purpose'),purpose||'');
  s(ci(headers,'override'),overrideReason||'');
  return newId;
}

function _setLoanStatus(loanId, status) {
  const { sh, headers, hRow } = readSheet(SH_LOANS,'loanid');
  const cId=ci(headers,'loanid'), cSt=ci(headers,'status');
  const data=sh.getDataRange().getValues();
  for (let r=hRow+1;r<data.length;r++)
    if (String(data[r][cId]).trim()===String(loanId).trim()) { if(cSt>-1)sh.getRange(r+1,cSt+1).setValue(status); break; }
}
