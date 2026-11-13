// ── CAPACITY WATCH ────────────────────────────────────────────────────────────
// Warns the admins before the club outgrows the system (limits in CAPACITY, Config.gs).
//
// Every day checkCapacity (ScheduledJobs.gs) measures, without reading whole tabs:
//   - active members                 against CAPACITY.activeMembers
//   - savings rows in the live sheet against CAPACITY.liveSavingsRows
//   - cells in the spreadsheet       against Google's 10-million-cell limit
//   - members against the hosting account's daily email quota (the monthly summaries go out on one day)
//   - emails that failed to send     (sendHtmlEmailNow_ counts them; they are otherwise silent)
//   - page requests slower than CAPACITY.slowCallMs (rpc times every request)
//   - scheduled-job run time         against Google's 6-minute limit, and jobs that were cut off
// Each is rated OK / Warning / Critical. The result is kept in script properties for the admin dashboard
// banner. The admins are emailed when the status gets worse, and reminded every CAPACITY.remindEveryDays
// while it is not OK; every change of status is written to the audit log.

const CAPACITY_LEVELS = ['ok', 'warning', 'critical'];
const CAPACITY_STATUS_KEY = 'cap_status';

function capProps_() { return PropertiesService.getScriptProperties(); }

// ── Counters written while the app runs (cheap: only when something is slow or fails) ──

// Called by rpc() after every page request
function noteCallTime_(fnName, ms) {
  if (!(ms >= CAPACITY.slowCallMs)) return;
  try {
    const key = 'cap_slow_' + today();
    const d = JSON.parse(capProps_().getProperty(key) || '{}');
    const e = d[fnName] || (d[fnName] = { n: 0, maxMs: 0 });
    e.n++; e.maxMs = Math.max(e.maxMs, ms);
    capProps_().setProperty(key, JSON.stringify(d));
  } catch (e) { /* never let monitoring break a request */ }
}

// Called when an email could not be sent (daily quota reached, bad address, ...)
function noteMailFailure_(err) {
  try {
    const key = 'cap_mailfail_' + today();
    const d = JSON.parse(capProps_().getProperty(key) || '{"n":0}');
    d.n++; d.last = String(err && err.message || err || '').slice(0, 200);
    capProps_().setProperty(key, JSON.stringify(d));
  } catch (e) {}
}

// Runs a scheduled job and records how long it took. A job Google stops at 6 minutes never reaches the
// end, so its start stays recorded and the next check reports it as cut off.
function timedJob_(name, fn) {
  const key = 'cap_job_' + name;
  let rec = {};
  try { rec = JSON.parse(capProps_().getProperty(key) || '{}'); } catch (e) {}
  rec.start = Date.now();
  capProps_().setProperty(key, JSON.stringify(rec));
  try { return fn(); }
  finally {
    rec.ms = Date.now() - rec.start; rec.at = now_ts(); delete rec.start;
    capProps_().setProperty(key, JSON.stringify(rec));
  }
}

// ── Measuring and rating ──

// The day before today, 'yyyy-MM-dd'
function yesterday_() { const d = new Date(); d.setDate(d.getDate() - 1); return fmt_date(d); }

