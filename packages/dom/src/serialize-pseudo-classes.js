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
import { walkShadowDOM, queryShadowAll, getShadowRoot } from './shadow-utils';
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

// Auto-detect: stamped from the live DOM during marking. CSS rules are
// rewritten regardless of whether the user configured anything.
const AUTO_DETECT_PSEUDO = [':focus', ':focus-within', ':checked', ':disabled'];
// Config-only: rewritten only when at least one configured element matches
// the rule's base selector. The user opts elements in via config and uses
// execute scripts to force the state before snapshot capture.
const CONFIG_ONLY_PSEUDO = [':hover', ':active'];
const ALL_INTERACTIVE_PSEUDO = [...AUTO_DETECT_PSEUDO, ...CONFIG_ONLY_PSEUDO];

const PSEUDO_TO_ATTR = {
  ':focus': '[data-percy-focus]',
  ':focus-within': '[data-percy-focus-within]',
  ':checked': '[data-percy-checked]',
  ':disabled': '[data-percy-disabled]',
  ':hover': '[data-percy-hover]',
  ':active': '[data-percy-active]'
};

// Order matters: longer pseudos (:focus-within) must be tried before their
// prefix forms (:focus). The boundary lookahead `(?![-\w])` prevents :focus
// from matching the start of :focus-within / :focus-visible / :focusable.
// Used only by selectorContainsPseudo for cheap detection — rewriting
// itself goes through walkPseudoSelector below, which is CSS-aware.
const PSEUDO_BOUNDARY_RES = {
  ':focus-within': /:focus-within(?![-\w])/g,
  ':focus': /:focus(?![-\w])/g,
  ':checked': /:checked(?![-\w])/g,
  ':disabled': /:disabled(?![-\w])/g,
  ':hover': /:hover(?![-\w])/g,
  ':active': /:active(?![-\w])/g
};

// Priority order: longest pseudo first so ':focus-within' wins over ':focus'
// at the same position.
const PSEUDO_PRIORITY = [':focus-within', ':focus', ':checked', ':disabled', ':hover', ':active'];

function selectorContainsPseudo(selectorText, pseudoList) {
  return pseudoList.some(pc => {
    const re = PSEUDO_BOUNDARY_RES[pc];
    re.lastIndex = 0;
    return re.test(selectorText);
  });
}

