# Kira SACCO System

A Google Apps Script web app for running a small SACCO (savings and credit cooperative) on top of a Google Sheet. Members sign in with their Google account (or a one-time email code), view their savings, loans and fines, and submit loan/withdrawal requests. Admins record transactions, issue loans, approve or reject requests, and export ledger reports — all backed by a single Google Sheet as the database.

## Features

- **Sign-in without passwords** — auto-detects the signed-in Google account, or falls back to a 6-digit one-time code emailed to the member.
- **Savings** — deposit/withdrawal ledger with running balance per member.
- **Loans** — reducing-balance interest calculation, projected amortization schedule, loan-to-savings limit with admin override, repayment tracking.
- **Loan & withdrawal requests** — members submit requests; admins approve (with limit checks) or reject with a reason.
- **Fines** — issue, track, and mark as paid.
- **Admin dashboard** — member/savings/loan/fine totals, pending requests, overdue loans.
- **Audit log** — every state-changing action is recorded automatically.
- **Reports** — per-member PDF statement (saved to Drive) and a full ledger CSV export.
- **Scheduled jobs** — monthly statements, repayment reminders, and weekly spreadsheet backups via time-driven triggers.
- **Email notifications** — members are emailed on savings changes, loan issuance/repayment, fines, and request decisions.

## Tech stack

