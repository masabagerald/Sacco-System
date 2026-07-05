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

function generateMemberStatementDoc() {
  const auth = _caller(); if (!auth.ok) return auth;
  const data = getMemberStatementData(); if (!data.ok) return data;
  const m = data.member;
  const title = SACCO_NAME + ' Statement — ' + m.name + ' — ' + data.generatedOn;
  const doc  = DocumentApp.create(title);
  const body = doc.getBody();
  body.appendParagraph(SACCO_NAME).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Member Statement').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendTable([['Member Name',m.name],['Member No.',m.memberNo],['Email',m.email],['Generated On',data.generatedOn]]);
  body.appendParagraph('Savings Summary').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Balance: ' + fmtUGX(data.savingsBalance));
  if (data.savingsHistory.length) {
    body.appendParagraph('Transaction History').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendTable([['Date','Type','Reference','Amount (UGX)']].concat(
      data.savingsHistory.map(r=>[r.date,r.type,r.reference||'',fmtUGX(r.amount)])));
  }
  if (data.loans.length) {
    body.appendParagraph('Loans').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    data.loans.forEach(l=>{
      body.appendParagraph(l.loanId+' — '+l.status).setHeading(DocumentApp.ParagraphHeading.HEADING3);
      body.appendTable([['Principal',fmtUGX(l.principal)],['Monthly Rate',l.monthlyRate+'%'],
        ['Term',l.term+' months'],['Outstanding',fmtUGX(l.outstandingBalance)],['Total Repaid',fmtUGX(l.totalRepaid)]]);
      if (l.schedule?.length) {
        body.appendParagraph('Projected Schedule');
        body.appendTable([['Month','Opening','Interest','Payment','Closing']].concat(
          l.schedule.map(s=>[String(s.month),fmtUGX(s.opening),fmtUGX(s.interest),fmtUGX(s.payment),fmtUGX(s.closing)])));
      }
    });
  }
  if (data.fines.length) {
    body.appendParagraph('Fines').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendTable([['Date','Reason','Amount','Status']].concat(data.fines.map(f=>[f.date,f.reason,fmtUGX(f.amount),f.status])));
    body.appendParagraph('Total Unpaid: ' + fmtUGX(data.unpaidFinesTotal));
  }
  doc.saveAndClose();
  const pdfBlob = DriveApp.getFileById(doc.getId()).getAs('application/pdf');
  let folder;
  const fi=DriveApp.getFoldersByName(SACCO_NAME+' Statements');
  folder = fi.hasNext() ? fi.next() : DriveApp.createFolder(SACCO_NAME+' Statements');
  const pdfFile = folder.createFile(pdfBlob).setName(title+'.pdf');
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  const id = pdfFile.getId();
  auditLog('Statement Generated', m.memberNo, m.memberNo, 'PDF statement generated.', id);
  return { ok:true, pdfUrl:'https://drive.google.com/file/d/'+id+'/view', downloadUrl:'https://drive.google.com/uc?export=download&id='+id, fileName:title+'.pdf' };
}

function exportAdminCSV() {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const { rows: savings } = readSheet(SH_SAVINGS,'memberno');
  const { rows: fines }   = readSheet(SH_FINES,'fineid');
  const lines = [];
  lines.push('KIRA SACCO — LEDGER EXPORT — '+today());
  lines.push('');
  lines.push('MEMBERS');
  lines.push(['MemberNo','Name','Email','Role','Status','Savings (UGX)','Active Loans','Outstanding (UGX)','Unpaid Fines (UGX)'].join(','));
  members.filter(m=>String(m['MemberNo']||'').trim()!=='').forEach(m=>{
    const bal=_savingsBalance(m['MemberNo']);
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===String(m['MemberNo']).trim()).map(l=>_computeLoan(l,reps)).filter(l=>l.status==='Active');
    const out=myLoans.reduce((s,l)=>s+l.outstandingBalance,0);
    const unpaid=fines.filter(f=>String(f['MemberNo']||'').trim()===String(m['MemberNo']).trim()&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
    lines.push([csvQ(m['MemberNo']),csvQ(m['Full Name']),csvQ(m['Email']),csvQ(m['Role']),csvQ(m['Status']),Math.round(bal),myLoans.length,Math.round(out),Math.round(unpaid)].join(','));
  });
  lines.push(''); lines.push('SAVINGS TRANSACTIONS');
  lines.push(['Date','MemberNo','Type','Amount (UGX)','Reference','Recorded By'].join(','));
  savings.forEach(r=>lines.push([csvQ(r['Date']),csvQ(r['MemberNo']),csvQ(r['Type']),Math.round(num(r['Amount (UGX)'])),csvQ(r['Reference']||''),csvQ(r['Recorded By']||'')].join(',')));
  lines.push(''); lines.push('LOANS');
  lines.push(['LoanID','MemberNo','Date Issued','Principal','Rate %','Term','Outstanding (UGX)','Status'].join(','));
  loans.filter(l=>String(l['LoanID']||'').trim()!=='').forEach(l=>{
    const c=_computeLoan(l,reps);
    lines.push([csvQ(l['LoanID']),csvQ(l['MemberNo']),csvQ(l['Date Issued']),Math.round(num(l['Principal (UGX)'])),num(l['Monthly Rate (%)']),num(l['Term (months)']),Math.round(c.outstandingBalance),csvQ(c.status)].join(','));
  });
  lines.push(''); lines.push('Generated by: '+auth.member.name+' on '+today());
  auditLog('Admin CSV Export', '', auth.member.memberNo, 'Full ledger exported to CSV.', '');
  return { ok:true, csv: lines.join('\n') };
}
