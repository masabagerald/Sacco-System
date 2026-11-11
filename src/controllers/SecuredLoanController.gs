// ── SECURED LOAN REQUESTS & WAIVER DECISIONS (ISS-11) ─────────────────────────
// See SecuredLoanService.gs for the rules. Every check is made here, on the server.

// The savings coverage checks for a loan the applicant is filling in, so the form can show what is
// not met and offer "Request for a Loan with Security". Admins may pass forMemberNo.
function checkLoanCoverage(amount, termInput, guarantorNos, forMemberNo) {
  const auth = caller_(); if (!auth.ok) return auth;
  const isAdmin = String(auth.member.role || '').toLowerCase() === 'admin';
  const who = (isAdmin && forMemberNo) ? String(forMemberNo).trim() : auth.member.memberNo;
  const m = memberByNo_(who);
  if (!m) return { ok: false, error: 'Member not found.' };
  const membershipType = String(m['Membership Type'] || '').trim();
  if (!(num(amount) > 0)) return { ok: true, membershipType, failed: [], securedAvailable: false, applicant: null, guarantors: [] };
  const sr = loanSpecFor_(membershipType, termInput);
  const cov = coverageCheck_(who, amount, sr.ok ? sr.spec : null, guarantorNos);
  return { ok: true, membershipType, applicant: cov.applicant, guarantors: cov.guarantors, failed: cov.failed,
    securedAvailable: cov.failed.length > 0 && SECURED_LOAN_MEMBERSHIP_TYPES.indexOf(membershipType) > -1 };
}

// A member's own secured-loan request. security: { type, otherType, description, value, ownership, documents, justification }
function requestSecuredLoan(amount, termInput, purpose, guarantorNos, security) {
  const auth = caller_(); if (!auth.ok) return auth;
  return withScriptLock_(() => submitSecuredLoanRequest_(auth.member.memberNo, auth.member.memberNo, auth.member.name,
    amount, termInput, purpose, guarantorNos, security));
}

