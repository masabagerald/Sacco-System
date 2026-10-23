// ISS-11: secured loan requests and constitutional waivers. A Founder Member short of a savings
// coverage requirement asks for a loan with security; three different committee administrators
// (at least one Chairperson and two Finance Committee) approve the waiver; then the normal path
// follows: both guarantors consent and two different admins approve. Real controllers, in-memory sheets.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

// Values built inside the script context are compared as JSON (their arrays come from another realm)
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

const { ALICE, BOB, CAROL, DAN, EVE, FAY } = EMAIL;
const GIL = 'gil@x.org', IVY = 'ivy@x.org', KIM = 'kim@x.org', JOY = 'joy@x.org';

// Committee: Alice (M001) Chairperson, Carol (M003) and Gil (M008) Finance Committee, Kim (M011) Finance
// Committee. Bob (M002) is an admin with no committee role. Applicant: Fay (M007). Guarantors: Dan (M004), Ivy (M010).
function setup(c) {
  const ctx = seed(c), { g, fakes, val } = ctx;
  const sh = fakes.sheet(val('SH_MEMBERS'));
  sh.data[0].push('Committee Role');
  const roles = { M001: 'Chairperson', M003: 'Finance Committee' };
  sh.data.slice(1).forEach(r => r.push(roles[r[0]] || ''));
  sh.data.push(['M008', 'Gil', GIL, '', 'Admin', 'Founder Member', '2024-01-01', 'Active', 'Finance Committee']);
  sh.data.push(['M010', 'Ivy', IVY, '', 'Member', 'Founder Member', '2024-01-01', 'Active', '']);
  sh.data.push(['M011', 'Kim', KIM, '', 'Admin', 'Founder Member', '2024-01-01', 'Active', 'Finance Committee']);
  fakes.addSheet(val('SH_REPAY'), [['LoanID', 'Date', 'Timestamp', 'MemberNo', 'Amount (UGX)', 'Recorded By', 'Notes', 'Reference', 'Reverses']]);
  g._sendEmail = (to, subject, rows, message) => { if (to) fakes.emails.push({ to, subject, rows, message }); };
  ctx.mail = re => fakes.emails.filter(e => re.test(e.subject));
  ctx.waivers = () => { const s = fakes.sheet(val('SH_WAIVERS')); return s ? s.records('requestid') : []; };
  ctx.decisions = () => { const s = fakes.sheet(val('SH_WAIVER_DECISIONS')); return s ? s.records('requestid') : []; };
  ctx.req = id => ctx.loanReqs().find(r => r.RequestID === id);
  ctx.as = email => fakes.signInAs(email);
  return ctx;
}

function fund(ctx, memberNo, amount) {
  ctx.as(ALICE);
  ok(ctx.g.recordSavings(memberNo, 'Deposit', amount, 'Principal', 'Monthly Premium', '', '', '2024-01-01'), 'fund ' + memberNo);
}

const SECURITY = { type: 'Land Title', description: 'Plot 12, Block 4, Mbale', value: 30000000,
  ownership: 'Registered to Fay', documents: 'https://drive.google.com/file/d/abc/view', justification: 'Expanding the clinic' };

