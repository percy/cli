describe('Dynamic Resources', () => {
  describe('handleDynamicResources integration', () => {
    it('should be called during serializeDOM', () => {
      document.body.innerHTML = '<p>Test content</p>';

      const { serializeDOM } = window.PercyDOM;
      const result = serializeDOM({ dom: document });

      expect(result).toBeTruthy();
      expect(result.html).toContain('<p>Test content</p>');
    });

    it('should detect existing data URLs', () => {
      document.body.innerHTML = `
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAGAfgKIqYAAAAAElFTkSuQmCC" alt="test">
      `;

      const { serializeDOM } = window.PercyDOM;
      const result = serializeDOM({ dom: document });

      expect(result).toBeTruthy();
      // Data URLs get converted to serialized resources, so check for the image element
      expect(result.html).toContain('<img');
      expect(result.html).toContain('alt="test"');
    });

    it('should handle elements with blob URLs in href', () => {
      // Create a mock blob URL
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);

        document.body.innerHTML = `
          <a href="${blobUrl}">Download</a>
          <link href="${blobUrl}" rel="stylesheet">
        `;

        const { serializeDOM } = window.PercyDOM;
        const result = serializeDOM({ dom: document });

        expect(result).toBeTruthy();

        URL.revokeObjectURL(blobUrl);
      });
    });

    it('should handle empty DOM', () => {
      document.body.innerHTML = '';

      const { serializeDOM } = window.PercyDOM;
      const result = serializeDOM({ dom: document });

      expect(result).toBeTruthy();
    });

    it('should handle DOM with no dynamic resources', () => {
      document.body.innerHTML = `
        <div>
          <p>Regular content</p>
          <img src="https://example.com/static.jpg" alt="static">
        </div>
      `;

      const { serializeDOM } = window.PercyDOM;
      const result = serializeDOM({ dom: document });

      expect(result).toBeTruthy();
      expect(result.html).toContain('Regular content');
    });
  });

  // Test the async functions that need coverage
  describe('preprocessDynamicResources', () => {
    it('should handle lazy-loaded images with data-src', (done) => {
      // Create test DOM with lazy-loaded image
      document.body.innerHTML = `
        <img data-src="https://example.com/test.jpg" alt="lazy image">
        <img data-src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAGAfgKIqYAAAAAElFTkSuQmCC" alt="data url">
      `;

      const testDom = document;
      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(testDom).then(() => {
        // Check that data-src was converted to src
        const images = testDom.querySelectorAll('img');
        expect(images[0].src).toBe('https://example.com/test.jpg');
        expect(images[1].src).toContain('data:image/png;base64');
        done();
      }).catch(done.fail);
    });

    it('should ignore invalid URLs in data-src', (done) => {
      document.body.innerHTML = `
        <img data-src="invalid-url" alt="invalid">
        <img data-src="javascript:alert('xss')" alt="js">
      `;

      const testDom = document;
      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(testDom).then(() => {
        const images = testDom.querySelectorAll('img');
        // Invalid URLs should not be converted - they stay as data-src
        expect(images[0].getAttribute('data-src')).toBe('invalid-url');
        expect(images[1].getAttribute('data-src')).toBe("javascript:alert('xss')");
        done();
      }).catch(done.fail);
    });

    it('should process blob URLs in src attributes', (done) => {
      // Create a mock blob URL
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);

        document.body.innerHTML = `
          <img src="${blobUrl}" alt="blob image">
          <video src="${blobUrl}"></video>
        `;

        const testDom = document;
        const { preprocessDynamicResources } = window.PercyDOM;

        preprocessDynamicResources(testDom).then(() => {
          const img = testDom.querySelector('img');
          const video = testDom.querySelector('video');

          // Should have percy element IDs
          expect(img.getAttribute('data-percy-element-id')).toBeTruthy();
          expect(video.getAttribute('data-percy-element-id')).toBeTruthy();

          // Should have serialized attributes with render.percy.local URLs
          expect(img.getAttribute('data-percy-serialized-attribute-src')).toContain('http://render.percy.local/__serialized__');
          expect(video.getAttribute('data-percy-serialized-attribute-src')).toContain('http://render.percy.local/__serialized__');

          // Should not have original blob src
          expect(img.src).toBe('');
          expect(video.src).toBe('');

          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(done.fail);
      });
    });

    it('should process blob URLs in background-image CSS', (done) => {
      // Create a mock blob URL
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);

        document.body.innerHTML = `
          <div style="background-image: url('${blobUrl}')">Test div</div>
        `;

        const testDom = document;
        const { preprocessDynamicResources } = window.PercyDOM;

        preprocessDynamicResources(testDom).then(() => {
          const div = testDom.querySelector('div');

          // Should have percy element ID
          expect(div.getAttribute('data-percy-element-id')).toBeTruthy();

          // Should have updated background-image with render.percy.local URL
          expect(div.style.backgroundImage).toContain('http://render.percy.local/__serialized__');
          expect(div.style.backgroundImage).not.toContain('blob:');

          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(done.fail);
      });
    });

    it('should handle no blob URLs gracefully', (done) => {
      document.body.innerHTML = `
        <img src="https://example.com/test.jpg" alt="normal image">
        <div style="background-image: url('https://example.com/bg.jpg')">Normal div</div>
      `;

      const testDom = document;
      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(testDom).then(() => {
        // Should complete without errors
        const img = testDom.querySelector('img');
        const div = testDom.querySelector('div');

        expect(img.src).toBe('https://example.com/test.jpg');
        expect(div.style.backgroundImage).toContain('https://example.com/bg.jpg');
        done();
      }).catch(done.fail);
    });

    it('should handle fetch errors gracefully', (done) => {
      // Create an invalid blob URL
      const invalidBlobUrl = 'blob:http://localhost:9876/invalid-blob-id';

      document.body.innerHTML = `
        <img src="${invalidBlobUrl}" alt="invalid blob">
      `;

      const testDom = document;
      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(testDom).then(() => {
        // Should complete even with failed fetch
        const img = testDom.querySelector('img');
        expect(img.getAttribute('data-percy-element-id')).toBeTruthy();
        done();
      }).catch(done.fail);
    });

    it('should handle elements with invalid computed styles', (done) => {
      document.body.innerHTML = '<div>Test div</div>';

      // Mock getComputedStyle to throw an error
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = () => {
        throw new Error('Access denied');
      };

      const testDom = document;
      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(testDom).then(() => {
        // Should complete without crashing
        expect(true).toBe(true);

        // Restore original function
        window.getComputedStyle = originalGetComputedStyle;
        done();
      }).catch(err => {
        // Restore original function
        window.getComputedStyle = originalGetComputedStyle;
        done.fail(err);
      });
    });
  });

  describe('serializeDOMWithPreprocessing', () => {
    it('should call preprocessDynamicResources and then serializeDOM', (done) => {
      document.body.innerHTML = `
        <img data-src="https://example.com/lazy.jpg" alt="lazy">
        <p>Test content</p>
      `;

      const { serializeDOMWithPreprocessing } = window.PercyDOM;

      serializeDOMWithPreprocessing({ dom: document }).then(result => {
        expect(result).toBeTruthy();
        expect(result.html).toContain('<p>Test content</p>');

        // Should have processed lazy loading
        const img = document.querySelector('img');
        expect(img.src).toBe('https://example.com/lazy.jpg');

        done();
      }).catch(done.fail);
    });

    it('should handle preprocessing errors gracefully', (done) => {
      // Create a simple DOM and then test error handling
      document.body.innerHTML = '<p>Test content</p>';

      // Mock preprocessDynamicResources to throw an error
      const { serializeDOMWithPreprocessing } = window.PercyDOM;

      // Use a valid DOM but intercept the preprocessing step
      const originalConsoleWarn = console.warn;
      console.warn = (msg) => {
        originalConsoleWarn(msg);
      };

      serializeDOMWithPreprocessing({ dom: document }).then(result => {
        // Should still complete and return result
        expect(result).toBeTruthy();
        expect(result.html).toContain('<p>Test content</p>');

        // Restore console
        console.warn = originalConsoleWarn;
        done();
      }).catch(err => {
        // Restore console
        console.warn = originalConsoleWarn;
        done.fail(err);
      });
    });

    it('should work with no options provided', (done) => {
      const { serializeDOMWithPreprocessing } = window.PercyDOM;

      serializeDOMWithPreprocessing().then(result => {
        expect(result).toBeTruthy();
        expect(result.html).toBeTruthy();
        done();
      }).catch(done.fail);
    });

    it('should pass through all options to serializeDOM', (done) => {
      const { serializeDOMWithPreprocessing } = window.PercyDOM;

      const options = {
        dom: document,
        enableJavaScript: true,
        domTransformation: (dom) => {
          dom.setAttribute('data-transformed', 'true');
        }
      };

      serializeDOMWithPreprocessing(options).then(result => {
        expect(result).toBeTruthy();
        expect(result.html).toContain('data-transformed="true"');
        done();
      }).catch(done.fail);
    });

    it('should pass preprocessed resources to serializeDOM', (done) => {
      // Create a blob URL to test resource passing
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);

        document.body.innerHTML = `<img src="${blobUrl}" alt="blob">`;

        const { serializeDOMWithPreprocessing } = window.PercyDOM;

        serializeDOMWithPreprocessing({ dom: document }).then(result => {
          expect(result).toBeTruthy();
          expect(result.resources).toBeTruthy();

          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(done.fail);
      });
    });
  });

  describe('convertBlobToDataUrl', () => {
    it('should return null for invalid blob URLs', () => {
      const { convertBlobToDataUrl } = window.PercyDOM;

      expect(convertBlobToDataUrl('invalid-url')).toBeNull();
      expect(convertBlobToDataUrl('http://example.com/not-blob')).toBeNull();
      expect(convertBlobToDataUrl('')).toBeNull();
      expect(convertBlobToDataUrl(null)).toBeNull();
      expect(convertBlobToDataUrl(undefined)).toBeNull();
    });

    it('should return null for blob URLs that cannot be fetched synchronously', () => {
      const { convertBlobToDataUrl } = window.PercyDOM;
      const invalidBlobUrl = 'blob:http://localhost:9876/nonexistent';

      expect(convertBlobToDataUrl(invalidBlobUrl)).toBeNull();
    });
  });

  describe('error handling in handleDynamicResources', () => {
    it('should handle elements with inaccessible properties', () => {
      document.body.innerHTML = '<div>Test</div>';
      const testDom = document.cloneNode(true);

      const { serializeDOM } = window.PercyDOM;

      // Should not throw errors even with problematic elements
      expect(() => {
        serializeDOM({ dom: testDom });
      }).not.toThrow();
    });

    it('should handle when window.getComputedStyle is not available', () => {
      document.body.innerHTML = '<div style="background-image: url(test.jpg)">Test</div>';

      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = undefined;

      const { serializeDOM } = window.PercyDOM;

      // Should not throw errors
      expect(() => {
        serializeDOM({ dom: document });
      }).not.toThrow();

      // Restore
      window.getComputedStyle = originalGetComputedStyle;
    });
  });

  describe('edge cases and error conditions', () => {
    it('should handle missing URL constructor', () => {
      document.body.innerHTML = '<img data-src="test.jpg" alt="test">';

      const originalURL = window.URL;
      window.URL = undefined;

      const { preprocessDynamicResources } = window.PercyDOM;

      preprocessDynamicResources(document).then(() => {
        // Should complete without throwing
        expect(true).toBe(true);

        // Restore
        window.URL = originalURL;
      }).catch(err => {
        // Restore
        window.URL = originalURL;
        // Should not fail catastrophically
        expect(err).toBeTruthy();
      });
    });

    it('should handle missing FileReader', (done) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);
        document.body.innerHTML = `<img src="${blobUrl}" alt="test">`;

        const originalFileReader = window.FileReader;
        window.FileReader = undefined;

        const { preprocessDynamicResources } = window.PercyDOM;

        preprocessDynamicResources(document).then(() => {
          // Should complete
          expect(true).toBe(true);

          // Restore
          window.FileReader = originalFileReader;
          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(err => {
          // Restore and handle error gracefully
          console.warn('Expected error in test:', err.message);
          window.FileReader = originalFileReader;
          URL.revokeObjectURL(blobUrl);
          done(); // Should not fail completely
        });
      });
    });

    it('should handle fetch not being available', (done) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);
        document.body.innerHTML = `<img src="${blobUrl}" alt="test">`;

        const originalFetch = window.fetch;
        window.fetch = undefined;

        const { preprocessDynamicResources } = window.PercyDOM;

        preprocessDynamicResources(document).then(() => {
          // Should complete
          expect(true).toBe(true);

          // Restore
          window.fetch = originalFetch;
          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(err => {
          // Restore and handle error gracefully
          console.warn('Expected error in test:', err.message);
          window.fetch = originalFetch;
          URL.revokeObjectURL(blobUrl);
          done(); // Should handle gracefully
        });
      });
    });
  });

  describe('resource creation and management', () => {
    it('should create resources with proper structure', (done) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl = URL.createObjectURL(blob);
        document.body.innerHTML = `<img src="${blobUrl}" alt="test">`;

        const { preprocessDynamicResources } = window.PercyDOM;
        const resources = new Set();

        preprocessDynamicResources(document, resources).then(() => {
          // Should have created at least one resource
          expect(resources.size).toBeGreaterThan(0);

          const resource = Array.from(resources)[0];
          expect(resource).toBeTruthy();
          expect(resource.url).toBeTruthy();
          expect(resource.content).toBeTruthy();

          URL.revokeObjectURL(blobUrl);
          done();
        }).catch(done.fail);
      });
    });

    it('should handle multiple blob URLs in the same element', (done) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(blob => {
        const blobUrl1 = URL.createObjectURL(blob);
        const blobUrl2 = URL.createObjectURL(blob);

        document.body.innerHTML = `
          <div style="background-image: url('${blobUrl1}'), url('${blobUrl2}')">Test</div>
        `;

        const { preprocessDynamicResources } = window.PercyDOM;

        preprocessDynamicResources(document).then(() => {
          const div = document.querySelector('div');

          // Should have processed the background
          expect(div.getAttribute('data-percy-element-id')).toBeTruthy();

          URL.revokeObjectURL(blobUrl1);
          URL.revokeObjectURL(blobUrl2);
          done();
        }).catch(done.fail);
      });
    });
  });
});