function submitSecuredLoanRequest_(memberNo, initiatedBy, initiatorName, amount, termInput, purpose, guarantorNos, security) {
  amount = r2(num(amount));
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const member = memberByNo_(memberNo);
  if (!member) return { ok: false, error: 'Member not found.' };
  const membershipType = String(member['Membership Type'] || '').trim();
  if (SECURED_LOAN_MEMBERSHIP_TYPES.indexOf(membershipType) < 0)
    return { ok: false, error: 'A loan with security is available to ' + SECURED_LOAN_MEMBERSHIP_TYPES.join(', ') + 's only.' };
  const sr = loanSpecFor_(membershipType, termInput); if (!sr.ok) return sr;
  const spec = sr.spec;
  // Rules a waiver does not lift: 12-month saving period, one running loan, not guaranteeing a running loan
  const el = loanEligibility_(memberNo, membershipType, ''); if (!el.ok) return el;
  const sv = validateSecurity_(security); if (!sv.ok) return sv;
  const sec = sv.security;
  // Every guarantor rule except savings coverage: exactly two, Founder Members, active, free to guarantee
  const picked = [...new Set((guarantorNos || []).map(g => String(g).trim()).filter(Boolean))];
  const gc = guarantorChecks_(memberNo, amount, picked, '', picked); if (!gc.ok) return gc;
  const cov = coverageCheck_(memberNo, amount, spec, gc.guarantors);
  if (!cov.failed.length)
    return { ok: false, error: 'You and your guarantors meet the savings requirements, so no waiver is needed. Submit a normal loan request instead.' };

  setupSecuredLoanSchema();
  const { newId, q } = writeLoanRequestRow_(memberNo, initiatedBy, amount, spec, termInput, purpose, gc.guarantors, REQ_PENDING_WAIVER, '');
  const snapshot = { applicant: cov.applicant, guarantors: cov.guarantors, limitRatio: LOAN_TO_SAVINGS_LIMIT, guarantorRatio: GUARANTOR_SAVINGS_RATIO };
  appendByHeaders_(SH_WAIVERS, 'requestid', {
    'RequestID': newId, 'Timestamp': now_ts(), 'ApplicantNo': memberNo, 'Initiated By': initiatedBy, 'Amount (UGX)': amount,
    'Repayment Term': spec.label, 'Guarantors': gc.guarantors.join(', '),
    'Applicant Principal Savings (UGX)': cov.applicant ? cov.applicant.savings : '', 'Applicant Coverage (%)': cov.applicant ? cov.applicant.coveragePct : '',
    'Loan Cap (UGX)': cov.applicant ? cov.applicant.maxLoan : '',
    'Guarantor Coverage': cov.guarantors.map(g => g.memberNo + ': ' + fmtUGX(g.savings) + ' (' + g.coveragePct + '%, needs ' + g.requiredPct + '%)').join('; '),
    'Failed Requirements': cov.failed.join('\n'), 'Waived Checks': JSON.stringify(cov.waive), 'Eligibility Snapshot': JSON.stringify(snapshot),
    'Security Type': sec.type, 'Security Type (Other)': sec.otherType, 'Security Description': sec.description,
    'Estimated Value (UGX)': sec.value, 'Ownership Details': sec.ownership, 'Supporting Documents': sec.documents.join('\n'),
    'Justification': sec.justification, 'Waiver Status': WAIVER_STATUS.PENDING, 'Status Updated At': now_ts() });

  const secLabel = sec.type === 'Others' ? 'Others: ' + sec.otherType : sec.type;
  auditLog_('Secured Loan Request Submitted', memberNo, initiatedBy,
    'Requested ' + fmtUGX(amount) + ' over ' + spec.label + ' with security. Requirement(s) not met: ' + cov.failed.join(' ')
    + ' Guarantor coverage: ' + cov.guarantors.map(g => g.memberNo + ' ' + fmtUGX(g.savings) + ' (' + g.coveragePct + '%)').join(', ')
    + '. Security: ' + secLabel + ' - ' + sec.description + '; declared value ' + fmtUGX(sec.value) + ' (not verified); ownership: ' + sec.ownership
    + '; documents: ' + (sec.documents.join(' ') || 'none') + '. Justification: ' + sec.justification + '. Purpose: ' + (purpose || '-')
    + '. Waiver status: ' + WAIVER_STATUS.PENDING + '.', newId);

  const rule = WAIVER_APPROVALS_REQUIRED + ' different committee administrators (' + Object.keys(WAIVER_ROLE_MINIMUMS)
    .map(r => 'at least ' + WAIVER_ROLE_MINIMUMS[r] + ' ' + r).join(', ') + ')';
  const rows = [['Request ID', newId], ['Amount', fmtUGX(amount)], ['Repayment term', spec.label], ['Security', secLabel],
    ['Requirement not met', cov.failed.length === 1 ? cov.failed[0] : cov.failed.length + ' requirements (see the app)'], ['Status', WAIVER_STATUS.PENDING]];
  sendEmail_(member['Email'], 'Secured Loan Request Received: ' + newId, rows,
    'Your request for a loan with security has been submitted, and approval of the constitutional waiver has been requested from '
    + rule + '. Your guarantors will be asked to consent only after the waiver is approved.');
  waiverDeciders_(memberNo, initiatedBy).forEach(a => sendEmail_(a['Email'], 'Waiver approval needed: ' + newId,
    [['Request ID', newId], ['Applicant', (member['Full Name'] || memberNo) + ' (' + memberNo + ')']].concat(rows.slice(1)),
    'A Founder Member has asked for a loan with security because a savings coverage requirement is not met. The waiver needs '
    + rule + '. Review the security details on the Loans page. The declared value and ownership have not been verified.'));
  return { ok: true, requestId: newId, total: q.total, waiverStatus: WAIVER_STATUS.PENDING, failed: cov.failed };
}

// One committee administrator's approval of a waiver. The approval that completes the requirement
// moves the request to the guarantor stage: both guarantors are emailed for consent, as for any loan.
function approveLoanWaiver(requestId, comment) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  return withScriptLock_(() => decideWaiverLocked_(auth, requestId, 'Approved', String(comment || '').trim().slice(0, 500)));
}

// Rejects a waiver (and with it the loan request). A reason is required; it is emailed to the applicant.
function rejectLoanWaiver(requestId, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  return withScriptLock_(() => decideWaiverLocked_(auth, requestId, 'Rejected', String(reason).trim().slice(0, 500)));
}

