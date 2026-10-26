'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
test('desktop launch selects only a current source-identical portable build and otherwise uses locked development runtime',()=>{
 const launcher=require('../scripts/start-desktop.cjs');assert.equal(typeof launcher.findMatchingRelease,'function');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'summoning-fu-launch-'));
 try{fs.mkdirSync(path.join(base,'desktop'),{recursive:true});fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({version:'0.6.0'}));fs.writeFileSync(path.join(base,'desktop','main.cjs'),'current-main');
 const release=path.join(base,'dist','releases','2026-10-24','Summoning-Fu-win32-x64');fs.mkdirSync(release,{recursive:true});fs.writeFileSync(path.join(release,'Summoning-Fu.exe'),'fixture-no-execution');
 const manifest={version:'0.5.0',files:{'desktop/main.cjs':crypto.createHash('sha256').update('current-main').digest('hex')}};const save=()=>fs.writeFileSync(path.join(release,'SOURCE-MANIFEST.json'),JSON.stringify(manifest));save();assert.equal(launcher.findMatchingRelease(base),null);
 manifest.version='0.6.0';save();assert.equal(launcher.findMatchingRelease(base),path.join(release,'Summoning-Fu.exe'));
 fs.writeFileSync(path.join(base,'desktop','main.cjs'),'updated-main');assert.equal(launcher.findMatchingRelease(base),null);
 manifest.files={'../../outside':'a'.repeat(64)};save();assert.equal(launcher.findMatchingRelease(base),null);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
