// ── SCHEDULED FUNCTIONS ───────────────────────────────────────────────────────

function sendMonthlyStatements() {
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const { rows: fines }   = readSheet(SH_FINES,'fineid');
  members.filter(m=>String(m['Status']||'').toLowerCase()==='active').forEach(m=>{
    const memberNo=String(m['MemberNo']).trim();
    const savings=_savingsBalance(memberNo);
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===memberNo).map(l=>_computeLoan(l,reps)).filter(l=>l.status==='Active');
    const outstanding=myLoans.reduce((s,l)=>s+l.outstandingBalance,0);
    const unpaid=fines.filter(f=>String(f['MemberNo']||'').trim()===memberNo&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
    _sendEmail(m['Email'],'Monthly Statement',[
      ['Savings Balance',fmtUGX(savings)],['Active Loans',String(myLoans.length)],
      ['Total Outstanding',fmtUGX(outstanding)],['Unpaid Fines',fmtUGX(unpaid)]
    ],'Here is your '+SACCO_NAME+' monthly summary as of '+today()+'.');
  });
}

function sendRepaymentReminders() {
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const dayOfMonth=new Date().getDate();
  const isReminderDay=dayOfMonth===25;
  const overdueNames=[], reminderNames=[];
  members.filter(m=>String(m['Status']||'').toLowerCase()==='active').forEach(m=>{
    const memberNo=String(m['MemberNo']).trim();
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===memberNo).map(l=>_computeLoan(l,reps)).filter(l=>l.status==='Active');
    if (!myLoans.length) return;
    const overdue=myLoans.filter(l=>l.overdue);
    if (overdue.length) {
      _sendEmail(m['Email'],'Overdue Loan Notice',overdue.map(l=>[l.loanId,fmtUGX(l.outstandingBalance)+' ('+l.monthsElapsed+'/'+l.term+' months)']),
        'You have overdue loans. Please contact the treasurer to arrange repayment.');
      overdueNames.push(m['Full Name']);
    }
    if (isReminderDay) {
      const upcoming=myLoans.filter(l=>!l.overdue);
      if (upcoming.length) {
        _sendEmail(m['Email'],'Repayment Reminder',upcoming.map(l=>[l.loanId,'Outstanding: '+fmtUGX(l.outstandingBalance)+' | Suggested: '+fmtUGX(l.monthlyPayment)]),
          'Friendly reminder: your loan repayment is due. Please ensure payment before month-end.');
        reminderNames.push(m['Full Name']);
      }
    }
  });
  if (overdueNames.length||reminderNames.length)
    _notifyAdmins('Repayment Reminder Summary',[
      ['Overdue notices',String(overdueNames.length)],['Monthly reminders',String(reminderNames.length)],['Date',today()]
    ],'Reminders sent today.'+(overdueNames.length?' Overdue: '+overdueNames.join(', ')+'.':'')+(reminderNames.length?' Monthly: '+reminderNames.join(', ')+'.':''));
}

function backupSpreadsheet() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const folderName=SACCO_NAME+' Backups';
  const fileName=SACCO_NAME+' Backup '+today();
  let folder; const fi=DriveApp.getFoldersByName(folderName);
  folder = fi.hasNext() ? fi.next() : DriveApp.createFolder(folderName);
  DriveApp.getFileById(ss.getId()).makeCopy(fileName, folder);
  const files=[]; const iter=folder.getFiles();
  while(iter.hasNext()){const f=iter.next();files.push({id:f.getId(),date:f.getDateCreated()});}
  files.sort((a,b)=>b.date-a.date);
  if(files.length>8) files.slice(8).forEach(f=>{try{DriveApp.getFileById(f.id).setTrashed(true);}catch(e){}});
  _notifyAdmins('Weekly Backup Complete',[
    ['File',fileName],['Folder',folderName+' (Google Drive)'],
    ['Date',today()],['Backups kept',String(Math.min(files.length,8))]
  ],'Your '+SACCO_NAME+' spreadsheet has been automatically backed up to Google Drive.');
  auditLog('Backup Created', '', 'System', 'Weekly backup: '+fileName, folderName);
}

// Creates all four time-driven triggers in one go — run once from Apps Script
function createAllTriggers() {
  // Remove existing to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendMonthlyStatements').timeBased().onMonthDay(1).atHour(7).create();
  ScriptApp.newTrigger('sendRepaymentReminders').timeBased().onMonthDay(25).atHour(8).create();
  ScriptApp.newTrigger('sendRepaymentReminders').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('backupSpreadsheet').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  Logger.log('All triggers created successfully.');
}
