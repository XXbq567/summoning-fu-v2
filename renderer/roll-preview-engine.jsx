import React, { useLayoutEffect } from 'react';
import { createRoot, extend } from '@react-three/fiber';
import * as THREE from 'three';
import { PaperMesh, getBehavior } from 'paperlab';
import { gsap } from 'gsap';
import sessionModule from './paperlab-session.js';
import rollMotion from './roll-motion.js';
import backface from './paper-backface.js';

extend(THREE);
const { createSession } = sessionModule;
export { rollMotion };
const fail = code => Object.assign(new Error(code), { code });
function hash(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let result = 2166136261;
  for (const byte of bytes) result = Math.imul(result ^ byte, 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}
function timeout(promise, milliseconds, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(fail(code)), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
function bandTexture(blank) {
  const canvas = document.createElement('canvas'); canvas.width = 528; canvas.height = 1420;
  const ctx = canvas.getContext('2d'); if (!ctx) throw fail('texture-failed');
  const colors = ['#c3636a', '#d59b59', '#d5c86a', '#76a98a', '#69a2b9', '#9a86b5'];
  const labels = ['TOP', '1', '2', '3', '4', 'BOTTOM'];
  for (let i = 0; i < 6; i++) {
    const top = i * canvas.height / 6;
    ctx.fillStyle = colors[i]; ctx.fillRect(0, top, canvas.width, canvas.height / 6 + 1);
    ctx.fillStyle = '#211b20'; ctx.font = 'bold 40px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(labels[i], 32, top + canvas.height / 12);
  }
  ctx.strokeStyle = '#22202b'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(352, 0); ctx.lineTo(352, canvas.height); ctx.stroke();
  // Reuse the actual paper silhouette. This masks the paper's outer shape,
  // never the moving roll front: all six bands remain on the same mesh.
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(blank.image, 0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
function rgba(texture) {
  const image = texture.image, ctx = image?.getContext?.('2d');
  if (!ctx) throw fail('texture-failed');
  return { width: image.width, height: image.height, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
}
function pixelTexture(pixels, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw fail('texture-failed');
  const image = ctx.createImageData(width, height); image.data.set(pixels); ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
function innerInkTexture(front, color) {
  const { width, height, pixels } = rgba(front), changed = pixels.slice(), rgb = color === 'cyan' ? [0, 255, 255] : [255, 0, 255];
  // Only the first 20% of paper wound into the core changes in this explicit
  // static QA fixture. The outer printed area and every alpha remain intact.
  for (let y = Math.ceil(height * .8); y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    if (changed[offset + 3] !== 0) changed.set(rgb, offset);
  }
  return pixelTexture(changed, width, height);
}
function checkerTexture(color) {
  const width = 64, height = 64, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const light = ((x >> 4) + (y >> 4)) % 2;
    pixels.set(color === 'red' ? [light ? 255 : 180, light ? 28 : 0, light ? 48 : 12, 255] : [light ? 25 : 0, light ? 25 : 0, light ? 25 : 0, 255], (y * width + x) * 4);
  }
  return pixelTexture(pixels, width, height);
}

async function prepareRoll(container, metadata, textureMode, artwork, backsideInkStrength, inspection) {
  const art = await artwork(metadata), extraTextures = [];
  let front, back, backdropTexture;
  try {
    front = textureMode === 'bands' ? bandTexture(art.blank) : art.full;
    if (front !== art.full) extraTextures.push(front);
    if (inspection?.innerInk && inspection.innerInk !== 'original') { front = innerInkTexture(front, inspection.innerInk); extraTextures.push(front); }
    const source = rgba(front), paper = rgba(art.blank);
    if (source.width !== paper.width || source.height !== paper.height) throw fail('texture-failed');
    const input = { width: source.width, height: source.height, front: source.pixels, blank: paper.pixels };
    if (inspection?.shader === 'paper-reference') back = art.blank;
    else {
      const pixels = inspection?.shader === 'ink-reference' ? backface.createInkReferencePixels(input) : backface.createBackPixels(input, backsideInkStrength);
      back = pixelTexture(pixels, source.width, source.height); extraTextures.push(back);
    }
    if (inspection?.behind !== undefined && inspection.behind !== 'none') { backdropTexture = checkerTexture(inspection.behind); extraTextures.push(backdropTexture); }
  } catch (error) { for (const texture of [art.blank, art.full, ...extraTextures]) texture.dispose(); throw error; }
  const textures = [art.blank, art.full, ...extraTextures];
  // CPU artwork is decoded once, before readiness; evidence polling must not
  // rasterize/read pixels or consume the visible presentation's frame budget.
  const textureHash = front.image?.getContext
    ? hash(front.image.getContext('2d').getImageData(0, 0, front.image.width, front.image.height).data)
    : art.textureHash;
  const backTextureHash = hash(rgba(back).pixels);
  let texturesDisposed = 0;
  for (const texture of textures) texture.addEventListener('dispose', () => { texturesDisposed++; });
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.rollPreview = 'bottom-up-paperlab-0.8.1';
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', display: 'none' });
  const bounds = container.getBoundingClientRect();
  const width = Math.max(160, Math.min(3000, Math.round(bounds.width || 420)));
  const height = Math.max(240, Math.min(3000, Math.round(bounds.height || 760)));
  const fullRadius = rollMotion.frameAt(rollMotion.durationMs).radius;
  const paperWidthDIP = Math.min(264, (height - 64) / (rollMotion.sheet.height + 2 * fullRadius), width - 64);
  container.append(canvas);
  let renderer, fiber, rootState, handle, material, mesh, dead = false, error = null, ready = false;
  let draws = 0, clears = 0, hasPixels = false, visible = false, lastKey = null, generation = null;
  let geometryDisposals = 0, materialDisposals = 0, prewarmMs = 0, shaderEvidence = {};
  const compiledMaterialSides = new Set(), extraResources = [];
  let timeline = null, currentFrame = rollMotion.frameAt(0), meshState = {};
  const clock = { elapsedMs: 0 }, root = new THREE.Group(); root.name = 'roll-fixed-flat-origin';
  if (inspection?.pose === 'back') root.rotation.y = Math.PI;
  if (inspection?.pose === 'side') root.rotation.y = Math.PI / 2 - .035;
  const inspectionElapsedMs = inspection?.pose === 'half' ? rollMotion.chapterElapsed('half')
    : inspection?.pose === 'rolled' ? rollMotion.chapterElapsed('rolled') : 0;
  let backdrop = null;
  if (backdropTexture) {
    const geometry = new THREE.PlaneGeometry(rollMotion.sheet.width * 1.3, rollMotion.sheet.height * 1.1);
    const material = new THREE.MeshBasicMaterial({ map: backdropTexture, toneMapped: false });
    backdrop = new THREE.Mesh(geometry, material); backdrop.position.z = -.65; extraResources.push(geometry, material);
  }
  const topReference = new THREE.Vector3(), scratch = new THREE.Vector3();
  let topIndex = -1, uvInitialHash = null;
  const compiledBehavior = getBehavior('unroll');
  const hidden = () => {
    visible = false; root.visible = false; canvas.style.display = 'none';
    if (hasPixels && renderer && !renderer.getContext().isContextLost()) { renderer.clear(); clears++; }
    hasPixels = false; lastKey = null;
    timeline?.kill(); timeline = null; gsap.ticker.sleep();
  };
  function dispose() {
    if (dead) return; dead = true; hidden(); ready = false;
    canvas.removeEventListener('webglcontextlost', lost);
    fiber?.unmount();
    for (const resource of extraResources) resource.dispose();
    for (const texture of textures) texture.dispose();
    renderer?.dispose(); canvas.remove();
  }
  function lost(event) { event.preventDefault(); error = 'context-lost'; hidden(); ready = false; }
  canvas.addEventListener('webglcontextlost', lost);
  function geometryEvidence() {
    const geometry = mesh.geometry, position = geometry.attributes.position, uv = geometry.attributes.uv, normals = geometry.attributes.normal;
    mesh.updateWorldMatrix(true, false);
    let measuredWoundFraction = 0, zMax = -Infinity, zMin = Infinity, finiteNormals = true;
    for (let i = 0; i < position.count; i++) {
      const originalY = (uv.getY(i) - .5) * rollMotion.sheet.height;
      if (Math.hypot(position.getY(i) - originalY, position.getZ(i)) > 1e-6) measuredWoundFraction = Math.max(measuredWoundFraction, uv.getY(i));
      zMin = Math.min(zMin, position.getZ(i)); zMax = Math.max(zMax, position.getZ(i));
    }
    for (const value of normals.array) { if (!Number.isFinite(value)) { finiteNormals = false; break; } }
    scratch.fromBufferAttribute(position, topIndex).applyMatrix4(mesh.matrixWorld);
    const options = compiledBehavior.optionsSchema.parse({ ...rollMotion.behavior, progress: handle.getProgress() });
    const actualRoll = compiledBehavior.stack(options, rollMotion.sheet)[0].options;
    const surfaceSamples = [1, 5 / 6, 4 / 6, 3 / 6, 2 / 6, 1 / 6, 0].map(v => {
      const point = handle.surfacePoint(.5, v, new THREE.Vector3());
      return { v, point: point?.toArray() || null };
    });
    return {
      meshId: mesh.uuid, geometryId: geometry.uuid, vertexCount: position.count,
      geometryPositionHash: hash(position.array), uvHash: hash(uv.array), uvInitialHash, finiteNormals,
      topPoint: scratch.toArray(), topInitialPoint: topReference.toArray(), topDriftDIP: scratch.distanceTo(topReference) * paperWidthDIP,
      measuredWoundFraction, rollFrontLocalY: (measuredWoundFraction - .5) * rollMotion.sheet.height,
      sampledRadius: (zMax - zMin) / 2, paperlabRadius: actualRoll.radius, paperlabBoundary: actualRoll.boundary, surfaceSamples,
      rootPosition: root.position.toArray(), rootRotation: [root.rotation.x, root.rotation.y, root.rotation.z], rootScale: root.scale.toArray(),
      cameraPosition: rootState.camera.position.toArray(), cameraQuaternion: rootState.camera.quaternion.toArray(), cameraProjectionHash: hash(new Float32Array(rootState.camera.projectionMatrix.elements)),
      material: { side: material.side, depthWrite: material.depthWrite, depthTest: material.depthTest, alphaTest: material.alphaTest,
        opacity: material.uniforms.uOpacity?.value ?? material.opacity, showThrough: material.uniforms.uShowThrough?.value ?? null,
        translucency: material.uniforms.uTranslucency?.value ?? null, forceSinglePass: material.forceSinglePass, backsideInkStrength,
        frontTextureId: material.uniforms.uFrontMap?.value?.uuid || null, backTextureId: material.uniforms.uBackMap?.value?.uuid || null,
        backSource: material.uniforms.uBackMap?.value === back ? (inspection?.shader === 'ink-reference' ? 'inspection-full-ink-reference' : inspection?.shader === 'paper-reference' ? 'inspection-direct-paper-reference' : 'generated-paper-with-ink-difference') : 'unknown',
        clippingPlanes: material.clippingPlanes?.map(plane => ({ normal: plane.normal.toArray(), constant: plane.constant })) || [],
        ...shaderEvidence, compiledMaterialSides: [...compiledMaterialSides] },
    };
  }
  function getState() {
    return { engine: 'paperlab', libraryVersion: '0.8.1', mode: 'roll-inspection', materialReady: ready && !dead && !error,
      phase: !visible ? 'hidden' : currentFrame.phase, generation, canvasVisible: visible && !dead,
      ...currentFrame, ...(!visible ? { phase: 'hidden' } : {}),
      actualDrawCount: draws, actualClearCount: clears, prewarmMs, metadataHash: art.metadataHash,
      textureHash,
      frontTextureHash: textureHash, backTextureHash, backsideInkStrength, materialAdapter: backface.adapter, inspection,
      needsAnimation: inspection ? false : currentFrame.needsAnimation,
      textureMode, textureRasterizations: textures.length, viewport: { width, height, paperWidthDIP },
      ...meshState, resources: { ownedTextures: textures.length, disposedTextures: texturesDisposed, geometryDisposals, materialDisposals },
      error: dead ? 'disposed' : error };
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.localClippingEnabled = true;
    renderer.debug.onShaderError = () => { error = 'render-failed'; };
    fiber = createRoot(canvas);
    await fiber.configure({ gl: renderer, flat: true, linear: false, frameloop: 'never', dpr: Math.min(2, globalThis.devicePixelRatio || 1),
      size: { width, height, top: 0, left: 0 }, orthographic: true,
      camera: { position: [0, 0, 10], near: .01, far: 30, zoom: paperWidthDIP }, onCreated: value => { rootState = value; } });
    let committed;
    const mounted = new Promise(resolve => { committed = resolve; });
    function Ready() { useLayoutEffect(() => { committed(); }, []); return null; }
    fiber.render(<>
      <ambientLight intensity={Math.PI * .64} />
      <directionalLight position={[-3, 3, 7]} intensity={Math.PI * .48} />
      {backdrop ? <primitive object={backdrop} /> : null}
      <primitive object={root}>
        <PaperMesh ref={value => { handle = value; }} sheet={rollMotion.sheet} stock="printer"
          content={{ type: 'blank', back: { type: 'blank' } }} scene={{ turn: 0 }}
          surface={{ grain: 0, aging: 0, showThrough: 0, translucency: 0 }} memory={{ set: 0, creases: [] }}
          behavior={rollMotion.behavior} physics="none" autoplay={false} reducedMotion={false} interactive={false} stateTriggers={false} />
      </primitive><Ready />
    </>);
    await timeout(mounted, 5000, 'webgl-unavailable');
    for (let i = 0; i < 200 && (!handle?.mesh?.material?.uniforms?.uFrontMap?.value || !handle?.mesh?.material?.uniforms?.uBackMap?.value); i++) await new Promise(resolve => setTimeout(resolve, 10));
    mesh = handle?.mesh; material = mesh?.material;
    if (!material?.uniforms?.uFrontMap || !material?.uniforms?.uBackMap || !rootState) throw fail('webgl-unavailable');
    mesh.geometry.addEventListener('dispose', () => { geometryDisposals++; });
    material.addEventListener('dispose', () => { materialDisposals++; });
    const compile = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, gl) => {
      compile(shader, gl);
      const compiledFacingBranch = shader.fragmentShader.includes('if (gl_FrontFacing)');
      const compiledBackSampler = shader.fragmentShader.includes('texture2D(uBackMap, vec2(1.0 - vPaperUv.x, vPaperUv.y)).rgb');
      if (!compiledFacingBranch || !compiledBackSampler || !shader.uniforms.uFrontMap || !shader.uniforms.uBackMap) throw fail('render-failed');
      if (inspection?.shader === 'paper-reference') {
        // Independent baseline: raw original paper, bypassing the back-image
        // compositor entirely. Sample physical UV directly to match the net
        // preflip + Paperlab flip in production's zero-strength back map.
        shader.fragmentShader = shader.fragmentShader.replace('texture2D(uBackMap, vec2(1.0 - vPaperUv.x, vPaperUv.y)).rgb', 'texture2D(uBackMap, vPaperUv).rgb');
      }
      shader.uniforms.ritualArtAlpha = { value: art.blank };
      shader.fragmentShader = 'uniform sampler2D ritualArtAlpha;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>',
        'diffuseColor.a *= texture2D(ritualArtAlpha, vPaperUv).a;\n#include <alphatest_fragment>');
      if (inspection?.shader === 'facing' || inspection?.shader === 'uv') {
        const anchor = '#include <colorspace_fragment>';
        if (!shader.fragmentShader.includes(anchor)) throw fail('render-failed');
        const color = inspection.shader === 'facing' ? '(gl_FrontFacing ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0))' : 'vec3(vPaperUv, gl_FrontFacing ? 1.0 : 0.0)';
        // Diagnostic values are final normalized display bytes, NOT sRGB-
        // encoded UVs. Original alpha and clipping have already run unchanged.
        shader.fragmentShader = shader.fragmentShader.replace(anchor, anchor + '\ngl_FragColor.rgb = ' + color + ';');
      }
      compiledMaterialSides.add(material.side);
      shaderEvidence = { compiledFacingBranch, compiledBackSampler, compiledBackSamplerMode: inspection?.shader === 'paper-reference' ? 'physical-uv-paper-reference' : 'paperlab-back-flip-compensated', compiledShaderHash: hash(shader.fragmentShader),
        compiledFrontTextureId: shader.uniforms.uFrontMap.value?.uuid || null, compiledBackTextureId: shader.uniforms.uBackMap.value?.uuid || null };
    };
    material.customProgramCacheKey = () => 'ritual-roll-backface-v1-' + (inspection?.shader || 'art');
    material.transparent = true; material.alphaTest = .01; material.depthWrite = true; material.depthTest = true; material.needsUpdate = true;
    backface.configureFacing(material, { legacyDoublePass: inspection?.legacyDoublePass || false });
    if (!material.uniforms.uShowThrough || !material.uniforms.uTranslucency) throw fail('render-failed');
    material.uniforms.uFrontMap.value = front; material.uniforms.uBackMap.value = back; material.uniforms.uOpacity.value = 1;
    material.uniforms.uShowThrough.value = 0; material.uniforms.uTranslucency.value = 0;
    if (inspection?.clip === 'lower-half') material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
    const uv = mesh.geometry.attributes.uv;
    uvInitialHash = hash(uv.array);
    let distance = Infinity;
    for (let i = 0; i < uv.count; i++) { const candidate = Math.abs(uv.getX(i) - .5) + Math.abs(uv.getY(i) - 1); if (candidate < distance) { distance = candidate; topIndex = i; } }
    const warmingAt = performance.now();
    // Compile and touch actual terminal curvature while hidden; return to the
    // equivalent flat pose before readiness. No presentation time is consumed.
    for (const elapsedMs of [rollMotion.durationMs, 0]) {
      handle.set('progress', rollMotion.frameAt(elapsedMs).progress); root.visible = true;
      rootState.advance(elapsedMs / 1000, false); draws++; hasPixels = true;
    }
    await timeout(renderer.compileAsync(rootState.scene, rootState.camera), 15000, 'webgl-unavailable');
    renderer.getContext().finish();
    mesh.updateWorldMatrix(true, false); topReference.fromBufferAttribute(mesh.geometry.attributes.position, topIndex).applyMatrix4(mesh.matrixWorld);
    meshState = geometryEvidence(); prewarmMs = performance.now() - warmingAt;
    if (error) throw fail(error);
    hidden(); ready = true;
    function render(frame) {
      if (dead || error || !ready) { hidden(); return; }
      generation = frame.generation;
      if (frame.visible !== true) { hidden(); return; }
      const sample = rollMotion.frameAt(inspection ? inspectionElapsedMs : frame.elapsedMs), key = `${generation}:${sample.elapsedMs}`;
      if (key === lastKey && visible) return;
      if (!timeline) {
        clock.elapsedMs = 0;
        timeline = gsap.timeline({ paused: true }).to(clock, { elapsedMs: rollMotion.durationMs, duration: rollMotion.durationMs / 1000, ease: 'none' });
      }
      timeline.time(sample.elapsedMs / 1000, true); gsap.ticker.sleep();
      currentFrame = rollMotion.frameAt(clock.elapsedMs);
      handle.set('progress', currentFrame.progress);
      root.visible = true; canvas.style.display = 'block'; visible = true;
      rootState.advance(currentFrame.elapsedMs / 1000, false); draws++; hasPixels = true;
      meshState = geometryEvidence(); lastKey = key;
      if (error) { hidden(); throw fail(error); }
    }
    return { render, getState, hide: hidden, dispose };
  } catch (failure) { dispose(); throw fail(failure.code || 'webgl-unavailable'); }
}

export function createRollPreviewView(container, options, artwork) {
  const textureMode = options.textureMode === 'talisman' ? 'talisman' : 'bands';
  const backsideInkStrength = backface.normalizeStrength(options.backsideInkStrength);
  const inspection = backface.normalizeInspection(options.materialInspection);
  const metadata = JSON.parse(JSON.stringify(options.metadata || {}));
  let engine = null;
  const session = rollMotion.createPreviewSession(async () => {
    engine = await prepareRoll(container, metadata, textureMode, artwork, backsideInkStrength, inspection); return engine;
  }, createSession, { mode: 'roll-inspection', textureMode });
  return { ready: session.ready, render: session.render, dispose: session.dispose,
    getState() {
      const sessionState = session.getState(), state = engine?.getState();
      return Object.freeze({ ...sessionState, ...(state || {}), error: sessionState.error,
        ...(sessionState.error ? { materialReady: false, canvasVisible: false, phase: 'hidden' } : {}) });
    } };
}
