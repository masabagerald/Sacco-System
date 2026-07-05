// ── FINES ─────────────────────────────────────────────────────────────────────

function getMyFines() {
  const auth = _caller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_FINES,'fineid');
  const fines = rows
    .filter(r=>String(r['MemberNo']||'').trim()===auth.member.memberNo)
    .map(r=>({fineId:r['FineID'],date:r['Date'],amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||''}))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const unpaidTotal=fines.filter(f=>String(f.status).toLowerCase()==='unpaid').reduce((s,f)=>s+f.amount,0);
  return { ok:true, fines, unpaidTotal:r2(unpaidTotal) };
}

function issueFine(memberNo, amount, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  amount=num(amount);
  if (amount<=0) return {ok:false,error:'Amount must be greater than zero.'};
  if (!String(reason||'').trim()) return {ok:false,error:'Please provide a reason.'};
  const { sh, headers, hRow } = readSheet(SH_FINES,'fineid');
  const newId=nextId(SH_FINES,'fineid','F');
  const row=emptyRow(sh,hRow,ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'fineid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'date'),today());
  s(ci(headers,'amount'),amount); s(ci(headers,'reason'),reason);
  s(ci(headers,'status'),'Unpaid'); s(ci(headers,'recorded'),auth.member.memberNo);
  const m=_memberByNo(memberNo);
  _sendEmail(m?.['Email'],'Fine Issued: '+newId,[
    ['Fine ID',newId],['Amount',fmtUGX(amount)],['Reason',reason],['Status','Unpaid']
  ],'A fine has been recorded on your account. Please settle with the treasurer.');
  auditLog('Fine Issued', memberNo, auth.member.memberNo, fmtUGX(amount)+'. Reason: '+reason, newId);
  return { ok:true, fineId:newId };
}

function markFinePaid(fineId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet(SH_FINES,'fineid');
  const fine=rows.find(r=>String(r['FineID']||'').trim()===String(fineId).trim());
  if (!fine) return {ok:false,error:'Fine not found.'};
  const cId=ci(headers,'fineid'), cSt=ci(headers,'status');
  const data=sh.getDataRange().getValues();
  for (let r=hRow+1;r<data.length;r++)
    if (String(data[r][cId]).trim()===String(fineId).trim()) { if(cSt>-1)sh.getRange(r+1,cSt+1).setValue('Paid'); break; }
  const m=_memberByNo(fine['MemberNo']);
  _sendEmail(m?.['Email'],'Fine Settled: '+fineId,[
    ['Fine ID',fineId],['Amount',fmtUGX(num(fine['Amount (UGX)']))],['Status','Paid']
  ],'This fine has been marked as paid. Thank you.');
  auditLog('Fine Marked Paid', fine['MemberNo'], auth.member.memberNo, fmtUGX(num(fine['Amount (UGX)']))+'. Reason was: '+fine['Reason'], fineId);
  return { ok:true };
}

function getAllFinesForAdmin() {
  const auth = _adminCaller(); if (!auth.ok) return [];
  const { rows } = readSheet(SH_FINES,'fineid');
  return rows.filter(r=>String(r['FineID']||'').trim()!=='').map(r=>{
    const m=_memberByNo(r['MemberNo']);
    return {fineId:r['FineID'],memberNo:r['MemberNo'],memberName:m?m['Full Name']:r['MemberNo'],
      date:r['Date'],amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||''};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
