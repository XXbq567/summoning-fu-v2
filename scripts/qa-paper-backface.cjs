'use strict';
// Bounded, isolated own-window material inspection. No official app, Pet or session access.
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const POSES = ['front', 'back', 'side', 'half', 'rolled'];
const STRENGTHS = [0, .1, .2], BACKGROUNDS = ['dark', 'light'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = reason => ({ result: 'FAIL', reason });
const finite = n => Number.isFinite(n);
function childEnvironment(source) { const env = { ...source }; delete env.ELECTRON_RUN_AS_NODE; return env; }
const linear = n => (n /= 255) <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
function bitmap(value) {
  if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096 || value.channelOrder !== 'BGRA' || !ArrayBuffer.isView(value.data) || value.data.byteLength !== value.width * value.height * 4) throw TypeError('invalid-bitmap');
  return value;
}
function pair(a, b) { bitmap(a); bitmap(b); if (a.width !== b.width || a.height !== b.height) throw TypeError('bitmap-size-mismatch'); }
function rgb(image, index) { const o = index * 4; return [image.data[o + 2], image.data[o + 1], image.data[o]]; }
function indices(image, mask) {
  if (mask === undefined) return Array.from({ length: image.width * image.height }, (_, i) => i);
  if (!Array.isArray(mask) || mask.some(i => !Number.isSafeInteger(i) || i < 0 || i >= image.width * image.height)) throw TypeError('invalid-pixel-mask');
  return mask;
}
function pixelStats(a, b, mask, tolerance = 1) {
  pair(a, b); const selected = indices(a, mask); if (selected.length < 64) return fail('insufficient-pixels');
  let changedPixels = 0, maxChannelDelta = 0, total = 0;
  for (const i of selected) { const offset = i * 4; let delta = 0; for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(a.data[offset + c] - b.data[offset + c])); if (delta > tolerance) changedPixels++; maxChannelDelta = Math.max(maxChannelDelta, delta); total += delta; }
  return { result: 'PASS', pixelCount: selected.length, changedPixels, maxChannelDelta, meanMaxChannelDelta: total / selected.length };
}
// The inspection shader writes exact display primaries. Any mixed primary is
// fractional silhouette/MSAA coverage, not an opaque-body pixel. Keep the pixel
// difference tolerance unchanged; select actual fully covered pixels instead.
function facingClass(image, i) { const [r, g, b] = rgb(image, i); return r === 255 && g === 0 && b === 0 ? 1 : g === 255 && r === 0 && b === 0 ? -1 : 0; }
function erodedMask(image, predicate = () => true, radius = 3) {
  bitmap(image); const { width, height } = image, set = new Uint8Array(width * height), result = [];
  for (let i = 0; i < set.length; i++) set[i] = predicate(i) ? 1 : 0;
  for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
    const i = y * width + x; if (!set[i]) continue; let ok = true;
    for (let dy = -radius; dy <= radius && ok; dy++) for (let dx = -radius; dx <= radius; dx++) if (!set[i + dy * width + dx]) { ok = false; break; }
    if (ok) result.push(i);
  }
  return result;
}
function analyseFacing(legacy, corrected) {
  pair(legacy, corrected); const mask = erodedMask(corrected, i => facingClass(corrected, i) === -1);
  if (mask.length < 200) return fail('physical-back-facing-pixels-not-observed');
  let wronglyFront = 0; for (const i of mask) if (facingClass(legacy, i) === 1) wronglyFront++;
  if (wronglyFront / mask.length < .98) return fail('legacy-front-branch-substitution-not-reproduced');
  return { result: 'PASS', classification: 'ACTUAL_GPU_FACING_DOUBLE_PASS_A_B', backPixels: mask.length, legacyFrontPixels: wronglyFront, legacyFrontFraction: wronglyFront / mask.length };
}
function analyseInkContrast({ blank, full, zero, tenth, fifth, mask }) {
  for (const candidate of [full, zero, tenth, fifth]) pair(blank, candidate);
  const selected = indices(blank, mask), ratios = [[], [], []]; let maxRatio = 0;
  for (const i of selected) {
    const base = rgb(blank, i).map(linear), reference = rgb(full, i).map(linear), d = reference.map((v, c) => v - base[c]);
    const energy = d.reduce((s, v) => s + v * v, 0); if (energy < .025) continue;
    for (const [n, image] of [zero, tenth, fifth].entries()) { const value = rgb(image, i).map(linear), ratio = value.reduce((s, v, c) => s + (v - base[c]) * d[c], 0) / energy; ratios[n].push(ratio); maxRatio = Math.max(maxRatio, ratio); }
  }
  if (ratios[0].length < 100) return fail('insufficient-high-contrast-ink-pixels');
  const means = ratios.map(values => values.reduce((s, v) => s + v, 0) / values.length);
  const zeroStats = pixelStats(blank, zero, selected), result = { result: 'PASS', classification: 'LINEARIZED_DISPLAY_RGB_INK_CONTRIBUTION_NOT_OPTICAL_TRANSMITTANCE', inkPixels: ratios[0].length, zeroRatio: means[0], tenthRatio: means[1], fifthRatio: means[2], maxRatio, zeroMaxChannelDelta: zeroStats.maxChannelDelta };
  if (zeroStats.maxChannelDelta > 1 || Math.abs(means[0]) > .005) return { ...result, ...fail('zero-strength-not-paper-base') };
  if (means[1] < .065 || means[1] > .135 || means[2] < .165 || means[2] > .235 || means[2] <= means[1] || maxRatio > .3) return { ...result, ...fail('back-ink-not-weak-bounded-monotonic') };
  return result;
}
function analyseOcclusion(a, b, inside, outside) {
  const interior = pixelStats(a, b, inside), positiveControl = pixelStats(a, b, outside);
  if (interior.result !== 'PASS' || positiveControl.result !== 'PASS') return fail('occlusion-samples-insufficient');
  if (positiveControl.changedPixels < 64 || positiveControl.maxChannelDelta < 80) return { ...fail('behind-probe-not-visibly-rendered'), positiveControl };
  if (interior.changedPixels > 0) return { ...fail('inner-content-visible-through-opaque-paper'), interior, positiveControl };
  return { result: 'PASS', classification: 'SEPARATED_DEPTH_ACTUAL_PAPER_WITH_VISIBLE_BACKDROP_CONTROL', interior, positiveControl };
}
function expectedInspection(sample) { return { pose: sample.pose, shader: sample.shader || 'art', legacyDoublePass: sample.legacyDoublePass === true, behind: sample.behind || 'none', clip: sample.clip || 'none', innerInk: sample.innerInk || 'original' }; }
function validateSample(sample) {
  if (!sample || !POSES.includes(sample.pose) || !STRENGTHS.includes(sample.backsideInkStrength) || !BACKGROUNDS.includes(sample.background)) return fail('invalid-sample-contract');
  try { bitmap(sample.bitmap); } catch { return fail('missing-actual-bitmap'); }
  const state = sample.state, p = state?.renderer, m = p?.material;
  if (!state?.ready || state.playing !== false || !Number.isSafeInteger(state.generation) || state.generation < 1 || !p?.materialReady || p.error || p.canvasVisible !== true || p.engine !== 'paperlab' || p.libraryVersion !== '0.8.1') return fail('missing-current-renderer');
  if (p.materialAdapter !== 'paper-backface-v1' || !Number.isSafeInteger(p.actualDrawCount) || p.actualDrawCount < 1) return fail('old-or-undrawn-material');
  for (const key of ['meshId', 'geometryId', 'uvHash', 'uvInitialHash', 'metadataHash', 'frontTextureHash', 'backTextureHash']) if (typeof p[key] !== 'string' || !p[key]) return fail('missing-material-input-evidence');
  if (p.uvHash !== p.uvInitialHash || JSON.stringify(p.inspection) !== JSON.stringify(expectedInspection(sample))) return fail('inspection-or-uv-mismatch');
  if (!m || m.forceSinglePass !== !sample.legacyDoublePass || m.opacity !== 1 || m.depthTest !== true || m.depthWrite !== true || m.backsideInkStrength !== sample.backsideInkStrength || p.backsideInkStrength !== sample.backsideInkStrength || m.showThrough !== 0) return fail('invalid-paper-material');
  if (m.compiledFacingBranch !== true || m.compiledBackSampler !== true || typeof m.compiledShaderHash !== 'string' || !m.compiledShaderHash || !m.frontTextureId || !m.backTextureId || m.compiledFrontTextureId !== m.frontTextureId || m.compiledBackTextureId !== m.backTextureId) return fail('missing-actual-compiled-texture-branch');
  return { result: 'PASS', generation: state.generation, actualDrawCount: p.actualDrawCount };
}
function validateMatrix(samples) {
  if (!Array.isArray(samples) || samples.length !== 30) return fail('matrix-permutations-missing');
  const seen = new Set(), generations = new Set(); let reference;
  for (const sample of samples) {
    const checked = validateSample(sample); if (checked.result !== 'PASS') return checked;
    const key = [sample.pose, sample.background, sample.backsideInkStrength].join(':');
    if (seen.has(key) || generations.has(sample.state.generation)) return fail('duplicate-sample-or-generation');
    const p = sample.state.renderer;
    const frozen = [p.metadataHash, p.frontTextureHash, p.uvHash].join(':');
    if (reference && frozen !== reference) return fail('frozen-front-inputs-changed');
    reference = frozen; seen.add(key); generations.add(sample.state.generation);
  }
  for (const pose of POSES) for (const background of BACKGROUNDS) for (const strength of STRENGTHS) if (!seen.has([pose, background, strength].join(':'))) return fail('matrix-permutations-missing');
  return { result: 'PASS', permutations: seen.size, uniqueGenerations: generations.size };
}
function buildPlan({ root, output, token, development }) {
  if (!/^[a-f0-9]{8,32}$/.test(token)) throw TypeError('invalid-profile-token');
  if (!development) throw TypeError('only-development-is-authorized');
  const profile = path.join(output, 'isolated-backface-' + token);
  return { profile, output, readbackClassification: 'PAUSED_OWN_STAGE_MATERIAL_PIXELS_NOT_NATURAL_PLAYBACK', totalDeadlineMs: 300000,
    args: [path.join(root, 'desktop/roll-preview-main.cjs'), '--qa-roll-preview', '--qa-output', output, '--user-data-dir=' + profile] };
}
function syntheticSampleForTest({ pose = 'back', backsideInkStrength = .1, background = 'dark', generation = 1 } = {}) {
  const data = Buffer.alloc(40 * 40 * 4, 255), inspection = { pose, shader: 'art', legacyDoublePass: false, behind: 'none', clip: 'none', innerInk: 'original' };
  return { pose, backsideInkStrength, background, bitmap: { data, width: 40, height: 40, channelOrder: 'BGRA' }, state: { ready: true, playing: false, generation, renderer: {
    engine: 'paperlab', libraryVersion: '0.8.1', materialReady: true, error: null, canvasVisible: true, materialAdapter: 'paper-backface-v1', actualDrawCount: 1,
    meshId: 'actual-mesh', geometryId: 'actual-geometry', uvHash: 'uv', uvInitialHash: 'uv', metadataHash: 'meta', frontTextureHash: 'front', backTextureHash: 'back-' + backsideInkStrength,
    inspection, backsideInkStrength, material: { forceSinglePass: true, opacity: 1, depthWrite: true, depthTest: true, showThrough: 0, backsideInkStrength,
      compiledFacingBranch: true, compiledBackSampler: true, compiledShaderHash: 'actual-compiled-shader', frontTextureId: 'front-map', backTextureId: 'back-map', compiledFrontTextureId: 'front-map', compiledBackTextureId: 'back-map' },
  } } };
}
function syntheticMatrixForTest() { let generation = 0; return POSES.flatMap(pose => BACKGROUNDS.flatMap(background => STRENGTHS.map(backsideInkStrength => syntheticSampleForTest({ pose, background, backsideInkStrength, generation: ++generation })))); }

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'qa', 'backface', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'));
  const plan = buildPlan({ root, output, token: crypto.randomBytes(8).toString('hex'), development: args.length === 1 && args[0] === '--development' });
  await fsp.mkdir(output, { recursive: true });
  const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const bundlePath = path.join(root, 'renderer/generated/paperlab-runtime.js'), bundleSHA256 = hashFile(bundlePath);
  const reportFile = path.join(output, 'report.json'), report = { classification: 'OWN_PAPER_MATERIAL_NOT_OFFICIAL_PET', result: 'RUNNING', startedAt: new Date().toISOString(), output, profile: plan.profile, bundleSHA256,
    readbackClassification: plan.readbackClassification, samples: [], matrix: { result: 'NOT_TESTED' }, facing: { result: 'NOT_TESTED' }, contrast: [], frontPreservation: [], bodyOcclusion: [], rolledInnerOcclusion: { result: 'NOT_TESTED' }, clipping: { result: 'NOT_TESTED' },
    naturalPlayback: 'NOT_TESTED_BY_THIS_PAUSED_RUNNER_USE_SEPARATE_QA_ROLL', realPetPosition: 'NOT_TESTED', rolledStageTwo: 'NOT_IMPLEMENTED_PENDING_USER_VISUAL_APPROVAL', visualAcceptance: 'PENDING_USER_REVIEW' };
  const persist = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 }); persist();
  let app, rows = [], acks = new Map(), request = 0, exitError = null, timedOut = false, stderr = '', watchdog;
  const check = (yes, reason) => { if (!yes) throw Error(reason); };
  const until = async (read, milliseconds, reason) => { const deadline = Date.now() + milliseconds; while (Date.now() < deadline) { check(!timedOut, 'backface-watchdog-expired'); check(!exitError, exitError); const value = read(); if (value) return value; await sleep(10); } throw Error(reason); };
  const latest = () => rows.at(-1)?.state;
  const command = async (action, extra = {}) => { check(app?.connected, 'preview-ipc-disconnected'); const requestId = 'b' + (++request); app.send({ type: 'roll-preview:command', requestId, action, ...extra }); const ack = await until(() => acks.get(requestId), 20000, 'command-timeout:' + action); acks.delete(requestId); check(ack.ok !== false, ack.error || 'command-rejected:' + action); return ack; };
  const readCapture = async capture => {
    check(capture && typeof capture.bitmapFile === 'string', 'actual-stage-bitmap-file-missing');
    const relative = path.relative(output, path.resolve(capture.bitmapFile)); check(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'bitmap-path-outside-own-output');
    const data = await fsp.readFile(capture.bitmapFile); return bitmap({ width: capture.width, height: capture.height, channelOrder: capture.channelOrder, data });
  };
  const savedSample = sample => ({ ...sample, bitmap: { width: sample.bitmap.width, height: sample.bitmap.height, channelOrder: sample.bitmap.channelOrder, sha256: crypto.createHash('sha256').update(sample.bitmap.data).digest('hex') } });
  const inspect = async (pose, backsideInkStrength = .1, background = 'dark', extra = {}) => {
    const config = { pose, backsideInkStrength, background, shader: 'art', legacyDoublePass: false, behind: 'none', clip: 'none', innerInk: 'original', ...extra }, old = latest()?.generation || 0;
    await command('material-inspect', config);
    const state = await until(() => { const state = latest(); return state?.ready && state.generation > old && state.playing === false && state.renderer?.materialReady ? state : null; }, 25000, 'inspection-not-ready:' + JSON.stringify(config));
    check(JSON.stringify(state.renderer.inspection) === JSON.stringify(expectedInspection(config)), 'wrong-or-stale-inspection');
    const ack = await command('capture');
    const sample = { ...config, state, capture: ack.capture, bitmap: await readCapture(ack.capture), at: new Date().toISOString() };
    const validation = validateSample(sample); check(validation.result === 'PASS', validation.reason); report.samples.push(savedSample(sample)); persist(); return sample;
  };
  try {
    const executable = require('electron');
    report.command = { executable, argv: plan.args }; persist();
    app = spawn(executable, plan.args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: childEnvironment(process.env) });
    app.stdout.on('data', bytes => {}); app.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
    app.on('error', error => { exitError = error.message; }); app.on('exit', code => { if (code !== 0) exitError = 'own-preview-exited:' + code; });
    app.on('message', value => { if (value?.type === 'roll-preview:evidence') { rows.push(value); report.environment ||= value.environment; } else if (value?.type === 'roll-preview:ack') acks.set(value.requestId, value); });
    watchdog = setTimeout(() => { timedOut = true; if (app && !app.killed) app.kill(); }, plan.totalDeadlineMs);
    await until(() => latest()?.ready, 30000, 'own-preview-readiness-timeout');
    const initialGeneration = latest().generation;
    await command('texture-talisman');
    await until(() => latest()?.ready && latest().generation > initialGeneration && latest().textureMode === 'talisman', 25000, 'actual-talisman-texture-not-ready');
    // First reproduce the original wrong back branch on the exact same installed GPU pipeline.
    const legacy = await inspect('back', 0, 'dark', { shader: 'facing', legacyDoublePass: true });
    const corrected = await inspect('back', 0, 'dark', { shader: 'facing' });
    report.facing = analyseFacing(legacy.bitmap, corrected.bitmap); persist(); check(report.facing.result === 'PASS', report.facing.reason);
    const matrix = [];
    for (const pose of POSES) for (const background of BACKGROUNDS) for (const strength of STRENGTHS) matrix.push(await inspect(pose, strength, background));
    report.matrix = validateMatrix(matrix); persist(); check(report.matrix.result === 'PASS', report.matrix.reason);
    const find = (pose, strength, background) => matrix.find(s => s.pose === pose && s.backsideInkStrength === strength && s.background === background);
    for (const background of BACKGROUNDS) {
      const full = await inspect('back', 0, background, { shader: 'ink-reference' }), paper = await inspect('back', 0, background, { shader: 'paper-reference' }), zero = find('back', 0, background), tenth = find('back', .1, background), fifth = find('back', .2, background);
      const face = await inspect('back', 0, background, { shader: 'facing' }), mask = erodedMask(face.bitmap, i => facingClass(face.bitmap, i) === -1);
      const contrast = { background, zeroIndependentPaperGpuReference: 'ACTUAL_RAW_BLANK_WITH_SAME_PHYSICAL_UV_AND_BACK_LIGHTING_NOT_CREATE_BACK_PIXELS', ...analyseInkContrast({ blank: paper.bitmap, full: full.bitmap, zero: zero.bitmap, tenth: tenth.bitmap, fifth: fifth.bitmap, mask }) };
      report.contrast.push(contrast); persist(); check(contrast.result === 'PASS', contrast.reason);
      const front0 = find('front', 0, background);
      for (const strength of [.1, .2]) { const stats = pixelStats(front0.bitmap, find('front', strength, background).bitmap); const outcome = { background, strength, ...stats, result: stats.result === 'PASS' && stats.changedPixels === 0 ? 'PASS' : 'FAIL' }; report.frontPreservation.push(outcome); persist(); check(outcome.result === 'PASS', 'front-pixels-changed-by-back-strength'); }
      const oldFront = await inspect('front', 0, background, { legacyDoublePass: true }), frontPipeline = pixelStats(oldFront.bitmap, front0.bitmap);
      const frontPipelineOutcome = { background, classification: 'ACTUAL_FRONT_LEGACY_DOUBLE_PASS_VS_CORRECTED_SINGLE_PASS', ...frontPipeline, result: frontPipeline.result === 'PASS' && frontPipeline.changedPixels === 0 ? 'PASS' : 'FAIL' };
      report.frontPreservation.push(frontPipelineOutcome); persist(); check(frontPipelineOutcome.result === 'PASS', 'front-pixels-changed-by-facing-fix');
    }
    for (const pose of POSES) {
      const face = await inspect(pose, .1, 'dark', { shader: 'facing' }), inside = erodedMask(face.bitmap, i => facingClass(face.bitmap, i) !== 0);
      const backgroundPair = pixelStats(find(pose, .1, 'dark').bitmap, find(pose, .1, 'light').bitmap, inside);
      report.bodyOcclusion.push({ pose, classification: 'OPAQUE_BODY_BACKGROUND_INDEPENDENCE', ...backgroundPair, result: backgroundPair.result === 'PASS' && backgroundPair.changedPixels === 0 ? 'PASS' : 'FAIL' });
      persist(); check(report.bodyOcclusion.at(-1).result === 'PASS', 'background-shows-through-paper:' + pose);
      if (['front', 'back'].includes(pose)) {
        const red = await inspect(pose, .1, 'dark', { behind: 'red' }), black = await inspect(pose, .1, 'dark', { behind: 'black' });
        const outside = erodedMask(face.bitmap, i => facingClass(face.bitmap, i) === 0, 4), outcome = { pose, ...analyseOcclusion(red.bitmap, black.bitmap, inside, outside) };
        report.bodyOcclusion.push(outcome); persist(); check(outcome.result === 'PASS', outcome.reason);
      }
    }
    // Only a genuinely outer UV region is compared. Real roll mouths/edges are excluded.
    const uv = await inspect('rolled', .1, 'dark', { shader: 'uv' }), face = await inspect('rolled', .1, 'dark', { shader: 'facing' });
    const outer = erodedMask(uv.bitmap, i => facingClass(face.bitmap, i) !== 0 && uv.bitmap.data[i * 4 + 1] / 255 > .72 && uv.bitmap.data[i * 4 + 2] / 255 > .15 && uv.bitmap.data[i * 4 + 2] / 255 < .85, 3);
    const innerA = await inspect('rolled', .1, 'dark', { innerInk: 'cyan' }), innerB = await inspect('rolled', .1, 'dark', { innerInk: 'magenta' });
    const outerStats = pixelStats(innerA.bitmap, innerB.bitmap, outer), allStats = pixelStats(innerA.bitmap, innerB.bitmap);
    const visibleInnerA = await inspect('front', .1, 'dark', { innerInk: 'cyan' }), visibleInnerB = await inspect('front', .1, 'dark', { innerInk: 'magenta' }), visibleOverrideControl = pixelStats(visibleInnerA.bitmap, visibleInnerB.bitmap);
    const overrideVisible = visibleOverrideControl.result === 'PASS' && visibleOverrideControl.changedPixels >= 100 && visibleOverrideControl.maxChannelDelta >= 80;
    report.rolledInnerOcclusion = { classification: 'ACTUAL_ROLL_OUTER_VISIBLE_UV_GT_POINT72_EXCLUDES_MOUTHS_AND_SILHOUETTE', outer: outerStats, all: allStats,
      result: outerStats.result === 'PASS' && outerStats.changedPixels === 0 && overrideVisible ? 'PASS' : 'FAIL', visibleOverrideControl, positiveControl: 'SAME_INNER_UV_OVERRIDE_VISIBLE_ON_FULL_SHEET', innerMouthVisibility: 'NOT_ASSERTED_INVISIBLE_REAL_OPEN_MOUTHS_EXCLUDED' };
    persist(); check(report.rolledInnerOcclusion.result === 'PASS', 'actual-roll-inner-ink-through-outer');
    const unclipped = await inspect('front', .1, 'dark', { shader: 'facing' }), clipped = await inspect('front', .1, 'dark', { shader: 'facing', clip: 'lower-half' });
    const fullCount = erodedMask(unclipped.bitmap, i => facingClass(unclipped.bitmap, i) !== 0).length, clipCount = erodedMask(clipped.bitmap, i => facingClass(clipped.bitmap, i) !== 0).length, retained = clipCount / fullCount;
    report.clipping = { result: fullCount > 1000 && retained > .4 && retained < .6 ? 'PASS' : 'FAIL', classification: 'SAME_MATERIAL_OWN_LOCAL_PLANE_NOT_ROLLED_PET_INTAKE', fullCount, clipCount, retained }; persist(); check(report.clipping.result === 'PASS', 'local-clip-regression');
    check(hashFile(bundlePath) === bundleSHA256, 'bundle-changed-during-gpu-test');
    report.result = 'PASS'; report.finishedAt = new Date().toISOString(); report.stderrTail = stderr; persist();
    await command('quit');
  } catch (error) { report.result = 'FAIL'; report.failure ||= error.message; report.finishedAt = new Date().toISOString(); report.stderrTail = stderr; persist(); process.exitCode = 1; }
  finally { clearTimeout(watchdog); if (app && app.exitCode === null) { if (app.connected) { try { app.send({ type: 'roll-preview:command', requestId: 'final-quit', action: 'quit' }); } catch {} } await sleep(300); if (app.exitCode === null && !app.killed) app.kill(); } }
  process.stdout.write(JSON.stringify({ result: report.result, reportFile, failure: report.failure || null, captures: report.samples.length }) + '\n');
  return report;
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { pixelStats, analyseFacing, analyseInkContrast, analyseOcclusion, validateSample, validateMatrix, buildPlan, childEnvironment, syntheticSampleForTest, syntheticMatrixForTest, main };
