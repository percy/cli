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

export function serializeBase64(node, resources) {
  let src = node.src;
  let isHrefUsed = false;
  if (src == null && node.href) {
    isHrefUsed = true;
    src = node.href.baseVal;
  }
  // skip if src is null
  if (src == null) return;

  let base64String = getBase64Substring(src.toString());
  // skip if src is not base64
  if (base64String == null) return;

  // create a resource from the serialized data url
  let resource = resourceFromText(uid(), mimetype, base64String);
  resources.add(resource);

  node.src = resource.url;
  if (isHrefUsed === true) {
    node.href.baseVal = resource.url;
  }
}

export default serializeBase64;
