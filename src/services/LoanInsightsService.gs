// ── LOAN INSIGHTS: loan-fund flows, balances and borrower statistics ──────────
// Every figure is derived from the source sheets each time it is asked for (Loans, Loan Repayments,
// Savings, Loan Fund Ledger) -- no dashboard total is ever stored. The functions here take rows, not
// sheets, so they can be tested directly.
//
// Everything is reduced to dated "atoms" { date, key, amount }:
//   disbursed                                      principal paid out on the loan's Date Issued
//   feeCharged / interestCharged / penaltyCharged  amounts owed (not cash)
//   feeCollected / interestCollected / penaltyCollected / principalRepaid / overpaid
//                                                  cash received, split from each repayment in
//                                                  REPAYMENT_ALLOCATION_ORDER
//   savingsIn / savingsOut                         club-wide Principal deposits and withdrawals (the capital)
//   injection / outflow / transferIn / transferOut approved Loan Fund Ledger entries
// A period total sums the atoms dated inside it; a balance sums every atom up to a date. Because
// cash, receivables and the trace ledger all come from the same atoms, they always reconcile.

// Effect of each atom on available loan cash
const CASH_SIGNS = { savingsIn: 1, savingsOut: -1, injection: 1, outflow: -1, transferIn: 1, transferOut: -1,
  principalRepaid: 1, interestCollected: 1, feeCollected: 1, penaltyCollected: 1, overpaid: 1, disbursed: -1 };
const FUND_ENTRY_KEYS = { 'Cash Injection': 'injection', 'Other Outflow': 'outflow',
  'Transfer from Investment': 'transferIn', 'Transfer to Investment': 'transferOut' };
const COLLECTED_KEY = { fee: 'feeCollected', interest: 'interestCollected', penalty: 'penaltyCollected', principal: 'principalRepaid' };
const CHARGED_KEY = { fee: 'feeCharged', interest: 'interestCharged', penalty: 'penaltyCharged', principal: 'disbursed' };

// 'yyyy-MM-dd' from a sheet value ('' if there is none)
function _dstr(v) {
  if (v instanceof Date) return fmt_date(v);
  const m = String(v || '').trim().match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? m[1] : '';
}
function _dayBefore(d) { return fmt_date(_addDays(_ymd(d), -1)); }
function _monthEnd(month) { const p = month.split('-'); return fmt_date(new Date(+p[0], +p[1], 0)); }
function _nextMonth(month) { const p = month.split('-'); return fmt_date(new Date(+p[0], +p[1], 1)).slice(0, 7); }

// ── PER-LOAN BREAKDOWN ────────────────────────────────────────────────────────

// What a loan charges and when: principal, fee and interest on the Date Issued (interest is charged
// on transfer); a penalty from the day after it applies; reducing-balance interest month by month.
function _loanCharges(loan, c) {
  const issued = _dstr(loan['Date Issued']);
  const charges = [{ part: 'principal', date: issued, amount: r2(c.principal) }];
  if (c.model === 'reducing') {
    (c.interestEvents || []).forEach(e => charges.push({ part: 'interest', date: e.date, amount: e.amount }));
    return charges;
  }
  if (c.processingFee > 0) charges.push({ part: 'fee', date: issued, amount: r2(c.processingFee) });
  if (c.interest > 0) charges.push({ part: 'interest', date: issued, amount: r2(c.interest) });
  if (c.penalty > 0) {
    const from = c.model === 'flat' ? _addDays(_ymd(issued), LOAN_DURATION_DAYS + 1) : _addDays(_ymd(c.dueDate), 1);
    charges.push({ part: 'penalty', date: fmt_date(from), amount: r2(c.penalty) });
  }
  return charges;
}

