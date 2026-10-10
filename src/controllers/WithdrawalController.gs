// ── WITHDRAWAL REQUESTS ───────────────────────────────────────────────────────
// A member requests a withdrawal from one deposit account (Principal, Operations or Welfare).
// Principal is limited by the member's own Principal balance; Operations and Welfare are club pools,
// limited by the club-wide balance of the account (see _withdrawalAvailable).
// Needs two different, non-initiating admins to approve before funds are released (segregation of duties).

function requestWithdrawal(amount, reason, otherText, account) {
  const auth = _caller(); if (!auth.ok) return auth;
  amount=num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  account = String(account||'').trim();
  if (DEPOSIT_ACCOUNTS.indexOf(account) < 0) return {ok:false,error:'Choose the account to withdraw from (Principal, Operations or Welfare).'};
  reason = String(reason||'').trim();
  if (WITHDRAWAL_REASONS.indexOf(reason) < 0) return {ok:false,error:'Choose a reason for the withdrawal.'};
  if (reason === 'Others') {
    otherText = String(otherText||'').trim();
    if (!otherText) return {ok:false,error:'Enter a reason.'};
    reason = 'Others: ' + otherText;
  }
  if (!_canWithdraw(auth.member.membershipType))
    return {ok:false,error:'Withdrawal requests are open to '+WITHDRAWAL_MEMBERSHIP_TYPES.join(' and ')+'s only.'};
  const memberNo = String(auth.member.memberNo).trim();
  return _withScriptLock(() => {
    const { sh, headers, hRow, rows: reqs } = readSheet(SH_WD_REQ,'requestid');
    if (ci(headers,'initiated by') < 0 || ci(headers,'deposit account') < 0)
      throw new Error('Withdrawal Requests sheet is missing the "Initiated By" or "Deposit Account" column. Run setupGuaranteeSchema() once from the script editor.');
    const { rows: savRows } = readSheet(SH_SAVINGS,'memberno');
    const pooled = _isPooled(account);
    const bal = pooled ? _poolBalanceFromRows(savRows, account) : _accountBalancesFromRows(savRows, memberNo)[account];
    const avail = _withdrawalAvailable(savRows, reqs, memberNo, account);
    if (amount > avail) return {ok:false,error:'Amount exceeds the available '+(pooled?'club ':'')+account+' balance ('+fmtUGX(Math.max(avail,0))
      +(avail < bal ? ', after requests still awaiting approval' : '')+').'};
    const newId=nextId(SH_WD_REQ,'requestid','W');
    const row=emptyRow(sh,hRow,ci(headers,'memberno'));
    const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
    s(ci(headers,'requestid'),newId); s(ci(headers,'timestamp'),now_ts());
    s(ci(headers,'memberno'),memberNo); s(ci(headers,'amount'),amount);
    s(ci(headers,'deposit account'),account);
    s(ci(headers,'reason'),reason); s(ci(headers,'status'),'Pending');
    s(ci(headers,'initiated by'),memberNo);
    _notifyAdmins('Withdrawal Request: '+newId,[
      ['Request ID',newId],['Member',auth.member.name+' ('+memberNo+')'],['Account',account],
      ['Amount',fmtUGX(amount)],['Reason',reason],[(pooled?'Club ':'')+account+' balance',fmtUGX(bal)]
    ],'A withdrawal request is pending two different admin approvals.');
    auditLog('Withdrawal Request Submitted', memberNo, memberNo,
      'Requested withdrawal of '+fmtUGX(amount)+' from the '+account+' account. Reason: '+reason, newId);
    return { ok: true, requestId: newId };
  });
}

function getMyWithdrawalRequests() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_WD_REQ,'requestid');
  return { ok: true, requests: rows
    .filter(r=>String(r['MemberNo']||'').trim()===String(auth.member.memberNo).trim())
    .map(r=>({requestId:r['RequestID'],account:_requestAccount(r),amount:num(r['Amount (UGX)']),reason:r['Reason']||'',
      status:r['Status']||'',decisionNotes:r['Decision Notes']||'',date:r['Timestamp']}))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

function getWithdrawalRequests() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_WD_REQ,'requestid');
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: savRows } = readSheet(SH_SAVINGS,'memberno');
  const nameOf = {}; members.forEach(m => { nameOf[String(m['MemberNo']||'').trim()] = m['Full Name'] || ''; });
  return { ok: true, requests: rows
    .filter(r=>String(r['RequestID']||'').trim()!=='')
    .map(r=>{
      const memberNo = String(r['MemberNo']||'').trim();
      const account = _requestAccount(r);
      const initiatedBy = String(r['Initiated By']||r['MemberNo']||'').trim();
      const approver1 = String(r['Approver 1']||'').trim();
      const approver2 = String(r['Approver 2']||'').trim();
      const pooled = _isPooled(account);
      return {requestId:r['RequestID'],memberNo,memberName:nameOf[memberNo]||memberNo,account,pooled,
        amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||'',
        decisionNotes:r['Decision Notes']||'',date:r['Timestamp'],
        currentBalance: pooled ? _poolBalanceFromRows(savRows,account) : _accountBalancesFromRows(savRows,memberNo)[account],
        initiatedBy, initiatedByName: nameOf[initiatedBy]||initiatedBy,
        approver1, approver1Name: approver1 ? (nameOf[approver1]||approver1) : '',
        approver2, approver2Name: approver2 ? (nameOf[approver2]||approver2) : ''};})
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))) };
}

