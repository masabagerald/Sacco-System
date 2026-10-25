// Daily pending-action reminders: everyone with an approval, review or consent waiting for them gets one
// email a day listing it, once the item has waited PENDING_REMINDER_MIN_HOURS. Each item goes only to
// people allowed to act on it (not the initiator, the applicant or the admin who already approved).
const assert = require('assert');
const { EMAIL, seed, ok } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN, FAY } = EMAIL;
const HOUR = 3600000;
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

function setup(c) {
  const ctx = seed(c), { g, fakes, val } = ctx;
  fakes.addSheet(val('SH_REPAY'), [['LoanID', 'Date', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Recorded By', 'Notes', 'Reference', 'Reverses']]);
  g.setupFinanceSchema();
  g._sendEmail = (to, subject, rows, message) => { if (to) fakes.emails.push({ to, subject, rows, message }); };
  ctx.as = e => fakes.signInAs(e);
  ctx.later = () => Date.now() + 13 * HOUR;
  ctx.waiting = () => { const p = g._pendingActions(ctx.later()); const out = {}; Object.keys(p.admins).sort().forEach(k => { out[k] = p.admins[k].map(i => i.id).sort(); }); return out; };
  ctx.respond = (requestId, no, decide) => {
    const row = ctx.guarantors().find(r => r.RequestID === requestId && r.GuarantorNo === no);
    g._guarantorHandle(row.Token, decide, '1', decide === 'decline' ? 'Cannot' : '');
  };
  ['M001', 'M002', 'M004', 'M007'].forEach(no => { ctx.as(ALICE); ok(g.recordSavings(no, 'Deposit', 200000, 'Principal', 'Monthly Premium', '', '', '2024-01-01'), 'fund ' + no); });
  return ctx;
}

module.exports = {
  'guarantors are reminded with their links; admins once both have agreed, except the first approver'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    ctx.as(FAY);
    const id = ok(g.requestLoan(50000, 3, 'Stock', ['M001', 'M004']), 'request').requestId;
    const now = g._pendingActions(Date.now());
    eq([Object.keys(now.admins).length, now.guarantors.length], [0, 0], 'nothing new is reminded the same day it was sent');
    const p = g._pendingActions(ctx.later());
    eq(p.guarantors.map(x => x.guarantorNo).sort(), ['M001', 'M004'], 'both guarantors still to respond');
    eq(Object.keys(p.admins), [], 'admins are not asked before the guarantors agree');
    const before = fakes.emails.length;
    g._sendPendingActionReminders(ctx.later());
    const sent = fakes.emails.slice(before);
    eq(sent.map(e => e.to).sort(), [ALICE, DAN], 'one reminder per guarantor');
    assert.ok(sent.every(e => /Reminder: please respond to guarantor request/.test(e.subject) && /decide=approve/.test(e.html) && /decide=decline/.test(e.html)), 'with their links');

    ctx.respond(id, 'M001', 'approve'); ctx.respond(id, 'M004', 'approve');
    eq(ctx.waiting(), { M001: [id], M002: [id], M003: [id] }, 'every admin who may approve (the applicant is not an admin)');
    ctx.as(BOB); ok(g.approveLoanRequest(id, ''), 'first approval');
    eq(ctx.waiting(), { M001: [id], M003: [id] }, 'not the admin who gave the first approval');
    const item = g._pendingActions(ctx.later()).admins.M003[0];
    eq([item.kind, item.action], ['Loan request', 'Second approval']);
    ctx.as(CAROL); ok(g.approveLoanRequest(id, ''), 'second approval issues the loan');
    eq(ctx.waiting(), {}, 'nothing left once it is decided');
  },

  'withdrawals, loan fund entries, assets and declined requests go to the admins who can act'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    ctx.as(DAN);
    const wd = ok(g.requestWithdrawal(10000, 'Dividends', '', 'Principal'), 'withdrawal').requestId;
    ctx.as(ALICE);
    const asset = ok(g.registerAsset({ type: 'Computers', description: 'Laptop', value: '100', dateAcquired: '2025-01-01', condition: 'Functional',
      availability: 'In Use', location: 'Office' }), 'asset').assetId;
    const lfe = ok(g.proposeLoanFundEntry('Cash Injection', 5000, '', 'BANK-1', 'Donation'), 'fund entry').entryId;
    ctx.as(FAY);
    const lr = ok(g.requestLoan(50000, 3, 'Stock', ['M001', 'M004']), 'loan request').requestId;
    ctx.respond(lr, 'M004', 'decline');
    const w = ctx.waiting();
    eq(w.M001, [asset, lfe, lr, wd].filter(x => x !== asset && x !== lfe).sort(), 'Alice: not her own asset or fund entry');
    eq(w.M002, [asset, lfe, lr, wd].sort(), 'Bob: everything');
    const declined = g._pendingActions(ctx.later()).admins.M002.find(i => i.id === lr);
    assert.strictEqual(declined.action, 'Reject (a guarantor declined)');

    ctx.as(ALICE); ok(g.approveWithdrawal(wd), 'Alice gives the first withdrawal approval');
    assert.ok(ctx.waiting().M001.indexOf(wd) < 0 && ctx.waiting().M002.indexOf(wd) > -1, 'then only the others are reminded');
    ctx.as(BOB); ok(g.updateMember('M003', 'Admin', 'Delegate Member', 'Inactive', ''), 'Carol made inactive');
    assert.strictEqual(ctx.waiting().M003, undefined, 'inactive admins are not reminded');

    // One email per admin, listing all their items
    const before = fakes.emails.length;
    const res = g._sendPendingActionReminders(ctx.later());
    const mails = fakes.emails.slice(before).filter(e => /Waiting for your action/.test(e.subject));
    eq(mails.map(e => e.to).sort(), [ALICE, BOB], 'one email each');
    const bob = mails.find(e => e.to === BOB);
    assert.strictEqual(bob.subject, 'Waiting for your action: 4 items');
    [asset, lfe, lr, wd].forEach(x => assert.ok(bob.rows.some(r => r[0].indexOf(x) > -1), 'lists ' + x));
    assert.ok(/script\.example\/exec/.test(bob.message), 'with the app link');
    assert.strictEqual(res.admins, 2);
    assert.ok(ctx.audit().some(a => a.Action === 'Pending Action Reminders'), 'logged');
  },

  'the job runs once a day, and a live club gets the new job added without duplicating the others'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    g.sendPendingActionReminders();
    g.sendPendingActionReminders();
    assert.ok(fakes.logs.some(l => /sendPendingActionReminders already ran today/.test(l)), 'second run skipped');

    g.createAllTriggers();
    assert.strictEqual(fakes.triggers.length, 7);
    g.ScriptApp.deleteTrigger(fakes.triggers.find(t => t.fn === 'sendPendingActionReminders'));  // a club set up before this job existed
    eq(g._ensureScheduledJobs(), ['sendPendingActionReminders'], 'only the missing job is added');
    assert.strictEqual(fakes.triggers.length, 7);
    eq(g._ensureScheduledJobs(), [], 'nothing more on a second run');
    assert.ok(fakes.triggers.find(t => t.fn === 'sendPendingActionReminders').schedule.join(' ').indexOf('everyDays(1)') > -1, 'daily');
  }
};
