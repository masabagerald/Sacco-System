// ── WITHDRAWAL REQUESTS ───────────────────────────────────────────────────────
// Needs two different, non-initiating admins to approve before funds are released (segregation of duties).

function requestWithdrawal(amount, reason, otherText) {
  const auth = _caller(); if (!auth.ok) return auth;
  amount=num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  reason = String(reason||'').trim();
  if (WITHDRAWAL_REASONS.indexOf(reason) < 0) return {ok:false,error:'Choose a reason for the withdrawal.'};
  if (reason === 'Others') {
    otherText = String(otherText||'').trim();
    if (!otherText) return {ok:false,error:'Enter a reason.'};
    reason = 'Others: ' + otherText;
  }
  if (auth.member.membershipType === 'Non-Member') return {ok:false,error:'Non-Members cannot make withdrawals.'};
  const bal=_savingsBalance(auth.member.memberNo);
  if (amount>bal) return {ok:false,error:'Amount exceeds savings balance ('+fmtUGX(bal)+').'};
  const { sh, headers, hRow } = readSheet(SH_WD_REQ,'requestid');
  if (ci(headers,'initiated by') < 0)
    throw new Error('Withdrawal Requests sheet is missing the "Initiated By" column. Run setupGuaranteeSchema() once from the script editor.');
  const newId=nextId(SH_WD_REQ,'requestid','W');
  const row=emptyRow(sh,hRow,ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),auth.member.memberNo); s(ci(headers,'amount'),amount);
  s(ci(headers,'reason'),reason); s(ci(headers,'status'),'Pending');
  s(ci(headers,'initiated by'),auth.member.memberNo);
  _notifyAdmins('Withdrawal Request: '+newId,[
    ['Request ID',newId],['Member',auth.member.name+' ('+auth.member.memberNo+')'],
    ['Amount',fmtUGX(amount)],['Reason',reason],['Balance',fmtUGX(bal)]
  ],'A withdrawal request is pending two different admin approvals.');
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
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const nameOf = {}; members.forEach(m => { nameOf[String(m['MemberNo']||'').trim()] = m['Full Name'] || ''; });
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r=>{
      const initiatedBy = String(r['Initiated By']||r['MemberNo']||'').trim();
      const approver1 = String(r['Approver 1']||'').trim();
      const approver2 = String(r['Approver 2']||'').trim();
      return {requestId:r['RequestID'],memberNo:r['MemberNo'],memberName:nameOf[String(r['MemberNo']||'').trim()]||r['MemberNo'],
        amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||'',
        decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],currentBalance:_savingsBalance(r['MemberNo']),
        initiatedBy, initiatedByName: nameOf[initiatedBy]||initiatedBy,
        approver1, approver1Name: approver1 ? (nameOf[approver1]||approver1) : '',
        approver2, approver2Name: approver2 ? (nameOf[approver2]||approver2) : ''};})
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

// Casts one of the two required admin approvals. The first call records "Partially Approved";
// the second call (a different, non-initiating admin) releases the funds.
function approveWithdrawal(requestId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  const status = String(req['Status']||'').trim();
  if (status !== 'Pending' && status !== 'Partially Approved') return {ok:false,error:'Already decided.'};
  const initiatedBy = String(req['Initiated By']||req['MemberNo']||'').trim();
  if (auth.member.memberNo === initiatedBy) return {ok:false,error:'You initiated this request; a different admin must approve it.'};
  const approver1 = String(req['Approver 1']||'').trim();
  if (approver1 && approver1 === auth.member.memberNo) return {ok:false,error:'You already gave the first approval; a different admin must give the second.'};

  const amount=num(req['Amount (UGX)']);
  const bal=_savingsBalance(req['MemberNo']);
  if (amount>bal) return {ok:false,error:'Insufficient balance at time of approval ('+fmtUGX(bal)+').'};

  if (!approver1) {
    _setApprover(sh, headers, hRow, requestId, 1, auth.member.memberNo);
    _updateReqStatus(sh, headers, hRow, requestId, 'Partially Approved', 'First approval by '+auth.member.memberNo, auth.member.memberNo);
    const m=_memberByNo(req['MemberNo']);
    _sendEmail(m?.['Email'],'Withdrawal Request Update: '+requestId,[['Request ID',requestId],['Status','First approval received']],
      'Your withdrawal request has received its first admin approval. A second, different admin must approve before funds are released.');
    auditLog('Withdrawal First Approval', req['MemberNo'], auth.member.memberNo, 'First of two required approvals.', requestId);
    return { ok: true, stage: 'first', message: 'First approval recorded. A second, different admin must approve to release funds.' };
  }

  _setApprover(sh, headers, hRow, requestId, 2, auth.member.memberNo);
  _addSavingsRow(req['MemberNo'],'Withdrawal',amount,auth.member.memberNo,'Withdrawal request '+requestId+' approved');
  _updateReqStatus(sh,headers,hRow,requestId,'Approved','Approved by '+approver1+' and '+auth.member.memberNo,auth.member.memberNo);
  const newBal=_savingsBalance(req['MemberNo']);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Withdrawal Approved: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(amount)],['New Balance',fmtUGX(newBal)]
  ],'Your withdrawal request has received both required admin approvals and your savings balance has been updated.');
  auditLog('Withdrawal Fully Approved', req['MemberNo'], auth.member.memberNo,
    'Withdrawal of '+fmtUGX(amount)+' approved by '+approver1+' and '+auth.member.memberNo+'. New balance: '+fmtUGX(newBal), requestId);
  return { ok: true, newBalance: newBal, stage: 'final' };
}

function rejectWithdrawal(requestId, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  const status = String(req['Status']||'').trim();
  if (status !== 'Pending' && status !== 'Partially Approved') return {ok:false,error:'Already decided.'};
  _updateReqStatus(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Withdrawal Request Update: '+requestId,[
    ['Request ID',requestId],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your withdrawal request was not approved. Please contact the committee.');
  auditLog('Withdrawal Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
