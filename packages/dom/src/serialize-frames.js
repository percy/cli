import serializeDOM from './serialize-dom';

// List of attributes that accept URIs that should be transformed
const URI_ATTRS = ['href', 'src', 'srcset', 'poster', 'background'];
const URI_SELECTOR = URI_ATTRS.map(a => `[${a}]`).join(',') + (
  ',[style*="url("]'); // include elements with url style attributes

// A loose srcset image candidate regex split into capture groups
// https://html.spec.whatwg.org/multipage/images.html#srcset-attribute
const SRCSET_REGEX = /(\s*)([^,]\S*[^,])((?:\s+[^,]+)*\s*(?:,|$))/g;

// A loose CSS url() regex split into capture groups
const CSS_URL_REGEX = /(url\((["']?))((?:\\.|(?!\2).|[^)])+)(\2\))/g;

// Transforms URL attributes within a document to be fully qualified URLs. This is necessary when
// embedded documents are serialized and their contents become root-relative.
function transformRelativeUrls(dom) {
  // transform style elements that might contain URLs
  for (let style of dom.querySelectorAll('style')) {
    style.innerHTML &&= style.innerHTML
      .replace(CSS_URL_REGEX, (_, $1, $2, uri, $4) => (
        `${$1}${new URL(uri, style.baseURI).href}${$4}`
      ));
  }

  // transform element attributes that might contain URLs
  for (let el of dom.querySelectorAll(URI_SELECTOR)) {
    for (let attr of URI_ATTRS.concat('style')) {
      if (!(attr in el) || !el[attr] || !el.hasAttribute(attr)) continue;
      let value = el[attr];

      if (attr === 'style') {
        // transform inline style url() usage
        value = el.getAttribute('style')
          .replace(CSS_URL_REGEX, (_, $1, $2, uri, $4) => (
            `${$1}${new URL(uri, el.baseURI).href}${$4}`
          ));
      } else if (attr === 'srcset') {
        // transform each srcset URL
        value = value.replace(SRCSET_REGEX, (_, $1, uri, $3) => (
          `${$1}${new URL(uri, el.baseURI).href}${$3}`
        ));
      } else {
        // resolve the URL with the node's base URI
        value = new URL(value, el.baseURI).href;
      }

      el.setAttribute(attr, value);
    }
  }
}

// Recursively serializes iframe documents into srcdoc attributes.
export default function serializeFrames(dom, clone, { enableJavaScript }) {
  for (let frame of dom.querySelectorAll('iframe')) {
    let percyElementId = frame.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript');

    // delete frames within the head since they usually break pages when
    // rerendered and do not effect the visuals of a page
    if (clone.head.contains(cloneEl)) {
      cloneEl.remove();

    // if the frame document is accessible and not empty, we can serialize it
    } else if (frame.contentDocument && frame.contentDocument.documentElement) {
      // js is enabled and this frame was built with js, don't serialize it
      if (enableJavaScript && builtWithJs) continue;

      // the frame has yet to load and wasn't built with js, it is unsafe to serialize
      if (!builtWithJs && !frame.contentWindow.performance.timing.loadEventEnd) continue;

      // recersively serialize contents
      let serialized = serializeDOM({
        domTransformation: transformRelativeUrls,
        dom: frame.contentDocument,
        enableJavaScript
      });

      // assign to srcdoc and remove src
      cloneEl.setAttribute('srcdoc', serialized);
      cloneEl.removeAttribute('src');

    // delete inaccessible frames built with js when js is disabled because they
    // break asset discovery by creating non-captured requests that hang
    } else if (!enableJavaScript && builtWithJs) {
      cloneEl.remove();
    }
  }
}