// Splits repayments over the charges. Charges and payments are taken in date order (charges first on
// the same day). Each payment pays the charges already due, part by part in REPAYMENT_ALLOCATION_ORDER;
// anything left over is held as a credit (overpaid) and applied to the next charge that falls due.
// A reversal (a payment with `reverses` set) undoes exactly what its original paid: those charges
// reopen for later payments, and its held credit is withdrawn. If that credit had already been used,
// the credit goes below zero and the next payment makes it good first.
// Returns [{ date, ref, cash, fee, interest, penalty, principal, overpaid }] -- cash is what came in
// that day (0 when a held credit is applied; negative for a reversal); the parts always add up to cash.
function _allocateRepayments(charges, payments) {
  const open = charges.map(ch => ({ part: ch.part, date: ch.date, left: r2(ch.amount) }));
  const order = REPAYMENT_ALLOCATION_ORDER.concat(['principal']).filter((p, i, a) => a.indexOf(p) === i);
  const rank = { charge: 0, pay: 1, rev: 2 };
  const events = charges.map(ch => ({ kind: 'charge', date: ch.date }))
    .concat(payments.map(p => ({ kind: p.reverses ? 'rev' : 'pay', date: p.date, ref: p.ref, reverses: p.reverses || '', amount: r2(p.amount) })))
    .sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]);
  const out = [], byRef = {};
  let credit = 0;
  const apply = (date, amount) => {
    const a = { fee: 0, interest: 0, penalty: 0, principal: 0 }, takes = [];
    let left = amount;
    order.forEach(part => open.forEach(ch => {
      if (ch.part !== part || ch.date > date || left <= 0 || ch.left <= 0) return;
      const take = r2(Math.min(left, ch.left));
      ch.left = r2(ch.left - take); a[part] = r2(a[part] + take); left = r2(left - take); takes.push([ch, take]);
    }));
    return { a, takes, left: left > 0.004 ? left : 0 };
  };
  events.forEach(ev => {
    if (ev.kind === 'pay') {
      const owed = credit < 0 ? Math.min(ev.amount, -credit) : 0;  // makes good a withdrawn credit first
      const r = apply(ev.date, r2(ev.amount - owed));
      credit = r2(credit + owed + r.left);
      const rec = Object.assign({ date: ev.date, ref: ev.ref, cash: ev.amount, overpaid: r2(owed + r.left) }, r.a);
      byRef[ev.ref] = { rec, takes: r.takes, held: r.left };
      out.push(rec);
    } else if (ev.kind === 'rev') {
      const o = byRef[ev.reverses];
      if (!o) { credit = r2(credit + ev.amount); out.push({ date: ev.date, ref: ev.ref, cash: ev.amount, fee: 0, interest: 0, penalty: 0, principal: 0, overpaid: ev.amount }); return; }
      o.takes.forEach(([ch, take]) => { ch.left = r2(ch.left + take); });
      credit = r2(credit - o.held);
      out.push({ date: ev.date, ref: ev.ref, cash: ev.amount, fee: 0 - o.rec.fee, interest: 0 - o.rec.interest, penalty: 0 - o.rec.penalty,
        principal: 0 - o.rec.principal, overpaid: r2(ev.amount + o.rec.fee + o.rec.interest + o.rec.penalty + o.rec.principal) });
      delete byRef[ev.reverses];
    } else if (credit > 0) {
      const r = apply(ev.date, credit);
      const used = r2(credit - r.left);
      if (used > 0) { credit = r.left; out.push(Object.assign({ date: ev.date, ref: 'credit', cash: 0, overpaid: -used }, r.a)); }
    }
  });
  return out;
}

