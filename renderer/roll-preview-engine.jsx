import React, { useLayoutEffect } from 'react';
import { createRoot, extend } from '@react-three/fiber';
import * as THREE from 'three';
import { PaperMesh, getBehavior } from 'paperlab';
import { gsap } from 'gsap';
import sessionModule from './paperlab-session.js';
import rollMotion from './roll-motion.js';

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

async function prepareRoll(container, metadata, textureMode, artwork) {
  const art = await artwork(metadata), extraTextures = [];
  let front;
  try { front = textureMode === 'bands' ? bandTexture(art.blank) : art.full; if (front !== art.full) extraTextures.push(front); }
  catch (error) { art.blank.dispose(); art.full.dispose(); throw error; }
  const textures = [art.blank, art.full, ...extraTextures];
  // CPU artwork is decoded once, before readiness; evidence polling must not
  // rasterize/read pixels or consume the visible presentation's frame budget.
  const textureHash = front.image?.getContext
    ? hash(front.image.getContext('2d').getImageData(0, 0, front.image.width, front.image.height).data)
    : art.textureHash;
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
  let geometryDisposals = 0, materialDisposals = 0, prewarmMs = 0;
  let timeline = null, currentFrame = rollMotion.frameAt(0), meshState = {};
  const clock = { elapsedMs: 0 }, root = new THREE.Group(); root.name = 'roll-fixed-flat-origin';
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
        frontTextureId: material.uniforms.uFrontMap?.value?.uuid || null, backTextureId: material.uniforms.uBackMap?.value?.uuid || null,
        backSource: material.uniforms.uBackMap?.value === art.blank ? 'generated-blank-paper' : 'unknown' },
    };
  }
  function getState() {
    return { engine: 'paperlab', libraryVersion: '0.8.1', mode: 'roll-inspection', materialReady: ready && !dead && !error,
      phase: !visible ? 'hidden' : currentFrame.phase, generation, canvasVisible: visible && !dead,
      ...currentFrame, ...(!visible ? { phase: 'hidden' } : {}),
      actualDrawCount: draws, actualClearCount: clears, prewarmMs, metadataHash: art.metadataHash,
      textureHash,
      textureMode, textureRasterizations: textures.length, viewport: { width, height, paperWidthDIP },
      ...meshState, resources: { ownedTextures: textures.length, disposedTextures: texturesDisposed, geometryDisposals, materialDisposals },
      error: dead ? 'disposed' : error };
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
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
      compile(shader, gl); shader.uniforms.ritualArtAlpha = { value: art.blank };
      shader.fragmentShader = 'uniform sampler2D ritualArtAlpha;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>',
        'diffuseColor.a *= texture2D(ritualArtAlpha, vPaperUv).a;\n#include <alphatest_fragment>');
    };
    material.customProgramCacheKey = () => 'ritual-roll-original-alpha-v1';
    material.transparent = true; material.alphaTest = .01; material.depthWrite = true; material.depthTest = true; material.needsUpdate = true;
    material.uniforms.uFrontMap.value = front; material.uniforms.uBackMap.value = art.blank; material.uniforms.uOpacity.value = 1;
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
      const sample = rollMotion.frameAt(frame.elapsedMs), key = `${generation}:${sample.elapsedMs}`;
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
  const metadata = JSON.parse(JSON.stringify(options.metadata || {}));
  let engine = null;
  const session = rollMotion.createPreviewSession(async () => {
    engine = await prepareRoll(container, metadata, textureMode, artwork); return engine;
  }, createSession, { mode: 'roll-inspection', textureMode });
  return { ready: session.ready, render: session.render, dispose: session.dispose,
    getState() {
      const sessionState = session.getState(), state = engine?.getState();
      return Object.freeze({ ...sessionState, ...(state || {}), error: sessionState.error,
        ...(sessionState.error ? { materialReady: false, canvasVisible: false, phase: 'hidden' } : {}) });
    } };
}
