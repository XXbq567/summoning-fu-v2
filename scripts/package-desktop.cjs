'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const root = path.resolve(__dirname, '..');
const included = ["desktop","renderer","adapter","config/task-envelope.schema.json","config/display-aliases.example.json","config/provider-catalog.json","assets/fonts","assets/providers","vendor/licenses","licenses/third-party","package.json","package-lock.json","THIRD-PARTY-NOTICES.md","README.md","INSTALL.md","AGENTS.md","CLAUDE.md"];
async function packagingPlan() {
 const metadata = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 const executable = require('electron'), localDist = path.dirname(executable);
 if(path.relative(path.join(root,'node_modules','electron','dist'),localDist)!=='') throw Error('locked-project-electron-required');
 await fs.access(executable);
 const stamp = new Date().toISOString().replace(/[:.]/g,'-');
 return {version:metadata.version,localDist,sourceRuntime:executable,staging:path.join(root,'dist','staging-'+crypto.randomUUID()),destination:path.join(root,'dist','releases',stamp,'Summoning-Fu-win32-x64')};
}
async function build() {
 await require('./build-paperlab.cjs').build(); assertPaperlabArtifacts(root);
 const plan = await packagingPlan(); await fs.mkdir(plan.staging,{recursive:true});
 const manifest = {};
 for(const item of included){ const source=path.join(root,item),destination=path.join(plan.staging,item);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.cp(source,destination,{recursive:true,errorOnExist:true,force:false}); }
 const docs=path.join(plan.staging,'docs');await fs.mkdir(docs,{recursive:true});
 for(const name of ["PUBLIC-VERIFICATION.md","ARCHITECTURE.md","SETUP.md","DECISIONS.md","KNOWN_ISSUES.md","TESTING.md","HANDOVER.md"])await fs.copyFile(path.join(root,'docs',name),path.join(docs,name));
 async function index(dir,relative=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const rel=path.posix.join(relative,entry.name),absolute=path.join(dir,entry.name);if(entry.isDirectory())await index(absolute,rel);else if(entry.isFile())manifest[rel]=crypto.createHash('sha256').update(await fs.readFile(absolute)).digest('hex');}}
 await index(plan.staging);
 await fs.cp(plan.localDist,plan.destination,{recursive:true,errorOnExist:true,force:false});
 await fs.rename(path.join(plan.destination,'electron.exe'),path.join(plan.destination,'Summoning-Fu.exe'));
 const {createPackage}=await import('@electron/asar');await createPackage(plan.staging,path.join(plan.destination,'resources','app.asar'));
 await fs.mkdir(path.join(plan.destination,'resources','send-observer'),{recursive:true});await fs.copyFile(path.join(root,'desktop','windows-send-observer.ps1'),path.join(plan.destination,'resources','send-observer','windows-send-observer.ps1'));
 await fs.writeFile(path.join(plan.destination,'PREVIEW.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0Summoning-Fu.exe" --paperlab-preview-only --user-data-dir="%TEMP%\\summoning-fu-preview-local-'+crypto.randomBytes(8).toString('hex')+'" --motion-preview\r\n');
 const normalLauncher='@echo off\r\ncd /d "%~dp0"\r\nstart /wait "" "%~dp0Summoning-Fu.exe" --quit\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "%~dp0Summoning-Fu.exe" --read\r\n';
 await fs.writeFile(path.join(plan.destination,'NORMAL.cmd'),normalLauncher);
 await fs.writeFile(path.join(plan.destination,'START.cmd'),normalLauncher);
 await fs.writeFile(path.join(plan.destination,'SOURCE-MANIFEST.json'),JSON.stringify({version:plan.version,runtime:JSON.parse(await fs.readFile(path.join(root,'node_modules','electron','package.json'),'utf8')).version,sourceRuntime:'project-local-electron-dist',networkDownloads:false,files:manifest},null,2));
 await fs.writeFile(path.join(plan.destination,'README.txt'),'召唤符 '+plan.version+'\r\n双击 PREVIEW.cmd 查看完整本地示例；双击 NORMAL.cmd 启动新版伴随应用（先让同一用户目录中的旧召唤符正常退出）。\r\n临时印记由本程序绘制，不控制官方 Pet；未知公司显示通用印。\r\n本便携目录不修改插件安装、Hook 或信任配置；正常入口复用召唤符现有用户目录。需另行安装并信任同版本插件，真实 UserPromptSubmit 才会冷启动其内置新版运行时；旧插件不会随便携包自动升级。退出后删除本目录即可移除便携程序。\r\n');
 process.stdout.write(JSON.stringify({output:[plan.destination],staging:plan.staging,version:plan.version,networkDownloads:false,sourceContents:'allowlisted source; fixed offline provider assets; no session data'},null,2)+'\n');return plan.destination;
}
if(require.main===module)build().catch(error=>{process.stderr.write('Desktop packaging failed: '+error.message+'\n');process.exitCode=1});
module.exports={build,packagingPlan,included};
