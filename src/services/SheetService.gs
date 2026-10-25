// ── GENERIC SHEET HELPERS ─────────────────────────────────────────────────────

function getSheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found. Check tab name matches exactly.');
  return sh;
}

// Columns that hold a moment rather than a day ("Timestamp", "Responded At", "Approver 1 At").
// Sheets turns the 'yyyy-MM-dd HH:mm:ss' text written by now_ts() into a date-time cell; these
// columns are read back with their time, every other date cell as 'yyyy-MM-dd'.
function _isMomentHeader(h) { return /timestamp|\bat$/i.test(String(h).trim()); }

// Spreadsheet timezone: the zone Sheets used when it turned the written text into a date-time, so
// formatting in it gives back exactly the wall-clock time that was written.
function _sheetTimeZone() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
  catch (e) { return Session.getScriptTimeZone(); }
}

// Read a sheet into an array of row objects keyed by header name.
// headerHint: one column name expected in the header row.
function readSheet(sheetName, headerHint) {
  const sh = getSheet(sheetName);
  const data = sh.getDataRange().getValues();
  let hRow = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].some(v => String(v).trim().toLowerCase() === headerHint.toLowerCase())) { hRow = i; break; }
  }
  if (hRow === -1) return { headers: [], rows: [], sh, hRow: -1 };
  const headers = data[hRow].map(h => String(h).trim());
  const moment = headers.map(_isMomentHeader);
  let tz = null;
  const rows = [];
  for (let r = hRow + 1; r < data.length; r++) {
    const obj = { _row: r + 1 }; let any = false;
    headers.forEach((h, c) => {
      let v = data[r][c];
      if (v instanceof Date) v = moment[c] ? Utilities.formatDate(v, tz || (tz = _sheetTimeZone()), 'yyyy-MM-dd HH:mm:ss') : fmt_date(v);
      obj[h] = v; if (String(v).trim()) any = true;
    });
    if (any) rows.push(obj);
  }
  return { headers, rows, sh, hRow };
}

// First non-empty value among alternative column names (sheets have used different headers over time)
function _pick(row, names) {
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
function emptyRow(sh, hRow, keyCol) {
  const data = sh.getDataRange().getValues();
  for (let r = hRow + 1; r < data.length; r++)
    if (!String(data[r][keyCol]).trim()) return r + 1;
  return data.length + 1;
}

// ── REFERENCE NUMBERS ─────────────────────────────────────────────────────────
// kind: a key of REF_CODES (Config.gs). New references are CODE-000001; older ones (L007, AST-0003)
// are still recognised and counted, so numbering carries on from them.

function _formatRef(kind, n) { return REF_CODES[kind].code + '-' + String(n).padStart(REF_DIGITS, '0'); }

// The serial number of a reference of this kind, in the current or the older format; 0 if it isn't one
function _refSerial(kind, ref) {
  const k = REF_CODES[kind], s = String(ref == null ? '' : ref).trim().toUpperCase();
  const cur = s.match(new RegExp('^' + k.code + '-([0-9]+)$'));
  if (cur) return parseInt(cur[1], 10);
  if (!k.legacy || s.indexOf(k.legacy) !== 0) return 0;
  const old = s.slice(k.legacy.length).match(/^([0-9]+)$/);
  return old ? parseInt(old[1], 10) : 0;
}

// The next reference after the highest one among `refs`
function _nextRef(kind, refs) {
  return _formatRef(kind, refs.reduce((max, r) => Math.max(max, _refSerial(kind, r)), 0) + 1);
}

// Next reference for the ID column of a sheet, e.g. nextId(SH_LOANS, 'loanid', 'loan') -> 'LN-000008'
function nextId(sheetName, headerHint, kind) {
  const { sh, headers, hRow } = readSheet(sheetName, headerHint);
  const c = ci(headers, headerHint);
  return _nextRef(kind, sh.getDataRange().getValues().slice(hRow + 1).map(r => r[c]));
}

// Runs fn while holding the script lock (one writer at a time across all users).
function _withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
