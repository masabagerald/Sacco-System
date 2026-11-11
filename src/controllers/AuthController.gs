// ── IDENTITY / LOGIN ──────────────────────────────────────────────────────────

// Step 1: silently probe Google session
function tryAutoDetect() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch(e) {}
  return { detected: !!email, email };
}

// Step 2: user confirmed auto-detected email. The email is re-read from the Google session here --
// never taken from the page, or anyone could sign in as anyone.
function confirmAutoDetect() {
  const email = tryAutoDetect().email;
  if (!email) return { ok: false, error: 'Your Google account could not be detected. Please sign in with your email instead.' };
  const r = lookupMember_(email);
  if (r.ok) r.sessionToken = startSession_(email);
  return r;
}

// Step 3a: send OTP (manual path)
function sendOtp(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Please enter your email address.' };
  const r = lookupMember_(email);
  if (!r.ok) return r;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  Config.setScriptProp('otp_' + email, JSON.stringify({ code, expires: Date.now() + OTP_EXPIRY_MS, attempts: 0 }));

  try {
    sendHtmlEmail_(email, '[' + SACCO_NAME + '] Your sign-in code', otpEmailHtml_(r.member.name, code));
  } catch(e) { return { ok: false, error: 'Could not send email: ' + e.message }; }

  const at = email.indexOf('@');
  return { ok: true, maskedEmail: email.slice(0,2) + '***' + (at>-1 ? email.slice(at) : '') };
}

// Step 3b: verify OTP
function verifyOtp(email, code) {
  email = String(email||'').trim().toLowerCase();
  code  = String(code||'').trim();
  if (!email || !code) return { ok: false, error: 'Email and code are required.' };
  let payload;
  try {
    const raw = Config.getScriptProp('otp_' + email);
    if (!raw) return { ok: false, error: 'No code found. Please request a new one.' };
    payload = JSON.parse(raw);
  } catch(e) { return { ok: false, error: 'Could not read code. Please request a new one.' }; }
  if (Date.now() > payload.expires) {
    Config.deleteScriptProp('otp_' + email);
    return { ok: false, expired: true, error: 'Code expired. Please request a new one.' };
  }
  if (payload.code !== code) {
    payload.attempts = (payload.attempts || 0) + 1;
    if (payload.attempts >= OTP_MAX_ATTEMPTS) {
      Config.deleteScriptProp('otp_' + email);
      return { ok: false, expired: true, error: 'Too many incorrect codes. Please request a new one.' };
    }
    Config.setScriptProp('otp_' + email, JSON.stringify(payload));
    return { ok: false, error: 'Incorrect code. Please check your email.' };
  }
  Config.deleteScriptProp('otp_' + email);
  const r = lookupMember_(email);
  if (r.ok) r.sessionToken = startSession_(email);
  return r;
}

// Logout
function logout() {
  endSession_();
  return { ok: true };
}

// getCurrentMember: called by frontend on load
function getCurrentMember() { return caller_(); }