// Fay asks for 80,000. With 100,000 savings her cap is 50,000, so the applicant coverage fails.
function securedRequest(ctx, opts) {
  opts = opts || {};
  fund(ctx, 'M007', opts.faySavings || 100000);
  fund(ctx, 'M004', opts.danSavings || 100000);
  fund(ctx, 'M010', opts.ivySavings || 100000);
  ctx.as(FAY);
  return ok(ctx.g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M010'], Object.assign({}, SECURITY, opts.security)), 'secured request').requestId;
}

function approveWaiver(ctx, id, emails) {
  emails.forEach(e => { ctx.as(e); ok(ctx.g.approveLoanWaiver(id, 'Security reviewed'), 'waiver approval by ' + e); });
}

function guarantorsConsent(ctx, id) {
  ['M004', 'M010'].forEach(no => {
    const row = ctx.guarantors().find(r => r.RequestID === id && r.GuarantorNo === no);
    assert.ok(row, 'guarantor row for ' + no);
    ctx.g._guarantorHandle(row.Token, 'approve', '1', '');
  });
}

module.exports = {
  'a member who meets the savings requirements uses the normal request; no waiver is offered'(c) {
    const ctx = setup(c), { g } = ctx;
    fund(ctx, 'M007', 200000); fund(ctx, 'M004', 100000); fund(ctx, 'M010', 100000);
    ctx.as(FAY);
    const cov = ok(g.checkLoanCoverage(80000, 3, ['M004', 'M010']), 'coverage');
    assert.strictEqual(cov.failed.length, 0);
    assert.strictEqual(cov.securedAvailable, false);
    assert.strictEqual(cov.applicant.ok, true);
    fails(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M010'], SECURITY), /no waiver is needed/, 'secured request when not needed');
    const id = ok(g.requestLoan(80000, 3, 'Clinic', ['M004', 'M010']), 'normal request').requestId;
    assert.strictEqual(ctx.req(id).Status, 'Pending');
    assert.strictEqual(ctx.waivers().length, 0, 'no waiver record');
  },

  'an applicant over the 50% savings cap: three committee approvals, then guarantors, then two admins'(c) {
    const ctx = setup(c), { g } = ctx;
    fund(ctx, 'M007', 100000); fund(ctx, 'M004', 100000); fund(ctx, 'M010', 100000);
    ctx.as(FAY);
    const cov = ok(g.checkLoanCoverage(80000, 3, ['M004', 'M010']), 'coverage');
    eq([cov.applicant.ok, cov.applicant.coveragePct, cov.applicant.maxLoan, cov.securedAvailable], [false, 125, 50000, true]);
    assert.match(cov.failed[0], /Applicant savings coverage .* above the cap of UGX 50,000/);

    const id = ok(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M010'], SECURITY), 'secured request').requestId;
    assert.strictEqual(ctx.req(id).Status, 'Pending Waiver Approval');
    const w = ctx.waivers()[0];
    eq([w.RequestID, w.ApplicantNo, w['Security Type'], w['Estimated Value (UGX)'], w['Waiver Status']],
      [id, 'M007', 'Land Title', 30000000, 'Pending Waiver Approval']);
    eq(JSON.parse(w['Waived Checks']), { applicantLimit: true, guarantors: [] }, 'only the failed requirement can be waived');
    assert.ok(JSON.parse(w['Eligibility Snapshot']).applicant.savings === 100000, 'original calculation kept');
    assert.strictEqual(ctx.guarantors().filter(r => r.RequestID === id).length, 0, 'guarantors are not asked before the waiver');
    assert.strictEqual(ctx.mail(/guarantor request/).length, 0, 'no guarantor email yet');
    assert.strictEqual(ctx.mail(/^Secured Loan Request Received/).filter(e => e.to === FAY).length, 1, 'applicant told once');
    eq(ctx.mail(/^Waiver approval needed/).map(e => e.to).sort(), [ALICE, CAROL, GIL, KIM].sort(),
      'approval requested from every committee admin, and from nobody else');
    assert.ok(ctx.audit().some(a => a.Action === 'Secured Loan Request Submitted' && /not verified/.test(a.Details) && /Plot 12/.test(a.Details)));

    // Nothing moves on until the waiver is approved
    ctx.as(BOB);
    fails(g.approveLoanRequest(id, ''), /waiting for its waiver: 0 of 3/, 'loan approval before the waiver');
    fails(g.rejectLoanRequest(id, 'x'), /waiting for its waiver decision/, 'plain rejection at the waiver stage');
    fails(g.approveLoanWaiver(id, ''), /Finance Committee or the Chairperson/, 'an admin without a committee role');
    ctx.as(FAY);
    fails(g.approveLoanWaiver(id, ''), /Admin access required/, 'the applicant');

    ctx.as(CAROL);
    const a1 = ok(g.approveLoanWaiver(id, 'Title seen'), 'first');
    eq([a1.stage, a1.approvals, a1.waiverStatus], ['partial', 1, 'Partially Approved']);
    fails(g.approveLoanWaiver(id, ''), /already given your decision/, 'the same admin twice');
    approveWaiver(ctx, id, [GIL]);
    ctx.as(KIM);
    fails(g.approveLoanWaiver(id, ''), /Finance Committee approvals for this waiver are already complete.*1 from Chairperson/, 'a third Finance Committee approval cannot replace the Chairperson');
    ctx.as(BOB);
    fails(g.approveLoanRequest(id, ''), /2 of 3 committee approvals/, 'still blocked after two');
    assert.strictEqual(ctx.waivers()[0]['Waiver Status'], 'Partially Approved');

    ctx.as(ALICE);
    const a3 = ok(g.approveLoanWaiver(id, ''), 'chairperson');
    eq([a3.stage, a3.waiverStatus, a3.approvals], ['approved', 'Waiver Approved', 3]);
    assert.strictEqual(ctx.req(id).Status, 'Pending', 'back on the normal path');
    assert.strictEqual(ctx.waivers()[0]['Waiver Status'], 'Waiver Approved');
    eq(ctx.decisions().map(d => [d.AdminNo, d['Committee Role'], d.Decision]),
      [['M003', 'Finance Committee', 'Approved'], ['M008', 'Finance Committee', 'Approved'], ['M001', 'Chairperson', 'Approved']]);
    eq(ctx.mail(/guarantor request/).map(e => e.to).sort(), [DAN, IVY], 'guarantors asked once the waiver is approved');
    const updates = ctx.mail(/^Secured Loan Request Update/).filter(e => e.to === FAY);
    eq(updates.map(e => e.rows.find(r => r[0] === 'Status')[1]), ['Partially Approved', 'Partially Approved', 'Waiver Approved'],
      'applicant told of each approval and of completion, once each');
    ctx.as(ALICE);
    fails(g.approveLoanWaiver(id, ''), /already been decided/, 'no more decisions after approval');

    // The usual guarantor consent and two final admin approvals still apply
    ctx.as(BOB);
    fails(g.approveLoanRequest(id, ''), /Waiting for guarantor M004/, 'guarantor consent still required');
    guarantorsConsent(ctx, id);
    ctx.as(FAY);
    fails(g.approveLoanRequest(id, ''), /Admin access required/);
    ctx.as(BOB);
    assert.strictEqual(ok(g.approveLoanRequest(id, ''), 'first loan approval').stage, 'first');
    fails(g.approveLoanRequest(id, ''), /already gave the first approval/, 'the same admin cannot give both');
    ctx.as(CAROL);
    const fin = ok(g.approveLoanRequest(id, ''), 'final loan approval (no limit override needed: the waiver covers it)');
    assert.strictEqual(fin.stage, 'final');
    const loan = ctx.loans()[0];
    eq([loan.LoanID, loan.MemberNo, loan['Principal (UGX)'], loan['Interest Rate (%)'], loan['Processing Fee (UGX)']],
      [fin.loanId, 'M007', 80000, 10, 5000], 'normal interest and fee');
    const actions = ctx.audit().map(a => a.Action);
    ['Secured Loan Request Submitted', 'Waiver Approval', 'Waiver Approved', 'Guarantor Consent Given', 'Loan Request First Approval', 'Loan Request Fully Approved']
      .forEach(a => assert.ok(actions.includes(a), 'audit: ' + a));
  },

  'one or both guarantors under 25%: only their coverage is waived, every other rule still applies'(c) {
    const ctx = setup(c), { g } = ctx;
    fund(ctx, 'M007', 400000); fund(ctx, 'M004', 10000); fund(ctx, 'M010', 100000);
    ctx.as(FAY);
    const normal = g.requestLoan(80000, 3, 'Clinic', ['M004', 'M010']);
    assert.ok(!normal.ok && normal.coverageFailed && normal.securedAvailable, 'the normal request offers a secured loan: ' + JSON.stringify(normal));
    const cov = ok(g.checkLoanCoverage(80000, 3, ['M004', 'M010']), 'coverage');
    eq(cov.guarantors.map(x => [x.memberNo, x.ok, x.coveragePct]), [['M004', false, 12.5], ['M010', true, 125]]);
    assert.strictEqual(cov.applicant.ok, true);

    fails(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004'], SECURITY), /Exactly 2 guarantors/, 'two guarantors still required');
    fails(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M003'], SECURITY), /M003 must be a Founder Member/, 'guarantor eligibility not waived');
    fails(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M007'], SECURITY), /cannot guarantee their own loan/, 'self-guarantee not waived');
    const id = ok(g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M010'], SECURITY), 'secured').requestId;
    eq(JSON.parse(ctx.waivers()[0]['Waived Checks']), { applicantLimit: false, guarantors: ['M004'] });

    // Both guarantors short
    ctx.as(ALICE);
    ok(g.recordSavings('M010', 'Withdrawal', 95000, 'Principal', '', '', '', ''), 'Ivy withdraws');
    ctx.as(FAY);
    const both = ok(g.checkLoanCoverage(80000, 3, ['M004', 'M010']), 'both short');
    assert.strictEqual(both.failed.length, 2);

    // The waiver covers M004 only: after approval, Ivy (M010) falling short blocks the final approval
    approveWaiver(ctx, id, [CAROL, GIL, ALICE]);
    guarantorsConsent(ctx, id);
    ctx.as(BOB);
    fails(g.approveLoanRequest(id, ''), /Guarantor M010 has Principal savings of UGX 5,000 but needs at least UGX 20,000/, 'an unwaived requirement is still enforced');
  },

  'security details are required and checked'(c) {
    const ctx = setup(c), { g } = ctx;
    fund(ctx, 'M007', 100000); fund(ctx, 'M004', 100000); fund(ctx, 'M010', 100000);
    ctx.as(FAY);
    const tryWith = o => g.requestSecuredLoan(80000, 3, 'Clinic', ['M004', 'M010'], Object.assign({}, SECURITY, o));
    const cases = [
      [{ type: '' }, 'type', /Choose the type of security/], [{ type: 'Shares' }, 'type', /Choose the type/],
      [{ type: 'Others', otherType: '' }, 'otherType', /Specify the type/],
      [{ description: '' }, 'description', /Describe the security/], [{ value: 0 }, 'value', /estimated value/],
      [{ value: -5 }, 'value', /estimated value/], [{ ownership: ' ' }, 'ownership', /ownership details/],
      [{ documents: 'http://example.com/doc' }, 'documents', /https:\/\//], [{ justification: '' }, 'justification', /why the waiver/]];
    cases.forEach(([o, field, re]) => {
      const r = tryWith(o);
      assert.ok(!r.ok && r.field === field && re.test(r.error), JSON.stringify(o) + ' -> ' + JSON.stringify(r));
    });
    assert.strictEqual(ctx.loanReqs().length, 0, 'nothing saved');
    ['Car Logbook', 'Equipment'].forEach(t => assert.ok(g._validateSecurity(Object.assign({}, SECURITY, { type: t })).ok, t));
    const id = ok(tryWith({ type: 'Others', otherType: 'Livestock (20 cattle)', documents: '' }), 'Others with a description').requestId;
    const w = ctx.waivers().find(x => x.RequestID === id);
    eq([w['Security Type'], w['Security Type (Other)'], w['Supporting Documents']], ['Others', 'Livestock (20 cattle)', '']);
  },

  'only Founder Members may ask, and the waiver lifts no other eligibility rule'(c) {
    const ctx = setup(c), { g, fakes, val } = ctx;
    fund(ctx, 'M005', 100000); fund(ctx, 'M004', 100000); fund(ctx, 'M010', 100000);
    ctx.as(EVE);
    fails(g.requestSecuredLoan(80000, 3, 'x', ['M004', 'M010'], SECURITY), /Founder Members only/, 'a Delegate Member');
    // A Founder Member who joined this month: the 12-month saving period is not waived
    fakes.sheet(val('SH_MEMBERS')).data.push(['M012', 'Joy', JOY, '', 'Member', 'Founder Member', g.today(), 'Active', '']);
    ctx.as(ALICE);
    ok(g.recordSavings('M012', 'Deposit', 10000, 'Principal', 'Monthly Premium', '', '', ''), 'Joy saves');
    ctx.as(JOY);
    fails(g.requestSecuredLoan(80000, 3, 'x', ['M004', 'M010'], SECURITY), /at least 12 months/, '12-month rule');
  },

  'a rejected waiver needs a reason, closes the request and tells the applicant why'(c) {
    const ctx = setup(c), { g } = ctx;
    const id = securedRequest(ctx);
    approveWaiver(ctx, id, [CAROL]);
    ctx.as(GIL);
    fails(g.rejectLoanWaiver(id, '  '), /reason/, 'reason required');
    const r = ok(g.rejectLoanWaiver(id, 'Title is in a relative\'s name'), 'reject');
    assert.strictEqual(r.waiverStatus, 'Waiver Rejected');
    assert.strictEqual(ctx.req(id).Status, 'Rejected');
    assert.match(ctx.req(id)['Decision Notes'], /Waiver rejected: Title is in a relative's name/);
    assert.strictEqual(ctx.waivers()[0]['Waiver Status'], 'Waiver Rejected');
    const mail = ctx.mail(/^Secured Loan Request Update/).filter(e => e.to === FAY).pop();
    eq(mail.rows.find(x => x[0] === 'Reason'), ['Reason', 'Title is in a relative\'s name']);
    eq(ctx.decisions().map(d => [d.AdminNo, d.Decision, d.Comment]),
      [['M003', 'Approved', 'Security reviewed'], ['M008', 'Rejected', 'Title is in a relative\'s name']], 'both decisions kept');
    assert.ok(ctx.audit().some(a => a.Action === 'Waiver Rejected' && /relative/.test(a.Details)));
    ctx.as(ALICE);
    fails(g.approveLoanWaiver(id, ''), /already been decided/, 'cannot approve after rejection');
    assert.strictEqual(ctx.guarantors().filter(x => x.RequestID === id).length, 0, 'guarantors never asked');
  },

  'a committee member cannot decide their own secured request; committee roles are set by admins'(c) {
    const ctx = setup(c), { g } = ctx;
    fund(ctx, 'M001', 100000); fund(ctx, 'M004', 100000); fund(ctx, 'M010', 100000);
    ctx.as(ALICE);  // the Chairperson applies
    const id = ok(g.requestSecuredLoan(80000, 3, 'x', ['M004', 'M010'], SECURITY), 'Alice applies').requestId;
    fails(g.approveLoanWaiver(id, ''), /your own loan request/, 'self-approval');
    fails(g.rejectLoanWaiver(id, 'x'), /your own loan request/, 'self-rejection');
    assert.ok(!ctx.mail(/^Waiver approval needed/).some(e => e.to === ALICE), 'the applicant is not asked to approve');
    // Seen by another committee admin: the view says who may act
    ctx.as(CAROL);
    const view = ok(g.getLoanRequests(), 'list').requests.find(r => r.requestId === id);
    assert.ok(view.secured && view.waiver.approveBlock === '' && view.waiver.stillNeeded.indexOf('Chairperson') > -1);
    assert.strictEqual(view.waiver.security.verified, false, 'declared value shown as not verified');

    // Committee roles
    ctx.as(BOB);
    fails(g.updateMember('M005', 'Member', 'Delegate Member', 'Active', '', 'Treasurer'), /Committee role must be/, 'unknown role');
    ok(g.updateMember('M002', 'Admin', 'Founder Member', 'Active', '', 'Chairperson'), 'Bob made Chairperson');
    assert.ok(ctx.audit().some(a => a.Action === 'Member Updated' && /Committee role: none -> Chairperson/.test(a.Details)));
    ok(g.updateMember('M002', 'Admin', 'Founder Member', 'Active', ''), 'older callers leave the committee role alone');
    assert.strictEqual(g._memberByNo('M002')['Committee Role'], 'Chairperson');
    ok(g.approveLoanWaiver(id, ''), 'Bob can now approve as Chairperson');
    ctx.as(FAY);
    const mine = ok(g.getMyLoanRequests(), 'mine').requests.find(r => r.requestId === id);
    assert.strictEqual(mine, undefined, 'members see only their own requests');
    ctx.as(ALICE);
    const own = ok(g.getMyLoanRequests(), 'own').requests.find(r => r.requestId === id);
    eq([own.waiver.status, own.waiver.approvals, own.waiver.required], ['Partially Approved', 1, 3]);
  }
};
