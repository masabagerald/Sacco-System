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

// Email address for registration and sign-in. Returns { ok, email } with the address trimmed and
// lower-cased (sign-in matches emails case-insensitively), or { ok:false, field:'email', error }.
// The web form (members.js.html, contactErrors) applies the same rules.
function validateEmail(email) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  const bad = msg => ({ ok: false, field: 'email', error: msg });
  if (!e) return bad('Email is required.');
  if (e.length > 254) return bad('Email is too long.');
  const m = e.match(/^([a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/);
  if (!m || m[1].length > 64) return bad('Enter a valid email address, for example name@gmail.com.');
  return { ok: true, email: e };
}

// Phone number, normalised to international form (+256712345678). Optional: blank gives { ok, phone:'' }.
// Ugandan numbers may be written 0712 345 678, 712345678, 256712345678 or +256 712 345 678; they must
// have 9 digits after the country code. Numbers from other countries need their country code (+ or 00),
// giving 8 to 15 digits in all (E.164). Spaces, dashes, dots and brackets are ignored.
// The web form (members.js.html, contactErrors) applies the same rules.
function normalizePhone(phone) {
  const raw = String(phone == null ? '' : phone).trim();
  if (!raw) return { ok: true, phone: '' };
  const bad = msg => ({ ok: false, field: 'phone', error: msg });
  if (/[^0-9+\s().\-]/.test(raw) || raw.indexOf('+') > 0 || (raw.match(/\+/g) || []).length > 1)
    return bad('Phone number can contain only digits, spaces, dashes, brackets and a leading +.');
  let d = raw.replace(/[^0-9]/g, '');
  if (raw[0] !== '+') {
    if (/^00/.test(d)) d = d.slice(2);                             // 00 international prefix
    else if (/^0[0-9]{9}$/.test(d)) d = '256' + d.slice(1);        // Ugandan local: 07XX XXX XXX
    else if (/^[2-7][0-9]{8}$/.test(d)) d = '256' + d;              // Ugandan without the leading 0
    else if (!/^256/.test(d)) return bad('Enter a Ugandan number (e.g. 0712 345 678) or include the country code (e.g. +254 712 345 678).');
  }
  if (/^256/.test(d)) {
    if (!/^256[2-7][0-9]{8}$/.test(d)) return bad('Enter a valid Ugandan number: 9 digits after +256, for example +256 712 345 678.');
  } else if (!/^[1-9][0-9]{7,14}$/.test(d)) {
    return bad('Enter a valid international number: country code and number, 8 to 15 digits in all.');
  }
  return { ok: true, phone: '+' + d };
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
