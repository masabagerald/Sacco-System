// Capacity watch (CapacityService.gs): the daily check warns the admins before the club reaches its limits.
const assert = require('assert');
const { EMAIL, seed, ok } = require('./fixtures');

function setLimits(c, over) {
  const cap = c.val('CAPACITY');
  Object.assign(cap, over);
  return cap;
}
const capEmails = fakes => fakes.emails.filter(e => /Capacity/.test(e.subject || ''));

module.exports = {
  'all within limits: status OK, no email, nothing on the dashboard'(c) {
    const { g, fakes } = seed(c);
    const s = fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(s.level, 'ok', JSON.stringify(s.items));
    assert.strictEqual(capEmails(fakes).length, 0);
    fakes.signInAs(EMAIL.ALICE);
    assert.strictEqual(ok(g.getAdminDashboard(), 'dashboard').capacity.level, 'ok');
  },

  'near the member limit: admins warned once, reminded after a week, told at once when it gets worse'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    setLimits(c, { activeMembers: 8 });   // the test club has 7 active members: 88%
    let s = fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(s.level, 'warning');
    assert.ok(s.items.some(i => i.key === 'members' && i.level === 'warning'));
    assert.strictEqual(capEmails(fakes).length, 1, 'admins emailed');
    assert.ok(ctx.audit().some(a => a.Action === 'Capacity Warning'), 'audit log');
    fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(capEmails(fakes).length, 1, 'not repeated the same week');
    // a week later
    const props = g.PropertiesService.getScriptProperties();
    const st = JSON.parse(props.getProperty('cap_status')); st.notifiedAt = '2000-01-01 08:00:00'; props.setProperty('cap_status', JSON.stringify(st));
    fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(capEmails(fakes).length, 2, 'weekly reminder');
    // worse: critical, emailed at once
    setLimits(c, { activeMembers: 7 });
    s = fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(s.level, 'critical');
    assert.strictEqual(capEmails(fakes).length, 3, 'worse: told at once');
    fakes.signInAs(EMAIL.ALICE);
    assert.strictEqual(ok(g.getAdminDashboard(), 'dashboard').capacity.level, 'critical', 'banner data');
    // back to normal
    setLimits(c, { activeMembers: 500 });
    assert.strictEqual(fakes.asOwner(() => g.checkCapacity()).level, 'ok');
    assert.ok(ctx.audit().some(a => a.Action === 'Capacity Back to Normal'));
  },

  'slow page requests and failed emails are counted and reported'(c) {
    const { g, fakes } = seed(c);
    fakes.signInAs(EMAIL.ALICE);
    g.noteCallTime_('getAllMembersSummary', 500);    // fast: not counted
    for (let i = 0; i < 6; i++) g.noteCallTime_('getLoanRequests', 9000 + i);
    g.noteMailFailure_(new Error('Service invoked too many times for one day: email.'));
    const s = fakes.asOwner(() => g.checkCapacity());
    const slow = s.items.find(i => i.key === 'slow');
    assert.ok(slow && slow.level === 'warning' && /getLoanRequests 9\.0 s/.test(slow.value), JSON.stringify(slow));
    const mail = s.items.find(i => i.key === 'emailFailed');
    assert.ok(mail && mail.level === 'critical' && /too many times/.test(mail.advice));
    assert.strictEqual(s.level, 'critical');
  },

  'every page request is timed through rpc'(c) {
    const { g, fakes } = seed(c);
    const seen = [];
    g.noteCallTime_ = (fn, ms) => seen.push([fn, typeof ms]);
    g.rpc('', 'tryAutoDetect', []);
    assert.deepStrictEqual(seen, [['tryAutoDetect', 'number']]);
    assert.throws(() => g.rpc('', 'checkCapacity', []), /Unknown action/, 'the check cannot be called from the page');
  },

  'a scheduled job cut off at the 6-minute limit is reported as critical'(c) {
    const { g, fakes } = seed(c);
    const props = g.PropertiesService.getScriptProperties();
    props.setProperty('cap_job_sendMonthlyStatements', JSON.stringify({ start: Date.now() - 8 * 60 * 1000 }));   // started, never finished
    props.setProperty('cap_job_processLoanDueDates', JSON.stringify({ ms: 330000, at: '2026-11-13 07:05:00' }));  // 92% of 6 minutes
    const s = fakes.asOwner(() => g.checkCapacity());
    assert.strictEqual(s.items.find(i => i.key === 'job_sendMonthlyStatements').level, 'critical');
    assert.strictEqual(s.items.find(i => i.key === 'job_processLoanDueDates').level, 'warning');
    // a job that finishes records its time and clears the start
    g.timedJob_('demo', () => 1);
    const rec = JSON.parse(props.getProperty('cap_job_demo'));
    assert.ok(rec.ms >= 0 && !rec.start);
  }
};
