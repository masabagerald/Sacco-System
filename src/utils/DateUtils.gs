// ── DATE HELPERS ───────────────────────────────────────────────────────────────

function fmt_date(d) { return Utilities.formatDate(d instanceof Date ? d : new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function now_ts()    { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function today()     { return fmt_date(new Date()); }
