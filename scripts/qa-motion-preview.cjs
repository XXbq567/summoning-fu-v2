'use strict';
// Compatibility entry: the Paperlab runner owns bounded real-material acceptance.
const { main } = require('./qa-paperlab-preview.cjs');
main().catch(error => {
  process.stderr.write('Paperlab QA preflight failed: ' + error.message + '\n');
  process.exitCode = 1;
});
