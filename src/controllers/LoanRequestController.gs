// ── LOAN REQUESTS ─────────────────────────────────────────────────────────────
// Every loan -- whether a member requests it or an admin issues it directly -- goes through this
// same pipeline and needs two different, non-initiating admins to approve it (segregation of duties).

// Parses a 'yyyy-MM-dd HH:mm:ss' timestamp and returns whole days since then, or null
function daysSince_(ts) {
  const d = new Date(String(ts||'').trim().replace(' ', 'T'));
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Loan product for the applicant's form: a Non-Member sees the Soft Loan term table (days),
// a Founder/Delegate Member sees the fixed 10% / minimum-2-months product (months).
function getLoanTerms(forMemberNo) {
  const auth = caller_(); if (!auth.ok) return auth;
  const isAdmin = String(auth.member.role||'').toLowerCase() === 'admin';
  const who = (isAdmin && forMemberNo) ? String(forMemberNo).trim() : auth.member.memberNo;
  const m = memberByNo_(who);
  const membershipType = m ? String(m['Membership Type']||'').trim() : (auth.member.membershipType||'');
  if (membershipType === 'Non-Member')
    return { ok: true, membershipType, product: 'soft', fee: PROCESSING_FEE,
      terms: LOAN_TERMS.map(t => ({ key: t.key, label: t.label, days: t.days, rate: r2(t.rate * 100) })) };
  if (membershipType === 'Founder Member' || membershipType === 'Delegate Member')
    return { ok: true, membershipType, product: 'member', fee: MEMBER_LOAN_FEE,
      rate: r2(MEMBER_LOAN_RATE * 100), minMonths: MEMBER_LOAN_MIN_MONTHS };
  return { ok: true, membershipType, product: 'none' };
}

// Total due for a loan of this size and spec (used for the admin and member lists)
function quoteFor_(amount, spec) {
  if (!spec) return { total: 0, interest: 0, label: '' };
  const t = loanAmounts_(num(amount), spec);
  return { total: t.total, interest: t.interest, label: spec.label };
}

// Writes a new Loan Requests row and returns { newId, q } (q: the quote, with the total due).
// status: 'Pending' for a normal request, REQ_PENDING_WAIVER for a secured-loan request (ISS-11).
function writeLoanRequestRow_(memberNo, initiatedBy, amount, spec, termInput, purpose, guarantors, status, guarantorOverride) {
  const rd = readSheet_(SH_LOAN_REQ,'requestid');
  const { sh, headers } = rd;
  if (ci(headers,'repayment term') < 0 || ci(headers,'initiated by') < 0)
    throw new Error('Loan Requests sheet is missing a required column (Repayment Term or Initiated By). Run setupGuaranteeSchema() once from the script editor.');
  if (guarantorOverride && ci(headers,'guarantor override') < 0)
    throw new Error('Loan Requests sheet is missing the "Guarantor Override" column. Run setupGuaranteeSchema() once from the script editor.');
  const newId = nextId_(SH_LOAN_REQ,'requestid','loanRequest', rd);
  const q = quoteFor_(amount, spec);
  const cells = [[ci(headers,'requestid'),newId], [ci(headers,'timestamp'),now_ts()],
    [ci(headers,'memberno'),memberNo], [ci(headers,'amount'),amount],
    [ci(headers,'repayment term'), spec.model === MEMBER_LOAN_MODEL ? String(spec.months) : termInput],
    [ci(headers,'purpose'),purpose||''], [ci(headers,'status'),status], [ci(headers,'initiated by'), initiatedBy],
    [ci(headers,'guarantor 1'),guarantors[0]||''], [ci(headers,'guarantor 2'),guarantors[1]||''], [ci(headers,'total due'),q.total]];
  if (guarantorOverride) cells.push([ci(headers,'guarantor override'), guarantorOverride]);
  writeCells_(sh, freeRowFinder_(rd, ci(headers,'memberno'))(), headers.length, cells);
  return { newId, q };
}

// Creates a Pending loan request row. Used both when a member requests their own loan
// (memberNo === initiatedBy) and when an admin issues one on a member's behalf (initiatedBy
// is the admin -- who is then excluded from approving it, since they initiated it).
// guarantorOverride (admin proposals only) lifts the Sec 8 guarantor restriction, with its reason recorded.
// Runs under the script lock: the checks (guarantors free, one running loan) and the new rows are one step,
// so two requests at the same moment cannot take the same request ID or row, or the same guarantor.
// Emails are sent once the lock is released (sendHtmlEmail_).
function submitLoanRequest_(memberNo, initiatedBy, initiatorName, amount, termInput, purpose, guarantorNos, guarantorOverride) {
  return withScriptLock_(() => submitLoanRequestLocked_(memberNo, initiatedBy, initiatorName, amount, termInput, purpose, guarantorNos, guarantorOverride));
}

function submitLoanRequestLocked_(memberNo, initiatedBy, initiatorName, amount, termInput, purpose, guarantorNos, guarantorOverride) {
  amount = num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const ctx = loanCtx_();
  const member = ctx.member(memberNo);
  if (!member) return { ok: false, error: 'Member not found.' };
  const membershipType = String(member['Membership Type']||'').trim();
  const sr = loanSpecFor_(membershipType, termInput); if (!sr.ok) return sr;
  const spec = sr.spec;
  guarantorOverride = String(guarantorOverride||'').trim();
  const el = loanEligibility_(memberNo, membershipType, guarantorOverride, ctx); if (!el.ok) return el;
  const overrideUsed = guarantorOverride && liveGuaranteesOf_(memberNo, '', ctx) > 0;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) {
    gc = guarantorChecks_(memberNo, amount, guarantorNos, '', null, ctx);
    // A guarantor short of the 25% savings coverage: a Founder Member may ask for a loan with security instead
    if (!gc.ok) return Object.assign(gc, { securedAvailable: !!gc.coverageFailed && SECURED_LOAN_MEMBERSHIP_TYPES.indexOf(membershipType) > -1 });
  }
  const { newId, q } = writeLoanRequestRow_(memberNo, initiatedBy, amount, spec, termInput, purpose, gc.guarantors, 'Pending',
    overrideUsed ? guarantorOverride : '');
  const tokens = spec.guarantorsRequired ? appendGuarantors_(newId, '', memberNo, gc.guarantors) : [];
  if (spec.guarantorsRequired) sendGuarantorRequests_(newId, memberNo, amount, spec, tokens);
  notifyAdmins_('New Loan Request: '+newId,[
    ['Request ID',newId],['Member',(member?member['Full Name']:memberNo)+' ('+memberNo+')'],['Initiated by',initiatorName],
    ['Amount',fmtUGX(amount)],['Repayment term',spec.label+' at '+r2(spec.rate*100)+'% interest'],
    ['Total due',fmtUGX(q.total)],['Purpose',purpose||'-'],
    ['Guarantors',gc.guarantors.length?gc.guarantors.join(', '):'None required']
  ],'A new loan request has been submitted. Both guarantors must consent by email before it can be approved; then two different admins must approve. Decision due within 3 days.');
  auditLog_('Loan Request Submitted', memberNo, initiatedBy,
    'Requested '+fmtUGX(amount)+' over '+spec.label+'. Guarantors: '+(gc.guarantors.join(', ')||'none')+'. Purpose: '+(purpose||'-'), newId);
  if (overrideUsed)
    auditLog_('Guarantor Restriction Override', memberNo, initiatedBy,
      'Member is guaranteeing a running loan; loan proposed anyway (Art. 4, Sec. 8). Reason: '+guarantorOverride, newId);
  return { ok: true, requestId: newId, total: q.total };
}

