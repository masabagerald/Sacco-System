// Terms of use: on first sign-in every user accepts the Terms of Use, and every Admin also the
// Administrator Agreement. Until then the server refuses every request. Acceptances (and declines) are
// recorded with the document version; a new version, or becoming an Admin, asks again.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, DAN } = EMAIL;
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

function setup(c) {
  const ctx = seed(c);
  ctx.docs = () => ctx.g._termsDocuments();
  ctx.terms = () => { const s = ctx.fakes.sheet(ctx.val('SH_TERMS')); return s ? s.records('memberno') : []; };
  return ctx;
}

module.exports = {
  'a member must accept the Terms of Use before anything else works'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.signInWithoutTerms(DAN);
    const st = ok(g.getTermsStatus(), 'status');
    eq([st.required, st.documents.map(d => d.key)], [true, ['use']], 'members see the Terms of Use only');
    assert.ok(st.documents[0].sections.length > 3 && /Terms of Use/.test(st.documents[0].title));
    const blocked = g.getMySavings();
    assert.ok(!blocked.ok && blocked.termsRequired && /accept the Terms of Use/.test(blocked.error), JSON.stringify(blocked));
    fails(g.requestWithdrawal(1000, 'Dividends', '', 'Principal'), /accept the Terms of Use/, 'no request before accepting');
    fails(g.acceptTerms({}), /tick the box for: Terms of Use/, 'box not ticked');
    fails(g.acceptTerms({ use: '0' }), /terms have been updated/, 'an out-of-date version');
    ok(g.acceptTerms({ use: ctx.docs().use.version }), 'accept');
    ok(g.getMySavings(), 'now allowed');
    const row = ctx.terms().find(r => r.MemberNo === 'M004');
    eq([row.Document, row.Version, row.Decision, row.Email], ['use', ctx.docs().use.version, 'Accepted', DAN]);
    assert.match(String(row.Timestamp), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'time of acceptance kept');
    assert.ok(ctx.audit().some(a => a.Action === 'Terms Accepted' && a['Member (Affected)'] === 'M004'));
    eq(ok(g.getTermsStatus(), 'after').required, false);
    ok(g.acceptTerms({ use: ctx.docs().use.version }), 'accepting again is harmless');
    assert.strictEqual(ctx.terms().filter(r => r.MemberNo === 'M004').length, 1, 'recorded once');
  },

  'an admin must also accept the Administrator Agreement'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.signInWithoutTerms(ALICE);
    eq(ok(g.getTermsStatus(), 'status').documents.map(d => d.key), ['use', 'admin']);
    fails(g.acceptTerms({ use: ctx.docs().use.version }), /tick the box for: Administrator Confidentiality and Conduct Agreement/, 'both needed');
    fails(g.getAdminDashboard(), /accept the Terms of Use and Administrator/, 'admin screens refused');
    ok(g.acceptTerms({ use: ctx.docs().use.version, admin: ctx.docs().admin.version }), 'accept both');
    ok(g.getAdminDashboard(), 'admin screens allowed');
    eq(ctx.terms().filter(r => r.MemberNo === 'M001').map(r => r.Document), ['use', 'admin']);
  },

  'a member made Admin is asked to accept the Administrator Agreement'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.signInWithoutTerms(DAN);
    ok(g.acceptTerms({ use: ctx.docs().use.version }), 'Dan accepts as a member');
    ctx.fakes.signInAs(BOB);
    ok(g.updateMember('M004', 'Admin', 'Founder Member', 'Active', ''), 'Dan made Admin');
    ctx.signInWithoutTerms(DAN);
    const st = ok(g.getTermsStatus(), 'status');
    eq(st.documents.map(d => [d.key, !!d.acceptedAt]), [['use', true], ['admin', false]], 'only the new agreement is outstanding');
    fails(g.getAdminDashboard(), /Administrator Confidentiality/, 'refused until accepted');
    ok(g.acceptTerms({ admin: ctx.docs().admin.version }), 'accept');
    ok(g.getAdminDashboard(), 'allowed');
  },

  'a new version must be accepted again; earlier acceptances stay on record'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.signInWithoutTerms(DAN);
    ok(g.acceptTerms({ use: ctx.docs().use.version }), 'v1');
    const original = g._termsDocuments;
    g._termsDocuments = () => { const d = original(); d.use.version = '2'; return d; };
    fails(g.getMySavings(), /accept the Terms of Use/, 'new version needed');
    ok(g.acceptTerms({ use: '2' }), 'v2');
    ok(g.getMySavings(), 'allowed again');
    eq(ctx.terms().filter(r => r.MemberNo === 'M004').map(r => r.Version), ['1', '2'], 'both acceptances kept');
  },

  'declining is recorded and signs the user out; nobody can accept for someone else'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    ctx.signInWithoutTerms(DAN);
    ok(g.declineTerms(), 'decline');
    eq(ctx.terms().map(r => [r.MemberNo, r.Document, r.Decision]), [['M004', 'use', 'Declined']]);
    assert.ok(ctx.audit().some(a => a.Action === 'Terms Declined'));
    fails(g.getMySavings(), /accept the Terms of Use/, 'still refused');
    ctx.signInWithoutTerms('stranger@x.org');
    fails(g.getTermsStatus(), /not registered/, 'not a member');
    fails(g.acceptTerms({ use: '1' }), /not registered/, 'not a member');
    fakes.signInAs('');
    fails(g.getTermsStatus(), /Session expired/, 'not signed in');
  }
};
