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

    'audit-log': { as: P.M001, async run() { await wait(300); goSec('audit'); await wait(500); } }
  };

  window.addEventListener('load', async () => {
    Element.prototype.scrollIntoView = function () {};
    const sc = SCENES[new URLSearchParams(location.search).get('scene')];
    if (!sc) { document.body.innerHTML = 'Unknown scene'; return; }
    window.SCENE_NONMEMBER = !!sc.nonMember;
    if (sc.as) { ME = sc.as; enterApp(); }
    await sc.run();
    document.title = 'READY';
  });
})();
