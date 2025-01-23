import { parseDOM, withExample, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeBase64', () => {
  let $, serialized;

  platforms.forEach((platform) => {
    it(`${platform}: serializes base64 elements`, async () => {
      withExample(`
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU" id="img">
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU" id="img2">
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhE2" id="diff_img">
      `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      expect($('#img')[0].getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect($('#img2')[0].getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect($('#diff_img')[0].getAttribute('src'))
        .toMatch('/__serialized__/\\w+\\.png');
      // both img and img2 refer to same resource as its same content
      expect($('#img')[0].getAttribute('src'))
        .toMatch($('#img2')[0].getAttribute('src'));

      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#img')[0].getAttribute('src'),
        content: 'iVBORw0KGgoAAAANSUhEU',
        mimetype: 'image/png'
      }));

      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#diff_img')[0].getAttribute('src'),
        content: 'iVBORw0KGgoAAAANSUhE2',
        mimetype: 'image/png'
      }));

      // even though we have 3 images - we have 2 unique base64 sha's
      expect(serialized.resources.length).toEqual(2);
    });

    it(`${platform}: serializes SVGAnimatedString having base64`, async () => {
      withExample(`
      <svg width="100" height="100">
        <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />
        <image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEU" id="image"></image>
      </svg>
      `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html, platform);

      expect($('#image')[0].getAttribute('href'))
        .toMatch('/__serialized__/\\w+\\.png');
      expect(serialized.resources).toContain(jasmine.objectContaining({
        url: $('#image')[0].getAttribute('href'),
        content: 'iVBORw0KGgoAAAANSUhEU',
        mimetype: 'image/png'
      }));
    });

    it(`${platform}: does not serialize elements without any src`, async () => {
      withExample(`
      <a href="https://www.browserstack.com/" id="a">
    `);

      serialized = serializeDOM();
      $ = parseDOM(serialized.html);

      expect($('#a')[0].getAttribute('href')).toBe('https://www.browserstack.com/');
      expect(serialized.resources).toEqual([]);
    });

    it(`${platform}: does not serialize elements without base64 src`, async () => {
      withExample(`
      <img src="image.png" id="img">
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
      shadowRoot.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEU" id="img">';

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
