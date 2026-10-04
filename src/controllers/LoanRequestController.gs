// ── LOAN REQUESTS ─────────────────────────────────────────────────────────────

// Parses a 'yyyy-MM-dd HH:mm:ss' timestamp and returns whole days since then, or null
function _daysSince(ts) {
  const d = new Date(String(ts||'').trim().replace(' ', 'T'));
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Terms and fee for the applicant's form
function getLoanTerms() {
  const auth = _caller(); if (!auth.ok) return auth;
  return { ok: true, fee: PROCESSING_FEE, terms: LOAN_TERMS.map(t => ({ key: t.key, label: t.label, days: t.days, rate: r2(t.rate * 100) })) };
}

// Total due for a loan of this size and term (used for the admin and member lists)
function _quoteFor(amount, termDef) {
  if (!termDef) return { total: 0, interest: 0, label: '' };
  const t = _termTerms(num(amount), termDef);
  return { total: t.total, interest: t.interest, label: termDef.label };
}

function requestLoan(amount, termKey, purpose, guarantorNos) {
  const auth = _caller(); if (!auth.ok) return auth;
  amount=num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const termDef = _termByKey(termKey); if (!termDef) return {ok:false,error:'Choose a repayment term.'};
  const el = _loanEligibility(auth.member.memberNo); if (!el.ok) return el;
  const gc = _guarantorChecks(auth.member.memberNo, amount, guarantorNos, ''); if (!gc.ok) return gc;
  const { sh, headers, hRow } = readSheet(SH_LOAN_REQ,'requestid');
  if (ci(headers,'repayment term') < 0)
    throw new Error('Loan Requests sheet is missing the "Repayment Term" column. Run setupGuaranteeSchema() once from the script editor.');
  const newId = nextId(SH_LOAN_REQ,'requestid','R');
  const row = emptyRow(sh, hRow, ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),auth.member.memberNo); s(ci(headers,'amount'),amount);
  s(ci(headers,'repayment term'),termDef.key);
  s(ci(headers,'purpose'),purpose||''); s(ci(headers,'status'),'Pending');
  s(ci(headers,'guarantor 1'),gc.guarantors[0]||''); s(ci(headers,'guarantor 2'),gc.guarantors[1]||'');
  const q = _quoteFor(amount, termDef);
  s(ci(headers,'total due'),q.total);
  const tokens=_appendGuarantors(newId, '', auth.member.memberNo, gc.guarantors);
  _sendGuarantorRequests(newId, auth.member.memberNo, amount, purpose, termDef, tokens);
  _notifyAdmins('New Loan Request: '+newId,[
    ['Request ID',newId],['Member',auth.member.name+' ('+auth.member.memberNo+')'],
    ['Amount',fmtUGX(amount)],['Repayment term',termDef.label+' at '+r2(termDef.rate*100)+'% interest'],
    ['Total due',fmtUGX(q.total)],['Purpose',purpose||'-'],['Guarantors',gc.guarantors.join(', ')]
  ],'A new loan request is pending your review. Decision due within 3 days.');
  auditLog('Loan Request Submitted', auth.member.memberNo, auth.member.memberNo,
    'Requested '+fmtUGX(amount)+' over '+termDef.label+'. Guarantors: '+gc.guarantors.join(', ')+'. Purpose: '+(purpose||'-'), newId);
  return { ok: true, requestId: newId, total: q.total };
}

