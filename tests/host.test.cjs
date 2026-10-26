'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HostClock, clampBounds, controlBounds, entranceBounds, EntranceScheduler, startupIntent, sanitizeRenderEvidence } = require('../desktop/host-state.cjs');
const start = { type: 'start', runId: 'r1', sessionId: 's1', metadata: { task: '任务一' }, source: 'codex-rollout' };
test('only working accrues, waiting and resumed positions remain exact', () => {
  const h = new HostClock({ staleMs: 90000 });
  h.accept([start], 0); h.accept([{ ...start, type: 'waiting' }], 1000);
  assert.equal(h.snapshot(30000).activeMs, 1000);
  h.accept([{ ...start, type: 'working' }], 30000);
  assert.equal(h.snapshot(31000).activeMs, 2000);
});
test('sleep and stale source stop accumulation until a fresh event', () => {
  const h = new HostClock({ staleMs: 10000 }); h.accept([start], 0);
  h.suspend(2000); assert.equal(h.snapshot(80000).activeMs, 2000);
  assert.equal(h.snapshot(80000).state, 'unknown');
  h.accept([{ ...start, type: 'working' }], 81000);
  assert.equal(h.snapshot(83000).activeMs, 4000);
  assert.equal(h.snapshot(110000).state, 'unknown');
  assert.equal(h.snapshot(110000).activeMs, 12000);
});
test('terminal completion never invents a new cycle or accepts late updates', () => {
  const h = new HostClock(); h.accept([start], 0);
  h.accept([{ ...start, type: 'completed' }], 500);
  h.accept([{ ...start, type: 'working' }], 1000);
  assert.equal(h.snapshot(120000).activeMs, 500);
  assert.equal(h.snapshot(120000).state, 'completed');
});
test('removed monitor coordinates clamp inside current display work area', () => {
  assert.deepEqual(clampBounds({ x: 4000, y: -500, width: 300, height: 600 }, { x: -1920, y: 0, width: 1920, height: 1040 }), { x: -300, y: 0, width: 300, height: 600 });
  assert.deepEqual(clampBounds({ x: 0, y: 0, width: 300, height: 600 }, { x: 0, y: 0, width: 200, height: 400 }), { x: 0, y: 0, width: 200, height: 400 });
});
test('restoring native decorated bounds never compounds control dimensions', () => {
  const area = { x: 0, y: 0, width: 2048, height: 1152 };
  let saved = { x: 1774, y: 1088, width: 256, height: 48 };
  for (let n = 0; n < 5; n++) {
    const restored = controlBounds(saved, area);
    assert.equal(restored.width, 250); assert.equal(restored.height, 44);
    saved = { ...restored, width: restored.width + 6, height: restored.height + 4 };
  }
});
test('first launch read, hidden and quit intentions survive an existing binding', () => {
  assert.deepEqual(startupIntent(['--read'], true), { quit: false, hidden: false, read: true });
  assert.deepEqual(startupIntent(['--hide'], false), { quit: false, hidden: true, read: false });
  assert.deepEqual(startupIntent(['--quit', '--read'], true), { quit: true, hidden: true, read: false });
});
test('renderer evidence only retains bounded numeric visual state, never task text', () => {
  const e = sanitizeRenderEvidence({ runId: 'r1', reducedMotion: false, effectiveReducedMotion: false, systemReducedMotion: true, documentHidden: false, rafCount: 0, renderCount: 3, frame: { activeMs: 3000, phase: 'hold', burn: 0, writing: 1, state: 'working', paperOpacity: 1, opacity: 1, visibleGlyphs: 40, totalGlyphs: 40, holdStartMs: 3000, leaveAtMs: 13000, hideAtMs: 14000, task: 'must not persist' }, prompt: 'must not persist' });
  assert.equal(e.reducedMotion, false); assert.equal(e.prompt, undefined); assert.equal(e.frame.task, undefined);
  assert.equal(sanitizeRenderEvidence({ ...e, frame: { ...e.frame, burn: Infinity } }), null);
  assert.equal(sanitizeRenderEvidence({ ...e, rafCount: -1 }), null);
});

