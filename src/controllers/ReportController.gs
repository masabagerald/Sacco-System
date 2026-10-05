// ── REPORTS & EXPORTS ─────────────────────────────────────────────────────────

function getMemberStatementData() {
  const auth = _caller(); if (!auth.ok) return auth;
  const savings  = getMySavings();
  const loans    = getMyLoans();
  const fines    = getMyFines();
  const loanReqs = getMyLoanRequests();
  const wdReqs   = getMyWithdrawalRequests();
  return { ok:true, generatedOn:today(), member:auth.member,
    savingsBalance:savings.ok?savings.balance:0, savingsHistory:savings.ok?savings.history:[],
    loans:loans.ok?loans.loans:[], fines:fines.ok?fines.fines:[], unpaidFinesTotal:fines.ok?fines.unpaidTotal:0,
    loanRequests:loanReqs.ok?loanReqs.requests:[], withdrawalRequests:wdReqs.ok?wdReqs.requests:[] };
}

// Body of a member statement (uses the shared layout in Branding.gs)
function _statementBody(body, data) {
  const m = data.member;
  const activeOut = data.loans.filter(l => l.status === 'Active').reduce((s,l) => s + l.outstandingBalance, 0);
  _cards(body, [
    ['Savings balance', fmtUGX(data.savingsBalance)],
    ['Outstanding loans', fmtUGX(activeOut)],
    ['Unpaid surcharges', fmtUGX(data.unpaidFinesTotal)]
  ]);

  _section(body, 'Member details');
  _kv(body, [['Name', m.name], ['Member no.', m.memberNo], ['Email', m.email], ['Generated on', human_date(data.generatedOn)]]);

  _section(body, 'Savings transactions');
  _table(body, ['Date','Type','Category','Reference','Amount (UGX)'],
    data.savingsHistory.map(r => [human_date(r.date), String(r.type), r.category || '-', r.reference || '', fmtUGX(r.amount)]), [4]);

  if (data.loans.length) {
    _section(body, 'Loans');
    data.loans.forEach(l => {
      const p = body.appendParagraph(l.loanId + '  —  ' + l.status);
      p.setSpacingBefore(8); p.setSpacingAfter(3);
      p.editAsText().setBold(true).setFontSize(10.5).setForegroundColor(BRAND_INK);
      const rows = [['Principal', fmtUGX(l.principal)], ['Interest', l.rateLabel], ['Term', l.termLabel]];
      if (l.dueDate) rows.push(['Due date', human_date(l.dueDate)]);
      rows.push(['Total due', fmtUGX(l.totalDue || l.principal)], ['Total repaid', fmtUGX(l.totalRepaid)], ['Outstanding', fmtUGX(l.outstandingBalance)]);
      _kv(body, rows);
      if (l.schedule && l.schedule.length) {
        const isReducing = l.model === 'reducing';
        const head = l.scheduleHead || ['Month','Opening','Interest','Payment','Closing'];
        const srows = isReducing
          ? l.schedule.map(s => [String(s.month), fmtUGX(s.opening), fmtUGX(s.interest), fmtUGX(s.payment), fmtUGX(s.closing)])
          : l.schedule.map(s => [s.label, human_date(s.due), fmtUGX(s.amount), fmtUGX(s.balance)]);
        body.appendParagraph('').setSpacingAfter(2);
        _table(body, head, srows, isReducing ? [1,2,3,4] : [2,3]);
      }
    });
  }

  if (data.fines.length) {
    _section(body, 'Surcharges');
    _table(body, ['Date','Reason','Amount (UGX)','Status'],
      data.fines.map(f => [human_date(f.date || ''), f.reason || '', fmtUGX(f.amount), f.status || '']), [2]);
    const tot = body.appendParagraph('Total unpaid: ' + fmtUGX(data.unpaidFinesTotal));
    tot.setSpacingBefore(6);
    tot.editAsText().setBold(true).setForegroundColor(BRAND_COLOR);
  }
}