// Everything Loan Insights needs about one loan. allRepayments: rows of Loan Repayments.
function _loanBreakdown(loan, allRepayments) {
  const c = _computeLoan(loan, allRepayments);
  const id = String(loan['LoanID'] || '').trim();
  const issued = _dstr(loan['Date Issued']);
  const charges = _loanCharges(loan, c);
  const payments = allRepayments
    .filter(r => String(r['LoanID'] || '').trim() === id)
    .map(r => ({ date: _dstr(r['Date']), ref: String(r['Reference'] || '').trim() || id + ' / row ' + r._row,
      reverses: String(r['Reverses'] || '').trim(), amount: num(_pick(r, ['Amount (UGX)', 'Total Amount Paid'])) }))
    .filter(p => p.date && p.amount);
  const allocations = _allocateRepayments(charges, payments);
  const atoms = [];
  charges.forEach(ch => atoms.push({ date: ch.date, key: CHARGED_KEY[ch.part], amount: ch.amount, loanId: id }));
  allocations.forEach(a => {
    ['fee', 'interest', 'penalty', 'principal'].forEach(p => { if (a[p]) atoms.push({ date: a.date, key: COLLECTED_KEY[p], amount: a[p], loanId: id }); });
    if (a.overpaid) atoms.push({ date: a.date, key: 'overpaid', amount: a.overpaid, loanId: id });
  });
  let finalDue = c.dueDate || '';
  if (c.model === 'flat') finalDue = fmt_date(_addDays(_ymd(issued), LOAN_DURATION_DAYS));
  if (c.model === 'reducing') finalDue = c.term > 0 ? fmt_date(_addMonths(_ymd(issued), c.term)) : '';
  const sheetStatus = String(loan['Status'] || '').trim();
  return { loanId: id, memberNo: String(loan['MemberNo'] || '').trim(), model: c.model, issued, finalDue,
    principal: r2(c.principal), fee: r2(c.processingFee || 0), term: c.model === 'reducing' ? num(c.term) : 0, sheetStatus,
    // a status other than Active/Cleared (set by hand on the sheet) keeps the loan out of the overdue figures
    otherStatus: !!sheetStatus && sheetStatus !== LOAN_STATUS.ACTIVE && sheetStatus !== LOAN_STATUS.CLEARED,
    flatInst1: c.model === 'flat' ? r2(_flatTerms(c.principal, c.processingFee).inst1) : 0,
    charges, allocations, atoms };
}

// Amount still owed on a loan at the end of day d: charges so far less what has been applied to them,
// plus any credit that a reversal withdrew after it had already paid a charge
function _loanOutstandingAt(b, d) {
  const upTo = b.allocations.filter(a => a.date <= d);
  const charged = b.charges.filter(ch => ch.date <= d).reduce((s, ch) => s + ch.amount, 0);
  const paid = upTo.reduce((s, a) => s + a.fee + a.interest + a.penalty + a.principal, 0);
  const credit = upTo.reduce((s, a) => s + a.overpaid, 0);
  return Math.max(0, r2(charged - paid + Math.max(0, -credit)));
}

// Overdue at the end of day d -- the same rules _computeLoan uses for "today", applied to any date.
function _loanOverdueAt(b, d) {
  if (b.otherStatus || !b.issued || b.issued > d) return false;
  const owed = _loanOutstandingAt(b, d);
  if (owed <= 0.5) return false;
  if (b.model === 'member' || b.model === 'term') return !!b.finalDue && d > b.finalDue;
  if (b.model === 'flat') {
    const d1 = fmt_date(_addDays(_ymd(b.issued), LOAN_FIRST_INSTALMENT_DAYS));
    const charged = b.charges.filter(ch => ch.date <= d && ch.part !== 'principal').reduce((s, ch) => s + ch.amount, 0);
    let required = 0;
    if (d >= d1) required += b.flatInst1;
    if (d >= b.finalDue) required += b.principal + charged - b.flatInst1;
    const repaid = b.allocations.filter(a => a.date <= d).reduce((s, a) => s + a.cash, 0);
    return repaid < required - 0.5;
  }
  return b.term > 0 && Math.floor((_ymd(d) - _ymd(b.issued)) / (1000 * 60 * 60 * 24 * 30.44)) > b.term;
}

// ── LOAN FUND CAPITAL AND LEDGER ENTRIES ──────────────────────────────────────

