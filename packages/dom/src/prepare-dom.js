// Returns a mostly random uid.
export function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

export function markElement(domElement, disableShadowDOM, forceShadowAsLightDOM, ctx) {
  // Mark elements that are to be serialized later with a data attribute.
  if (['input', 'textarea', 'select', 'iframe', 'canvas', 'video', 'style'].includes(domElement.tagName?.toLowerCase())) {
    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // add special marker for shadow host
  if (!disableShadowDOM && domElement.shadowRoot) {
    // When forceShadowAsLightDOM is true, don't mark as shadow host
    if (!forceShadowAsLightDOM) {
      domElement.setAttribute('data-percy-shadow-host', '');
    }

    if (!domElement.getAttribute('data-percy-element-id')) {
      domElement.setAttribute('data-percy-element-id', uid());
    }
  }

  // Detect possible closed shadow roots on custom elements (R6)
  if (!disableShadowDOM && !domElement.shadowRoot && domElement.tagName?.includes('-')) {
    try {
      const ctor = window.customElements?.get(domElement.tagName.toLowerCase());
      if (ctor) {
        // R6 Part B: Mark for renderer scoped screenshot
        const rect = domElement.getBoundingClientRect?.();
        if (rect) {
          domElement.setAttribute('data-percy-closed-shadow', JSON.stringify({
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }));
        }
        if (!domElement.getAttribute('data-percy-element-id')) {
          domElement.setAttribute('data-percy-element-id', uid());
        }
        if (ctx?.warnings) {
          ctx.warnings.add(
            `Possible closed shadow root on <${domElement.tagName.toLowerCase()}> — content cannot be captured`
          );
        }
      }
    } catch (e) {
      // Ignore errors from customElements.get()
    }
  }

  // R-new3: Detect possibly unhydrated custom elements
  // Registered custom element with an open shadow root but empty content
  if (!disableShadowDOM && domElement.shadowRoot && domElement.tagName?.includes('-')) {
    if (domElement.shadowRoot.childNodes.length === 0) {
      if (ctx?.warnings) {
        ctx.warnings.add(
          `Custom element <${domElement.tagName.toLowerCase()}> has empty shadow root — may not be hydrated`
        );
      }
    }
  }
}

export default markElement;
