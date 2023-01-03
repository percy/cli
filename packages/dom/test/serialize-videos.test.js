import { withShadowExample, parseDOM, parseDeclShadowDOM, withExample, getExampleShadowRoot, isShadowMode } from './helpers';
import serializeDOM from '@percy/dom';

let canPlay = $video => new Promise(resolve => {
  if ($video.readyState > 2) resolve();
  else $video.addEventListener('canplay', resolve);
});

let shadowDom = isShadowMode;
let loadExample = shadowDom ? withShadowExample : withExample;
let parse = shadowDom ? parseDeclShadowDOM : parseDOM;

describe('serializeVideos', () => {
  let $, serialized;

  it('serializes video elements', async () => {
    loadExample(`
      <video src="base/test/assets/example.webm" id="video" controls />
    `);

    await canPlay(shadowDom ? getExampleShadowRoot().querySelector('video') : window.video);
    serialized = serializeDOM();
    $ = parse(serialized.html);

      expect($('#video')[0].getAttribute('poster'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#video')[0].getAttribute('poster'),
        content: jasmine.any(String),
        mimetype: 'image/png'
      }));
    });

  it('does not serialize videos with an existing poster', async () => {
    loadExample(`
      <video src="base/test/assets/example.webm" id="video" poster="//:0" />
    `);

    await canPlay(shadowDom ? getExampleShadowRoot().querySelector('video') : window.video);
    serialized = serializeDOM();
    $ = parse(serialized.html);

      expect($('#video')[0].getAttribute('poster')).toBe('//:0');
      expect(serialized.resources).toEqual([]);
    });

  it('does not apply blank poster images', () => {
    loadExample(`
      <video src="//:0" id="video" />
    `);

    $ = parse(serializeDOM());
    expect($('#video')[0].hasAttribute('poster')).toBe(false);
  });

  it('does not hang serialization when there is an error thrown', () => {
    loadExample(`
      <video src="//:0" id="video" />
    `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('An error'));

    $ = parse(serializeDOM());
    expect($('#video')[0].hasAttribute('poster')).toBe(false);
  });
});
