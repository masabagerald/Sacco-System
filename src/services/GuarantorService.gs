// ── GUARANTORS (Article 4, Sections 3, 4, 5, 6 and 8) ─────────────────────────
const GUARANTOR_HEADERS = ['Timestamp','RequestID','LoanID','ApplicantNo','GuarantorNo','Token','Response','Responded At'];

// A guarantor row is "live" while the loan it backs is still running. Before the loan exists
// it backs a pending request. Live guarantors can't guarantee anyone else (Sec 5).
function _liveGuaranteeRows() {
  const { rows: g } = readSheet(SH_GUARANTORS, 'requestid');
  if (!g.length) return [];
  const { rows: reqs } = readSheet(SH_LOAN_REQ, 'requestid');
  const reqStatus = {};
  reqs.forEach(r => { reqStatus[String(r['RequestID']||'').trim()] = String(r['Status']||'').trim(); });
  const { rows: loans } = readSheet(SH_LOANS, 'loanid');
  const { rows: reps } = readSheet(SH_REPAY, 'loanid');
  const loanStatus = {};
  loans.forEach(l => { loanStatus[String(l['LoanID']||'').trim()] = _computeLoan(l, reps).status; });
  return g.filter(r => {
    const lid = String(r['LoanID']||'').trim();
    if (lid) return loanStatus[lid] === LOAN_STATUS.ACTIVE;
    return reqStatus[String(r['RequestID']||'').trim()] === 'Pending';
  });
}

// How many live guarantees a member holds, ignoring the request being decided (excludeRequestId)
function _liveGuaranteesOf(memberNo, excludeRequestId) {
  const mNo = String(memberNo).trim(), ex = String(excludeRequestId||'').trim();
  return _liveGuaranteeRows().filter(r =>
    String(r['GuarantorNo']||'').trim() === mNo &&
    (!ex || String(r['RequestID']||'').trim() !== ex)).length;
}

// Checks the guarantor rules for a proposed set of guarantors. Returns {ok, error, guarantors}.
function _guarantorChecks(applicantNo, amount, guarantorNos, excludeRequestId) {
  const applicant = String(applicantNo).trim();
  const list = [...new Set((guarantorNos||[]).map(g => String(g).trim()).filter(Boolean))];
  if (list.length < GUARANTOR_MIN_COUNT) return { ok: false, error: 'At least ' + GUARANTOR_MIN_COUNT + ' guarantors are required. (Art. 4, Sec. 4)' };
  if (list.includes(applicant)) return { ok: false, error: 'A member cannot guarantee their own loan.' };
  const needed = r2(num(amount) * GUARANTOR_SAVINGS_RATIO);
  for (const g of list) {
    const m = _memberByNo(g);
    if (!m) return { ok: false, error: 'Guarantor ' + g + ' was not found.' };
    if (String(m['Status']||'').trim().toLowerCase() !== 'active') return { ok: false, error: 'Guarantor ' + g + ' is not an active member.' };
    const running = _runningLoanOf(g);
    if (running) return { ok: false, error: 'Guarantor ' + g + ' has a running loan (' + running.loanId + ') and cannot guarantee anyone. (Art. 4, Sec. 6)' };
    if (_liveGuaranteesOf(g, excludeRequestId) > 0) return { ok: false, error: 'Guarantor ' + g + ' is already guaranteeing another loan. A member can guarantee only one member at a time. (Art. 4, Sec. 5)' };
    const sav = _savingsBalance(g);
    if (sav < needed) return { ok: false, error: 'Guarantor ' + g + ' has savings of ' + fmtUGX(sav) + ' but needs at least ' + fmtUGX(needed) + ' (25% of the loan). (Art. 4, Sec. 3)' };
  }
  return { ok: true, guarantors: list };
}

// { requestId: [guarantor memberNos] }
function _guarantorMap() {
  const { rows } = readSheet(SH_GUARANTORS, 'requestid');
  const map = {};
  rows.forEach(r => {
    const id = String(r['RequestID']||'').trim();
    if (!id) return;
    (map[id] = map[id] || []).push(String(r['GuarantorNo']||'').trim());
  });
  return map;
}

