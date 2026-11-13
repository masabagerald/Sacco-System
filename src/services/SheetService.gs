// ── GENERIC SHEET HELPERS ─────────────────────────────────────────────────────

function getSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found. Check tab name matches exactly.');
  return sh;
}

// Columns that hold a moment rather than a day ("Timestamp", "Responded At", "Approver 1 At").
// Sheets turns the 'yyyy-MM-dd HH:mm:ss' text written by now_ts() into a date-time cell; these
// columns are read back with their time, every other date cell as 'yyyy-MM-dd'.
function isMomentHeader_(h) { return /timestamp|\bat$/i.test(String(h).trim()); }

// Spreadsheet timezone: the zone Sheets used when it turned the written text into a date-time, so
// formatting in it gives back exactly the wall-clock time that was written.
function sheetTimeZone_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
  catch (e) { return Session.getScriptTimeZone(); }
}

// Read a sheet into an array of row objects keyed by header name.
// headerHint: one column name expected in the header row.
function readSheet_(sheetName, headerHint) {
  const sh = getSheet_(sheetName);
  const data = sh.getDataRange().getValues();
  let hRow = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].some(v => String(v).trim().toLowerCase() === headerHint.toLowerCase())) { hRow = i; break; }
  }
  if (hRow === -1) return { headers: [], rows: [], sh, hRow: -1 };
  const headers = data[hRow].map(h => String(h).trim());
  const moment = headers.map(isMomentHeader_);
  let tz = null;
  const rows = [];
  for (let r = hRow + 1; r < data.length; r++) {
    const obj = { _row: r + 1 }; let any = false;
    headers.forEach((h, c) => {
      let v = data[r][c];
      if (v instanceof Date) v = moment[c] ? Utilities.formatDate(v, tz || (tz = sheetTimeZone_()), 'yyyy-MM-dd HH:mm:ss') : fmt_date(v);
      obj[h] = v; if (String(v).trim()) any = true;
    });
    if (any) rows.push(obj);
  }
  return { headers, rows, sh, hRow };
}

// First non-empty value among alternative column names (sheets have used different headers over time)
function pick_(row, names) {
  for (const n of names) { const v = row[n]; if (v !== undefined && String(v).trim() !== '') return v; }
  return '';
}

// Return 0-based column index for the first header starting with `name`.
function ci(headers, name) {
  const n = name.toLowerCase();
  for (let i = 0; i < headers.length; i++)
    if (String(headers[i]).trim().toLowerCase().startsWith(n)) return i;
  return -1;
}

// Find first empty row after header (by key column); append if none.
function emptyRow_(sh, hRow, keyCol) {
  const data = sh.getDataRange().getValues();
  for (let r = hRow + 1; r < data.length; r++)
    if (!String(data[r][keyCol]).trim()) return r + 1;
  return data.length + 1;
}

// ── REFERENCE NUMBERS ─────────────────────────────────────────────────────────
// kind: a key of REF_CODES (Config.gs). New references are CODE-000001; older ones (L007, AST-0003)
// are still recognised and counted, so numbering carries on from them.

function formatRef_(kind, n) { return REF_CODES[kind].code + '-' + String(n).padStart(REF_DIGITS, '0'); }

// The serial number of a reference of this kind, in the current or the older format; 0 if it isn't one
function refSerial_(kind, ref) {
  const k = REF_CODES[kind], s = String(ref == null ? '' : ref).trim().toUpperCase();
  const cur = s.match(new RegExp('^' + k.code + '-([0-9]+)$'));
  if (cur) return parseInt(cur[1], 10);
  if (!k.legacy || s.indexOf(k.legacy) !== 0) return 0;
  const old = s.slice(k.legacy.length).match(/^([0-9]+)$/);
  return old ? parseInt(old[1], 10) : 0;
}

// The next reference after the highest one among `refs`
function nextRef_(kind, refs) {
  return formatRef_(kind, refs.reduce((max, r) => Math.max(max, refSerial_(kind, r)), 0) + 1);
}

// Next reference for the ID column of a sheet, e.g. nextId_(SH_LOANS, 'loanid', 'loan') -> 'LN-000008'.
// rd: the sheet as already read by readSheet_ (saves reading it again).
function nextId_(sheetName, headerHint, kind, rd) {
  const { headers, rows } = rd || readSheet_(sheetName, headerHint);
  const h = headers[ci(headers, headerHint)];
  return nextRef_(kind, rows.map(r => r[h]));
}

// ── WRITING NEW ROWS ──────────────────────────────────────────────────────────

// Free rows of a sheet already read by readSheet_: the first row (below the header) whose key column is
// blank, then the next, ... -- the same rows emptyRow_() finds, without reading the sheet again.
// Returns a function; each call gives the next free row (1-based).
function freeRowFinder_(rd, keyCol) {
  const key = rd.headers[keyCol];
  const taken = {};
  rd.rows.forEach(r => { if (String(r[key] == null ? '' : r[key]).trim()) taken[r._row] = true; });
  let cur = rd.hRow + 2;
  return () => { while (taken[cur]) cur++; taken[cur] = true; return cur++; };
}

// Makes sure the sheet's grid reaches row `row`. A range below the last grid row cannot be written,
// so a tab that is full (a new tab has 1,000 rows) is extended first.
function ensureRows_(sh, row) {
  if (typeof sh.getMaxRows !== 'function') return;
  const max = sh.getMaxRows();
  if (row > max) sh.insertRowsAfter(max, row - max);
}

// Writes several cells of one row in a single call. cells: [[0-based column, value], ...]; columns
// below 0 (a header the sheet lacks) are skipped. Other cells of the row keep their values.
function writeCells_(sh, row, width, cells) {
  ensureRows_(sh, row);
  const range = sh.getRange(row, 1, 1, width);
  const vals = range.getValues()[0];
  cells.forEach(([c, v]) => { if (c > -1 && c < width) vals[c] = v; });
  range.setValues([vals]);
}

// ── THE SCRIPT LOCK ───────────────────────────────────────────────────────────
// One writer at a time across all users. Emails asked for while the lock is held are sent after it is
// released (sendHtmlEmail_ queues them), so other writers do not wait for the mail server. Re-entrant:
// a function that already holds the lock can call another that takes it.
var LOCK_DEPTH_ = 0;
var AFTER_LOCK_ = [];

function withScriptLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  LOCK_DEPTH_++;
  try { return fn(); }
  finally {
    LOCK_DEPTH_--; lock.releaseLock();
    runAfterLock_();   // also when fn threw: emails for what was already done still go out, as before
  }
}

function runAfterLock_() {
  const queued = AFTER_LOCK_.splice(0, AFTER_LOCK_.length);
  queued.forEach(f => { try { f(); } catch (e) { Logger.log('After-lock task failed: ' + e); } });
}
