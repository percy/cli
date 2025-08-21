/* global fetch, FileReader */
import serializeInputs from './serialize-inputs';
import serializeFrames from './serialize-frames';
import serializeCSSOM from './serialize-cssom';
import serializeCanvas from './serialize-canvas';
import serializeVideos from './serialize-video';
import { cloneNodeAndShadow, getOuterHTML } from './clone-dom';
import { uid, resourceFromDataURL } from './utils';

// Returns a copy or new doctype for a document.
function doctype(dom) {
  let { name = 'html', publicId = '', systemId = '' } = dom?.doctype ?? {};
  let deprecated = '';

  if (publicId && systemId) {
    deprecated = ` PUBLIC "${publicId}" "${systemId}"`;
  } else if (publicId) {
    deprecated = ` PUBLIC "${publicId}"`;
  } else if (systemId) {
    deprecated = ` SYSTEM "${systemId}"`;
  }

  return `<!DOCTYPE ${name}${deprecated}>`;
}

// Serializes and returns the cloned DOM as an HTML string
function serializeHTML(ctx) {
  let html = getOuterHTML(ctx.clone.documentElement, { shadowRootElements: ctx.shadowRootElements });
  // this is replacing serialized data tag with real tag
  html = html.replace(/(<\/?)data-percy-custom-element-/g, '$1');
  // replace serialized data attributes with real attributes
  html = html.replace(/ data-percy-serialized-attribute-(\w+?)=/ig, ' $1=');
  // include the doctype with the html string
  return doctype(ctx.dom) + html;
}

function serializeElements(ctx) {
  serializeInputs(ctx);
  serializeFrames(ctx);
  serializeVideos(ctx);

  if (!ctx.enableJavaScript) {
    serializeCSSOM(ctx);
    serializeCanvas(ctx);
  }

  for (const shadowHost of ctx.dom.querySelectorAll('[data-percy-shadow-host]')) {
    let percyElementId = shadowHost.getAttribute('data-percy-element-id');
    let cloneShadowHost = ctx.clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    if (shadowHost.shadowRoot && cloneShadowHost.shadowRoot) {
      // getHTML requires shadowRoot to be passed explicitly
      // to serialize the shadow elements properly
      ctx.shadowRootElements.push(cloneShadowHost.shadowRoot);
      serializeElements({
        ...ctx,
        dom: shadowHost.shadowRoot,
        clone: cloneShadowHost.shadowRoot
      });
    } else {
      ctx.warnings.add('data-percy-shadow-host does not have shadowRoot');
    }
  }
}

// Helper function to convert blob URL to data URL synchronously
function convertBlobToDataUrl(blobUrl) {
  try {
    console.log(`Percy: Converting blob URL: ${blobUrl}`);

    // For most blob URLs created from canvas, we can use a different strategy
    // Create a temporary image and use canvas to convert to data URL
    const img = document.createElement('img');
    img.style.display = 'none';
    document.body.appendChild(img);

    // Set the blob URL and wait for it to load
    img.src = blobUrl;

    // Check if image is already cached/loaded
    if (img.complete && img.naturalWidth > 0) {
      // Image is already loaded, convert immediately
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      document.body.removeChild(img);

      const dataUrl = canvas.toDataURL('image/png');
      console.log(`Percy: Successfully converted blob to data URL (immediate), length: ${dataUrl.length}`);
      return dataUrl;
    }

    // If not loaded immediately, we'll return null and let the async approach handle it
    document.body.removeChild(img);
    console.warn(`Percy: Could not convert blob URL synchronously: ${blobUrl}`);
    return null;
  } catch (err) {
    console.warn(`Percy: Exception converting blob URL "${blobUrl}": ${err.message}`);
    return null;
  }
}

