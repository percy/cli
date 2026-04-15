/* global XPathResult */

// Process pseudo-class enabled elements by capturing their pseudo-class styles
// and applying them as inline styles with !important

import { uid } from './prepare-dom';

const PSEDUO_ELEMENT_MARKER_ATTR = 'data-percy-pseudo-element-id';
const POPOVER_OPEN_ATTR = 'data-percy-popover-open';

// Data attributes for interactive state marking
const FOCUS_ATTR = 'data-percy-focus';
const CHECKED_ATTR = 'data-percy-checked';
const DISABLED_ATTR = 'data-percy-disabled';

// Pseudo-class selectors we look for in CSS rules
const INTERACTIVE_PSEUDO_CLASSES = [':focus', ':checked', ':disabled', ':hover', ':active'];

// Map pseudo-classes to their data-attribute replacements
const PSEUDO_TO_ATTR = {
  ':focus': '[data-percy-focus]',
  ':checked': '[data-percy-checked]',
  ':disabled': '[data-percy-disabled]',
  ':hover': '[data-percy-hover]',
  ':active': '[data-percy-active]'
};

function isPopoverOpen(ctx, element) {
  try {
    return element.matches(':popover-open');
  } catch (err) {
    ctx.warnings.add('Browser does not support :popover-open pseudo-class.');
    return false;
  }
}

function safeMatches(element, selector) {
  try {
    return element.matches(selector);
  } catch (e) {
    return false;
  }
}

function markElementIfNeeded(ctx, element, markWithId) {
  if (!markWithId) return;

  if (element.hasAttribute('popover') && isPopoverOpen(ctx, element) && !element.hasAttribute(POPOVER_OPEN_ATTR)) {
    element.setAttribute(POPOVER_OPEN_ATTR, 'true');
  }

  // Mark interactive states: focus
  if (ctx._focusedElementId) {
    let id = element.getAttribute('data-percy-element-id');
    if (id && id === ctx._focusedElementId && !element.hasAttribute(FOCUS_ATTR)) {
      element.setAttribute(FOCUS_ATTR, 'true');
    }
  }
  if (safeMatches(element, ':focus') && !element.hasAttribute(FOCUS_ATTR)) {
    element.setAttribute(FOCUS_ATTR, 'true');
  }

  // Mark interactive states: checked
  if (safeMatches(element, ':checked') && !element.hasAttribute(CHECKED_ATTR)) {
    element.setAttribute(CHECKED_ATTR, 'true');
  }

  // Mark interactive states: disabled
  if (safeMatches(element, ':disabled') && !element.hasAttribute(DISABLED_ATTR)) {
    element.setAttribute(DISABLED_ATTR, 'true');
  }

  if (!element.getAttribute(PSEDUO_ELEMENT_MARKER_ATTR)) {
    element.setAttribute(PSEDUO_ELEMENT_MARKER_ATTR, uid());
  }
}

/**
 * Get all elements matching the pseudoClassEnabledElements configuration
 * @param {Document} dom - The document to search
 * @param {Object} config - Configuration with id, className, and xpath arrays
 * @param {boolean} markWithId - Whether to mark elements with PSEDUO_ELEMENT_MARKER_ATTR
 * @returns {Array} Array of elements found
 */
