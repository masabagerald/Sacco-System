# Scope and capacity report: SACCO system (Mbale Soco deployment)

Prepared from the code on branch `club/mbale_soco` (commit `42d150d`), 13 November 2026.

**How to read the numbers.** Every figure is marked:

- **Counted:** exact. Produced by running the real server code locally (Node, in-memory spreadsheet) and counting each spreadsheet call, cell read and written, date conversion and email.
- **Estimated:** Apps Script time, calculated from those counts and the per-call costs listed in [Method](#method). These were **not** timed on Google's servers.
- **Google limit:** taken from Google's published Apps Script and Sheets limits.

No live spreadsheet or deployment was read or changed. A harness that measures the real Apps Script times on a separate copy is ready to run (`bench/README.md`). Until it has been run, treat the capacity figures as estimates.

---

## Summary

- **Scope.** The system is a complete member, savings, loan, approval, loan-fund, investment-tracking and asset-register application with an audit trail, email notifications and weekly backups. It is **not** an accounting system: there is no general ledger, trial balance, financial statements, bank reconciliation or dividend distribution. SMS and mobile money are not present.
- **Capacity of the current version is already small.** Member-facing screens and postings are fast. However, the admin page makes 7 server calls in parallel, and two of them (the members list and the loan-requests list) re-read the whole Savings tab once per member or once per request. Their cost grows with the *square* of the club's size. Estimated:
  - At **50 members with 6 months** of history, the admin page takes **≈16 s**.
  - At 100 members × 1 year, it takes ≈4 minutes.
  - From 100 members × 3 years upward, it hits Apps Script's 6-minute limit and fails.

  The final loan approval and the monthly statements job behave the same way.
- **Under the 10-second rule, the current version's ceiling is about 40 active members with about 6 months of transactions** (≈1,500 savings rows). This is an estimate. Confirm it on the copy before putting it in the MOU (see [Recommended ceiling](#recommended-capacity-ceiling)).
- **The cause is fixable at low cost.** Reading each tab once per request instead of once per member or per row removes every quadratic path (about 2–3 days). After that, the estimated ceiling is set by straight-line growth: about **45,000 live savings rows**, roughly 500 members with one year of live data, which needs yearly archiving to be sustained.
- **Data integrity under concurrency.** Three writes do not take the lock: recording a surcharge, requesting a loan, and accepting the terms. When requests coincide, these can silently overwrite each other; in the test, 4 of 5 simultaneous writes were lost while all 5 reported success. Locked writes queue, and loan approvals hold the lock long enough that 2 or more at once already time out.
- **Hard Google limits that bind early.** On a free Gmail hosting account, the email quota (100 recipients/day) caps the club at roughly **50–130 members** at the assumed activity. All users share one account's limit of 30 simultaneous executions.

---

## Part 1: What the system does (scope inventory)

Status: **Complete** = works end to end in the code; **Partial** = exists with a notable gap; **Missing** = not in the code.

### Members

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Add member | Admin adds name, email, phone, role, membership type, date joined; member number assigned automatically (`MSIC-0001`, never reused) | `addMember` (MemberController.gs) | Complete |
| Edit member | Admin changes role, membership type, status, date joined, committee role | `updateMember` | **Partial**: name, email and phone cannot be changed in the app after the member is added |
| Members list | All members with total and Principal balances | `getAllMembersSummary` | Complete (slow at scale, see Part 2) |
| Hosting account protection | The club's Google account stays an active Admin with no membership type | `hostMemberError_` (SetupService.gs) | Complete |
| Member number migration | One-off renumbering of older `M001` numbers across all tabs | `previewMemberNumberMigration`, `migrateMemberNumbers` (editor only) | Complete |
| Exit / deactivate | Member set Inactive; cannot sign in | `updateMember` | **Partial**: no exit settlement (final balance payout) workflow |
| Self-registration | Members apply to join | – | Missing |

### Savings and shares

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Three deposit accounts | Principal (individual), Operations and Welfare (club pools); balances always derived from the ledger | `accountBalancesFromRows_`, `poolBalanceFromRows_` (SavingsService.gs) | Complete |
| Record deposit / withdrawal | Admin posts with payment category, account, date, notes; email confirmation | `recordSavings` | Complete |
| Reverse a transaction | Appends a reversal row; original kept | `reverseSavingsTransaction` | Complete |
| Correct a deposit | Reversal + replacement in one step | `correctContribution` | Complete |
| Savings ledger view | Filter by member, type, account, category, dates | `getSavingsTransactions` | Complete (no paging) |
| Member savings view | Balances per account, history, amount available to withdraw | `getMySavings` | Complete |
| Withdrawal requests | Member requests from an account; limits checked; two different admins approve | `requestWithdrawal`, `approveWithdrawal`, `rejectWithdrawal`, `getWithdrawalRequests`, `getMyWithdrawalRequests` | Complete |
| Share capital | Shares as distinct from savings (share register, share value, transfers) | – | Missing |

### Loans

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Loan products | Founder/Delegate loan (10%, min 2 months, UGX 5,000 fee); Non-Member Soft Loan (1 week–1 month, 5–15%, UGX 10,000 fee); older Flat and reducing-balance loans still calculated | `loanSpecFor_`, `computeLoan_` (LoanService.gs) | Complete |
| Eligibility rules | 12 months of saving, one running loan, guarantor restrictions (by-laws Art. 4) | `loanEligibility_` | Complete |
| Loan limit | 50% of Principal savings; admin override with reason | `checkLimit_` | Complete |
| Loan request | Member requests or admin proposes; two Founder Member guarantors with 25% coverage | `requestLoan`, `issueLoan`, `getLoanTerms`, `getGuarantorCandidates` | Complete |
| Guarantor consent | Guarantors approve/decline by emailed link (decline needs a reason) | `doGet` → `guarantorHandle_` (GuarantorWeb.gs) | Complete |
| Two-admin approval | Two different admins, neither initiator nor applicant; second approval issues the loan | `approveLoanRequest`, `rejectLoanRequest`, `getLoanRequests` | Complete |
| Loan with security (waiver) | Founder short of coverage offers an asset; three committee admins approve the waiver | `checkLoanCoverage`, `requestSecuredLoan`, `approveLoanWaiver`, `rejectLoanWaiver` | Complete |
| Record repayment | Breakdown (fee → interest → penalty → principal) before saving; duplicate, overpayment and stale checks | `getRepaymentPreview`, `recordRepayment` | Complete |
| Reverse repayment | Negative row linked to the original | `reverseRepayment`, `getRepayments` | Complete |
| Overdue handling | Reminders 3 days before and on the due date; one-time 10% overdue surcharge; daily overdue notices for 2 weeks | `processLoanDueDates`, `sendRepaymentReminders` (scheduled) | Complete |
| Loan portfolio view | Running loans with guarantors and notice history | `getActiveLoans`, `getMyLoans` | Complete |
| Instalment schedules for new loans | Current products are one payment on the due date | – | **Partial** (only older Flat loans had two instalments) |
| Write-off, cancellation, rescheduling, top-up | – | – | Missing (README lists write-offs as not supported) |

### Surcharges (fines)

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Surcharge register | Admin records a surcharge; marks it paid; member sees their own | `issueFine`, `markFinePaid`, `getAllFinesForAdmin`, `getMyFines` | Complete |
| Surcharge paid as a deposit | Deposit category "Surcharge" with a reason | `recordSavings` | Complete (separate from the register: the two are not linked) |

### Accounting

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Loan Fund Ledger | Cash injections and other outflows, each needing two admin approvals; reversals | `proposeLoanFundEntry`, `approveFinanceEntry`, `rejectFinanceEntry`, `reverseFinanceEntry`, `getLoanFundEntries` | Complete |
| Loan Insights | Available loan cash, charged vs collected interest/fees/penalties, overdue, borrowers, month-by-month trend; aggregate view for Founder Members | `getLoanInsights` | Complete |
| Loan fund cash trace | Every movement with running balance, reconciling to available cash | `getLoanFundLedger` | Complete |
| General ledger / chart of accounts / double entry | – | – | Missing |
| Trial balance, balance sheet, income statement | – | – | Missing |
| Bank reconciliation | – | – | Missing |
| Period close / year end | – | – | Missing |

### Reports

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Member statement (PDF) | Branded PDF saved to Drive, opened by link | `generateMemberStatementDoc` | Complete. Note: the PDF is shared "anyone with the link" (ReportController.gs:80) |
| Admin ledger report (PDF) | Members, loans, every savings transaction, surcharges | `generateAdminReportPdf` | Complete (will not finish at scale, see Part 2) |
| Ledger CSV export | Same data as CSV | `exportAdminCSV` | Complete (slow at scale) |
| Audit log search and CSV export | Server-side filters, paging, 20,000-row export pages | `getAuditLog`, `exportAuditLogCsv` | Complete |
| Asset register export | PDF and Excel with filters | `exportAssetRegisterPdf`, `exportAssetRegisterXlsx` | Complete |
| Monthly member summary (email) | Savings, loans, surcharges per member on the 1st | `sendMonthlyStatements` (scheduled) | Complete |
| Monthly audit report (PDF email to admins) | Last month's loan and withdrawal decisions and audit log | `sendMonthlyAuditReport` (scheduled) | Complete |

### Users and security

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Sign-in | Emailed 6-digit code (10 min, 5 attempts) or Google account detection; session token held server-side in cache, 6 h sliding | `sendOtp`, `verifyOtp`, `tryAutoDetect`, `confirmAutoDetect`, `logout` | Complete |
| Server-side permission checks | Every call checks the member, role and accepted terms | `caller_`, `adminCaller_`, `insightsCaller_`, `rpc` allow-list (AuthService.gs) | Complete |
| Roles | Member, Admin, plus committee role (Chairperson / Finance Committee) and membership type | Members tab | **Partial**: no finer roles (e.g. read-only auditor, treasurer-only) |
| Segregation of duties | Two different admins for loans, withdrawals, ledger and investment entries; three for waivers; a different admin verifies assets | `approvalDutyError_` (RequestService.gs) | Complete |
| Terms of use and admin agreement | Must be accepted (per version) before any use; admins publish new versions | `getTermsStatus`, `acceptTerms`, `declineTerms`, `getTermsForEditing`, `publishTerms` | Complete |
| Audit trail | Append-only log of every action with time and actor | `auditLog_`, `getAuditLog` | Complete |
| Backups | Weekly copy of the spreadsheet to Drive, 8 kept | `backupSpreadsheet` (scheduled) | **Partial**: no restore tool (restore by hand from Drive) |
| Sign-in code rate limit | – | `sendOtp` | **Partial**: wrong codes are limited, but requests for new codes are not (each sends an email) |
| Two-factor authentication for admins | – | – | Missing (email code is the only factor) |

### Investments and dividends

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Investment register | Name, type, provider, dates, account (masked), source of funds | `createInvestment`, `updateInvestment`, `getInvestment` | Complete |
| Investment transactions | Contributions, redemptions, income earned/received/reinvested, fees, taxes, valuations; two admin approvals; reversals | `proposeInvestmentTx`, `approveFinanceEntry`, `getInvestmentTransactions` | Complete |
| Transfers with the loan fund | Linked pair, approved together | `proposeInvestmentTransfer` | Complete |
| Portfolio dashboard | Net invested, value, income, capital gain, net return, maturities, by type/provider/source | `getInvestmentDashboard` | Complete (valuations are entered by hand) |
| Dividend calculation and distribution | – | – | **Missing** ("Dividends" exists only as a withdrawal reason, Config.gs:78) |

### Notifications

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Email notifications | Confirmations, approvals, guarantor requests and notices, due/overdue reminders, daily pending-action digest, monthly summaries, admin alerts | `sendEmail_`, `notifyAdmins_`, `notifyGuarantors_`, scheduled jobs | Complete. Failures are silently skipped (EmailService.gs:50) |
| SMS / WhatsApp | – | – | Missing |
| In-app counts | Pending-request badges in the menu | page only | Partial |

### Other

| Feature | What it does | Entry functions | Status |
|---|---|---|---|
| Asset register | Register, update, dispose; independent verification by a different admin; history and reviews | `registerAsset`, `updateAsset`, `disposeAsset`, `verifyAsset`, `rejectAsset`, `getAssets`, `getAsset` | Complete |
| Self-setup and upgrades | First visit creates all tabs, columns and scheduled jobs; later versions add missing ones | `ensureSetUp_`, `setupNewClub` | Complete |
| User guide | Served at `?page=guide` | `doGet` | Complete |
| Mobile money / bank integration | – | – | Missing |
| Document uploads | Supporting documents are links only | – | Missing |
| Data archiving | Old years moved out of the live tabs | – | Missing |
| Multi-currency | UGX only | – | Missing |

### Commonly expected but not present

General ledger with chart of accounts and double entry; trial balance and financial statements (balance sheet, income statement); bank reconciliation; period/year-end close; dividend or interest-on-savings calculation and distribution; share capital register; loan write-off, rescheduling and top-up; SMS or WhatsApp notifications; mobile money (MTN MoMo, Airtel Money) or bank integration; member self-registration and self-service profile changes; document upload; data archiving; a backup restore tool; two-factor sign-in for admins; finer-grained roles.

Present and worth naming in the MOU because they are often missing: append-only audit trail with search and export, two-admin approval on every money movement, weekly automatic backups.

---

## Data model

One Google Sheet holds all data. Each tab has a header row; columns are found by header name.

Live row counts were **not read** (the live spreadsheet was not opened). To fill them in without changing anything, run `benchInventoryOf('<live spreadsheet ID>')` from the bench copy (read-only). The "Synthetic rows" column shows the 250-member × 1-year test tier for scale.

| Tab | Columns | Written by | Read by | Synthetic rows (250 × 1 y) |
|---|---|---|---|---:|
| Members | MemberNo, Full Name, Email, Phone, Role, Membership Type, Date Joined, Status, Committee Role | `addMember`, `updateMember`, setup (host), member-number migration | **Every signed-in request** (`lookupMember_`), `memberByNo_` (called per row in several lists), `notifyAdmins_`, lists, reports, jobs | 250 |
| Savings | Date, Timestamp, MemberNo, Deposit Type, Amount (UGX), Recorded By, Reference, Notes, Payment Category, Surcharge Reason, Deposit Account, Reverses | `appendSavingsTxsLocked_` (deposits, withdrawals, reversals, corrections, approved withdrawal requests) | Balances (`accountBalances_`, called per member in lists, exports, statements job), `getMySavings`, ledger, dashboard, loan eligibility and limits, guarantor checks, Loan Insights, withdrawals, pool checks | 17,472 |
| Loans | LoanID, Timestamp, MemberNo, Date Issued, Principal (UGX), Status, Issued By, Purpose, Override Reason, Loan Model, Processing Fee (UGX), Interest Rate (%), Term (months), Term (days), Due Date, Overdue Surcharge (UGX), Last Notice | `createLoanRow_` (final approval), `setLoanStatus_` (repayments), `processLoanDueDates` | Every loan screen, dashboard, eligibility, guarantor checks, Loan Insights, notices, reports, jobs | 864 |
| Loan Repayments | LoanID, Date, Timestamp, MemberNo, Amount (UGX), Recorded By, Notes, Reference, Reverses | `appendRepaymentRow_` (repayments and reversals) | `computeLoan_` and everything that calls it | 2,155 |
| Surcharge | FineID, Timestamp, MemberNo, Date, Amount (UGX), Reason, Status, Recorded By | `issueFine`, `markFinePaid` | `getMyFines`, `getAllFinesForAdmin`, dashboard, reports, statements job | 498 |
| Loan Requests | RequestID, Timestamp, MemberNo, Amount (UGX), Repayment Term, Purpose, Status, Decision Notes, Decided By, Initiated By, Guarantor 1, Guarantor 2, Total Due, Approver 1, Approver 1 At, Approver 2, Approver 2 At, Guarantor Override, Limit Override | `writeLoanRequestRow_`, `setApprover_`, `updateReqStatus_` | Loan request lists, live-guarantee checks, guarantor links, reminders, audit report | 864 |
| Withdrawal Requests | RequestID, Timestamp, MemberNo, Amount (UGX), Reason, Status, Decision Notes, Decided By, Initiated By, Approver 1, Approver 1 At, Approver 2, Approver 2 At, Deposit Account | `requestWithdrawal`, `approveWithdrawal`, `rejectWithdrawal` | Withdrawal lists, `getMySavings` (available amount), pool checks, reminders, dashboard, audit report | 672 |
| Audit Log | Timestamp, Action, Member (Affected), Performed By, Details, Reference ID | `auditLog_` (append, everywhere) | `getAuditLog`, `exportAuditLogCsv`, `sendMonthlyAuditReport` | 25,789 |
| Guarantors | Timestamp, RequestID, LoanID, ApplicantNo, GuarantorNo, Token, Response, Responded At, Decline Reason | `appendGuarantors_`, `linkGuarantorsToLoan_`, guarantor links | Guarantor rules, loan request lists, active loans, notices, reminders | 1,728 |
| Guarantor Notifications | Timestamp, Event Key, LoanID, BorrowerNo, GuarantorNo, Event, Amount (UGX), Transaction Date, Remaining Balance (UGX), Sent To | `notifyGuarantors_` (append) | `notifyGuarantors_` (no duplicates), `getActiveLoans` | 5,684 |
| Loan Fund Ledger | EntryID, Timestamp, Date, Entry Type, Amount (UGX), Reference, Description, Investment ID, Linked Entry, Reverses, Status, Initiated By, Approver 1, Approver 1 At, Approver 2, Approver 2 At, Decision Notes, Decided By | Loan fund entries, approvals, reversals | Loan Insights, cash checks, reminders | 4 |
| Investments | InvestmentID, Timestamp, Name, Type, Provider, Currency, Start Date, Maturity Date, Account Reference, Status, Notes, Document Link, Created By, Updated At, Updated By, Source of Funds, Source of Funds (Other) | `createInvestment`, `updateInvestment` | Investment screens; **every pool balance** (`poolInvestmentFlows_`) | 3 |
| Investment Transactions | TxID, Timestamp, InvestmentID, Date, Tx Type, Amount (UGX), Cost Source, Reference, Notes, Linked Entry, Reverses, Status, Initiated By, Approver 1, Approver 1 At, Approver 2, Approver 2 At, Decision Notes, Decided By | Proposals, approvals, reversals | Investment dashboard, pool balances, reminders | 36 |
| Loan Waivers | RequestID, Timestamp, ApplicantNo, Initiated By, Amount (UGX), Repayment Term, Guarantors, Applicant Principal Savings (UGX), Applicant Coverage (%), Loan Cap (UGX), Guarantor Coverage, Failed Requirements, Waived Checks, Eligibility Snapshot, Security Type, Security Type (Other), Security Description, Estimated Value (UGX), Ownership Details, Supporting Documents, Justification, Waiver Status, Status Updated At | `requestSecuredLoan`, waiver decisions | Loan request lists, approvals, reminders | 0 |
| Waiver Decisions | Timestamp, RequestID, AdminNo, Admin Name, Committee Role, Decision, Comment | `approveLoanWaiver`, `rejectLoanWaiver` (append) | Waiver progress | 0 |
| Assets | AssetID, Timestamp, Asset Tag, Asset Type, Type (Other), Description, Make, Model, Serial Number, Value (UGX), Date Acquired, Condition, Availability, Location, Disposal Date, Disposed To, Recipient Contact, Documents, Notes, Verification Status, Version, Submitted By, Submitted At, Verified By, Verified At, Created By, Updated At, Updated By | Asset register functions | Asset screens, exports, reminders | 0 |
| Asset Reviews | Timestamp, AssetID, Version, Reviewer, Reviewer Name, Decision, Comment, Submitted By | `verifyAsset`, `rejectAsset` (append) | `getAsset` | 0 |
| Asset History | Timestamp, AssetID, Version, Action, Changed By, Field, Previous Value, New Value, Reason | Asset changes (append) | `getAsset` | 0 |
| Terms Acceptance | Timestamp, MemberNo, Email, Role, Document, Title, Version, Decision | `acceptTerms`, `declineTerms` | **Every signed-in request** (`termsAccepted_`), `getTermsForEditing` | 256 |
| Terms Versions | Timestamp, Document, Version, Title, Checkbox, Text, Change Summary, Published By | `publishTerms` | **Every signed-in request** (`termsDocuments_`) | 0 |

Outside the spreadsheet: sign-in sessions in the script cache (6 h), sign-in codes and job run markers in script properties, weekly backups and member statement PDFs in the hosting account's Drive.

Synthetic activity behind these numbers (assumption, see [Method](#method)): a saving member who borrows makes 8 transactions a month (6.5 savings postings, 1 repayment, 1 loan every 3 months, 1 surcharge every 6 months). Averaged over all members, including Non-Members who do not save, it is about 7 a month, and the app writes about 19 rows per member per month across all tabs once audit entries and guarantor notices are counted.

---

## Part 2: Capacity analysis

### Static review: performance and concurrency risks

Almost every read is `readSheet_` (SheetService.gs:23-45): `getDataRange().getValues()` on the **whole tab, all years**, then one object per row, with every date cell converted by `Utilities.formatDate` (SheetService.gs:39). That pattern is fine once per request. The risks below are where it is repeated, or where its result is scanned in nested loops.

| # | Risk | Where | Rating |
|---|---|---|---|
| S1 | **Whole Savings tab re-read once per member.** `accountBalances_` reads the full Savings tab each call and is called inside a loop over all members. Cost grows with members × savings rows. | MemberController.gs:8 (Members list); ReportController.gs:97 (ledger PDF), :165 (CSV); ScheduledJobs.gs:10 (monthly statements); SavingsService.gs:45-47 | **High** |
| S2 | **Whole Savings tab re-read once per loan request, for every request ever made.** `getLoanRequests` calls `checkLimit_` → `principalBalance_` for each row, including long-decided ones. Cost grows with requests × savings rows. | LoanRequestController.gs:161; LoanService.gs:219-223 | **High** |
| S3 | **Every loan recomputed against every repayment.** `computeLoan_` filters the full repayment list for each loan. Called for all loans by the dashboard, active-loans list, Loan Insights, and by `liveGuaranteeRows_`, which runs 5 or more times per loan request or approval (eligibility, then 2 guarantors × running-loan + live-guarantee checks), each time re-reading Guarantors, Loan Requests, Loans and Repayments. | LoanService.gs:67-71; GuarantorService.gs:6-21, 26, 47-49; LoanService.gs:226-232, 260-265; DashboardController.gs:16; LoanController.gs:31 | **High** |
| S4 | **Members tab re-read once per row.** `memberByNo_` reads the full Members tab and is called inside loops. | FineController.gs:60 (per surcharge); ScheduledJobs.gs:95 (per running loan); DashboardController.gs:62 (per overdue loan) | **High** |
| S5 | **Sign-in check costs 3 full-tab reads on every call.** `caller_` reads Members, Terms Versions and all of Terms Acceptance. The member home page makes 5 calls, so 15 of these reads; `getMemberStatementData` repeats the check 6 times and reads Savings twice. | AuthService.gs:4-11, 62-71; TermsService.gs:19-28, 76-89; ReportController.gs:3-14; app.js.html:68-75 | **High** |
| S6 | **Quadratic loops in memory.** Per-member balance over all savings rows on the dashboard; per-request balance on the withdrawal list. | DashboardController.gs:14; WithdrawalController.gs:85 | Medium |
| S7 | **Writes without the script lock that pick a reference and a row, then write.** Two at once get the same reference and the same row; one overwrites the other and both report success. `requestLoan` is unlocked while the secured-loan request is locked. | FineController.gs:19-26 (`issueFine`); LoanRequestController.gs:38-57, 63-101 (`requestLoan`, `issueLoan`); TermsService.gs:95 (`recordTerms_`); GuarantorService.gs:83 (`appendGuarantors_`) | **High** (data integrity) |
| S8 | **Lock held during slow work.** All financial writes run under one script-wide lock (`waitLock(15000)`), and inside it they read whole tabs, sometimes twice (`emptyRow_` re-reads the tab), then write cell by cell. Loan approval holds the lock for the full eligibility and guarantor checks (S3). As tabs grow, a queue of simultaneous writes passes 15 s and the later ones fail with a lock timeout. | SheetService.gs:62-67, 98-102; SavingsService.gs:179-202; LoanRequestController.gs:192-256 | **High** |
| S9 | **Row-by-row `setValue`.** New rows are written one cell at a time (9–17 calls per row) after locating the row with a full-tab read; status updates re-read the tab to find the row. | SavingsService.gs:187-196; LoanService.gs:279-294; RepaymentService.gs:17-22; LoanRequestController.gs:46-55; WithdrawalController.gs:41-46; FineController.gs:22-26; RequestService.gs:3-29; SheetService.gs:91-95 (`nextId_` reads the tab twice) | Medium |
| S10 | **No archiving, no data caching.** Every read covers all years. CacheService holds only sign-in sessions. | SheetService.gs:23-45; AuthService.gs:25-38 | **High** |
| S11 | **Unused grid columns count against the 10M-cell limit.** Tabs are created with `insertSheet`, which gives 26 columns (A–Z), and never trimmed. A Savings row uses 12 columns but costs 26 cells; an Audit Log row uses 6 but costs 26. This roughly halves how much data fits. | SecuredLoanService.gs:23-27; GuarantorNotificationService.gs:13-18; ApprovalLedgerService.gs:224-226 | **High** (storage ceiling) |
| S12 | **Possible write failure at the bottom of a tab (to verify).** `emptyRow_` returns "last row + 1" and the row is written with `getRange(row, col).setValue`. If Apps Script refuses a range below the tab's last grid row (a new tab has 1,000), these writes fail once a tab is full; only `appendRow` grows a tab by itself. Not verified here (the local fake grows silently). `benchProbeGridEdge` in the harness settles it in one run. | SheetService.gs:62-67 and every caller in S9 | Unverified; **Critical if confirmed** |
| S13 | **Unpaged replies.** The savings ledger and repayments lists return every row ever recorded to the browser. | SavingsController.gs:123-158; LoanController.gs:151-169; LoanRequestController.gs:136-184 | Medium |
| S14 | **Email on every transaction, failures silent.** One email per deposit, one per admin per request stage, two per guarantor event; `notifyAdmins_` also re-reads Members. Failures (including the daily quota) are swallowed. | EmailService.gs:45-51, 64-67; GuarantorNotificationService.gs:37-73 | **High** (quota ceiling, see Limits) |
| S15 | **Sign-in codes can be requested without limit.** Each request emails a code, drawing on the daily quota. | AuthController.gs:21-36 | Medium |
| S16 | **Pool balance reads the Investments tab each time.** `poolBalanceFromRows_` calls `poolInvestmentFlows_`, which reads Investments (and Investment Transactions) on every call. | SavingsService.gs:61-68, 109; InvestmentService.gs:155-174 | Low |
| S18 | **Emails sent while holding the lock.** A withdrawal request emails every admin before releasing the lock; loan approvals email inside it too. Every other writer waits for those emails. | WithdrawalController.gs:29-53 (notifyAdmins_ at :48); LoanRequestController.gs:240-255, 300-313 | Medium |
| S17 | Well done already: the audit log appends with `appendRow` and its viewer reads only the Timestamp column for date searches; loan insights are computed from one read of each tab. | AuditService.gs:6-15, 94-113; LoanInsightsService.gs:380-384 | – |

Formula-heavy sheets: none. The app writes plain values; there are no VLOOKUP/QUERY/ARRAYFORMULA formulas in the code. (Formulas added by hand on the live spreadsheet were not checked.)

### The heaviest operations

Ranked by estimated time at 100 members × 1 year (counted work at 250 × 1 year in brackets):

| # | Operation | Why it is heavy | Est. at 100 × 1 y |
|---|---|---|---:|
| 1 | **Admin page load**: the loan-requests list (`getLoanRequests`) and members list (`getAllMembersSummary`) among its 7 parallel calls | Savings tab re-read per request / per member (S1, S2) | 237 s / 103 s |
| 2 | **Monthly statements job** (`sendMonthlyStatements`) and **ledger CSV / PDF export** | Savings tab re-read per member (S1) | 148 s / 112 s |
| 3 | **Final loan approval** (`approveLoanRequest`) | Eligibility and guarantor checks recompute every loan 5+ times, all inside the lock (S3, S8) [71 sheet reads, 2.5 M cells] | 35.5 s |
| 4 | **Admin dashboard** (`getAdminDashboard`) and **Loan Insights** | Every loan against every repayment; per-member balance loop (S3, S6) | 5.0 s (24.5 s at 250 × 1 y) |
| 5 | **Posting a deposit** (`recordSavings`), the most frequent write | Sign-in reads, then Savings read 3 times (rows, free row, new balance), 12 single-cell writes, email (S5, S8, S9) [7 reads, 636 k cells] | 4.3 s (13.8 s at 100 × 5 y) |

The member statement and the member home page are lighter: one Savings read each (plus 6 repeated sign-in checks for the statement). The member home page is 2.3 s at 100 × 1 y and 7.9 s at 100 × 5 y.

### Benchmark results

#### Data volume per tier (counted, all 15 tiers)

| Tier (members × years) | Rows, all tabs | Savings rows | Used cells | Grid cells as the app creates tabs (26 columns) | Fits in 10M cells? |
|---|---:|---:|---:|---:|---|
| 100 × 1 y | 20,758 | 6,942 | 0.19M | 0.92M | yes |
| 100 × 3 y | 62,544 | 20,826 | 0.56M | 1.93M | yes |
| 100 × 5 y | 104,330 | 34,710 | 0.94M | 2.99M | yes |
| 250 × 1 y | 56,275 | 17,472 | 0.51M | 1.77M | yes |
| 250 × 3 y | 169,841 | 52,416 | 1.53M | 4.69M | yes |
| 250 × 5 y | 283,473 | 87,360 | 2.55M | 7.64M | yes |
| 500 × 1 y | 115,574 | 35,022 | 1.04M | 3.27M | yes |
| 500 × 3 y | 349,130 | 105,066 | 3.14M | 9.34M | yes |
| 500 × 5 y | 582,806 | 175,110 | 5.24M | 15.41M | only after deleting unused columns |
| 1000 × 1 y | 234,172 | 70,122 | 2.10M | 6.32M | yes |
| 1000 × 3 y | 707,732 | 210,366 | 6.36M | 18.63M | only after deleting unused columns |
| 1000 × 5 y | 1,181,328 | 350,610 | 10.62M | 30.95M | **no** |
| 2000 × 1 y | 471,410 | 140,322 | 4.24M | 12.49M | only after deleting unused columns |
| 2000 × 3 y | 1,425,356 | 420,966 | 12.81M | 37.29M | **no** |
| 2000 × 5 y | 2,379,026 | 701,610 | 21.39M | 62.09M | **no** |



Timed tiers: 50 × 6 months, 50 × 1 y, 75 × 1 y, 100 × 1/3/5 y and 250 × 1 y. The larger tiers were still running locally when this report was written. They cannot change the ceiling: the admin page already exceeds the 6-minute limit at 100 × 3 y. To refresh the tables when the run finishes: `node bench/report-tables.js`.

Times are **estimates** (see [Method](#method)): the median of up to 3 runs, by the central cost assumption, including about 0.6 s for the browser round trip. "≈" marks a run that was stopped locally and scaled from a smaller tier by how its work grows. "Fails" means more than Apps Script's 6-minute limit.


#### Estimated Apps Script time per operation, seconds (central estimate; ≈ extrapolated; bold ≥ 10 s)

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


#### Range for the key operations (low – high cost assumptions), seconds

| Operation | 50 × 6 mo | 50 × 1 y | 75 × 1 y | 100 × 1 y | 100 × 3 y | 100 × 5 y | 250 × 1 y |
|---|---:|---:|---:|---:|---:|---:|---:|
| Member home page: 5 calls in parallel (slowest) | 0.7–3.1 | 0.8–3.6 | 0.9–4.2 | 1.2–4.9 | 2.3–8.9 | 4.5–15.9 | 2.7–9.6 |
| Admin page: 7 calls in parallel (slowest) | 8.6–34.8 | 30.7–120.7 | 69.2–262.9 | 131.6–482.5 | 1184.0–4342.4 | 3288.9–12062.2 | 1067.4–3914.9 |
| Admin dashboard (getAdminDashboard) | 0.9–3.9 | 1.3–5.3 | 1.9–7.0 | 2.9–10.0 | 9.4–28.9 | 27.8–77.6 | 15.4–43.9 |
| Post a deposit (recordSavings) | 1.2–5.6 | 1.5–6.8 | 1.8–7.9 | 2.2–9.5 | 5.3–20.3 | 7.4–28.7 | 4.1–16.6 |
| Post a loan repayment (recordRepayment) | 1.7–8.3 | 1.8–8.7 | 1.9–9.0 | 2.0–9.4 | 2.9–12.6 | 3.5–15.0 | 2.8–12.4 |
| Final loan approval, issues the loan (approveLoanRequest) | 3.8–17.0 | 5.5–23.0 | 14.5–64.0 | 18.6–77.5 | 61.5–180.3 | 172.9–507.0 | 39.6–123.7 |


#### Counted work per operation at 250 × 1 y (exact counts)

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


### Google limits checked

| Google limit | Value | What it means here |
|---|---|---|
| Script run time per execution | 6 minutes | Already exceeded (estimated) by the members list at 100 × 5 y, the loan-requests list and the monthly statements job at 100 × 3 y, and CSV/PDF exports at 100 × 5 y. Scheduled jobs that exceed it stop part-way: some members get no statement. |
| Spreadsheet size | 10 million cells | Counted per tier above. Because tabs keep the default 26 columns, the current layout holds about **500 members × 3 years**; 1,000 members fit for only about 1 year; 2,000 members do not fit at all. Deleting unused columns roughly triples this. |
| Simultaneous executions | 30 per user | The web app runs as the hosting account (`appsscript.json`: `executeAs: USER_DEPLOYING`), so **every user shares one limit**. A member's home page makes 5 calls at once and the admin page 7, so about 5 people opening the app in the same moment reach it; further calls fail. |
| Web-app response time | No fixed limit below 6 minutes | The 10-second rule in this report is a usability target, not a Google limit. Large replies (the unfiltered savings ledger is 4.7 MB at 250 × 1 y and grows with every year) slow the browser and may fail. |
| Email recipients per day | 100 (free Gmail), 1,500 (Google Workspace) | At the assumed activity the app sends about 22 emails per member per month: one per deposit, guarantor notices, one per admin at each request stage, and the monthly summary. **Estimated** ceiling: about 130 members on a free Gmail account on an average day, and about 55 on the 1st of the month, when every member's summary goes out the same day. On Workspace: about 2,000 and about 850. Emails over the limit are dropped without notice. |
| Trigger run time per day | 90 min (free Gmail), 6 h (Workspace) | Not binding while each job finishes; it becomes binding once jobs run near the 6-minute limit daily. |

Note: the Mbale Soco deployment is hosted on the club's Gmail finance account, so the free-Gmail limits apply.

### Concurrency

**Writes without the lock: measured locally, worst case.** All requests read (choose their reference and their row) before any of them writes, as truly simultaneous executions can:

| Operation | Simultaneous | Reported success | Rows actually kept | Lost silently |
|---|---:|---:|---:|---:|
| Record a surcharge (`issueFine`) | 5 | 5 | 1 | 4 |
| Record a surcharge (`issueFine`) | 10 | 10 | 1 | 9 |
| Request a loan (`requestLoan`) | 5 | 5 | 1 | 4 |
| Request a loan (`requestLoan`) | 10 | 10 | 1 | 9 |
| Accept terms (`acceptTerms`) | 5 | 5 | 1 | 4 |
| Accept terms (`acceptTerms`) | 10 | 10 | 1 | 9 |

Each lost surcharge was still emailed to the member and written to the audit log, so the register and the audit log disagree. For loan requests, the guarantor rows of every request were written under the one surviving request ID. How often this happens in real use depends on requests landing within the same 1–3 seconds. Many members applying at once (for example after a meeting) makes it likely.

**Writes with the lock: modelled from each operation's counted critical section.** Apps Script runs them one at a time; each waits up to 15 s, then fails with a lock-timeout error. Nothing is corrupted, but the request is lost and the user sees an error.

| Operation | Tier | Lock held (s, est.) | 5 at once: failures | 10 at once: failures |
|---|---|---:|---:|---:|
| Post a deposit | 100 × 1 y | 1.9 | 0 | 2 |
| Post a deposit | 250 × 1 y | 4.0 | 1 | 6 |
| Post a deposit | 100 × 5 y | 7.8 | 3 | 8 |
| Post a repayment | 250 × 1 y | 1.2 | 0 | 0 |
| Request a withdrawal | 50 × 6 mo | 3.3 | 0 | 5 |
| Request a withdrawal | 250 × 1 y | 5.5 | 2 | 7 |
| Final loan approval | 50 × 6 mo | 6.9 | 2 | 7 |
| Final loan approval | 100 × 1 y | 18.0 | 4 | 9 |

All locked writes share one lock, so a slow loan approval also delays deposits and repayments. Real concurrency on Apps Script can be measured with `benchConcurrency` on the copy.

---

## Recommended capacity ceiling

Rule: **the slowest common operation must stay under 10 seconds.** Common operations are:

- the member home page and statement;
- the admin page (all 7 lists);
- the dashboard;
- posting a deposit, a repayment or a surcharge;
- requesting a withdrawal or a loan;
- approving a loan.

Exports, Loan Insights and scheduled jobs are not counted, but they must stay under 6 minutes.

### Current version (as deployed)

The slowest common operation is the admin page: the loan-requests list and the members list. Their cost grows with members × savings rows, so **the ceiling shrinks as history accumulates**. Fitting the counted tiers (16.4 s and 13.8 s at 50 members × 6 months, 57.5 s and 23.7 s at 50 × 1 year) gives a 10-second limit at about:

| Measure | Ceiling, current version | Basis |
|---|---|---|
| Active members | **≈ 30 for the first year of data** (≈ 40 for 6 months, ≈ 25 for 18 months) | Estimated from counted work |
| Transactions per year | ≈ 2,500 (30 members × ~7 a month) | Estimated |
| Live rows, all tabs | ≈ 7,000 (≈ 1,500 savings rows) | Counted rows per tier |
| Concurrent users | ≤ 5 people opening the app in the same moment; ≤ 2 admins approving loans at the same time | Google limit (30 executions); lock model |
| Email (free Gmail hosting) | ≈ 55 members | Estimated |

With the most favourable cost assumptions (the "low" column), the admin page still takes 8.6 s at 50 × 6 months, so the conclusion does not depend on the exact per-call costs. One uncertainty could make the real system faster than estimated: Apps Script may serve the repeated reads of the same tab from its own cache. Run `benchRun` on the copy at 50 × 1 and 100 × 1 before quoting these figures.

### After optimisations 1–3 below (estimated, not measured)

With each tab read once per request, every common operation behaves like today's member home page, which reads Savings once. That page is counted at 4.3–4.7 s at 17,000–17,500 savings rows and 7.9 s at 35,000. Extrapolating that straight line (10 s at ≈45,000 live savings rows):

| Measure | Ceiling after fixes 1–3 | With yearly archiving (fix 4) as well |
|---|---|---|
| Active members | ≈ 150 for 5 years, 250 for 2.5 years, 500 for 1 year of data | **≈ 500**, sustained |
| Transactions per year | ≈ 40,000 | ≈ 40,000 |
| Live rows, all tabs | ≈ 150,000 | ≈ 115,000 (one year live) |
| Concurrent users | ≤ 5 opening at the same moment (Google limit, unchanged); ≈ 5 simultaneous postings | same |
| Email | needs Google Workspace above ≈ 55 members | same |

Beyond ≈ 500 active members, a database (for example Cloud SQL or Firebase) is the realistic path, not more spreadsheet tuning.

---

## Top 5 optimisations

| # | Change | Fixes | Effect (estimated) | Effort |
|---|---|---|---|---|
| 1 | **Read each tab once per request and index it.** Pass the Savings rows already read into `accountBalancesFromRows_` instead of calling `accountBalances_` per member or request; group repayments by LoanID once; one member map instead of `memberByNo_` in loops; compute live guarantees once per request. | S1–S4, S6 | Removes every quadratic path. Admin page from ≈237 s to ≈3–5 s at 100 × 1 y; loan approval from ≈35 s to ≈5 s. Raises the ceiling from ≈30 to ≈150–500 members. | 2–3 days with tests |
| 2 | **Make the sign-in check cheap.** Cache the member record and accepted-terms status with the session (CacheService, a few minutes; cleared when the member or the terms change); check it once for `getMemberStatementData`. | S5 | Saves 3 full-tab reads per call (≈0.3–1 s each call, 15 reads per member page). | 1 day |
| 3 | **Short, safe writes.** Lock `requestLoan`, `issueLoan`, `issueFine` and `acceptTerms`. Write each new row with one `setValues`/`appendRow`, finding the next reference from the last rows or a counter instead of re-reading the tab. Send emails and audit entries after releasing the lock. | S7–S9, S12, S18 | No lost writes. Lock held well under 1 s, so 10 simultaneous postings succeed. Removes the possible bottom-of-tab failure. | 1.5–2 days |
| 4 | **Yearly archiving.** Move closed years of Savings, Repayments, Audit Log and Guarantor Notifications to an archive spreadsheet, carrying balances forward as opening rows; cleared loans and decided requests move with them. All-time reports read the archive on demand. | S10 | Keeps live tabs at about one year, so the ceiling stops shrinking over time. Also keeps the spreadsheet under 10M cells. | 3–5 days (opening balances, Loan Insights all-time figures and statements need care) |
| 5 | **Trim unused columns and page large lists.** Delete unused grid columns on every tab (a setup step). Page the savings ledger, repayments and loan requests on the server, as the audit log already does. | S11, S13 | Roughly 3× more data fits in 10M cells; replies stay small. | 1 day |

Outside the code: host the club on **Google Workspace** (1,500 emails a day, 6 h of trigger time) if it will pass about 55 members, and/or reduce per-transaction emails (for example a daily digest to admins instead of one email per admin per event).

---

## Suggested MOU wording: capacity clause

Two versions. Use **A** if the system is handed over as it is. Use **B** if optimisations 1–3 (and 4 for long-term use) are delivered first. Before signing, replace each figure marked [confirm] with the median measured on the test copy (`bench/README.md`).

**A. Current version**

> **Capacity.** The System is designed for a club of up to **30 active members** with up to **12 months** of transaction history held in the live spreadsheet, about **2,500 transactions a year**. Within these limits, the Developer will ensure that the common screens and actions (member home page, admin page, posting deposits, repayments and surcharges, loan and withdrawal requests, and loan approvals) respond within **10 seconds** under normal conditions [confirm]. At most **5 users** may open the System at the same moment, and at most **2 administrators** may post or approve transactions at the same time.
>
> The System runs on Google Apps Script and Google Sheets and is subject to Google's published limits, which the Developer does not control. These include 6 minutes per operation, 10 million cells per spreadsheet, 30 simultaneous operations for the hosting account, and the hosting account's daily email quota (100 recipients a day for a free Gmail account). On a free Gmail account, email notifications are reliable for up to about **55 members**; above that the Club should host the System on Google Workspace.
>
> If the Club exceeds these limits, response times will rise and some operations may fail. The Developer is not in breach as a result. On request, the Developer will quote for the optimisation work needed to raise the limits.

**B. After the optimisation release**

> **Capacity.** The System is designed for up to **500 active members** and **40,000 transactions a year**, with up to **12 months** of transactions in the live spreadsheet (earlier years are moved to an archive by the yearly archiving function) [confirm]. Within these limits, the common screens and actions respond within **10 seconds** under normal conditions [confirm]. At most **5 users** may open the System at the same moment and at most **5 administrators** may post transactions at the same time.
>
> The System is subject to Google's published Apps Script and Sheets limits as set out above. Email notifications for more than about 55 members require Google Workspace hosting (1,500 recipients a day).
>
> Capacity was assessed with synthetic data at an average of 7–8 transactions per member per month. Substantially higher activity reduces the member limit in proportion.

---

## Method

**What ran.** `bench/run-local.js` loads every `src/**/*.gs` file, the same code the live app runs, into Node with the in-memory Apps Script stand-ins used by `npm test`. It fills the fake spreadsheet with synthetic data and calls each operation as a signed-in member, an admin or the scheduled-job owner: 3 runs each, median reported; a run that exceeded the local time budget was stopped and scaled. Each spreadsheet call is counted with exact cells, plus date conversions, cache and property calls, lock periods and emails. No Google service was called. The live spreadsheet and deployment were not opened.

**Synthetic data** (`bench/gas/BenchData.gs`, deterministic, fake names and `@example.invalid` addresses):

- 1 hosting admin and 5 admins; 70% Founder, 20% Delegate and 10% Non-Members.
- Each saving member per month: 6 deposits (4 Principal, 1 Operations, 1 Welfare); a withdrawal (through an approved request) 1 month in 4; a deposit reversal 1 month in 4.
- Loans: one 3-month loan every 3 months, repaid in 3 instalments, with 2 guarantors. Non-Members take a 1-month Soft Loan every 3 months.
- One surcharge per member every 6 months. 5% of loans are never finished.
- Plus every row the app itself writes: audit entries, guarantor rows and notices, requests.
- Counted result: about 19 rows per member per month across all tabs.

**Estimated Apps Script time** = 3 × the operation's JavaScript time in Node, plus a cost per counted call. These costs are assumptions based on Google's guidance that each spreadsheet call is a round trip and on commonly reported timings. They were **not** measured in this work:

| Cost | Low | Central | High |
|---|---:|---:|---:|
| JavaScript speed vs Node | 2× | 3× | 5× |
| Each sheet read (call) | 20 ms | 40 ms | 80 ms |
| Each cell read | 3 µs | 6 µs | 12 µs |
| Each write call | 10 ms | 25 ms | 60 ms |
| Each `appendRow` | 80 ms | 150 ms | 400 ms |
| Each date conversion (`Utilities.formatDate`) | 5 µs | 10 µs | 30 µs |
| Each cache / property call | 8 / 10 ms | 15 / 20 ms | 40 / 50 ms |
| Each email sent | 200 ms | 400 ms | 1,000 ms |
| Browser round trip per page call | 0.3 s | 0.6 s | 1.5 s |

**Known limits of the estimate.**

- Apps Script may serve repeated reads of the same tab faster than a first read. That would lower the quadratic operations, but not the JavaScript part, which is already above 10 s for the members list at 100 × 1 y.
- PDF building (Google Docs) and real lock contention were not timed locally.
- Network and Google load vary through the day.

**To replace the estimates with measurements**, follow `bench/README.md`. In short: push the code and the harness to a new spreadsheet named "BENCH …" in a test account, then run `benchInit`, `benchProbeGridEdge`, and `benchSetTier` → `benchGenerate` → `benchRun` per tier, plus `benchConcurrency` through a test web-app deployment. Results land in the copy's **Bench Results** tab. The harness refuses any spreadsheet not named BENCH or already holding members, sends no email and creates none of the app's scheduled jobs.

**Files:**

- `bench/run-local.js`: local run.
- `bench/report-tables.js`: tables from results.
- `bench/gas/BenchData.gs`: synthetic data.
- `bench/gas/Bench.gs`: harness for the copy.
- `bench/push-to-copy.ps1`: pushes to a copy; refuses live script IDs.
- `bench/results/`: raw results.
