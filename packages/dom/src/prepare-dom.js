// Returns a mostly random uid.
export function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

export function markElement(domElement, disableShadowDOM, forceShadowDomAsLightDom) {
  // Mark elements that are to be serialized later with a data attribute.
  if (['input', 'textarea', 'select', 'iframe', 'canvas', 'video', 'style'].includes(domElement.tagName?.toLowerCase())) {
    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // add special marker for shadow host
  if (!disableShadowDOM && domElement.shadowRoot) {
    // When forceShadowDomAsLightDom is true, don't mark as shadow host
    if (!forceShadowDomAsLightDom) {
      domElement.setAttribute('data-percy-shadow-host', '');
    }

    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }
}

export default markElement;
