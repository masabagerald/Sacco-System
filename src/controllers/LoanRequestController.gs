// ── LOAN REQUESTS ─────────────────────────────────────────────────────────────
// Every loan -- whether a member requests it or an admin issues it directly -- goes through this
// same pipeline and needs two different, non-initiating admins to approve it (segregation of duties).

// Parses a 'yyyy-MM-dd HH:mm:ss' timestamp and returns whole days since then, or null
function _daysSince(ts) {
  const d = new Date(String(ts||'').trim().replace(' ', 'T'));
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Loan product for the applicant's form: a Non-Member sees the Soft Loan term table (days),
// a Founder/Delegate Member sees the fixed 10% / minimum-2-months product (months).
function getLoanTerms(forMemberNo) {
  const auth = _caller(); if (!auth.ok) return auth;
  const isAdmin = String(auth.member.role||'').toLowerCase() === 'admin';
  const who = (isAdmin && forMemberNo) ? String(forMemberNo).trim() : auth.member.memberNo;
  const m = _memberByNo(who);
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
function _quoteFor(amount, spec) {
  if (!spec) return { total: 0, interest: 0, label: '' };
  const t = _loanAmounts(num(amount), spec);
  return { total: t.total, interest: t.interest, label: spec.label };
}

// Creates a Pending loan request row. Used both when a member requests their own loan
// (memberNo === initiatedBy) and when an admin issues one on a member's behalf (initiatedBy
// is the admin -- who is then excluded from approving it, since they initiated it).
// guarantorOverride (admin proposals only) lifts the Sec 8 guarantor restriction, with its reason recorded.
function _submitLoanRequest(memberNo, initiatedBy, initiatorName, amount, termInput, purpose, guarantorNos, guarantorOverride) {
  amount = num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const member = _memberByNo(memberNo);
  if (!member) return { ok: false, error: 'Member not found.' };
  const membershipType = String(member['Membership Type']||'').trim();
  const sr = _loanSpecFor(membershipType, termInput); if (!sr.ok) return sr;
  const spec = sr.spec;
  guarantorOverride = String(guarantorOverride||'').trim();
  const el = _loanEligibility(memberNo, membershipType, guarantorOverride); if (!el.ok) return el;
  const overrideUsed = guarantorOverride && _liveGuaranteesOf(memberNo, '') > 0;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) { gc = _guarantorChecks(memberNo, amount, guarantorNos, ''); if (!gc.ok) return gc; }
  const { sh, headers, hRow } = readSheet(SH_LOAN_REQ,'requestid');
  if (ci(headers,'repayment term') < 0 || ci(headers,'initiated by') < 0)
    throw new Error('Loan Requests sheet is missing a required column (Repayment Term or Initiated By). Run setupGuaranteeSchema() once from the script editor.');
  if (overrideUsed && ci(headers,'guarantor override') < 0)
    throw new Error('Loan Requests sheet is missing the "Guarantor Override" column. Run setupGuaranteeSchema() once from the script editor.');
  const newId = nextId(SH_LOAN_REQ,'requestid','R');
  const row = emptyRow(sh, hRow, ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'amount'),amount);
  s(ci(headers,'repayment term'), spec.model === MEMBER_LOAN_MODEL ? String(spec.months) : termInput);
  s(ci(headers,'purpose'),purpose||''); s(ci(headers,'status'),'Pending');
  s(ci(headers,'initiated by'), initiatedBy);
  s(ci(headers,'guarantor 1'),gc.guarantors[0]||''); s(ci(headers,'guarantor 2'),gc.guarantors[1]||'');
  if (overrideUsed) s(ci(headers,'guarantor override'), guarantorOverride);
  const q = _quoteFor(amount, spec);
  s(ci(headers,'total due'),q.total);
  const tokens = spec.guarantorsRequired ? _appendGuarantors(newId, '', memberNo, gc.guarantors) : [];
  if (spec.guarantorsRequired) _sendGuarantorRequests(newId, memberNo, amount, purpose, spec, tokens);
  _notifyAdmins('New Loan Request: '+newId,[
    ['Request ID',newId],['Member',(member?member['Full Name']:memberNo)+' ('+memberNo+')'],['Initiated by',initiatorName],
    ['Amount',fmtUGX(amount)],['Repayment term',spec.label+' at '+r2(spec.rate*100)+'% interest'],
    ['Total due',fmtUGX(q.total)],['Purpose',purpose||'-'],
    ['Guarantors',gc.guarantors.length?gc.guarantors.join(', '):'None required']
  ],'A new loan request is pending two different admin approvals. Decision due within 3 days.');
  auditLog('Loan Request Submitted', memberNo, initiatedBy,
    'Requested '+fmtUGX(amount)+' over '+spec.label+'. Guarantors: '+(gc.guarantors.join(', ')||'none')+'. Purpose: '+(purpose||'-'), newId);
  if (overrideUsed)
    auditLog('Guarantor Restriction Override', memberNo, initiatedBy,
      'Member is guaranteeing a running loan; loan proposed anyway (Art. 4, Sec. 8). Reason: '+guarantorOverride, newId);
  return { ok: true, requestId: newId, total: q.total };
}

