## Data volume per tier

| Tier (members × years) | Rows, all tabs | Savings rows | Used cells | Grid cells as the app creates tabs (A–Z) | Fits in 10M cells? |
|---|---:|---:|---:|---:|---|
| 50 × 6 mo | 5,209 | 1,716 | 0.05M | 0.58M | yes |
| 50 × 1 y | 10,445 | 3,432 | 0.09M | 0.68M | yes |
| 75 × 1 y | 15,630 | 5,226 | 0.14M | 0.80M | yes |
| 100 × 1 y | 20,758 | 6,942 | 0.19M | 0.92M | yes |
| 100 × 3 y | 62,544 | 20,826 | 0.56M | 1.93M | yes |
| 100 × 5 y | 104,330 | 34,710 | 0.94M | 2.99M | yes |
| 250 × 1 y | 56,275 | 17,472 | 0.51M | 1.77M | yes |

## Estimated Apps Script time per operation, seconds (central estimate; ≈ extrapolated; bold ≥ 10 s)

| Operation | 50 × 6 mo | 50 × 1 y | 75 × 1 y | 100 × 1 y | 100 × 3 y | 100 × 5 y | 250 × 1 y |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sign-in check on every request (getCurrentMember) | 0.77 | 0.76 | 0.76 | 0.78 | 0.77 | 0.77 | 0.81 |
| My savings (getMySavings) | 1.35 | 1.57 | 1.85 | 2.43 | 4.32 | 7.83 | 4.31 |
| My loans (getMyLoans) | 0.89 | 0.92 | 0.95 | 1.02 | 1.33 | 2.19 | 1.49 |
| Member home page: 5 calls in parallel (slowest) | 1.33 | 1.55 | 1.85 | 2.25 | 4.22 | 7.92 | 4.70 |
| Member statement data (getMemberStatementData, before PDF) | 2.49 | 2.77 | 3.21 | 3.59 | 6.47 | **10.8** | 6.10 |
| Admin dashboard (getAdminDashboard) | 1.73 | 2.45 | 3.38 | 5.04 | **15.5** | **43.8** | **24.5** |
| Members list with balances (getAllMembersSummary) | **13.8** | **23.7** | **53.8** | **103** | ≈**309** | **>360 (fails)** | **>360 (fails)** |
| Loan requests list (getLoanRequests) | **16.4** | **57.5** | **127** | **237** | **>360 (fails)** | **>360 (fails)** | **>360 (fails)** |
| Active loans / portfolio (getActiveLoans) | 1.12 | 1.33 | 1.48 | 1.94 | 6.54 | **22.5** | 9.10 |
| Repayments list (getRepayments) | 0.88 | 0.90 | 0.93 | 0.99 | 1.15 | 1.65 | 1.24 |
| Withdrawal requests (getWithdrawalRequests) | 1.37 | 2.23 | 3.12 | 5.61 | **45.3** | **143** | **26.0** |
| Surcharges list (getAllFinesForAdmin) | 3.23 | 5.69 | 8.52 | **11.6** | **33.9** | **55.0** | **35.1** |
| Admin page: 7 calls in parallel (slowest) | **16.4** | **57.5** | **127** | **237** | **>360 (fails)** | **>360 (fails)** | **>360 (fails)** |
| Savings ledger, unfiltered (getSavingsTransactions) | 1.10 | 1.38 | 1.67 | 2.02 | 4.36 | 6.08 | 3.75 |
| Loan Insights, all time (getLoanInsights) | 1.32 | 1.92 | 2.33 | 2.99 | **13.3** | **27.9** | **12.3** |
| Loan fund trace, all time (getLoanFundLedger) | 1.32 | 1.85 | 2.33 | 3.21 | **14.1** | **25.0** | **12.7** |
| Audit log, first page (getAuditLog) | 1.09 | 1.16 | 1.23 | 1.34 | 1.73 | 2.10 | 1.70 |
| Ledger CSV export (exportAdminCSV) | **14.2** | **26.0** | **55.5** | **112** | ≈**336** | **>360 (fails)** | **>360 (fails)** |
| Post a deposit (recordSavings) | 2.37 | 2.97 | 3.52 | 4.30 | 9.78 | **13.8** | 7.81 |
| Post a loan repayment (recordRepayment) | 3.41 | 3.60 | 3.74 | 3.98 | 5.55 | 6.71 | 5.45 |
| Member requests a withdrawal (requestWithdrawal) | 4.06 | 4.32 | 4.57 | 4.92 | 7.11 | 8.96 | 6.32 |
| Member requests a loan (requestLoan) | 7.02 | 8.32 | 9.43 | **11.6** | **67.3** | **56.4** | **28.2** |
| Final loan approval, issues the loan (approveLoanRequest) | 7.68 | **10.7** | **28.6** | **35.5** | **99.1** | ≈**279** | **65.7** |
| Record a surcharge (issueFine) | 3.42 | 5.24 | 5.44 | 5.79 | **10.1** | **13.3** | 7.93 |
| Monthly statements job (sendMonthlyStatements) | **32.9** | **44.3** | **81.8** | **148** | **>360 (fails)** | **>360 (fails)** | **>360 (fails)** |
| Daily due-date job (processLoanDueDates) | 1.39 | 1.87 | 2.63 | 4.51 | **15.4** | **17.9** | **16.9** |
| Daily pending-action reminders (sendPendingActionReminders_) | 0.50 | 0.55 | 0.59 | 0.67 | 1.40 | 1.54 | 1.15 |
| Daily repayment reminders (sendRepaymentReminders_) | 0.21 | 0.32 | 0.45 | 0.80 | 9.36 | **18.9** | 5.19 |

