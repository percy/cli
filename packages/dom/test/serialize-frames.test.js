import I, { when } from 'interactor.js';
import { assert, expect, withExample, parseDOM } from 'test/helpers';
import serializeDOM from '@percy/dom';

describe('serializeFrames', () => {
  let $;

  const getFrame = id => when(() => {
    let $frame = document.getElementById(id);
    let accessible = !!$frame.contentDocument;
    let loaded = accessible && $frame.contentWindow.performance.timing.loadEventEnd;
    assert(!accessible || loaded, `#${id} did not load in time`);
    return $frame;
  }, 5000);

  beforeEach(async function() {
    this.timeout(0); // frames may take a bit to load

    withExample(`
      <iframe id="frame-external" src="https://example.com"></iframe>
      <iframe id="frame-external-fail" src="https://google.com"></iframe>
      <iframe id="frame-input" srcdoc="<input/>"></iframe>
      <iframe id="frame-js" src="javascript:void(
        this.document.body.innerHTML = '<p>made with js src</p>'
      )"></iframe>
      <iframe id="frame-js-no-src"></iframe>
    `);

    let $frameInput = await getFrame('frame-input');
    await I.type(() => $frameInput.contentDocument.querySelector('input'), 'iframe with an input');

    let $frameJS = await getFrame('frame-js-no-src');
    $frameJS.contentDocument.body.innerHTML = '<p>generated iframe</p>';

    let $frameHead = document.createElement('iframe');
    $frameHead.id = 'frame-head';
    document.head.appendChild($frameHead);

    let $frameInject = document.createElement('iframe');
    $frameInject.id = 'frame-inject';
    $frameInject.src = 'javascript:false';
    $frameInject.sandbox = '';
    document.getElementById('test').appendChild($frameInject);

    // ensure external frame has loaded for coverage
    await getFrame('frame-external');

    $ = parseDOM(serializeDOM());
  });

  afterEach(() => {
    document.querySelector('#frame-head').remove();
  });

  it('serializes iframes created with JS', () => {
    expect($('#frame-js')[0].getAttribute('src')).toBeUndefined();
    expect($('#frame-js')[0].getAttribute('srcdoc')).toBe([
      '<!DOCTYPE html><html><head></head><body>',
      '<p>made with js src</p>',
      '</body></html>'
    ].join(''));

    expect($('#frame-js-no-src')[0].getAttribute('src')).toBeUndefined();
    expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toBe([
      '<!DOCTYPE html><html><head></head><body>',
      '<p>generated iframe</p>',
      '</body></html>'
    ].join(''));
  });

  it('serializes iframes that have been interacted with', () => {
    expect($('#frame-input')[0].getAttribute('srcdoc')).toMatch(new RegExp([
      '^<!DOCTYPE html><html><head></head><body>',
      '<input data-percy-element-id=".+?" value="iframe with an input">',
      '</body></html>$'
    ].join('')));
  });

  it('does not serialize iframes with CORS', () => {
    expect($('#frame-external')[0].getAttribute('src')).toBe('https://example.com');
    expect($('#frame-external-fail')[0].getAttribute('src')).toBe('https://google.com');
    expect($('#frame-external')[0].getAttribute('srcdoc')).toBeUndefined();
    expect($('#frame-external-fail')[0].getAttribute('srcdoc')).toBeUndefined();
  });

  it('does not serialize iframes created by JS when JS is enabled', () => {
    $ = parseDOM(serializeDOM({ enableJavaScript: true }));
    expect($('#frame-js')[0].getAttribute('src')).not.toBeUndefined();
    expect($('#frame-js')[0].getAttribute('srcdoc')).toBeUndefined();
    expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toBeUndefined();
  });

  it('removes iframes from the head element', () => {
    expect($('#frame-head')).toHaveLength(0);
  });

  it('removes inaccessible JS frames', () => {
    expect($('#frame-inject')).toHaveLength(0);
  });
});
