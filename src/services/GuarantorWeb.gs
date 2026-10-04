// ── GUARANTOR EMAILS & RESPONSE LINKS ─────────────────────────────────────────
// Guarantors get an email with Approve / Decline links. Each link carries a private token
// and opens a confirmation page, so a click alone (e.g. an email scanner) never records a decision.

function _webAppUrl() { return ScriptApp.getService().getUrl(); }

function _memberName(memberNo, members) {
  const m = members.find(x => String(x['MemberNo']||'').trim() === String(memberNo).trim());
  return m ? (m['Full Name'] || memberNo) : memberNo;
}

// Emails every guarantor on a new request. Email failures are logged, not thrown,
// so the request itself still saves.
function _sendGuarantorRequests(requestId, applicantNo, amount, purpose, termDef, tokens) {
  const { rows: members } = readSheet(SH_MEMBERS, 'memberno');
  const applicant = _memberName(applicantNo, members);
  const base = _webAppUrl();
  tokens.forEach(t => {
    const m = members.find(x => String(x['MemberNo']||'').trim() === String(t.guarantorNo).trim());
    if (!m || !String(m['Email']||'').trim()) { Logger.log('No email for guarantor ' + t.guarantorNo); return; }
    const link = d => base + '?g=' + t.token + '&decide=' + d;
    const html = _guarantorEmailHtml(m['Full Name'] || '', requestId, applicant, amount, purpose, termDef, link('approve'), link('decline'));
    try {
      _sendHtmlEmail(m['Email'], '[' + SACCO_NAME + '] Please respond to guarantor request ' + requestId, html);
    } catch (e) { Logger.log('Guarantor email failed for ' + t.guarantorNo + ': ' + e); }
  });
}

function _findGuaranteeByToken(token) {
  const { sh, headers, rows } = readSheet(SH_GUARANTORS, 'requestid');
  const row = rows.find(r => String(r['Token']||'') === String(token));
  return row ? { sh, headers, row } : null;
}

function _setGuaranteeCell(sh, headers, rowNum, name, value) {
  const c = ci(headers, name);
  if (c > -1) sh.getRange(rowNum, c + 1).setValue(value);
}

// Handles a guarantor's link. Shows a confirmation page, then records the decision on confirm.
function _guarantorHandle(token, decide, confirm) {
  const found = _findGuaranteeByToken(token);
  if (!found) return _guarantorPage('Link not valid', 'This link is not valid. Please use the most recent email you received.');
  const { sh, headers, row } = found;
  const requestId = String(row['RequestID']||'').trim();

  const { rows: reqs } = readSheet(SH_LOAN_REQ, 'requestid');
  const req = reqs.find(r => String(r['RequestID']||'').trim() === requestId);
  if (!req || String(req['Status']||'').trim() !== 'Pending')
    return _guarantorPage('Request closed', 'This loan request is no longer open for guarantor responses.');

  const current = String(row['Response']||'Pending').trim();
  if (current !== 'Pending')
    return _guarantorPage('Already responded', 'You have already ' + (current === 'Accepted' ? 'approved' : 'declined') + ' this request. Thank you.');

  if (decide !== 'approve' && decide !== 'decline')
    return _guarantorPage('Link not valid', 'This link is not valid.');

  const { rows: members } = readSheet(SH_MEMBERS, 'memberno');
  const applicantName = _memberName(req['MemberNo'], members);
  const guarantorName = _memberName(row['GuarantorNo'], members);
  const amount = fmtUGX(num(req['Amount (UGX)']));
  const purpose = String(req['Purpose']||'').trim();

  if (confirm !== '1') {
    const yes = _webAppUrl() + '?g=' + token + '&decide=' + decide + '&confirm=1';
    const verb = decide === 'approve' ? 'approve' : 'decline';
    return _guarantorPage('Confirm your response',
      '<p style="margin:0 0 12px;">Hello ' + esc(guarantorName) + ', you are about to <strong>' + verb + '</strong> guarantor request <strong>' + esc(requestId) + '</strong>.</p>' +
      '<table style="width:100%;font-size:14px;margin:0 0 16px;">' +
        '<tr><td style="color:#6b7c75;padding:4px 0;">Member</td><td style="text-align:right;font-weight:700;">' + esc(applicantName) + '</td></tr>' +
        '<tr><td style="color:#6b7c75;padding:4px 0;">Loan</td><td style="text-align:right;font-weight:700;">' + esc(amount) + '</td></tr>' +
        (purpose ? '<tr><td style="color:#6b7c75;padding:4px 0;">Purpose</td><td style="text-align:right;">' + esc(purpose) + '</td></tr>' : '') +
      '</table>' +
      '<a href="' + yes + '" style="display:block;text-align:center;background:' + (decide === 'approve' ? '#2e7d4f' : '#b3412e') + ';color:#fff;text-decoration:none;font-weight:700;padding:12px;border-radius:8px;">Yes, ' + verb + '</a>' +
      '<p style="font-size:12px;color:#6b7c75;margin:14px 0 0;">Close this page to cancel. Nothing is recorded until you confirm.</p>');
  }

  // Record the decision
  const decision = decide === 'approve' ? 'Accepted' : 'Declined';
  _setGuaranteeCell(sh, headers, row._row, 'response', decision);
  _setGuaranteeCell(sh, headers, row._row, 'responded at', now_ts());
  const applicantEmail = (members.find(m => String(m['MemberNo']||'').trim() === String(req['MemberNo']).trim()) || {})['Email'];
  const rowsOut = [['Request ID', requestId], ['Guarantor', guarantorName], ['Response', decision]];

  _sendEmail(applicantEmail, 'Guarantor response: ' + requestId, rowsOut,
    decision === 'Accepted' ? guarantorName + ' has approved your guarantee request.' : guarantorName + ' has declined your guarantee request. Please choose another guarantor.');
  if (decision === 'Declined') {
    _notifyAdmins('Guarantor declined: ' + requestId, rowsOut,
      guarantorName + ' declined to guarantee ' + applicantName + '\'s loan request. The request cannot be approved as it stands.');
  } else {
    const all = _guaranteeResponses(requestId);
    if (all.every(g => g.response === 'Accepted'))
      _notifyAdmins('Ready for approval: ' + requestId, rowsOut, 'All guarantors have approved. You can now approve this request.');
  }

  return _guarantorPage(decision === 'Accepted' ? 'Thank you' : 'Response recorded',
    'Your ' + (decision === 'Accepted' ? 'approval' : 'decline') + ' for request <strong>' + esc(requestId) + '</strong> has been recorded. You can close this page.');
}