## Range for the key operations (low – high cost assumptions), seconds

| Operation | 50 × 6 mo | 50 × 1 y | 75 × 1 y | 100 × 1 y | 100 × 3 y | 100 × 5 y | 250 × 1 y |
|---|---:|---:|---:|---:|---:|---:|---:|
| Member home page: 5 calls in parallel (slowest) | 0.7–3.1 | 0.8–3.6 | 0.9–4.2 | 1.2–4.9 | 2.3–8.9 | 4.5–15.9 | 2.7–9.6 |
| Admin page: 7 calls in parallel (slowest) | 8.6–34.8 | 30.7–120.7 | 69.2–262.9 | 131.6–482.5 | 1184.0–4342.4 | 3288.9–12062.2 | 1067.4–3914.9 |
| Admin dashboard (getAdminDashboard) | 0.9–3.9 | 1.3–5.3 | 1.9–7.0 | 2.9–10.0 | 9.4–28.9 | 27.8–77.6 | 15.4–43.9 |
| Post a deposit (recordSavings) | 1.2–5.6 | 1.5–6.8 | 1.8–7.9 | 2.2–9.5 | 5.3–20.3 | 7.4–28.7 | 4.1–16.6 |
| Post a loan repayment (recordRepayment) | 1.7–8.3 | 1.8–8.7 | 1.9–9.0 | 2.0–9.4 | 2.9–12.6 | 3.5–15.0 | 2.8–12.4 |
| Final loan approval, issues the loan (approveLoanRequest) | 3.8–17.0 | 5.5–23.0 | 14.5–64.0 | 18.6–77.5 | 61.5–180.3 | 172.9–507.0 | 39.6–123.7 |

## Measured work per operation at the largest tier that ran (counts are exact)

Tier 250 × 1 y.

| Operation | Sheet reads | Cells read | Write calls | Rows appended | Date conversions | Emails | JS time in Node (ms) | Reply size |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sign-in check on every request (getCurrentMember) | 3 | 4,323 | 0 | 0 | 506 | 0 | 8 | 0 KB |
| My savings (getMySavings) | 9 | 223,693 | 0 | 0 | 37,490 | 0 | 503 | 14 KB |
| My loans (getMyLoans) | 5 | 38,432 | 0 | 0 | 7,416 | 0 | 110 | 3 KB |
| Member home page: 5 calls in parallel (slowest) | 9 | 223,693 | 0 | 0 | 37,490 | 0 | 630 | 14 KB |
| Member statement data (getMemberStatementData, before PDF) | 30 | 309,289 | 0 | 0 | 52,535 | 0 | 527 | 18 KB |
| Admin dashboard (getAdminDashboard) | 47 | 359,417 | 0 | 0 | 58,732 | 0 | 6332 | 78 KB |
| Active loans / portfolio (getActiveLoans) | 8 | 113,102 | 0 | 0 | 18,561 | 0 | 2411 | 100 KB |
| Repayments list (getRepayments) | 5 | 25,986 | 0 | 0 | 5,066 | 0 | 61 | 492 KB |
| Withdrawal requests (getWithdrawalRequests) | 8 | 225,816 | 0 | 0 | 37,728 | 0 | 7745 | 307 KB |
| Surcharges list (getAllFinesForAdmin) | 502 | 1,133,297 | 0 | 0 | 126,002 | 0 | 1278 | 79 KB |
| Savings ledger, unfiltered (getSavingsTransactions) | 5 | 216,258 | 0 | 0 | 35,700 | 0 | 416 | 4739 KB |
| Loan Insights, all time (getLoanInsights) | 8 | 250,457 | 0 | 0 | 44,445 | 0 | 3117 | 326 KB |
| Loan fund trace, all time (getLoanFundLedger) | 8 | 250,457 | 0 | 0 | 44,419 | 0 | 3253 | 2524 KB |
| Audit log, first page (getAuditLog) | 9 | 34,141 | 0 | 0 | 26,830 | 0 | 74 | 39 KB |
| Post a deposit (recordSavings) | 7 | 635,658 | 12 | 1 | 70,648 | 1 | 490 | 0 KB |
| Post a loan repayment (recordRepayment) | 15 | 207,830 | 9 | 3 | 32,624 | 3 | 213 | 1 KB |
| Member requests a withdrawal (requestWithdrawal) | 9 | 254,038 | 8 | 1 | 39,734 | 6 | 196 | 0 KB |
| Member requests a loan (requestLoan) | 36 | 1,029,323 | 12 | 1 | 180,327 | 8 | 4751 | 0 KB |
| Final loan approval, issues the loan (approveLoanRequest) | 71 | 2,521,295 | 22 | 1 | 439,403 | 1 | 13673 | 0 KB |
| Record a surcharge (issueFine) | 24 | 306,011 | 8 | 5 | 49,206 | 5 | 297 | 0 KB |
| Daily due-date job (processLoanDueDates) | 180 | 448,718 | 0 | 0 | 55,511 | 0 | 1838 | – |
| Daily pending-action reminders (sendPendingActionReminders_) | 9 | 46,970 | 0 | 0 | 8,724 | 0 | 110 | 0 KB |
| Daily repayment reminders (sendRepaymentReminders_) | 3 | 36,412 | 0 | 0 | 8,917 | 0 | 1580 | – |

