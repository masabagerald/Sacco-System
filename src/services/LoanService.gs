// ── LOAN CALCULATIONS & LOW-LEVEL LOAN ROW HELPERS ────────────────────────────

// Four loan models live side by side:
//  - Member (Founder/Delegate loans): 10% interest, minimum 2 months, UGX 5,000 fee. One payment
//    due at the end of the term, counted in months.
//  - Term (Non-Member Soft Loans only): interest set by the repayment term (LOAN_TERMS) plus the
//    UGX 10,000 processing fee. One payment, due on the due date, counted in days. Needs Founder
//    Member guarantors; no savings cap (Non-Members have no savings).
//  - Flat (Article 4, earlier loans): 10% flat + UGX 5,000 fee, two instalments at weeks 4 and 8.
//    Still owed at week 8 -> 10% late penalty on the balance.
//  - Reducing (oldest loans): monthly reducing balance at the rate entered at the time.
const MEMBER_LOAN_MODEL = 'Member';
const TERM_LOAN_MODEL = 'Term';
const FLAT_LOAN_MODEL = 'Flat';

function modelOf_(loan) { return String(loan['Loan Model']||'').trim().toLowerCase(); }
function isMemberLoan_(loan) { return modelOf_(loan) === MEMBER_LOAN_MODEL.toLowerCase(); }
function isTerm_(loan) { return modelOf_(loan) === TERM_LOAN_MODEL.toLowerCase(); }
function isFlat_(loan) { return modelOf_(loan) === FLAT_LOAN_MODEL.toLowerCase(); }

