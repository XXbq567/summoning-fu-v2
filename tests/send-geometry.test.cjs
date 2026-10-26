'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { frameAt } = require('../renderer/entrance-timeline.js');
let geometryAt;
try { ({ geometryAt } = require('../renderer/send-geometry.js')); } catch {}
const geometry = { originRect: { x: 880, y: 680, width: 40, height: 40 }, targetRect: { x: 340, y: 62, width: 320, height: 676 } };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);

test('delivery canvas encloses its planned path while the projected paper stays at the same screen point', () => {
  const { canvasBoundsAt } = require('../renderer/send-geometry.js');
  const target={targetId:'example',revision:1,rect:{x:800,y:800,width:80,height:80},coordinateSpace:'overlay-local-dip',source:'preview-example',valid:true,visible:true,observedAtMonotonicMs:0,expiresAtMonotonicMs:10000};
  const options={geometry,deliveryTarget:target,allowPreviewTarget:true,nowMs:100};
  const before = canvasBoundsAt(frameAt(1400), geometry);
  const frame=frameAt(7000,false,options),delivery=canvasBoundsAt(frame,geometry),planned=frame.delivery.plan.bounds;
  assert.equal(before.y, geometry.targetRect.y - 24);
  assert.ok(delivery.x<=planned.x&&delivery.y<=planned.y);
  assert.ok(delivery.x+delivery.width>=planned.x+planned.width&&delivery.y+delivery.height>=planned.y+planned.height);
  const paperW = geometry.targetRect.width * 264 / 360;
  const targetY = geometry.targetRect.y + geometry.targetRect.height * 375 / 760;
  for (const bounds of [before, delivery]) {
    const localWorldY = -(targetY - bounds.y - bounds.height / 2) / paperW;
    close(bounds.y + bounds.height / 2 - localWorldY * paperW, targetY);
  }
});

test('send geometry places an actual six-DIP paper point at the supplied send center and restores exact final geometry', () => {
  assert.equal(typeof geometryAt, 'function');
  const first = geometryAt(frameAt(0), geometry), target = geometry.targetRect;
  close(target.x + first.translateX + target.width * .5 * first.scaleX, 900);
  close(target.y + first.translateY + target.height * 375 / 760 * first.scaleY, 700);
  close(target.width * 264 / 360 * first.scaleX, 6);
  close(target.height * 710 / 760 * first.scaleY, 6);
  for (const time of [1950, 3050, 4150, 6149]) {
    const value = geometryAt(frameAt(time), geometry);
    close(value.translateX, 0); close(value.translateY, 0); close(value.scaleX, 1); close(value.scaleY, 1);
  }
});
test('send geometry unfolds blank paper, does not mutate frozen inputs or double-apply target positioning', () => {
  assert.equal(typeof geometryAt, 'function');
  const input = Object.freeze({ originRect: Object.freeze({ ...geometry.originRect }), targetRect: Object.freeze({ ...geometry.targetRect }) });
  const midway = geometryAt(frameAt(850), input);
  assert.equal(frameAt(850).writing, 0); assert.ok(midway.scaleX > 0 && midway.scaleX < 1); close(midway.scaleY, 1);
  close(input.targetRect.x + midway.translateX + input.targetRect.width * .5 * midway.scaleX, input.targetRect.x + input.targetRect.width / 2);
  assert.equal(geometryAt(frameAt(0), null), null);
  for (const bad of [{ ...input, originRect: { ...input.originRect, x: NaN } }, { ...input, targetRect: { ...input.targetRect, width: 0 } }, { ...input, originRect: { ...input.originRect, height: -1 } }]) assert.equal(geometryAt(frameAt(0), bad), null);
  assert.equal(geometryAt({ ...frameAt(500), progress: { travel: Infinity, stretchX: 0, stretchY: 0 } }, input), null);
});

test('send geometry follows a bounded gentle path and never deforms visible lettering', () => {
  assert.equal(typeof geometryAt, 'function');
  const target = geometry.targetRect;
  const start = { x: 900, y: 700 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height * 375 / 760 };
  const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy);
  for (let time = 0; time <= 1950; time += 20) {
    const frame = frameAt(time), value = geometryAt(frame, geometry);
    const x = target.x + value.translateX + target.width / 2 * value.scaleX;
    const y = target.y + value.translateY + target.height * 375 / 760 * value.scaleY;
    assert.ok(Math.abs(dx * (y - start.y) - dy * (x - start.x)) / distance <= distance * .08 + 1e-8);
    if (time <= 120) { close(x, start.x); close(y, start.y); }
    if (time >= 850) { close(x, end.x); close(y, end.y); }
    assert.ok(Object.values(value).every(Number.isFinite));
    if (frame.writing > 0) { close(value.scaleX, 1); close(value.scaleY, 1); }
  }
  for (const time of [1951, 3050, 4150, 6149]) {
    const value = geometryAt(frameAt(time), geometry);
    close(value.scaleX, 1); close(value.scaleY, 1);
  }
});

test('send geometry accepts negative local positions without guessing or clamping malformed data', () => {
  assert.equal(typeof geometryAt, 'function');
  const negative = { originRect: { x: -500, y: -400, width: 40, height: 40 }, targetRect: { x: -300, y: -200, width: 320, height: 676 } };
  const value = geometryAt(frameAt(0), negative);
  close(negative.targetRect.x + value.translateX + negative.targetRect.width / 2 * value.scaleX, -480);
  for (const bad of [undefined, {}, { ...geometry, targetRect: { x: 0, y: 0, width: 300, height: 300 } }, { ...geometry, originRect: { ...geometry.originRect, width: Infinity } }]) assert.equal(geometryAt(frameAt(0), bad), null);
  for (const progress of [{ travel: NaN, stretchX: 0, stretchY: 0 }, { travel: .5, stretchX: -1, stretchY: .5 }, { travel: .5, stretchX: .5, stretchY: 2 }]) assert.equal(geometryAt({ ...frameAt(500), progress }, geometry), null);
  assert.equal(geometryAt(null, geometry), null);
});
