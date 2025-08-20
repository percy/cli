// Drop loading attribute. We do not scroll page in discovery stage but we want to make sure that
// all resources are requested, so we drop loading attribute [as it can be set to lazy]
export function dropLoadingAttribute(domElement) {
  if (!['img', 'iframe'].includes(domElement.tagName?.toLowerCase())) return;
  domElement.removeAttribute('loading');
}

export function serializeScrollState(clone, original) {
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

// All transformations that we need to apply for a successful discovery and stable render
function applyElementTransformations(domElement, originalElement) {
  dropLoadingAttribute(domElement);
  serializeScrollState(domElement, originalElement);
}

export default applyElementTransformations;
