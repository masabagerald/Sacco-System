// Sign-in sessions. The web app runs as the deploying account, so Session.getActiveUser() is blank for
// ordinary visitors and user properties are one store shared by everyone. A sign-in is therefore a token
// the page holds and sends with every call through rpc(); without it, nothing is returned.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, DAN, EVE } = EMAIL;

// Signs in by emailed code, as a visitor whose Google account the app cannot see; returns the token
function otpSignIn(ctx, email) {
  ctx.fakes.signInAs(email);          // records terms acceptance for this member (fixtures)
  ctx.fakes.signInAs('');             // ...but the app cannot see the visitor's Google account
  ok(ctx.g.sendOtp(email), 'send code');
  const code = JSON.parse(ctx.val('Config').getScriptProp('otp_' + email)).code;
  const r = ok(ctx.g.verifyOtp(email, code), 'verify');
  assert.ok(r.sessionToken, 'a token is returned');
  return r.sessionToken;
}

module.exports = {
  'each visitor keeps their own sign-in; no token, no access'(c) {
    const ctx = seed(c), { g } = ctx;
    const dan = otpSignIn(ctx, DAN), eve = otpSignIn(ctx, EVE);
    assert.strictEqual(ok(g.rpc(dan, 'getCurrentMember', []), 'dan').member.email, DAN, 'Dan is still Dan after Eve signs in');
    assert.strictEqual(ok(g.rpc(eve, 'getCurrentMember', []), 'eve').member.email, EVE);
    fails(g.rpc('', 'getMySavings', []), /Session expired/, 'no token');
    fails(g.rpc('0'.repeat(72), 'getMySavings', []), /Session expired/, 'made-up token');
    fails(g.getMySavings(), /Session expired/, 'calling a function directly carries no sign-in');
    ok(g.rpc(dan, 'logout', []), 'logout');
    fails(g.rpc(dan, 'getMySavings', []), /Session expired/, 'signed out');
    ok(g.rpc(eve, 'getMySavings', []), 'Eve is unaffected by Dan signing out');
  },

  'auto-detect signs in only the Google account the server sees, never an email from the page'(c) {
    const ctx = seed(c), { g } = ctx;
    ctx.fakes.signInAs(ALICE); ctx.fakes.signInAs('');
    fails(g.confirmAutoDetect(ALICE), /could not be detected/, 'a page-supplied email is ignored');
    ctx.fakes.signInAs(DAN);
    const r = ok(g.confirmAutoDetect(ALICE), 'detected');
    assert.strictEqual(r.member.email, DAN, 'signed in as the detected account, not the one asked for');
  },

  'a code is refused after too many wrong guesses'(c) {
    const ctx = seed(c), { g } = ctx;
    ctx.fakes.signInAs('');
    ok(g.sendOtp(DAN), 'send');
    const code = JSON.parse(ctx.val('Config').getScriptProp('otp_' + DAN)).code;
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 4; i++) fails(g.verifyOtp(DAN, wrong), /Incorrect code/);
    fails(g.verifyOtp(DAN, wrong), /Too many incorrect codes/);
    fails(g.verifyOtp(DAN, code), /No code found/, 'the right code no longer works');
  },

  'rpc reaches public functions only'(c) {
    const ctx = seed(c), { g } = ctx;
    ['_lookupMember', 'startSession_', 'doGet', 'setupNewClub', 'sendMonthlyStatements', 'rpc', 'eval', 'Function', 'parseInt', 'nope', 'constructor.x']
      .forEach(fn => assert.throws(() => g.rpc('', fn, [ALICE]), /Unknown action/, fn));
    assert.strictEqual(g.rpc('', 'tryAutoDetect', []).detected, false);
  }
};
