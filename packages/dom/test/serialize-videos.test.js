import { parseDOM, withExample, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';
import serializeVideos from '../src/serialize-video';

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

      await canPlay(platform === 'shadow' ? platformDOM(platform).querySelector('video') : window.video);
      serialized = await serializeDOM();
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

      await canPlay(platform === 'shadow' ? platformDOM(platform).querySelector('video') : window.video);
      serialized = await serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#video')[0].getAttribute('poster')).toBe('//:0');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not apply blank poster images`, async () => {
      withExample(`
      <video src="//:0" id="video" />
    `);

      $ = parseDOM(await serializeDOM(), platform);
      expect($('#video')[0].hasAttribute('poster')).toBe(false);
    });

    it(`${platform}: does not hang serialization when there is an error thrown`, async () => {
      withExample(`
      <video src="//:0" id="video" />
    `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('An error'));

      $ = parseDOM(await serializeDOM());
      expect($('#video')[0].hasAttribute('poster')).toBe(false);
    });

    it(`${platform}: serializes video elements inside nested dom`, async () => {
      if (platform === 'plain') {
        return;
      }
      withExample('<div id="video-container"/>');
      const dom = platformDOM(platform);
      const videoContainer = dom.querySelector('#video-container');
      const shadowRoot = videoContainer.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = '<video src="base/test/assets/example.webm" id="video" controls />';

      await canPlay(shadowRoot.querySelector('video'));
      serialized = await serializeDOM();
      $ = parseDOM(serialized.html, platform);

      const resultRoot = $('#video-container template')[0];
      const videoElement = resultRoot.content.querySelector('video');

      expect(videoElement.getAttribute('poster'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: videoElement.getAttribute('poster'),
        content: jasmine.any(String),
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: add node details in error message and rethrow it`, async () => {
      withExample(`
        <video class="test1 test2" src="base/test/assets/example.webm" id="video" controls/>
      `);

      await canPlay(platform === 'shadow' ? platformDOM(platform).querySelector('video') : window.video);
      expect(() => serializeVideos({ dom: document })).toThrowMatching((error) => {
        return error.message.includes('Error serializing video element:') &&
          error.message.includes('{"nodeName":"VIDEO","classNames":"test1 test2","id":"video"}');
      });
    });
  });
});
