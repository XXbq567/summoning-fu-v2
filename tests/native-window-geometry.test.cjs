'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let Geometry; try { Geometry = require('../desktop/native-window-geometry.cjs'); } catch {}
const requested = { x: 1422, y: 250, width: 626, height: 902 };
const actual = { x: 1422, y: 250, width: 627, height: 903 };
test('one own setBounds accepts the exact measured 1.25 DPI roundtrip without modifying logical layout', () => {
  assert.equal(typeof Geometry?.ownNativeBounds, 'function');
  const receipt = Geometry.ownNativeBounds(requested, actual, actual);
  assert.ok(receipt); assert.deepEqual(receipt.requested, requested); assert.deepEqual(receipt.actual, actual);
  assert.equal(receipt.mode, 'native-roundtrip-expansion'); assert.ok(Object.isFrozen(receipt));
  assert.equal(Geometry.nativeBoundsMatch(receipt, requested, actual), true);
  assert.equal(Geometry.nativeBoundsMatch(receipt, requested, { ...actual, x: actual.x + 1 }), false);
  assert.equal(Geometry.nativeBoundsMatch(receipt, requested, { ...actual, width: actual.width + 1 }), false);
  assert.equal(Geometry.nativeBoundsMatch(receipt, { ...requested, y: requested.y + 1 }, actual), false);
});
test('pixel rounding is not a general movement or size tolerance and is never applied recursively', () => {
  assert.equal(typeof Geometry?.ownNativeBounds, 'function');
  assert.equal(Geometry.ownNativeBounds(requested, actual, requested), null, 'a one-DIP difference without the actual screen roundtrip is rejected');
  for (const bad of [{ ...actual, x: actual.x + 1 }, { ...actual, y: actual.y - 1 }, { ...actual, width: 625 }, { ...actual, height: 904 }, { ...actual, width: 628 }, { ...actual, width: Infinity }]) assert.equal(Geometry.ownNativeBounds(requested, bad, bad), null);
  const recursive = { ...actual, width: 629, height: 905 };
  assert.equal(Geometry.ownNativeBounds(actual, recursive, recursive), null);
  assert.equal(Geometry.ownNativeBounds(requested, requested, null).mode, 'exact');
});
