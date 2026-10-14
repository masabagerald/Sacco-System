// ── INVESTMENT TRACKER: figures per investment and for the portfolio ──────────
// Only Approved investment transactions count (see ApprovalLedgerService). A reversal is dated when it
// is approved and cancels its original from then on; a reversed valuation is ignored altogether.
//
// For each investment, up to a date:
//   net invested   = contributions + income reinvested - redemptions - fees/taxes deducted from its balance
//   current value  = the latest valuation, carried forward by any contributions/redemptions/deductions
//                    made after it; with no valuation, the investment is shown at net invested (cost)
//   income         = income received (cash) + income reinvested + accrued income not yet received, where
//                    accrued = income earned less income received/reinvested (never below zero) -- so a
//                    return recorded as earned and later as received is counted once
//   capital gain   = current value - net invested (only when there is a valuation)
//   net return     = income - fees - taxes + capital gain
// Valuations are entered by hand: there is no market-data feed.

const INV_FLOW_KEYS = { 'Initial Investment': 'contributed', 'Additional Contribution': 'contributed', 'Redemption': 'redeemed',
  'Income Earned': 'incomeEarned', 'Income Received': 'incomeReceived', 'Income Reinvested': 'incomeReinvested', 'Fee': 'fees', 'Tax': 'taxes' };
const INV_COST_KEYS = ['fees', 'taxes'];

// Approved flows and valuations of one investment
function _investmentAtoms(txRows, investmentId) {
  const rows = txRows.filter(r => String(r['InvestmentID'] || '').trim() === investmentId);
  const byId = {};
  rows.forEach(r => { byId[String(r['TxID'] || '').trim()] = r; });
  const atoms = [], valuations = [], reversedValuation = {};
  rows.filter(r => String(r['Status'] || '').trim() === 'Approved').forEach(r => {
    let type = String(r['Tx Type'] || '').trim(), src = r, sign = 1;
    const date = _dstr(r['Date']), amount = num(r['Amount (UGX)']);
    if (!date) return;
    if (type === ENTRY_REVERSAL) {
      src = byId[String(r['Reverses'] || '').trim()]; if (!src) return;
      type = String(src['Tx Type'] || '').trim(); sign = -1;
      if (type === 'Valuation') { reversedValuation[String(src['TxID']).trim()] = true; return; }
    }
    if (type === 'Valuation') { valuations.push({ date, value: amount, txId: String(r['TxID']).trim() }); return; }
    const key = INV_FLOW_KEYS[type]; if (!key) return;
    atoms.push({ date, key, amount: sign * amount, fromBalance: String(src['Cost Source'] || '').trim() === INV_COST_SOURCES[0],
      linked: !!String(src['Linked Entry'] || '').trim() });
  });
  return { atoms, valuations: valuations.filter(v => !reversedValuation[v.txId]).sort((a, b) => a.date.localeCompare(b.date) || a.txId.localeCompare(b.txId)) };
}

// How a flow moves the investment's own balance (what its value is carried forward by)
function _invBalanceMove(a) {
  if (a.key === 'contributed' || a.key === 'incomeReinvested') return a.amount;
  if (a.key === 'redeemed') return -a.amount;
  if (INV_COST_KEYS.indexOf(a.key) > -1 && a.fromBalance) return -a.amount;
  return 0;
}

