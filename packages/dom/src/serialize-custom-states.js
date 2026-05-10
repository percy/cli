// Serializes ElementInternals custom-element :state() into Percy's clone
// via [data-percy-custom-state~="X"] attribute selectors.
//
// rewriteCustomStateCSS is the only entry point — it walks <style> elements,
// rewrites :state(X) and legacy :--X (Chrome 90-124) to the data-attribute
// selector, then for each state name discovered in CSS tests live custom
// elements with element.matches(':state(name)') and stamps
// data-percy-custom-state on the corresponding clone. Only states with at
// least one CSS rule are captured — states without CSS have no visual
// effect, so the clone faithfully represents what the page renders.

import { walkShadowDOM } from './shadow-utils';
import { isCustomElement } from './utils';

// State names that survive into the rewritten attribute selector. Anything
// else (quotes, brackets, '</style>') would let a hostile page CSS escape
// the rewritten <style> block or inject extra rules.
const SAFE_STATE_NAME_RE = /^[-\w]+$/;
const STATE_ATTR_TEMPLATE = name => `[data-percy-custom-state~="${name}"]`;

export function rewriteCustomStateCSS(ctx) {
  const stateNames = new Set();
  const styleElements = collectStyleElements(ctx.clone);

  for (const style of styleElements) {
    const css = style.textContent;
    if (!css) continue;

    const modified = rewriteCustomStateSelectors(css, stateNames);
    if (modified !== css) {
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      style.textContent = modified;
    }
  }

  if (stateNames.size > 0) {
    addCustomStateAttributes(ctx, stateNames);
  }
}

// Rewrites `:state(name)` and the legacy `:--name` to attribute selectors.
// Names are validated against SAFE_STATE_NAME_RE; unsafe names are left
// alone so authors notice the bad input rather than getting silent
// zero-match rules.
export function rewriteCustomStateSelectors(text, stateNames) {
  text = text.replace(/:state\(([^)]+)\)/g, (m, name) => {
    name = name.trim();
    if (!SAFE_STATE_NAME_RE.test(name)) return m;
    stateNames.add(name);
    return STATE_ATTR_TEMPLATE(name);
  });
  text = text.replace(/:--([a-zA-Z][\w-]*)/g, (m, name) => {
    stateNames.add(name);
    return STATE_ATTR_TEMPLATE(name);
  });
  return text;
}

// Collect <style> elements from the document and every shadow root.
function collectStyleElements(root) {
  const styles = [];
  walkShadowDOM(root, scope => {
    if (!scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll('style')) styles.push(el);
  });
  return styles;
}

// :state() supports both the function form and the legacy :--name form.
// element.matches() may throw on unsupported syntax; tolerate and try both.
function elementInState(el, name) {
  for (const sel of [`:state(${name})`, `:--${name}`]) {
    try {
      if (el.matches(sel)) return true;
    } catch (e) {
      // not supported in this browser — try the next form
    }
  }
  return false;
}

// Test live custom elements against :state(name) for each state name found
// in CSS, and stamp data-percy-custom-state on the matching clone element.
//
// Builds a percyId → cloneEl Map in one walk over the clone tree so the
// per-element lookup is O(1) — a naive per-element ctx.clone.querySelector
// scan is O(N × T) for N custom elements and a tree of size T.
function addCustomStateAttributes(ctx, stateNames) {
  // ctx.clone is a DocumentFragment we constructed ourselves and shadow
  // roots always have querySelectorAll, so the visitor doesn't need the
  // defensive guard the live-DOM walk (below) uses.
  const cloneByPercyId = new Map();
  walkShadowDOM(ctx.clone, scope => {
    for (const el of scope.querySelectorAll('[data-percy-element-id]')) {
      cloneByPercyId.set(el.getAttribute('data-percy-element-id'), el);
    }
  });

  walkShadowDOM(ctx.dom, scope => {
    if (!scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll('*')) {
      if (!isCustomElement(el)) continue;
      const percyId = el.getAttribute('data-percy-element-id');
      if (!percyId) continue;

      const cloneEl = cloneByPercyId.get(percyId);
      if (!cloneEl || cloneEl.hasAttribute('data-percy-custom-state')) continue;

      const matchedStates = [];
      for (const name of stateNames) {
        if (elementInState(el, name)) matchedStates.push(name);
      }

      if (matchedStates.length > 0) {
        cloneEl.setAttribute('data-percy-custom-state', matchedStates.join(' '));
      }
    }
  });
}
