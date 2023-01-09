import { parseDOM, withExample } from './helpers';
import serializeDOM from '@percy/dom';

const platforms = ['plain', 'shadow'];
const pdom = (platform) => platform === 'shadow' ? document.getElementById('test-shadow').shadowRoot : document;

let canPlay = $video => new Promise(resolve => {
  if ($video.readyState > 2) resolve();
  else $video.addEventListener('canplay', resolve);
});

describe('serializeVideos', () => {
  let $, serialized;

  platforms.forEach((platform) => {
    it(`${platform}: serializes video elements`, async () => {
      withExample(`
        <video src="base/test/assets/example.webm" id="video" controls />
      `);

      await canPlay(platform === 'shadow' ? pdom(platform).querySelector('video') : window.video);
      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      expect($('#video')[0].getAttribute('poster'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#video')[0].getAttribute('poster'),
        content: jasmine.any(String),
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: does not serialize videos with an existing poster`, async () => {
      withExample(`
      <video src="base/test/assets/example.webm" id="video" poster="//:0" />
    `);

      await canPlay(platform === 'shadow' ? pdom(platform).querySelector('video') : window.video);
      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#video')[0].getAttribute('poster')).toBe('//:0');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not apply blank poster images`, () => {
      withExample(`
      <video src="//:0" id="video" />
    `);

      $ = parseDOM(serializeDOM(), platform);
      expect($('#video')[0].hasAttribute('poster')).toBe(false);
    });

    it(`${platform}: does not hang serialization when there is an error thrown`, () => {
      withExample(`
      <video src="//:0" id="video" />
    `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('An error'));

      $ = parseDOM(serializeDOM());
      expect($('#video')[0].hasAttribute('poster')).toBe(false);
    });
  });
});
