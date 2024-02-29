import { parseDOM, withExample, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeBase64Images', () => {
  let $, serialized;

  platforms.forEach((platform) => {
    it(`${platform}: serializes base64 image elements`, async () => {
      withExample(`
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU">
      `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      expect($('#img')[0].getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#src')[0].getAttribute('src'),
        content: 'iVBORw0KGgoAAAANSUhEU',
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: does not serialize image elements without base64 src`, async () => {
      withExample(`
      <img src="image.png">
    `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#img')[0].getAttribute('src')).toBe('image.png');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not serialize image elements without invalid base64 src`, async () => {
      withExample(`
      <img src="data:image/png;base64,xyzabcd">
    `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#img')[0].getAttribute('src')).toBe('data:image/png;base64,xyzabcd');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: serializes base64 image elements inside nested dom`, async () => {
      if (platform === 'plain') {
        return;
      }
      withExample('<div id="image-container"/>');
      const dom = platformDOM(platform);
      const imageContainer = dom.querySelector('#image-container');
      const shadowRoot = imageContainer.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU">';

      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      const resultRoot = $('#image-container template')[0];
      const imageElement = resultRoot.content.querySelector('img');

      expect(imageElement.getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: imageElement.getAttribute('src'),
        content: 'iVBORw0KGgoAAAANSUhEU',
        mimetype: 'image/png'
      }));
    });
  });
});
