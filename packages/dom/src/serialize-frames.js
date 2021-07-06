import serializeDOM from './serialize-dom';

// List of attributes that accept URIs that should be transformed
const URI_ATTRS = ['href', 'src', 'srcset', 'poster', 'background'];
const URI_SELECTOR = URI_ATTRS.map(a => `[${a}]`).join(',');

// A loose srcset image candidate regex split into capture groups
// https://html.spec.whatwg.org/multipage/images.html#srcset-attribute
const SRCSET_REGEX = /(\s*)([^,]\S*[^,])((?:\s+[^,]+)*\s*(?:,|$))/g;

// Transforms URL attributes within a document to be fully qualified URLs. This is necessary when
// embedded documents are serialized and their contents become root-relative.
function transformRelativeUrls(dom) {
  for (let el of dom.querySelectorAll(URI_SELECTOR)) {
    for (let attr of URI_ATTRS) {
      if (!(attr in el) || !el[attr]) continue;
      let value = el[attr];

      if (attr === 'srcset') {
        // the srcset attribute needs to be parsed
        value = value.replace(SRCSET_REGEX, (_, $1, uri, $3) => (
          `${$1}${new URL(uri, el.baseURI).href}${$3}`
        ));
      } else {
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
