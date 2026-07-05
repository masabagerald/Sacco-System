// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const SACCO_NAME         = 'Kira SACCO';
const BRAND_COLOR        = '#1F5C3B';
const LOAN_TO_SAVINGS_LIMIT = 3;   // max loan = this × member savings
const OTP_EXPIRY_MS      = 10 * 60 * 1000; // 10 minutes

// Sheet tab names — must match exactly
const SH_MEMBERS   = 'Members';
const SH_SAVINGS   = 'Savings';
const SH_LOANS     = 'Loans';
const SH_REPAY     = 'Loan Repayments';
const SH_FINES     = 'Fines';
const SH_LOAN_REQ  = 'Loan Requests';
const SH_WD_REQ    = 'Withdrawal Requests';
const SH_AUDIT     = 'Audit Log';
