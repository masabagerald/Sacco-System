// ── REPORTS & EXPORTS ─────────────────────────────────────────────────────────

// Each member's position from rows already read, indexed once: savings total, active loans with their
// outstanding balance, and unpaid surcharges. Returns memberNo -> { savings, activeLoans, outstanding, unpaid }.
// Used by the ledger PDF, the CSV export and the monthly statements job instead of re-reading per member.
function memberPositions_(savRows, loans, reps, fines) {
  const balances = memberBalances_(savRows);
  const loansOf = {}, unpaidOf = {};
  loans.forEach(l => { const no = String(l['MemberNo']||'').trim(); (loansOf[no] = loansOf[no] || []).push(l); });
  fines.forEach(f => {
    const no = String(f['MemberNo']||'').trim();
    if (String(f['Status']||'').toLowerCase() === 'unpaid') unpaidOf[no] = (unpaidOf[no] || 0) + num(f['Amount (UGX)']);
  });
  return no => {
    const activeLoans = (loansOf[no] || []).map(l => computeLoan_(l, reps)).filter(l => l.status === 'Active');
    return { savings: balanceOf_(balances, no).total, activeLoans,
      outstanding: activeLoans.reduce((s, l) => s + l.outstandingBalance, 0), unpaid: unpaidOf[no] || 0 };
  };
}

function getMemberStatementData() {
  const auth = caller_(); if (!auth.ok) return auth;
  const me = auth.member;   // checked once; the parts below do not check again
  const savings  = mySavingsFor_(me);
  const loans    = myLoansFor_(me);
  const fines    = myFinesFor_(me);
  const loanReqs = myLoanRequestsFor_(me);
  const wdReqs   = myWithdrawalRequestsFor_(me);
  return { ok:true, generatedOn:today(), member:auth.member,
    savingsBalance:savings.ok?savings.balance:0, savingsAccounts:savings.ok?savings.accounts:null, savingsHistory:savings.ok?savings.history:[],
    loans:loans.ok?loans.loans:[], fines:fines.ok?fines.fines:[], unpaidFinesTotal:fines.ok?fines.unpaidTotal:0,
    loanRequests:loanReqs.ok?loanReqs.requests:[], withdrawalRequests:wdReqs.ok?wdReqs.requests:[] };
}

// Body of a member statement (uses the shared layout in Branding.gs)
function statementBody_(body, data) {
  const m = data.member;
  const activeOut = data.loans.filter(l => l.status === 'Active').reduce((s,l) => s + l.outstandingBalance, 0);
  cards_(body, [
    ['Savings balance', fmtUGX(data.savingsBalance)],
    ['Outstanding loans', fmtUGX(activeOut)],
    ['Unpaid surcharges', fmtUGX(data.unpaidFinesTotal)]
  ]);

  section_(body, 'Member details');
  kv_(body, [['Name', m.name], ['Member no.', m.memberNo], ['Email', m.email], ['Generated on', human_date(data.generatedOn)]]);

  if (data.savingsAccounts) {
    section_(body, 'Deposit accounts');
    kv_(body, DEPOSIT_ACCOUNTS.map(a => [a, fmtUGX(data.savingsAccounts[a])]));
  }

  section_(body, 'Savings transactions');
  table_(body, ['Date','Type','Account','Category','Reference','Amount (UGX)'],
    data.savingsHistory.map(r => [human_date(r.date), String(r.type), r.account || '-', r.category || '-', r.reference || '', fmtUGX(r.amount)]), [5]);

  if (data.loans.length) {
    section_(body, 'Loans');
    data.loans.forEach(l => {
      const p = body.appendParagraph(l.loanId + '  —  ' + l.status);
      p.setSpacingBefore(8); p.setSpacingAfter(3);
      p.editAsText().setBold(true).setFontSize(10.5).setForegroundColor(BRAND_INK);
      const rows = [['Principal', fmtUGX(l.principal)], ['Interest', l.rateLabel], ['Term', l.termLabel]];
      if (l.dueDate) rows.push(['Due date', human_date(l.dueDate)]);
      rows.push(['Total due', fmtUGX(l.totalDue || l.principal)], ['Total repaid', fmtUGX(l.totalRepaid)], ['Outstanding', fmtUGX(l.outstandingBalance)]);
      kv_(body, rows);
      if (l.schedule && l.schedule.length) {
        const isReducing = l.model === 'reducing';
        const head = l.scheduleHead || ['Month','Opening','Interest','Payment','Closing'];
        const srows = isReducing
          ? l.schedule.map(s => [String(s.month), fmtUGX(s.opening), fmtUGX(s.interest), fmtUGX(s.payment), fmtUGX(s.closing)])
          : l.schedule.map(s => [s.label, human_date(s.due), fmtUGX(s.amount), fmtUGX(s.balance)]);
        body.appendParagraph('').setSpacingAfter(2);
        table_(body, head, srows, isReducing ? [1,2,3,4] : [2,3]);
      }
    });
  }

  if (data.fines.length) {
    section_(body, 'Surcharges');
    table_(body, ['Date','Reason','Amount (UGX)','Status'],
      data.fines.map(f => [human_date(f.date || ''), f.reason || '', fmtUGX(f.amount), f.status || '']), [2]);
    const tot = body.appendParagraph('Total unpaid: ' + fmtUGX(data.unpaidFinesTotal));
    tot.setSpacingBefore(6);
    tot.editAsText().setBold(true).setForegroundColor(BRAND_COLOR);
  }
}

