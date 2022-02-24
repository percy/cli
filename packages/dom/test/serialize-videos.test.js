import { withExample, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeVideos', () => {
  let $;

  it('serializes video elements', (done) => {
    withExample(`
       <video src="base/test/assets/example.mp4" id="video" controls />
    `);

    document.querySelector('#video').addEventListener('canplay', () => {
      $ = parseDOM(serializeDOM());

      expect($('#video')[0].getAttribute('poster').length > 25).toBe(true);
      done();
    });
  });

  it('does not serialize videos with an existing poster', (done) => {
    withExample(`
       <video src="base/test/assets/example.mp4" id="video" poster="//:0" />
    `);

    document.querySelector('#video').addEventListener('canplay', () => {
      $ = parseDOM(serializeDOM());

      expect($('#video')[0].getAttribute('poster')).toBe('//:0');
      done();
    });
  });

  it('does not apply blank poster images', () => {
    withExample(`
       <video src="//:0" id="video" />
    `);

    $ = parseDOM(serializeDOM());
    expect($('#video')[0].getAttribute('poster')).toBe(null);
  });
});
