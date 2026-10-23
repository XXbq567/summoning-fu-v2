'use strict';
// Local integration QA only. No Codex chat, model request, or official app mutation.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CLI_VERSION = '0.163.0-alpha.11'; // Explicit current local contract; still synthetic fixture evidence.
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, message) => { if (!value) throw new Error(message); };

function execute(executable, argv, { env, input, timeoutMs = 10000, gui = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { cwd: root, env, shell: false, windowsHide: !gui, stdio: [input == null ? 'ignore' : 'pipe', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => reject(new Error('Child did not exit within the bounded QA deadline.')), timeoutMs);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('QA child could not start.')); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('QA child exited unsuccessfully.')); });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
async function readRows(file) {
  try { return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch { return []; }
}
async function until(predicate, timeoutMs, label) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) { const result = await predicate(); if (result) return result; await pause(150); }
  throw new Error('Timed out: ' + label);
}
async function main() {
  check(process.platform === 'win32', 'This QA harness is Windows-only.');
  check(option('--package-root'), 'Usage: node scripts/qa-plugin-entrance.cjs --package-root <installed-plugin-root> [--appdata-alias <proven-equivalent-roaming-root>]');
  const packageRoot = path.resolve(option('--package-root'));
  const executable = path.join(packageRoot, 'runtime', 'Summoning-Fu.exe');
  const hook = path.join(packageRoot, 'scripts', 'user-prompt-submit.cjs');
  await fs.access(executable); await fs.access(hook);
  check(process.env.APPDATA && path.isAbsolute(process.env.APPDATA), 'A normal absolute APPDATA is required.');
  const normalAppData = path.resolve(process.env.APPDATA);
  const cases = [{ name: 'ordinary', appData: normalAppData }, { name: 'local-drive-namespace', appData: path.toNamespacedPath(normalAppData) }];
  if (option('--appdata-alias')) {
    const alias = path.resolve(option('--appdata-alias'));
    // MSIX can expose the same product directory through different realpath
    // spellings. Compare existing product directories' actual identities only;
    // unrelated Roaming content is neither read nor used to authorize writes.
    for (const relative of ['summoning-fu-handoff', path.join('summoning-fu-handoff', 'entrance-events')]) {
      const normal = await fs.lstat(path.join(normalAppData, relative), { bigint: true });
      const redirected = await fs.lstat(path.join(alias, relative), { bigint: true });
      check(normal.isDirectory() && redirected.isDirectory() && !normal.isSymbolicLink() && !redirected.isSymbolicLink(), 'Product alias must be existing regular directories.');
      check(normal.dev !== 0n && normal.ino !== 0n && normal.dev === redirected.dev && normal.ino === redirected.ino, 'Product alias directory identity differs; refusing.');
    }
    cases.push({ name: 'verified-alias', appData: alias });
  }
  const output = path.join(root, 'docs', 'QA', 'plugin-entrance-e2e', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'));
  const codexHome = path.join(output, 'fixture-codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '10', '21');
  const captures = path.join(output, 'captures');
  await fs.mkdir(sessions, { recursive: true }); await fs.mkdir(captures);
  const diagnostics = path.join(output, 'runtime.jsonl');
  const env = { ...process.env, APPDATA: normalAppData, CODEX_HOME: codexHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const report = { classification: 'LOCAL_FIXTURE_INTEGRATION_QA_NOT_REAL_CODEX_CLIENT_ACCEPTANCE', cliVersion: CLI_VERSION, beganAt: new Date().toISOString(), output, cases: [], realClient: 'NOT_TESTED', storeColdStart: 'NOT_TESTED' };
  const ownedEvents = [];
  let runtimeStarted = false;
  try {
    process.stdout.write('QA: gracefully closing the companion runtime; official Codex is untouched.\n');
    await execute(executable, ['--quit'], { env, gui: true }); await pause(1000);
    const runtime = spawn(executable, ['--hide', '--diagnostics-file', diagnostics, '--capture-dir', captures], { cwd: root, env, windowsHide: false, stdio: 'ignore' });
    let startError = false; runtime.once('error', () => { startError = true; });
    runtimeStarted = true;
    await until(async () => { check(!startError, 'Runtime could not start.'); return (await readRows(diagnostics)).length > 0; }, 12000, 'runtime diagnostic heartbeat');
    for (const scenario of cases) {
      const sessionId = crypto.randomUUID(), turnId = crypto.randomUUID();
      const eventId = crypto.createHash('sha256').update(sessionId + '\n' + turnId).digest('hex');
      const file = path.join(sessions, `rollout-qa-${sessionId}.jsonl`);
      const title = '本地验收·非真实任务';
      const meta = { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: sessionId, cli_version: CLI_VERSION, cwd: output, base_instructions: 'LOCAL QA FIXTURE. '.repeat(2000) } };
      const startedAt = Date.now();
      const start = { timestamp: new Date(startedAt).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: turnId, started_at: startedAt / 1000 } };
      const effort = scenario.name === 'local-drive-namespace' ? 'high' : 'xhigh';
      const context = { timestamp: new Date(startedAt).toISOString(), type: 'turn_context', payload: { turn_id: turnId, model: 'local-qa-model', effort } };
      check(Buffer.byteLength(JSON.stringify(meta)) > 16384, 'Fixture did not cover the oversized legacy header boundary.');
      const beforeContext = JSON.stringify(meta) + '\n' + JSON.stringify(start) + '\n';
      const contextOffset = Buffer.byteLength(beforeContext);
      await fs.writeFile(file, beforeContext + JSON.stringify(context) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.appendFile(path.join(codexHome, 'session_index.jsonl'), JSON.stringify({ id: sessionId, thread_name: title, updated_at: new Date().toISOString() }) + '\n', { mode: 0o600 });
      const eventFile = path.join(normalAppData, 'summoning-fu-handoff', 'entrance-events', eventId + '.json');
      try { await fs.access(eventFile); throw new Error('QA event already exists; refusing to overwrite.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      ownedEvents.push(eventFile);
      const input = { hook_event_name: 'UserPromptSubmit', session_id: sessionId, turn_id: turnId, transcript_path: file, cwd: output, model: 'local-qa-model', prompt: 'LOCAL QA FIXTURE; this text must not be displayed.' };
      const submittedAt = Date.now();
      process.stdout.write(`QA: ${scenario.name}, real hook process stdin -> product spool -> companion window.\n`);
      await execute(process.execPath, [hook], { env: { ...env, APPDATA: scenario.appData, PLUGIN_ROOT: packageRoot }, input: JSON.stringify(input) });
      await until(async () => { try { const value = JSON.parse(await fs.readFile(eventFile, 'utf8')); return value.eventId === eventId; } catch { return false; } }, 3000, 'owned fixture event');
      const shown = await until(async () => (await readRows(diagnostics)).find(row => row.runId === eventId && row.visible && row.windows?.[0]?.visible), 12000, 'verified fixture entrance becomes visible');
      check(shown.source === 'codex-user-prompt-submit' && shown.sessionId === sessionId && shown.turnId === turnId, 'Displayed source identity did not match fixture hook.');
      check(shown.titleSource === 'codex-session-index', 'Fixture chat title provenance was not preserved.');
      check(shown.reasoning?.value === effort && shown.reasoning.source === 'reported' && shown.reasoning.contextOffset === contextOffset, 'Current-turn reasoning evidence was not explicitly mapped and frozen.');
      check(shown.windows[0].focused === false, 'Pet stole focus.');
      const showDelayMs = Date.parse(shown.at) - submittedAt;
      check(showDelayMs >= 4800 && showDelayMs <= 9000, 'Display did not follow the approximately five-second hook delay.');
      const previousCaptures = new Set(await fs.readdir(captures));
      await execute(executable, ['--capture'], { env, gui: true });
      const capture = await until(async () => (await fs.readdir(captures)).find(name => name.endsWith('-pet.png') && !previousCaptures.has(name)), 4000, 'visible fixture screenshot');
      const hiddenRow = await until(async () => (await readRows(diagnostics)).find(row => row.runId === eventId && !row.visible && !row.windows?.[0]?.visible), 16000, 'fixture entrance disappears');
      const expectedDuration = shown.hideAtMs;
      const rendered = (await readRows(diagnostics)).find(row => row.runId === eventId && row.renderEvidence?.runId === eventId && typeof row.renderEvidence.systemReducedMotion === 'boolean');
      check(rendered, 'Matching fixture renderer motion evidence is missing.');
      const systemReducedMotion = rendered.renderEvidence.systemReducedMotion;
      check(rendered.effectiveReducedMotion === false && rendered.renderEvidence.effectiveReducedMotion === false && rendered.renderEvidence.reducedMotion === false, 'Normal hook did not use the approved full-motion policy.');
      check(rendered.systemReducedMotion === systemReducedMotion, 'Host and renderer disagree about the separately observed system preference.');
      check(expectedDuration === 14000, 'Normal hook must play fourteen seconds, even when system reduced motion is enabled.');
      // EntranceTimeline intentionally freezes expired elapsedMs at 14000; use
      // the recorded start-relative wall time to measure actual window hiding.
      const estimatedStartAt = Date.parse(shown.at) - shown.elapsedMs;
      const hiddenAtMs = Date.parse(hiddenRow.at) - estimatedStartAt;
      check(hiddenAtMs >= expectedDuration - 100 && hiddenAtMs <= expectedDuration + 1500, 'Hide did not follow the entrance deadline.');
      const stableHidden = await until(async () => {
        const rows = (await readRows(diagnostics)).filter(row => row.runId === eventId && !row.windows?.[0]?.visible && Date.parse(row.at) >= Date.parse(hiddenRow.at) + 1200);
        return rows.length >= 2 ? rows : null;
      }, 6000, 'two stable hidden rendering observations');
      const all = (await readRows(diagnostics)).filter(row => row.runId === eventId);
      check(stableHidden.every(row => row.renderEvidence?.runId === eventId), 'No renderer evidence for the fixture.');
      const first = stableHidden[0].renderEvidence, last = stableHidden.at(-1).renderEvidence;
      check(first.renderCount === last.renderCount && first.rafCount === last.rafCount, 'Renderer continued rendering while hidden.');
      check(all.filter(row => row.windows?.[0]?.visible).every(row => !row.windows[0].focused), 'Pet acquired focus while shown.');
      check(all.some(row => row.admission?.stage === 'applied' && row.admission.sessionId === sessionId), 'Applied admission evidence missing.');
      check(all.every(row => row.reasoning?.value === effort && row.reasoning.source === 'reported' && row.reasoning.contextOffset === contextOffset), 'Reasoning context changed within the displayed entrance.');
      check(all.every(row => row.effectiveReducedMotion === false && row.systemReducedMotion === systemReducedMotion), 'Normal entrance motion policy changed during display.');
      const visualStages = all.at(-1).visualStages;
      const stageResults = {};
      if (scenario.name === 'ordinary') {
        for (const phase of ['paper', 'writing', 'hold', 'leaving']) {
          const stage = visualStages?.[phase];
          check(stage?.status === 'captured' && typeof stage.capture === 'string' && path.basename(stage.capture) === stage.capture, 'Missing natural normal-hook stage capture: ' + phase);
          check((await fs.stat(path.join(captures, stage.capture))).size > 1000, 'Empty natural stage screenshot: ' + phase);
          for (const evidence of [stage.before, stage.after]) {
            check(evidence?.runId === eventId && !evidence.documentHidden && evidence.frame.phase === phase && evidence.effectiveReducedMotion === false, 'Stage capture did not stay within the current normal hook frame: ' + phase);
            const f = evidence.frame;
            if (phase === 'paper') check(f.paperOpacity > 0 && f.paperOpacity < 1 && f.opacity === 1 && f.writing === 0 && f.visibleGlyphs === 0, 'Natural paper stage included ink or skipped paper appearance.');
            if (phase === 'writing') check(f.paperOpacity === 1 && f.opacity === 1 && f.visibleGlyphs > 0 && f.visibleGlyphs < f.totalGlyphs, 'Natural writing stage did not show partial text.');
            if (phase === 'hold') check(f.paperOpacity === 1 && f.opacity === 1 && f.visibleGlyphs === f.totalGlyphs && f.totalGlyphs > 0, 'Natural hold stage was not a complete talisman.');
            if (phase === 'leaving') check(f.paperOpacity === 1 && f.opacity > 0 && f.opacity < 1 && f.visibleGlyphs === f.totalGlyphs, 'Natural departure did not fade the common paper-and-ink parent.');
          }
          stageResults[phase] = { result: 'PASS', capture: stage.capture, before: stage.before.frame, after: stage.after.frame };
        }
      }
      const holds = all.filter(row => row.renderEvidence?.runId === eventId && row.renderEvidence.frame.phase === 'hold' && row.windows?.[0]?.visible);
      check(holds.length >= 7, 'Too few natural complete-hold observations.');
      const firstHold = holds[0].renderEvidence, lastHold = holds.at(-1).renderEvidence;
      check(firstHold.frame.leaveAtMs - firstHold.frame.holdStartMs === 10000 && lastHold.frame.activeMs - firstHold.frame.activeMs >= 8000, 'Normal hook skipped the full ten-second hold.');
      check(holds.every(row => row.renderEvidence.frame.opacity === 1 && row.renderEvidence.frame.visibleGlyphs === row.renderEvidence.frame.totalGlyphs), 'Paper or glyphs changed during complete hold.');
      check(firstHold.rafCount === lastHold.rafCount, 'Static hold continued requesting animation frames.');
      report.cases.push({ scenario: scenario.name, result: 'PASS', sessionId, turnId, eventId, showDelayMs, hideAtMs: expectedDuration, hiddenAtMs, systemReducedMotion, effectiveReducedMotion: false,
        reasoning: { value: effort, source: 'reported', contextOffset }, petFocused: false, hiddenRenderStopped: true, capture, naturalStages: stageResults,
        completeHold: { durationMs: 10000, observedMs: lastHold.frame.activeMs - firstHold.frame.activeMs, rafStopped: true } });
      process.stdout.write(`QA: ${scenario.name} PASS, delay ${showDelayMs} ms, lifetime ${expectedDuration} ms.\n`);
    }
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL'; report.failure = error.message;
    process.exitCode = 1;
  } finally {
    if (runtimeStarted) { try { await execute(executable, ['--quit'], { env, gui: true }); } catch { report.shutdown = 'FAILED'; process.exitCode = 1; } }
    for (const file of ownedEvents) {
      // These exact cryptographically unique paths were created for this run only.
      try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') { report.cleanup = 'FAILED'; process.exitCode = 1; } }
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ result: report.result, report: path.join(output, 'report.json'), cases: report.cases.length, failure: report.failure || null }) + '\n');
  }
}
main().catch(() => { process.stderr.write('QA preflight failed. Check package root, permissions, and APPDATA alias equivalence.\n'); process.exitCode = 1; });
