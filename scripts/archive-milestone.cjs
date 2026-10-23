'use strict';
const path = require('node:path');
const { archiveMilestone } = require('./publication-core.cjs');
if (process.argv.length !== 2) { process.stderr.write('Usage: node scripts/archive-milestone.cjs\n'); process.exitCode = 1; }
else archiveMilestone(path.resolve(__dirname, '..')).then(result => process.stdout.write(JSON.stringify({ classification: 'PRIVATE_LOCAL_ONLY', ...result }, null, 2) + '\n')).catch(error => { process.stderr.write('Private archive failed: ' + error.message + '\n'); process.exitCode = 1; });
