/* Local TTF cmap inspection. No fonts, text or credentials leave this process. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualFontCoverage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function parseCmap(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = at => view.getUint16(at, false), u32 = at => view.getUint32(at, false);
    let cmap = -1;
    for (let i = 0; i < u16(4); i++) {
      const at = 12 + i * 16;
      if (u32(at) === 0x636d6170) cmap = u32(at + 8);
    }
    if (cmap < 0) throw new Error('Font has no cmap table');
    const supported = new Set(), visited = new Set();
    for (let i = 0; i < u16(cmap + 2); i++) {
      const record = cmap + 4 + i * 8;
      const platform = u16(record), encoding = u16(record + 2);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const at = cmap + u32(record + 4);
      if (visited.has(at)) continue;
      visited.add(at);
      const format = u16(at);
      if (format === 12) {
        for (let group = 0; group < u32(at + 12); group++) {
          const entry = at + 16 + group * 12;
          const start = u32(entry), end = Math.min(u32(entry + 4), 0x10ffff), glyph = u32(entry + 8);
          for (let cp = start; cp <= end; cp++) if (glyph + cp - start !== 0) supported.add(cp);
        }
      } else if (format === 4) {
        const count = u16(at + 6) / 2, ends = at + 14, starts = ends + count * 2 + 2;
        const deltas = starts + count * 2, offsets = deltas + count * 2;
        for (let segment = 0; segment < count; segment++) {
          const start = u16(starts + segment * 2), end = u16(ends + segment * 2);
          const delta = u16(deltas + segment * 2), rangeAt = offsets + segment * 2, range = u16(rangeAt);
          for (let cp = start; cp <= end && cp < 0xffff; cp++) {
            let glyph = range ? u16(rangeAt + range + (cp - start) * 2) : (cp + delta) & 0xffff;
            if (range && glyph) glyph = (glyph + delta) & 0xffff;
            if (glyph) supported.add(cp);
          }
        }
      }
    }
    if (!supported.size) throw new Error('Font has no supported Unicode cmap format 4/12');
    const ranges = [];
    for (const cp of [...supported].sort((a, b) => a - b)) {
      const last = ranges[ranges.length - 1];
      if (last && cp === last[1] + 1) last[1] = cp;
      else ranges.push([cp, cp]);
    }
    return { schemaVersion: 1, family: 'Ma Shan Zheng', glyphCodePoints: supported.size, ranges };
  }
  function hasGlyph(character, coverage) {
    if (!coverage || !Array.isArray(coverage.ranges)) return false;
    const cp = character.codePointAt(0);
    let lo = 0, hi = coverage.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1, range = coverage.ranges[mid];
      if (cp < range[0]) hi = mid - 1;
      else if (cp > range[1]) lo = mid + 1;
      else return true;
    }
    return false;
  }
  function report(text, coverage) {
    const checked = !!coverage && Array.isArray(coverage.ranges);
    return {
      checked,
      missingFromBrush: checked ? [...new Set(Array.from(String(text)))].filter(ch => !/\s/.test(ch) && !hasGlyph(ch, coverage))
        .map(character => ({ character, codePoint: 'U+' + character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') })) : [],
      fallback: 'Microsoft YaHei, SimSun, Segoe UI, Segoe UI Emoji; system glyph coverage is not asserted',
    };
  }
  return Object.freeze({ parseCmap, hasGlyph, report });
});
