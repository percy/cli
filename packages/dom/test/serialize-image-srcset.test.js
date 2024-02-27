import { withExample, platforms } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeImageSrcSet', () => {
  let serialized;

  platforms.forEach((platform) => {
    it(`${platform}: capture url from img srcset`, async () => {
      withExample(`
        <img srcset="base/test/assets/example.webp, base/test/assets/example.png 100px" />
      `);

      serialized = serializeDOM();

      expect(serialized.imageLinks).toEqual(['http://localhost:9876/base/test/assets/example.webp', 'http://localhost:9876/base/test/assets/example.png']);
    });

    it(`${platform}: capture url from source of picture`, async () => {
      withExample(`
      <picture>
        <source srcset='//locahost:9876/base/test/assets/example.webp, //localhost:9876/base/test/assets/example.png 2x' />
        <source srcset='//locahost:9876/base/test/assets/example.jpeg 100px, //locahost:9876/base/test/assets/example1.jpeg 200px' />
      </picture>
    `);

      serialized = serializeDOM();

      expect(serialized.imageLinks).toEqual([
        'http://locahost:9876/base/test/assets/example.webp',
        'http://localhost:9876/base/test/assets/example.png',
        'http://locahost:9876/base/test/assets/example.jpeg',
        'http://locahost:9876/base/test/assets/example1.jpeg'
      ]);
    });

    it(`${platform}: srcset inside shadowroot`, () => {
      withExample(`
      <img srcset="/base/test/assets/example.webp, /base/test/assets/example.png 100px, /base/test/assets/example1.png 2x" />
    `, { withShadow: true });

      serialized = serializeDOM();
      expect(serialized.imageLinks).toEqual([
        'http://localhost:9876/base/test/assets/example.webp',
        'http://localhost:9876/base/test/assets/example.png',
        'http://localhost:9876/base/test/assets/example1.png'
      ]);
    });
  });
});
