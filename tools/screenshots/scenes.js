// Screens for the user guide. ?scene=<name> picks one. Each scene signs in as a sample person,
// opens a screen, fills in example values and (optionally) hides everything but one panel.
(function () {
  const P = window.SAMPLE_PEOPLE;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); };

  // Hides everything inside <main> except the element (and its ancestors), so one panel fills the shot
  function focusOn(el) {
    if (typeof el === 'string') el = document.querySelector(el);
    while (el && el.parentElement && el.tagName !== 'MAIN') {
      const p = el.parentElement;
      [...p.children].forEach(c => { if (c !== el && c.tagName !== 'SCRIPT') c.style.display = 'none'; });
      el = p;
    }
    window.scrollTo(0, 0);
  }
  const panelOf = sel => document.querySelector(sel).closest('.panel');

  const SCENES = {
    'sign-in': { async run() { await wait(300); set('#manualEmail', 'peter.wanyama@gmail.com'); } },

    'my-account': { as: P.M004, async run() {
      await wait(500);
      focusOn('#sec-my-top');
      document.querySelector('#sec-my-savings').style.display = '';
      document.querySelector('#sec-my-loans').style.display = '';
    } },

    'request-withdrawal': { as: P.M004, async run() {
      await wait(500); openReqWd(); set('#wd_acc', 'Welfare'); set('#wd_am', '50000'); set('#wd_rs', 'Welfare');
    } },

    'request-soft-loan': { as: P.M006, nonMember: true, async run() {
      await wait(500); openReqLoan(); await wait(500);
      set('#rl_am', '100000'); set('#rl_tmwrap_input', '2w'); set('#rl_pu', 'Stock for shop');
      ['M004', 'M007'].forEach(no => { document.querySelector('#rl_gt input[value="' + no + '"]').checked = true; });
      updateQuote('rl_am', 'rl_tmwrap', 'rl_q');
    } },

    'admin-deposit-accounts': { as: P.M001, async run() {
      await wait(300); goSec('dash'); await wait(600); showAccTab('Welfare'); focusOn(panelOf('#d_accTabs'));
    } },

    'record-savings': { as: P.M001, async run() {
      await wait(300); goSec('members'); await wait(600); openRecSavings();
      set('#sv_mb', 'M004'); set('#sv_ty', 'Deposit'); set('#sv_am', '15000'); set('#sv_dt', '2026-10-05');
      set('#sv_acc', 'Welfare'); set('#sv_nt', 'Slip 55840');
    } },

    'savings-transactions': { as: P.M001, async run() {
      await wait(300); goSec('savings'); await wait(600); loadSavingsTx(); await wait(300); focusOn(panelOf('#stfTb'));
    } },

    'adjust-transaction': { as: P.M001, async run() {
      await wait(300); goSec('savings'); await wait(600); loadSavingsTx(); await wait(300); focusOn(panelOf('#stfTb'));
      openAdjTx(0); set('#aj_am', '120000'); set('#aj_rs', 'Amount entered wrongly; slip shows 120,000');
    } },

    'withdrawal-approvals': { as: P.M001, async run() {
      await wait(300); goSec('savings'); await wait(700); focusOn(panelOf('#wdReqAdminTb'));
    } },

    'loan-approvals': { as: P.M001, async run() {
      await wait(300); goSec('loans'); await wait(700); focusOn(panelOf('#loanReqAdminTb'));
    } },

    'propose-loan': { as: P.M003, async run() {
      await wait(300); goSec('members'); await wait(600); openIssueLoan();
      set('#ln_mb', 'M007'); onIssueMemberChange(); await wait(500);
      set('#ln_pr', '300000'); set('#ln_tmwrap_input', '2'); set('#ln_pu', 'Farm inputs');
      ['M001', 'M002'].forEach(no => { document.querySelector('#ln_gt input[value="' + no + '"]').checked = true; });
      set('#ln_ov', 'Committee minute 12/2026');
      updateQuote('ln_pr', 'ln_tmwrap', 'ln_q');
    } },

    'audit-log': { as: P.M001, async run() { await wait(300); goSec('audit'); await wait(500); } },

    'record-repayment': { as: P.M001, async run() {
      await wait(300); goSec('loans'); await wait(700); focusOn(panelOf('#activeLoansTb'));
      openRepay('LN-000015', 120000); set('#rp_am', '50000'); set('#rp_dt', '2026-10-14'); set('#rp_nt', 'Mobile money, ref MM-88213');
      loadRepayPreview(); await wait(300);
    } },

    'secured-loan-request': { as: P.M004, async run() {
      await wait(500); openReqLoan(); await wait(600);
      set('#rl_am', '300000'); set('#rl_tmwrap_input', '3'); set('#rl_pu', 'Clinic equipment');
      ['M001', 'M007'].forEach(no => { document.querySelector('#rl_gt input[value="' + no + '"]').checked = true; });
      loadCoverage(); await wait(300); openSecuredLoan();
      set('#sl_type', 'Land Title'); set('#sl_value', '45000000');
      set('#sl_description', 'Plot 214, Block 9, Namakwekwe, Mbale (0.25 acres)'); set('#sl_ownership', 'Registered to Peter Wanyama (sole owner)');
      set('#sl_documents', 'https://drive.google.com/file/d/1xExampleTitleScan/view');
      set('#sl_justification', 'Buying an ultrasound machine for my clinic; repayment from clinic income.');
    } },

    'waiver-decision': { as: P.M001, async run() {
      await wait(300); goSec('loans'); await wait(800); focusOn(panelOf('#loanReqAdminTb')); openWaiver('LRQ-000025');
      set('#wv_comment', 'Title verified at the lands office; value confirmed by the valuer.');
    } },

    'terms-of-use': { async run() {
      ME = P.M002; afterSignIn(); await wait(400);
      document.querySelector('#termsDocs input[data-doc="use"]').checked = true; termsTicked();
    } },

    'edit-terms': { as: P.M001, async run() {
      await wait(400); openTermsEditor(); await wait(400);
      set('#te_summary', 'Added a section on members\' meetings');
      const t = document.querySelector('#te_text'); t.value += '\n\n## Meetings\n- Members attend the annual general meeting or send apologies.';
      document.querySelector('#te_confirm').checked = true; document.querySelector('#te_pub').disabled = false;
    } },

    'asset-register': { as: P.M001, async run() {
      await wait(300); goSec('assets'); await wait(800);
    } },

    'asset-review': { as: P.M001, async run() {
      await wait(300); goSec('assets'); await wait(800); openAssetView('AST-000004'); await wait(300);
      set('#av_comment', 'Checked the projector and the receipt in the club office.');
    } },

    'reverse-repayment': { as: P.M001, async run() {
      await wait(300); goSec('loans'); await wait(700); focusOn(panelOf('#repaymentsTb'));
      openRevRepay('RPY-000046'); set('#rr_rs', 'Recorded against LN-000014 by mistake; the payment was for LN-000012');
    } },

    // Loan Insights as a Founder Member (Peter, not an admin): club totals only
    'loan-insights-founder': { as: P.M004, who: 'founder', async run() {
      await wait(300); goSec('insights'); await wait(700);
      ['#li_cashTb', '#li_typeTb', '#lc_dis', '#li_cumTb'].forEach(s => { panelOf(s).style.display = 'none'; });
    } },

    'loan-insights-trends': { as: P.M001, async run() {
      await wait(300); goSec('insights'); await wait(700); focusOn(panelOf('#lc_dis'));
    } },

    'loan-fund-entry': { as: P.M001, async run() {
      await wait(300); goSec('insights'); await wait(800); focusOn(panelOf('#li_entTb'));
      openFundEntry(); set('#fe_ty', 'Cash Injection'); set('#fe_am', '250000'); set('#fe_ref', 'BANK-1120'); set('#fe_ds', 'Grant from the alumni association');
    } },

    'loan-fund-trace': { as: P.M001, async run() {
      await wait(300); goSec('insights'); await wait(800); loadFundLedger(); await wait(400); focusOn(panelOf('#li_ledTb'));
    } },

    'investments': { as: P.M001, async run() {
      await wait(300); goSec('investments'); await wait(800);
      ['#iv_perTb', '#ic_rec', '#iv_typeTb'].forEach(s => { panelOf(s).style.display = 'none'; });
      document.querySelectorAll('#iv_body .sec-h')[1].style.display = 'none';
    } },

    'investment-transfer': { as: P.M001, async run() {
      await wait(300); goSec('investments'); await wait(800); focusOn(panelOf('#iv_tb'));
      openInvTr('INV-000001'); set('#tr_dir', 'toLoanFund'); set('#tr_am', '300000'); set('#tr_rf', 'TRF-9'); set('#tr_nt', 'Top up the loan float');
    } }
  };

  window.addEventListener('load', async () => {
    Element.prototype.scrollIntoView = function () {};
    const sc = SCENES[new URLSearchParams(location.search).get('scene')];
    if (!sc) { document.body.innerHTML = 'Unknown scene'; return; }
    window.SCENE_NONMEMBER = !!sc.nonMember;
    window.SCENE_WHO = sc.who || 'admin';
    if (sc.as) { ME = sc.as; enterApp(); }
    await sc.run();
    document.title = 'READY';
  });
})();
