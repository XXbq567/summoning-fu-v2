'use strict';
let latest = null, received = 0, view, viewKey = '', readyKey = '', animation = null, coverage = {};
let rafCount = 0, renderCount = 0, lastFrame = null, renderedRunId = null, lastReportAt = -Infinity;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function stop() { if (animation !== null) cancelAnimationFrame(animation); animation = null; }
function keyFor(value) { return value ? value.runId + ':' + value.presentationToken : ''; }
function render() {
  animation = null;
  if (!latest || !view || readyKey !== viewKey) return;
  const concealed = document.hidden || latest.hidden || latest.presentationPreparing;
  const delta = !concealed && latest.visible ? Math.min(300, Math.max(0, performance.now() - received)) : 0;
  const frame = { ...latest, ...RitualEntrance.frameAt(latest.elapsedMs + delta, false, latest), ...(concealed ? { visible: false, opacity: 0, ashOpacity: 0, needsAnimation: false } : {}) };
  if (!concealed && frame.phase === 'hold' && lastFrame?.phase === 'hold' && renderedRunId === latest.runId) return;
  view.render(frame, false); renderCount++; renderedRunId = latest.runId; lastFrame = frame;
  if (frame.visible && frame.needsAnimation) animation = requestAnimationFrame(() => { rafCount++; render(); });
}
function update(value) {
  latest = value; received = performance.now(); stop();
  const rect = value.geometry?.targetRect, container = document.querySelector('#talisman');
  if (rect) { container.style.left = rect.x + 'px'; container.style.top = rect.y + 'px'; container.style.width = rect.width + 'px'; container.style.height = rect.height + 'px'; }
  const nextKey = keyFor(value);
  if (viewKey !== nextKey || !view) {
    viewKey = nextKey; readyKey = ''; lastFrame = null;
    try {
      if (view) view.setMetadata(value.metadata || {});
      else view = new RitualBurn.BurnView(container, value.metadata || {}, { fontCoverage: coverage });
      const preparedView = view;
      Promise.resolve(view.ready).then(() => {
        if (view !== preparedView || viewKey !== nextKey || keyFor(latest) !== nextKey) return;
        readyKey = nextKey;
        if (latest.presentationPreparing) fuHost.reportReady({ runId: latest.runId, token: latest.presentationToken, status: 'ready' });
        else render();
      }).catch(() => {
        if (viewKey === nextKey && latest?.presentationPreparing) fuHost.reportReady({ runId: latest.runId, token: latest.presentationToken, status: 'error' });
      });
    } catch {
      if (value.presentationPreparing) fuHost.reportReady({ runId: value.runId, token: value.presentationToken, status: 'error' });
    }
  } else render();
}
fuHost.subscribe(update);
fuHost.initial().then(value => { if (value) { coverage = value.coverage; update(value.snapshot); } });
document.addEventListener('visibilitychange', () => { stop(); render(); });
addEventListener('pagehide', () => { stop(); view?.dispose?.(); });
function report() {
  if (!lastFrame || !view) return;
  const interval = latest?.diagnosticsEnabled && !document.hidden && !latest.hidden ? 100 : 1000;
  if (performance.now() - lastReportAt < interval) return;
  lastReportAt = performance.now();
  const glyphs = Array.from(view.svg?.querySelectorAll('[data-writing-order] tspan') || []);
  const attribute = (selector, name) => Number(view.svg?.querySelector(selector)?.getAttribute(name) ?? 0);
  const material = view.getPresentationState?.();
  fuHost.reportRender({ runId: renderedRunId ?? null, reducedMotion: false, effectiveReducedMotion: false, systemReducedMotion: reduce.matches,
    documentHidden: document.hidden, rafCount, renderCount, ...(material ? { paperlab: material } : {}),
    frame: { activeMs: lastFrame.elapsedMs, phase: lastFrame.phase, burn: lastFrame.burn, writing: lastFrame.writing, state: lastFrame.state,
      paperOpacity: attribute('#ritual-paper-base', 'opacity'), opacity: attribute('#ritual-paper-content', 'opacity'),
      visibleGlyphs: glyphs.filter(g => g.style.visibility !== 'hidden' && Number(g.style.opacity || 1) > 0).length, totalGlyphs: glyphs.length,
      holdStartMs: lastFrame.holdStartMs, leaveAtMs: lastFrame.leaveAtMs, hideAtMs: lastFrame.hideAtMs } });
}
reduce.addEventListener('change', report);
setInterval(report, 100);
