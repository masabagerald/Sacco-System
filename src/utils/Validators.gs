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
