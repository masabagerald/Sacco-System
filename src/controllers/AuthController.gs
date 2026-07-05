// ── IDENTITY / LOGIN ──────────────────────────────────────────────────────────

// Step 1: silently probe Google session
function tryAutoDetect() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch(e) {}
  return { detected: !!email, email };
}

// Step 2: user confirmed auto-detected email
function confirmAutoDetect(email) {
  const r = _lookupMember(email);
  if (r.ok) { _storeSession(email); }
  return r;
}

// Step 3a: send OTP (manual path)
function sendOtp(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Please enter your email address.' };
  const r = _lookupMember(email);
  if (!r.ok) return r;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  Config.setScriptProp('otp_' + email, JSON.stringify({ code, expires: Date.now() + OTP_EXPIRY_MS }));

  try {
    MailApp.sendEmail({
      to: email, name: SACCO_NAME,
      subject: '[' + SACCO_NAME + '] Your sign-in code',
      htmlBody: _otpEmailHtml(r.member.name, code)
    });
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
    const raw = PropertiesService.getScriptProperties().getProperty('otp_' + email);
    if (!raw) return { ok: false, error: 'No code found. Please request a new one.' };
    payload = JSON.parse(raw);
  } catch(e) { return { ok: false, error: 'Could not read code. Please request a new one.' }; }
  if (Date.now() > payload.expires) {
    PropertiesService.getScriptProperties().deleteProperty('otp_' + email);
    return { ok: false, expired: true, error: 'Code expired. Please request a new one.' };
  }
  if (payload.code !== code) return { ok: false, error: 'Incorrect code. Please check your email.' };
  PropertiesService.getScriptProperties().deleteProperty('otp_' + email);
  const r = _lookupMember(email);
  if (r.ok) _storeSession(email);
  return r;
}

// Logout
function logout() {
  try { PropertiesService.getUserProperties().deleteProperty('sacco_email'); } catch(e) {}
  return { ok: true };
}

// getCurrentMember: called by frontend on load
function getCurrentMember() { return _caller(); }
