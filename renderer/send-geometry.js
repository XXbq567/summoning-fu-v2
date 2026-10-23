/* Pure overlay-local geometry. Host positioning and DIP conversion happen once. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualSendGeometry = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Existing SVG viewport and visible paper bounds; never include its margins
  // when aligning the paper point to the observed send-button center.
  const viewport = Object.freeze({ width: 360, height: 760 });
  const paper = Object.freeze({ x: 48, y: 20, width: 264, height: 710 });
  // 50-DIP tongues can gain up to ~6 DIP from the library's vertex puff.
  const burnOutsetDIP = 56;
  function validRect(rect) {
    return rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
      && rect.width > 0 && rect.height > 0
      && Number.isFinite(rect.x + rect.width) && Number.isFinite(rect.y + rect.height);
  }
  function geometryAt(frame, geometry) {
    if (!frame || frame.kind !== 'entrance' || !geometry || !validRect(geometry.originRect) || !validRect(geometry.targetRect)) return null;
    const progress = frame.progress;
    if (!progress || !['travel', 'stretchX', 'stretchY'].every(key => Number.isFinite(progress[key]) && progress[key] >= 0 && progress[key] <= 1)) return null;
    const { originRect: origin, targetRect: target } = geometry;
    // Allow host rounding to a DIP without accepting a distorted final viewport.
    if (Math.abs(target.width / target.height - viewport.width / viewport.height) > .001) return null;
    const paperWidth = target.width * paper.width / viewport.width;
    const paperHeight = target.height * paper.height / viewport.height;
    if (paperWidth < 6 || paperHeight < 6) return null;
    const centerX = (paper.x + paper.width / 2) / viewport.width;
    const centerY = (paper.y + paper.height / 2) / viewport.height;
    const fromX = origin.x + origin.width / 2, fromY = origin.y + origin.height / 2;
    const toX = target.x + target.width * centerX, toY = target.y + target.height * centerY;
    const dx = toX - fromX, dy = toY - fromY;
    // A single gentle arc, bounded to 3.5% of travel, with exact endpoints.
    const bend = progress.travel === 0 || progress.travel === 1 ? 0 : Math.sin(Math.PI * progress.travel) * .035;
    const x = fromX + dx * progress.travel - dy * bend;
    const y = fromY + dy * progress.travel + dx * bend;
    const scaleX = 6 / paperWidth + (1 - 6 / paperWidth) * progress.stretchX;
    const scaleY = 6 / paperHeight + (1 - 6 / paperHeight) * progress.stretchY;
    const result = {
      translateX: x - target.x - target.width * centerX * scaleX,
      translateY: y - target.y - target.height * centerY * scaleY,
      scaleX, scaleY,
      // The complete paper silhouette is revealed through its blank-paper
      // transform; applying a second clip/scale would shrink the point twice.
      paperReveal: 1,
    };
    return Object.values(result).every(Number.isFinite) ? Object.freeze(result) : null;
  }
  function canvasBoundsAt(frame, geometry) {
    if (!geometryAt(frame, geometry)) return null;
    const { originRect: o, targetRect: t } = geometry;
    const paperW = t.width * paper.width / viewport.width, paperH = t.height * paper.height / viewport.height;
    const fromX = o.x + o.width / 2, fromY = o.y + o.height / 2;
    const x = Math.min(t.x - 24, fromX - paperW * .6);
    const y = Math.min(t.y - (frame.phase === 'burning' ? burnOutsetDIP : 24), fromY - paperH * .2);
    const right = Math.max(t.x + t.width + 24, fromX + paperW * .6);
    const bottom = Math.max(t.y + t.height + 24, fromY + paperH * .2);
    return Object.freeze({ x, y, width: Math.ceil(right - x), height: Math.ceil(bottom - y) });
  }
  return Object.freeze({ geometryAt, canvasBoundsAt, burnOutsetDIP });
});
