// Minimal in-memory stand-ins for the Apps Script services the server code uses.
// Only the calls the code actually makes are implemented.
const crypto = require('crypto');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setValues(vals) { vals.forEach((r, i) => r.forEach((v, j) => this.sheet._set(this.row + i, this.col + j, v))); return this; }
  setNumberFormat(f) { this.sheet.formats[this.row + ':' + this.col] = f; return this; }
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
  constructor(name, rows) { this.name = name; this.data = (rows || []).map(r => r.slice()); this.formats = {}; }
  getName() { return this.name; }
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

// A real ZIP archive (stored, not compressed) like Utilities.zip makes, so tests can open an .xlsx
function zipStore(entries) {
  const zlib = require('zlib');
  const local = [], central = [];
  let offset = 0;
  entries.forEach(([name, data]) => {
    const n = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(local.concat([cd, end]));
}

function createGasFakes() {
  const sheets = {};
  const logs = [];
  const emails = [];
  const props = {};
  let currentUser = '';
  let hostUser = '';            // the account the web app runs as (Session.getEffectiveUser)
  const triggers = [];

  const spreadsheet = {
    getSheetByName: name => sheets[name] || null,
    getSheets: () => Object.values(sheets),
    getSpreadsheetTimeZone: () => 'Africa/Nairobi',
    insertSheet: name => (sheets[name] = new FakeSheet(name, []))
  };

  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: { formatDate, getUuid: () => crypto.randomUUID(),
      newBlob: (data, type, name) => ({ data: String(data), type, name, getBytes: () => Array.from(Buffer.from(String(data), 'utf8')), getName: () => name }),
      zip: (blobs, name) => { const bytes = zipStore(blobs.map(b => [b.name, Buffer.from(b.data, 'utf8')])); return { name, files: blobs, getBytes: () => Array.from(bytes) }; },
      base64Encode: bytes => Buffer.from(bytes).toString('base64') },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.example/exec' }),
      // Time-driven triggers: each newTrigger(fn)...create() is recorded in `triggers`
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i > -1) triggers.splice(i, 1); },
      WeekDay: { MONDAY: 'MONDAY' },
      newTrigger: fn => { const t = { fn, schedule: [] }; const b = new Proxy({}, { get: (_, k) => k === 'create'
        ? () => { triggers.push(t); return t; } : (...a) => { t.schedule.push(k + '(' + a.join(',') + ')'); return b; } }); return b; } },
    HtmlService: { createHtmlOutput: html => ({ html, setTitle() { return this; }, addMetaTag() { return this; }, getContent() { return html; } }),
      createTemplateFromFile: file => ({ file, evaluate() { return { file, setTitle() { return this; }, addMetaTag() { return this; } }; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => currentUser }), getEffectiveUser: () => ({ getEmail: () => hostUser }),
      getScriptTimeZone: () => 'Africa/Nairobi' },
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
      g._sendHtmlEmail = (to, subject, html) => emails.push({ to, subject, html });
      g._notifyAdmins = subject => emails.push({ to: 'admins', subject });
    },
    addSheet(name, rows) { sheets[name] = new FakeSheet(name, rows); return sheets[name]; },
    sheet: name => sheets[name],
    signInAs(email) { currentUser = email; },
    hostAs(email) { hostUser = email; },
    triggers
  };
}

module.exports = { createGasFakes, FakeSheet };
