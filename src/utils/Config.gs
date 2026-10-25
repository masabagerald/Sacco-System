// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// Club identity: change these (and CLUB_LOGO_B64 in Branding.gs) when setting the app up for a new club.
// See README → "Setting up for a new club".
const SACCO_NAME         = 'Mbale School of Clinical Officers Investment Club';  // web page titles, emails, PDFs
const CLUB_SHORT_NAME    = 'MSIC';      // member numbers (MSIC-0001), export file names, "Exit from MSIC"
const MEMBER_NO_PREFIX   = CLUB_SHORT_NAME + '-';
const BRAND_COLOR        = '#143452'; // navy from the club seal
const LOAN_TO_SAVINGS_LIMIT = 0.5; // max loan = this × member savings (Article 4, Section 2: 50%)
const OTP_EXPIRY_MS      = 10 * 60 * 1000; // 10 minutes

// Reference numbers: CODE-000001. Every record type has its own code and counter; the next number
// continues from the highest existing one, so references made before this format (L007, AST-0003, ...)
// stay valid and are never reused. legacy: the prefix used before, so its numbers are counted too.
const REF_DIGITS = 6;
const REF_CODES = {
  loan:         { code: 'LN',  legacy: 'L' },    // LN-000001   loans
  loanRequest:  { code: 'LRQ', legacy: 'R' },    // LRQ-000001  loan requests
  withdrawal:   { code: 'WRQ', legacy: 'W' },    // WRQ-000001  withdrawal requests
  surcharge:    { code: 'SUR', legacy: 'F' },    // SUR-000001  surcharges
  fundEntry:    { code: 'LFE', legacy: 'LF' },   // LFE-000001  loan fund ledger entries
  investment:   { code: 'INV', legacy: 'INV' },  // INV-000001  investments
  investmentTx: { code: 'IVT', legacy: 'IT' },   // IVT-000001  investment transactions
  asset:        { code: 'AST', legacy: 'AST-' }, // AST-000001  assets
  deposit:      { code: 'DEP' },                 // DEP-000001  savings deposits
  savingsOut:   { code: 'WDL' },                 // WDL-000001  savings withdrawals
  reversal:     { code: 'REV' },                 // REV-000001  savings reversals
  repayment:    { code: 'RPY' }                  // RPY-000001  loan repayments
};

// Loan rules (Article 4 of the SACCO by-laws)
const FLAT_INTEREST_RATE         = 0.10;  // Sec 10: 10% flat on principal, charged on transfer
const PROCESSING_FEE             = 10000; // processing fee on every loan (UGX), added to the debt
const ARTICLE4_FEE               = 5000;  // fee on earlier Article 4 loans (kept so they still calculate)

// Repayment terms for new loans: interest rate by term. One payment, due on the due date.
const LOAN_TERMS = [
  { key: '1w', label: '1 week',  days: 7,  rate: 0.05 },
  { key: '2w', label: '2 weeks', days: 14, rate: 0.10 },
  { key: '3w', label: '3 weeks', days: 21, rate: 0.15 },
  { key: '1m', label: '1 month', days: 30, rate: 0.15 }
];
function _termByKey(key) { return LOAN_TERMS.find(t => t.key === String(key||'').trim()) || null; }
const LOAN_FIRST_INSTALMENT_DAYS = 28;    // Sec 13: first instalment at week 4
const LOAN_DURATION_DAYS         = 56;    // Sec 12/13: everything due by week 8
const LATE_PENALTY_RATE          = 0.10;  // Sec 14: 10% if unpaid at week 8
const GUARANTOR_COUNT            = 2;     // Sec 4: every loan, all membership types, needs exactly two
const GUARANTOR_SAVINGS_RATIO    = 0.25;  // Sec 3: guarantor savings >= 25% of loan
const DECISION_WINDOW_DAYS       = 3;     // Sec 9: committee decides within 3 days


// Sheet tab names — must match exactly
const SH_MEMBERS   = 'Members';
const SH_SAVINGS   = 'Savings';
const SH_LOANS     = 'Loans';
const SH_REPAY     = 'Loan Repayments';
const SH_FINES     = 'Surcharge';
const SH_LOAN_REQ  = 'Loan Requests';
const SH_GUARANTORS = 'Guarantors';
const SH_GUARANTOR_NOTICES = 'Guarantor Notifications';
const SH_WD_REQ    = 'Withdrawal Requests';
const SH_AUDIT     = 'Audit Log';

