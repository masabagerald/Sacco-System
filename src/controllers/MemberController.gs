// ── MEMBERS (ADMIN) ───────────────────────────────────────────────────────────

function getAllMembersSummary() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  return { ok:true, members: rows
    .filter(m=>String(m['MemberNo']||'').trim()!=='')
    .map(m=>{ const b=_accountBalances(m['MemberNo']); return {...makeMemberRecord(m), savingsBalance:b.total, principalBalance:b.Principal}; }) };
}

function addMember(name, email, phone, role, membershipType, dateJoined) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  name=String(name||'').trim();
  if (!name) return {ok:false,field:'name',error:'Full name is required.'};
  // Contact details are checked here as well as on the form, so a direct call cannot skip the checks.
  // A failure names the field ('email' / 'phone') so the form can show the message beside it.
  const ev = validateEmail(email); if (!ev.ok) return ev;
  email = ev.email;
  const pv = normalizePhone(phone); if (!pv.ok) return pv;
  phone = pv.phone;
  membershipType = String(membershipType||'').trim();
  if (membershipType && MEMBERSHIP_TYPES.indexOf(membershipType) < 0) return {ok:false,error:'Choose a valid membership type.'};
  const jv = validateDateJoined(dateJoined); if (!jv.ok) return jv;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const { rows } = readSheet(SH_MEMBERS,'memberno');
    if (rows.some(r=>String(r['Email']||'').trim().toLowerCase()===email)) return {ok:false,field:'email',error:'Email already registered to another member.'};
    // Member numbers are generated: MSIC-0001, MSIC-0002, ... (continues from the highest existing number)
    const memberNo = _nextMemberNo();
    const { sh, headers, hRow } = readSheet(SH_MEMBERS,'memberno');
    const row=emptyRow(sh,hRow,ci(headers,'full name'));
    const s=(c,v)=>{if(c>-1)sh.getRange(row,c+1).setValue(v);};
    s(ci(headers,'memberno'),memberNo); s(ci(headers,'full name'),name);
    s(ci(headers,'email'),email);
    // Plain-text cell, so Sheets keeps the leading + instead of reading the number as a value
    const cPh=ci(headers,'phone'); if(cPh>-1) sh.getRange(row,cPh+1).setNumberFormat('@').setValue(phone);
    s(ci(headers,'role'),role||'Member'); s(ci(headers,'membership type'),membershipType||'');
    s(ci(headers,'date joined'),jv.date); s(ci(headers,'status'),'Active');
    auditLog('Member Added', memberNo, auth.member.memberNo, name+' ('+email+(phone?', '+phone:'')+'), '+(membershipType||'membership type not set')+', joined '+jv.date, memberNo);
    return { ok:true, memberNo: memberNo };
  } finally { lock.releaseLock(); }
}

// Changes an existing member's role, membership type, active/inactive status and (when given) date joined.
// committeeRole (ISS-11): 'Finance Committee', 'Chairperson' or '' (none); left unchanged when not given.
// It decides who may approve secured-loan waivers, so every change is kept in the audit log.
function updateMember(memberNo, role, membershipType, status, dateJoined, committeeRole) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  memberNo = String(memberNo||'').trim();
  role = String(role||'').trim();
  membershipType = String(membershipType||'').trim();
  status = String(status||'').trim();
  if (!memberNo) return {ok:false,error:'Member not found.'};
  if (role !== 'Admin' && role !== 'Member') return {ok:false,error:'Role must be Admin or Member.'};
  if (membershipType && MEMBERSHIP_TYPES.indexOf(membershipType) < 0) return {ok:false,error:'Choose a valid membership type.'};
  if (status !== 'Active' && status !== 'Inactive') return {ok:false,error:'Status must be Active or Inactive.'};
  const setCommittee = committeeRole !== undefined && committeeRole !== null;
  committeeRole = String(committeeRole == null ? '' : committeeRole).trim();
  if (setCommittee && committeeRole && COMMITTEE_ROLES.indexOf(committeeRole) < 0) return {ok:false,error:'Committee role must be '+COMMITTEE_ROLES.join(', ')+' or none.'};
  const { sh, headers, rows } = readSheet(SH_MEMBERS,'memberno');
  const row = rows.find(r => String(r['MemberNo']||'').trim() === memberNo);
  if (!row) return {ok:false,error:'Member not found.'};
  let joinedNote = '';
  if (String(dateJoined == null ? '' : dateJoined).trim()) {  // blank leaves the date unchanged
    const jv = validateDateJoined(dateJoined); if (!jv.ok) return jv;
    if (ci(headers, 'date joined') < 0) return {ok:false,error:'The Members sheet has no "Date Joined" column. Run setupGuaranteeSchema() once from the script editor.'};
    const before = _dstr(row['Date Joined']);
    if (jv.date !== before) joinedNote = ', Date joined: '+(before||'-')+' -> '+jv.date;
    dateJoined = jv.date;
  }
  if (setCommittee && committeeRole !== String(row['Committee Role']||'').trim() && ci(headers, 'committee role') < 0)
    return {ok:false,error:'The Members sheet has no "Committee Role" column. Run setupGuaranteeSchema() once from the script editor.'};
  const set = (name, v) => { const c = ci(headers, name); if (c > -1) sh.getRange(row._row, c + 1).setValue(v); };
  set('role', role); set('membership type', membershipType); set('status', status);
  if (joinedNote) set('date joined', dateJoined);
  let committeeNote = '';
  if (setCommittee) {
    const before = String(row['Committee Role']||'').trim();
    if (committeeRole !== before) {
      set('committee role', committeeRole);
      committeeNote = ', Committee role: '+(before||'none')+' -> '+(committeeRole||'none');
    }
  }
  auditLog('Member Updated', memberNo, auth.member.memberNo,
    'Role: '+role+', Membership type: '+(membershipType||'-')+', Status: '+status+joinedNote+committeeNote, memberNo);
  return { ok: true };
}