test('normal entrance retains full motion when system preference is enabled or changes mid-run', () => {
  const { entranceMotionPolicy } = require('../desktop/host-state.cjs');
  const { EntranceTimeline, timings } = require('../renderer/entrance-timeline.js');
  assert.equal(typeof entranceMotionPolicy, 'function');
  const timeline = new EntranceTimeline(); timeline.trigger('normal-hook', 0, {});
  for (const [time, system, phase] of [[(timings.pointEndMs + timings.travelEndMs) / 2, true, 'travel'], [(timings.travelEndMs + timings.paperEndMs) / 2, true, 'unfold'], [(timings.paperEndMs + timings.writingEndMs) / 2, false, 'writing'], [timings.holdStartMs + timings.holdMs / 2, true, 'hold'], [timings.leaveAtMs, true, 'hidden']]) {
    const policy = entranceMotionPolicy(system);
    assert.equal(policy.systemReducedMotion, system); assert.equal(policy.effectiveReducedMotion, false);
    const frame = timeline.snapshot(time, policy.effectiveReducedMotion);
    assert.equal(frame.phase, phase); assert.equal(frame.hideAtMs, timings.leaveAtMs); assert.equal(frame.reducedMotion, false);
  }
  assert.equal(timeline.snapshot(timings.totalMs, entranceMotionPolicy(true).effectiveReducedMotion).visible, false);
});

