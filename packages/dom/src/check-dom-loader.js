// Determines if an element is visible
export function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity) > 0
  );
}

// Checks if an element is a loader element by traversing its children
export function isLoaderElement(el, maxDepth = 2, currentDepth = 0) {
  if (currentDepth >= maxDepth) return false;

  const children = el.children;
  if (children.length === 0) return true;

  for (let i = 0; i < children.length; i++) {
    if (!isLoaderElement(children[i], maxDepth, currentDepth + 1)) return false;
  }

  return true;
}

// Checks for loader elements in the DOM
export function checkForLoader() {
  const loaders = Array.from(document.querySelectorAll('*')).filter(el =>
    (typeof el.className === 'string' && el.className.includes('loader')) ||
    (typeof el.id === 'string' && el.id.includes('loader'))
  );

  return loaders.some(loader => {
    const parent = loader.parentElement;

    if (!isElementVisible(loader) || !isElementVisible(parent)) return false;
    if (!isLoaderElement(loader)) return false;

    const parentRect = parent.getBoundingClientRect();
    const loaderRect = loader.getBoundingClientRect();

    const viewportWidth = window.innerWidth;
    const viewportHeight = Math.max(
      document.documentElement.scrollHeight,
      window.innerHeight
    );

    if (parentRect.width > loaderRect.width && parentRect.height > loaderRect.height) {
      const widthPercentage = (parentRect.width / viewportWidth) * 100;
      const heightPercentage = (parentRect.height / viewportHeight) * 100;

      if (widthPercentage >= 75 && heightPercentage >= 75) {
        return true;
      }
    } else {
      const widthPercentage = (loaderRect.width / viewportWidth) * 100;
      const heightPercentage = (loaderRect.height / viewportHeight) * 100;

      if (widthPercentage >= 75 && heightPercentage >= 75) {
        return true;
      }
    }

    return false;
  });
}

export default { checkForLoader };
