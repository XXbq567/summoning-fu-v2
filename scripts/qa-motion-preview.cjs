'use strict';
// QA of this product's explicit preview only: no official Codex UI or model call.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = key => { const at = args.indexOf(key); return at < 0 ? null : args[at + 1]; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function rows(file) {
  try { return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch { return []; }
}
async function until(read, timeout, name) {
  const end = performance.now() + timeout;
  while (performance.now() <= end) { const result = await read(); if (result) return result; await wait(150); }
  throw new Error('Timed out: ' + name);
}
async function run(executable, argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { env, cwd: root, shell: false, windowsHide: false, stdio: 'ignore' });
    const timeout = setTimeout(() => reject(new Error('Companion command did not exit.')), 10000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Companion command failed to launch.')); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Companion command failed.')); });
  });
}
async function bindingHash() {
  try {
    const value = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'summoning-fu-handoff', 'summoning-fu-settings.json'), 'utf8'));
    return crypto.createHash('sha256').update(JSON.stringify(value.binding ?? null)).digest('hex');
  } catch { return null; }
}
async function main() {
  check(process.platform === 'win32' && option('--executable'), 'Usage: node scripts/qa-motion-preview.cjs --executable <absolute packaged Summoning-Fu.exe>');
  const executable = path.resolve(option('--executable')); await fs.access(executable);
  const output = path.join(root, 'docs', 'QA', 'motion-preview', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'));
  const captures = path.join(output, 'captures'), diagnostics = path.join(output, 'runtime.jsonl');
  await fs.mkdir(captures, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const report = { classification: 'EXPLICIT_LOCAL_PREVIEW_QA_NOT_REAL_HOOK_ACCEPTANCE', output, startedAt: new Date().toISOString(), stages: {}, normalPreview: 'NOT_TESTED', realHook: 'NOT_TESTED' };
  let started = false, initialBinding;
  const command = name => run(executable, ['--preview-qa=' + name], env);
  const latest = async () => (await rows(diagnostics)).at(-1);
  try {
    await run(executable, ['--quit'], env); await wait(800); initialBinding = await bindingHash();
    process.stdout.write('QA: starting explicit local motion preview.\n');
    const app = spawn(executable, ['--motion-preview', '--diagnostics-file', diagnostics, '--capture-dir', captures], { env, cwd: root, shell: false, windowsHide: false, stdio: 'ignore' });
    let launchFailed = false; app.once('error', () => { launchFailed = true; }); started = true;
    const baseline = await until(async () => { check(!launchFailed, 'Preview launch failed.'); const row = await latest(); return row?.preview?.visible && row.preview.evidence ? row : null; }, 15000, 'preview window and renderer evidence');
    check(baseline.preview.source === 'example', 'Cold-start QA expected explicitly labelled local example content.');
    const systemReduce = baseline.systemReducedMotion;
    const realIdentity = JSON.stringify({ runId: baseline.runId, sessionId: baseline.sessionId, source: baseline.source, pending: baseline.pendingEntrance, isolation: baseline.isolation });
    report.systemReducedMotion = systemReduce;
    for (const stage of ['paper', 'writing', 'hold', 'leaving']) {
      const previousGeneration = (await latest()).preview.evidence.generation;
      await command(stage);
      const row = await until(async () => { const value = await latest(), e = value?.preview?.evidence; return e && e.generation > previousGeneration && e.phase === stage && !e.playing ? value : null; }, 5000, stage + ' paused stage');
      const e = row.preview.evidence;
      check(e.effectiveReducedMotion === false && e.systemReducedMotion === systemReduce, 'Preview did not distinguish real system preference from explicit full animation.');
      if (stage === 'paper') check(e.paperOpacity > 0 && e.paperOpacity < 1 && e.visibleGlyphs === 0 && e.writing === 0 && e.opacity === 1, 'Paper-only DOM evidence failed.');
      if (stage === 'writing') check(e.paperOpacity === 1 && e.visibleGlyphs > 0 && e.visibleGlyphs < e.totalGlyphs, 'Partial writing DOM evidence failed.');
      if (stage === 'hold') check(e.paperOpacity === 1 && e.visibleGlyphs === e.totalGlyphs && e.totalGlyphs > 0 && e.opacity === 1, 'Complete talisman DOM evidence failed.');
      if (stage === 'leaving') check(e.paperOpacity === 1 && e.opacity > 0 && e.opacity < 1 && e.visibleGlyphs === e.totalGlyphs, 'Paper and ink do not share the fading parent.');
      const before = new Set(await fs.readdir(captures));
      await run(executable, ['--capture'], env);
      const capture = await until(async () => (await fs.readdir(captures)).find(file => file.endsWith('-preview.png') && !before.has(file)), 5000, stage + ' actual screenshot');
      report.stages[stage] = { result: 'PASS', capture, evidence: e };
      process.stdout.write('QA: ' + stage + ' screenshot and DOM evidence PASS.\n');
    }
    await command('replay');
    const prior = (await latest()).preview.evidence.generation;
    // The next normal diagnostic tick observes the explicit replay generation.
    const playing = await until(async () => { const row = await latest(), e = row?.preview?.evidence; return e?.playing && e.elapsedMs < e.holdStartMs ? row : null; }, 5000, 'natural preview playback');
    const generation = playing.preview.evidence.generation;
    const finished = await until(async () => { const row = await latest(), e = row?.preview?.evidence; return e?.generation === generation && e.phase === 'hidden' && !e.playing ? row : null; }, 18000, 'natural fourteen-second playback');
    const playback = (await rows(diagnostics)).filter(row => row.preview?.evidence?.generation === generation && row.preview.visible);
    const holds = playback.filter(row => row.preview.evidence.phase === 'hold');
    check(holds.length >= 7, 'Natural playback did not provide enough hold observations.');
    const firstHold = holds[0].preview.evidence, lastHold = holds.at(-1).preview.evidence;
    check(firstHold.leaveAtMs - firstHold.holdStartMs === 10000, 'Shared timeline does not specify ten-second complete hold.');
    check(lastHold.elapsedMs - firstHold.elapsedMs >= 8000, 'Natural playback skipped part of the ten-second hold.');
    check(holds.every(row => row.preview.evidence.visibleGlyphs === row.preview.evidence.totalGlyphs && row.preview.evidence.opacity === 1), 'Text or paper changed while holding.');
    check(firstHold.renderCount === lastHold.renderCount && firstHold.rafCount === lastHold.rafCount, 'Hold used unnecessary SVG redraws or RAF.');
    check(lastHold.uiElapsedMs - firstHold.uiElapsedMs >= 8000, 'UI progress froze during the static hold.');
    const elapsedWall = Date.parse(finished.at) - Date.parse(playing.at);
    const elapsedVisual = finished.preview.evidence.elapsedMs - playing.preview.evidence.elapsedMs;
    check(Math.abs(elapsedWall - elapsedVisual) <= 1500, 'Natural playback did not follow elapsed real time.');
    report.naturalPlayback = { result: 'PASS', generation, holdDurationMs: 10000, observedHoldMs: lastHold.elapsedMs - firstHold.elapsedMs, svgRenderCountDuringHold: firstHold.renderCount, finalElapsedMs: finished.preview.evidence.elapsedMs, uiProgressAdvanced: true };
    // The same public request used by a second double-click must replay an ended preview.
    await run(executable, ['--motion-preview'], env);
    const reopened = await until(async () => { const row = await latest(), e = row?.preview?.evidence; return e?.generation > generation && e.playing && e.elapsedMs < 3000 ? row : null; }, 5000, 'same-instance reopen starts replay');
    await command('hide');
    const hidden = await until(async () => { const row = await latest(), e = row?.preview?.evidence; return row?.preview?.open && !row.preview.visible && e?.documentHidden && !e.playing ? row : null; }, 5000, 'preview hidden and paused');
    const stable = await until(async () => { const found = (await rows(diagnostics)).filter(row => !row.preview?.visible && row.preview?.evidence?.documentHidden && Date.parse(row.at) >= Date.parse(hidden.at) + 1200); return found.length >= 2 ? found : null; }, 6000, 'stable hidden preview observations');
    const startHidden = stable[0].preview.evidence, endHidden = stable.at(-1).preview.evidence;
    check(startHidden.rafCount === endHidden.rafCount && startHidden.renderCount === endHidden.renderCount && startHidden.elapsedMs === endHidden.elapsedMs, 'Hidden preview advanced or rendered.');
    await command('show');
    const shownAgain = await until(async () => { const row = await latest(), e = row?.preview?.evidence; return row?.preview?.visible && e && !e.documentHidden ? row : null; }, 5000, 'preview visibility restored');
    check(!shownAgain.preview.evidence.playing && shownAgain.preview.evidence.rafCount === endHidden.rafCount, 'Restoring hidden window silently resumed motion.');
    await command('close');
    const closed = await until(async () => { const row = await latest(); return row?.preview && !row.preview.open ? row : null; }, 5000, 'preview close');
    const afterClose = await until(async () => { const row = await latest(); return row && Date.parse(row.at) > Date.parse(closed.at) + 1800 ? row : null; }, 5000, 'closed preview remains stopped');
    check(afterClose.preview.evidence.rafCount === closed.preview.evidence.rafCount && afterClose.preview.evidence.renderCount === closed.preview.evidence.renderCount, 'Closed preview kept rendering.');
    const all = await rows(diagnostics);
    check(all.every(row => JSON.stringify({ runId: row.runId, sessionId: row.sessionId, source: row.source, pending: row.pendingEntrance, isolation: row.isolation }) === realIdentity), 'Preview changed the real entrance scheduler or context.');
    check(all.every(row => row.systemReducedMotion === systemReduce), 'Preview changed real entrance system-motion policy.');
    report.normalPreview = 'PASS'; report.reopenReplay = 'PASS'; report.hiddenAndClosedStop = 'PASS'; report.realStateIsolation = 'PASS'; report.result = 'PASS';
  } catch (error) { report.result = 'FAIL'; report.failure = error.message; process.exitCode = 1; }
  finally {
    if (started) { try { await run(executable, ['--quit'], env); await wait(500); } catch { report.shutdown = 'FAILED'; process.exitCode = 1; } }
    const finalBinding = await bindingHash();
    if (initialBinding !== null && initialBinding !== undefined) { report.persistedBindingUnchanged = finalBinding === initialBinding; if (!report.persistedBindingUnchanged) { report.result = 'FAIL'; report.failure = 'Preview-only session changed the stored binding.'; process.exitCode = 1; } }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ result: report.result, report: path.join(output, 'report.json'), failure: report.failure || null }) + '\n');
  }
}
main().catch(error => { process.stderr.write('Preview QA preflight failed: ' + error.message + '\n'); process.exitCode = 1; });
