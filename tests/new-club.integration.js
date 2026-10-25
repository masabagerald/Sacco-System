// A new club sets itself up: the first time the web app is opened (doGet), a blank spreadsheet gets
// every tab, the scheduled jobs, and the hosting account as its first member -- "System Administrator",
// an active Admin with no membership type, which can't be demoted, deactivated or given a membership
// type. setupNewClub() can also be run by hand; running it again changes nothing.
const assert = require('assert');

const HOST = 'Club.Host@Gmail.com';
const host = HOST.toLowerCase();

function freshClub({ g, fakes, val }) { fakes.hostAs(HOST); return { g, fakes, val }; }
const ok = (r, label) => { assert.ok(r && r.ok, label + ': ' + JSON.stringify(r)); return r; };
const fails = (r, re, label) => { assert.ok(r && !r.ok, label + ' should fail: ' + JSON.stringify(r)); if (re) assert.match(r.error, re, label); };

module.exports = {
  'opening the app the first time sets up a blank spreadsheet, with the hosting account as admin'(c) {
    const { g, fakes, val } = freshClub(c);
    g.doGet({ parameter: {} });
    ['SH_MEMBERS', 'SH_SAVINGS', 'SH_LOANS', 'SH_REPAY', 'SH_FINES', 'SH_LOAN_REQ', 'SH_WD_REQ', 'SH_AUDIT', 'SH_GUARANTORS', 'SH_GUARANTOR_NOTICES',
      'SH_LOAN_FUND', 'SH_INVESTMENTS', 'SH_INV_TX', 'SH_WAIVERS', 'SH_WAIVER_DECISIONS', 'SH_ASSETS', 'SH_ASSET_REVIEWS', 'SH_ASSET_HISTORY']
      .forEach(k => assert.ok(fakes.sheet(val(k)), 'tab ' + val(k)));
    const members = fakes.sheet(val('SH_MEMBERS')).records('memberno');
    assert.strictEqual(members.length, 1);
    const m = members[0];
    assert.deepStrictEqual([m.MemberNo, m['Full Name'], m.Email, m.Role, m['Membership Type'], m.Status],
      [val('MEMBER_NO_PREFIX') + '0001', 'System Administrator', host, 'Admin', '', 'Active'], 'hosting account: Admin, no membership type');
    assert.deepStrictEqual(fakes.triggers.map(t => t.fn).sort(),
      ['backupSpreadsheet', 'processLoanDueDates', 'sendMonthlyAuditReport', 'sendMonthlyStatements', 'sendRepaymentReminders', 'sendRepaymentReminders'],
      'scheduled jobs created');
    assert.ok(fakes.sheet(val('SH_AUDIT')).records('timestamp').some(a => a.Action === 'Club Set Up'));

    // Later visits, and running it by hand, change nothing
    g.doGet({ parameter: {} });
    assert.match(g.setupNewClub(), /All core tabs already existed/);
    assert.strictEqual(fakes.sheet(val('SH_MEMBERS')).records('memberno').length, 1, 'no second admin');
    assert.strictEqual(fakes.triggers.length, 6, 'no duplicate jobs');
  },

  'the hosting account always stays an active Admin with no membership type'(c) {
    const { g, fakes } = freshClub(c);
    g.setupNewClub();
    fakes.signInAs(host);
    const first = ok(g.getAllMembersSummary(), 'members').members[0].memberNo;
    const other = ok(g.addMember('Second Admin', 'second@gmail.com', '', 'Admin', 'Founder Member', '2020-01-01'), 'add admin').memberNo;
    fakes.signInAs('second@gmail.com');
    fails(g.updateMember(first, 'Member', '', 'Active', ''), /must stay an Admin/, 'demote');
    fails(g.updateMember(first, 'Admin', '', 'Inactive', ''), /must stay Active/, 'deactivate');
    fails(g.updateMember(first, 'Admin', 'Founder Member', 'Active', ''), /no membership type/, 'give a membership type');
    ok(g.updateMember(first, 'Admin', '', 'Active', '', 'Finance Committee'), 'other details can still change');
    ok(g.updateMember(other, 'Member', 'Founder Member', 'Active', ''), 'ordinary members are not affected');
    // The hosting account signs in and uses the admin screens without a membership type
    fakes.signInAs(host);
    fails(g.addMember('Copy', HOST, '', 'Admin', '', ''), /already registered/, 'the hosting account cannot be added twice');
    ok(g.getAdminDashboard(), 'dashboard');
    ok(g.getLoanInsights({}), 'loan insights');
    const terms = ok(g.getLoanTerms(null), 'loan terms');
    assert.strictEqual(terms.product, 'none', 'no loan product for an administrator-only account');
  },

  'the new club works: the admin adds members, records savings, and every area loads'(c) {
    const { g, fakes } = freshClub(c);
    g.doGet({ parameter: {} });
    fakes.signInAs(host);
    const b = ok(g.addMember('First Member', 'member@gmail.com', '0772 000 111', 'Member', 'Founder Member', '2020-01-01'), 'add member').memberNo;
    ok(g.recordSavings(b, 'Deposit', 50000, 'Principal', 'Monthly Premium', '', '', ''), 'deposit');
    ok(g.issueFine(b, 2000, 'Late'), 'surcharge');
    const d = ok(g.getAdminDashboard(), 'dashboard');
    assert.strictEqual(d.totalMembers, 2);
    assert.strictEqual(d.totalSavings, 50000);
    ok(g.getAuditLog(50), 'audit log');
    ok(g.getInvestmentDashboard({}), 'investments');
    ok(g.registerAsset({ type: 'Computers', description: 'Laptop', value: '1000000', dateAcquired: '2025-01-01', condition: 'Functional',
      availability: 'In Use', location: 'Office' }), 'asset register');
    ok(g.getLoanRequests(), 'loan requests');
  },

  'a club that is already live is not changed by the first visit after an update'(c) {
    const { seed } = require('./fixtures');
    const ctx = seed(c);
    ctx.fakes.hostAs('alice@x.org');                      // the hosting account is already a member (Alice, Founder Member)
    const before = ctx.fakes.sheet(ctx.val('SH_MEMBERS')).records('memberno');
    ctx.g.doGet({ parameter: {} });
    const after = ctx.fakes.sheet(ctx.val('SH_MEMBERS')).records('memberno');
    assert.strictEqual(after.length, before.length, 'no member added');
    assert.deepStrictEqual(after.map(m => [m.MemberNo, m.Role, m['Membership Type']]), before.map(m => [m.MemberNo, m.Role, m['Membership Type']]));
    // Alice keeps her existing membership type and can still be edited, but stays an active Admin
    ctx.fakes.signInAs('bob@x.org');
    ok(ctx.g.updateMember('M001', 'Admin', 'Founder Member', 'Active', ''), 'existing membership type kept');
    fails(ctx.g.updateMember('M001', 'Member', 'Founder Member', 'Active', ''), /must stay an Admin/, 'still protected');
  }
};
