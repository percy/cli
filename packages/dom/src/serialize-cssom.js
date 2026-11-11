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

  // Only treat as mismatch when the live sheet has MORE rules than the
  // clone — that signals rules were added via CSSOM (insertRule/adopted)
  // and must be re-serialized. When lenA <= lenB, the clone already
  // contains all of the live rules; trust the clone's source text so that
  // CSS shorthand semantics (e.g. `all: initial; border-radius: var(...)`)
  // survive — `cssRule.cssText` expansion appends logical longhands like
  // `border-end-end-radius: initial` AFTER the shorthand, which silently
  // overrides it and breaks the cascade.
  if (lenA > lenB) return false;

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
  let { dom, clone, resources, warnings, ignoreStyleSheetSerializationErrors, styleSheetClones } = ctx;
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
          if (!styleId && ignoreStyleSheetSerializationErrors) continue;
          cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);
          if (!cloneOwnerNode) continue; // Skip if element not found in clone
          if (styleSheetsMatch(styleSheet, styleSheetFromNode(cloneOwnerNode))) continue;
          let style = document.createElement('style');

          style.type = 'text/css';
          style.setAttribute('data-percy-element-id', styleId);
          style.setAttribute('data-percy-cssom-serialized', 'true');
          style.textContent = Array.from(styleSheet.cssRules)
            .map(cssRule => cssRule.cssText).join('\n');

          cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
          cloneOwnerNode.remove();
          styleSheetClones?.set(styleSheet.ownerNode, style);
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

  serializeAdoptedStyleSheets(ctx);
}

// Serializes constructed stylesheets adopted by a document or shadow root into <link> tags
// backed by CSS resources. Unlike the rest of the CSSOM, this also runs when JavaScript is
// enabled: adopted sheets have no DOM representation, so without this they are lost whenever
// the page's own JS doesn't re-adopt them at render time.
export function serializeAdoptedStyleSheets(ctx) {
  let { dom, clone, resources, cache, warnings } = ctx;
  // Regarding ordering of the adopted stylesheets - https://github.com/WICG/construct-stylesheets/issues/93
  /* istanbul ignore next: tested, but coverage is stripped */
  if (dom.adoptedStyleSheets) {
    // Document and iframe clones are fragments carrying body/head/documentElement references; links
    // go at the start of the body, else the head, else inside documentElement (the only part that is
    // serialized). A shadow root has none of these and takes the links directly.
    let container = clone && ['HTMLDocument', 'DocumentFragment', 'ShadowRoot'].includes(clone.constructor.name)
      ? (clone.body || clone.head || clone.documentElement || clone)
      : null;
    // each link goes after the one before it, so the links keep the order the sheets were adopted in
    let prevLink = null;

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
      // a constructed sheet can carry a media condition (new CSSStyleSheet({ media })); keep it
      if (sheet.media?.mediaText) styleLink.setAttribute('media', sheet.media.mediaText);

      if (!container) continue;
      if (prevLink) {
        prevLink.after(styleLink);
      } else {
        container.prepend(styleLink);
      }
      prevLink = styleLink;
    }
  } else {
    warnings.add('Skipping `adoptedStyleSheets` as it is not supported.');
  }
}

export default serializeCSSOM;
