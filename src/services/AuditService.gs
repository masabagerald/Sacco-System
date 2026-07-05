// ── AUDIT LOG ─────────────────────────────────────────────────────────────────

function auditLog(action, affectedMemberNo, performedBy, details, refId) {
  try {
    const sh = getSheet(SH_AUDIT);
    const data = sh.getDataRange().getValues();
    // find header row
    let hRow = -1;
    for (let i = 0; i < data.length; i++)
      if (data[i].some(v => String(v).trim().toLowerCase() === 'timestamp')) { hRow = i; break; }
    const targetRow = hRow > -1 ? data.length + 1 : 5;
    sh.getRange(targetRow, 1, 1, 6).setValues([[
      now_ts(), action,
      String(affectedMemberNo || ''), String(performedBy || ''),
      String(details || ''), String(refId || '')
    ]]);
  } catch(e) { /* non-fatal — don't let audit failure break the transaction */ }
}
