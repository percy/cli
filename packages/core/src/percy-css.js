import log from '@percy/logger';
import { createLocalResource } from './utils/resources';

// Creates a local Percy CSS resource and injects a Percy CSS link into the
// provided DOM string. Returns both the new DOM string and local resource
// object. If no Percy CSS is provided the return value will be the original DOM
// string and the function will do nothing.
export default function injectPercyCSS(rootUrl, originalDOM, percyCSS, meta) {
  if (!percyCSS) return [originalDOM];

  let filename = `percy-specific.${Date.now()}.css`;

  log.debug('Handling percy-specific css:', meta);
  log.debug(`-> filename: ${filename}`, meta);
  log.debug(`-> content: ${percyCSS}`, meta);

  let url = `${new URL(rootUrl).origin}/${filename}`;
  let resource = createLocalResource(url, percyCSS, 'text/css', null, meta);
  let link = `<link data-percy-specific-css rel="stylesheet" href="/${filename}"/>`;
  let dom = originalDOM.replace(/(<\/body>)(?!.*\1)/is, link + '$&');

  return [dom, resource];
}
