// ── INVESTMENT TRACKER (admin only) ───────────────────────────────────────────
// An investment's details (name, provider, dates, status) are kept on the Investments tab and changed
// by one admin, with the change audited. Every money movement and valuation is an Investment
// Transaction that needs two admin approvals before it counts (ApprovalLedgerService).

function getInvestmentDashboard(filters) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rg = _validRange(filters); if (!rg.ok) return rg;
  const inv = _readOptional(SH_INVESTMENTS, 'investmentid');
  const res = _portfolioFromRows(inv.rows, _readOptional(SH_INV_TX, 'txid').rows, rg.from, rg.to, today());
  return Object.assign({ ok: true, ready: !inv.missing, types: INVESTMENT_TYPES, statuses: INVESTMENT_STATUSES, txTypes: INV_TX_TYPES,
    costSources: INV_COST_SOURCES, currency: INVESTMENT_CURRENCY, generatedAt: now_ts() }, res);
}

// Every investment transaction, in any status, with the investment's name
function getInvestmentTransactions(investmentId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const nameOf = {};
  _investmentRows().forEach(r => { nameOf[String(r['InvestmentID'] || '').trim()] = String(r['Name'] || ''); });
  investmentId = String(investmentId || '').trim();
  return { ok: true, entries: _ledgerEntryList('inv')
    .filter(e => !investmentId || e.investmentId === investmentId)
    .map(e => Object.assign(e, { investmentName: nameOf[e.investmentId] || '' })) };
}

// Full details of one investment, including its account reference, for the edit form
function getInvestment(investmentId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const r = _investmentById(investmentId);
  if (!r) return { ok: false, error: 'Investment not found.' };
  return { ok: true, investment: { id: String(r['InvestmentID']).trim(), name: String(r['Name'] || ''), type: String(r['Type'] || ''),
    provider: String(r['Provider'] || ''), currency: String(r['Currency'] || INVESTMENT_CURRENCY), startDate: _dstr(r['Start Date']),
    maturityDate: _dstr(r['Maturity Date']), accountRef: String(r['Account Reference'] || ''), status: String(r['Status'] || 'Active'),
    notes: String(r['Notes'] || ''), documentLink: String(r['Document Link'] || ''),
    fundSource: String(r['Source of Funds'] || ''), fundSourceOther: String(r['Source of Funds (Other)'] || '') } };
}

// Creates an investment record. If initialAmount is given, its Initial Investment transaction is
// proposed at the same time (still needing two approvals); with fromLoanFund it is paid out of the
// loan fund, recorded as a linked "Transfer to Investment" on the Loan Fund Ledger.
function createInvestment(data) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  data = data || {};
  const v = _validateInvestment(data); if (!v.ok) return v;
  const inv = v.inv, initial = num(data.initialAmount);
  if (initial < 0) return { ok: false, error: 'The initial amount cannot be negative.' };
  // The loan fund's capital is Principal savings: only money from Principal can be paid out of the loan fund
  if (data.fromLoanFund && inv.fundSource !== 'Principal')
    return { ok: false, field: 'fundSource', error: 'Only money from Principal is paid out of the loan fund. Choose Principal as the source of funds, or untick "Paid out of the loan fund".' };
  return _withScriptLock(() => {
    const { sh, headers, hRow, rows, missing } = _readOptional(SH_INVESTMENTS, 'investmentid');
    if (missing || hRow < 0) throw new Error('The "' + SH_INVESTMENTS + '" tab is missing. Run setupFinanceSchema() once from the script editor.');
    if (rows.some(r => String(r['Name'] || '').trim().toLowerCase() === inv.name.toLowerCase() && String(r['Provider'] || '').trim().toLowerCase() === inv.provider.toLowerCase()))
      return { ok: false, error: 'An investment called "' + inv.name + '" with ' + inv.provider + ' already exists.' };
    const id = _nextRef('investment', rows.map(r => r['InvestmentID']));
    _writeRow(sh, headers, emptyRow(sh, hRow, _hdrIdx(headers, 'InvestmentID')), { InvestmentID: id, Timestamp: now_ts(), Name: inv.name, Type: inv.type,
      Provider: inv.provider, Currency: inv.currency, 'Start Date': inv.startDate, 'Maturity Date': inv.maturityDate,
      'Account Reference': inv.accountRef, Status: inv.status, Notes: inv.notes, 'Document Link': inv.documentLink, 'Created By': auth.member.memberNo,
      'Source of Funds': inv.fundSource, 'Source of Funds (Other)': inv.fundSourceOther });
    auditLog('Investment Created', '', auth.member.memberNo, inv.type + ' "' + inv.name + '" with ' + inv.provider
      + ', funded from ' + (inv.fundSource === 'Others' ? 'Others: ' + inv.fundSourceOther : inv.fundSource) + ', started ' + inv.startDate
      + (inv.maturityDate ? ', matures ' + inv.maturityDate : '') + (inv.accountRef ? ', account ' + _maskRef(inv.accountRef) : '') + '.', id);
    if (!initial) return { ok: true, investmentId: id };
    const tx = _proposeInvestmentTxLocked(auth, id, 'Initial Investment', initial, inv.startDate, data.reference, 'Initial investment', '', data.fromLoanFund ? 'fromLoanFund' : '');
    return Object.assign({}, tx, { ok: true, investmentId: id, txError: tx.ok ? '' : tx.error });
  });
}

