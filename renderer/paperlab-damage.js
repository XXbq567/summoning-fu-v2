/* A recorded real DamageField makes backwards seeking deterministic. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualPaperlabDamage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function bakeBurn(DamageField) {
    const field = new DamageField({ seed: 2718, heatDiffusion: .008, anisotropy: 1.3, grain: .5, consumeRate: 10, charRate: 4 });
    const frames = [];
    const save = () => frames.push({ pixels: field.pixels.slice(), time: field.time, remaining: Math.max(0, Math.min(1, field.lastStats.remaining)) });
    field.ignite(.12, .015, .12, 1); field.ignite(.85, .04, .10, 1);
    frames.push({ pixels: field.pixels.slice(), time: 0, remaining: 1 });
    for (let i = 1; i <= 2400; i++) {
      field.step(1 / 120);
      if (i % 8 === 0 || field.lastStats.remaining <= 0) save();
      if (field.lastStats.remaining <= 0) break;
    }
    if (frames.at(-1).remaining > .0001) throw new Error('DamageField did not consume the complete sheet');
    return Object.freeze({ size: field.size, frames: Object.freeze(frames) });
  }
  function sampleBurn(recording, progress, source) {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    const f = p * (recording.frames.length - 1), a = recording.frames[Math.floor(f)], b = recording.frames[Math.ceil(f)], t = f % 1;
    for (let i = 0; i < source.pixels.length; i++) source.pixels[i] = Math.round(a.pixels[i] + (b.pixels[i] - a.pixels[i]) * t);
    source.time = a.time + (b.time - a.time) * t;
    source.version++;
    return a.remaining + (b.remaining - a.remaining) * t;
  }
  return Object.freeze({ bakeBurn, sampleBurn });
});
