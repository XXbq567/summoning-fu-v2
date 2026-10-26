'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('paused-only material pictures cannot claim natural playback and stay inside one QA profile',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/qa-paperlab-paused.cjs'),'--dry-run'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);const p=JSON.parse(result.stdout);
 assert.equal(p.classification,'PAUSED_ONLY_NOT_NATURAL_PLAYBACK_OR_REAL_SEND');
 assert.equal(p.naturalPlayback,'NOT_TESTED');assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,60000);
 assert.deepEqual(p.stages,['hold','burning']);
 for(const argv of Object.values(p.commands)){assert.ok(argv.includes('--preview-qa-only'));assert.ok(argv.includes('--user-data-dir='+p.profile));}
 assert.equal(p.initialWindowsHide,false);
});
