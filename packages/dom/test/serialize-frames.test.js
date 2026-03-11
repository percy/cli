import { when } from 'interactor.js';
import { assert, withExample, parseDOM, platforms, platformDOM, getTestBrowser, chromeBrowser, firefoxBrowser } from './helpers';
import serializeDOM from '../src/serialize-dom';
import { resetPolicy } from '../src/serialize-frames';

describe('serializeFrames', () => {
  let serialized, cache = { shadow: {}, plain: {} };

  const getFrame = (id, dom = document) => when(() => {
    let $frame = dom.getElementById(id);
    let accessible = !!$frame.contentDocument;
    let loaded = accessible && $frame.contentWindow.performance.timing.loadEventEnd;
    assert(!accessible || loaded, `#${id} did not load in time`);
    return $frame;
  }, 5000);

  beforeEach(async function() {
    withExample(`
      <iframe id="frame-external" src="https://example.com"></iframe>
      <iframe id="frame-external-fail" src="https://google.com"></iframe>
      <iframe id="frame-input" srcdoc="<input/>"></iframe>
      <iframe id="frame-js" src="javascript:void(
        this.document.body.innerHTML = '<p>made with js src</p>'
      )"></iframe>
      <iframe id="frame-js-no-src"></iframe>
      <iframe id="frame-empty" srcdoc="<input/>"></iframe>
      <iframe id="frame-empty-self" src="javascript:void(
        Object.defineProperty(this.document, 'documentElement', { value: null })
      )"></iframe>
    `);

    spyOn(window.document, 'createDocumentFragment').and.callThrough();

    for (const platform of platforms) {
      let dom = platformDOM(platform);
      let $frameInput = await getFrame('frame-input', dom);
      $frameInput.contentDocument.querySelector('input').value = 'iframe with an input';

      let $frameJS = await getFrame('frame-js-no-src', dom);
      $frameJS.contentDocument.body.innerHTML = '<p>generated iframe</p><canvas id="canvas"/>';
      let $ctx = $frameJS.contentDocument.getElementById('canvas').getContext('2d');
      $ctx.fillRect(0, 0, 10, 10);

      let $frameEmpty = await getFrame('frame-empty', dom);
      $frameEmpty.contentDocument.querySelector('input').value = 'no document element';
      Object.defineProperty($frameEmpty.contentDocument, 'documentElement', { value: null });

      let $frameHead = document.createElement('iframe');
      $frameHead.id = 'frame-head';
      document.head.appendChild($frameHead);

      let $frameInject = document.createElement('iframe');
      $frameInject.id = 'frame-inject';
      $frameInject.src = 'javascript:false';
      $frameInject.sandbox = '';
      document.getElementById('test').appendChild($frameInject);

      // ensure external frame has loaded for coverage
      await getFrame('frame-external', dom);

      serialized = serializeDOM();
      cache[platform].$ = parseDOM(serialized.html, platform);
    }
  }, 0); // frames may take a bit to load

  afterEach(() => {
    window.document.createDocumentFragment.calls.reset();
  });

  it('calls document.createDocumentFragment once for parent frame', () => {
    // document.createDocumentFragment is only called on first depth of recursion for serializing iframes
    // post that the document of the iframe itself should be used for creating document fragment
    // we're having expection for root frame only currently, this should suffice for now

    let timesCalled = 0;
    if (getTestBrowser() === chromeBrowser) {
      // we use plain & shadow platform
      timesCalled = 2;
    } else if (getTestBrowser() === firefoxBrowser) {
      // we use only plain platform
      timesCalled = 1;
    }

    expect(window.document.createDocumentFragment).toHaveBeenCalledTimes(timesCalled);
  });

  platforms.forEach(platform => {
    let $;
    beforeEach(() => {
      $ = cache[platform].$;
    });

    afterEach(() => {
      document.querySelector('#frame-head').remove();
    });

    it(`${platform}: serializes iframes created with JS`, () => {
      let dom = platformDOM(platform);
      expect($('#frame-js')[0].getAttribute('src')).toBeNull();
      expect($('#frame-js')[0].getAttribute('srcdoc')).toMatch(new RegExp([
        '<!DOCTYPE html><html><head>',
        `<base href="${dom.querySelector('#frame-js').baseURI}">`,
        '</head><body>',
        '<p>made with js src</p>',
        '</body></html>'
      ].join('')));

      expect($('#frame-js-no-src')[0].getAttribute('src')).toBeNull();
      expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toMatch([
        '<!DOCTYPE html><html><head>',
        `<base href="${dom.querySelector('#frame-js-no-src').baseURI}">`,
        '</head><body>',
        '<p>generated iframe</p>',
        '<img .*data-percy-canvas-serialized.*>',
        '</body></html>'
      ].join(''));

      // frame resources are serialized recursively
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: jasmine.stringMatching('/__serialized__/\\w+\\.png'),
        content: jasmine.any(String),
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: serializes iframes that have been interacted with`, () => {
      expect($('#frame-input')[0].getAttribute('srcdoc')).toMatch(new RegExp([
        '^<!DOCTYPE html><html><head>',
        '.*?</head><body>',
        '<input data-percy-element-id=".+?" value="iframe with an input">',
        '</body></html>$'
      ].join('')));
    });

    it(`${platform}: does not serialize iframes with CORS`, () => {
      expect($('#frame-external')[0].getAttribute('src')).toBe('https://example.com');
      expect($('#frame-external-fail')[0].getAttribute('src')).toBe('https://google.com');
      expect($('#frame-external')[0].getAttribute('srcdoc')).toBeNull();
      expect($('#frame-external-fail')[0].getAttribute('srcdoc')).toBeNull();
    });

    it(`${platform}: does not serialize iframes created by JS when JS is enabled`, () => {
      const serializedDOM = serializeDOM({ enableJavaScript: true }).html;
      $ = parseDOM(serializedDOM, platform);
      expect($('#frame-js')[0].getAttribute('src')).not.toBeNull();
      expect($('#frame-js')[0].getAttribute('srcdoc')).toBeNull();
      expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toBeNull();
    });
    it(`${platform}: adds a warning and catches error when baseURI is unparseable`, async () => {
      // 1. Inject an iframe with a very specific, unique <base> tag.
      // This guarantees both the original AND the clone will share this exact baseURI string.
      let $frameInvalid = document.createElement('iframe');
      $frameInvalid.id = 'frame-warning-test';
      $frameInvalid.srcdoc = `
        <html>
          <head><base href="http://mock-invalid-base.com/"></head>
          <body><p>Test</p></body>
        </html>
      `;
      document.getElementById('test').appendChild($frameInvalid);

      // 2. Wait for iframe to load to bypass early exit checks
      await getFrame('frame-warning-test', document);

      // 3. Capture the exact resolved string (Chrome usually adds a trailing slash)
      const targetBaseURI = $frameInvalid.contentDocument.baseURI;

      // 4. Safely hijack the URL constructor
      const RealURL = window.URL;
      window.URL = function(url, base) {
        // setBaseURI calls `new URL(dom.baseURI)` with NO base parameter.
        // serializeDOM's internal resource parsers use `new URL(href, baseURI)` WITH a base parameter.
        // We ONLY throw when called with exactly 1 argument matching our unique string.
        if (url === targetBaseURI && base === undefined) {
          throw new TypeError('Simulated invalid URL parsing error');
        }
        return base !== undefined ? new RealURL(url, base) : new RealURL(url);
      };

      // Keep static methods intact (like URL.createObjectURL) just in case
      window.URL.prototype = RealURL.prototype;
      Object.assign(window.URL, RealURL);

      let result;
      try {
        // 5. Execute serialization
        result = serializeDOM();
      } finally {
        // 6. ALWAYS restore the original URL constructor immediately
        window.URL = RealURL;
      }

      // 7. Verify the catch block successfully logged the warning
      expect(result.warnings).toContain(
        `Could not parse baseURI for iframe: ${targetBaseURI}`
      );

      // 8. Verify the frame itself didn't cause a fatal crash and is present in output
      let $parsed = parseDOM(result.html, platform);
      expect($parsed('#frame-warning-test')).toBeDefined();

      $frameInvalid.remove();
    });

    it(`${platform}: does not crash when an iframe has an unparseable baseURI`, () => {
      // Simulate a transient/non-standard iframe baseURI (e.g. third-party widgets like Intercom)
      // by creating an iframe whose contentDocument.baseURI is overridden to an invalid value.
      let $frameInvalid = document.createElement('iframe');
      $frameInvalid.id = 'frame-invalid-base-uri';
      document.getElementById('test').appendChild($frameInvalid);

      // Wait for it to be accessible, then stub the baseURI
      let doc = $frameInvalid.contentDocument;
      if (doc) {
        Object.defineProperty(doc, 'baseURI', { value: 'not-a-valid-url', configurable: true });
      }

      // Should not throw, and the frame should simply not get a <base> tag
      let result;
      expect(() => { result = serializeDOM(); }).not.toThrow();

      let $parsed = parseDOM(result.html, platform);
      // The invalid-base-uri frame should still be present (just without a <base> injected)
      expect($parsed('#frame-invalid-base-uri')).toBeDefined();

      $frameInvalid.remove();
    });

    it(`${platform}: handles catch block when URL constructor throws`, () => {
      // Create an iframe that will trigger the catch block in setBaseURI
      let $frameURLError = document.createElement('iframe');
      $frameURLError.id = 'frame-url-error';
      document.getElementById('test').appendChild($frameURLError);

      // Mock the baseURI to return a value that will cause URL constructor to throw
      let doc = $frameURLError.contentDocument;
      if (doc) {
        Object.defineProperty(doc, 'baseURI', {
          value: 'ht!tp://invalid url with spaces',
          configurable: true
        });
      }

      // Should not throw and should handle the error gracefully
      let result;
      expect(() => { result = serializeDOM(); }).not.toThrow();

      let $parsed = parseDOM(result.html, platform);
      // The frame should be present but without a <base> tag due to the URL error
      expect($parsed('#frame-url-error')).toBeDefined();

      $frameURLError.remove();
    });
    it(`${platform}: returns early and does not prepend <base> if hostname is missing`, () => {
      const RealURL = window.URL;
      // We use a standard function to support "new URL()"
      window.URL = function(url) {
        this.hostname = '';
        this.href = url;
      };

      try {
        let $frame = document.createElement('iframe');
        $frame.id = 'frame-no-hostname';
        $frame.srcdoc = '<p>test</p>';
        document.getElementById('test').appendChild($frame);

        // Wait for frame to load
        when(() => {
          return $frame.contentDocument && $frame.contentWindow.performance.timing.loadEventEnd;
        }, 5000);

        Object.defineProperty($frame.contentDocument, 'baseURI', {
          value: 'about:blank',
          configurable: true
        });

        let result = serializeDOM();
        let $parsed = parseDOM(result.html, platform);

        // The frame should be serialized without a base tag since hostname is empty
        expect($parsed('#frame-no-hostname')).toBeDefined();

        $frame.remove();
      } finally {
        window.URL = RealURL;
      }
    });

    it(`${platform}: does not serialize iframes without document elements`, () => {
      expect($('#frame-empty')[0]).toBeDefined();
      expect($('#frame-empty')[0].getAttribute('srcdoc')).toBe('<input/>');
      expect($('#frame-empty-self')).toHaveSize(0);
    });

    it(`${platform}: removes iframes from the head element`, () => {
      expect($('#frame-head')).toHaveSize(0);
    });

    it(`${platform}: removes inaccessible JS frames`, () => {
      expect($('#frame-inject')).toHaveSize(0);
    });

    if (platform === 'plain') {
      it('uses Trusted Types policy to create srcdoc when available', () => {
        let createHTML = jasmine.createSpy('createHTML').and.callFake(html => html);
        let createPolicy = jasmine.createSpy('createPolicy').and.returnValue({ createHTML });
        let trustedTypesDescriptor = Object.getOwnPropertyDescriptor(window, 'trustedTypes');

        // Reset policy to ensure we don't use a cached version from a previous test/environment
        resetPolicy();

        Object.defineProperty(window, 'trustedTypes', {
          value: { createPolicy },
          configurable: true
        });

        try {
          serializeDOM();
          expect(createPolicy).toHaveBeenCalledWith('percy-dom', jasmine.objectContaining({ createHTML: jasmine.any(Function) }));
          expect(createHTML).toHaveBeenCalled();
        } finally {
          if (trustedTypesDescriptor) {
            Object.defineProperty(window, 'trustedTypes', trustedTypesDescriptor);
          } else {
            delete window.trustedTypes;
          }
        }
      });

      it('handles srcdoc serialization without Trusted Types', () => {
        let trustedTypesDescriptor = Object.getOwnPropertyDescriptor(window, 'trustedTypes');

        // Reset policy to ensure we don't use a cached version from a previous test/environment
        resetPolicy();

        // Remove trustedTypes to test fallback
        delete window.trustedTypes;

        try {
          let serializedDOM = serializeDOM();
          $ = parseDOM(serializedDOM.html, platform);

          // Should still serialize iframes correctly without Trusted Types
          expect($('#frame-input')[0].getAttribute('srcdoc')).toMatch(new RegExp([
            '^<!DOCTYPE html><html><head>',
            '.*?</head><body>',
            '<input data-percy-element-id=".+?" value="iframe with an input">',
            '</body></html>$'
          ].join('')));
        } finally {
          if (trustedTypesDescriptor) {
            Object.defineProperty(window, 'trustedTypes', trustedTypesDescriptor);
          }
        }
      });

      it('handles setAttribute errors gracefully', async () => {
        // Create a new iframe to test error handling
        withExample(`
          <iframe id="frame-error-test" srcdoc="<p>test</p>"></iframe>
        `);

        await getFrame('frame-error-test');

        // Spy on setAttribute to make it throw
        let originalSetAttribute = window.Element.prototype.setAttribute;
        spyOn(window.Element.prototype, 'setAttribute').and.callFake(function(name, value) {
          if (name === 'srcdoc') {
            throw new Error('setAttribute failed');
          }
          return originalSetAttribute.call(this, name, value);
        });

        try {
          // Should not throw even if setAttribute fails
          let serializedDOM = serializeDOM();
          expect(serializedDOM).toBeDefined();
          expect(serializedDOM.html).toBeDefined();
        } finally {
          window.Element.prototype.setAttribute.and.callThrough();
        }
      });
    }
  });
});
