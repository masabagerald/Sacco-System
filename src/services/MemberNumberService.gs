// ── MEMBER NUMBERS ────────────────────────────────────────────────────────────
// Member numbers are MSIC-0001, MSIC-0002, ... : the club prefix and a serial number. A number is
// given once and never changes or gets reused. It carries no meaning (membership type and date joined
// both change), so it never has to be rewritten. Numbers from before this format (M001, ...) are
// converted by migrateMemberNumbers(), run once from the script editor.
const MEMBER_NO_PREFIX = 'MSIC-';
const MEMBER_NO_DIGITS = 4;
const LEGACY_MEMBER_NO = /^M([0-9]+)$/i;

function _formatMemberNo(n) { return MEMBER_NO_PREFIX + String(n).padStart(MEMBER_NO_DIGITS, '0'); }

// Serial part of a member number in either format (MSIC-0007 or legacy M007), or 0
function _memberSerial(memberNo) {
  const s = String(memberNo||'').trim();
  const m = s.match(LEGACY_MEMBER_NO) || (s.toUpperCase().startsWith(MEMBER_NO_PREFIX) && s.slice(MEMBER_NO_PREFIX.length).match(/^([0-9]+)$/));
  return m ? parseInt(m[1], 10) : 0;
}

// Next number after the highest existing one, counting legacy numbers too, so a new member added
// before the migration (e.g. MSIC-0006 after M005) can never collide with a migrated number.
function _nextMemberNo() {
  const { rows } = readSheet(SH_MEMBERS, 'memberno');
  return _formatMemberNo(rows.reduce((max, r) => Math.max(max, _memberSerial(r['MemberNo'])), 0) + 1);
}

// ── ONE-TIME MIGRATION: M001 -> MSIC-0001 ─────────────────────────────────────
// Columns that hold a member number, on any tab. Only cells exactly equal to an old number change;
// formulas, dates and free text (e.g. Decision Notes) are left as they are. The Audit Log is
// append-only and keeps the old numbers; one entry records the mapping.
const MEMBER_NO_COLUMNS = ['memberno', 'applicantno', 'guarantorno', 'borrowerno', 'recorded by', 'issued by', 'initiated by',
  'decided by', 'approver 1', 'approver 2', 'guarantor 1', 'guarantor 2', 'created by', 'updated by',
  'reviewed by (admin 1)', 'approved by (admin 2)'];

// { 'M001': 'MSIC-0001', ... } for every legacy number on the Members tab
function _memberNoMapping() {
  const { rows } = readSheet(SH_MEMBERS, 'memberno');
  const map = {};
  rows.forEach(r => {
    const old = String(r['MemberNo']||'').trim();
    if (LEGACY_MEMBER_NO.test(old)) map[old] = _formatMemberNo(_memberSerial(old));
  });
  return map;
}

// Finds every cell to change. Returns { map, changes: [{sh, row, col, from, to}], summary: {tab: n}, error }
function _planMemberNoMigration() {
  const map = _memberNoMapping();
  const existing = readSheet(SH_MEMBERS, 'memberno').rows.map(r => String(r['MemberNo']||'').trim());
  const clash = Object.keys(map).find(old => existing.indexOf(map[old]) > -1);
  if (clash) return { map, changes: [], summary: {}, error: map[clash] + ' (the new number for ' + clash + ') is already used by another member. Nothing was changed.' };
  const changes = [], summary = {};
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(sh => {
    const name = sh.getName();
    if (name === SH_AUDIT || name === 'Instructions' || !Object.keys(map).length) return;
    const data = sh.getDataRange().getValues();
    // Header row: the first of the top 10 rows naming a member-number column (tabs have a title above)
    const hRow = data.slice(0, 10).findIndex(r => r.some(v => MEMBER_NO_COLUMNS.indexOf(String(v).trim().toLowerCase()) > -1));
    if (hRow < 0) return;
    const cols = data[hRow].map((v, c) => MEMBER_NO_COLUMNS.indexOf(String(v).trim().toLowerCase()) > -1 ? c : -1).filter(c => c > -1);
    for (let r = hRow + 1; r < data.length; r++) cols.forEach(c => {
      const from = String(data[r][c]).trim();
      if (map[from]) { changes.push({ sh, row: r + 1, col: c + 1, from, to: map[from] }); summary[name] = (summary[name] || 0) + 1; }
    });
  });
  return { map, changes, summary, error: '' };
}

function _describeMemberNoPlan(plan) {
  return 'Mapping: ' + (Object.keys(plan.map).map(k => k + ' -> ' + plan.map[k]).join(', ') || 'none (no old-format numbers)') +
    '. Cells per tab: ' + (Object.keys(plan.summary).map(k => k + ' ' + plan.summary[k]).join(', ') || 'none') + '.';
}

// Run from the script editor first: logs what migrateMemberNumbers() would change, changes nothing.
function previewMemberNumberMigration() {
  const plan = _planMemberNoMigration();
  const msg = plan.error || (plan.changes.length + ' cell(s) would change. ' + _describeMemberNoPlan(plan));
  Logger.log(msg);
  return msg;
}

// Run once from the script editor: renumbers M001 -> MSIC-0001 (etc.) on every tab except the Audit
// Log. Safe to run again: with no old-format numbers left it changes nothing.
function migrateMemberNumbers() {
  return _withScriptLock(() => {
    const plan = _planMemberNoMigration();
    if (plan.error) { Logger.log(plan.error); return plan.error; }
    if (!plan.changes.length) { Logger.log('No old-format member numbers found; nothing to change.'); return 'Nothing to change.'; }
    plan.changes.forEach(ch => ch.sh.getRange(ch.row, ch.col).setValue(ch.to));
    const msg = 'Member numbers changed to the ' + MEMBER_NO_PREFIX + '0001 format: ' + plan.changes.length + ' cell(s). ' + _describeMemberNoPlan(plan)
      + ' Earlier audit entries and free-text notes keep the old numbers.';
    auditLog('Member Numbers Migrated', '', 'System', msg, '');
    Logger.log(msg);
    return msg;
  });
}
