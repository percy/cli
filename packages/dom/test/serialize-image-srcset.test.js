import { withExample, platforms } from './helpers';

import { loadAllSrcsetLinks } from '@percy/dom';

describe('loadAllSrcsetLinks', () => {
  let imgTags;

  platforms.forEach((platform) => {
    it(`${platform}: capture url from img srcset`, async () => {
      withExample(`
        <img srcset="base/test/assets/example.webp, base/test/assets/example.png 100px" />
      `);

      imgTags = loadAllSrcsetLinks();

      expect(imgTags.map(s => s.src)).toEqual(['http://localhost:9876/base/test/assets/example.webp', 'http://localhost:9876/base/test/assets/example.png']);
    });

    it(`${platform}: capture url from img srcset where there is no space after ,`, async () => {
      withExample(`
        <img srcset="base/test/assets/example.webp 200px,base/test/assets/example.png 100px" />
      `);

      imgTags = loadAllSrcsetLinks();

      expect(imgTags.map(s => s.src)).toEqual(['http://localhost:9876/base/test/assets/example.webp', 'http://localhost:9876/base/test/assets/example.png']);
    });

    it(`${platform}: capture url from source of picture`, async () => {
      withExample(`
      <picture>
        <source srcset='//locahost:9876/base/test/assets/example.webp, //localhost:9876/base/test/assets/example.png 2x' />
        <source srcset='//locahost:9876/base/test/assets/example.jpeg 100px, //locahost:9876/base/test/assets/example1.jpeg 200px' />
      </picture>
    `);

      imgTags = loadAllSrcsetLinks();

      expect(imgTags.map(s => s.src)).toEqual([
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

      imgTags = loadAllSrcsetLinks();

      expect(imgTags.map(s => s.src)).toEqual([
        'http://localhost:9876/base/test/assets/example.webp',
        'http://localhost:9876/base/test/assets/example.png',
        'http://localhost:9876/base/test/assets/example1.png'
      ]);
    });
  });
});
