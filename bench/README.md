# Capacity benchmark

Two parts, both using the same synthetic data (`gas/BenchData.gs`: fake members `Bench Member 0001…`, addresses `@example.invalid`, about 8 transactions per member per month).

| | What it gives | Touches Google? |
|---|---|---|
| `run-local.js` | Exact counts of spreadsheet calls, cells read and written, date conversions and emails per operation, plus the JavaScript time, at every tier. Apps Script time is **estimated** from those counts (`COST` at the top of the file). Also runs the concurrency collision tests. | No |
| `gas/Bench.gs` on a copy | **Measured** Apps Script times, PDF builds, real lock behaviour and real concurrency, on a separate test spreadsheet. | Yes, a separate test project only |

## Local run

```bash
node --max-old-space-size=12288 bench/run-local.js          # all 15 tiers, 1–2 hours
node --max-old-space-size=8192  bench/run-local.js --quick  # two small tiers, a few minutes
```

Results: `bench/results/local.json` (and `local-run.log`).

## Measured run on a copy (never on a live club)

Use a Google account that can be filled with test data, ideally not the club's account (the copy uses its Drive and its Apps Script quotas, and it needs no access to the club's spreadsheet).

1. Create a new blank spreadsheet and name it **`BENCH Sacco capacity`** (the name must start with `BENCH`; the harness refuses otherwise). File → Settings: the club's time zone.
2. Extensions → Apps Script. Project Settings → copy the **Script ID**.
3. Make sure clasp is signed in to that test account (`clasp login`; sign back in to the club's account before the next live release), then from the repository root:
   ```powershell
   .\bench\push-to-copy.ps1 -ScriptId <the copy's script ID>
   ```
   It refuses the script ID of any live club in this repository and never changes `.clasp.json`.
4. In the copy's Apps Script editor run, one at a time (allow the permissions the first time):
   - `benchInit` – marks this project as a bench copy. No email is ever sent from the copy and the app's scheduled jobs are never created.
   - `benchProbeGridEdge` – checks whether writing below the bottom of a tab's grid works (see the capacity report).
   - For each tier: `benchSetTier(100, 1)` → `benchGenerate` → `benchRun`. Both continue by themselves (one-minute triggers) until done; watch the **Bench Results** tab. Then the next tier: `benchSetTier(250, 1)`, … up to the largest that fits.
     To change the arguments, edit a one-line wrapper, e.g. `function t500x3(){ benchSetTier(500, 3); }`.
5. Concurrency (optional): Deploy → New deployment → Web app, *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL, then run for example `function c(){ benchConcurrency('<url>', 'issueFine', 10); }` with `issueFine`, `requestLoan`, `recordSavings`, `recordRepayment` and k = 5 and 10.
6. Optional, read-only: `benchInventoryOf('<live spreadsheet ID>')` lists the live spreadsheet's tabs, rows and grid cells (it only reads; the account must be able to open it).
7. When finished: `benchStop` (removes the copy's triggers), archive the copy's web-app deployment, and delete the copy.
