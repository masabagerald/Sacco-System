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

// ── Admins: edit and publish the terms ──

// Each document as text for the editor, with its version history and how many users have accepted it
function getTermsForEditing() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const docs = _termsDocuments(), versions = _termsVersions();
  const members = readSheet(SH_MEMBERS, 'memberno').rows.filter(m => String(m['MemberNo'] || '').trim() && String(m['Status'] || '').trim().toLowerCase() === 'active');
  const accepted = {};
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TERMS))
    readSheet(SH_TERMS, 'memberno').rows.filter(r => String(r['Decision'] || '').trim() === 'Accepted')
      .forEach(r => { accepted[String(r['Document']).trim() + '|' + String(r['Version']).trim() + '|' + String(r['MemberNo']).trim()] = true; });
  return { ok: true, documents: TERMS_DOC_KEYS.map(k => {
    const d = docs[k];
    const applies = members.filter(m => k === 'use' || String(m['Role'] || '').trim().toLowerCase() === 'admin');
    return { key: k, title: d.title, appliesTo: d.appliesTo, checkbox: d.checkbox, version: d.version, updated: d.updated, text: _termsToText(d),
      acceptedCount: applies.filter(m => accepted[k + '|' + d.version + '|' + String(m['MemberNo']).trim()]).length, appliesCount: applies.length,
      history: versions.filter(v => v.key === k).map(v => ({ version: v.version, at: v.at, by: v.by, summary: v.summary })).reverse() };
  }) };
}

// Publishes a new version of a document. Everyone it applies to must accept it at their next sign-in (and
// any request they make before that is refused until they do). summary: what changed, kept with the version.
function publishTerms(key, title, checkbox, text, summary) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  key = String(key || '').trim();
  if (TERMS_DOC_KEYS.indexOf(key) < 0) return { ok: false, error: 'Unknown document.' };
  title = String(title || '').trim(); checkbox = String(checkbox || '').trim(); text = String(text || '').replace(/\r/g, '').trim();
  summary = String(summary || '').trim();
  if (!title || title.length > 150) return { ok: false, field: 'title', error: 'Enter a title (up to 150 characters).' };
  if (!checkbox || checkbox.length > 250) return { ok: false, field: 'checkbox', error: 'Enter the tickbox wording (up to 250 characters).' };
  if (text.length > 30000) return { ok: false, field: 'text', error: 'The text is too long (30,000 characters at most).' };
  const parsed = _termsFromText(text);
  if (!parsed.intro || !parsed.sections.length || parsed.sections.some(s => !s.points.length))
    return { ok: false, field: 'text', error: 'Start with an introduction, then at least one "## Heading" with "- " points under every heading.' };
  if (!summary) return { ok: false, field: 'summary', error: 'Describe what changed. It is kept with the version and in the audit log.' };
  return _withScriptLock(() => {
    const cur = _termsDocuments()[key];
    if (cur.title === title && cur.checkbox === checkbox && _termsToText(cur) === _termsToText(Object.assign({}, cur, parsed)))
      return { ok: false, error: 'Nothing has changed, so no new version was published.' };
    const version = String(Math.max(num(cur.version), ..._termsVersions().filter(v => v.key === key).map(v => num(v.version))) + 1);
    setupTermsSchema();
    // A leading = + - @ would make Sheets read the cell as a formula: store such values as plain text
    const plain = v => /^[=+\-@]/.test(v) ? "'" + v : v;
    _appendByHeaders(SH_TERMS_VERSIONS, 'document', { 'Timestamp': now_ts(), 'Document': key, 'Version': version, 'Title': plain(title),
      'Checkbox': plain(checkbox), 'Text': plain(_termsToText(Object.assign({}, cur, parsed))), 'Change Summary': plain(summary), 'Published By': auth.member.memberNo });
    auditLog('Terms Updated', '', auth.member.memberNo, title + ': version ' + cur.version + ' -> ' + version + ' published. '
      + (key === 'use' ? 'Every user' : 'Every administrator') + ' must accept it at their next sign-in. Changes: ' + summary, key + ' v' + version);
    return { ok: true, key, version };
  });
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
