'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('UIA failure cannot cancel a pending Hook, including while an older observed Chat remains displayed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const body = source.match(/function cancelObservedPresentation\([^]*?\n}/)[0];
  const cancelled = [], globals = { observerStatus: '', observerDiagnostic: null, diagnostic: '', pendingPresentation: { eventId: 'hook', presentationMode: 'independent-hook' },
    displayContext: { eventId: 'chat', presentationMode: 'observed-chat' }, pendingTimer: 1, presentationGeneration: 2, entranceCancellation: 10,
    scheduler: { cancel() { throw Error('UIA must never cancel Hook scheduler'); } }, sendGate: { invalidate() {} },
    entrance: { current: { id: 'hook', token: 9 }, cancel(token) { cancelled.push(token); } }, clearTimeout() {}, broadcast() {}, sendDiagnostic: () => 'fixed observer status',
    observedInvalidationScope: (context, pending, current) => ({ pending: context?.presentationMode === 'observed-chat' && pending === context, current: context?.presentationMode === 'observed-chat' && context.eventId === current?.id }) };
  const fn = vm.runInNewContext('(' + body + ')', globals); fn('observer-unavailable');
  assert.equal(globals.entranceCancellation, 10); assert.equal(globals.pendingPresentation.eventId, 'hook'); assert.deepEqual(cancelled, []);
  globals.displayContext = { eventId: 'chat', presentationMode: 'observed-chat' }; globals.entrance.current = { id: 'chat', token: 8 }; fn('geometry-changed');
  assert.deepEqual(cancelled, [8]); assert.equal(globals.pendingPresentation.eventId, 'hook'); assert.equal(globals.entranceCancellation, 10);
});
