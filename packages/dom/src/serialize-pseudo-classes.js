/* global XPathResult */

// Serializes pseudo-class state into Percy's clone via two paths:
//
//   1. Configured-element path (`pseudoClassEnabledElements` config). User
//      explicitly opts in elements by id/className/xpath/selector. We mark
//      each with PSEDUO_ELEMENT_MARKER_ATTR, snapshot ALL computed styles
//      (including pseudo-class styles), and inject them as inline rules on
//      the clone. This is the heavyweight "guarantee this element looks
//      right" path.
//
//   2. Auto-detect path (every snapshot). For :focus/:checked/:disabled we
//      stamp data-percy-focus / data-percy-checked / data-percy-disabled on
//      the live element, then rewrite matching CSS rules in collected
//      stylesheets to use the data-attribute selector. :hover/:active are
//      config-only — there is no input state to auto-detect; we only
//      rewrite their rules when the base selector matches a configured
//      element (so the user can stage them via inline styles or fixtures).
//
// Custom-element :state() lives in serialize-custom-states.js and is
// re-exported here so existing callers (serialize-dom.js, tests) don't move.

import { uid } from './prepare-dom';
import { walkShadowDOM, queryShadowAll } from './shadow-utils';
import { rewriteCustomStateCSS } from './serialize-custom-states';

export { rewriteCustomStateCSS };

const PSEDUO_ELEMENT_MARKER_ATTR = 'data-percy-pseudo-element-id';
const POPOVER_OPEN_ATTR = 'data-percy-popover-open';
const FOCUS_ATTR = 'data-percy-focus';
const CHECKED_ATTR = 'data-percy-checked';
const DISABLED_ATTR = 'data-percy-disabled';

// :hover and :active are *config-only*: rewriting them only makes sense if
// the user explicitly listed the element in pseudoClassEnabledElements.
const AUTO_DETECT_PSEUDO = [':focus', ':checked', ':disabled'];
const CONFIG_ONLY_PSEUDO = [':hover', ':active'];
const INTERACTIVE_PSEUDO_CLASSES = [...AUTO_DETECT_PSEUDO, ...CONFIG_ONLY_PSEUDO];

const PSEUDO_TO_ATTR = {
  ':focus': '[data-percy-focus]',
  ':checked': '[data-percy-checked]',
  ':disabled': '[data-percy-disabled]',
  ':hover': '[data-percy-hover]',
  ':active': '[data-percy-active]'
};

// Pre-built boundary regexes for each interactive pseudo-class. The
// `(?![-\w])` lookahead skips matches like :focus-within / :focus-visible /
// :checkedfoo. Hardcoded literals (rather than `new RegExp(constant + ...)`)
// because (a) the input set is closed and known at module load and (b) it
// avoids tripping semgrep's detect-non-literal-regexp ReDoS warning even
// though the inputs are constant.
const PSEUDO_BOUNDARY_RES = {
  ':focus': /:focus(?![-\w])/g,
  ':checked': /:checked(?![-\w])/g,
  ':disabled': /:disabled(?![-\w])/g,
  ':hover': /:hover(?![-\w])/g,
  ':active': /:active(?![-\w])/g
};

function selectorContainsPseudo(selectorText, pseudoList) {
  return pseudoList.some(pc => {
    // Reset lastIndex on the global regex before .test() so calls don't
    // depend on each other across .test() invocations.
    const re = PSEUDO_BOUNDARY_RES[pc];
    re.lastIndex = 0;
    return re.test(selectorText);
  });
}

function rewritePseudoSelector(selectorText) {
  let rewritten = selectorText;
  for (const pseudo of INTERACTIVE_PSEUDO_CLASSES) {
    rewritten = rewritten.replace(PSEUDO_BOUNDARY_RES[pseudo], PSEUDO_TO_ATTR[pseudo]);
  }
  return rewritten;
}

function stripInteractivePseudo(selectorText) {
  let stripped = selectorText;
  for (const pseudo of INTERACTIVE_PSEUDO_CLASSES) {
    stripped = stripped.replace(PSEUDO_BOUNDARY_RES[pseudo], '');
  }
  return stripped;
}

