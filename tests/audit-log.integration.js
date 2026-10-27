// Audit log at scale: writes append without reading the log, the Audit tab reads only the newest rows,
// and the CSV download (by date range, in pages the browser joins) covers every entry exactly once.
// Real controllers against an in-memory spreadsheet.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, DAN } = EMAIL;
const HEADERS = ['Timestamp', 'Action', 'Member (Affected)', 'Performed By', 'Details', 'Reference ID'];
const CSV_HEADERS = ['Timestamp', 'Action', 'Category', 'Member (Affected)', 'Member Name', 'Performed By', 'Performed By Name', 'Details', 'Reference ID'];

// Audit tab with a title above the header (as on the real tab) and `n` entries, one a minute from 2025-01-01
function bigLog(ctx, n) {
  const rows = [['Audit Log'], [], HEADERS];
  const t0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i++) {
    const ts = new Date(t0 + i * 60000).toISOString().replace('T', ' ').slice(0, 19);
    rows.push([ts, 'Action ' + i, 'M004', 'M001', 'entry ' + i, 'R' + i]);
  }
  return ctx.fakes.addSheet(ctx.val('SH_AUDIT'), rows);
}

// Counts the cells each sheet read touches; getDataRange (a whole-sheet read) fails the test
function watchReads(sh) {
  const seen = { cells: 0 };
  const getRange = sh.getRange.bind(sh);
  sh.getRange = (r, c, nr, nc) => { const rg = getRange(r, c, nr, nc); const gv = rg.getValues.bind(rg);
    rg.getValues = () => { seen.cells += (nr || 1) * (nc || 1); return gv(); }; return rg; };
  sh.getDataRange = () => { throw new Error('the whole audit log was read'); };
  return seen;
}

// Every page of an export, joined as the browser does
function download(g, from, to, more) {
  const parts = []; let offset = 0, res, pages = 0;
  do { res = ok(g.exportAuditLogCsv(Object.assign({ from, to }, more), offset), 'export page'); parts.push(res.csv); offset = res.nextOffset; pages++; }
  while (offset != null);
  return { lines: parts.join('\n').split('\n'), total: res.total, fileName: res.fileName, pages };
}