function generateMemberStatementDoc() {
  const auth = caller_(); if (!auth.ok) return auth;
  const data = getMemberStatementData(); if (!data.ok) return data;
  const m = data.member;
  const title = SACCO_NAME + ' Statement — ' + m.name + ' — ' + data.generatedOn;
  const blob = brandedPdf_(title, 'Member statement', body => statementBody_(body, data));
  let folder;
  const fi=DriveApp.getFoldersByName(SACCO_NAME+' Statements');
  folder = fi.hasNext() ? fi.next() : DriveApp.createFolder(SACCO_NAME+' Statements');
  const pdfFile = folder.createFile(blob).setName(title+'.pdf');
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = pdfFile.getId();
  auditLog_('Statement Generated', m.memberNo, m.memberNo, 'PDF statement generated.', id);
  return { ok:true, pdfUrl:'https://drive.google.com/file/d/'+id+'/view', downloadUrl:'https://drive.google.com/uc?export=download&id='+id, fileName:title+'.pdf' };
}

// Admin ledger as a branded PDF. Returned as base64 and downloaded in the browser (not shared by link).
function generateAdminReportPdf() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet_(SH_REPAY,'loanid');
  const { rows: savings } = readSheet_(SH_SAVINGS,'memberno');
  const { rows: fines }   = readSheet_(SH_FINES,'fineid');

  const per = memberPositions_(savings, loans, reps, fines);
  const memberRows = members.filter(m => String(m['MemberNo']||'').trim() !== '').map(m => {
    const no = String(m['MemberNo']).trim(), p = per(no);
    return { no, name: m['Full Name']||'', role: m['Role']||'', status: m['Status']||'', bal: p.savings, activeCount: p.activeLoans.length, out: p.outstanding, unpaid: p.unpaid };
  });
  const loanRows = loans.filter(l => String(l['LoanID']||'').trim() !== '').map(l => ({ l, c: computeLoan_(l, reps) }));
  const savingRows = savings.filter(r => String(r['MemberNo']||'').trim() !== '');
  const fineRows = fines.filter(f => String(f['FineID']||'').trim() !== '');

  const totalSavings = memberRows.reduce((s,m) => s + m.bal, 0);
  const totalOut = memberRows.reduce((s,m) => s + m.out, 0);
  const totalUnpaid = memberRows.reduce((s,m) => s + m.unpaid, 0);
  const activeLoans = loanRows.filter(x => x.c.status === 'Active').length;

  const title = SACCO_NAME + ' Ledger Report — ' + human_date(today());
  const blob = brandedPdf_(title, 'Ledger report  |  ' + human_date(today()), body => {
    cards_(body, [
      ['Members', String(memberRows.length)],
      ['Active loans', String(activeLoans)],
      ['Total savings', fmtUGX(totalSavings)],
      ['Outstanding loans', fmtUGX(totalOut)],
      ['Unpaid surcharges', fmtUGX(totalUnpaid)]
    ]);

    section_(body, 'Members');
    table_(body, ['Member no.','Name','Role','Status','Savings (UGX)','Active loans','Outstanding (UGX)','Unpaid surcharges (UGX)'],
      memberRows.map(m => [m.no, m.name, m.role, m.status, fmtUGX(m.bal), String(m.activeCount), fmtUGX(m.out), fmtUGX(m.unpaid)]),
      [4,5,6,7]);

    section_(body, 'Loans');
    table_(body, ['Loan ID','Member','Issued','Principal','Interest','Total due','Due date','Outstanding','Status'],
      loanRows.map(x => {
        const c = x.c;
        const interest = c.interest || c.totalInterestAccrued || 0;
        const totalDue = c.totalDue || r2(c.principal + interest);
        return [c.loanId, c.memberNo, human_date(c.dateIssued||''), fmtUGX(c.principal), fmtUGX(interest), fmtUGX(totalDue), human_date(c.dueDate||''), fmtUGX(c.outstandingBalance), c.status];
      }),
      [3,4,5,7]);

    section_(body, 'Savings transactions');
    table_(body, ['Date','Member no.','Type','Account','Category','Amount (UGX)','Reference'],
      savingRows.map(r => [human_date(r['Date']||''), String(r['MemberNo']||''), txType_(r), accountOf_(r), String(r['Payment Category']||'-'), fmtUGX(num(r['Amount (UGX)'])), String(r['Reference']||'')]),
      [5]);

    section_(body, 'Surcharges');
    table_(body, ['Surcharge ID','Member no.','Date','Amount (UGX)','Status'],
      fineRows.map(f => [String(f['FineID']||''), String(f['MemberNo']||''), human_date(pick_(f,['Date','Date of Payment'])), fmtUGX(num(f['Amount (UGX)'])), String(f['Status']||'')]),
      [3]);
  });

  auditLog_('Admin Report Export', '', auth.member.memberNo, 'Ledger PDF report downloaded.', '');
  return { ok:true, fileName: CLUB_SHORT_NAME + '_Ledger_Report_' + today() + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
}

