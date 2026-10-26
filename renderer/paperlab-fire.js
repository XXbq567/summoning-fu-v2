/* Bounded structural DamageField adapter for recorded, seekable fire. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualPaperlabFire = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function syncFireField(source, enabled) {
    source.data ||= new Float32Array(source.pixels.length);
    source.frontCells ||= new Int32Array(source.size * source.size);
    source.frontCount = 0;
    for (let i = 0; i < source.pixels.length; i++) source.data[i] = source.pixels[i] / 255;
    const size = source.size, data = source.data;
    if (enabled) for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const cell = y * size + x, i = cell * 4;
      if (data[i + 2] < .22 || data[i + 3] < .5) continue;
      if ([cell - 1, cell + 1, cell - size, cell + size].every(n => data[n * 4 + 3] >= .5)) continue;
      source.frontCells[source.frontCount++] = cell;
    }
    source.lastStats = { front: source.frontCount / (size * size) };
    return source;
  }
  // Float32 storage can round a capped world height just above the DIP cap.
  // The reported range remains exact so strict host evidence is not lost.
  function measureFlameHeightDIP(worldHeight, paperWidth) { return Math.min(50, Math.max(0, worldHeight * paperWidth)); }
  function limitFlameInstances(geometry, enabled) {
    geometry.instanceCount = enabled && Number.isFinite(geometry.instanceCount) ? Math.min(16, Math.max(0, Math.trunc(geometry.instanceCount))) : 0;
  }
  return Object.freeze({ syncFireField, measureFlameHeightDIP, limitFlameInstances });
});
