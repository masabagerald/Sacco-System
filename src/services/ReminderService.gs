// ── PENDING-ACTION REMINDERS ──────────────────────────────────────────────────
// Once a day (sendPendingActionReminders, ScheduledJobs.gs), everyone with something waiting for them
// gets one email listing it: admins for approvals and reviews, guarantors for consent (with their
// Approve / Decline links again). Each item goes only to people the rules allow to act on it -- the same
// checks the approve/verify functions use -- and only once it has waited PENDING_REMINDER_MIN_HOURS
// (the immediate notice covers the first hours). Reminders repeat daily until the item is dealt with.

// Milliseconds of a 'yyyy-MM-dd HH:mm:ss' (or 'yyyy-MM-dd') value, or NaN
function tsMs_(v) { return new Date(String(v || '').trim().replace(' ', 'T')).getTime(); }

// The latest of several timestamps: when the item last became actionable
function latestTs_(values) {
  return values.map(v => String(v || '').trim()).filter(v => !isNaN(tsMs_(v))).sort().pop() || '';
}

// Everything waiting for someone, as of nowMs.
// Returns { admins: { memberNo: [item] }, guarantors: [{ requestId, guarantorNo, token, since, days }] }
// item: { kind, id, about, action, since, days }
function pendingActions_(nowMs) {
  const minMs = PENDING_REMINDER_MIN_HOURS * 3600000;
  const age = since => { const t = tsMs_(since); return isNaN(t) ? null : nowMs - t; };
  const dueEnough = since => { const a = age(since); return a !== null && a >= minMs; };
  const days = since => Math.max(0, Math.floor(age(since) / 86400000));

  const members = readSheet_(SH_MEMBERS, 'memberno').rows;
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
  const gRows = ss.getSheetByName(SH_GUARANTORS) ? readSheet_(SH_GUARANTORS, 'requestid').rows : [];
  const gOf = id => gRows.filter(g => String(g['RequestID'] || '').trim() === id && !String(g['LoanID'] || '').trim());

  // Loan requests: admin approval once both guarantors agreed; rejection if one declined; waivers
  const waivers = typeof waiversByRequest_ === 'function' ? waiversByRequest_() : {};
  readSheet_(SH_LOAN_REQ, 'requestid').rows.filter(r => String(r['RequestID'] || '').trim()).forEach(r => {
    const id = String(r['RequestID']).trim(), status = String(r['Status'] || '').trim();
    const about = nameOf(r['MemberNo']) + ' · ' + fmtUGX(num(r['Amount (UGX)']));
    if (status === REQ_PENDING_WAIVER) {
      const w = waivers[id]; if (!w) return;
      const decisions = waiverDecisions_(id);
      add({ kind: 'Loan with security: waiver', id, about, action: 'Approve or reject the waiver',
        since: latestTs_([w['Timestamp']].concat(decisions.map(d => d.at))) }, a => !waiverDeciderError_(w, r, a, decisions, true));
      return;
    }
    if (status !== 'Pending' && status !== 'Partially Approved') return;   // Awaiting Guarantors: waiting on guarantors only
    const g = gOf(id);
    const declined = g.some(x => String(x['Response'] || '').trim() === 'Declined');
    if (declined) {
      add({ kind: 'Loan request', id, about, action: 'Reject (a guarantor declined)', since: latestTs_(g.map(x => x['Responded At']).concat([r['Timestamp']])) },
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
      since: latestTs_([r['Timestamp'], r['Approver 1 At']].concat(g.map(x => x['Responded At']))) },
      a => !approvalDutyError_(r, String(a['MemberNo']).trim()));
  });

  // Withdrawal requests
  readSheet_(SH_WD_REQ, 'requestid').rows.filter(r => String(r['RequestID'] || '').trim() && isOpenRequest_(r)).forEach(r => {
    add({ kind: 'Withdrawal request', id: String(r['RequestID']).trim(), about: nameOf(r['MemberNo']) + ' · ' + fmtUGX(num(r['Amount (UGX)'])) + ' from ' + requestAccount_(r),
      action: r['Approver 1'] ? 'Second approval' : 'Approve or reject', since: latestTs_([r['Timestamp'], r['Approver 1 At']]) },
      a => !approvalDutyError_(r, String(a['MemberNo']).trim()));
  });

  // Loan fund entries and investment transactions (a linked pair is approved together: listed once)
  const listed = {};
  Object.keys(APPROVAL_LEDGERS).forEach(key => {
    const L = APPROVAL_LEDGERS[key];
    readOptional_(L.sheet, L.hint).rows.filter(r => String(r[L.id] || '').trim() && isOpenRequest_(r)).forEach(r => {
      const id = String(r[L.id]).trim(), linked = String(r['Linked Entry'] || '').trim();
      if (linked && listed[linked]) return;
      listed[id] = true;
      add({ kind: L.label + (linked ? ' (with ' + linked + ')' : ''), id, about: String(r[L.type] || '') + ' · ' + fmtUGX(num(r['Amount (UGX)'])),
        action: r['Approver 1'] ? 'Second approval' : 'Approve or reject', since: latestTs_([r['Timestamp'], r['Approver 1 At']]) },
        a => !approvalDutyError_(r, String(a['MemberNo']).trim()));
    });
  });

  // Assets awaiting verification
  if (ss.getSheetByName(SH_ASSETS)) assetRows_().filter(r => String(r['Verification Status'] || '') === ASSET_VERIFICATION.PENDING).forEach(r => {
    add({ kind: 'Asset verification', id: String(r['AssetID']).trim(), about: String(r['Description'] || '') + ' · ' + fmtUGX(num(r['Value (UGX)'])),
      action: 'Verify or reject', since: String(r['Submitted At'] || r['Timestamp'] || '') },
      a => !assetReviewBlock_(r, String(a['MemberNo']).trim()));
  });
  return out;
}

