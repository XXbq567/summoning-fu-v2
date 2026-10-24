'use strict';
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const changedNotice = `/*!
 * LOCAL MODIFICATIONS - Summoning Fu, 2026-10-24.
 * This generated bundle includes Paperlab 0.8.1 (Apache-2.0).
 * Runtime adaptation preserves the original art alpha on the Paperlab sheet.
 * Project-owned Three.js bands, hinges and clipping implement folded delivery.
 * This delivery runtime does not import Paperlab fire effects.
 * These are project integration changes; installed upstream files are unchanged.
 * Upstream copyright, license and NOTICE remain applicable and are distributed
 * with the project's third-party notices.
 */`;
// Resolve within this checkout. esbuild otherwise parses unrelated ancestor
// package.json files (this Windows account has an invalid legacy one).
const isolatedModules = { name: 'project-module-boundary', setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
    if (['@react-three/postprocessing', 'postprocessing'].includes(args.path)) return { path: args.path, external: true };
    let file;
    if (args.kind === 'entry-point') file = path.resolve(root, args.path);
    else file = require.resolve(args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : args.path, { paths: [args.resolveDir || root] });
    if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) {
      const name = args.path.startsWith('@') ? args.path.split('/').slice(0, 2).join('/') : args.path.split('/')[0];
      let folder = path.dirname(file);
      while (folder.startsWith(root)) {
        const manifest = path.join(folder, 'package.json');
        if (fs.existsSync(manifest)) {
          const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          if (pkg.name === name) {
            if (args.path === name && pkg.module) file = path.resolve(folder, pkg.module);
            // Public fire components are used. The unused optional post pass
            // is removed by the narrowly checked pure annotation below.
            if (args.path === 'paperlab/fx') {
              if (pkg.version !== '0.8.1') throw new Error('Recheck Paperlab DamageField chunk after a version change');
              file = path.join(folder, 'dist/fx.js');
            }
            break;
          }
        }
        folder = path.dirname(folder);
      }
    }
    return { path: file, namespace: 'project-code', ...(file.includes(`${path.sep}node_modules${path.sep}`) ? { sideEffects: false } : {}) };
  });
  build.onLoad({ filter: /.*/, namespace: 'project-code' }, args => {
    let contents = fs.readFileSync(args.path);
    if (args.path === path.join(root, 'node_modules/paperlab/dist/fx.js')) {
      const source = contents.toString('utf8');
      if (!source.includes('var Pass = lazy(')) throw new Error('Recheck optional FxPost import after a Paperlab version change');
      contents = source.replace('var Pass = lazy(', 'var Pass = /* @__PURE__ */ lazy(');
    }
    return { contents, resolveDir: path.dirname(args.path), loader: args.path.endsWith('.ttf') ? 'dataurl' : args.path.endsWith('.jsx') ? 'jsx' : args.path.endsWith('.json') ? 'json' : 'js' };
  });
} };
async function build() {
  const result = await esbuild.build({ absWorkingDir: root, entryPoints: ['renderer/paperlab-entry.jsx'], outfile: 'renderer/generated/paperlab-runtime.js',
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome150', minify: true, sourcemap: false, metafile: true, tsconfigRaw: {},
    // Optional full-screen post FX are never imported by this entry. Keeping
    // their peers external lets esbuild discard that unused lazy branch.
    plugins: [isolatedModules],
    banner: { js: changedNotice },
    loader: { '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
  fs.mkdirSync(path.join(root, 'qa/paperlab'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qa/paperlab/bundle-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  console.log('Built actual Paperlab 0.8.1 runtime.');
}
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { build };