// Changes an investment's details. The reason and the before/after values go to the audit log.
function updateInvestment(investmentId, data, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const v = _validateInvestment(data || {}); if (!v.ok) return v;
  const inv = v.inv;
  return _withScriptLock(() => {
    const { sh, headers, rows } = _readOptional(SH_INVESTMENTS, 'investmentid');
    const row = rows.find(r => String(r['InvestmentID'] || '').trim() === String(investmentId || '').trim());
    if (!row) return { ok: false, error: 'Investment not found.' };
    const next = { Name: inv.name, Type: inv.type, Provider: inv.provider, Currency: inv.currency, 'Start Date': inv.startDate,
      'Maturity Date': inv.maturityDate, 'Account Reference': inv.accountRef, Status: inv.status, Notes: inv.notes, 'Document Link': inv.documentLink,
      'Source of Funds': inv.fundSource, 'Source of Funds (Other)': inv.fundSourceOther };
    const oldSource = String(row['Source of Funds'] || '').trim();
    if (oldSource !== inv.fundSource) {
      const moved = _readOptional(SH_INV_TX, 'txid').rows.filter(r => String(r['InvestmentID'] || '').trim() === String(investmentId || '').trim()
        && String(r['Status'] || '').trim() !== 'Rejected' && ['contributed', 'redeemed'].indexOf(INV_FLOW_KEYS[String(r['Tx Type'] || '').trim()]) > -1);
      if (oldSource && moved.length)
        return { ok: false, field: 'fundSource', error: 'The source of funds can\'t be changed after money has been paid into or out of this investment: '
          + 'it would move that money between pools. Reverse the transactions first, or record a new investment.' };
      // Recording the source of an older investment for the first time: its money then comes off that pool
      if (!oldSource && POOLED_ACCOUNTS.indexOf(inv.fundSource) > -1 && moved.length) {
        const ia = _investmentAtoms(_readOptional(SH_INV_TX, 'txid').rows, String(investmentId).trim());
        const net = r2(ia.atoms.filter(a => !a.linked).reduce((s, a) => s + (a.key === 'contributed' ? a.amount : a.key === 'redeemed' ? -a.amount : 0), 0));
        const bal = _poolBalanceFromRows(readSheet(SH_SAVINGS, 'memberno').rows, inv.fundSource);
        if (net > bal + 0.005)
          return { ok: false, field: 'fundSource', error: 'This investment holds ' + fmtUGX(net) + ' paid in, more than the ' + fmtUGX(Math.max(bal, 0))
            + ' in the club ' + inv.fundSource + ' pool. Check the source of funds.' };
      }
    }
    const shown = (k, x) => k === 'Account Reference' ? _maskRef(x) : String(x || '');
    const changes = Object.keys(next).filter(k => String(k.indexOf('Date') > -1 ? _dstr(row[k]) : (row[k] || '')).trim() !== String(next[k]).trim())
      .map(k => k + ': "' + shown(k, k.indexOf('Date') > -1 ? _dstr(row[k]) : row[k]) + '" -> "' + shown(k, next[k]) + '"');
    if (!changes.length) return { ok: false, error: 'Nothing to change.' };
    _writeRow(sh, headers, row._row, Object.assign(next, { 'Updated At': now_ts(), 'Updated By': auth.member.memberNo }));
    auditLog('Investment Updated', '', auth.member.memberNo, changes.join('; ') + '. Reason: ' + String(reason).trim(), String(investmentId).trim());
    return { ok: true };
  });
}

