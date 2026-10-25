// ── TERMS ACCEPTANCE ──────────────────────────────────────────────────────────
// Before using the app, every user accepts the current version of the Terms of Use, and every Admin also
// the Administrator Agreement (texts in Terms.gs). Until they do, _caller() refuses every request, so
// the rule holds on the server and not only on the screen. A member who becomes an Admin, or a document
// whose version is raised, is asked again at the next sign-in.
// Terms Acceptance is append-only: one row per document accepted (or declined), with the version.

const TERMS_HEADERS = ['Timestamp', 'MemberNo', 'Email', 'Role', 'Document', 'Title', 'Version', 'Decision'];

function setupTermsSchema() { _ensureTab(SH_TERMS, 'memberno', TERMS_HEADERS); }

// Document keys this member must have accepted: 'use' for everyone, plus 'admin' for Admins
function _termsRequiredDocs(member) {
  return String(member.role || '').toLowerCase() === 'admin' ? ['use', 'admin'] : ['use'];
}

// { 'use|1': '2026-10-25 10:02:11', ... }: the documents and versions this member has accepted, and when
function _termsAccepted(memberNo) {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TERMS)) return out;
  readSheet(SH_TERMS, 'memberno').rows
    .filter(r => String(r['MemberNo'] || '').trim() === String(memberNo).trim() && String(r['Decision'] || '').trim() === 'Accepted')
    .forEach(r => { out[String(r['Document']).trim() + '|' + String(r['Version']).trim()] = String(r['Timestamp'] || ''); });
  return out;
}

// Document keys still to accept (current versions), [] when the member is up to date
function _termsMissing(member) {
  const docs = _termsDocuments(), done = _termsAccepted(member.memberNo);
  return _termsRequiredDocs(member).filter(k => !done[k + '|' + docs[k].version]);
}

function _recordTerms(member, keys, decision) {
  setupTermsSchema();
  const docs = _termsDocuments(), ts = now_ts();
  const { sh, headers } = readSheet(SH_TERMS, 'memberno');
  sh.getRange(sh.getLastRow() + 1, 1, keys.length, headers.length).setValues(keys.map(k => headers.map(h => ({
    'Timestamp': ts, 'MemberNo': member.memberNo, 'Email': member.email, 'Role': member.role, 'Document': k,
    'Title': docs[k].title, 'Version': docs[k].version, 'Decision': decision })[h] || '')));
}
