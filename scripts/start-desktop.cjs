'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function findMatchingRelease(workspace = root) {
 const releases=path.join(workspace,'dist','releases');
 let version; try{version=JSON.parse(fs.readFileSync(path.join(workspace,'package.json'),'utf8')).version;}catch{return null;}
 if(!fs.existsSync(releases))return null;
 for(const name of fs.readdirSync(releases).sort().reverse()){
  const dir=path.join(releases,name,'Summoning-Fu-win32-x64'),exe=path.join(dir,'Summoning-Fu.exe');
  try{
   const manifest=JSON.parse(fs.readFileSync(path.join(dir,'SOURCE-MANIFEST.json'),'utf8'));
   if(manifest.version!==version||!manifest.files||!manifest.files['desktop/main.cjs']||!fs.existsSync(exe))continue;
   const entries=Object.entries(manifest.files);if(!entries.length||entries.length>10000)continue;
   const valid=entries.every(([relative,hash])=>{
    if(typeof relative!=='string'||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return false;
    const absolute=path.resolve(workspace,relative),within=path.relative(workspace,absolute);
    if(!within||within.startsWith('..'+path.sep)||path.isAbsolute(within))return false;
    return fs.statSync(absolute).isFile()&&crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')===hash;
   });
   if(valid)return exe;
  }catch{}
 }
 return null;
}
function launch(args=process.argv.slice(2)){
 const detached=args.includes('--detached'),forwarded=args.filter(a=>a!=='--detached'&&a!=='--development');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const release=!args.includes('--development')?findMatchingRelease():null;
 const executable=release||require('electron'),launchArgs=release?forwarded:[root,...forwarded];
 // This child is the explicitly requested application. SW_HIDE overrides the
 // first native ShowWindow call, so it cannot be used for the reader window.
 const child=spawn(executable,launchArgs,{cwd:root,env,detached,windowsHide:false,stdio:detached?'ignore':'inherit'});
 child.on('error',()=>{process.stderr.write('召唤符启动失败。请检查桌面包是否完整。\n');process.exitCode=1;});
 if(detached)child.unref();else child.on('exit',code=>{process.exitCode=code||0;});
 return child;
}
if(require.main===module)launch();
module.exports={findMatchingRelease,launch};
