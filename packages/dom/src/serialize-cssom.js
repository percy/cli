// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  // no href, has a rulesheet, and isn't already in the DOM
  return !styleSheet.href && styleSheet.cssRules &&
    !styleSheet.ownerNode?.innerText.trim().length;
}

// Outputs in-memory CSSOM into their respective DOM nodes.
export default function serializeCSSOM(dom, clone) {
  for (let styleSheet of dom.styleSheets) {
    if (isCSSOM(styleSheet)) {
      let style = clone.createElement('style');

      style.type = 'text/css';
      style.setAttribute('data-percy-cssom-serialized', 'true');
      style.innerHTML = Array.from(styleSheet.cssRules)
        .reduce((prev, cssRule) => prev + cssRule.cssText, '');

      clone.head.appendChild(style);
    }
  }
}