// Principal savings movements as atoms (other accounts are not loan-fund capital)
function _savingsAtoms(savRows) {
  const atoms = [];
  savRows.forEach(r => {
    if (!String(r['MemberNo'] || '').trim() || _accountOf(r) !== 'Principal') return;
    const date = _dstr(r['Date']); if (!date) return;
    const amt = num(r['Amount (UGX)']);
    const t = _txType(r).toLowerCase();
    if (t === 'deposit') atoms.push({ date, key: 'savingsIn', amount: amt });
    else if (t === 'deposit reversal') atoms.push({ date, key: 'savingsIn', amount: -amt });
    else if (t === 'withdrawal') atoms.push({ date, key: 'savingsOut', amount: amt });
    else if (t === 'withdrawal reversal') atoms.push({ date, key: 'savingsOut', amount: -amt });
  });
  return atoms;
}

// Approved Loan Fund Ledger entries as atoms. A reversal takes its original's key with the amount negated.
function _fundAtoms(fundRows) {
  const byId = {};
  fundRows.forEach(r => { byId[String(r['EntryID'] || '').trim()] = r; });
  const atoms = [];
  fundRows.filter(r => String(r['Status'] || '').trim() === 'Approved').forEach(r => {
    const type = String(r['Entry Type'] || '').trim();
    const date = _dstr(r['Date']); if (!date) return;
    let key = FUND_ENTRY_KEYS[type], amount = num(r['Amount (UGX)']);
    if (type === ENTRY_REVERSAL) {
      const orig = byId[String(r['Reverses'] || '').trim()];
      key = orig && FUND_ENTRY_KEYS[String(orig['Entry Type'] || '').trim()];
      amount = -amount;
    }
    if (key) atoms.push({ date, key, amount, entryId: String(r['EntryID'] || '').trim() });
  });
  return atoms;
}

function _sumAtoms(atoms, from, to) {
  const t = {};
  Object.keys(CASH_SIGNS).concat(['feeCharged', 'interestCharged', 'penaltyCharged']).forEach(k => { t[k] = 0; });
  atoms.forEach(a => { if ((!from || a.date >= from) && (!to || a.date <= to)) t[a.key] = (t[a.key] || 0) + a.amount; });
  Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
  return t;
}

function _cashOf(t) { return r2(Object.keys(CASH_SIGNS).reduce((s, k) => s + CASH_SIGNS[k] * (t[k] || 0), 0)); }

// Point-in-time balances from atom totals up to a date
function _balancesOf(t) {
  const b = {
    availableCash: _cashOf(t),
    outstandingPrincipal: r2(t.disbursed - t.principalRepaid),
    interestOutstanding: r2(t.interestCharged - t.interestCollected),
    feesOutstanding: r2(t.feeCharged - t.feeCollected),
    penaltiesOutstanding: r2(t.penaltyCharged - t.penaltyCollected),
    borrowerCredit: r2(t.overpaid)  // overpayments held for borrowers: in cash, but owed back
  };
  b.fundPosition = r2(b.availableCash + b.outstandingPrincipal + b.interestOutstanding + b.feesOutstanding + b.penaltiesOutstanding - b.borrowerCredit);
  return b;
}

// Flows within a period, from atom totals for that period
function _flowsOf(t) {
  const cashReceived = r2(t.principalRepaid + t.interestCollected + t.feeCollected + t.penaltyCollected + t.overpaid);
  return {
    disbursed: t.disbursed, principalRepaid: t.principalRepaid,
    interestCharged: t.interestCharged, interestCollected: t.interestCollected,
    feesCharged: t.feeCharged, feesCollected: t.feeCollected,
    penaltiesCharged: t.penaltyCharged, penaltiesCollected: t.penaltyCollected,
    overpaid: t.overpaid, cashReceived,
    savingsIn: t.savingsIn, savingsOut: t.savingsOut, savingsNet: r2(t.savingsIn - t.savingsOut),
    injections: t.injection, outflows: t.outflow, transfersIn: t.transferIn, transfersOut: t.transferOut,
    netCashFlow: _cashOf(t)
  };
}

// ── THE DASHBOARD ─────────────────────────────────────────────────────────────

