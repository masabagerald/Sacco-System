// ── LOAN REQUESTS ─────────────────────────────────────────────────────────────

function requestLoan(amount, termMonths, purpose) {
  const auth = _caller(); if (!auth.ok) return auth;
  amount=num(amount); termMonths=num(termMonths);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const { sh, headers, hRow } = readSheet(SH_LOAN_REQ,'requestid');
  const newId = nextId(SH_LOAN_REQ,'requestid','R');
  const row = emptyRow(sh, hRow, ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),auth.member.memberNo); s(ci(headers,'amount'),amount);
  s(ci(headers,'term'),termMonths); s(ci(headers,'purpose'),purpose||''); s(ci(headers,'status'),'Pending');
  _notifyAdmins('New Loan Request: '+newId,[
    ['Request ID',newId],['Member',auth.member.name+' ('+auth.member.memberNo+')'],
    ['Amount',fmtUGX(amount)],['Term',termMonths+' months'],['Purpose',purpose||'-']
  ],'A new loan request is pending your review.');
  auditLog('Loan Request Submitted', auth.member.memberNo, auth.member.memberNo,
    'Requested '+fmtUGX(amount)+' for '+termMonths+' months. Purpose: '+(purpose||'-'), newId);
  return { ok: true, requestId: newId };
}

function getMyLoanRequests() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r => String(r['MemberNo']||'').trim()===auth.member.memberNo)
    .map(r => ({requestId:r['RequestID'],amount:num(r['Amount (UGX)']),term:num(r['Term (months)']),
      purpose:r['Purpose']||'',status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp']}))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function getLoanRequests() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r => {
      const lc=_checkLimit(r['MemberNo'],num(r['Amount (UGX)']));
      const m=_memberByNo(r['MemberNo']);
      return {requestId:r['RequestID'],memberNo:r['MemberNo'],memberName:m?m['Full Name']:r['MemberNo'],
        amount:num(r['Amount (UGX)']),term:num(r['Term (months)']),purpose:r['Purpose']||'',
        status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        withinLimit:lc.withinLimit,savings:lc.savings,maxLoan:lc.maxLoan};
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function approveLoanRequest(requestId, monthlyRate, overrideReason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (String(req['Status']||'').trim()!=='Pending') return {ok:false,error:'Already decided.'};
  const amount=num(req['Amount (UGX)']);
  const lc=_checkLimit(req['MemberNo'],amount);
  if (!lc.withinLimit && !String(overrideReason||'').trim())
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide override reason.',limitCheck:lc};
  const newId=_createLoanRow(req['MemberNo'],amount,num(monthlyRate),num(req['Term (months)']),req['Purpose']||'',auth.member.memberNo,overrideReason);
  _updateReqStatus(sh,headers,hRow,requestId,'Approved','Approved → '+newId+(overrideReason?' [OVERRIDE: '+overrideReason+']':''),auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Loan Request Approved: '+requestId,[
    ['Request ID',requestId],['Loan ID',newId],['Amount',fmtUGX(amount)],['Term',req['Term (months)']+' months']
  ],'Your loan request has been approved and the loan has been issued.');
  auditLog('Loan Request Approved', req['MemberNo'], auth.member.memberNo,
    'Approved '+fmtUGX(amount)+'. Loan '+newId+' created.'+(overrideReason?' Override: '+overrideReason:''), requestId);
  return { ok: true, loanId: newId };
}

function rejectLoanRequest(requestId, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (String(req['Status']||'').trim()!=='Pending') return {ok:false,error:'Already decided.'};
  _updateReqStatus(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Loan Request Update: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your loan request was not approved. Please contact the committee for more information.');
  auditLog('Loan Request Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
