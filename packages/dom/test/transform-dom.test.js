import { dropLoadingAttribute, serializeScrollState, serializeOpacity } from '../src/transform-dom';
import { withExample, platforms, platformDOM, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

// Note: applyElementTransformations is tested in serialize-dom tests

describe('transformDOM', () => {
  describe('serializeScrollState', () => {
    let original, clone;

    beforeEach(() => {
      original = document.createElement('div');
      Object.defineProperty(original, 'scrollTop', {
        writable: true,
        value: 0
      });
      Object.defineProperty(original, 'scrollLeft', {
        writable: true,
        value: 0
      });

      clone = document.createElement('div');
    });

    it('does not set attributes if scrollTop and scrollLeft are 0 or undefined', () => {
      serializeScrollState(original, clone);
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrolltop if scrollTop is non-zero', () => {
      original.scrollTop = 42;
      serializeScrollState(original, clone);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe('42');
      expect(clone.hasAttribute('data-percy-scrollleft')).toBe(false);
    });

    it('sets data-percy-scrollleft if scrollLeft is non-zero', () => {
      original.scrollLeft = 17;
      serializeScrollState(original, clone);
      expect(clone.getAttribute('data-percy-scrollleft')).toBe('17');
      expect(clone.hasAttribute('data-percy-scrolltop')).toBe(false);
    });

    it('sets both attributes if both scrollTop and scrollLeft are non-zero', () => {
      original.scrollTop = 5;
      original.scrollLeft = 10;
      serializeScrollState(original, clone);
      expect(clone.getAttribute('data-percy-scrolltop')).toBe('5');
      expect(clone.getAttribute('data-percy-scrollleft')).toBe('10');
    });

    it('does nothing if original or clone is missing', () => {
      expect(() => serializeScrollState(original, null)).not.toThrow();
      expect(() => serializeScrollState(null, clone)).not.toThrow();
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

  describe('serializeOpacity', () => {
    let original, clone;

    beforeEach(() => {
      original = document.createElement('div');
      clone = document.createElement('div');
    });

    it('does not set opacity attribute for opacity 1 (default)', () => {
      // Mock getComputedStyle to return opacity: 1
      spyOn(window, 'getComputedStyle').and.returnValue({
        opacity: '1'
      });

      serializeOpacity(original, clone);
      expect(clone.hasAttribute('data-percy-opacity')).toBe(false);
    });

    it('sets opacity attribute for explicit opacity 1', () => {
      // Set explicit opacity style
      original.style.opacity = '1';

      // Mock getComputedStyle to return opacity: 1
      spyOn(window, 'getComputedStyle').and.returnValue({
        opacity: '1'
      });

      serializeOpacity(original, clone);
      expect(clone.getAttribute('data-percy-opacity')).toBe('1');
    });

    it('sets data-percy-opacity attribute for opacity values other than 1', () => {
      // Mock getComputedStyle to return opacity: 0.5
      spyOn(window, 'getComputedStyle').and.returnValue({
        opacity: '0.5'
      });

      serializeOpacity(original, clone);
      expect(clone.getAttribute('data-percy-opacity')).toBe('0.5');
    });

    it('sets data-percy-opacity attribute for opacity 0', () => {
      // Mock getComputedStyle to return opacity: 0
      spyOn(window, 'getComputedStyle').and.returnValue({
        opacity: '0'
      });

      serializeOpacity(original, clone);
      expect(clone.getAttribute('data-percy-opacity')).toBe('0');
    });

    it('handles getComputedStyle errors gracefully', () => {
      // Mock getComputedStyle to throw an error
      spyOn(window, 'getComputedStyle').and.throwError('Computed style error');

      expect(() => serializeOpacity(original, clone)).not.toThrow();
      expect(clone.hasAttribute('data-percy-opacity')).toBe(false);
    });

    it('does nothing if original or clone is missing', () => {
      expect(() => serializeOpacity(original, null)).not.toThrow();
      expect(() => serializeOpacity(null, clone)).not.toThrow();
    });

    it('handles various opacity values correctly', () => {
      const testCases = [
        { opacity: '0.25', expected: '0.25' },
        { opacity: '0.75', expected: '0.75' },
        { opacity: '0.999', expected: '0.999' },
        { opacity: '0.001', expected: '0.001' }
      ];

      testCases.forEach(({ opacity, expected }) => {
        const testOriginal = document.createElement('div');
        const testClone = document.createElement('div');

        spyOn(window, 'getComputedStyle').and.returnValue({ opacity });

        serializeOpacity(testOriginal, testClone);
        expect(testClone.getAttribute('data-percy-opacity')).toBe(expected);
      });
    });
  });

  describe('opacity integration with DOM serialization', () => {
    platforms.forEach((platform) => {
      let dom;
      beforeEach(() => {
        withExample(`
          <div id="opacity-0" style="opacity: 0;">Hidden element</div>
          <div id="opacity-0.5" style="opacity: 0.5;">Semi-transparent element</div>
          <div id="opacity-1" style="opacity: 1;">Fully opaque element</div>
          <div id="opacity-0.25" style="opacity: 0.25;">Quarter transparent element</div>
        `, { withShadow: platform === 'shadow' });
        dom = platformDOM(platform);
      });

      it(`${platform}: serializes opacity attributes for all elements`, () => {
        const { html } = serializeDOM();
        const $ = parseDOM(html, platform);

        // Check that opacity attributes are set on cloned elements
        expect($('#opacity-0')[0].getAttribute('data-percy-opacity')).toBe('0');
        expect($('#opacity-0\\.5')[0].getAttribute('data-percy-opacity')).toBe('0.5');
        expect($('#opacity-1')[0].getAttribute('data-percy-opacity')).toBe('1'); // opacity 1 should have attribute because it's explicitly set
        expect($('#opacity-0\\.25')[0].getAttribute('data-percy-opacity')).toBe('0.25');
      });

      it(`${platform}: preserves original DOM structure`, () => {
        // Serialize DOM
        serializeDOM();

        // Verify original DOM is not modified
        expect(dom.getElementById('opacity-0').style.opacity).toBe('0');
        expect(dom.getElementById('opacity-0.5').style.opacity).toBe('0.5');
        expect(dom.getElementById('opacity-1').style.opacity).toBe('1');
        expect(dom.getElementById('opacity-0.25').style.opacity).toBe('0.25');
      });
    });
  });
});
