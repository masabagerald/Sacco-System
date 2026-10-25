// ── ASSET REGISTER (ISS-12) ───────────────────────────────────────────────────
// The club's own assets (computers, furniture, vehicles, ...). Admins only.
//
// Assets: one row per asset, holding its current details. Assets are never deleted: a disposed asset
//   stays on the register with its disposal date and recipient.
// Asset History: append-only. Every registration and change, one row per field, with the previous
//   and new value and the reason given.
// Asset Reviews: append-only. Every verification or rejection, with the reviewer and comment.
//
// Verification: a new asset is "Pending Verification" until a different admin verifies it (or rejects
// it, with a reason). A material change to a verified asset (identity, value, condition, availability,
// location or disposal details) sends it back to Pending Verification. Minor corrections (description,
// notes, document links) do not. The person who created the asset and the person whose change is
// awaiting review may not verify it. Verification fields are only ever set by verifyAsset/rejectAsset.

const ASSET_HEADERS = ['AssetID', 'Timestamp', 'Asset Tag', 'Asset Type', 'Type (Other)', 'Description', 'Make', 'Model', 'Serial Number',
  'Value (UGX)', 'Date Acquired', 'Condition', 'Availability', 'Location', 'Disposal Date', 'Disposed To', 'Recipient Contact',
  'Documents', 'Notes', 'Verification Status', 'Version', 'Submitted By', 'Submitted At', 'Verified By', 'Verified At',
  'Created By', 'Updated At', 'Updated By'];
const ASSET_REVIEW_HEADERS = ['Timestamp', 'AssetID', 'Version', 'Reviewer', 'Reviewer Name', 'Decision', 'Comment', 'Submitted By'];
const ASSET_HISTORY_HEADERS = ['Timestamp', 'AssetID', 'Version', 'Action', 'Changed By', 'Field', 'Previous Value', 'New Value', 'Reason'];

// Editable fields: [data key, column, material?]. Material changes need reverification.
const ASSET_FIELDS = [
  ['tag', 'Asset Tag', true], ['type', 'Asset Type', true], ['otherType', 'Type (Other)', true], ['description', 'Description', false],
  ['make', 'Make', true], ['model', 'Model', true], ['serial', 'Serial Number', true], ['value', 'Value (UGX)', true],
  ['dateAcquired', 'Date Acquired', true], ['condition', 'Condition', true], ['availability', 'Availability', true],
  ['location', 'Location', true], ['disposalDate', 'Disposal Date', true], ['disposedTo', 'Disposed To', true],
  ['recipientContact', 'Recipient Contact', true], ['documents', 'Documents', false], ['notes', 'Notes', false]];

// One-time setup (also run by setupGuaranteeSchema). The tabs are created on first use as well. Safe to run again.
function setupAssetRegisterSchema() {
  _ensureTab(SH_ASSETS, 'assetid', ASSET_HEADERS);
  _ensureTab(SH_ASSET_REVIEWS, 'assetid', ASSET_REVIEW_HEADERS);
  _ensureTab(SH_ASSET_HISTORY, 'assetid', ASSET_HISTORY_HEADERS);
}

function _assetRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_ASSETS)) return [];
  return readSheet(SH_ASSETS, 'assetid').rows.filter(r => String(r['AssetID'] || '').trim());
}

function _assetRowById(id) {
  id = String(id || '').trim();
  return _assetRows().find(r => String(r['AssetID']).trim() === id) || null;
}

// ── Validation ────────────────────────────────────────────────────────────────

