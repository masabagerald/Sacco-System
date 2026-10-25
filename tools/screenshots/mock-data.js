// Fictional sample data for the user-guide screenshots. Runs in the browser in place of the
// Apps Script server: every google.script.run call is answered from MOCK below.
// People, numbers and references here are made up.
(function () {
  const PEOPLE = {
    M001: { memberNo: 'M001', name: 'Grace Akello', email: 'grace.akello@gmail.com', role: 'Admin', membershipType: 'Founder Member', status: 'Active' },
    M002: { memberNo: 'M002', name: 'Samuel Opio', email: 'samuel.opio@gmail.com', role: 'Admin', membershipType: 'Founder Member', status: 'Active' },
    M003: { memberNo: 'M003', name: 'Sarah Nabirye', email: 'sarah.nabirye@gmail.com', role: 'Admin', membershipType: 'Delegate Member', status: 'Active' },
    M004: { memberNo: 'M004', name: 'Peter Wanyama', email: 'peter.wanyama@gmail.com', role: 'Member', membershipType: 'Founder Member', status: 'Active' },
    M005: { memberNo: 'M005', name: 'Mary Kisakye', email: 'mary.kisakye@gmail.com', role: 'Member', membershipType: 'Delegate Member', status: 'Active' },
    M006: { memberNo: 'M006', name: 'Nancy Achieng', email: 'nancy.achieng@gmail.com', role: 'Member', membershipType: 'Non-Member', status: 'Active' },
    M007: { memberNo: 'M007', name: 'Ruth Atim', email: 'ruth.atim@gmail.com', role: 'Member', membershipType: 'Founder Member', status: 'Active' }
  };
  const BAL = { M001: [1800000, 1800000], M002: [1450000, 1450000], M003: [620000, 620000], M004: [1385000, 1250000], M005: [540000, 480000], M006: [0, 0], M007: [990000, 900000] };
  const name = no => PEOPLE[no].name;

  const accounts = [
    { account: 'Principal', pooled: false, contributions: 7350000, withdrawals: 850000, balance: 6500000, contributionsThisMonth: 420000, members: [
      ['M001', 1800000, 0], ['M002', 1600000, 150000], ['M003', 620000, 0], ['M004', 1450000, 200000], ['M005', 480000, 0], ['M007', 1400000, 500000]] },
    { account: 'Operations', pooled: true, contributions: 610000, withdrawals: 180000, balance: 430000, contributionsThisMonth: 60000, members: [
      ['M001', 120000, 0], ['M002', 120000, 0], ['M003', 80000, 0], ['M004', 120000, 0], ['M005', 50000, 180000], ['M007', 120000, 0]] },
    { account: 'Welfare', pooled: true, contributions: 455000, withdrawals: 150000, balance: 305000, contributionsThisMonth: 45000, members: [
      ['M001', 90000, 0], ['M002', 90000, 0], ['M003', 40000, 0], ['M004', 90000, 0], ['M005', 55000, 0], ['M007', 90000, 150000]] }
  ].map(a => Object.assign(a, { members: a.members.map(([no, c, w]) => ({ memberNo: no, name: name(no), contributions: c, withdrawals: w, balance: c - w })) }));

  const MOCK = {
    tryAutoDetect: () => ({ detected: false }),
    getMySavings: () => window.SCENE_NONMEMBER ? { ok: false, nonMember: true } : {
      ok: true, balance: 1385000, pooled: ['Operations', 'Welfare'], canWithdraw: true,
      accounts: { Principal: 1250000, Operations: 120000, Welfare: 90000, total: 1460000 },
      contributions: { Principal: 1450000, Operations: 120000, Welfare: 90000 },
      available: { Principal: 1250000, Operations: 430000, Welfare: 305000 },
      history: [
        { date: '2026-06-05', type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000231', amount: 100000 },
        { date: '2026-07-05', type: 'Deposit', account: 'Operations', category: 'Operations Fee', reference: 'DEP-000262', amount: 20000 },
        { date: '2026-08-05', type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000290', amount: 150000 },
        { date: '2026-08-07', type: 'Deposit Reversal', account: 'Principal', category: 'Monthly Premium', reference: 'REV-000012', amount: 150000, reverses: 'DEP-000290' },
        { date: '2026-08-05', type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000295', amount: 100000 },
        { date: '2026-09-05', type: 'Deposit', account: 'Welfare', category: 'Welfare Fee', reference: 'DEP-000318', amount: 15000 },
        { date: '2026-09-20', type: 'Withdrawal', account: 'Principal', category: '', reference: 'WDL-000041', amount: 200000 },
        { date: '2026-10-05', type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000344', amount: 100000 }
      ] },
    getMyLoans: () => ({ ok: true, loans: window.SCENE_NONMEMBER ? [] : [{
      loanId: 'L014', status: 'Active', overdue: false, model: 'member', principal: 500000, rateLabel: '10%', termLabel: '3 months',
      outstandingBalance: 555000, totalDue: 555000, totalRepaid: 0, dueDate: '2026-12-20', processingFee: 5000, penalty: 0,
      scheduleHead: ['Payment', 'Due', 'Amount', 'Balance'], schedule: [{ label: 'Full payment', due: '2026-12-20', amount: 555000, balance: 555000 }] }] }),
    getMyLoanRequests: () => ({ ok: true, requests: window.SCENE_NONMEMBER ? [] : [
      { requestId: 'R021', amount: 500000, termLabel: '3 months', total: 555000, purpose: 'School fees', status: 'Approved', decisionNotes: 'Approved → L014', date: '2026-09-18 10:02:11' }] }),
    requestSecuredLoan: () => ({ ok: true, requestId: 'R025', total: 335000, waiverStatus: 'Pending Waiver Approval', failed: [] }),
    getMyWithdrawalRequests: () => ({ ok: true, requests: [
      { requestId: 'W009', account: 'Welfare', amount: 50000, reason: 'Welfare', status: 'Partially Approved', decisionNotes: 'First approval by M002', date: '2026-10-08 09:15:00' },
      { requestId: 'W006', account: 'Principal', amount: 200000, reason: 'Dividends', status: 'Approved', decisionNotes: 'Approved by M001 and M003', date: '2026-09-19 14:40:00' }] }),
    getMyFines: () => ({ ok: true, fines: [], unpaidTotal: 0 }),
    getLoanTerms: (forNo) => (forNo ? PEOPLE[forNo] : (window.SCENE_NONMEMBER ? PEOPLE.M006 : PEOPLE.M004)).membershipType === 'Non-Member'
      ? { ok: true, membershipType: 'Non-Member', product: 'soft', fee: 10000, terms: [
          { key: '1w', label: '1 week', days: 7, rate: 5 }, { key: '2w', label: '2 weeks', days: 14, rate: 10 },
          { key: '3w', label: '3 weeks', days: 21, rate: 15 }, { key: '1m', label: '1 month', days: 30, rate: 15 }] }
      : { ok: true, membershipType: 'Founder Member', product: 'member', fee: 5000, rate: 10, minMonths: 2 },
    getGuarantorCandidates: () => ({ ok: true, candidates: ['M001', 'M002', 'M004', 'M007'].map(no => ({ memberNo: no, name: name(no) })) }),

    getAllMembersSummary: () => ({ ok: true, members: Object.values(PEOPLE).map(p => Object.assign({}, p, { savingsBalance: BAL[p.memberNo][0], principalBalance: BAL[p.memberNo][1] })) }),
    getAdminDashboard: () => ({ ok: true, totalMembers: 7, totalSavings: 7235000, totalLoansOutstanding: 1180000, activeLoanCount: 3,
      unpaidFinesTotal: 30000, pendingLoanRequests: 2, pendingWithdrawalRequests: 1, month: '2026-10',
      depositsThisMonth: 525000, withdrawalsThisMonth: 50000, repaymentsThisMonth: 210000, loansIssuedThisMonth: 1, loansIssuedAmountThisMonth: 100000,
      overdueCount: 0, overdueAmount: 0, unpaidSurchargeCount: 2, paidFinesTotal: 45000, paidSurchargeCount: 4,
      categoryTotals: [['Membership Fee', 0], ['Annual Subscription Fee', 0], ['Monthly Premium', 420000], ['Operations Fee', 60000], ['Welfare Fee', 45000], ['Surcharge', 0], ['Uncategorised', 0]]
        .map(([category, amount]) => ({ category, amount })),
      depositAccounts: accounts, overdueLoans: [] }),
    getWithdrawalRequests: () => ({ ok: true, requests: [
      { requestId: 'W009', memberNo: 'M004', memberName: name('M004'), account: 'Welfare', pooled: true, amount: 50000, reason: 'Welfare', status: 'Partially Approved',
        currentBalance: 305000, initiatedBy: 'M004', initiatedByName: name('M004'), approver1: 'M002', approver1Name: name('M002'), approver2: '', approver2Name: '' },
      { requestId: 'W010', memberNo: 'M001', memberName: name('M001'), account: 'Principal', pooled: false, amount: 300000, reason: 'Dividends', status: 'Pending',
        currentBalance: 1800000, initiatedBy: 'M001', initiatedByName: name('M001'), approver1: '', approver1Name: '', approver2: '', approver2Name: '' },
      { requestId: 'W008', memberNo: 'M005', memberName: name('M005'), account: 'Operations', pooled: true, amount: 180000, reason: 'Operations', status: 'Approved',
        currentBalance: 430000, initiatedBy: 'M005', initiatedByName: name('M005'), approver1: 'M001', approver1Name: name('M001'), approver2: 'M003', approver2Name: name('M003') }] }),
    // ISS-11: Peter (M004, 400,000 Principal savings) asks for 300,000; his cap is 200,000
    checkLoanCoverage: (amount, term, gs) => ({ ok: true, membershipType: 'Founder Member',
      applicant: { savings: 400000, maxLoan: 200000, coveragePct: Math.round(40000000 / (Number(amount) || 1)) / 100, limitPct: 50, ok: Number(amount) <= 200000 },
      guarantors: (gs || []).map(no => ({ memberNo: no, name: name(no), savings: 900000, needed: Number(amount) * 0.25, coveragePct: 300, requiredPct: 25, ok: true })),
      failed: Number(amount) > 200000 ? ['Applicant savings coverage (Art. 4, Sec. 2): a loan of UGX ' + Number(amount).toLocaleString('en-US') + ' is above the cap of UGX 200,000 (50% of Principal savings of UGX 400,000).'] : [],
      securedAvailable: Number(amount) > 200000 }),
    getLoanRequests: () => ({ ok: true, requests: [
      { requestId: 'R025', memberNo: 'M004', memberName: name('M004'), membershipType: 'Founder Member', amount: 300000, termLabel: '3 months', total: 335000,
        guarantorsRequired: true, savingsLimit: true, guarantorOverride: '', limitOverride: '', purpose: 'Clinic equipment', status: 'Pending Waiver Approval', decisionNotes: '', date: '2026-10-21 09:30:00',
        withinLimit: false, savings: 400000, maxLoan: 200000, daysPending: 2, decisionOverdue: false, secured: true, waivedLimit: false,
        guarantors: [], pendingGuarantors: [{ memberNo: 'M001', name: name('M001'), response: 'Not asked yet' }, { memberNo: 'M007', name: name('M007'), response: 'Not asked yet' }],
        initiatedBy: 'M004', initiatedByName: name('M004'), approver1: '', approver1Name: '', approver2: '', approver2Name: '',
        waiver: { status: 'Partially Approved', submittedAt: '2026-10-21 09:30:12',
          failed: ['Applicant savings coverage (Art. 4, Sec. 2): a loan of UGX 300,000 is above the cap of UGX 200,000 (50% of Principal savings of UGX 400,000).'],
          applicantSavings: 400000, applicantCoveragePct: 133.33, loanCap: 200000,
          guarantorCoverage: [{ memberNo: 'M001', name: name('M001'), savings: 900000, coveragePct: 300, requiredPct: 25 }, { memberNo: 'M007', name: name('M007'), savings: 650000, coveragePct: 216.67, requiredPct: 25 }],
          security: { type: 'Land Title', description: 'Plot 214, Block 9, Namakwekwe, Mbale (0.25 acres)', value: 45000000, ownership: 'Registered to Peter Wanyama (sole owner)',
            documents: ['https://drive.google.com/file/d/1xExampleTitleScan/view'], justification: 'Buying an ultrasound machine for my clinic; repayment from clinic income.', verified: false },
          decisions: [{ at: '2026-10-21 14:02:40', adminNo: 'M003', name: name('M003'), role: 'Finance Committee', decision: 'Approved', comment: 'Title search done at the lands office.' }],
          approvals: 1, required: 3, stillNeeded: 'Still needed: 1 from Chairperson, 1 from Finance Committee.', approveBlock: '', rejectBlock: '' } },
      { requestId: 'R024', memberNo: 'M006', memberName: name('M006'), membershipType: 'Non-Member', amount: 100000, termLabel: '2 weeks', total: 120000,
        guarantorsRequired: true, savingsLimit: false, guarantorOverride: '', purpose: 'Stock for shop', status: 'Pending', decisionNotes: '', date: '2026-10-09 11:20:00',
        withinLimit: true, savings: 0, maxLoan: 0, daysPending: 1, decisionOverdue: false,
        guarantors: [{ memberNo: 'M004', name: name('M004'), response: 'Accepted' }, { memberNo: 'M007', name: name('M007'), response: 'Pending' }],
        initiatedBy: 'M006', initiatedByName: name('M006'), approver1: '', approver1Name: '', approver2: '', approver2Name: '' },
      { requestId: 'R023', memberNo: 'M007', memberName: name('M007'), membershipType: 'Founder Member', amount: 300000, termLabel: '2 months', total: 335000,
        guarantorsRequired: true, savingsLimit: true, guarantorOverride: 'Committee minute 12/2026', purpose: 'Farm inputs', status: 'Partially Approved', decisionNotes: '', date: '2026-10-08 16:05:00',
        withinLimit: true, savings: 900000, maxLoan: 450000, daysPending: 2, decisionOverdue: false,
        guarantors: [{ memberNo: 'M001', name: name('M001'), response: 'Accepted' }, { memberNo: 'M002', name: name('M002'), response: 'Accepted' }],
        initiatedBy: 'M003', initiatedByName: name('M003'), approver1: 'M002', approver1Name: name('M002'), approver2: '', approver2Name: '' }] }),
    getActiveLoans: () => ({ ok: true, loans: [
      { loanId: 'L012', memberNo: 'M005', name: name('M005'), membershipType: 'Delegate Member', dateIssued: '2026-07-20', dueDate: '2026-09-20',
        principal: 300000, totalDue: 335000, totalRepaid: 100000, outstandingBalance: 268500, overdue: true },
      { loanId: 'L015', memberNo: 'M006', name: name('M006'), membershipType: 'Non-Member', dateIssued: '2026-10-06', dueDate: '2026-10-20',
        principal: 100000, totalDue: 120000, totalRepaid: 0, outstandingBalance: 120000, overdue: false },
      { loanId: 'L014', memberNo: 'M004', name: name('M004'), membershipType: 'Founder Member', dateIssued: '2026-09-20', dueDate: '2026-12-20',
        principal: 500000, totalDue: 555000, totalRepaid: 0, outstandingBalance: 555000, overdue: false }] }),
    // L015: 100,000 principal + 10,000 interest + 10,000 processing fee, nothing paid yet
    getRepaymentPreview: (loanId, amount, date) => {
      const parts = [['principal', 'Principal', 100000], ['interest', 'Interest', 10000], ['fee', 'Processing fee', 10000]];
      let left = Number(amount) || 0;
      const take = {};
      ['fee', 'interest', 'principal'].forEach(p => { const c = parts.find(x => x[0] === p)[2]; take[p] = Math.min(left, c); left -= take[p]; });
      return { ok: true, loanId, memberNo: 'M006', model: 'term', status: 'Active', date, amount: Number(amount) || 0,
        allocationOrder: ['fee', 'interest', 'penalty', 'principal'],
        components: parts.map(([part, label, charged]) => ({ part, label, charged, paidBefore: 0, outstandingBefore: charged, allocated: take[part],
          balanceAfter: charged - take[part], status: charged - take[part] <= 0 ? 'Settled by this payment' : 'Outstanding', chargeChanged: false })),
        credit: { before: 0, allocated: left, after: left },
        totals: { outstandingBefore: 120000, amount: Number(amount) || 0, outstandingAfter: Math.max(0, 120000 - (Number(amount) || 0)) },
        overpayment: Math.max(0, (Number(amount) || 0) - 120000), similar: [], chargeChanged: false, reconciles: true, stateKey: '0|0|120000' };
    },
    // Asset Register (ISS-12)
    getAssets: () => {
      const A = (id, tag, type, description, make, model, serial, value, acquired, condition, availability, location, verification, extra) =>
        Object.assign({ id, tag, type, typeLabel: type, description, make, model, serial, value, dateAcquired: acquired, condition, availability, location,
          disposalDate: '', disposedTo: '', recipientContact: '', verification, version: 1, disposed: availability === 'Disposed Off', canReview: false }, extra || {});
      const assets = [
        A('AST-0001', 'MSIC-IT-001', 'Computers', 'Treasurer\'s laptop', 'Dell', 'Latitude 5420', 'DL5420-77X1', 2450000, '2025-03-14', 'Functional', 'In Use', 'Treasurer\'s office', 'Verified'),
        A('AST-0002', 'MSIC-IT-002', 'Printers', 'Office printer and scanner', 'HP', 'LaserJet M428', 'HPM428-1190', 1350000, '2025-03-14', 'Non-functional', 'Unavailable', 'Club office', 'Verified', { version: 2 }),
        A('AST-0003', 'MSIC-F-001', 'Furniture', 'Conference table and 12 chairs', '', '', '', 1800000, '2024-11-02', 'Functional', 'Available', 'Meeting hall', 'Verified'),
        A('AST-0004', 'MSIC-EQ-001', 'Equipment', 'Projector for meetings', 'Epson', 'EB-X51', 'EPX51-3302', 2100000, '2026-10-20', 'Functional', 'Available', 'Club office', 'Pending Verification', { canReview: true }),
        A('AST-0005', 'MSIC-IT-000', 'Computers', 'Old desktop computer', 'Lenovo', 'ThinkCentre M70', 'LNV-M70-88', 900000, '2021-02-10', 'Non-functional', 'Disposed Off', 'Club office', 'Verified',
          { disposalDate: '2026-08-15', disposedTo: 'St Jude Primary School', recipientContact: '+256772123456', version: 3 }),
        A('AST-0006', '', 'Other', 'Generator (2.5 kVA)', 'Honda', 'EU22i', '', 3200000, '2026-09-30', 'Functional', 'Available', 'Store room', 'Rejected', { typeLabel: 'Other: Generator' })];
      return { ok: true, ready: true, assets, page: 1, pages: 1, pageSize: 25, total: assets.length,
        summary: { count: 6, verified: 4, pending: 1, rejected: 1, disposed: 1, verifiedValue: 5600000, unverifiedValue: 5300000 },
        options: { types: ['Computers', 'Printers', 'Furniture', 'Vehicles', 'Equipment', 'Other'], conditions: ['Functional', 'Non-functional'],
          availability: ['Available', 'In Use', 'Unavailable', 'Disposed Off'], verification: ['Pending Verification', 'Verified', 'Rejected'] } };
    },
    getAsset: () => ({ ok: true, reviewBlock: '',
      asset: { id: 'AST-0004', tag: 'MSIC-EQ-001', type: 'Equipment', otherType: '', typeLabel: 'Equipment', description: 'Projector for meetings', make: 'Epson', model: 'EB-X51',
        serial: 'EPX51-3302', value: 2100000, dateAcquired: '2026-10-20', condition: 'Functional', availability: 'Available', location: 'Club office',
        disposalDate: '', disposedTo: '', recipientContact: '', documents: ['https://drive.google.com/file/d/1xProjectorReceipt/view'], notes: 'Receipt no. 4471 from Mbale Office Supplies',
        verification: 'Pending Verification', version: 1, createdBy: 'M003', createdByName: name('M003'), createdAt: '2026-10-20 15:12:08',
        submittedBy: 'M003', submittedByName: name('M003'), submittedAt: '2026-10-20 15:12:08', verifiedBy: '', verifiedByName: '', verifiedAt: '', disposed: false },
      reviews: [],
      history: [{ at: '2026-10-20 15:12:08', version: 1, action: 'Registered', by: 'M003', byName: name('M003'), field: '', before: '',
        after: 'Equipment "Projector for meetings", tag MSIC-EQ-001, Epson EB-X51, S/N EPX51-3302, value UGX 2,100,000, acquired 2026-10-20, Functional, Available, at Club office', reason: '' }] }),
    getRepayments: () => ({ ok: true, ready: true, repayments: [
      { reference: 'RPY-000047', date: '2026-10-13', loanId: 'L012', memberNo: 'M005', name: name('M005'), amount: 50000, notes: 'Cash, receipt 4471', recordedBy: 'M002', reverses: '', reversedBy: '' },
      { reference: 'RPY-000046', date: '2026-10-12', loanId: 'L014', memberNo: 'M004', name: name('M004'), amount: 120000, notes: 'Mobile money, ref MM-87120', recordedBy: 'M001', reverses: '', reversedBy: '' },
      { reference: 'RPY-000045', date: '2026-10-08', loanId: 'L012', memberNo: 'M005', name: name('M005'), amount: -35000, notes: 'Reversal of RPY-000044: entered twice', recordedBy: 'M003', reverses: 'RPY-000044', reversedBy: '' },
      { reference: 'RPY-000044', date: '2026-10-07', loanId: 'L012', memberNo: 'M005', name: name('M005'), amount: 35000, notes: 'Cash', recordedBy: 'M002', reverses: '', reversedBy: 'RPY-000045' },
      { reference: 'RPY-000043', date: '2026-09-30', loanId: 'L012', memberNo: 'M005', name: name('M005'), amount: 65000, notes: 'Cash, receipt 4402', recordedBy: 'M001', reverses: '', reversedBy: '' }] }),
    getAllFinesForAdmin: () => [
      { fineId: 'F007', memberName: name('M005'), date: '2026-10-01', reason: 'Late monthly premium', amount: 10000, status: 'Unpaid' },
      { fineId: 'F006', memberName: name('M003'), date: '2026-09-30', reason: 'Missed meeting', amount: 20000, status: 'Unpaid' }],
    getSavingsTransactions: () => ({ ok: true, net: 135000, rows: [
      { date: '2026-10-05', member: 'M004', name: name('M004'), type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000344', amount: 100000, sign: 1, notes: 'Slip 55812', reversedBy: '', reverses: '' },
      { date: '2026-10-05', member: 'M007', name: name('M007'), type: 'Deposit', account: 'Welfare', category: 'Welfare Fee', reference: 'DEP-000343', amount: 15000, sign: 1, notes: '', reversedBy: '', reverses: '' },
      { date: '2026-10-05', member: 'M005', name: name('M005'), type: 'Deposit', account: 'Operations', category: 'Operations Fee', reference: 'DEP-000342', amount: 20000, sign: 1, notes: '', reversedBy: '', reverses: '' },
      { date: '2026-08-07', member: 'M004', name: name('M004'), type: 'Deposit Reversal', account: 'Principal', category: 'Monthly Premium', reference: 'REV-000012', amount: 150000, sign: -1, notes: 'Reversal of DEP-000290 (corrected): Wrong amount', reversedBy: '', reverses: 'DEP-000290' },
      { date: '2026-08-05', member: 'M004', name: name('M004'), type: 'Deposit', account: 'Principal', category: 'Monthly Premium', reference: 'DEP-000290', amount: 150000, sign: 1, notes: '', reversedBy: 'REV-000012', reverses: '' }] }),
    getAuditLog: () => ({ ok: true, entries: [
      ['2026-10-09 11:42', 'Guarantor Consent Given', 'M006', 'M004', 'Peter Wanyama agreed to guarantee Nancy Achieng\'s loan request of UGX 100,000.', 'R024'],
      ['2026-10-09 11:20', 'Loan Request Submitted', 'M006', 'M006', 'Requested UGX 100,000 over 2 weeks. Guarantors: M004, M007. Purpose: Stock for shop', 'R024'],
      ['2026-10-08 16:30', 'Loan Request First Approval', 'M007', 'M002', 'First of two required approvals. Guarantor restriction override on file: Committee minute 12/2026', 'R023'],
      ['2026-10-08 16:05', 'Guarantor Restriction Override', 'M007', 'M003', 'Member is guaranteeing a running loan; loan proposed anyway (Art. 4, Sec. 8). Reason: Committee minute 12/2026', 'R023'],
      ['2026-10-08 09:40', 'Withdrawal First Approval', 'M004', 'M002', 'First of two required approvals (UGX 50,000 from Welfare).', 'W009'],
      ['2026-10-05 10:12', 'Deposit', 'M004', 'M001', 'Deposit of UGX 100,000 (Principal account, Monthly Premium, dated 2026-10-05). Note: Slip 55812. New Principal balance: UGX 1,250,000. Total savings: UGX 1,460,000', 'DEP-000344'],
      ['2026-08-07 15:03', 'Contribution Corrected', 'M004', 'M001', 'DEP-000290 corrected. Before: UGX 150,000 in Principal (Monthly Premium, dated 2026-08-05). After: UGX 100,000 in Principal (Monthly Premium, dated 2026-08-05). Reason: Wrong amount', 'DEP-000295']
    ].map(([timestamp, action, member, performedBy, details, refId]) => ({ timestamp, action, member, performedBy, details, refId })), timeZone: 'Africa/Nairobi' })
  };

  function runner(onOk, onFail) {
    return new Proxy({}, { get(_, fn) {
      if (fn === 'withSuccessHandler') return h => runner(h, onFail);
      if (fn === 'withFailureHandler') return h => runner(onOk, h);
      return (...args) => setTimeout(() => {
        // Loan Insights / Investments: recorded from the real server (finance-data.js), as admin or as a Founder Member
        const fin = window.FINANCE_MOCK && (window.FINANCE_MOCK[window.SCENE_WHO || 'admin'] || {})[fn];
        if (fin) { if (onOk) onOk(JSON.parse(JSON.stringify(fin))); return; }
        if (!MOCK[fn]) { console.warn('No mock for ' + fn); return; }
        if (onOk) onOk(MOCK[fn](...args));
      }, 0);
    } });
  }
  window.google = { script: { run: runner(null, null) } };
  window.SAMPLE_PEOPLE = PEOPLE;
})();
