// Percy Pre-flight Script
// Injected before page scripts to intercept closed shadow roots and ElementInternals.
// This enables Percy to capture content inside closed shadow DOM and custom element states.

(function() {
  if (window.__percyPreflightActive) return;
  window.__percyPreflightActive = true;

  // --- Intercept closed shadow roots ---
  var closedShadowRoots = new WeakMap();
  var origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    var root = origAttachShadow.call(this, init);
    if (init && init.mode === 'closed') {
      closedShadowRoots.set(this, root);
    }
    return root;
  };
  window.__percyClosedShadowRoots = closedShadowRoots;

  // --- Intercept ElementInternals for :state() capture ---
  if (typeof HTMLElement.prototype.attachInternals === 'function') {
    var internalsMap = new WeakMap();
    var origAttachInternals = HTMLElement.prototype.attachInternals;
    HTMLElement.prototype.attachInternals = function() {
      var internals = origAttachInternals.call(this);
      internalsMap.set(this, internals);
      return internals;
    };
    window.__percyInternals = internalsMap;
  }
})();
