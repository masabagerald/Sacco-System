// Minimal in-memory stand-ins for the Apps Script services the server code uses.
// Only the calls the code actually makes are implemented.

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setValues(vals) { vals.forEach((r, i) => r.forEach((v, j) => this.sheet._set(this.row + i, this.col + j, v))); return this; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.numRows; i++) {
      const r = [];
      for (let j = 0; j < this.numCols; j++) r.push(this.sheet._get(this.row + i, this.col + j));
      out.push(r);
    }
    return out;
  }
}

class FakeSheet {
  constructor(name, rows) { this.name = name; this.data = (rows || []).map(r => r.slice()); }
  _width() { return this.data.reduce((w, r) => Math.max(w, r.length), 0); }
  _get(row, col) { const r = this.data[row - 1]; return r && r[col - 1] !== undefined ? r[col - 1] : ''; }
  _set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const r = this.data[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = v;
  }
  getDataRange() {
    const w = this._width();
    return new FakeRange(this, 1, 1, this.data.length, w);
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows || 1, numCols || 1); }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this._width(); }
  appendRow(vals) { this.data.push(vals.slice()); return this; }
  // Test helper: rows below the header row as objects keyed by header
  records(headerHint) {
    const h = this.data.findIndex(r => r.some(v => String(v).trim().toLowerCase() === headerHint.toLowerCase()));
    const headers = this.data[h].map(String);
    return this.data.slice(h + 1).filter(r => r.some(v => String(v).trim() !== ''))
      .map(r => Object.fromEntries(headers.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
  }
}

function formatDate(d, tz, fmt) {
  d = d instanceof Date ? d : new Date(d);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return fmt.replace(/yyyy|MMM|MM|dd|d|HH|mm|ss/g, t => ({
    yyyy: d.getFullYear(), MMM: MON[d.getMonth()], MM: p(d.getMonth() + 1), dd: p(d.getDate()),
    d: d.getDate(), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds())
  })[t]);
}

function createGasFakes() {
  const sheets = {};
  const logs = [];
  const emails = [];
  const props = {};
  let currentUser = '';

  const spreadsheet = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = new FakeSheet(name, []))
  };

  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: { formatDate },
    Session: { getActiveUser: () => ({ getEmail: () => currentUser }), getScriptTimeZone: () => 'Africa/Nairobi' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }),
      getUserProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} })
    },
    Logger: { log: m => logs.push(String(m)) },
    MailApp: { sendEmail: o => emails.push(o) }
  };

  return {
    globals, logs, emails,
    // Replace the email helpers so tests can see who was notified without building HTML.
    install(g) {
      g._sendEmail = (to, subject) => emails.push({ to, subject });
      g._notifyAdmins = subject => emails.push({ to: 'admins', subject });
    },
    addSheet(name, rows) { sheets[name] = new FakeSheet(name, rows); return sheets[name]; },
    sheet: name => sheets[name],
    signInAs(email) { currentUser = email; }
  };
}

module.exports = { createGasFakes, FakeSheet };