// Figures for one investment at the end of day d ('' = before anything happened)
function _investmentAt(ia, d) {
  const t = { contributed: 0, redeemed: 0, incomeEarned: 0, incomeReceived: 0, incomeReinvested: 0, fees: 0, taxes: 0,
    costsFromBalance: 0, transfersToLoanFund: 0, transfersFromLoanFund: 0 };
  const upTo = ia.atoms.filter(a => d && a.date <= d);
  upTo.forEach(a => {
    t[a.key] += a.amount;
    if (INV_COST_KEYS.indexOf(a.key) > -1 && a.fromBalance) t.costsFromBalance += a.amount;
    if (a.linked && a.key === 'redeemed') t.transfersToLoanFund += a.amount;
    if (a.linked && a.key === 'contributed') t.transfersFromLoanFund += a.amount;
  });
  Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
  const netInvested = r2(upTo.reduce((s, a) => s + _invBalanceMove(a), 0));
  const v = ia.valuations.filter(x => d && x.date <= d).pop() || null;
  const value = v ? r2(v.value + upTo.filter(a => a.date > v.date).reduce((s, a) => s + _invBalanceMove(a), 0)) : netInvested;
  const incomeReceivedTotal = r2(t.incomeReceived + t.incomeReinvested);
  const accruedIncome = Math.max(0, r2(t.incomeEarned - incomeReceivedTotal));
  const incomeTotal = r2(incomeReceivedTotal + accruedIncome);
  const costs = r2(t.fees + t.taxes);
  const capitalGain = v ? r2(value - netInvested) : 0;
  return Object.assign(t, { netInvested, value, valued: !!v, valuationDate: v ? v.date : '', valuationAmount: v ? v.value : 0,
    incomeReceivedTotal, accruedIncome, incomeTotal, costs, capitalGain, netReturn: r2(incomeTotal - costs + capitalGain) });
}

// Change in each flow between two points: (later - earlier) for the period's totals
function _investmentPeriod(a, b) {
  const out = {};
  ['contributed', 'redeemed', 'incomeEarned', 'incomeReceived', 'incomeReinvested', 'fees', 'taxes', 'costs',
    'transfersToLoanFund', 'transfersFromLoanFund', 'incomeTotal', 'netReturn'].forEach(k => { out[k] = r2(b[k] - a[k]); });
  return out;
}

const INV_SUM_KEYS = ['contributed', 'redeemed', 'incomeEarned', 'incomeReceived', 'incomeReinvested', 'fees', 'taxes', 'costs',
  'transfersToLoanFund', 'transfersFromLoanFund', 'netInvested', 'value', 'incomeReceivedTotal', 'accruedIncome', 'incomeTotal',
  'capitalGain', 'netReturn'];
function _sumInto(acc, x, keys) { keys.forEach(k => { acc[k] = r2((acc[k] || 0) + (x[k] || 0)); }); return acc; }

// Masks an account number for lists: '•••• 1234'
function _maskRef(s) { s = String(s || '').trim(); return s.length > 4 ? '•••• ' + s.slice(-4) : s; }

