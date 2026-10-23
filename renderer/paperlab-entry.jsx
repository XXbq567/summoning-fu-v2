import React, { useLayoutEffect } from 'react';
import { createRoot, extend, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PaperMesh } from 'paperlab';
import { DamageField, FxFlames, FxFireLight } from 'paperlab/fx';
import fontDataURL from '../assets/fonts/MaShanZheng-Regular.ttf';
import sessionModule from './paperlab-session.js';
import damageModule from './paperlab-damage.js';
import fireModule from './paperlab-fire.js';

extend(THREE);
const { createSession } = sessionModule;
const { bakeBurn, sampleBurn } = damageModule;
const { syncFireField, measureFlameHeightDIP, limitFlameInstances } = fireModule;
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => x * x * (3 - 2 * x);
const fail = code => Object.assign(new Error(code), { code });
let recording;
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

async function prepare(container, metadata) {
  const art = await artwork(metadata);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.paperlab = '0.8.1';
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '360px', height: '760px', pointerEvents: 'none', display: 'none' });
  container.append(canvas);
  let renderer, fiber, rootState, handle, dead = false, error = null, draws = 0, canvasVisible = false, materialReady = false, lastKey = '', remaining = 1;
  const damage = { size: 64, pixels: new Uint8Array(64 * 64 * 4), version: 0, time: 0, detail: .28,
    look: { emberWidth: 1.6, emberIntensity: 2.6, emberCoverage: .82, emberGlow: 1.6, sparkle: .06,
      lipWidth: .55, lipBrightness: .55, charWidth: 2.2, edgeWave: .65, edgeBite: .3, fingers: .65, scorchReach: 6 } };
  recording ||= bakeBurn(DamageField); sampleBurn(recording, 0, damage);
  syncFireField(damage, false);
  const group = new THREE.Group();
  const fireGroup = new THREE.Group(); fireGroup.visible = false;
  const fireState = { enabled: false, paperW: 264, flameCount: 0, maxHeightDIP: 0, rawCount: 0 };
  let prewarmMs = 0, prewarmDraws = 0;
  const diagnostics = lastRenderMs => { canvas.dataset.paperlabDiagnostics = JSON.stringify({ prewarmMs, prewarmDraws, lastRenderMs, rawFlameCount: fireState.rawCount, drawnFlameCount: fireState.flameCount, maxFlameHeightDIP: fireState.maxHeightDIP, damageVersion: damage.version, presenceRemaining: remaining }); };
  const surface = new THREE.Vector3();
  const alphaContext = art.full.image.getContext('2d');
  const originalAlpha = alphaContext.getImageData(0, 0, 528, 1420).data;
  const locate = (u, v) => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const x = Math.min(527, Math.floor(u * 528)), y = Math.min(1419, Math.floor((1 - v) * 1420));
    if (originalAlpha[(y * 528 + x) * 4 + 3] < 64) return null;
    return handle?.surfacePoint(u, v, surface) || null;
  };
  const alignment = { x: 0, y: 0, paperPhase: false };
  const center = new THREE.Vector3();
  const loss = event => { event.preventDefault(); error = 'context-lost'; materialReady = false; hide(); };
  canvas.addEventListener('webglcontextlost', loss);
  const hide = () => { canvas.style.display = 'none'; canvasVisible = false; fireState.enabled = false; fireState.flameCount = 0; fireState.rawCount = 0; fireState.maxHeightDIP = 0; fireGroup.visible = false; syncFireField(damage, false); diagnostics(0); };
  const dispose = () => {
    if (dead) return; dead = true; hide(); materialReady = false;
    canvas.removeEventListener('webglcontextlost', loss); fiber?.unmount();
    art.blank.dispose(); art.full.dispose(); renderer?.dispose(); canvas.remove();
  };
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
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
        if (!mesh) return;
        mesh.geometry.computeBoundingBox(); mesh.geometry.boundingBox.getCenter(center); center.applyEuler(group.rotation);
        group.position.set(alignment.x - center.x, alignment.y - center.y, -center.z);
      });
      return null;
    }
    function TuneFire() {
      useFrame(() => {
        fireState.flameCount = 0; fireState.maxHeightDIP = 0;
        fireGroup.traverse(object => {
          if (object.isPointLight) {
            // Existing library fire lighting, bounded to the local hot edge.
            object.distance = 40 / fireState.paperW; object.decay = 1.5;
          }
          if (!object.isMesh || !object.geometry?.getAttribute('aShape')) return;
          const geometry = object.geometry, shape = geometry.getAttribute('aShape');
          fireState.rawCount = geometry.instanceCount;
          limitFlameInstances(geometry, fireState.enabled);
          fireState.flameCount = geometry.instanceCount;
          for (let i = 0; i < geometry.instanceCount; i++) {
            shape.array[i * 4] = Math.min(50 / fireState.paperW, shape.array[i * 4] * 1.8);
            fireState.maxHeightDIP = Math.max(fireState.maxHeightDIP, measureFlameHeightDIP(shape.array[i * 4], fireState.paperW));
          }
          shape.needsUpdate = true;
          const flame = object.material;
          if (!flame.userData.ritualFire) {
            // The library's additive fire disappears against pale paper.
            // Its same tongue shader gets real coverage instead, so orange
            // gas remains visible above the retained warm paper and ink.
            const anchor = 'gl_FragColor = vec4(c * body * fade, 1.0);';
            if (!flame.fragmentShader.includes(anchor)) throw fail('render-failed');
            flame.fragmentShader = flame.fragmentShader.replace(anchor, 'gl_FragColor = vec4(c, body * fade * 0.92);');
            flame.blending = THREE.NormalBlending; flame.depthTest = false; flame.toneMapped = false;
            flame.needsUpdate = true; flame.userData.ritualFire = true;
          }
        });
      });
      return null;
    }
    fiber.render(<>
      <ambientLight intensity={Math.PI * .86} />
      <directionalLight position={[-2, 3, 6]} intensity={Math.PI * .16} />
      <primitive object={group}>
        <PaperMesh ref={value => { handle = value; }} sheet={{ width: 1, height: 710 / 264, thickness: .001, segments: 'auto', cornerRadius: 0 }}
          stock="printer" content={{ type: 'blank' }} surface={{ grain: 0, aging: 0, showThrough: 0, translucency: 0 }} memory={{ set: 0, creases: [] }}
          behavior={{ type: 'unroll', progress: 1, tightness: .04, core: .035, sway: 0, from: 'bottom', tail: 0 }}
          physics="none" autoplay={false} reducedMotion={false} interactive={false} stateTriggers={false} damage={damage} />
      </primitive>
      <AlignMaterial />
      <primitive object={fireGroup}>
        <FxFlames field={damage} locate={locate} quality="low" wind={[.04, 0, 0]} />
        <FxFireLight field={damage} locate={locate} gain={14} shadows={false} />
      </primitive>
      <TuneFire />
      <Ready />
    </>);
    await timeout(committed, 5000, 'webgl-unavailable');
    // Effects create the content map/material. This bounded preparation does
    // not depend on a visible window or an automatically scheduled RAF.
    for (let i = 0; i < 100 && !handle?.mesh?.material?.uniforms?.uFrontMap; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const material = handle?.mesh?.material;
    if (!material?.uniforms?.uFrontMap || !rootState) throw fail('webgl-unavailable');
    const compile = material.onBeforeCompile.bind(material);
    // Paperlab 0.8.1 intentionally paints image content over opaque stock.
    // Preserve our original die-cut alpha, before its own common damage cut.
    material.onBeforeCompile = (shader, gl) => {
      compile(shader, gl);
      shader.uniforms.ritualArtAlpha = { value: art.blank };
      shader.fragmentShader = 'uniform sampler2D ritualArtAlpha;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= texture2D(ritualArtAlpha, vPaperUv).a;\n#include <alphatest_fragment>');
      material.userData.ritualShader = shader;
    };
    material.customProgramCacheKey = () => 'ritual-paperlab-original-alpha-v1';
    material.transparent = true; material.alphaTest = .01; material.needsUpdate = true;
    function texture(value) {
      material.uniforms.uFrontMap.value = value;
      if (material.userData.ritualShader) material.userData.ritualShader.uniforms.ritualArtAlpha.value = value;
    }
    texture(art.blank); handle.set('progress', 1); rootState.advance(0, false); draws++;
    if (error) throw fail(error);
    // Warm the real fire, hot paper and point-light shader variant while the
    // canvas stays display:none. The presentation clock has not started.
    // Run callbacks once without drawing to assemble the exact hot scene,
    // then compile asynchronously, draw it and wait for the GPU to finish.
    const warmingAt = performance.now();
    try {
      texture(art.full); remaining = sampleBurn(recording, .5, damage); syncFireField(damage, true);
      fireState.enabled = true; fireGroup.visible = true;
      const drawScene = renderer.render;
      try { renderer.render = () => {}; rootState.advance(10.65, false); }
      finally { renderer.render = drawScene; }
      await timeout(renderer.compileAsync(rootState.scene, rootState.camera), 15000, 'webgl-unavailable');
      if (error) throw fail(error);
      rootState.advance(10.65, false); draws++; prewarmDraws++;
      renderer.getContext().finish();
      if (error) throw fail(error);
    } finally {
      // No hot texture, field state, fire geometry or elapsed time may leak
      // from preparation into a new run or a replaced metadata generation.
      remaining = sampleBurn(recording, 0, damage); syncFireField(damage, false);
      fireState.enabled = false; fireGroup.visible = false; fireState.rawCount = 0;
      texture(art.blank); material.uniforms.uOpacity.value = 1; handle.set('progress', 1);
      rootState.advance(0, false); draws++; prewarmDraws++;
      renderer.getContext().finish(); renderer.clear(); hide();
    }
    prewarmMs = Math.max(0, performance.now() - warmingAt); diagnostics(0);
    canvas.dataset.paperlabWarmup = 'ready';
    materialReady = true;
    const getState = () => ({ materialReady, canvasVisible, actualDrawCount: draws, presenceRemaining: remaining, damageVersion: damage.version,
      flameCount: fireState.flameCount, maxFlameHeightDIP: fireState.maxHeightDIP, colorPipeline: 'srgb-no-tone-mapping',
      metadataHash: art.metadataHash, textureHash: art.textureHash, textureRasterizations: 2, error });
    function render(frame) {
      const renderingAt = performance.now();
      if (dead || error) { hide(); return; }
      const g = frame.geometry;
      const geometryValid = globalThis.RitualSendGeometry?.geometryAt(frame, g);
      const paperPhase = ['point', 'travel', 'unfold'].includes(frame.phase);
      if (!frame.visible || !geometryValid || (!paperPhase && frame.phase !== 'burning')) {
        if (frame.burn === 1 && remaining !== 0) remaining = sampleBurn(recording, 1, damage);
        hide(); lastKey = ''; return;
      }
      const key = `${frame.elapsedMs}:${g.originRect.x}:${g.originRect.y}:${g.targetRect.x}:${g.targetRect.y}:${g.targetRect.width}:${g.targetRect.height}`;
      if (key === lastKey) return; lastKey = key;
      const { originRect: o, targetRect: t } = g;
      const paperW = t.width * 264 / 360, paperH = t.height * 710 / 760;
      fireState.paperW = paperW;
      const from = { x: o.x + o.width / 2, y: o.y + o.height / 2 };
      const to = { x: t.x + t.width / 2, y: t.y + t.height * 375 / 760 };
      const canvasBounds = globalThis.RitualSendGeometry.canvasBoundsAt(frame, g);
      const { x: minX, y: minY, width: w, height: h } = canvasBounds;
      Object.assign(canvas.style, { left: `${minX - t.x}px`, top: `${minY - t.y}px`, width: `${w}px`, height: `${h}px`, display: 'block' }); canvasVisible = true;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
      const camera = rootState.camera; camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2; camera.zoom = paperW; camera.updateProjectionMatrix();
      const travel = paperPhase ? ease(clamp((frame.elapsedMs - 100) / 750)) : 1;
      const arc = Math.sin(Math.PI * travel) * .035;
      const x = from.x + (to.x - from.x) * travel - (to.y - from.y) * arc;
      const y = from.y + (to.y - from.y) * travel + (to.x - from.x) * arc;
      alignment.x = (x - minX - w / 2) / paperW; alignment.y = -(y - minY - h / 2) / paperW;
      // Constant material dimensions. The visible extent changes because the
      // library winds a real arc, never by scaling the rectangular sheet.
      const unroll = paperPhase ? ease(clamp((frame.elapsedMs - 260) / 1640)) : 1;
      handle.set('progress', unroll);
      const yaw = 1.53 * (1 - ease(clamp((frame.elapsedMs - 100) / 800)));
      group.rotation.set(paperPhase ? -.27 * Math.sin(Math.PI * unroll) : 0, paperPhase ? yaw : 0, paperPhase ? -.08 * Math.sin(Math.PI * travel) : 0);
      material.uniforms.uOpacity.value = paperPhase ? ease(clamp(frame.elapsedMs / 120)) : 1;
      texture(paperPhase ? art.blank : art.full);
      remaining = sampleBurn(recording, paperPhase ? 0 : frame.burn, damage);
      fireState.enabled = !paperPhase && frame.burn > 0 && frame.burn < 1;
      fireGroup.visible = fireState.enabled;
      syncFireField(damage, fireState.enabled);
      rootState.advance(frame.elapsedMs / 1000, false); draws++;
      diagnostics(Math.max(0, performance.now() - renderingAt));
      if (error) { hide(); throw fail(error); }
    }
    return { render, dispose, hide, getState };
  } catch (failure) { dispose(); throw fail(failure.code || 'webgl-unavailable'); }
}

globalThis.RitualPaperlab = Object.freeze({ version: '0.8.1', createView(container, options = {}) {
  return createSession(() => prepare(container, options.metadata || {}));
} });
