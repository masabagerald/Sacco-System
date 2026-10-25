// ── TERMS OF USE ──────────────────────────────────────────────────────────────
// These three functions use _signedInMember() (who is signed in) rather than _caller(), because _caller()
// refuses users who have not accepted the terms yet. See TermsService.gs.

// The documents that apply to the signed-in user, which are still to accept, and when the others were accepted
function getTermsStatus() {
  const r = _signedInMember(); if (!r.ok) return r;
  const docs = _termsDocuments(), done = _termsAccepted(r.member.memberNo);
  const keys = _termsRequiredDocs(r.member);
  return { ok: true, member: r.member, required: keys.some(k => !done[k + '|' + docs[k].version]),
    documents: keys.map(k => Object.assign({ key: k, acceptedAt: done[k + '|' + docs[k].version] || '' }, docs[k])) };
}

// Records acceptance. accepted: { use: '1', admin: '1' } -- the version of each document the user ticked,
// as shown to them, so an acceptance of out-of-date text is refused. Every outstanding document must be included.
function acceptTerms(accepted) {
  const r = _signedInMember(); if (!r.ok) return r;
  accepted = accepted || {};
  const docs = _termsDocuments(), missing = _termsMissing(r.member);
  if (!missing.length) return { ok: true, member: r.member, alreadyAccepted: true };
  const notTicked = missing.filter(k => String(accepted[k] || '') !== docs[k].version);
  if (notTicked.length)
    return { ok: false, error: notTicked.some(k => accepted[k]) ? 'The terms have been updated. Please read the latest version and accept again.'
      : 'Please tick the box for: ' + notTicked.map(k => docs[k].title).join(' and ') + '.' };
  _recordTerms(r.member, missing, 'Accepted');
  auditLog('Terms Accepted', r.member.memberNo, r.member.memberNo,
    missing.map(k => docs[k].title + ' (version ' + docs[k].version + ')').join(' and ') + ' accepted.', '');
  return { ok: true, member: r.member };
}

// The user declines: recorded, and the session is ended. They can come back and accept later.
function declineTerms() {
  const r = _signedInMember(); if (!r.ok) return r;
  const missing = _termsMissing(r.member);
  if (missing.length) {
    const docs = _termsDocuments();
    _recordTerms(r.member, missing, 'Declined');
    auditLog('Terms Declined', r.member.memberNo, r.member.memberNo,
      missing.map(k => docs[k].title + ' (version ' + docs[k].version + ')').join(' and ') + ' declined; signed out.', '');
  }
  Config.deleteUserProp('sacco_email');
  return { ok: true };
}
