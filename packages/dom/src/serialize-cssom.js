import { resourceFromText } from './utils';
import { uid } from './prepare-dom';

// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  // no href, has a rulesheet, and has an owner node
  return !styleSheet.href && styleSheet.cssRules && styleSheet.ownerNode;
}

// Returns false if any stylesheet rules do not match between two stylesheets
function styleSheetsMatch(sheetA, sheetB) {
  for (let i = 0; i < sheetA.cssRules.length; i++) {
    let ruleA = sheetA.cssRules[i].cssText;
    let ruleB = sheetB.cssRules[i]?.cssText;
    if (ruleA !== ruleB) return false;
  }

  return true;
}

function styleSheetFromNode(node) {
  /* istanbul ignore if: sanity check */
  if (node.sheet) return node.sheet;
  /* istanbul ignore if: sanity check */
  if (node.constructor.name !== 'HTMLStyleElement') return;

  // Cloned style nodes inside don't have a sheet instance unless cloned along
  // with document; we get it by temporarily adding the rules to DOM
  const tempStyle = document.createElement('style');
  tempStyle.id = 'style-percy-helper';
  tempStyle.innerText = node.innerText;
  document.head.appendChild(tempStyle);
  const sheet = tempStyle.sheet;
  // Cleanup node
  tempStyle.remove();

  return sheet;
}

export function serializeCSSOM({ dom, clone, warnings, resources, cache }) {
  // in-memory CSSOM into their respective DOM nodes.
  for (let styleSheet of dom.styleSheets) {
    if (isCSSOM(styleSheet)) {
      let styleId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
      if (!styleId) {
        let attributes = Array.from(styleSheet.ownerNode.attributes).map(attr => `${attr.name}: ${attr.value}`);
        warnings.add(`stylesheet with attributes - [ ${attributes} ] - was not serialized`);
        continue;
      }
      let cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);
      if (styleSheetsMatch(styleSheet, styleSheetFromNode(cloneOwnerNode))) continue;
      let style = document.createElement('style');

      style.type = 'text/css';
      style.setAttribute('data-percy-element-id', styleId);
      style.setAttribute('data-percy-cssom-serialized', 'true');
      style.innerHTML = Array.from(styleSheet.cssRules)
        .map(cssRule => cssRule.cssText).join('\n');

      cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
      cloneOwnerNode.remove();
    }
  }

  // clone Adopted Stylesheets
  // Regarding ordering of the adopted stylesheets - https://github.com/WICG/construct-stylesheets/issues/93
  for (let sheet of dom.adoptedStyleSheets) {
    const styleLink = document.createElement('link');
    styleLink.setAttribute('rel', 'stylesheet');

    if (!cache.has(sheet)) {
      const styles = Array.from(sheet.cssRules)
        .map(cssRule => cssRule.cssText).join('\n');
      let resource = resourceFromText(uid(), 'text/css', styles);
      resources.add(resource);
      cache.set(sheet, resource.url);
    }
    styleLink.setAttribute('data-percy-serialized-attribute-href', cache.get(sheet));

    /* istanbul ignore next: tested, but coverage is stripped */
    if (clone.constructor.name === 'HTMLDocument' || clone.constructor.name === 'DocumentFragment') {
      // handle document and iframe
      clone.body.prepend(styleLink);
    } else if (clone.constructor.name === 'ShadowRoot') {
      clone.prepend(styleLink);
    }
  }
}

export default serializeCSSOM;
