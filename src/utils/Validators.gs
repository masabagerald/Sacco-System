// ── GENERIC INPUT VALIDATORS ───────────────────────────────────────────────────
// Shared by controllers that previously repeated these checks inline.

function validatePositiveAmount(amount) {
  if (num(amount) <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
  return { ok: true };
}

function validateReason(reason) {
  if (!String(reason||'').trim()) return { ok: false, error: 'Please provide a reason.' };
  return { ok: true };
}

// Transaction date from a form ('yyyy-MM-dd'). Blank means today. Cannot be in the future.
function validateTxDate(d) {
  const str = String(d||'').trim();
  if (!str) return { ok: true, date: today() };
  const m = str.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (!m) return { ok: false, error: 'Enter a valid transaction date.' };
  const dt = new Date(+m[1], +m[2]-1, +m[3]);
  if (dt.getFullYear() !== +m[1] || dt.getMonth() !== +m[2]-1 || dt.getDate() !== +m[3]) return { ok: false, error: 'Enter a valid transaction date.' };
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (dt > endOfToday) return { ok: false, error: 'The transaction date cannot be in the future.' };
  return { ok: true, date: str };
}
