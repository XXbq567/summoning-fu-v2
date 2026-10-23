(function (root) {
  'use strict';
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
  if (typeof module === 'object' && module.exports) { module.exports = { PreviewClock, shouldAnimateFrame, localPreviewGeometry, svgIsVisible }; return; }
  root.FuMotion = { PreviewClock, shouldAnimateFrame };
  if (!document.querySelector('#preview-paper')) return;
  const timing = root.RitualEntrance.timings, clock = new PreviewClock(timing.totalMs);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let view = null, raf = null, wake = null, rafCount = 0, renderCount = 0, lastFrame = null, lastEvidenceAt = -Infinity, qaOnly = true, materialReady = false, preparation = 0;
  const labels = { point: '取纸', travel: '牵出卷纸', unfold: '纸身舒展', writing: '落墨', hold: '完整停留 · 5 秒', burning: '纸墨一起燃尽', ash: '余灰', hidden: '本次预览结束' };
  function stopFrames() { if (raf !== null) cancelAnimationFrame(raf); clearTimeout(wake); raf = null; wake = null; }
  function numericAttribute(element, name) { const number = Number(element?.getAttribute(name)); return Number.isFinite(number) ? number : 0; }
  function evidence() {
    if (!view || !lastFrame) return;
    if (performance.now() - lastEvidenceAt < 100) return;
    lastEvidenceAt = performance.now();
    const glyphs = Array.from(view.svg.querySelectorAll('[data-writing-order] tspan'));
    const paperlab = view.getPresentationState?.();
    root.fuPreview.report({ ...clock.snapshot(performance.now()), phase: lastFrame.phase, systemReducedMotion: reduce.matches, effectiveReducedMotion: false, documentHidden: document.hidden,
      ...(paperlab ? { paperlab } : {}), svgVisible: svgIsVisible(view.svg, document.hidden),
      renderCount, rafCount, paperOpacity: numericAttribute(view.svg.querySelector('#ritual-paper-base'), 'opacity'), opacity: numericAttribute(view.svg.querySelector('#ritual-paper-content'), 'opacity'), writing: lastFrame.writing, burn: lastFrame.burn,
      visibleGlyphs: glyphs.filter(glyph => glyph.style.visibility !== 'hidden' && Number(glyph.style.opacity || 1) > 0).length, totalGlyphs: glyphs.length,
      uiElapsedMs: Number(document.querySelector('#preview-progress').value),
      holdStartMs: lastFrame.holdStartMs, leaveAtMs: lastFrame.leaveAtMs, hideAtMs: lastFrame.hideAtMs });
  }
  function updateUI(state = clock.snapshot(performance.now())) {
    if (!view || !materialReady || document.hidden) return;
    document.querySelector('#preview-time').textContent = `${(state.elapsedMs / 1000).toFixed(1)} / ${(timing.totalMs / 1000).toFixed(1)} 秒`;
    document.querySelector('#preview-progress').value = state.elapsedMs;
    document.querySelector('#pause-preview').textContent = state.playing ? '暂停' : '继续';
    document.querySelector('#preview-policy').textContent = `系统减少动态：${reduce.matches ? '开启' : '关闭'}。本应用的正常入口和独立预览均播放完整动效；Windows 设置保持不变。`;
  }
  function render() {
    stopFrames();
    if (!view || !materialReady || document.hidden) return;
    const state = clock.snapshot(performance.now());
    const geometry = localPreviewGeometry(document.querySelector('.preview-stage').getBoundingClientRect(), document.querySelector('#example-send').getBoundingClientRect(), document.querySelector('#preview-paper').getBoundingClientRect());
    lastFrame = { ...root.RitualEntrance.frameAt(state.elapsedMs, false), geometry };
    try { view.render(lastFrame, false); renderCount++; } catch { showError(); return; }
    document.querySelector('#preview-stage').textContent = labels[lastFrame.phase];
    updateUI(state);
    if (state.playing && shouldAnimateFrame(lastFrame, document.hidden)) raf = requestAnimationFrame(() => { rafCount++; render(); });
    else if (state.playing) wake = setTimeout(render, Math.max(1, (lastFrame.leaveAtMs - state.elapsedMs + 1) / clock.speed));
    evidence();
  }
  function command(action) {
    if (['fixture-a', 'fixture-b'].includes(action)) {
      if (qaOnly) void prepareMetadata({ model: action === 'fixture-a' ? '示例甲模型' : '示例乙模型', harness: '本地示例', environment: '隔离采证', reasoning: 'xhigh', sources: { model: 'demo', harness: 'demo', environment: 'demo', reasoning: 'demo' }, presentation: { mode: 'entrance', sessionId: action, chatTitle: { value: action === 'fixture-a' ? '示例甲 · 新纸新字' : '示例乙 · 新纸新字', source: 'demo' } } });
      return;
    }
    if (!materialReady) return;
    const now = performance.now();
    const positions = { point: timing.pointEndMs / 2, travel: (timing.pointEndMs + timing.travelEndMs) / 2, unfold: (timing.travelEndMs + timing.paperEndMs) / 2, paper: (timing.travelEndMs + timing.paperEndMs) / 2, writing: (timing.paperEndMs + timing.writingEndMs) / 2, seal: timing.holdStartMs, hold: timing.holdStartMs + timing.holdMs / 2, burning: (timing.leaveAtMs + timing.burnEndMs) / 2, leaving: (timing.leaveAtMs + timing.burnEndMs) / 2, ash: (timing.burnEndMs + timing.totalMs) / 2 };
    if (action === 'replay') clock.replay(now);
    else if (action === 'pause') clock.pause(now);
    else if (action === 'resume') clock.resume(now);
    else if (action === 'stop') clock.seek(timing.totalMs, now);
    else if (['speed-0.25', 'speed-0.5', 'speed-1'].includes(action)) clock.setSpeed(Number(action.slice(6)), now);
    else if (Object.hasOwn(positions, action)) clock.seek(positions[action], now);
    else return;
    render();
  }
  function controlsDisabled(value) {
    document.querySelectorAll('button').forEach(button => { button.disabled = value; });
    const speed = document.querySelector('#preview-speed'); if (speed) speed.disabled = value;
  }
  function showError() {
    materialReady = false; clock.pause(performance.now()); stopFrames(); controlsDisabled(true);
    document.querySelector('#preview-stage').textContent = 'Paperlab 本机渲染未就绪';
    const error = document.querySelector('#preview-error'); if (error) { error.hidden = false; error.textContent = '纸张或 WebGL 未能准备完成。请重新构建本地 Paperlab 资源后重开预览；本次没有调用模型。'; }
  }
  async function prepareMetadata(metadata) {
    const token = ++preparation; materialReady = false; stopFrames(); clock.seek(0, performance.now()); lastFrame = null; controlsDisabled(true);
    const container = document.querySelector('#preview-paper'); container.style.visibility = 'hidden';
    try {
      if (view) view.setMetadata(metadata);
      else view = new root.RitualBurn.BurnView(container, metadata, { fontCoverage: initialCoverage });
      await view.ready;
      if (token !== preparation) return;
      materialReady = true; container.style.visibility = 'visible'; controlsDisabled(qaOnly);
      clock.replay(performance.now()); if (document.hidden) clock.pause(performance.now()); render();
    } catch { if (token === preparation) showError(); }
  }
  let initialCoverage = {};
  document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => { if (!qaOnly) command(button.dataset.preview); }));
  document.querySelector('#pause-preview').addEventListener('click', () => { if (!qaOnly) command(clock.snapshot(performance.now()).playing ? 'pause' : 'resume'); });
  const speedControl = document.querySelector('#preview-speed'); if (speedControl) speedControl.addEventListener('change', () => { if (!qaOnly) command('speed-' + speedControl.value); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clock.pause(performance.now()); stopFrames(); if (view && materialReady && lastFrame) view.render({ ...lastFrame, visible: false, opacity: 0, ashOpacity: 0, needsAnimation: false }, false); evidence(); } else render(); });
  reduce.addEventListener('change', render);
  addEventListener('resize', () => { clock.pause(performance.now()); render(); });
  root.fuPreview.subscribe(command);
  root.fuPreview.initial().then(async value => {
    if (!value) return;
    qaOnly = value.qaOnly === true;
    controlsDisabled(true); initialCoverage = value.coverage;
    await document.fonts.ready;
    document.querySelector('#preview-source').textContent = value.source === 'frozen-current' ? '内容：打开预览时的当前符快照；后续真实任务不会改写本窗口。' : '内容：本地示例符 · 非真实任务，未调用模型。';
    document.querySelector('#preview-progress').max = timing.totalMs;
    await prepareMetadata(value.metadata);
  }).catch(showError);
  addEventListener('pagehide', () => { preparation++; stopFrames(); clock.pause(performance.now()); view?.dispose?.(); });
  setInterval(() => { updateUI(); evidence(); }, 250);
})(globalThis);
