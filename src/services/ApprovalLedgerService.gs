// ── TWO-ADMIN APPROVAL LEDGERS (Loan Fund Ledger, Investment Transactions) ─────
// Rows are only ever appended; no entry is edited after the fact except for its approval columns.
// Each entry starts Pending and counts in the figures only once two different admins -- neither of
// them the admin who proposed it -- have approved it (the same segregation of duties as loans and
// withdrawals, via _approvalDutyError). A correction is a Reversal entry, approved the same way.
// Two entries can be linked (a transfer between an investment and the loan fund): they are approved,
// rejected and reversed together, so one side can never count without the other.

const LOAN_FUND_HEADERS = ['EntryID', 'Timestamp', 'Date', 'Entry Type', 'Amount (UGX)', 'Reference', 'Description', 'Investment ID',
  'Linked Entry', 'Reverses', 'Status', 'Initiated By', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Decision Notes', 'Decided By'];
const INV_TX_HEADERS = ['TxID', 'Timestamp', 'InvestmentID', 'Date', 'Tx Type', 'Amount (UGX)', 'Cost Source', 'Reference', 'Notes',
  'Linked Entry', 'Reverses', 'Status', 'Initiated By', 'Approver 1', 'Approver 1 At', 'Approver 2', 'Approver 2 At', 'Decision Notes', 'Decided By'];
const INVESTMENT_HEADERS = ['InvestmentID', 'Timestamp', 'Name', 'Type', 'Provider', 'Currency', 'Start Date', 'Maturity Date',
  'Account Reference', 'Status', 'Notes', 'Document Link', 'Created By', 'Updated At', 'Updated By', 'Source of Funds', 'Source of Funds (Other)'];

// `sheet` is a getter: Apps Script runs this file before Config.gs, so SH_* is not defined yet when
// this object is built -- it is read only when a function asks for it.
const APPROVAL_LEDGERS = {
  fund: { get sheet() { return SH_LOAN_FUND; }, hint: 'entryid', id: 'EntryID', type: 'Entry Type', notes: 'Description', inv: 'Investment ID',
    ref: 'fundEntry', label: 'Loan fund entry', headers: LOAN_FUND_HEADERS },
  inv:  { get sheet() { return SH_INV_TX; }, hint: 'txid', id: 'TxID', type: 'Tx Type', notes: 'Notes', inv: 'InvestmentID',
    ref: 'investmentTx', label: 'Investment transaction', headers: INV_TX_HEADERS }
};

// 'fund' for LFE-000001 (or the older LF001), 'inv' for IVT-000001 (or IT001), '' otherwise
function _ledgerKeyOf(id) {
  return Object.keys(APPROVAL_LEDGERS).find(k => _refSerial(APPROVAL_LEDGERS[k].ref, id) > 0) || '';
}

// Rows of a sheet that may not exist yet (before the setup has been run): empty instead of an error
function _readOptional(sheetName, hint) {
  try { return readSheet(sheetName, hint); }
  catch (e) { return { headers: [], rows: [], sh: null, hRow: -1, missing: true }; }
}

// Column of the header named exactly `name` (case-insensitive), else the first starting with it
function _hdrIdx(headers, name) {
  const n = String(name).toLowerCase();
  const i = headers.findIndex(h => String(h).trim().toLowerCase() === n);
  return i > -1 ? i : ci(headers, n);
}

function _requireLedger(key) {
  const L = APPROVAL_LEDGERS[key];
  const r = _readOptional(L.sheet, L.hint);
  if (r.missing || r.hRow < 0) throw new Error('The "' + L.sheet + '" tab is missing. Run setupFinanceSchema() once from the script editor.');
  const lacking = L.headers.filter(h => _hdrIdx(r.headers, h) < 0);
  if (lacking.length) throw new Error('The "' + L.sheet + '" tab is missing columns (' + lacking.join(', ') + '). Run setupFinanceSchema() once from the script editor.');
  return r;
}

// Writes one row from { 'Header Name': value }
function _writeRow(sh, headers, rowNum, obj) {
  const arr = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  Object.keys(obj).forEach(k => { const c = _hdrIdx(headers, k); if (c > -1) arr[c] = obj[k]; });
  sh.getRange(rowNum, 1, 1, headers.length).setValues([arr]);
}

function _nextLedgerId(rows, L) { return _nextRef(L.ref, rows.map(r => r[L.id])); }

// Appends entries (Pending). entries: [{ ledger: 'fund'|'inv', fields: {...} }]. With link=true the
// two entries reference each other in "Linked Entry". Caller holds the script lock. Returns the ids.
function _appendLedgerEntriesLocked(entries, initiatedBy, link) {
  const reads = {};
  const ids = entries.map(e => {
    const L = APPROVAL_LEDGERS[e.ledger];
    const r = reads[e.ledger] || (reads[e.ledger] = _requireLedger(e.ledger));
    const id = _nextLedgerId(r.rows, L);
    r.rows.push({ [L.id]: id });
    return id;
  });
  entries.forEach((e, i) => {
    const L = APPROVAL_LEDGERS[e.ledger];
    const r = reads[e.ledger];
    const fields = Object.assign({}, e.fields, { [L.id]: ids[i], Timestamp: now_ts(), Status: 'Pending', 'Initiated By': initiatedBy });
    if (link && ids.length === 2) fields['Linked Entry'] = ids[1 - i];
    _writeRow(r.sh, r.headers, emptyRow(r.sh, r.hRow, _hdrIdx(r.headers, L.id)), fields);
  });
  return ids;
}

// The entry with this id and, if it has one, its linked entry: [{ key, L, read, row }]
function _entryGroup(id) {
  const key = _ledgerKeyOf(id);
  if (!key) return null;
  const read = _requireLedger(key), L = APPROVAL_LEDGERS[key];
  const row = read.rows.find(r => String(r[L.id] || '').trim() === String(id).trim());
  if (!row) return null;
  const group = [{ key, L, read, row }];
  const linked = String(row['Linked Entry'] || '').trim();
  if (linked) {
    const k2 = _ledgerKeyOf(linked);
    const read2 = k2 === key ? read : _requireLedger(k2), L2 = APPROVAL_LEDGERS[k2];
    const row2 = read2.rows.find(r => String(r[L2.id] || '').trim() === linked);
    if (row2) group.push({ key: k2, L: L2, read: read2, row: row2 });
  }
  return group;
}

function _describeEntry(g) {
  const r = g.row;
  return g.L.label + ' ' + r[g.L.id] + ': ' + r[g.L.type] + ' of ' + fmtUGX(num(r['Amount (UGX)'])) + ', dated ' + _dstr(r['Date'])
    + (r[g.L.inv] ? ', investment ' + r[g.L.inv] : '') + (r['Reverses'] ? ', reverses ' + r['Reverses'] : '');
}

function _auditPrefix(key) { return key === 'fund' ? 'Loan Fund Entry' : 'Investment Transaction'; }

// Business checks run before an entry (group) is finally approved -- the ledgers must still allow it.
// Returns an error message, or ''.
function _finalApprovalError(group) {
  for (const g of group) {
    const r = g.row;
    if (String(r[g.L.type] || '').trim() !== ENTRY_REVERSAL) continue;
    const origId = String(r['Reverses'] || '').trim();
    const orig = g.read.rows.find(x => String(x[g.L.id] || '').trim() === origId);
    if (!orig || String(orig['Status'] || '').trim() !== 'Approved') return 'The entry being reversed (' + origId + ') is not an approved entry.';
    if (g.read.rows.some(x => String(x['Reverses'] || '').trim() === origId && String(x['Status'] || '').trim() === 'Approved'))
      return origId + ' has already been reversed.';
  }
  const fund = group.find(g => g.key === 'fund');
  if (fund) { const e = _fundCashError(fund.row, false); if (e) return e; }
  const inv = group.find(g => g.key === 'inv');
  if (inv) { const e = _investmentTxError(inv.row, false); if (e) return e; }
  return '';
}

// One of the two approvals. The first records "Partially Approved"; the second, by a different
// admin who did not propose the entry, makes it (and its linked entry) count.
function _approveLedgerEntryLocked(auth, id) {
  const group = _entryGroup(id);
  if (!group) return { ok: false, error: 'Entry ' + id + ' was not found.' };
  const me = auth.member.memberNo;
  const lead = group[0].row;
  const dutyErr = _approvalDutyError(lead, me);
  if (dutyErr) return { ok: false, error: dutyErr };
  if (group.some(g => String(g.row['Status'] || '').trim() !== String(lead['Status'] || '').trim()))
    return { ok: false, error: 'This entry and its linked entry are out of step; contact the system administrator.' };
  const first = !String(lead['Approver 1'] || '').trim();
  if (!first) { const err = _finalApprovalError(group); if (err) return { ok: false, error: err }; }
  group.forEach(g => _writeRow(g.read.sh, g.read.headers, g.row._row, first
    ? { 'Approver 1': me, 'Approver 1 At': now_ts(), Status: 'Partially Approved' }
    : { 'Approver 2': me, 'Approver 2 At': now_ts(), Status: 'Approved', 'Decision Notes': 'Approved by ' + lead['Approver 1'] + ' and ' + me, 'Decided By': me }));
  const what = group.map(_describeEntry).join('; ');
  auditLog(_auditPrefix(group[0].key) + (first ? ' First Approval' : ' Approved'), '', me,
    (first ? 'First of two required approvals. ' : 'Second approval -- now counts in the figures. ') + what, group.map(g => g.row[g.L.id]).join(', '));
  if (first) _notifyAdmins('Second approval needed: ' + id, [['Entry', what], ['First approval', auth.member.name + ' (' + me + ')']],
    'A different admin, who did not propose this entry, must give the final approval.');
  return { ok: true, stage: first ? 'first' : 'final' };
}

// Any admin may reject an entry that is still awaiting approval (a reason is required)
function _rejectLedgerEntryLocked(auth, id, reason) {
  const group = _entryGroup(id);
  if (!group) return { ok: false, error: 'Entry ' + id + ' was not found.' };
  if (!_isOpenRequest(group[0].row)) return { ok: false, error: 'Already decided.' };
  group.forEach(g => _writeRow(g.read.sh, g.read.headers, g.row._row,
    { Status: 'Rejected', 'Decision Notes': reason, 'Decided By': auth.member.memberNo }));
  auditLog(_auditPrefix(group[0].key) + ' Rejected', '', auth.member.memberNo,
    group.map(_describeEntry).join('; ') + '. Reason: ' + reason, group.map(g => g.row[g.L.id]).join(', '));
  return { ok: true };
}

// Proposes a Reversal of an approved entry (and of its linked entry). The reversal itself needs two approvals.
function _proposeReversalLocked(auth, id, reason) {
  const group = _entryGroup(id);
  if (!group) return { ok: false, error: 'Entry ' + id + ' was not found.' };
  for (const g of group) {
    const gid = g.row[g.L.id];
    if (String(g.row['Status'] || '').trim() !== 'Approved') return { ok: false, error: gid + ' is not approved, so there is nothing to reverse. Reject it instead.' };
    if (String(g.row[g.L.type] || '').trim() === ENTRY_REVERSAL) return { ok: false, error: 'A reversal cannot itself be reversed.' };
    if (g.read.rows.some(x => String(x['Reverses'] || '').trim() === gid && String(x['Status'] || '').trim() !== 'Rejected'))
      return { ok: false, error: gid + ' already has a reversal (approved or awaiting approval).' };
  }
  const entries = group.map(g => ({ ledger: g.key, fields: {
    Date: today(), [g.L.type]: ENTRY_REVERSAL, 'Amount (UGX)': num(g.row['Amount (UGX)']), [g.L.inv]: g.row[g.L.inv] || '',
    'Cost Source': g.row['Cost Source'] || '', Reverses: g.row[g.L.id], [g.L.notes]: 'Reversal of ' + g.row[g.L.id] + ': ' + reason } }));
  const ids = _appendLedgerEntriesLocked(entries, auth.member.memberNo, entries.length === 2);
  auditLog(_auditPrefix(group[0].key) + ' Reversal Proposed', '', auth.member.memberNo,
    'Reversal of ' + group.map(_describeEntry).join('; ') + ' proposed as ' + ids.join(', ') + '. Reason: ' + reason + '. Needs two admin approvals.', ids.join(', '));
  _notifyAdmins('Reversal awaiting approval: ' + ids.join(', '), [['Reverses', group.map(g => g.row[g.L.id]).join(', ')], ['Reason', reason],
    ['Proposed by', auth.member.name + ' (' + auth.member.memberNo + ')']], 'Two different admins, neither the proposer, must approve this reversal.');
  return { ok: true, ids };
}

// Entries of one ledger for the admin lists (every status)
function _ledgerEntryList(key) {
  const L = APPROVAL_LEDGERS[key];
  const r = _readOptional(L.sheet, L.hint);
  const reversedBy = {};
  r.rows.forEach(x => { const o = String(x['Reverses'] || '').trim(); if (o && String(x['Status'] || '').trim() !== 'Rejected') reversedBy[o] = String(x[L.id]); });
  return r.rows.filter(x => String(x[L.id] || '').trim()).map(x => ({
    id: String(x[L.id]).trim(), date: _dstr(x['Date']), timestamp: String(x['Timestamp'] || ''), type: String(x[L.type] || ''),
    amount: num(x['Amount (UGX)']), reference: String(x['Reference'] || ''), notes: String(x[L.notes] || ''),
    investmentId: String(x[L.inv] || ''), costSource: String(x['Cost Source'] || ''), linked: String(x['Linked Entry'] || ''),
    reverses: String(x['Reverses'] || ''), reversedBy: reversedBy[String(x[L.id]).trim()] || '', status: String(x['Status'] || ''),
    initiatedBy: String(x['Initiated By'] || ''), approver1: String(x['Approver 1'] || ''), approver2: String(x['Approver 2'] || ''),
    decisionNotes: String(x['Decision Notes'] || '') }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
}

// The same entry proposed twice (a double click, or two admins entering the same slip) is refused:
// a reference already used by an entry that is not rejected, or an identical entry still awaiting approval.
function _duplicateEntryError(key, fields) {
  const L = APPROVAL_LEDGERS[key];
  const live = _readOptional(L.sheet, L.hint).rows.filter(r => String(r['Status'] || '').trim() !== 'Rejected');
  const ref = String(fields.Reference || '').trim();
  if (ref) {
    const dup = live.find(r => String(r['Reference'] || '').trim().toLowerCase() === ref.toLowerCase() && !String(r['Reverses'] || '').trim());
    if (dup) return 'Reference "' + ref + '" is already used by ' + dup[L.id] + '. Each slip or statement reference can be recorded once.';
  }
  const same = live.find(r => _isOpenRequest(r) && String(r[L.type] || '').trim() === fields[L.type]
    && _dstr(r['Date']) === fields.Date && num(r['Amount (UGX)']) === num(fields['Amount (UGX)'])
    && String(r[L.inv] || '').trim() === String(fields[L.inv] || '').trim());
  if (same) return 'An identical ' + fields[L.type] + ' (' + same[L.id] + ') is already awaiting approval.';
  return '';
}

// One-time setup, run from the script editor: creates the Loan Fund Ledger, Investments and
// Investment Transactions tabs, or adds any missing columns to them. Safe to run again; never
// touches existing rows.
function setupFinanceSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SH_LOAN_FUND, 'entryid', LOAN_FUND_HEADERS], [SH_INVESTMENTS, 'investmentid', INVESTMENT_HEADERS], [SH_INV_TX, 'txid', INV_TX_HEADERS]]
    .forEach(([name, hint, headers]) => {
      let sh = ss.getSheetByName(name);
      if (!sh) sh = ss.insertSheet(name);
      const { hRow } = readSheet(name, hint);
      if (hRow < 0) {
        if (sh.getLastRow() === 0) sh.appendRow(headers);
        else throw new Error('The "' + name + '" tab has data but no ' + hint + ' header row; fix it by hand.');
        return;
      }
      headers.forEach(h => {
        const hdr = sh.getRange(hRow + 1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim().toLowerCase());
        if (hdr.indexOf(h.toLowerCase()) < 0) sh.getRange(hRow + 1, sh.getLastColumn() + 1).setValue(h);
      });
    });
  _setupRepaymentReferences();  // Loan Repayments: Reference + Reverses, references for existing rows
  // Loan Requests: the limit-override reason is kept on the request, so it still applies when the
  // last guarantor's acceptance (rather than an admin) is what issues the loan
  const lr = readSheet(SH_LOAN_REQ, 'requestid');
  if (lr.hRow > -1 && ci(lr.headers, 'limit override') < 0) lr.sh.getRange(lr.hRow + 1, lr.sh.getLastColumn() + 1).setValue('Limit Override');
  Logger.log('Finance schema ready.');
}
