// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const SACCO_NAME         = 'Mbale School of clinical officers Investment Club';
const BRAND_COLOR        = '#143452'; // navy from the club seal
const LOAN_TO_SAVINGS_LIMIT = 0.5; // max loan = this × member savings (Article 4, Section 2: 50%)
const OTP_EXPIRY_MS      = 10 * 60 * 1000; // 10 minutes

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
const GUARANTOR_MIN_COUNT        = 2;     // Sec 4
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
const WITHDRAWAL_REASONS = ['Exit from MSIC', 'Dividends', 'Welfare', 'Operations', 'Others'];

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
// Membership types that may request a withdrawal from their deposit accounts.
// Add 'Delegate Member' here if the committee extends the privilege to Delegates.
const WITHDRAWAL_MEMBERSHIP_TYPES = ['Founder Member'];

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
