'use strict';
// Isolated design viewer/capture runner; it never loads the desktop host.
const path=require('node:path');
const fs=require('node:fs');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'qa','paper-material-study');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'appdata'));
app.setName('Summoning Fu Paper Material Study');
const capture=process.argv.includes('--capture-study');
const observe=process.argv.includes('--observe-study');
const keyframes=process.argv.includes('--keyframes-study');
const software=process.argv.includes('--software-study');
if(software)app.disableHardwareAcceleration();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1280,height:1000,show:false,backgroundColor:'#171917',autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const errors=[];
  win.webContents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(String(details.message).slice(0,400));});
  await win.loadFile(path.join(__dirname,'paper-material-study.html'));
  await win.webContents.executeJavaScript('window.paperMaterialStudy.ready');
  if(capture||observe||keyframes){
    await win.webContents.executeJavaScript('document.querySelectorAll("button,select,input").forEach(element=>{element.disabled=true;});document.querySelector(".stage-note").textContent="正在记录本页动效 · 不接真实应用";');
    win.showInactive();
  }else win.show();
  if(!capture&&!observe&&!keyframes)return;
  const hardLimit=setTimeout(()=>{fs.writeFileSync(path.join(output,'watchdog-failure.json'),JSON.stringify({kind:'study-watchdog-failure',software,at:new Date().toISOString()},null,2));app.exit(2);},22000);
  const bounded=(promise,ms)=>Promise.race([promise,new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('Study readback exceeded '+ms+'ms')),ms))]);
  if(observe){
    const samples=[];
    await win.webContents.executeJavaScript('window.paperMaterialStudy.play()');
    const started=Date.now();
    while(Date.now()-started<13300){await wait(250);samples.push({atMs:Date.now()-started,state:await bounded(win.webContents.executeJavaScript('window.paperMaterialStudy.getState()'),1500)});}
    const burnSamples=samples.filter(sample=>sample.state.phase==='burning');
    const holdSamples=samples.filter(sample=>sample.state.phase==='hold');
    const passed=samples.every(sample=>sample.state.naturalRunId===1)&&burnSamples.length>=7&&burnSamples.at(-1).state.elapsedMs>11700&&burnSamples.every((sample,i)=>i===0||sample.state.renderCount>burnSamples[i-1].state.renderCount)&&holdSamples.length>=15&&holdSamples.every(sample=>sample.state.renderCount===holdSamples[0].state.renderCount)&&samples.at(-1).state.phase==='hidden'&&samples.at(-1).state.paused;
    const report={kind:'visible-natural-study-without-readback',software,passed,errors,samples};
    fs.writeFileSync(path.join(output,'visible-natural-'+(software?'software':'gpu')+'.json'),JSON.stringify(report,null,2));
    clearTimeout(hardLimit);console.log(JSON.stringify({kind:report.kind,software,passed,samples:samples.length,burnSamples:burnSamples.length,last:samples.at(-1)}));app.exit(passed?0:1);return;
  }
  const records=[];
  if(!keyframes)await win.webContents.executeJavaScript('window.paperMaterialStudy.play()');
  const started=Date.now();
  for(const [time,name] of [[180,'01-take'],[850,'01b-arrive'],[1100,'02-unroll'],[1900,'02b-before-flat'],[1950,'03-flat'],[3000,'04-ink'],[4350,'05-hold'],[10600,'06-burn'],[12300,'07-ash'],[12600,'08-hidden']]){
    if(keyframes){await win.webContents.executeJavaScript('window.paperMaterialStudy.seek('+time+')');await wait(80);}
    else await wait(Math.max(0,time-(Date.now()-started)));
    const state=await win.webContents.executeJavaScript('window.paperMaterialStudy.getState()');
    const image=await bounded(win.webContents.capturePage(),3000);
    const file=path.join(output,name+'.png');
    fs.writeFileSync(file,image.toPNG());
    const afterCapture=await win.webContents.executeJavaScript('window.paperMaterialStudy.getState()');
    records.push({captureAtMs:Date.now()-started,file,state,afterCapture});
  }
  clearTimeout(hardLimit);
  fs.writeFileSync(path.join(output,keyframes?'paused-keyframes.json':'natural-playback.json'),JSON.stringify({kind:keyframes?'paused-study-keyframes':'independent-design-study',software,capturedAt:new Date().toISOString(),errors,records},null,2));
  console.log(JSON.stringify({kind:'independent-design-study',output,frames:records.length,errors:errors.length,last:records.at(-1).state}));
  app.quit();
}).catch(error=>{fs.writeFileSync(path.join(output,'latest-run-failure.json'),JSON.stringify({kind:'study-run-failure',error:error.message,software,at:new Date().toISOString()},null,2));console.error('Study viewer failed: '+error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
