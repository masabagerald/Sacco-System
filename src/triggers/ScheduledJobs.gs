// ── SCHEDULED FUNCTIONS ───────────────────────────────────────────────────────

function sendMonthlyStatements(e) { ownerOrTrigger_(e);
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet_(SH_REPAY,'loanid');
  const { rows: fines }   = readSheet_(SH_FINES,'fineid');
  members.filter(m=>String(m['Status']||'').toLowerCase()==='active').forEach(m=>{
    const memberNo=String(m['MemberNo']).trim();
    const savings=savingsBalance_(memberNo);
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===memberNo).map(l=>computeLoan_(l,reps)).filter(l=>l.status==='Active');
    const outstanding=myLoans.reduce((s,l)=>s+l.outstandingBalance,0);
    const unpaid=fines.filter(f=>String(f['MemberNo']||'').trim()===memberNo&&String(f['Status']||'').toLowerCase()==='unpaid').reduce((s,f)=>s+num(f['Amount (UGX)']),0);
    sendEmail_(m['Email'],'Monthly Statement',[
      ['Savings Balance',fmtUGX(savings)],['Active Loans',String(myLoans.length)],
      ['Total Outstanding',fmtUGX(outstanding)],['Unpaid Surcharges',fmtUGX(unpaid)]
    ],'Here is your '+SACCO_NAME+' monthly summary as of '+human_date(today())+'.');
  });
}

// Runs a scheduled job at most once per day, so a retried or doubly-registered trigger does not
// send the same emails twice. The day is marked done only after the job finishes.
function oncePerDay_(jobName, fn) {
  const key = 'lastRun_' + jobName;
  if (Config.getScriptProp(key) === today()) { Logger.log(jobName + ' already ran today; skipped.'); return; }
  fn();
  Config.setScriptProp(key, today());
}

// Generic monthly/overdue nudge for older loan models (reducing-balance, Article 4 flat) which
// have no single due date. Member/Soft-Loan due-date logic lives in processLoanDueDates() below.
// Registered both monthly (25th) and daily, so it is guarded to run once per day.
function sendRepaymentReminders(e) { ownerOrTrigger_(e); oncePerDay_('sendRepaymentReminders', sendRepaymentReminders_); }

function sendRepaymentReminders_() {
  const { rows: members } = readSheet_(SH_MEMBERS,'memberno');
  const { rows: loans }   = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }    = readSheet_(SH_REPAY,'loanid');
  const dayOfMonth=new Date().getDate();
  const isReminderDay=dayOfMonth===25;
  const overdueNames=[], reminderNames=[];
  const hasDueDate = l => l.model==='member'||l.model==='term';
  members.filter(m=>String(m['Status']||'').toLowerCase()==='active').forEach(m=>{
    const memberNo=String(m['MemberNo']).trim();
    const myLoans=loans.filter(l=>String(l['MemberNo']||'').trim()===memberNo).map(l=>computeLoan_(l,reps)).filter(l=>l.status==='Active'&&!hasDueDate(l));
    if (!myLoans.length) return;
    const overdue=myLoans.filter(l=>l.overdue);
    if (overdue.length) {
      sendEmail_(m['Email'],'Overdue Loan Notice',overdue.map(l=>[l.loanId,fmtUGX(l.outstandingBalance)+' ('+l.progressLabel+')']),
        'You have overdue loans. Please contact the treasurer to arrange repayment.');
      overdueNames.push(m['Full Name']);
      overdue.forEach(l => notifyGuarantors_(l.loanId, { key: 'overdue|' + l.loanId, event: 'Loan overdue', amount: 0, date: today(),
        balance: l.outstandingBalance, message: "The borrower's loan is overdue." }));
    }
    if (isReminderDay) {
      const upcoming=myLoans.filter(l=>!l.overdue);
      if (upcoming.length) {
        sendEmail_(m['Email'],'Repayment Reminder',upcoming.map(l=>[l.loanId,'Outstanding: '+fmtUGX(l.outstandingBalance)+' | Suggested: '+fmtUGX(l.monthlyPayment)]),
          'Friendly reminder: your loan repayment is due. Please ensure payment before month-end.');
        reminderNames.push(m['Full Name']);
      }
    }
  });
  if (overdueNames.length||reminderNames.length)
    notifyAdmins_('Repayment Reminder Summary',[
      ['Overdue notices',String(overdueNames.length)],['Monthly reminders',String(reminderNames.length)],['Date',human_date(today())]
    ],'Reminders sent today.'+(overdueNames.length?' Overdue: '+overdueNames.join(', ')+'.':'')+(reminderNames.length?' Monthly: '+reminderNames.join(', ')+'.':''));
}

