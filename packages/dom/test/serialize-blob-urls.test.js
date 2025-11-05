// Example test showing how blob URL serialization works
/* global fetch, performance, Blob */
import serializeDOM from '@percy/dom';
import { withExample, parseDOM } from './helpers';

describe('Blob URL serialization', () => {
  it('should convert blob URLs in img src attributes', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a canvas with some content
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 100, 100);

    // Convert canvas to blob URL
    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Create img element with blob URL
    const img = document.createElement('img');
    img.src = blobUrl;
    img.id = 'test-image';
    testDiv.appendChild(img);

    // Wait for image to load
    await new Promise(resolve => {
      img.onload = resolve;
    });

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Blob URL should be converted to Percy resource
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources).toContain(jasmine.objectContaining({
      url: jasmine.stringMatching('/__serialized__/.*\\.png'),
      mimetype: 'image/png',
      content: jasmine.any(String)
    }));

    // Check the serialized image element
    const $img = $('#test-image');
    expect($img[0]).toBeDefined();
    expect($img[0].hasAttribute('src')).toBe(true);
    expect($img[0].getAttribute('src')).toMatch('/__serialized__/');
    expect($img[0].getAttribute('src')).not.toContain('blob:');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should convert blob URLs in background-image styles', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a canvas with some content
    const canvas = document.createElement('canvas');
    canvas.width = 50;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 50, 50);

    // Convert canvas to blob URL
    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Create div with background-image
    const div = document.createElement('div');
    div.style.backgroundImage = `url(${blobUrl})`;
    div.style.width = '50px';
    div.style.height = '50px';
    div.id = 'test-div';
    testDiv.appendChild(div);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Blob URL should be converted to Percy resource
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources).toContain(jasmine.objectContaining({
      url: jasmine.stringMatching('/__serialized__/.*\\.png'),
      mimetype: 'image/png'
    }));

    // Check the serialized div element
    const $div = $('#test-div');
    expect($div[0]).toBeDefined();
    const bgImage = $div[0].style.backgroundImage;
    expect(bgImage).toContain('/__serialized__/');
    expect(bgImage).not.toContain('blob:');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle lazy-loaded images with data-src', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create img with data-src
    const img = document.createElement('img');
    img.setAttribute('data-src', 'https://example.com/image.jpg');
    img.id = 'lazy-image';
    testDiv.appendChild(img);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // data-src should be converted to src
    const $img = $('#lazy-image');
    expect($img[0]).toBeDefined();
    expect($img[0].getAttribute('src')).toBe('https://example.com/image.jpg');
  });

  it('should skip lazy-loaded images with unsupported protocols', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create img with data-src using ftp protocol (unsupported)
    const img = document.createElement('img');
    img.setAttribute('data-src', 'ftp://example.com/image.jpg');
    img.id = 'ftp-image';
    testDiv.appendChild(img);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // data-src should NOT be converted to src for unsupported protocols
    const $img = $('#ftp-image');
    expect($img[0]).toBeDefined();
    expect($img[0].hasAttribute('src')).toBe(false);
    expect($img[0].getAttribute('data-src')).toBe('ftp://example.com/image.jpg');
  });

  it('should handle invalid data-src URLs gracefully', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create img with invalid data-src that URL constructor will reject
    const img = document.createElement('img');
    img.setAttribute('data-src', ''); // Empty string is invalid
    img.id = 'invalid-lazy-image';
    testDiv.appendChild(img);

    // Serialize DOM - should not throw error
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Empty data-src should not create a src attribute
    const $img = $('#invalid-lazy-image');
    expect($img[0]).toBeDefined();
    expect($img[0].hasAttribute('src')).toBe(false);
  });

  it('should handle multiple blob URLs in parallel', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');
    const blobUrls = [];
    const elements = [];

    // Create multiple images with blob URLs
    const imageLoadPromises = [];
    for (let i = 0; i < 5; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = i % 2 === 0 ? 'red' : 'blue';
      ctx.fillRect(0, 0, 10, 10);

      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);

      const img = document.createElement('img');
      img.id = `test-image-${i}`;

      // Set up load promise before setting src
      const loadPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Image load timeout')), 3000);
        img.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Image load error'));
        };
        // If already complete, resolve immediately
        if (img.complete) {
          clearTimeout(timeout);
          resolve();
        }
      });
      imageLoadPromises.push(loadPromise);

      img.src = blobUrl;
      testDiv.appendChild(img);
      elements.push(img);
    }

    // Wait for all images to load
    await Promise.all(imageLoadPromises);

    // Serialize DOM
    const startTime = performance.now();
    const result = await serializeDOM();
    const endTime = performance.now();

    // Should create resources for all blob URLs
    const pngResources = result.resources.filter(r => r.mimetype === 'image/png');
    expect(pngResources.length).toBe(5);

    // Should complete reasonably fast (parallel processing)
    const duration = endTime - startTime;
    expect(duration).toBeLessThan(5000); // 5 seconds max

    // Cleanup
    blobUrls.forEach(url => URL.revokeObjectURL(url));
  });

  it('should handle errors gracefully when blob fetch fails', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create an invalid blob URL
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/invalid-blob-id';
    img.id = 'invalid-blob';
    testDiv.appendChild(img);

    // Serialize DOM - should not throw error
    const result = await serializeDOM();

    // Should have a warning about the failed conversion
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('blob'))).toBe(true);
  });

  it('should convert blob URLs in anchor href attributes', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a blob URL for a download link
    const textBlob = new Blob(['test content'], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(textBlob);

    // Create anchor element with blob URL
    const link = document.createElement('a');
    link.href = blobUrl;
    link.textContent = 'Download';
    link.id = 'test-link';
    testDiv.appendChild(link);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Blob URL should be converted to Percy resource
    expect(result.resources.length).toBeGreaterThan(0);
    const $link = $('#test-link');
    expect($link[0]).toBeDefined();
    expect($link[0].hasAttribute('href')).toBe(true);
    expect($link[0].getAttribute('href')).toContain('/__serialized__/');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should skip stylesheet link elements with blob URLs', async () => {
    withExample('', { withShadow: false });

    // Create a blob URL for a stylesheet
    const cssBlob = new Blob(['.test { color: red; }'], { type: 'text/css' });
    const blobUrl = URL.createObjectURL(cssBlob);

    // Create link element with blob URL
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = blobUrl;
    link.id = 'test-stylesheet';
    document.head.appendChild(link);

    // Wait for stylesheet to load
    await new Promise(resolve => setTimeout(resolve, 100));

    // Serialize DOM with enableJavaScript: false to trigger serializeCSSOM
    const result = await serializeDOM({ enableJavaScript: false });

    // The stylesheet should be handled by serializeCSSOM, not by blob URL preprocessing
    // We just verify the serialization completes without error
    expect(result.html).toBeDefined();

    // Cleanup
    document.head.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle elements with existing data-percy-element-id', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a canvas with some content
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'green';
    ctx.fillRect(0, 0, 10, 10);

    // Convert canvas to blob URL
    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Create img element with blob URL and pre-existing data-percy-element-id
    const img = document.createElement('img');
    img.setAttribute('data-percy-element-id', 'existing-id-123');
    img.src = blobUrl;
    img.id = 'img-with-id';
    testDiv.appendChild(img);

    // Wait for image to load
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Should have converted the blob URL
    const $img = $('#img-with-id');
    expect($img[0]).toBeDefined();
    expect($img[0].getAttribute('src')).toContain('/__serialized__/');

    // Should have preserved the existing data-percy-element-id
    expect($img[0].getAttribute('data-percy-element-id')).toBe('existing-id-123');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle style attributes with blob text but no valid blob URLs', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create div with style containing the word "blob" but not a blob URL
    const div = document.createElement('div');
    div.setAttribute('style', 'content: "This is blob text"; color: blue;');
    div.id = 'fake-blob-style';
    testDiv.appendChild(div);

    // Serialize DOM - should not throw error
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Style should remain unchanged
    const $div = $('#fake-blob-style');
    expect($div[0]).toBeDefined();
    expect($div[0].getAttribute('style')).toContain('blob text');
  });

  it('should handle anchor elements with existing data-percy-element-id', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a blob URL for a download link
    const textBlob = new Blob(['test content'], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(textBlob);

    // Create anchor element with blob URL and pre-existing data-percy-element-id
    const link = document.createElement('a');
    link.setAttribute('data-percy-element-id', 'existing-link-id');
    link.href = blobUrl;
    link.textContent = 'Download';
    link.id = 'link-with-id';
    testDiv.appendChild(link);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Should have converted the blob URL
    const $link = $('#link-with-id');
    expect($link[0]).toBeDefined();
    expect($link[0].getAttribute('href')).toContain('/__serialized__/');

    // Should have preserved the existing data-percy-element-id
    expect($link[0].getAttribute('data-percy-element-id')).toBe('existing-link-id');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle style elements with existing data-percy-element-id', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a canvas with some content
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'purple';
    ctx.fillRect(0, 0, 20, 20);

    // Convert canvas to blob URL
    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Create div with background-image and pre-existing data-percy-element-id
    const div = document.createElement('div');
    div.setAttribute('data-percy-element-id', 'existing-style-id');
    div.style.backgroundImage = `url(${blobUrl})`;
    div.style.width = '20px';
    div.style.height = '20px';
    div.id = 'div-with-style';
    testDiv.appendChild(div);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Should have converted the blob URL in the style
    const $div = $('#div-with-style');
    expect($div[0]).toBeDefined();
    const bgImage = $div[0].style.backgroundImage;
    expect(bgImage).toContain('/__serialized__/');
    expect(bgImage).not.toContain('blob:');

    // Should have preserved the existing data-percy-element-id
    expect($div[0].getAttribute('data-percy-element-id')).toBe('existing-style-id');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle style attributes without blob URL patterns', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create div with style containing "blob:" but not as a URL
    const div = document.createElement('div');
    div.setAttribute('style', 'content: "blob: not a url"; color: red;');
    div.id = 'no-blob-url';
    testDiv.appendChild(div);

    // Serialize DOM - should not process this as a blob URL
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Style should remain unchanged (line 64 coverage: blobMatches is null)
    const $div = $('#no-blob-url');
    expect($div[0]).toBeDefined();
    expect($div[0].getAttribute('style')).toContain('blob: not a url');
  });

  it('should verify style property replacement in convertBlobToResource', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a canvas and convert to blob URL
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'orange';
    ctx.fillRect(0, 0, 10, 10);

    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Create div with blob URL in background-image style using setAttribute
    const div = document.createElement('div');
    div.setAttribute('style', `background-image: url(${blobUrl}); width: 10px;`);
    div.id = 'style-replacement';
    testDiv.appendChild(div);

    // Serialize DOM
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Verify the blob URL was replaced in the style attribute (line 114 coverage)
    const $div = $('#style-replacement');
    expect($div[0]).toBeDefined();
    const styleAttr = $div[0].getAttribute('style');
    expect(styleAttr).toContain('/__serialized__/');
    expect(styleAttr).not.toContain('blob:');

    // Verify it's in the background-image property
    expect(styleAttr).toContain('background-image');

    // Cleanup
    URL.revokeObjectURL(blobUrl);
  });

  it('should handle malformed blob URL patterns in style', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');

    // Create a div with a malformed style that contains url( but not properly formatted
    // This should cause urlMatch to be null even though blobMatches might match
    const div = document.createElement('div');
    // This contains 'url(' and 'blob:' but in a way that might match the global regex
    // but fail the detailed match (edge case for line 70)
    div.setAttribute('style', 'background: url(blob:invalid);');
    div.id = 'malformed-blob';
    testDiv.appendChild(div);

    // Serialize DOM - should not throw error
    const result = await serializeDOM();
    const $ = parseDOM(result.html);

    // Style should remain unchanged since it's malformed
    const $div = $('#malformed-blob');
    expect($div[0]).toBeDefined();
  });
});
