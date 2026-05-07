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

// Per-spec: nested iframes are captured up to a configurable depth (default 3).
// Beyond that we skip recursion to bound runtime and prevent pathological pages
// (e.g. cyclic iframe trees) from blowing the call stack.
export const DEFAULT_MAX_IFRAME_DEPTH = 3;
// Hard ceiling for any user-supplied maxIframeDepth — values above this are
// clamped down. 10 levels is well past any realistic UI nesting and keeps
// the recursion cost predictable.
export const HARD_MAX_IFRAME_DEPTH = 10;

function clampIframeDepth(raw) {
  let n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_IFRAME_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_IFRAME_DEPTH);
}

// Recursively serializes iframe documents into srcdoc attributes. `iframeDepth`
// is the current nesting level (0 at the top-level document, +1 per recursion).
// The `iframeDepth = 0` default fires only when serializeFrames is called
// without going through serializeDOM (which always sets it on ctx) — kept
// as a defensive fallback for direct callers.
/* istanbul ignore next: iframeDepth default unreachable from serializeDOM */
export function serializeFrames({ dom, clone, warnings, resources, enableJavaScript, disableShadowDOM, ignoreIframeSelectors, forceShadowAsLightDOM, maxIframeDepth, iframeDepth = 0 }) {
  maxIframeDepth = clampIframeDepth(maxIframeDepth);
  let iframeTotal = 0;
  let captured = 0;
  let corsExcluded = 0;
  let sandboxWarned = 0;
  let ignored = 0;
  let depthExcluded = 0;

  for (let frame of dom.querySelectorAll('iframe')) {
    iframeTotal++;
    let percyElementId = frame.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);

    // Skip iframes with data-percy-ignore attribute or matching configured selectors
    let matchesSelector = ignoreIframeSelectors?.length &&
      ignoreIframeSelectors.some(sel => { try { return frame.matches(sel); } catch { return false; } });
    if (frame.hasAttribute('data-percy-ignore') || matchesSelector) {
      ignored++;
      cloneEl?.remove();
      continue;
    }
    let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript');
    let sandboxAttr = frame.getAttribute('sandbox');

    // Warn about sandboxed iframes lacking the permissions Percy needs to
    // render with fidelity. Fully-permissive sandboxes (allow-scripts +
    // allow-same-origin) capture fine and do NOT count toward the
    // [fidelity] summary — counting them would inflate the user-visible
    // "N sandboxed" number for safe configurations.
    if (sandboxAttr !== null) {
      let frameLabel = frame.id || frame.src || frame.getAttribute('name') || '<unnamed iframe>';
      let tokens = sandboxAttr.split(/\s+/).filter(Boolean);
      let warned = false;

      if (tokens.length === 0) {
        warnings.add(`Sandboxed iframe "${frameLabel}" has no permissions — content may not render with full fidelity in Percy`);
        warned = true;
      } else {
        if (!tokens.includes('allow-scripts')) {
          warnings.add(`Sandboxed iframe "${frameLabel}" has scripts disabled — JS-dependent content will not render in Percy`);
          warned = true;
        }
        if (!tokens.includes('allow-same-origin')) {
          warnings.add(`Sandboxed iframe "${frameLabel}" lacks allow-same-origin — styles and resources may not load correctly in Percy`);
          warned = true;
        }
      }

      if (warned) sandboxWarned++;
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

      // Bound recursion at the configured depth so nested iframes can't
      // blow the call stack on pathological pages.
      if (iframeDepth + 1 >= maxIframeDepth) {
        depthExcluded++;
        continue;
      }

      captured++;

      // recersively serialize contents — propagate ignoreIframeSelectors,
      // forceShadowAsLightDOM, and the depth counter so nested iframes/shadow
      // trees honor the same user options as the top-level capture.
      let serialized = serializeDOM({
        domTransformation: (dom) => setBaseURI(dom, warnings),
        dom: frame.contentDocument,
        enableJavaScript,
        disableShadowDOM,
        forceShadowAsLightDOM,
        ignoreIframeSelectors,
        maxIframeDepth,
        iframeDepth: iframeDepth + 1
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
    } else {
      // frame.contentDocument is null or empty — cross-origin or otherwise inaccessible
      corsExcluded++;
    }
  }

  if (iframeTotal > 0) {
    let parts = [`${captured} captured`, `${corsExcluded} cross-origin excluded`, `${sandboxWarned} sandboxed`];
    if (ignored > 0) parts.push(`${ignored} ignored via data-percy-ignore`);
    if (depthExcluded > 0) parts.push(`${depthExcluded} excluded at depth limit (${maxIframeDepth})`);
    warnings.add(`[fidelity] ${iframeTotal} iframe(s): ${parts.join(', ')}`);
  }
}

export default serializeFrames;
