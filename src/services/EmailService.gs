// ── EMAIL HELPERS ─────────────────────────────────────────────────────────────

function _sendEmail(to, subject, rows, message) {
  to=String(to||'').trim(); if (!to) return;
  try {
    const rowsHtml=rows.map(r=>
      '<tr><td style="padding:7px 14px;color:#6b7c75;font-size:13px;border-bottom:1px solid #e5ece8;">'+esc(String(r[0]))+
      '</td><td style="padding:7px 14px;font-weight:700;color:'+BRAND_COLOR+';font-size:13px;border-bottom:1px solid #e5ece8;text-align:right;">'+esc(String(r[1]))+'</td></tr>'
    ).join('');
    MailApp.sendEmail({ to, name:SACCO_NAME, subject:'['+SACCO_NAME+'] '+subject,
      htmlBody:
        '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border:1px solid #e5ece8;border-radius:10px;overflow:hidden;">'+
          '<div style="background:'+BRAND_COLOR+';color:#fff;padding:18px 22px;">'+
            '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.8;">'+esc(SACCO_NAME)+'</div>'+
            '<div style="font-size:18px;font-weight:700;margin-top:4px;">'+esc(subject)+'</div>'+
          '</div>'+
          '<div style="padding:22px;">'+
            '<p style="font-size:14px;color:#243b30;line-height:1.5;margin:0 0 16px;">'+esc(message)+'</p>'+
            '<table style="width:100%;border-collapse:collapse;">'+rowsHtml+'</table>'+
            '<p style="font-size:11px;color:#9fb3ac;margin:18px 0 0;">This is an automated message from '+esc(SACCO_NAME)+'.</p>'+
          '</div>'+
        '</div>'
    });
  } catch(e) { /* swallow email errors so transactions still succeed */ }
}

function _otpEmailHtml(name, code) {
  return '<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;border:1px solid #e5ece8;border-radius:10px;overflow:hidden;">'+
    '<div style="background:'+BRAND_COLOR+';color:#fff;padding:16px 22px;">'+
      '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.8;">'+esc(SACCO_NAME)+'</div>'+
      '<div style="font-size:17px;font-weight:700;margin-top:4px;">Your sign-in code</div>'+
    '</div><div style="padding:22px;">'+
      '<p style="font-size:14px;color:#243b30;margin:0 0 16px;">Hello '+esc(name)+',</p>'+
      '<p style="font-size:14px;color:#243b30;margin:0 0 20px;">Use the code below to sign in. It expires in <strong>10 minutes</strong> and can only be used once.</p>'+
      '<div style="background:#f0f7f3;border:2px solid '+BRAND_COLOR+';border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;">'+
        '<span style="font-family:\'Courier New\',monospace;font-size:36px;font-weight:800;color:'+BRAND_COLOR+';letter-spacing:8px;">'+esc(code)+'</span>'+
      '</div>'+
      '<p style="font-size:12px;color:#9fb3ac;">If you did not request this code, please ignore this email.</p>'+
    '</div></div>';
}

function _notifyAdmins(subject, rows, message) {
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  members.filter(m=>String(m['Role']||'').toLowerCase()==='admin').forEach(m=>_sendEmail(m['Email'],subject,rows,message));
}
