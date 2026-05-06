// Serializes ElementInternals custom-element :state() into Percy's clone
// via [data-percy-custom-state~="X"] attribute selectors.
//
// Two paths land state attributes on cloned elements:
//   1. Preflight path (CLI runtime): preflight.js intercepts attachInternals
//      and stores ElementInternals refs on a per-page WeakMap. clone-dom.js
//      reads the WeakMap and writes data-percy-custom-state on each clone.
//   2. Fallback path (legacy or preflight-failed): test live elements with
//      element.matches(':state(name)') after the CSS has been parsed for
//      state names, and write the attribute on the corresponding clone.
//
// rewriteCustomStateCSS is the only entry point — it walks <style> elements,
// rewrites :state(X) and legacy :--X (Chrome 90-124) to the data-attribute
// selector, and triggers the fallback if any state names were observed.

import { walkShadowDOM } from './shadow-utils';

// Match :state(NAME) — CSS Custom State Pseudo-Class spec.
const STATE_FN_RE = /:state\(([^)]+)\)/g;
// Legacy :--name syntax (Chrome 90-124, before :state() shipped).
const LEGACY_DASH_DASH_RE = /:--([a-zA-Z][\w-]*)/g;
const STATE_ATTR_TEMPLATE = name => `[data-percy-custom-state~="${name}"]`;

export function rewriteCustomStateCSS(ctx) {
  const stateNames = new Set();
  const styleElements = collectStyleElements(ctx.clone);

  for (const style of styleElements) {
    const css = style.textContent;
    if (!css) continue;

    let modified = css.replace(STATE_FN_RE, (_, name) => {
      stateNames.add(name);
      return STATE_ATTR_TEMPLATE(name);
    });
    modified = modified.replace(LEGACY_DASH_DASH_RE, (_, name) => {
      stateNames.add(name);
      return STATE_ATTR_TEMPLATE(name);
    });

    if (modified !== css) {
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      style.textContent = modified;
    }
  }

  if (stateNames.size > 0) {
    addCustomStateAttributes(ctx, stateNames);
  }
}

// Collect <style> elements from the document and every shadow root.
function collectStyleElements(root) {
  const styles = [];
  walkShadowDOM(root, scope => {
    /* istanbul ignore next: defensive — every scope exposes querySelectorAll */
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

// Fallback: when clone-dom.js didn't pre-populate data-percy-custom-state
// (preflight unavailable), test live elements against :state() and write
// the attribute on the matching clone element.
function addCustomStateAttributes(ctx, stateNames) {
  const customElements = [];
  walkShadowDOM(ctx.dom, scope => {
    /* istanbul ignore next: defensive — every scope exposes querySelectorAll */
    if (!scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll('*')) {
      if (el.tagName?.includes('-')) customElements.push(el);
    }
  });

  for (const el of customElements) {
    const percyId = el.getAttribute('data-percy-element-id');
    if (!percyId) continue;

    const cloneEl = ctx.clone.querySelector(`[data-percy-element-id="${percyId}"]`);
    if (!cloneEl || cloneEl.hasAttribute('data-percy-custom-state')) continue;

    const matchedStates = [];
    for (const name of stateNames) {
      // State names are dashed-idents; reject anything else to avoid
      // surprising attribute-selector escapes later.
      /* istanbul ignore if: defensive — CSS spec restricts :state() to dashed-idents */
      if (!/^[-\w]+$/.test(name)) continue;
      if (elementInState(el, name)) matchedStates.push(name);
    }

    if (matchedStates.length > 0) {
      cloneEl.setAttribute('data-percy-custom-state', matchedStates.join(' '));
    }
  }
}