// Portfolio dashboard. invRows: Investments; txRows: Investment Transactions. from/to 'yyyy-MM-dd'.
function _portfolioFromRows(invRows, txRows, from, to, today) {
  to = to || today;
  const invs = invRows.filter(r => String(r['InvestmentID'] || '').trim()).map(r => {
    const id = String(r['InvestmentID']).trim();
    return { id, row: r, ia: _investmentAtoms(txRows, id) };
  });
  const firstDate = invs.reduce((m, x) => x.ia.atoms.concat(x.ia.valuations).reduce((mm, a) => (!mm || a.date < mm ? a.date : mm), m), '');
  const start = from || firstDate || to;
  const before = _dayBefore(start);

  const totals = {}, period = {}, byType = {}, byProvider = {};
  let realizedGain = 0, unrealizedGain = 0;
  const list = invs.map(x => {
    const r = x.row, at = _investmentAt(x.ia, to), p = _investmentPeriod(_investmentAt(x.ia, before), at);
    const status = String(r['Status'] || 'Active').trim();
    _sumInto(totals, at, INV_SUM_KEYS); _sumInto(period, p, Object.keys(p));
    if (status === 'Closed') realizedGain = r2(realizedGain + at.capitalGain); else unrealizedGain = r2(unrealizedGain + at.capitalGain);
    const type = String(r['Type'] || 'Other').trim(), prov = String(r['Provider'] || '-').trim();
    _sumInto(byType[type] || (byType[type] = { name: type, count: 0 }), at, ['netInvested', 'value', 'incomeTotal', 'netReturn']).count++;
    _sumInto(byProvider[prov] || (byProvider[prov] = { name: prov, count: 0 }), at, ['netInvested', 'value', 'incomeTotal', 'netReturn']).count++;
    return { id: x.id, name: String(r['Name'] || ''), type, provider: prov, currency: String(r['Currency'] || INVESTMENT_CURRENCY),
      startDate: _dstr(r['Start Date']), maturityDate: _dstr(r['Maturity Date']), status, accountRef: _maskRef(r['Account Reference']),
      notes: String(r['Notes'] || ''), documentLink: String(r['Document Link'] || ''), figures: at, period: p };
  });
  const horizon = fmt_date(_addDays(_ymd(today), MATURITY_WINDOW_DAYS));
  const maturities = list.filter(i => i.status === 'Active' && i.maturityDate && i.maturityDate >= today && i.maturityDate <= horizon)
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
    .map(i => ({ id: i.id, name: i.name, provider: i.provider, maturityDate: i.maturityDate, value: i.figures.value }));
  const months = [];
  for (let m = start.slice(0, 7); m <= to.slice(0, 7) && months.length < 240; m = _nextMonth(m)) {
    const lo = m + '-01' < start ? start : m + '-01';
    const end = _monthEnd(m), hi = end > to ? to : end;
    const acc = { month: m, incomeEarned: 0, incomeReceived: 0, incomeReinvested: 0, costs: 0, netReturn: 0, value: 0, netInvested: 0 };
    invs.forEach(x => {
      const a = _investmentAt(x.ia, hi), p = _investmentPeriod(_investmentAt(x.ia, _dayBefore(lo)), a);
      _sumInto(acc, p, ['incomeEarned', 'incomeReceived', 'incomeReinvested', 'costs', 'netReturn']);
      _sumInto(acc, a, ['value', 'netInvested']);
    });
    months.push(acc);
  }
  if (!list.length) INV_SUM_KEYS.forEach(k => { totals[k] = 0; });
  return { range: { from: start, to, allTime: !from }, totals: Object.assign(totals, { realizedGain, unrealizedGain }), period,
    byType: Object.keys(byType).map(k => byType[k]), byProvider: Object.keys(byProvider).map(k => byProvider[k]),
    maturities, investments: list, months,
    valuationsAreManual: true, valuedCount: list.filter(i => i.figures.valued).length };
}

// ── CHECKS ────────────────────────────────────────────────────────────────────

function _investmentRows() { return _readOptional(SH_INVESTMENTS, 'investmentid').rows; }
function _investmentById(id) { return _investmentRows().find(r => String(r['InvestmentID'] || '').trim() === String(id || '').trim()) || null; }

// A redemption may not exceed the investment's current recorded value (with pendingToo, less other
// redemptions still awaiting approval). Returns an error message, or ''.
function _investmentTxError(row, pendingToo) {
  if (String(row['Tx Type'] || '').trim() !== 'Redemption') return '';
  const invId = String(row['InvestmentID'] || '').trim();
  const txRows = _readOptional(SH_INV_TX, 'txid').rows;
  let value = _investmentAt(_investmentAtoms(txRows, invId), today()).value;
  const id = String(row['TxID'] || '').trim();
  if (pendingToo) txRows.filter(r => _isOpenRequest(r) && String(r['InvestmentID'] || '').trim() === invId && String(r['TxID'] || '').trim() !== id
    && String(r['Tx Type'] || '').trim() === 'Redemption').forEach(r => { value -= num(r['Amount (UGX)']); });
  value = r2(value);
  if (num(row['Amount (UGX)']) > value + 0.005)
    return 'The redemption of ' + fmtUGX(num(row['Amount (UGX)'])) + ' is more than the investment\'s current recorded value of ' + fmtUGX(Math.max(value, 0))
      + (pendingToo ? ' (after redemptions awaiting approval)' : '') + '. If its value has grown, record a valuation first.';
  return '';
}

