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

// State names that survive into the rewritten attribute selector. Anything
// else (quotes, brackets, '</style>') would let a hostile page CSS escape
// the rewritten <style> block or inject extra rules.
const SAFE_STATE_NAME_RE = /^[-\w]+$/;
// Legacy :--name capture (Chrome 90-124, before :state() shipped). Matches
// the `name` portion only.
const LEGACY_DASH_DASH_NAME_RE = /^([a-zA-Z][\w-]*)/;
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

// CSS-aware rewriter for `:state(name)` and the legacy `:--name`. Walks the
// CSS text token by token, skipping over string literals and attribute
// brackets so :state() / :-- tokens appearing inside attribute values or
// strings are left alone. A naive `/:state\(([^)]+)\)/g` over-consumes any
// content up to the next `)` — including content inside `[attr=":state(x)"]`
// or comments — and would let hostile state names escape the <style> block.
//
// State names are validated against SAFE_STATE_NAME_RE; non-conforming names
// pass through unchanged so authors notice the bad input rather than getting
// silent zero-match rules.
export function rewriteCustomStateSelectors(text, stateNames) {
  let out = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch; i++;
      while (i < len && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < len) {
          out += text[i] + text[i + 1];
          i += 2;
        } else {
          out += text[i++];
        }
      }
      if (i < len) out += text[i++];
      continue;
    }
    if (ch === '[') {
      let depth = 1;
      out += ch; i++;
      while (i < len && depth > 0) {
        const cc = text[i];
        if (cc === '"' || cc === "'") {
          const q = cc;
          out += cc; i++;
          while (i < len && text[i] !== q) {
            if (text[i] === '\\' && i + 1 < len) {
              out += text[i] + text[i + 1];
              i += 2;
            } else {
              out += text[i++];
            }
          }
          if (i < len) out += text[i++];
        } else if (cc === '[') {
          depth++; out += cc; i++;
        } else if (cc === ']') {
          depth--; out += cc; i++;
        } else {
          out += text[i++];
        }
      }
      continue;
    }
    // :state(name) at top level
    if (ch === ':' && text.startsWith(':state(', i)) {
      const close = text.indexOf(')', i + 7);
      if (close !== -1) {
        const name = text.slice(i + 7, close).trim();
        if (SAFE_STATE_NAME_RE.test(name)) {
          stateNames.add(name);
          out += STATE_ATTR_TEMPLATE(name);
          i = close + 1;
          continue;
        }
      }
    }
    // legacy :--name at top level
    if (ch === ':' && text.startsWith(':--', i)) {
      const m = LEGACY_DASH_DASH_NAME_RE.exec(text.slice(i + 3));
      if (m) {
        stateNames.add(m[1]);
        out += STATE_ATTR_TEMPLATE(m[1]);
        i += 3 + m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
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
      if (elementInState(el, name)) matchedStates.push(name);
    }

    if (matchedStates.length > 0) {
      cloneEl.setAttribute('data-percy-custom-state', matchedStates.join(' '));
    }
  }
}
