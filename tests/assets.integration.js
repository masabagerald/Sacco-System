// ISS-12: the Asset Register. Admins register assets; a different admin verifies or rejects each new
// asset and each material change; disposals keep the record; filters drive the list and the PDF/Excel
// exports alike; members have no access. Real controllers against an in-memory spreadsheet.
const assert = require('assert');
const { EMAIL, seed, ok, fails } = require('./fixtures');

const { ALICE, BOB, CAROL, DAN } = EMAIL;
// Values built inside the script context are compared as JSON (their arrays come from another realm)
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

function setup(c) {
  const ctx = seed(c), { g, fakes, val } = ctx;
  g._sendEmail = (to, subject, rows, message) => { if (to) fakes.emails.push({ to, subject, rows, message }); };
  ctx.as = e => fakes.signInAs(e);
  ctx.assets = () => { const s = fakes.sheet(val('SH_ASSETS')); return s ? s.records('assetid') : []; };
  ctx.history = () => { const s = fakes.sheet(val('SH_ASSET_HISTORY')); return s ? s.records('assetid') : []; };
  ctx.reviews = () => { const s = fakes.sheet(val('SH_ASSET_REVIEWS')); return s ? s.records('assetid') : []; };
  return ctx;
}

const LAPTOP = { tag: 'MSIC-IT-001', type: 'Computers', description: 'Office laptop for the treasurer', make: 'Dell', model: 'Latitude 5420',
  serial: 'DL5420-77X1', value: '2,450,000', dateAcquired: '2025-03-14', condition: 'Functional', availability: 'In Use', location: 'Treasurer\'s office',
  documents: 'https://drive.google.com/file/d/invoice123/view', notes: 'Invoice INV-2231' };
const asset = o => Object.assign({}, LAPTOP, o);

