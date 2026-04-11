// Percy Pre-flight Script
// Injected before page scripts to intercept closed shadow roots and ElementInternals.
// This enables Percy to capture content inside closed shadow DOM and custom element states.

(function() {
  if (window.__percyPreflightActive) return;
  window.__percyPreflightActive = true;

  // --- Intercept closed shadow roots ---
  let closedShadowRoots = new WeakMap();
  let origAttachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function(init) {
    let root = origAttachShadow.call(this, init);
    if (init && init.mode === 'closed') {
      closedShadowRoots.set(this, root);
    }
    return root;
  };
  window.__percyClosedShadowRoots = closedShadowRoots;

  // --- Intercept ElementInternals for :state() capture ---
  if (typeof window.HTMLElement.prototype.attachInternals === 'function') {
    let internalsMap = new WeakMap();
    let origAttachInternals = window.HTMLElement.prototype.attachInternals;
    window.HTMLElement.prototype.attachInternals = function() {
      let internals = origAttachInternals.call(this);
      internalsMap.set(this, internals);
      return internals;
    };
    window.__percyInternals = internalsMap;
  }
})();