function requestLoan(amount, termInput, purpose, guarantorNos) {
  const auth = caller_(); if (!auth.ok) return auth;
  return submitLoanRequest_(auth.member.memberNo, auth.member.memberNo, auth.member.name, amount, termInput, purpose, guarantorNos);
}

function getMyLoanRequests() {
  const auth = caller_(); if (!auth.ok) return auth;
  return myLoanRequestsFor_(auth.member);
}

function myLoanRequestsFor_(member) {
  const { rows } = readSheet_(SH_LOAN_REQ,'requestid');
  const waivers = waiversByRequest_();
  return { ok: true, requests: rows
    .filter(r => String(r['MemberNo']||'').trim()===member.memberNo)
    .map(r => {
      const sr = loanSpecFor_(member.membershipType, r['Repayment Term']);
      const spec = sr.ok ? sr.spec : null;
      return {requestId:r['RequestID'],amount:num(r['Amount (UGX)']),
        termLabel: spec ? spec.label : (r['Repayment Term']||''),
        total: num(r['Total Due']) || (spec ? quoteFor_(num(r['Amount (UGX)']), spec).total : 0),
        purpose:r['Purpose']||'',status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        waiver: waivers[String(r['RequestID']||'').trim()] ? memberWaiverView_(waivers[String(r['RequestID']||'').trim()]) : null};
    })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

// { requestId: Loan Waivers row } for every secured-loan request
function waiversByRequest_() {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_WAIVERS)) return out;
  readSheet_(SH_WAIVERS, 'requestid').rows.forEach(w => { const id = String(w['RequestID']||'').trim(); if (id) out[id] = w; });
  return out;
}

