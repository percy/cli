import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';
import serializeVideos from './serialize-video';
import { serializePseudoClasses, markPseudoClassElements } from './serialize-pseudo-classes';
import { cloneNodeAndShadow, getOuterHTML } from './clone-dom';
import { waitForReady } from './readiness';

// Returns a copy or new doctype for a document.
function doctype(dom) {
  let { name = 'html', publicId = '', systemId = '' } = dom?.doctype ?? {};
  let deprecated = '';

  if (publicId && systemId) {
    deprecated = ` PUBLIC "${publicId}" "${systemId}"`;
  } else if (publicId) {
    deprecated = ` PUBLIC "${publicId}"`;
  } else if (systemId) {
    deprecated = ` SYSTEM "${systemId}"`;
  }

  return `<!DOCTYPE ${name}${deprecated}>`;
}

// Serializes and returns the cloned DOM as an HTML string
function serializeHTML(ctx) {
  let html = getOuterHTML(ctx.clone.documentElement, { shadowRootElements: ctx.shadowRootElements, forceShadowAsLightDOM: ctx.forceShadowAsLightDOM });
  // this is replacing serialized data tag with real tag
  html = html.replace(/(<\/?)data-percy-custom-element-/g, '$1');
  // replace serialized data attributes with real attributes
  html = html.replace(/ data-percy-serialized-attribute-(\w+?)=/ig, ' $1=');
  // include the doctype with the html string
  return doctype(ctx.dom) + html;
}

function serializeElements(ctx) {
  serializeInputs(ctx);
  serializeFrames(ctx);
  serializeVideos(ctx);

  if (!ctx.enableJavaScript) {
    serializeCSSOM(ctx);
    serializeCanvas(ctx);
  }
  // Only process shadow hosts if forceShadowAsLightDOM is not enabled
  if (!ctx.forceShadowAsLightDOM) {
    for (const shadowHost of ctx.dom.querySelectorAll('[data-percy-shadow-host]')) {
      let percyElementId = shadowHost.getAttribute('data-percy-element-id');
      let cloneShadowHost = ctx.clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
      if (shadowHost.shadowRoot && cloneShadowHost.shadowRoot) {
        // getHTML requires shadowRoot to be passed explicitly
        // to serialize the shadow elements properly
        ctx.shadowRootElements.push(cloneShadowHost.shadowRoot);
        serializeElements({
          ...ctx,
          dom: shadowHost.shadowRoot,
          clone: cloneShadowHost.shadowRoot
        });
      } else {
        ctx.warnings.add('data-percy-shadow-host does not have shadowRoot');
      }
    }
  }
}

// This is used by SDK's in captureResponsiveSnapshot
export function waitForResize() {
  // if window resizeCount present means event listener was already present
  if (!window.resizeCount) {
    let resizeTimeout = false;
    window.addEventListener('resize', () => {
      if (resizeTimeout !== false) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => window.resizeCount++, 100);
    });
  }
  // always reset count 0
  window.resizeCount = 0;
}

// Serializes a document and returns the resulting DOM string.
//
// This function is SYNCHRONOUS and always returns a plain object — preserving
// backward compatibility with existing SDKs (@percy/cypress, @percy/puppeteer,
// @percy/selenium-webdriver, etc.) that call `PercyDOM.serialize(options)`
// without awaiting the result.
//
// To enable readiness-gated serialization, callers must explicitly opt in by
// calling `serializeDOMWithReadiness()` (which returns a Promise) or by
// awaiting `serializeDOM()` after calling `waitForReady()` separately.
export function serializeDOM(options) {
  return _serialize(options);
}

// Async variant that runs readiness checks before serializing. Returns a
// Promise. Used by:
//   - CLI URL-capture path (page.js calls this via page.eval)
//   - New SDK versions that opt into readiness-gated capture
// Existing SDKs are unaffected as they call serializeDOM() directly.
export async function serializeDOMWithReadiness(options) {
  let readiness = options?.readiness;

  if (readiness && readiness.preset !== 'disabled') {
    try {
      let diagnostics = await waitForReady(readiness);
      let result = _serialize(options);
      /* istanbul ignore next: stringifyResponse with readiness is an unlikely combination */
      if (typeof result === 'object' && diagnostics) {
        result.readiness_diagnostics = diagnostics;
      }
      return result;
    } catch (err) /* istanbul ignore next */ {
      // If readiness fails, still serialize (graceful degradation)
      console.error(`Readiness check failed: ${err.message}`);
    }
  }

  return _serialize(options);
}

// Core serialization logic — always synchronous.
function _serialize(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation,
    stringifyResponse = options?.stringify_response,
    disableShadowDOM = options?.disable_shadow_dom,
    reshuffleInvalidTags = options?.reshuffle_invalid_tags,
    ignoreCanvasSerializationErrors = options?.ignore_canvas_serialization_errors,
    ignoreStyleSheetSerializationErrors = options?.ignore_style_sheet_serialization_errors,
    forceShadowAsLightDOM = options?.force_shadow_dom_as_light_dom,
    pseudoClassEnabledElements = options?.pseudo_class_enabled_elements
  } = options || {};

  // keep certain records throughout serialization
  let ctx = {
    resources: new Set(),
    warnings: new Set(),
    hints: new Set(),
    cache: new Map(),
    shadowRootElements: [],
    enableJavaScript,
    disableShadowDOM,
    ignoreCanvasSerializationErrors,
    ignoreStyleSheetSerializationErrors,
    forceShadowAsLightDOM,
    pseudoClassEnabledElements
  };

  ctx.dom = dom;
  markPseudoClassElements(ctx, pseudoClassEnabledElements);
  ctx.clone = cloneNodeAndShadow(ctx);

  serializeElements(ctx);

  // STEP 4: Process pseudo-class enabled elements
  serializePseudoClasses(ctx);

  if (domTransformation) {
    try {
      // eslint-disable-next-line no-eval
      if (typeof (domTransformation) === 'string') domTransformation = window.eval(domTransformation);
      domTransformation(ctx.clone.documentElement);
    } catch (err) {
      let errorMessage = `Could not transform the dom: ${err.message}`;
      ctx.warnings.add(errorMessage);
      console.error(errorMessage);
    }
  }

  if (reshuffleInvalidTags) {
    let clonedBody = ctx.clone.body;
    while (clonedBody.nextSibling) {
      let sibling = clonedBody.nextSibling;
      clonedBody.append(sibling);
    }
  } else if (ctx.clone.body?.nextSibling) {
    ctx.hints.add('DOM elements found outside </body>');
  }

  let cookies = '';
  // Collecting cookies fail for about://blank page
  try {
    cookies = dom.cookie;
  } catch (err) /* istanbul ignore next */ /* Tested this part in discovery.test.js with about:blank page */ {
    const errorMessage = `Could not capture cookies: ${err.message}`;
    ctx.warnings.add(errorMessage);
    console.error(errorMessage);
  }

  let result = {
    html: serializeHTML(ctx),
    cookies: cookies,
    userAgent: navigator.userAgent,
    warnings: Array.from(ctx.warnings),
    resources: Array.from(ctx.resources),
    hints: Array.from(ctx.hints)
  };

  return stringifyResponse
    ? JSON.stringify(result)
    : result;
}

export default serializeDOM;
