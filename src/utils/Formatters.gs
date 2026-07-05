// ── FORMATTING / PRIMITIVE HELPERS ────────────────────────────────────────────

function num(v)  { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function r2(n)   { return Math.round(n * 100) / 100; }
function fmtUGX(n)   { return 'UGX ' + Math.round(num(n)).toLocaleString('en-US'); }
function esc(s)      { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function csvQ(v)     { const s=String(v==null?'':v); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; }
