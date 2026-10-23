'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../renderer/ritual-core.js');
const { Session, frameAt, variants } = require('../renderer/ritual-timeline.js');

function event(type, runId = 'run-a', extra = {}) {
  return { type, runId, sessionId: 'session-a', source: 'demo', ...extra };
}
function started(metadata = {}) {
  const session = new Session();
  assert.equal(session.dispatch(event('start', 'run-a', { metadata }), 0), true);
  return session;
}
const sample = {
  model: 'MODEL_A', company: 'COMPANY_B', relay: 'RELAY_C',
  harness: 'HARNESS_D', environment: 'WORKSPACE_E', task: 'Build module', reasoning: 'HIGH_F',
};

test('a fresh sheet starts at each 30-second boundary without reporting task completion', () => {
  const before = frameAt(29999, { seed: 'run-a' });
  const edge = frameAt(30000, { seed: 'run-a' });
  const third = frameAt(60000, { seed: 'run-a' });
  assert.equal(before.sheetNumber, 1);
  assert.equal(before.phase, 'renewal');
  assert.equal(edge.sheetNumber, 2);
  assert.equal(edge.cycle, 0);
  assert.equal(edge.writing, 0);
  assert.equal(edge.burn, 0);
  assert.equal(third.sheetNumber, 3);
  const session = started();
  assert.equal(session.snapshot(90000).state, 'working');
});

test('one paper cycle moves through writing, seal, burning and renewal', () => {
  assert.equal(frameAt(1000).phase, 'writing');
  assert.equal(frameAt(2700).phase, 'seal');
  assert.equal(frameAt(15000).phase, 'burning');
  assert.equal(frameAt(29400).phase, 'renewal');
  for (const ms of [0, 1, 2400, 3000, 15000, 28800, 29999, 30000]) {
    const frame = frameAt(ms);
    for (const key of ['writing', 'burn', 'opacity']) {
      assert.ok(frame[key] >= 0 && frame[key] <= 1, `${key} must remain a normalized visual value`);
    }
  }
});

test('automatic variants never repeat on adjacent sheets and remain deterministic', () => {
  for (const seed of ['run-a', 'run-b', '含中文的种子']) {
    const sequence = Array.from({ length: 12 }, (_, i) => frameAt(i * 30000 + 1000, { seed }).variant);
    assert.equal(new Set(sequence.slice(0, 4)).size, 4);
    for (let i = 1; i < sequence.length; i++) assert.notEqual(sequence[i], sequence[i - 1]);
    assert.deepEqual(sequence, Array.from({ length: 12 }, (_, i) => frameAt(i * 30000 + 1000, { seed }).variant));
  }
});

test('an explicitly chosen burn mode is honored in preview controls', () => {
  for (const variant of variants) {
    assert.equal(frameAt(10000, { variant }).variant, variant);
    assert.equal(frameAt(40000, { variant }).variant, variant);
  }
});

test('waiting freezes the current paper and resuming counts only active work', () => {
  const session = started();
  assert.equal(session.dispatch(event('waiting'), 12000), true);
  const frozen = session.snapshot(45000);
  assert.equal(frozen.activeMs, 12000);
  assert.equal(frozen.sheetNumber, 1);
  assert.equal(frozen.state, 'waiting');
  assert.equal(session.dispatch(event('working'), 50000), true);
  assert.equal(session.snapshot(55000).activeMs, 17000);
});

test('duplicate current starts preserve the original task and paper progress', () => {
  const session = started({ task: 'original task' });
  session.snapshot(12000);
  assert.equal(session.dispatch(event('start', 'run-a', { metadata: { task: 'replacement task' } }), 15000), false);
  const snapshot = session.snapshot(18000);
  assert.equal(snapshot.activeMs, 18000);
  assert.equal(snapshot.metadata.task, 'original task');
  assert.equal(snapshot.runId, 'run-a');
});

test('a retained closed run cannot replace a newer run with a late start', () => {
  const session = started();
  session.dispatch(event('completed'), 100);
  session.dispatch(event('start', 'run-b'), 200);
  assert.equal(session.dispatch(event('start', 'run-a'), 300), false);
  const snapshot = session.snapshot(400);
  assert.equal(snapshot.runId, 'run-b');
  assert.equal(snapshot.state, 'working');
  assert.equal(snapshot.activeMs, 200);
});

test('a session lock rejects starts and state changes from another session', () => {
  const session = started();
  assert.equal(session.dispatch(event('start', 'run-other', { sessionId: 'session-other' }), 100), false);
  assert.equal(session.dispatch(event('completed', 'run-a', { sessionId: 'session-other' }), 200), false);
  const snapshot = session.snapshot(300);
  assert.equal(snapshot.sessionId, 'session-a');
  assert.equal(snapshot.runId, 'run-a');
  assert.equal(snapshot.state, 'working');
});

