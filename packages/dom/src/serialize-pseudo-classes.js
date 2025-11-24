// Process pseudo-class enabled elements by capturing their pseudo-class styles
// and applying them as inline styles with !important

import { uid } from './prepare-dom';

/**
 * Get all elements matching the pseudoClassEnabledElements configuration
 * @param {Document} dom - The document to search
 * @param {Object} config - Configuration with id and xpath arrays
 * @returns {Array} Array of elements to process
 */
function getElementsToProcess(dom, config) {
  if (!config || (!config.id && !config.xpath)) {
    return [];
  }

  const elements = [];

  // Process ID selectors
  if (config.id && Array.isArray(config.id)) {
    for (const id of config.id) {
      const element = dom.getElementById(id);
      if (element) {
        elements.push(element);
      }
    }
  }

  // Process XPath selectors
  if (config.xpath && Array.isArray(config.xpath)) {
    for (const xpathExpression of config.xpath) {
      try {
        const result = dom.evaluate(
          xpathExpression,
          dom,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        for (let i = 0; i < result.snapshotLength; i++) {
          elements.push(result.snapshotItem(i));
        }
      } catch (err) {
        console.warn(`Invalid XPath expression: ${xpathExpression}`, err);
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
export function markPseudoClassElements(dom, config) {
  if (!config || (!config.id && !config.xpath)) {
    return;
  }

  // Process ID selectors
  if (config.id && Array.isArray(config.id)) {
    for (const id of config.id) {
      const element = dom.getElementById(id);
      if (element && !element.getAttribute('data-percy-element-id')) {
        element.setAttribute('data-percy-element-id', uid());
      }
    }
  }

  // Process XPath selectors
  if (config.xpath && Array.isArray(config.xpath)) {
    for (const xpathExpression of config.xpath) {
      try {
        const result = dom.evaluate(
          xpathExpression,
          dom,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        for (let i = 0; i < result.snapshotLength; i++) {
          const element = result.snapshotItem(i);
          if (!element.getAttribute('data-percy-element-id')) {
            element.setAttribute('data-percy-element-id', uid());
          }
        }
      } catch (err) {
        console.warn(`Invalid XPath expression: ${xpathExpression}`, err);
      }
    }
  }
}


/**
 * Convert CSSStyleDeclaration to CSS text with !important declarations
 * @param {CSSStyleDeclaration} styles - Computed style declaration
 * @returns {string} CSS text
 */
function stylesToCSSText(styles) {
  if (!styles || styles.length === 0) {
    return '';
  }

  const cssProperties = [];
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    const value = styles.getPropertyValue(property);
    if (value) {
      cssProperties.push(`${property}: ${value} !important;`);
    }
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

  const elements = getElementsToProcess(ctx.dom, ctx.pseudoClassEnabledElements);
  
  if (elements.length === 0) {
    return;
  }

  const cssRules = [];

  for (const element of elements) {
    const percyElementId = element.getAttribute('data-percy-element-id');
    
    if (!percyElementId) {
      continue;
    }

    // Get corresponding clone element
    const cloneElement = ctx.clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    
    if (!cloneElement) {
      continue;
    }

    try {
      // Get all computed styles including pseudo-classes
      const computedStyles = window.getComputedStyle(element);
      const cssText = stylesToCSSText(computedStyles);
      
      if (cssText) {
        const selector = `[data-percy-element-id="${percyElementId}"]`;
        cssRules.push(`${selector} { ${cssText} }`);
      }
    } catch (err) {
      console.warn(`Could not get computed styles for element`, element, err);
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
