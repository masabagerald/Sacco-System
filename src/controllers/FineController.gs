// ── FINES ─────────────────────────────────────────────────────────────────────

function getMyFines() {
  const auth = caller_(); if (!auth.ok) return auth;
  return myFinesFor_(auth.member);
}

function myFinesFor_(member) {
  const { rows } = readSheet_(SH_FINES,'fineid');
  const fines = rows
    .filter(r=>String(r['MemberNo']||'').trim()===member.memberNo)
    .map(r=>({fineId:r['FineID'],date:pick_(r,['Date','Date of Payment']),amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||''}))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const unpaidTotal=fines.filter(f=>String(f.status).toLowerCase()==='unpaid').reduce((s,f)=>s+f.amount,0);
  return { ok:true, fines, unpaidTotal:r2(unpaidTotal) };
}

function issueFine(memberNo, amount, reason) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  amount=num(amount);
  const av = validatePositiveAmount(amount); if (!av.ok) return av;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  // Under the script lock: two surcharges recorded at the same moment must not get the same ID and row
  const newId = withScriptLock_(() => {
    const rd = readSheet_(SH_FINES,'fineid');
    const { sh, headers } = rd;
    const id = nextId_(SH_FINES,'fineid','surcharge', rd);
    writeCells_(sh, freeRowFinder_(rd, ci(headers,'memberno'))(), headers.length, [
      [ci(headers,'fineid'),id], [ci(headers,'timestamp'),now_ts()], [ci(headers,'memberno'),memberNo], [ci(headers,'date'),today()],
      [ci(headers,'amount'),amount], [ci(headers,'reason'),reason], [ci(headers,'status'),'Unpaid'], [ci(headers,'recorded'),auth.member.memberNo]]);
    return id;
  });
  const m=memberByNo_(memberNo);
  sendEmail_(m?.['Email'],'Surcharge Issued: '+newId,[
    ['Surcharge ID',newId],['Amount',fmtUGX(amount)],['Reason',reason],['Status','Unpaid']
  ],'A surcharge has been recorded on your account. Please settle with the treasurer.');
  auditLog_('Surcharge Issued', memberNo, auth.member.memberNo, fmtUGX(amount)+'. Reason: '+reason, newId);
  notifyGuarantorsOfBorrower_(memberNo, { key: 'fine-issued|' + newId, event: 'Surcharge / fine charged', amount, date: today(),
    message: 'A surcharge or fine has been charged to the borrower and is outstanding.' });
  return { ok:true, fineId:newId };
}

function markFinePaid(fineId) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { sh, headers, hRow, rows } = readSheet_(SH_FINES,'fineid');
  const fine=rows.find(r=>String(r['FineID']||'').trim()===String(fineId).trim());
  if (!fine) return {ok:false,error:'Surcharge not found.'};
  const cId=ci(headers,'fineid'), cSt=ci(headers,'status');
  const data=sh.getDataRange().getValues();
  for (let r=hRow+1;r<data.length;r++)
    if (String(data[r][cId]).trim()===String(fineId).trim()) { if(cSt>-1)sh.getRange(r+1,cSt+1).setValue('Paid'); break; }
  const m=memberByNo_(fine['MemberNo']);
  sendEmail_(m?.['Email'],'Surcharge Settled: '+fineId,[
    ['Surcharge ID',fineId],['Amount',fmtUGX(num(fine['Amount (UGX)']))],['Status','Paid']
  ],'This surcharge has been marked as paid. Thank you.');
  auditLog_('Surcharge Marked Paid', fine['MemberNo'], auth.member.memberNo, fmtUGX(num(fine['Amount (UGX)']))+'. Reason was: '+fine['Reason'], fineId);
  notifyGuarantorsOfBorrower_(fine['MemberNo'], { key: 'fine-paid|' + String(fineId).trim(), event: 'Surcharge / fine paid', amount: num(fine['Amount (UGX)']),
    date: today(), message: 'The borrower has paid a surcharge or fine.' });
  return { ok:true };
}

function getAllFinesForAdmin() {
  const auth = adminCaller_(); if (!auth.ok) return [];
  const { rows } = readSheet_(SH_FINES,'fineid');
  const memberOf = {};
  readSheet_(SH_MEMBERS,'memberno').rows.forEach(m => { const no = String(m['MemberNo']||'').trim(); if (!(no in memberOf)) memberOf[no] = m; });
  return rows.filter(r=>String(r['FineID']||'').trim()!=='').map(r=>{
    const m=memberOf[String(r['MemberNo']).trim()]||null;
    return {fineId:r['FineID'],memberNo:r['MemberNo'],memberName:m?m['Full Name']:r['MemberNo'],
      date:pick_(r,['Date','Date of Payment']),amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||''};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
