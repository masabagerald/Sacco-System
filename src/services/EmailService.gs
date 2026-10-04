// ── EMAIL HELPERS ─────────────────────────────────────────────────────────────
// All member emails share one layout: navy header with the club seal, a body, and a footer.
// The seal is sent as an inline image (cid), which mail apps display reliably.

// Wraps body HTML in the club layout. heading is the small line under the club name.
function _emailShell(heading, bodyHtml, footnote) {
  return '<div style="background:#f4f7f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d5e0ec;border-radius:12px;overflow:hidden;">' +
      '<tr><td style="background:' + BRAND_COLOR + ';padding:18px 22px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="vertical-align:middle;padding-right:14px;"><img src="cid:clubseal" width="58" height="58" alt="" style="display:block;border-radius:50%;border:2px solid rgba(255,255,255,.35);"></td>' +
          '<td style="vertical-align:middle;">' +
            '<div style="color:#ffffff;font-size:15px;font-weight:700;">' + esc(SACCO_NAME) + '</div>' +
            '<div style="color:#c9d9ea;font-size:12px;margin-top:3px;">' + esc(heading) + '</div>' +
          '</td>' +
        '</tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 24px 8px;color:#1d2b3a;font-size:14px;line-height:1.6;">' + bodyHtml + '</td></tr>' +
      '<tr><td style="padding:14px 24px 22px;color:#7a8a9c;font-size:11px;line-height:1.5;border-top:1px solid #eef3f8;">' +
        esc(footnote || ('This is an automated message from ' + SACCO_NAME + '. Please do not reply to this email.')) +
      '</td></tr>' +
    '</table></div>';
}

// Label / value rows used in notification emails
function _emailRows(rows) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 4px;">' +
    rows.map(r =>
      '<tr><td style="padding:8px 12px;color:#5b6b7d;font-size:12px;border-bottom:1px solid #eef3f8;">' + esc(String(r[0])) + '</td>' +
      '<td style="padding:8px 12px;color:' + BRAND_COLOR + ';font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #eef3f8;">' + esc(String(r[1])) + '</td></tr>'
    ).join('') +
    '</table>';
}

// Sends a finished HTML email with the club seal attached inline. Errors are thrown to the caller.
function _sendHtmlEmail(to, subject, html) {
  MailApp.sendEmail({
    to: to, name: SACCO_NAME,
    subject: subject,
    htmlBody: html,
    inlineImages: { clubseal: _logoBlob() }
  });
}

function _sendEmail(to, subject, rows, message) {
  to=String(to||'').trim(); if (!to) return;
  try {
    const body = '<p style="margin:0 0 6px;">' + esc(message) + '</p>' + _emailRows(rows);
    _sendHtmlEmail(to, '[' + SACCO_NAME + '] ' + subject, _emailShell(subject, body));
  } catch(e) { /* swallow email errors so transactions still succeed */ }
}

function _otpEmailHtml(name, code) {
  const body =
    '<p style="margin:0 0 14px;">Hello ' + esc(name) + ',</p>' +
    '<p style="margin:0 0 18px;">Use the code below to sign in. It expires in <strong>10 minutes</strong> and can only be used once.</p>' +
    '<div style="background:#eef3f8;border:2px solid ' + BRAND_COLOR + ';border-radius:10px;padding:20px;text-align:center;margin-bottom:18px;">' +
      '<span style="font-family:\'Courier New\',monospace;font-size:34px;font-weight:800;color:' + BRAND_COLOR + ';letter-spacing:8px;">' + esc(code) + '</span>' +
    '</div>' +
    '<p style="margin:0;color:#5b6b7d;font-size:12px;">If you did not request this code, you can ignore this email.</p>';
  return _emailShell('Your sign-in code', body);
}

function _notifyAdmins(subject, rows, message) {
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  members.filter(m=>String(m['Role']||'').toLowerCase()==='admin').forEach(m=>_sendEmail(m['Email'],subject,rows,message));
}
