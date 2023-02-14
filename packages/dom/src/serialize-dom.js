import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';
import serializeVideos from './serialize-video';
import { cloneNodeAndShadow, getOuterHTML } from './clone-dom';
import injectDeclarativeShadowDOMPolyfill from './inject-polyfill';

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
  let html = getOuterHTML(ctx.clone.documentElement);
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
}

// Serializes a document and returns the resulting DOM string.
export function serializeDOM(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation,
    stringifyResponse = options?.stringify_response,
    disableShadowDOM = options?.disable_shadow_dom
  } = options || {};

  // keep certain records throughout serialization
  let ctx = {
    resources: new Set(),
    warnings: new Set(),
    cache: new Map(),
    enableJavaScript,
    disableShadowDOM
  };

  ctx.dom = dom;
  ctx.clone = cloneNodeAndShadow(ctx);

  serializeElements(ctx);

  for (const shadowHost of ctx.dom.querySelectorAll('[data-percy-shadow-host]')) {
    let percyElementId = shadowHost.getAttribute('data-percy-element-id');
    let cloneShadowHost = ctx.clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    if (shadowHost.shadowRoot && cloneShadowHost.shadowRoot) {
      serializeElements({
        ...ctx,
        dom: shadowHost.shadowRoot,
        clone: cloneShadowHost.shadowRoot
      });
    } else {
      ctx.warnings.add('element with data-percy-shadow-host does not have shadowRoot');
    }
  }

  if (domTransformation) {
    try {
      domTransformation(ctx.clone.documentElement);
    } catch (err) {
      console.error('Could not transform the dom:', err.message);
    }
  }

  if (!disableShadowDOM) { injectDeclarativeShadowDOMPolyfill(ctx); }

  let result = {
    html: serializeHTML(ctx),
    warnings: Array.from(ctx.warnings),
    resources: Array.from(ctx.resources)
  };

  return stringifyResponse
    ? JSON.stringify(result)
    : result;
}

export default serializeDOM;
