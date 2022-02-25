import { withExample, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

let canPlay = $video => new Promise(resolve => {
  if ($video.readyState > 2) resolve();
  else $video.addEventListener('canplay', resolve);
});

describe('serializeVideos', () => {
  let $;

  it('serializes video elements', async () => {
    withExample(`
       <video src="base/test/assets/example.webm" id="video" controls />
    `);

    await canPlay(window.video);
    $ = parseDOM(serializeDOM());
    expect($('#video')[0].getAttribute('poster').length > 25).toBe(true);
  });

  it('does not serialize videos with an existing poster', async () => {
    withExample(`
       <video src="base/test/assets/example.webm" id="video" poster="//:0" />
    `);

    await canPlay(window.video);
    $ = parseDOM(serializeDOM());
    expect($('#video')[0].getAttribute('poster')).toBe('//:0');
  });

  it('does not apply blank poster images', () => {
    withExample(`
       <video src="//:0" id="video" />
    `);

    $ = parseDOM(serializeDOM());
    expect($('#video')[0].getAttribute('poster')).toBe(null);
  });
});
