import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';
import serializeVideos from './serialize-video';
import { cloneNodeAndShadow, getOuterHTML } from './clone-dom';

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
  let html = getOuterHTML(ctx.clone.documentElement, { shadowRootElements: ctx.shadowRootElements });
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
export function serializeDOM(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation,
    stringifyResponse = options?.stringify_response,
    disableShadowDOM = options?.disable_shadow_dom,
    reshuffleInvalidTags = options?.reshuffle_invalid_tags
  } = options || {};

  // keep certain records throughout serialization
  let ctx = {
    resources: new Set(),
    warnings: new Set(),
    hints: new Set(),
    cache: new Map(),
    shadowRootElements: [],
    enableJavaScript,
    disableShadowDOM
  };

  ctx.dom = dom;
  ctx.clone = cloneNodeAndShadow(ctx);

  serializeElements(ctx);

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
  } else if (ctx.clone.body.nextSibling) {
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
