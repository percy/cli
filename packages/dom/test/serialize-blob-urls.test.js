// Example test showing how blob URL serialization works
/* global fetch, performance */
import serializeDOM from '@percy/dom';
import { withExample } from './helpers';

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
    const result = await serializeDOM({ dom: testDiv });

    // Blob URL should be converted to Percy resource
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources).toContain(jasmine.objectContaining({
      url: jasmine.stringMatching('/__serialized__/.*\\.png'),
      mimetype: 'image/png',
      content: jasmine.any(String)
    }));

    // HTML should use serialized attribute instead of blob URL
    expect(result.html).not.toContain('blob:');
    expect(result.html).toContain('data-percy-serialized-attribute-src');
    expect(result.html).toContain('/__serialized__/');

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
    const result = await serializeDOM({ dom: testDiv });

    // Blob URL should be converted to Percy resource
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources).toContain(jasmine.objectContaining({
      url: jasmine.stringMatching('/__serialized__/.*\\.png'),
      mimetype: 'image/png'
    }));

    // HTML should use resource URL instead of blob URL
    expect(result.html).not.toContain('blob:');
    expect(result.html).toContain('/__serialized__/');

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
    const result = await serializeDOM({ dom: testDiv });

    // data-src should be converted to src
    expect(result.html).toContain('src="https://example.com/image.jpg"');
  });

  it('should handle multiple blob URLs in parallel', async () => {
    withExample('', { withShadow: false });
    const testDiv = document.getElementById('test');
    const blobUrls = [];
    const elements = [];

    // Create multiple images with blob URLs
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
      img.src = blobUrl;
      img.id = `test-image-${i}`;
      testDiv.appendChild(img);
      elements.push(img);
    }

    // Wait for all images to load
    await Promise.all(elements.map(img => new Promise(resolve => {
      img.onload = resolve;
    })));

    // Serialize DOM
    const startTime = performance.now();
    const result = await serializeDOM({ dom: testDiv });
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
    const result = await serializeDOM({ dom: testDiv });

    // Should have a warning about the failed conversion
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('blob'))).toBe(true);
  });
});
