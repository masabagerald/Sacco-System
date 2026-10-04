// ── DATE HELPERS ───────────────────────────────────────────────────────────────

function fmt_date(d) { return Utilities.formatDate(d instanceof Date ? d : new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function now_ts()    { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function today()     { return fmt_date(new Date()); }

// Reader-friendly date for emails, PDFs and messages: "5 Oct 2026" (or "5 Oct 2026, 14:30").
// Storage keeps yyyy-MM-dd; this is for display only.
function human_date(v) {
  const str = v instanceof Date ? fmt_date(v) : String(v||'');
  const m = str.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})(?: ([0-9]{2}):([0-9]{2}))?/);
  if (!m) return str;
  const d = new Date(+m[1], +m[2]-1, +m[3]);
  const day = Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy');
  return m[4] ? day + ', ' + m[4] + ':' + m[5] : day;
}
