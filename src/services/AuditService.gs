// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
// Append-only. Reads and writes touch only the rows they need, so the log stays fast at 100,000+ entries.

const AUDIT_COLS = 6;  // Timestamp, Action, Member (Affected), Performed By, Details, Reference ID

function auditLog_(action, affectedMemberNo, performedBy, details, refId) {
  try {
    // appendRow is atomic: two actions at the same moment never land on the same row
    getSheet_(SH_AUDIT).appendRow([
      now_ts(), action,
      String(affectedMemberNo || ''), String(performedBy || ''),
      String(details || ''), String(refId || '')
    ]);
  } catch(e) { /* non-fatal — don't let audit failure break the transaction */ }
}

// Header row (1-based) of the Audit Log tab, found in the top rows (the tab has a title above it); -1 if missing
function auditHeaderRow_(sh) {
  const n = Math.min(10, sh.getLastRow());
  if (n < 1) return -1;
  const top = sh.getRange(1, 1, n, AUDIT_COLS).getValues();
  return top.findIndex(r => r.some(v => String(v).trim().toLowerCase() === 'timestamp')) + 1 || -1;
}

// Timestamp cell as text: Sheets turns the written 'yyyy-MM-dd HH:mm:ss' into a date-time cell
function auditTs_(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss') : String(v || '');
}

// Rows first..last (1-based, inclusive) as entries, skipping blank rows
function auditEntries_(sh, first, last) {
  if (last < first) return [];
  const tz = sheetTimeZone_();
  return sh.getRange(first, 1, last - first + 1, AUDIT_COLS).getValues()
    .map((r, i) => ({ timestamp: auditTs_(r[0], tz), action: r[1], member: r[2], performedBy: r[3],
      details: r[4], refId: r[5], _row: first + i }))
    .filter(e => [e.timestamp, e.action, e.member, e.performedBy, e.details, e.refId].some(v => String(v).trim()));
}

// ── CATEGORIES, SEARCH AND FILTERS ────────────────────────────────────────────

// Category of an action, from its name, so new actions sort themselves. First match wins.
const AUDIT_CATEGORIES = [
  ['Exports',     /export|statement generated|audit report sent/i],
  ['System',      /club set up|backup|terms|migrated|reminders|references assigned/i],
  ['Assets',      /asset/i],
  ['Investments', /investment|loan fund/i],
  ['Loans',       /loan|repayment|guarantor|waiver/i],
  ['Savings',     /deposit|withdrawal|contribution|savings|surcharge/i],
  ['Members',     /member/i]
];
const AUDIT_CATEGORY_NAMES = AUDIT_CATEGORIES.map(c => c[0]).concat(['Other']);
// Actions an auditor checks first: anything that undoes, overrides or changes a record, or takes data out
const AUDIT_SENSITIVE = /revers|override|correct|migrat|terms updated|member updated|disposed|export|backup/i;

function auditCategory_(action) { const c = AUDIT_CATEGORIES.find(c => c[1].test(String(action || ''))); return c ? c[0] : 'Other'; }
function auditSensitive_(action) { return AUDIT_SENSITIVE.test(String(action || '')); }

// Every member, for names beside member numbers (members who left still have their row)
function auditMembers_() {
  return readSheet_(SH_MEMBERS, 'memberno').rows
    .map(m => ({ no: String(m['MemberNo'] || '').trim(), name: String(m['Full Name'] || '').trim() }))
    .filter(m => m.no);
}
function auditNameMap_(members) { const map = {}; members.forEach(m => { map[m.no.toLowerCase()] = m.name; }); return map; }
function auditName_(names, no) { return names[String(no || '').trim().toLowerCase()] || ''; }

// Filters from the browser, checked: { from, to, member, category, sensitive, q } or { error }
function auditFilters_(f) {
  f = f || {};
  const out = { from: String(f.from || '').trim(), to: String(f.to || '').trim(),
    member: String(f.member || '').trim().toLowerCase(), category: String(f.category || '').trim(),
    sensitive: f.sensitive === true || f.sensitive === 'true', q: String(f.q || '').trim().toLowerCase() };
  const isDay = s => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDay(out.from) || !isDay(out.to)) return { error: 'Dates must be in yyyy-mm-dd format.' };
  if (out.from && out.to && out.from > out.to) return { error: 'The start date is after the end date.' };
  if (out.category && AUDIT_CATEGORY_NAMES.indexOf(out.category) < 0) return { error: 'Unknown category: ' + out.category };
  return out;
}

// The filters in words, for the audit entry an export leaves
function auditFilterLabel_(f) {
  const parts = [(f.from || 'the start') + ' to ' + (f.to || 'today')];
  if (f.member) parts.push('member ' + f.member.toUpperCase());
  if (f.category) parts.push(f.category);
  if (f.sensitive) parts.push('sensitive only');
  if (f.q) parts.push('search "' + f.q + '"');
  return parts.join(', ');
}

// Rows matching the filters, in sheet order (oldest first), as [{ row, ts, entry }].
// A date-only search reads just the Timestamp column (entry is then null and auditRead_ fetches it);
// member, category, sensitive and text filters read the whole log once.
function auditFind_(sh, f, names) {
  const hRow = auditHeaderRow_(sh), last = sh.getLastRow();
  if (hRow < 0 || last <= hRow) return [];
  const inRange = ts => { const day = ts.slice(0, 10); return !!day && (!f.from || day >= f.from) && (!f.to || day <= f.to); };
  if (!(f.member || f.category || f.sensitive || f.q)) {
    const tz = sheetTimeZone_();
    return sh.getRange(hRow + 1, 1, last - hRow, 1).getValues()
      .map((r, i) => ({ row: hRow + 1 + i, ts: auditTs_(r[0], tz), entry: null }))
      .filter(h => inRange(h.ts));
  }
  const isMember = v => String(v || '').trim().toLowerCase() === f.member;
  return auditEntries_(sh, hRow + 1, last)
    .filter(e => inRange(e.timestamp)
      && (!f.member || isMember(e.member) || isMember(e.performedBy))
      && (!f.category || auditCategory_(e.action) === f.category)
      && (!f.sensitive || auditSensitive_(e.action))
      && (!f.q || [e.action, e.member, auditName_(names, e.member), e.performedBy, auditName_(names, e.performedBy), e.details, e.refId]
        .join(' ').toLowerCase().indexOf(f.q) > -1))
    .map(e => ({ row: e._row, ts: e.timestamp, entry: e }));
}

// Full entries for these hits, in the same order; rows not read yet come from one read of their span
function auditRead_(sh, hits) {
  const missing = hits.filter(h => !h.entry).map(h => h.row);
  if (missing.length) {
    const byRow = {};
    const first = missing.reduce((a, b) => Math.min(a, b)), last = missing.reduce((a, b) => Math.max(a, b));
    auditEntries_(sh, first, last).forEach(e => { byRow[e._row] = e; });
    hits.forEach(h => { if (!h.entry) h.entry = byRow[h.row]; });
  }
  return hits.map(h => h.entry).filter(Boolean);
}

// An entry as shown and exported: with its category, sensitive flag and member names
function auditView_(e, names) {
  return { timestamp: e.timestamp, action: e.action, category: auditCategory_(e.action), sensitive: auditSensitive_(e.action),
    member: e.member, memberName: auditName_(names, e.member), performedBy: e.performedBy,
    performedByName: auditName_(names, e.performedBy), details: e.details, refId: e.refId };
}
