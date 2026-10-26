'use strict';
let latest = null, received = 0, view, viewKey = '', readyKey = '', animation = null, wake = null, coverage = {};
let rafCount = 0, renderCount = 0, lastFrame = null, renderedRunId = null, lastReportAt = -Infinity;
let deliveryPlan = null, planKey = '', cancelledKey = '', closed = false, terminalElapsed = null;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function stop() { if (animation !== null) cancelAnimationFrame(animation); clearTimeout(wake); animation = null; wake = null; }
function keyFor(value) { return value ? value.runId + ':' + value.presentationToken : ''; }
function naturalEnd() { return Number.isFinite(latest?.hideAtMs) ? latest.hideAtMs : RitualEntrance.timings.leaveAtMs + ((deliveryPlan || latest?.deliveryPlan)?.durationMs || 0) + (latest?.localSeal ? 400 : 0); }
function finishNaturally() {
  terminalElapsed = naturalEnd(); cancelledKey = viewKey; deliveryPlan = null; planKey = ''; stop();
}
function invalidate(reason) {
  if (!latest || cancelledKey === viewKey) return;
  cancelledKey = viewKey; deliveryPlan = null; planKey = ''; stop();
  fuHost.reportInvalidation?.({ runId: latest.runId, token: latest.presentationToken, reason });
}
function render() {
  animation = null;
  if (closed || !latest || !view || readyKey !== viewKey) return;
  const concealed = document.hidden || latest.hidden || latest.presentationPreparing || cancelledKey === viewKey;
  const localDelta = Math.max(0, performance.now() - received), delta = !concealed && latest.visible ? Math.min(300, localDelta) : 0;
  const nowMs = Number.isFinite(latest.presentationNowMs) ? latest.presentationNowMs + localDelta : performance.now();
  let frame = { ...latest, ...RitualEntrance.frameAt(latest.elapsedMs + delta, false, { ...latest, deliveryPlan, nowMs, allowPreviewTarget: false }) };
  if (!concealed && latest.visible && !frame.visible) {
    if (deliveryPlan && frame.elapsedMs < naturalEnd()) invalidate('target-changed');
    else finishNaturally();
  }
  if (terminalElapsed !== null) frame = { ...frame, elapsedMs: terminalElapsed, hideAtMs: terminalElapsed };
  if (concealed || cancelledKey === viewKey) frame = { ...frame, visible: false, phase: 'hidden', opacity: 0, paperOpacity: 0, ashOpacity: 0, needsAnimation: false, delivery: null };
  if (!concealed && frame.phase === 'hold' && lastFrame?.phase === 'hold' && renderedRunId === latest.runId && !frame.needsAnimation) {
    if (frame.nextAnimationAtMs > frame.elapsedMs) wake = setTimeout(render, frame.nextAnimationAtMs - frame.elapsedMs);
    return;
  }
  try {
    view.render(frame, false); renderCount++;
    const actual = view.getPresentationState?.();
    if (frame.visible && actual && (actual.error || actual.materialReady === false)) throw Error('renderer-reported-failure');
  } catch {
    invalidate('render-failed');
    frame = { ...frame, visible: false, phase: 'hidden', opacity: 0, paperOpacity: 0, ashOpacity: 0, needsAnimation: false, delivery: null };
    try { view.render(frame, false); renderCount++; } catch {}
    view.dispose?.(); readyKey = '';
  }
  renderedRunId = latest.runId; lastFrame = frame;
  if (frame.visible && frame.needsAnimation) animation = requestAnimationFrame(() => { rafCount++; render(); });
  else if (frame.visible && frame.nextAnimationAtMs > frame.elapsedMs) wake = setTimeout(render, frame.nextAnimationAtMs - frame.elapsedMs);
}
function update(value) {
  if (closed) return;
  latest = value; received = performance.now(); stop();
  const rect = value.geometry?.targetRect, container = document.querySelector('#talisman');
  if (rect) { container.style.left = rect.x + 'px'; container.style.top = rect.y + 'px'; container.style.width = rect.width + 'px'; container.style.height = rect.height + 'px'; }
  const nextKey = keyFor(value);
  if (nextKey !== viewKey) { cancelledKey = ''; deliveryPlan = null; planKey = ''; terminalElapsed = null; }
  if (!value.presentationPreparing && value.hidden) cancelledKey = nextKey;
  if (value.deliveryPlan && cancelledKey !== nextKey) {
    const incomingKey = JSON.stringify(value.deliveryPlan);
    if (deliveryPlan && incomingKey !== planKey) invalidate('geometry-changed');
    else if (!deliveryPlan) { deliveryPlan = value.deliveryPlan; planKey = incomingKey; }
  }
  if (viewKey !== nextKey || !view) {
    viewKey = nextKey; readyKey = ''; lastFrame = null;
    try {
      if (view) view.setMetadata(value.metadata || {});
      else view = new RitualBurn.BurnView(container, value.metadata || {}, { fontCoverage: coverage });
      const preparedView = view;
      Promise.resolve(view.ready).then(() => {
        if (closed || cancelledKey === nextKey || view !== preparedView || viewKey !== nextKey || keyFor(latest) !== nextKey) return;
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
function nativeHidden() {
  stop();
  if (latest?.visible && !latest.presentationPreparing && cancelledKey !== viewKey) {
    const elapsed = latest.elapsedMs + Math.max(0, performance.now() - received);
    if (elapsed >= naturalEnd()) finishNaturally();
    else invalidate('document-hidden');
  }
  render();
}
fuHost.subscribeNativeHidden?.(nativeHidden);
document.addEventListener('visibilitychange', () => {
  // Native host hide and its terminal IPC copy may arrive in either order.
  // Both paths use the uncapped elapsed clock to distinguish natural expiry.
  if (document.hidden) nativeHidden(); else { stop(); render(); }
});
addEventListener('pagehide', () => { invalidate('pagehide'); closed = true; stop(); view?.dispose?.(); });
function report() {
  if (!lastFrame || !view) return;
  const interval = latest?.diagnosticsEnabled && !document.hidden && !latest.hidden ? 35 : 1000;
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
setInterval(report, 40);
