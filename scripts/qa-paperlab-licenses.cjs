'use strict';
// Read installed metadata and copy original license/notice text. Never installs or executes packages.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const INTEGRITY = 'sha512-PKXArVLRDzxWMgsNOH0mNw9PzQkc8vDBoLDXJVpxQTNm9DB2Rexis7V7vgWOKXVhRsnF67rIkVfGvHxwXLiXcw==';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

function inspectPaperlabArchive(buffer, integrity = INTEGRITY) {
  if ('sha512-' + crypto.createHash('sha512').update(buffer).digest('base64') !== integrity) throw new Error('Paperlab archive integrity mismatch');
  const tar = zlib.gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 }), entries = {};
  for (let position = 0; position + 512 <= tar.length;) {
    const name = tar.subarray(position, position + 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(tar.subarray(position + 124, position + 136).toString('ascii').replace(/\0.*$/s, ''), 8) || 0;
    position += 512;
    if (!name) break;
    if (!Number.isSafeInteger(size) || size < 0 || position + size > tar.length) throw new Error('Invalid archive entry');
    if (['package/LICENSE', 'package/NOTICE', 'package/package.json'].includes(name)) entries[name] = tar.subarray(position, position + size).toString('utf8');
    position += Math.ceil(size / 512) * 512;
  }
  const manifest = JSON.parse(entries['package/package.json'] || '{}');
  if (manifest.name !== 'paperlab' || manifest.version !== '0.8.1' || manifest.license !== 'Apache-2.0' || !entries['package/LICENSE'] || !entries['package/NOTICE']) throw new Error('Unexpected Paperlab source metadata');
  return { manifest, license: entries['package/LICENSE'], notice: entries['package/NOTICE'], integrity };
}

function collectInstalledNotices(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  let supplemental={};try{supplemental=JSON.parse(fs.readFileSync(path.join(root,'licenses/third-party/SUPPLEMENTAL.json'),'utf8'));}catch{}
  const packages = lock.packages || {}, rows = [];
  // All runtime packages plus the newly introduced browser bundler. Existing Electron
  // and packager development dependencies retain their existing license delivery.
  const selected = new Set(Object.keys(packages).filter(key => key.startsWith('node_modules/') && packages[key].dev !== true));
  for (const key of Object.keys(packages)) if (/^node_modules\/(?:esbuild|@esbuild\/[^/]+)$/.test(key)) selected.add(key);
  for (const key of [...selected].sort()) {
    if (key.split(/[\\/]/).some(part => part === '..') || path.isAbsolute(key)) throw new Error('Unsafe dependency path');
    const directory = path.join(root, key);
    if (!fs.existsSync(path.join(directory, 'package.json'))) continue; // Uninstalled platform-optional packages are not redistributed.
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:licen[sc]e|notice|copying|copyright)(?:[.-].*)?$/i.test(entry.name)) continue;
      const buffer = fs.readFileSync(path.join(directory, entry.name));
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Unexpected license file size');
      files.push({ relativePath: entry.name, sourceRelativePath: key+'/'+entry.name, content: buffer.toString('utf8'), sha256: hash(buffer) });
    }
    for(const source of supplemental[manifest.name+'@'+manifest.version]||[]){
      if(typeof source.path!=='string'||!source.path.startsWith('licenses/third-party/')||source.path.split('/').includes('..'))throw new Error('Unsafe supplemental notice path');
      const buffer=fs.readFileSync(path.join(root,source.path));if(hash(buffer)!==source.sha256)throw new Error('Supplemental notice integrity mismatch');
      files.push({relativePath:path.basename(source.path),sourceRelativePath:source.path,content:buffer.toString('utf8'),sha256:source.sha256,source:source.source,kind:source.kind,...(source.terms?{terms:source.terms}:{})});
    }
    const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type || (manifest.licenses ? JSON.stringify(manifest.licenses) : 'UNDECLARED');
    rows.push({ name: manifest.name, version: manifest.version, license, packagePath: key,
      resolved: packages[key].resolved || null, integrity: packages[key].integrity || null,
      developmentTool: packages[key].dev === true, files, review: !files.length ? 'MISSING_TERMS_REVIEW_REQUIRED' : files.some(file=>file.kind==='published-license-notice') ? 'published-notice-preserved-custom-terms-linked' : license==='UNDECLARED' ? 'original-license-file-preserved-metadata-omitted' : 'original-terms-preserved' });
  }
  return rows;
}

