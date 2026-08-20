/**
 * Custom deep clone function that replaces Percy's current clone behavior.
 * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
 */
import markElement from './prepare-dom';
import applyElementTransformations from './transform-dom';
import serializeBase64 from './serialize-base64';
import { handleErrors, isCustomElement } from './utils';
import {
  getClosedShadowRoot,
  hasClosedShadowRoot
} from './shadow-utils';

/**
 * Deep clone a document while also preserving shadow roots
 * returns document fragment
 */

const ignoreTags = ['NOSCRIPT'];

/**
 * Clone an element without triggering custom element lifecycle callbacks.
 * Custom elements with callbacks or closed shadow roots are cloned as proxy elements
 * to prevent constructors from running (which could call attachShadow, fetch data, etc).
 */
function cloneElementWithoutLifecycle(element) {
  let isCustom = isCustomElement(element);
  let hasClosedShadow = isCustom && hasClosedShadowRoot(element);
  let hasCallbacks = isCustom && element.attributeChangedCallback;

  if (!isCustom || (!hasCallbacks && !hasClosedShadow)) {
    return element.cloneNode();
  }

  const cloned = document.createElement('data-percy-custom-element-' + element.tagName);

  // Clone attributes without triggering attributeChangedCallback
  for (const attr of element.attributes) {
    // handle src separately
    if (attr.name.toLowerCase() === 'src') {
      cloned.setAttribute('data-percy-serialized-attribute-src', attr.value);
    } else {
      cloned.setAttribute(attr.name, attr.value);
    }
  }

  return cloned;
}

export function cloneNodeAndShadow(ctx) {
  let { dom, disableShadowDOM, forceShadowAsLightDOM, resources, cache, enableJavaScript } = ctx;
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

      if (node.nodeName === 'BASE') {
        let clone = node.cloneNode(false);
        parent.appendChild(clone);
        return;
      }

      // mark the node before cloning
      markElement(node, disableShadowDOM, forceShadowAsLightDOM);

      let clone = cloneElementWithoutLifecycle(node);

      // Custom-element :state() is captured by the fallback path in
      // serialize-custom-states.js (live el.matches against state names
      // discovered in CSS) — no clone-time fast path remains.

      // Handle <style> tag specifically for media queries
      if (node.nodeName === 'STYLE' && !enableJavaScript) {
        let cssText = node.textContent?.trim() || '';
        if (!cssText && node.sheet) {
          try {
            const cssRules = node.sheet.cssRules;
            if (cssRules && cssRules.length > 0) {
              cssText = Array.from(cssRules).map(rule => rule.cssText).join('\n');
            }
          } catch (_) {
            // ignore errors
          }
        }

        if (cssText) {
          clone.textContent = cssText;
          clone.setAttribute('data-percy-cssom-serialized', 'true');
        }
      }

      // We apply any element transformations here to avoid another treeWalk
      applyElementTransformations(node, clone);

      serializeBase64(clone, resources, cache);

      parent.appendChild(clone);

      // shallow clone should not contain children
      if (clone.children) {
        /* istanbul ignore next */
        Array.from(clone.children).forEach((child) => clone.removeChild(child));
      }

      // clone shadow DOM (including closed shadow roots captured via CDP
      // and stored on window.__percyClosedShadowRoots)
      let nodeShadowRoot = node.shadowRoot || getClosedShadowRoot(node);
      if (nodeShadowRoot && !disableShadowDOM) {
        if (forceShadowAsLightDOM) {
          // When forceShadowAsLightDOM is true, treat shadow content as normal DOM
          walkTree(nodeShadowRoot.firstChild, clone);
        } else {
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
          walkTree(nodeShadowRoot.firstChild, clone.shadowRoot);
        }
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
export function getOuterHTML(docElement, { shadowRootElements, forceShadowAsLightDOM, cloneMayHaveUncountedShadowRoots }) {
  // chromium gives us declarative shadow DOM serialization API
  let innerHTML = '';
  // When forceShadowAsLightDOM is true, treat shadow DOM as normal HTML
  if (forceShadowAsLightDOM) {
    return docElement.outerHTML;
  }
  // With no shadow roots to embed, the getHTML()+textContent=''+outerHTML
  // .replace() reassembly below just reproduces `docElement.outerHTML` while
  // allocating a full-size intermediate string + replace copy. Skip it to cut
  // this step's transient footprint (GC pressure) on heavy pages.
  //
  // The guard is deliberately two-part. An empty shadowRootElements is NOT by
  // itself proof that the clone has no shadow roots to serialize: getHTML's
  // `serializableShadowRoots: true` also picks up any root attached with
  // `serializable: true` (which is how cloneNodeAndShadow attaches them) even
  // when it is absent from the explicit `shadowRoots` array. What makes the
  // array authoritative is that serializeElements() pushes every clone shadow
  // root into it (serialize-dom.js) before serializeHTML runs. A caller-supplied
  // domTransformation breaks that: it runs AFTER serializeElements and can
  // attach a serializable root to the clone, so cloneMayHaveUncountedShadowRoots
  // sends those snapshots down the full reassembly path instead of dropping the
  // shadow content on the floor.
  if (!cloneMayHaveUncountedShadowRoots && !shadowRootElements?.length) {
    // Release the clone's node graph before the caller builds the doctype
    // concatenation (and, with stringifyResponse, a full JSON copy) on top of
    // this string — the reassembly path below gets that for free via its own
    // `textContent = ''`, and on a heavy page the retained tree dwarfs the one
    // string copy this fast path saves.
    let html = docElement.outerHTML;
    docElement.textContent = '';
    return html;
  }
  /* istanbul ignore else if: Only triggered in chrome <= 128 and tests runs on latest */
  if (docElement.getHTML) {
    // All major browsers in latest versions supports getHTML API to get serialized DOM
    // https://developer.mozilla.org/en-US/docs/Web/API/Element/getHTML
    innerHTML = docElement.getHTML({ serializableShadowRoots: true, shadowRoots: shadowRootElements });
  } else if (docElement.getInnerHTML) {
    innerHTML = docElement.getInnerHTML({ includeShadowRoots: true });
  } else {
    // old firefox doesn't serialize shadow DOM, we're awaiting API's by firefox to become ready and are not polyfilling it.
    // new firefox from 128 onwards serializes it using getHTML
    return docElement.outerHTML;
  }
  docElement.textContent = '';
  // Note: Here we are specifically passing replacer function to avoid any replacements due to
  // special characters in client's dom like $&
  return docElement.outerHTML.replace('</html>', () => `${innerHTML}</html>`);
};
