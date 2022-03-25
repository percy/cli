// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  // no href, has a rulesheet, and isn't already in the DOM
  return !styleSheet.href && styleSheet.cssRules &&
    !styleSheet.ownerNode?.innerText?.trim().length;
}

// Outputs in-memory CSSOM into their respective DOM nodes.
export function serializeCSSOM(dom, clone) {
  for (let styleSheet of dom.styleSheets) {
    if (isCSSOM(styleSheet)) {
      let style = clone.createElement('style');
      let styleId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
      let cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);

      style.type = 'text/css';
      style.setAttribute('data-percy-cssom-serialized', 'true');
      style.innerHTML = Array.from(styleSheet.cssRules)
        .reduce((prev, cssRule) => prev + cssRule.cssText, '');

      cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
    }
  }
}

export default serializeCSSOM;
