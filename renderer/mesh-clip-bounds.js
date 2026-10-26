/* CPU geometry evidence only; this neither clips a renderer nor reads pixels. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualMeshClipBounds = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function visibleBounds(positions, indices, distanceToPlane, project) {
    if (!Array.isArray(positions) || !indices || indices.length % 3 !== 0 || typeof distanceToPlane !== 'function' || typeof project !== 'function') throw new TypeError('indexed clipping requires positions, triangle indices, a plane and a projection');
    const used = new Set();
    for (const index of indices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= positions.length) throw new RangeError('invalid triangle index');
      used.add(index);
    }
    const distances = new Map();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, retainedVertexCount = 0;
    function include(point) {
      const projected = project(point);
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) throw new TypeError('finite projected geometry required');
      minX = Math.min(minX, projected.x); minY = Math.min(minY, projected.y);
      maxX = Math.max(maxX, projected.x); maxY = Math.max(maxY, projected.y);
    }
    for (const index of used) {
      const point = positions[index];
      if (!point || !['x', 'y', 'z'].every(key => Number.isFinite(point[key]))) throw new TypeError('finite world positions required');
      const distance = distanceToPlane(point);
      if (!Number.isFinite(distance)) throw new TypeError('finite plane distance required');
      distances.set(index, distance);
      if (distance >= 0) { retainedVertexCount++; include(point); }
    }
    const crossingEdges = new Set();
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      for (let side = 0; side < 3; side++) {
        const start = indices[triangle + side], end = indices[triangle + (side + 1) % 3];
        const firstDistance = distances.get(start), secondDistance = distances.get(end);
        if (!((firstDistance > 0 && secondDistance < 0) || (firstDistance < 0 && secondDistance > 0))) continue;
        const key = start < end ? start + ':' + end : end + ':' + start;
        if (crossingEdges.has(key)) continue;
        crossingEdges.add(key);
        // Actual indexed triangle edges meet the actual WORLD clipping plane.
        // Project the 3D intersection afterwards, valid for either camera type.
        const fraction = firstDistance / (firstDistance - secondDistance), a = positions[start], b = positions[end];
        include({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction });
      }
    }
    return { bounds: minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      retainedVertexCount, intersectionCount: crossingEdges.size, source: 'cpu-clipped-indexed-triangles' };
  }
  return Object.freeze({ visibleBounds });
});