## Concurrency: writes protected by the script lock (modelled from each operation's measured critical section)

Apps Script runs them one at a time; each waits at most 15 s for the lock (withScriptLock_), then fails with a lock timeout.

| Operation | Tier | Lock held (s) | 5 at once: failures, last one waits | 10 at once: failures, last one waits |
|---|---|---:|---|---|
| Post a deposit (recordSavings) | 50 × 6 mo | 0.73 | 0, 2.9 s | 0, 6.5 s |
| Post a deposit (recordSavings) | 50 × 1 y | 1.09 | 0, 4.3 s | 0, 9.8 s |
| Post a deposit (recordSavings) | 75 × 1 y | 1.44 | 0, 5.7 s | 0, 12.9 s |
| Post a deposit (recordSavings) | 100 × 1 y | 1.91 | 0, 7.6 s | 2, 15.0 s |
| Post a deposit (recordSavings) | 100 × 3 y | 5.26 | 2, 15.0 s | 7, 15.0 s |
| Post a deposit (recordSavings) | 100 × 5 y | 7.79 | 3, 15.0 s | 8, 15.0 s |
| Post a deposit (recordSavings) | 250 × 1 y | 4.00 | 1, 15.0 s | 6, 15.0 s |
| Post a loan repayment (recordRepayment) | 50 × 6 mo | 0.47 | 0, 1.9 s | 0, 4.2 s |
| Post a loan repayment (recordRepayment) | 50 × 1 y | 0.54 | 0, 2.2 s | 0, 4.8 s |
| Post a loan repayment (recordRepayment) | 75 × 1 y | 0.58 | 0, 2.3 s | 0, 5.3 s |
| Post a loan repayment (recordRepayment) | 100 × 1 y | 0.68 | 0, 2.7 s | 0, 6.1 s |
| Post a loan repayment (recordRepayment) | 100 × 3 y | 1.26 | 0, 5.1 s | 0, 11.4 s |
| Post a loan repayment (recordRepayment) | 100 × 5 y | 1.66 | 0, 6.6 s | 0, 14.9 s |
| Post a loan repayment (recordRepayment) | 250 × 1 y | 1.19 | 0, 4.8 s | 0, 10.7 s |
| Member requests a withdrawal (requestWithdrawal) | 50 × 6 mo | 3.27 | 0, 13.1 s | 5, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 50 × 1 y | 3.53 | 0, 14.1 s | 5, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 75 × 1 y | 3.78 | 1, 15.0 s | 6, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 100 × 1 y | 4.12 | 1, 15.0 s | 6, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 100 × 3 y | 6.31 | 2, 15.0 s | 7, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 100 × 5 y | 8.16 | 3, 15.0 s | 8, 15.0 s |
| Member requests a withdrawal (requestWithdrawal) | 250 × 1 y | 5.50 | 2, 15.0 s | 7, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 50 × 6 mo | 6.89 | 2, 15.0 s | 7, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 50 × 1 y | 9.87 | 3, 15.0 s | 8, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 75 × 1 y | 12.62 | 3, 15.0 s | 8, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 100 × 1 y | 18.01 | 4, 15.0 s | 9, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 100 × 3 y | 98.25 | 4, 15.0 s | 9, 15.0 s |
| Final loan approval, issues the loan (approveLoanRequest) | 250 × 1 y | 64.91 | 4, 15.0 s | 9, 15.0 s |

## Concurrency: writes WITHOUT the lock (measured, worst-case interleaving)

| Operation | Simultaneous | Reported success | Rows actually kept | Lost |
|---|---:|---:|---:|---:|
| issueFine | 5 | 5 | 1 | 4 |
| requestLoan | 5 | 5 | 1 | 4 |
| acceptTerms | 5 | 5 | 1 | 4 |
| issueFine | 10 | 10 | 1 | 9 |
| requestLoan | 10 | 10 | 1 | 9 |
| acceptTerms | 10 | 10 | 1 | 9 |
