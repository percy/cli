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
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
        ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      });

      it('adds warning if pseudo clone element is not found', () => {
        // Remove marker from clone for 'foo' so it cannot be found
        console.log('-->> ', ctx.clone.getElementById('foo'));
        ctx.clone.getElementById('foo').removeAttribute('data-percy-pseudo-element-id');
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
        ctx.clone.body.innerHTML = originalClonedBody;
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
        ctx.dom.body.innerHTML = orginalBody;
      });

      describe('handles getComputedStyle errors gracefully', () => {
        let origGetComputedStyle;
        beforeEach(() => {
          // Setup DOM and clone
          withExample('<div id="foo"></div><div class="bar"></div><div id="baz"></div>');
          ctx.clone = document.implementation.createHTMLDocument('Clone');
          // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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
          // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
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

  describe('popover element handling via markPseudoClassElements', () => {
    it('stamps data-percy-popover-open only when popover is actually open', () => {
      withExample('<div id="p1" popover="auto"></div>');
      const el = document.getElementById('p1');
      if (typeof el.showPopover !== 'function') {
        pending('Popover API not supported in this environment');
        return;
      }
      el.showPopover();
      markPseudoClassElements(ctx, { id: ['p1'] });
      expect(el.hasAttribute('data-percy-popover-open')).toBe(true);
      expect(el.getAttribute('data-percy-popover-open')).toBe('true');
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(true);

      if (typeof el.hidePopover === 'function') el.hidePopover();
    });

    it('does NOT stamp data-percy-popover-open when popover is closed', () => {
      withExample('<div id="p1" popover="auto"></div>');
      const el = document.getElementById('p1');
      // Don't open the popover, keep it closed
      markPseudoClassElements(ctx, { id: ['p1'] });
      expect(el.hasAttribute('data-percy-popover-open')).toBe(false);
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
    });

    it('does NOT stamp any attributes when markWithId is false', () => {
      withExample('<div id="p1" popover="auto"></div>');
      const el = document.getElementById('p1');
      if (typeof el.showPopover !== 'function') {
        pending('Popover API not supported in this environment');
        return;
      }
      el.showPopover();
      getElementsToProcess(ctx, { id: ['p1'] }, false);
      expect(el.hasAttribute('data-percy-popover-open')).toBe(false);
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(false);
      if (typeof el.hidePopover === 'function') el.hidePopover();
    });

    it('does NOT stamp data-percy-popover-open on non-popover elements', () => {
      withExample('<div id="foo"></div>');
      markPseudoClassElements(ctx, { id: ['foo'] });
      const el = document.getElementById('foo');
      expect(el.hasAttribute('data-percy-popover-open')).toBe(false);
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
    });
  });

  describe('selector branch in getElementsToProcess', () => {
    it('marks popover elements matched by a [popover] selector when open', () => {
      withExample('<div id="p1" popover="auto"></div><div id="p2" popover="manual"></div>');
      const p1 = document.getElementById('p1');
      const p2 = document.getElementById('p2');
      // Open both popovers
      if (typeof p1.showPopover !== 'function' || typeof p2.showPopover !== 'function') {
        pending('Popover API not supported in this environment');
        return;
      }
      p1.showPopover();
      p2.showPopover();
      markPseudoClassElements(ctx, { selector: ['[popover]'] });
      expect(p1.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(p1.hasAttribute('data-percy-popover-open')).toBe(true);
      expect(p1.getAttribute('data-percy-popover-open')).toBe('true');
      expect(p2.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(p2.hasAttribute('data-percy-popover-open')).toBe(true);
      expect(p2.getAttribute('data-percy-popover-open')).toBe('true');

      if (typeof p1.hidePopover === 'function') p1.hidePopover();
      if (typeof p2.hidePopover === 'function') p2.hidePopover();
    });

    it('marks all matched elements including non-popover ones', () => {
      withExample('<div id="p1" popover="auto"></div><div id="other"></div>');
      const p1 = document.getElementById('p1');
      markPseudoClassElements(ctx, { selector: ['div'] });
      // popover element does NOT get popover-open attr (it's closed)
      expect(p1.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(p1.hasAttribute('data-percy-popover-open')).toBe(false);
      // non-popover element gets pseudo-element-id but NOT popover-open
      expect(document.getElementById('other').hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(document.getElementById('other').hasAttribute('data-percy-popover-open')).toBe(false);
    });

    it('warns when selector matches nothing', () => {
      withExample('<div id="foo"></div>');
      markPseudoClassElements(ctx, { selector: ['[popover]'] });
      const warnings = Array.from(ctx.warnings);
      expect(warnings.some(w => w.includes('No element found for selector'))).toBe(true);
    });

    it('warns on invalid selector and does not throw', () => {
      spyOn(console, 'warn');
      withExample('<div id="foo" popover="auto"></div>');
      expect(() => markPseudoClassElements(ctx, { selector: ['[invalid(('] })).not.toThrow();
      expect(console.warn).toHaveBeenCalled();
      const callArgs = console.warn.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Invalid selector');
    });

    it('does not mark elements when markWithId is false', () => {
      withExample('<div id="p1" popover="auto"></div>');
      getElementsToProcess(ctx, { selector: ['[popover]'] }, false);
      expect(document.getElementById('p1').hasAttribute('data-percy-pseudo-element-id')).toBe(false);
    });
  });
});
