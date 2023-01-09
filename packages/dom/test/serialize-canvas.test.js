import { withExample, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

const platforms = ['plain', 'shadow'];
const pdom = (platform) => platform === 'shadow' ? document.getElementById('test-shadow').shadowRoot : document;

describe('serializeCanvas', () => {
  let serialized, cache = { shadow: {}, plain: {} };

  beforeEach(() => {
    withExample(`
      <canvas
        id="canvas"
        width="150px"
        height="150px"
        style="border: 5px solid black;"
      ></canvas>
      <canvas
        id="empty"
        width="0px"
        height="0px"
      ></canvas>
    `
    );
    platforms.forEach((plat) => {
      let dom = pdom(plat);
      let canvas = dom.getElementById('canvas');
      let ctx = canvas.getContext('2d');

      ctx.beginPath();
      ctx.arc(75, 75, 50, 0, Math.PI * 2, true);
      ctx.moveTo(110, 75);
      ctx.arc(75, 75, 35, 0, Math.PI, false);
      ctx.moveTo(65, 65);
      ctx.arc(60, 65, 5, 0, Math.PI * 2, true);
      ctx.moveTo(95, 65);
      ctx.arc(90, 65, 5, 0, Math.PI * 2, true);
      ctx.stroke();

      cache[plat].dataURL = canvas.toDataURL();
    });

    serialized = serializeDOM();
  });

  platforms.forEach((platform) => {
    let $;
    beforeEach(() => {
      // console.log(`beforeEach ${platform}`);
      $ = parseDOM(serialized.html, platform);
    });

    it(`${platform}: serializes canvas elements`, () => {
      let $canvas = $('#canvas');
      expect($canvas[0].tagName).toBe('IMG');
      expect($canvas[0].getAttribute('width')).toBe('150px');
      expect($canvas[0].getAttribute('height')).toBe('150px');
      expect($canvas[0].getAttribute('src')).toMatch('/__serialized__/\\w+\\.png');
      expect($canvas[0].getAttribute('style')).toBe('border: 5px solid black; max-width: 100%;');
      expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(true);

      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $canvas[0].getAttribute('src'),
        content: cache[platform].dataURL.split(',')[1],
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: does not serialize canvas elements when JS is enabled`, () => {
      serialized = serializeDOM({ enableJavaScript: true });
      $ = parseDOM(serialized.html, platform);

      let $canvas = $('#canvas');
      expect($canvas[0].tagName).toBe('CANVAS');
      expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(false);
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not serialize empty canvas elements`, () => {
      let $canvas = $('#empty');
      expect($canvas[0].tagName).toBe('CANVAS');
      expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(false);
    });
  });
});
