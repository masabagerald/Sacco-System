// ── WEB APP ENTRY POINT ────────────────────────────────────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  // Guarantor response link from email (see GuarantorWeb.gs)
  if (p.g) return guarantorHandle_(p.g, p.decide, p.confirm, p.reason);
  // User guide: public, so the link works before signing in (built by tools/build-guide.py)
  if (p.page === 'guide') return guidePage_();
  // First visit after deploying: the spreadsheet sets itself up (tabs, scheduled jobs, the hosting account
  // as first admin). Afterwards this is one property lookup. See SetupService.gs.
  ensureSetUp_();
  const t = HtmlService.createTemplateFromFile('src/webapp/index');
  t.guideUrl = webAppUrl_() + '?page=guide';
  return t
    .evaluate()
    .setTitle(SACCO_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function guidePage_() {
  const html = HtmlService.createHtmlOutputFromFile('src/webapp/guide/guide').getContent().replace('__APP_URL__', webAppUrl_());
  return HtmlService.createHtmlOutput(html)
    .setTitle(SACCO_NAME + ' — User Guide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Stitches component templates/scripts together, e.g. <?!= include('src/webapp/components/app/app') ?>
// Uses evaluate() (not just createHtmlOutputFromFile) so an included file's own
// <?!= include(...) ?> calls are resolved too — components can nest child components.
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}
