// ── WEB APP ENTRY POINT ────────────────────────────────────────────────────────

function doGet() {
  return HtmlService.createTemplateFromFile('src/webapp/index')
    .evaluate()
    .setTitle(SACCO_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Used by index.html to stitch in css/js partials: <?!= include('src/webapp/js/api') ?>
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
