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
 * Sets up the document clone to mirror the result of Node.cloneNode() 
 * using the deep clone function able of cloning shadow dom
 */
const cloneNodeAndShadow = doc => {
  let clonedDocumentElementFragment = deepClone(doc.documentElement);
  clonedDocumentElementFragment.head = document.createDocumentFragment();
  clonedDocumentElementFragment.documentElement = clonedDocumentElementFragment.firstChild;
  return clonedDocumentElementFragment;
};

const customOuterHTML = docElement => {
  return `<html class="hydrated">${docElement.getInnerHTML()}</html>`;
};


export { cloneNodeAndShadow, customOuterHTML }