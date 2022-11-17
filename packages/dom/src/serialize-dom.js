import prepareDOM from './prepare-dom';
import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';
import serializeVideos from './serialize-video';

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
  let html = ctx.clone.documentElement.outerHTML;
  // include the doctype with the html string
  return doctype(ctx.dom) + html;
}

// Serializes a document and returns the resulting DOM string.
export function serializeDOM(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation
  } = options || {};

  // keep certain records throughout serialization
  let ctx = {
    resources: new Set(),
    warnings: new Set(),
    enableJavaScript
  };

  ctx.dom = prepareDOM(dom);
  ctx.clone = ctx.dom.cloneNode(true);

  serializeInputs(ctx);
  serializeFrames(ctx);
  serializeVideos(ctx);

  if (!enableJavaScript) {
    serializeCSSOM(ctx);
    serializeCanvas(ctx);
  }

  if (domTransformation) {
    try {
      domTransformation(ctx.clone.documentElement);
    } catch (err) {
      console.error('Could not transform the dom:', err.message);
    }
  }

  return {
    html: serializeHTML(ctx),
    warnings: Array.from(ctx.warnings),
    resources: Array.from(ctx.resources)
  };
}

export default serializeDOM;
