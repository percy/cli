import { getShadowRoot } from './shadow-utils';

// Returns a mostly random uid.
export function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

export function markElement(domElement, disableShadowDOM, forceShadowAsLightDOM) {
  // Mark elements that are to be serialized later with a data attribute.
  // Custom elements with ElementInternals or closed shadow roots also get
  // stamped so the post-clone state-fallback can locate their clones.
  let isCustomElement = domElement.tagName?.includes('-');
  if (
    ['input', 'textarea', 'select', 'iframe', 'canvas', 'video', 'style', 'dialog'].includes(domElement.tagName?.toLowerCase()) ||
    isCustomElement
  ) {
    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // add special marker for shadow host (including closed shadow roots intercepted by preflight)
  let shadowRoot = getShadowRoot(domElement);
  if (!disableShadowDOM && shadowRoot) {
    // When forceShadowAsLightDOM is true, don't mark as shadow host
    if (!forceShadowAsLightDOM) {
      domElement.setAttribute('data-percy-shadow-host', '');
    }

    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }
}

export default markElement;
