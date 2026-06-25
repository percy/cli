/* global XPathResult */

// Serializes pseudo-class state into Percy's clone via two paths:
//
//   1. Auto-detect path (every snapshot). For :focus / :focus-within /
//      :checked / :disabled we stamp the live DOM with the corresponding
//      data-percy-* attribute and rewrite matching CSS rules to use those
//      attribute selectors. :focus-within stamps the focused element's
//      ancestor chain across shadow boundaries.
//
//   2. Configured-element path (`pseudoClassEnabledElements` config). User
//      opts in elements by id/className/xpath/selector. We snapshot all
//      computed styles (including :hover/:active styles when the page has
//      forced those states via execute scripts) and inject them as inline
//      rules on the clone. :hover and :active CSS rules are also rewritten
//      to data-percy-hover / -active selectors, gated on the configured-
//      element list — they only stamp on opted-in elements.
//
// All live-DOM mutations are recorded on `ctx._liveMutations` so
// `cleanupInteractiveStateMarkers` can unstamp them after serialization;
// otherwise SDK mode (which runs in the customer's tab) would leak Percy
// attributes into the page.

import { uid } from './prepare-dom';
import { walkShadowDOM, getShadowRoot } from './shadow-utils';
import { rewriteCustomStateCSS } from './serialize-custom-states';

export { rewriteCustomStateCSS };

const PSEUDO_ELEMENT_MARKER_ATTR = 'data-percy-pseudo-element-id';
const POPOVER_OPEN_ATTR = 'data-percy-popover-open';
const FOCUS_ATTR = 'data-percy-focus';
const FOCUS_WITHIN_ATTR = 'data-percy-focus-within';
const CHECKED_ATTR = 'data-percy-checked';
const DISABLED_ATTR = 'data-percy-disabled';
const HOVER_ATTR = 'data-percy-hover';
const ACTIVE_ATTR = 'data-percy-active';

const ALL_INTERACTIVE_PSEUDO = [':focus', ':focus-within', ':checked', ':disabled', ':hover', ':active'];

const PSEUDO_TO_ATTR = {
  ':focus': '[data-percy-focus]',
  ':focus-within': '[data-percy-focus-within]',
  ':checked': '[data-percy-checked]',
  ':disabled': '[data-percy-disabled]',
  ':hover': '[data-percy-hover]',
  ':active': '[data-percy-active]'
};

// Boundary regex per pseudo-class. Lookahead `(?![-\w])` prevents :focus
// from matching the start of :focus-within / :focus-visible. Order matters:
// longer pseudos (:focus-within) are listed first so they win over :focus.
const PSEUDO_RES = [
  [':focus-within', /:focus-within(?![-\w])/g],
  [':focus', /:focus(?![-\w])/g],
  [':checked', /:checked(?![-\w])/g],
  [':disabled', /:disabled(?![-\w])/g],
  [':hover', /:hover(?![-\w])/g],
  [':active', /:active(?![-\w])/g]
];

function selectorContainsPseudo(selectorText, pseudoList) {
  return pseudoList.some(pc => {
    const re = PSEUDO_RES.find(([p]) => p === pc)[1];
    re.lastIndex = 0;
    return re.test(selectorText);
  });
}

export function rewritePseudoSelector(selectorText) {
  let out = selectorText;
  for (const [pseudo, re] of PSEUDO_RES) out = out.replace(re, PSEUDO_TO_ATTR[pseudo]);
  return out;
}

// Record a live-DOM mutation so cleanup can undo it. Callers must ensure
// ctx._liveMutations exists — markPseudoClassElements and getElementsToProcess
// both initialize it upfront.
function stampOnce(ctx, element, attr, value) {
  if (element.hasAttribute(attr)) return;
  element.setAttribute(attr, value);
  ctx._liveMutations.push([element, attr]);
}

// Walk into shadow roots (including closed ones captured via CDP) to find
// the deepest focused element, so we can stamp it with FOCUS_ATTR.
function findDeepActiveElement(dom) {
  let active = dom.activeElement;
  let root = active && getShadowRoot(active);
  while (root?.activeElement) {
    active = root.activeElement;
    root = getShadowRoot(active);
  }
  return active;
}

