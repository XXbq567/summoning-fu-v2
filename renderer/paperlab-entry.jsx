import React, { useLayoutEffect } from 'react';
import { createRoot, extend, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PaperMesh } from 'paperlab';
import { gsap } from 'gsap';
import fontDataURL from '../assets/fonts/MaShanZheng-Regular.ttf';
import sessionModule from './paperlab-session.js';
import deliveryModule from './delivery-motion.js';
import foldedModule from './folded-paper.js';
import { createRollPreviewView, createRollDeliveryView, rollMotion } from './roll-preview-engine.jsx';
import backfaceModule from './paper-backface.js';
import providerSealModule from './provider-seal-view.js';

extend(THREE);
const { createSession } = sessionModule;
const { inkSubpaths } = foldedModule;
// GSAP's seek API wakes its shared ticker even for a paused timeline. This
// view owns no autonomous GSAP playback, so every seek immediately sleeps it.
gsap.ticker.sleep();
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => x * x * (3 - 2 * x);
const fail = code => Object.assign(new Error(code), { code });
let fontReady;
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); }
function timeout(promise, ms, code) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(fail(code)), ms); promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); }); });
}
async function artwork(metadata) {
  fontReady ||= (async () => { const face = new FontFace('FuBrush', `url(${fontDataURL})`); await face.load(); document.fonts.add(face); })();
  await timeout(fontReady, 10000, 'texture-failed');
  // Fresh Core output has no live writing or burn masks and embeds the actual
  // bundled brush font. SVG decoding cannot inherit a page's CSS font face.
  const source = globalThis.RitualCore.buildTalismanSVG(metadata, { idPrefix: 'paperlab-art', fontDataURL });
  const full = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  if (full.querySelector('parsererror')) throw fail('texture-failed');
  for (const original of full.querySelectorAll('[data-writing-order] path')) {
    const parts = inkSubpaths(original.getAttribute('d'));
    if (parts.length < 2) continue;
    const fragment = full.ownerDocument.createDocumentFragment();
    for (const d of parts) { const path = original.cloneNode(false); path.setAttribute('d', d); fragment.append(path); }
    original.replaceWith(fragment);
  }
  full.setAttribute('viewBox', '48 20 264 710'); full.setAttribute('width', '528'); full.setAttribute('height', '1420');
  const blank = full.cloneNode(true);
  for (const group of blank.querySelectorAll('[data-writing-order]')) group.remove();
  async function decode(svg) {
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await timeout(image.decode(), 10000, 'texture-failed');
    const canvas = document.createElement('canvas'); canvas.width = 528; canvas.height = 1420;
    const ctx = canvas.getContext('2d'); if (!ctx) throw fail('texture-failed');
    ctx.clearRect(0, 0, 528, 1420); ctx.drawImage(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }
  let blankTexture;
  try {
    blankTexture = await decode(blank);
    return { blank: blankTexture, full: await decode(full), metadataHash: hash(source.replace(fontDataURL, 'bundled-brush')), textureHash: hash(new XMLSerializer().serializeToString(full).replace(fontDataURL, 'bundled-brush')) };
  } catch { blankTexture?.dispose(); throw fail('texture-failed'); }
}

async function prepare(container, metadata, options = {}) {
  const art = await artwork(metadata);
  const rollDelivery = createRollDeliveryView(container, metadata, art);
  const providerSeal = providerSealModule.createView(container, metadata, options);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.paperlab = '0.8.1';
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '360px', height: '760px', pointerEvents: 'none', display: 'none' });
  container.append(canvas);
  let renderer, fiber, rootState, handle, dead = false, error = null, draws = 0, clears = 0, hasPixels = false, canvasVisible = false, materialReady = false, lastKey = '';
  let prewarmMs = 0, prewarmDraws = 0;
  const group = new THREE.Group();
  const alignment = { x: 0, y: 0 }, center = new THREE.Vector3();
  const diagnostics = lastRenderMs => { canvas.dataset.paperlabDiagnostics = JSON.stringify({ prewarmMs, prewarmDraws, lastRenderMs, damageVersion: 0, presenceRemaining: 1, rawFlameCount: 0, drawnFlameCount: 0 }); };
  const hidePaper = () => {
    canvas.style.display = 'none'; canvasVisible = false; group.visible = false;
    rollDelivery.render({ phase: 'hidden', visible: false, elapsedMs: 0 });
    if (hasPixels) { if (renderer && !renderer.getContext().isContextLost()) { renderer.clear(); clears++; } hasPixels = false; }
    gsap.ticker.sleep(); diagnostics(0);
  };
  const hide = () => { hidePaper(); providerSeal.hide(); };
  const loss = event => { event.preventDefault(); error = 'context-lost'; materialReady = false; hide(); };
  canvas.addEventListener('webglcontextlost', loss);
  const dispose = () => {
    if (dead) return; dead = true; hide(); materialReady = false;
    canvas.removeEventListener('webglcontextlost', loss); fiber?.unmount(); rollDelivery.dispose(); providerSeal.dispose();
    art.blank.dispose(); art.full.dispose(); renderer?.dispose(); canvas.remove();
  };
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.localClippingEnabled = true;
    renderer.debug.onShaderError = () => { error = 'render-failed'; };
    fiber = createRoot(canvas);
    await fiber.configure({ gl: renderer, flat: true, linear: false, frameloop: 'never', dpr: Math.min(2, globalThis.devicePixelRatio || 1), size: { width: 360, height: 760, top: 0, left: 0 }, orthographic: true,
      camera: { position: [0, 0, 10], near: .01, far: 30, zoom: 264 }, onCreated: state => { rootState = state; } });
    let mounted;
    const committed = new Promise(resolve => { mounted = resolve; });
    function Ready() { useLayoutEffect(() => { mounted(); }, []); return null; }
    function AlignMaterial() {
      useFrame(() => {
        const mesh = handle?.mesh;
        if (!mesh || !group.visible) return;
        mesh.geometry.computeBoundingBox(); mesh.geometry.boundingBox.getCenter(center); center.applyEuler(group.rotation);
        group.position.set(alignment.x - center.x, alignment.y - center.y, -center.z);
      }); return null;
    }
    fiber.render(<>
      <ambientLight intensity={Math.PI * .86} />
      <directionalLight position={[-2, 3, 6]} intensity={Math.PI * .16} />
      <primitive object={group}>
        <PaperMesh ref={value => { handle = value; }} sheet={{ width: 1, height: 710 / 264, thickness: .001, segments: 'auto', cornerRadius: 0 }}
          stock="printer" content={{ type: 'blank', back: { type: 'blank' } }} surface={{ grain: 0, aging: 0, showThrough: 0, translucency: 0 }} memory={{ set: 0, creases: [] }}
          behavior={{ type: 'unroll', progress: 1, tightness: .04, core: .035, sway: 0, from: 'bottom', tail: 0 }}
          physics="none" autoplay={false} reducedMotion={false} interactive={false} stateTriggers={false} />
      </primitive>
      <AlignMaterial /><Ready />
    </>);
    await timeout(committed, 5000, 'webgl-unavailable');
    for (let i = 0; i < 100 && (!handle?.mesh?.material?.uniforms?.uFrontMap?.value || !handle?.mesh?.material?.uniforms?.uBackMap?.value); i++) await new Promise(resolve => setTimeout(resolve, 10));
    const material = handle?.mesh?.material;
    if (!material?.uniforms?.uFrontMap || !material?.uniforms?.uBackMap || !rootState) throw fail('webgl-unavailable');
    const compile = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, gl) => {
      compile(shader, gl); shader.uniforms.ritualArtAlpha = { value: art.blank };
      shader.fragmentShader = 'uniform sampler2D ritualArtAlpha;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= texture2D(ritualArtAlpha, vPaperUv).a;\n#include <alphatest_fragment>');
      material.userData.ritualShader = shader;
    };
    material.customProgramCacheKey = () => 'ritual-paperlab-original-alpha-v1';
    material.transparent = true; material.alphaTest = .01; material.needsUpdate = true;
    backfaceModule.configureFacing(material);
    // Before writing both faces are blank: no future text leaks through the
    // already approved extraction. The separate folded delivery is untouched.
    material.uniforms.uFrontMap.value = art.blank; material.uniforms.uBackMap.value = art.blank;
    handle.set('progress', 1); rootState.advance(0, false); draws++; hasPixels = true;
    if (error) throw fail(error);
    const warmingAt = performance.now();
    try {
      group.visible = true;
      await timeout(renderer.compileAsync(rootState.scene, rootState.camera), 15000, 'webgl-unavailable');
      rootState.advance(0, false); draws++; hasPixels = true; prewarmDraws++; renderer.getContext().finish();
      await rollDelivery.ready;
      await timeout(providerSeal.ready, 5000, 'texture-failed');
      if (error) throw fail(error);
    } finally { hide(); }
    prewarmMs = Math.max(0, performance.now() - warmingAt); diagnostics(0); canvas.dataset.paperlabWarmup = 'ready'; materialReady = true;
    const getState = () => { const delivery = rollDelivery.getState(); return ({ ...delivery, ...providerSeal.getState(), materialReady: materialReady && delivery.materialReady,
      canvasVisible: canvasVisible || delivery.canvasVisible, actualDrawCount: draws + delivery.actualDrawCount, actualClearCount: clears + (delivery.actualClearCount || 0), presenceRemaining: 1, damageVersion: 0,
      flameCount: 0, maxFlameHeightDIP: 0, colorPipeline: 'srgb-no-tone-mapping',
      metadataHash: art.metadataHash, textureHash: art.textureHash, textureRasterizations: 3, error: error || delivery.error,
    }); };
    function render(frame) {
      const renderingAt = performance.now();
      if (dead || error) { hide(); return; }
      providerSeal.render(frame);
      const g = frame.geometry, geometryValid = globalThis.RitualSendGeometry?.geometryAt(frame, g);
      const paperPhase = ['point', 'travel', 'unfold'].includes(frame.phase), deliveryPhase = ['rolling', 'rotating', 'flying', 'staging', 'intake'].includes(frame.phase);
      if (!frame.visible || !geometryValid) { hide(); lastKey = ''; return; }
      if (!paperPhase && !deliveryPhase) { hidePaper(); lastKey = ''; return; }
      const key = `${frame.generation || frame.token || 0}:${frame.elapsedMs}:${g.originRect.x}:${g.originRect.y}:${g.targetRect.x}:${g.targetRect.y}:${g.targetRect.width}:${g.targetRect.height}`;
      if (key === lastKey) return; lastKey = key;
      if (deliveryPhase && frame.delivery?.plan && frame.delivery.state) {
        canvas.style.display = 'none'; canvasVisible = false; group.visible = false;
        if (hasPixels) { renderer.clear(); clears++; hasPixels = false; }
        rollDelivery.render(frame);
        if (rollDelivery.getState().error) { hide(); throw fail('render-failed'); }
        return;
      }
      rollDelivery.render({ phase: 'hidden', visible: false, elapsedMs: 0 });
      const { originRect: o, targetRect: t } = g;
      const paperW = t.width * 264 / 360;
      const canvasBounds = globalThis.RitualSendGeometry.canvasBoundsAt(frame, g);
      const { x: minX, y: minY, width: w, height: h } = canvasBounds;
      Object.assign(canvas.style, { left: `${minX - t.x}px`, top: `${minY - t.y}px`, width: `${w}px`, height: `${h}px`, display: 'block' }); canvasVisible = true;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
      const camera = rootState.camera; camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2; camera.zoom = paperW; camera.updateProjectionMatrix();
      {
        group.visible = true;
        const from = { x: o.x + o.width / 2, y: o.y + o.height / 2 }, to = { x: t.x + t.width / 2, y: t.y + t.height * 375 / 760 };
        const travel = ease(clamp((frame.elapsedMs - 100) / 750)), arc = Math.sin(Math.PI * travel) * .035;
        const x = from.x + (to.x - from.x) * travel - (to.y - from.y) * arc;
        const y = from.y + (to.y - from.y) * travel + (to.x - from.x) * arc;
        alignment.x = (x - minX - w / 2) / paperW; alignment.y = -(y - minY - h / 2) / paperW;
        // Preserve the already approved real Paperlab extraction/unroll.
        const unroll = ease(clamp((frame.elapsedMs - 260) / 1640)); handle.set('progress', unroll);
        const yaw = 1.53 * (1 - ease(clamp((frame.elapsedMs - 100) / 800)));
        group.rotation.set(-.27 * Math.sin(Math.PI * unroll), yaw, -.08 * Math.sin(Math.PI * travel));
        material.uniforms.uOpacity.value = ease(clamp(frame.elapsedMs / 120));
      }
      rootState.advance(frame.elapsedMs / 1000, false); draws++; hasPixels = true; diagnostics(Math.max(0, performance.now() - renderingAt));
      if (error) { hide(); throw fail(error); }
    }
    return { render, dispose, hide, getState };
  } catch (failure) { dispose(); throw fail(failure.code || 'webgl-unavailable'); }
}

globalThis.RitualPaperlab = Object.freeze({ version: '0.8.1', createView(container, options = {}) {
  return createSession(() => prepare(container, options.metadata || {}, { allowDemoProvider: options.allowDemoProvider === true }));
}, createRollPreviewView(container, options = {}) { return createRollPreviewView(container, options, artwork); }, rollMotion, RollMotion: rollMotion });
