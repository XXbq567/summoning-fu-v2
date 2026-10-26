'use strict';
const keys = ['x', 'y', 'width', 'height'];
const valid = rect => rect && keys.every(key => Number.isSafeInteger(rect[key]) && Math.abs(rect[key]) < 1000000) && rect.width > 0 && rect.height > 0;
const equal = (a, b) => valid(a) && valid(b) && keys.every(key => a[key] === b[key]);
const copy = rect => Object.freeze(Object.fromEntries(keys.map(key => [key, rect[key]])));
function ownNativeBounds(requested, actual, roundTrip) {
  if (!valid(requested) || !valid(actual)) return null;
  let mode = 'exact';
  if (!equal(requested, actual)) {
    // Accept only the immediately sampled result of our own setBounds, proven
    // by Electron's DIP -> physical -> DIP conversion of the ORIGINAL request.
    // Positions never drift; only the right/bottom native enclosure may grow
    // by one DIP. This is not a tolerance for later window events.
    if (!equal(actual, roundTrip) || actual.x !== requested.x || actual.y !== requested.y
      || actual.width < requested.width || actual.width > requested.width + 1
      || actual.height < requested.height || actual.height > requested.height + 1) return null;
    mode = 'native-roundtrip-expansion';
  }
  return Object.freeze({ requested: copy(requested), actual: copy(actual), mode });
}
function nativeBoundsMatch(receipt, requested, actual) {
  return !!receipt && equal(receipt.requested, requested) && equal(receipt.actual, actual);
}
module.exports = { ownNativeBounds, nativeBoundsMatch };
