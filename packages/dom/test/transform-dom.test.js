import { dropLoadingAttribute, serializeScrollState } from '../src/transform-dom';
import { withExample, platforms, platformDOM } from './helpers';

// Note: applyElementTransformations is tested in serialize-dom tests

describe('transformDOM', () => {
  describe('serializeScrollState', () => {
    let original, clone;

    beforeEach(() => {
      original = document.createElement('div');
      original.style.overflow = 'scroll';
      original.style.height = '100px';
      original.style.width = '100px';
      original.innerHTML = '<div style="height: 200px; width: 200px;"></div>';
      document.body.appendChild(original);
      
      clone = document.createElement('div');
    });

    afterEach(() => {
      if (original && original.parentNode) {
        original.parentNode.removeChild(original);
      }
    });

    it('does not set attributes if scrollTop and scrollLeft are 0 or undefined', () => {
      serializeScrollState(clone, original);
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrolltop if scrollTop is non-zero', () => {
      original.scrollTop = 42;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe('42');
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrollleft if scrollLeft is non-zero', () => {
      original.scrollLeft = 17;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrollleft')).toBe('17');
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
    });

    it('sets both attributes if both scrollTop and scrollLeft are non-zero', () => {
      original.scrollTop = 5;
      original.scrollLeft = 10;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe('5');
      expect(clone.getAttribute('data-percy-scrollleft')).toBe('10');
    });

    it('does nothing if original or clone is missing', () => {
      expect(() => serializeScrollState(null, original)).not.toThrow();
      expect(() => serializeScrollState(clone, null)).not.toThrow();
    });
  });

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
