// ── MEMBER MODEL ───────────────────────────────────────────────────────────────
// Shapes a raw Members-sheet row into a clean member object.
function makeMemberRecord(row) {
  return {
    memberNo: row['MemberNo'],
    name: row['Full Name'],
    email: row['Email'],
    phone: row['Phone'] || '',
    role: String(row['Role']||'Member').trim(),
    status: row['Status'] || ''
  };
}

// Validates the required shape for a new member. Uniqueness (memberNo/email
// already taken) needs a sheet read, so that stays with the caller.
function validateNewMember(memberNo, name, email) {
  memberNo = String(memberNo||'').trim();
  name = String(name||'').trim();
  email = String(email||'').trim();
  if (!memberNo || !name || !email) return { ok: false, error: 'Member number, name and email are required.' };
  return { ok: true };
}
