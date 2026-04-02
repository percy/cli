import serializeDOM from './serialize-dom';

let policy = null;

export function resetPolicy() {
  policy = null;
}

function getPolicy() {
  if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
    if (policy && policy.createHTML) return policy;

    try {
      policy = window.trustedTypes.createPolicy('percy-dom', {
        // codeql[js/dom-text-reinterpreted-as-html]
        createHTML: html => html
      });
    } catch (e) {
      // ignore
    }
    /* istanbul ignore next */
    return policy || {};
  }
}

// Adds a `<base>` element to the serialized iframe's `<head>`. This is necessary when
// embedded documents are serialized and their contents become root-relative.
function setBaseURI(dom, warnings) {
  let parsedURL;
  try {
    parsedURL = new URL(dom.baseURI);
  } catch (e) {
    warnings?.add(`Could not parse baseURI for iframe: ${dom.baseURI}`);
    return;
  }

  if (!parsedURL?.hostname) return;

  let $base = document.createElement('base');
  $base.href = dom.baseURI;

  dom.querySelector('head')?.prepend($base);
}

// Recursively serializes iframe documents into srcdoc attributes.
export function serializeFrames({ dom, clone, warnings, resources, enableJavaScript, disableShadowDOM, excludeIframeSelectors }) {
  for (let frame of dom.querySelectorAll('iframe')) {
    // R19: Skip iframes marked with data-percy-ignore
    if (frame.hasAttribute('data-percy-ignore') || frame.closest?.('[data-percy-ignore]')) {
      let percyElementId = frame.getAttribute('data-percy-element-id');
      let cloneEl = percyElementId && clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
      if (cloneEl) cloneEl.remove();
      warnings.add(`Iframe excluded by data-percy-ignore`);
      continue;
    }

    // R19b: CSS selector-based iframe exclusion
    if (excludeIframeSelectors?.length) {
      let excluded = false;
      for (const selector of excludeIframeSelectors) {
        try {
          if (frame.matches(selector)) {
            let percyElementId = frame.getAttribute('data-percy-element-id');
            let cloneEl = percyElementId && clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
            if (cloneEl) cloneEl.remove();
            warnings.add(`Iframe excluded by CSS selector: ${selector}`);
            excluded = true;
            break;
          }
        } catch (e) { /* invalid selector, skip */ }
      }
      if (excluded) continue;
    }

    try {
      let percyElementId = frame.getAttribute('data-percy-element-id');
      let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
      let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript');

      // delete frames within the head since they usually break pages when
      // rerendered and do not effect the visuals of a page
      if (clone.head?.contains(cloneEl)) {
        cloneEl.remove();

        // if the frame document is accessible and not empty, we can serialize it
      } else if (frame.contentDocument && frame.contentDocument.documentElement) {
        // js is enabled and this frame was built with js, don't serialize it
        if (enableJavaScript && builtWithJs) continue;

        // the frame has yet to load and wasn't built with js, it is unsafe to serialize
        try {
          let loadEnd;
          // Use PerformanceNavigationTiming (modern) with fallback to deprecated API
          let navEntries = frame.contentWindow?.performance?.getEntriesByType?.('navigation');
          loadEnd = navEntries?.[0]?.loadEventEnd ?? frame.contentWindow?.performance?.timing?.loadEventEnd;
          if (!builtWithJs && !loadEnd) continue;
        } catch (e) {
          // Cross-origin or restricted access to performance API — skip this frame
          if (!builtWithJs) continue;
        }

        // recersively serialize contents
        let serialized = serializeDOM({
          domTransformation: (dom) => setBaseURI(dom, warnings),
          dom: frame.contentDocument,
          enableJavaScript,
          disableShadowDOM
        });

        // append serialized warnings and resources
        /* istanbul ignore next: warnings not implemented yet */
        for (let w of serialized.warnings) warnings.add(w);
        for (let r of serialized.resources) resources.add(r);

        // assign serialized html to srcdoc and remove src
        let p = getPolicy() || {};
        try {
          cloneEl.setAttribute('srcdoc', p.createHTML ? p.createHTML(serialized.html) : serialized.html);
        } catch { }

        cloneEl.removeAttribute('src');

        // delete inaccessible frames built with js when js is disabled because they
        // break asset discovery by creating non-captured requests that hang
      } else if (!enableJavaScript && builtWithJs) {
        cloneEl.remove();
      } else if (frame.src && !builtWithJs) {
        // R1: Cross-origin or otherwise inaccessible iframe — emit warning with sanitized URL
        try {
          let origin = new URL(frame.src).origin;
          warnings.add(`Cross-origin iframe could not be captured: ${origin}`);
        } catch (e) {
          warnings.add(`Inaccessible iframe could not be captured`);
        }
      }
    } catch (e) {
      // Error boundary: one bad iframe should not kill all subsequent iframe serialization
      warnings.add(`Failed to serialize iframe: ${e.message}`);
    }
  }
}

export default serializeFrames;
