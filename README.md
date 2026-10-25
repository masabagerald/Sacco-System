# Kira SACCO System

A Google Apps Script web app for running a small SACCO (savings and credit cooperative) on top of a Google Sheet. Members sign in with their Google account (or a one-time email code), view their savings, loans and surcharges, and submit loan and withdrawal requests. Admins record transactions, approve requests, run the loan fund, investments and asset register, and export reports. A single Google Sheet is the database.

**Contents**

- [Features](#features)
- [Setting up for a new club (from clone to live)](#setting-up-for-a-new-club-from-clone-to-live)
- [Updating a club that is already live](#updating-a-club-that-is-already-live)
- [Moving a club to a different Google account](#moving-a-club-to-a-different-google-account)
- [Troubleshooting](#troubleshooting)
- [Configuration reference](#configuration-reference)
- [Sheet schema](#sheet-schema)
- [Project structure](#project-structure)
- [Tests](#tests)
- [How it works](#how-it-works) (authentication, loans, Loan Insights, investments, upgrades)

## Features

- **Sign-in without passwords**: auto-detects the signed-in Google account, or falls back to a 6-digit one-time code emailed to the member.
- **Savings / deposit accounts**: each member's deposits are held in three accounts with separate balances: **Principal**, **Operations** and **Welfare**. Corrections and reversals never edit a row; they append a reversal (and, for a correction, a replacement) and write to the audit log.
- **Withdrawal requests**: Founder and Delegate Members withdraw from a chosen account. Principal is limited by the member's own balance; Operations and Welfare are club pools. Two different admins must approve.
- **Loans**: Founder/Delegate member loans and Non-Member Soft Loans, each with exactly two consenting Founder Member guarantors and two different admin approvals. Guarantors are notified of repayments, surcharges, overdue status and clearance.
- **Loans with security**: a Founder Member short of a savings coverage requirement can offer an asset as security; three committee administrators must approve the waiver.
- **Repayments**: a breakdown of principal, interest, processing fee and surcharge before saving; reversals keep the original.
- **Surcharges**, **admin dashboard**, **Loan Insights** (loan-fund cash, interest, fees, overdue, borrowers), **Investment Tracker**, **Asset Register** (independent verification, PDF/Excel export).
- **Audit log** of every action, with date and time.
- **Reports**: member PDF statements, ledger PDF and CSV.
- **Scheduled jobs**: monthly statements and audit report, repayment reminders, due-date processing and weekly spreadsheet backups.
- **Email notifications** to members, guarantors and admins.
- **User guide** for members and admins, served by the app at `<app URL>?page=guide`.

Tech: Google Apps Script (V8), `HtmlService` web app, Google Sheets as the data store, vanilla JS frontend calling the server through `google.script.run`, and [clasp](https://github.com/google/clasp) for local development and deployment.

---

## Setting up for a new club (from clone to live)

Each club gets its **own Google account, its own spreadsheet and its own copy of the script**. Nothing is shared between clubs. Allow about an hour for the first club.

### 1. Decide which Google account will own the club

The web app runs **as the account that deploys it**. That account:

- owns the spreadsheet (all the club's data) and the Apps Script project,
- sends every email (sign-in codes, notices, statements) from its Gmail,
- stores the weekly backups and PDF statements in its Google Drive.

Use a **dedicated account for the club** (for example `yourclub.sacco@gmail.com`, or an account on the club's Google Workspace), not your personal account. The club should know its password and recovery details. You can do the setup while signed in to that account, or have the club share the spreadsheet with you (see step 4).

Email limits come from that account: a free Gmail account can email about **100 recipients a day**; Google Workspace about **1,500**. For a club of more than about 40 members, monthly statements on a free account may hit the limit; use Workspace or expect some emails to wait until the next day.

### 2. Prepare your computer (once)

| Tool | Needed for | Install |
|---|---|---|
| Git | getting the code | https://git-scm.com |
| Node.js **22 or newer** | `clasp` and the test suite | https://nodejs.org |
| clasp 3.x | pushing code to Apps Script and deploying | `npm install -g @google/clasp` |
| Python 3 with Pillow | *optional*: rebuilding the in-app user guide | `pip install pillow` |
| Google Chrome or Edge | *optional*: regenerating the user-guide screenshots | |

Check: `node --version` (v22 or later) and `clasp --version` (3.x).

### 3. Get the code and check it works

```bash
git clone <repository-url> sacco-system
cd sacco-system
npm install
npm test          # every suite should pass, for example "86 passed, 0 failed"
```

Keep each club's settings on its own branch, so updates from `main` can be merged into every club later:

```bash
git checkout -b club/<shortname>      # for example club/msic
```

### 4. Create the club's spreadsheet and its Apps Script project

Signed in **as the club's Google account**:

1. Go to https://sheets.new to create a blank spreadsheet. Name it, for example *"Kampala Teachers SACCO – Database"*.
2. **File → Settings**: set **Locale** (for example *Uganda*) and **Time zone** (for example *(GMT+03:00) Kampala*). Save.
3. **Extensions → Apps Script**. A new script project opens, attached to this spreadsheet. Rename it (top left), for example *"Kampala Teachers SACCO"*.
   - The project **must** be created from the spreadsheet like this. The code reads "the spreadsheet this script belongs to"; a standalone script from script.google.com will not work.
4. In the Apps Script editor, click **Project Settings** (the gear icon):
   - Tick **Show "appsscript.json" manifest file in editor**.
   - Copy the **Script ID**. You need it in step 6.

If someone else will do the technical setup, the club shares the spreadsheet with them as **Editor**; they can then open Extensions → Apps Script and push code. The **deployment in step 8 should still be done signed in as the club's account**, so the app runs and sends email as the club.

### 5. Turn on the Apps Script API (once per Google account that uses clasp)

Open https://script.google.com/home/usersettings while signed in as the account you will use with clasp, and switch **Google Apps Script API** to **On**. Without this, `clasp push` fails with *"User has not enabled the Apps Script API"*.

### 6. Configure the club in the code

Edit these files on the club's branch:

**`src/utils/Config.gs`** (top of the file):

| Setting | What to put |
|---|---|
| `SACCO_NAME` | Full club name. Shown on the sign-in page, page title, emails and PDFs. |
| `CLUB_SHORT_NAME` | Short code, letters only, for example `KTS`. Member numbers become `KTS-0001`; export files are named `KTS_Asset_Register_…`. **Choose it before adding members**; member numbers never change once given. |
| `BRAND_COLOR` | Main colour for emails and PDFs (hex, for example `#143452`). |
| Loan rules | `LOAN_TO_SAVINGS_LIMIT`, `GUARANTOR_COUNT`, `GUARANTOR_SAVINGS_RATIO`, `MEMBER_LOAN_RATE`, `MEMBER_LOAN_MIN_MONTHS`, `MEMBER_LOAN_FEE`, `PROCESSING_FEE`, `LOAN_TERMS`, `OVERDUE_SURCHARGE_RATE`: set from the club's by-laws. |
| Categories | `PAYMENT_CATEGORIES`, `SURCHARGE_REASONS`, `WITHDRAWAL_REASONS`, `MEMBERSHIP_TYPES`. |
| Waivers | `WAIVER_APPROVALS_REQUIRED`, `WAIVER_ROLE_MINIMUMS` (who must approve a loan with security). |
| Assets | `ASSET_TYPES`, `ASSET_CONDITIONS`, `ASSET_AVAILABILITY`. |

**`src/utils/Branding.gs`**: the club's logo, `CLUB_LOGO_B64`, is a base64-encoded **JPEG**. It is used on the web page, in emails and in PDFs. Use a square image of about 256×256 pixels, under 50 KB. To produce the text:

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("logo.jpg")) | Set-Clipboard
```
```bash
# macOS / Linux
base64 -i logo.jpg | tr -d '\n' | pbcopy        # Linux: base64 -w0 logo.jpg
```

Paste it between the quotes of `const CLUB_LOGO_B64 = '…';` (one long line).

**`src/utils/Terms.gs`**: the starting text of the **Terms of Use** (every user) and the **Administrator Confidentiality and Conduct Agreement** (admins) that each user must accept at first sign-in. It is a template covering account security, confidentiality and non-disclosure, no manipulation of records, segregation of duties and personal data. **Have the club's committee or lawyer review it.** After go-live, admins change the terms in the app (menu → **Terms of use** → **Edit terms**): each publish is a new version, and everyone it applies to accepts it at their next sign-in. You can also edit this file before the first deployment so the club starts with its own text.

**`appsscript.json`**: set `"timeZone"` to the club's zone, for example `"Africa/Kampala"`, `"Africa/Nairobi"` or `"Africa/Dar_es_Salaam"`. It must match the spreadsheet's time zone (step 4). Dates, due dates and audit times use it. Leave the `"webapp"` section as it is.

**`.clasp.json`**: replace `"scriptId"` with the Script ID from step 4.

Then commit on the club branch:

```bash
npm test
git commit -am "Configure <club name>"
```

### 7. Push the code to the club's project

```bash
clasp logout                 # only if clasp is signed in to a different account
clasp login                  # sign in as the account from step 5, in the browser that opens
clasp push --force           # --force: overwrite the project's default manifest
```

`clasp push` uploads `appsscript.json` and everything under `src/` (see `.claspignore`); tests, tools and docs are not uploaded. Reload the Apps Script editor: you should see folders such as `src/controllers`, `src/services` and `src/webapp`. The default empty `Code.gs` can be deleted in the editor.

### 8. Deploy the web app (and allow its permissions)

Signed in **as the club's account**, in the Apps Script editor:

1. **Deploy → New deployment**. Click the gear next to *Select type* and choose **Web app**.
2. Description: for example `v1 – first release`.
3. **Execute as: Me (the club's account)**.
4. **Who has access: Anyone**. Members sign in inside the app, so they don't need any Google permissions. Choose *Anyone with Google account* only if every member has a Google account and you want Google to check that first.
5. Click **Deploy**. Google asks the club's account to allow the app's permissions: choose the account, then **Advanced → Go to *(project name)* (unsafe) → Allow**. The warning appears because the script is private to the club and not published by Google; it is expected.
   - The app asks for access to: the spreadsheet, Google Drive (backups and PDFs), Google Docs (building PDFs), sending email as the club, and running scheduled jobs.
6. Copy the **Web app URL** (it ends in `/exec`). This is the club's app; it never changes as long as you update this same deployment (see [Updating](#updating-a-club-that-is-already-live)).
7. Note the **Deployment ID** (Deploy → Manage deployments, or `clasp list-deployments`). You need it to update the club later.

Do this first deployment in the editor, not with `clasp deploy`: `clasp deploy` can't show Google's permission screen, and until the permissions are allowed the app only shows *"Authorization required"*.

### 9. Open the app: the database sets itself up

Open the web app URL. **The first time the app is opened, it sets up the spreadsheet by itself** (it takes a few seconds):

- creates every tab with its header row (Members, Savings, Loans, Loan Repayments, Surcharge, Loan Requests, Withdrawal Requests, Audit Log, Guarantors, Loan Fund Ledger, Investments, Loan Waivers, Assets, and the rest; see [Sheet schema](#sheet-schema));
- schedules the automatic jobs:

  | Job | When |
  |---|---|
  | `processLoanDueDates`: due-date reminders, overdue surcharges | daily, 7 am |
  | `sendRepaymentReminders` | daily 9 am, and on the 25th, 8 am |
  | `sendMonthlyStatements` | 1st of the month, 7 am |
  | `sendMonthlyAuditReport` | 1st of the month, 5 am |
  | `sendPendingActionReminders`: one email per person listing approvals, reviews and guarantor consents waiting for them over 12 hours | daily, 8 am |
  | `backupSpreadsheet`: copy to a Drive folder, keeps 8 | Mondays, 6 am |

- adds **the hosting account (the club's Google account) as the first member**: `<SHORT>-0001`, **System Administrator**, an **Admin with no membership type**.

The hosting account is an administrator only. It runs the app, so the app keeps it an active Admin: it can't be changed to an ordinary Member, made Inactive, or given a membership type. It has no savings or loans of its own. The club's officers are added as their own members in step 10, with their own emails.

Then sign in: enter the **club account's email address**; a sign-in code arrives in that account's Gmail.

Setup runs only once. It never deletes or changes existing rows, and the next visits skip it. To check it, open the spreadsheet (new tabs, *Club Set Up* on the **Audit Log** tab) and the Apps Script editor (**Triggers**, the alarm-clock icon). You can delete the empty *Sheet1* tab.

**Running setup by hand instead.** In the Apps Script editor, open `src/services/SetupService.gs`, choose **`setupNewClub`** and click **Run**; the **Execution log** shows *"Setup complete…"*. This does exactly the same and is safe to run again. Use it if you want the spreadsheet ready before anyone opens the app, or to check for errors. `createAllTriggers` (in `src/triggers/ScheduledJobs.gs`) recreates the scheduled jobs on its own.

### 10. Go live

1. Signed in as the System Administrator: **Members → + Add Member** for every member: name, the email they will sign in with, phone, role (Member or Admin), membership type and **date joined the club**. The 12-month saving rule for loans counts from that date.
2. Make the club's officers **Admins** (role Admin). Have **at least three admins besides the System Administrator**: most approvals need two different admins who did not start the request, and waivers need three.
   - At first sign-in every user, including the System Administrator, must accept the Terms of Use; admins also accept the Administrator Agreement. Until they do, the app refuses every request for them.
3. Set the **committee roles** (Members → Edit → Committee role): at least the numbers in `WAIVER_ROLE_MINIMUMS` (by default one Chairperson and two Finance Committee members, all Admins). Without them, no loan with security can be approved.
4. Enter opening balances: **Savings → Record Savings** for each member, with the real transaction date, account and payment category.
5. Try one member account end to end: sign in, view savings, request a withdrawal; then approve it as two different admins.
6. **User guide**: the app serves it at `<web app URL>?page=guide`. It is built from `docs/USER_GUIDE.md`, which describes the club this project was first built for (names, member numbers and screenshots). For a new club, edit `docs/USER_GUIDE.md` and rebuild it with `python tools/build-guide.py` (optionally regenerate screenshots first with `npm run screenshots`), then push and update the deployment.
7. Share the web app URL with members (WhatsApp, email). Members never need access to the spreadsheet: **don't share the spreadsheet** with anyone except trusted administrators of the club account.

The club is live.

---

## Updating a club that is already live

From the club's branch:

```bash
git checkout club/<shortname>
git merge main                    # bring in the latest changes; keep the club's own Config.gs, logo and .clasp.json
npm test
clasp push --force
clasp deploy -i <DEPLOYMENT_ID> -d "Short description of the update"
```

- **Always pass `-i <DEPLOYMENT_ID>`**. It updates the existing deployment, so the URL stays the same. `clasp deploy` without `-i` creates a *new* deployment with a *new* URL. Find the ID with `clasp list-deployments`.
- `clasp push` alone changes the code in the editor (and the `…/dev` test URL), not the live `/exec` app. The live app changes only when the deployment is updated.
- If an update adds tabs, columns or scheduled jobs, it raises `SETUP_VERSION` in `src/services/SetupService.gs`, and the first visit after deploying runs setup again automatically, adding only what is missing. New scheduled jobs are added alongside the existing ones, without duplicating them. You can also run `setupNewClub` in the editor yourself; it is safe any time.
- If the update needs a new Google permission, the app may show *"Authorization required"* until someone runs any function (for example `setupNewClub`) in the editor as the club's account and allows it.
- In the editor you can also do it by hand: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.

---

## Moving a club to a different Google account

To move an existing club (for example from your account to the club's own account):

1. Signed in as the **new** account, open the spreadsheet (it must be shared with the new account) and choose **File → Make a copy**. Copying a spreadsheet also copies its attached Apps Script project, so the copy has all the data and all the code.
2. Open the copy → **Extensions → Apps Script**. This is a new project with a **new Script ID**: put it in `.clasp.json` on the club's branch.
3. Run **`createAllTriggers`** in the editor (it asks for permission for the new account). Triggers are not copied with the spreadsheet.
4. **Deploy → New deployment** as in step 8. The URL is new: send it to members.
5. Add the new account as a member if it isn't one yet (the old hosting account's member row stays as it was). Setup adds the hosting account automatically only to an empty Members tab.
6. Turn off the old copy, so it stops sending emails and changing data: in the old project delete its triggers (**Triggers** page) and archive the old deployment (**Deploy → Manage deployments → Archive**). Keep the old spreadsheet as a read-only archive, or delete it once the new one is checked.

Members sign in again on the new URL (sign-in sessions are not copied). Member numbers, balances, loans and the audit log are unchanged.

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `clasp push`: *User has not enabled the Apps Script API* | Turn it on at https://script.google.com/home/usersettings for the account clasp is using (step 5). |
| `clasp push`: *Manifest file has been updated. Do you want to push and overwrite?* | Use `clasp push --force`. |
| `clasp push` succeeds but the editor shows nothing new | Wrong `scriptId` in `.clasp.json`, or clasp is signed in to another account (`clasp logout`, `clasp login`). |
| The app says *Sheet "Members" not found* (or another tab) | Automatic setup did not finish: run `setupNewClub` in the editor to see the error (step 9). The script must belong to the spreadsheet (step 4). |
| *Authorization required* on the first visit | The app's permissions haven't been allowed yet: deploy from the editor (step 8), or run `setupNewClub` in the editor and allow. |
| *This is the hosting account… It must stay an Admin* | The hosting account (System Administrator) runs the app and can't be demoted, deactivated or given a membership type. |
| *Script function not found: doGet* | The code has not been pushed to this project, or the deployment is of an old version: push and update the deployment. |
| The app still shows old behaviour after an update | `clasp push` does not update the live app. Run `clasp deploy -i <DEPLOYMENT_ID>`. |
| *Authorization is required to perform that action* | A new permission is needed: run any function in the editor as the club's account and allow it. |
| Members never receive sign-in codes | Check their spam folder; check the email on the Members tab (members sign in with exactly that address); check the club account's daily email limit. Problems are listed under **Executions** in the Apps Script editor. |
| Members are not recognised automatically and always get a code | Normal for free Gmail accounts: Google only shares the visitor's email with apps in the same Workspace. The emailed code is the standard sign-in. |
| Dates or times are a few hours off | The spreadsheet time zone (File → Settings) and `"timeZone"` in `appsscript.json` differ. Set both to the club's zone. |
| *You registered this asset / You initiated this request…* | Working as intended: a different admin must approve. A club needs at least three active admins. |
| A loan with security can't be approved | Set committee roles (Members → Edit) to meet `WAIVER_ROLE_MINIMUMS`. |
| *Please read and accept the Terms of Use…* | The user hasn't accepted the current version of the terms (`src/utils/Terms.gs`). They sign in again and accept. Who accepted what, and when, is on the **Terms Acceptance** tab. |

Every action an admin or member takes is in the **Audit log** (Admin menu) and on the **Audit Log** tab; errors are under **Executions** in the Apps Script editor.

---

## Configuration reference

All settings are constants at the top of `src/utils/Config.gs`, plus the logo in `src/utils/Branding.gs` and `"timeZone"` in `appsscript.json`. The main ones:

- `SACCO_NAME`, `CLUB_SHORT_NAME`, `BRAND_COLOR`: club identity (see step 6). `MEMBER_NO_PREFIX` is derived from `CLUB_SHORT_NAME`.
- `LOAN_TO_SAVINGS_LIMIT`: max member-loan principal as a multiple of the member's Principal savings (admins can override with a reason). `GUARANTOR_SAVINGS_RATIO`: each guarantor's Principal must be at least this share of the loan.
- `MEMBER_LOAN_*`, `PROCESSING_FEE`, `LOAN_TERMS`, `OVERDUE_*`: loan products and overdue rules.
- `REPAYMENT_ALLOCATION_ORDER`: how a repayment is split (fee → interest → penalty → principal).
- `WAIVER_APPROVALS_REQUIRED`, `WAIVER_ROLE_MINIMUMS`, `COMMITTEE_ROLES`, `SECURITY_TYPES`: loans with security.
- `ASSET_TYPES`, `ASSET_CONDITIONS`, `ASSET_AVAILABILITY`, `ASSET_PAGE_SIZE`: asset register.
- `INSIGHTS_MEMBERSHIP_TYPES`: who besides admins sees Loan Insights (aggregate only).
- `OTP_EXPIRY_MS`: how long a sign-in code stays valid.
- Terms of use: the starting texts are in `src/utils/Terms.gs`; versions published in the app are on the **Terms Versions** tab.
- `SH_*`: tab names. Change them only before setting up a club; `setupNewClub` creates tabs with these names.

All amounts are in UGX (`INVESTMENT_CURRENCY`); other currencies are not supported.

---

## Sheet schema

The app creates every tab below with its header row the first time it is opened (or when `setupNewClub` is run); you don't need to type them. Columns are matched by header text (case-insensitive; a header may have extra words after the name, for example `Amount (UGX)`), so column order doesn't matter and extra columns can be added freely. The header row can sit below a title.

| Tab | Holds |
|---|---|
| `Members` | MemberNo (`<SHORT>-0001`, assigned automatically, never changed or reused), Full Name, Email, Phone, Role (`Member`/`Admin`), Membership Type, Date Joined, Status (`Active`/`Inactive`), Committee Role |
| `Savings` | Date, Timestamp, MemberNo, Deposit Type, Amount (UGX), Recorded By, Reference, Notes, Payment Category, Surcharge Reason, Deposit Account, Reverses |
| `Loans` | LoanID, Timestamp, MemberNo, Date Issued, Principal (UGX), Status, Issued By, Purpose, Override Reason, Loan Model, Processing Fee (UGX), Interest Rate (%), Term (months), Term (days), Due Date, Overdue Surcharge (UGX), Last Notice |
| `Loan Repayments` | LoanID, Date, Timestamp, MemberNo, Amount (UGX), Recorded By, Notes, Reference, Reverses |
| `Surcharge` | FineID, Timestamp, MemberNo, Date, Amount (UGX), Reason, Status (`Unpaid`/`Paid`), Recorded By |
| `Loan Requests` | RequestID, Timestamp, MemberNo, Amount (UGX), Repayment Term, Purpose, Status, Decision Notes, Decided By, Initiated By, Guarantor 1/2, Total Due, Approver 1/2 (+ At), Guarantor Override, Limit Override |
| `Withdrawal Requests` | RequestID, Timestamp, MemberNo, Amount (UGX), Reason, Status, Decision Notes, Decided By, Initiated By, Approver 1/2 (+ At), Deposit Account |
| `Audit Log` | Timestamp, Action, Member (Affected), Performed By, Details, Reference ID. Append-only. |
| `Terms Acceptance` | Timestamp, MemberNo, Email, Role, Document (`use` / `admin`), Title, Version, Decision (`Accepted` / `Declined`). Append-only: one row per document accepted or declined. |
| `Terms Versions` | Timestamp, Document, Version, Title, Checkbox, Text, Change Summary, Published By. Append-only: every version an admin published, with its full text. |
| `Guarantors` | one row per guarantor per request: consent, token, response time, decline reason |
| `Guarantor Notifications` | one row per notice sent, so none is sent twice |
| `Loan Fund Ledger`, `Investments`, `Investment Transactions` | loan-fund cash entries and the investment tracker |
| `Loan Waivers`, `Waiver Decisions` | loans with security: security details, eligibility snapshot, each committee decision |
| `Assets`, `Asset Reviews`, `Asset History` | asset register, every verification decision, every change with old and new values |

Every record gets a reference of the form `CODE-000001`: six digits, one counter per record type. The codes are in `REF_CODES` (`src/utils/Config.gs`): `LN` loans, `LRQ` loan requests, `WRQ` withdrawal requests, `SUR` surcharges, `RPY` repayments, `DEP` / `WDL` / `REV` savings deposits, withdrawals and reversals, `LFE` loan fund entries, `INV` investments, `IVT` investment transactions, `AST` assets. Clubs set up before this format keep their older references (`L007`, `R012`, `AST-0004`, …), which stay valid; new numbers continue after the highest existing one. Member numbers have their own format, `<CLUB_SHORT_NAME>-0001`.

**Never delete or reorder rows by hand.** Corrections are made in the app (reversals, corrections, edits with a reason), which keeps the audit trail intact.

---

## Project structure

```
.
├── appsscript.json            Apps Script manifest: time zone, V8, web app settings
├── .clasp.json                clasp: the Script ID of the club's project (one per club)
├── .claspignore               only appsscript.json and src/ are pushed
├── src/
│   ├── controllers/           functions the web page calls through google.script.run
│   │                          (Auth, Dashboard, Savings, Withdrawal, Loan, LoanRequest, SecuredLoan,
│   │                           Fine, Member, Report, LoanInsights, Investment, Asset)
│   ├── services/              business rules and sheet access, not called from the page
│   │                          (SheetService, AuthService, AuditService, EmailService, LoanService,
│   │                           RepaymentService, GuarantorService, GuarantorNotificationService,
│   │                           GuarantorWeb (guarantor email links), SecuredLoanService, AssetService,
│   │                           LoanInsightsService, InvestmentService, ApprovalLedgerService,
│   │                           MemberNumberService, SetupService (first-visit setup, setupNewClub), ...)
│   ├── models/                Member, Loan, Repayment shaping and validation
│   ├── utils/                 Config.gs (all settings), Branding.gs (logo, PDF layout), dates, formatters, validators
│   ├── triggers/              ScheduledJobs.gs: scheduled jobs and createAllTriggers()
│   ├── tests/                 .gs test suites that can also run in the editor
│   └── webapp/                the web page: doGet.gs, index.html, css, api.js, components/<feature>/,
│                              guide/guide.html (built user guide)
├── tests/                     Node test runner, in-memory Apps Script fakes, integration tests (not pushed)
├── tools/                     build-guide.py (user guide), screenshots/ (guide screenshots) (not pushed)
└── docs/                      USER_GUIDE.md and its images
```

Apps Script has no modules: every `.gs` file shares one global namespace, and files load in alphabetical order of their path, so a constant in `Config.gs` (in `utils/`) is not yet defined while files in `controllers/` or `services/` first load. Use constants inside functions, not at the top level of those files. Frontend `.js.html` files keep the `.html` extension because `HtmlService` only serves `.html`; `include()` in `doGet.gs` evaluates each file as a template, so components can nest and use `<?= SACCO_NAME ?>`.

---

## Tests

- `npm test` runs every suite under Node, with in-memory stand-ins for the Apps Script services (`tests/gas-fakes.js`): the `.gs` suites in `src/tests/` and the integration tests in `tests/*.integration.js`, which call the real controllers against an in-memory spreadsheet. Run it before every push.
- `tests/new-club.integration.js` checks that the first visit turns a blank spreadsheet into a working club, with the hosting account as System Administrator, and that a live club is left unchanged.
- `npm run screenshots` regenerates the user-guide screenshots (needs Chrome or Edge); `python tools/build-guide.py` rebuilds `src/webapp/guide/guide.html` from `docs/USER_GUIDE.md`.

---

## How it works

### Authentication

1. The page first asks the server who the visitor is (`tryAutoDetect`, using `Session.getActiveUser()`). If that email belongs to an active member, the member only confirms it.
2. Otherwise the member enters their email, receives a 6-digit code (`sendOtp`) and enters it (`verifyOtp`). Codes are kept in script properties, expire after `OTP_EXPIRY_MS` and work once.
3. The session is remembered in user properties, so members don't sign in on every visit; `logout()` clears it.
4. Every server function calls `_caller()` / `_adminCaller()` (`AuthService.gs`) first, so permissions are checked on the server, never only in the page.

The web app runs as the deploying account (`executeAs: USER_DEPLOYING`), so members never need access to the spreadsheet. Email failures don't block a transaction; they are skipped and the action is still saved and audited.

### Loans and repayments

Loan rules (Article 4 of the by-laws) are in `Config.gs` and `src/services/LoanService.gs`. Every loan needs exactly two Founder Member guarantors, each with Principal savings of at least `GUARANTOR_SAVINGS_RATIO` of the loan; both consent by email before two different admins approve, and the second approval issues the loan. Loans with security (`src/services/SecuredLoanService.gs`) add a three-administrator waiver stage before the guarantors are asked; only the coverage requirement that failed is waived.

Each repayment row stores one total. It is split **fee → interest → penalty → principal** (`REPAYMENT_ALLOCATION_ORDER`); a charge only takes money paid on or after the day it was charged, and an overpayment is held as credit. The Record Repayment form shows this split before saving. A wrong repayment is reversed (a negative row with `Reverses` set); the original is never changed.

### Loan Insights and the Investment Tracker

Nothing is stored as a dashboard total: every figure is calculated from the source tabs each time (`src/services/LoanInsightsService.gs`).

- **Loan-fund capital** is the club-wide Principal savings balance. **Available loan cash** = Principal savings net + approved cash injections + transfers from investments + repayments − loans disbursed − approved other outflows − transfers to investments.
- **Charged vs collected**: interest and fees are charged when the loan is issued, surcharges and penalties when they apply; cash received is reported separately.
- **Trace**: the admin cash-ledger trace lists every movement with a running balance, which always equals available cash.
- Loan Fund Ledger entries and investment transactions count only after two different admins approve them; corrections are reversal entries.
- **Investments** (`src/services/InvestmentService.gs`): net invested, value from the latest manual valuation, income (received, reinvested, accrued), capital gain and net return. Transfers to or from the loan fund are two linked entries approved together.

### Asset register

`src/services/AssetService.gs`. Admins only. Every new asset, and every material change (identity, value, condition, status, location, disposal), must be verified by a different admin; rejections need a reason. Disposed assets stay on the register. PDF and Excel exports use the list's filters; the Excel file is built with `Utilities.zip` (no extra permission needed).

### Upgrading an older install

For a spreadsheet created before these features, nothing needs to be run by hand: the first visit after deploying runs setup, which adds every missing column and tab (deposit accounts, guarantors and notices, loan fund and investments, loans with security and committee roles, asset register) and gives existing repayments references. Existing rows are not changed: rows without a deposit account are placed by their payment category (Operations Fee → Operations, Welfare Fee → Welfare, everything else → Principal), so each member's total savings stays the same.

**Member numbers.** Members are numbered `<CLUB_SHORT_NAME>-0001`, `-0002`, … (`src/services/MemberNumberService.gs`). For a spreadsheet with older `M001`-style numbers, run `previewMemberNumberMigration()` to see what would change, then `migrateMemberNumbers()` once. It rewrites member numbers on every tab except the append-only Audit Log, which keeps the old numbers and gets one entry recording the mapping. It is safe to run again.

**Not supported yet**: loan write-offs or cancellations, currencies other than UGX, and file uploads (supporting documents are stored as https links, for example to Google Drive).