// What the applicant sees of their waiver: status, what was not met, approvals so far (not who)
function memberWaiverView_(w) {
  const p = waiverProgress_(waiverDecisions_(w['RequestID']));
  return { status: String(w['Waiver Status']||''), failed: String(w['Failed Requirements']||'').split('\n').filter(Boolean),
    security: securityLabel_(w), approvals: p.count, required: p.required };
}

function getLoanRequests() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { rows } = readSheet_(SH_LOAN_REQ,'requestid');
  const gmap = guarantorMap_();
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const nameOf = {}; const typeOf = {};
  members.forEach(m => {
    const no = String(m['MemberNo']||'').trim();
    nameOf[no] = m['Full Name'] || ''; typeOf[no] = String(m['Membership Type']||'').trim();
  });
  const { rows: allGuar } = readSheet_(SH_GUARANTORS,'requestid');
  const respOf = {};
  allGuar.forEach(g => { respOf[String(g['RequestID']||'').trim()+'|'+String(g['GuarantorNo']||'').trim()] = String(g['Response']||'Pending').trim() || 'Pending'; });
  const waivers = waiversByRequest_();
  const viewer = memberByNo_(auth.member.memberNo);
  const ctx = loanCtx_();   // the savings ledger is read once for every request's limit check
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r => {
      const id = String(r['RequestID']).trim();
      const status = String(r['Status']||'').trim();
      const amount = num(r['Amount (UGX)']);
      const memberNo = String(r['MemberNo']||'').trim();
      const membershipType = typeOf[memberNo]||'';
      const sr = loanSpecFor_(membershipType, r['Repayment Term']);
      const spec = sr.ok ? sr.spec : null;
      const lc = (spec && spec.savingsLimit) ? checkLimit_(memberNo,amount,ctx) : {withinLimit:true,savings:0,maxLoan:0};
      const w = waivers[id];
      const days = (isOpenRequest_(r) || status === REQ_PENDING_WAIVER) ? daysSince_(r['Timestamp']) : null;
      const q = quoteFor_(amount, spec);
      const initiatedBy = String(r['Initiated By']||memberNo).trim();
      const approver1 = String(r['Approver 1']||'').trim();
      const approver2 = String(r['Approver 2']||'').trim();
      return {requestId:id,memberNo:r['MemberNo'],memberName:nameOf[memberNo]||r['MemberNo'],membershipType,
        amount, termLabel: spec ? spec.label : 'Not set', total: q.total,
        guarantorsRequired: spec ? spec.guarantorsRequired : false, savingsLimit: spec ? !!spec.savingsLimit : false,
        guarantorOverride: String(r['Guarantor Override']||''), limitOverride: String(r['Limit Override']||''),
        purpose:r['Purpose']||'', status, decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        withinLimit:lc.withinLimit,savings:lc.savings,maxLoan:lc.maxLoan,
        secured: !!w, waiver: w ? waiverView_(w, r, viewer) : null,
        waivedLimit: !!(w && String(w['Waiver Status']||'').trim() === WAIVER_STATUS.APPROVED && waivedChecks_(w).applicantLimit),
        pendingGuarantors: status === REQ_PENDING_WAIVER ? [r['Guarantor 1'], r['Guarantor 2']].map(g => String(g||'').trim()).filter(Boolean)
          .map(no => ({memberNo:no, name:nameOf[no]||no, response:'Not asked yet'})) : [],
        guarantors: (spec && spec.guarantorsRequired) ? (gmap[id]||[]).map(no => ({memberNo:no, name:nameOf[no]||no, response:respOf[id+'|'+no]||'Pending'})) : [],
        daysPending: days, decisionOverdue: days !== null && days > DECISION_WINDOW_DAYS,
        initiatedBy, initiatedByName: nameOf[initiatedBy]||initiatedBy,
        approver1, approver1Name: approver1 ? (nameOf[approver1]||approver1) : '',
        approver2, approver2Name: approver2 ? (nameOf[approver2]||approver2) : ''};
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

// Casts one of the two required admin approvals. The order is fixed: both guarantors consent first,
// then two different admins approve, and the second approval issues the loan. Until both guarantors
// have accepted, no admin approval is recorded; a decline blocks it for good. Neither approver may be
// the initiator or the applicant. A request left "Awaiting Guarantors" by the earlier any-order flow
// is issued (or retried) here once its guarantors have all accepted. Runs under the script lock so
// two admins approving at once cannot create the loan twice.
function approveLoanRequest(requestId, overrideReason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  return withScriptLock_(() => approveLoanRequestLocked_(auth, requestId, overrideReason));
}

function approveLoanRequestLocked_(auth, requestId, overrideReason) {
  const { sh, headers, hRow, rows } = readSheet_(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  overrideReason = String(overrideReason||'').trim();
  // Secured-loan request (ISS-11): no loan approval until the committee has approved its waiver
  if (String(req['Status']||'').trim() === REQ_PENDING_WAIVER) return {ok:false,error:waiverPendingMessage_(requestId)};
  const waived = approvedWaiverChecks_(requestId);
  if (waived && waived.error) return {ok:false,error:waived.error};
  if (String(req['Status']||'').trim() === AWAITING_GUARANTORS) {
    const me = auth.member.memberNo, member = String(req['MemberNo']||'').trim();
    if (me === String(req['Initiated By']||member).trim() || me === member) return {ok:false,error:'A different admin, who is neither the initiator nor the applicant, must issue this loan.'};
    if (overrideReason) setLoanRequestCell_(sh, headers, req._row, 'limit override', overrideReason);
    return finalizeLoanRequestLocked_(requestId, me);
  }
  const dutyErr = approvalDutyError_(req, auth.member.memberNo);
  if (dutyErr) return {ok:false,error:dutyErr};
  const approver1 = String(req['Approver 1']||'').trim();
  const guarantorOverride = String(req['Guarantor Override']||'').trim();

  const amount=num(req['Amount (UGX)']);
  const ctx = loanCtx_();   // one read of each tab for every check below (and the final approval)
  const member = ctx.member(req['MemberNo']);
  const membershipType = member ? String(member['Membership Type']||'').trim() : '';
  const sr = loanSpecFor_(membershipType, req['Repayment Term']);
  if (!sr.ok) return sr;
  const spec = sr.spec;
  const el=loanEligibility_(req['MemberNo'], membershipType, guarantorOverride, ctx); if (!el.ok) return el;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) {
    gc=guarantorChecks_(req['MemberNo'], amount, guarantorMap_()[String(requestId).trim()]||[], requestId, waived ? waived.guarantors : [], ctx);
    if (!gc.ok) return gc;
    const gate = guarantorGate_(requestId); if (!gate.ok) return gate;
  }
  // Limit override: given now, or by the other approving admin earlier (kept on the request).
  // An approved secured-loan waiver of the applicant's coverage takes the place of an override.
  const storedOverride = String(req['Limit Override']||'').trim();
  const lc = (spec.savingsLimit && !(waived && waived.applicantLimit)) ? checkLimit_(req['MemberNo'],amount,ctx) : {withinLimit:true,savings:0,maxLoan:0};
  if (!lc.withinLimit && !overrideReason && !storedOverride)
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide override reason.',limitCheck:lc};
  if (overrideReason) {
    if (ci(headers,'limit override') < 0) throw new Error('Loan Requests sheet is missing the "Limit Override" column. Run setupFinanceSchema() once from the script editor.');
    setLoanRequestCell_(sh, headers, req._row, 'limit override', overrideReason);
  }
  if (!approver1) {
    setApprover_(sh, headers, hRow, requestId, 1, auth.member.memberNo);
    updateReqStatus_(sh, headers, hRow, requestId, 'Partially Approved',
      'First approval by '+auth.member.memberNo+(overrideReason?' [OVERRIDE: '+overrideReason+']':''), auth.member.memberNo);
    sendEmail_(member?.['Email'],'Loan Request Update: '+requestId,[['Request ID',requestId],['Status','First approval received']],
      'Your loan request has received its first admin approval. A second, different admin must approve before it is finalized.');
    notifyAdmins_('Second approval needed: '+requestId,[['Request ID',requestId],['Member',(member?member['Full Name']:req['MemberNo'])+' ('+req['MemberNo']+')'],
      ['Amount',fmtUGX(amount)],['First approval',auth.member.name+' ('+auth.member.memberNo+')']],
      'This loan request has its first approval. A different admin, who is neither the initiator nor the applicant, must give the final approval.');
    auditLog_('Loan Request First Approval', req['MemberNo'], auth.member.memberNo,
      'First of two required approvals.'+(overrideReason?' Override: '+overrideReason:'')+(guarantorOverride?' Guarantor restriction override on file: '+guarantorOverride:''), requestId);
    return { ok: true, stage: 'first', message: 'First approval recorded. A second, different admin must approve to finish.' };
  }

  setApprover_(sh, headers, hRow, requestId, 2, auth.member.memberNo);
  // The approver cells just written do not affect the checks, so the final approval reuses ctx
  return finalizeLoanRequestLocked_(requestId, auth.member.memberNo, ctx);
}

// Why a secured-loan request cannot be approved yet: how many waiver approvals it has and still needs
function waiverPendingMessage_(requestId) {
  const p = waiverProgress_(waiverDecisions_(requestId));
  return 'This secured-loan request is waiting for its waiver: ' + p.count + ' of ' + p.required + ' committee approvals. ' + p.stillNeeded
    + ' Guarantors are asked to consent, and the loan can be approved, only after the waiver is approved.';
}

function setLoanRequestCell_(sh, headers, rowNum, name, value) {
  const c = ci(headers, name);
  if (c > -1) sh.getRange(rowNum, c + 1).setValue(value);
}

// Issues the loan for a request that has both admin approvals and every guarantor's acceptance. All the
// rules are checked again first, because time may have passed since the approvals. issuedBy: the admin
// who gave the last approval or retried, or the second approver when a guarantor's acceptance completes it.
// Caller holds the script lock. Returns { ok, loanId, stage:'final' } or { ok:false, error }.
// ctx: the loanCtx_() of the approval being given now (optional; read fresh otherwise).
function finalizeLoanRequestLocked_(requestId, issuedBy, ctx) {
  ctx = ctx || loanCtx_();
  const { sh, headers, hRow, rows } = readSheet_(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req || !isOpenRequest_(req)) return {ok:false,error:'Already decided.'};
  const approver1 = String(req['Approver 1']||'').trim(), approver2 = String(req['Approver 2']||'').trim();
  if (!approver1 || !approver2) return {ok:false,error:'This request does not have two admin approvals yet.'};
  const waived = approvedWaiverChecks_(requestId);
  if (waived && waived.error) return {ok:false,error:waived.error};
  const guarantorOverride = String(req['Guarantor Override']||'').trim();
  const overrideReason = String(req['Limit Override']||'').trim();
  const amount=num(req['Amount (UGX)']);
  const member = ctx.member(req['MemberNo']);
  const membershipType = member ? String(member['Membership Type']||'').trim() : '';
  const sr = loanSpecFor_(membershipType, req['Repayment Term']); if (!sr.ok) return sr;
  const spec = sr.spec;
  const el=loanEligibility_(req['MemberNo'], membershipType, guarantorOverride, ctx); if (!el.ok) return el;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) {
    gc=guarantorChecks_(req['MemberNo'], amount, guarantorMap_()[String(requestId).trim()]||[], requestId, waived ? waived.guarantors : [], ctx);
    if (!gc.ok) return gc;
    const gate=guarantorGate_(requestId); if (!gate.ok) return gate;
  }
  const lc = (spec.savingsLimit && !(waived && waived.applicantLimit)) ? checkLimit_(req['MemberNo'],amount,ctx) : {withinLimit:true,savings:0,maxLoan:0};
  if (!lc.withinLimit && !overrideReason)
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. An approving admin must give an override reason.',limitCheck:lc};

  const newId=createLoanRow_(req['MemberNo'],amount,req['Purpose']||'',issuedBy,overrideReason,spec);
  if (spec.guarantorsRequired) linkGuarantorsToLoan_(requestId,newId);
  updateReqStatus_(sh,headers,hRow,requestId,'Approved',
    'Approved → '+newId+' by '+approver1+' and '+approver2+(overrideReason?' [OVERRIDE: '+overrideReason+']':''),issuedBy);
  const t=loanAmounts_(amount, spec);
  const dueDate = spec.model === MEMBER_LOAN_MODEL ? addMonths_(new Date(), spec.months) : addDays_(new Date(), spec.days);
  sendEmail_(member?.['Email'],'Loan Request Approved: '+requestId,[
    ['Request ID',requestId],['Loan ID',newId],['Amount',fmtUGX(amount)],
    ['Interest ('+r2(spec.rate*100)+'%)',fmtUGX(t.interest)],['Processing fee',fmtUGX(t.fee)],
    ['Total to repay',fmtUGX(t.total)],['Due date',human_date(dueDate)]
  ],'Your loan request has received both required admin approvals and the loan has been issued. The due date is counted from today.');
  auditLog_('Loan Request Fully Approved', req['MemberNo'], issuedBy,
    'Approved '+fmtUGX(amount)+' over '+spec.label+' by '+approver1+' and '+approver2+'. Loan '+newId+' created. Guarantors: '+(gc.guarantors.join(', ')||'none')+'.'+(overrideReason?' Override: '+overrideReason:'')+(guarantorOverride?' Guarantor restriction override: '+guarantorOverride:''), requestId);
  return { ok: true, loanId: newId, stage: 'final' };
}

function rejectLoanRequest(requestId, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  return withScriptLock_(() => rejectLoanRequestLocked_(auth, requestId, reason));
}

function rejectLoanRequestLocked_(auth, requestId, reason) {
  const { sh, headers, hRow, rows } = readSheet_(SH_LOAN_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  // A secured-loan request still at the waiver stage is decided by the committee (rejectLoanWaiver)
  if (String(req['Status']||'').trim() === REQ_PENDING_WAIVER) return {ok:false,error:'This secured-loan request is waiting for its waiver decision. A committee administrator rejects it with Reject waiver.'};
  if (!isOpenRequest_(req)) return {ok:false,error:'Already decided.'};
  updateReqStatus_(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=memberByNo_(req['MemberNo']);
  sendEmail_(m?.['Email'],'Loan Request Update: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your loan request was not approved. Please contact the committee for more information.');
  auditLog_('Loan Request Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