function generateMemberStatementDoc() {
  const auth = _caller(); if (!auth.ok) return auth;
  const data = getMemberStatementData(); if (!data.ok) return data;
  const m = data.member;
  const title = SACCO_NAME + ' Statement — ' + m.name + ' — ' + data.generatedOn;
  const blob = _brandedPdf(title, 'Member statement', body => _statementBody(body, data));
  let folder;
  const fi=DriveApp.getFoldersByName(SACCO_NAME+' Statements');
  folder = fi.hasNext() ? fi.next() : DriveApp.createFolder(SACCO_NAME+' Statements');
  const pdfFile = folder.createFile(blob).setName(title+'.pdf');
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = pdfFile.getId();
  auditLog('Statement Generated', m.memberNo, m.memberNo, 'PDF statement generated.', id);
  return { ok:true, pdfUrl:'https://drive.google.com/file/d/'+id+'/view', downloadUrl:'https://drive.google.com/uc?export=download&id='+id, fileName:title+'.pdf' };
}

// Admin ledger as a branded PDF. Returned as base64 and downloaded in the browser (not shared by link).
function generateAdminReportPdf() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const { rows: savings } = readSheet(SH_SAVINGS,'memberno');
  const { rows: fines }   = readSheet(SH_FINES,'fineid');

  const memberRows = members.filter(m => String(m['MemberNo']||'').trim() !== '').map(m => {
    const no = String(m['MemberNo']).trim();
    const bal = _savingsBalance(no);
    const myLoans = loans.filter(l => String(l['MemberNo']||'').trim() === no).map(l => _computeLoan(l, reps)).filter(l => l.status === 'Active');
    const out = myLoans.reduce((s,l) => s + l.outstandingBalance, 0);
    const unpaid = fines.filter(f => String(f['MemberNo']||'').trim() === no && String(f['Status']||'').toLowerCase() === 'unpaid').reduce((s,f) => s + num(f['Amount (UGX)']), 0);
    return { no, name: m['Full Name']||'', role: m['Role']||'', status: m['Status']||'', bal, activeCount: myLoans.length, out, unpaid };
  });
  const loanRows = loans.filter(l => String(l['LoanID']||'').trim() !== '').map(l => ({ l, c: _computeLoan(l, reps) }));
  const savingRows = savings.filter(r => String(r['MemberNo']||'').trim() !== '');
  const fineRows = fines.filter(f => String(f['FineID']||'').trim() !== '');

  const totalSavings = memberRows.reduce((s,m) => s + m.bal, 0);
  const totalOut = memberRows.reduce((s,m) => s + m.out, 0);
  const totalUnpaid = memberRows.reduce((s,m) => s + m.unpaid, 0);
  const activeLoans = loanRows.filter(x => x.c.status === 'Active').length;

  const title = SACCO_NAME + ' Ledger Report — ' + human_date(today());
  const blob = _brandedPdf(title, 'Ledger report  |  ' + human_date(today()), body => {
    _cards(body, [
      ['Members', String(memberRows.length)],
      ['Active loans', String(activeLoans)],
      ['Total savings', fmtUGX(totalSavings)],
      ['Outstanding loans', fmtUGX(totalOut)],
      ['Unpaid surcharges', fmtUGX(totalUnpaid)]
    ]);

    _section(body, 'Members');
    _table(body, ['Member no.','Name','Role','Status','Savings (UGX)','Active loans','Outstanding (UGX)','Unpaid surcharges (UGX)'],
      memberRows.map(m => [m.no, m.name, m.role, m.status, fmtUGX(m.bal), String(m.activeCount), fmtUGX(m.out), fmtUGX(m.unpaid)]),
      [4,5,6,7]);

    _section(body, 'Loans');
    _table(body, ['Loan ID','Member','Issued','Principal','Interest','Total due','Due date','Outstanding','Status'],
      loanRows.map(x => {
        const c = x.c;
        const interest = c.interest || c.totalInterestAccrued || 0;
        const totalDue = c.totalDue || r2(c.principal + interest);
        return [c.loanId, c.memberNo, human_date(c.dateIssued||''), fmtUGX(c.principal), fmtUGX(interest), fmtUGX(totalDue), human_date(c.dueDate||''), fmtUGX(c.outstandingBalance), c.status];
      }),
      [3,4,5,7]);

    _section(body, 'Savings transactions');
    _table(body, ['Date','Member no.','Type','Category','Amount (UGX)','Reference'],
      savingRows.map(r => [human_date(r['Date']||''), String(r['MemberNo']||''), String(_pick(r,['Deposit Type','Type'])), String(r['Payment Category']||'-'), fmtUGX(num(r['Amount (UGX)'])), String(r['Reference']||'')]),
      [4]);

    _section(body, 'Surcharges');
    _table(body, ['Surcharge ID','Member no.','Date','Amount (UGX)','Status'],
      fineRows.map(f => [String(f['FineID']||''), String(f['MemberNo']||''), human_date(_pick(f,['Date','Date of Payment'])), fmtUGX(num(f['Amount (UGX)'])), String(f['Status']||'')]),
      [3]);
  });

  auditLog('Admin Report Export', '', auth.member.memberNo, 'Ledger PDF report downloaded.', '');
  return { ok:true, fileName: 'MbaleSOCI_Ledger_Report_' + today() + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
}

