// ── SECURED LOANS & CONSTITUTIONAL WAIVERS (ISS-11) ───────────────────────────
// A Founder Member who does not meet a savings coverage requirement can ask for a loan secured by an
// asset. The request starts "Pending Waiver Approval": nobody is asked to guarantee it yet. At least
// three different committee administrators (WAIVER_APPROVALS_REQUIRED, with WAIVER_ROLE_MINIMUMS per
// group) must approve the waiver; then the request becomes "Pending" and follows the usual path:
// both guarantors consent, then two different admins approve and the loan is issued.
//
// The waiver covers only the coverage checks that failed when the request was made, and is recorded
// as such ("Waived Checks"): the applicant's loan cap and/or named guarantors' 25% savings coverage.
// Every other rule -- the 12-month saving period, one running loan, guarantor eligibility, consent,
// the two final approvals, interest, fees and terms -- still applies.
//
// Loan Waivers holds one row per secured request (security details and the eligibility snapshot taken
// at submission); only its status cells change. Waiver Decisions is append-only: one row per decision.

const WAIVER_HEADERS = ['RequestID', 'Timestamp', 'ApplicantNo', 'Initiated By', 'Amount (UGX)', 'Repayment Term', 'Guarantors',
  'Applicant Principal Savings (UGX)', 'Applicant Coverage (%)', 'Loan Cap (UGX)', 'Guarantor Coverage', 'Failed Requirements',
  'Waived Checks', 'Eligibility Snapshot', 'Security Type', 'Security Type (Other)', 'Security Description', 'Estimated Value (UGX)',
  'Ownership Details', 'Supporting Documents', 'Justification', 'Waiver Status', 'Status Updated At'];
const WAIVER_DECISION_HEADERS = ['Timestamp', 'RequestID', 'AdminNo', 'Admin Name', 'Committee Role', 'Decision', 'Comment'];

// Creates a tab with its header row, or adds any missing columns. Safe to run again.
function _ensureTab(name, hint, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); return sh; }
  const { hRow } = readSheet(name, hint);
  if (hRow < 0) throw new Error('The "' + name + '" tab has data but no ' + hint + ' header row; fix it by hand.');
  headers.forEach(h => {
    const hdr = sh.getRange(hRow + 1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim().toLowerCase());
    if (hdr.indexOf(h.toLowerCase()) < 0) sh.getRange(hRow + 1, sh.getLastColumn() + 1).setValue(h);
  });
  return sh;
}

// One-time setup, also run by setupGuaranteeSchema(). The tabs are created on first use as well.
function setupSecuredLoanSchema() {
  _ensureTab(SH_WAIVERS, 'requestid', WAIVER_HEADERS);
  _ensureTab(SH_WAIVER_DECISIONS, 'requestid', WAIVER_DECISION_HEADERS);
  const { sh, hRow, headers } = readSheet(SH_MEMBERS, 'memberno');
  if (hRow > -1 && ci(headers, 'committee role') < 0) sh.getRange(hRow + 1, sh.getLastColumn() + 1).setValue('Committee Role');
}

function _appendByHeaders(name, hint, obj) {
  const { sh, headers } = readSheet(name, hint);
  sh.appendRow(headers.map(h => (obj[h] === undefined ? '' : obj[h])));
}

// ── Eligibility ───────────────────────────────────────────────────────────────

// The two constitutional savings coverage checks, as figures for the applicant, the admins and the
// audit trail. spec: from _loanSpecFor (the applicant cap applies only where spec.savingsLimit).
// Returns { applicant, guarantors, failed: [text], waive: { applicantLimit, guarantors: [memberNo] } }.
function _coverageCheck(memberNo, amount, spec, guarantorNos) {
  amount = num(amount);
  const pct = v => amount > 0 ? r2(v / amount * 100) : 0;
  const out = { applicant: null, guarantors: [], failed: [], waive: { applicantLimit: false, guarantors: [] } };
  if (spec && spec.savingsLimit) {
    const lc = _checkLimit(memberNo, amount);
    out.applicant = { savings: r2(lc.savings), maxLoan: r2(lc.maxLoan), coveragePct: pct(lc.savings),
      limitPct: r2(LOAN_TO_SAVINGS_LIMIT * 100), ok: !!lc.withinLimit };
    if (!lc.withinLimit) {
      out.waive.applicantLimit = true;
      out.failed.push('Applicant savings coverage (Art. 4, Sec. 2): a loan of ' + fmtUGX(amount) + ' is above the cap of ' + fmtUGX(lc.maxLoan)
        + ' (' + r2(LOAN_TO_SAVINGS_LIMIT * 100) + '% of Principal savings of ' + fmtUGX(lc.savings) + ').');
    }
  }
  const needed = r2(amount * GUARANTOR_SAVINGS_RATIO);
  [...new Set((guarantorNos || []).map(g => String(g).trim()).filter(Boolean))].forEach(g => {
    const m = _memberByNo(g);
    const sav = m ? r2(_principalBalance(g)) : 0;
    const ok = sav >= needed;
    out.guarantors.push({ memberNo: g, name: m ? (m['Full Name'] || g) : g, savings: sav, needed, coveragePct: pct(sav),
      requiredPct: r2(GUARANTOR_SAVINGS_RATIO * 100), ok });
    if (!ok) {
      out.waive.guarantors.push(g);
      out.failed.push('Guarantor ' + g + ' savings coverage (Art. 4, Sec. 3): Principal savings of ' + fmtUGX(sav) + ', needs at least '
        + fmtUGX(needed) + ' (' + r2(GUARANTOR_SAVINGS_RATIO * 100) + '% of the loan).');
    }
  });
  return out;
}

