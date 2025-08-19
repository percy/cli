// Drop loading attribute. We do not scroll page in discovery stage but we want to make sure that
// all resources are requested, so we drop loading attribute [as it can be set to lazy]
export function dropLoadingAttribute(domElement) {
  if (!['img', 'iframe'].includes(domElement.tagName?.toLowerCase())) return;
  domElement.removeAttribute('loading');
}

export function serializeScrollState(clone, original) {
  if (original.scrollTop == 0 && original.scrollLeft == 0) return;
  clone.setAttribute('data-percy-scrollTop', original.scrollTop.toString())
  clone.setAttribute('data-percy-scrollLeft', original.scrollLeft.toString())
}

// All transformations that we need to apply for a successful discovery and stable render
function applyElementTransformations(domElement, originalElement) {
  dropLoadingAttribute(domElement);
  serializeScrollState(domElement, originalElement)
}

export default applyElementTransformations;
