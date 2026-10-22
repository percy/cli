// Custom element names are required by spec to contain a hyphen. Returns
// false for text/comment nodes (which don't have a tagName). This is the
// single source of truth used across prepare-dom, clone-dom, and the
// serializers — keep checks consistent by importing this rather than
// inlining `tagName?.includes('-')`.
export function isCustomElement(element) {
  return !!element?.tagName?.includes('-');
}

// Creates a resource object from an element's unique ID and data URL
export function resourceFromDataURL(uid, dataURL) {
  // split dataURL into desired parts
  let [data, content] = dataURL.split(',');
  let [, mimetype] = data.split(':');
  [mimetype] = mimetype.split(';');

  // build a root-relative URL for the serialized asset. It is same-origin by
  // construction (served from wherever the captured page itself ends up), so
  // it never needs a host or scheme baked in -- PPLT-6109: an absolute URL
  // here previously carried over whatever scheme the local capture host used
  // (typically http), which survives every downstream hostname rewrite and
  // becomes a mixed-content block on any https render.
  let [, ext] = mimetype.split('/');
  let url = `/__serialized__/${uid}.${ext}`;

  // return the url, base64 content, and mimetype
  return { url, content, mimetype };
}

export function resourceFromText(uid, mimetype, data) {
  // build a root-relative URL for the serialized asset -- see
  // resourceFromDataURL above for why this is relative, not absolute.
  let [, ext] = mimetype.split('/');
  let url = `/__serialized__/${uid}.${ext}`;
  // return the url, text content, and mimetype
  return { url, content: data, mimetype };
}

export function styleSheetFromNode(node) {
  /* istanbul ignore if: sanity check */
  try {
    if (node.sheet) return node.sheet;
    // Cloned style nodes don't have a sheet instance unless they are within
    // a document; we get it by temporarily adding the rules to DOM
    const scratch = document.implementation.createHTMLDocument('percy-scratch');
    const tempStyle = node.cloneNode();
    tempStyle.setAttribute('data-percy-style-helper', '');
    tempStyle.textContent = node.textContent || '';
    scratch.head.appendChild(tempStyle);
    const sheet = tempStyle.sheet;
    // Cleanup node
    tempStyle.remove();

    return sheet;
  } catch (err) {
    handleErrors(err, 'Failed to get stylesheet from node: ', node);
  }
}

// Utility function to handle errors
export function handleErrors(error, prefixMessage, element = null, additionalData = {}) {
  let elementData = {};
  if (element) {
    elementData = {
      nodeName: element.nodeName,
      classNames: element.className,
      id: element.id
    };
  }
  additionalData = { ...additionalData, ...elementData };
  let message = error.message;
  message += `\n${prefixMessage} \n${JSON.stringify(additionalData)}`;
  message += '\n Please validate that your DOM is as per W3C standards using any online tool';
  error.message = message;
  error.handled = true;
  throw error;
}
