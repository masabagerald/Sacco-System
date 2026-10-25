// ── PENDING-ACTION REMINDERS ──────────────────────────────────────────────────
// Once a day (sendPendingActionReminders, ScheduledJobs.gs), everyone with something waiting for them
// gets one email listing it: admins for approvals and reviews, guarantors for consent (with their
// Approve / Decline links again). Each item goes only to people the rules allow to act on it -- the same
// checks the approve/verify functions use -- and only once it has waited PENDING_REMINDER_MIN_HOURS
// (the immediate notice covers the first hours). Reminders repeat daily until the item is dealt with.

// Milliseconds of a 'yyyy-MM-dd HH:mm:ss' (or 'yyyy-MM-dd') value, or NaN
function _tsMs(v) { return new Date(String(v || '').trim().replace(' ', 'T')).getTime(); }

// The latest of several timestamps: when the item last became actionable
function _latestTs(values) {
  return values.map(v => String(v || '').trim()).filter(v => !isNaN(_tsMs(v))).sort().pop() || '';
}

// Everything waiting for someone, as of nowMs.
// Returns { admins: { memberNo: [item] }, guarantors: [{ requestId, guarantorNo, token, since, days }] }
// item: { kind, id, about, action, since, days }
function _pendingActions(nowMs) {
  const minMs = PENDING_REMINDER_MIN_HOURS * 3600000;
  const age = since => { const t = _tsMs(since); return isNaN(t) ? null : nowMs - t; };
  const dueEnough = since => { const a = age(since); return a !== null && a >= minMs; };
  const days = since => Math.max(0, Math.floor(age(since) / 86400000));

  const members = readSheet(SH_MEMBERS, 'memberno').rows;
  const nameOf = no => { const m = members.find(x => String(x['MemberNo'] || '').trim() === String(no || '').trim()); return m ? (m['Full Name'] || no) : (no || ''); };
  const admins = members.filter(m => String(m['Role'] || '').trim().toLowerCase() === 'admin' && String(m['Status'] || '').trim().toLowerCase() === 'active'
    && String(m['MemberNo'] || '').trim());
  const out = { admins: {}, guarantors: [] };
  const add = (item, canAct) => {
    if (!dueEnough(item.since)) return;
    item.days = days(item.since);
    admins.filter(canAct).forEach(a => { const no = String(a['MemberNo']).trim(); (out.admins[no] = out.admins[no] || []).push(item); });
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gRows = ss.getSheetByName(SH_GUARANTORS) ? readSheet(SH_GUARANTORS, 'requestid').rows : [];
  const gOf = id => gRows.filter(g => String(g['RequestID'] || '').trim() === id && !String(g['LoanID'] || '').trim());

  // Loan requests: admin approval once both guarantors agreed; rejection if one declined; waivers
  const waivers = typeof _waiversByRequest === 'function' ? _waiversByRequest() : {};
  readSheet(SH_LOAN_REQ, 'requestid').rows.filter(r => String(r['RequestID'] || '').trim()).forEach(r => {
    const id = String(r['RequestID']).trim(), status = String(r['Status'] || '').trim();
    const about = nameOf(r['MemberNo']) + ' · ' + fmtUGX(num(r['Amount (UGX)']));
    if (status === REQ_PENDING_WAIVER) {
      const w = waivers[id]; if (!w) return;
      const decisions = _waiverDecisions(id);
      add({ kind: 'Loan with security: waiver', id, about, action: 'Approve or reject the waiver',
        since: _latestTs([w['Timestamp']].concat(decisions.map(d => d.at))) }, a => !_waiverDeciderError(w, r, a, decisions, true));
      return;
    }
    if (status !== 'Pending' && status !== 'Partially Approved') return;   // Awaiting Guarantors: waiting on guarantors only
    const g = gOf(id);
    const declined = g.some(x => String(x['Response'] || '').trim() === 'Declined');
    if (declined) {
      add({ kind: 'Loan request', id, about, action: 'Reject (a guarantor declined)', since: _latestTs(g.map(x => x['Responded At']).concat([r['Timestamp']])) },
        () => true);
      return;
    }
    const allAccepted = g.length === GUARANTOR_COUNT && g.every(x => String(x['Response'] || '').trim() === 'Accepted');
    if (!allAccepted) {
      g.filter(x => String(x['Response'] || 'Pending').trim() === 'Pending' || !String(x['Response'] || '').trim()).forEach(x => {
        const since = String(x['Timestamp'] || r['Timestamp'] || '');
        if (dueEnough(since)) out.guarantors.push({ requestId: id, guarantorNo: String(x['GuarantorNo'] || '').trim(), token: String(x['Token'] || ''),
          applicantNo: String(r['MemberNo'] || '').trim(), amount: num(r['Amount (UGX)']), term: r['Repayment Term'], since, days: days(since) });
      });
      return;
    }
    add({ kind: 'Loan request', id, about, action: r['Approver 1'] ? 'Second approval' : 'Approve or reject',
      since: _latestTs([r['Timestamp'], r['Approver 1 At']].concat(g.map(x => x['Responded At']))) },
      a => !_approvalDutyError(r, String(a['MemberNo']).trim()));
  });

  // Withdrawal requests
  readSheet(SH_WD_REQ, 'requestid').rows.filter(r => String(r['RequestID'] || '').trim() && _isOpenRequest(r)).forEach(r => {
    add({ kind: 'Withdrawal request', id: String(r['RequestID']).trim(), about: nameOf(r['MemberNo']) + ' · ' + fmtUGX(num(r['Amount (UGX)'])) + ' from ' + _requestAccount(r),
      action: r['Approver 1'] ? 'Second approval' : 'Approve or reject', since: _latestTs([r['Timestamp'], r['Approver 1 At']]) },
      a => !_approvalDutyError(r, String(a['MemberNo']).trim()));
  });

  // Loan fund entries and investment transactions (a linked pair is approved together: listed once)
  const listed = {};
  Object.keys(APPROVAL_LEDGERS).forEach(key => {
    const L = APPROVAL_LEDGERS[key];
    _readOptional(L.sheet, L.hint).rows.filter(r => String(r[L.id] || '').trim() && _isOpenRequest(r)).forEach(r => {
      const id = String(r[L.id]).trim(), linked = String(r['Linked Entry'] || '').trim();
      if (linked && listed[linked]) return;
      listed[id] = true;
      add({ kind: L.label + (linked ? ' (with ' + linked + ')' : ''), id, about: String(r[L.type] || '') + ' · ' + fmtUGX(num(r['Amount (UGX)'])),
        action: r['Approver 1'] ? 'Second approval' : 'Approve or reject', since: _latestTs([r['Timestamp'], r['Approver 1 At']]) },
        a => !_approvalDutyError(r, String(a['MemberNo']).trim()));
    });
  });

  // Assets awaiting verification
  if (ss.getSheetByName(SH_ASSETS)) _assetRows().filter(r => String(r['Verification Status'] || '') === ASSET_VERIFICATION.PENDING).forEach(r => {
    add({ kind: 'Asset verification', id: String(r['AssetID']).trim(), about: String(r['Description'] || '') + ' · ' + fmtUGX(num(r['Value (UGX)'])),
      action: 'Verify or reject', since: String(r['Submitted At'] || r['Timestamp'] || '') },
      a => !_assetReviewBlock(r, String(a['MemberNo']).trim()));
  });
  return out;
}

// Sends the reminders. Returns { admins, items, guarantors } (counts) for the log.
function _sendPendingActionReminders(nowMs) {
  const p = _pendingActions(nowMs);
  const members = readSheet(SH_MEMBERS, 'memberno').rows;
  const byNo = no => members.find(x => String(x['MemberNo'] || '').trim() === no);
  const url = _webAppUrl();
  let items = 0;
  Object.keys(p.admins).forEach(no => {
    const m = byNo(no), list = p.admins[no].slice().sort((x, y) => y.days - x.days);
    if (!m || !String(m['Email'] || '').trim()) return;
    items += list.length;
    _sendEmail(m['Email'], 'Waiting for your action: ' + list.length + ' item' + (list.length > 1 ? 's' : ''),
      list.map(i => [i.kind + ' ' + i.id, i.action + ' — ' + i.about + ' — waiting ' + (i.days ? i.days + ' day' + (i.days > 1 ? 's' : '') : 'since today')]),
      'Hello ' + (m['Full Name'] || no) + ', the items below are waiting for your approval or review. Please attend to them in the app: ' + url
      + ' . You will be reminded daily until they are dealt with.');
  });
  // Guarantors: the original request email again, with their own Approve / Decline links
  const groups = {};
  p.guarantors.forEach(x => { (groups[x.requestId] = groups[x.requestId] || []).push(x); });
  Object.keys(groups).forEach(id => {
    const x = groups[id][0], applicant = byNo(x.applicantNo);
    const sr = _loanSpecFor(applicant ? String(applicant['Membership Type'] || '').trim() : '', x.term);
    if (!sr.ok) return;
    _sendGuarantorRequests(id, x.applicantNo, x.amount, sr.spec, groups[id].map(g => ({ guarantorNo: g.guarantorNo, token: g.token })), true);
  });
  const result = { admins: Object.keys(p.admins).length, items, guarantors: p.guarantors.length };
  if (result.admins || result.guarantors)
    auditLog('Pending Action Reminders', '', 'System', 'Daily reminders: ' + result.admins + ' administrator(s) about ' + result.items
      + ' waiting item(s); ' + result.guarantors + ' guarantor consent reminder(s).', '');
  return result;
}
