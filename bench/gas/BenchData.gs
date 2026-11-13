// ── SYNTHETIC DATA FOR CAPACITY TESTS ─────────────────────────────────────────
// Used by the Node benchmark (bench/run-local.js) and by the Apps Script harness on a COPY
// (bench/gas/Bench.gs). Never push this to a live club: it fills the spreadsheet with fake members.
//
// Every value is fake: members are "Bench Member 0001" with @example.invalid addresses (the .invalid
// domain can never receive mail). Generation is deterministic (no Math.random), month by month, so the
// Apps Script copy can generate a large tier over several executions and get exactly the same rows.
//
// Activity per saving member per month (the "~8 transactions per member per month" assumption):
//   6 deposits (4 Principal, 1 Operations, 1 Welfare), a withdrawal 1 month in 4 (with its approved
//   withdrawal request), a deposit reversal 1 month in 4                          → 6.5 savings rows
//   1 loan repayment (a 3-month loan every 3 months, repaid in 3 instalments)      → 1 repayment
//   1 loan every 3 months (request + 2 guarantor rows + loan row)                  → 0.33 loans
//   1 surcharge every 6 months                                                     → 0.17 surcharges
// plus the rows the app itself writes for those: audit log entries, guarantor notifications
// (2 per repayment + 2 when a loan clears). Non-Members (1 in 10) take a 1-month Soft Loan every
// 3 months and do not save. 5% of loans are never finished (overdue, with the 10% surcharge).

const BENCH_CLEAN_FOUNDERS = 33;   // founders kept free of loans and guarantees, for the write tests

