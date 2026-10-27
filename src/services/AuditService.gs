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
