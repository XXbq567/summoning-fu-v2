'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('delivery dry-run launches nothing and separates natural playback from partial-intake and hidden pixels',()=>{
 const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/qa-delivery-preview.cjs'),'--dry-run'],{encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);
 assert.equal(p.classification,'ISOLATED_DELIVERY_PREVIEW_NOT_REAL_PET_TARGET');
 assert.equal(p.captureDeadlineMs,3000);assert.equal(p.naturalReadback,false);
 assert.ok(p.commands['intake-tip']);assert.ok(p.commands['intake-tail']);
 for(const a of Object.values(p.commands))assert.ok(a.includes('--user-data-dir='+p.profile));
});