function inspectBundleScope(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'qa/paperlab/bundle-metafile.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const keys = Object.keys(lock.packages).filter(key=>key.startsWith('node_modules/')).sort((a,b)=>b.length-a.length);
  const output = 'renderer/generated/paperlab-runtime.js', emitted = manifest.outputs?.[output];
  if (!emitted) throw new Error('Missing emitted Paperlab bundle');
  const bundle = fs.readFileSync(path.join(root, output));
  if (bundle.length !== emitted.bytes) throw new Error('Bundle metafile is stale');
  const packages = {};
  for (const [input, detail] of Object.entries(emitted.inputs || {})) {
    if (!Number.isSafeInteger(detail.bytesInOutput) || detail.bytesInOutput <= 0) continue;
    const normalized = input.replace(/^project-code:/, '').replaceAll('\\', '/');
    const relative = path.relative(root, normalized).replaceAll('\\', '/');
    if (!relative.startsWith('node_modules/')) continue;
    const owner = keys.find(key=>relative.startsWith(key+'/'));
    if (!owner) throw new Error('Unmapped emitted dependency');
    packages[owner] = (packages[owner] || 0) + detail.bytesInOutput;
  }
  return { output, bytes:bundle.length, sha256:hash(bundle), externalImports:emitted.imports || [], packages };
}

function writeNotices(root) {
  const archive = inspectPaperlabArchive(fs.readFileSync(path.join(root, 'qa/burn-research/paperlab-0.8.1.tgz')));
  const destination = path.join(root, 'licenses/third-party'), paperlab = path.join(destination, 'paperlab-0.8.1');
  fs.mkdirSync(paperlab, { recursive: true });
  fs.writeFileSync(path.join(paperlab, 'LICENSE'), archive.license);
  fs.writeFileSync(path.join(paperlab, 'NOTICE'), archive.notice);
  const bundle = inspectBundleScope(root);
  const rows = collectInstalledNotices(root).map(row=>({...row, bundledBytes:bundle.packages[row.packagePath]||0,
    distribution:bundle.packages[row.packagePath]>0?'emitted-browser-bundle':row.developmentTool?'build-only':'installed-not-emitted'}));
  for (const row of rows) {
    const folder = row.name.replaceAll('@', '').replaceAll('/', '__') + '-' + row.version;
    if (!/^[A-Za-z0-9_.+-]+$/.test(folder)) throw new Error('Unsafe license folder');
    const target = path.join(destination, folder); fs.mkdirSync(target, { recursive: true });
    for (const file of row.files) {const source=path.resolve(root,file.sourceRelativePath),output=path.join(target,file.relativePath);if(source!==output)fs.copyFileSync(source,output);}
  }
  const inventory = { kind: 'installed-package-original-notices-with-emitted-bundle-scope', generatedAt: new Date().toISOString(), bundle,
    localAdaptationNotice:'Project build annotates the unused optional Paperlab lazy call as PURE in memory; project runtime adapts alpha, flame shader coverage, local shape and lighting. Original installed package and retained LICENSE/NOTICE remain unchanged. See THIRD-PARTY-NOTICES.md.',
    sourceArchive: { name: 'paperlab', version: '0.8.1', registry: 'https://registry.npmjs.org/paperlab/-/paperlab-0.8.1.tgz', integrity: archive.integrity },
    packages: rows.map(({ files, ...row }) => ({ ...row, files: files.map(({ content, ...file }) => file) })) };
  fs.writeFileSync(path.join(destination, 'SOURCE.json'), JSON.stringify(inventory, null, 2) + '\n');
  const lines = ['# Paperlab dependency notices', '', 'Original license and notice files are retained in adjacent versioned folders. Package license labels below are metadata, not a replacement for their complete terms. GSAP has its own custom standard license and is not classified as MIT. Existing project code remains UNLICENSED; the unmodified font retains assets/fonts/OFL.txt and NOTICE.txt.', '', 'Scope is taken from positive bytesInOutput in the final esbuild output, not merely parsed inputs. Installed-not-emitted dependencies and their unused model/decoder assets are not part of this browser bundle. Esbuild and its platform executable are build-only. SOURCE.json records exact sources, hashes, scope and bundle hash; existing Electron runtime notices are delivered separately.', '', '| Package | Version | Declared license | Distribution | Emitted bytes | Review |', '| --- | --- | --- | --- | ---: | --- |'];
  for (const row of rows) lines.push(`| ${row.name} | ${row.version} | ${row.license.replaceAll('|', '\\|')} | ${row.distribution} | ${row.bundledBytes} | ${row.review} |`);
  fs.writeFileSync(path.join(destination, 'README.md'), lines.join('\n') + '\n');
  return { packageCount: rows.length, shippedPackageCount:rows.filter(row=>row.bundledBytes>0).length, missingShippedTerms:rows.filter(row=>row.bundledBytes>0&&row.review==='MISSING_TERMS_REVIEW_REQUIRED').map(row=>row.name), installedNotEmittedMissingTerms:rows.filter(row=>!row.bundledBytes&&row.review==='MISSING_TERMS_REVIEW_REQUIRED').map(row=>row.name), destination };
}

if (require.main === module) process.stdout.write(JSON.stringify(writeNotices(path.resolve(__dirname, '..'))) + '\n');
module.exports = { inspectPaperlabArchive, collectInstalledNotices, inspectBundleScope, writeNotices };