// A strict 'yyyy-MM-dd' check that, unlike validateTxDate, allows future dates (maturity dates)
function _validYmd(s) {
  const m = String(s || '').trim().match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// Checks the details of an investment. Returns { ok, inv } with cleaned values, or { ok:false, error }.
function _validateInvestment(input) {
  const inv = {
    name: String(input.name || '').trim(), type: String(input.type || '').trim(), provider: String(input.provider || '').trim(),
    currency: String(input.currency || INVESTMENT_CURRENCY).trim().toUpperCase(), startDate: String(input.startDate || '').trim(),
    maturityDate: String(input.maturityDate || '').trim(), accountRef: String(input.accountRef || '').trim(),
    status: String(input.status || 'Active').trim(), notes: String(input.notes || '').trim(), documentLink: String(input.documentLink || '').trim()
  };
  if (!inv.name) return { ok: false, error: 'Enter the investment name.' };
  if (INVESTMENT_TYPES.indexOf(inv.type) < 0) return { ok: false, error: 'Choose the investment type.' };
  if (!inv.provider) return { ok: false, error: 'Enter the financial institution or provider.' };
  if (inv.currency !== INVESTMENT_CURRENCY) return { ok: false, error: 'Only ' + INVESTMENT_CURRENCY + ' investments are supported.' };
  const sd = validateTxDate(inv.startDate); if (!sd.ok || !inv.startDate) return { ok: false, error: 'Enter a valid start date (not in the future).' };
  if (inv.maturityDate && (!_validYmd(inv.maturityDate) || inv.maturityDate < inv.startDate)) return { ok: false, error: 'The maturity date must be a valid date on or after the start date.' };
  if (INVESTMENT_STATUSES.indexOf(inv.status) < 0) return { ok: false, error: 'Choose a valid status.' };
  if (inv.documentLink && !/^https:\/\//i.test(inv.documentLink)) return { ok: false, error: 'The document link must start with https://' };
  return { ok: true, inv };
}

// Checks an investment transaction before it is proposed. Returns { ok, fields } or { ok:false, error }.
function _validateInvestmentTx(investmentId, type, amount, txDate, reference, notes, costSource) {
  investmentId = String(investmentId || '').trim(); type = String(type || '').trim();
  const inv = _investmentById(investmentId);
  if (!inv) return { ok: false, error: 'Investment not found.' };
  if (INV_TX_TYPES.indexOf(type) < 0) return { ok: false, error: 'Choose the transaction type.' };
  amount = num(amount);
  if (type === 'Valuation' ? amount < 0 : amount <= 0) return { ok: false, error: type === 'Valuation' ? 'A valuation cannot be negative.' : 'Amount must be greater than zero.' };
  const dv = validateTxDate(txDate); if (!dv.ok) return dv;
  costSource = String(costSource || '').trim();
  if ((type === 'Fee' || type === 'Tax') && INV_COST_SOURCES.indexOf(costSource) < 0) return { ok: false, error: 'Say whether the ' + type.toLowerCase() + ' was deducted from the investment balance or paid separately.' };
  if (type !== 'Fee' && type !== 'Tax') costSource = '';
  if (type === 'Initial Investment') {
    const live = _readOptional(SH_INV_TX, 'txid').rows.filter(r => String(r['InvestmentID'] || '').trim() === investmentId
      && String(r['Tx Type'] || '').trim() === 'Initial Investment' && String(r['Status'] || '').trim() !== 'Rejected');
    const reversed = id => _readOptional(SH_INV_TX, 'txid').rows.some(r => String(r['Reverses'] || '').trim() === id && String(r['Status'] || '').trim() === 'Approved');
    if (live.some(r => !reversed(String(r['TxID']).trim()))) return { ok: false, error: 'This investment already has an initial investment. Record further money as an Additional Contribution.' };
  }
  return { ok: true, inv, fields: { InvestmentID: investmentId, 'Tx Type': type, 'Amount (UGX)': amount, Date: dv.date,
    'Cost Source': costSource, Reference: String(reference || '').trim(), Notes: String(notes || '').trim() } };
}