function getMyLoanRequests() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r => String(r['MemberNo']||'').trim()===auth.member.memberNo)
    .map(r => {
      const td = _termByKey(r['Repayment Term']);
      return {requestId:r['RequestID'],amount:num(r['Amount (UGX)']),
        termLabel: td ? td.label : (num(r['Term (months)']) ? num(r['Term (months)'])+' months' : ''),
        total: num(r['Total Due']) || _quoteFor(num(r['Amount (UGX)']), td).total,
        purpose:r['Purpose']||'',status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp']};
    })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function getLoanRequests() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_LOAN_REQ,'requestid');
  const gmap = _guarantorMap();
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const nameOf = {};
  members.forEach(m => { nameOf[String(m['MemberNo']||'').trim()] = m['Full Name'] || ''; });
  const { rows: allGuar } = readSheet(SH_GUARANTORS,'requestid');
  const respOf = {};
  allGuar.forEach(g => { respOf[String(g['RequestID']||'').trim()+'|'+String(g['GuarantorNo']||'').trim()] = String(g['Response']||'Pending').trim() || 'Pending'; });
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r => {
      const id = String(r['RequestID']).trim();
      const status = String(r['Status']||'').trim();
      const amount = num(r['Amount (UGX)']);
      const lc=_checkLimit(r['MemberNo'],amount);
      const days = status === 'Pending' ? _daysSince(r['Timestamp']) : null;
      const td = _termByKey(r['Repayment Term']);
      const q = _quoteFor(amount, td);
      return {requestId:id,memberNo:r['MemberNo'],memberName:nameOf[String(r['MemberNo']||'').trim()]||r['MemberNo'],
        amount, termKey: td ? td.key : '', termLabel: td ? td.label : 'Not set', total: q.total,
        purpose:r['Purpose']||'', status, decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        withinLimit:lc.withinLimit,savings:lc.savings,maxLoan:lc.maxLoan,
        guarantors:(gmap[id]||[]).map(no => ({memberNo:no, name:nameOf[no]||no, response:respOf[id+'|'+no]||'Pending'})),
        daysPending: days, decisionOverdue: days !== null && days > DECISION_WINDOW_DAYS};
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function approveLoanRequest(requestId, overrideReason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet(SH_LOAN_REQ,'requestid');
  const req = rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (String(req['Status']||'').trim()!=='Pending') return {ok:false,error:'Already decided.'};
  const amount=num(req['Amount (UGX)']);
  const termDef=_termByKey(req['Repayment Term']);
  if (!termDef) return {ok:false,error:'This request has no repayment term. Ask the member to submit a new request.'};
  const el=_loanEligibility(req['MemberNo']); if (!el.ok) return el;
  const gc=_guarantorChecks(req['MemberNo'], amount, _guarantorMap()[String(requestId).trim()]||[], requestId);
  if (!gc.ok) return gc;
  const gate=_guarantorGate(requestId); if (!gate.ok) return gate;
  const lc=_checkLimit(req['MemberNo'],amount);
  if (!lc.withinLimit && !String(overrideReason||'').trim())
    return {ok:false,error:'Exceeds limit. Savings: '+fmtUGX(lc.savings)+', max: '+fmtUGX(lc.maxLoan)+'. Provide override reason.',limitCheck:lc};
  const newId=_createLoanRow(req['MemberNo'],amount,req['Purpose']||'',auth.member.memberNo,overrideReason,termDef);
  _linkGuarantorsToLoan(requestId,newId);
  _updateReqStatus(sh,headers,hRow,requestId,'Approved','Approved → '+newId+(overrideReason?' [OVERRIDE: '+overrideReason+']':''),auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  const t=_termTerms(amount, termDef);
  _sendEmail(m?.['Email'],'Loan Request Approved: '+requestId,[
    ['Request ID',requestId],['Loan ID',newId],['Amount',fmtUGX(amount)],
    ['Interest ('+r2(termDef.rate*100)+'%)',fmtUGX(t.interest)],['Processing fee',fmtUGX(t.fee)],
    ['Total to repay',fmtUGX(t.total)],['Due date',human_date(_addDays(new Date(), termDef.days))]
  ],'Your loan request has been approved and the loan has been issued. The due date is counted from the approval date.');
  auditLog('Loan Request Approved', req['MemberNo'], auth.member.memberNo,
    'Approved '+fmtUGX(amount)+' over '+termDef.label+'. Loan '+newId+' created. Guarantors: '+gc.guarantors.join(', ')+'.'+(overrideReason?' Override: '+overrideReason:''), requestId);
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
