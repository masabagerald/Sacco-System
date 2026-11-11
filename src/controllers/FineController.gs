// ── FINES ─────────────────────────────────────────────────────────────────────

function getMyFines() {
  const auth = caller_(); if (!auth.ok) return auth;
  const { rows } = readSheet_(SH_FINES,'fineid');
  const fines = rows
    .filter(r=>String(r['MemberNo']||'').trim()===auth.member.memberNo)
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
  const { sh, headers, hRow } = readSheet_(SH_FINES,'fineid');
  const newId=nextId_(SH_FINES,'fineid','surcharge');
  const row=emptyRow_(sh,hRow,ci(headers,'memberno'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'fineid'),newId); s(ci(headers,'timestamp'),now_ts());
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'date'),today());
  s(ci(headers,'amount'),amount); s(ci(headers,'reason'),reason);
  s(ci(headers,'status'),'Unpaid'); s(ci(headers,'recorded'),auth.member.memberNo);
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
  return rows.filter(r=>String(r['FineID']||'').trim()!=='').map(r=>{
    const m=memberByNo_(r['MemberNo']);
    return {fineId:r['FineID'],memberNo:r['MemberNo'],memberName:m?m['Full Name']:r['MemberNo'],
      date:pick_(r,['Date','Date of Payment']),amount:num(r['Amount (UGX)']),reason:r['Reason']||'',status:r['Status']||''};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
