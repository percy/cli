// Creates a resource object from an element's unique ID and data URL
export function resourceFromDataURL(uid, dataURL) {
  // split dataURL into desired parts
  let [data, content] = dataURL.split(',');
  let [, mimetype] = data.split(':');
  [mimetype] = mimetype.split(';');

  // build a URL for the serialized asset
  let [, ext] = mimetype.split('/');
  let path = `/__serialized__/${uid}.${ext}`;
  let url = rewriteLocalhostURL(new URL(path, document.URL).toString());

  // return the url, base64 content, and mimetype
  return { url, content, mimetype };
}

export function resourceFromText(uid, mimetype, data) {
  // build a URL for the serialized asset
  let [, ext] = mimetype.split('/');
  let path = `/__serialized__/${uid}.${ext}`;
  let url = rewriteLocalhostURL(new URL(path, document.URL).toString());
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

export function rewriteLocalhostURL(url) {
  let parsedURL = new URL(url);

  // check if URL has chrome-error scheme and rewrite to a non-existent URL that will 404
  if (parsedURL.protocol === 'chrome-error:') {
    url = 'http://we-got-a-chrome-error-url-handled-gracefully.com/' + parsedURL.host + parsedURL.pathname + parsedURL.search + parsedURL.hash;
  }
  return url.replace(/(http[s]{0,1}:\/\/)(localhost|127.0.0.1)[:\d+]*/, '$1render.percy.local');
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
