import serializeDOM from './serialize-dom';

// Recursively serializes iframe documents into srcdoc attributes.
export default function serializeFrames(dom, clone, { enableJavaScript }) {
  for (let frame of dom.querySelectorAll('iframe')) {
    let percyElementId = frame.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript');

    // delete frames within the head since they usually break pages when
    // rerendered and do not effect the visuals of a page
    if (clone.head.contains(cloneEl)) {
      cloneEl.remove();

    // if the frame document is accessible and not empty, we can serialize it
    } else if (frame.contentDocument && frame.contentDocument.documentElement) {
      // js is enabled and this frame was built with js, don't serialize it
      if (enableJavaScript && builtWithJs) continue;

      // the frame has yet to load and wasn't built with js, it is unsafe to serialize
      if (!builtWithJs && !frame.contentWindow.performance.timing.loadEventEnd) continue;

      // recersively serialize contents
      let serialized = serializeDOM({
        dom: frame.contentDocument,
        enableJavaScript
      });

      // assign to srcdoc and remove src
      cloneEl.setAttribute('srcdoc', serialized);
      cloneEl.removeAttribute('src');

    // delete inaccessible frames built with js when js is disabled because they
    // break asset discovery by creating non-captured requests that hang
    } else if (!enableJavaScript && builtWithJs) {
      cloneEl.remove();
    }
  }
}
