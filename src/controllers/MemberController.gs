// ── MEMBERS (ADMIN) ───────────────────────────────────────────────────────────

function getAllMembersSummary() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  return { ok:true, members: rows
    .filter(m=>String(m['MemberNo']||'').trim()!=='')
    .map(m=>({...makeMemberRecord(m), savingsBalance:_savingsBalance(m['MemberNo'])})) };
}

function addMember(name, email, phone, role) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  name=String(name||'').trim(); email=String(email||'').trim().toLowerCase();
  if (!name || !email) return {ok:false,error:'Name and email are required.'};
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const { rows } = readSheet(SH_MEMBERS,'memberno');
    if (rows.some(r=>String(r['Email']||'').trim().toLowerCase()===email)) return {ok:false,error:'Email already registered to another member.'};
    // Member numbers are generated: M001, M002, ... (continues from the highest existing number)
    const memberNo = nextId(SH_MEMBERS,'memberno','M');
    const { sh, headers, hRow } = readSheet(SH_MEMBERS,'memberno');
    const row=emptyRow(sh,hRow,ci(headers,'full name'));
    const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
    s(ci(headers,'memberno'),memberNo); s(ci(headers,'full name'),name);
    s(ci(headers,'email'),email); s(ci(headers,'phone'),phone||'');
    s(ci(headers,'role'),role||'Member'); s(ci(headers,'date joined'),today()); s(ci(headers,'status'),'Active');
    auditLog('Member Added', memberNo, auth.member.memberNo, name+' ('+email+')', memberNo);
    return { ok:true, memberNo: memberNo };
  } finally { lock.releaseLock(); }
}
