/**
 * Custom deep clone function that replaces Percy's current clone behavior.
 * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
 */
import markElement from './prepare-dom';
import applyElementTransformations from './transform-dom';
import serializeBase64 from './serialize-base64';
import { handleErrors } from './utils';

/**
 * Deep clone a document while also preserving shadow roots
 * returns document fragment
 */

const ignoreTags = ['NOSCRIPT'];

export function cloneNodeAndShadow(ctx) {
  let { dom, disableShadowDOM, resources } = ctx;
  // clones shadow DOM and light DOM for a given node
  let cloneNode = (node, parent) => {
    try {
      let walkTree = (nextn, nextp) => {
        while (nextn) {
          if (!ignoreTags.includes(nextn.nodeName)) {
            cloneNode(nextn, nextp);
          }
          nextn = nextn.nextSibling;
        }
      };

      // mark the node before cloning
      markElement(node, disableShadowDOM);

      let clone = node.cloneNode();

      // We apply any element transformations here to avoid another treeWalk
      applyElementTransformations(clone);

      serializeBase64(clone, resources);

      parent.appendChild(clone);

      // shallow clone should not contain children
      if (clone.children) {
        Array.from(clone.children).forEach(child => clone.removeChild(child));
      }

      // clone shadow DOM
      if (node.shadowRoot && !disableShadowDOM) {
        // create shadowRoot
        if (clone.shadowRoot) {
          // it may be set up in a custom element's constructor
          clone.shadowRoot.innerHTML = '';
        } else {
          clone.attachShadow({
            mode: 'open',
            serializable: true
          });
        }
        // clone dom elements
        walkTree(node.shadowRoot.firstChild, clone.shadowRoot);
      }

      // clone light DOM
      walkTree(node.firstChild, clone);
    } catch (err) {
      if (!err.handled) {
        handleErrors(err, 'Error cloning node: ', node);
      } else {
        throw err;
      }
    }
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
  // All major browsers in latest versions supports getHTML API to get serialized DOM
  // https://developer.mozilla.org/en-US/docs/Web/API/Element/getHTML
  // firefox doesn't serialize shadow DOM, we're awaiting API's by firefox to become ready and are not polyfilling it.
  if (!docElement.getHTML) { return docElement.outerHTML; }
  // chromium gives us declarative shadow DOM serialization API
  let innerHTML = '';
  if (docElement.getHTML) {
    innerHTML = docElement.getHTML({ serializableShadowRoots: true });
  } else if (docElement.getInnerHTML) {
    innerHTML = docElement.getInnerHTML({ includeShadowRoots: true });
  }
  docElement.textContent = '';
  // Note: Here we are specifically passing replacer function to avoid any replacements due to
  // special characters in client's dom like $&
  return docElement.outerHTML.replace('</html>', () => `${innerHTML}</html>`);
};
