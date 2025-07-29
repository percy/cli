import { resourceFromDataURL, handleErrors } from './utils.js';

// Helper function to create and insert image element
function createAndInsertImageElement(canvas, clone, percyElementId, srcAttribute = '') {
  let img = document.createElement('img');

  // copy canvas element attributes to the image element
  for (let { name, value } of canvas.attributes) {
    img.setAttribute(name, value);
  }

  // mark the image as serialized and set src attribute
  img.setAttribute('data-percy-canvas-serialized', '');
  img.setAttribute('data-percy-serialized-attribute-src', srcAttribute);

  // set a default max width to account for canvases that might resize with JS
  img.style.maxWidth = img.style.maxWidth || '100%';

  // insert the image into the cloned DOM and remove the cloned canvas element
  let cloneEl = clone.querySelector(`[data-percy-element-id=${percyElementId}]`);

  if (!cloneEl) {
    throw new Error(`Clone element not found for percy-element-id: ${percyElementId}`);
  }

  // `parentElement` for elements directly under shadow root is `null` -> Incase of Nested Shadow DOM.
  if (cloneEl.parentElement) {
    cloneEl.parentElement.insertBefore(img, cloneEl);
  } else {
    clone.insertBefore(img, cloneEl);
  }
  cloneEl.remove();
}

// Serialize in-memory canvas elements into images.
export function serializeCanvas(ctx) {
  let { dom, clone, resources, ignoreCanvasSerializationErrors } = ctx;

  for (let canvas of dom.querySelectorAll('canvas')) {
    let percyElementId = canvas.getAttribute('data-percy-element-id');

    try {
      // Note: the `.toDataURL` API requires WebGL canvas elements to use
      // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
      // drawing buffer, which is cleared after each render for WebGL by default.
      let dataUrl = canvas.toDataURL();

      // skip empty canvases
      if (!dataUrl || dataUrl === 'data:,') continue;

      // create a resource for the canvas data
      let resource = resourceFromDataURL(percyElementId, dataUrl);
      resources.add(resource);

      // create and insert image element with the resource URL
      createAndInsertImageElement(canvas, clone, percyElementId, resource.url);
    } catch (err) {
      if (ignoreCanvasSerializationErrors) {
        ctx.warnings.add('Error in serializeCanvas: ' + err.message);
        try {
          // create and insert image element with empty src
          createAndInsertImageElement(canvas, clone, percyElementId, '');
        } catch (fallbackErr) {
          ctx.warnings.add('Error creating fallback image element: ' + fallbackErr.message);
        }
      } else {
        handleErrors(err, 'Error serializing canvas element: ', canvas);
      }
    }
  }
}

export default serializeCanvas;
