import prepareDOM from './prepare-dom';
import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';

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

// Serializes a document and returns the resulting DOM string.
export default function serializeDOM(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation
  } = options || {};

  prepareDOM(dom);

  let clone = dom.cloneNode(true);
  serializeInputs(dom, clone);
  serializeFrames(dom, clone, { enableJavaScript });

  if (!enableJavaScript) {
    serializeCSSOM(dom, clone);
    serializeCanvas(dom, clone);
  }

  let doc = clone.documentElement;

  if (domTransformation) {
    try {
      domTransformation(doc);
    } catch (err) {
      console.error('Could not transform the dom:', err.message);
    }
  }

  return doctype(dom) + doc.outerHTML;
}
