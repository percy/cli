/* global XPathResult */

// Process pseudo-class enabled elements by capturing their pseudo-class styles
// and applying them as inline styles with !important

import { uid } from './prepare-dom';

const PSEDUO_ELEMENT_MARKER_ATTR = 'data-percy-pseudo-element-id';
function markElementIfNeeded(element, markWithId) {
  if (markWithId && !element.getAttribute(PSEDUO_ELEMENT_MARKER_ATTR)) {
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

      markElementIfNeeded(element, markWithId);
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
      markElementIfNeeded(element, markWithId);
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

        markElementIfNeeded(element, markWithId);
      } catch (err) {
        console.warn(`Invalid XPath expression "${xpathExpression}". Error: ${err.message}`);
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
  if (!config) return;
  getElementsToProcess(ctx, config, true);
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
 * Process pseudo-class elements and add percy-pseudo-class CSS
 * @param {Object} ctx - Serialization context
 */
export function serializePseudoClasses(ctx) {
  if (!ctx.pseudoClassEnabledElements) {
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
}
