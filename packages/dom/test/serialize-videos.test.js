import { withExample, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

let canPlay = $video => new Promise(resolve => {
  if ($video.readyState > 2) resolve();
  else $video.addEventListener('canplay', resolve);
});

describe('serializeVideos', () => {
  let $, serialized;

  it('serializes video elements', async () => {
    withExample(`
      <video src="base/test/assets/example.webm" id="video" controls />
    `);

    await canPlay(window.video);
    serialized = serializeDOM();
    $ = parseDOM(serialized.html);

    expect($('#video')[0].getAttribute('poster'))
      .toMatch('/__serialized__/\\w+\\.png');
    expect(serialized.resources).toEqual([{
      url: $('#video')[0].getAttribute('poster'),
      content: jasmine.any(String),
      mimetype: 'image/png'
    }]);
  });

  it('does not serialize videos with an existing poster', async () => {
    withExample(`
      <video src="base/test/assets/example.webm" id="video" poster="//:0" />
    `);

    await canPlay(window.video);
    serialized = serializeDOM();
    $ = parseDOM(serialized.html);

    expect($('#video')[0].getAttribute('poster')).toBe('//:0');
    expect(serialized.resources).toEqual([]);
  });

  it('does not apply blank poster images', () => {
    withExample(`
      <video src="//:0" id="video" />
    `);

    $ = parseDOM(serializeDOM());
    expect($('#video')[0].hasAttribute('poster')).toBe(false);
  });

  it('does not hang serialization when there is an error thrown', () => {
    withExample(`
      <video src="//:0" id="video" />
    `);

    spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('An error'));

    $ = parseDOM(serializeDOM());
    expect($('#video')[0].hasAttribute('poster')).toBe(false);
  });
});
