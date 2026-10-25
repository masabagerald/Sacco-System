// ── ASSET REGISTER (ISS-12) ───────────────────────────────────────────────────
// Admins only: every function checks _adminCaller() on the server. See AssetService.gs for the rules.

// The register, filtered and one page at a time. filters: see _cleanAssetFilters; page: 1-based.
function getAssets(filters, page) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const cf = _cleanAssetFilters(filters); if (!cf.ok) return cf;
  const ready = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_ASSETS);
  const list = _filterAssets(_assetRows().map(_assetView), cf.filters);
  const pages = Math.max(1, Math.ceil(list.length / ASSET_PAGE_SIZE));
  page = Math.min(pages, Math.max(1, Math.floor(num(page)) || 1));
  const me = auth.member.memberNo;
  const shown = list.slice((page - 1) * ASSET_PAGE_SIZE, page * ASSET_PAGE_SIZE).map(a => Object.assign(a, {
    canReview: a.verification === ASSET_VERIFICATION.PENDING && me !== a.createdBy && me !== a.submittedBy }));
  return { ok: true, ready, assets: shown, page, pages, pageSize: ASSET_PAGE_SIZE, total: list.length, summary: _assetSummary(list),
    options: { types: ASSET_TYPES, conditions: ASSET_CONDITIONS, availability: ASSET_AVAILABILITY,
      verification: Object.keys(ASSET_VERIFICATION).map(k => ASSET_VERIFICATION[k]) } };
}

// One asset with its change history and review decisions
function getAsset(assetId) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const r = _assetRowById(assetId);
  if (!r) return { ok: false, error: 'Asset not found.' };
  const { rows: members } = readSheet(SH_MEMBERS, 'memberno');
  const nameOf = no => { const m = members.find(x => String(x['MemberNo'] || '').trim() === String(no || '').trim()); return m ? (m['Full Name'] || no) : (no || ''); };
  const view = _assetView(r);
  return { ok: true, asset: Object.assign(view, { createdByName: nameOf(view.createdBy), submittedByName: nameOf(view.submittedBy),
      verifiedByName: view.verifiedBy ? nameOf(view.verifiedBy) : '' }),
    reviewBlock: _assetReviewBlock(r, auth.member.memberNo),
    history: _assetLog(SH_ASSET_HISTORY, 'assetid', view.id).map(h => ({ at: String(h['Timestamp'] || ''), version: num(h['Version']),
      action: String(h['Action'] || ''), by: String(h['Changed By'] || ''), byName: nameOf(h['Changed By']), field: String(h['Field'] || ''),
      before: String(h['Previous Value'] == null ? '' : h['Previous Value']), after: String(h['New Value'] == null ? '' : h['New Value']), reason: String(h['Reason'] || '') })),
    reviews: _assetLog(SH_ASSET_REVIEWS, 'assetid', view.id).map(v => ({ at: String(v['Timestamp'] || ''), version: num(v['Version']),
      reviewer: String(v['Reviewer'] || ''), reviewerName: String(v['Reviewer Name'] || ''), decision: String(v['Decision'] || ''), comment: String(v['Comment'] || '') })) };
}

// Registers an asset. It starts Pending Verification; a different admin must verify it.
function registerAsset(data) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const v = _validateAsset(data); if (!v.ok) return v;
  const a = v.asset, me = auth.member.memberNo;
  return _withScriptLock(() => {
    setupAssetRegisterSchema();
    const rows = _assetRows();
    const dup = _assetDuplicateError(rows, a, ''); if (dup) return Object.assign({ ok: false }, dup);
    const id = _nextAssetId(rows), ts = now_ts();
    const rec = { 'AssetID': id, 'Timestamp': ts, 'Verification Status': ASSET_VERIFICATION.PENDING, 'Version': 1,
      'Submitted By': me, 'Submitted At': ts, 'Created By': me, 'Updated At': ts, 'Updated By': me };
    ASSET_FIELDS.forEach(([key, col]) => { rec[col] = a[key]; });
    _appendByHeaders(SH_ASSETS, 'assetid', rec);
    _appendByHeaders(SH_ASSET_HISTORY, 'assetid', { 'Timestamp': ts, 'AssetID': id, 'Version': 1, 'Action': 'Registered', 'Changed By': me,
      'Field': '', 'Previous Value': '', 'New Value': _assetSummaryText(a), 'Reason': '' });
    auditLog('Asset Registered', '', me, id + ': ' + _assetSummaryText(a) + '.', id);
    auditLog('Asset Submitted for Verification', '', me, id + ' (version 1) is pending verification by a different administrator.', id);
    _notifyAdmins('Asset verification needed: ' + id, [['Asset', id], ['Type', a.type === 'Other' ? 'Other: ' + a.otherType : a.type],
      ['Description', a.description], ['Value', fmtUGX(a.value)], ['Registered by', auth.member.name + ' (' + me + ')']],
      'A new asset has been registered. A different administrator must verify it in the Asset Register.');
    return { ok: true, assetId: id, verification: ASSET_VERIFICATION.PENDING };
  });
}

