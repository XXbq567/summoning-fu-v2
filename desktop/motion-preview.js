(function (root) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const Delivery = common ? require('../renderer/delivery-motion.js') : root.RitualDelivery;
  const Entrance = common ? require('../renderer/entrance-timeline.js') : root.RitualEntrance;
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  class PreviewClock {
    constructor(duration) { this.duration = duration; this.position = 0; this.startedAt = 0; this.playing = false; this.generation = 0; this.speed = 1; }
    snapshot(now) {
      const elapsedMs = Math.min(this.duration, this.position + (this.playing ? Math.max(0, now - this.startedAt) * this.speed : 0));
      if (elapsedMs >= this.duration) { this.position = this.duration; this.playing = false; }
      return { elapsedMs, playing: this.playing, generation: this.generation };
    }
    replay(now) { this.position = 0; this.startedAt = now; this.playing = true; this.generation++; }
    pause(now) { this.position = this.snapshot(now).elapsedMs; this.startedAt = now; this.playing = false; }
    resume(now) { if (this.position < this.duration) { this.startedAt = now; this.playing = true; } }
    seek(value, now) { if (!Number.isFinite(value)) return; this.position = Math.max(0, Math.min(this.duration, value)); this.startedAt = now; this.playing = false; this.generation++; }
    setSpeed(value, now) { if (![.25, .5, 1].includes(value)) return; const playing = this.playing; this.pause(now); this.speed = value; if (playing) this.resume(now); }
  }
  class PreviewDeliveryRun {
    constructor(geometry) { this.geometry = freeze(JSON.parse(JSON.stringify(geometry))); this.plan = null; this.cancelled = false; this.finished = false; this.reason = 'none'; }
    cancel(reason = 'cancelled') {
      this.cancelled = true; this.plan = null;
      this.reason = ['cancelled', 'target-unavailable', 'target-changed', 'document-hidden', 'geometry-changed', 'render-failed', 'pagehide'].includes(reason) ? reason : 'cancelled';
    }
    release() { this.plan = null; this.finished = true; }
    sample(elapsedMs, target, nowMs) {
      if (!this.cancelled && !this.finished && this.plan && !Delivery.targetStillValid(this.plan, target, { nowMs, allowPreviewTarget: true })) this.cancel('target-changed');
      if (!this.cancelled && !this.finished && elapsedMs >= Entrance.timings.leaveAtMs && !this.plan) {
        this.plan = Delivery?.createPlan(this.geometry, target, { nowMs, allowPreviewTarget: true }) || null;
        if (!this.plan) this.cancel('target-unavailable');
      }
      if (this.cancelled || this.finished) return { ...Entrance.frameAt(Entrance.timings.totalMs), elapsedMs, geometry: this.geometry, visible: false, phase: 'hidden', needsAnimation: false, opacity: 0, paperOpacity: 0, ashOpacity: 0, delivery: null, cancellationReason: this.reason };
      return { ...Entrance.frameAt(elapsedMs, false, { geometry: this.geometry, deliveryTarget: target, deliveryPlan: this.plan, allowPreviewTarget: true, nowMs }), geometry: this.geometry, deliveryTarget: target, deliveryPlan: this.plan, allowPreviewTarget: true, nowMs };
    }
  }
  function deliveryChapterElapsed(plan, action) {
    if (!plan) return null;
    if (action === 'folding') return Entrance.timings.leaveAtMs + plan.flightAtMs * .5;
    if (action === 'flying') return Entrance.timings.leaveAtMs + (plan.flightAtMs + plan.flightEndMs) / 2;
    const partial = [];
    for (let ms = plan.intakeAtMs; ms < plan.durationMs; ms++) {
      const state = Delivery.sample(plan, ms);
      if (state.leadingPoint.y > state.clip.point.y && state.trailingPoint.y < state.clip.point.y) partial.push(ms);
    }
    if (!partial.length) return null;
    const fraction = action === 'intake-tip' ? .25 : action === 'intake-tail' ? .75 : .5;
    return Entrance.timings.leaveAtMs + partial[Math.floor((partial.length - 1) * fraction)];
  }
  const shouldAnimateFrame = (frame, hidden) => !hidden && frame.visible === true && frame.reducedMotion !== true && frame.needsAnimation === true;
  function localPreviewGeometry(stage, button, paper) {
    const local = rect => ({ x: rect.x - stage.x, y: rect.y - stage.y, width: rect.width, height: rect.height });
    return { originRect: local(button), targetRect: local(paper) };
  }
  function svgIsVisible(svg, hidden, styleOf = root.getComputedStyle) {
    if (!svg || hidden || typeof styleOf !== 'function') return false;
    const bounds = svg.getBoundingClientRect?.();
    if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return false;
    for (let element = svg; element; element = element.parentElement) {
      const style = styleOf(element);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  if (common) { module.exports = { PreviewClock, PreviewDeliveryRun, deliveryChapterElapsed, shouldAnimateFrame, localPreviewGeometry, svgIsVisible }; return; }
  root.FuMotion = { PreviewClock, shouldAnimateFrame };
  if (!document.querySelector('#preview-paper')) return;
  const timing = Entrance.timings, clock = new PreviewClock(timing.totalMs), reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let view = null, run = null, raf = null, wake = null, rafCount = 0, renderCount = 0, lastFrame = null, renderedGeneration = null, lastEvidenceAt = -Infinity;
  let qaOnly = true, materialReady = false, preparation = 0, initialCoverage = {}, currentMetadata = {}, targetRevision = 0, targetObservedAt = performance.now(), drag = null;
  const labels = { point: '取纸', travel: '牵出卷纸', unfold: '纸身舒展', writing: '落墨', hold: '完整停留 · 2 秒', folding: '折起这张符', flying: '送往示例目标', intake: '从目标入口逐段接收', hidden: '本次预览已清空' };
  const stage = () => document.querySelector('.preview-stage');
  const targetElement = () => document.querySelector('#preview-target');
  function stopFrames() { if (raf !== null) cancelAnimationFrame(raf); clearTimeout(wake); raf = null; wake = null; }
  function numericAttribute(element, name) { const number = Number(element?.getAttribute(name)); return Number.isFinite(number) ? number : 0; }
  function currentTarget() {
    const element = targetElement(); if (!element) return null;
    const a = stage().getBoundingClientRect(), b = element.getBoundingClientRect();
    const style = root.getComputedStyle ? root.getComputedStyle(element) : null;
    return { targetId: 'preview-example-target', revision: targetRevision, rect: { x: b.x - a.x, y: b.y - a.y, width: b.width, height: b.height },
      coordinateSpace: 'overlay-local-dip', source: 'preview-example', valid: true, visible: !element.hidden && style?.display !== 'none' && style?.visibility !== 'hidden',
      observedAtMonotonicMs: targetObservedAt, expiresAtMonotonicMs: targetObservedAt + 60000 };
  }
  function readGeometry() { return localPreviewGeometry(stage().getBoundingClientRect(), document.querySelector('#example-send').getBoundingClientRect(), document.querySelector('#preview-paper').getBoundingClientRect()); }
  function evidence(force = false) {
    if (!view || !lastFrame || (!force && performance.now() - lastEvidenceAt < 80)) return;
    lastEvidenceAt = performance.now();
    const glyphs = Array.from(view.svg.querySelectorAll('[data-writing-order] tspan')), paperlab = view.getPresentationState?.();
    root.fuPreview.report({ ...clock.snapshot(performance.now()), phase: lastFrame.phase, systemReducedMotion: reduce.matches, effectiveReducedMotion: false, documentHidden: document.hidden,
      ...(paperlab ? { paperlab } : {}), svgVisible: svgIsVisible(view.svg, document.hidden), cancellationReason: run?.reason || 'none',
      renderCount, rafCount, paperOpacity: numericAttribute(view.svg.querySelector('#ritual-paper-base'), 'opacity'), opacity: numericAttribute(view.svg.querySelector('#ritual-paper-content'), 'opacity'),
      writing: lastFrame.writing, burn: 0, visibleGlyphs: glyphs.filter(glyph => glyph.style.visibility !== 'hidden' && Number(glyph.style.opacity || 1) > 0).length, totalGlyphs: glyphs.length,
      uiElapsedMs: Number(document.querySelector('#preview-progress').value), holdStartMs: lastFrame.holdStartMs, leaveAtMs: lastFrame.leaveAtMs, hideAtMs: lastFrame.hideAtMs });
  }
  function updateUI() {
    const state = clock.snapshot(performance.now());
    document.querySelector('#preview-time').textContent = (state.elapsedMs / 1000).toFixed(1) + ' 秒';
    document.querySelector('#preview-progress').value = state.elapsedMs;
    document.querySelector('#pause-preview').textContent = state.playing ? '暂停' : '继续';
    document.querySelector('#preview-policy').textContent = '完整文字停留 2 秒。示例目标只存在于本页，不是官方 Pet 位置。系统减少动态：' + (reduce.matches ? '开启' : '关闭') + '；Windows 设置保持不变。';
  }
  function controlsDisabled(value) {
    document.querySelectorAll('button').forEach(button => { button.disabled = qaOnly || value; });
    const replay = document.querySelector('#example-send'); if (replay && !qaOnly) replay.disabled = false;
    const speed = document.querySelector('#preview-speed'); if (speed) speed.disabled = qaOnly || value;
  }
  function cancel(reason) {
    preparation++; clock.pause(performance.now()); stopFrames();
    run ||= new PreviewDeliveryRun(readGeometry()); run.cancel(reason);
    if (!materialReady) { view?.dispose?.(); view = null; }
    if (view) {
      lastFrame = { ...run.sample(clock.position, null, performance.now()), generation: clock.generation };
      view.render(lastFrame, false); renderCount++; renderedGeneration = clock.generation;
    }
    document.querySelector('#preview-stage').textContent = reason === 'target-changed' ? '示例目标已变化，本轮已清空；重播使用新位置。' : '本轮已清空；重播开始新一轮。';
    controlsDisabled(false); updateUI(); evidence(true);
  }
  function showError() {
    cancel('render-failed'); materialReady = false;
    document.querySelector('#preview-stage').textContent = 'Paperlab 本机渲染未就绪';
    const error = document.querySelector('#preview-error'); if (error) { error.hidden = false; error.textContent = '纸张或 WebGL 资源未能准备完成。请重播或重新构建本地资源；本次没有调用模型。'; }
  }
  function render() {
    stopFrames(); if (!view || !materialReady || document.hidden || !run) return;
    const state = clock.snapshot(performance.now()), previous = lastFrame;
    lastFrame = { ...run.sample(state.elapsedMs, currentTarget(), performance.now()), generation: clock.generation };
    const staticHold = lastFrame.phase === 'hold' && previous?.phase === 'hold' && renderedGeneration === clock.generation;
    try { if (!staticHold) { view.render(lastFrame, false); renderCount++; renderedGeneration = clock.generation; } } catch { showError(); return; }
    document.querySelector('#preview-stage').textContent = labels[lastFrame.phase] || labels.hidden;
    if (run.cancelled || !lastFrame.visible) {
      if (!run.cancelled) { clock.duration = lastFrame.hideAtMs; clock.snapshot(performance.now()); run.release(); }
      clock.pause(performance.now()); stopFrames();
    } else if (run.plan) clock.duration = lastFrame.hideAtMs;
    updateUI(); evidence();
    // Drawing/UI sampling can cross the deadline after this frame was sampled.
    // Commit the terminal clear now rather than leaving the last intake pixels.
    if (lastFrame.visible && state.playing && !clock.playing && !run.cancelled) { render(); return; }
    if (clock.playing && shouldAnimateFrame(lastFrame, document.hidden)) raf = requestAnimationFrame(() => { rafCount++; render(); });
    else if (clock.playing) wake = setTimeout(render, Math.max(1, (timing.leaveAtMs - state.elapsedMs + 1) / clock.speed));
  }
  function beginRun(action = 'replay') {
    stopFrames(); targetObservedAt = performance.now();
    run = new PreviewDeliveryRun(readGeometry()); lastFrame = null; renderedGeneration = null; clock.duration = timing.totalMs;
    clock.replay(performance.now());
    const positions = { point: timing.pointEndMs / 2, travel: (timing.pointEndMs + timing.travelEndMs) / 2, unfold: (timing.travelEndMs + timing.paperEndMs) / 2, paper: (timing.travelEndMs + timing.paperEndMs) / 2,
      writing: (timing.paperEndMs + timing.writingEndMs) / 2, seal: timing.holdStartMs, hold: timing.holdStartMs + timing.holdMs / 2 };
    if (['folding', 'flying', 'intake', 'intake-tip', 'intake-tail'].includes(action)) {
      run.sample(timing.leaveAtMs, currentTarget(), performance.now());
      const at = deliveryChapterElapsed(run.plan, action); if (at !== null) clock.seek(at, performance.now());
    } else if (Object.hasOwn(positions, action)) clock.seek(positions[action], performance.now());
    if (document.hidden) { cancel('document-hidden'); return; }
    render();
  }
  function preset(name) {
    const element = targetElement(); if (!element) return;
    const a = stage().getBoundingClientRect(), g = readGeometry().targetRect, b = element.getBoundingClientRect();
    const locations = { near: { x: g.x + g.width + 16, y: g.y + g.height * .45 }, far: { x: 16, y: a.height - b.height - 24 }, left: { x: 16, y: a.height * .4 }, right: { x: a.width - b.width - 16, y: a.height * .65 } };
    const point = locations[name] || locations.near;
    element.hidden = false; Object.assign(element.style, { left: Math.max(12, Math.min(a.width - b.width - 12, point.x)) + 'px', top: Math.max(12, Math.min(a.height - b.height - 12, point.y)) + 'px', right: 'auto', bottom: 'auto' });
    targetRevision++; targetObservedAt = performance.now();
  }
  function command(action) {
    if (['fixture-a', 'fixture-b'].includes(action)) {
      if (qaOnly) void prepareMetadata({ model: action === 'fixture-a' ? '示例甲模型' : '示例乙模型', harness: '本地示例', environment: '隔离采证', reasoning: 'xhigh', sources: { model: 'demo', harness: 'demo', environment: 'demo', reasoning: 'demo' }, presentation: { mode: 'entrance', sessionId: action, chatTitle: { value: action === 'fixture-a' ? '示例甲 · 新纸新字' : '示例乙 · 新纸新字', source: 'demo' } } });
      return;
    }
    if (['target-near', 'target-far', 'target-left', 'target-right'].includes(action)) { preset(action.slice(7)); if (materialReady) beginRun(); return; }
    if (action === 'target-move' || action === 'target-hide') {
      const element = targetElement(); if (!element) return;
      if (action === 'target-hide') element.hidden = true;
      else { const p = currentTarget().rect; element.style.left = (p.x > 70 ? p.x - 60 : p.x + 60) + 'px'; element.style.right = 'auto'; }
      targetRevision++; targetObservedAt = performance.now(); if (run?.plan) cancel('target-changed'); return;
    }
    if (action === 'replay') { const element = targetElement(); if (element) element.hidden = false; if (!materialReady || !view) void prepareMetadata(currentMetadata); else beginRun(); return; }
    if (['speed-0.25', 'speed-0.5', 'speed-1'].includes(action)) {
      clock.setSpeed(Number(action.slice(6)), performance.now());
      if (materialReady && run && !run.cancelled && !run.finished) render();
      return;
    }
    if (!materialReady || !run) return;
    if (action === 'stop') { cancel('cancelled'); return; }
    if (['point', 'travel', 'unfold', 'paper', 'writing', 'seal', 'hold', 'folding', 'flying', 'intake', 'intake-tip', 'intake-tail'].includes(action)) { if (!run.cancelled) beginRun(action); return; }
    if (run.cancelled || run.finished) return;
    const now = performance.now();
    if (action === 'pause') clock.pause(now);
    else if (action === 'resume') clock.resume(now);
    else return;
    render();
  }
  async function prepareMetadata(metadata) {
    const token = ++preparation; materialReady = false; stopFrames(); clock.pause(performance.now()); run = null; lastFrame = null; controlsDisabled(true);
    currentMetadata = freeze(JSON.parse(JSON.stringify(metadata || {})));
    const container = document.querySelector('#preview-paper'); container.style.visibility = 'hidden';
    try {
      if (view) view.setMetadata(currentMetadata); else view = new root.RitualBurn.BurnView(container, currentMetadata, { fontCoverage: initialCoverage });
      const preparedView = view; await view.ready;
      if (token !== preparation || view !== preparedView) return;
      materialReady = true; container.style.visibility = 'visible'; controlsDisabled(false); beginRun();
    } catch { if (token === preparation) showError(); }
  }
  document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => { if (!qaOnly) command(button.dataset.preview); }));
  document.querySelector('#pause-preview').addEventListener('click', () => { if (!qaOnly) command(clock.playing ? 'pause' : 'resume'); });
  document.querySelector('#preview-speed')?.addEventListener('change', () => { if (!qaOnly) command('speed-' + document.querySelector('#preview-speed').value); });
  const targetNode = targetElement();
  targetNode?.addEventListener('pointerdown', event => {
    if (qaOnly) return; const r = targetNode.getBoundingClientRect(); drag = { id: event.pointerId, x: event.clientX - r.x, y: event.clientY - r.y }; targetNode.setPointerCapture(event.pointerId);
  });
  targetNode?.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || qaOnly) return;
    const a = stage().getBoundingClientRect(), b = targetNode.getBoundingClientRect();
    Object.assign(targetNode.style, { left: Math.max(0, Math.min(a.width - b.width, event.clientX - a.x - drag.x)) + 'px', top: Math.max(0, Math.min(a.height - b.height, event.clientY - a.y - drag.y)) + 'px', right: 'auto', bottom: 'auto' });
    targetRevision++; targetObservedAt = performance.now();
    if (run?.plan && !Delivery.targetStillValid(run.plan, currentTarget(), { nowMs: performance.now(), allowPreviewTarget: true })) cancel('target-changed');
  });
  for (const name of ['pointerup', 'pointercancel']) targetNode?.addEventListener(name, () => { drag = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && preparation > 0) cancel('document-hidden'); else { updateUI(); evidence(true); } });
  addEventListener('resize', () => { if (preparation > 0) cancel('geometry-changed'); });
  reduce.addEventListener('change', () => { updateUI(); evidence(true); });
  addEventListener('pagehide', () => { cancel('pagehide'); view?.dispose?.(); view = null; });
  root.fuPreview.subscribe(command);
  root.fuPreview.initial().then(async value => {
    if (!value) return;
    qaOnly = value.qaOnly === true; controlsDisabled(true); initialCoverage = value.coverage;
    await document.fonts.ready;
    document.querySelector('#preview-source').textContent = value.source === 'frozen-current' ? '内容：打开预览时冻结的当前符；示例目标仅在本页。' : '内容：本地示例符与示例目标 · 非真实任务，未调用模型。';
    document.querySelector('#preview-progress').max = timing.totalMs;
    preset('near'); await prepareMetadata(value.metadata);
  }).catch(showError);
  setInterval(() => { updateUI(); evidence(); }, 100);
})(globalThis);