test('normal renderer evidence distinguishes system preference and actual policy and bounds DOM values', () => {
  const input = { runId: 'normal-hook', reducedMotion: false, effectiveReducedMotion: false, systemReducedMotion: true, documentHidden: false, rafCount: 30, renderCount: 35,
    frame: { activeMs: 1700, phase: 'writing', burn: 0, writing: 0.5, state: 'unknown', paperOpacity: 1, opacity: 1, visibleGlyphs: 20, totalGlyphs: 40, holdStartMs: 3000, leaveAtMs: 13000, hideAtMs: 14000, task: 'private' } };
  const result = sanitizeRenderEvidence(input);
  assert.equal(result.systemReducedMotion, true); assert.equal(result.effectiveReducedMotion, false);
  assert.equal(result.frame.visibleGlyphs, 20); assert.equal(result.frame.task, undefined);
  assert.equal(sanitizeRenderEvidence({ ...input, frame: { ...input.frame, paperOpacity: Infinity } }), null);
  assert.equal(sanitizeRenderEvidence({ ...input, frame: { ...input.frame, visibleGlyphs: 41 } }), null);
});
test('latest explicit send replaces pending entrance and stale callbacks cannot consume it', () => {
  const scheduler = new EntranceScheduler();
  const first = scheduler.queue({ eventId: 'e1', sessionId: 's1', turnId: 't1', createdAt: '2026-10-21T00:00:00Z' }, 0);
  const second = scheduler.queue({ eventId: 'e2', sessionId: 's1', turnId: 't2', createdAt: '2026-10-21T00:00:01Z' }, 1000);
  assert.equal(scheduler.take(first, 1000), null);
  assert.equal(scheduler.queue({ eventId: 'e2', sessionId: 's1', turnId: 't2', createdAt: '2026-10-21T00:00:01Z' }, 2000), null);
  assert.equal(scheduler.take(second, 1000).turnId, 't2');
  assert.equal(scheduler.take(second, 1001), null);
  assert.equal(scheduler.isCurrent(first), false);
});
test('verified source context wait is limited to 750ms and never imposes a fixed takeoff delay', async () => {
  const { verifyEntranceUntil } = require('../desktop/host-state.cjs');
  let now = 0, calls = 0;
  const result = await verifyEntranceUntil({ verify: async () => { calls++; return { verified: true, contextMissing: true }; }, now: () => now, wait: async ms => { now += ms; }, deadline: 5000, waitForContext: true });
  assert.equal(result.verified, true); assert.equal(result.contextMissing, true);
  assert.equal(now, 750); assert.equal(calls, 4);
});
test('entrance size grows thirty percent, retains aspect and clamps on small displays', () => {
  const large = entranceBounds(null, { x: 0, y: 0, width: 2048, height: 1152 });
  assert.equal(large.height, 676); assert.equal(large.width, 320);
  const small = entranceBounds({ x: 9999, y: -9999 }, { x: -400, y: 0, width: 400, height: 500 });
  assert.ok(small.x >= -400 && small.x + small.width <= 0);
  assert.ok(small.y >= 0 && small.y + small.height <= 500);
  assert.ok(Math.abs(small.width / small.height - 360 / 760) < 0.003);
});
test('cross-session delayed submission cannot replace a newer proven source start', () => {
  const scheduler = new EntranceScheduler();
  assert.equal(scheduler.acceptSource('new', 2000), true);
  assert.equal(scheduler.acceptSource('old', 1000), false);
  assert.equal(scheduler.acceptSource('ambiguous', 2000), false);
  assert.equal(scheduler.acceptSource('new', 2000), true);
});
test('recorded window bounds reject invalid/offscreen values and use maximized work area', () => {
  const { validateRecordedBounds } = require('../desktop/window-target.cjs');
  const area = { x: 0, y: 0, width: 2048, height: 1152 };
  assert.equal(validateRecordedBounds({ x: NaN, y: 0, width: 600, height: 500 }, [area]), null);
  assert.equal(validateRecordedBounds({ x: 9000, y: 9000, width: 600, height: 500 }, [area]), null);
  const target = validateRecordedBounds({ x: 473, y: 293, width: 1364, height: 741, isMaximized: true }, [area]);
  assert.deepEqual(target.center, { x: 1024, y: 576 });
  assert.equal(target.source, 'codex-last-recorded-window');
});
test('source verification retries delayed root turn within its bounded window without accepting it early', async () => {
  const { verifyEntranceUntil } = require('../desktop/host-state.cjs');
  let now = 0, calls = 0;
  const result = await verifyEntranceUntil({ verify: async () => ++calls < 3 ? { verified: false, reason: 'latest-turn-mismatch' } : { verified: true, startedAtMs: 123 }, now: () => now, wait: async ms => { now += ms; }, deadline: 5000 });
  assert.equal(result.verified, true); assert.equal(calls, 3); assert.equal(now, 500);
  const scheduler = new EntranceScheduler(); scheduler.acceptSource('new', 200); const token = scheduler.queue({ eventId: 'new' }, 0);
  now = 0; calls = 0;
  const stale = await verifyEntranceUntil({ verify: async () => { calls++; return { verified: false, reason: 'source-not-ready' }; }, now: () => now, wait: async ms => { now += ms; }, deadline: 5000 });
  assert.equal(stale.verified, false); assert.equal(now, 5000); assert.equal(calls, 21);
  assert.equal(scheduler.pending.token, token); assert.equal(scheduler.sourceWatermark, 200);
});
test('verification cancellation and permanent invalid source do not retry', async () => {
  const { verifyEntranceUntil } = require('../desktop/host-state.cjs');
  let active = true, calls = 0;
  const aborted = await verifyEntranceUntil({ verify: async () => { calls++; return { verified: false, reason: 'source-changed' }; }, now: () => 0, wait: async () => { active = false; }, isActive: () => active, deadline: 5000 });
  assert.equal(aborted.reason, 'cancelled'); assert.equal(calls, 1);
  const invalid = await verifyEntranceUntil({ verify: async () => ({ verified: false, reason: 'invalid-source' }), now: () => 0, wait: async () => { throw new Error('must not wait'); }, deadline: 5000 });
  assert.equal(invalid.reason, 'invalid-source');
});
test('admission evidence rejects arbitrary strings and retains only bounded diagnostic fields', () => {
  const { AdmissionEvidence, admissionMessage } = require('../desktop/host-state.cjs');
  const evidence = new AdmissionEvidence();
  evidence.record('received', { at: 0, elapsedMs: 0, sessionId: 's1', turnId: 't1', title: 'private', path: 'C:/secret', reason: 'C:/secret: task text' });
  assert.equal(evidence.snapshot().reason, 'verification-failed');
  assert.equal(evidence.snapshot().title, undefined); assert.equal(evidence.snapshot().path, undefined);
  assert.equal(evidence.record('private text', {}), false);
  evidence.record('verify-rejected', { at: 1000, elapsedMs: Infinity, sessionId: 'not an id / credential', turnId: 'x'.repeat(200), reason: 'invalid-source' });
  const value = evidence.snapshot();
  assert.equal(value.sessionId, null); assert.equal(value.turnId, null); assert.equal(value.elapsedMs, null);
  assert.equal(value.reason, 'invalid-source'); assert.deepEqual(value.counters, { received: 1, 'read-rejected': 0, 'verify-rejected': 1, queued: 0, applied: 0 });
  value.counters.received = 999; assert.equal(evidence.snapshot().counters.received, 1);
  assert.equal(admissionMessage('C:/secret: private task'), admissionMessage('verification-failed'));
});
test('entrance path diagnostics retain only bounded shapes, including namespace and quoting distinctions', () => {
  const { entrancePathShape } = require('../desktop/host-state.cjs');
  const hash = 'a'.repeat(64), file = `C:\\private-task\\entrance-events\\${hash}.json`;
  const shape = entrancePathShape(file);
  assert.equal(shape.baseHashRegex, true); assert.equal(shape.parentNameExpected, true); assert.equal(shape.localDrive, true);
  assert.equal(entrancePathShape('\\\\?\\' + file).hasNamespace, true);
  assert.equal(entrancePathShape('"' + file + '"').startsQuotes, true);
  assert.equal(entrancePathShape(undefined).type, 'undefined');
  assert.equal(entrancePathShape('x'.repeat(100000)).length, 65536);
  assert.equal(JSON.stringify(shape).includes('private-task'), false);
  assert.ok(Object.values(shape).every(value => typeof value === 'boolean' || typeof value === 'number' || value === 'string'));
});
test('argv diagnostics expose only known flags and indexed shapes, never unknown argument text', () => {
  const { entranceArgvShapes } = require('../desktop/host-state.cjs');
  const file = 'C:\\private\\entrance-events\\' + 'a'.repeat(64) + '.json';
  const shapes = entranceArgvShapes(['exe', '--entrance-file', '--allow-file-access-from-files', file, '--private-secret=secret', '--entrance-file=' + file]);
  assert.equal(shapes[2].flag, 'allow-file-access-from-files'); assert.equal(shapes[3].shape.baseHashRegex, true);
  assert.equal(shapes[4].flag, 'unknown-option'); assert.equal(shapes[5].attachedValue.baseHashRegex, true);
  assert.equal(JSON.stringify(shapes).includes('private'), false); assert.equal(JSON.stringify(shapes).includes('secret'), false);
  assert.equal(entranceArgvShapes(Array(100).fill('x')).length, 32);
});
test('entrance arguments survive switch reordering only through explicit attached value and reject ambiguity', () => {
  const { parseEntranceArgument } = require('../desktop/host-state.cjs');
  const file = 'C:\\fixture\\entrance-events\\' + 'a'.repeat(64) + '.json';
  assert.deepEqual(parseEntranceArgument(['app', '--entrance-file=' + file, '--allow-file-access-from-files']), { value: file, error: null });
  assert.deepEqual(parseEntranceArgument(['app', '--entrance-file', file]), { value: file, error: null });
  assert.deepEqual(parseEntranceArgument(['app', '--entrance-file', '--allow-file-access-from-files', file]), { value: null, error: 'event-arguments-invalid' });
  assert.equal(parseEntranceArgument(['--entrance-file=' + file, '--entrance-file', file]).error, 'event-arguments-invalid');
  assert.equal(parseEntranceArgument(['--entrance-file=']).error, 'event-arguments-invalid');
  assert.equal(parseEntranceArgument(['--entrance-file']).error, 'event-arguments-invalid');
  assert.deepEqual(parseEntranceArgument(['app', file]), { value: null, error: null });
});
test('missing turn context receives only the existing bounded final verification window', async () => {
  let now = 5000, calls = 0;
  const { verifyEntranceUntil } = require('../desktop/host-state.cjs');
  const value = await verifyEntranceUntil({ waitForContext: true, deadline: 5750, now: () => now, wait: async ms => { now += ms; }, verify: async () => ++calls < 3 ? { verified: true, contextMissing: true, reasoning: { value: null, source: 'unknown' } } : { verified: true, contextMissing: false, reasoning: { value: 'xhigh', source: 'reported' } } });
  assert.equal(value.reasoning.value, 'xhigh'); assert.equal(now, 5500);
  now = 5000;
  const unknown = await verifyEntranceUntil({ waitForContext: true, deadline: 5750, now: () => now, wait: async ms => { now += ms; }, verify: async () => ({ verified: true, contextMissing: true, reasoning: { value: null, source: 'unknown' } }) });
  assert.equal(now, 5750); assert.equal(unknown.verified, true); assert.equal(unknown.reasoning.source, 'unknown');
});
test('reasoning evidence keeps only supported reported enum with a safe source offset', () => {
  const { sanitizeReasoningEvidence } = require('../desktop/host-state.cjs');
  assert.deepEqual(sanitizeReasoningEvidence({ value: 'xhigh', source: 'reported', contextOffset: 50000, prompt: 'secret' }), { value: 'xhigh', source: 'reported', contextOffset: 50000 });
  for (const value of [{ value: 'secret/path', source: 'reported', contextOffset: 4 }, { value: 'high', source: 'configured', contextOffset: 4 }, { value: 'high', source: 'reported', contextOffset: Infinity }]) assert.deepEqual(sanitizeReasoningEvidence(value), { value: null, source: 'unknown', contextOffset: null });
});