export function getElementsToProcess(ctx, config, markWithId = false) {
  const { dom } = ctx;
  const elements = [];

  if (config.id && Array.isArray(config.id)) {
    for (const id of config.id) {
      const element = dom.getElementById(id);
      if (!element) {
        ctx.warnings.add(`No element found with ID: ${id} for pseudo-class serialization`);
        continue;
      }

      markElementIfNeeded(ctx, element, markWithId);
      elements.push(element);
    }
  }

  // Process only first match per class name
  if (config.className && Array.isArray(config.className)) {
    for (const className of config.className) {
      const elementCollection = dom.getElementsByClassName(className);
      if (!elementCollection.length) {
        ctx.warnings.add(`No element found with class name: ${className} for pseudo-class serialization`);
        continue;
      }

      const element = elementCollection[0];
      markElementIfNeeded(ctx, element, markWithId);
      elements.push(element);
    }
  }

  if (config.xpath && Array.isArray(config.xpath)) {
    for (const xpathExpression of config.xpath) {
      try {
        const element = dom.evaluate(
          xpathExpression,
          dom,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;

        if (!element) {
          ctx.warnings.add(`No element found for XPath: ${xpathExpression} for pseudo-class serialization`);
          continue;
        }

        markElementIfNeeded(ctx, element, markWithId);
      } catch (err) {
        ctx.warnings.add(`Invalid XPath expression "${xpathExpression}" for pseudo-class serialization. Error: ${err.message}`);
        console.warn(`Invalid XPath expression "${xpathExpression}". Error: ${err.message}`);
      }
    }
  }

  if (config.selectors && Array.isArray(config.selectors)) {
    for (const selector of config.selectors) {
      try {
        const matched = Array.from(dom.querySelectorAll(selector));

        if (!matched.length) {
          ctx.warnings.add(`No element found for selector: ${selector} for pseudo-class serialization`);
          continue;
        }

        matched.forEach((el) => {
          markElementIfNeeded(ctx, el, markWithId);
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

/**
 * Mark pseudo-class enabled elements with data-percy-element-id before cloning
 * This must be called before the DOM is cloned
 * @param {Document} dom - The document to mark
 * @param {Object} config - Configuration with id and xpath arrays
 */
export function markPseudoClassElements(ctx, config) {
  // Capture which element is focused before cloning steals focus.
  // Traverse into shadow roots to find the deepest focused element,
  // since document.activeElement only returns the shadow host.
  ctx._focusedElementId = null;
  let focused = ctx.dom.activeElement;
  while (focused?.shadowRoot?.activeElement) {
    focused = focused.shadowRoot.activeElement;
  }
  if (focused && focused !== ctx.dom.body && focused !== ctx.dom.documentElement) {
    let id = focused.getAttribute('data-percy-element-id');
    if (id) ctx._focusedElementId = id;
  }

  // Mark all elements in interactive states (focus/checked/disabled)
  markInteractiveStatesInRoot(ctx, ctx.dom);

  if (!config) return;
  getElementsToProcess(ctx, config, true);
}

/**
 * Walk the DOM (including shadow roots) to mark elements in interactive states.
 * Runs on ALL elements, not just those in pseudoClassEnabledElements config.
 */
function markInteractiveStatesInRoot(ctx, root) {
  // Mark focused element by ID (captured from document.activeElement before cloning)
  if (ctx._focusedElementId && root.querySelector) {
    let focusedEl = root.querySelector(`[data-percy-element-id="${ctx._focusedElementId}"]`);
    if (focusedEl && !focusedEl.hasAttribute(FOCUS_ATTR)) {
      focusedEl.setAttribute(FOCUS_ATTR, 'true');
    }
  }

  // Also mark activeElement directly if it's within this root and not yet marked.
  // This covers elements that don't have data-percy-element-id yet.
  // Traverse shadow roots to find the deepest focused element.
  let active = ctx.dom.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  if (active && active !== ctx.dom.body && active !== ctx.dom.documentElement &&
      active.hasAttribute && !active.hasAttribute(FOCUS_ATTR)) {
    active.setAttribute(FOCUS_ATTR, 'true');
  }

  // Mark :checked elements
  let checkedEls = queryShadowAll(root, ':checked');
  for (let el of checkedEls) {
    if (!el.hasAttribute(CHECKED_ATTR)) {
      el.setAttribute(CHECKED_ATTR, 'true');
    }
  }

  // Mark :disabled elements
  let disabledEls = queryShadowAll(root, ':disabled');
  for (let el of disabledEls) {
    if (!el.hasAttribute(DISABLED_ATTR)) {
      el.setAttribute(DISABLED_ATTR, 'true');
    }
  }
}

/**
 * Convert CSSStyleDeclaration to CSS text with !important declarations
 * @param {CSSStyleDeclaration} styles - Computed style declaration
 * @returns {string} CSS text
 */
function stylesToCSSText(styles) {
  const cssProperties = [];
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    const value = styles.getPropertyValue(property);
    cssProperties.push(`${property}: ${value} !important;`);
  }

  return cssProperties.join(' ');
}

/**
 * Recursively walk shadow roots to find elements matching a selector
 */
function queryShadowAll(root, selector) {
  let results = [];
  try {
    results = [...root.querySelectorAll(selector)];
  } catch (e) {
    // Some selectors may not be supported or querySelectorAll unavailable
    return results;
  }
  try {
    let hosts = root.querySelectorAll('[data-percy-shadow-host]');
    for (let host of hosts) {
      let shadow = host.shadowRoot || window.__percyClosedShadowRoots?.get(host);
      if (shadow) results.push(...queryShadowAll(shadow, selector));
    }
  } catch (e) {
    // Shadow traversal may fail
  }
  return results;
}

/**
 * Recursively walk CSS rules, yielding style rules from nested @media/@layer blocks
 */
function walkCSSRules(ruleList, depth) {
  depth = depth || 0;
  let result = [];
  for (let i = 0; i < ruleList.length; i++) {
    let rule = ruleList[i];
    let hasNested = !!(rule.cssRules && rule.cssRules.length);
    if (hasNested) {
      let nested = walkCSSRules(rule.cssRules, depth + 1);
      for (let j = 0; j < nested.length; j++) result.push(nested[j]);
    }
    if (rule.selectorText) result.push(rule);
  }
  return result;
}

/**
 * Check if a selector text contains any interactive pseudo-class
 */
function containsInteractivePseudo(selectorText) {
  return INTERACTIVE_PSEUDO_CLASSES.some(pc => selectorText.includes(pc));
}

/**
 * Rewrite pseudo-class selectors in a selector string to use data attributes
 */
function rewritePseudoSelector(selectorText) {
  let rewritten = selectorText;
  for (let [pseudo, attr] of Object.entries(PSEUDO_TO_ATTR)) {
    // Use a regex that matches the pseudo-class not followed by a hyphen (to avoid :focus-within etc.)
    let escaped = pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regex = new RegExp(escaped + '(?![-\\w])', 'g');
    rewritten = rewritten.replace(regex, attr);
  }
  return rewritten;
}

/**
 * Collect all stylesheets from a document, including shadow roots
 */
function collectStyleSheets(doc, owner = null) {
  // Returns array of { sheet, owner } where owner is the shadow host element
  // (null for document-level sheets). This lets us inject rewritten rules
  // back into the correct shadow root clone.
  let entries = [];
  try {
    for (let sheet of doc.styleSheets) {
      entries.push({ sheet, owner });
    }
  } catch (e) {
    // May fail in some contexts
  }
  // Also collect from shadow roots
  let hosts = doc.querySelectorAll ? doc.querySelectorAll('[data-percy-shadow-host]') : [];
  for (let host of hosts) {
    let shadow = host.shadowRoot || window.__percyClosedShadowRoots?.get(host);
    if (shadow) {
      try {
        if (shadow.styleSheets) {
          for (let sheet of shadow.styleSheets) {
            entries.push({ sheet, owner: host });
          }
        }
      } catch (e) {
        // ignore
      }
      entries = entries.concat(collectStyleSheets(shadow, host));
    }
  }
  return entries;
}

/**
 * Determine which pseudo-classes in a selector are "auto-detect" (focus/checked/disabled)
 * vs. "config-only" (hover/active)
 */
function selectorHasConfigOnlyPseudo(selectorText) {
  return selectorText.includes(':hover') || selectorText.includes(':active');
}

function selectorHasAutoDetectPseudo(selectorText) {
  return selectorText.includes(':focus') || selectorText.includes(':checked') || selectorText.includes(':disabled');
}

/**
 * Extract CSS rules with interactive pseudo-classes and rewrite them
 * to use data-percy-* attribute selectors, then inject into the clone.
 * @param {Object} ctx - Serialization context
 */
function extractPseudoClassRules(ctx) {
  let sheetEntries = collectStyleSheets(ctx.dom);
  // Group rewritten rules by their owner (null = document, element = shadow host)
  let rulesByOwner = new Map();

  // Build a set of configured element selectors for hover/active matching
  let configuredSelectors = buildConfiguredSelectors(ctx);

  for (let { sheet, owner } of sheetEntries) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      // Cross-origin stylesheet, skip
      continue;
    }
    if (!rules) continue;

    for (let rule of walkCSSRules(rules)) {
      if (!containsInteractivePseudo(rule.selectorText)) continue;

      let selectorText = rule.selectorText;
      let hasConfigOnly = selectorHasConfigOnlyPseudo(selectorText);
      let hasAutoDetect = selectorHasAutoDetectPseudo(selectorText);

      // If selector only has hover/active and no configured elements, skip
      if (hasConfigOnly && !hasAutoDetect && configuredSelectors.length === 0) {
        continue;
      }

      // If selector has hover/active, check if the base selector matches any configured element
      if (hasConfigOnly) {
        let baseSelector = selectorText;
        for (let pseudo of INTERACTIVE_PSEUDO_CLASSES) {
          let escaped = pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          baseSelector = baseSelector.replace(new RegExp(escaped + '(?![-\\w])', 'g'), '');
        }
        // Check if any configured element matches this base selector
        let matchesConfigured = false;
        try {
          let matched = ctx.dom.querySelectorAll(baseSelector);
          for (let el of matched) {
            if (isElementConfigured(el, configuredSelectors)) {
              matchesConfigured = true;
              break;
            }
          }
        } catch (e) {
          // Invalid base selector after stripping pseudo-classes
        }
        if (!matchesConfigured) continue;
      }

      let rewrittenSelector = rewritePseudoSelector(selectorText);
      if (rewrittenSelector !== selectorText) {
        if (!rulesByOwner.has(owner)) rulesByOwner.set(owner, []);
        rulesByOwner.get(owner).push(`${rewrittenSelector} { ${rule.style.cssText} }`);
      }
    }
  }

  // Inject rewritten rules into the correct location in the clone
  for (let [owner, rewrittenRules] of rulesByOwner) {
    let styleElement = ctx.clone.createElement
      ? ctx.clone.createElement('style')
      : ctx.dom.createElement('style');
    styleElement.setAttribute('data-percy-interactive-states', 'true');
    styleElement.textContent = rewrittenRules.join('\n');

    if (owner === null) {
      // Document-level rules — inject into <head>
      let head = ctx.clone.head || ctx.clone.querySelector('head');
      if (head) head.appendChild(styleElement);
    } else {
      // Shadow DOM rules — inject into the corresponding shadow root clone
      let percyId = owner.getAttribute('data-percy-element-id');
      let cloneHost = ctx.clone.querySelector(`[data-percy-element-id="${percyId}"]`);
      if (cloneHost?.shadowRoot) {
        cloneHost.shadowRoot.appendChild(styleElement);
      }
    }
  }
}

/**
 * Build a list of selectors/matchers from the pseudoClassEnabledElements config
 * for matching hover/active elements
 */
function buildConfiguredSelectors(ctx) {
  let config = ctx.pseudoClassEnabledElements;
  if (!config) return [];

  let matchers = [];

  if (config.id && Array.isArray(config.id)) {
    for (let id of config.id) {
      matchers.push({ type: 'id', value: id });
    }
  }
  if (config.className && Array.isArray(config.className)) {
    for (let className of config.className) {
      matchers.push({ type: 'className', value: className });
    }
  }
  if (config.selectors && Array.isArray(config.selectors)) {
    for (let sel of config.selectors) {
      matchers.push({ type: 'selector', value: sel });
    }
  }
  if (config.xpath && Array.isArray(config.xpath)) {
    for (let xpath of config.xpath) {
      matchers.push({ type: 'xpath', value: xpath });
    }
  }

  return matchers;
}

/**
 * Check if an element matches any of the configured selectors
 */
function isElementConfigured(element, matchers) {
  for (let matcher of matchers) {
    try {
      switch (matcher.type) {
        case 'id':
          if (element.id === matcher.value) return true;
          break;
        case 'className':
          if (element.classList && element.classList.contains(matcher.value)) return true;
          break;
        case 'selector':
          if (element.matches(matcher.value)) return true;
          break;
        case 'xpath':
          // For xpath, we rely on the element already being marked
          if (element.hasAttribute(PSEDUO_ELEMENT_MARKER_ATTR)) return true;
          break;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return false;
}

/**
 * Collect all <style> elements from a root and its shadow roots recursively
 */
function collectStyleElements(root) {
  let styles = Array.from(root.querySelectorAll('style'));
  // Also collect from shadow roots
  let hosts = root.querySelectorAll('[data-percy-shadow-host]');
  for (let host of hosts) {
    if (host.shadowRoot) {
      styles = styles.concat(collectStyleElements(host.shadowRoot));
    }
  }
  return styles;
}

/**
 * Rewrite :state() and legacy :--state CSS selectors to attribute selectors
 * that match the data-percy-custom-state attribute set during cloning.
 * @param {Object} ctx - Serialization context
 */
export function rewriteCustomStateCSS(ctx) {
  let styleElements = collectStyleElements(ctx.clone);
  let stateNames = new Set();

  for (let style of styleElements) {
    let css = style.textContent;
    if (!css) continue;

    let modified = css;
    // Collect state names while replacing :state(X) with [data-percy-custom-state~="X"]
    modified = modified.replace(/:state\(([^)]+)\)/g, (_, name) => {
      stateNames.add(name);
      return `[data-percy-custom-state~="${name}"]`;
    });
    // Replace legacy :--X (dashed-ident, Chrome 90-124) with [data-percy-custom-state~="X"]
    modified = modified.replace(/:--([a-zA-Z][\w-]*)/g, (_, name) => {
      stateNames.add(name);
      return `[data-percy-custom-state~="${name}"]`;
    });

    if (modified !== css) {
      style.textContent = modified;
    }
  }

  // If clone-dom.js didn't set data-percy-custom-state (SDK path where preflight didn't run),
  // detect states by testing elements against :state() using element.matches()
  if (stateNames.size > 0) {
    addCustomStateAttributes(ctx, stateNames);
  }
}

/**
 * Try matching an element against :state(name) and legacy :--name syntax.
 * Returns true if either matches.
 */
function safeMatchesState(el, name) {
  let selectors = [`:state(${name})`, `:--${name}`];
  for (let sel of selectors) {
    try {
      if (el.matches(sel)) return true;
    } catch (e) {
      // selector syntax not supported in this browser
    }
  }
  return false;
}

/**
 * For each custom element in the DOM, test if it matches any :state() pseudo-class
 * and add data-percy-custom-state attribute to the corresponding clone element.
 * This is the fallback path when preflight/WeakMap is unavailable (SDK path).
 */
function addCustomStateAttributes(ctx, stateNames) {
  let customElements = queryShadowAll(ctx.dom, '*');
  customElements = customElements.filter(el => el.tagName?.includes('-'));

  for (let el of customElements) {
    // Skip if clone-dom.js already set the attribute (preflight path)
    let percyId = el.getAttribute('data-percy-element-id');
    if (!percyId) continue;

    let cloneEl = ctx.clone.querySelector(`[data-percy-element-id="${percyId}"]`);
    if (!cloneEl || cloneEl.hasAttribute('data-percy-custom-state')) continue;

    let matchedStates = [];
    for (let name of stateNames) {
      let matched = safeMatchesState(el, name);
      if (matched) matchedStates.push(name.replace(/["\\}\]]/g, '\\$&'));
    }

    if (matchedStates.length > 0) {
      cloneEl.setAttribute('data-percy-custom-state', matchedStates.join(' '));
    }
  }
}

export function serializePseudoClasses(ctx) {
  if (!ctx.pseudoClassEnabledElements) {
    // Even without config, extract auto-detect pseudo-class CSS rules (focus/checked/disabled)
    extractPseudoClassRules(ctx);
    return;
  }

  const elements = ctx.dom.querySelectorAll(`[${PSEDUO_ELEMENT_MARKER_ATTR}]`);
  if (elements.length === 0) {
    return;
  }

  const cssRules = [];

  for (const element of elements) {
    const percyElementId = element.getAttribute(PSEDUO_ELEMENT_MARKER_ATTR);

    const cloneElement = ctx.clone.querySelector(`[${PSEDUO_ELEMENT_MARKER_ATTR}="${percyElementId}"]`);

    if (!cloneElement) {
      ctx.warnings.add(`Element not found for pseudo-class serialization with percy-element-id: ${percyElementId}`);
      continue;
    }

    try {
      // Get all computed styles including pseudo-classes
      const computedStyles = window.getComputedStyle(element);
      const cssText = stylesToCSSText(computedStyles);
      const selector = `[${PSEDUO_ELEMENT_MARKER_ATTR}="${percyElementId}"]`;
      cssRules.push(`${selector} { ${cssText} }`);
    } catch (err) {
      console.warn('Could not get computed styles for element', element, err);
    }
  }

  // Inject CSS into cloned document
  if (cssRules.length > 0) {
    const styleElement = ctx.dom.createElement('style');
    styleElement.setAttribute('data-percy-pseudo-class-styles', 'true');
    styleElement.textContent = cssRules.join('\n');

    const head = ctx.clone.head || ctx.clone.querySelector('head');
    if (head) {
      head.appendChild(styleElement);
    } else {
      ctx.warnings.add('Could not inject pseudo-class styles: no <head> element found');
    }
  }

  // Extract and rewrite interactive pseudo-class CSS rules
  extractPseudoClassRules(ctx);
}
