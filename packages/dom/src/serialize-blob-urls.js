// Helper: Generate unique ID for resources
function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper: Create resource from data URL
function resourceFromDataURL(id, dataURL) {
  let [data, content] = dataURL.split(',');
  let [, mimetype] = data.split(':');
  [mimetype] = mimetype.split(';');
  let [, ext] = mimetype.split('/');
  let path = `/__serialized__/${id}.${ext}`;
  let url = new URL(path, document.URL).toString();

  return { url, content, mimetype };
}

// Find all blob URLs in the DOM
function findAllBlobUrls(dom) {
  const blobUrls = [];

  // Find blob URLs in src attributes (img, video, audio, source, iframe)
  const elementsWithSrc = dom.querySelectorAll('[src^="blob:"]');
  for (const el of elementsWithSrc) {
    if (!el.getAttribute('data-percy-element-id')) {
      el.setAttribute('data-percy-element-id', uid());
    }
    blobUrls.push({
      element: el,
      blobUrl: el.src,
      property: 'src',
      id: el.getAttribute('data-percy-element-id')
    });
  }

  // Find blob URLs in href attributes
  const elementsWithHref = dom.querySelectorAll('[href^="blob:"]');
  for (const el of elementsWithHref) {
    if (!el.getAttribute('data-percy-element-id')) {
      el.setAttribute('data-percy-element-id', uid());
    }
    blobUrls.push({
      element: el,
      blobUrl: el.href,
      property: 'href',
      id: el.getAttribute('data-percy-element-id')
    });
  }

  // Find blob URLs in inline styles (background-image, etc.)
  const allElements = dom.querySelectorAll('*');
  for (const el of allElements) {
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle && inlineStyle.includes('blob:')) {
      const blobMatches = inlineStyle.match(/url\(["']?(blob:[^"')]+)["']?\)/g);
      if (blobMatches) {
        if (!el.getAttribute('data-percy-element-id')) {
          el.setAttribute('data-percy-element-id', uid());
        }
        for (const match of blobMatches) {
          const urlMatch = match.match(/url\(["']?(blob:[^"')]+)["']?\)/);
          if (urlMatch) {
            blobUrls.push({
              element: el,
              blobUrl: urlMatch[1],
              property: 'style',
              id: el.getAttribute('data-percy-element-id')
            });
          }
        }
      }
    }
  }

  return blobUrls;
}

// Convert blob URL to Percy resource (async)
async function convertBlobToResource(blobInfo) {
  const { element, blobUrl, property, id } = blobInfo;

  try {
    // Fetch the blob data
    const response = await fetch(blobUrl);
    const blob = await response.blob();

    // Convert blob to data URL using FileReader
    const dataUrl = await new Promise((resolve, reject) => {
      /* eslint-disable-next-line no-undef */
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Create Percy resource
    const resource = resourceFromDataURL(id, dataUrl);

    // Update element to use resource URL instead of blob URL
    if (property === 'src') {
      element.removeAttribute('src');
      element.setAttribute('data-percy-serialized-attribute-src', resource.url);
    } else if (property === 'href') {
      element.removeAttribute('href');
      element.setAttribute('data-percy-serialized-attribute-href', resource.url);
    } else if (property === 'style') {
      const currentStyle = element.getAttribute('style');
      const updatedStyle = currentStyle.replace(blobUrl, resource.url);
      element.setAttribute('style', updatedStyle);
    }

    return resource;
  } catch (err) {
    throw new Error(`Failed to convert blob URL ${blobUrl}: ${err.message}`);
  }
}

// Process lazy-loaded images (data-src to src)
function processLazyLoadedImages(dom) {
  const lazyImages = dom.querySelectorAll('img[data-src], source[data-src]');
  let processedCount = 0;

  for (const el of lazyImages) {
    const dataSrc = el.getAttribute('data-src');
    if (dataSrc) {
      try {
        const url = new URL(dataSrc, window.location.origin);
        if (['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) {
          el.setAttribute('src', url.href);
          processedCount++;
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }

  return processedCount;
}

// Preprocess dynamic resources (async) - runs before cloning
export default async function preprocessDynamicResources(dom, resources, warnings) {
  const processedResources = [];

  // 1. Process lazy-loaded images
  const lazyCount = processLazyLoadedImages(dom);
  if (lazyCount > 0) {
    console.debug(`Percy: Processed ${lazyCount} lazy-loaded images`);
  }

  // 2. Find all blob URLs
  const blobUrls = findAllBlobUrls(dom);

  if (blobUrls.length > 0) {
    console.debug(`Percy: Found ${blobUrls.length} blob URLs to convert`);

    // 3. Convert all blob URLs to resources (parallel)
    const conversions = blobUrls.map(blobInfo =>
      convertBlobToResource(blobInfo)
        .then(resource => {
          resources.add(resource);
          processedResources.push(resource);
          return resource;
        })
        .catch(err => {
          warnings.add(err.message);
          console.warn(`Percy: ${err.message}`);
          return null;
        })
    );

    // Wait for all conversions
    await Promise.all(conversions);

    const successCount = processedResources.length;
    console.debug(`Percy: Successfully converted ${successCount}/${blobUrls.length} blob URLs`);
  }

  return processedResources;
}
