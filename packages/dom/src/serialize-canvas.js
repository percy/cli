// Serialize in-memory canvas elements into images.
export function serializeCanvas(dom, clone) {
  for (let canvas of dom.querySelectorAll('canvas')) {
    // Note: the `.toDataURL` API requires WebGL canvas elements to use
    // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
    // drawing buffer, which is cleared after each render for WebGL by default.
    let dataUrl = canvas.toDataURL();

    // skip empty canvases
    if (!dataUrl || dataUrl === 'data:,') continue;

    // create an image element in the cloned dom
    let img = clone.createElement('img');
    img.src = dataUrl;

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
    let percyElementId = canvas.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id=${percyElementId}]`);
    cloneEl.parentElement.insertBefore(img, cloneEl);
    cloneEl.remove();
  }
}

export default serializeCanvas;