function capacityMetrics_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cells = 0;
  ss.getSheets().forEach(sh => { cells += sh.getMaxRows() * sh.getMaxColumns(); });
  const sav = ss.getSheetByName(SH_SAVINGS);
  const savingsRows = sav ? Math.max(0, sav.getLastRow() - 1) : 0;
  const activeMembers = readSheet_(SH_MEMBERS, 'memberno').rows
    .filter(m => String(m['MemberNo'] || '').trim() && String(m['Status'] || '').trim().toLowerCase() === 'active').length;

  // The account's daily email quota: the largest "remaining" seen (the check runs early, before most mail)
  let quota = num(capProps_().getProperty('cap_mailquota'));
  try { const rem = MailApp.getRemainingDailyQuota(); if (rem > quota) { quota = rem; capProps_().setProperty('cap_mailquota', String(rem)); } } catch (e) {}

  const days = [yesterday_(), today()];
  const read = k => { try { return JSON.parse(capProps_().getProperty(k) || 'null'); } catch (e) { return null; } };
  const slow = {};
  days.forEach(d => { const x = read('cap_slow_' + d) || {}; Object.keys(x).forEach(fn => {
    const s = slow[fn] || (slow[fn] = { n: 0, maxMs: 0 }); s.n += x[fn].n; s.maxMs = Math.max(s.maxMs, x[fn].maxMs); }); });
  const mailFail = days.reduce((a, d) => { const x = read('cap_mailfail_' + d); return x ? { n: a.n + x.n, last: x.last || a.last } : a; }, { n: 0, last: '' });

  const jobs = {};
  capProps_().getKeys().filter(k => k.indexOf('cap_job_') === 0).forEach(k => { const r = read(k); if (r) jobs[k.slice(8)] = r; });
  return { at: now_ts(), cells, savingsRows, activeMembers, mailQuota: quota, slow, mailFail, jobs };
}

function capLevel_(ratio) { return ratio >= CAPACITY.criticalAt ? 'critical' : ratio >= CAPACITY.warnAt ? 'warning' : 'ok'; }
function capWorst_(levels) { return levels.reduce((w, l) => (CAPACITY_LEVELS.indexOf(l) > CAPACITY_LEVELS.indexOf(w) ? l : w), 'ok'); }
const pct_ = r => Math.round(r * 100) + '%';

// Rates each measure. Returns { level, at, items: [{ key, label, value, level, advice }] }
function capacityStatus_(m) {
  const items = [];
  const ratio = (key, label, value, limit, advice) => {
    const r = limit > 0 ? value / limit : 0;
    items.push({ key, label, value: value.toLocaleString('en-US') + ' of ' + limit.toLocaleString('en-US') + ' (' + pct_(r) + ')', level: capLevel_(r), advice });
  };
  ratio('members', 'Active members', m.activeMembers, CAPACITY.activeMembers,
    'The club is close to the number of members the system was planned for. Plan the next step with the developer (see the capacity clause of the agreement).');
  ratio('savingsRows', 'Savings rows in the live spreadsheet', m.savingsRows, CAPACITY.liveSavingsRows,
    'Screens will slow down as the ledger grows. Archive closed years (move them to an archive spreadsheet) or ask the developer.');
  ratio('cells', 'Spreadsheet size (cells)', m.cells, CAPACITY.cells,
    'Google stops a spreadsheet at 10 million cells. Delete unused columns and empty rows, and archive closed years, before it is reached.');
  if (m.mailQuota > 0)
    ratio('email', 'Members vs. daily email quota', m.activeMembers, m.mailQuota,
      'On the 1st of the month every member is emailed a summary. Above the daily quota (' + m.mailQuota + ' a day on this account) emails are dropped. Move the club to Google Workspace or reduce emails.');

  if (m.mailFail.n > 0)
    items.push({ key: 'emailFailed', label: 'Emails that could not be sent (yesterday and today)', value: String(m.mailFail.n), level: 'critical',
      advice: 'Members and admins did not receive some notices. Usual cause: the daily email quota. Last error: ' + (m.mailFail.last || 'not recorded') + '.' });

  const slowN = Object.keys(m.slow).reduce((s, fn) => s + m.slow[fn].n, 0);
  if (slowN > 0) {
    const worst = Object.keys(m.slow).sort((a, b) => m.slow[b].maxMs - m.slow[a].maxMs);
    items.push({ key: 'slow', label: 'Slow page requests (over ' + CAPACITY.slowCallMs / 1000 + ' s, yesterday and today)',
      value: slowN + ' (slowest: ' + worst.slice(0, 3).map(fn => fn + ' ' + (m.slow[fn].maxMs / 1000).toFixed(1) + ' s').join(', ') + ')',
      level: slowN >= CAPACITY.slowCallsCritical ? 'critical' : slowN >= CAPACITY.slowCallsWarn ? 'warning' : 'ok',
      advice: 'Members and admins are waiting too long. Ask the developer to look at the slowest screens listed.' });
  }

  Object.keys(m.jobs).forEach(name => {
    const j = m.jobs[name];
    if (j.start && Date.now() - j.start > CAPACITY.jobLimitMs + 60000)
      items.push({ key: 'job_' + name, label: 'Scheduled job ' + name, value: 'cut off at Google\'s 6-minute limit (started ' + fmt_date(new Date(j.start)) + ')',
        level: 'critical', advice: 'The job did not finish, so some members were not reached. Ask the developer.' });
    else if (j.ms) {
      const r = j.ms / CAPACITY.jobLimitMs;
      if (capLevel_(r) !== 'ok') items.push({ key: 'job_' + name, label: 'Scheduled job ' + name,
        value: (j.ms / 1000).toFixed(0) + ' s of the 360 s limit (' + pct_(r) + ', ' + (j.at || '') + ')', level: capLevel_(r),
        advice: 'The job is close to Google\'s 6-minute limit; once it passes it, the job stops part-way. Ask the developer.' });
    }
  });
  return { level: capWorst_(items.map(i => i.level)), at: m.at, items };
}

