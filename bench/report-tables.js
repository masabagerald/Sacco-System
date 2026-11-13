// Turns bench/results/local.json into the markdown tables used in the capacity report.
// node bench/report-tables.js [results.json] > bench/results/tables.md
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, 'results', 'local.json');
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const LIMIT_S = 360, TARGET_S = 10, LOCK_WAIT_S = 15;
const tiers = R.tiers.filter(t => !t.skipped);
const label = t => t.members + ' × ' + (t.years < 1 ? t.years * 12 + ' mo' : t.years + ' y');
const s = ms => ms / 1000;
const cell = op => {
  if (!op) return '–';
  if (!op.model) return op.error ? 'error' : '–';
  const c = s(op.model.central);
  const txt = c >= LIMIT_S ? '**>360 (fails)**' : c >= 100 ? c.toFixed(0) : c >= 10 ? c.toFixed(1) : c.toFixed(2);
  const flag = c >= TARGET_S && c < LIMIT_S ? '**' + txt + '**' : txt;
  return (op.extrapolated && c < LIMIT_S ? '≈' : '') + flag;
};
const out = [];
const P = (...a) => out.push(a.join(''));

P('## Data volume per tier\n');
P('| Tier (members × years) | Rows, all tabs | Savings rows | Used cells | Grid cells as the app creates tabs (A–Z) | Fits in 10M cells? |');
P('|---|---:|---:|---:|---:|---|');
R.tiers.forEach(t => P(`| ${label(t)} | ${t.cells.rows.toLocaleString('en-US')} | ${t.savingsRows.toLocaleString('en-US')} | ${(t.cells.used / 1e6).toFixed(2)}M | ${(t.cells.grid / 1e6).toFixed(2)}M | ${t.cells.grid <= 10e6 ? 'yes' : t.cells.used <= 10e6 ? 'only with unused columns deleted' : '**no**'} |`));

const ORDER = ['auth', 'mySavings', 'myLoans', 'myPage', 'statement', 'dashboard', 'members', 'loanReqs', 'activeLoans', 'repayments', 'wdReqs', 'fines', 'adminPage',
  'savingsTx', 'insights', 'fundLedger', 'auditLog', 'csv', 'recordSavings', 'recordRepayment', 'requestWithdrawal', 'requestLoan', 'approveLoan', 'issueFine',
  'jobStatements', 'jobDueDates', 'jobPending', 'jobRepayRem'];
const names = {};
tiers.forEach(t => Object.keys(t.ops).forEach(id => { names[id] = t.ops[id].name; }));
P('\n## Estimated Apps Script time per operation, seconds (central estimate; ≈ extrapolated; bold ≥ 10 s)\n');
P('| Operation | ' + tiers.map(label).join(' | ') + ' |');
P('|---|' + tiers.map(() => '---:').join('|') + '|');
ORDER.filter(id => names[id]).forEach(id => P(`| ${names[id]} | ` + tiers.map(t => cell(t.ops[id])).join(' | ') + ' |'));

P('\n## Range for the key operations (low – high cost assumptions), seconds\n');
P('| Operation | ' + tiers.map(label).join(' | ') + ' |');
P('|---|' + tiers.map(() => '---:').join('|') + '|');
['myPage', 'adminPage', 'dashboard', 'recordSavings', 'recordRepayment', 'approveLoan'].forEach(id => P(`| ${names[id]} | ` + tiers.map(t => {
  const o = t.ops[id]; if (!o || !o.model) return '–';
  return s(o.model.low).toFixed(1) + '–' + s(o.model.high).toFixed(1);
}).join(' | ') + ' |'));

P('\n## Measured work per operation at the largest tier that ran (counts are exact)\n');
const big = tiers[tiers.length - 1];
P(`Tier ${label(big)}.\n`);
P('| Operation | Sheet reads | Cells read | Write calls | Rows appended | Date conversions | Emails | JS time in Node (ms) | Reply size |');
P('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
ORDER.filter(id => big.ops[id] && big.ops[id].counters && !big.ops[id].extrapolated).forEach(id => {
  const o = big.ops[id], c = o.counters;
  P(`| ${o.name} | ${c.readCalls} | ${c.cellsRead.toLocaleString('en-US')} | ${c.writeCalls} | ${c.appends} | ${c.fmtDate.toLocaleString('en-US')} | ${c.emails} | ${o.cpuMs ? o.cpuMs.toFixed(0) : '–'} | ${o.payload ? (o.payload / 1024).toFixed(0) + ' KB' : '–'} |`);
});

P('\n## Concurrency: writes protected by the script lock (modelled from each operation\'s measured critical section)\n');
P(`Apps Script runs them one at a time; each waits at most ${LOCK_WAIT_S} s for the lock (withScriptLock_), then fails with a lock timeout.\n`);
P('| Operation | Tier | Lock held (s) | 5 at once: failures, last one waits | 10 at once: failures, last one waits |');
P('|---|---|---:|---|---|');
['recordSavings', 'recordRepayment', 'requestWithdrawal', 'approveLoan'].forEach(id => tiers.forEach(t => {
  const o = t.ops[id]; if (!o || !o.lockModel) return;
  const T = s(o.lockModel);
  const q = k => { let fail = 0; for (let j = 0; j < k; j++) if (j * T > LOCK_WAIT_S) fail++; return fail + ', ' + Math.min((k - 1) * T, LOCK_WAIT_S).toFixed(1) + ' s'; };
  P(`| ${o.name} | ${label(t)} | ${T.toFixed(2)} | ${q(5)} | ${q(10)} |`);
}));

P('\n## Concurrency: writes WITHOUT the lock (measured, worst-case interleaving)\n');
P('| Operation | Simultaneous | Reported success | Rows actually kept | Lost |');
P('|---|---:|---:|---:|---:|');
(R.concurrency || []).forEach(c => P(`| ${c.kind} | ${c.k} | ${c.reportedOk} | ${c.rowsAdded} | ${c.lost} |`));

process.stdout.write(out.join('\n') + '\n');
