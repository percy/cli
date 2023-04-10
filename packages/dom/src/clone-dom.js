/**
 * Custom deep clone function that replaces Percy's current clone behavior.
 * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
 */
import markElement from './prepare-dom';

/**
 * Deep clone a document while also preserving shadow roots
 * returns document fragment
 */
export function cloneNodeAndShadow({ dom, disableShadowDOM }) {
  // clones shadow DOM and light DOM for a given node
  let cloneNode = (node, parent) => {
    let walkTree = (nextn, nextp) => {
      while (nextn) {
        cloneNode(nextn, nextp);
        nextn = nextn.nextSibling;
      }
    };

    // mark the node before cloning
    markElement(node, disableShadowDOM);

    let clone = node.cloneNode();

    parent.appendChild(clone);

    // shallow clone should not contain children
    // these might get added due to DOM side effects
    if (clone.children) {
      for (const child of Array.from(clone.children)) {
        clone.removeChild(child);
      }
    }

    // clone shadow DOM
    if (node.shadowRoot && !disableShadowDOM) {
      // create shadowRoot
      if (clone.shadowRoot) {
        // it may be set up in a custom element's constructor
        clone.shadowRoot.innerHTML = '';
      } else {
        clone.attachShadow({
          mode: 'open'
        });
      }
      // clone dom elements
      walkTree(node.shadowRoot.firstChild, clone.shadowRoot);
    }

    // clone light DOM
    walkTree(node.firstChild, clone);
  };

  let fragment = dom.createDocumentFragment();
  cloneNode(dom.documentElement, fragment);
  fragment.documentElement = fragment.firstChild;
  fragment.head = fragment.querySelector('head');
  fragment.body = fragment.querySelector('body');
  return fragment;
};

/**
 * Use `getInnerHTML()` to serialize shadow dom as <template> tags. `innerHTML` and `outerHTML` don't do this. Buzzword: "declarative shadow dom"
 */
export function getOuterHTML(docElement) {
  // firefox doesn't serialize shadow DOM, we're awaiting API's by firefox to become ready and are not polyfilling it.
  if (!docElement.getInnerHTML) { return docElement.outerHTML; }
  // chromium gives us declarative shadow DOM serialization API
  let innerHTML = docElement.getInnerHTML({ includeShadowRoots: true });
  docElement.textContent = '';
  return docElement.outerHTML.replace('</html>', `${innerHTML}</html>`);
};
