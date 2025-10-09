import { resourceFromText, styleSheetFromNode, handleErrors } from './utils';
import { uid } from './prepare-dom';

// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  // no href, has a rulesheet, and has an owner node
  return !styleSheet.href && styleSheet.cssRules && styleSheet.ownerNode;
}

// Returns false if any stylesheet rules do not match between two stylesheets
function styleSheetsMatch(sheetA, sheetB) {
  if (!sheetA || !sheetB) return false;
  const hasOwnAccessor = (obj, prop) => {
    if (!obj || typeof obj !== 'object') return false;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    return !!(desc && (typeof desc.get === 'function' || typeof desc.set === 'function'));
  };
  if (hasOwnAccessor(sheetA, 'cssRules') || hasOwnAccessor(sheetB, 'cssRules')) {
    return false;
  }

  if (!sheetA.cssRules || !sheetB.cssRules) return false;

  const lenA = sheetA.cssRules.length;
  const lenB = sheetB.cssRules.length;

  if (lenA !== lenB) return false;

  for (let i = 0; i < lenA; i++) {
    const ruleA = sheetA.cssRules[i] && sheetA.cssRules[i].cssText;
    const ruleB = sheetB.cssRules[i] && sheetB.cssRules[i].cssText;
    if (ruleA !== ruleB) return false;
  }

  return true;
}

function createStyleResource(styleSheet) {
  const styles = Array.from(styleSheet.cssRules)
    .map(cssRule => cssRule.cssText).join('\n');
  let resource = resourceFromText(uid(), 'text/css', styles);
  return resource;
}

export function serializeCSSOM(ctx) {
  let { dom, clone, resources, cache, warnings } = ctx;
  // in-memory CSSOM into their respective DOM nodes.
  let styleSheets = null;
  // catch error in case styleSheets property is not available (overwritten to throw error)
  try {
    styleSheets = dom.styleSheets;
  } catch {
    warnings.add('Skipping `styleSheets` as it is not supported.');
  }
  if (styleSheets) {
    for (let styleSheet of styleSheets) {
      if (isCSSOM(styleSheet)) {
        let styleId;
        let cloneOwnerNode;
        try {
          styleId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
          if (!styleId) continue;
          cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);
          if (styleSheetsMatch(styleSheet, styleSheetFromNode(cloneOwnerNode))) continue;
          let style = document.createElement('style');

          style.type = 'text/css';
          style.setAttribute('data-percy-element-id', styleId);
          style.setAttribute('data-percy-cssom-serialized', 'true');
          style.textContent = Array.from(styleSheet.cssRules)
            .map(cssRule => cssRule.cssText).join('\n');

          cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
          cloneOwnerNode.remove();
        } catch (err) {
          handleErrors(err, 'Error serializing stylesheet: ', cloneOwnerNode, {
            styleId: styleId
          });
        }
      } else if (styleSheet.href?.startsWith('blob:')) {
        try {
          const styleLink = document.createElement('link');
          styleLink.setAttribute('rel', 'stylesheet');
          let resource = createStyleResource(styleSheet);
          resources.add(resource);

          styleLink.setAttribute('data-percy-blob-stylesheets-serialized', 'true');
          styleLink.setAttribute('data-percy-serialized-attribute-href', resource.url);

          /* istanbul ignore next: tested, but coverage is stripped */
          if (clone.constructor.name === 'HTMLDocument' || clone.constructor.name === 'DocumentFragment') {
            // handle document and iframe
            clone.body.prepend(styleLink);
          } else if (clone.constructor.name === 'ShadowRoot') {
            clone.prepend(styleLink);
          }
        } catch (err) {
          handleErrors(err, 'Error serializing stylesheet from blob: ', null, {
            stylesheetHref: styleSheet.href
          });
        }
      }
    }
  }

  // clone Adopted Stylesheets
  // Regarding ordering of the adopted stylesheets - https://github.com/WICG/construct-stylesheets/issues/93
  /* istanbul ignore next: tested, but coverage is stripped */
  if (dom.adoptedStyleSheets) {
    for (let sheet of dom.adoptedStyleSheets) {
      const styleLink = document.createElement('link');
      styleLink.setAttribute('rel', 'stylesheet');

      if (!cache.has(sheet)) {
        let resource = createStyleResource(sheet);
        resources.add(resource);
        cache.set(sheet, resource.url);
      }
      styleLink.setAttribute('data-percy-adopted-stylesheets-serialized', 'true');
      styleLink.setAttribute('data-percy-serialized-attribute-href', cache.get(sheet));

      /* istanbul ignore next: tested, but coverage is stripped */
      if (clone.constructor.name === 'HTMLDocument' || clone.constructor.name === 'DocumentFragment') {
        // handle document and iframe
        // We are checking if we have multiple stylesheets present for the same clone or clone.body then we add
        // them in the same order in which we receive them.
        const lastLink = clone.body.querySelector('link[data-percy-adopted-stylesheets-serialized]:last-of-type');
        if (lastLink) {
          lastLink.after(styleLink);
        } else {
          clone.body.prepend(styleLink);
        }
      } else if (clone.constructor.name === 'ShadowRoot') {
        const lastLink = clone.querySelector('link[data-percy-adopted-stylesheets-serialized]:last-of-type');
        if (lastLink) {
          lastLink.after(styleLink);
        } else {
          clone.prepend(styleLink);
        }
      }
    }
  } else {
    warnings.add('Skipping `adoptedStyleSheets` as it is not supported.');
  }
}

export default serializeCSSOM;
