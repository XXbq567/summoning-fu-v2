// Builds a standalone offline preview from the editable renderer and template.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const font = fs.readFileSync(path.join(root, 'assets/fonts/MaShanZheng-Regular.ttf'));
const license = read('assets/fonts/OFL.txt');
const escapeHTML = value => value.replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
const replacements = {
  FONT_DATA: 'data:font/ttf;base64,' + font.toString('base64'),
  FONT_LICENSE: escapeHTML(license),
  LICENSE_JSON: JSON.stringify(license).replace(/</g, '\\u003c'),
  RITUAL_CORE: read('renderer/ritual-core.js'),
  TIMELINE: read('renderer/ritual-timeline.js'),
  BURN_VIEW: read('renderer/burn-view.js')
};
let html = read('preview/template.html').replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
  if (!(key in replacements)) throw new Error('Unknown template placeholder: ' + key);
  return replacements[key];
});
const output = path.join(root, 'SUMMONING-FU-PREVIEW.html');
fs.writeFileSync(output, html);
console.log(JSON.stringify({output, bytes:Buffer.byteLength(html), externalDependencies:0}));