// Security details for a secured-loan request. Values are as declared by the applicant: nothing here
// verifies the asset, its value or its ownership. Documents are https links (the app has no file upload).
function _validateSecurity(s) {
  s = s || {};
  const t = v => String(v == null ? '' : v).trim();
  const bad = (field, error) => ({ ok: false, field, error });
  const type = t(s.type);
  if (SECURITY_TYPES.indexOf(type) < 0) return bad('type', 'Choose the type of security: ' + SECURITY_TYPES.join(', ') + '.');
  const otherType = t(s.otherType).slice(0, 100);
  if (type === 'Others' && !otherType) return bad('otherType', 'Specify the type of security.');
  const description = t(s.description).slice(0, 1000);
  if (description.length < 5) return bad('description', 'Describe the security, for example the plot number and location, or the vehicle registration.');
  const value = r2(num(s.value));
  if (!(value > 0)) return bad('value', 'Enter the estimated value of the security (UGX).');
  const ownership = t(s.ownership).slice(0, 500);
  if (!ownership) return bad('ownership', 'Give the ownership details: whose name the asset is registered in.');
  const documents = String(s.documents == null ? '' : s.documents).split(/[\r\n]+/).map(t).filter(Boolean);
  if (documents.length > 5) return bad('documents', 'Add at most 5 document links.');
  if (documents.some(d => !/^https:\/\/\S+$/i.test(d))) return bad('documents', 'Each supporting document must be a link starting with https://, one per line.');
  const justification = t(s.justification).slice(0, 1000);
  if (!justification) return bad('justification', 'Explain why the waiver should be granted.');
  return { ok: true, security: { type, otherType: type === 'Others' ? otherType : '', description, value, ownership, documents, justification } };
}

function _securityLabel(w) {
  const type = String(w['Security Type'] || '');
  return type === 'Others' ? 'Others: ' + String(w['Security Type (Other)'] || '') : type;
}

// ── Records ───────────────────────────────────────────────────────────────────

// The Loan Waivers row for a request, or null (a normal request has none)
function _waiverFor(requestId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_WAIVERS)) return null;
  const id = String(requestId || '').trim();
  return readSheet(SH_WAIVERS, 'requestid').rows.find(r => String(r['RequestID'] || '').trim() === id) || null;
}

// { applicantLimit, guarantors } recorded at submission: the only checks the waiver may lift
function _waivedChecks(w) {
  try { const v = JSON.parse(String(w['Waived Checks'] || '{}')); return { applicantLimit: !!v.applicantLimit, guarantors: (v.guarantors || []).map(String) }; }
  catch (e) { return { applicantLimit: false, guarantors: [] }; }
}

// What an APPROVED waiver lifts for this request; null when the request has no waiver.
// { error } when it has one that is not (yet) approved, so callers stop rather than run the normal checks.
function _approvedWaiverChecks(requestId) {
  const w = _waiverFor(requestId);
  if (!w) return null;
  if (String(w['Waiver Status'] || '').trim() !== WAIVER_STATUS.APPROVED)
    return { error: 'This is a secured-loan request and its waiver is ' + (String(w['Waiver Status'] || '').trim() || 'not decided') + '.' };
  return _waivedChecks(w);
}

function _waiverDecisions(requestId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_WAIVER_DECISIONS)) return [];
  const id = String(requestId || '').trim();
  return readSheet(SH_WAIVER_DECISIONS, 'requestid').rows
    .filter(r => String(r['RequestID'] || '').trim() === id)
    .map(r => ({ at: String(r['Timestamp'] || ''), adminNo: String(r['AdminNo'] || '').trim(), name: String(r['Admin Name'] || ''),
      role: String(r['Committee Role'] || '').trim(), decision: String(r['Decision'] || '').trim(), comment: String(r['Comment'] || '') }));
}

function _setWaiverStatus(requestId, status) {
  const w = _waiverFor(requestId);
  if (!w) return;
  const { sh, headers } = readSheet(SH_WAIVERS, 'requestid');
  const set = (name, v) => { const c = ci(headers, name); if (c > -1) sh.getRange(w._row, c + 1).setValue(v); };
  set('waiver status', status); set('status updated at', now_ts());
}

// ── Approvals ─────────────────────────────────────────────────────────────────

