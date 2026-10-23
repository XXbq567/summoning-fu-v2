'use strict';
// Generates qualification assets only. It never installs/selects a Codex pet.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { cwd: project, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status === null ? 1 : result.status);
} else {
  const { app, BrowserWindow, nativeImage } = require('electron');
  const used = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
  app.whenReady().then(async () => {
    const slug = 'fu-probe-20261021-' + crypto.randomBytes(3).toString('hex');
    const output = path.join(project, 'native-probe', slug);
    fs.mkdirSync(output, { recursive: true });
    const win = new BrowserWindow({ show: false, width: 380, height: 780, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:"></head><body style="margin:0"><div id="paper"></div></body></html>'));
    for (const file of ['ritual-core.js', 'font-coverage.js', 'burn-view.js']) await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'renderer', file), 'utf8'));
    const fontURL = 'data:font/ttf;base64,' + fs.readFileSync(path.join(project, 'assets/fonts/MaShanZheng-Regular.ttf')).toString('base64');
    const coverage = JSON.parse(fs.readFileSync(path.join(project, 'assets/fonts/coverage.json'), 'utf8'));
    const inputs = { fontURL, coverage, used };
    const result = await win.webContents.executeJavaScript(`(async function ({fontURL,coverage,used}) {
      const style=document.createElement('style'); style.textContent="@font-face{font-family:FuBrush;src:url('"+fontURL+"')}"; document.head.append(style);
      await document.fonts.load('20px FuBrush'); await document.fonts.ready;
      const metadata={model:'MODEL-A / 示例',company:'示例公司',relay:'本地探测入口',harness:'Codex · 探测',environment:'Windows · 样本',task:'任务A：原生载体资格实验',reasoning:'未取得',sources:{}};
      const view=new RitualBurn.BurnView(document.getElementById('paper'),metadata,{fontCoverage:coverage});
      const frame={state:'working',writing:0,burn:0,variant:'bottom-up',seed:1,opacity:1,activeMs:0};
      const visible=()=>view.writingSteps.flatMap(g=>g.steps).filter(s=>s.element.style.visibility==='visible').length;
      view.render(frame); const blank=visible();
      view.render({...frame,writing:.5}); const halfway=visible();
      view.render({...frame,writing:1}); const complete=visible();
      const paths=view.writingSteps.flatMap(g=>g.steps).filter(s=>s.trace);
      const rendererChecks={blankVisibleInk:blank,halfwayVisibleSteps:halfway,completeVisibleSteps:complete,measuredPaths:paths.length,allPathLengthsPositive:paths.every(s=>s.length>0),fontReport:view.fontReport};
      if(blank!==0 || halfway<=0 || halfway>=complete || !rendererChecks.allPathLengthsPositive) throw new Error('New renderer writing integration check failed');
      const samples=[];
      for(const letter of ['A','B']) {
        const svg=RitualCore.buildTalismanSVG({...metadata,model:'MODEL-'+letter+' / 示例',task:'任务'+letter+'：原生载体资格实验'},{idPrefix:'probe'+letter,fontDataURL:fontURL});
        const image=new Image(); image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); await image.decode();
        const master=document.createElement('canvas'); master.width=360; master.height=760; master.getContext('2d').drawImage(image,0,0);
        const atlas=document.createElement('canvas'); atlas.width=1536; atlas.height=2288; const ctx=atlas.getContext('2d');
        const scale=198/760, width=360*scale;
        for(let row=0;row<11;row++) for(let col=0;col<used[row];col++) ctx.drawImage(master,col*192+(192-width)/2,row*208+5,width,198);
        const pixels=ctx.getImageData(0,0,1536,2288).data;
        let opaque=0,transparent=0,unusedNonTransparent=0;
        for(let y=0;y<2288;y++) for(let x=0;x<1536;x++) {
          const alpha=pixels[(y*1536+x)*4+3]; if(alpha) opaque++; else transparent++;
          if(Math.floor(x/192)>=used[Math.floor(y/208)] && alpha) unusedNonTransparent++;
        }
        samples.push({letter,atlas:atlas.toDataURL('image/png').split(',')[1],master:master.toDataURL('image/png').split(',')[1],metrics:{width:1536,height:2288,nonTransparentPixels:opaque,transparentPixels:transparent,unusedNonTransparent}});
      }
      return {rendererChecks,samples};
    })(${JSON.stringify(inputs)})`);
    const manifest = { id: slug, displayName: '召唤符 · 原生资格探测 A', description: '虚构任务 A 的载体资格实验；不代表动态任务接入或30秒节拍通过。', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.png' };
    fs.writeFileSync(path.join(output, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n');
    const samples = [];
    for (const sample of result.samples) {
      const filename = sample.letter === 'A' ? 'spritesheet.png' : 'spritesheet-B.png';
      fs.writeFileSync(path.join(output, filename), Buffer.from(sample.atlas, 'base64'));
      fs.writeFileSync(path.join(output, `sample-${sample.letter}.png`), Buffer.from(sample.master, 'base64'));
      const decoded = nativeImage.createFromPath(path.join(output, filename));
      const size = decoded.getSize();
      if (size.width !== 1536 || size.height !== 2288 || sample.metrics.unusedNonTransparent !== 0 || sample.metrics.transparentPixels === 0 || sample.metrics.nonTransparentPixels === 0) throw new Error('Atlas dimension/alpha validation failed');
      samples.push({ file: filename, ...sample.metrics, decodedSize: size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, filename))).digest('hex') });
    }
    const evidence = { generatedAt: new Date().toISOString(), slug, electron: process.versions.electron, chromium: process.versions.chrome, scope: 'Local qualification asset and new renderer DOM checks; not native Codex playback', nativeCapabilities: { A: 'NOT_TESTED', B: 'NOT_TESTED', C: 'NOT_TESTED', D: 'NOT_TESTED', E: 'NOT_TESTED' }, installed: false, previousSelection: 'NOT_OBSERVED', standardRowUsedCells: used.slice(0, 9), lookRows: 'All cells occupied with same flat paper pose; directional character animation not implemented for this probe', rendererChecks: result.rendererChecks, samples };
    fs.writeFileSync(path.join(output, 'asset-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ output, rendererChecks: result.rendererChecks, samples }, null, 2));
    win.destroy(); app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
