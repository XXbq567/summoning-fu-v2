(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const clamp = value => Math.max(0, Math.min(1, value));
  function rough(x, seed, scale = 1) {
    return scale * (Math.sin(x * 0.17 + seed) * 2.7 + Math.sin(x * 0.43 + seed * 0.17) * 1.8 + Math.sin(x * 0.81 + seed * 0.09) * 0.9);
  }
  function circlePath(cx, cy, radius, seed) {
    if (radius <= 0) return '';
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const angle = i * Math.PI / 32;
      const r = Math.max(0, radius + rough(i * 4, seed, Math.min(radius / 20, 1.8)));
      pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
    }
    return 'M' + pts.join(' L') + ' Z';
  }
  function maskGeometry(progress, variant, seed) {
    const p = clamp(progress);
    if (p === 0) return { removed: '', edge: '' };
    if (p === 1) return { removed: 'M0 0H360V760H0Z', edge: '' };
    if (variant === 'bottom-up' || variant === 'top-down') {
      const y = variant === 'bottom-up' ? 754 - p * 770 : 6 + p * 770;
      const pts = Array.from({ length: 53 }, (_, i) => { const x = 24 + i * 6; return `${x},${y + rough(x, seed, 1.8)}`; });
      const edge = 'M' + pts.join(' L');
      const rest = variant === 'bottom-up' ? ' L336 790 L24 790 Z' : ' L336 -20 L24 -20 Z';
      return { removed: edge + rest, edge };
    }
    const sites = variant === 'spots' ? [[116, 188, 1], [244, 425, 0.85], [143, 646, 0.74]]
      : [[62, 60, 0.94], [298, 176, 0.92], [76, 358, 0.98], [287, 538, 1], [167, 707, 1.05], [175, 250, 0.5]];
    const expansion = variant === 'whole' ? Math.pow(p, 2) * 228 : Math.pow(p, 1.45) * 265;
    const paths = sites.map(([x, y, speed], i) => circlePath(x, y, Math.max(0, expansion * speed - i * 2), seed + i * 18));
    return { removed: paths.join(' '), edge: paths.join(' ') };
  }
  class BurnView {
    constructor(container, metadata, options = {}) {
      this.container = container; this.options = options; this.reduced = false;
      this.setMetadata(metadata);
    }
    setMetadata(metadata) {
      this.material?.dispose();
      this.disposed = false;
      const parsed = new DOMParser().parseFromString(root.RitualCore.buildTalismanSVG(metadata, { idPrefix: 'ritual' }), 'image/svg+xml');
      if (parsed.querySelector('parsererror')) throw new Error('Invalid talisman SVG');
      this.svg = document.importNode(parsed.documentElement, true);
      this.container.replaceChildren(this.svg);
      this.svg.setAttribute('aria-label', '按当前任务字段写成的召唤符');
      let defs = this.svg.querySelector('defs');
      if (!defs) { defs = node('defs'); this.svg.prepend(defs); }
      const mask = node('mask', { id: 'ritual-burn-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 760, 'mask-type': 'luminance' });
      mask.append(node('rect', { width: 360, height: 760, fill: 'white' }));
      this.cut = node('path', { fill: 'black', 'fill-rule': 'nonzero' }); mask.append(this.cut); defs.append(mask);
      const clip = node('clipPath', { id: 'ritual-fire-clip', clipPathUnits: 'userSpaceOnUse' });
      clip.append(node('rect', { x: 48, y: 20, width: 264, height: 710 })); defs.append(clip);
      this.paper = this.svg.querySelector('#ritual-paper-content') || this.svg.querySelector('#fu-paper-content');
      if (!this.paper) throw new Error('Renderer must provide a paper-content group');
      this.paperBase = this.svg.querySelector('#ritual-paper-base') || this.svg.querySelector('#fu-paper-base');
      this.paper.setAttribute('mask', 'url(#ritual-burn-mask)');
      this.rims = node('g', { 'clip-path': 'url(#ritual-fire-clip)', mask: 'url(#ritual-burn-mask)', fill: 'none', 'stroke-linejoin': 'round' });
      this.char = node('path', { stroke: '#402619', 'stroke-width': 8, opacity: 0.92 });
      this.glow = node('path', { stroke: '#e07824', 'stroke-width': 3.4, opacity: 0.9 });
      this.hot = node('path', { stroke: '#ffd176', 'stroke-width': 1.1, opacity: 0.92 });
      this.rims.append(this.char, this.glow, this.hot); this.svg.append(this.rims);
      this.ash = node('g', { fill: '#bd8e5e', opacity: 0.7 }); this.svg.append(this.ash);
      this.seal = node('g', { transform: 'translate(178 358) rotate(-9)', opacity: 0 });
      this.seal.append(node('rect', { x: -62, y: -44, width: 124, height: 88, rx: 2, fill: '#341c13', 'fill-opacity': .95, stroke: '#efc56f', 'stroke-width': 2 }));
      const sealText = node('text', { x: 0, y: 12, fill: '#efc56f', 'text-anchor': 'middle', 'font-size': 27, 'font-family': root.RitualCore.fontStack });
      sealText.textContent = '已成待阅'; this.seal.append(sealText); this.svg.append(this.seal);
      this.writing = Array.from(this.paper.querySelectorAll('[data-writing-order]'));
      this.fontReport = root.RitualFontCoverage
        ? root.RitualFontCoverage.report(this.paper.textContent, this.options.fontCoverage)
        : { checked: false, missingFromBrush: [], fallback: 'System font fallback; coverage not inspected' };
      this.prepareWriting(defs);
      // A fresh generation owns decoded textures and the WebGL scene. Old
      // preparation may finish, but its disposed session can never draw.
      const snapshot = JSON.parse(JSON.stringify(metadata || {}));
      this.material = root.RitualPaperlab?.createView(this.container, { metadata: snapshot, allowDemoProvider: this.options.allowDemoProvider === true }) || null;
      this.ready = this.material ? this.material.ready.then(() => this)
        : Promise.reject(Object.assign(new Error('engine-unavailable'), { code: 'engine-unavailable' }));
      this.ready.catch(() => {});
    }
    getPresentationState() {
      if (this.material) return this.material.getState();
      return Object.freeze({ engine: 'paperlab', libraryVersion: '0.8.1', effectiveReducedMotion: false, materialReady: false,
        canvasVisible: false, actualDrawCount: 0, phase: this.lastEntrancePhase || 'hidden', writing: 0, burn: 0,
        presenceRemaining: null, damageVersion: 0, metadataHash: null, textureHash: null, textureRasterizations: 0,
        error: this.disposed ? 'disposed' : 'engine-unavailable' });
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true; this.material?.dispose();
      if (this.svg) this.svg.style.display = 'none';
    }
    prepareWriting(defs) {
      let index = 0;
      const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
      this.writingSteps = this.writing.map(group => {
        // Separate original subpaths so each has its own measured trajectory.
        for (const original of Array.from(group.querySelectorAll('path'))) {
          const parts = (original.getAttribute('d') || '').match(/[Mm][^Mm]*/g) || [];
          if (parts.length > 1) {
            const fragment = document.createDocumentFragment();
            for (const part of parts) { const path = original.cloneNode(false); path.setAttribute('d', part); fragment.append(path); }
            original.replaceWith(fragment);
          }
        }
        const steps = [];
        for (const element of Array.from(group.querySelectorAll('path, text, rect'))) {
          if (element.tagName.toLowerCase() === 'text') {
            const text = element.textContent;
            element.setAttribute('aria-label', text);
            element.textContent = '';
            const glyphs = segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
            for (const glyph of glyphs) {
              const span = node('tspan'); span.textContent = glyph;
              if (this.fontReport.checked && !Array.from(glyph).every(ch => root.RitualFontCoverage.hasGlyph(ch, this.options.fontCoverage))) {
                span.setAttribute('font-family', "'Microsoft YaHei','SimSun','Segoe UI','Segoe UI Emoji',sans-serif");
                span.setAttribute('data-font-fallback', 'system');
              }
              element.append(span); steps.push({ element: span, weight: 1 });
            }
          } else if (element.tagName.toLowerCase() === 'path') {
            const length = element.getTotalLength();
            const maskId = 'ritual-writing-' + index++;
            const mask = node('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 760, 'mask-type': 'luminance' });
            const trace = node('path', {
              d: element.getAttribute('d'), fill: 'none', stroke: 'white', 'stroke-width': 20,
              'stroke-linecap': 'round', 'stroke-linejoin': 'round',
              'stroke-dasharray': `${length} ${length}`, 'stroke-dashoffset': length,
            });
            mask.append(trace); defs.append(mask);
            element.setAttribute('mask', `url(#${maskId})`);
            steps.push({ element, trace, length, weight: Math.max(1, Math.min(5, length / 65)) });
          } else steps.push({ element, weight: .5 });
        }
        let total = 0;
        for (const step of steps) { step.start = total; total += step.weight; step.element.style.visibility = 'hidden'; }
        return { order: Number(group.getAttribute('data-writing-order')), steps, total };
      });
    }
    renderEntrance(frame, reduced = false) {
      // Presentation expiry never supplies completed/cancelled work semantics.
      reduced = reduced || frame.reducedMotion;
      const geometry = root.RitualSendGeometry && root.RitualSendGeometry.geometryAt(frame, frame.geometry);
      const visible = !this.disposed && frame.visible && !!geometry;
      this.lastEntrancePhase = frame.phase;
      const materialPhase = ['point', 'travel', 'unfold', 'rolling', 'rotating', 'flying', 'staging', 'intake', 'seal-ack', 'seal-exit'].includes(frame.phase);
      // SVG is the original sharp typography during writing and the entire
      // hold. Only a fully flat blank sheet hands off to those glyphs.
      this.render({ ...frame, kind: undefined, state: 'entrance', seed: 0, burn: 0,
        variant: 'bottom-up', activeMs: frame.elapsedMs,
        visualFireActive: false,
        ashOpacity: 0,
        opacity: visible && !materialPhase ? frame.opacity : 0 }, reduced);
      if (this.paperBase) this.paperBase.setAttribute('opacity', reduced ? 1 : clamp(frame.paperOpacity ?? 1));
      this.svg.style.transform = '';
      this.svg.style.visibility = visible ? 'visible' : 'hidden';
      this.svg.style.display = visible && (!materialPhase || reduced) ? '' : 'none';
      this.svg.setAttribute('data-presentation-phase', frame.phase);
      this.material?.render({ ...frame, visible: visible && !reduced });
    }
    render(frame, reduced = false) {
      if (frame.kind === 'entrance') return this.renderEntrance(frame, reduced);
      if (frame.state !== 'entrance') this.material?.render({ phase: 'hidden', visible: false, writing: 0, burn: 0 });
      if (this.svg) { this.svg.style.transform = ''; this.svg.style.visibility = 'visible'; this.svg.style.display = ''; }
      if (this.paperBase) this.paperBase.setAttribute('opacity', 1);
      this.reduced = reduced;
      const entrance = frame.state === 'entrance';
      const active = entrance ? frame.visualFireActive === true : frame.state === 'working';
      const showWhole = frame.state === 'completed' || frame.state === 'idle';
      const burn = reduced || showWhole ? 0 : frame.burn;
      const shape = maskGeometry(burn, frame.variant, frame.seed % 10000);
      const fireActive = active && !reduced && burn > 0 && burn < 1;
      this.cut.setAttribute('d', shape.removed);
      for (const el of [this.char, this.glow, this.hot]) el.setAttribute('d', shape.edge);
      this.rims.setAttribute('opacity', fireActive ? 1 : 0);
      this.glow.setAttribute('opacity', fireActive ? .9 : 0);
      this.hot.setAttribute('opacity', fireActive ? .92 : 0);
      this.paper.setAttribute('opacity', frame.state === 'cancelled' ? 0 : frame.state === 'unknown' ? .45 : showWhole ? 1 : Math.max(0, frame.opacity));
      for (const group of this.writingSteps) {
        const amount = reduced || showWhole ? 1 : root.RitualCore.writingProgress(frame.writing, group.order);
        for (const step of group.steps) {
          let progress = clamp((amount * group.total - step.start) / step.weight);
          if (frame.state === 'entrance' && !step.trace) {
            // Overlapping fades soften glyph entry while keeping every glyph at
            // its final position and finishing each semantic group on time.
            const start = step.start / group.total;
            const span = Math.min(1 - start, Math.max(step.weight / group.total, .22));
            progress = clamp((amount - start) / span);
          }
          step.element.style.visibility = progress > 0 ? 'visible' : 'hidden';
          if (step.trace) step.trace.setAttribute('stroke-dashoffset', step.length * (1 - progress));
          // Text keeps accurate font glyphs and appears in reading order. This is
          // glyph reveal, not an invented claim of Chinese stroke-order data.
          else step.element.style.opacity = String(frame.state === 'entrance' ? progress * progress * (3 - 2 * progress) : clamp(progress * 4));
        }
      }
      this.seal.setAttribute('opacity', frame.state === 'completed' ? 1 : 0);
      this.ash.replaceChildren();
      this.ash.setAttribute('opacity', entrance ? clamp(frame.ashOpacity || 0) * .7 : .7);
      const residualAsh = entrance && !reduced && burn === 1 && frame.ashOpacity > 0;
      if ((fireActive && burn > 0.02 && burn < 0.995) || residualAsh) {
        const t = frame.activeMs / 1000;
        for (let i = 0; i < (residualAsh ? 8 : 10); i++) {
          const life = (t * (0.28 + i * .009) + i * .137) % 1;
          const x = 72 + ((i * 73 + frame.seed) % 220) + Math.sin(t + i) * 11;
          const edgeY = residualAsh ? 68 + i % 3 * 12 : frame.variant === 'bottom-up' ? 750 - burn * 770 : frame.variant === 'top-down' ? 6 + burn * 770 : 620 - i * 48;
          this.ash.append(node('rect', { x, y: edgeY - life * 78, width: i % 3 ? 1.3 : 2.2, height: 3.2, opacity: (1 - life) * .55, transform: `rotate(${i * 32 + t * 10} ${x} ${edgeY - life * 78})` }));
        }
      }
    }
  }
  root.RitualBurn = { BurnView, maskGeometry };
})(globalThis);