// Walk the focused element's ancestor chain across shadow root boundaries
// stamping FOCUS_WITHIN_ATTR on each. :focus-within rules in CSS will be
// rewritten to [data-percy-focus-within] and match these stamps.
function markFocusWithinAncestors(ctx, focused) {
  let node = focused?.parentNode;
  while (node) {
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      stampOnce(ctx, node, FOCUS_WITHIN_ATTR, 'true');
      node = node.parentNode;
    } else if (node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE — shadow root */) {
      // Shadow roots always have a host per spec; if a future detached
      // fragment ever lacked one, the next iteration's nodeType checks
      // both fail and the else cascade nulls node anyway.
      node = node.host;
    } else {
      node = null;
    }
  }
}

function markInteractiveStates(ctx) {
  const focused = findDeepActiveElement(ctx.dom);
  if (focused && focused !== ctx.dom.body && focused !== ctx.dom.documentElement) {
    stampOnce(ctx, focused, FOCUS_ATTR, 'true');
    markFocusWithinAncestors(ctx, focused);
  }

  // Single walk of ctx.dom + shadow roots collecting BOTH :checked and
  // :disabled in one pass. Previously two separate queryShadowAll calls
  // each walked the tree and re-traversed every [data-percy-shadow-host]
  // — on pages with many shadow hosts this doubled the per-snapshot
  // walk cost. Also tracks which states were observed so the CSS rule
  // extractor can skip work for selectors that have no matched elements.
  ctx._stampedInteractive = ctx._stampedInteractive || new Set();
  // walkShadowDOM only invokes the visitor with Document/Element/ShadowRoot
  // scopes — each has querySelectorAll, so no defensive guard is needed here.
  walkShadowDOM(ctx.dom, scope => {
    try {
      for (const el of scope.querySelectorAll(':checked')) {
        stampOnce(ctx, el, CHECKED_ATTR, 'true');
        ctx._stampedInteractive.add('checked');
      }
    } catch (e) { /* selector unsupported in this scope */ }
    try {
      for (const el of scope.querySelectorAll(':disabled')) {
        stampOnce(ctx, el, DISABLED_ATTR, 'true');
        ctx._stampedInteractive.add('disabled');
      }
    } catch (e) { /* selector unsupported in this scope */ }
  });
}

// Walk the LIVE document and every shadow root (open, or closed via the CDP
// WeakMap) WITHOUT relying on data-percy-shadow-host markers. walkShadowDOM
// descends through those markers, but they are only stamped later during
// cloning — so during this pre-clone marking pass it cannot reach shadow
// content. We descend via the live shadowRoot directly instead.
function eachScopeIncludingShadow(root, visit) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  visit(root);
  for (const el of root.querySelectorAll('*')) {
    const shadow = getShadowRoot(el);
    if (shadow) eachScopeIncludingShadow(shadow, visit);
  }
}

// Auto-detect open native popovers page-wide, INCLUDING inside shadow roots.
// `:popover-open` is an unambiguous serialize-time state (like :checked /
// :disabled), so it is stamped automatically rather than only on
// pseudoClassEnabledElements. The renderer's popover-element-helper already
// re-opens any [popover][data-percy-popover-open] across shadow boundaries;
// without this stamp a popover open at snapshot time renders hidden via the
// UA `[popover]:not(:popover-open){display:none}` rule. If `:popover-open`
// is unsupported the selector throws — we stop querying and warn once.
function markOpenPopovers(ctx) {
  let supported = true;
  eachScopeIncludingShadow(ctx.dom, scope => {
    if (!supported) return;
    try {
      for (const el of scope.querySelectorAll('[popover]:popover-open')) {
        stampOnce(ctx, el, POPOVER_OPEN_ATTR, 'true');
      }
    } catch (e) {
      supported = false;
      ctx.warnings.add('Browser does not support :popover-open pseudo-class.');
    }
  });
}