// Handle dynamic resources like lazy-loaded images and blob URLs (synchronous version)
function handleDynamicResources(dom, resources = new Set()) {
  console.log('Percy: Handling dynamic resources on cloned DOM...');

  // Handle lazy-loaded images
  const images = dom.querySelectorAll('img');
  images.forEach(img => {
    const dataSrc = img.getAttribute('data-src');
    if (dataSrc) {
      try {
        // Only allow http, https, data, or blob URLs
        const url = new URL(dataSrc, window.location.origin);
        if (
          url.protocol === 'http:' ||
          url.protocol === 'https:' ||
          url.protocol === 'data:' ||
          url.protocol === 'blob:'
        ) {
          img.src = url.href;
          console.log('Percy: Converted data-src to src for lazy-loaded image');
        }
      } catch (e) {
        // If dataSrc is not a valid URL, ignore it
      }
    }
  });

  // Handle blob URLs in src attributes with synchronous conversion
  let blobCount = 0;
  let processedCount = 0;
  let convertedCount = 0;

  const elementsWithSrc = dom.querySelectorAll('img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"], source[src^="blob:"]');
  for (const el of elementsWithSrc) {
    const blobUrl = el.src;
    if (blobUrl && blobUrl.startsWith('blob:')) {
      blobCount++;
      console.log(`Percy: Attempting to convert blob src "${blobUrl}"`);

      // Mark element for serialization if not already marked
      if (!el.getAttribute('data-percy-element-id')) {
        el.setAttribute('data-percy-element-id', uid());
      }

      // Try synchronous conversion
      const dataUrl = convertBlobToDataUrl(blobUrl);
      if (dataUrl) {
        // Create resource from data URL instead of setting directly
        const percyElementId = el.getAttribute('data-percy-element-id');
        const resource = resourceFromDataURL(percyElementId, dataUrl);
        resources.add(resource);

        // Use serialized attribute pattern like canvas/video
        el.removeAttribute('src');
        el.setAttribute('data-percy-serialized-attribute-src', resource.url);
        convertedCount++;
        console.log(`Percy: Created resource for blob src in ${el.tagName.toLowerCase()}`);
      } else {
        console.warn(`Percy: Could not convert blob src "${blobUrl}" synchronously`);
      }
    }
  }

  // Also check for data URLs in src attributes (already converted)
  const elementsWithDataSrc = dom.querySelectorAll('img[src^="data:"], video[src^="data:"], audio[src^="data:"], source[src^="data:"]');
  processedCount += elementsWithDataSrc.length;
  if (elementsWithDataSrc.length > 0) {
    console.log('Percy: Found data URL in src attribute (converted from blob)');
  }

  // Handle blob URLs in inline styles with conversion
  const elements = Array.from(dom.querySelectorAll('*'));
  for (const el of elements) {
    try {
      // Check inline style attribute for blob URLs
      const inlineStyle = el.getAttribute('style') || '';
      if (inlineStyle.includes('blob:')) {
        console.log(`Percy: Processing blob URL in inline style: ${inlineStyle.substring(0, 100)}...`);

        // Mark element for serialization if not already marked
        if (!el.getAttribute('data-percy-element-id')) {
          el.setAttribute('data-percy-element-id', uid());
        }

        // Extract blob URLs from style and convert them
        const blobUrlMatches = inlineStyle.match(/url\(["']?(blob:[^"')]+)["']?\)/g);
        if (blobUrlMatches) {
          let updatedStyle = inlineStyle;

          for (const match of blobUrlMatches) {
            const blobUrlMatch = match.match(/url\(["']?(blob:[^"')]+)["']?\)/);
            if (blobUrlMatch && blobUrlMatch[1]) {
              const blobUrl = blobUrlMatch[1];
              blobCount++;

              const dataUrl = convertBlobToDataUrl(blobUrl);
              if (dataUrl) {
                // Create resource from data URL
                const percyElementId = el.getAttribute('data-percy-element-id');
                const resource = resourceFromDataURL(percyElementId, dataUrl);
                resources.add(resource);

                // Update style to use resource URL
                updatedStyle = updatedStyle.replace(blobUrl, resource.url);
                convertedCount++;
                console.log('Percy: Created resource for blob URL in inline style');
              } else {
                console.warn(`Percy: Could not convert blob URL "${blobUrl}" in inline style`);
              }
            }
          }

          // Update the element's style attribute if any conversions were made
          if (updatedStyle !== inlineStyle) {
            el.setAttribute('style', updatedStyle);
          }
        }
      }

      // Check for data URLs that were converted from blobs (good case)
      if (inlineStyle.includes('data:')) {
        processedCount++;
        console.log('Percy: Found data URL in cloned DOM (converted from blob)');
      }

      // For cloned DOM, we can also check href attributes
      if (el.href && el.href.startsWith('blob:')) {
        blobCount++;

        // Mark element for serialization if not already marked
        if (!el.getAttribute('data-percy-element-id')) {
          el.setAttribute('data-percy-element-id', uid());
        }

        const dataUrl = convertBlobToDataUrl(el.href);
        if (dataUrl) {
          // Create resource from data URL
          const percyElementId = el.getAttribute('data-percy-element-id');
          const resource = resourceFromDataURL(percyElementId, dataUrl);
          resources.add(resource);

          // Use serialized attribute pattern
          el.removeAttribute('href');
          el.setAttribute('data-percy-serialized-attribute-href', resource.url);
          convertedCount++;
          console.log('Percy: Created resource for blob href');
        } else {
          console.warn(`Percy: Found blob href "${el.href}" in cloned DOM but could not convert`);
        }
      }
    } catch (e) {
      // Ignore errors accessing element properties
    }
  }

  console.log(`Percy: Cloned DOM processing complete. Found ${blobCount} blob URLs, ${convertedCount} converted, ${processedCount} data URLs`);

  const remainingBlobs = blobCount - convertedCount;
  if (remainingBlobs > 0) {
    console.warn(`Percy: Warning: ${remainingBlobs} blob URLs could not be converted synchronously. For best results, call preprocessDynamicResources() on the original DOM before serializeDOM().`);
  }
}