module.exports = {
  'recording an action appends one row without reading the log'(c) {
    const ctx = seed(c), { g } = ctx;
    const sh = bigLog(ctx, 2000);
    watchReads(sh);
    g.auditLog('Deposit', 'M004', 'M001', 'UGX 10,000', 'S1');
    g.auditLog('Withdrawal', 'M004', 'M001', 'UGX 5,000', 'S2');
    const recs = sh.records('timestamp');
    assert.strictEqual(recs.length, 2002);
    assert.deepStrictEqual(recs.slice(-2).map(r => [r.Action, r['Member (Affected)'], r['Reference ID']]),
      [['Deposit', 'M004', 'S1'], ['Withdrawal', 'M004', 'S2']], 'appended at the bottom, in order');
  },

  'the Audit tab reads one column of a long log plus the page it shows'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const sh = bigLog(ctx, 5000);
    const seen = watchReads(sh);
    fakes.signInAs(ALICE);
    const res = ok(g.getAuditLog(200), 'audit log');
    assert.strictEqual(res.entries.length, 200);
    assert.strictEqual(res.entries[0].action, 'Action 4999', 'newest first');
    assert.strictEqual(res.entries[199].action, 'Action 4800');
    assert.strictEqual(res.total, 5000);
    assert.ok(seen.cells <= 5000 + 10 * 6 + 200 * 6, 'read ' + seen.cells + ' cells for 200 entries');
  },

  'the CSV download covers a date range, joined from pages, each entry once'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    bigLog(ctx, 45000);  // 1 Jan 2025 00:00 to 1 Feb 2025 05:59, one a minute
    fakes.signInAs(ALICE);

    const all = download(g, '', '');
    assert.strictEqual(all.pages, 3, 'pages of 20,000');
    assert.strictEqual(all.total, 45000);
    assert.strictEqual(all.lines[0], CSV_HEADERS.join(','), 'the header comes once, first');
    assert.strictEqual(all.lines.length, 45001);
    assert.deepStrictEqual(all.lines.slice(1).map(l => l.split(',')[8]), Array.from({ length: 45000 }, (_, i) => 'R' + i),
      'every entry once, oldest first');
    assert.match(all.fileName, /_Audit_Log_start_to_\d{4}-\d{2}-\d{2}\.csv$/);

    const day = download(g, '2025-01-10', '2025-01-10');
    assert.strictEqual(day.total, 1440, 'one day, both ends inclusive');
    assert.strictEqual(day.lines[1].split(',')[0], '2025-01-10 00:00:00');
    assert.strictEqual(day.lines[1440].split(',')[0], '2025-01-10 23:59:00');
    assert.match(day.fileName, /_Audit_Log_2025-01-10_to_2025-01-10\.csv$/);

    assert.strictEqual(download(g, '', '2025-01-01').total, 1440, 'open-ended range');
    assert.strictEqual(download(g, '2024-01-01', '2024-12-31').lines.length, 1, 'no matches: header only');

    const logged = ctx.audit().filter(a => a.Action === 'Audit Log Export');
    assert.strictEqual(logged.length, 4, 'each download is logged once, not once per page');
    assert.match(logged[1].Details, /2025-01-10 to 2025-01-10 \(1440 entries\)/);
  },

  'the CSV keeps date-time cells, quotes commas and neutralises formulas'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const D = ctx.val('Date');  // Sheets returns the script's own Date for date-time cells
    const sh = fakes.sheet(ctx.val('SH_AUDIT'));
    sh.data.push([new D(2025, 9, 18, 14, 30, 5), 'Note', 'M004', 'M001', 'Paid 10,000 "cash"', 'R1']);
    sh.data.push(['2025-10-19 08:00:00', 'Note', 'M004', 'M001', '=HYPERLINK("x")', 'R2']);
    fakes.signInAs(ALICE);
    const { lines } = download(g, '2025-10-18', '2025-10-19');
    assert.strictEqual(lines[1], '2025-10-18 14:30:05,Note,Other,M004,Dan,M001,Alice,"Paid 10,000 ""cash""",R1');
    assert.strictEqual(lines[2], '2025-10-19 08:00:00,Note,Other,M004,Dan,M001,Alice,"\'=HYPERLINK(""x"")",R2');
  },

  'every action the app records gets a category, and the risky ones are flagged'(c) {
    const { g } = seed(c);
    const expect = {
      'Deposit': ['Savings', false], 'Withdrawal Fully Approved': ['Savings', false], 'Surcharge Issued': ['Savings', false],
      'Contribution Corrected': ['Savings', true], 'Savings Reversal': ['Savings', true],
      'Loan Request First Approval': ['Loans', false], 'Guarantor Consent Given': ['Loans', false], 'Waiver Approved': ['Loans', false],
      'Loan Repayment Reversed': ['Loans', true], 'Guarantor Restriction Override': ['Loans', true],
      'Investment Transaction Proposed': ['Investments', false], 'Loan Fund Entry Approved': ['Investments', false],
      'Loan Fund Entry Reversal Proposed': ['Investments', true],
      'Asset Registered': ['Assets', false], 'Asset Disposed': ['Assets', true],
      'Member Added': ['Members', false], 'Member Updated': ['Members', true],
      'Asset Register Export': ['Exports', true], 'Admin CSV Export': ['Exports', true], 'Statement Generated': ['Exports', false],
      'Terms Accepted': ['System', false], 'Terms Updated': ['System', true], 'Member Numbers Migrated': ['System', true],
      'Backup Created': ['System', true], 'Pending Action Reminders': ['System', false],
      'Something New': ['Other', false]
    };
    Object.keys(expect).forEach(a => assert.deepStrictEqual([g._auditCategory(a), g._auditSensitive(a)], expect[a], a));
  },

  'search, member, category and sensitive filters find entries across years, with names and paging'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const sh = fakes.sheet(ctx.val('SH_AUDIT'));
    const add = (...r) => sh.data.push(r);
    add('2016-03-01 10:00:00', 'Deposit', 'M004', 'M001', 'UGX 50,000 to Principal', 'S-1');
    add('2019-06-02 11:00:00', 'Loan Request Submitted', 'M004', 'M004', 'UGX 1,000,000', 'LRQ-1');
    add('2019-06-03 09:00:00', 'Loan Request First Approval', 'M004', 'M002', '', 'LRQ-1');
    add('2019-06-04 09:00:00', 'Savings Reversal', 'M005', 'M001', 'Entered twice', 'S-2');
    add('2022-01-05 08:00:00', 'Member Updated', 'M005', 'M003', 'Phone changed', '');
    add('2025-12-31 23:59:59', 'Audit Log Export', '', 'M002', 'CSV', '');
    fakes.signInAs(ALICE);
    const find = f => ok(g.getAuditLog(f), JSON.stringify(f));
    const actions = f => find(f).entries.map(e => e.action);

    const all = find({});
    assert.strictEqual(all.total, 6);
    assert.deepStrictEqual(all.entries.map(e => e.category), ['Exports', 'Members', 'Savings', 'Loans', 'Loans', 'Savings'], 'newest first');
    assert.deepStrictEqual(all.entries.map(e => e.sensitive), [true, true, true, false, false, false]);
    assert.deepStrictEqual([all.entries[5].memberName, all.entries[5].performedByName], ['Dan', 'Alice'], 'names beside member numbers');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(all.categories)), ['Exports', 'System', 'Assets', 'Investments', 'Loans', 'Savings', 'Members', 'Other']);
    assert.ok(all.members.some(m => m.no === 'M004' && m.name === 'Dan'), 'members for the filter list');

    assert.deepStrictEqual(actions({ member: 'm004' }), ['Loan Request First Approval', 'Loan Request Submitted', 'Deposit'], 'affected or acting');
    assert.deepStrictEqual(actions({ member: 'M002' }), ['Audit Log Export', 'Loan Request First Approval'], 'what an admin did');
    assert.deepStrictEqual(actions({ category: 'Loans' }), ['Loan Request First Approval', 'Loan Request Submitted']);
    assert.deepStrictEqual(actions({ sensitive: true }), ['Audit Log Export', 'Member Updated', 'Savings Reversal']);
    assert.deepStrictEqual(actions({ q: 'LRQ-1' }), ['Loan Request First Approval', 'Loan Request Submitted'], 'a reference\'s whole trail');
    assert.deepStrictEqual(actions({ q: 'carol' }), ['Member Updated'], 'search by name');
    assert.deepStrictEqual(actions({ q: 'twice' }), ['Savings Reversal'], 'search details');
    assert.deepStrictEqual(actions({ from: '2019-01-01', to: '2019-12-31', member: 'M005' }), ['Savings Reversal'], 'filters combine');

    const p = find({ page: 1, pageSize: 2 });
    assert.deepStrictEqual([p.total, p.page, p.entries.map(e => e.action)], [6, 1, ['Savings Reversal', 'Loan Request First Approval']], 'paging');
    assert.strictEqual(find({ page: 9, pageSize: 2 }).entries.length, 0, 'past the end');

    const loans = download(g, '', '', { category: 'Loans' });
    assert.strictEqual(loans.total, 2, 'the download uses the same filters');
    assert.deepStrictEqual(loans.lines.slice(1).map(l => l.split(',')[1]), ['Loan Request Submitted', 'Loan Request First Approval'], 'oldest first');
    assert.match(ctx.audit().pop().Details, /the start to today, Loans \(2 entries\)/);
  },

  'only admins can download, and bad dates are refused'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fakes.signInAs(DAN);
    fails(g.exportAuditLogCsv({}, 0), /Admin access required/, 'member');
    fakes.signInAs(ALICE);
    fails(g.exportAuditLogCsv({ from: '10/01/2025' }, 0), /yyyy-mm-dd/, 'bad format');
    fails(g.exportAuditLogCsv({ from: '2025-02-01', to: '2025-01-01' }, 0), /start date is after/, 'reversed range');
    fails(g.getAuditLog({ category: 'Nonsense' }), /Unknown category/, 'unknown category');
    assert.strictEqual(download(g, '', '').total, 0, 'an empty log downloads as a header only');
  }
};
