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

// Auto-increment ID: e.g. nextId('Loans','loanid','L') → 'L004'
function nextId(sheetName, headerHint, prefix) {
  const { sh, headers, hRow } = readSheet(sheetName, headerHint);
  const c = ci(headers, headerHint);
  const data = sh.getDataRange().getValues();
  let max = 0;
  for (let r = hRow + 1; r < data.length; r++) {
    const m = String(data[r][c] || '').match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + String(max + 1).padStart(3, '0');
}

// Runs fn while holding the script lock (one writer at a time across all users).
function _withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
