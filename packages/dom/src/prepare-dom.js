import { getShadowRoot } from './shadow-utils';
import { isCustomElement } from './utils';

// Returns a mostly random uid.
export function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

export function markElement(domElement, disableShadowDOM, forceShadowAsLightDOM) {
  // Mark elements that are to be serialized later with a data attribute.
  // Custom elements with ElementInternals or closed shadow roots also get
  // stamped so the post-clone state-fallback can locate their clones.
  let tagName = domElement.tagName?.toLowerCase();
  // Stylesheet <link>s are stamped so the pseudo-class serializer can locate
  // the sheet's clone element and anchor its rewritten interactive-state rules
  // immediately after it — preserving the sheet's original cascade position
  // instead of appending at the end of <head> (PER-10077).
  let isStylesheetLink = tagName === 'link' &&
    /(^|\s)stylesheet(\s|$)/i.test(domElement.getAttribute('rel') || '');
  if (
    ['input', 'textarea', 'select', 'iframe', 'canvas', 'video', 'style', 'dialog'].includes(tagName) ||
    isStylesheetLink ||
    isCustomElement(domElement)
  ) {
    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // add special marker for shadow host (including closed shadow roots captured via CDP)
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
