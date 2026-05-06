// Shared traversal helpers for walking a document plus every shadow root
// it contains (open or closed-via-preflight). Replaces the three near-
// identical recursions that used to live across serialize-pseudo-classes,
// serialize-custom-states, and clone/serialize callers.

// Resolve a shadow host's root, including closed roots intercepted by
// preflight. Returns null when the host has no shadow root reachable.
export function getShadowRoot(host) {
  if (host?.shadowRoot) return host.shadowRoot;
  /* istanbul ignore next: window.__percyClosedShadowRoots only set in browser via preflight */
  return window.__percyClosedShadowRoots?.get(host) || null;
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
    /* istanbul ignore next: scope always exposes querySelectorAll, but selector may throw on syntax */
    try {
      for (const el of scope.querySelectorAll(selector)) results.push(el);
    } catch (e) {
      // Selector syntax not supported in this scope — skip
    }
  });
  return results;
}
