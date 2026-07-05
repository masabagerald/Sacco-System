/*
  KIRA SACCO SYSTEM — Code.gs
  ════════════════════════════
  SETUP (do this once):
  1. Open the Kira SACCO sheet → Extensions → Apps Script.
  2. Delete any existing content and push this project with clasp (or paste each
     file manually, preserving the controllers/ and services/ folder names).
  3. File → New → HTML file, name it exactly "Index" → paste Index.html content.
  4. Save (Ctrl+S).
  5. Deploy → New deployment → Web app:
       Execute as: Me
       Who has access: Anyone
     Authorize when prompted. Copy the /exec URL — that is your Kira SACCO app.
  6. Run createAllTriggers() once to set up all scheduled tasks automatically.

  RE-DEPLOY after any code change:
    Deploy → Manage deployments → edit (pencil) → New version → Deploy.

  PROJECT LAYOUT
  ────────────────
  config/      shared constants (SACCO_NAME, sheet tab names, ...)
  services/    internal business logic & sheet/data access, not called from the frontend
  controllers/ public functions invoked from Index.html via google.script.run,
               plus the time-driven scheduled functions
*/

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(SACCO_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}
