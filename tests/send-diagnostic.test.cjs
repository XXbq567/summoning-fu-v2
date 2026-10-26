'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),host=require('../desktop/host-state.cjs'),{REASONS}=require('../adapter/ui-send-observation.cjs');
test('each observer reason has its own fixed message and host gate retains safe exception details',()=>{
 for(const reason of REASONS)if(reason!=='observer-unavailable')assert.notEqual(host.sendDiagnostic(reason),host.sendDiagnostic('untrusted'),reason);
 assert.equal(typeof host.sanitizeObserverDiagnostic,'function');
 const diagnostic={stage:'composer',hresult:-2147024891};assert.deepEqual(host.sanitizeObserverDiagnostic(diagnostic),diagnostic);
 assert.equal(host.sanitizeObserverDiagnostic({...diagnostic,message:'private'}),null);
 const gate=new host.SendAdmissionGate(),raw={schemaVersion:1,kind:'unavailable',observerId:'safe_diag',sequence:1,monotonicMs:1,reason:'window-inactive',diagnostic};const result=gate.accept(raw,1);assert.equal(result.reason,'window-inactive');assert.deepEqual(result.diagnostic,diagnostic);
 assert.match(host.sendDiagnostic('observer-unavailable',diagnostic),/0x80070005/);assert.equal(host.sendDiagnostic('observer-unavailable',{stage:'private',hresult:0}),host.sendDiagnostic('observer-unavailable'));
});

test('paged source rejection codes stay distinct and never become retry candidates',async()=>{
 const reasons=['paged-state-unavailable','paged-schema-mismatch','paged-source-unverified'];const messages=reasons.map(reason=>host.admissionMessage(reason));assert.equal(new Set(messages).size,3);
 for(const reason of reasons){assert.notEqual(host.admissionMessage(reason),host.admissionMessage('verification-failed'));const recorder=new host.AdmissionEvidence();recorder.record('verify-rejected',{reason});assert.equal(recorder.snapshot().reason,reason);let calls=0,waits=0;const result=await host.verifyEntranceUntil({verify:async()=>{calls++;return{verified:false,reason}},deadline:5000,now:()=>0,wait:async()=>{waits++}});assert.equal(result.reason,reason);assert.equal(calls,1);assert.equal(waits,0);}
});
