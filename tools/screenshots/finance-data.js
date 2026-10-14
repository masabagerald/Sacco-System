// Sample data for the Loan Insights and Investments screenshots. Rather than typing the figures by
// hand, this runs the real server code against the in-memory test spreadsheet (tests/fixtures.js)
// with a made-up year of savings, loans, repayments, loan fund entries and investments, and records
// what the controllers return. Every figure in those screenshots is therefore consistent.
// Dates are relative to the day the screenshots are built.
const { seed, EMAIL } = require('../../tests/fixtures');

const NAMES = { M001: 'Grace Akello', M002: 'Samuel Opio', M003: 'Sarah Nabirye', M004: 'Peter Wanyama',
  M005: 'Mary Kisakye', M006: 'Nancy Achieng', M007: 'Ruth Atim' };

// loadServer() -> { g, fakes, val } with the project's .gs files loaded
function buildFinanceData(loadServer) {
  const { g, fakes, val } = loadServer();
  seed({ g, fakes, val });
  fakes.sheet(val('SH_MEMBERS')).data.forEach(r => { if (NAMES[r[0]]) r[1] = NAMES[r[0]]; });
  g.setupFinanceSchema();
  const must = (r, what) => { if (!r || !r.ok) throw new Error('finance sample data, ' + what + ': ' + JSON.stringify(r)); return r; };
  const ago = days => g.fmt_date(g._addDays(new Date(), -days));
  const addRow = (sheet, o) => {
    const sh = fakes.sheet(val(sheet)); const h = sh.data.findIndex(r => r.some(v => String(v).trim()));
    sh.data.push(sh.data[h].map(k => (k in o ? o[k] : '')));
  };
  const as = email => fakes.signInAs(email);
  // Grace (M001) proposes; Samuel (M002) and Sarah (M003) approve
  const approve = id => { as(EMAIL.BOB); must(g.approveFinanceEntry(id), 'first approval'); as(EMAIL.CAROL); must(g.approveFinanceEntry(id), 'final approval'); as(EMAIL.ALICE); };

  as(EMAIL.ALICE);
  [['M001', 2400000, 330], ['M002', 1800000, 320], ['M003', 900000, 300], ['M004', 1500000, 290], ['M005', 700000, 280], ['M007', 1200000, 270],
   ['M001', 300000, 150], ['M002', 250000, 120], ['M004', 200000, 60], ['M007', 150000, 20]]
    .forEach(([no, amount, days]) => must(g.recordSavings(no, 'Deposit', amount, 'Principal', 'Monthly Premium', '', '', ago(days)), 'savings'));
  must(g.recordSavings('M005', 'Withdrawal', 200000, 'Principal', '', '', '', ago(90)), 'withdrawal');

  let n = 0;
  const loan = (no, principal, days, model, term, surcharge, repayments) => {
    const id = 'L' + String(++n).padStart(3, '0'), issued = ago(days), member = model === 'Member';
    const due = member ? g._addMonths(g._ymd(issued), term) : g._addDays(g._ymd(issued), term);
    addRow('SH_LOANS', { LoanID: id, MemberNo: no, 'Date Issued': issued, 'Principal (UGX)': principal, Status: 'Active', 'Loan Model': model,
      'Processing Fee (UGX)': member ? 5000 : 10000, 'Interest Rate (%)': 10, 'Term (months)': member ? term : '', 'Term (days)': member ? '' : term,
      'Due Date': g.fmt_date(due), 'Overdue Surcharge (UGX)': surcharge || '' });
    repayments.forEach(([amount, d]) => addRow('SH_REPAY', { LoanID: id, Date: ago(d), MemberNo: no, 'Amount (UGX)': amount }));
  };
  loan('M004', 500000, 300, 'Member', 2, 0, [[200000, 260], [355000, 240]]);
  loan('M006', 150000, 250, 'Term', 14, 17500, [[192500, 220]]);
  loan('M005', 300000, 200, 'Member', 3, 0, [[335000, 110]]);
  loan('M007', 400000, 160, 'Member', 2, 0, [[100000, 120]]);
  loan('M004', 250000, 100, 'Member', 2, 0, [[280000, 40]]);
  loan('M006', 120000, 75, 'Term', 14, 0, [[50000, 50]]);
  loan('M002', 600000, 30, 'Member', 2, 0, []);
  loan('M003', 350000, 12, 'Member', 3, 0, []);

  approve(must(g.proposeLoanFundEntry('Cash Injection', 500000, ago(180), 'BANK-1043', 'Grant from the district SACCO programme'), 'injection').entryId);
  approve(must(g.proposeLoanFundEntry('Other Outflow', 45000, ago(95), 'RCPT-221', 'Bank charges and loan register printing'), 'outflow').entryId);
  as(EMAIL.BOB);
  must(g.proposeLoanFundEntry('Cash Injection', 120000, ago(2), 'BANK-1101', 'Donation from the alumni dinner'), 'pending injection');
  as(EMAIL.ALICE);

  const mm = must(g.createInvestment({ name: 'Money Market Fund', type: 'Unit Trust', provider: 'UAP Old Mutual', startDate: ago(280),
    accountRef: 'UT-55102847', initialAmount: 2000000, reference: 'UT-DEP-1' }), 'unit trust');
  approve(mm.txId);
  const tb = must(g.createInvestment({ name: '182-day Treasury Bill', type: 'Treasury Bill', provider: 'Bank of Uganda', startDate: ago(150),
    maturityDate: g.fmt_date(g._addDays(new Date(), 32)), accountRef: 'CSD-77120', initialAmount: 1000000, reference: 'TB-1' }), 'treasury bill');
  approve(tb.txId);
  [[mm, 'Income Earned', 18000, 240], [mm, 'Income Received', 18000, 230], [mm, 'Income Earned', 19500, 200], [mm, 'Income Reinvested', 19500, 195],
   [mm, 'Income Earned', 21000, 140], [mm, 'Income Received', 21000, 130], [mm, 'Valuation', 2085000, 100], [mm, 'Fee', 6000, 95, 'Investment balance'],
   [mm, 'Income Earned', 22000, 60], [tb, 'Income Earned', 45000, 30], [tb, 'Tax', 6750, 29, 'Paid separately']]
    .forEach(([inv, type, amount, days, source]) => approve(must(g.proposeInvestmentTx(inv.investmentId, type, amount, ago(days), '', '', source || ''), type).txId));
  approve(must(g.proposeInvestmentTransfer('toLoanFund', mm.investmentId, 400000, ago(70), 'TRF-7', 'Top up the loan float'), 'transfer').txId);
  as(EMAIL.BOB);
  must(g.proposeInvestmentTx(mm.investmentId, 'Valuation', 1720000, ago(1), 'STMT-SEP', 'Monthly statement', ''), 'pending valuation');

  const call = (email, fns) => { as(email); const out = {}; Object.keys(fns).forEach(k => { out[k] = must(fns[k](), k); }); return out; };
  return {
    admin: call(EMAIL.ALICE, { getLoanInsights: () => g.getLoanInsights({}), getLoanFundEntries: () => g.getLoanFundEntries(),
      getLoanFundLedger: () => g.getLoanFundLedger({}), getInvestmentDashboard: () => g.getInvestmentDashboard({}),
      getInvestmentTransactions: () => g.getInvestmentTransactions('') }),
    founder: call(EMAIL.DAN, { getLoanInsights: () => g.getLoanInsights({}) })
  };
}

module.exports = { buildFinanceData };