function exportAdminCSV() {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet_(SH_REPAY,'loanid');
  const { rows: savings } = readSheet_(SH_SAVINGS,'memberno');
  const { rows: fines }   = readSheet_(SH_FINES,'fineid');
  const lines = [];
  lines.push(SACCO_NAME.toUpperCase()+' — LEDGER EXPORT — '+human_date(today()));
  lines.push('');
  lines.push('MEMBERS');
  lines.push(['MemberNo','Name','Email','Role','Status','Savings (UGX)','Active Loans','Outstanding (UGX)','Unpaid Surcharges (UGX)'].join(','));
  const per = memberPositions_(savings, loans, reps, fines);
  members.filter(m=>String(m['MemberNo']||'').trim()!=='').forEach(m=>{
    const p = per(String(m['MemberNo']).trim());
    lines.push([csvQ(m['MemberNo']),csvQ(m['Full Name']),csvQ(m['Email']),csvQ(m['Role']),csvQ(m['Status']),Math.round(p.savings),p.activeLoans.length,Math.round(p.outstanding),Math.round(p.unpaid)].join(','));
  });
  lines.push(''); lines.push('SAVINGS TRANSACTIONS');
  lines.push(['Date','MemberNo','Type','Account','Category','Amount (UGX)','Reference','Reverses','Recorded By'].join(','));
  savings.filter(r=>String(r['MemberNo']||'').trim()!=='').forEach(r=>lines.push([csvQ(r['Date']),csvQ(r['MemberNo']),csvQ(txType_(r)),csvQ(accountOf_(r)),csvQ(r['Payment Category']||''),Math.round(num(r['Amount (UGX)'])),csvQ(r['Reference']||''),csvQ(r['Reverses']||''),csvQ(r['Recorded By']||'')].join(',')));
  lines.push(''); lines.push('LOANS');
  lines.push(['LoanID','MemberNo','Date Issued','Principal','Rate %','Term','Outstanding (UGX)','Status'].join(','));
  loans.filter(l=>String(l['LoanID']||'').trim()!=='').forEach(l=>{
    const c=computeLoan_(l,reps);
    lines.push([csvQ(l['LoanID']),csvQ(l['MemberNo']),csvQ(l['Date Issued']),Math.round(num(l['Principal (UGX)'])),num(pick_(l,['Monthly Rate (%)','Weekly Rate (%)'])),num(l['Term (months)']),Math.round(c.outstandingBalance),csvQ(c.status)].join(','));
  });
  lines.push(''); lines.push('Generated by: '+auth.member.name+' on '+human_date(today()));
  auditLog_('Admin CSV Export', '', auth.member.memberNo, 'Full ledger exported to CSV.', '');
  return { ok:true, csv: lines.join('\n') };
}


