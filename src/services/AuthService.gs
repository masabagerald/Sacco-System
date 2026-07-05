// ── IDENTITY / SESSION HELPERS ────────────────────────────────────────────────

// Internal: look up member by email
function _lookupMember(email) {
  email = String(email||'').trim().toLowerCase();
  const { rows } = readSheet(SH_MEMBERS, 'memberno');
  const m = rows.find(r => String(r['Email']||'').trim().toLowerCase() === email);
  if (!m) return { ok: false, notRegistered: true, error: 'The email ' + email + ' is not registered with ' + SACCO_NAME + '. Please contact the treasurer.' };
  if (String(m['Status']||'').trim().toLowerCase() !== 'active') return { ok: false, error: 'Your account is not active. Please contact the treasurer.' };
  return { ok: true, member: { memberNo: m['MemberNo'], name: m['Full Name'], email: m['Email'], role: String(m['Role']||'Member').trim(), phone: m['Phone']||'' } };
}

function _storeSession(email) {
  try { PropertiesService.getUserProperties().setProperty('sacco_email', email); } catch(e) {}
}

// Guards every protected function — resolves caller from Google session or stored session
function _caller() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail()||'').trim().toLowerCase(); } catch(e) {}
  if (!email) {
    try { email = String(PropertiesService.getUserProperties().getProperty('sacco_email')||'').trim().toLowerCase(); } catch(e) {}
  }
  if (!email) return { ok: false, error: 'Session expired. Please sign in again.' };
  return _lookupMember(email);
}

function _adminCaller() {
  const r = _caller();
  if (!r.ok) return r;
  if (r.member.role.toLowerCase() !== 'admin') return { ok: false, error: 'Admin access required.' };
  return r;
}
