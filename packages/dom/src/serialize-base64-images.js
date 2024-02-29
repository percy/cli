import { resourceFromText } from './utils';
import { uid } from './prepare-dom';

const signatures = {
  JVBERi0: 'application/pdf',
  R0lGODdh: 'image/gif',
  R0lGODlh: 'image/gif',
  iVBORw0KGgo: 'image/png',
  '/9j/': 'image/jpg',
  Qk02U: 'image/bmp'
};

function getBase64Substring(src) {
  let base64Index = src.indexOf(';base64,');
  if (base64Index === -1) return null;

  base64Index += ';base64,'.length;
  return src.substring(base64Index);
}

function detectMimeType(base64String) {
  for (let s in signatures) {
    if (base64String.indexOf(s) === 0) {
      return signatures[s];
    }
  }
  return null;
}

// Captures the current frame of videos and sets the poster image
export function serializeBase64Images(dom, resources) {
  for (let image of dom.querySelectorAll('img')) {
    let imageSrc = image.getAttribute('src');

    let base64String = getBase64Substring(imageSrc);
    // skip if image src is not base64
    if (base64String == null) continue;

    let mimetype = detectMimeType(base64String);
    // skip if mimetype not found
    if (mimetype == null) continue;

    // create a resource from the serialized data url
    let resource = resourceFromText(uid(), mimetype, base64String);
    resources.add(resource);

    image.setAttribute('src', resource.url);
  }
}

export default serializeBase64Images;