test('completed, failed and cancelled runs cannot revive or continue burning', () => {
  for (const terminal of ['completed', 'error', 'cancelled']) {
    const session = started();
    assert.equal(session.dispatch(event(terminal), 5000), true);
    assert.equal(session.dispatch(event('working'), 6000), false);
    assert.equal(session.dispatch(event('start'), 7000), false);
    const snapshot = session.snapshot(60000);
    assert.equal(snapshot.state, terminal);
    assert.equal(snapshot.activeMs, 5000);
  }
});

test('a genuinely new run can start after a terminal result', () => {
  const session = started();
  session.dispatch(event('completed'), 5000);
  assert.equal(session.dispatch(event('start', 'run-b', { metadata: { task: 'new task' } }), 6000), true);
  const snapshot = session.snapshot(7000);
  assert.equal(snapshot.runId, 'run-b');
  assert.equal(snapshot.activeMs, 1000);
  assert.equal(snapshot.metadata.task, 'new task');
});

test('unknown freezes burning until a valid working event resumes it', () => {
  const session = started();
  session.dispatch(event('unknown'), 6000);
  assert.equal(session.snapshot(30000).activeMs, 6000);
  session.dispatch(event('working'), 40000);
  assert.equal(session.snapshot(42000).activeMs, 8000);
});

test('unrecognized state events become unknown instead of continuing animation', () => {
  const session = started();
  assert.equal(session.dispatch(event('unrecognized-state'), 5000), true);
  const snapshot = session.snapshot(30000);
  assert.equal(snapshot.state, 'unknown');
  assert.equal(snapshot.activeMs, 5000);
});

test('events with older supplied monotonic times do not rewind state', () => {
  const session = started();
  session.snapshot(10000);
  assert.equal(session.dispatch(event('waiting'), 9000), false);
  assert.equal(session.snapshot(11000).activeMs, 11000);
  assert.equal(session.snapshot(11000).state, 'working');
});

test('a previous run late stop cannot stop the active run', () => {
  const session = started();
  session.dispatch(event('start', 'run-b'), 1000);
  assert.equal(session.dispatch(event('completed', 'run-a'), 2000), false);
  assert.equal(session.snapshot(3000).state, 'working');
  assert.equal(session.snapshot(3000).runId, 'run-b');
});

test('the start event snapshots input metadata before caller mutation', () => {
  const metadata = { task: 'original', detail: { value: 1 } };
  const session = started(metadata);
  metadata.task = 'changed';
  metadata.detail.value = 2;
  assert.deepEqual(session.snapshot(1).metadata, { task: 'original', detail: { value: 1 } });
});

test('missing and invalid metadata uses 未取得 and never invents a company', () => {
  for (const input of [undefined, null, [], { model: 'model-slug', company: null }]) {
    const normalized = core.normalizeMetadata(input);
    assert.equal(normalized.company, '未取得');
    assert.equal(normalized.sources.company, 'unknown');
    for (const key of core.fields) assert.equal(typeof normalized[key], 'string');
  }
});

test('long task text is retained separately from the compact inscription', () => {
  const task = '这是一条需要完整保留供用户展开阅读的任务说明。'.repeat(30);
  const normalized = core.normalizeMetadata({ task });
  assert.equal(normalized.fullTask, task);
  assert.equal(normalized.fullTaskTruncated, false);
  assert.ok(Array.from(normalized.task).length <= 120);
  assert.ok(normalized.task.endsWith('…'));
});

test('the full-task buffer is bounded and explicitly reports truncation', () => {
  const normalized = core.normalizeMetadata({ task: 'short title', fullTask: '甲'.repeat(9000) });
  assert.equal(Array.from(normalized.fullTask).length, 8192);
  assert.equal(normalized.fullTaskTruncated, true);
  assert.ok(normalized.fullTask.endsWith('…'));
});

test('XML metacharacters are escaped in visible text and accessibility descriptions', () => {
  const payload = '<script>x</script>&"\'';
  const metadata = Object.fromEntries(core.fields.map(key => [key, payload]));
  const svg = core.buildTalismanSVG(metadata);
  assert.ok(svg.includes('&lt;script&gt;x&lt;/script&gt;&amp;&quot;&apos;'));
  assert.doesNotMatch(svg, /<script\b/i);
  assert.doesNotMatch(svg, /<foreignObject\b/i);
  assert.doesNotMatch(svg, /onload\s*=/i);
  assert.ok(svg.includes('<desc '));
});

