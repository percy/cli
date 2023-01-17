/**
 * Custom deep clone function that replaces Percy's current clone behavior.
 * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
 */
import markElement from './prepare-dom';

// returns document fragment
const deepClone = (host, disableShadowDom = false) => {
  // clones shadow DOM and light DOM for a given node
  let cloneNode = (node, parent) => {
    let walkTree = (nextn, nextp) => {
      while (nextn) {
        cloneNode(nextn, nextp);
        nextn = nextn.nextSibling;
      }
    };

    // mark the node before cloning
    markElement(node, disableShadowDom);

    let clone = node.cloneNode();

    parent.appendChild(clone);

    // clone shadow DOM
    if (node.shadowRoot && !disableShadowDom) {
      // create shadowRoot
      if (clone.shadowRoot) {
        // it may be set up in a custom element's constructor
        clone.shadowRoot.innerHTML = '';
      } else {
        clone.attachShadow({
          mode: 'open'
        });
      }

      // clone stylesheets in shadowRoot
      for (let sheet of node.shadowRoot.adoptedStyleSheets) {
        let cssText = Array.from(sheet.rules).map(rule => rule.cssText).join('\n');
        let style = document.createElement('style');
        style.appendChild(document.createTextNode(cssText));
        clone.shadowRoot.prepend(style);
      }

      // clone dom elements
      walkTree(node.shadowRoot.firstChild, clone.shadowRoot);
    }

    // clone light DOM
    walkTree(node.firstChild, clone);
  };

  let fragment = document.createDocumentFragment();
  cloneNode(host, fragment);
  return fragment;
};

/**
 * Deep clone a document while also preserving shadow roots and converting adoptedStylesheets to <style> tags.
 */
const cloneNodeAndShadow = (ctx) => {
  let cloneDocumentElementFragment = deepClone(ctx.dom.documentElement, ctx.disableShadowDom);
  // TODO: we're not properly appending documentElement (html node) in the clone document, this can cause side effects in original document.
  // convert document fragment to document object
  let cloneDocument = ctx.dom.cloneNode();
  // dissolve document fragment in clone document
  cloneDocument.appendChild(cloneDocumentElementFragment);
  return cloneDocument;
};

/**
 * Use `getInnerHTML()` to serialize shadow dom as <template> tags. `innerHTML` and `outerHTML` don't do this. Buzzword: "declarative shadow dom"
 */
const getOuterHTML = (docElement) => {
  // firefox doesn't serialize shadow DOM, we're awaiting API's by firefox to become ready and are not polyfilling it.
  if (!docElement.getInnerHTML) { return docElement.outerHTML; }
  // chromium gives us declarative shadow DOM serialization API
  let innerHTML = docElement.getInnerHTML({ includeShadowRoots: true });
  docElement.textContent = '';
  return docElement.outerHTML.replace('</html>', `${innerHTML}</html>`);
};

export { cloneNodeAndShadow, getOuterHTML };