// Checks an asset form. Returns { ok, asset } with cleaned values, or { ok:false, field, error }.
function _validateAsset(d) {
  d = d || {};
  const t = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const bad = (field, error) => ({ ok: false, field, error });
  const a = {
    tag: t(d.tag, 50), type: t(d.type), otherType: t(d.otherType, 100), description: t(d.description, 500),
    make: t(d.make, 100), model: t(d.model, 100), serial: t(d.serial, 100), location: t(d.location, 200),
    condition: t(d.condition), availability: t(d.availability), disposedTo: t(d.disposedTo, 200), notes: t(d.notes, 1000)
  };
  if (ASSET_TYPES.indexOf(a.type) < 0) return bad('type', 'Choose the asset type: ' + ASSET_TYPES.join(', ') + '.');
  if (a.type === 'Other' && !a.otherType) return bad('otherType', 'Specify the type of asset.');
  if (a.type !== 'Other') a.otherType = '';
  if (a.description.length < 3) return bad('description', 'Describe the asset.');
  const rawValue = String(d.value == null ? '' : d.value).replace(/,/g, '').trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(rawValue)) return bad('value', 'Enter the asset value in UGX (a number, 0 or more).');
  a.value = r2(parseFloat(rawValue));
  if (!String(d.dateAcquired || '').trim()) return bad('dateAcquired', 'Enter the date the asset was acquired.');
  const dv = validateTxDate(d.dateAcquired); if (!dv.ok) return bad('dateAcquired', 'Enter a valid date acquired (it cannot be in the future).');
  a.dateAcquired = dv.date;
  if (ASSET_CONDITIONS.indexOf(a.condition) < 0) return bad('condition', 'Choose the condition: ' + ASSET_CONDITIONS.join(' or ') + '.');
  if (ASSET_AVAILABILITY.indexOf(a.availability) < 0) return bad('availability', 'Choose the status: ' + ASSET_AVAILABILITY.join(', ') + '.');
  if (!a.location) return bad('location', 'Enter where the asset is kept.');

  const contact = String(d.recipientContact == null ? '' : d.recipientContact).trim();
  if (a.availability === ASSET_DISPOSED) {
    if (!String(d.disposalDate || '').trim()) return bad('disposalDate', 'Enter the disposal date.');
    const xv = validateTxDate(d.disposalDate); if (!xv.ok) return bad('disposalDate', 'Enter a valid disposal date (it cannot be in the future).');
    if (xv.date < a.dateAcquired) return bad('disposalDate', 'The disposal date cannot be before the date acquired.');
    a.disposalDate = xv.date;
    if (!a.disposedTo) return bad('disposedTo', 'Enter the person or organisation the asset was disposed to.');
    if (!contact) return bad('recipientContact', 'Enter the recipient\'s phone number or email.');
    const asEmail = contact.indexOf('@') > -1 ? validateEmail(contact) : null;
    const asPhone = asEmail ? null : normalizePhone(contact);
    if (asEmail ? !asEmail.ok : !asPhone.ok)
      return bad('recipientContact', 'Enter a valid phone number (e.g. 0712 345 678 or +254 712 345 678) or email address for the recipient.');
    a.recipientContact = asEmail ? asEmail.email : asPhone.phone;
  } else {
    if (String(d.disposalDate || '').trim() || a.disposedTo || contact)
      return bad('availability', 'Disposal details can only be entered when the status is ' + ASSET_DISPOSED + '.');
    a.disposalDate = ''; a.recipientContact = '';
  }
  const docs = String(d.documents == null ? '' : (Array.isArray(d.documents) ? d.documents.join('\n') : d.documents))
    .split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
  if (docs.length > 10) return bad('documents', 'Add at most 10 document links.');
  if (docs.some(x => !/^https:\/\/\S+$/i.test(x))) return bad('documents', 'Each document must be a link starting with https://, one per line.');
  a.documents = docs.join('\n');
  return { ok: true, asset: a };
}

// Asset tags and serial numbers identify one asset each (ignoring case and spaces at the ends).
// Disposed assets keep theirs, so a tag is never reused. Returns { field, error } or null.
function _assetDuplicateError(rows, a, excludeId) {
  const norm = v => String(v || '').trim().toLowerCase();
  const others = rows.filter(r => String(r['AssetID']).trim() !== String(excludeId || '').trim());
  const tagDup = a.tag && others.find(r => norm(r['Asset Tag']) === norm(a.tag));
  if (tagDup) return { field: 'tag', error: 'Asset tag ' + a.tag + ' is already used by ' + tagDup['AssetID'] + '.' };
  const serDup = a.serial && others.find(r => norm(r['Serial Number']) === norm(a.serial));
  if (serDup) return { field: 'serial', error: 'Serial number ' + a.serial + ' is already registered as ' + serDup['AssetID'] + '.' };
  return null;
}