// Find the deepest active element across shadow root boundaries. Plain
// document.activeElement only returns the shadow host; we need the actual
// focused leaf so we can stamp it with data-percy-focus.
function findDeepActiveElement(dom) {
  let active = dom.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

// Mark elements in :focus / :checked / :disabled state on the live DOM
// before cloning, so cloneNode copies the data-attribute over. Walks shadow
// roots so states inside open or preflight-intercepted closed shadow DOM
// are captured too.
function markInteractiveStates(ctx) {
  // Capture the focused element's id so configured-element marking can
  // honor it later even when element.matches(':focus') is unreliable
  // (some test environments mock matches at the prototype level).
  ctx._focusedElementId = null;
  const focused = findDeepActiveElement(ctx.dom);
  if (focused && focused !== ctx.dom.body && focused !== ctx.dom.documentElement) {
    const id = focused.getAttribute?.('data-percy-element-id');
    if (id) ctx._focusedElementId = id;
    if (focused.hasAttribute && !focused.hasAttribute(FOCUS_ATTR)) {
      focused.setAttribute(FOCUS_ATTR, 'true');
    }
  }

  for (const el of queryShadowAll(ctx.dom, ':checked')) {
    if (!el.hasAttribute(CHECKED_ATTR)) el.setAttribute(CHECKED_ATTR, 'true');
  }
  for (const el of queryShadowAll(ctx.dom, ':disabled')) {
    if (!el.hasAttribute(DISABLED_ATTR)) el.setAttribute(DISABLED_ATTR, 'true');
  }
}

// :popover-open isn't an interactive state — it's a render-time signal that
// changes which sub-tree is visible. Stamp it as an attribute so downstream
// CSS rewriting can target the popover-open variant.
function isPopoverOpen(ctx, element) {
  try {
    return element.matches(':popover-open');
  } catch (err) {
    ctx.warnings.add('Browser does not support :popover-open pseudo-class.');
    return false;
  }
}

function markPopoverIfOpen(ctx, element) {
  if (element.hasAttribute('popover') &&
      isPopoverOpen(ctx, element) &&
      !element.hasAttribute(POPOVER_OPEN_ATTR)) {
    element.setAttribute(POPOVER_OPEN_ATTR, 'true');
  }
}

// Stamp a per-element id used by the configured-element computed-style
// snapshot (serializePseudoClasses below). Idempotent.
function stampPseudoElementId(element) {
  if (!element.getAttribute(PSEDUO_ELEMENT_MARKER_ATTR)) {
    element.setAttribute(PSEDUO_ELEMENT_MARKER_ATTR, uid());
  }
}

// Per-element interactive-state marking. Complements markInteractiveStates
// (which sweeps the whole DOM) by handling configured elements whose state
// the DOM-wide selector engine can't observe — e.g. an element whose
// `.matches(':focus')` is overridden by a test or by app code.
function markElementInteractiveStates(ctx, element) {
  if (ctx._focusedElementId) {
    const id = element.getAttribute('data-percy-element-id');
    if (id && id === ctx._focusedElementId && !element.hasAttribute(FOCUS_ATTR)) {
      element.setAttribute(FOCUS_ATTR, 'true');
    }
  }
  for (const [pseudo, attr] of [[':focus', FOCUS_ATTR], [':checked', CHECKED_ATTR], [':disabled', DISABLED_ATTR]]) {
    if (element.hasAttribute(attr)) continue;
    try {
      if (element.matches(pseudo)) element.setAttribute(attr, 'true');
    } catch (e) {
      // Browser doesn't support this pseudo — skip
    }
  }
}

// Resolve the pseudoClassEnabledElements config to a flat list of live
// elements. Caller controls whether resolved elements get stamped with
// PSEDUO_ELEMENT_MARKER_ATTR (true during the pre-clone marking pass,
// false during the post-clone style-extraction pass — though in practice
// the only caller passes true).
export function getElementsToProcess(ctx, config, markWithId = false) {
  const { dom } = ctx;
  const elements = [];

  const stamp = (el) => {
    if (markWithId) {
      markPopoverIfOpen(ctx, el);
      markElementInteractiveStates(ctx, el);
      stampPseudoElementId(el);
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
  markInteractiveStates(ctx);
  if (config) getElementsToProcess(ctx, config, true);
}

// Convert a CSSStyleDeclaration to a CSS text block with !important on every
// declaration. Inline styles win over rules in the cascade with !important,
// which is what we want when injecting captured pseudo-class styles.
function stylesToCSSText(styles) {
  const decls = [];
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    decls.push(`${property}: ${styles.getPropertyValue(property)} !important;`);
  }
  return decls.join(' ');
}

// Walk a CSSRule list, yielding every style rule reachable. Nested rules
// inside @media/@layer/@supports are emitted with their containing at-rule
// preserved as a wrapper string — flat-emitting the inner rule would drop
// the at-rule guard and apply styles unconditionally.
function walkCSSRules(ruleList) {
  const result = [];
  for (let i = 0; i < ruleList.length; i++) {
    const rule = ruleList[i];
    const hasNested = !!(rule.cssRules && rule.cssRules.length);
    if (hasNested) {
      // For at-rules with conditions, keep their prelude so wrapping rules
      // honor the guard (e.g. @media (max-width: 600px) { :focus { ... } }).
      /* istanbul ignore next: at-rule prelude extraction — only fires for nested @media/@layer/@supports rules, exercised by integration */
      const conditionText = rule.conditionText || rule.media?.mediaText;
      /* istanbul ignore next: prelude extraction depends on browser cssText shape */
      const atRulePrelude = conditionText && rule.cssText
        ? rule.cssText.split('{')[0].trim()
        : null;
      for (const inner of walkCSSRules(rule.cssRules)) {
        /* istanbul ignore next: at-rule wrapping fork — both branches depend on
           browser cssText shape (conditionText & cssText.split). Integration
           tests cover the @media path; the @layer-without-condition path is
           harder to deterministically trigger in jsdom. */
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
    }
    if (rule.selectorText) {
      result.push({ selectorText: rule.selectorText, style: rule.style, wrapper: null });
    }
  }
  return result;
}

// Collect { sheet, owner } entries for every stylesheet in the document
// and inside every shadow root. owner is the shadow host element (or null
// for document-level sheets) so we know which clone scope to inject into.
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

// Build matchers for the configured-element list, used to gate whether a
// hover/active CSS rule should be rewritten. A rule like `.btn:hover` only
// becomes `.btn[data-percy-hover]` when at least one configured element
// matches `.btn`.
function buildConfiguredMatchers(ctx) {
  const config = ctx.pseudoClassEnabledElements;
  if (!config) return [];
  const matchers = [];
  for (const id of config.id || []) matchers.push({ type: 'id', value: id });
  for (const cls of config.className || []) matchers.push({ type: 'className', value: cls });
  for (const sel of config.selectors || []) matchers.push({ type: 'selector', value: sel });
  for (const xp of config.xpath || []) matchers.push({ type: 'xpath', value: xp });
  return matchers;
}

function isElementConfigured(element, matchers) {
  for (const matcher of matchers) {
    try {
      switch (matcher.type) {
        case 'id':
          if (element.id === matcher.value) return true;
          break;
        case 'className':
          if (element.classList?.contains(matcher.value)) return true;
          break;
        case 'selector':
          if (element.matches(matcher.value)) return true;
          break;
        case 'xpath':
          // xpath matchers can't be cheaply evaluated per-element here, so
          // we rely on the marking pass having stamped the element earlier.
          if (element.hasAttribute(PSEDUO_ELEMENT_MARKER_ATTR)) return true;
          break;
      }
    } catch (e) {
      // Invalid selector — skip
    }
  }
  return false;
}

// Extract every CSS rule that mentions an interactive pseudo-class, rewrite
// the pseudo to its data-attribute form, and inject the rewritten rules
// back into the clone. Document rules go to <head>; shadow root rules go to
// the corresponding clone shadow root.
function extractPseudoClassRules(ctx) {
  const sheetEntries = collectStyleSheets(ctx.dom);
  const rulesByOwner = new Map();
  const matchers = buildConfiguredMatchers(ctx);

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
      if (!selectorContainsPseudo(rule.selectorText, INTERACTIVE_PSEUDO_CLASSES)) continue;

      const hasConfigOnly = selectorContainsPseudo(rule.selectorText, CONFIG_ONLY_PSEUDO);
      const hasAutoDetect = selectorContainsPseudo(rule.selectorText, AUTO_DETECT_PSEUDO);

      // Pure hover/active rule with no configured elements: nothing to do.
      if (hasConfigOnly && !hasAutoDetect && matchers.length === 0) continue;

      // hover/active gating: rewrite only when at least one configured
      // element matches the selector with the pseudo stripped.
      if (hasConfigOnly) {
        const baseSelector = stripInteractivePseudo(rule.selectorText);
        let matchesConfigured = false;
        try {
          for (const el of ctx.dom.querySelectorAll(baseSelector)) {
            if (isElementConfigured(el, matchers)) {
              matchesConfigured = true;
              break;
            }
          }
        } catch (e) {
          // Stripped selector invalid (e.g. selector was `:hover` alone)
        }
        if (!matchesConfigured) continue;
      }

      const rewrittenSelector = rewritePseudoSelector(rule.selectorText);
      /* istanbul ignore if: defensive — selectorContainsPseudo and the boundary
         regexes are consistent, so a passed selector always rewrites to a new
         string. This guard exists in case a future pseudo addition breaks that
         invariant. */
      if (rewrittenSelector === rule.selectorText) continue;

      // Wrap with the original at-rule prelude when present so @media etc.
      // guards survive the rewrite.
      const cssText = `${rewrittenSelector} { ${rule.style.cssText} }`;
      const wrapped = rule.wrapper ? `${rule.wrapper} { ${cssText} }` : cssText;
      /* istanbul ignore else: rulesByOwner-already-set branch only fires with
         multiple stylesheets per owner; one-sheet fixtures are the norm. */
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
  if (!ctx.pseudoClassEnabledElements) {
    extractPseudoClassRules(ctx);
    return;
  }

  const elements = ctx.dom.querySelectorAll(`[${PSEDUO_ELEMENT_MARKER_ATTR}]`);
  if (elements.length === 0) return;

  const cssRules = [];
  for (const element of elements) {
    const percyElementId = element.getAttribute(PSEDUO_ELEMENT_MARKER_ATTR);
    const cloneElement = ctx.clone.querySelector(`[${PSEDUO_ELEMENT_MARKER_ATTR}="${percyElementId}"]`);

    if (!cloneElement) {
      ctx.warnings.add(`Element not found for pseudo-class serialization with percy-element-id: ${percyElementId}`);
      continue;
    }

    try {
      const computedStyles = window.getComputedStyle(element);
      const cssText = stylesToCSSText(computedStyles);
      cssRules.push(`[${PSEDUO_ELEMENT_MARKER_ATTR}="${percyElementId}"] { ${cssText} }`);
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

  extractPseudoClassRules(ctx);
}
