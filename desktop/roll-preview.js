(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value || {}));
  class RollClock {
    constructor(durationMs) { this.durationMs = durationMs; this.position = 0; this.startedAt = 0; this.playing = false; this.speed = 1; }
    snapshot(now) { return { elapsedMs: Math.min(this.durationMs, this.position + (this.playing ? Math.max(0, now - this.startedAt) * this.speed : 0)), playing: this.playing, speed: this.speed }; }
    replay(now) { this.position = 0; this.startedAt = now; this.playing = true; }
    pause(now) { this.position = this.snapshot(now).elapsedMs; this.startedAt = now; this.playing = false; }
    finish(now) { this.position = this.durationMs; this.startedAt = now; this.playing = false; }
    seek(value, now) { if (!Number.isFinite(value)) return; this.position = Math.max(0, Math.min(this.durationMs, value)); this.startedAt = now; this.playing = false; }
    resume(now) { if (this.position >= this.durationMs) return false; this.startedAt = now; this.playing = true; return true; }
    setSpeed(value, now) { if (![.5, 1].includes(value)) return; const playing = this.playing; this.pause(now); this.speed = value; if (playing) this.resume(now); }
  }
  class RollController {
    constructor({ durationMs, makeView, now = () => performance.now(), requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id), onChange = () => {} }) {
      Object.assign(this, { makeView, now, requestFrame, cancelFrame, onChange });
      this.clock = new RollClock(durationMs); this.generation = 0; this.raf = null; this.rafCount = 0; this.renderCount = 0;
      this.view = null; this.pendingView = null; this.ready = false; this.preparing = false; this.closed = true; this.phase = 'hidden'; this.elapsedMs = 0; this.cancelReason = 'none'; this.textureMode = 'bands'; this.renderer = null; this.config = {};
    }
    stopFrames() { if (this.raf !== null) this.cancelFrame(this.raf); this.raf = null; }
    async start(config = this.config, options = {}) {
      this.cancel('replacement'); const generation = ++this.generation;
      this.config = clone(config); this.textureMode = config.textureMode === 'talisman' ? 'talisman' : 'bands';
      this.preparing = true; this.closed = false; this.cancelReason = 'none'; this.elapsedMs = 0; this.phase = 'hidden'; this.onChange();
      let prepared;
      try {
        prepared = this.makeView({ ...clone(this.config), textureMode: this.textureMode }); this.pendingView = prepared;
        await prepared.ready;
        if (generation !== this.generation || this.closed) { prepared.dispose?.(); return false; }
        this.pendingView = null; this.view = prepared; this.preparing = false; this.ready = true;
        this.clock.seek(Number.isFinite(options.elapsedMs) ? options.elapsedMs : 0, this.now());
        this.draw();
        if (generation !== this.generation || !this.ready || this.closed) return false;
        // Commit the exact flat/seek pose before starting wall time. Readiness
        // and evidence sampling can never consume the first visible frame.
        if (options.autoPlay !== false && this.clock.resume(this.now())) {
          this.raf = this.requestFrame(() => { this.raf = null; this.rafCount++; this.draw(); });
          this.onChange();
        }
        return true;
      } catch {
        prepared?.dispose?.();
        if (generation === this.generation) this.cancel('render-failed');
        return false;
      }
    }
    draw() {
      this.stopFrames(); if (!this.ready || this.closed || !this.view) return;
      const state = this.clock.snapshot(this.now()); this.elapsedMs = state.elapsedMs;
      this.phase = state.elapsedMs === 0 ? 'flat' : state.elapsedMs >= this.clock.durationMs ? 'rolled' : 'rolling';
      try { this.view.render({ elapsedMs: state.elapsedMs, visible: true, generation: this.generation }); this.renderCount++; this.renderer = this.view.getState?.() || {}; }
      catch { this.cancel('render-failed'); return; }
      // The shared session intentionally catches engine exceptions and exposes
      // them through state. A successful call alone is not a successful frame.
      if (this.renderer.error || this.renderer.materialReady === false) { this.cancel('render-failed'); return; }
      if (state.elapsedMs >= this.clock.durationMs) this.clock.finish(this.now());
      this.onChange();
      if (this.clock.playing) this.raf = this.requestFrame(() => { this.raf = null; this.rafCount++; this.draw(); });
    }
    pause() { if (!this.ready || this.closed) return false; this.clock.pause(this.now()); this.draw(); return true; }
    resume() { if (!this.ready || this.closed || !this.clock.resume(this.now())) return false; this.draw(); return true; }
    seek(value) { if (!this.ready || this.closed || !Number.isFinite(value)) return false; this.clock.seek(value, this.now()); this.draw(); return true; }
    setSpeed(value) { this.clock.setSpeed(value, this.now()); if (this.ready && !this.closed) this.draw(); else this.onChange(); }
    cancel(reason = 'cancelled') {
      this.generation++; this.clock.pause(this.now()); this.stopFrames(); this.closed = true; this.preparing = false; this.ready = false;
      this.cancelReason = ['replacement', 'cancelled', 'document-hidden', 'geometry-changed', 'pagehide', 'render-failed'].includes(reason) ? reason : 'cancelled';
      if (this.view) { try { this.view.render({ elapsedMs: this.elapsedMs, visible: false, generation: this.generation - 1 }); this.renderCount++; } catch {} this.view.dispose?.(); this.renderer = this.view.getState?.() || {}; }
      this.pendingView?.dispose?.(); this.pendingView = null; this.view = null; this.phase = 'hidden'; this.onChange();
    }
    evidence() { return { ready: this.ready, preparing: this.preparing, generation: this.generation, textureMode: this.textureMode, phase: this.phase, elapsedMs: this.elapsedMs,
      clockElapsedMs: this.clock.snapshot(this.now()).elapsedMs, playing: this.clock.playing, speed: this.clock.speed, cancelReason: this.cancelReason,
      rafCount: this.rafCount, renderCount: this.renderCount, renderer: this.view?.getState?.() || this.renderer, source: 'synthetic-local-only' }; }
  }
  if (typeof module === 'object' && module.exports) { module.exports = { RollClock, RollController }; return; }
  const container = document.querySelector('#roll-paper'); if (!container) return;
  const motion = root.RitualPaperlab.rollMotion, durationMs = motion.durationMs;
  let controller, qaOnly = false, fixture = null;
  const labels = { hidden: '本轮已清空', flat: '完整平纸', rolling: '底边向上收卷', rolled: '横向纸卷 · 保持查看' };
  function geometry() { const r = container.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }
  function readEvidence() { return controller ? { ...controller.evidence(), geometry: geometry(), canvasPresent: !!container.querySelector('canvas') } : { ready: false, preparing: true, phase: 'hidden', generation: 0 }; }
  function update() {
    if (!controller) return;
    const state = readEvidence();
    document.querySelector('#roll-state').textContent = state.preparing ? '正在准备本地纸张与纹理…' : state.cancelReason === 'render-failed' ? '纸张准备失败，请重播' : labels[state.phase];
    document.querySelector('#roll-time').textContent = Math.round(state.elapsedMs) + ' / ' + durationMs + ' ms';
    document.querySelector('#roll-progress').value = state.elapsedMs;
    document.querySelector('#roll-pause').textContent = state.playing ? '暂停' : '继续';
    document.querySelector('#roll-speed').value = String(state.speed);
    document.querySelector('#roll-texture').value = state.textureMode;
    document.querySelectorAll('[data-chapter],#roll-pause,#roll-progress').forEach(element => { element.disabled = qaOnly || !state.ready; });
    document.querySelectorAll('#roll-replay,#roll-stop,#roll-speed,#roll-texture').forEach(element => { element.disabled = qaOnly; });
    root.rollPreview.report(state);
  }
  function command(input) {
    const action = typeof input === 'string' ? input : input?.action;
    if (!controller) return false;
    if (action === 'window-hidden') { controller.cancel('document-hidden'); return true; }
    if (action === 'replay') { void controller.start({ metadata: fixture, textureMode: controller.textureMode }); return true; }
    if (action === 'stop') { controller.cancel('cancelled'); return true; }
    if (action === 'pause') return controller.pause();
    if (action === 'resume') return controller.resume();
    if (['speed-0.5', 'speed-1'].includes(action)) { controller.setSpeed(Number(action.slice(6))); return true; }
    if (action === 'seek') return controller.seek(input.elapsedMs);
    if (['flat', 'start', 'half', 'closing', 'rolled'].includes(action)) {
      const elapsedMs = action === 'flat' ? 0 : motion.chapterElapsed(action);
      if (controller.ready && !controller.closed) return controller.seek(elapsedMs);
      void controller.start({ metadata: fixture, textureMode: controller.textureMode }, { autoPlay: false, elapsedMs }); return true;
    }
    if (['texture-bands', 'texture-talisman', 'fixture-a', 'fixture-b'].includes(action)) {
      if (action.startsWith('fixture-')) fixture = { ...fixture, model: action === 'fixture-a' ? '示例甲模型' : '示例乙模型', task: action === 'fixture-a' ? '检查甲纸卷' : '检查乙纸卷' };
      const textureMode = action.startsWith('texture-') ? action.slice(8) : controller.textureMode;
      void controller.start({ metadata: fixture, textureMode }); return true;
    }
    return false;
  }
  root.RollPreview = Object.freeze({ readEvidence, command });
  root.rollPreview.subscribe(command);
  document.querySelector('#roll-replay').addEventListener('click', () => command('replay'));
  document.querySelector('#roll-stop').addEventListener('click', () => command('stop'));
  document.querySelector('#roll-pause').addEventListener('click', () => command(controller.clock.playing ? 'pause' : 'resume'));
  document.querySelector('#roll-speed').addEventListener('change', event => command('speed-' + event.target.value));
  document.querySelector('#roll-texture').addEventListener('change', event => command('texture-' + event.target.value));
  document.querySelector('#roll-progress').addEventListener('input', event => command({ action: 'seek', elapsedMs: Number(event.target.value) }));
  document.querySelectorAll('[data-chapter]').forEach(button => button.addEventListener('click', () => command(button.dataset.chapter)));
  document.addEventListener('visibilitychange', () => { if (document.hidden) controller?.cancel('document-hidden'); else update(); });
  addEventListener('resize', () => controller?.cancel('geometry-changed'));
  addEventListener('pagehide', () => controller?.cancel('pagehide'));
  root.rollPreview.initial().then(async value => {
    qaOnly = value.qaOnly === true; fixture = value.metadata;
    await document.fonts.ready;
    controller = new RollController({ durationMs, makeView: options => root.RitualPaperlab.createRollPreviewView(container, options), onChange: update });
    document.querySelector('#roll-progress').max = durationMs;
    if (!document.hidden) await controller.start({ metadata: fixture, textureMode: 'bands' });
    else controller.cancel('document-hidden');
    update();
  }).catch(() => { document.querySelector('#roll-state').textContent = '本地预览准备失败，请重新打开。'; });
  setInterval(update, 50);
})(globalThis);
