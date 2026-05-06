/* global XPathResult */

// Serializes pseudo-class state into Percy's clone via two paths:
//
//   1. Configured-element path (`pseudoClassEnabledElements` config). User
//      explicitly opts in elements by id/className/xpath/selector. Each is
//      stamped with PSEUDO_ELEMENT_MARKER_ATTR; we then snapshot all
//      computed styles (including pseudo-class styles) and inject them as
//      inline rules on the clone.
//
//   2. Auto-detect path (every snapshot). For :focus / :checked / :disabled
//      we stamp the live DOM with data-percy-focus / -checked / -disabled
//      and rewrite matching CSS rules in collected stylesheets to use those
//      data-attribute selectors.
//
// :hover and :active are intentionally NOT rewritten — there is no live
// state to detect at snapshot time, and rewriting them produced dead
// selectors (no `data-percy-hover` is ever stamped).
//
// All live-DOM mutations are recorded on `ctx._liveMutations` so
// `cleanupInteractiveStateMarkers` can unstamp them after serialization;
// otherwise SDK mode (which runs in the customer's tab) would leak Percy
// attributes into the page.

import { uid } from './prepare-dom';
import { walkShadowDOM, queryShadowAll, getShadowRoot } from './shadow-utils';
import { rewriteCustomStateCSS } from './serialize-custom-states';

export { rewriteCustomStateCSS };

const PSEUDO_ELEMENT_MARKER_ATTR = 'data-percy-pseudo-element-id';
const POPOVER_OPEN_ATTR = 'data-percy-popover-open';
const FOCUS_ATTR = 'data-percy-focus';
const CHECKED_ATTR = 'data-percy-checked';
const DISABLED_ATTR = 'data-percy-disabled';

const AUTO_DETECT_PSEUDO = [':focus', ':checked', ':disabled'];

const PSEUDO_TO_ATTR = {
  ':focus': '[data-percy-focus]',
  ':checked': '[data-percy-checked]',
  ':disabled': '[data-percy-disabled]'
};

// Boundary lookahead `(?![-\w])` skips :focus-within, :focus-visible, etc.
const PSEUDO_BOUNDARY_RES = {
  ':focus': /:focus(?![-\w])/g,
  ':checked': /:checked(?![-\w])/g,
  ':disabled': /:disabled(?![-\w])/g
};

function selectorContainsAutoPseudo(selectorText) {
  return AUTO_DETECT_PSEUDO.some(pc => {
    const re = PSEUDO_BOUNDARY_RES[pc];
    re.lastIndex = 0;
    return re.test(selectorText);
  });
}

function rewritePseudoSelector(selectorText) {
  let rewritten = selectorText;
  for (const pseudo of AUTO_DETECT_PSEUDO) {
    rewritten = rewritten.replace(PSEUDO_BOUNDARY_RES[pseudo], PSEUDO_TO_ATTR[pseudo]);
  }
  return rewritten;
}

// Record a live-DOM mutation so cleanup can undo it. Returns true if the
// attribute was newly written (caller may want to set the value).
function stampOnce(ctx, element, attr, value) {
  if (!element || typeof element.hasAttribute !== 'function') return false;
  if (element.hasAttribute(attr)) return false;
  element.setAttribute(attr, value);
  /* istanbul ignore next: defensive — _liveMutations is initialized in markPseudoClassElements */
  if (!ctx._liveMutations) ctx._liveMutations = [];
  ctx._liveMutations.push([element, attr]);
  return true;
}

// Walk into shadow roots (including closed ones intercepted by preflight)
// to find the deepest focused element, so we can stamp it with FOCUS_ATTR.
function findDeepActiveElement(dom) {
  let active = dom.activeElement;
  let root = active && getShadowRoot(active);
  while (root?.activeElement) {
    active = root.activeElement;
    root = getShadowRoot(active);
  }
  return active;
}

function markInteractiveStates(ctx) {
  ctx._focusedElementId = null;
  const focused = findDeepActiveElement(ctx.dom);
  if (focused && focused !== ctx.dom.body && focused !== ctx.dom.documentElement) {
    const id = focused.getAttribute?.('data-percy-element-id');
    if (id) ctx._focusedElementId = id;
    stampOnce(ctx, focused, FOCUS_ATTR, 'true');
  }

  for (const el of queryShadowAll(ctx.dom, ':checked')) {
    stampOnce(ctx, el, CHECKED_ATTR, 'true');
  }
  for (const el of queryShadowAll(ctx.dom, ':disabled')) {
    stampOnce(ctx, el, DISABLED_ATTR, 'true');
  }
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
    /* istanbul ignore next: defensive — _liveMutations is initialized in markPseudoClassElements */
    if (!ctx._liveMutations) ctx._liveMutations = [];
    ctx._liveMutations.push([element, PSEUDO_ELEMENT_MARKER_ATTR]);
  }
}

function markElementInteractiveStates(ctx, element) {
  if (ctx._focusedElementId) {
    const id = element.getAttribute('data-percy-element-id');
    if (id && id === ctx._focusedElementId) {
      stampOnce(ctx, element, FOCUS_ATTR, 'true');
    }
  }
  for (const [pseudo, attr] of [[':focus', FOCUS_ATTR], [':checked', CHECKED_ATTR], [':disabled', DISABLED_ATTR]]) {
    try {
      if (element.matches(pseudo)) stampOnce(ctx, element, attr, 'true');
    } catch (e) {
      // Browser doesn't support this pseudo — skip
    }
  }
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
      if (!selectorContainsAutoPseudo(rule.selectorText)) continue;

      const rewrittenSelector = rewritePseudoSelector(rule.selectorText);
      if (rewrittenSelector === rule.selectorText) continue;

      const cssText = `${rewrittenSelector} { ${rule.style.cssText} }`;
      const wrapped = rule.wrapper ? `${rule.wrapper} { ${cssText} }` : cssText;
      if (!rulesByOwner.has(owner)) rulesByOwner.set(owner, []);
      rulesByOwner.get(owner).push(wrapped);
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
      const cloneHost = ctx.clone.querySelector(`[data-percy-element-id="${percyId}"]`);
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

  const cssRules = [];
  for (const element of elements) {
    const percyElementId = element.getAttribute(PSEUDO_ELEMENT_MARKER_ATTR);
    const cloneElement = ctx.clone.querySelector(`[${PSEUDO_ELEMENT_MARKER_ATTR}="${percyElementId}"]`);

    if (!cloneElement) {
      ctx.warnings.add(`Element not found for pseudo-class serialization with percy-element-id: ${percyElementId}`);
      continue;
    }

    try {
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