// Parses a 'yyyy-MM-dd' sheet value as a local date, so day counts don't shift with timezone.
function ymd_(v) {
  const m = String(v||'').trim().match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(v);
}
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths_(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

// Decides which loan product a member is offered, based on membership type. termInput is the
// repayment-term key (Non-Member Soft Loans) or the number of months (Founder/Delegate loans).
function loanSpecFor_(membershipType, termInput) {
  const type = String(membershipType||'').trim();
  if (type === 'Non-Member') {
    const def = termByKey_(termInput);
    if (!def) return { ok: false, error: 'Choose a repayment term.' };
    return { ok: true, spec: { model: TERM_LOAN_MODEL, days: def.days, rate: def.rate, fee: PROCESSING_FEE, label: def.label,
      guarantorsRequired: true, savingsLimit: false } };
  }
  if (type === 'Founder Member' || type === 'Delegate Member') {
    // A Soft Loan term key ('1w', '1m', ...) means the request was made while the member was a
    // Non-Member and their membership type has changed since. Don't read '1w' as 1 month.
    const soft = termByKey_(termInput);
    if (soft) return { ok: false, error: 'This request was made as a Non-Member Soft Loan (' + soft.label + '), but the member is now a ' + type + '. Reject it; the member can apply again as a ' + type + '.' };
    const months = Math.round(num(termInput));
    if (!months || months < MEMBER_LOAN_MIN_MONTHS)
      return { ok: false, error: 'Minimum loan term is ' + MEMBER_LOAN_MIN_MONTHS + ' months.' };
    return { ok: true, spec: { model: MEMBER_LOAN_MODEL, months: months, rate: MEMBER_LOAN_RATE, fee: MEMBER_LOAN_FEE,
      label: months + ' month' + (months > 1 ? 's' : ''), guarantorsRequired: true, savingsLimit: true } };
  }
  return { ok: false, error: 'This member\'s membership type has not been set (Founder Member, Delegate Member or Non-Member). Ask an admin to set it before applying for a loan.' };
}

// Amounts for a given loan spec (model/rate/fee/term). Shared by the issue email and the request preview.
function loanAmounts_(principal, spec) {
  const interest = r2(principal * spec.rate);
  return { rate: spec.rate, interest, fee: spec.fee, total: r2(principal + interest + spec.fee) };
}

// Flat-loan amounts (Article 4). Used by the legacy calculation.
function flatTerms_(principal, fee) {
  const interest = r2(principal * FLAT_INTEREST_RATE);
  const base = r2(principal + interest + fee);
  const inst1 = r2(base / 2);
  return { interest, fee, base, inst1, inst2: r2(base - inst1) };
}

// The repayment rows of one loan. The rows are grouped by LoanID once per list (and again only if the
// list grows), so working out every loan costs one pass over the repayments, not one pass per loan.
const REPAYMENTS_BY_LOAN_ = new WeakMap();
function repaymentsOf_(allRepayments, loanId) {
  let ix = REPAYMENTS_BY_LOAN_.get(allRepayments);
  if (!ix || ix.n !== allRepayments.length) {
    ix = { n: allRepayments.length, byId: {} };
    allRepayments.forEach(r => { const id = String(r['LoanID'] || '').trim(); (ix.byId[id] = ix.byId[id] || []).push(r); });
    REPAYMENTS_BY_LOAN_.set(allRepayments, ix);
  }
  return ix.byId[String(loanId || '').trim()] || [];
}

function computeLoan_(loan, allRepayments) {
  const reps = repaymentsOf_(allRepayments, loan['LoanID'])
    .map(r => ({ date: ymd_(r['Date']), amount: num(pick_(r,['Amount (UGX)','Total Amount Paid'])) }))
    .sort((a,b) => a.date - b.date);
  if (isMemberLoan_(loan)) return computeSingleDue_(loan, reps, 'member', MEMBER_LOAN_RATE, MEMBER_LOAN_FEE);
  if (isTerm_(loan)) return computeSingleDue_(loan, reps, 'term', 0, PROCESSING_FEE);
  return isFlat_(loan) ? computeFlat_(loan, reps) : computeReducing_(loan, reps);
}

function progressLabel_(overdue, status) {
  return overdue ? 'Overdue' : (status === LOAN_STATUS.CLEARED ? 'Cleared' : 'On track');
}

// One payment due on a due date. Used for both the Member loan (term in months) and the
// Non-Member Soft Loan (term in days) -- they only differ in how the due date and label are derived.
function computeSingleDue_(loan, reps, model, rateFallback, feeFallback) {
  const principal = num(loan['Principal (UGX)']);
  const issued = ymd_(loan['Date Issued']);
  const rate = num(loan['Interest Rate (%)']) ? num(loan['Interest Rate (%)']) / 100 : rateFallback;
  const fee = num(loan['Processing Fee (UGX)']) || feeFallback;
  let due, termLabel, termValue;
  if (model === 'member') {
    const months = num(loan['Term (months)']) || MEMBER_LOAN_MIN_MONTHS;
    due = loan['Due Date'] ? ymd_(loan['Due Date']) : addMonths_(issued, months);
    termLabel = months + ' month' + (months > 1 ? 's' : '');
    termValue = months;
  } else {
    const days = num(loan['Term (days)']);
    const def = LOAN_TERMS.find(t => t.days === days) || { label: days + ' days' };
    due = loan['Due Date'] ? ymd_(loan['Due Date']) : addDays_(issued, days);
    termLabel = def.label;
    termValue = days;
  }
  const interest = r2(principal * rate);
  const base = r2(principal + interest + fee);
  // 10% overdue surcharge on principal+interest (not the fee), applied once by processLoanDueDates()
  // and stored on the sheet -- read here, never computed live, so it can't change after the fact.
  const surcharge = num(loan['Overdue Surcharge (UGX)']) || 0;
  const total = r2(base + surcharge);
  const totalRepaid = r2(reps.reduce((s,r) => s + r.amount, 0));
  const outstanding = Math.max(0, r2(total - totalRepaid));
  const status = outstanding <= 0.5 ? LOAN_STATUS.CLEARED : String(loan['Status']||LOAN_STATUS.ACTIVE);
  // Overdue once the due date has passed and money is still owed
  const overdue = status === LOAN_STATUS.ACTIVE && new Date() >= addDays_(due, 1);
  const schedule = [{ label: 'Full payment', due: fmt_date(due), amount: base, balance: Math.max(0, r2(base - totalRepaid)) }];
  if (surcharge > 0) schedule.push({ label: 'Overdue surcharge (10%)', due: fmt_date(due), amount: surcharge, balance: outstanding });
  return {
    loanId: loan['LoanID'], memberNo: loan['MemberNo'], model, principal,
    monthlyRate: rate * 100, rateLabel: r2(rate * 100) + '%', term: termValue, termLabel,
    dateIssued: loan['Date Issued'], dueDate: fmt_date(due), purpose: loan['Purpose']||'',
    overrideReason: loan['Override Reason']||'', monthsElapsed: null,
    processingFee: fee, interest, penalty: surcharge, totalDue: total,
    totalInterestAccrued: interest, totalRepaid, outstandingBalance: outstanding, status, overdue,
    progressLabel: progressLabel_(overdue, status),
    monthlyPayment: total, scheduleHead: ['Payment','Due date','Amount','Balance after'],
    schedule
  };
}

// Flat loan (Article 4, earlier loans)
function computeFlat_(loan, reps) {
  const principal = num(loan['Principal (UGX)']);
  const issued = ymd_(loan['Date Issued']);
  const now = new Date();
  const d1 = addDays_(issued, LOAN_FIRST_INSTALMENT_DAYS);
  const d2 = addDays_(issued, LOAN_DURATION_DAYS);
  const t = flatTerms_(principal, num(loan['Processing Fee (UGX)']) || ARTICLE4_FEE);

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
    progressLabel: progressLabel_(overdue, status),
    monthlyPayment: t.inst1, scheduleHead: ['Instalment','Due date','Amount','Balance after'], schedule
  };
}