// Sends the reminders. Returns { admins, items, guarantors } (counts) for the log.
function sendPendingActionReminders_(nowMs) {
  const p = pendingActions_(nowMs);
  const members = readSheet_(SH_MEMBERS, 'memberno').rows;
  const byNo = no => members.find(x => String(x['MemberNo'] || '').trim() === no);
  const url = webAppUrl_();
  let items = 0;
  Object.keys(p.admins).forEach(no => {
    const m = byNo(no), list = p.admins[no].slice().sort((x, y) => y.days - x.days);
    if (!m || !String(m['Email'] || '').trim()) return;
    items += list.length;
    sendEmail_(m['Email'], 'Waiting for your action: ' + list.length + ' item' + (list.length > 1 ? 's' : ''),
      list.map(i => [i.kind + ' ' + i.id, i.action + ' — ' + i.about + ' — waiting ' + (i.days ? i.days + ' day' + (i.days > 1 ? 's' : '') : 'since today')]),
      'Hello ' + (m['Full Name'] || no) + ', the items below are waiting for your approval or review. Please attend to them in the app: ' + url
      + ' . You will be reminded daily until they are dealt with.');
  });
  // Guarantors: the original request email again, with their own Approve / Decline links
  const groups = {};
  p.guarantors.forEach(x => { (groups[x.requestId] = groups[x.requestId] || []).push(x); });
  Object.keys(groups).forEach(id => {
    const x = groups[id][0], applicant = byNo(x.applicantNo);
    const sr = loanSpecFor_(applicant ? String(applicant['Membership Type'] || '').trim() : '', x.term);
    if (!sr.ok) return;
    sendGuarantorRequests_(id, x.applicantNo, x.amount, sr.spec, groups[id].map(g => ({ guarantorNo: g.guarantorNo, token: g.token })), true);
  });
  const result = { admins: Object.keys(p.admins).length, items, guarantors: p.guarantors.length };
  if (result.admins || result.guarantors)
    auditLog_('Pending Action Reminders', '', 'System', 'Daily reminders: ' + result.admins + ' administrator(s) about ' + result.items
      + ' waiting item(s); ' + result.guarantors + ' guarantor consent reminder(s).', '');
  return result;
}
