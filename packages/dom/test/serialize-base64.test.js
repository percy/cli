import { parseDOM, withExample, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeBase64', () => {
  let $, serialized;

  platforms.forEach((platform) => {
    it(`${platform}: serializes base64 elements`, async () => {
      withExample(`
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU">
      `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      expect($('#img')[0].getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#img')[0].getAttribute('src'),
        content: 'iVBORw0KGgoAAAANSUhEU',
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: does not serialize elements without any src`, async () => {
      withExample(`
      <a href="https://www.browserstack.com/">
    `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#a')[0].getAttribute('href')).toBe('https://www.browserstack.com/');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not serialize elements without base64 src`, async () => {
      withExample(`
      <img src="image.png">
    `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#img')[0].getAttribute('src')).toBe('image.png');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: serializes base64 elements inside nested dom`, async () => {
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
