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

// Records one of the two required admin approvals (slot 1 or 2) with a timestamp.
// Shared by Loan Requests and Withdrawal Requests -- both sheets use the same column names.
function _setApprover(sh, headers, hRow, requestId, slot, memberNo) {
  const cId = ci(headers,'requestid'), cM = ci(headers,'approver '+slot), cT = ci(headers,'approver '+slot+' at');
  const data = sh.getDataRange().getValues();
  for (let r = hRow+1; r < data.length; r++) {
    if (String(data[r][cId]).trim() === String(requestId).trim()) {
      if (cM > -1) sh.getRange(r+1, cM+1).setValue(memberNo);
      if (cT > -1) sh.getRange(r+1, cT+1).setValue(now_ts());
      break;
    }
  }
}