// Cell value of a field, in the same form _validateAsset produces (for comparing and history)
function _assetFieldValue(row, col) {
  const v = row[col];
  if (col === 'Value (UGX)') return String(v === '' || v == null ? '' : r2(num(v)));
  if (col === 'Date Acquired' || col === 'Disposal Date') return _dstr(v);
  return String(v == null ? '' : v).trim();
}

// [{ key, col, material, before, after }] for every field that differs
function _assetChanges(row, a) {
  return ASSET_FIELDS.map(([key, col, material]) => ({ key, col, material,
    before: _assetFieldValue(row, col), after: col === 'Value (UGX)' ? String(a.value) : String(a[key] == null ? '' : a[key]) }))
    .filter(c => c.before !== c.after);
}

function _nextAssetId(rows) { return _nextRef('asset', rows.map(r => r['AssetID'])); }

// ── Views, filters, history ───────────────────────────────────────────────────

function _assetView(r) {
  const type = String(r['Asset Type'] || '');
  return { id: String(r['AssetID']).trim(), tag: String(r['Asset Tag'] || ''), type, otherType: String(r['Type (Other)'] || ''),
    typeLabel: type === 'Other' && r['Type (Other)'] ? 'Other: ' + r['Type (Other)'] : type,
    description: String(r['Description'] || ''), make: String(r['Make'] || ''), model: String(r['Model'] || ''), serial: String(r['Serial Number'] || ''),
    value: num(r['Value (UGX)']), dateAcquired: _dstr(r['Date Acquired']), condition: String(r['Condition'] || ''),
    availability: String(r['Availability'] || ''), location: String(r['Location'] || ''), disposalDate: _dstr(r['Disposal Date']),
    disposedTo: String(r['Disposed To'] || ''), recipientContact: String(r['Recipient Contact'] || ''),
    documents: String(r['Documents'] || '').split('\n').filter(Boolean), notes: String(r['Notes'] || ''),
    verification: String(r['Verification Status'] || ASSET_VERIFICATION.PENDING), version: num(r['Version']) || 1,
    submittedBy: String(r['Submitted By'] || ''), submittedAt: String(r['Submitted At'] || ''),
    verifiedBy: String(r['Verified By'] || ''), verifiedAt: String(r['Verified At'] || ''),
    createdBy: String(r['Created By'] || ''), createdAt: String(r['Timestamp'] || ''),
    updatedBy: String(r['Updated By'] || ''), updatedAt: String(r['Updated At'] || ''),
    disposed: String(r['Availability'] || '') === ASSET_DISPOSED };
}

// Filters: { q (ID, tag, serial, make, model or description), type, condition, availability, location,
// from, to (date acquired), verification, disposal ('disposed' | 'held') }. Shared by the list and the
// exports, so an export always matches the list on screen.
function _cleanAssetFilters(f) {
  f = f || {};
  const t = v => String(v == null ? '' : v).trim();
  const out = { q: t(f.q), type: t(f.type), condition: t(f.condition), availability: t(f.availability), location: t(f.location),
    from: t(f.from), to: t(f.to), verification: t(f.verification), disposal: t(f.disposal) };
  if ((out.from && !/^\d{4}-\d{2}-\d{2}$/.test(out.from)) || (out.to && !/^\d{4}-\d{2}-\d{2}$/.test(out.to)))
    return { ok: false, error: 'Enter the acquisition dates as yyyy-mm-dd.' };
  if (out.from && out.to && out.from > out.to) return { ok: false, error: 'The "from" date is after the "to" date.' };
  return { ok: true, filters: out };
}

