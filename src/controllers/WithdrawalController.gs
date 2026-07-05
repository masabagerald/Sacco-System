// ── WITHDRAWAL REQUESTS ───────────────────────────────────────────────────────

function requestWithdrawal(amount, reason) {
  const auth = _caller(); if (!auth.ok) return auth;
  amount=num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const bal=_savingsBalance(auth.member.memberNo);
  if (amount>bal) return {ok:false,error:'Amount exceeds savings balance ('+fmtUGX(bal)+').'};
  const { sh, headers, hRow } = readSheet(SH_WD_REQ,'requestid');
  const newId=nextId(SH_WD_REQ,'requestid','W');
  const row=emptyRow(sh,hRow,ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),auth.member.memberNo); s(ci(headers,'amount'),amount);
  s(ci(headers,'reason'),reason); s(ci(headers,'status'),'Pending');
  _notifyAdmins('Withdrawal Request: '+newId,[
    ['Request ID',newId],['Member',auth.member.name+' ('+auth.member.memberNo+')'],
    ['Amount',fmtUGX(amount)],['Reason',reason],['Balance',fmtUGX(bal)]
  ],'A withdrawal request is pending your review.');
  auditLog('Withdrawal Request Submitted', auth.member.memberNo, auth.member.memberNo,
    'Requested withdrawal of '+fmtUGX(amount)+'. Reason: '+reason, newId);
  return { ok: true, requestId: newId };
}

function getMyWithdrawalRequests() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_WD_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r=>String(r['MemberNo']||'').trim()===auth.member.memberNo)
    .map(r=>({requestId:r['RequestID'],amount:num(r['Amount (UGX)']),reason:r['Reason']||'',
      status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp']}))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function getWithdrawalRequests() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_WD_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r=>{ const m=_memberByNo(r['MemberNo']);
      return {requestId:r['RequestID'],memberNo:r['MemberNo'],memberName:m?m['Full Name']:r['MemberNo'],
        amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||'',
        decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],currentBalance:_savingsBalance(r['MemberNo'])};})
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function approveWithdrawal(requestId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (String(req['Status']||'').trim()!=='Pending') return {ok:false,error:'Already decided.'};
  const amount=num(req['Amount (UGX)']);
  const bal=_savingsBalance(req['MemberNo']);
  if (amount>bal) return {ok:false,error:'Insufficient balance at time of approval ('+fmtUGX(bal)+').'};
  // record actual withdrawal
  const { sh:ss, headers:sh2, hRow:hr2 } = readSheet(SH_SAVINGS,'memberno');
  const row=emptyRow(ss,hr2,ci(sh2,'memberno'));
  const s=(c,v)=>{if(c>-1)ss.getRange(row,c+1).setValue(v);};
  s(ci(sh2,'date'),today()); s(ci(sh2,'timestamp'),now_ts());
  s(ci(sh2,'memberno'),req['MemberNo']); s(ci(sh2,'type'),'Withdrawal');
  s(ci(sh2,'amount'),amount); s(ci(sh2,'recorded'),auth.member.memberNo);
  s(ci(sh2,'reference'),requestId); s(ci(sh2,'notes'),'Withdrawal request approved');
  _updateReqStatus(sh,headers,hRow,requestId,'Approved','Approved by '+auth.member.memberNo,auth.member.memberNo);
  const newBal=_savingsBalance(req['MemberNo']);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Withdrawal Approved: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(amount)],['New Balance',fmtUGX(newBal)]
  ],'Your withdrawal request has been approved and your savings balance updated.');
  auditLog('Withdrawal Approved', req['MemberNo'], auth.member.memberNo,
    'Withdrawal of '+fmtUGX(amount)+' approved. New balance: '+fmtUGX(newBal), requestId);
  return { ok: true, newBalance: newBal };
}

function rejectWithdrawal(requestId, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (String(req['Status']||'').trim()!=='Pending') return {ok:false,error:'Already decided.'};
  _updateReqStatus(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Withdrawal Request Update: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your withdrawal request was not approved. Please contact the committee.');
  auditLog('Withdrawal Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
