// ── LOAN CALCULATIONS & LOW-LEVEL LOAN ROW HELPERS ────────────────────────────

// Two loan models live side by side:
//  - Flat (Article 4): 10% interest + processing fee on principal, repaid in two equal
//    instalments at weeks 4 and 8. Still owed at week 8 -> 10% late penalty on the balance.
//  - Reducing (legacy): monthly reducing balance at the rate entered at the time. Kept so
//    loans issued before the flat model still calculate correctly.
const FLAT_LOAN_MODEL = 'Flat';

function _isFlat(loan) {
  return String(loan['Loan Model']||'').trim().toLowerCase() === FLAT_LOAN_MODEL.toLowerCase();
}

// Parses a 'yyyy-MM-dd' sheet value as a local date, so day counts don't shift with timezone.
function _ymd(v) {
  const m = String(v||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(v);
}
function _addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Flat-loan amounts for a principal. Used by the calculation and the issue email.
function _flatTerms(principal, fee) {
  const interest = r2(principal * FLAT_INTEREST_RATE);
  const base = r2(principal + interest + fee);
  const inst1 = r2(base / 2);
  return { interest, fee, base, inst1, inst2: r2(base - inst1) };
}

function _computeLoan(loan, allRepayments) {
  const reps = allRepayments
    .filter(r => String(r['LoanID']||'').trim() === String(loan['LoanID']||'').trim())
    .map(r => ({ date: _ymd(r['Date']), amount: num(_pick(r,['Amount (UGX)','Total Amount Paid'])) }))
    .sort((a,b) => a.date - b.date);
  return _isFlat(loan) ? _computeFlat(loan, reps) : _computeReducing(loan, reps);
}

function _computeFlat(loan, reps) {
  const principal = num(loan['Principal (UGX)']);
  const issued = _ymd(loan['Date Issued']);
  const now = new Date();
  const d1 = _addDays(issued, LOAN_FIRST_INSTALMENT_DAYS);
  const d2 = _addDays(issued, LOAN_DURATION_DAYS);
  const t = _flatTerms(principal, num(loan['Processing Fee (UGX)']) || PROCESSING_FEE);

  // Late penalty: if less than the full base is paid by week 8, 10% is charged on what is still owed
  const paidByDeadline = reps.filter(r => r.date <= d2).reduce((s,r) => s + r.amount, 0);
  const owedAtDeadline = t.base - paidByDeadline;
  const penalty = owedAtDeadline > 0.5 ? r2(owedAtDeadline * LATE_PENALTY_RATE) : 0;

  const totalDue = r2(t.base + penalty);
  const totalRepaid = r2(reps.reduce((s,r) => s + r.amount, 0));
  const outstanding = Math.max(0, r2(totalDue - totalRepaid));
  const status = outstanding <= 0.5 ? LOAN_STATUS.CLEARED : String(loan['Status']||LOAN_STATUS.ACTIVE);

  // What should have been paid by today
  let requiredNow = 0;
  if (now >= d1) requiredNow += t.inst1;
  if (now >= d2) requiredNow += t.inst2 + penalty;
  const overdue = status === LOAN_STATUS.ACTIVE && totalRepaid < requiredNow - 0.5;

  const items = [
    { label: 'Instalment 1', due: fmt_date(d1), amount: t.inst1 },
    { label: 'Instalment 2', due: fmt_date(d2), amount: t.inst2 }
  ];
  if (penalty > 0) items.push({ label: 'Late penalty (10%)', due: fmt_date(d2), amount: penalty });
  let running = totalDue;
  const schedule = items.map(it => { running = r2(running - it.amount); return { ...it, balance: Math.max(0, running) }; });

  return {
    loanId: loan['LoanID'], memberNo: loan['MemberNo'], model: 'flat', principal,
    monthlyRate: FLAT_INTEREST_RATE * 100, rateLabel: '10% flat',
    term: 0, termLabel: '8 weeks', dateIssued: loan['Date Issued'], purpose: loan['Purpose']||'',
    overrideReason: loan['Override Reason']||'', monthsElapsed: null,
    processingFee: t.fee, interest: t.interest, penalty, totalDue,
    totalInterestAccrued: t.interest, totalRepaid, outstandingBalance: outstanding, status, overdue,
    progressLabel: overdue ? 'Overdue' : (status === LOAN_STATUS.CLEARED ? 'Cleared' : 'On track'),
    monthlyPayment: t.inst1, scheduleHead: ['Instalment','Due date','Amount','Balance after'], schedule
  };
}

function _computeReducing(loan, reps) {
  const principal = num(loan['Principal (UGX)']);
  const rate = num(_pick(loan,['Monthly Rate (%)','Weekly Rate (%)'])) / 100;
  const issued = _ymd(loan['Date Issued']);
  const now = new Date();
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
  const status = balance <= 0.5 ? LOAN_STATUS.CLEARED : String(loan['Status']||LOAN_STATUS.ACTIVE);
  const overdue = status === LOAN_STATUS.ACTIVE && term > 0 && monthsElapsed > term;
  const sch = _schedule(principal, num(_pick(loan,['Monthly Rate (%)','Weekly Rate (%)'])), term);
  return { loanId: loan['LoanID'], memberNo: loan['MemberNo'], model: 'reducing', principal,
    monthlyRate: num(_pick(loan,['Monthly Rate (%)','Weekly Rate (%)'])), rateLabel: num(_pick(loan,['Monthly Rate (%)','Weekly Rate (%)']))+'%/mo',
    term, termLabel: term+' months', dateIssued: loan['Date Issued'], purpose: loan['Purpose']||'',
    overrideReason: loan['Override Reason']||'', monthsElapsed, totalInterestAccrued: r2(totalInterest),
    totalRepaid: r2(totalRepaid), outstandingBalance: r2(balance), status, overdue,
    progressLabel: overdue ? 'Overdue' : (status === LOAN_STATUS.CLEARED ? 'Cleared' : 'On track'),
    monthlyPayment: sch.monthlyPayment, scheduleHead: null, schedule: sch.schedule };
}

// Projected amortization schedule for legacy reducing-balance loans (guidance only)
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

// The running (not yet cleared) loan for a member, or null
function _runningLoanOf(memberNo) {
  const mNo = String(memberNo).trim();
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const { rows: reps } = readSheet(SH_REPAY,'loanid');
  return loans.filter(l => String(l['MemberNo']||'').trim() === mNo)
    .map(l => _computeLoan(l, reps)).find(l => l.status === LOAN_STATUS.ACTIVE) || null;
}

// Member-level eligibility for a new loan. Hard rules, no override.
function _loanEligibility(memberNo) {
  const mNo = String(memberNo).trim();

  // Sec 1: must have saved for at least 12 months (counted from first deposit)
  const { rows: savRows } = readSheet(SH_SAVINGS, 'memberno');
  const deposits = savRows.filter(r => String(r['MemberNo']||'').trim() === mNo
    && String(_pick(r,['Deposit Type','Type'])).trim().toLowerCase() === 'deposit' && r['Date']);
  if (!deposits.length) return { ok: false, error: 'Member has no savings yet. Loans are only available after saving for a minimum of 12 months.' };
  const first = new Date(Math.min(...deposits.map(r => _ymd(r['Date']).getTime())));
  const eligibleFrom = new Date(first); eligibleFrom.setMonth(eligibleFrom.getMonth() + 12);
  if (new Date() < eligibleFrom) return { ok: false, error: 'Member must save for at least 12 months before accessing a loan. Eligible from ' + fmt_date(eligibleFrom) + '.' };

  // Sec 7: a member with a running loan cannot access another loan
  const running = _runningLoanOf(mNo);
  if (running) return { ok: false, error: 'Member already has a running loan (' + running.loanId + '). A new loan can only be accessed after it is fully cleared. (Art. 4, Sec. 7)' };

  // Sec 8: a member who is guaranteeing another loan cannot access a loan until that one is fully serviced
  if (_liveGuaranteesOf(mNo, '') > 0) return { ok: false, error: 'Member is currently guaranteeing another loan. A loan can only be accessed once that loan is fully serviced. (Art. 4, Sec. 8)' };

  return { ok: true };
}

// Creates a flat-model loan row. Requires the "Loan Model" and "Processing Fee (UGX)" columns.
function _createLoanRow(memberNo, principal, purpose, issuedBy, overrideReason) {
  const { sh, headers, hRow } = readSheet(SH_LOANS,'loanid');
  if (ci(headers,'loan model') < 0 || ci(headers,'processing fee') < 0)
    throw new Error('Loans sheet needs "Loan Model" and "Processing Fee (UGX)" columns. Run setupGuaranteeSchema() once from the script editor.');
  const newId = nextId(SH_LOANS,'loanid','L');
  const row = emptyRow(sh, hRow, ci(headers,'loanid'));
  const s = (c,v) => { if(c>-1) sh.getRange(row,c+1).setValue(v); };
  s(ci(headers,'loanid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'date issued'),today());
  s(ci(headers,'principal'),principal); s(ci(headers,'status'),LOAN_STATUS.ACTIVE);
  s(ci(headers,'issued by'),issuedBy); s(ci(headers,'purpose'),purpose||'');
  s(ci(headers,'override'),overrideReason||'');
  s(ci(headers,'loan model'),FLAT_LOAN_MODEL); s(ci(headers,'processing fee'),PROCESSING_FEE);
  return newId;
}

function _setLoanStatus(loanId, status) {
  const { sh, headers, hRow } = readSheet(SH_LOANS,'loanid');
  const cId=ci(headers,'loanid'), cSt=ci(headers,'status');
  const data=sh.getDataRange().getValues();
  for (let r=hRow+1;r<data.length;r++)
    if (String(data[r][cId]).trim()===String(loanId).trim()) { if(cSt>-1)sh.getRange(r+1,cSt+1).setValue(status); break; }
}
