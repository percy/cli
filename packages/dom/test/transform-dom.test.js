import { dropLoadingAttribute, serializeScrollState, serializeOpacityState } from '../src/transform-dom';
import { withExample, platforms, platformDOM } from './helpers';

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

  describe('serializeOpacityState', () => {
    let original, clone;
    let originalGetComputedStyle;

    beforeEach(() => {
      original = document.createElement('div');
      clone = document.createElement('div');

      // Store original getComputedStyle
      originalGetComputedStyle = window.getComputedStyle;
    });

    afterEach(() => {
      // Restore original getComputedStyle
      window.getComputedStyle = originalGetComputedStyle;
    });

    it('adds percy-opacity-1 class when element has data-percy-opacity attribute', () => {
      original.setAttribute('data-percy-opacity', 'true');
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: '',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.getAttribute('class')).toBe('percy-opacity-1');
    });

    it('adds percy-opacity-1 class when element has animation-related classes', () => {
      original.classList.add('fade-in');
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: '',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.getAttribute('class')).toBe('percy-opacity-1');
    });

    it('adds percy-opacity-1 class when opacity is 1 and element has explicit opacity style', () => {
      original.style.opacity = '1';
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: '',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.getAttribute('class')).toBe('percy-opacity-1');
    });

    it('adds percy-opacity-1 class when opacity is 1 and element has opacity transition', () => {
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: 'opacity 0.3s ease',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.getAttribute('class')).toBe('percy-opacity-1');
    });

    it('preserves existing classes when adding percy-opacity-1', () => {
      clone.setAttribute('class', 'existing-class another-class');
      original.setAttribute('data-percy-opacity', 'true');
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: '',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.getAttribute('class')).toBe('existing-class another-class percy-opacity-1');
    });

    it('does not add class when opacity is 1 but no opacity-related indicators exist', () => {
      window.getComputedStyle = () => ({
        opacity: '1',
        transition: '',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.hasAttribute('class')).toBe(false);
    });

    it('does not add class when opacity is not 1 even with indicators', () => {
      original.style.opacity = '0.5';
      window.getComputedStyle = () => ({
        opacity: '0.5',
        transition: 'opacity 0.3s ease',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.hasAttribute('class')).toBe(false);
    });

    it('does not add class when opacity is not 1', () => {
      original.style.opacity = '0.5';
      window.getComputedStyle = () => ({
        opacity: '0.5',
        transition: 'opacity 0.3s ease',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.hasAttribute('class')).toBe(false);
    });

    it('does not add class when opacity is 0', () => {
      original.style.opacity = '0';
      window.getComputedStyle = () => ({
        opacity: '0',
        transition: 'opacity 0.3s ease',
        animation: 'none'
      });

      serializeOpacityState(original, clone);
      expect(clone.hasAttribute('class')).toBe(false);
    });

    it('does nothing if original or clone is missing', () => {
      expect(() => serializeOpacityState(original, null)).not.toThrow();
      expect(() => serializeOpacityState(null, clone)).not.toThrow();
    });

    it('does nothing for non-element nodes', () => {
      const textNode = document.createTextNode('text');
      const commentNode = document.createComment('comment');

      // Mock nodeType for non-element nodes
      Object.defineProperty(textNode, 'nodeType', { value: 3 }); // TEXT_NODE
      Object.defineProperty(commentNode, 'nodeType', { value: 8 }); // COMMENT_NODE

      expect(() => serializeOpacityState(textNode, clone)).not.toThrow();
      expect(() => serializeOpacityState(commentNode, clone)).not.toThrow();
      expect(clone.hasAttribute('class')).toBe(false);
    });

    it('handles errors gracefully when getComputedStyle fails', () => {
      window.getComputedStyle = () => {
        throw new Error('getComputedStyle failed');
      };

      expect(() => serializeOpacityState(original, clone)).not.toThrow();
      expect(clone.hasAttribute('class')).toBe(false);
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
