// ── FORMATTING / PRIMITIVE HELPERS ────────────────────────────────────────────

function num(v)  { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function r2(n)   { return Math.round(n * 100) / 100; }
function fmt_date(d) { return Utilities.formatDate(d instanceof Date ? d : new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function now_ts()    { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function today()     { return fmt_date(new Date()); }
function fmtUGX(n)   { return 'UGX ' + Math.round(num(n)).toLocaleString('en-US'); }
function esc(s)      { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function csvQ(v)     { const s=String(v==null?'':v); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; }