// ── AUDIT LOG EXPORT ─────────────────────────────────────────────────────────
// CSV of the audit log with the same filters as the Audit tab (AuditService.gs), oldest first, sent in
// pages that the browser joins into one file, so 100,000+ entries download without hitting the size
// limit of one server reply. A date-only export reads just the Timestamp column plus the rows it returns.

const AUDIT_EXPORT_PAGE = 20000;

// Details and notes are typed by users: a cell starting with = + or @ would run as a formula in Excel
function csvText_(v) { const s = String(v == null ? '' : v); return csvQ(/^[=+@]/.test(s) ? "'" + s : s); }

function exportAuditLogCsv(filters, offset) {
  const auth = adminCaller_(); if (!auth.ok) return auth;
  const f = auditFilters_(filters); if (f.error) return { ok:false, error:f.error };
  offset = Math.max(0, Math.floor(num(offset)));

  const sh = getSheet_(SH_AUDIT), names = auditNameMap_(auditMembers_());
  const hits = auditFind_(sh, f, names);
  const page = hits.slice(offset, offset + AUDIT_EXPORT_PAGE);
  const lines = auditRead_(sh, page).map(e => { const v = auditView_(e, names);
    return [v.timestamp, v.action, v.category, v.member, v.memberName, v.performedBy, v.performedByName, v.details, v.refId].map(csvText_).join(','); });
  if (!offset) lines.unshift(['Timestamp','Action','Category','Member (Affected)','Member Name','Performed By','Performed By Name','Details','Reference ID'].join(','));

  const next = offset + page.length, done = next >= hits.length;
  if (done) auditLog_('Audit Log Export', '', auth.member.memberNo, 'Audit log CSV downloaded: ' + auditFilterLabel_(f) + ' (' + hits.length + ' entries).', '');
  return { ok:true, csv: lines.join('\n'), total: hits.length, nextOffset: done ? null : next,
    fileName: CLUB_SHORT_NAME + '_Audit_Log_' + (f.from || 'start') + '_to_' + (f.to || today()) + '.csv' };
}


// ── MONTHLY AUDIT REPORT (covers the just-completed calendar month) ──────────

function prevMonthPrefix_() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM");
}

