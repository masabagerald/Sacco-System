// ── LOAN MODEL ───────────────────────────────────────────────────────────────
const LOAN_STATUS = { ACTIVE: 'Active', CLEARED: 'Cleared' };

// Validates the inputs for issuing a brand-new loan.
// Eligibility (Article 4) is checked via _loanEligibility, the savings cap via _checkLimit.
function validateLoanIssue(principal) {
  if (principal <= 0) return { ok: false, error: 'Principal must be greater than zero.' };
  return { ok: true };
}
