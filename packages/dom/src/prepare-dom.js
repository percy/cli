// Returns a mostly random uid.
function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

export function markElement(domElement) {
  // Mark elements that are to be serialized later with a data attribute.
  if (['input', 'textarea', 'select', 'iframe', 'canvas', 'video', 'style'].includes(domElement.tagName?.toLowerCase())) {
    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // add special marker for shadow host
  if (domElement.shadowRoot) {
    if (!domElement.getAttribute('data-percy-shadow-host')) {
      domElement.setAttribute('data-percy-shadow-host', '');
    }

    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }
}

export default markElement;
