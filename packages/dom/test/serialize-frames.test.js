import I, { when } from 'interactor.js';
import { assert, withExample, parseDOM } from './helpers';
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
      <iframe id="frame-with-urls" src="javascript:void(
        (this.document.body.background = '_/bg.png'),
        (this.document.body.innerHTML = \`
          <style>@font-face { src: url('_/font.woff2') }</style>
          <h1 style='background-image:url(_/head.png)'>Testing</h1>
          <link rel='stylesheet' href='_/style.css'>
          <img src='_/img.gif' srcset='/_/img.png 2x,
            //example.com/img.png 400w'>
          <video poster='_/poster.png'>\`)
      )"></iframe>
    `);

    let $frameInput = await getFrame('frame-input');
    await I.type(() => $frameInput.contentDocument.querySelector('input'), 'iframe with an input');

    let $frameJS = await getFrame('frame-js-no-src');
    $frameJS.contentDocument.body.innerHTML = '<p>generated iframe</p>';

    let $frameEmpty = await getFrame('frame-empty');
    await I.type(() => $frameEmpty.contentDocument.querySelector('input'), 'no document element');
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
    await getFrame('frame-external');

    $ = parseDOM(serializeDOM());
  }, 0); // frames may take a bit to load

  afterEach(() => {
    document.querySelector('#frame-head').remove();
  });

  it('serializes iframes created with JS', () => {
    expect($('#frame-js')[0].getAttribute('src')).toBeNull();
    expect($('#frame-js')[0].getAttribute('srcdoc')).toBe([
      '<!DOCTYPE html><html><head></head><body>',
      '<p>made with js src</p>',
      '</body></html>'
    ].join(''));

    expect($('#frame-js-no-src')[0].getAttribute('src')).toBeNull();
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

  it('serializes iframes internal URLs', () => {
    let url = uri => new URL(uri, document.URL).href;

    expect($('#frame-with-urls')[0].getAttribute('srcdoc')).toBe([
      `<!DOCTYPE html><html><head></head><body background="${url('_/bg.png')}">`,
      `<style>@font-face { src: url('${url('_/font.woff2')}') }</style>`,
      `<h1 style="background-image:url(${url('_/head.png')})">Testing</h1>`,
      `<link rel="stylesheet" href="${url('_/style.css')}">`,
      `<img src="${url('_/img.gif')}" srcset="${url('/_/img.png')} 2x,`,
      '  http://example.com/img.png 400w">',
      `<video poster="${url('_/poster.png')}"></video>`
      // account for indentation in the fixture
    ].join(' '.repeat(12)) + '</body></html>');
  });

  it('does not serialize iframes with CORS', () => {
    expect($('#frame-external')[0].getAttribute('src')).toBe('https://example.com');
    expect($('#frame-external-fail')[0].getAttribute('src')).toBe('https://google.com');
    expect($('#frame-external')[0].getAttribute('srcdoc')).toBeNull();
    expect($('#frame-external-fail')[0].getAttribute('srcdoc')).toBeNull();
  });

  it('does not serialize iframes created by JS when JS is enabled', () => {
    $ = parseDOM(serializeDOM({ enableJavaScript: true }));
    expect($('#frame-js')[0].getAttribute('src')).not.toBeNull();
    expect($('#frame-js')[0].getAttribute('srcdoc')).toBeNull();
    expect($('#frame-js-no-src')[0].getAttribute('srcdoc')).toBeNull();
  });

  it('does not serialize iframes without document elements', () => {
    expect($('#frame-empty')[0]).toBeDefined();
    expect($('#frame-empty')[0].getAttribute('srcdoc')).toBe('<input/>');
    expect($('#frame-empty-self')).toHaveSize(0);
  });

  it('removes iframes from the head element', () => {
    expect($('#frame-head')).toHaveSize(0);
  });

  it('removes inaccessible JS frames', () => {
    expect($('#frame-inject')).toHaveSize(0);
  });
});