function isPopoverOpen(ctx, element) {
  try {
    return element.matches(':popover-open');
  } catch (err) {
    ctx.warnings.add('Browser does not support :popover-open pseudo-class.');
    return false;
  }
}

function markPopoverIfOpen(ctx, element) {
  if (element.hasAttribute('popover') && isPopoverOpen(ctx, element)) {
    stampOnce(ctx, element, POPOVER_OPEN_ATTR, 'true');
  }
}

function stampPseudoElementId(ctx, element) {
  if (!element.getAttribute(PSEUDO_ELEMENT_MARKER_ATTR)) {
    element.setAttribute(PSEUDO_ELEMENT_MARKER_ATTR, uid());
    ctx._liveMutations.push([element, PSEUDO_ELEMENT_MARKER_ATTR]);
  }
}

// Configured elements get :hover/:active stamped unconditionally — opting in
// IS the request to capture those forced states. :focus/:checked/:disabled
// are already covered by the page-wide markInteractiveStates pass.
function markElementInteractiveStates(ctx, element) {
  stampOnce(ctx, element, HOVER_ATTR, 'true');
  stampOnce(ctx, element, ACTIVE_ATTR, 'true');
}

export function getElementsToProcess(ctx, config, markWithId = false) {
  const { dom } = ctx;
  const elements = [];

  const stamp = (el) => {
    if (markWithId) {
      markPopoverIfOpen(ctx, el);
      markElementInteractiveStates(ctx, el);
      stampPseudoElementId(ctx, el);
    }
  };

  if (Array.isArray(config.id)) {
    for (const id of config.id) {
      const element = dom.getElementById(id);
      if (!element) {
        ctx.warnings.add(`No element found with ID: ${id} for pseudo-class serialization`);
        continue;
      }
      stamp(element);
      elements.push(element);
    }
  }

  if (Array.isArray(config.className)) {
    for (const className of config.className) {
      const collection = dom.getElementsByClassName(className);
      if (!collection.length) {
        ctx.warnings.add(`No element found with class name: ${className} for pseudo-class serialization`);
        continue;
      }
      // Process only first match per class name (preserves prior behavior).
      const element = collection[0];
      stamp(element);
      elements.push(element);
    }
  }

  if (Array.isArray(config.xpath)) {
    for (const xpathExpression of config.xpath) {
      try {
        const element = dom.evaluate(
          xpathExpression, dom, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        if (!element) {
          ctx.warnings.add(`No element found for XPath: ${xpathExpression} for pseudo-class serialization`);
          continue;
        }
        stamp(element);
      } catch (err) {
        ctx.warnings.add(`Invalid XPath expression "${xpathExpression}" for pseudo-class serialization. Error: ${err.message}`);
        console.warn(`Invalid XPath expression "${xpathExpression}". Error: ${err.message}`);
      }
    }
  }

  if (Array.isArray(config.selectors)) {
    for (const selector of config.selectors) {
      try {
        const matched = Array.from(dom.querySelectorAll(selector));
        if (!matched.length) {
          ctx.warnings.add(`No element found for selector: ${selector} for pseudo-class serialization`);
          continue;
        }
        matched.forEach((el) => {
          stamp(el);
          elements.push(el);
        });
      } catch (err) {
        ctx.warnings.add(`Invalid selector "${selector}" for pseudo-class serialization. Error: ${err.message}`);
        console.warn(`Invalid selector "${selector}". Error: ${err.message}`);
      }
    }
  }
  return elements;
}

// Pre-clone marking pass. Runs on the live DOM before cloneNodeAndShadow so
// the data-attributes are copied through to the clone via cloneNode.
export function markPseudoClassElements(ctx, config) {
  ctx._liveMutations = [];
  markInteractiveStates(ctx);
  markOpenPopovers(ctx);
  if (config) getElementsToProcess(ctx, config, true);
}

// Reverse every setAttribute we made on the live DOM during marking. Called
// at the end of serializeDOM so the customer's page is left clean — SDK
// mode runs in the customer's actual browser tab and leaks would persist
// past the snapshot.
export function cleanupInteractiveStateMarkers(ctx) {
  if (!ctx._liveMutations) return;
  for (const [element, attr] of ctx._liveMutations) {
    try {
      element.removeAttribute(attr);
    } catch (e) {
      // Element detached or attribute already gone — fine
    }
  }
  ctx._liveMutations = [];
}

function stylesToCSSText(styles) {
  const decls = [];
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    decls.push(`${property}: ${styles.getPropertyValue(property)} !important;`);
  }
  return decls.join(' ');
}

