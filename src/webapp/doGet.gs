// ── WEB APP ENTRY POINT ────────────────────────────────────────────────────────

function doGet() {
  return HtmlService.createTemplateFromFile('src/webapp/index')
    .evaluate()
    .setTitle(SACCO_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Stitches component templates/scripts together, e.g. <?!= include('src/webapp/components/app/app') ?>
// Uses evaluate() (not just createHtmlOutputFromFile) so an included file's own
// <?!= include(...) ?> calls are resolved too — components can nest child components.
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}