// Changes an asset. reason is required and kept with each change. A material change (see ASSET_FIELDS)
// sends a verified or rejected asset back to Pending Verification, as a new version; minor corrections
// keep its verification. version (optional): the version the form was opened on, to refuse a stale save.
function updateAsset(assetId, data, reason, version) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return Object.assign({ field: 'reason' }, rv);
  const v = _validateAsset(data); if (!v.ok) return v;
  return _withScriptLock(() => _updateAssetLocked(auth, assetId, v.asset, String(reason).trim().slice(0, 500), version));
}

// Records that an asset was disposed of. disposal: { date, to, contact }. Keeps the asset on the register.
function disposeAsset(assetId, disposal, reason) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const r = _assetRowById(assetId);
  if (!r) return { ok: false, error: 'Asset not found.' };
  if (String(r['Availability'] || '') === ASSET_DISPOSED) return { ok: false, error: 'This asset is already recorded as disposed. Edit it to correct the disposal details.' };
  disposal = disposal || {};
  const cur = _assetView(r);
  const v = _validateAsset({ tag: cur.tag, type: cur.type, otherType: cur.otherType, description: cur.description, make: cur.make, model: cur.model,
    serial: cur.serial, value: cur.value, dateAcquired: cur.dateAcquired, condition: cur.condition, availability: ASSET_DISPOSED,
    location: cur.location, disposalDate: disposal.date, disposedTo: disposal.to, recipientContact: disposal.contact,
    documents: cur.documents.concat(String(disposal.documents || '').split(/[\r\n]+/).map(x => x.trim()).filter(Boolean)).join('\n'), notes: cur.notes });
  if (!v.ok) return v;
  const why = String(reason || '').trim() || 'Asset disposed';
  return _withScriptLock(() => _updateAssetLocked(auth, assetId, v.asset, why.slice(0, 500), disposal.version));
}

function _updateAssetLocked(auth, assetId, a, reason, version) {
  const id = String(assetId || '').trim(), me = auth.member.memberNo;
  const { sh, headers, rows } = readSheet(SH_ASSETS, 'assetid');
  const r = rows.find(x => String(x['AssetID'] || '').trim() === id);
  if (!r) return { ok: false, error: 'Asset not found.' };
  const ver = num(r['Version']) || 1;
  if (version !== undefined && version !== null && String(version) !== '' && num(version) !== ver)
    return { ok: false, code: 'stale', error: 'This asset was changed by someone else after you opened it. Reload it and make your change again.' };
  const dup = _assetDuplicateError(rows.filter(x => String(x['AssetID'] || '').trim()), a, id); if (dup) return Object.assign({ ok: false }, dup);
  const changes = _assetChanges(r, a);
  if (!changes.length) return { ok: false, error: 'Nothing to change.' };
  const material = changes.some(c => c.material);
  const before = String(r['Verification Status'] || ASSET_VERIFICATION.PENDING);
  const nextVer = material ? ver + 1 : ver;
  const ts = now_ts();
  const upd = { 'Updated At': ts, 'Updated By': me };
  changes.forEach(c => { upd[c.col] = c.col === 'Value (UGX)' ? a.value : a[c.key]; });
  if (material) Object.assign(upd, { 'Verification Status': ASSET_VERIFICATION.PENDING, 'Version': nextVer, 'Submitted By': me, 'Submitted At': ts });
  _writeRow(sh, headers, r._row, upd);
  const disposedNow = a.availability === ASSET_DISPOSED && String(r['Availability'] || '') !== ASSET_DISPOSED;
  const action = disposedNow ? 'Disposed' : (material ? 'Material change' : 'Minor correction');
  const { sh: hs, headers: hh } = readSheet(SH_ASSET_HISTORY, 'assetid');
  hs.getRange(hs.getLastRow() + 1, 1, changes.length, hh.length).setValues(changes.map(c => hh.map(h => ({ 'Timestamp': ts, 'AssetID': id,
    'Version': nextVer, 'Action': action, 'Changed By': me, 'Field': c.col, 'Previous Value': c.before, 'New Value': c.after, 'Reason': reason })[h] || '')));
  const detail = changes.map(c => c.col + ': "' + c.before + '" -> "' + c.after + '"').join('; ');
  auditLog(disposedNow ? 'Asset Disposed' : 'Asset Updated', '', me, id + ' ' + (material ? 'material change' : 'minor correction') + '. ' + detail + '. Reason: ' + reason, id);
  if (material) {
    auditLog('Asset Submitted for Verification', '', me, id + ' (version ' + nextVer + ') needs verification by a different administrator'
      + (before === ASSET_VERIFICATION.VERIFIED ? '; it was Verified before this change (reverification required).' : '.'), id);
    _notifyAdmins('Asset verification needed: ' + id, [['Asset', id], ['Change', action], ['Changed by', auth.member.name + ' (' + me + ')'], ['Reason', reason]],
      'An asset has been changed and must be verified again by a different administrator in the Asset Register.');
  }
  return { ok: true, assetId: id, material, verification: material ? ASSET_VERIFICATION.PENDING : before, version: nextVer, changes: changes.length };
}

