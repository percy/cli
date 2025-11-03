import { when } from 'interactor.js';
import { assert, withExample, parseDOM, platforms, platformDOM, getTestBrowser, chromeBrowser, firefoxBrowser } from './helpers';
import serializeDOM from '@percy/dom';

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

      serialized = await serializeDOM();
      cache[platform].$ = parseDOM(serialized.html, platform);
    }
  }, 0); // frames may take a bit to load

  afterEach(() => {
    window.document.createDocumentFragment.calls.reset();
  });

  it('calls document.createDocumentFragment once for parent frame', async () => {
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
    beforeEach(async () => {
      $ = cache[platform].$;
    });

    afterEach(() => {
      document.querySelector('#frame-head').remove();
    });

    it(`${platform}: serializes iframes created with JS`, async () => {
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

    it(`${platform}: serializes iframes that have been interacted with`, async () => {
      expect($('#frame-input')[0].getAttribute('srcdoc')).toMatch(new RegExp([
        '^<!DOCTYPE html><html><head>',
        '.*?</head><body>',
        '<input data-percy-element-id=".+?" value="iframe with an input">',
        '</body></html>$'
      ].join('')));
    });

    it(`${platform}: does not serialize iframes with CORS`, async () => {
      expect($('#frame-external')[0].getAttribute('src')).toBe('https://example.com');
      expect($('#frame-external-fail')[0].getAttribute('src')).toBe('https://google.com');
      expect($('#frame-external')[0].getAttribute('srcdoc')).toBeNull();
      expect($('#frame-external-fail')[0].getAttribute('srcdoc')).toBeNull();
    });

    it(`${platform}: does not serialize iframes created by JS when JS is enabled`, async () => {
      const serializedDOM = await serializeDOM({ enableJavaScript: true }).html;
      $ = parseDOM(serializedDOM, platform);
      expect($('#frame-js')[0].getAttribute('src')).not.toBeNull();
      expect($('#frame-js')[0].getAttribute('srcdoc')).toBeNull();
      expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toBeNull();
    });

    it(`${platform}: does not serialize iframes without document elements`, async () => {
      expect($('#frame-empty')[0]).toBeDefined();
      expect($('#frame-empty')[0].getAttribute('srcdoc')).toBe('<input/>');
      expect($('#frame-empty-self')).toHaveSize(0);
    });

    it(`${platform}: removes iframes from the head element`, async () => {
      expect($('#frame-head')).toHaveSize(0);
    });

    it(`${platform}: removes inaccessible JS frames`, async () => {
      expect($('#frame-inject')).toHaveSize(0);
    });
  });
});