test('all seven fields appear as visible SVG text in their intended semantic regions', () => {
  const svg = core.buildTalismanSVG(sample, { idPrefix: 'contract' });
  const regions = {
    relay: ['gateway', 'invocation'], company: ['gateway', 'invocation'],
    model: ['invocation', 'edict'], harness: ['harness', 'task'],
    environment: ['harness', 'task'], task: ['task', 'heart'], reasoning: ['heart', null],
  };
  for (const [field, [from, to]] of Object.entries(regions)) {
    const start = svg.indexOf(`id="contract-${from}"`);
    const end = to ? svg.indexOf(`id="contract-${to}"`, start + 1) : svg.length;
    assert.ok(start >= 0 && end > start, `${field} region exists`);
    assert.ok(svg.slice(start, end).includes(`>${core.escapeXML(sample[field])}</text>`), `${field} must be visible in its region, not only in a title or description`);
  }
});

test('network, script and CSS-injection font URLs are rejected', () => {
  for (const fontDataURL of [
    'https://example.invalid/font.ttf', 'http://example.invalid/font.woff2',
    'javascript:alert(1)', "data:font/ttf;base64,AAA');}body{background:url(https://example.invalid)}",
  ]) {
    const svg = core.buildTalismanSVG(sample, { fontDataURL });
    assert.doesNotMatch(svg, /@font-face/);
    assert.ok(!svg.includes(fontDataURL));
    assert.doesNotMatch(svg, /example\.invalid/);
  }
});

test('a syntactically valid local base64 font URI is embedded without a network URL', () => {
  // This checks URI admission only, not whether these test bytes form a font.
  const svg = core.buildTalismanSVG(sample, { fontDataURL: 'data:font/ttf;base64,AAAA' });
  assert.ok(svg.includes("src:url('data:font/ttf;base64,AAAA')"));
  assert.doesNotMatch(svg, /src:url\(['"]?https?:/);
});

test('unsafe SVG id-prefix input cannot inject attributes or external elements', () => {
  const svg = core.buildTalismanSVG(sample, { idPrefix: '42\"><script>alert(1)</script>' });
  assert.doesNotMatch(svg, /<script\b/i);
  assert.doesNotMatch(svg, /id="42/);
  assert.ok(svg.includes('url(#_42scriptalert1script-paper-tone)'));
});

test('example envelope manually satisfies required keys, enums and unknown/null rules', () => {
  // Deliberately a focused manual check, not a JSON Schema conformance validator.
  const configDir = path.resolve(__dirname, '../config');
  const schema = JSON.parse(fs.readFileSync(path.join(configDir, 'task-envelope.schema.json'), 'utf8'));
  const example = JSON.parse(fs.readFileSync(path.join(configDir, 'task.example.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  for (const key of schema.required) assert.ok(Object.hasOwn(example, key), `missing ${key}`);
  assert.equal(example.schemaVersion, 1);
  assert.ok(schema.properties.source.enum.includes(example.source));
  assert.ok(schema.properties.state.enum.includes(example.state));
  assert.equal(example.source, 'demo');
  assert.deepEqual(Object.keys(example.metadata).sort(), [...core.fields].sort());
  assert.deepEqual(Object.keys(example.provenance).sort(), [...core.fields].sort());
  for (const key of core.fields) {
    const value = example.metadata[key], from = example.provenance[key];
    assert.ok(schema.$defs.provenance.enum.includes(from));
    assert.equal(from, 'demo');
    assert.equal(typeof value, 'string');
    assert.ok(value.trim().length > 0);
    assert.ok(Array.from(value).length <= schema.properties.metadata.properties[key].maxLength);
  }
});

test('example provenance is explicitly mapped into the renderer source contract', () => {
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/task.example.json'), 'utf8'));
  const normalized = core.normalizeMetadata({ ...example.metadata, sources: example.provenance });
  for (const key of core.fields) assert.equal(normalized.sources[key], 'demo');
});

test('external mutation of snapshot metadata and nested data is blocked', () => {
  const session = started({ task: 'original task', detail: { value: 'original detail' } });
  const snapshot = session.snapshot(1);
  assert.equal(Object.isFrozen(snapshot.metadata), true);
  assert.equal(Object.isFrozen(snapshot.metadata.detail), true);
  assert.throws(() => { snapshot.metadata.task = 'modified task'; }, TypeError);
  assert.throws(() => { snapshot.metadata.detail.value = 'modified detail'; }, TypeError);
  assert.deepEqual(session.snapshot(2).metadata, {
    task: 'original task', detail: { value: 'original detail' },
  });
});