// A different admin verifies the version awaiting review. version (optional) must match it.
function verifyAsset(assetId, comment, version) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  return _withScriptLock(() => _reviewAssetLocked(auth, assetId, ASSET_VERIFICATION.VERIFIED, String(comment || '').trim().slice(0, 500), version));
}

// Rejects the version awaiting review. A reason is required; it is emailed to the person who submitted it.
function rejectAsset(assetId, reason, version) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const rv = validateReason(reason); if (!rv.ok) return rv;
  return _withScriptLock(() => _reviewAssetLocked(auth, assetId, ASSET_VERIFICATION.REJECTED, String(reason).trim().slice(0, 500), version));
}

function _reviewAssetLocked(auth, assetId, decision, comment, version) {
  const id = String(assetId || '').trim(), me = auth.member.memberNo;
  const { sh, headers, rows } = readSheet(SH_ASSETS, 'assetid');
  const r = rows.find(x => String(x['AssetID'] || '').trim() === id);
  if (!r) return { ok: false, error: 'Asset not found.' };
  const block = _assetReviewBlock(r, me, version); if (block) return { ok: false, error: block };
  const ver = num(r['Version']) || 1, ts = now_ts(), submitter = String(r['Submitted By'] || '').trim();
  _appendByHeaders(SH_ASSET_REVIEWS, 'assetid', { 'Timestamp': ts, 'AssetID': id, 'Version': ver, 'Reviewer': me, 'Reviewer Name': auth.member.name,
    'Decision': decision, 'Comment': comment, 'Submitted By': submitter });
  _writeRow(sh, headers, r._row, decision === ASSET_VERIFICATION.VERIFIED
    ? { 'Verification Status': decision, 'Verified By': me, 'Verified At': ts }
    : { 'Verification Status': decision });
  if (decision === ASSET_VERIFICATION.VERIFIED) {
    auditLog('Asset Verified', '', me, id + ' version ' + ver + ' verified' + (ver > 1 ? ' (reverification)' : '') + ' by ' + auth.member.name
      + '. Submitted by ' + submitter + (comment ? '. Comment: ' + comment : '') + '.', id);
  } else {
    auditLog('Asset Rejected', '', me, id + ' version ' + ver + ' rejected by ' + auth.member.name + '. Reason: ' + comment + '. Submitted by ' + submitter + '.', id);
    const to = [...new Set([submitter, String(r['Created By'] || '').trim()].filter(Boolean))];
    to.forEach(no => { const m = _memberByNo(no); if (m) _sendEmail(m['Email'], 'Asset record rejected: ' + id,
      [['Asset', id], ['Description', String(r['Description'] || '')], ['Version', String(ver)], ['Rejected by', auth.member.name], ['Reason', comment]],
      'An asset record you entered was rejected in the Asset Register. Correct it and save it to submit it for verification again.'); });
  }
  return { ok: true, assetId: id, verification: decision, version: ver };
}

// ── Exports (respect the same filters as the list) ────────────────────────────

function _assetExportData(filters) {
  const cf = _cleanAssetFilters(filters); if (!cf.ok) return cf;
  const list = _filterAssets(_assetRows().map(_assetView), cf.filters);
  const f = cf.filters;
  const desc = Object.keys(f).filter(k => f[k]).map(k => ({ q: 'Search', type: 'Type', condition: 'Condition', availability: 'Status', location: 'Location',
    from: 'Acquired from', to: 'Acquired to', verification: 'Verification', disposal: 'Disposal' }[k] + ': ' + (k === 'disposal' ? (f[k] === 'disposed' ? 'disposed' : 'not disposed') : f[k])));
  const header = ['Asset ID', 'Asset tag', 'Type', 'Description', 'Make / model', 'Serial number', 'Value (UGX)', 'Date acquired', 'Condition',
    'Status', 'Location', 'Disposal date', 'Disposed to', 'Recipient contact', 'Verification', 'Notes'];
  const rows = list.map(a => [a.id, a.tag, a.typeLabel, a.description, [a.make, a.model].filter(Boolean).join(' '), a.serial, a.value, a.dateAcquired,
    a.condition, a.availability, a.location, a.disposalDate, a.disposedTo, a.recipientContact, a.verification + (a.verification === ASSET_VERIFICATION.VERIFIED ? '' : ' (not verified)'), a.notes]);
  return { ok: true, list, header, rows, summary: _assetSummary(list), filterText: desc.length ? desc.join('; ') : 'All assets' };
}

