// ── MEMBERS (ADMIN) ───────────────────────────────────────────────────────────

function getAllMembersSummary() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  return { ok:true, members: rows
    .filter(m=>String(m['MemberNo']||'').trim()!=='')
    .map(m=>({...makeMemberRecord(m), savingsBalance:_savingsBalance(m['MemberNo'])})) };
}

function addMember(memberNo, name, email, phone, role) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  memberNo=String(memberNo).trim(); email=String(email).trim().toLowerCase();
  const nv = validateNewMember(memberNo, name, email); if (!nv.ok) return nv;
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
