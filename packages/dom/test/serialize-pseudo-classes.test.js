// nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method

import { markPseudoClassElements, serializePseudoClasses, getElementsToProcess } from '../src/serialize-pseudo-classes';
import { withExample } from './helpers';

describe('serialize-pseudo-classes', () => {
  let ctx;

  beforeEach(() => {
    ctx = {
      dom: document,
      warnings: new Set()
    };
    withExample('<div id="foo" style="color: red;"></div><div class="bar"></div><div id="baz"></div>');
    ctx.clone = document.implementation.createHTMLDocument('Clone');
    ctx.clone.body.innerHTML = document.body.innerHTML;
  });

  describe('when no pseudoClassEnabledElements is given', () => {
    it('serializePseudoClasses does nothing and does not throw', () => {
      ctx.clone = document.implementation.createHTMLDocument('Clone');
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });
  });

  describe('serializePseudoClasses', () => {
    describe('with no marked elements', () => {
      it('does nothing if no elements with marker attribute are found', () => {
        // Setup: DOM and clone with no marker attributes
        // Do NOT call markPseudoClassElements, so no marker attribute is set
        serializePseudoClasses({
          dom: document,
          warnings: new Set(),
          pseudoClassEnabledElements: { id: ['foo'] }
        });
        // Should not throw and should not add style
        expect(ctx.clone.head.querySelector('style')).toBeNull();
        // Should not add any warnings
        expect(ctx.warnings.size).toBe(0);
      });
    });

    describe('with marked elements', () => {
      beforeEach(() => {
        ctx.pseudoClassEnabledElements = { id: ['foo'] };
        markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
        ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      });

      it('adds warning if pseudo clone element is not found', () => {
        // Remove marker from clone for 'foo' so it cannot be found
        console.log('-->> ', ctx.clone.getElementById('foo'));
        ctx.clone.getElementById('foo').removeAttribute('data-percy-pseudo-element-id');
        ctx.clone.head.innerHTML = '';
        serializePseudoClasses(ctx);
        // Should add a warning for missing clone element
        const warnings = Array.from(ctx.warnings);
        expect(warnings.some(w => w.includes('Element not found for pseudo-class serialization with percy-element-id'))).toBe(true);
      });

      it('adds warning if <head> is missing in clone', () => {
        // Remove head from clone
        ctx.clone.head.parentNode.removeChild(ctx.clone.head);
        serializePseudoClasses(ctx);
        const warnings = Array.from(ctx.warnings);
        expect(warnings.some(w => w.includes('Could not inject pseudo-class styles: no <head> element found'))).toBe(true);
      });

      it('adds style element to head in clone', () => {
        ctx.clone.head.innerHTML = '';
        serializePseudoClasses(ctx);
        const style = ctx.clone.head.querySelector('style[data-percy-pseudo-class-styles="true"]');
        expect(style).not.toBeNull();
        expect(style.textContent).toContain('color: rgb(255, 0, 0) !important');
      });

      it('adds attributes in cloned dom as well', () => {
        let orginalBody = ctx.dom.body.innerHTML;
        let originalClonedBody = ctx.clone.body.innerHTML;
        markPseudoClassElements(ctx, { id: ['foo', 'baz'], className: ['bar'] });
        ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
        serializePseudoClasses(ctx);
        // Check that the marker attribute exists in the clone for each element
        ['foo', 'baz'].forEach(id => {
          const clone = ctx.clone.getElementById(id);
          expect(clone.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
        });

        const cloneBar = ctx.clone.getElementsByClassName('bar')[0];
        expect(cloneBar.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
        // Restore original cloned body
        ctx.clone.body.innerHTML = originalClonedBody;
        ctx.dom.body.innerHTML = orginalBody;
      });

      describe('handles getComputedStyle errors gracefully', () => {
        let origGetComputedStyle;
        beforeEach(() => {
          // Setup DOM and clone
          withExample('<div id="foo"></div><div class="bar"></div><div id="baz"></div>');
          ctx.clone = document.implementation.createHTMLDocument('Clone');
          ctx.clone.body.innerHTML = document.body.innerHTML;
          ctx.pseudoClassEnabledElements = {
            id: ['foo'],
            className: ['bar'],
            xpath: ['//*[@id="baz"]']
          };
          // Mark elements in original DOM
          markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
          // Copy marker attributes to clone
          ['foo', 'baz'].forEach(id => {
            const orig = document.getElementById(id);
            const clone = ctx.clone.getElementById(id);
            if (orig && clone) {
              clone.setAttribute('data-percy-pseudo-element-id', orig.getAttribute('data-percy-pseudo-element-id'));
            }
          });
          const origBar = document.getElementsByClassName('bar')[0];
          const cloneBar = ctx.clone.getElementsByClassName('bar')[0];
          if (origBar && cloneBar) {
            cloneBar.setAttribute('data-percy-pseudo-element-id', origBar.getAttribute('data-percy-pseudo-element-id'));
          }
          // Mock getComputedStyle
          origGetComputedStyle = window.getComputedStyle;
          window.getComputedStyle = () => ({
            length: 1,
            0: 'color',
            getPropertyValue: () => 'red'
          });
        });
        afterEach(() => {
          window.getComputedStyle = origGetComputedStyle;
        });

        it('handles getComputedStyle throwing an error gracefully', () => {
          // Setup spy for console.warn using Jasmine
          spyOn(console, 'warn');
          window.getComputedStyle = () => { throw new Error('fail'); };
          ctx.clone.head.innerHTML = '';
          expect(() => serializePseudoClasses(ctx)).not.toThrow();
          expect(console.warn).toHaveBeenCalled();
          const callArgs = console.warn.calls.mostRecent().args;
          expect(callArgs[0]).toContain('Could not get computed styles for element');
          expect(callArgs[2] instanceof Error).toBe(true);
        });
      });
    });
  });

  describe('getElementsToProcess', () => {
    it('does not mark element if markWithId is false (via getElementsToProcess)', () => {
      // This is an internal branch, but we can simulate it by calling markPseudoClassElements with a helper
      // We'll temporarily patch getElementsToProcess to expose markWithId
      withExample('<div id="foo"></div>');
      const el = document.getElementById('foo');
      const ctx2 = { dom: document, warnings: new Set() };
      getElementsToProcess(ctx2, { id: ['foo'] });
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(false);
    });

    it('throws an error if ctx is null', () => {
      expect(() => {
        getElementsToProcess(null, { id: ['foo'] });
      }).toThrow();
    });

    it('throws an error if config is null', () => {
      const ctx2 = { dom: document, warnings: new Set() };
      expect(() => {
        getElementsToProcess(ctx2, null);
      }).toThrow();
    });
  });

  describe('markPseudoClassElements', () => {
    it('does not re-mark if xpath element is already marked', () => {
      withExample('<div id="foo"></div>');
      const xpath = '//*[@id="foo"]';
      // Mark with xpath
      markPseudoClassElements(ctx, { xpath: [xpath] });
      const el = document.getElementById('foo');
      const firstId = el.getAttribute('data-percy-pseudo-element-id');
      // Mark again with same xpath
      markPseudoClassElements(ctx, { xpath: [xpath] });
      expect(el.getAttribute('data-percy-pseudo-element-id')).toBe(firstId);
    });

    it('does not re-mark if className element is already marked', () => {
      withExample('<div class="bar"></div>');
      // Mark with className
      markPseudoClassElements(ctx, { className: ['bar'] });
      const el = document.getElementsByClassName('bar')[0];
      const firstId = el.getAttribute('data-percy-pseudo-element-id');
      // Mark again with same className
      markPseudoClassElements(ctx, { className: ['bar'] });
      expect(el.getAttribute('data-percy-pseudo-element-id')).toBe(firstId);
    });

    it('does not re-mark if id element is already marked', () => {
      withExample('<div id="foo"></div>');
      // Mark with id
      markPseudoClassElements(ctx, { id: ['foo'] });
      const el = document.getElementById('foo');
      const firstId = el.getAttribute('data-percy-pseudo-element-id');
      // Mark again with same id
      markPseudoClassElements(ctx, { id: ['foo'] });
      expect(el.getAttribute('data-percy-pseudo-element-id')).toBe(firstId);
    });

    it('does not re-mark if attribute already present (id/class/xpath point to same element)', () => {
      // Setup DOM with one element
      withExample('<div id="foo" class="bar"></div>');
      // XPath that matches the same element
      const xpath = '//*[@id="foo"]';
      const config = {
        id: ['foo'],
        className: ['bar'],
        xpath: [xpath]
      };
      // Mark once
      markPseudoClassElements(ctx, config);
      const el = document.getElementById('foo');
      const firstId = el.getAttribute('data-percy-pseudo-element-id');
      // Mark again (simulate multiple selectors matching same element)
      markPseudoClassElements(ctx, config);
      // Should not change the attribute
      expect(el.getAttribute('data-percy-pseudo-element-id')).toBe(firstId);
    });

    it('marks elements by id, className, and xpath', () => {
      withExample('<div id="foo"></div><div class="bar"></div><div id="baz"></div>');
      const config = {
        id: ['foo'],
        className: ['bar'],
        xpath: ['//*[@id="baz"]']
      };
      markPseudoClassElements(ctx, config);
      expect(document.getElementById('foo').hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(document.getElementsByClassName('bar')[0].hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(document.getElementById('baz').hasAttribute('data-percy-pseudo-element-id')).toBe(true);
    });
  });

  describe('when no element found', () => {
    it('adds warning for invalid XPath expression', () => {
      spyOn(console, 'warn');
      const config = {
        xpath: ['//*invalid_xpath']
      };
      markPseudoClassElements(ctx, config);
      expect(console.warn).toHaveBeenCalled();
      const callArgs = console.warn.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Invalid XPath expression');
      expect(callArgs[0]).toContain('//*invalid_xpath');
    });
    it('adds warnings for missing id, className, and xpath', () => {
      const config = {
        id: ['notfoundid'],
        className: ['notfoundclass'],
        xpath: ['//*[@id="notfoundxpath"]']
      };
      markPseudoClassElements(ctx, config);
      const warnings = Array.from(ctx.warnings);
      expect(warnings[0]).toContain('No element found with ID: notfoundid');
      expect(warnings[1]).toContain('No element found with class name: notfoundclass');
      expect(warnings[2]).toContain('No element found for XPath: //*[@id="notfoundxpath"]');
    });
  });

  describe('when no config is present', () => {
    it('throws an error if ctx is null', () => {
      expect(() => {
        markPseudoClassElements(null, { id: ['foo'] });
      }).toThrow();
    });

    it('does nothing and does not throw', () => {
      expect(() => markPseudoClassElements(ctx, undefined)).not.toThrow();
      expect(ctx.warnings.size).toBe(0);
    });
  });
});