// How far the approvals have got. Each approval counts once, for its approver's group.
// need: approvals still required from each group; free: further approvals any group can give.
function _waiverProgress(decisions) {
  const approvals = decisions.filter(d => d.decision === 'Approved');
  const have = {};
  COMMITTEE_ROLES.forEach(r => { have[r] = 0; });
  approvals.forEach(a => { have[a.role] = (have[a.role] || 0) + 1; });
  const need = {}; let needSum = 0;
  Object.keys(WAIVER_ROLE_MINIMUMS).forEach(r => { need[r] = Math.max(0, WAIVER_ROLE_MINIMUMS[r] - (have[r] || 0)); needSum += need[r]; });
  const free = Math.max(0, WAIVER_APPROVALS_REQUIRED - approvals.length - needSum);
  const complete = approvals.length >= WAIVER_APPROVALS_REQUIRED && needSum === 0;
  const parts = Object.keys(need).filter(r => need[r] > 0).map(r => need[r] + ' from ' + r);
  if (free > 0) parts.push(free + ' from any committee member');
  return { count: approvals.length, required: WAIVER_APPROVALS_REQUIRED, have, need, free, complete,
    stillNeeded: complete ? '' : 'Still needed: ' + parts.join(', ') + '.' };
}

// Who may approve or reject a waiver: an active Admin with a committee role, who is neither the
// applicant nor the person who submitted it, and has not already decided on it. An approval must also
// fill a place still open (for example, a fourth Finance Committee approval cannot stand in for the
// Chairperson's). Returns an error message, or '' when `me` (a Members row) may decide.
function _waiverDeciderError(w, req, me, decisions, forApproval) {
  if (!w) return 'This is not a secured-loan request.';
  const st = String(w['Waiver Status'] || '').trim();
  if ((st !== WAIVER_STATUS.PENDING && st !== WAIVER_STATUS.PARTIAL) || String(req['Status'] || '').trim() !== REQ_PENDING_WAIVER)
    return 'This waiver has already been decided (' + (st || 'no status') + ').';
  if (!me || String(me['Role'] || '').trim().toLowerCase() !== 'admin' || String(me['Status'] || '').trim().toLowerCase() !== 'active')
    return 'Only active administrators may decide a secured-loan waiver.';
  const role = String(me['Committee Role'] || '').trim();
  if (COMMITTEE_ROLES.indexOf(role) < 0)
    return 'Only administrators in the ' + COMMITTEE_ROLES.join(' or the ') + ' may decide a secured-loan waiver. Ask an admin to set your committee role.';
  const no = String(me['MemberNo'] || '').trim();
  if (no === String(w['ApplicantNo'] || req['MemberNo'] || '').trim()) return 'This is your own loan request; other committee members must decide the waiver.';
  if (no === String(w['Initiated By'] || req['Initiated By'] || '').trim()) return 'You submitted this request; other committee members must decide the waiver.';
  if (decisions.some(d => d.adminNo === no)) return 'You have already given your decision on this waiver; each administrator decides once.';
  if (forApproval) {
    const p = _waiverProgress(decisions);
    if (!(p.need[role] > 0) && !(p.free > 0)) return 'The ' + role + ' approvals for this waiver are already complete. ' + p.stillNeeded;
  }
  return '';
}

// Active admins with a committee role who may decide this waiver (for the approval-request emails)
function _waiverDeciders(applicantNo, initiatedBy) {
  return readSheet(SH_MEMBERS, 'memberno').rows.filter(m =>
    String(m['Role'] || '').trim().toLowerCase() === 'admin' && String(m['Status'] || '').trim().toLowerCase() === 'active'
    && COMMITTEE_ROLES.indexOf(String(m['Committee Role'] || '').trim()) > -1
    && [String(applicantNo).trim(), String(initiatedBy).trim()].indexOf(String(m['MemberNo'] || '').trim()) < 0);
}

// The waiver as the Loan Requests screens show it. viewer: the caller's Members row (admins), or null.
function _waiverView(w, req, viewer) {
  const decisions = _waiverDecisions(w['RequestID']);
  const p = _waiverProgress(decisions);
  let guarantorCoverage = [];
  try { guarantorCoverage = JSON.parse(String(w['Eligibility Snapshot'] || '{}')).guarantors || []; } catch (e) {}
  const view = {
    status: String(w['Waiver Status'] || ''), submittedAt: String(w['Timestamp'] || ''),
    failed: String(w['Failed Requirements'] || '').split('\n').filter(Boolean),
    applicantSavings: num(w['Applicant Principal Savings (UGX)']), applicantCoveragePct: num(w['Applicant Coverage (%)']), loanCap: num(w['Loan Cap (UGX)']),
    guarantorCoverage,
    security: { type: _securityLabel(w), description: String(w['Security Description'] || ''), value: num(w['Estimated Value (UGX)']),
      ownership: String(w['Ownership Details'] || ''), documents: String(w['Supporting Documents'] || '').split('\n').filter(Boolean),
      justification: String(w['Justification'] || ''), verified: false },
    decisions, approvals: p.count, required: p.required, stillNeeded: p.stillNeeded
  };
  if (viewer) {
    view.approveBlock = _waiverDeciderError(w, req, viewer, decisions, true);
    view.rejectBlock = _waiverDeciderError(w, req, viewer, decisions, false);
  }
  return view;
}