// Pre-process dynamic resources asynchronously
async function preprocessDynamicResources(dom, resources = new Set()) {
  console.log('Percy: Pre-processing dynamic resources...');

  // Handle lazy-loaded images
  const images = dom.querySelectorAll('img');
  images.forEach(img => {
    const dataSrc = img.getAttribute('data-src');
    if (dataSrc) {
      try {
        // Only allow http, https, data, or blob URLs
        const url = new URL(dataSrc, window.location.origin);
        if (
          url.protocol === 'http:' ||
          url.protocol === 'https:' ||
          url.protocol === 'data:' ||
          url.protocol === 'blob:'
        ) {
          img.src = url.href;
          console.log('Percy: Converted data-src to src for lazy-loaded image');
        }
      } catch (e) {
        // If dataSrc is not a valid URL, ignore it
      }
    }
  });

  // Handle blob URLs in src attributes (images, videos, etc.)
  const elementsWithSrc = dom.querySelectorAll('img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"], source[src^="blob:"]');
  const srcPromises = [];

  for (const el of elementsWithSrc) {
    const blobUrl = el.src;
    if (blobUrl && blobUrl.startsWith('blob:')) {
      // Mark element for serialization if not already marked
      if (!el.getAttribute('data-percy-element-id')) {
        el.setAttribute('data-percy-element-id', uid());
      }

      const promise = fetch(blobUrl)
        .then(res => res.blob())
        .then(blob => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            // Create resource from data URL instead of setting directly
            const percyElementId = el.getAttribute('data-percy-element-id');
            const resource = resourceFromDataURL(percyElementId, reader.result);
            resources.add(resource);

            // Use serialized attribute pattern like canvas/video
            el.removeAttribute('src');
            el.setAttribute('data-percy-serialized-attribute-src', resource.url);
            console.log(`Percy: Created resource for blob src in ${el.tagName.toLowerCase()}`);
            resolve();
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }))
        .catch(err => {
          console.warn(`Percy: Failed to convert blob src "${blobUrl}": ${err.message}`);
        });

      srcPromises.push(promise);
    }
  }

  // Handle blob background images - the critical part for visual containers
  const elements = Array.from(dom.querySelectorAll('*'));
  const backgroundPromises = [];

  for (const el of elements) {
    try {
      // Check computed styles for blob URLs
      const style = window.getComputedStyle(el);
      const backgroundImage = style.getPropertyValue('background-image');

      if (backgroundImage && backgroundImage.includes('blob:')) {
        const blobUrlMatch = backgroundImage.match(/url\("?(blob:.+?)"?\)/);
        if (blobUrlMatch && blobUrlMatch[1]) {
          const blobUrl = blobUrlMatch[1];

          // Mark element for serialization if not already marked
          if (!el.getAttribute('data-percy-element-id')) {
            el.setAttribute('data-percy-element-id', uid());
          }

          const promise = fetch(blobUrl)
            .then(res => res.blob())
            .then(blob => new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                // Create resource from data URL
                const percyElementId = el.getAttribute('data-percy-element-id');
                const resource = resourceFromDataURL(percyElementId, reader.result);
                resources.add(resource);

                // Update the background image to use resource URL
                const newBackgroundImage = backgroundImage.replace(blobUrl, resource.url);
                el.style.backgroundImage = newBackgroundImage;
                console.log('Percy: Created resource for blob background-image');
                resolve();
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }))
            .catch(err => {
              console.warn(`Percy: Failed to process blob URL "${blobUrl}": ${err.message}`);
            });

          backgroundPromises.push(promise);
        }
      }
    } catch (err) {
      // Continue processing other elements if one fails
      console.warn(`Percy: Error processing element for blob URLs: ${err.message}`);
    }
  }

  // Wait for all conversions to complete
  const allPromises = [...srcPromises, ...backgroundPromises];
  if (allPromises.length > 0) {
    console.log(`Percy: Waiting for ${allPromises.length} blob conversions to complete...`);
    await Promise.all(allPromises);
    console.log('Percy: All blob conversions completed successfully');
  } else {
    console.log('Percy: No blob URLs found to convert');
  }
}

