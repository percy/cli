// Drop loading attribute. We do not scroll page in discovery stage but we want to make sure that
// all resources are requested, so we drop loading attribute [as it can be set to lazy]
function dropLoadingAttribute(domElement) {
  if (!['img', 'iframe'].includes(domElement.tagName?.toLowerCase())) return;
  domElement.removeAttribute('loading');
}

// All transformations that we need to apply for a successful discovery and stable render
export function maybeTranformElement(domElement) {
  dropLoadingAttribute(domElement);
}
