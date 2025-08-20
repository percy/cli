import { dropLoadingAttribute, serializeScrollState } from '../src/transform-dom';
import { withExample, platforms, platformDOM } from './helpers';

// Note: applyElementTransformations is tested in serialize-dom tests

describe('transformDOM', () => {
  describe('serializeScrollState', () => {
    let original, clone;

    function makeScrollableDiv() {
      const el = document.createElement('div');
      el.style.width = '100px';
      el.style.height = '100px';
      el.style.overflow = 'scroll';
      el.innerHTML = '<div style="width:200px;height:200px;"></div>';
      document.body.appendChild(el);
      return el;
    }

    beforeEach(() => {
      // Remove any previous test divs
      document.querySelectorAll('.test-scrollable').forEach(e => e.remove());
      original = makeScrollableDiv();
      original.classList.add('test-scrollable');
      clone = document.createElement('div');
    });

    afterEach(() => {
      original.remove();
    });

    it('does not set attributes if scrollTop and scrollLeft are 0 or undefined', () => {
      serializeScrollState(clone, original);
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrolltop if scrollTop is non-zero', () => {
      original.scrollTop = 42;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe(original.scrollTop.toString());
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrollleft if scrollLeft is non-zero', () => {
      original.scrollLeft = 17;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrollleft')).toBe(original.scrollLeft.toString());
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
    });

    it('sets both attributes if both scrollTop and scrollLeft are non-zero', () => {
      original.scrollTop = 5;
      original.scrollLeft = 10;
      serializeScrollState(clone, original);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe(original.scrollTop.toString());
      expect(clone.getAttribute('data-percy-scrollleft')).toBe(original.scrollLeft.toString());
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
