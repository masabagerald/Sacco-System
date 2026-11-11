// ── TERMS ACCEPTANCE ──────────────────────────────────────────────────────────
// Before using the app, every user accepts the current version of the Terms of Use, and every Admin also
// the Administrator Agreement (texts in Terms.gs). Until they do, caller_() refuses every request, so
// the rule holds on the server and not only on the screen. A member who becomes an Admin, or a document
// whose version is raised, is asked again at the next sign-in.
// Terms Acceptance is append-only: one row per document accepted (or declined), with the version.

const TERMS_HEADERS = ['Timestamp', 'MemberNo', 'Email', 'Role', 'Document', 'Title', 'Version', 'Decision'];
// Terms Versions: append-only, one row per version an admin publishes (the full text, so every version is kept)
const TERMS_VERSION_HEADERS = ['Timestamp', 'Document', 'Version', 'Title', 'Checkbox', 'Text', 'Change Summary', 'Published By'];
const TERMS_DOC_KEYS = ['use', 'admin'];

function setupTermsSchema() {
  ensureTab_(SH_TERMS, 'memberno', TERMS_HEADERS);
  ensureTab_(SH_TERMS_VERSIONS, 'document', TERMS_VERSION_HEADERS);
}

// The documents in force: the starting text (Terms.gs), replaced by the latest version published in the app
function termsDocuments_() {
  const docs = defaultTermsDocuments_(), pub = publishedTerms_();
  Object.keys(pub).forEach(k => {
    if (!docs[k]) return;
    const p = pub[k], parsed = termsFromText_(p.text);
    Object.assign(docs[k], { title: p.title, checkbox: p.checkbox, version: p.version, updated: dstr_(p.at),
      intro: parsed.intro, sections: parsed.sections, publishedBy: p.by });
  });
  return docs;
}

// Every published version, oldest first: [{ key, version, at, title, checkbox, text, summary, by }]
function termsVersions_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TERMS_VERSIONS)) return [];
  return readSheet_(SH_TERMS_VERSIONS, 'document').rows.filter(r => String(r['Document'] || '').trim()).map(r => ({
    key: String(r['Document']).trim(), version: String(r['Version']).trim(), at: String(r['Timestamp'] || ''),
    title: String(r['Title'] || ''), checkbox: String(r['Checkbox'] || ''), text: String(r['Text'] || ''),
    summary: String(r['Change Summary'] || ''), by: String(r['Published By'] || '') }))
    .sort((a, b) => num(a.version) - num(b.version));
}

// The latest published version of each document: { use: {...}, admin: {...} }
function publishedTerms_() {
  const out = {};
  termsVersions_().forEach(v => { out[v.key] = v; });
  return out;
}

// The editing format: an intro paragraph, then "## Heading" lines each followed by "- point" lines.
// A line that doesn't start a heading or a point continues the previous paragraph or point.
function termsToText_(doc) {
  return [doc.intro].concat(doc.sections.map(s => '## ' + s.heading + '\n' + s.points.map(p => '- ' + p).join('\n'))).join('\n\n');
}

function termsFromText_(text) {
  const intro = [], sections = [];
  let cur = null, last = null;
  String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) { last = null; return; }
    const h = line.match(/^#{1,3}\s*(.+)$/);
    if (h) { cur = { heading: h[1].trim(), points: [] }; sections.push(cur); last = null; return; }
    const p = line.match(/^[-*•]\s*(.+)$/);
    if (p && cur) { cur.points.push(p[1].trim()); last = { arr: cur.points, i: cur.points.length - 1 }; return; }
    if (last) { last.arr[last.i] += ' ' + line; return; }
    if (!cur) { intro.push(line); return; }
    cur.points.push(line); last = { arr: cur.points, i: cur.points.length - 1 };
  });
  return { intro: intro.join(' '), sections };
}

// Document keys this member must have accepted: 'use' for everyone, plus 'admin' for Admins
function termsRequiredDocs_(member) {
  return String(member.role || '').toLowerCase() === 'admin' ? ['use', 'admin'] : ['use'];
}

// { 'use|1': '2026-10-25 10:02:11', ... }: the documents and versions this member has accepted, and when
function termsAccepted_(memberNo) {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TERMS)) return out;
  readSheet_(SH_TERMS, 'memberno').rows
    .filter(r => String(r['MemberNo'] || '').trim() === String(memberNo).trim() && String(r['Decision'] || '').trim() === 'Accepted')
    .forEach(r => { out[String(r['Document']).trim() + '|' + String(r['Version']).trim()] = String(r['Timestamp'] || ''); });
  return out;
}

// Document keys still to accept (current versions), [] when the member is up to date
function termsMissing_(member) {
  const docs = termsDocuments_(), done = termsAccepted_(member.memberNo);
  return termsRequiredDocs_(member).filter(k => !done[k + '|' + docs[k].version]);
}

function recordTerms_(member, keys, decision) {
  setupTermsSchema();
  const docs = termsDocuments_(), ts = now_ts();
  const { sh, headers } = readSheet_(SH_TERMS, 'memberno');
  sh.getRange(sh.getLastRow() + 1, 1, keys.length, headers.length).setValues(keys.map(k => headers.map(h => ({
    'Timestamp': ts, 'MemberNo': member.memberNo, 'Email': member.email, 'Role': member.role, 'Document': k,
    'Title': docs[k].title, 'Version': docs[k].version, 'Decision': decision })[h] || '')));
}
