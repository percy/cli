import { dropLoadingAttribute } from '../src/transform-dom';
import { withExample, platforms, platformDOM } from './helpers';

// Note: applyElementTransformations is tested in serialize-dom tests

describe('transformDOM', () => {
  describe('dropLoadingAttribute', () => {
    let dom;

    platforms.forEach((platform) => {
      beforeEach(() => {
        withExample(`
          <img id="image" loading="lazy"/>
          <video id="other_tag" loading="lazy"/>
          <iframe id="frame1" loading="lazy"/>
        `, { withShadow: platform === 'shadow' });
        dom = platformDOM(platform);
      });

      it(`${platform} drops loading from image tag`, () => {
        dropLoadingAttribute(dom.getElementById('image'));

        expect(dom.getElementById('image').getAttribute('loading')).toBe(null);
      });

      it(`${platform} drops loading from iframe tag`, () => {
        dropLoadingAttribute(dom.getElementById('frame1'));

        expect(dom.getElementById('frame1').getAttribute('loading')).toBe(null);
      });

      it(`${platform} does not drop loading from other tags`, () => {
        dropLoadingAttribute(dom.getElementById('other_tag'));

        expect(dom.getElementById('other_tag').getAttribute('loading')).toBe('lazy');
      });
    });
  });
});
