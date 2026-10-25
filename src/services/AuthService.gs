// ── IDENTITY / SESSION HELPERS ────────────────────────────────────────────────

// Internal: look up member by email
function _lookupMember(email) {
  email = String(email||'').trim().toLowerCase();
  const { rows } = readSheet(SH_MEMBERS, 'memberno');
  const m = rows.find(r => String(r['Email']||'').trim().toLowerCase() === email);
  if (!m) return { ok: false, notRegistered: true, error: 'The email ' + email + ' is not registered with ' + SACCO_NAME + '. Please contact the treasurer.' };
  if (String(m['Status']||'').trim().toLowerCase() !== 'active') return { ok: false, error: 'Your account is not active. Please contact the treasurer.' };
  return { ok: true, member: makeMemberRecord(m) };
}

function _storeSession(email) {
  Config.setUserProp('sacco_email', email);
}

// Guards every protected function: the signed-in member, who must also have accepted the current terms
// (TermsService.gs). Until then every request is refused with termsRequired, whatever the page does.
function _caller() {
  const r = _signedInMember();
  if (!r.ok) return r;
  const missing = _termsMissing(r.member);
  if (missing.length) {
    const docs = _termsDocuments();
    return { ok: false, termsRequired: true, error: 'Please read and accept the ' + missing.map(k => docs[k].title).join(' and ') + ' to continue.' };
  }
  return r;
}

// The signed-in member, from the Google session or the stored session (terms not checked)
function _signedInMember() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail()||'').trim().toLowerCase(); } catch(e) {}
  if (!email) {
    email = String(Config.getUserProp('sacco_email')||'').trim().toLowerCase();
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

// Loan Insights: admins get the full view (level 'admin'); members whose membership type is in
// INSIGHTS_MEMBERSHIP_TYPES get the read-only aggregate view (level 'aggregate'); everyone else is refused.
// Membership type grants this view only -- it never grants admin actions.
function _insightsCaller() {
  const r = _caller();
  if (!r.ok) return r;
  if (r.member.role.toLowerCase() === 'admin') return Object.assign({}, r, { level: 'admin' });
  if (INSIGHTS_MEMBERSHIP_TYPES.indexOf(String(r.member.membershipType || '').trim()) > -1) return Object.assign({}, r, { level: 'aggregate' });
  return { ok: false, error: 'Loan Insights are available to administrators and Founder Members only.' };
}
