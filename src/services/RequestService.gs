// ── SHARED REQUEST HELPERS (loan requests & withdrawal requests) ─────────────

function _updateReqStatus(sh, headers, hRow, requestId, status, notes, decidedBy) {
  const cId=ci(headers,'requestid'), cSt=ci(headers,'status'),
        cNo=ci(headers,'decision notes'), cBy=ci(headers,'decided by');
  const data=sh.getDataRange().getValues();
  for (let r=hRow+1;r<data.length;r++) {
    if (String(data[r][cId]).trim()===String(requestId).trim()) {
      if(cSt>-1) sh.getRange(r+1,cSt+1).setValue(status);
      if(cNo>-1) sh.getRange(r+1,cNo+1).setValue(notes);
      if(cBy>-1) sh.getRange(r+1,cBy+1).setValue(decidedBy);
      break;
    }
  }
}
