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

// Serialize opacity state for elements that have opacity: 1 during capture
// This ensures elements that reached full visibility after animations remain visible
export function serializeOpacityState(original, clone) {
  if (!original || !clone) return;

  // Only process element nodes (not text nodes, comments, etc.)
  if (original.nodeType !== 1) return;

  try {
    // Only apply opacity preservation if element has clear signs of being animated
    // Check for data attributes or classes that suggest this element is animated
    const hasAnimationAttributes = original.hasAttribute('data-percy-opacity') ||
      original.classList.contains('fade-in') ||
      original.classList.contains('fade-out') ||
      original.classList.contains('animate') ||
      original.classList.contains('animated');
    
    // Check for explicit opacity style or animation properties
    const hasExplicitOpacity = original.style.opacity !== '';
    const computedStyle = window.getComputedStyle(original);
    const hasOpacityTransition = computedStyle.transition &&
      computedStyle.transition.includes('opacity') &&
      computedStyle.transition !== 'all 0s ease 0s';
    
    // Only proceed if there are clear indicators this element uses opacity animations
    if (hasAnimationAttributes || hasExplicitOpacity || hasOpacityTransition) {
      const opacity = computedStyle.opacity;
      
      // If opacity is 1 (fully visible), add a class to ensure it stays visible
      if (opacity === '1') {
        // Add percy-opacity-1 class to preserve the visible state
        const existingClasses = clone.getAttribute('class') || '';
        const newClasses = existingClasses ? `${existingClasses} percy-opacity-1` : 'percy-opacity-1';
        clone.setAttribute('class', newClasses);
      }
    }
  } catch (err) {
    // Silently handle any errors (e.g., if getComputedStyle fails)
    // This ensures serialization continues even if opacity detection fails
  }
}

// All transformations that we need to apply for a successful discovery and stable render
function applyElementTransformations(originalElement, domElement) {
  dropLoadingAttribute(domElement);
  serializeScrollState(originalElement, domElement);
  serializeOpacityState(originalElement, domElement);
}

export default applyElementTransformations;