function computeReducing_(loan, reps) {
  const principal = num(loan['Principal (UGX)']);
  const rate = num(loan['Monthly Rate (%)']) / 100;
  const issued = ymd_(loan['Date Issued']);
  const now = new Date();
  let balance = principal, totalInterest = 0, totalRepaid = 0, cursor = new Date(issued), ri = 0;
  const interestEvents = [];  // when each month's interest was added (used by Loan Insights)
  while (true) {
    const next = new Date(cursor); next.setMonth(next.getMonth()+1);
    if (next > now) break;
    while (ri < reps.length && reps[ri].date <= next) { balance -= reps[ri].amount; totalRepaid += reps[ri].amount; ri++; }
    if (balance < 0) balance = 0;
    const interest = balance * rate; balance += interest; totalInterest += interest;
    if (interest > 0) interestEvents.push({ date: fmt_date(next), amount: r2(interest) });
    cursor = next;
  }
  while (ri < reps.length) { balance -= reps[ri].amount; totalRepaid += reps[ri].amount; ri++; }
  if (balance < 0) balance = 0;
  const term = num(loan['Term (months)']);
  const monthsElapsed = Math.floor((now - issued) / (1000*60*60*24*30.44));
  const status = balance <= 0.5 ? LOAN_STATUS.CLEARED : String(loan['Status']||LOAN_STATUS.ACTIVE);
  const overdue = status === LOAN_STATUS.ACTIVE && term > 0 && monthsElapsed > term;
  const sch = schedule_(principal, num(loan['Monthly Rate (%)']), term);
  return { loanId: loan['LoanID'], memberNo: loan['MemberNo'], model: 'reducing', principal,
    monthlyRate: num(loan['Monthly Rate (%)']), rateLabel: num(loan['Monthly Rate (%)'])+'%/mo',
    term, termLabel: term+' months', dateIssued: loan['Date Issued'], purpose: loan['Purpose']||'',
    overrideReason: loan['Override Reason']||'', monthsElapsed, totalInterestAccrued: r2(totalInterest),
    totalRepaid: r2(totalRepaid), outstandingBalance: r2(balance), status, overdue,
    progressLabel: progressLabel_(overdue, status),
    monthlyPayment: sch.monthlyPayment, scheduleHead: null, schedule: sch.schedule, interestEvents };
}

