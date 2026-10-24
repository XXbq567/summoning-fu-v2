/* Paperlab 0.8.1 integration. No renderer, scheduler, network or DOM ownership. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualPaperBackface = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const adapter = 'paper-backface-v1';
  function normalizeStrength(value = .1) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > .2) throw new RangeError('backside ink strength must be a finite number within 0..0.2');
    return value;
  }
  const srgbToLinear = byte => { const value = byte / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
  const linearToSrgb = value => Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
  function validatePixels({ front, blank, width, height }) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16 * 1024 * 1024
      || !(front instanceof Uint8ClampedArray || front instanceof Uint8Array) || !(blank instanceof Uint8ClampedArray || blank instanceof Uint8Array)
      || front.length !== width * height * 4 || blank.length !== front.length) throw new TypeError('paper-back pixels must be equal RGBA byte arrays with bounded dimensions');
  }
  function pixels(source, strength, reference = false) {
    validatePixels(source);
    const { front, blank, width, height } = source, result = new Uint8ClampedArray(front.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4, target = (y * width + width - 1 - x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const paper = srgbToLinear(blank[index + channel]), ink = srgbToLinear(front[index + channel]);
          result[target + channel] = reference ? front[index + channel] : linearToSrgb(paper + strength * (ink - paper));
        }
        // Paperlab samples back at (1-u,v). Mirroring once here compensates
        // that convention: each physical UV retains its original paper alpha
        // and sees only the weak, physically reversed front ink difference.
        result[target + 3] = blank[index + 3];
      }
    }
    return result;
  }
  function createBackPixels(source, strength) { return pixels(source, normalizeStrength(strength)); }
  // Explicit static QA reference under the SAME back-facing lighting. It is
  // never an accepted production strength or a hidden change to front art.
  function createInkReferencePixels(source) { return pixels(source, 0, true); }
  function configureFacing(material, { legacyDoublePass = false } = {}) {
    if (!material || material.side !== 2 || typeof legacyDoublePass !== 'boolean') throw new TypeError('paper-back requires the actual DoubleSide material');
    // Three's transparent BackSide pass flips gl.frontFace. Keeping the genuine
    // double-sided pass lets Paperlab's gl_FrontFacing choose the correct map.
    material.forceSinglePass = !legacyDoublePass; material.needsUpdate = true;
    return material;
  }
  const inspectionEnums = Object.freeze({
    pose: Object.freeze(['front', 'back', 'side', 'half', 'rolled']),
    shader: Object.freeze(['art', 'facing', 'uv', 'ink-reference', 'paper-reference']),
    behind: Object.freeze(['none', 'red', 'black']),
    clip: Object.freeze(['none', 'lower-half']),
    innerInk: Object.freeze(['original', 'cyan', 'magenta']),
  });
  function normalizeInspection(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(inspectionEnums, key) && key !== 'legacyDoublePass')) throw new TypeError('invalid material inspection');
    const get = (key, fallback) => value[key] === undefined ? fallback : value[key];
    const result = { pose: value.pose, shader: get('shader', 'art'), legacyDoublePass: get('legacyDoublePass', false),
      behind: get('behind', 'none'), clip: get('clip', 'none'), innerInk: get('innerInk', 'original') };
    for (const [key, choices] of Object.entries(inspectionEnums)) if (!choices.includes(result[key])) throw new TypeError('invalid material inspection ' + key);
    if (typeof result.legacyDoublePass !== 'boolean') throw new TypeError('invalid material inspection legacyDoublePass');
    return Object.freeze(result);
  }
  return Object.freeze({ adapter, normalizeStrength, normalizeInspection, inspectionEnums, createBackPixels, createInkReferencePixels, configureFacing });
});
