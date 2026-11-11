// ── LOAN MODEL ───────────────────────────────────────────────────────────────
const LOAN_STATUS = { ACTIVE: 'Active', CLEARED: 'Cleared' };

// Validates the inputs for issuing a brand-new loan.
// Eligibility (Article 4) is checked via loanEligibility_, the savings cap via checkLimit_.
function validateLoanIssue(principal) {
  if (principal <= 0) return { ok: false, error: 'Principal must be greater than zero.' };
  return { ok: true };
}