function benchCfg_(members, years, endYmd, hostEmail) {
  const m = String(endYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return { members: members, years: years, months: years * 12, endY: +m[1], endM: +m[2] - 1, endD: +m[3],
    hostEmail: String(hostEmail || 'host@club.org').toLowerCase() };
}

function benchPad_(n, w) { return String(n).padStart(w, '0'); }
// Small deterministic hash -> 0..2^32-1
function benchHash_(a, b, c) {
  let h = 2166136261 >>> 0;
  [a, b, c || 0].forEach(v => { h ^= (v + 0x9e3779b9) >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; });
  return h >>> 0;
}

// Calendar month of data month k (0 = oldest; months-1 = the month of endYmd)
function benchMonth_(cfg, k) {
  const total = cfg.endY * 12 + cfg.endM - (cfg.months - 1) + k;
  return { y: Math.floor(total / 12), m: total % 12, last: k === cfg.months - 1 };
}

// Members: index 0 is the hosting account (System Administrator); 1-5 are admins (1 Chairperson,
// 2-3 Finance Committee); 1 in 10 is a Non-Member, 2 in 10 Delegate Members, the rest Founder Members.
// The last BENCH_CLEAN_FOUNDERS founders never borrow or guarantee (applicants/guarantors for write tests).
function benchMembers_(cfg) {
  const list = [];
  for (let i = 0; i < cfg.members; i++) {
    const no = MEMBER_NO_PREFIX + benchPad_(i + 1, 4);
    let type = i % 10 === 9 ? 'Non-Member' : (i % 10 === 7 || i % 10 === 8) ? 'Delegate Member' : 'Founder Member';
    if (i === 0) type = '';
    if (i >= 1 && i <= 5) type = 'Founder Member';
    list.push({ i, no, type, name: i === 0 ? 'System Administrator' : 'Bench Member ' + benchPad_(i + 1, 4),
      email: i === 0 ? cfg.hostEmail : 'bench.member' + benchPad_(i + 1, 4) + '@example.invalid',
      role: i <= 5 ? 'Admin' : 'Member', committee: i === 1 ? 'Chairperson' : (i === 2 || i === 3) ? 'Finance Committee' : '',
      saver: i > 0 && type !== 'Non-Member', clean: false });
  }
  const founders = list.filter(m => m.type === 'Founder Member' && m.i > 5);
  founders.slice(-Math.min(BENCH_CLEAN_FOUNDERS, Math.floor(founders.length / 2))).forEach(m => { m.clean = true; });
  const borrowers = list.filter(m => m.i > 0 && !m.clean);
  const guarantorPool = list.filter(m => m.type === 'Founder Member' && !m.clean);
  return { list, borrowers, guarantorPool, clean: list.filter(m => m.clean), admins: list.filter(m => m.role === 'Admin') };
}

// Rows that do not depend on the month: Members, Terms Acceptance, Investments.
// mkDate(y, m0, d, h, mi, s) builds a Date in the caller's realm. Returns { sheetName: [ {Header: value} ] }.
function benchStaticRows_(cfg, mkDate) {
  const mm = benchMembers_(cfg);
  const s = benchMonth_(cfg, 0);
  const joined = mkDate(s.y - 2, s.m, 1, 0, 0, 0);
  const out = {};
  out[SH_MEMBERS] = mm.list.map(m => ({ 'MemberNo': m.no, 'Full Name': m.name, 'Email': m.email,
    'Phone': '+2567' + benchPad_(10000000 + m.i, 8), 'Role': m.role, 'Membership Type': m.type, 'Date Joined': joined,
    'Status': 'Active', 'Committee Role': m.committee }));
  out[SH_TERMS] = [];
  mm.list.forEach(m => ['use'].concat(m.role === 'Admin' ? ['admin'] : []).forEach(k => out[SH_TERMS].push({
    'Timestamp': mkDate(s.y, s.m, 1, 9, 0, 0), 'MemberNo': m.no, 'Email': m.email, 'Role': m.role, 'Document': k,
    'Title': k === 'use' ? 'Terms of Use' : 'Administrator Confidentiality and Conduct Agreement', 'Version': '1', 'Decision': 'Accepted' })));
  out[SH_INVESTMENTS] = [1, 2, 3].map(n => ({ 'InvestmentID': 'INV-' + benchPad_(n, 6), 'Timestamp': mkDate(s.y, s.m, 2, 10, 0, 0),
    'Name': 'Bench Investment ' + n, 'Type': n === 1 ? 'Unit Trust' : n === 2 ? 'Fixed Deposit' : 'Treasury Bill', 'Provider': 'Bench Bank ' + n,
    'Currency': 'UGX', 'Start Date': mkDate(s.y, s.m, 2, 0, 0, 0), 'Maturity Date': '', 'Account Reference': '00012345' + n,
    'Status': 'Active', 'Notes': '', 'Document Link': '', 'Created By': mm.admins[1].no, 'Source of Funds': 'Others',
    'Source of Funds (Other)': 'Bench' }));
  return out;
}

// Rows for data month k. Returns { sheetName: [ {Header: value} ] } (only the sheets with rows that month).
function benchMonthRows_(cfg, k, mkDate) {
  const mm = benchMembers_(cfg), M = cfg.members, cal = benchMonth_(cfg, k);
  const maxDay = cal.last ? Math.max(1, Math.min(28, cfg.endD)) : 28;
  const day = d => Math.min(d, maxDay);
  const D = (d, h, mi) => mkDate(cal.y, cal.m, day(d), h || 0, mi || 0, (k * 7 + d) % 60);
  const ymd = d => cal.y + '-' + benchPad_(cal.m + 1, 2) + '-' + benchPad_(day(d), 2);
  const admin = n => mm.admins[1 + (n % 5)].no;
  const out = {};
  const add = (sheet, row) => { (out[sheet] = out[sheet] || []).push(row); };
  const audit = (ts, action, member, by, details, ref) => add(SH_AUDIT, { 'Timestamp': ts, 'Action': action, 'Member (Affected)': member,
    'Performed By': by, 'Details': details, 'Reference ID': ref });
  const ref = (code, n) => code + '-' + benchPad_(n, 6);

  // ── savings ──
  const DEPOSITS = [['Monthly Premium', 'Principal', 50000], ['Monthly Premium', 'Principal', 50000], ['Annual Subscription Fee', 'Principal', 10000],
    ['Operations Fee', 'Operations', 10000], ['Welfare Fee', 'Welfare', 5000], ['Monthly Premium', 'Principal', 20000]];
  mm.list.filter(m => m.saver).forEach(m => {
    const base = (k * M + m.i) * 8;
    DEPOSITS.forEach(([cat, acc, amt], j) => {
      const r = ref('DEP', base + j + 1), by = admin(m.i + j);
      add(SH_SAVINGS, { 'Date': D(2 + j), 'Timestamp': D(2 + j, 9, j), 'MemberNo': m.no, 'Deposit Type': 'Deposit', 'Amount (UGX)': amt,
        'Recorded By': by, 'Reference': r, 'Notes': '', 'Payment Category': cat, 'Surcharge Reason': '', 'Deposit Account': acc, 'Reverses': '' });
      audit(D(2 + j, 9, j), 'Deposit', m.no, by, 'Deposit of UGX ' + amt + ' (' + acc + ' account, ' + cat + ', dated ' + ymd(2 + j) + ')', r);
    });
    if (k % 4 === m.i % 4) {   // approved withdrawal request -> Withdrawal row
      const wr = ref('WRQ', k * M + m.i + 1), r = ref('WDL', base + 7), a1 = admin(m.i), a2 = admin(m.i + 1);
      add(SH_WD_REQ, { 'RequestID': wr, 'Timestamp': D(9, 10), 'MemberNo': m.no, 'Amount (UGX)': 20000, 'Reason': 'Dividends', 'Status': 'Approved',
        'Decision Notes': 'Approved by ' + a1 + ' and ' + a2, 'Decided By': a2, 'Initiated By': m.no, 'Approver 1': a1, 'Approver 1 At': D(9, 14),
        'Approver 2': a2, 'Approver 2 At': D(10, 9), 'Deposit Account': 'Principal' });
      add(SH_SAVINGS, { 'Date': D(10), 'Timestamp': D(10, 9, 1), 'MemberNo': m.no, 'Deposit Type': 'Withdrawal', 'Amount (UGX)': 20000,
        'Recorded By': a2, 'Reference': r, 'Notes': 'Withdrawal request ' + wr + ' approved', 'Payment Category': '', 'Surcharge Reason': '',
        'Deposit Account': 'Principal', 'Reverses': '' });
      audit(D(9, 10), 'Withdrawal Request Submitted', m.no, m.no, 'Requested withdrawal of UGX 20,000 from the Principal account.', wr);
      audit(D(9, 14), 'Withdrawal First Approval', m.no, a1, 'First of two required approvals.', wr);
      audit(D(10, 9), 'Withdrawal Fully Approved', m.no, a2, 'Withdrawal approved. Ledger ref ' + r, wr);
    }
    if (k % 4 === (m.i + 2) % 4) {   // reversal of this month's last deposit
      const orig = ref('DEP', base + 6), r = ref('REV', base + 8), by = admin(m.i + 3);
      add(SH_SAVINGS, { 'Date': D(11), 'Timestamp': D(11, 11), 'MemberNo': m.no, 'Deposit Type': 'Deposit Reversal', 'Amount (UGX)': 20000,
        'Recorded By': by, 'Reference': r, 'Notes': 'Reversal of ' + orig + ': entered twice', 'Payment Category': 'Monthly Premium',
        'Surcharge Reason': '', 'Deposit Account': 'Principal', 'Reverses': orig });
      audit(D(11, 11), 'Savings Reversal', m.no, by, 'Reversed Deposit ' + orig + '. Reason: entered twice', r);
    }
  });

  // ── loans: borrower b takes a loan in months where k % 3 === b % 3 ──
  const pool = mm.guarantorPool, nP = pool.length;
  const loanOf = (b, m, ki) => {   // the loan borrower m took in month ki (deterministic, so later months can repay it)
    const h = benchHash_(ki, m.i);
    const soft = m.type === 'Non-Member';
    const P = 100000 * (2 + h % 9);
    const rate = soft ? 0.15 : 0.10, fee = soft ? 10000 : 5000;
    const total = Math.round(P + P * rate + fee);
    const inst = soft ? [total] : [Math.round(total / 3), Math.round(total / 3)];
    if (!soft) inst.push(total - inst[0] - inst[1]);
    const defaults = h % 20 === 0;   // never pays the last instalment
    let g1 = pool[(b * 7 + 1 + ki) % nP], g2 = pool[(b * 7 + 2 + ki) % nP];
    if (g1.i === m.i) g1 = pool[(b * 7 + 3 + ki) % nP];
    if (g2.i === m.i || g2.i === g1.i) g2 = pool[(b * 7 + 4 + ki) % nP];
    return { id: ref('LN', ki * M + m.i + 1), req: ref('LRQ', ki * M + m.i + 1), P, rate, fee, total, inst, soft, defaults, g: [g1, g2] };
  };
  mm.borrowers.forEach((m, b) => {
    // 1. a new loan this month
    if (k % 3 === b % 3) {
      const L = loanOf(b, m, k);
      const issued = mkDate(cal.y, cal.m, day(1), 0, 0, 0);
      const due = L.soft ? mkDate(cal.y, cal.m, day(1) + 30, 0, 0, 0) : mkDate(cal.y, cal.m + 3, day(1), 0, 0, 0);
      const lastPayMonth = k + L.inst.length - (L.soft ? 0 : 1);
      const cleared = !L.defaults && lastPayMonth <= cfg.months - 1;
      const today = mkDate(cfg.endY, cfg.endM, cfg.endD, 0, 0, 0);
      const overdue = !cleared && due < today;
      const a1 = admin(m.i), a2 = admin(m.i + 2);
      add(SH_LOAN_REQ, { 'RequestID': L.req, 'Timestamp': D(1, 8), 'MemberNo': m.no, 'Amount (UGX)': L.P, 'Repayment Term': L.soft ? '1m' : '3',
        'Purpose': 'Business stock', 'Status': 'Approved', 'Decision Notes': 'Approved → ' + L.id, 'Decided By': a2, 'Initiated By': m.no,
        'Guarantor 1': L.g[0].no, 'Guarantor 2': L.g[1].no, 'Total Due': L.total, 'Approver 1': a1, 'Approver 1 At': D(1, 12),
        'Approver 2': a2, 'Approver 2 At': D(1, 16), 'Guarantor Override': '', 'Limit Override': 'Bench data' });
      L.g.forEach((g, j) => add(SH_GUARANTORS, { 'Timestamp': D(1, 8), 'RequestID': L.req, 'LoanID': L.id, 'ApplicantNo': m.no, 'GuarantorNo': g.no,
        'Token': benchPad_(benchHash_(k, m.i, j + 1).toString(16), 8) + benchPad_(benchHash_(m.i, k, j + 7).toString(16), 8) + 'bench0000000000000000',
        'Response': 'Accepted', 'Responded At': D(1, 10 + j), 'Decline Reason': '' }));
      add(SH_LOANS, { 'LoanID': L.id, 'Timestamp': D(1, 16), 'MemberNo': m.no, 'Date Issued': issued, 'Principal (UGX)': L.P,
        'Status': cleared ? 'Cleared' : 'Active', 'Issued By': a2, 'Purpose': 'Business stock', 'Override Reason': 'Bench data',
        'Loan Model': L.soft ? 'Term' : 'Member', 'Processing Fee (UGX)': L.fee, 'Interest Rate (%)': L.rate * 100,
        'Term (months)': L.soft ? '' : 3, 'Term (days)': L.soft ? 30 : '', 'Due Date': due,
        'Overdue Surcharge (UGX)': overdue ? Math.round((L.P + L.P * L.rate) * 0.1) : '', 'Last Notice': '' });
      audit(D(1, 8), 'Loan Request Submitted', m.no, m.no, 'Requested UGX ' + L.P, L.req);
      L.g.forEach((g, j) => audit(D(1, 10 + j), 'Guarantor Consent Given', m.no, g.no, g.name + ' agreed to guarantee', L.req));
      audit(D(1, 12), 'Loan Request First Approval', m.no, a1, 'First of two required approvals.', L.req);
      audit(D(1, 16), 'Loan Request Fully Approved', m.no, a2, 'Loan ' + L.id + ' created.', L.req);
    }
    // 2. instalments due this month on loans taken in earlier months (or this month)
    for (let back = 0; back <= 2; back++) {
      const ki = k - back;
      if (ki < 0 || ki % 3 !== b % 3) continue;
      const L = loanOf(b, m, ki);
      const n = L.soft ? back - 1 : back;   // soft loans: one payment, the month after
      if (n < 0 || n >= L.inst.length) continue;
      if (L.defaults && n === L.inst.length - 1) continue;
      const r = ref('RPY', k * M + m.i + 1), by = admin(m.i + 1), amt = L.inst[n];
      const isLast = n === L.inst.length - 1;
      const paid = L.inst.slice(0, n + 1).reduce((s, x) => s + x, 0);
      add(SH_REPAY, { 'LoanID': L.id, 'Date': D(12), 'Timestamp': D(12, 11), 'MemberNo': m.no, 'Amount (UGX)': amt, 'Recorded By': by,
        'Notes': '', 'Reference': r, 'Reverses': '' });
      audit(D(12, 11), 'Loan Repayment', m.no, by, 'Repayment of UGX ' + amt + ' (' + r + ')', L.id);
      L.g.forEach(g => add(SH_GUARANTOR_NOTICES, { 'Timestamp': D(12, 11), 'Event Key': 'repayment|' + r, 'LoanID': L.id, 'BorrowerNo': m.no,
        'GuarantorNo': g.no, 'Event': 'Loan repayment', 'Amount (UGX)': amt, 'Transaction Date': ymd(12), 'Remaining Balance (UGX)': L.total - paid, 'Sent To': g.email }));
      if (isLast) L.g.forEach(g => add(SH_GUARANTOR_NOTICES, { 'Timestamp': D(12, 11), 'Event Key': 'cleared|' + L.id + '|' + r, 'LoanID': L.id,
        'BorrowerNo': m.no, 'GuarantorNo': g.no, 'Event': 'Loan cleared', 'Amount (UGX)': '', 'Transaction Date': ymd(12),
        'Remaining Balance (UGX)': 0, 'Sent To': g.email }));
    }
  });

  // ── surcharges: one per member every 6 months ──
  mm.list.filter(m => m.i > 0 && k % 6 === m.i % 6).forEach(m => {
    const id = ref('SUR', k * M + m.i + 1), by = admin(m.i);
    add(SH_FINES, { 'FineID': id, 'Timestamp': D(8, 15), 'MemberNo': m.no, 'Date': D(8), 'Amount (UGX)': 5000,
      'Reason': 'Late monthly premium', 'Status': cal.last ? 'Unpaid' : 'Paid', 'Recorded By': by });
    audit(D(8, 15), 'Surcharge Issued', m.no, by, 'UGX 5,000. Reason: Late monthly premium', id);
  });

  // ── investments: a valuation per investment per month; a loan-fund injection per quarter ──
  [1, 2, 3].forEach(n => add(SH_INV_TX, { 'TxID': ref('IVT', k * 3 + n), 'Timestamp': D(25, 10), 'InvestmentID': 'INV-' + benchPad_(n, 6),
    'Date': D(25), 'Tx Type': k === 0 ? 'Initial Investment' : 'Valuation', 'Amount (UGX)': 1000000 * n + k * 10000, 'Cost Source': '',
    'Reference': '', 'Notes': '', 'Linked Entry': '', 'Reverses': '', 'Status': 'Approved', 'Initiated By': admin(n), 'Approver 1': admin(n + 1),
    'Approver 1 At': D(25, 12), 'Approver 2': admin(n + 2), 'Approver 2 At': D(25, 14), 'Decision Notes': '', 'Decided By': admin(n + 2) }));
  if (k % 3 === 0) add(SH_LOAN_FUND, { 'EntryID': ref('LFE', k + 1), 'Timestamp': D(5, 10), 'Date': D(5), 'Entry Type': 'Cash Injection',
    'Amount (UGX)': 5000000, 'Reference': 'BENCH-' + k, 'Description': 'Bench cash injection', 'Investment ID': '', 'Linked Entry': '',
    'Reverses': '', 'Status': 'Approved', 'Initiated By': admin(1), 'Approver 1': admin(2), 'Approver 1 At': D(5, 12),
    'Approver 2': admin(3), 'Approver 2 At': D(5, 14), 'Decision Notes': '', 'Decided By': admin(3) });
  return out;
}

// Header-ordered arrays from row objects. headers: the tab's header row as written by the app's setup.
function benchToArrays_(headers, objs) {
  return objs.map(o => headers.map(h => (o[h] === undefined || o[h] === null) ? '' : o[h]));
}
