// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const SACCO_NAME         = 'Mbale School of clinical officers Investment Club';
const BRAND_COLOR        = '#143452'; // navy from the club seal
const LOAN_TO_SAVINGS_LIMIT = 0.5; // max loan = this × member savings (Article 4, Section 2: 50%)
const OTP_EXPIRY_MS      = 10 * 60 * 1000; // 10 minutes

// Loan rules (Article 4 of the SACCO by-laws)
const FLAT_INTEREST_RATE         = 0.10;  // Sec 10: 10% flat on principal, charged on transfer
const PROCESSING_FEE             = 5000;  // Sec 11: added to the debt on transfer
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