// Proposes a transaction (contribution, redemption, income, fee, tax or valuation) on an investment
function proposeInvestmentTx(investmentId, type, amount, txDate, reference, notes, costSource) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return _withScriptLock(() => _proposeInvestmentTxLocked(auth, investmentId, type, amount, txDate, reference, notes, costSource, ''));
}

// Moves money between an investment and the loan fund. toLoanFund: a Redemption of the investment
// plus a "Transfer from Investment" injection into the loan fund. fromLoanFund: an Additional
// Contribution plus a "Transfer to Investment" outflow. The two entries are linked and approved
// together. A transfer is never income: it only moves money that is already the club's.
function proposeInvestmentTransfer(direction, investmentId, amount, txDate, reference, notes) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  direction = String(direction || '').trim();
  if (direction !== 'toLoanFund' && direction !== 'fromLoanFund') return { ok: false, error: 'Choose the direction of the transfer.' };
  const type = direction === 'toLoanFund' ? 'Redemption' : 'Additional Contribution';
  return _withScriptLock(() => _proposeInvestmentTxLocked(auth, investmentId, type, amount, txDate, reference, notes, '', direction));
}

// link: '' (no loan fund side), 'toLoanFund' or 'fromLoanFund'
function _proposeInvestmentTxLocked(auth, investmentId, type, amount, txDate, reference, notes, costSource, link) {
  const v = _validateInvestmentTx(investmentId, type, amount, txDate, reference, notes, costSource); if (!v.ok) return v;
  const f = v.fields;
  const dup = _duplicateEntryError('inv', f); if (dup) return { ok: false, error: dup };
  const valErr = _investmentTxError(f, true); if (valErr) return { ok: false, error: valErr };
  const entries = [{ ledger: 'inv', fields: f }];
  const name = String(v.inv['Name'] || f.InvestmentID);
  if (link) {
    const fund = { Date: f.Date, 'Entry Type': link === 'toLoanFund' ? 'Transfer from Investment' : 'Transfer to Investment',
      'Amount (UGX)': f['Amount (UGX)'], Reference: f.Reference, 'Investment ID': f.InvestmentID,
      Description: (link === 'toLoanFund' ? 'From ' : 'To ') + name + (f.Notes ? ': ' + f.Notes : '') };
    const dup2 = _duplicateEntryError('fund', fund); if (dup2) return { ok: false, error: dup2 };
    const cashErr = _fundCashError(fund, true); if (cashErr) return { ok: false, error: cashErr };
    entries.push({ ledger: 'fund', fields: fund });
  }
  const ids = _appendLedgerEntriesLocked(entries, auth.member.memberNo, !!link);
  auditLog('Investment Transaction Proposed', '', auth.member.memberNo,
    f['Tx Type'] + ' of ' + fmtUGX(f['Amount (UGX)']) + ' on ' + f.InvestmentID + ' (' + name + '), dated ' + f.Date
    + (f['Cost Source'] ? ', ' + f['Cost Source'].toLowerCase() : '') + (f.Reference ? ', ref ' + f.Reference : '')
    + (link ? '. Linked loan fund entry ' + ids[1] + ' (' + entries[1].fields['Entry Type'] + ')' : '') + '. Needs two admin approvals.', ids.join(', '));
  _notifyAdmins('Investment transaction awaiting approval: ' + ids.join(', '), [['Investment', f.InvestmentID + ' ' + name], ['Type', f['Tx Type']],
    ['Amount', fmtUGX(f['Amount (UGX)'])], ['Date', human_date(f.Date)], ['Proposed by', auth.member.name + ' (' + auth.member.memberNo + ')']],
    'Two different admins, neither the proposer, must approve this before it counts.');
  return { ok: true, txId: ids[0], fundEntryId: ids[1] || '' };
}
