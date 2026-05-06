// Shared traversal helpers for walking a document plus every shadow root
// it contains (open or closed-via-preflight). Centralizes access to the
// preflight WeakMaps so each call site honors the *iframe's* runtime
// window — a top-level `window.__percyClosedShadowRoots` lookup misses
// shadow roots and ElementInternals stored by preflight inside iframes.

// Resolve the runtime window for any node (Document/Element/ShadowRoot).
// For a node inside an iframe, returns the iframe's window — which is where
// preflight installed the per-document WeakMaps.
function getRuntime(node) {
  const doc = node?.ownerDocument || node;
  return doc?.defaultView || (typeof window !== 'undefined' ? window : null);
}

// Closed-shadow-root WeakMap installed by preflight, scoped to the node's
// owning document.
export function getClosedShadowRoot(host) {
  return getRuntime(host)?.__percyClosedShadowRoots?.get(host) || null;
}

export function hasClosedShadowRoot(host) {
  return !!getRuntime(host)?.__percyClosedShadowRoots?.has(host);
}

// ElementInternals WeakMap installed by preflight.
export function getCustomStateInternals(host) {
  return getRuntime(host)?.__percyInternals?.get(host) || null;
}

// Resolve a shadow host's root, including closed roots intercepted by
// preflight. Returns null when the host has no shadow root reachable.
export function getShadowRoot(host) {
  if (host?.shadowRoot) return host.shadowRoot;
  return getClosedShadowRoot(host);
}

// Walk root + every shadow root descendant, calling visit(scope) on each.
// `scope` is either the original root or a shadow root.
export function walkShadowDOM(root, visit) {
  visit(root);
  /* istanbul ignore if: defensive — roots passed in always have querySelectorAll */
  if (!root.querySelectorAll) return;
  for (const host of root.querySelectorAll('[data-percy-shadow-host]')) {
    const shadow = getShadowRoot(host);
    if (shadow) walkShadowDOM(shadow, visit);
  }
}

// Run a selector against root + every shadow root, returning the flat list
// of matching elements. Tolerates selectors that aren't supported in a given
// scope so a single bad scope can't break the whole walk.
export function queryShadowAll(root, selector) {
  const results = [];
  walkShadowDOM(root, scope => {
    try {
      for (const el of scope.querySelectorAll(selector)) results.push(el);
    } catch (e) {
      // Selector syntax not supported in this scope — skip
    }
  });
  return results;
}