// Saves guarantor rows for a request (requestId set) or a directly issued loan (loanId set).
// Returns [{guarantorNo, token}] so the caller can email each guarantor their response link.
function _appendGuarantors(requestId, loanId, applicantNo, guarantorNos) {
  if (!guarantorNos.length) return [];
  const { sh, headers } = readSheet(SH_GUARANTORS, 'requestid');
  const tokens = guarantorNos.map(() => Utilities.getUuid().replace(/-/g, ''));
  const out = guarantorNos.map((g, i) => {
    const arr = headers.map(() => '');
    const set = (name, v) => { const c = ci(headers, name); if (c > -1) arr[c] = v; };
    set('timestamp', now_ts()); set('requestid', requestId || ''); set('loanid', loanId || '');
    set('applicantno', applicantNo); set('guarantorno', g);
    set('token', tokens[i]); set('response', loanId ? 'Admin issued' : 'Pending');
    return arr;
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, headers.length).setValues(out);
  return guarantorNos.map((g, i) => ({ guarantorNo: g, token: tokens[i] }));
}

// Once a request is approved, attach the new loan ID to its guarantor rows
function _linkGuarantorsToLoan(requestId, loanId) {
  const { sh, headers, hRow } = readSheet(SH_GUARANTORS, 'requestid');
  const cR = ci(headers, 'requestid'), cL = ci(headers, 'loanid');
  if (cL < 0) return;
  const data = sh.getDataRange().getValues();
  for (let r = hRow + 1; r < data.length; r++)
    if (String(data[r][cR]).trim() === String(requestId).trim()) sh.getRange(r + 1, cL + 1).setValue(loanId);
}

// Members a guarantor can pick from: active members other than the applicant.
// Admins may pass applicantNo to load candidates for a member they are issuing a loan to.
function getGuarantorCandidates(applicantNo) {
  const auth = _caller(); if (!auth.ok) return auth;
  const isAdmin = String(auth.member.role||'').toLowerCase() === 'admin';
  const who = (isAdmin && applicantNo) ? String(applicantNo).trim() : auth.member.memberNo;
  const { rows } = readSheet(SH_MEMBERS, 'memberno');
  return { ok: true, candidates: rows
    .filter(m => String(m['Status']||'').trim().toLowerCase() === 'active' && String(m['MemberNo']||'').trim() !== who)
    .map(m => ({ memberNo: String(m['MemberNo']).trim(), name: m['Full Name'] || '' })) };
}

// One-time setup, run from the script editor. Creates the Guarantors tab (or adds any missing
// columns to it) and adds the new Loans columns. Safe to run again.
function setupGuaranteeSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let g = ss.getSheetByName(SH_GUARANTORS);
  if (!g) g = ss.insertSheet(SH_GUARANTORS);
  if (g.getLastRow() === 0) g.appendRow(GUARANTOR_HEADERS);
  const gHdr = g.getRange(1, 1, 1, g.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  GUARANTOR_HEADERS.forEach(name => {
    if (!gHdr.includes(name.toLowerCase())) { g.getRange(1, g.getLastColumn() + 1).setValue(name); gHdr.push(name.toLowerCase()); }
  });

  // Adds any missing columns to an existing tab. Finds the real header row (tabs have a title above it).
  const addColumns = (sheetName, hint, names) => {
    const { sh, hRow } = readSheet(sheetName, hint);
    if (hRow < 0) throw new Error('Could not find the header row on the ' + sheetName + ' tab.');
    names.forEach(name => {
      const lastCol = sh.getLastColumn();
      const hdr = sh.getRange(hRow + 1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toLowerCase());
      if (!hdr.some(h => h.startsWith(name.toLowerCase()))) sh.getRange(hRow + 1, lastCol + 1).setValue(name);
    });
  };
  addColumns(SH_LOANS, 'loanid', ['Loan Model', 'Processing Fee (UGX)', 'Term (days)', 'Interest Rate (%)', 'Due Date']);
  addColumns(SH_LOAN_REQ, 'requestid', ['Repayment Term', 'Total Due']);
  addColumns(SH_SAVINGS, 'memberno', ['Payment Category']);

  Logger.log('Guarantee schema ready.');
}

// ── GUARANTOR RESPONSES ───────────────────────────────────────────────────────

// [{guarantorNo, response}] for a request. response: Pending / Accepted / Declined
function _guaranteeResponses(requestId) {
  const { rows } = readSheet(SH_GUARANTORS, 'requestid');
  return rows.filter(r => String(r['RequestID']||'').trim() === String(requestId).trim())
    .map(r => ({ guarantorNo: String(r['GuarantorNo']||'').trim(), response: String(r['Response']||'Pending').trim() || 'Pending' }));
}

// Approval is blocked until every guarantor has accepted
function _guarantorGate(requestId) {
  const list = _guaranteeResponses(requestId);
  const declined = list.find(g => g.response === 'Declined');
  if (declined) return { ok: false, error: 'Guarantor ' + declined.guarantorNo + ' declined this request. It cannot be approved; reject it with a reason.' };
  const waiting = list.find(g => g.response !== 'Accepted');
  if (waiting) return { ok: false, error: 'Waiting for guarantor ' + waiting.guarantorNo + ' to respond to the email link.' };
  return { ok: true };
}
