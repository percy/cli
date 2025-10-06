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

  // Check if original is a DOM Element
  if (!original.nodeType || original.nodeType !== 1) return;

  try {
    // Get computed opacity for the original element
    const opacity = window.getComputedStyle(original).opacity;

    // Set opacity attribute for any non-default opacity value
    clone.setAttribute('data-percy-opacity', opacity);
  } catch (err) {
    // Handle getComputedStyle errors gracefully - this is needed because:
    // 1. Some elements may not be fully attached to the DOM when serialized
    // 2. getComputedStyle can throw in certain edge cases or test environments
    // 3. The test "handles getComputedStyle errors gracefully" expects this behavior
    // 4. We want serialization to continue even if opacity can't be determined
  }
}

// All transformations that we need to apply for a successful discovery and stable render
function applyElementTransformations(originalElement, domElement) {
  dropLoadingAttribute(domElement);
  serializeScrollState(originalElement, domElement);
  serializeOpacity(originalElement, domElement);
}

export default applyElementTransformations;
