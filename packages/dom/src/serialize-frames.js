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

// Capture bounding rect from original DOM element before removing from clone
function captureFidelityRegion(frame, reason, fidelityRegions) {
  let rect;
  try {
    rect = frame.getBoundingClientRect();
  } catch (e) {
    rect = null;
  }
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  fidelityRegions.push({
    reason,
    tag: 'iframe',
    selector: frame.id || frame.className || 'iframe',
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  });
}

// Recursively serializes iframe documents into srcdoc attributes.
export function serializeFrames({ dom, clone, warnings, resources, fidelityRegions, enableJavaScript, disableShadowDOM, ignoreIframeSelectors }) {
  let iframeTotal = 0;
  let captured = 0;
  let corsExcluded = 0;
  let sandboxWarned = 0;
  let ignored = 0;

  for (let frame of dom.querySelectorAll('iframe')) {
    iframeTotal++;
    let percyElementId = frame.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);

    // Skip iframes with data-percy-ignore attribute or matching configured selectors
    let matchesSelector = ignoreIframeSelectors?.length &&
      ignoreIframeSelectors.some(sel => { try { return frame.matches(sel); } catch { return false; } });
    if (frame.hasAttribute('data-percy-ignore') || matchesSelector) {
      ignored++;
      captureFidelityRegion(frame, 'user-ignored', fidelityRegions);
      cloneEl?.remove();
      continue;
    }
    let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript');
    let sandboxAttr = frame.getAttribute('sandbox');

    // Warn about sandboxed iframes
    if (sandboxAttr !== null) {
      sandboxWarned++;
      let frameLabel = frame.id || frame.src || frame.getAttribute('name') || '<unnamed iframe>';
      let tokens = sandboxAttr.split(/\s+/).filter(Boolean);

      if (tokens.length === 0) {
        warnings.add(`Sandboxed iframe "${frameLabel}" has no permissions — content may not render with full fidelity in Percy`);
      } else {
        if (!tokens.includes('allow-scripts')) {
          warnings.add(`Sandboxed iframe "${frameLabel}" has scripts disabled — JS-dependent content will not render in Percy`);
        }
        if (!tokens.includes('allow-same-origin')) {
          warnings.add(`Sandboxed iframe "${frameLabel}" lacks allow-same-origin — styles and resources may not load correctly in Percy`);
        }
      }
    }

    // delete frames within the head since they usually break pages when
    // rerendered and do not effect the visuals of a page
    if (clone.head?.contains(cloneEl)) {
      cloneEl.remove();

      // if the frame document is accessible and not empty, we can serialize it
    } else if (frame.contentDocument && frame.contentDocument.documentElement) {
      // js is enabled and this frame was built with js, don't serialize it
      if (enableJavaScript && builtWithJs) continue;

      // the frame has yet to load and wasn't built with js, it is unsafe to serialize
      if (!builtWithJs && !frame.contentWindow.performance.timing.loadEventEnd) continue;

      captured++;

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
      captureFidelityRegion(frame, 'js-inaccessible', fidelityRegions);
      cloneEl.remove();
    } else {
      // frame.contentDocument is null or empty — cross-origin or otherwise inaccessible
      corsExcluded++;
      captureFidelityRegion(frame, 'cross-origin-excluded', fidelityRegions);
    }
  }

  if (iframeTotal > 0) {
    let parts = [`${captured} captured`, `${corsExcluded} cross-origin excluded`, `${sandboxWarned} sandboxed`];
    if (ignored > 0) parts.push(`${ignored} ignored via data-percy-ignore`);
    warnings.add(`[fidelity] ${iframeTotal} iframe(s): ${parts.join(', ')}`);
  }
}

export default serializeFrames;
