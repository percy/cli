import log from '@percy/logger';
import { createLocalResource } from './utils/resources';

// Creates a local Percy CSS resource and injects a Percy CSS link into the
// provided DOM string. Returns both the new DOM string and local resource
// object. If no Percy CSS is provided the return value will be the original DOM
// string and the function will do nothing.
export default function injectPercyCSS(rootUrl, originalDOM, percyCSS) {
  if (!percyCSS) return [originalDOM];

  let filename = `percy-specific.${Date.now()}.css`;

  log.debug('Handling percy-specific css:');
  log.debug(`-> filename: ${filename}`);
  log.debug(`-> content: ${percyCSS}`);

  let url = `${rootUrl}/${filename}`;
  let resource = createLocalResource(url, percyCSS, 'text/css');
  let link = `<link data-percy-specific-css rel="stylesheet" href="/${filename}"/>`;
  let dom = originalDOM.replace(/(<\/body>)(?!.*\1)/is, link + '$&');

  return [dom, resource];
}
