'use strict';
// UIA owns only its observed Chat presentation. A failed observer is not a
// user cancellation and cannot retire an independently verified Hook source.
function observedInvalidationScope(context, pending, current) {
  const observed = context?.presentationMode === 'observed-chat';
  return Object.freeze({ pending: observed && pending === context,
    current: observed && typeof context.eventId === 'string' && context.eventId === current?.id });
}
module.exports = { observedInvalidationScope };