function decideWaiverLocked_(auth, requestId, decision, comment) {
  const id = String(requestId || '').trim();
  const lr = readSheet_(SH_LOAN_REQ, 'requestid');
  const req = lr.rows.find(r => String(r['RequestID'] || '').trim() === id);
  if (!req) return { ok: false, error: 'Request not found.' };
  const w = waiverFor_(id);
  const me = memberByNo_(auth.member.memberNo);
  const decisions = waiverDecisions_(id);
  const err = waiverDeciderError_(w, req, me, decisions, decision === 'Approved'); if (err) return { ok: false, error: err };
  const memberNo = String(req['MemberNo'] || '').trim();
  const applicant = memberByNo_(memberNo);
  const role = String(me['Committee Role'] || '').trim();
  const who = auth.member.name + ' (' + auth.member.memberNo + ', ' + role + ')';
  const amount = num(req['Amount (UGX)']);
  // The guarantor stage needs the loan product; check it before recording anything
  const sr = loanSpecFor_(applicant ? String(applicant['Membership Type'] || '').trim() : '', req['Repayment Term']);
  if (decision === 'Approved' && !sr.ok) return sr;

  appendByHeaders_(SH_WAIVER_DECISIONS, 'requestid', { 'Timestamp': now_ts(), 'RequestID': id, 'AdminNo': auth.member.memberNo,
    'Admin Name': auth.member.name, 'Committee Role': role, 'Decision': decision, 'Comment': comment });

  if (decision === 'Rejected') {
    setWaiverStatus_(id, WAIVER_STATUS.REJECTED);
    updateReqStatus_(lr.sh, lr.headers, lr.hRow, id, 'Rejected', 'Waiver rejected: ' + comment, auth.member.memberNo);
    auditLog_('Waiver Rejected', memberNo, auth.member.memberNo, 'Secured-loan waiver rejected by ' + who + '. Reason: ' + comment
      + '. Final waiver status: ' + WAIVER_STATUS.REJECTED + '. Loan request status: Rejected.', id);
    sendEmail_(applicant && applicant['Email'], 'Secured Loan Request Update: ' + id,
      [['Request ID', id], ['Amount', fmtUGX(amount)], ['Status', WAIVER_STATUS.REJECTED], ['Reason', comment]],
      'The constitutional waiver for your loan with security was not approved, so the loan request has been closed. Please contact the committee for more information.');
    return { ok: true, stage: 'rejected', waiverStatus: WAIVER_STATUS.REJECTED };
  }

  const p = waiverProgress_(decisions.concat([{ adminNo: auth.member.memberNo, role, decision: 'Approved' }]));
  if (!p.complete) {
    setWaiverStatus_(id, WAIVER_STATUS.PARTIAL);
    auditLog_('Waiver Approval', memberNo, auth.member.memberNo, 'Secured-loan waiver approval ' + p.count + ' of ' + p.required + ' by ' + who
      + (comment ? '. Comment: ' + comment : '') + '. ' + p.stillNeeded + ' Waiver status: ' + WAIVER_STATUS.PARTIAL + '.', id);
    sendEmail_(applicant && applicant['Email'], 'Secured Loan Request Update: ' + id,
      [['Request ID', id], ['Approval', p.count + ' of ' + p.required + ' received'], ['Approved by', auth.member.name + ' (' + role + ')'], ['Status', WAIVER_STATUS.PARTIAL]],
      'A committee administrator has approved the waiver for your loan with security. More approvals are needed before your guarantors are asked to consent.');
    return { ok: true, stage: 'partial', waiverStatus: WAIVER_STATUS.PARTIAL, approvals: p.count, required: p.required, message: p.stillNeeded };
  }

  // Waiver approved: the request joins the normal path at the guarantor stage
  const approvers = decisions.filter(d => d.decision === 'Approved').map(d => d.adminNo).concat([auth.member.memberNo]);
  setWaiverStatus_(id, WAIVER_STATUS.APPROVED);
  const cSt = ci(lr.headers, 'status'), cNotes = ci(lr.headers, 'decision notes');
  if (cSt > -1) lr.sh.getRange(req._row, cSt + 1).setValue('Pending');
  if (cNotes > -1) lr.sh.getRange(req._row, cNotes + 1).setValue('Waiver approved by ' + approvers.join(', ') + '; waiting for guarantor consent');
  const guarantors = [req['Guarantor 1'], req['Guarantor 2']].map(g => String(g || '').trim()).filter(Boolean);
  const tokens = appendGuarantors_(id, '', memberNo, guarantors);
  sendGuarantorRequests_(id, memberNo, amount, sr.spec, tokens);
  auditLog_('Waiver Approved', memberNo, auth.member.memberNo, 'Secured-loan waiver approval ' + p.count + ' of ' + p.required + ' by ' + who
    + (comment ? '. Comment: ' + comment : '') + '. Approved by ' + approvers.join(', ') + '. Final waiver status: ' + WAIVER_STATUS.APPROVED
    + '. Loan request moves to the guarantor stage; guarantors ' + guarantors.join(', ') + ' asked to consent.', id);
  sendEmail_(applicant && applicant['Email'], 'Secured Loan Request Update: ' + id,
    [['Request ID', id], ['Approvals', p.count + ' of ' + p.required + ' received'], ['Status', WAIVER_STATUS.APPROVED], ['Next step', 'Guarantor consent']],
    'All the required committee approvals for the waiver have been given. Your two guarantors have now been asked to consent; after that, two different admins must approve the loan before it is issued.');
  notifyAdmins_('Waiver approved: ' + id, [['Request ID', id], ['Member', (applicant ? applicant['Full Name'] : memberNo) + ' (' + memberNo + ')'],
    ['Amount', fmtUGX(amount)], ['Approved by', approvers.join(', ')]],
    'The secured-loan waiver is approved. The guarantors have been asked to consent; then two different admins must approve the loan as usual.');
  return { ok: true, stage: 'approved', waiverStatus: WAIVER_STATUS.APPROVED, approvals: p.count, required: p.required };
}
