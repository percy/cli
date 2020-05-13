// Serialize in-memory canvas elements into images.
export default function serializeCanvas(dom, clone) {
  for (let canvas of dom.querySelectorAll('canvas')) {
    let img = clone.createElement('img');

    // copy canvas element attributes to the image element such as style, class,
    // or data attributes that may be targeted by CSS
    for (let { name, value } of canvas.attributes) {
      img.setAttribute(name, value);
    }

    // Note: the `.toDataURL` API requires WebGL canvas elements to use
    // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
    // drawing buffer, which is cleared after each render for WebGL by default.
    img.src = canvas.toDataURL();

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