// ── PROPERTIES SERVICE WRAPPER ────────────────────────────────────────────────
// Centralizes script/user property access so callers don't touch PropertiesService directly.
const Config = {
  getScriptProp(key)        { return PropertiesService.getScriptProperties().getProperty(key); },
  setScriptProp(key, value) { PropertiesService.getScriptProperties().setProperty(key, value); },
  deleteScriptProp(key)     { PropertiesService.getScriptProperties().deleteProperty(key); },

  getUserProp(key)        { try { return PropertiesService.getUserProperties().getProperty(key); } catch(e) { return null; } },
  setUserProp(key, value) { try { PropertiesService.getUserProperties().setProperty(key, value); } catch(e) {} },
  deleteUserProp(key)     { try { PropertiesService.getUserProperties().deleteProperty(key); } catch(e) {} }
};

// Reasons a member can give for a savings withdrawal request
const WITHDRAWAL_REASONS = ['Exit from ' + CLUB_SHORT_NAME, 'Dividends', 'Welfare', 'Operations', 'Others'];

// Categories a deposit must be filed under
const PAYMENT_CATEGORIES = ['Membership Fee', 'Annual Subscription Fee', 'Monthly Premium', 'Operations Fee', 'Welfare Fee', 'Surcharge'];
const SURCHARGE_REASONS = ['Surcharge on Unpaid Premium', 'Surcharge on Unpaid Loan', 'Surcharge on Unpaid Loan Balance', 'Surcharge on Unpaid Interest'];

// Membership type: a member's business privileges (separate from Role, which is login/admin access)
const MEMBERSHIP_TYPES = ['Founder Member', 'Delegate Member', 'Non-Member'];

// Deposit accounts: each member's deposits are held in three accounts with separate balances.
const DEPOSIT_ACCOUNTS = ['Principal', 'Operations', 'Welfare'];
// Payment categories that may be filed under each account. Rows saved before accounts existed
// are placed by their category; anything not listed under Operations or Welfare is Principal.
const ACCOUNT_CATEGORIES = {
  Principal:  ['Membership Fee', 'Annual Subscription Fee', 'Monthly Premium', 'Surcharge'],
  Operations: ['Operations Fee'],
  Welfare:    ['Welfare Fee']
};
// Membership types that may request a withdrawal (from any of the three accounts).
const WITHDRAWAL_MEMBERSHIP_TYPES = ['Founder Member', 'Delegate Member'];
// Club pools: withdrawals from these are limited by the club-wide balance of the account
// (all contributions less all withdrawals), not by what the member personally paid in.
// Principal is individual savings: a member can withdraw only their own Principal balance.
const POOLED_ACCOUNTS = ['Operations', 'Welfare'];

// Savings ledger transaction types. Corrections never edit a row: they add a reversal row
// (linked by the Reverses column) and, for a correction, a replacement row.
const TX_DEPOSIT = 'Deposit';
const TX_WITHDRAWAL = 'Withdrawal';
const TX_DEPOSIT_REVERSAL = 'Deposit Reversal';
const TX_WITHDRAWAL_REVERSAL = 'Withdrawal Reversal';

// Founder/Delegate loans (this spec): 10% interest, minimum 2 months, UGX 5,000 fee
const MEMBER_LOAN_RATE = 0.10;
const MEMBER_LOAN_MIN_MONTHS = 2;
const MEMBER_LOAN_FEE = 5000;

// Overdue rule (all single-due-date loans: Founder/Delegate Member loans and Non-Member Soft Loans)
const OVERDUE_SURCHARGE_RATE = 0.10;       // 10% on principal+interest once the due date is missed
const OVERDUE_REMINDER_DAYS_BEFORE = 3;    // reminder 3 days before the due date
const OVERDUE_MAX_DAILY_NOTICE_DAYS = 14;  // daily overdue notices stop after 2 weeks