// Casts one of the two required admin approvals. The first call records "Partially Approved";
// the second call (a different, non-initiating admin) releases the funds from the requested account.
// Runs under the script lock so two admins approving at once cannot both release the funds.
function approveWithdrawal(requestId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return _withScriptLock(() => _approveWithdrawalLocked(auth, requestId));
}

function _approveWithdrawalLocked(auth, requestId) {
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  const dutyErr = _approvalDutyError(req, auth.member.memberNo);
  if (dutyErr) return {ok:false,error:dutyErr};
  const memberNo = String(req['MemberNo']).trim();
  const m=_memberByNo(memberNo);
  if (!m || !_canWithdraw(m['Membership Type']))
    return {ok:false,error:'This member is no longer eligible to withdraw ('+WITHDRAWAL_MEMBERSHIP_TYPES.join(', ')+' only). Reject the request with a reason.'};

  const account=_requestAccount(req);
  const amount=num(req['Amount (UGX)']);
  const tx = { memberNo, type: TX_WITHDRAWAL, amount, account, date: today(),
    notes: 'Withdrawal request '+requestId+' approved', recordedBy: auth.member.memberNo };
  const balErr = _checkSavingsTxs(readSheet(SH_SAVINGS,'memberno').rows, [tx]);
  if (balErr) return {ok:false,error:balErr+' Checked at the time of approval.'};

  const approver1 = String(req['Approver 1']||'').trim();
  if (!approver1) {
    _setApprover(sh, headers, hRow, requestId, 1, auth.member.memberNo);
    _updateReqStatus(sh, headers, hRow, requestId, 'Partially Approved', 'First approval by '+auth.member.memberNo, auth.member.memberNo);
    _sendEmail(m['Email'],'Withdrawal Request Update: '+requestId,[['Request ID',requestId],['Account',account],['Status','First approval received']],
      'Your withdrawal request has received its first admin approval. A second, different admin must approve before funds are released.');
    _notifyAdmins('Second approval needed: '+requestId,[['Request ID',requestId],['Member',(m['Full Name']||memberNo)+' ('+memberNo+')'],
      ['Account',account],['Amount',fmtUGX(amount)],['First approval',auth.member.name+' ('+auth.member.memberNo+')']],
      'This withdrawal has its first approval. A different admin, who did not initiate it, must give the final approval.');
    auditLog('Withdrawal First Approval', memberNo, auth.member.memberNo, 'First of two required approvals ('+fmtUGX(amount)+' from '+account+').', requestId);
    return { ok: true, stage: 'first', message: 'First approval recorded. A second, different admin must approve to release funds.' };
  }

  const res=_appendSavingsTxsLocked([tx]);
  if (!res.ok) return res;
  _setApprover(sh, headers, hRow, requestId, 2, auth.member.memberNo);
  _updateReqStatus(sh,headers,hRow,requestId,'Approved','Approved by '+approver1+' and '+auth.member.memberNo,auth.member.memberNo);
  const newBal=_accountBalances(memberNo);
  _sendEmail(m['Email'],'Withdrawal Approved: '+requestId,[
    ['Request ID',requestId],['Account',account],['Amount',fmtUGX(amount)],[account+' balance',fmtUGX(newBal[account])],['Total savings',fmtUGX(newBal.total)]
  ],'Your withdrawal request has received both required admin approvals and your '+account+' balance has been updated.');
  auditLog('Withdrawal Fully Approved', memberNo, auth.member.memberNo,
    'Withdrawal of '+fmtUGX(amount)+' from '+account+' approved by '+approver1+' and '+auth.member.memberNo+'. New '+account+' balance: '+fmtUGX(newBal[account])+'. Ledger ref '+res.references[0], requestId);
  return { ok: true, newBalance: newBal.total, stage: 'final' };
}

function rejectWithdrawal(requestId, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  const { sh, headers, hRow, rows } = readSheet(SH_WD_REQ,'requestid');
  const req=rows.find(r=>String(r['RequestID']||'').trim()===String(requestId).trim());
  if (!req) return {ok:false,error:'Request not found.'};
  if (!_isOpenRequest(req)) return {ok:false,error:'Already decided.'};
  _updateReqStatus(sh,headers,hRow,requestId,'Rejected',reason,auth.member.memberNo);
  const m=_memberByNo(req['MemberNo']);
  _sendEmail(m?.['Email'],'Withdrawal Request Update: '+requestId,[
    ['Request ID',requestId],['Account',_requestAccount(req)],['Amount',fmtUGX(num(req['Amount (UGX)']))],['Status','Rejected'],['Reason',reason]
  ],'Your withdrawal request was not approved. Please contact the committee.');
  auditLog('Withdrawal Rejected', req['MemberNo'], auth.member.memberNo, 'Reason: '+reason, requestId);
  return { ok: true };
}