function exportAdminCSV() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const { rows: savings } = readSheet(SH_SAVINGS,'memberno');
  const { rows: fines }   = readSheet(SH_FINES,'fineid');
  const lines = [];
  lines.push('MBALE SCHOOL OF CLINICAL OFFICERS INVESTMENT CLUB — LEDGER EXPORT — '+human_date(today()));
  lines.push('');
  lines.push('MEMBERS');
  lines.push(['MemberNo','Name','Email','Role','Status','Savings (UGX)','Active Loans','Outstanding (UGX)','Unpaid Surcharges (UGX)'].join(','));
  members.filter(m=>String(m['MemberNo']||'').trim()!=='').forEach(m=>{
    const bal=_savingsBalance(m['MemberNo']);
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===String(m['MemberNo']).trim()).map(l=>_computeLoan(l,reps)).filter(l=>l.status==='Active');
    const out=myLoans.reduce((s,l)=>s+l.outstandingBalance,0);
    const unpaid=fines.filter(f=>String(f['MemberNo']||'').trim()===String(m['MemberNo']).trim()&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
    lines.push([csvQ(m['MemberNo']),csvQ(m['Full Name']),csvQ(m['Email']),csvQ(m['Role']),csvQ(m['Status']),Math.round(bal),myLoans.length,Math.round(out),Math.round(unpaid)].join(','));
  });
  lines.push(''); lines.push('SAVINGS TRANSACTIONS');
  lines.push(['Date','MemberNo','Type','Category','Amount (UGX)','Reference','Recorded By'].join(','));
  savings.forEach(r=>lines.push([csvQ(r['Date']),csvQ(r['MemberNo']),csvQ(_pick(r,['Deposit Type','Type'])),csvQ(r['Payment Category']||''),Math.round(num(r['Amount (UGX)'])),csvQ(r['Reference']||''),csvQ(r['Recorded By']||'')].join(',')));
  lines.push(''); lines.push('LOANS');
  lines.push(['LoanID','MemberNo','Date Issued','Principal','Rate %','Term','Outstanding (UGX)','Status'].join(','));
  loans.filter(l=>String(l['LoanID']||'').trim()!=='').forEach(l=>{
    const c=_computeLoan(l,reps);
    lines.push([csvQ(l['LoanID']),csvQ(l['MemberNo']),csvQ(l['Date Issued']),Math.round(num(l['Principal (UGX)'])),num(_pick(l,['Monthly Rate (%)','Weekly Rate (%)'])),num(l['Term (months)']),Math.round(c.outstandingBalance),csvQ(c.status)].join(','));
  });
  lines.push(''); lines.push('Generated by: '+auth.member.name+' on '+human_date(today()));
  auditLog('Admin CSV Export', '', auth.member.memberNo, 'Full ledger exported to CSV.', '');
  return { ok:true, csv: lines.join('\n') };
}
