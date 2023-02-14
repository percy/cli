import { resourceFromDataURL } from './utils.js';

// Captures the current frame of imgs and sets the poster image
export function serializeImages({ dom, clone, resources, warnings }) {
  for (let img of dom.querySelectorAll('img')) {
    // we currently only serialize blob images, since they don't show up during asset discovery
    if (!img.getAttribute('src')?.startsWith('blob:')) continue;

    let imgId = img.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${imgId}"]`);
    let canvas = document.createElement('canvas');
    let width = canvas.width = img.width;
    let height = canvas.height = img.height;
    let dataUrl;

    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    try { dataUrl = canvas.toDataURL(); } catch (e) { warnings.add(`data-percy-element-id="${imgId}" : ${e.toString()}`); }

    // if the canvas produces a blank image, skip
    if (!dataUrl || dataUrl === 'data:,') continue;

    // create a resource from the serialized data url
    let resource = resourceFromDataURL(imgId, dataUrl);
    resources.add(resource);

    cloneEl.setAttribute('data-percy-image-serialized', '');
    // use a data attribute to avoid making a real request
    cloneEl.setAttribute('data-percy-serialized-attribute-src', resource.url);
    cloneEl.removeAttribute('src');
  }
}

export default serializeImages;