test('Paperlab telemetry retains only bounded draw and damage evidence, never arbitrary errors or task data', () => {
  const { sanitizePaperlabEvidence } = require('../desktop/host-state.cjs');
  const input = { engine: 'paperlab', libraryVersion: '0.8.1', effectiveReducedMotion: false, materialReady: true, canvasVisible: true, actualDrawCount: 6, phase: 'burning', writing: 1, burn: .3, presenceRemaining: .7, damageVersion: 8, metadataHash: '0123abcd', textureHash: '4567abcd', textureRasterizations: 2, error: null, prompt: 'private' };
  const result = sanitizePaperlabEvidence(input);
  assert.equal(result.engine, 'paperlab'); assert.equal(result.prompt, undefined);
  assert.equal(result.effectiveReducedMotion, false);
  assert.equal(sanitizePaperlabEvidence({ ...input, effectiveReducedMotion: true }), null);
  assert.equal(sanitizePaperlabEvidence({ ...input, error: 'C:\\private\\provider exception' }), null);
  assert.equal(sanitizePaperlabEvidence({ ...input, actualDrawCount: -1 }), null);
  assert.equal(sanitizePaperlabEvidence({ ...input, presenceRemaining: 1.1 }), null);
  assert.equal(sanitizePaperlabEvidence({ ...input, metadataHash: 'private text' }), null);
});
test('Paperlab fire telemetry keeps only bounded emitted flame evidence and a fixed color pipeline', () => {
  const { sanitizePaperlabEvidence } = require('../desktop/host-state.cjs');
  const input = { engine: 'paperlab', libraryVersion: '0.8.1', materialReady: true, canvasVisible: true, actualDrawCount: 6, phase: 'burning', writing: 1, burn: .3, presenceRemaining: .7, damageVersion: 8, metadataHash: '0123abcd', textureHash: '4567abcd', textureRasterizations: 2, error: null,
    flameCount: 5, maxFlameHeightDIP: 20, colorPipeline: 'srgb-no-tone-mapping' };
  const result = sanitizePaperlabEvidence(input);
  assert.equal(result.flameCount, 5); assert.equal(result.maxFlameHeightDIP, 20); assert.equal(result.colorPipeline, 'srgb-no-tone-mapping');
  for (const change of [{ flameCount: 17 }, { flameCount: 1.5 }, { maxFlameHeightDIP: 51 }, { maxFlameHeightDIP: Infinity }, { colorPipeline: 'private' }]) assert.equal(sanitizePaperlabEvidence({ ...input, ...change }), null);
});
test('independent Pet outset preserves the paper anchor and leaves the shared flame envelope inside its native window', () => {
  const { independentPetLayout } = require('../desktop/host-state.cjs');
  const { burnOutsetDIP } = require('../renderer/send-geometry.js');
  assert.equal(burnOutsetDIP, 56);
  const saved = { x: 300, y: 200 }, area = { x: 0, y: 0, width: 1600, height: 1100 };
  const layout = independentPetLayout(saved, area), target = layout.geometry.targetRect;
  assert.equal(layout.bounds.x + target.x, saved.x); assert.equal(layout.bounds.y + target.y, saved.y);
  assert.equal(target.width, 320); assert.equal(target.height, 676);
  assert.ok(target.x >= burnOutsetDIP && target.y >= burnOutsetDIP);
  assert.ok(layout.bounds.width - target.x - target.width >= burnOutsetDIP);
  assert.ok(layout.bounds.height - target.y - target.height >= burnOutsetDIP);
  assert.deepEqual(saved, { x: 300, y: 200 });
  for (const workArea of [{ x: -1200, y: 0, width: 1200, height: 800 }, { x: 0, y: 0, width: 600, height: 600 }]) {
    const one = independentPetLayout({ x: workArea.x, y: workArea.y }, workArea), t = one.geometry.targetRect;
    assert.ok(one.bounds.x >= workArea.x && one.bounds.y >= workArea.y);
    assert.ok(one.bounds.x + one.bounds.width <= workArea.x + workArea.width);
    assert.ok(one.bounds.y + one.bounds.height <= workArea.y + workArea.height);
    assert.ok(t.x >= burnOutsetDIP && t.y >= burnOutsetDIP);
    assert.ok(one.bounds.width - t.x - t.width >= burnOutsetDIP - 1e-8);
    assert.ok(one.bounds.height - t.y - t.height >= burnOutsetDIP - 1e-8);
    assert.ok(Math.abs(t.width / t.height - 360 / 760) < .001);
    const next = independentPetLayout({ x: one.bounds.x + t.x, y: one.bounds.y + t.y }, workArea);
    assert.deepEqual(next, one, 'persisting paper position must not accumulate an outer-window offset');
  }
});
