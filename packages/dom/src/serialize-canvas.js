import { resourceFromDataURL, handleErrors } from './utils.js';

// Serialize in-memory canvas elements into images.
export function serializeCanvas(ctx) {
  let { dom, clone, resources } = ctx;
  for (let canvas of dom.querySelectorAll('canvas')) {
    try {
      // Note: the `.toDataURL` API requires WebGL canvas elements to use
      // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
      // drawing buffer, which is cleared after each render for WebGL by default.
      let dataUrl = canvas.toDataURL();

      // skip empty canvases
      if (!dataUrl || dataUrl === 'data:,') continue;

      // get the element's percy id and create a resource for it
      let percyElementId = canvas.getAttribute('data-percy-element-id');
      let resource = resourceFromDataURL(percyElementId, dataUrl);
      resources.add(resource);

      // create an image element in the cloned dom
      let img = document.createElement('img');
      // use a data attribute to avoid making a real request
      img.setAttribute('data-percy-serialized-attribute-src', resource.url);

      // copy canvas element attributes to the image element such as style, class,
      // or data attributes that may be targeted by CSS
      for (let { name, value } of canvas.attributes) {
        img.setAttribute(name, value);
      }

      // mark the image as serialized (can be targeted by CSS)
      img.setAttribute('data-percy-canvas-serialized', '');
      // set a default max width to account for canvases that might resize with JS
      img.style.maxWidth = img.style.maxWidth || '100%';

      // insert the image into the cloned DOM and remove the cloned canvas element
      let cloneEl = clone.querySelector(`[data-percy-element-id=${percyElementId}]`);
      // `parentElement` for elements directly under shadow root is `null` -> Incase of Nested Shadow DOM.
      if (cloneEl.parentElement) {
        cloneEl.parentElement.insertBefore(img, cloneEl);
      } else {
        clone.insertBefore(img, cloneEl);
      }
      cloneEl.remove();
    } catch (err) {
      handleErrors(err, 'Error serializing canvas element: ', canvas);
    }
  }
}

export default serializeCanvas;
