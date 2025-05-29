import { resourceFromText } from './utils';
import { uid } from './prepare-dom';

let mimetype = null;

function getBase64Substring(src) {
  let base64Index = src.indexOf(';base64,');
  if (base64Index === -1) return null;

  mimetype = src.substring(5, base64Index);
  base64Index += ';base64,'.length;
  return src.substring(base64Index);
}

export function serializeBase64(node, resources, cache) {
  let src = node.src;
  let isHrefUsed = false;

  // case for SVGAnimatedString
  if (src == null && node.href) {
    isHrefUsed = true;
    src = node.href.baseVal;
  }
  // skip if src is null
  if (src == null) return;

  let base64String = getBase64Substring(src.toString());
  // skip if src is not base64
  if (base64String == null) return;
  if (!cache.has(base64String)) {
    // create a resource from the serialized data url
    let resource = resourceFromText(uid(), mimetype, base64String);
    resources.add(resource);
    cache.set(base64String, resource.url);
  }

  if (isHrefUsed === true) {
    if (node.hasAttribute('xlink:href')) {
      node.removeAttribute('xlink:href');
      node.setAttribute('data-percy-serialized-attribute-xlink:href', cache.get(base64String));
    } else {
      node.href.baseVal = cache.get(base64String);
    }
  } else {
    // we use data-percy-serialized-attribute-src here instead of `src`.
    // As soon as src is used the browser will try to load the resource,
    // thus making a network call which would fail as this is a
    // dynamic cached resource and not a resource that backend can serve.
    // we later post converting domtree to html replace this with src
    node.removeAttribute('src');
    node.setAttribute('data-percy-serialized-attribute-src', cache.get(base64String));
  }
}

export default serializeBase64;
