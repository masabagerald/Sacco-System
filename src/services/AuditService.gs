// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
// Append-only. Reads and writes touch only the rows they need, so the log stays fast at 100,000+ entries.

const AUDIT_COLS = 6;  // Timestamp, Action, Member (Affected), Performed By, Details, Reference ID

function auditLog(action, affectedMemberNo, performedBy, details, refId) {
  try {
    // appendRow is atomic: two actions at the same moment never land on the same row
    getSheet(SH_AUDIT).appendRow([
      now_ts(), action,
      String(affectedMemberNo || ''), String(performedBy || ''),
      String(details || ''), String(refId || '')
    ]);
  } catch(e) { /* non-fatal — don't let audit failure break the transaction */ }
}

// Header row (1-based) of the Audit Log tab, found in the top rows (the tab has a title above it); -1 if missing
function _auditHeaderRow(sh) {
  const n = Math.min(10, sh.getLastRow());
  if (n < 1) return -1;
  const top = sh.getRange(1, 1, n, AUDIT_COLS).getValues();
  return top.findIndex(r => r.some(v => String(v).trim().toLowerCase() === 'timestamp')) + 1 || -1;
}

// Timestamp cell as text: Sheets turns the written 'yyyy-MM-dd HH:mm:ss' into a date-time cell
function _auditTs(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss') : String(v || '');
}

// Rows first..last (1-based, inclusive) as entries, skipping blank rows
function _auditEntries(sh, first, last) {
  if (last < first) return [];
  const tz = _sheetTimeZone();
  return sh.getRange(first, 1, last - first + 1, AUDIT_COLS).getValues()
    .map((r, i) => ({ timestamp: _auditTs(r[0], tz), action: r[1], member: r[2], performedBy: r[3],
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

function _auditCategory(action) { const c = AUDIT_CATEGORIES.find(c => c[1].test(String(action || ''))); return c ? c[0] : 'Other'; }
function _auditSensitive(action) { return AUDIT_SENSITIVE.test(String(action || '')); }

// Every member, for names beside member numbers (members who left still have their row)
function _auditMembers() {
  return readSheet(SH_MEMBERS, 'memberno').rows
    .map(m => ({ no: String(m['MemberNo'] || '').trim(), name: String(m['Full Name'] || '').trim() }))
    .filter(m => m.no);
}
function _auditNameMap(members) { const map = {}; members.forEach(m => { map[m.no.toLowerCase()] = m.name; }); return map; }
function _auditName(names, no) { return names[String(no || '').trim().toLowerCase()] || ''; }

// Filters from the browser, checked: { from, to, member, category, sensitive, q } or { error }
function _auditFilters(f) {
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
function _auditFilterLabel(f) {
  const parts = [(f.from || 'the start') + ' to ' + (f.to || 'today')];
  if (f.member) parts.push('member ' + f.member.toUpperCase());
  if (f.category) parts.push(f.category);
  if (f.sensitive) parts.push('sensitive only');
  if (f.q) parts.push('search "' + f.q + '"');
  return parts.join(', ');
}

// Rows matching the filters, in sheet order (oldest first), as [{ row, ts, entry }].
// A date-only search reads just the Timestamp column (entry is then null and _auditRead fetches it);
// member, category, sensitive and text filters read the whole log once.
function _auditFind(sh, f, names) {
  const hRow = _auditHeaderRow(sh), last = sh.getLastRow();
  if (hRow < 0 || last <= hRow) return [];
  const inRange = ts => { const day = ts.slice(0, 10); return !!day && (!f.from || day >= f.from) && (!f.to || day <= f.to); };
  if (!(f.member || f.category || f.sensitive || f.q)) {
    const tz = _sheetTimeZone();
    return sh.getRange(hRow + 1, 1, last - hRow, 1).getValues()
      .map((r, i) => ({ row: hRow + 1 + i, ts: _auditTs(r[0], tz), entry: null }))
      .filter(h => inRange(h.ts));
  }
  const isMember = v => String(v || '').trim().toLowerCase() === f.member;
  return _auditEntries(sh, hRow + 1, last)
    .filter(e => inRange(e.timestamp)
      && (!f.member || isMember(e.member) || isMember(e.performedBy))
      && (!f.category || _auditCategory(e.action) === f.category)
      && (!f.sensitive || _auditSensitive(e.action))
      && (!f.q || [e.action, e.member, _auditName(names, e.member), e.performedBy, _auditName(names, e.performedBy), e.details, e.refId]
        .join(' ').toLowerCase().indexOf(f.q) > -1))
    .map(e => ({ row: e._row, ts: e.timestamp, entry: e }));
}

// Full entries for these hits, in the same order; rows not read yet come from one read of their span
function _auditRead(sh, hits) {
  const missing = hits.filter(h => !h.entry).map(h => h.row);
  if (missing.length) {
    const byRow = {};
    const first = missing.reduce((a, b) => Math.min(a, b)), last = missing.reduce((a, b) => Math.max(a, b));
    _auditEntries(sh, first, last).forEach(e => { byRow[e._row] = e; });
    hits.forEach(h => { if (!h.entry) h.entry = byRow[h.row]; });
  }
  return hits.map(h => h.entry).filter(Boolean);
}

// An entry as shown and exported: with its category, sensitive flag and member names
function _auditView(e, names) {
  return { timestamp: e.timestamp, action: e.action, category: _auditCategory(e.action), sensitive: _auditSensitive(e.action),
    member: e.member, memberName: _auditName(names, e.member), performedBy: e.performedBy,
    performedByName: _auditName(names, e.performedBy), details: e.details, refId: e.refId };
}
