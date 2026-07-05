// ── MEMBERS (ADMIN) ───────────────────────────────────────────────────────────

function getAllMembersSummary() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  return { ok:true, members: rows
    .filter(m=>String(m['MemberNo']||'').trim()!=='')
    .map(m=>({memberNo:m['MemberNo'],name:m['Full Name'],email:m['Email'],role:m['Role'],
      status:m['Status'],savingsBalance:_savingsBalance(m['MemberNo'])})) };
}

function addMember(memberNo, name, email, phone, role) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  memberNo=String(memberNo).trim(); email=String(email).trim().toLowerCase();
  if (!memberNo||!name||!email) return {ok:false,error:'Member number, name and email are required.'};
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  if (rows.some(r=>String(r['MemberNo']||'').trim()===memberNo)) return {ok:false,error:'Member number already exists.'};
  if (rows.some(r=>String(r['Email']||'').trim().toLowerCase()===email)) return {ok:false,error:'Email already registered to another member.'};
  const { sh, headers, hRow } = readSheet(SH_MEMBERS,'memberno');
  const row=emptyRow(sh,hRow,ci(headers,'full name'));
  const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
  s(ci(headers,'memberno'),memberNo); s(ci(headers,'full name'),name);
  s(ci(headers,'email'),email); s(ci(headers,'phone'),phone||'');
  s(ci(headers,'role'),role||'Member'); s(ci(headers,'date joined'),today()); s(ci(headers,'status'),'Active');
  auditLog('Member Added', memberNo, auth.member.memberNo, name+' ('+email+')', memberNo);
  return { ok:true };
}