function _guarantorPage(title, bodyHtml) {
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;font-family:Arial,sans-serif;background:#f4f7f5;">' +
    '<div style="max-width:460px;margin:40px auto;background:#fff;border:1px solid #e5ece8;border-radius:12px;overflow:hidden;">' +
      '<div style="background:' + BRAND_COLOR + ';color:#fff;padding:18px 22px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:14px;"><img src="data:image/jpeg;base64,' + CLUB_LOGO_B64 + '" width="56" height="56" alt="" style="display:block;border-radius:50%;"></td><td>' +
        '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.8;">' + esc(SACCO_NAME) + '</div>' +
        '<div style="font-size:18px;font-weight:700;margin-top:4px;">' + esc(title) + '</div></td></tr></table>' +
      '</div>' +
      '<div style="padding:22px;font-size:14px;color:#243b30;line-height:1.55;">' + bodyHtml + '</div>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(SACCO_NAME).addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Email to a guarantor: loan details and the Approve / Decline buttons
function _guarantorEmailHtml(name, requestId, applicant, amount, purpose, termDef, approveUrl, declineUrl) {
  const btn = (url, label, color) => '<a href="' + url + '" style="display:block;text-align:center;background:' + color + ';color:#ffffff;text-decoration:none;font-weight:700;padding:13px;border-radius:8px;font-size:14px;">' + label + '</a>';
  const body =
    '<p style="margin:0 0 12px;">Hello ' + esc(name) + ',</p>' +
    '<p style="margin:0 0 12px;"><strong>' + esc(applicant) + '</strong> has asked you to guarantee a loan of <strong>' + esc(fmtUGX(amount)) + '</strong>' + (purpose ? ' for ' + esc(purpose) : '') + '.</p>' +
    _emailRows([
      ['Request ID', requestId],
      ['Repayment term', termDef.label + ' at ' + r2(termDef.rate * 100) + '% interest'],
      ['Processing fee', fmtUGX(PROCESSING_FEE)],
      ['Due', 'Full amount on the due date (counted from approval)']
    ]) +
    '<p style="margin:14px 0 16px;color:#5b6b7d;font-size:13px;">Guaranteeing means you agree to support repayment if the member cannot pay.</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="padding-right:6px;width:50%;">' + btn(approveUrl, 'Approve', '#2e7d4f') + '</td>' +
      '<td style="padding-left:6px;width:50%;">' + btn(declineUrl, 'Decline', '#b3412e') + '</td>' +
    '</tr></table>' +
    '<p style="margin:14px 0 0;color:#7a8a9c;font-size:12px;">You will be asked to confirm on the next page. If you did not expect this request, decline it or contact the committee.</p>';
  return _emailShell('Guarantor request: ' + requestId, body);
}
