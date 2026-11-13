// ── IDENTITY / SESSION HELPERS ────────────────────────────────────────────────

// Internal: look up member by email
function lookupMember_(email) {
  email = String(email||'').trim().toLowerCase();
  const { rows } = readSheet_(SH_MEMBERS, 'memberno');
  const m = rows.find(r => String(r['Email']||'').trim().toLowerCase() === email);
  if (!m) return { ok: false, notRegistered: true, error: 'The email ' + email + ' is not registered with ' + SACCO_NAME + '. Please contact the treasurer.' };
  if (String(m['Status']||'').trim().toLowerCase() !== 'active') return { ok: false, error: 'Your account is not active. Please contact the treasurer.' };
  return { ok: true, member: makeMemberRecord(m) };
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────
// The web app runs as the deploying account (executeAs USER_DEPLOYING), so PropertiesService's *user*
// properties are that one account's store, shared by every visitor -- they cannot hold a sign-in. And
// Session.getActiveUser() is blank for visitors outside the deployer's Workspace domain (always, for a
// gmail.com deployer). So a sign-in is a random token: kept server-side in the script cache (email, with
// an expiry) and held by the page in memory, which sends it with every call through rpc() below.
const SESSION_TTL_S = 6 * 60 * 60;   // CacheService maximum; renewed on every request
const OTP_MAX_ATTEMPTS = 5;

// The token sent with the request being served (set by rpc; each google.script.run call is its own execution)
var REQUEST_SESSION_TOKEN_ = '';

function startSession_(email) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, email, SESSION_TTL_S);
  return token;
}

function sessionEmail_(token) {
  token = String(token || '');
  if (!/^[0-9a-f-]{72}$/i.test(token)) return '';
  const cache = CacheService.getScriptCache();
  const email = cache.get('sess_' + token) || '';
  if (email) cache.put('sess_' + token, email, SESSION_TTL_S);
  return email;
}

function endSession_() {
  if (REQUEST_SESSION_TOKEN_) CacheService.getScriptCache().remove('sess_' + REQUEST_SESSION_TOKEN_);
}

// The single entry point the page calls: rpc(token, 'getMySavings', []). Only public functions can be
// reached -- names starting or ending with '_' (helpers), the web-app/trigger entry points and setup are refused.
const RPC_BLOCKED = ['rpc', 'doGet', 'doPost', 'include', 'setupNewClub', 'setupGuaranteeSchema', 'createAllTriggers',
  'sendMonthlyStatements', 'sendRepaymentReminders', 'processLoanDueDates', 'backupSpreadsheet', 'sendPendingActionReminders', 'checkCapacity'];
function rpc(token, fnName, args) {
  fnName = String(fnName || '');
  const fn = globalThis[fnName];
  // Built-ins (eval, Function, ...) are native code: only functions written in this project can be called
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(fnName) || RPC_BLOCKED.indexOf(fnName) > -1 || typeof fn !== 'function' ||
      /\[native code\]/.test(Function.prototype.toString.call(fn))) {
    throw new Error('Unknown action: ' + fnName);
  }
  REQUEST_SESSION_TOKEN_ = String(token || '');
  const t0 = Date.now();
  try { return fn.apply(null, Array.isArray(args) ? args : []); }
  finally { noteCallTime_(fnName, Date.now() - t0); }   // slow requests feed the capacity watch (CapacityService.gs)
}

// Guards every protected function: the signed-in member, who must also have accepted the current terms
// (TermsService.gs). Until then every request is refused with termsRequired, whatever the page does.
function caller_() {
  const r = signedInMember_();
  if (!r.ok) return r;
  const missing = termsMissing_(r.member);
  if (missing.length) {
    const docs = termsDocuments_();
    return { ok: false, termsRequired: true, error: 'Please read and accept the ' + missing.map(k => docs[k].title).join(' and ') + ' to continue.' };
  }
  return r;
}

// The signed-in member, from the Google session or the stored session (terms not checked)
function signedInMember_() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail()||'').trim().toLowerCase(); } catch(e) {}
  if (!email) email = sessionEmail_(REQUEST_SESSION_TOKEN_);
  if (!email) return { ok: false, error: 'Session expired. Please sign in again.' };
  return lookupMember_(email);
}

function adminCaller_() {
  const r = caller_();
  if (!r.ok) return r;
  if (r.member.role.toLowerCase() !== 'admin') return { ok: false, error: 'Admin access required.' };
  return r;
}

// Loan Insights: admins get the full view (level 'admin'); members whose membership type is in
// INSIGHTS_MEMBERSHIP_TYPES get the read-only aggregate view (level 'aggregate'); everyone else is refused.
// Membership type grants this view only -- it never grants admin actions.
function insightsCaller_() {
  const r = caller_();
  if (!r.ok) return r;
  if (r.member.role.toLowerCase() === 'admin') return Object.assign({}, r, { level: 'admin' });
  if (INSIGHTS_MEMBERSHIP_TYPES.indexOf(String(r.member.membershipType || '').trim()) > -1) return Object.assign({}, r, { level: 'aggregate' });
  return { ok: false, error: 'Loan Insights are available to administrators and Founder Members only.' };
}