// data: { loans, reps, savRows, fundRows, members } (sheet rows). from/to: 'yyyy-MM-dd' ('' from = all time).
// today: 'yyyy-MM-dd'. Returns the aggregate figures; perLoan adds the per-loan rows (admins only).
function _loanInsightsFromRows(data, from, to, today, perLoan) {
  to = to || today;
  const typeOf = {}, nameOf = {};
  (data.members || []).forEach(m => {
    const no = String(m['MemberNo'] || '').trim();
    typeOf[no] = String(m['Membership Type'] || '').trim(); nameOf[no] = m['Full Name'] || '';
  });
  const breakdowns = _loanBreakdowns(data);
  const atoms = _loanFundAtoms(data, breakdowns);
  const firstDate = atoms.reduce((m, a) => (!m || a.date < m ? a.date : m), '');
  const start = from || firstDate || to;

  const period = _flowsOf(_sumAtoms(atoms, start, to));
  const closingT = _sumAtoms(atoms, '', to);
  const closing = _balancesOf(closingT);
  const opening = _balancesOf(_sumAtoms(atoms, '', _dayBefore(start)));
  const cumulative = _flowsOf(closingT);

  const overdueAt = d => {
    const list = breakdowns.filter(b => _loanOverdueAt(b, d));
    return { count: list.length, amount: r2(list.reduce((s, b) => s + _loanOutstandingAt(b, d), 0)), loanIds: list.map(b => b.loanId) };
  };
  const od = overdueAt(to);
  closing.overdueCount = od.count; closing.overdueAmount = od.amount;
  closing.activeLoans = breakdowns.filter(b => b.issued <= to && _loanOutstandingAt(b, to) > 0.5).length;

  // Borrowers: a client counts once however many loans they took in the period
  const firstLoanOf = {};
  breakdowns.forEach(b => { if (!firstLoanOf[b.memberNo] || b.issued < firstLoanOf[b.memberNo]) firstLoanOf[b.memberNo] = b.issued; });
  const borrowerStats = (lo, hi) => {
    const inRange = breakdowns.filter(b => b.issued >= lo && b.issued <= hi);
    const unique = [...new Set(inRange.map(b => b.memberNo))];
    const isNew = no => firstLoanOf[no] >= lo;
    return { unique: unique.length, loans: inRange.length, newBorrowers: unique.filter(isNew).length,
      repeatBorrowers: unique.filter(no => !isNew(no)).length, list: inRange, members: unique };
  };
  const bs = borrowerStats(start, to);
  const byType = {};
  MEMBERSHIP_TYPES.concat(['Not set']).forEach(t => { byType[t] = { type: t, borrowers: 0, loans: 0, disbursed: 0, feesCharged: 0 }; });
  bs.members.forEach(no => { byType[typeOf[no] || 'Not set'].borrowers++; });
  bs.list.forEach(b => { const x = byType[typeOf[b.memberNo] || 'Not set']; x.loans++; x.disbursed = r2(x.disbursed + b.principal); x.feesCharged = r2(x.feesCharged + b.fee); });

  // Month by month: flows inside each month (clipped to the range) and balances at each month's end
  const months = [];
  for (let m = start.slice(0, 7); m <= to.slice(0, 7) && months.length < 240; m = _nextMonth(m)) {
    const lo = m + '-01' < start ? start : m + '-01';
    const end = _monthEnd(m), hi = end > to ? to : end;
    const f = _flowsOf(_sumAtoms(atoms, lo, hi));
    const bal = _balancesOf(_sumAtoms(atoms, '', hi));
    const o = overdueAt(hi);
    const mb = borrowerStats(lo, hi);
    months.push({ month: m, from: lo, to: hi, disbursed: f.disbursed, principalRepaid: f.principalRepaid,
      interestCollected: f.interestCollected, feesCollected: f.feesCollected, penaltiesCollected: f.penaltiesCollected,
      savingsNet: f.savingsNet, injections: r2(f.injections + f.transfersIn), outflows: r2(f.outflows + f.transfersOut),
      availableCash: bal.availableCash, outstandingPrincipal: bal.outstandingPrincipal,
      overdueCount: o.count, overdueAmount: o.amount, borrowers: mb.unique, loans: mb.loans });
  }

  const res = { range: { from: start, to, allTime: !from }, period: Object.assign(period, { loansIssued: bs.loans }),
    opening: { availableCash: opening.availableCash }, closing, cumulative,
    borrowers: { unique: bs.unique, loans: bs.loans, newBorrowers: bs.newBorrowers, repeatBorrowers: bs.repeatBorrowers,
      everServed: Object.keys(firstLoanOf).filter(no => firstLoanOf[no] <= to).length,
      byMembershipType: Object.keys(byType).map(k => byType[k]).filter(x => x.loans || MEMBERSHIP_TYPES.indexOf(x.type) > -1) },
    months };
  if (perLoan) {
    res.loans = breakdowns
      .filter(b => b.issued <= to && ((b.issued >= start) || _loanOutstandingAt(b, to) > 0.5 || b.allocations.some(a => a.date >= start && a.date <= to)))
      .map(b => {
        const s = (part, lo, hi) => r2(b.allocations.filter(a => a.date >= lo && a.date <= hi).reduce((x, a) => x + a[part], 0));
        const ch = part => r2(b.charges.filter(c => c.part === part && c.date <= to).reduce((x, c) => x + c.amount, 0));
        return { loanId: b.loanId, memberNo: b.memberNo, name: nameOf[b.memberNo] || '', membershipType: typeOf[b.memberNo] || '',
          issued: b.issued, dueDate: b.finalDue, principal: b.principal, feeCharged: ch('fee'), interestCharged: ch('interest'), penaltyCharged: ch('penalty'),
          principalRepaid: s('principal', '', to), interestCollected: s('interest', '', to), feesCollected: s('fee', '', to), penaltiesCollected: s('penalty', '', to),
          outstanding: _loanOutstandingAt(b, to), overdue: od.loanIds.indexOf(b.loanId) > -1, status: b.sheetStatus || LOAN_STATUS.ACTIVE };
      })
      .sort((a, b) => b.issued.localeCompare(a.issued));
  }
  return res;
}