module.exports = {
  'registering an asset: required fields, types, statuses and values are checked'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.as(ALICE);
    const cases = [
      [{ type: 'Phones' }, 'type'], [{ type: 'Other', otherType: '' }, 'otherType'], [{ description: '' }, 'description'],
      [{ value: '' }, 'value'], [{ value: '-5' }, 'value'], [{ value: 'abc' }, 'value'], [{ dateAcquired: '' }, 'dateAcquired'],
      [{ dateAcquired: '2999-01-01' }, 'dateAcquired'], [{ condition: 'Broken' }, 'condition'], [{ availability: 'Lost' }, 'availability'],
      [{ location: ' ' }, 'location'], [{ documents: 'http://insecure.example/doc' }, 'documents'],
      [{ disposedTo: 'Someone' }, 'availability'],
      [{ availability: 'Disposed Off' }, 'disposalDate'],
      [{ availability: 'Disposed Off', disposalDate: '2025-01-01' }, 'disposalDate'],          // before acquisition
      [{ availability: 'Disposed Off', disposalDate: '2026-01-10' }, 'disposedTo'],
      [{ availability: 'Disposed Off', disposalDate: '2026-01-10', disposedTo: 'St Jude School' }, 'recipientContact'],
      [{ availability: 'Disposed Off', disposalDate: '2026-01-10', disposedTo: 'St Jude School', recipientContact: '12345' }, 'recipientContact']];
    cases.forEach(([o, field]) => {
      const r = g.registerAsset(asset(o));
      assert.ok(!r.ok && r.field === field, JSON.stringify(o) + ' should fail on ' + field + ': ' + JSON.stringify(r));
    });
    assert.strictEqual(ctx.assets().length, 0, 'nothing saved');

    const res = ok(g.registerAsset(LAPTOP), 'valid asset');
    eq([res.assetId, res.verification], ['AST-000001', 'Pending Verification'], 'new assets start pending');
    const row = ctx.assets()[0];
    eq([row['Value (UGX)'], row['Created By'], row['Submitted By'], row.Version, row['Verified By']], [2450000, 'M001', 'M001', 1, ''], 'UGX value, creator recorded');
    ok(g.registerAsset(asset({ tag: '', serial: '', type: 'Other', otherType: 'Projector', description: 'Hall projector' })), 'Other with its type');
    ok(g.registerAsset(asset({ tag: 'MSIC-F-001', serial: '', type: 'Furniture', description: 'Donated chairs', value: '0', condition: 'Functional', availability: 'Available' })), 'a donated asset can be valued at 0');
    ['Printers', 'Vehicles', 'Equipment'].forEach((t, i) => ok(g.registerAsset(asset({ tag: 'T-' + i, serial: 'S-' + i, type: t })), t));
    ok(g.registerAsset(asset({ tag: 'MSIC-IT-009', serial: 'SN-9', availability: 'Disposed Off', disposalDate: '2026-01-10',
      disposedTo: 'St Jude School', recipientContact: '0772 123 456' })), 'registered as already disposed');
    assert.strictEqual(ctx.assets().find(a => a['Asset Tag'] === 'MSIC-IT-009')['Recipient Contact'], '+256772123456', 'contact normalised');
    assert.ok(ctx.audit().some(a => a.Action === 'Asset Registered' && a['Reference ID'] === 'AST-000001'));
    assert.ok(ctx.audit().some(a => a.Action === 'Asset Submitted for Verification' && a['Reference ID'] === 'AST-000001'));
  },

  'asset tags and serial numbers are unique, whatever the case'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.as(ALICE);
    ok(g.registerAsset(LAPTOP), 'first');
    const t = g.registerAsset(asset({ tag: ' msic-it-001 ', serial: 'OTHER' }));
    assert.ok(!t.ok && t.field === 'tag' && /already used by AST-000001/.test(t.error), JSON.stringify(t));
    const s = g.registerAsset(asset({ tag: 'NEW-1', serial: 'dl5420-77x1' }));
    assert.ok(!s.ok && s.field === 'serial', JSON.stringify(s));
    const b = ok(g.registerAsset(asset({ tag: 'NEW-1', serial: 'NEW-SN' })), 'second').assetId;
    ctx.as(BOB);
    fails(g.updateAsset(b, asset({ tag: 'MSIC-IT-001', serial: 'NEW-SN' }), 'typo'), /already used by AST-000001/, 'an edit cannot take another asset\'s tag');
  },

  'a different admin verifies; the creator and members cannot; rejection needs a reason and keeps history'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    ctx.as(ALICE);
    const id = ok(g.registerAsset(LAPTOP), 'register').assetId;
    fails(g.verifyAsset(id, ''), /You registered this asset/, 'creator cannot verify');
    fails(g.rejectAsset(id, 'x'), /You registered this asset/, 'creator cannot reject');
    ctx.as(DAN);
    fails(g.verifyAsset(id, ''), /Admin access required/, 'a member cannot verify');
    fails(g.getAssets({}), /Admin access required/, 'a member cannot list assets');
    fails(g.getAsset(id), /Admin access required/, 'nor open one (or its document links)');
    fails(g.registerAsset(asset({ tag: 'X', serial: 'Y' })), /Admin access required/, 'nor register one');
    fails(g.exportAssetRegisterXlsx({}), /Admin access required/, 'nor export');

    ctx.as(BOB);
    fails(g.rejectAsset(id, '  '), /reason/, 'rejection needs a reason');
    fails(g.verifyAsset(id, '', 7), /changed after you opened it/, 'a stale version cannot be verified');
    ok(g.rejectAsset(id, 'Serial number does not match the invoice'), 'reject');
    let row = ctx.assets()[0];
    eq([row['Verification Status'], row['Verified By']], ['Rejected', ''], 'rejected, never marked verified');
    assert.ok(fakes.emails.some(e => e.to === ALICE && /Asset record rejected/.test(e.subject) && e.rows.some(r => r[1] === 'Serial number does not match the invoice')), 'creator told why');
    fails(g.verifyAsset(id, ''), /is Rejected/, 'a rejected record cannot be verified without a correction');

    // Corrected by the creator: pending again as version 2; Carol verifies
    ctx.as(ALICE);
    const up = ok(g.updateAsset(id, asset({ serial: 'DL5420-77X2' }), 'Serial corrected from the invoice'), 'correct');
    eq([up.material, up.verification, up.version], [true, 'Pending Verification', 2]);
    ctx.as(CAROL);
    ok(g.verifyAsset(id, 'Checked against the invoice', 2), 'verify');
    row = ctx.assets()[0];
    eq([row['Verification Status'], row['Verified By'], row.Version], ['Verified', 'M003', 2]);
    eq(ctx.reviews().map(r => [r.Version, r.Reviewer, r.Decision, r.Comment]),
      [[1, 'M002', 'Rejected', 'Serial number does not match the invoice'], [2, 'M003', 'Verified', 'Checked against the invoice']], 'both decisions kept');
    fails(g.verifyAsset(id, ''), /is Verified/, 'no second verification');
    const detail = ok(g.getAsset(id), 'details');
    eq(detail.reviews.map(r => r.decision), ['Rejected', 'Verified']);
    assert.ok(detail.history.some(h => h.field === 'Serial Number' && h.before === 'DL5420-77X1' && h.after === 'DL5420-77X2'), 'previous value kept');
    ['Asset Rejected', 'Asset Updated', 'Asset Verified'].forEach(a => assert.ok(ctx.audit().some(x => x.Action === a && x['Reference ID'] === id), 'audit: ' + a));
  },

  'material changes need reverification; minor corrections do not; verification cannot be set directly'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.as(ALICE);
    const id = ok(g.registerAsset(LAPTOP), 'register').assetId;
    ctx.as(BOB); ok(g.verifyAsset(id, ''), 'verify');
    ctx.as(CAROL);
    fails(g.updateAsset(id, asset({ notes: 'x' }), ''), /reason/, 'a reason is required');
    fails(g.updateAsset(id, LAPTOP, 'nothing'), /Nothing to change/);
    const minor = ok(g.updateAsset(id, asset({ notes: 'Warranty to March 2027', description: 'Office laptop (treasurer)' }), 'Notes'), 'minor');
    eq([minor.material, minor.verification, minor.version], [false, 'Verified', 1], 'still verified');
    // Fields a client might try to slip in are ignored: verification is only set by verifyAsset
    const sneaky = ok(g.updateAsset(id, asset({ location: 'Store room', notes: 'Warranty to March 2027', description: 'Office laptop (treasurer)',
      'Verification Status': 'Verified', verification: 'Verified', verifiedBy: 'M003' }), 'Moved'), 'location change');
    eq([sneaky.material, sneaky.verification, sneaky.version], [true, 'Pending Verification', 2], 'location is material');
    eq(ctx.assets()[0]['Verification Status'], 'Pending Verification');
    fails(g.verifyAsset(id, ''), /You made the change awaiting review/, 'the editor cannot verify their own change');
    ctx.as(ALICE);
    fails(g.verifyAsset(id, ''), /You registered this asset/, 'nor can the creator');
    ctx.as(BOB);
    ok(g.verifyAsset(id, 'Seen in the store room'), 'reverified by another admin');
    ['value', 'condition', 'availability', 'dateAcquired', 'serial', 'tag', 'make'].forEach((k, i) => {
      const cur = ctx.assets()[0];
      const changed = { value: '2000000', condition: 'Non-functional', availability: 'Unavailable', dateAcquired: '2025-03-15', serial: 'NEW-' + i, tag: 'TAG-' + i, make: 'HP' }[k];
      const base = { tag: cur['Asset Tag'], serial: cur['Serial Number'], make: cur.Make, value: String(cur['Value (UGX)']), condition: cur.Condition,
        availability: cur.Availability, dateAcquired: cur['Date Acquired'], location: cur.Location, notes: cur.Notes, description: cur.Description };
      ctx.as(CAROL);
      const r = ok(g.updateAsset(id, asset(Object.assign(base, { [k]: changed })), 'Change ' + k), k);
      assert.strictEqual(r.material, true, k + ' is material');
      ctx.as(BOB); ok(g.verifyAsset(id, ''), 'reverify after ' + k);
    });
    const v = ctx.history().find(h => h.Field === 'Value (UGX)');
    eq([v['Previous Value'], v['New Value'], v['Changed By'], v.Reason], ['2450000', '2000000', 'M003', 'Change value'], 'value change history');
    fails(g.updateAsset(id, asset({ location: 'Hall' }), 'x', 1), /changed by someone else/, 'a stale form is refused');
  },

  'disposal requires the date, recipient and contact, and keeps the asset'(c) {
    const ctx = setup(c), { g } = ctx;
    ctx.as(ALICE);
    const id = ok(g.registerAsset(LAPTOP), 'register').assetId;
    ctx.as(BOB); ok(g.verifyAsset(id, ''), 'verify');
    ctx.as(CAROL);
    const r1 = g.disposeAsset(id, { date: '', to: 'St Jude School', contact: '0772123456' }, 'Donated');
    assert.ok(!r1.ok && r1.field === 'disposalDate', JSON.stringify(r1));
    const r2 = g.disposeAsset(id, { date: '2026-02-01', to: '', contact: '0772123456' }, 'Donated');
    assert.ok(!r2.ok && r2.field === 'disposedTo', JSON.stringify(r2));
    const r3 = g.disposeAsset(id, { date: '2026-02-01', to: 'St Jude School', contact: '' }, 'Donated');
    assert.ok(!r3.ok && r3.field === 'recipientContact', JSON.stringify(r3));
    const d = ok(g.disposeAsset(id, { date: '2026-02-01', to: 'St Jude School', contact: 'Head@StJude.ac.ug' }, 'Donated to the school'), 'dispose');
    eq([d.material, d.verification], [true, 'Pending Verification'], 'disposal needs verification');
    const row = ctx.assets()[0];
    eq([row.Availability, row['Disposal Date'], row['Disposed To'], row['Recipient Contact'], row.Condition, row['Value (UGX)']],
      ['Disposed Off', '2026-02-01', 'St Jude School', 'head@stjude.ac.ug', 'Functional', 2450000], 'record kept with its details');
    fails(g.disposeAsset(id, { date: '2026-02-02', to: 'X', contact: '0772123456' }, 'again'), /already recorded as disposed/);
    assert.ok(ctx.audit().some(a => a.Action === 'Asset Disposed' && /St Jude School/.test(a.Details)));
    ctx.as(BOB); ok(g.verifyAsset(id, 'Handover note seen'), 'verify the disposal');
    assert.strictEqual(ctx.assets().length, 1, 'never deleted');
    assert.strictEqual(typeof g.deleteAsset, 'undefined', 'there is no delete');
    const list = ok(g.getAssets({ disposal: 'disposed' }), 'disposed list');
    eq(list.assets.map(a => [a.id, a.disposed, a.verification]), [[id, true, 'Verified']]);
  },

  'filters, pagination and exports agree, and unverified assets are never shown as verified'(c) {
    const ctx = setup(c), { g, fakes } = ctx;
    ctx.as(ALICE);
    const mk = (i, o) => ok(g.registerAsset(asset(Object.assign({ tag: 'TAG-' + String(i).padStart(3, '0'), serial: 'SN-' + String(i).padStart(3, '0') }, o))), 'asset ' + i).assetId;
    const a1 = mk(1, { type: 'Computers', location: 'Main office', dateAcquired: '2024-05-01', value: '1000000' });
    const a2 = mk(2, { type: 'Printers', location: 'Main office', dateAcquired: '2025-06-01', value: '500000', condition: 'Non-functional', availability: 'Unavailable' });
    const a3 = mk(3, { type: 'Furniture', location: 'Hall', dateAcquired: '2025-08-01', value: '300000', availability: 'Available', description: 'Conference table' });
    for (let i = 4; i <= 30; i++) mk(i, { type: 'Furniture', location: 'Store', dateAcquired: '2023-01-01', value: '1000', availability: 'Available', description: 'Chair ' + i });
    ctx.as(BOB);
    ok(g.verifyAsset(a1, ''), 'verify a1'); ok(g.rejectAsset(a2, 'Wrong model'), 'reject a2');

    const ids = f => ok(g.getAssets(f), JSON.stringify(f)).assets.map(a => a.id);
    eq(ids({ q: 'tag-002' }), [a2], 'tag search'); eq(ids({ q: 'sn-003' }), [a3], 'serial search'); eq(ids({ q: a1 }), [a1], 'ID search');
    eq(ids({ type: 'Printers' }), [a2]); eq(ids({ condition: 'Non-functional' }), [a2]); eq(ids({ location: 'main' }), [a1, a2]);
    eq(ids({ from: '2025-01-01', to: '2025-07-01' }), [a2], 'acquisition range');
    eq(ids({ verification: 'Verified' }), [a1]); eq(ids({ verification: 'Rejected' }), [a2]);
    eq(ids({ disposal: 'disposed' }), []);
    fails(g.getAssets({ from: '2025-02-01', to: '2025-01-01' }), /after the "to" date/);
    const p1 = ok(g.getAssets({}, 1), 'page 1'), p2 = ok(g.getAssets({}, 2), 'page 2');
    eq([p1.total, p1.pages, p1.assets.length, p2.assets.length], [30, 2, 25, 5], 'pagination');
    eq([p1.summary.verified, p1.summary.pending, p1.summary.rejected, p1.summary.verifiedValue], [1, 28, 1, 1000000], 'only verified value counts as verified');
    assert.ok(p1.assets.find(a => a.id === a3).canReview, 'Bob can review a pending asset he did not enter');

    // Excel: the same rows as the filtered list, and readable as a real .xlsx
    const filters = { location: 'main' };
    const x = ok(g.exportAssetRegisterXlsx(filters), 'xlsx');
    assert.strictEqual(x.count, 2);
    const zip = Buffer.from(x.base64, 'base64');
    assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'a zip archive');
    const xml = zip.toString('utf8');
    ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', '[Content_Types].xml', 'xl/styles.xml'].forEach(f => assert.ok(xml.indexOf(f) > -1, f));
    ['Asset ID', 'Asset tag', 'Type', 'Description', 'Value (UGX)', 'Date acquired', 'Condition', 'Status', 'Location', 'Disposal date',
      'Disposed to', 'Recipient contact', 'Verification'].forEach(h => assert.ok(xml.indexOf('>' + h + '<') > -1, 'header ' + h));
    assert.ok(xml.indexOf(a1) > -1 && xml.indexOf(a2) > -1 && xml.indexOf(a3) < 0, 'only the filtered assets');
    assert.ok(xml.indexOf('Rejected (not verified)') > -1 && xml.indexOf('<v>1000000</v>') > -1, 'status distinguished; values are numbers');
    assert.ok(xml.indexOf('Filters: Location: main') > -1, 'filters stated');
    fs_write(x.base64);

    // PDF: built through the shared branded layout; capture what goes into it
    const cap = { tables: [], cards: null, kv: [] };
    g._brandedPdf = (title, sub, fn) => { cap.title = title; fn({}); return { getBytes: () => [37, 80, 68, 70] }; };
    g._cards = (b, cards) => { cap.cards = cards; }; g._kv = (b, rows) => { cap.kv.push(rows); };
    g._section = () => {}; g._table = (b, head, rows) => { cap.tables.push({ head, rows }); };
    const p = ok(g.exportAssetRegisterPdf({ verification: 'Pending Verification', type: 'Furniture' }), 'pdf');
    assert.strictEqual(p.count, 28);
    const t = cap.tables[0];
    eq(t.head, ['Asset ID', 'Tag', 'Type', 'Description', 'Value (UGX)', 'Acquired', 'Condition', 'Status', 'Location', 'Verification']);
    assert.ok(t.rows.length === 28 && t.rows.every(r => r[9] === 'PENDING VERIFICATION'), 'pending rows clearly marked');
    assert.ok(JSON.stringify(cap.kv).indexOf('Type: Furniture') > -1, 'filters stated');
    eq(cap.cards[4], ['Verified value', 'UGX 0'], 'no unverified value shown as verified');
    assert.strictEqual(ctx.audit().filter(a => a.Action === 'Asset Register Export').length, 2, 'exports are audited');
    ctx.as(DAN);
    fails(g.exportAssetRegisterPdf({}), /Admin access required/, 'members cannot export');
  }
};

// Keeps the last Excel export in the OS temp folder, so it can be opened by hand (npm test leaves it there)
function fs_write(b64) {
  try { require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'msic-asset-register-test.xlsx'), Buffer.from(b64, 'base64')); } catch (e) {}
}
