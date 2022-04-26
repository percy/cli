/**
 * Custom deep clone function that replaces Percy's current clone behavior.
 * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open 
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
 */
const deepClone = host => {
  let cloneNode = (node, parent) => {
    let walkTree = (nextn, nextp) => {
      while (nextn) {
        cloneNode(nextn, nextp);
        nextn = nextn.nextSibling;
      }
    };

    let clone = node.cloneNode();
    parent.appendChild(clone);

    if (node.shadowRoot) {
      if (clone.shadowRoot) {
        // it may be set up in a custom element's constructor
        clone.shadowRoot.innerHTML = '';
      } else {
        clone.attachShadow({
          mode: 'open'
        });
      }

      for (let sheet of node.shadowRoot.adoptedStyleSheets) {
        let cssText = Array.from(sheet.rules).map(rule => rule.cssText).join('\n');
        let style = document.createElement('style');
        style.appendChild(document.createTextNode(cssText));
        clone.shadowRoot.prepend(style);
      }
    }

    if (node.shadowRoot) {
      walkTree(node.shadowRoot.firstChild, clone.shadowRoot);
    }

    walkTree(node.firstChild, clone);
  };

  let fragment = document.createDocumentFragment();
  cloneNode(host, fragment);
  return fragment;
};


/**
 * Deep clone a document while also preserving shadow roots and converting adoptedStylesheets to <style> tags.
 */
const cloneNodeAndShadow = doc => {
  let mockDocument = deepClone(doc.documentElement);
  mockDocument.head = document.createDocumentFragment();
  mockDocument.documentElement = mockDocument.firstChild;
  return mockDocument;
};

/**
 * Use `getInnerHTML()` to serialize shadow dom as <template> tags. `innerHTML` and `outerHTML` don't do this. Buzzword: "declarative shadow dom"
 */
const getOuterHTML = docElement => {
  let innerHTML = docElement.getInnerHTML();
  docElement.textContent = '';
  return docElement.outerHTML.replace('</html>', `${innerHTML}</html>`);
};


export { cloneNodeAndShadow, getOuterHTML }