// ── MEMBER MODEL ───────────────────────────────────────────────────────────────
// Shapes a raw Members-sheet row into a clean member object.
function makeMemberRecord(row) {
  return {
    memberNo: row['MemberNo'],
    name: row['Full Name'],
    email: row['Email'],
    phone: row['Phone'] || '',
    role: String(row['Role']||'Member').trim(),
    membershipType: row['Membership Type'] || '',
    dateJoined: _dstr(row['Date Joined']),
    committeeRole: String(row['Committee Role']||'').trim(),
    status: row['Status'] || ''
  };
}

// Date a member joined the club ('yyyy-MM-dd'). Blank means today; it cannot be in the future.
// Members who joined before the app was in use get their real joining date, which the 12-month
// saving rule for loans counts from.
function validateDateJoined(d) {
  const v = validateTxDate(d);
  return v.ok ? v : { ok: false, error: 'Enter a valid date joined (it cannot be in the future).' };
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
