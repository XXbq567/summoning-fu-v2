'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
function helper(name, globals) {
  const text = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'))?.[0];
  assert.ok(text, name + ' must be explicit and independently testable');
  return vm.runInNewContext('(' + text + ')', globals);
}
test('prepaint revalidation requires the typed immutable anchor and exact source identity, without offset equality', () => {
  const matches = helper('samePreparedVerification', { verificationAnchor: v => v.verified && v.sourceRevision ? v.sourceKind + ':' + v.sourceRevision : null });
  const prepared = { sessionId: 's', turnId: 't', verificationStartedAtMs: 1, verificationAnchor: 'codex-paginated-metadata:abc' };
  const verified = { verified: true, sessionId: 's', turnId: 't', startedAtMs: 1, sourceKind: 'codex-paginated-metadata', sourceRevision: 'abc' };
  assert.equal(matches(prepared, verified), true);
  for (const patch of [{ verified: false }, { sourceRevision: 'changed' }, { sessionId: 'other' }, { turnId: 'new' }, { startedAtMs: 2 }, { sourceKind: 'codex-rollout' }, { sourceRevision: null }]) assert.equal(matches(prepared, { ...verified, ...patch }), false);
  assert.equal(matches(prepared, { ...verified, offset: 999 }), true, 'paged metadata has no JSONL byte offset');
  assert.match(source, /if \(!samePreparedVerification\(prepared, verification\)\)/);
});
test('paged title uses only verified metadata, including pending, while legacy retains exact-index lookup', async () => {
  let calls = 0;
  const choose = helper('titleForVerifiedEntrance', { readChatTitle: async () => { calls++; return { value: 'legacy title', source: 'codex-session-index' }; } });
  const event = { sessionId: 's', title: { value: 'untrusted event', source: 'codex-session-index' } };
  const title = { value: 'verified paged name', source: 'codex-paginated-name' };
  assert.equal((await choose(event, { verified: true, sourceKind: 'codex-paginated-metadata', title })).value, title.value);
  const unicode = '😀'.repeat(121);
  assert.equal((await choose(event, { verified: true, sourceKind: 'codex-paginated-metadata', title: { value: unicode, source: 'codex-paginated-name' } })).value, unicode, 'the verified 240-codepoint contract is not a UTF-16 length limit');
  assert.equal((await choose(event, { verified: true, sourceKind: 'codex-paginated-metadata', title: { value: null, source: 'pending' } })).value, null);
  assert.equal((await choose(event, { verified: true, sourceKind: 'codex-paginated-metadata', title: event.title })).value, null);
  assert.equal(calls, 0);
  assert.equal((await choose(event, { verified: true, sourceKind: 'codex-rollout' })).value, 'legacy title');
  assert.equal(calls, 1);
});