// CSS-aware rewriter: walks the selector text token-by-token, skipping over
// string literals ('...' / "...") and attribute-bracket contents ([...]) so
// that `:focus` appearing inside `[value=":focus"]` or a quoted string is
// left alone. A naive global regex would corrupt those literals.
//
// `replace` receives `(pseudo)` and returns the replacement string. This
// lets us implement both full rewrite (return PSEUDO_TO_ATTR[pseudo]) and
// stripping (return '').
function walkPseudoSelector(selectorText, replace) {
  let out = '';
  let i = 0;
  let len = selectorText.length;
  while (i < len) {
    let ch = selectorText[i];
    // Top-level string literal — copy verbatim through the closing quote.
    if (ch === '"' || ch === "'") {
      let quote = ch;
      out += ch; i++;
      while (i < len && selectorText[i] !== quote) {
        if (selectorText[i] === '\\' && i + 1 < len) {
          out += selectorText[i] + selectorText[i + 1];
          i += 2;
        } else {
          out += selectorText[i++];
        }
      }
      if (i < len) out += selectorText[i++];
      continue;
    }
    // Attribute bracket — copy verbatim through the matching `]`. Handles
    // nested brackets, single- and double-quoted strings inside.
    if (ch === '[') {
      let depth = 1;
      out += ch; i++;
      while (i < len && depth > 0) {
        let cc = selectorText[i];
        if (cc === '"' || cc === "'") {
          let q = cc;
          out += cc; i++;
          while (i < len && selectorText[i] !== q) {
            if (selectorText[i] === '\\' && i + 1 < len) {
              out += selectorText[i] + selectorText[i + 1];
              i += 2;
            } else {
              out += selectorText[i++];
            }
          }
          if (i < len) out += selectorText[i++];
        } else if (cc === '[') {
          depth++; out += cc; i++;
        } else if (cc === ']') {
          depth--; out += cc; i++;
        } else {
          out += selectorText[i++];
        }
      }
      continue;
    }
    // Top-level pseudo-class — try priority-ordered match.
    if (ch === ':') {
      let matched = false;
      for (const pseudo of PSEUDO_PRIORITY) {
        if (selectorText.startsWith(pseudo, i)) {
          let nextCh = selectorText[i + pseudo.length];
          if (!nextCh || !/[-\w]/.test(nextCh)) {
            out += replace(pseudo);
            i += pseudo.length;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function rewritePseudoSelector(selectorText) {
  return walkPseudoSelector(selectorText, pseudo => PSEUDO_TO_ATTR[pseudo]);
}

export function stripInteractivePseudo(selectorText) {
  return walkPseudoSelector(selectorText, () => '');
}

// Record a live-DOM mutation so cleanup can undo it. The init-on-demand
// branch fires when callers exercise getElementsToProcess directly (in
// tests) rather than going through markPseudoClassElements.
function stampOnce(ctx, element, attr, value) {
  if (!element || typeof element.hasAttribute !== 'function') return;
  if (element.hasAttribute(attr)) return;
  element.setAttribute(attr, value);
  if (!ctx._liveMutations) ctx._liveMutations = [];
  ctx._liveMutations.push([element, attr]);
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
      /* istanbul ignore next: shadow roots always have a host; the `|| null`
         fallback covers a hypothetical detached fragment whose host has been
         cleared. */
      node = node.host || null;
    } else {
      node = null;
    }
  }
}

function markInteractiveStates(ctx) {
  ctx._focusedElementId = null;
  const focused = findDeepActiveElement(ctx.dom);
  if (focused && focused !== ctx.dom.body && focused !== ctx.dom.documentElement) {
    const id = focused.getAttribute?.('data-percy-element-id');
    if (id) ctx._focusedElementId = id;
    stampOnce(ctx, focused, FOCUS_ATTR, 'true');
    markFocusWithinAncestors(ctx, focused);
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
    /* istanbul ignore next: the init-on-demand branch is unreachable from
       markPseudoClassElements (which initializes the array first); kept as
       a defensive fallback for callers that exercise getElementsToProcess
       directly. */
    if (!ctx._liveMutations) ctx._liveMutations = [];
    ctx._liveMutations.push([element, PSEUDO_ELEMENT_MARKER_ATTR]);
  }
}

// Per-element marking for configured elements. Stamps :focus / :checked /
// :disabled when the live element matches them (auto-detect catches the
// page-wide case; this handles configured elements whose .matches() may be
// overridden by page code). Also stamps :hover and :active unconditionally
// on configured elements — opting an element into pseudoClassEnabledElements
// IS the user's request to capture those forced states.
function markElementInteractiveStates(ctx, element) {
  if (ctx._focusedElementId) {
    const id = element.getAttribute('data-percy-element-id');
    /* istanbul ignore else: the `id` short-circuit only triggers when a
       configured element has no data-percy-element-id; markPseudoClassElements
       stamps every configured element earlier, so in practice id is always
       truthy here. */
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
  // Configured elements get :hover and :active unconditionally so any CSS
  // rule using those pseudos applies to them in the snapshot.
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
    } else /* istanbul ignore else: rules without nested cssRules and without
       selectorText (@charset / @counter-style / @font-face) cannot contain
       interactive pseudos, so skipping them is correct. */ if (rule.selectorText) {
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

// Returns true if at least one configured element matches `baseSelector` —
// used to gate :hover/:active rewriting. Without this gate we'd rewrite
// every `.btn:hover` on the page and apply the resulting [data-percy-hover]
// rule globally, but only configured elements receive that stamp, so other
// matches would silently lose their hover styles.
function configuredElementMatches(ctx, baseSelector) {
  if (!ctx.pseudoClassEnabledElements) return false;
  const stamped = ctx.dom.querySelectorAll(`[${PSEUDO_ELEMENT_MARKER_ATTR}]`);
  if (!stamped.length) return false;
  let candidates;
  try {
    candidates = ctx.dom.querySelectorAll(baseSelector);
  } catch (e) {
    // Stripped selector invalid (e.g. pseudo was at the start: ':hover')
    return false;
  }
  for (const el of candidates) {
    if (el.hasAttribute(PSEUDO_ELEMENT_MARKER_ATTR)) return true;
  }
  return false;
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
      if (!selectorContainsPseudo(rule.selectorText, ALL_INTERACTIVE_PSEUDO)) continue;

      const hasConfigOnly = selectorContainsPseudo(rule.selectorText, CONFIG_ONLY_PSEUDO);
      const hasAutoDetect = selectorContainsPseudo(rule.selectorText, AUTO_DETECT_PSEUDO);

      // :hover/:active alone with no configured elements: skip — the
      // rewritten selector wouldn't match anything.
      if (hasConfigOnly && !hasAutoDetect &&
          !configuredElementMatches(ctx, stripInteractivePseudo(rule.selectorText))) {
        continue;
      }

      const rewrittenSelector = rewritePseudoSelector(rule.selectorText);
      /* istanbul ignore if: defensive — selectorContainsPseudo and the
         boundary regexes are consistent, so any selector that passed the
         contains-check above always rewrites to a different string. Kept
         in case a future pseudo addition breaks that invariant. */
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
      /* istanbul ignore next: ctx.dom.defaultView is always set in a browser
         test runner; the `|| window` fallback is defense-in-depth for non-
         standard ctx.dom values that might lack the property. */
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
