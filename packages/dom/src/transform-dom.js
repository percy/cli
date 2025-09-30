// Drop loading attribute. We do not scroll page in discovery stage but we want to make sure that
// all resources are requested, so we drop loading attribute [as it can be set to lazy]
export function dropLoadingAttribute(domElement) {
  if (!['img', 'iframe'].includes(domElement.tagName?.toLowerCase())) return;
  domElement.removeAttribute('loading');
}

export function serializeScrollState(original, clone) {
  if (!original || !clone) return;

  // Check and set scrollTop if it exists and has a value
  if (typeof original.scrollTop === 'number' && original.scrollTop !== 0) {
    clone.setAttribute('data-percy-scrolltop', original.scrollTop.toString());
  }

  // Check and set scrollLeft if it exists and has a value
  if (typeof original.scrollLeft === 'number' && original.scrollLeft !== 0) {
    clone.setAttribute('data-percy-scrollleft', original.scrollLeft.toString());
  }
}

export function serializeOpacity(original, clone) {
  if (!original || !clone) return;

  try {
    // Get computed styles for the original element
    const styles = window.getComputedStyle(original);
    const opacity = styles.opacity;

    // Only set the opacity attribute if the element has an explicit opacity style
    // or if the computed opacity is not the default value of '1'
    const hasExplicitOpacity = original.style && original.style.opacity !== '';
    const isNonDefaultOpacity = opacity !== '1';

    if (hasExplicitOpacity || isNonDefaultOpacity) {
      clone.setAttribute('data-percy-opacity', opacity);
    }
  } catch (err) {
    // Silently handle any errors in getting computed styles
    // This prevents the serialization from failing due to opacity issues
  }
}

// All transformations that we need to apply for a successful discovery and stable render
function applyElementTransformations(originalElement, domElement) {
  dropLoadingAttribute(domElement);
  serializeScrollState(originalElement, domElement);
  serializeOpacity(originalElement, domElement);
}

export default applyElementTransformations;
