// Percy Pre-flight Script
// Injected before page scripts to intercept closed shadow roots and
// ElementInternals. Lets Percy capture content inside closed shadow DOM and
// custom-element :state(...) styling.
//
// Globals are installed as non-writable, non-configurable, non-enumerable
// properties so page scripts can't trivially clobber them and they don't
// surface in `for ... in window`. The maps remain reachable via the named
// properties Percy looks up at serialize time.

(function() {
  if (window.__percyPreflightActive) return;
  Object.defineProperty(window, '__percyPreflightActive', {
    value: true, writable: false, configurable: false, enumerable: false
  });

  // --- Intercept closed shadow roots ---
  var closedShadowRoots = new WeakMap();
  var origAttachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function(init) {
    var root = origAttachShadow.apply(this, arguments);
    if (init && init.mode === 'closed') {
      closedShadowRoots.set(this, root);
    }
    return root;
  };
  Object.defineProperty(window, '__percyClosedShadowRoots', {
    value: closedShadowRoots, writable: false, configurable: false, enumerable: false
  });

  // --- Intercept ElementInternals for :state() capture ---
  if (typeof window.HTMLElement.prototype.attachInternals === 'function') {
    var internalsMap = new WeakMap();
    var origAttachInternals = window.HTMLElement.prototype.attachInternals;
    window.HTMLElement.prototype.attachInternals = function() {
      var internals = origAttachInternals.apply(this, arguments);
      internalsMap.set(this, internals);
      return internals;
    };
    Object.defineProperty(window, '__percyInternals', {
      value: internalsMap, writable: false, configurable: false, enumerable: false
    });
  }
})();
