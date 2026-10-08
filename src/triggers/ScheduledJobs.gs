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
      ['Total Outstanding',fmtUGX(outstanding)],['Unpaid Surcharges',fmtUGX(unpaid)]
    ],'Here is your '+SACCO_NAME+' monthly summary as of '+human_date(today())+'.');
  });
}

// Generic monthly/overdue nudge for older loan models (reducing-balance, Article 4 flat) which
// have no single due date. Member/Soft-Loan due-date logic lives in processLoanDueDates() below.
function sendRepaymentReminders() {
  const { rows: members } = readSheet(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet(SH_REPAY,'loanid');
  const dayOfMonth=new Date().getDate();
  const isReminderDay=dayOfMonth===25;
  const overdueNames=[], reminderNames=[];
  const hasDueDate = l => l.model==='member'||l.model==='term';
  members.filter(m=>String(m['Status']||'').toLowerCase()==='active').forEach(m=>{
    const memberNo=String(m['MemberNo']).trim();
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===memberNo).map(l=>_computeLoan(l,reps)).filter(l=>l.status==='Active'&&!hasDueDate(l));
    if (!myLoans.length) return;
    const overdue=myLoans.filter(l=>l.overdue);
    if (overdue.length) {
      _sendEmail(m['Email'],'Overdue Loan Notice',overdue.map(l=>[l.loanId,fmtUGX(l.outstandingBalance)+' ('+l.progressLabel+')']),
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
      ['Overdue notices',String(overdueNames.length)],['Monthly reminders',String(reminderNames.length)],['Date',human_date(today())]
    ],'Reminders sent today.'+(overdueNames.length?' Overdue: '+overdueNames.join(', ')+'.':'')+(reminderNames.length?' Monthly: '+reminderNames.join(', ')+'.':''));
}

// Daily job for Founder/Delegate Member loans and Non-Member Soft Loans (single due date):
//  - 3 days before the due date: reminder
//  - on the due date: reminder
//  - the day after: apply the one-time 10% overdue surcharge (on principal+interest) and notify
//  - every day after that, up to 2 weeks: a plain overdue reminder
// The surcharge is applied at most once per loan -- _computeSingleDue reads it back from the
// sheet rather than recalculating it, so re-running this job is always safe.
function processLoanDueDates() {
  const { rows: loans } = readSheet(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet(SH_REPAY,'loanid');
  const { headers } = readSheet(SH_LOANS,'loanid');
  if (ci(headers,'overdue surcharge') < 0) { Logger.log('Loans sheet has no "Overdue Surcharge (UGX)" column; run setupGuaranteeSchema().'); return; }
  const todayYmd = _ymd(today());
  const dueSoon=[], dueToday=[], surcharged=[], stillOverdue=[];

  loans.filter(l => String(l['LoanID']||'').trim()!=='' && (_isMemberLoan(l) || _isTerm(l))).forEach(l => {
    const c = _computeLoan(l, reps);
    if (c.status !== LOAN_STATUS.ACTIVE) return;
    const m = _memberByNo(c.memberNo);
    if (!m || !m['Email']) return;
    const due = _ymd(c.dueDate);
    const daysUntilDue = Math.round((due - todayYmd) / 86400000);

    if (daysUntilDue === OVERDUE_REMINDER_DAYS_BEFORE) {
      _sendEmail(m['Email'],'Loan Due Soon: '+c.loanId,[['Loan ID',c.loanId],['Due date',human_date(c.dueDate)],['Outstanding',fmtUGX(c.outstandingBalance)]],
        'Your loan is due in '+OVERDUE_REMINDER_DAYS_BEFORE+' days. Please arrange repayment to avoid the automatic overdue surcharge.');
      dueSoon.push(m['Full Name']);
    } else if (daysUntilDue === 0) {
      _sendEmail(m['Email'],'Loan Due Today: '+c.loanId,[['Loan ID',c.loanId],['Outstanding',fmtUGX(c.outstandingBalance)]],
        'Your loan is due today. A 10% surcharge on the loan and interest applies automatically from tomorrow if it remains unpaid.');
      dueToday.push(m['Full Name']);
    } else if (daysUntilDue < 0) {
      const daysPastDue = -daysUntilDue;
      const alreadyApplied = num(l['Overdue Surcharge (UGX)']) > 0;
      if (!alreadyApplied) {
        const principal = num(l['Principal (UGX)']);
        const rate = num(l['Interest Rate (%)']) ? num(l['Interest Rate (%)']) / 100 : (c.monthlyRate / 100);
        const interest = r2(principal * rate);
        const surcharge = r2((principal + interest) * OVERDUE_SURCHARGE_RATE);
        _setLoanOverdueSurcharge(c.loanId, surcharge);
        auditLog('Overdue Surcharge Applied', c.memberNo, 'System',
          'UGX '+fmtUGX(surcharge)+' (10% of loan + interest) applied automatically -- overdue since '+human_date(c.dueDate)+'.', c.loanId);
        _sendEmail(m['Email'],'Loan Overdue: '+c.loanId,[
          ['Loan ID',c.loanId],['Overdue surcharge (10%)',fmtUGX(surcharge)],
          ['New total outstanding',fmtUGX(r2(c.outstandingBalance + surcharge))]
        ],'Your loan is now overdue. A 10% surcharge on the loan and interest has been applied automatically. Please contact the treasurer to arrange repayment.');
        surcharged.push(m['Full Name']);
      } else if (daysPastDue <= OVERDUE_MAX_DAILY_NOTICE_DAYS) {
        _sendEmail(m['Email'],'Overdue Loan Reminder: '+c.loanId,[['Loan ID',c.loanId],['Days overdue',String(daysPastDue)],['Outstanding',fmtUGX(c.outstandingBalance)]],
          'Your loan remains overdue. Please contact the treasurer to arrange repayment.');
        stillOverdue.push(m['Full Name']);
      }
      // Beyond OVERDUE_MAX_DAILY_NOTICE_DAYS: no more automatic daily notices (the debt and the
      // surcharge remain on the loan; the committee follows up directly).
    }
  });

  if (dueSoon.length||dueToday.length||surcharged.length||stillOverdue.length)
    _notifyAdmins('Loan Due-Date Summary',[
      ['Due in 3 days',String(dueSoon.length)],['Due today',String(dueToday.length)],
      ['Surcharge applied today',String(surcharged.length)],['Still-overdue reminders',String(stillOverdue.length)],
      ['Date',human_date(today())]
    ],'Automatic loan due-date processing ran today.');
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
    ['Date',human_date(today())],['Backups kept',String(Math.min(files.length,8))]
  ],'Your '+SACCO_NAME+' spreadsheet has been automatically backed up to Google Drive.');
  auditLog('Backup Created', '', 'System', 'Weekly backup: '+fileName, folderName);
}

// Creates all time-driven triggers in one go — run once from Apps Script (safe to re-run)
function createAllTriggers() {
  // Remove existing to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendMonthlyStatements').timeBased().onMonthDay(1).atHour(7).create();
  ScriptApp.newTrigger('sendMonthlyAuditReport').timeBased().onMonthDay(1).atHour(5).create();
  ScriptApp.newTrigger('sendRepaymentReminders').timeBased().onMonthDay(25).atHour(8).create();
  ScriptApp.newTrigger('sendRepaymentReminders').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('processLoanDueDates').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('backupSpreadsheet').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  Logger.log('All triggers created successfully.');
}