// Projected amortization schedule for reducing-balance loans (guidance only)
function schedule_(principal, ratePct, termMonths) {
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

// ── LOAN CONTEXT: the tabs the loan rules need, each read at most once per request ──
// The eligibility, guarantor and limit checks for one request share one context, instead of each
// re-reading Savings, Loans, Repayments, Guarantors, Loan Requests and Members. Read lazily; only for
// use within one request, before anything those checks depend on is written.
function loanCtx_() {
  const memo = {};
  const once = (k, f) => () => (k in memo ? memo[k] : (memo[k] = f()));
  const ctx = {
    loans: once('loans', () => readSheet_(SH_LOANS, 'loanid').rows),
    reps: once('reps', () => readSheet_(SH_REPAY, 'loanid').rows),
    savRows: once('savRows', () => readSheet_(SH_SAVINGS, 'memberno').rows),
    balances: once('balances', () => memberBalances_(ctx.savRows())),
    guarantorRows: once('guarantorRows', () => readSheet_(SH_GUARANTORS, 'requestid').rows),
    requests: once('requests', () => readSheet_(SH_LOAN_REQ, 'requestid').rows),
    membersByNo: once('membersByNo', () => {
      const m = {}; readSheet_(SH_MEMBERS, 'memberno').rows.forEach(r => { const no = String(r['MemberNo'] || '').trim(); if (no && !m[no]) m[no] = r; });
      return m;
    }),
    member: no => ctx.membersByNo()[String(no == null ? '' : no).trim()] || null,
    principal: no => balanceOf_(ctx.balances(), no).Principal,
    live: null   // liveGuaranteeRows_ result, once worked out
  };
  return ctx;
}

// Loan cap: LOAN_TO_SAVINGS_LIMIT x the member's Principal (individual savings). ctx: optional loanCtx_().
function checkLimit_(memberNo, principal, ctx) {
  const savings = ctx ? ctx.principal(memberNo) : principalBalance_(memberNo);
  const maxLoan = r2(savings * LOAN_TO_SAVINGS_LIMIT);
  return { withinLimit: principal <= maxLoan, savings, maxLoan };
}

// The running (not yet cleared) loan for a member, or null. ctx: optional loanCtx_().
function runningLoanOf_(memberNo, ctx) {
  const mNo = String(memberNo).trim();
  const loans = ctx ? ctx.loans() : readSheet_(SH_LOANS,'loanid').rows;
  const reps = ctx ? ctx.reps() : readSheet_(SH_REPAY,'loanid').rows;
  return loans.filter(l => String(l['MemberNo']||'').trim() === mNo)
    .map(l => computeLoan_(l, reps)).find(l => l.status === LOAN_STATUS.ACTIVE) || null;
}

// Member-level eligibility for a new loan. Hard rules; the only override is guarantorOverride, an
// admin's recorded reason for letting a member who is guaranteeing a running loan take one (Sec 8).
// Non-Members have no savings, so the 12-month savings rule (Founder/Delegate loans only) is skipped for them.
function loanEligibility_(memberNo, membershipType, guarantorOverride, ctx) {
  const mNo = String(memberNo).trim();

  if (String(membershipType||'').trim() !== 'Non-Member') {
    // Sec 1: must have saved for at least 12 months, counted from the earlier of the member's Date
    // Joined and their first Principal deposit that has not been reversed (Operations and Welfare are
    // club pools, not savings). Date Joined lets members who saved before the app was in use qualify
    // without their old deposits being entered.
    const savRows = ctx ? ctx.savRows() : readSheet_(SH_SAVINGS, 'memberno').rows;
    const reversed = {};
    savRows.forEach(r => { const o = String(r['Reverses']||'').trim(); if (o) reversed[o] = true; });
    const starts = savRows.filter(r => String(r['MemberNo']||'').trim() === mNo
      && txType_(r).toLowerCase() === 'deposit' && accountOf_(r) === 'Principal'
      && !reversed[String(r['Reference']||'').trim()] && r['Date']).map(r => ymd_(r['Date']).getTime());
    const joined = dstr_(((ctx ? ctx.member(mNo) : memberByNo_(mNo)) || {})['Date Joined']);
    if (joined) starts.push(ymd_(joined).getTime());
    if (!starts.length) return { ok: false, error: 'Member has no savings yet. Loans are only available after saving for a minimum of 12 months.' };
    const first = new Date(Math.min(...starts));
    const eligibleFrom = new Date(first); eligibleFrom.setMonth(eligibleFrom.getMonth() + 12);
    if (new Date() < eligibleFrom) return { ok: false, error: 'Member must save for at least 12 months before accessing a loan. Eligible from ' + human_date(eligibleFrom) + '.' };
  }

  // Sec 7: a member with a running loan cannot access another loan (all membership types)
  const running = runningLoanOf_(mNo, ctx);
  if (running) return { ok: false, error: 'Member already has a running loan (' + running.loanId + '). A new loan can only be accessed after it is fully cleared. (Art. 4, Sec. 7)' };

  // Sec 8: a member who is guaranteeing another loan cannot access a loan until that one is fully
  // serviced, unless an admin has recorded an override reason
  if (!String(guarantorOverride||'').trim() && liveGuaranteesOf_(mNo, '', ctx) > 0)
    return { ok: false, guarantorBlock: true, error: 'Member is currently guaranteeing another loan. A loan can only be accessed once that loan is fully serviced, unless an admin proposes it with an override reason. (Art. 4, Sec. 8)' };

  return { ok: true };
}

// Creates a loan row from a loanSpecFor_() spec (Member: months; Term: days).
function createLoanRow_(memberNo, principal, purpose, issuedBy, overrideReason, spec) {
  const rd = readSheet_(SH_LOANS,'loanid');
  const { sh, headers } = rd;
  const needed = ['loan model','processing fee','interest rate','due date'];
  if (needed.some(n => ci(headers, n) < 0))
    throw new Error('Loans sheet is missing one of these columns: Loan Model, Processing Fee (UGX), Interest Rate (%), Due Date. Run setupGuaranteeSchema() once from the script editor.');
  const newId = nextId_(SH_LOANS,'loanid','loan', rd);
  const row = freeRowFinder_(rd, ci(headers,'loanid'))();
  const issued = new Date();
  const cells = [[ci(headers,'loanid'),newId], [ci(headers,'timestamp'),now_ts()],
    [ci(headers,'memberno'),memberNo], [ci(headers,'date issued'),fmt_date(issued)],
    [ci(headers,'principal'),principal], [ci(headers,'status'),LOAN_STATUS.ACTIVE],
    [ci(headers,'issued by'),issuedBy], [ci(headers,'purpose'),purpose||''],
    [ci(headers,'override'),overrideReason||''],
    [ci(headers,'loan model'),spec.model], [ci(headers,'processing fee'),spec.fee],
    [ci(headers,'interest rate'),r2(spec.rate*100)]];
  if (spec.model === MEMBER_LOAN_MODEL) {
    cells.push([ci(headers,'term (months)'),spec.months], [ci(headers,'due date'),fmt_date(addMonths_(issued, spec.months))]);
  } else {
    cells.push([ci(headers,'term (days)'),spec.days], [ci(headers,'due date'),fmt_date(addDays_(issued, spec.days))]);
  }
  writeCells_(sh, row, headers.length, cells);
  return newId;
}

// Sets one cell of the first Loans row with this LoanID. rd: the Loans tab as already read (optional).
function setLoanCell_(loanId, header, value, rd) {
  const { sh, headers, rows } = rd || readSheet_(SH_LOANS,'loanid');
  const c = ci(headers, header), idH = headers[ci(headers,'loanid')];
  const row = rows.find(r => String(r[idH] == null ? '' : r[idH]).trim() === String(loanId).trim());
  if (row && c > -1) sh.getRange(row._row, c + 1).setValue(value);
}

function setLoanStatus_(loanId, status, rd) { setLoanCell_(loanId, 'status', status, rd); }

// Persists the one-time 10% overdue surcharge on a loan. Reading it back (in computeSingleDue_)
// is what makes it idempotent -- once a nonzero value is stored, it is never recalculated.
function setLoanOverdueSurcharge_(loanId, amount, rd) { setLoanCell_(loanId, 'overdue surcharge', amount, rd); }
