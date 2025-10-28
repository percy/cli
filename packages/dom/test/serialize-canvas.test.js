import { withExample, parseDOM, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';
import serializeCanvas from '../src/serialize-canvas';

describe('serializeCanvas', () => {
  let serialized, cache = { shadow: {}, plain: {} };

  describe('sucess case', () => {
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
        let dom = platformDOM(plat);
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

  describe('failure case', () => {
    it('add node details in error message and rethrow it', async () => {
      withExample(`
        <canvas id="canvas" class="test1 test2"/>
      `);
      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('An error'));
      expect(() => serializeCanvas({ dom: document })).toThrowMatching((error) => {
        return error.message.includes('Error serializing canvas element:') &&
          error.message.includes('{"nodeName":"CANVAS","classNames":"test1 test2","id":"canvas"}');
      });
    });

    it('ignores canvas serialization errors when flag is enabled', () => {
      withExample(`
        <canvas id="canvas" width="150px" height="150px"/>
      `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('Canvas error'));

      let ctx = {
        dom: document,
        clone: document.cloneNode(true),
        resources: new Set(),
        warnings: new Set(),
        ignoreCanvasSerializationErrors: true
      };

      expect(() => serializeCanvas(ctx)).not.toThrow();
      expect(Array.from(ctx.warnings)).toContain('Canvas Serialization failed, Replaced canvas with empty Image');
      expect(Array.from(ctx.warnings)).toContain('Error: Canvas error');
    });

    it('creates fallback image element when ignoring canvas errors', () => {
      withExample(`
        <canvas id="canvas" width="150px" height="150px"/>
      `);

      // Use serializeDOM to properly set up the context like the real flow
      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('Canvas error'));

      let result = serializeDOM({ ignoreCanvasSerializationErrors: true });

      expect(Array.from(result.warnings)).toContain('Canvas Serialization failed, Replaced canvas with empty Image');
      expect(Array.from(result.warnings)).toContain('Error: Canvas error');

      // Parse the result to check for the fallback image
      let $ = parseDOM(result.html);
      let $img = $('img[data-percy-canvas-serialized]');

      expect($img.length).toBe(1);
      expect($img[0].getAttribute('src')).toBe('');
      expect($img[0].getAttribute('width')).toBe('150px');
      expect($img[0].getAttribute('height')).toBe('150px');
    });

    it('handles fallback image creation errors gracefully', () => {
      withExample(`
        <canvas id="canvas"/>
      `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('Canvas error'));

      // Mock document.createElement to throw error during fallback
      let originalCreateElement = document.createElement;
      spyOn(document, 'createElement').and.callFake((tagName) => {
        if (tagName === 'img') {
          throw new Error('Element creation error');
        }
        return originalCreateElement.call(document, tagName);
      });

      let result = serializeDOM({ ignoreCanvasSerializationErrors: true });

      expect(result.warnings).toContain('Canvas Serialization failed, Replaced canvas with empty Image');
      expect(result.warnings).toContain('Error: Canvas error');
      expect(result.warnings).toContain('Error creating fallback image element: Element creation error');
    });
  });
});
