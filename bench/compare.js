// Before/after table of estimated Apps Script times (central), seconds.
// node bench/compare.js <before.json> <after.json>
const fs = require('fs');
const [before, after] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const key = t => t.members + 'x' + t.years;
const label = t => t.members + ' × ' + (t.years < 1 ? t.years * 12 + ' mo' : t.years + ' y');
const B = {}; before.tiers.forEach(t => { B[key(t)] = t; });
const tiers = after.tiers.filter(t => !t.skipped);
const fmt = (op, isAfter) => {
  if (!op || !op.model) return '–';
  const s = op.model.central / 1000;
  const txt = s >= 360 ? '>360 (fails)' : s >= 100 ? s.toFixed(0) : s >= 10 ? s.toFixed(1) : s.toFixed(2);
  return (op.extrapolated && s < 360 ? '≈' : '') + (s >= 10 ? '**' + txt + '**' : txt);
};
const OPS = ['myPage', 'adminPage', 'members', 'loanReqs', 'dashboard', 'wdReqs', 'fines', 'activeLoans', 'insights', 'csv',
  'recordSavings', 'recordRepayment', 'requestWithdrawal', 'requestLoan', 'approveLoan', 'issueFine', 'jobStatements', 'jobDueDates'];
const names = {}; tiers.forEach(t => Object.keys(t.ops).forEach(id => { names[id] = t.ops[id].name; }));
const out = ['| Operation | ' + tiers.map(label).join(' | ') + ' |', '|---|' + tiers.map(() => '---:').join('|') + '|'];
OPS.filter(id => names[id]).forEach(id => out.push('| ' + names[id] + ' | ' + tiers.map(t => {
  const b = B[key(t)], a = t.ops[id];
  return (b ? fmt(b.ops[id]) : 'n/r') + ' → ' + fmt(a, true);
}).join(' | ') + ' |'));
console.log(out.join('\n'));
// Lock time per write, after
console.log('\n| Write | ' + tiers.map(label).join(' | ') + ' |\n|---|' + tiers.map(() => '---:').join('|') + '|');
['recordSavings', 'recordRepayment', 'requestWithdrawal', 'requestLoan', 'approveLoan', 'issueFine'].forEach(id => console.log('| ' + (names[id] || id) + ' | ' +
  tiers.map(t => { const b = B[key(t)], bo = b && b.ops[id], a = t.ops[id];
    const f = o => (o && o.lockModel ? (o.lockModel / 1000).toFixed(2) : '–');
    return (b ? f(bo) : 'n/r') + ' → ' + f(a); }).join(' | ') + ' |'));