function exportAssetRegisterXlsx(filters) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const d = _assetExportData(filters); if (!d.ok) return d;
  const s = d.summary;
  const fileName = CLUB_SHORT_NAME + '_Asset_Register_' + today() + '.xlsx';
  const blob = _xlsxBlob(fileName, 'Asset Register', [SACCO_NAME + ' - Asset Register', 'Generated ' + human_date(today()) + ' by ' + auth.member.name,
    'Filters: ' + d.filterText, s.count + ' assets: ' + s.verified + ' verified, ' + s.pending + ' pending verification, ' + s.rejected + ' rejected, ' + s.disposed + ' disposed.',
    'Verified value (held assets): ' + fmtUGX(s.verifiedValue) + '. Not yet verified: ' + fmtUGX(s.unverifiedValue) + '.'], d.header, d.rows, [6]);
  auditLog('Asset Register Export', '', auth.member.memberNo, 'Excel export of ' + s.count + ' asset(s). Filters: ' + d.filterText + '.', '');
  return { ok: true, fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Utilities.base64Encode(blob.getBytes()), count: s.count };
}

function exportAssetRegisterPdf(filters) {
  const auth = _adminCaller(); if (!auth.ok) return auth;
  const d = _assetExportData(filters); if (!d.ok) return d;
  const s = d.summary;
  const title = SACCO_NAME + ' Asset Register — ' + human_date(today());
  const blob = _brandedPdf(title, 'Asset register  |  ' + human_date(today()), body => {
    _cards(body, [['Assets', String(s.count)], ['Verified', String(s.verified)], ['Pending verification', String(s.pending)],
      ['Rejected', String(s.rejected)], ['Verified value', fmtUGX(s.verifiedValue)]]);
    _kv(body, [['Filters', d.filterText], ['Not yet verified (value)', fmtUGX(s.unverifiedValue)], ['Disposed', String(s.disposed)], ['Generated by', auth.member.name]]);
    _section(body, 'Assets');
    _table(body, ['Asset ID', 'Tag', 'Type', 'Description', 'Value (UGX)', 'Acquired', 'Condition', 'Status', 'Location', 'Verification'],
      d.list.map(a => [a.id, a.tag || '-', a.typeLabel, a.description + (a.make || a.model ? ' (' + [a.make, a.model].filter(Boolean).join(' ') + ')' : '') + (a.serial ? ' S/N ' + a.serial : ''),
        fmtUGX(a.value), human_date(a.dateAcquired), a.condition, a.availability, a.location,
        a.verification === ASSET_VERIFICATION.VERIFIED ? 'Verified' : a.verification.toUpperCase()]), [4]);
    const disposed = d.list.filter(a => a.disposed);
    if (disposed.length) {
      _section(body, 'Disposals');
      _table(body, ['Asset ID', 'Description', 'Disposal date', 'Disposed to', 'Recipient contact', 'Verification'],
        disposed.map(a => [a.id, a.description, human_date(a.disposalDate), a.disposedTo, a.recipientContact, a.verification]), []);
    }
  });
  auditLog('Asset Register Export', '', auth.member.memberNo, 'PDF export of ' + s.count + ' asset(s). Filters: ' + d.filterText + '.', '');
  return { ok: true, fileName: CLUB_SHORT_NAME + '_Asset_Register_' + today() + '.pdf', mimeType: 'application/pdf', base64: Utilities.base64Encode(blob.getBytes()), count: s.count };
}

function _assetSummaryText(a) {
  return (a.type === 'Other' ? 'Other: ' + a.otherType : a.type) + ' "' + a.description + '"'
    + (a.tag ? ', tag ' + a.tag : '') + (a.make || a.model ? ', ' + [a.make, a.model].filter(Boolean).join(' ') : '') + (a.serial ? ', S/N ' + a.serial : '')
    + ', value ' + fmtUGX(a.value) + ', acquired ' + a.dateAcquired + ', ' + a.condition + ', ' + a.availability + ', at ' + a.location
    + (a.availability === ASSET_DISPOSED ? ', disposed ' + a.disposalDate + ' to ' + a.disposedTo + ' (' + a.recipientContact + ')' : '');
}
