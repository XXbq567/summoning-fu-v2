'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('reader separates missing Work hook handoff from an inactive Chat-only observer',()=>{
 const {readerStatus}=require('../desktop/reader.js');assert.equal(typeof readerStatus,'function');
 const value={source:'unknown',observerStatus:'window-inactive',observerDiagnostic:{stage:'mode',hresult:-2147024891},hookAdmission:{counters:{received:0,applied:0}},phase:'hidden'};const text=readerStatus(value);
 assert.match(text.hook,/尚未收到.*Hook/);assert.match(text.observer,/Chat/);assert.match(text.observer,/前台/);assert.match(text.observer,/0x80070005/);assert.doesNotMatch(text.hook,/未启用|未信任|初始化失败/);assert.match(text.motion,/2 秒/);assert.match(text.motion,/临时印记/);assert.doesNotMatch(text.motion,/5 秒|燃尽/);
 const actual=readerStatus({...value,presentationMode:'independent-hook',hookAdmission:{counters:{received:2,applied:1}},titleSource:'codex-paginated-name'});assert.match(actual.hook,/已播放|已核验/);assert.match(actual.title,/Codex/);assert.doesNotMatch(actual.title,/待定/);
 const safe=readerStatus({...value,observerStatus:'private-message',observerDiagnostic:{stage:'private-stage',hresult:0}});assert.doesNotMatch(safe.observer,/private/);
});

test('the actual reader page binds separate diagnostic rows and the current title source',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const html=fs.readFileSync(path.join(__dirname,'../desktop/reader.html'),'utf8');
 const element=()=>({textContent:'',style:{},replaceChildren(){},append(){},addEventListener(){}});const elements=Object.fromEntries([...html.matchAll(/id="([a-z-]+)"/g)].map(m=>[m[1],element()]));
 let update;const document={querySelector:s=>elements[s.slice(1)]||null,querySelectorAll:()=>[],createElement:element,importNode:()=>({})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/reader.js'),'utf8'),{document,DOMParser:class{parseFromString(){return{documentElement:{}}}},RitualCore:{normalizeMetadata:()=>({task:'本地测试',fullTask:'本地测试'}),buildTalismanSVG:()=>'<svg/>'},RitualFontCoverage:{report:()=>({checked:true,missingFromBrush:[]})},fuHost:{subscribe(fn){update=fn},initial:async()=>null}});
 update({phase:'hold',presentationMode:'independent-hook',source:'codex-user-prompt-submit',sessionId:'synthetic',runId:'synthetic',metadata:{},observerStatus:'window-inactive',hookAdmission:{counters:{received:0,applied:0}},titleSource:'codex-paginated-name',adapterLabel:'本地测试'});
 assert.match(elements['motion-status'].textContent,/2 秒.*临时印记/);assert.match(elements['hook-status'].textContent,/尚未收到 Hook/);assert.match(elements['observer-status'].textContent,/前台/);assert.match(elements.adapter.textContent,/Codex 当次轮次名称/);
});
