// setupNewClub(): a brand-new, empty spreadsheet is turned into a working club in one run. The person
// running it becomes the first admin, every tab gets its headers, and the main features work straight
// away. Running it again changes nothing.
const assert = require('assert');

const OWNER = 'Owner.Person@Gmail.com';

function freshClub({ g, fakes, val }) {
  g.Session.getEffectiveUser = () => ({ getEmail: () => OWNER });
  return { g, fakes, val };
}

module.exports = {
  'a blank spreadsheet: every tab is created and the owner becomes the first admin'(c) {
    const { g, fakes, val } = freshClub(c);
    const msg = g.setupNewClub();
    assert.match(msg, /Created tabs: Members, Savings, Loans, Loan Repayments, Surcharge, Loan Requests, Withdrawal Requests, Audit Log/);
    ['SH_MEMBERS', 'SH_SAVINGS', 'SH_LOANS', 'SH_REPAY', 'SH_FINES', 'SH_LOAN_REQ', 'SH_WD_REQ', 'SH_AUDIT', 'SH_GUARANTORS', 'SH_GUARANTOR_NOTICES',
      'SH_LOAN_FUND', 'SH_INVESTMENTS', 'SH_INV_TX', 'SH_WAIVERS', 'SH_WAIVER_DECISIONS', 'SH_ASSETS', 'SH_ASSET_REVIEWS', 'SH_ASSET_HISTORY']
      .forEach(k => assert.ok(fakes.sheet(val(k)), 'tab ' + val(k)));
    const members = fakes.sheet(val('SH_MEMBERS')).records('memberno');
    assert.strictEqual(members.length, 1);
    const m = members[0];
    assert.deepStrictEqual([m.MemberNo, m.Email, m.Role, m['Membership Type'], m.Status], [val('MEMBER_NO_PREFIX') + '0001', 'owner.person@gmail.com', 'Admin', 'Founder Member', 'Active']);

    // Run again: nothing new
    const snapshot = JSON.stringify(Object.keys(fakes.sheet(val('SH_MEMBERS')).data));
    assert.match(g.setupNewClub(), /All core tabs already existed/);
    assert.strictEqual(fakes.sheet(val('SH_MEMBERS')).records('memberno').length, 1, 'no second admin');
    assert.strictEqual(JSON.stringify(Object.keys(fakes.sheet(val('SH_MEMBERS')).data)), snapshot);
  },

  'the new club works: the admin adds members, records savings, and the dashboards load'(c) {
    const { g, fakes } = freshClub(c);
    g.setupNewClub();
    fakes.signInAs('owner.person@gmail.com');
    const ok = (r, label) => { assert.ok(r && r.ok, label + ': ' + JSON.stringify(r)); return r; };
    const b = ok(g.addMember('Second Admin', 'second@gmail.com', '0772 000 111', 'Admin', 'Founder Member', '2020-01-01'), 'add member').memberNo;
    ok(g.recordSavings(b, 'Deposit', 50000, 'Principal', 'Monthly Premium', '', '', ''), 'deposit');
    ok(g.issueFine(b, 2000, 'Late'), 'surcharge');
    const d = ok(g.getAdminDashboard(), 'dashboard');
    assert.strictEqual(d.totalMembers, 2);
    assert.strictEqual(d.totalSavings, 50000);
    ok(g.getAuditLog(50), 'audit log');
    ok(g.getLoanInsights({}), 'loan insights');
    ok(g.getInvestmentDashboard({}), 'investments');
    ok(g.registerAsset({ type: 'Computers', description: 'Laptop', value: '1000000', dateAcquired: '2025-01-01', condition: 'Functional',
      availability: 'In Use', location: 'Office' }), 'asset register');
    ok(g.getLoanRequests(), 'loan requests');
  }
};