// Async wrapper for serializeDOM that includes automatic blob URL preprocessing
async function serializeDOMWithPreprocessing(options) {
  console.log('Percy: serializeDOMWithPreprocessing called with options:', options);
  let {
    dom = document
  } = options || {};

  // Create resources set for preprocessing
  const resources = new Set();

  // STEP 1: Automatically preprocess dynamic resources (convert blob URLs to data URLs)
  console.log('Percy: Auto-preprocessing dynamic resources...');
  try {
    await preprocessDynamicResources(dom, resources);
    console.log('Percy: Auto-preprocessing completed successfully');
  } catch (err) {
    console.warn(`Could not auto-preprocess dynamic resources: ${err.message}`);
  }

  // STEP 2: Call the synchronous serializeDOM with preprocessed DOM and pass resources
  return serializeDOM({
    ...options,
    _preprocessedResources: resources
  });
}

// This is used by SDK's in captureResponsiveSnapshot
export function waitForResize() {
  // if window resizeCount present means event listener was already present
  if (!window.resizeCount) {
    let resizeTimeout = false;
    window.addEventListener('resize', () => {
      if (resizeTimeout !== false) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => window.resizeCount++, 100);
    });
  }
  // always reset count 0
  window.resizeCount = 0;
}

// Serializes a document and returns the resulting DOM string.
export function serializeDOM(options) {
  let {
    dom = document,
    // allow snake_case or camelCase
    enableJavaScript = options?.enable_javascript,
    domTransformation = options?.dom_transformation,
    stringifyResponse = options?.stringify_response,
    disableShadowDOM = options?.disable_shadow_dom,
    reshuffleInvalidTags = options?.reshuffle_invalid_tags,
    ignoreCanvasSerializationErrors = options?.ignore_canvas_serialization_errors,
    _preprocessedResources = options?._preprocessedResources
  } = options || {};

  // keep certain records throughout serialization
  let ctx = {
    resources: _preprocessedResources || new Set(),
    warnings: new Set(),
    hints: new Set(),
    cache: new Map(),
    shadowRootElements: [],
    enableJavaScript,
    disableShadowDOM,
    ignoreCanvasSerializationErrors
  };

  ctx.dom = dom;
  ctx.clone = cloneNodeAndShadow(ctx);

  // Handle dynamic resources on the cloned DOM before serializing elements
  console.log('Percy: About to call handleDynamicResources on cloned DOM');
  try {
    handleDynamicResources(ctx.clone, ctx.resources);
    console.log('Percy: handleDynamicResources completed successfully on cloned DOM');
  } catch (err) {
    const errorMessage = `Could not handle dynamic resources: ${err.message}`;
    ctx.warnings.add(errorMessage);
    console.warn(errorMessage);
  }

  serializeElements(ctx);

  if (domTransformation) {
    try {
      // eslint-disable-next-line no-eval
      if (typeof (domTransformation) === 'string') domTransformation = window.eval(domTransformation);
      domTransformation(ctx.clone.documentElement);
    } catch (err) {
      let errorMessage = `Could not transform the dom: ${err.message}`;
      ctx.warnings.add(errorMessage);
      console.error(errorMessage);
    }
  }

  if (reshuffleInvalidTags) {
    let clonedBody = ctx.clone.body;
    while (clonedBody.nextSibling) {
      let sibling = clonedBody.nextSibling;
      clonedBody.append(sibling);
    }
  } else if (ctx.clone.body?.nextSibling) {
    ctx.hints.add('DOM elements found outside </body>');
  }

  let cookies = '';
  // Collecting cookies fail for about://blank page
  try {
    cookies = dom.cookie;
  } catch (err) /* istanbul ignore next */ /* Tested this part in discovery.test.js with about:blank page */ {
    const errorMessage = `Could not capture cookies: ${err.message}`;
    ctx.warnings.add(errorMessage);
    console.error(errorMessage);
  }

  let result = {
    html: serializeHTML(ctx),
    cookies: cookies,
    userAgent: navigator.userAgent,
    warnings: Array.from(ctx.warnings),
    resources: Array.from(ctx.resources),
    hints: Array.from(ctx.hints)
  };

  return stringifyResponse
    ? JSON.stringify(result)
    : result;
}

export default serializeDOM;

// Export the new functions for external use
export { preprocessDynamicResources, serializeDOMWithPreprocessing, convertBlobToDataUrl };