// Every cash movement of the loan fund in date order, with a running balance -- the trace behind
// "available loan cash". Opening balance is the cash before `from`; the last balance equals the
// dashboard's closing available cash for the same `to`. Admin only (it names members).
function _loanFundLedgerFromRows(data, from, to, today) {
  to = to || today;
  const nameOf = {};
  (data.members || []).forEach(m => { nameOf[String(m['MemberNo'] || '').trim()] = m['Full Name'] || ''; });
  const lines = [];
  data.loans.filter(l => String(l['LoanID'] || '').trim() && _dstr(l['Date Issued'])).forEach(l => {
    const b = _loanBreakdown(l, data.reps);
    const who = b.memberNo + (nameOf[b.memberNo] ? ' ' + nameOf[b.memberNo] : '');
    lines.push({ date: b.issued, source: 'Loans', ref: b.loanId, kind: 'Loan disbursement', description: who, amount: -b.principal });
    b.allocations.filter(a => a.cash).forEach(a => {
      const rev = a.cash < 0, amt = v => fmtUGX(rev ? -v : v).replace('UGX ', '');
      const parts = ['fee', 'interest', 'penalty', 'principal'].filter(p => a[p]).map(p => p + ' ' + amt(a[p]));
      if (a.overpaid) parts.push('credit ' + (rev ? 'withdrawn ' : 'held ') + amt(a.overpaid));
      lines.push({ date: a.date, source: 'Loan Repayments', ref: a.ref, kind: rev ? 'Repayment reversal' : 'Repayment',
        description: who + ' -- ' + (rev ? 'takes back ' : '') + parts.join(', '), amount: a.cash });
    });
  });
  data.savRows.forEach(r => {
    if (!String(r['MemberNo'] || '').trim() || _accountOf(r) !== 'Principal') return;
    const date = _dstr(r['Date']); const sign = _txSign(_txType(r)); if (!date || !sign) return;
    const no = String(r['MemberNo']).trim();
    lines.push({ date, source: 'Savings', ref: String(r['Reference'] || ''), kind: 'Principal ' + _txType(r).toLowerCase(),
      description: no + (nameOf[no] ? ' ' + nameOf[no] : ''), amount: sign * num(r['Amount (UGX)']) });
  });
  const fundRows = data.fundRows || [];
  _fundAtoms(fundRows).forEach(a => {
    const r = fundRows.find(x => String(x['EntryID'] || '').trim() === a.entryId);
    lines.push({ date: a.date, source: 'Loan Fund Ledger', ref: a.entryId, kind: String(r['Entry Type'] || ''),
      description: String(r['Description'] || '') + (r['Reverses'] ? ' (reverses ' + r['Reverses'] + ')' : ''), amount: CASH_SIGNS[a.key] * a.amount });
  });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const opening = r2(lines.filter(l => from && l.date < from).reduce((s, l) => s + l.amount, 0));
  let bal = opening;
  const rows = lines.filter(l => (!from || l.date >= from) && l.date <= to).map(l => {
    bal = r2(bal + l.amount);
    return Object.assign({}, l, { amount: r2(l.amount), balance: bal });
  });
  return { opening, closing: bal, rows };
}