// Daily job for Founder/Delegate Member loans and Non-Member Soft Loans (single due date):
//  - 3 days before the due date: reminder
//  - on the due date: reminder
//  - the day after: apply the one-time 10% overdue surcharge (on principal+interest) and notify
//  - every day after that, up to 2 weeks: a plain overdue reminder
// The surcharge is applied at most once per loan -- computeSingleDue_ reads it back from the
// sheet rather than recalculating it. Each loan's "Last Notice" cell records the day it was last
// emailed, so re-running this job on the same day (a retry) sends nothing twice.
function processLoanDueDates(e) { ownerOrTrigger_(e);
  const { rows: loans } = readSheet_(SH_LOANS,'loanid');
  const { rows: reps }  = readSheet_(SH_REPAY,'loanid');
  const { sh: loanSh, headers } = readSheet_(SH_LOANS,'loanid');
  if (ci(headers,'overdue surcharge') < 0) { Logger.log('Loans sheet has no "Overdue Surcharge (UGX)" column; run setupGuaranteeSchema().'); return; }
  const cNotice = ci(headers,'last notice');
  if (cNotice < 0) Logger.log('Loans sheet has no "Last Notice" column; run setupGuaranteeSchema() so retried runs cannot send duplicate notices.');
  const todayStr = today();
  const noticedToday = l => cNotice > -1 && String(l['Last Notice']||'').trim() === todayStr;
  const markNoticed = l => { if (cNotice > -1) loanSh.getRange(l._row, cNotice + 1).setValue(todayStr); };
  const todayYmd = ymd_(today());
  const dueSoon=[], dueToday=[], surcharged=[], stillOverdue=[];

  loans.filter(l => String(l['LoanID']||'').trim()!=='' && (isMemberLoan_(l) || isTerm_(l))).forEach(l => {
    const c = computeLoan_(l, reps);
    if (c.status !== LOAN_STATUS.ACTIVE) return;
    if (noticedToday(l)) return;
    const m = memberByNo_(c.memberNo);
    if (!m || !m['Email']) return;
    const due = ymd_(c.dueDate);
    const daysUntilDue = Math.round((due - todayYmd) / 86400000);

    if (daysUntilDue === OVERDUE_REMINDER_DAYS_BEFORE) {
      sendEmail_(m['Email'],'Loan Due Soon: '+c.loanId,[['Loan ID',c.loanId],['Due date',human_date(c.dueDate)],['Outstanding',fmtUGX(c.outstandingBalance)]],
        'Your loan is due in '+OVERDUE_REMINDER_DAYS_BEFORE+' days. Please arrange repayment to avoid the automatic overdue surcharge.');
      markNoticed(l);
      dueSoon.push(m['Full Name']);
    } else if (daysUntilDue === 0) {
      sendEmail_(m['Email'],'Loan Due Today: '+c.loanId,[['Loan ID',c.loanId],['Outstanding',fmtUGX(c.outstandingBalance)]],
        'Your loan is due today. A 10% surcharge on the loan and interest applies automatically from tomorrow if it remains unpaid.');
      markNoticed(l);
      dueToday.push(m['Full Name']);
    } else if (daysUntilDue < 0) {
      const daysPastDue = -daysUntilDue;
      const alreadyApplied = num(l['Overdue Surcharge (UGX)']) > 0;
      if (!alreadyApplied) {
        const principal = num(l['Principal (UGX)']);
        const rate = num(l['Interest Rate (%)']) ? num(l['Interest Rate (%)']) / 100 : (c.monthlyRate / 100);
        const interest = r2(principal * rate);
        const surcharge = r2((principal + interest) * OVERDUE_SURCHARGE_RATE);
        setLoanOverdueSurcharge_(c.loanId, surcharge);
        auditLog_('Overdue Surcharge Applied', c.memberNo, 'System',
          'UGX '+fmtUGX(surcharge)+' (10% of loan + interest) applied automatically -- overdue since '+human_date(c.dueDate)+'.', c.loanId);
        sendEmail_(m['Email'],'Loan Overdue: '+c.loanId,[
          ['Loan ID',c.loanId],['Overdue surcharge (10%)',fmtUGX(surcharge)],
          ['New total outstanding',fmtUGX(r2(c.outstandingBalance + surcharge))]
        ],'Your loan is now overdue. A 10% surcharge on the loan and interest has been applied automatically. Please contact the treasurer to arrange repayment.');
        markNoticed(l);
        surcharged.push(m['Full Name']);
        notifyGuarantors_(c.loanId, { key: 'overdue|' + c.loanId, event: 'Loan overdue: surcharge charged', amount: surcharge, date: today(),
          balance: r2(c.outstandingBalance + surcharge),
          message: 'The borrower has missed the due date. A 10% overdue surcharge has been charged on the loan and interest.' });
      } else if (daysPastDue <= OVERDUE_MAX_DAILY_NOTICE_DAYS) {
        sendEmail_(m['Email'],'Overdue Loan Reminder: '+c.loanId,[['Loan ID',c.loanId],['Days overdue',String(daysPastDue)],['Outstanding',fmtUGX(c.outstandingBalance)]],
          'Your loan remains overdue. Please contact the treasurer to arrange repayment.');
        markNoticed(l);
        stillOverdue.push(m['Full Name']);
      }
      // Beyond OVERDUE_MAX_DAILY_NOTICE_DAYS: no more automatic daily notices (the debt and the
      // surcharge remain on the loan; the committee follows up directly).
    }
  });

  if (dueSoon.length||dueToday.length||surcharged.length||stillOverdue.length)
    notifyAdmins_('Loan Due-Date Summary',[
      ['Due in 3 days',String(dueSoon.length)],['Due today',String(dueToday.length)],
      ['Surcharge applied today',String(surcharged.length)],['Still-overdue reminders',String(stillOverdue.length)],
      ['Date',human_date(today())]
    ],'Automatic loan due-date processing ran today.');
}