// Walk a CSSRule list yielding every reachable style rule. Nested rules
// inside @media/@layer/@supports are emitted with the at-rule prelude
// preserved as a wrapper string; flat-emitting would drop the guard.
function walkCSSRules(ruleList) {
  const result = [];
  for (let i = 0; i < ruleList.length; i++) {
    const rule = ruleList[i];
    const hasNested = !!(rule.cssRules && rule.cssRules.length);
    if (hasNested) {
      const conditionText = rule.conditionText || rule.media?.mediaText;
      const atRulePrelude = conditionText && rule.cssText
        ? rule.cssText.split('{')[0].trim()
        : null;
      for (const inner of walkCSSRules(rule.cssRules)) {
        if (atRulePrelude && inner.selectorText) {
          result.push({
            selectorText: inner.selectorText,
            style: inner.style,
            wrapper: atRulePrelude
          });
        } else {
          result.push(inner);
        }
      }
    } else if (rule.selectorText) {
      // Rules without nested cssRules and without selectorText (@font-face,
      // @charset, @counter-style, etc.) are skipped — they can't contain
      // interactive pseudos.
      result.push({ selectorText: rule.selectorText, style: rule.style, wrapper: null });
    }
  }
  return result;
}

// Collect { sheet, owner } entries for every stylesheet in the document
// and inside every shadow root. owner is the shadow host (or null for
// document-level sheets) so we know which clone scope to inject into.
function collectStyleSheets(doc) {
  const entries = [];
  walkShadowDOM(doc, scope => {
    let sheets;
    try {
      sheets = scope.styleSheets;
    } catch (e) {
      return;
    }
    if (!sheets) return;
    const owner = scope === doc ? null : scope.host;
    for (const sheet of sheets) entries.push({ sheet, owner });
  });
  return entries;
}

function extractPseudoClassRules(ctx) {
  const sheetEntries = collectStyleSheets(ctx.dom);
  const rulesByOwner = new Map();

  // Short-circuit per pseudo: when markInteractiveStates ran first (the
  // production path via markPseudoClassElements), `ctx._stampedInteractive`
  // records which interactive states were actually observed. Rules for
  // `:checked` / `:disabled` selectors that found no live elements can't
  // match anything in the clone after rewriting, so we drop them from the
  // filter and avoid the rewrite cost. When the marker is absent (unit
  // tests that call serializePseudoClasses directly), fall back to the
  // full pseudo list to preserve prior behavior. `:focus`, `:focus-within`,
  // `:hover`, `:active` are kept regardless either way.
  const activePseudos = ctx._stampedInteractive
    ? ALL_INTERACTIVE_PSEUDO.filter(p => {
      if (p === ':checked') return ctx._stampedInteractive.has('checked');
      if (p === ':disabled') return ctx._stampedInteractive.has('disabled');
      return true;
    })
    : ALL_INTERACTIVE_PSEUDO;

  for (const { sheet, owner } of sheetEntries) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      // Cross-origin stylesheet — skip
      continue;
    }
    if (!rules) continue;

    for (const rule of walkCSSRules(rules)) {
      // Cheapest possible filter: a selector with no `:` can't contain any
      // interactive pseudo. Skips most rules on most stylesheets without
      // touching the regex bank.
      if (!rule.selectorText.includes(':')) continue;
      if (!selectorContainsPseudo(rule.selectorText, activePseudos)) continue;

      const rewrittenSelector = rewritePseudoSelector(rule.selectorText);

      const cssText = `${rewrittenSelector} { ${rule.style.cssText} }`;
      const wrapped = rule.wrapper ? `${rule.wrapper} { ${cssText} }` : cssText;
      if (!rulesByOwner.has(owner)) rulesByOwner.set(owner, []);
      rulesByOwner.get(owner).push(wrapped);
    }
  }

  // Build a percyId → cloneEl index once for shadow-host injection — only
  // when there is at least one non-null owner in the collected rules.
  let cloneByPercyId = null;
  for (const owner of rulesByOwner.keys()) {
    if (owner !== null) {
      cloneByPercyId = new Map();
      for (const el of ctx.clone.querySelectorAll('[data-percy-element-id]')) {
        cloneByPercyId.set(el.getAttribute('data-percy-element-id'), el);
      }
      break;
    }
  }

  for (const [owner, rewrittenRules] of rulesByOwner) {
    const styleElement = ctx.clone.createElement
      ? ctx.clone.createElement('style')
      : ctx.dom.createElement('style');
    styleElement.setAttribute('data-percy-interactive-states', 'true');
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    styleElement.textContent = rewrittenRules.join('\n');

    if (owner === null) {
      const head = ctx.clone.head || ctx.clone.querySelector('head');
      if (head) head.appendChild(styleElement);
    } else {
      const percyId = owner.getAttribute('data-percy-element-id');
      const cloneHost = cloneByPercyId.get(percyId);
      if (cloneHost && cloneHost.shadowRoot) {
        cloneHost.shadowRoot.appendChild(styleElement);
      }
    }
  }
}

