/* Three locally hinged bands; no scheduler and no capture of other windows. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualFoldedPaper = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FOLD_MODEL = 'bottom-then-middle-nested-hinges';
  // BurnView reveals these original brush subpaths separately. Keeping that
  // same union in a texture avoids opposite-winding strokes cutting white
  // holes through each other at their intersections.
  function inkSubpaths(d) { return typeof d === 'string' ? d.match(/[Mm][^Mm]*/g) || [] : []; }
  function textureBands() { return Object.freeze([{ vMin: 2 / 3, vMax: 1 }, { vMin: 1 / 3, vMax: 2 / 3 }, { vMin: 0, vMax: 1 / 3 }].map(Object.freeze)); }
  function createFoldedPaper(THREE, { full, blank }) {
    const h = 710 / 264, bandH = h / 3, thickness = .0024;
    const root = new THREE.Group(), intakeRoot = new THREE.Group(), top = new THREE.Group(), middle = new THREE.Group(), bottom = new THREE.Group();
    root.name = 'delivery-flight'; intakeRoot.name = 'delivery-intake'; middle.name = 'middle-hinge'; bottom.name = 'bottom-hinge';
    root.add(intakeRoot); intakeRoot.add(top); middle.position.set(0, -bandH / 2, thickness * 2); intakeRoot.add(middle);
    bottom.position.set(0, -bandH, thickness * 2); middle.add(bottom);
    const resources = [], materials = [], plane = new THREE.Plane();
    const bands = textureBands();
    function material(map, side) {
      const m = new THREE.MeshBasicMaterial({ map, side, transparent: true, alphaTest: .01, toneMapped: false, depthWrite: true });
      m.clippingPlanes = []; materials.push(m); resources.push(m); return m;
    }
    function band(parent, centerY, uv, index) {
      const geometry = new THREE.PlaneGeometry(1, bandH, 1, 1), attribute = geometry.getAttribute('uv');
      for (let i = 0; i < attribute.count; i++) attribute.setY(i, uv.vMin + attribute.getY(i) * (uv.vMax - uv.vMin));
      attribute.needsUpdate = true; resources.push(geometry);
      // Separate one-sided materials are essential: the reverse never samples
      // the full ink texture, so no mirror lettering appears during a flip.
      const front = new THREE.Mesh(geometry, material(full, THREE.FrontSide));
      const back = new THREE.Mesh(geometry, material(blank, THREE.BackSide));
      front.position.y = back.position.y = centerY; front.name = `front-band-${index}`; back.name = `blank-back-${index}`;
      parent.add(front, back);
      const edgeMaterial = new THREE.MeshBasicMaterial({ map: blank, color: '#decfaf', transparent: true, alphaTest: .01, opacity: .6, toneMapped: false });
      edgeMaterial.clippingPlanes = []; resources.push(edgeMaterial); materials.push(edgeMaterial);
      for (const [y, v] of [[centerY - bandH / 2, uv.vMin], [centerY + bandH / 2, uv.vMax]]) {
        const edgeGeometry = new THREE.BoxGeometry(1, thickness, thickness * 1.25), edgeUV = edgeGeometry.getAttribute('uv'), positions = edgeGeometry.getAttribute('position');
        for (let i = 0; i < edgeUV.count; i++) edgeUV.setXY(i, positions.getX(i) + .5, v);
        edgeUV.needsUpdate = true; resources.push(edgeGeometry);
        const edge = new THREE.Mesh(edgeGeometry, edgeMaterial); edge.name = `paper-edge-${index}-${v}`; edge.position.set(0, y, 0); parent.add(edge);
      }
      const creaseGeometry = new THREE.PlaneGeometry(1, .022), creaseMaterial = new THREE.MeshBasicMaterial({ map: blank, color: '#4c3017', transparent: true, alphaTest: .01, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const creaseUV = creaseGeometry.getAttribute('uv'), creasePositions = creaseGeometry.getAttribute('position');
      for (let i = 0; i < creaseUV.count; i++) creaseUV.setXY(i, creasePositions.getX(i) + .5, uv.vMax + (creasePositions.getY(i) - .011) / h);
      creaseUV.needsUpdate = true;
      creaseMaterial.clippingPlanes = []; resources.push(creaseGeometry, creaseMaterial); materials.push(creaseMaterial);
      const crease = new THREE.Mesh(creaseGeometry, creaseMaterial); crease.position.set(0, centerY + bandH / 2 - .011, .001); parent.add(crease);
      return creaseMaterial;
    }
    const creases = [band(top, 0, bands[0], 0), band(middle, -bandH / 2, bands[1], 1), band(bottom, -bandH / 2, bands[2], 2)];
    root.visible = false;
    function apply(state, plan, bounds) {
      root.visible = state.phase !== 'hidden';
      root.position.set((state.position.x - bounds.x - bounds.width / 2) / plan.paperWidth, -(state.position.y - bounds.y - bounds.height / 2) / plan.paperWidth, .03);
      root.rotation.set(0, 0, -state.rotationZ); root.scale.setScalar(state.scale);
      intakeRoot.scale.set(state.scaleX, state.scaleY, 1);
      // The second hinge carries the already folded bottom. All local paper
      // dimensions stay constant throughout the fold.
      bottom.rotation.x = -Math.PI * state.foldBottom;
      middle.rotation.x = -Math.PI * state.foldMiddle;
      // Keep each folded layer on the front side of the receiving panel.
      bottom.position.z = thickness * 2 - Math.sin(Math.PI * state.foldMiddle / 2) * thickness * 6;
      creases[0].opacity = .07 * Math.sin(Math.PI * state.foldMiddle);
      creases[1].opacity = .08 * Math.max(Math.sin(Math.PI * state.foldBottom), Math.sin(Math.PI * state.foldMiddle));
      creases[2].opacity = .035 * state.foldBottom;
      if (state.clip.enabled) {
        // Keep world y ABOVE the fixed acceptance point. This plane remains
        // in target space while the packet passes through it tip first.
        const worldY = -(state.clip.point.y - bounds.y - bounds.height / 2) / plan.paperWidth;
        plane.set(new THREE.Vector3(0, 1, 0), -worldY);
      }
      for (const m of materials) {
        const clipped = m.clippingPlanes.length > 0;
        if (clipped !== state.clip.enabled) { m.clippingPlanes = state.clip.enabled ? [plane] : []; m.needsUpdate = true; }
      }
    }
    return { root, apply, hide() { root.visible = false; }, dispose() { root.visible = false; root.removeFromParent(); for (const item of resources) item.dispose(); } };
  }
  return Object.freeze({ FOLD_MODEL, inkSubpaths, textureBands, createFoldedPaper });
});