function backupSpreadsheet(e) { ownerOrTrigger_(e);
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
  notifyAdmins_('Weekly Backup Complete',[
    ['File',fileName],['Folder',folderName+' (Google Drive)'],
    ['Date',human_date(today())],['Backups kept',String(Math.min(files.length,8))]
  ],'Your '+SACCO_NAME+' spreadsheet has been automatically backed up to Google Drive.');
  auditLog_('Backup Created', '', 'System', 'Weekly backup: '+fileName, folderName);
}

// Daily: one email per person with everything waiting for their approval, review or consent (ReminderService.gs)
function sendPendingActionReminders(e) { ownerOrTrigger_(e); oncePerDay_('sendPendingActionReminders', () => sendPendingActionReminders_(Date.now())); }

// The scheduled jobs: [function, schedule]. A function may appear more than once.
const SCHEDULED_JOBS = [
  ['sendMonthlyStatements', t => t.timeBased().onMonthDay(1).atHour(7)],
  ['sendMonthlyAuditReport', t => t.timeBased().onMonthDay(1).atHour(5)],
  ['sendRepaymentReminders', t => t.timeBased().onMonthDay(25).atHour(8)],
  ['sendRepaymentReminders', t => t.timeBased().everyDays(1).atHour(9)],
  ['processLoanDueDates', t => t.timeBased().everyDays(1).atHour(7)],
  ['sendPendingActionReminders', t => t.timeBased().everyDays(1).atHour(8)],
  ['backupSpreadsheet', t => t.timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6)]
];

// Creates all time-driven triggers in one go -- run from Apps Script (safe to re-run: the existing
// ones are removed first, so there are never duplicates)
function createAllTriggers(e) { ownerOrTrigger_(e);
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  SCHEDULED_JOBS.forEach(([fn, schedule]) => schedule(ScriptApp.newTrigger(fn)).create());
  Logger.log('All triggers created successfully.');
}

// Adds the jobs that have no trigger yet, leaving existing ones alone (used by setup, so a release that
// adds a job schedules it on clubs that are already live). Returns the functions scheduled.
function ensureScheduledJobs_() {
  const have = {};
  ScriptApp.getProjectTriggers().forEach(t => { have[t.getHandlerFunction()] = true; });
  const added = [];
  SCHEDULED_JOBS.forEach(([fn, schedule]) => {
    if (have[fn]) return;
    schedule(ScriptApp.newTrigger(fn)).create();
    if (added.indexOf(fn) < 0) added.push(fn);
  });
  return added;
}