function sendMonthlyAuditReport(e) { ownerOrTrigger_(e); timedJob_('sendMonthlyAuditReport', sendMonthlyAuditReport_); }
function sendMonthlyAuditReport_() {
  const prefix = prevMonthPrefix_();
  const { rows: loanReqs } = readSheet_(SH_LOAN_REQ, "requestid");
  const { rows: wdReqs }   = readSheet_(SH_WD_REQ, "requestid");
  const { rows: guarRows } = readSheet_(SH_GUARANTORS, "requestid");
  const { rows: audit }    = readSheet_(SH_AUDIT, "timestamp");
  const { rows: members }  = readSheet_(SH_MEMBERS, "memberno");
  const nameOf = {}; members.forEach(m => { nameOf[String(m["MemberNo"]||"").trim()] = m["Full Name"] || ""; });
  const name = no => nameOf[String(no||"").trim()] || no || "-";

  const gByReq = {};
  guarRows.forEach(g => { const id = String(g["RequestID"]||"").trim(); if (!id) return; (gByReq[id] = gByReq[id] || []).push(g); });

  const inMonth = r => String(r["Timestamp"]||"").indexOf(prefix) === 0;

  const loanRows = loanReqs.filter(r => String(r["RequestID"]||"").trim() !== "" && inMonth(r)).map(r => {
    const id = String(r["RequestID"]).trim();
    const g = gByReq[id] || [];
    const gText = x => x ? name(x["GuarantorNo"]) + ": " + (x["Response"]||"Pending") + (x["Responded At"] ? " (" + x["Responded At"] + ")" : "") : "-";
    return [id, name(r["MemberNo"]), name(r["Initiated By"]||r["MemberNo"]), String(r["Timestamp"]||""),
      gText(g[0]), gText(g[1]),
      r["Approver 1"] ? name(r["Approver 1"]) + " @ " + (r["Approver 1 At"]||"") : "-",
      r["Approver 2"] ? name(r["Approver 2"]) + " @ " + (r["Approver 2 At"]||"") : "-",
      r["Status"]||"", r["Decision Notes"]||""];
  });

  const wdRows = wdReqs.filter(r => String(r["RequestID"]||"").trim() !== "" && inMonth(r)).map(r => [
    String(r["RequestID"]), name(r["MemberNo"]), requestAccount_(r), fmtUGX(num(r["Amount (UGX)"])), name(r["Initiated By"]||r["MemberNo"]), String(r["Timestamp"]||""),
    r["Approver 1"] ? name(r["Approver 1"]) + " @ " + (r["Approver 1 At"]||"") : "-",
    r["Approver 2"] ? name(r["Approver 2"]) + " @ " + (r["Approver 2 At"]||"") : "-",
    r["Status"]||"", r["Decision Notes"]||""]);

  const auditRows = audit.filter(inMonth).map(r => [
    String(r["Timestamp"]||""), r["Action"]||"", name(r["Member (Affected)"]), name(r["Performed By"]), r["Details"]||"", r["Reference ID"]||""]);

  const title = SACCO_NAME + " Monthly Audit Report — " + prefix;
  const blob = brandedPdf_(title, "Audit report for " + prefix, body => {
    cards_(body, [["Loan decisions", String(loanRows.length)], ["Withdrawal decisions", String(wdRows.length)], ["Audit log entries", String(auditRows.length)]]);
    section_(body, "Loan Requests");
    table_(body, ["Request","Member","Initiated by","Created","Guarantor 1","Guarantor 2","Approver 1","Approver 2","Status","Notes"], loanRows, []);
    section_(body, "Withdrawal Requests");
    table_(body, ["Request","Member","Account","Amount","Initiated by","Created","Approver 1","Approver 2","Status","Notes"], wdRows, []);
    section_(body, "Full Audit Log");
    table_(body, ["Timestamp","Action","Member","Performed by","Details","Reference"], auditRows, []);
  });

  members.filter(m => String(m["Role"]||"").toLowerCase() === "admin" && m["Email"]).forEach(m => {
    try {
      MailApp.sendEmail({ to: m["Email"], name: SACCO_NAME, subject: "[" + SACCO_NAME + "] Monthly Audit Report — " + prefix,
        htmlBody: emailShell_("Monthly audit report", "<p style='margin:0 0 10px;'>Attached is the audit report for " + prefix + ", covering loan and withdrawal decisions and the full audit log.</p>"),
        attachments: [blob.copyBlob().setName(title + ".pdf")], inlineImages: { clubseal: logoBlob_() } });
    } catch (e) { Logger.log("Monthly audit report email failed for " + m["Email"] + ": " + e); }
  });
  auditLog_("Monthly Audit Report Sent", "", "System", "Report for " + prefix + " emailed to admins.", "");
}