- Google Apps Script (V8 runtime), deployed as a web app via `HtmlService`.
- Google Sheets as the data store (no external database).
- Vanilla JS on the frontend, calling the server through `google.script.run`.
- [clasp](https://github.com/google/clasp) for local development and deployment.

## Project structure

```
.
├── appsscript.json              Apps Script manifest (timezone, webapp access, V8 runtime)
├── .clasp.json                  clasp project config (script ID, file extensions)
└── src/
    ├── controllers/             Public functions called from the frontend via google.script.run
    │   ├── AuthController.gs        sign-in, OTP, session, logout
    │   ├── SavingsController.gs     get/record savings
    │   ├── LoanController.gs        get loans, issue loan, record repayment
    │   ├── LoanRequestController.gs request/approve/reject loan requests
    │   ├── WithdrawalController.gs  request/approve/reject withdrawals
    │   ├── FineController.gs        issue fines, mark paid
    │   ├── MemberController.gs      list/add members (admin)
    │   ├── DashboardController.gs   admin dashboard summary, audit log viewer
    │   └── ReportController.gs      member statement (PDF), admin CSV export
    │
    ├── services/                 Internal business logic and Sheet access — not called from the frontend
    │   ├── SheetService.gs           generic sheet read/write helpers (readSheet, ci, nextId, ...)
    │   ├── AuthService.gs            session/member lookup used by every controller
    │   ├── AuditService.gs           auditLog()
    │   ├── EmailService.gs           transactional email templates
    │   ├── MemberService.gs          member lookup by number
    │   ├── SavingsService.gs         savings balance calculation
    │   ├── LoanService.gs            reducing-balance interest math, amortization schedule
    │   └── RequestService.gs         shared approve/reject status updates
    │
    ├── models/                   Data shaping and validation for a single entity
    │   ├── Member.gs                 makeMemberRecord(), validateNewMember()
    │   ├── Loan.gs                    LOAN_STATUS enum, validateLoanIssue()
    │   └── Repayment.gs               validateRepaymentAmount()
    │
    ├── utils/                    Small, dependency-free helpers
    │   ├── Config.gs                 SACCO_NAME/sheet names/etc, PropertiesService wrapper
    │   ├── DateUtils.gs              date formatting
    │   ├── Formatters.gs             number/currency/HTML-escaping helpers
    │   └── Validators.gs             validatePositiveAmount(), validateReason()
    │
    ├── triggers/
    │   └── ScheduledJobs.gs          monthly statements, repayment reminders, weekly backup, createAllTriggers()
    │
    ├── tests/
    │   └── LoanService.test.gs       runnable assertions against the pure loan-math functions
    │
    └── webapp/                   The frontend, served by doGet()
        ├── doGet.gs                  entry point + include() template helper
        ├── index.html                thin assembler: includes auth/app/modals/scripts
        ├── css/styles.html
        ├── services/
        │   └── api.js.html           google.script.run wrappers used by every component script
        └── components/            One folder per feature; *.html is markup, *.js.html is script
            ├── auth/                 login screens
            ├── app/                  shell: header, tab nav, nests each tab's components
            ├── dashboard/             summary cards, overdue loans, audit log view
            ├── loans/                 my loans / admin loan requests / loan modals
            ├── savings/               savings history / admin withdrawals / savings modals
            ├── fines/                 my fines / admin fines / fine modal
            ├── members/               admin member list / add-member modal
            └── reports/               statement + CSV export buttons
```

Because Apps Script has no import/export system, every `.gs`/`.js` file shares one global namespace — files are organized for readability, not for module boundaries. On the frontend, `.js.html` files must keep the `.html` extension because `HtmlService` can only serve `.html` files to the browser; `doGet.gs`'s `include()` helper evaluates each file as its own template, so components can nest other components (see `components/app/app.html`).

## Sheet schema

The spreadsheet must have these tabs (exact names, set in `src/utils/Config.gs`). Column order doesn't matter — columns are matched by header text (case-insensitive, prefix match), so you can add extra columns freely.

| Tab | Key columns |
|---|---|
| `Members` | MemberNo, Full Name, Email, Phone, Role (`Member`/`Admin`), Date Joined, Status (`Active`/...) |
| `Savings` | Date, Timestamp, MemberNo, Type (`Deposit`/`Withdrawal`), Amount (UGX), Recorded By, Reference, Notes |
| `Loans` | LoanID, Timestamp, MemberNo, Date Issued, Principal (UGX), Monthly Rate (%), Term (months), Status, Issued By, Purpose, Override Reason |
| `Loan Repayments` | Date, Timestamp, LoanID, MemberNo, Amount (UGX), Recorded By, Notes |
| `Fines` | FineID, Timestamp, MemberNo, Date, Amount (UGX), Reason, Status (`Unpaid`/`Paid`), Recorded By |
| `Loan Requests` | RequestID, Timestamp, MemberNo, Amount (UGX), Term (months), Purpose, Status, Decision Notes, Decided By |
| `Withdrawal Requests` | RequestID, Timestamp, MemberNo, Amount (UGX), Reason, Status, Decision Notes, Decided By |
| `Audit Log` | Timestamp, Action, Member (Affected), Performed By, Details, Reference ID |

IDs are auto-generated per sheet (`L001`, `R001`, `W001`, `F001`, ...) by `nextId()` in `SheetService.gs`.

## Setup

1. Create a Google Sheet with the tabs and columns listed above.
2. Install [clasp](https://github.com/google/clasp) and log in: `npm install -g @google/clasp && clasp login`.
3. From this directory, push the project to the Apps Script project bound to your sheet (the script ID is already set in `.clasp.json`): `clasp push`.
   - If you're starting fresh instead, open the sheet → Extensions → Apps Script, then `clasp clone <scriptId>` or paste the files in manually, keeping the folder paths (Apps Script displays `/` in a file name as a folder).
4. In the Apps Script editor, run `createAllTriggers` once (from `src/triggers/ScheduledJobs.gs`) to schedule the monthly statement, repayment reminder, and weekly backup jobs. Authorize the requested permissions when prompted.
5. Deploy → New deployment → Web app:
   - Execute as: **Me**
   - Who has access: **Anyone** (or restrict to your organization)
6. Open the deployed `/exec` URL — that's the SACCO app.

### Re-deploying after changes

`clasp push`, then in the Apps Script editor: Deploy → Manage deployments → edit (pencil) → New version → Deploy. Pushing alone updates the code but not a published web app version.

## Configuration

Edit the constants at the top of `src/utils/Config.gs`:

- `SACCO_NAME`, `BRAND_COLOR` — used in the UI and email templates.
- `LOAN_TO_SAVINGS_LIMIT` — max loan principal as a multiple of the member's savings balance (admins can override per-loan with a reason).
- `OTP_EXPIRY_MS` — how long a one-time sign-in code stays valid.
- `SH_*` — the exact sheet tab names the app reads from.

## Authentication

1. The frontend silently probes `Session.getActiveUser()` (`tryAutoDetect`). If it matches a registered, active member, the user just confirms the detected email (`confirmAutoDetect`).
2. Otherwise, the member enters their email, gets a 6-digit code by email (`sendOtp`), and verifies it (`verifyOtp`). The code is stored in script properties with an expiry and is single-use.
3. Once verified, the session is remembered via user properties (`Config.setUserProp`) so the member doesn't have to re-verify every visit; `logout()` clears it.
4. Every protected controller function calls `_caller()` / `_adminCaller()` (`AuthService.gs`) to resolve and authorize the current member before doing anything.

## Testing

`src/tests/LoanService.test.gs` contains real assertions against `_schedule()` and `_computeLoan()` — both are pure functions (only `Date`/`Math`, no Sheet access), so they can be exercised directly with in-memory fixtures. Run `runLoanServiceTests()` from the Apps Script editor; it throws on the first failing assertion and logs a PASS/FAIL line per check either way.

## Notes

- All amounts are stored and displayed in UGX.
- The web app runs as the deploying user (`executeAs: USER_DEPLOYING` in `appsscript.json`), so it only needs the deployer's Sheet/Drive/Mail permissions — members never need direct access to the spreadsheet.
- Email failures are swallowed (`EmailService.gs`) so a transaction still succeeds even if a notification can't be sent; audit log writes are similarly non-fatal.