function requestLoan(amount, termInput, purpose, guarantorNos) {
  const auth = _caller(); if (!auth.ok) return auth;
  return _submitLoanRequest(auth.member.memberNo, auth.member.memberNo, auth.member.name, amount, termInput, purpose, guarantorNos);
}

function getMyLoanRequests() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r => String(r['MemberNo']||'').trim()===auth.member.memberNo)
    .map(r => {
      const sr = _loanSpecFor(auth.member.membershipType, r['Repayment Term']);
      const spec = sr.ok ? sr.spec : null;
      return {requestId:r['RequestID'],amount:num(r['Amount (UGX)']),
        termLabel: spec ? spec.label : (r['Repayment Term']||''),
        total: num(r['Total Due']) || (spec ? _quoteFor(num(r['Amount (UGX)']), spec).total : 0),
        purpose:r['Purpose']||'',status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp']};
    })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function getLoanRequests() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  const gmap = _guarantorMap();
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const nameOf = {}; const typeOf = {};
  members.forEach(m => {
    const no = String(m['MemberNo']||'').trim();
    nameOf[no] = m['Full Name'] || ''; typeOf[no] = String(m['Membership Type']||'').trim();
  });
  const { rows: allGuar } = readSheet(SH_GUARANTORS,'requestid');
  const respOf = {};
  allGuar.forEach(g => { respOf[String(g['RequestID']||'').trim()+'|'+String(g['GuarantorNo']||'').trim()] = String(g['Response']||'Pending').trim() || 'Pending'; });
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r => {
      const id = String(r['RequestID']).trim();
      const status = String(r['Status']||'').trim();
      const amount = num(r['Amount (UGX)']);
      const memberNo = String(r['MemberNo']||'').trim();
      const membershipType = typeOf[memberNo]||'';
      const sr = _loanSpecFor(membershipType, r['Repayment Term']);
      const spec = sr.ok ? sr.spec : null;
      const lc = (spec && spec.savingsLimit) ? _checkLimit(memberNo,amount) : {withinLimit:true,savings:0,maxLoan:0};
      const days = _isOpenRequest(r) ? _daysSince(r['Timestamp']) : null;
      const q = _quoteFor(amount, spec);
      const initiatedBy = String(r['Initiated By']||memberNo).trim();
      const approver1 = String(r['Approver 1']||'').trim();
      const approver2 = String(r['Approver 2']||'').trim();
      return {requestId:id,memberNo:r['MemberNo'],memberName:nameOf[memberNo]||r['MemberNo'],membershipType,
        amount, termLabel: spec ? spec.label : 'Not set', total: q.total,
        guarantorsRequired: spec ? spec.guarantorsRequired : false, savingsLimit: spec ? !!spec.savingsLimit : false,
        guarantorOverride: String(r['Guarantor Override']||''), limitOverride: String(r['Limit Override']||''),
        purpose:r['Purpose']||'', status, decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        withinLimit:lc.withinLimit,savings:lc.savings,maxLoan:lc.maxLoan,
        guarantors: (spec && spec.guarantorsRequired) ? (gmap[id]||[]).map(no => ({memberNo:no, name:nameOf[no]||no, response:respOf[id+'|'+no]||'Pending'})) : [],
        daysPending: days, decisionOverdue: days !== null && days > DECISION_WINDOW_DAYS,
        initiatedBy, initiatedByName: nameOf[initiatedBy]||initiatedBy,
        approver1, approver1Name: approver1 ? (nameOf[approver1]||approver1) : '',
        approver2, approver2Name: approver2 ? (nameOf[approver2]||approver2) : ''};
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

// Casts one of the two required admin approvals. Admins and guarantors can act in any order: the loan
// is issued by whichever comes last -- the second admin approval (if every guarantor has accepted) or
// the last guarantor's acceptance (if both admins have approved; see GuarantorWeb.gs). A guarantor's
// decline blocks approval. Neither approver may be the initiator or the applicant. On a request
// already "Awaiting Guarantors" whose guarantors have all accepted, this retries issuing the loan
// (used when issuing failed at the guarantor's acceptance). Runs under the script lock so two
// admins approving at once cannot create the loan twice.
function approveLoanRequest(requestId, overrideReason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return _withScriptLock(() => _approveLoanRequestLocked(auth, requestId, overrideReason));
}

function _approveLoanRequestLocked(auth, requestId, overrideReason) {
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  overrideReason = String(overrideReason||'').trim();
  if (String(req['Status']||'').trim() === AWAITING_GUARANTORS) {
    const me = auth.member.memberNo, member = String(req['MemberNo']||'').trim();
    if (me === String(req['Initiated By']||member).trim() || me === member) return {ok:false,error:'A different admin, who is neither the initiator nor the applicant, must issue this loan.'};
    if (overrideReason) _setLoanRequestCell(sh, headers, req._row, 'limit override', overrideReason);
    return _finalizeLoanRequestLocked(requestId, me);
  }
  const dutyErr = _approvalDutyError(req, auth.member.memberNo);
  if (dutyErr) return {ok:false,error:dutyErr};
  const approver1 = String(req['Approver 1']||'').trim();
  const guarantorOverride = String(req['Guarantor Override']||'').trim();

  const amount=num(req['Amount (UGX)']);
  const member = _memberByNo(req['MemberNo']);
  const membershipType = member ? String(member['Membership Type']||'').trim() : '';
  const sr = _loanSpecFor(membershipType, req['Repayment Term']);
  if (!sr.ok) return sr;
  const spec = sr.spec;
  const el=_loanEligibility(req['MemberNo'], membershipType, guarantorOverride); if (!el.ok) return el;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) {
    gc=_guarantorChecks(req['MemberNo'], amount, _guarantorMap()[String(requestId).trim()]||[], requestId);
    if (!gc.ok) return gc;
    const declined = _guaranteeResponses(requestId).find(g => g.response === 'Declined');
    if (declined) return {ok:false,error:'Guarantor ' + declined.guarantorNo + ' declined this request. It cannot be approved; reject it with a reason.'};
  }
  // Limit override: given now, or by the other approving admin earlier (kept on the request)
  const storedOverride = String(req['Limit Override']||'').trim();
  const lc = spec.savingsLimit ? _checkLimit(req['MemberNo'],amount) : {withinLimit:true,savings:0,maxLoan:0};
  if (!lc.withinLimit && !overrideReason && !storedOverride)
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide override reason.',limitCheck:lc};
  if (overrideReason) {
    if (ci(headers,'limit override') < 0) throw new Error('Loan Requests sheet is missing the "Limit Override" column. Run setupFinanceSchema() once from the script editor.');
    _setLoanRequestCell(sh, headers, req._row, 'limit override', overrideReason);
  }
  const guarantorsReady = !spec.guarantorsRequired || _guarantorGate(requestId).ok;
  const waitingNote = guarantorsReady ? '' : ' Waiting for: ' + _guaranteeResponses(requestId).filter(g => g.response !== 'Accepted').map(g => g.guarantorNo).join(', ') + '.';

  if (!approver1) {
    _setApprover(sh, headers, hRow, requestId, 1, auth.member.memberNo);
    _updateReqStatus(sh, headers, hRow, requestId, 'Partially Approved',
      'First approval by '+auth.member.memberNo+(overrideReason?' [OVERRIDE: '+overrideReason+']':''), auth.member.memberNo);
    _sendEmail(member?.['Email'],'Loan Request Update: '+requestId,[['Request ID',requestId],['Status','First approval received']],
      'Your loan request has received its first admin approval. A second, different admin must approve'+(guarantorsReady?'':', and every guarantor must accept,')+' before it is finalized.');
    _notifyAdmins('Second approval needed: '+requestId,[['Request ID',requestId],['Member',(member?member['Full Name']:req['MemberNo'])+' ('+req['MemberNo']+')'],
      ['Amount',fmtUGX(amount)],['First approval',auth.member.name+' ('+auth.member.memberNo+')']],
      'This loan request has its first approval. A different admin, who is neither the initiator nor the applicant, must give the final approval.');
    auditLog('Loan Request First Approval', req['MemberNo'], auth.member.memberNo,
      'First of two required approvals.'+(overrideReason?' Override: '+overrideReason:'')+(guarantorOverride?' Guarantor restriction override on file: '+guarantorOverride:''), requestId);
    return { ok: true, stage: 'first', message: 'First approval recorded. A second, different admin must approve to finish.'+waitingNote };
  }

  _setApprover(sh, headers, hRow, requestId, 2, auth.member.memberNo);
  if (guarantorsReady) return _finalizeLoanRequestLocked(requestId, auth.member.memberNo);
  _updateReqStatus(sh, headers, hRow, requestId, AWAITING_GUARANTORS,
    'Approved by '+approver1+' and '+auth.member.memberNo+(overrideReason?' [OVERRIDE: '+overrideReason+']':'')+'. The loan is issued when every guarantor has accepted.'+waitingNote, auth.member.memberNo);
  _sendEmail(member?.['Email'],'Loan Request Update: '+requestId,[['Request ID',requestId],['Status','Approved by two admins; waiting for guarantors']],
    'Your loan request has both admin approvals. It will be issued as soon as every guarantor has accepted.');
  auditLog('Loan Request Second Approval', req['MemberNo'], auth.member.memberNo,
    'Second of two required approvals (with '+approver1+'). Loan to be issued once every guarantor accepts.'+waitingNote+(overrideReason?' Override: '+overrideReason:''), requestId);
  return { ok: true, stage: 'awaiting', message: 'Both admin approvals are in. The loan is issued automatically when every guarantor has accepted.'+waitingNote };
}

function _setLoanRequestCell(sh, headers, rowNum, name, value) {
  const c = ci(headers, name);
  if (c > -1) sh.getRange(rowNum, c + 1).setValue(value);
}

// Issues the loan for a request that has both admin approvals and every guarantor's acceptance. All the
// rules are checked again first, because time may have passed since the approvals. issuedBy: the admin
// who gave the last approval or retried, or the second approver when a guarantor's acceptance completes it.
// Caller holds the script lock. Returns { ok, loanId, stage:'final' } or { ok:false, error }.
function _finalizeLoanRequestLocked(requestId, issuedBy) {
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req || !_isOpenRequest(req)) return {ok:false,error:'Already decided.'};
  const approver1 = String(req['Approver 1']||'').trim(), approver2 = String(req['Approver 2']||'').trim();
  if (!approver1 || !approver2) return {ok:false,error:'This request does not have two admin approvals yet.'};
  const guarantorOverride = String(req['Guarantor Override']||'').trim();
  const overrideReason = String(req['Limit Override']||'').trim();
  const amount=num(req['Amount (UGX)']);
  const member = _memberByNo(req['MemberNo']);
  const membershipType = member ? String(member['Membership Type']||'').trim() : '';
  const sr = _loanSpecFor(membershipType, req['Repayment Term']); if (!sr.ok) return sr;
  const spec = sr.spec;
  const el=_loanEligibility(req['MemberNo'], membershipType, guarantorOverride); if (!el.ok) return el;
  let gc = { ok: true, guarantors: [] };
  if (spec.guarantorsRequired) {
    gc=_guarantorChecks(req['MemberNo'], amount, _guarantorMap()[String(requestId).trim()]||[], requestId);
    if (!gc.ok) return gc;
    const gate=_guarantorGate(requestId); if (!gate.ok) return gate;
  }
  const lc = spec.savingsLimit ? _checkLimit(req['MemberNo'],amount) : {withinLimit:true,savings:0,maxLoan:0};
  if (!lc.withinLimit && !overrideReason)
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. An approving admin must give an override reason.',limitCheck:lc};

  const newId=_createLoanRow(req['MemberNo'],amount,req['Purpose']||'',issuedBy,overrideReason,spec);
  if (spec.guarantorsRequired) _linkGuarantorsToLoan(requestId,newId);
  _updateReqStatus(sh,headers,hRow,requestId,'Approved',
    'Approved → '+newId+' by '+approver1+' and '+approver2+(overrideReason?' [OVERRIDE: '+overrideReason+']':''),issuedBy);
  const t=_loanAmounts(amount, spec);
  const dueDate = spec.model === MEMBER_LOAN_MODEL ? _addMonths(new Date(), spec.months) : _addDays(new Date(), spec.days);
  _sendEmail(member?.['Email'],'Loan Request Approved: '+requestId,[
    ['Request ID',requestId],['Loan ID',newId],['Amount',fmtUGX(amount)],
    ['Interest ('+r2(spec.rate*100)+'%)',fmtUGX(t.interest)],['Processing fee',fmtUGX(t.fee)],
    ['Total to repay',fmtUGX(t.total)],['Due date',human_date(dueDate)]
  ],'Your loan request has received both required admin approvals and the loan has been issued. The due date is counted from today.');
  auditLog('Loan Request Fully Approved', req['MemberNo'], issuedBy,
    'Approved '+fmtUGX(amount)+' over '+spec.label+' by '+approver1+' and '+approver2+'. Loan '+newId+' created. Guarantors: '+(gc.guarantors.join(', ')||'none')+'.'+(overrideReason?' Override: '+overrideReason:'')+(guarantorOverride?' Guarantor restriction override: '+guarantorOverride:''), requestId);
  return { ok: true, loanId: newId, stage: 'final' };
}

function rejectLoanRequest(requestId, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (!_isOpenRequest(req)) return {ok:false,error:'Already decided.'};
  _updateReqStatus(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Loan Request Update: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your loan request was not approved. Please contact the committee for more information.');
  auditLog('Loan Request Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