export function serializePseudoClasses(ctx) {
  // Auto-detect path runs unconditionally so `:focus`/`:checked`/`:disabled`
  // rules are rewritten regardless of whether the user configured a
  // pseudoClassEnabledElements list (and regardless of whether that list
  // matched anything on this page).
  extractPseudoClassRules(ctx);

  if (!ctx.pseudoClassEnabledElements) return;

  const elements = ctx.dom.querySelectorAll(`[${PSEUDO_ELEMENT_MARKER_ATTR}]`);
  if (elements.length === 0) return;

  // pseudoElementId → cloneEl index, built once. The previous shape did a
  // ctx.clone.querySelector per element which is O(N × T).
  const cloneByPseudoId = new Map();
  for (const el of ctx.clone.querySelectorAll(`[${PSEUDO_ELEMENT_MARKER_ATTR}]`)) {
    cloneByPseudoId.set(el.getAttribute(PSEUDO_ELEMENT_MARKER_ATTR), el);
  }

  const cssRules = [];
  for (const element of elements) {
    const percyElementId = element.getAttribute(PSEUDO_ELEMENT_MARKER_ATTR);
    const cloneElement = cloneByPseudoId.get(percyElementId);

    if (!cloneElement) {
      ctx.warnings.add(`Element not found for pseudo-class serialization with percy-element-id: ${percyElementId}`);
      continue;
    }

    try {
      // ctx.dom.defaultView is the iframe's window for nested-frame contexts;
      // fall back to the global window when ctx.dom is the top document or a
      // synthetic root that doesn't expose defaultView (e.g. tests).
      const win = ctx.dom.defaultView || window;
      const computedStyles = win.getComputedStyle(element);
      const cssText = stylesToCSSText(computedStyles);
      cssRules.push(`[${PSEUDO_ELEMENT_MARKER_ATTR}="${percyElementId}"] { ${cssText} }`);
    } catch (err) {
      console.warn('Could not get computed styles for element', element, err);
    }
  }

  if (cssRules.length > 0) {
    const styleElement = ctx.dom.createElement('style');
    styleElement.setAttribute('data-percy-pseudo-class-styles', 'true');
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    styleElement.textContent = cssRules.join('\n');

    const head = ctx.clone.head || ctx.clone.querySelector('head');
    if (head) {
      head.appendChild(styleElement);
    } else {
      ctx.warnings.add('Could not inject pseudo-class styles: no <head> element found');
    }
  }
}