// The last stored check, for the admin dashboard (no measuring here: one property read)
function lastCapacityStatus_() {
  try { return JSON.parse(capProps_().getProperty(CAPACITY_STATUS_KEY) || 'null'); } catch (e) { return null; }
}

// Measures, stores, and tells the admins when needed. Returns the status. Called by checkCapacity.
function runCapacityCheck_() {
  const prev = lastCapacityStatus_() || { level: 'ok' };
  const s = capacityStatus_(capacityMetrics_());
  const worse = CAPACITY_LEVELS.indexOf(s.level) > CAPACITY_LEVELS.indexOf(prev.level);
  const due = !prev.notifiedAt || (Date.now() - new Date(String(prev.notifiedAt).replace(' ', 'T')).getTime()) >= CAPACITY.remindEveryDays * 86400000;
  s.notifiedAt = prev.notifiedAt || '';
  const problems = s.items.filter(i => i.level !== 'ok');
  if (s.level !== 'ok' && (worse || due)) {
    notifyAdmins_('Capacity ' + (s.level === 'critical' ? 'CRITICAL' : 'warning') + ': the club is close to the system\'s limits',
      problems.map(i => [i.label + ' (' + i.level + ')', i.value]),
      'The daily capacity check found the items below near or over their limits. ' + problems.map(i => i.label + ': ' + i.advice).join(' ')
      + ' This is repeated every ' + CAPACITY.remindEveryDays + ' days while it lasts, and at once if it gets worse.');
    s.notifiedAt = now_ts();
  }
  if (s.level !== prev.level)
    auditLog_('Capacity ' + (s.level === 'ok' ? 'Back to Normal' : s.level === 'critical' ? 'Critical' : 'Warning'), '', 'System',
      s.level === 'ok' ? 'Every capacity measure is back within its limit.' : problems.map(i => i.label + ': ' + i.value + ' (' + i.level + ')').join('; '), '');
  capProps_().setProperty(CAPACITY_STATUS_KEY, JSON.stringify(s));
  // Keep only the last two days of counters
  const keep = ['cap_slow_' + today(), 'cap_slow_' + yesterday_(), 'cap_mailfail_' + today(), 'cap_mailfail_' + yesterday_()];
  capProps_().getKeys().filter(k => /^cap_(slow|mailfail)_/.test(k) && keep.indexOf(k) < 0).forEach(k => capProps_().deleteProperty(k));
  return s;
}