function _filterAssets(views, f) {
  const q = f.q.toLowerCase(), loc = f.location.toLowerCase();
  return views.filter(a =>
    (!q || [a.id, a.tag, a.serial, a.make, a.model, a.description].some(v => String(v).toLowerCase().indexOf(q) > -1)) &&
    (!f.type || a.type === f.type) && (!f.condition || a.condition === f.condition) &&
    (!f.availability || a.availability === f.availability) && (!loc || a.location.toLowerCase().indexOf(loc) > -1) &&
    (!f.from || a.dateAcquired >= f.from) && (!f.to || a.dateAcquired <= f.to) &&
    (!f.verification || a.verification === f.verification) &&
    (!f.disposal || (f.disposal === 'disposed' ? a.disposed : !a.disposed)))
    .sort((x, y) => _refSerial('asset', x.id) - _refSerial('asset', y.id) || x.id.localeCompare(y.id));  // by number: AST-0009 before AST-000010
}

// Totals for a list. Only verified assets count towards the register's verified value.
function _assetSummary(list) {
  const by = s => list.filter(a => a.verification === s);
  const held = list.filter(a => !a.disposed);
  return { count: list.length, verified: by(ASSET_VERIFICATION.VERIFIED).length, pending: by(ASSET_VERIFICATION.PENDING).length,
    rejected: by(ASSET_VERIFICATION.REJECTED).length, disposed: list.length - held.length,
    verifiedValue: r2(held.filter(a => a.verification === ASSET_VERIFICATION.VERIFIED).reduce((s, a) => s + a.value, 0)),
    unverifiedValue: r2(held.filter(a => a.verification !== ASSET_VERIFICATION.VERIFIED).reduce((s, a) => s + a.value, 0)) };
}

function _assetLog(sheet, hint, id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(sheet)) return [];
  return readSheet(sheet, hint).rows.filter(r => String(r['AssetID'] || '').trim() === String(id).trim());
}

// Why `me` may not verify or reject this asset ('' when they may)
function _assetReviewBlock(r, me, version) {
  const st = String(r['Verification Status'] || '');
  if (st !== ASSET_VERIFICATION.PENDING) return 'This asset is ' + (st || 'not pending') + '; only a record pending verification can be reviewed.';
  if (version !== undefined && version !== null && String(version) !== '' && num(version) !== (num(r['Version']) || 1))
    return 'This asset was changed after you opened it. Reload it and review the latest details.';
  if (me === String(r['Created By'] || '').trim()) return 'You registered this asset; a different administrator must verify it.';
  if (me === String(r['Submitted By'] || '').trim()) return 'You made the change awaiting review; a different administrator must verify it.';
  return '';
}

// ── Excel (.xlsx) ─────────────────────────────────────────────────────────────
// A minimal Office Open XML workbook built by hand and zipped with Utilities.zip: no extra OAuth scope,
// no temporary file in Drive. titleRows go above the bold, filterable header row; numeric cells stay numbers.
function _xlsxBlob(fileName, sheetName, titleRows, header, rows, moneyCols) {
  const x = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const cell = (v, r, c, style) => {
    const ref = col(c) + r, s = style ? ' s="' + style + '"' : '';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
  };
  const lines = [];
  let r = 0;
  (titleRows || []).forEach(t => { r++; lines.push('<row r="' + r + '">' + cell(t, r, 0, 1) + '</row>'); });
  if (titleRows && titleRows.length) r++;  // blank row
  const headerRow = ++r;
  lines.push('<row r="' + r + '">' + header.map((h, i) => cell(h, r, i, 1)).join('') + '</row>');
  rows.forEach(row => { r++; lines.push('<row r="' + r + '">' + row.map((v, i) => cell(v, r, i, (moneyCols || []).indexOf(i) > -1 ? 2 : 0)).join('') + '</row>'); });
  const last = col(header.length - 1);
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<cols>' + header.map((h, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(45, Math.max(12, String(h).length + 4)) + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + lines.join('') + '</sheetData>'
    + '<autoFilter ref="A' + headerRow + ':' + last + Math.max(headerRow, r) + '"/></worksheet>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + x(String(sheetName).slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets>'
      + '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + x(String(sheetName).slice(0, 31)) + '\'!$A$' + headerRow + ':$' + last + '$' + Math.max(headerRow, r) + '</definedName></definedNames></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet
  };
  const blobs = Object.keys(files).map(name => Utilities.newBlob(files[name], 'application/xml', name));
  return Utilities.zip(blobs, fileName);
}
