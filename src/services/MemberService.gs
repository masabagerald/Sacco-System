// ── MEMBER LOOKUP ─────────────────────────────────────────────────────────────

function memberByNo_(memberNo) {
  const { rows } = readSheet_(SH_MEMBERS,'memberno');
  return rows.find(r => String(r['MemberNo']||'').trim()===String(memberNo).trim()) || null;
}
