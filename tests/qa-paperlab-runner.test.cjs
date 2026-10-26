'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('Paperlab GUI runner dry-run never launches an app and scopes capture and quit to its own profile',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/qa-paperlab-preview.cjs'),'--dry-run'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);const p=JSON.parse(result.stdout);
 assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,120000);
 assert.match(p.profile,/summoning-fu-preview-qa-[a-f0-9]{8,32}$/);
 for(const argv of Object.values(p.commands)){assert.ok(argv.includes('--preview-qa-only'));assert.ok(argv.includes('--user-data-dir='+p.profile));}
});
test('Paperlab runner deadline rejects a stalled capture without waiting forever',async()=>{
 const {deadline}=require('../scripts/qa-paperlab-preview.cjs');let timeout,cleared=false;
 const result=deadline(new Promise(()=>{}),3000,'capture-timeout',{setTimer:fn=>{timeout=fn;return 1},clearTimer:()=>{cleared=true}});
 timeout();await assert.rejects(result,/capture-timeout/);assert.equal(cleared,true);
});
test('Paperlab baseline tolerates a visible window before its material evidence arrives',()=>{
 const {naturalBaselineReady}=require('../scripts/qa-paperlab-preview.cjs');
 assert.equal(typeof naturalBaselineReady,'function');
 assert.equal(naturalBaselineReady({preview:{visible:true,evidence:null}}),false);
 assert.equal(naturalBaselineReady(null),false);
 assert.equal(naturalBaselineReady({preview:{visible:true,evidence:{playing:true,paperlab:{materialReady:false}}}}),false);
});
test('legacy motion QA entry runs the bounded Paperlab contract rather than SVG-only acceptance',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/qa-motion-preview.cjs'),'--dry-run'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);const p=JSON.parse(result.stdout);
 assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,120000);
 assert.ok(p.commands['fixture-b'].includes('--preview-qa=fixture-b'));
});
