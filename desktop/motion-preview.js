(function (root) {
  'use strict';
  class PreviewClock {
    constructor(duration) { this.duration = duration; this.position = 0; this.startedAt = 0; this.playing = false; this.generation = 0; }
    snapshot(now) {
      const elapsedMs = Math.min(this.duration, this.position + (this.playing ? Math.max(0, now - this.startedAt) : 0));
      if (elapsedMs >= this.duration) { this.position = this.duration; this.playing = false; }
      return { elapsedMs, playing: this.playing, generation: this.generation };
    }
    replay(now) { this.position = 0; this.startedAt = now; this.playing = true; this.generation++; }
    pause(now) { this.position = this.snapshot(now).elapsedMs; this.startedAt = now; this.playing = false; }
    resume(now) { if (this.position < this.duration) { this.startedAt = now; this.playing = true; } }
    seek(value, now) { if (!Number.isFinite(value)) return; this.position = Math.max(0, Math.min(this.duration, value)); this.startedAt = now; this.playing = false; this.generation++; }
  }
  const shouldAnimateFrame = (frame, hidden) => !hidden && frame.visible === true && frame.reducedMotion !== true && frame.needsAnimation === true;
  if (typeof module === 'object' && module.exports) { module.exports = { PreviewClock, shouldAnimateFrame }; return; }
  root.FuMotion = { PreviewClock, shouldAnimateFrame };
  if (!document.querySelector('#preview-paper')) return;
  const timing = root.RitualEntrance.timings, clock = new PreviewClock(timing.totalMs);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let view = null, raf = null, wake = null, rafCount = 0, renderCount = 0, lastFrame = null, lastEvidenceAt = -Infinity;
  const labels = { paper: '纸张显现', writing: '字序写入', seal: '落敕定形', hold: '完整停留 · 10 秒', leaving: '轻收符淡出', hidden: '本次预览结束' };
  function stopFrames() { if (raf !== null) cancelAnimationFrame(raf); clearTimeout(wake); raf = null; wake = null; }
  function numericAttribute(element, name) { const number = Number(element?.getAttribute(name)); return Number.isFinite(number) ? number : 0; }
  function evidence() {
    if (!view || !lastFrame) return;
    if (performance.now() - lastEvidenceAt < 100) return;
    lastEvidenceAt = performance.now();
    const glyphs = Array.from(view.svg.querySelectorAll('[data-writing-order] tspan'));
    root.fuPreview.report({ ...clock.snapshot(performance.now()), phase: lastFrame.phase, systemReducedMotion: reduce.matches, effectiveReducedMotion: false, documentHidden: document.hidden,
      renderCount, rafCount, paperOpacity: numericAttribute(view.svg.querySelector('#ritual-paper-base'), 'opacity'), opacity: numericAttribute(view.svg.querySelector('#ritual-paper-content'), 'opacity'), writing: lastFrame.writing,
      visibleGlyphs: glyphs.filter(glyph => glyph.style.visibility !== 'hidden' && Number(glyph.style.opacity || 1) > 0).length, totalGlyphs: glyphs.length,
      uiElapsedMs: Number(document.querySelector('#preview-progress').value),
      holdStartMs: lastFrame.holdStartMs, leaveAtMs: lastFrame.leaveAtMs, hideAtMs: lastFrame.hideAtMs });
  }
  function updateUI(state = clock.snapshot(performance.now())) {
    if (!view || document.hidden) return;
    document.querySelector('#preview-time').textContent = `${(state.elapsedMs / 1000).toFixed(1)} / ${(timing.totalMs / 1000).toFixed(1)} 秒`;
    document.querySelector('#preview-progress').value = state.elapsedMs;
    document.querySelector('#pause-preview').textContent = state.playing ? '暂停' : '继续';
    document.querySelector('#preview-policy').textContent = `系统减少动态：${reduce.matches ? '开启' : '关闭'}。本应用的正常入口和独立预览均播放完整动效；Windows 设置保持不变。`;
  }
  function render() {
    stopFrames();
    if (!view || document.hidden) return;
    const state = clock.snapshot(performance.now());
    lastFrame = root.RitualEntrance.frameAt(state.elapsedMs, false);
    view.render(lastFrame, false); renderCount++;
    document.querySelector('#preview-stage').textContent = labels[lastFrame.phase];
    updateUI(state);
    if (state.playing && shouldAnimateFrame(lastFrame, document.hidden)) raf = requestAnimationFrame(() => { rafCount++; render(); });
    else if (state.playing) wake = setTimeout(render, Math.max(1, lastFrame.leaveAtMs - state.elapsedMs + 1));
    evidence();
  }
  function command(action) {
    const now = performance.now();
    const positions = { paper: timing.paperEndMs / 2, writing: (timing.paperEndMs + timing.writingEndMs) / 2, seal: (timing.writingEndMs + timing.holdStartMs) / 2, hold: timing.holdStartMs + 1000, leaving: timing.leaveAtMs + (timing.totalMs - timing.leaveAtMs) / 2 };
    if (action === 'replay') clock.replay(now);
    else if (action === 'pause') clock.pause(now);
    else if (action === 'resume') clock.resume(now);
    else if (action === 'stop') clock.seek(timing.totalMs, now);
    else if (Object.hasOwn(positions, action)) clock.seek(positions[action], now);
    else return;
    render();
  }
  document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => command(button.dataset.preview)));
  document.querySelector('#pause-preview').addEventListener('click', () => command(clock.snapshot(performance.now()).playing ? 'pause' : 'resume'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clock.pause(performance.now()); stopFrames(); evidence(); } else render(); });
  reduce.addEventListener('change', render);
  root.fuPreview.subscribe(command);
  root.fuPreview.initial().then(async value => {
    if (!value) return;
    await document.fonts.ready;
    document.querySelector('#preview-source').textContent = value.source === 'frozen-current' ? '内容：打开预览时的当前符快照；后续真实任务不会改写本窗口。' : '内容：本地示例符 · 非真实任务，未调用模型。';
    document.querySelector('#preview-progress').max = timing.totalMs;
    view = new root.RitualBurn.BurnView(document.querySelector('#preview-paper'), value.metadata, { fontCoverage: value.coverage });
    clock.replay(performance.now()); render();
  });
  setInterval(() => { updateUI(); evidence(); }, 250);
})(globalThis);
