// Builds an offline copy of the same desktop Paperlab preview and controller.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const root = path.resolve(__dirname, '..');
const escapeHTML = value => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
const scriptText = value => value.replace(/<\/script/gi, '<\\/script');
function createStandalone({ rootDir = root } = {}) {
  const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
  const artifacts = assertPaperlabArtifacts(rootDir);
  const fontData = 'data:font/ttf;base64,' + fs.readFileSync(path.join(rootDir, 'assets/fonts/MaShanZheng-Regular.ttf')).toString('base64');
  const desktop = read('desktop/motion-preview.html');
  const content = desktop.match(/<body class="motion-preview">([\s\S]*?)<script\b/);
  if (!content) throw Error('Shared preview markup missing.');
  const metadata = { relay: '本地示例', company: '原创示例', model: '示例模型', harness: 'Codex', environment: '本机离线预览', reasoning: 'xhigh',
    sources: Object.fromEntries(['relay', 'company', 'model', 'harness', 'environment', 'reasoning', 'task'].map(key => [key, 'demo'])),
    presentation: { mode: 'entrance', sessionId: 'offline-preview-example', chatTitle: { value: '本地示例 · 观纸落墨', source: 'manual' } } };
  const initial = JSON.stringify({ metadata, coverage: JSON.parse(read('assets/fonts/coverage.json')), source: 'example', qaOnly: false }).replace(/</g, '\\u003c');
  const bridge = `globalThis.fuPreview = Object.freeze({ initial: async () => (${initial}), subscribe() {}, report(value) { globalThis.paperlabPreviewEvidence = value; } });`;
  const replacements = {
    PREVIEW_CONTENT: content[1],
    WINDOW_CSS: read('desktop/window.css').replace('../assets/fonts/MaShanZheng-Regular.ttf', fontData),
    PREVIEW_BRIDGE: bridge,
    RITUAL_CORE: read('renderer/ritual-core.js'),
    DELIVERY_MOTION: read('renderer/delivery-motion.js'),
    ENTRANCE_TIMELINE: read('renderer/entrance-timeline.js'),
    SEND_GEOMETRY: read('renderer/send-geometry.js'),
    FONT_COVERAGE: read('renderer/font-coverage.js'),
    PAPERLAB_RUNTIME: read('renderer/generated/paperlab-runtime.js'),
    BURN_VIEW: read('renderer/burn-view.js'),
    PREVIEW_CONTROLLER: read('desktop/motion-preview.js'),
    FONT_LICENSE: escapeHTML(read('assets/fonts/OFL.txt')),
    THIRD_PARTY_NOTICES: escapeHTML(read('THIRD-PARTY-NOTICES.md')),
    THIRD_PARTY_TERMS: artifacts.licenseFiles.map(file => '<h3>' + escapeHTML(file) + '</h3><pre>' + escapeHTML(fs.readFileSync(path.join(artifacts.licenseRoot, file), 'utf8')) + '</pre>').join('\n')
  };
  const scripts = new Set(['PREVIEW_BRIDGE', 'RITUAL_CORE', 'DELIVERY_MOTION', 'ENTRANCE_TIMELINE', 'SEND_GEOMETRY', 'FONT_COVERAGE', 'PAPERLAB_RUNTIME', 'BURN_VIEW', 'PREVIEW_CONTROLLER']);
  return read('preview/template.html').replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
    if (!Object.hasOwn(replacements, key)) throw Error('Unknown template placeholder: ' + key);
    return scripts.has(key) ? scriptText(replacements[key]) : replacements[key];
  });
}
function build() {
  const html = createStandalone(), output = path.join(root, 'SUMMONING-FU-PREVIEW.html');
  fs.writeFileSync(output, html);
  console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), engine: 'paperlab', libraryVersion: '0.8.1', externalDependencies: 0 }));
  return output;
}
if (require.main === module) { try { build(); } catch (error) { console.error('Offline preview build failed: ' + error.message); process.exitCode = 1; } }
module.exports = { createStandalone, build };
