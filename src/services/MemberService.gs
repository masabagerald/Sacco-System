// ── MEMBER LOOKUP ─────────────────────────────────────────────────────────────

function _memberByNo(memberNo) {
  const { rows } = readSheet(SH_MEMBERS,'memberno');
  return rows.find(r => String(r['MemberNo']||'').trim()===String(memberNo).trim()) || null;
}
