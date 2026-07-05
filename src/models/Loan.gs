// ── LOAN MODEL ───────────────────────────────────────────────────────────────
const LOAN_STATUS = { ACTIVE: 'Active', CLEARED: 'Cleared' };

// Validates the inputs for issuing a brand-new loan.
// The loan-to-savings limit is a separate business rule, checked via _checkLimit.
function validateLoanIssue(principal, monthlyRate) {
  if (principal <= 0) return { ok: false, error: 'Principal must be greater than zero.' };
  if (monthlyRate < 0) return { ok: false, error: 'Interest rate cannot be negative.' };
  return { ok: true };
}