// ── SECURED LOANS & CONSTITUTIONAL WAIVERS (ISS-11) ───────────────────────────
// A Founder Member who does not meet a savings coverage requirement (the applicant's loan cap,
// LOAN_TO_SAVINGS_LIMIT, or a guarantor's GUARANTOR_SAVINGS_RATIO) may ask for a loan secured by an
// asset. The waiver covers only the coverage requirements that failed; every other rule still applies.
const SH_WAIVERS          = 'Loan Waivers';       // one row per secured-loan request: security and eligibility snapshot
const SH_WAIVER_DECISIONS = 'Waiver Decisions';   // append-only: each administrator's approval or rejection
const SECURED_LOAN_MEMBERSHIP_TYPES = ['Founder Member'];
const SECURITY_TYPES = ['Land Title', 'Car Logbook', 'Equipment', 'Others'];
// Committee role (Members sheet, "Committee Role"): which approval group an administrator belongs to.
// Set per member by an admin; nobody is hardcoded. Only an active Admin with a committee role may decide a waiver.
const COMMITTEE_ROLES = ['Finance Committee', 'Chairperson'];
// Approvals a waiver needs: at least WAIVER_APPROVALS_REQUIRED different administrators, including at
// least this many from each group. Each administrator counts once, for their own group.
// BUSINESS DECISION TO CONFIRM: the split below (Chairperson 1 + Finance Committee 2) is an assumption.
const WAIVER_APPROVALS_REQUIRED = 3;
const WAIVER_ROLE_MINIMUMS = { 'Chairperson': 1, 'Finance Committee': 2 };
// Waiver status (on the Loan Waivers row). The loan request itself is "Pending Waiver Approval" until the
// waiver is approved, then "Pending" (the usual guarantor-consent and two-admin stage), or "Rejected".
const WAIVER_STATUS = { PENDING: 'Pending Waiver Approval', PARTIAL: 'Partially Approved', APPROVED: 'Waiver Approved', REJECTED: 'Waiver Rejected' };
const REQ_PENDING_WAIVER = 'Pending Waiver Approval';

// ── ASSET REGISTER (ISS-12) ───────────────────────────────────────────────────
// Admins only. Every new asset, and every material change to one, must be verified by a different admin.
const SH_ASSETS        = 'Assets';          // one row per asset: its current details
const SH_ASSET_REVIEWS = 'Asset Reviews';   // append-only: each verification or rejection
const SH_ASSET_HISTORY = 'Asset History';   // append-only: every change, with the previous and new value
const ASSET_TYPES = ['Computers', 'Printers', 'Furniture', 'Vehicles', 'Equipment', 'Other'];  // 'Other' needs the type written in
// Condition and availability are separate: a functional asset can be in use; a disposed asset keeps its last condition.
const ASSET_CONDITIONS = ['Functional', 'Non-functional'];
const ASSET_AVAILABILITY = ['Available', 'In Use', 'Unavailable', 'Disposed Off'];
const ASSET_DISPOSED = 'Disposed Off';
const ASSET_VERIFICATION = { PENDING: 'Pending Verification', VERIFIED: 'Verified', REJECTED: 'Rejected' };
const ASSET_PAGE_SIZE = 25;

// ── LOAN INSIGHTS & INVESTMENT TRACKER ────────────────────────────────────────
const SH_LOAN_FUND   = 'Loan Fund Ledger';
const SH_INVESTMENTS = 'Investments';
const SH_INV_TX      = 'Investment Transactions';

// Loan Insights: admins see everything; these membership types (without the Admin role) get a
// read-only, aggregate-only view. Everyone else is refused.
const INSIGHTS_MEMBERSHIP_TYPES = ['Founder Member'];

// Repayments are stored as one total per payment. For reporting, each payment is applied to the
// loan's charges in this order. A charge only takes money paid on or after the date it was charged.
const REPAYMENT_ALLOCATION_ORDER = ['fee', 'interest', 'penalty', 'principal'];

// The loan fund's capital is the club-wide Principal savings balance (deposits in, withdrawals out).
// The Loan Fund Ledger holds only the cash movements no other sheet records. Each entry needs two
// admin approvals and counts only once Approved. +1 adds to available loan cash, -1 takes from it.
const FUND_ENTRY_SIGNS = { 'Cash Injection': 1, 'Other Outflow': -1, 'Transfer from Investment': 1, 'Transfer to Investment': -1 };
const FUND_MANUAL_TYPES = ['Cash Injection', 'Other Outflow'];  // the transfer types are created with an investment transaction
const ENTRY_REVERSAL = 'Reversal';

const INVESTMENT_TYPES = ['Unit Trust', 'Fixed Deposit', 'Treasury Bill', 'Treasury Bond', 'Other'];
const INVESTMENT_STATUSES = ['Active', 'Matured', 'Closed'];
const INVESTMENT_CURRENCY = 'UGX';  // only UGX is supported: totals have no exchange-rate rule
// Investment transactions (each needs two admin approvals, like loan fund entries)
const INV_TX_TYPES = ['Initial Investment', 'Additional Contribution', 'Redemption', 'Income Earned', 'Income Received',
  'Income Reinvested', 'Fee', 'Tax', 'Valuation'];
// Where a fee or tax was paid from: deducted from the investment's balance (lowers its value), or paid separately
const INV_COST_SOURCES = ['Investment balance', 'Paid separately'];
const MATURITY_WINDOW_DAYS = 90;  // "upcoming maturities" on the investment dashboard
