'use strict';
// Read-only display conversion evidence. No BrowserWindow, session, UI input,
// single-instance messaging, source events or persistent settings are used.
async function main() {
  const { app, screen } = require('electron');
  await app.whenReady();
  try {
    const convert = rect => {
      const physical = screen.dipToScreenRect(null, rect);
      return { dip: rect, physical, dipRoundTrip: screen.screenToDipRect(null, physical) };
    };
    process.stdout.write(JSON.stringify({ classification: 'READ_ONLY_ELECTRON_DISPLAY_CONVERSIONS',
      displays: screen.getAllDisplays().map(d => ({ id: d.id, scaleFactor: d.scaleFactor, bounds: d.bounds, workArea: d.workArea })),
      requested: convert({ x: 1422, y: 250, width: 626, height: 902 }),
      nativeReported: convert({ x: 1422, y: 250, width: 627, height: 903 }) }) + '\n');
  } finally { app.quit(); }
}
if (require.main === module || process.versions.electron) main().catch(() => {
  process.stderr.write('Own display conversion probe failed.\n'); require('electron').app.exit(1);
});
module.exports = { main };
