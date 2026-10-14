// Member numbers: new members get MSIC-0001-style numbers, and migrateMemberNumbers() converts the
// old M001-style numbers on every tab (except the append-only Audit Log) without breaking anything.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, NAN } = EMAIL;
const members = ctx => ctx.fakes.sheet(ctx.val('SH_MEMBERS')).records('memberno');

// A Soft Loan for Nan: guarantors Dan and Fay, approved by Alice then Bob; plus a fine for Nan
function activity(ctx) {
  const { g, fakes } = ctx;
  fakes.signInAs(ALICE);
  ['M004', 'M007'].forEach(no => ok(g.recordSavings(no, 'Deposit', 100000, 'Principal', 'Monthly Premium', '', '', ''), 'fund ' + no));
  fakes.signInAs(NAN);
  const id = ok(g.requestLoan(50000, '1w', 'Stock', ['M004', 'M007']), 'request').requestId;
  ['M004', 'M007'].forEach(no => {
    const row = ctx.guarantors().find(r => r.RequestID === id && r.GuarantorNo === no);
    g._guarantorHandle(row.Token, 'approve', '1', '');
  });
  fakes.signInAs(ALICE); ok(g.approveLoanRequest(id, ''), 'first');
  fakes.signInAs(BOB); const loanId = ok(g.approveLoanRequest(id, ''), 'final').loanId;
  return { requestId: id, loanId };
}

module.exports = {
  'a new member gets the next MSIC number, counting the old-format numbers'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    fakes.signInAs(ALICE);
    assert.strictEqual(ok(g.addMember('Joan', 'joan@x.org', '', 'Member', 'Founder Member', ''), 'add').memberNo, 'MSIC-0008', 'after M007');
    assert.strictEqual(ok(g.addMember('Kim', 'kim@x.org', '', 'Member', 'Delegate Member', ''), 'add').memberNo, 'MSIC-0009');
  },

  'the migration renumbers every tab, keeps the Audit Log, and is safe to run again'(c) {
    const ctx = seed(c), { g, fakes } = ctx;
    const { requestId, loanId } = activity(ctx);
    const auditBefore = ctx.audit().length;

    assert.match(g.previewMemberNumberMigration(), /M001 -> MSIC-0001.*M007 -> MSIC-0007/);
    assert.strictEqual(members(ctx)[0].MemberNo, 'M001', 'preview changes nothing');

    assert.match(g.migrateMemberNumbers(), /cell\(s\)/);
    assert.deepStrictEqual(members(ctx).map(m => m.MemberNo), ['MSIC-0001', 'MSIC-0002', 'MSIC-0003', 'MSIC-0004', 'MSIC-0005', 'MSIC-0006', 'MSIC-0007']);
    const req = ctx.loanReqs().find(r => r.RequestID === requestId);
    assert.deepStrictEqual([req.MemberNo, req['Initiated By'], req['Guarantor 1'], req['Guarantor 2'], req['Approver 1'], req['Approver 2']],
      ['MSIC-0006', 'MSIC-0006', 'MSIC-0004', 'MSIC-0007', 'MSIC-0001', 'MSIC-0002']);
    const loan = ctx.loans().find(l => l.LoanID === loanId);
    assert.deepStrictEqual([loan.MemberNo, loan['Issued By']], ['MSIC-0006', 'MSIC-0002']);
    assert.ok(ctx.guarantors().every(r => /^MSIC-/.test(r.ApplicantNo) && /^MSIC-/.test(r.GuarantorNo)));
    assert.ok(ctx.ledger().every(r => /^MSIC-/.test(r.MemberNo) && /^MSIC-/.test(r['Recorded By'])));
    assert.match(String(req['Decision Notes']), /M00/, 'free-text notes are left as written');

    const audit = ctx.audit();
    assert.ok(audit.slice(0, auditBefore).every(a => !/MSIC-/.test(a['Performed By'])), 'earlier audit entries unchanged');
    assert.ok(audit.some(a => a.Action === 'Member Numbers Migrated' && /M006 -> MSIC-0006/.test(a.Details)), 'mapping recorded');

    // Everything still works under the new numbers
    fakes.signInAs(NAN);
    const mine = ok(g.getMyLoans(), 'Nan\'s loans').loans;
    assert.strictEqual(mine.length, 1);
    fakes.signInAs(ALICE);
    ok(g.recordRepayment(loanId, 10000, '', ''), 'repayment after migration');
    assert.ok(fakes.emails.some(e => e.to === EMAIL.DAN && /Guarantor notice/.test(e.subject)), 'guarantor notices still reach Dan');
    fakes.signInAs(CAROL);
    fails(g.approveLoanRequest(requestId, ''), /Already decided/, 'request history intact');
    fakes.signInAs(ALICE);
    assert.strictEqual(ok(g.addMember('Joan', 'joan@x.org', '', 'Member', 'Founder Member', ''), 'add').memberNo, 'MSIC-0008');

    assert.strictEqual(g.migrateMemberNumbers(), 'Nothing to change.', 'second run');
  },

  'the migration stops without changes if a new number is already taken'(c) {
    const ctx = seed(c), { g, fakes, val } = ctx;
    fakes.sheet(val('SH_MEMBERS')).appendRow(['MSIC-0002', 'Zed', 'zed@x.org', '', 'Member', 'Founder Member', '2024-01-01', 'Active']);
    assert.match(g.migrateMemberNumbers(), /MSIC-0002 \(the new number for M002\) is already used/);
    assert.strictEqual(members(ctx)[0].MemberNo, 'M001', 'nothing changed');
  }
};
