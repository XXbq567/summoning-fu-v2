'use strict';
const path = require('node:path');
const { preparePublicSnapshot } = require('./publication-core.cjs');
if (process.argv.length !== 2) { process.stderr.write('Usage: node scripts/prepare-public-snapshot.cjs\n'); process.exitCode = 1; }
else preparePublicSnapshot(path.resolve(__dirname, '..')).then(result => process.stdout.write(JSON.stringify({ classification: 'PUBLIC_SOURCE_REVIEW_CANDIDATE', ...result }, null, 2) + '\n')).catch(error => { process.stderr.write('Public export failed: ' + error.message + '\n'); process.exitCode = 1; });