// ── DATA AND CASH CHECKS ──────────────────────────────────────────────────────

function _loanBreakdowns(data) {
  return data.loans.filter(l => String(l['LoanID'] || '').trim() && _dstr(l['Date Issued'])).map(l => _loanBreakdown(l, data.reps));
}

// Every atom of the loan fund: loans, Principal savings and approved ledger entries
function _loanFundAtoms(data, breakdowns) {
  return [].concat(...(breakdowns || _loanBreakdowns(data)).map(b => b.atoms), _savingsAtoms(data.savRows), _fundAtoms(data.fundRows || []));
}

// The rows Loan Insights reads. The Loan Fund Ledger may not exist until setupFinanceSchema() has run.
function _loanFundData() {
  return { loans: readSheet(SH_LOANS, 'loanid').rows, reps: readSheet(SH_REPAY, 'loanid').rows,
    savRows: readSheet(SH_SAVINGS, 'memberno').rows, fundRows: _readOptional(SH_LOAN_FUND, 'entryid').rows,
    members: readSheet(SH_MEMBERS, 'memberno').rows };
}

// Effect of a Loan Fund Ledger row on available cash: +amount, -amount (a reversal flips its original)
function _fundEntryEffect(row, fundRows) {
  const type = String(row['Entry Type'] || '').trim(), amt = num(row['Amount (UGX)']);
  if (type !== ENTRY_REVERSAL) return (FUND_ENTRY_SIGNS[type] || 0) * amt;
  const orig = fundRows.find(r => String(r['EntryID'] || '').trim() === String(row['Reverses'] || '').trim());
  return orig ? -(FUND_ENTRY_SIGNS[String(orig['Entry Type'] || '').trim()] || 0) * amt : 0;
}

// An entry that takes cash out of the loan fund (an outflow, a transfer to an investment, or the
// reversal of an injection) may not take today's available loan cash below zero. With pendingToo,
// entries still awaiting approval are counted as well, so two proposals cannot overdraw it between them.
// Returns an error message, or ''.
function _fundCashError(row, pendingToo) {
  const data = _loanFundData();
  const effect = _fundEntryEffect(row, data.fundRows);
  if (effect >= 0) return '';
  let cash = _cashOf(_sumAtoms(_loanFundAtoms(data), '', today()));
  const id = String(row['EntryID'] || '').trim();
  if (pendingToo) data.fundRows.filter(r => _isOpenRequest(r) && String(r['EntryID'] || '').trim() !== id).forEach(r => {
    const e = _fundEntryEffect(r, data.fundRows); if (e < 0) cash += e;
  });
  cash = r2(cash);
  if (cash + effect < -0.005)
    return 'Not enough available loan cash: ' + fmtUGX(Math.max(cash, 0)) + (pendingToo ? ' after entries awaiting approval' : '') + ', but this entry takes out ' + fmtUGX(-effect) + '.';
  return '';
}
