'use strict';
let latest = null, received = 0, view, runId, animation = null;
let rafCount = 0, renderCount = 0, lastFrame = null, renderedRunId = null, lastReportAt = -Infinity;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function stop() { if (animation !== null) cancelAnimationFrame(animation); animation = null; }
function render() {
  animation = null;
  if (!latest || document.hidden || latest.hidden || !view) return;
  const delta = latest.visible ? Math.min(300, Math.max(0, performance.now() - received)) : 0;
  const frame = { ...latest, ...RitualEntrance.frameAt(latest.elapsedMs + delta, latest.reducedMotion, latest) };
  view.render(frame, latest.reducedMotion);
  renderCount++;
  renderedRunId = latest.runId;
  lastFrame = frame;
  if (frame.visible && !frame.reducedMotion && frame.needsAnimation) animation = requestAnimationFrame(() => { rafCount++; render(); });
}
function update(value) {
  latest = value; received = performance.now();
  if (!view || runId !== value.runId) { runId = value.runId; if (view) view.setMetadata(value.metadata || {}); else view = new RitualBurn.BurnView(document.querySelector('#talisman'), value.metadata || {}, { fontCoverage: coverage }); }
  stop(); render();
}
let coverage = {};
fuHost.subscribe(update);
fuHost.initial().then(value => { if (!value) return; coverage = value.coverage; update(value.snapshot); });
document.addEventListener('visibilitychange', () => { stop(); render(); });
function report() {
  if (!lastFrame || !view) return;
  const interval = latest?.diagnosticsEnabled && !document.hidden && !latest.hidden ? 100 : 1000;
  if (performance.now() - lastReportAt < interval) return;
  lastReportAt = performance.now();
  const glyphs = Array.from(view.svg.querySelectorAll('[data-writing-order] tspan'));
  const attribute = (selector, name) => Number(view.svg.querySelector(selector)?.getAttribute(name) ?? 0);
  fuHost.reportRender({ runId: renderedRunId ?? null, reducedMotion: lastFrame.reducedMotion, effectiveReducedMotion: lastFrame.reducedMotion, systemReducedMotion: reduce.matches,
    documentHidden: document.hidden, rafCount, renderCount,
    frame: { activeMs: lastFrame.elapsedMs, phase: lastFrame.phase, burn: 0, writing: lastFrame.writing, state: lastFrame.state,
      paperOpacity: attribute('#ritual-paper-base', 'opacity'), opacity: attribute('#ritual-paper-content', 'opacity'),
      visibleGlyphs: glyphs.filter(g => g.style.visibility !== 'hidden' && Number(g.style.opacity || 1) > 0).length, totalGlyphs: glyphs.length,
      holdStartMs: lastFrame.holdStartMs, leaveAtMs: lastFrame.leaveAtMs, hideAtMs: lastFrame.hideAtMs } });
}
// A system preference change is diagnostic only; it never restarts or shortens this entrance.
reduce.addEventListener('change', report);
setInterval(report, 100);
