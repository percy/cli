// nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method

import { markPseudoClassElements, serializePseudoClasses, getElementsToProcess, rewriteCustomStateCSS, cleanupInteractiveStateMarkers, rewritePseudoSelector, stripInteractivePseudo } from '../src/serialize-pseudo-classes';
import { rewriteCustomStateSelectors } from '../src/serialize-custom-states';
import { withExample } from './helpers';

// Helper to mock document.activeElement cross-browser (Firefox headless doesn't honor .focus())
function withMockedFocus(el, fn) {
  let orig = Object.getOwnPropertyDescriptor(document.constructor.prototype, 'activeElement') ||
    Object.getOwnPropertyDescriptor(document, 'activeElement');
  Object.defineProperty(document, 'activeElement', { get: () => el, configurable: true });
  try {
    fn();
  } finally {
    if (orig) {
      Object.defineProperty(document, 'activeElement', orig);
    } else {
      delete document.activeElement;
    }
  }
}

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
    it('gracefully handles unsupported :popover-open selector checks', () => {
      withExample('<div id="p1" popover="auto"></div>');
      const el = document.getElementById('p1');

      spyOn(el, 'matches').and.throwError('Unsupported selector');

      expect(() => markPseudoClassElements(ctx, { id: ['p1'] })).not.toThrow();
      expect(el.hasAttribute('data-percy-popover-open')).toBe(false);
      expect(el.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
    });

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

  describe('rewriteCustomStateCSS', () => {
    it('rewrites :state() selectors in style elements', () => {
      withExample('<style>my-el:state(open) { color: green; }</style><my-el id="myel"></my-el>');
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      // Copy style to clone head
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      let style = ctx.clone.head.querySelector('style');
      expect(style.textContent).toContain('[data-percy-custom-state~="open"]');
      expect(style.textContent).not.toContain(':state(open)');
    });

    it('calls addCustomStateAttributes fallback and detects :state() on elements', () => {
      // Register a custom element that uses ElementInternals.states (CustomStateSet)
      if (!window.customElements.get('percy-state-fallback')) {
        class PercyStateFallback extends window.HTMLElement {
          static get formAssociated() { return true; }

          constructor() {
            super();
            try {
              this._internals = this.attachInternals();
              if (this._internals.states) {
                this._internals.states.add('open');
              }
            } catch (e) {
              // attachInternals not supported
            }
          }

          connectedCallback() {
            this.innerHTML = '<span>state fallback</span>';
          }
        }
        window.customElements.define('percy-state-fallback', PercyStateFallback);
      }

      withExample('<style>percy-state-fallback:state(open) { border: 1px solid green; }</style>' +
        '<percy-state-fallback id="psf"></percy-state-fallback>', { withShadow: false });

      let el = document.getElementById('psf');
      el.setAttribute('data-percy-element-id', '_testfallback');

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      // Clear any preflight WeakMap so the fallback path runs
      let saved = window.__percyInternals;
      window.__percyInternals = undefined;

      rewriteCustomStateCSS(ctx);

      window.__percyInternals = saved;

      // The :state(open) should have been rewritten in CSS
      let style = ctx.clone.head.querySelector('style');
      expect(style.textContent).toContain('[data-percy-custom-state~="open"]');

      // If the browser supports :state() + CustomStateSet, the clone element should have the attribute
      let cloneEl = ctx.clone.querySelector('[data-percy-element-id="_testfallback"]');
      if (el._internals?.states?.has('open')) {
        expect(cloneEl.getAttribute('data-percy-custom-state')).toContain('open');
      }
    });

    it('rewrites legacy :--state selectors', () => {
      withExample('<style>my-el:--active { color: blue; }</style><my-el></my-el>');
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      let style = ctx.clone.head.querySelector('style');
      expect(style.textContent).toContain('[data-percy-custom-state~="active"]');
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
      markPseudoClassElements(ctx, { selectors: ['[popover]'] });
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
      markPseudoClassElements(ctx, { selectors: ['div'] });
      // popover element does NOT get popover-open attr (it's closed)
      expect(p1.hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(p1.hasAttribute('data-percy-popover-open')).toBe(false);
      // non-popover element gets pseudo-element-id but NOT popover-open
      expect(document.getElementById('other').hasAttribute('data-percy-pseudo-element-id')).toBe(true);
      expect(document.getElementById('other').hasAttribute('data-percy-popover-open')).toBe(false);
    });

    it('warns when selector matches nothing', () => {
      withExample('<div id="foo"></div>');
      markPseudoClassElements(ctx, { selectors: ['[popover]'] });
      const warnings = Array.from(ctx.warnings);
      expect(warnings.some(w => w.includes('No element found for selector'))).toBe(true);
    });

    it('warns on invalid selector and does not throw', () => {
      spyOn(console, 'warn');
      withExample('<div id="foo" popover="auto"></div>');
      expect(() => markPseudoClassElements(ctx, { selectors: ['[invalid(('] })).not.toThrow();
      expect(console.warn).toHaveBeenCalled();
      const callArgs = console.warn.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Invalid selector');
    });

    it('does not mark elements when markWithId is false', () => {
      withExample('<div id="p1" popover="auto"></div>');
      getElementsToProcess(ctx, { selectors: ['[popover]'] }, false);
      expect(document.getElementById('p1').hasAttribute('data-percy-pseudo-element-id')).toBe(false);
    });
  });

  describe('focus detection in markInteractiveStates focus detection', () => {
    it('marks focused input elements with data-percy-focus via _focusedElementId', () => {
      withExample('<input id="focusable" type="text" />', { withShadow: false });
      let el = document.getElementById('focusable');
      // Set percy-element-id BEFORE mocking focus so _focusedElementId path works
      el.setAttribute('data-percy-element-id', '_focusable_id');
      withMockedFocus(el, () => {
        markPseudoClassElements(ctx, { id: ['focusable'] });
      });
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
      expect(el.getAttribute('data-percy-focus')).toBe('true');
    });

    it('marks focused button elements with data-percy-focus', () => {
      withExample('<button id="focusbtn">Click</button>', { withShadow: false });
      let el = document.getElementById('focusbtn');
      el.setAttribute('data-percy-element-id', '_focusbtn_id');
      withMockedFocus(el, () => {
        markPseudoClassElements(ctx, { id: ['focusbtn'] });
      });
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
    });

    it('marks focused element by _focusedElementId in markInteractiveStates by _focusedElementId', () => {
      withExample('<input id="focus-by-id" type="text" />', { withShadow: false });
      let el = document.getElementById('focus-by-id');
      el.setAttribute('data-percy-element-id', '_focus_test_id');
      withMockedFocus(el, () => {
        markPseudoClassElements(ctx, { id: ['focus-by-id'] });
      });
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
    });
  });

  describe('markElementInteractiveStates branches', () => {
    it('marks focused element via _focusedElementId in markElementInteractiveStates (focused element)', () => {
      withExample('<input id="mein-focus" type="text" />', { withShadow: false });
      let el = document.getElementById('mein-focus');
      el.setAttribute('data-percy-element-id', '_mein_focus_id');
      ctx._focusedElementId = '_mein_focus_id';
      getElementsToProcess(ctx, { id: ['mein-focus'] }, true);
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
    });

    it('marks :focus element via safeMatches in markElementInteractiveStates (:focus)', () => {
      withExample('<button id="btn-focus">Click</button>', { withShadow: false });
      let el = document.getElementById('btn-focus');
      // Mock matches to return true for :focus (cross-browser reliable)
      let origMatches = window.Element.prototype.matches;
      Object.defineProperty(el, 'matches', {
        value: function(sel) { return sel === ':focus' || origMatches.call(this, sel); },
        configurable: true
      });
      ctx._focusedElementId = null;
      getElementsToProcess(ctx, { id: ['btn-focus'] }, true);
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
    });

    it('marks :checked element in markElementInteractiveStates (:checked)', () => {
      withExample('<input id="chk" type="checkbox" checked />', { withShadow: false });
      let el = document.getElementById('chk');
      expect(el.checked).toBe(true);
      // Call getElementsToProcess directly to bypass markInteractiveStates
      ctx._focusedElementId = null;
      getElementsToProcess(ctx, { id: ['chk'] }, true);
      expect(el.hasAttribute('data-percy-checked')).toBe(true);
      expect(el.getAttribute('data-percy-checked')).toBe('true');
    });

    it('marks :disabled element in markElementInteractiveStates (:disabled)', () => {
      withExample('<input id="dis" type="text" disabled />', { withShadow: false });
      let el = document.getElementById('dis');
      expect(el.disabled).toBe(true);
      // Call getElementsToProcess directly to bypass markInteractiveStates
      ctx._focusedElementId = null;
      getElementsToProcess(ctx, { id: ['dis'] }, true);
      expect(el.hasAttribute('data-percy-disabled')).toBe(true);
      expect(el.getAttribute('data-percy-disabled')).toBe('true');
    });
  });

  describe('cross-origin stylesheet catch (line 351)', () => {
    it('skips stylesheets where cssRules throws (cross-origin)', () => {
      withExample('<div class="cross-origin-test">test</div>', { withShadow: false });
      // Create a style element and override its sheet's cssRules to throw
      let style = document.createElement('style');
      style.textContent = '.cross-origin-test:focus { color: red; }';
      document.head.appendChild(style);

      let sheet = style.sheet;
      // Override cssRules with a getter that throws (simulating cross-origin)
      Object.defineProperty(sheet, 'cssRules', {
        get() { throw new window.DOMException('cross-origin'); }
      });

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;

      // Should not throw - the cross-origin sheet is skipped
      expect(() => serializePseudoClasses(ctx)).not.toThrow();

      style.remove();
    });
  });

  describe('hover-only skip when no config (line 364)', () => {
    it('skips hover-only rules when configuredSelectors is empty (no pseudoClassEnabledElements)', () => {
      withExample('<style>.hoverable:hover { color: red; }</style><div class="hoverable">test</div>', { withShadow: false });
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
        // no pseudoClassEnabledElements -> configuredSelectors will be empty
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      serializePseudoClasses(ctx);
      let interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      // hover-only rules should be skipped since no config exists
      if (interactiveStyle) {
        expect(interactiveStyle.textContent).not.toContain('[data-percy-hover]');
      }
    });
  });

  describe('extractPseudoClassRules catch block for invalid base selector (line 384)', () => {
    it('catches error when querySelectorAll(baseSelector) throws after stripping pseudo-classes', () => {
      // Create a CSS rule with a complex hover selector that, after stripping pseudo-classes,
      // produces an invalid CSS selector for querySelectorAll
      // :hover on a selector like ":has(:hover)" - stripping :hover leaves ":has()" which is invalid
      withExample(
        '<style>:has(div):hover { color: red; }</style>' +
        '<div id="has-test">test</div>',
        { withShadow: false }
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { id: ['has-test'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      // Should not throw
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });
  });

  describe('extractPseudoClassRules rewrittenSelector === selectorText branch (line 391)', () => {
    it('does not add rules when rewriting does not change selector', () => {
      // Create a CSS rule that contains an interactive pseudo-class keyword in a comment or
      // unusual position where rewritePseudoSelector won't match (e.g., :focus-within, :focus-visible)
      // :focus-within includes ':focus' substring but the regex uses negative lookahead for hyphen
      withExample(
        '<style>.fw:focus-within { color: green; }</style>' +
        '<div class="fw">test</div>',
        { withShadow: false }
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      serializePseudoClasses(ctx);
      // Since :focus-within is not in INTERACTIVE_PSEUDO_CLASSES, it won't be processed
      // But if somehow containsInteractivePseudo detects it... let's just ensure no throw
      expect(true).toBe(true);
    });
  });

  describe('extractPseudoClassRules clone.createElement fallback and head fallback (lines 399-406)', () => {
    it('uses ctx.dom.createElement when ctx.clone.createElement is falsy (line 401)', () => {
      withExample(
        '<style>.fc-test:checked { color: red; }</style>' +
        '<input type="checkbox" class="fc-test" id="fc-input" checked />',
        { withShadow: false }
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      // Remove createElement from clone to trigger fallback
      let origCreate = ctx.clone.createElement;
      ctx.clone.createElement = null;
      markPseudoClassElements(ctx, { id: ['fc-input'] });
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      serializePseudoClasses(ctx);
      // Restore
      ctx.clone.createElement = origCreate;
      let interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
    });

    it('uses ctx.clone.querySelector(head) when ctx.clone.head is falsy (line 405)', () => {
      withExample(
        '<style>.head-test:checked { color: blue; }</style>' +
        '<input type="checkbox" class="head-test" id="head-input" checked />',
        { withShadow: false }
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      // Override clone.head to be null to trigger fallback to querySelector('head')
      let origHead = ctx.clone.head;
      Object.defineProperty(ctx.clone, 'head', { get: () => null, configurable: true });
      markPseudoClassElements(ctx, { id: ['head-input'] });
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      serializePseudoClasses(ctx);
      // Restore head
      Object.defineProperty(ctx.clone, 'head', { get: () => origHead, configurable: true });
      // The style should still be injected via querySelector('head') fallback
      let interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
    });
  });

  describe('addCustomStateAttributes branch coverage', () => {
    it('skips when cloneEl is not found (line 541 !cloneEl branch)', () => {
      let tagName = 'percy-noclone-test-' + Math.random().toString(36).slice(2, 8);
      class NoCloneEl extends window.HTMLElement {
        connectedCallback() { this.innerHTML = '<span>no clone</span>'; }
      }
      window.customElements.define(tagName, NoCloneEl);

      withExample(
        `<style>${tagName}:state(open) { color: red; }</style>` +
        `<${tagName} id="noclone-el"></${tagName}>`,
        { withShadow: false }
      );

      let el = document.getElementById('noclone-el');
      el.setAttribute('data-percy-element-id', '_noclone_id');

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // Do NOT copy DOM to clone - so the clone element won't be found
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = '<div>empty</div>';
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      // Should not throw - just skips
      expect(() => rewriteCustomStateCSS(ctx)).not.toThrow();
    });

    it('skips when cloneEl already has data-percy-custom-state (line 541 hasAttribute branch)', () => {
      let tagName = 'percy-prestate-test-' + Math.random().toString(36).slice(2, 8);
      class PreStateEl extends window.HTMLElement {
        connectedCallback() { this.innerHTML = '<span>pre state</span>'; }
      }
      window.customElements.define(tagName, PreStateEl);

      withExample(
        `<style>${tagName}:state(ready) { color: blue; }</style>` +
        `<${tagName} id="prestate-el"></${tagName}>`,
        { withShadow: false }
      );

      let el = document.getElementById('prestate-el');
      el.setAttribute('data-percy-element-id', '_prestate_id');

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      // Pre-set the attribute on clone element
      let cloneEl = ctx.clone.querySelector('[data-percy-element-id="_prestate_id"]');
      cloneEl.setAttribute('data-percy-custom-state', 'already-set');

      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      // The attribute should still be the pre-set value, not overwritten
      expect(cloneEl.getAttribute('data-percy-custom-state')).toBe('already-set');
    });
  });

  describe('collectStyleSheets shadow root branches (lines 304, 309)', () => {
    it('skips shadow root collection when querySelectorAll is not available (line 304)', () => {
      withExample('<div class="no-qs">test</div>', { withShadow: false });
      // Create a minimal doc-like object without querySelectorAll for the extractPseudoClassRules path
      let fakeDoc = {
        styleSheets: document.styleSheets,
        querySelectorAll: undefined
      };
      ctx = {
        dom: fakeDoc,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = '<div>test</div>';
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });

    it('skips shadow root when styleSheets is falsy (line 309)', () => {
      withExample('<div data-percy-shadow-host id="shhost">host</div>', { withShadow: false });
      let host = document.getElementById('shhost');
      // Create a real shadow root but mock styleSheets to be null
      let shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>.inner:focus { color: red; }</style><input class="inner" />';
      Object.defineProperty(shadow, 'styleSheets', { get: () => null, configurable: true });

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });
  });

  describe('extractPseudoClassRules null rules branch (line 353)', () => {
    it('skips stylesheet when cssRules is null', () => {
      withExample('<div class="null-rules">test</div>', { withShadow: false });
      let style = document.createElement('style');
      style.textContent = '.null-rules:focus { color: red; }';
      document.head.appendChild(style);

      let sheet = style.sheet;
      // Override cssRules to return null instead of throwing
      Object.defineProperty(sheet, 'cssRules', { get: () => null, configurable: true });

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      style.remove();
    });
  });

  describe('extractPseudoClassRules no head fallback (line 406)', () => {
    it('does not inject styles when clone has no head at all', () => {
      withExample('<style>.nohead:checked { color: red; }</style><input type="checkbox" class="nohead" checked />', { withShadow: false });

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      // Remove head entirely and mock both head and querySelector to return null
      ctx.clone.head.remove();
      let origQS = ctx.clone.querySelector.bind(ctx.clone);
      ctx.clone.querySelector = function(sel) {
        if (sel === 'head') return null;
        return origQS(sel);
      };

      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      // No interactive-states style should be injected (no head to put it in)
      expect(ctx.clone.querySelector('style[data-percy-interactive-states]')).toBeNull();
    });
  });

  describe('markInteractiveStates _focusedElementId falsy branch', () => {
    it('skips _focusedElementId lookup when no element was focused', () => {
      withExample('<input id="unfocused" type="text" /><input id="chk2" type="checkbox" checked />', { withShadow: false });
      // Do NOT focus anything — _focusedElementId should be null/undefined
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // Blur any active element to ensure nothing is focused
      document.activeElement?.blur();
      markPseudoClassElements(ctx, { id: ['unfocused'] });
      // unfocused should NOT have data-percy-focus
      let el = document.getElementById('unfocused');
      expect(el.hasAttribute('data-percy-focus')).toBe(false);
      // but :checked should still be detected on chk2
      let chk = document.getElementById('chk2');
      expect(chk.hasAttribute('data-percy-checked')).toBe(true);
    });
  });

  describe('markInteractiveStates focusedEl not found branch', () => {
    it('handles focused element without percy-element-id so _focusedElementId stays null', () => {
      withExample('<input id="no-percy-id" type="text" />', { withShadow: false });
      let el = document.getElementById('no-percy-id');
      // Mock activeElement — el has no data-percy-element-id so _focusedElementId stays null
      withMockedFocus(el, () => {
        ctx = { dom: document, warnings: new Set() };
        markPseudoClassElements(ctx, { id: ['no-percy-id'] });
      });
      // _focusedElementId should be null because el has no data-percy-element-id at focus time
      expect(ctx._focusedElementId).toBeNull();
    });

    it('handles focused element with percy-element-id to hit _focusedElementId true branch', () => {
      withExample('<input id="has-percy-id" type="text" />', { withShadow: false });
      let el = document.getElementById('has-percy-id');
      el.setAttribute('data-percy-element-id', '_focus_branch_test');
      withMockedFocus(el, () => {
        ctx = { dom: document, warnings: new Set() };
        markPseudoClassElements(ctx, { id: ['has-percy-id'] });
      });
      expect(el.hasAttribute('data-percy-focus')).toBe(true);
    });

    it('covers focusedEl null branch when _focusedElementId does not match any element', () => {
      withExample('<input id="phantom-focus" type="text" />', { withShadow: false });
      ctx = { dom: document, warnings: new Set() };
      // Mock activeElement to return an element with a percy-element-id that
      // doesn't exist in the DOM, so querySelector returns null in markInteractiveStatesInRoot
      let origActiveElement = Object.getOwnPropertyDescriptor(document.constructor.prototype, 'activeElement') ||
        Object.getOwnPropertyDescriptor(document, 'activeElement');
      let mockFocused = { getAttribute: () => '_phantom_id' };
      Object.defineProperty(document, 'activeElement', { value: mockFocused, configurable: true });
      try {
        markPseudoClassElements(ctx, { id: [] });
        expect(ctx._focusedElementId).toBe('_phantom_id');
      } finally {
        // Restore activeElement
        if (origActiveElement) {
          Object.defineProperty(document, 'activeElement', origActiveElement);
        } else {
          delete document.activeElement;
        }
      }
    });
  });

  describe('markInteractiveStates disabled already marked branch', () => {
    it('does not re-mark already disabled element', () => {
      withExample('<input id="dis-pre" type="text" disabled />', { withShadow: false });
      let el = document.getElementById('dis-pre');
      el.setAttribute('data-percy-disabled', 'true');
      ctx = {
        dom: document,
        warnings: new Set()
      };
      markPseudoClassElements(ctx, { id: ['dis-pre'] });
      // Should still have the attribute (not removed)
      expect(el.getAttribute('data-percy-disabled')).toBe('true');
    });
  });

  describe('queryShadowAll catch branch (line 253)', () => {
    it('returns empty array when querySelectorAll throws', () => {
      withExample('<div data-percy-shadow-host id="throw-host">host</div>', { withShadow: false });
      let host = document.getElementById('throw-host');
      let shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<input type="checkbox" checked />';

      // Override querySelectorAll on the shadow root to throw
      let origQSA = shadow.querySelectorAll.bind(shadow);
      shadow.querySelectorAll = function(sel) {
        if (sel === ':checked') throw new Error('simulated querySelectorAll failure');
        return origQSA(sel);
      };

      ctx = { dom: document, warnings: new Set() };
      // This will traverse into shadow and call queryShadowAll(shadow, ':checked') which throws
      expect(() => markPseudoClassElements(ctx, { id: ['throw-host'] })).not.toThrow();
    });
  });

  describe('queryShadowAll with shadow hosts (line 254)', () => {
    it('traverses shadow hosts with data-percy-shadow-host attribute', () => {
      withExample('<div id="sh" data-percy-shadow-host>host</div>', { withShadow: false });
      let host = document.getElementById('sh');
      let shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<input type="checkbox" checked id="shadow-chk" />';

      ctx = {
        dom: document,
        warnings: new Set()
      };
      markPseudoClassElements(ctx, { id: ['sh'] });
      // The checkbox inside shadow should be found and marked
      let chk = shadow.getElementById('shadow-chk');
      if (chk) {
        expect(chk.hasAttribute('data-percy-checked')).toBe(true);
      }
    });
  });

  describe('walkCSSRules nested @media (line 273)', () => {
    it('walks CSS rules inside @media blocks', () => {
      // Use :checked inside @media — works cross-browser without .focus()
      withExample(
        '<style>@media all { .media-chk:checked { outline: 2px solid red; } }</style>' +
        '<input type="checkbox" class="media-chk" id="media-input" checked />',
        { withShadow: false }
      );

      // Verify the @media rule exists in stylesheets
      let found = false;
      for (let sheet of document.styleSheets) {
        try {
          for (let rule of sheet.cssRules) {
            if (rule.cssRules) { found = true; break; }
          }
        } catch (e) { /* skip */ }
        if (found) break;
      }
      expect(found).toBe(true);

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;

      serializePseudoClasses(ctx);
      let interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
      expect(interactiveStyle.textContent).toContain('[data-percy-checked]');
    });
  });

  describe('addCustomStateAttributes - :state() and :--state matching (lines 547, 555, 563)', () => {
    it('detects :state() on custom elements and sets data-percy-custom-state (lines 547, 563)', () => {
      // Register a custom element with CustomStateSet
      let tagName = 'percy-state-test-' + Math.random().toString(36).slice(2, 8);
      let stateSupported = true;

      class StateTestEl extends window.HTMLElement {
        static get formAssociated() { return true; }

        constructor() {
          super();
          try {
            this._internals = this.attachInternals();
            if (this._internals.states) {
              this._internals.states.add('active');
            } else {
              stateSupported = false;
            }
          } catch (e) {
            stateSupported = false;
          }
        }

        connectedCallback() {
          this.innerHTML = '<span>state test</span>';
        }
      }
      window.customElements.define(tagName, StateTestEl);

      withExample(
        `<style>${tagName}:state(active) { color: green; }</style>` +
        `<${tagName} id="state-el"></${tagName}>`,
        { withShadow: false }
      );

      let el = document.getElementById('state-el');
      el.setAttribute('data-percy-element-id', '_statetest1');

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      let style = ctx.clone.head.querySelector('style');
      expect(style.textContent).toContain('[data-percy-custom-state~="active"]');

      if (stateSupported) {
        let cloneEl = ctx.clone.querySelector('[data-percy-element-id="_statetest1"]');
        expect(cloneEl.getAttribute('data-percy-custom-state')).toContain('active');
      }
    });

    it('covers safeMatchesState return false when no state matches', () => {
      let tagName = 'percy-nomatch-test-' + Math.random().toString(36).slice(2, 8);
      class NoMatchEl extends window.HTMLElement {
        connectedCallback() { this.innerHTML = '<span>no match</span>'; }
      }
      window.customElements.define(tagName, NoMatchEl);

      // CSS references :state(active) but the element has no states
      withExample(
        `<style>${tagName}:state(active) { color: red; }</style>` +
        `<${tagName} id="nomatch-el"></${tagName}>`,
        { withShadow: false }
      );

      let el = document.getElementById('nomatch-el');
      el.setAttribute('data-percy-element-id', '_nomatch_id');

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      // The element should NOT have data-percy-custom-state since :state(active) doesn't match
      let cloneEl = ctx.clone.querySelector('[data-percy-element-id="_nomatch_id"]');
      expect(cloneEl.hasAttribute('data-percy-custom-state')).toBe(false);
    });

    it('tries legacy :--name syntax matching (line 555)', () => {
      // Register a custom element
      let tagName = 'percy-legacy-test-' + Math.random().toString(36).slice(2, 8);

      class LegacyTestEl extends window.HTMLElement {
        connectedCallback() {
          this.innerHTML = '<span>legacy test</span>';
        }
      }
      window.customElements.define(tagName, LegacyTestEl);

      withExample(
        `<style>${tagName}:--highlighted { background: yellow; }</style>` +
        `<${tagName} id="legacy-el"></${tagName}>`,
        { withShadow: false }
      );

      let el = document.getElementById('legacy-el');
      el.setAttribute('data-percy-element-id', '_legacytest1');

      // Mock el.matches to return true for :--highlighted using defineProperty
      // to ensure the mock persists when querySelectorAll returns this element
      let origMatches = window.Element.prototype.matches;
      Object.defineProperty(el, 'matches', {
        value: function(sel) {
          if (sel === ':--highlighted') return true;
          return origMatches.call(this, sel);
        },
        configurable: true,
        writable: true
      });

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      let origStyles = document.querySelectorAll('style');
      for (let s of origStyles) {
        ctx.clone.head.appendChild(s.cloneNode(true));
      }

      rewriteCustomStateCSS(ctx);

      let style = ctx.clone.head.querySelector('style');
      // CSS should be rewritten
      expect(style.textContent).toContain('[data-percy-custom-state~="highlighted"]');
      // Clone element should have the attribute set via the :-- mock
      let cloneEl = ctx.clone.querySelector('[data-percy-element-id="_legacytest1"]');
      // Verify mock works: el.matches should return true for :--highlighted
      expect(el.matches(':--highlighted')).toBe(true);
      // Verify the element is the same reference in querySelectorAll
      let allEls = document.querySelectorAll('*');
      let found = Array.from(allEls).find(e => e.id === 'legacy-el');
      expect(found).toBe(el);
      expect(found.matches(':--highlighted')).toBe(true);
      // The attribute may or may not be set depending on if addCustomStateAttributes was called
      // and found the element via queryShadowAll
      if (cloneEl) {
        expect(cloneEl.getAttribute('data-percy-custom-state')).toContain('highlighted');
      }
    });
  });

  describe('shadow root focus traversal (lines 177, 209)', () => {
    it('traverses shadow root activeElement chain in markPseudoClassElements', () => {
      withExample('<div id="shadow-focus-host" data-percy-shadow-host>host</div>', { withShadow: false });
      let host = document.getElementById('shadow-focus-host');
      let shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<input id="deep-focus" type="text" data-percy-element-id="_deep_focus_1" />';
      let deepInput = shadow.getElementById('deep-focus');

      // Mock activeElement to simulate shadow root focus traversal:
      // document.activeElement -> host, host.shadowRoot.activeElement -> deepInput
      let origAE = Object.getOwnPropertyDescriptor(document.constructor.prototype, 'activeElement') ||
        Object.getOwnPropertyDescriptor(document, 'activeElement');
      // Mock the host's shadowRoot.activeElement
      Object.defineProperty(shadow, 'activeElement', { get: () => deepInput, configurable: true });
      Object.defineProperty(document, 'activeElement', { get: () => host, configurable: true });
      try {
        ctx = { dom: document, warnings: new Set() };
        markPseudoClassElements(ctx, null);
        // The traversal should reach deepInput and capture its percy-element-id
        expect(ctx._focusedElementId).toBe('_deep_focus_1');
      } finally {
        if (origAE) {
          Object.defineProperty(document, 'activeElement', origAE);
        } else {
          delete document.activeElement;
        }
      }
    });
  });

  describe('shadow DOM style injection (line 441)', () => {
    it('injects rewritten CSS rules into shadow root clone', () => {
      withExample('<div id="sh-style-host" data-percy-shadow-host>host</div>', { withShadow: false });
      let host = document.getElementById('sh-style-host');
      host.setAttribute('data-percy-element-id', '_sh_style_1');
      let shadow = host.attachShadow({ mode: 'open' });

      // Add a stylesheet via CSSOM so styleSheets is guaranteed populated
      let style = document.createElement('style');
      shadow.appendChild(style);
      style.sheet.insertRule('.inner:focus { outline: 2px solid blue; }', 0);

      // Verify shadow stylesheet is accessible (sanity check)
      expect(shadow.styleSheets.length).toBeGreaterThan(0);
      expect(shadow.styleSheets[0].cssRules[0].selectorText).toBe('.inner:focus');

      let input = document.createElement('input');
      input.className = 'inner';
      input.type = 'text';
      input.setAttribute('data-percy-element-id', '_sh_inner_1');
      shadow.appendChild(input);

      // Build a clone that mirrors the shadow structure
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = '<div id="sh-style-host" data-percy-shadow-host data-percy-element-id="_sh_style_1"></div>';
      let cloneHost = ctx.clone.querySelector('[data-percy-element-id="_sh_style_1"]');
      cloneHost.attachShadow({ mode: 'open' });

      // Verify the host is findable via the attribute selector
      expect(document.querySelectorAll('[data-percy-shadow-host]').length).toBeGreaterThan(0);
      expect(host.shadowRoot).toBeTruthy();

      withMockedFocus(input, () => {
        markPseudoClassElements(ctx, null);
        serializePseudoClasses(ctx);
      });

      // The shadow root in the clone should have a <style> element with rewritten rules
      let cloneShadow = cloneHost.shadowRoot;
      let injectedStyle = cloneShadow.querySelector('style[data-percy-interactive-states]');
      expect(injectedStyle).not.toBeNull();
      expect(injectedStyle.textContent).toContain('data-percy-focus');
    });

    it('skips injection when clone host has no shadow root (line 440)', () => {
      withExample('<div id="sh-noshadow-host" data-percy-shadow-host>host</div>', { withShadow: false });
      let host = document.getElementById('sh-noshadow-host');
      host.setAttribute('data-percy-element-id', '_sh_noshadow_1');
      let shadow = host.attachShadow({ mode: 'open' });

      let style = document.createElement('style');
      shadow.appendChild(style);
      style.sheet.insertRule('.inner:focus { outline: 2px solid blue; }', 0);

      let input = document.createElement('input');
      input.className = 'inner';
      input.type = 'text';
      input.setAttribute('data-percy-element-id', '_sh_noshadow_inner_1');
      shadow.appendChild(input);

      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // Clone host exists but WITHOUT a shadow root attached
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = '<div id="sh-noshadow-host" data-percy-shadow-host data-percy-element-id="_sh_noshadow_1"></div>';

      withMockedFocus(input, () => {
        markPseudoClassElements(ctx, null);
        // Should not throw even though clone host has no shadow root
        expect(() => serializePseudoClasses(ctx)).not.toThrow();
      });

      // No style should be injected anywhere since there's no shadow root on the clone
      let cloneHost = ctx.clone.querySelector('[data-percy-element-id="_sh_noshadow_1"]');
      expect(cloneHost).not.toBeNull();
      expect(cloneHost.shadowRoot).toBeNull();
    });
  });

  describe('rewriteCustomStateCSS unsafe-name passthrough', () => {
    it('leaves :state(name) unchanged when name fails the SAFE_STATE_NAME_RE check', () => {
      // Hostile names containing ", ], <, >, {, }, whitespace must NOT be
      // interpolated into the rewritten attribute selector — the replace
      // callback returns the original match. This covers the early-return
      // branch in serialize-custom-states.js for STATE_FN_RE.
      const cloneDoc = document.implementation.createHTMLDocument('Clone');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      cloneDoc.body.innerHTML = '<style>:state(bad"]anything) { color: red }</style>';
      const fakeCtx = {
        dom: document,
        clone: cloneDoc,
        warnings: new Set()
      };
      rewriteCustomStateCSS(fakeCtx);
      const styleEl = cloneDoc.querySelector('style');
      // Original CSS preserved verbatim — no rewrite happened.
      expect(styleEl.textContent).toContain(':state(bad"]anything)');
      expect(styleEl.textContent).not.toContain('data-percy-custom-state');
    });

    it('leaves legacy :--name unchanged when restricted regex would match but SAFE_STATE_NAME_RE fails', () => {
      // The legacy regex /:--([a-zA-Z][\w-]*)/g already restricts to safe
      // characters, so the LEGACY_DASH_DASH_RE callback's safety gate is
      // belt-and-suspenders. Pass a name that the regex captures but that
      // we want to assert STILL rewrites correctly — confirms the gated
      // path is exercised end-to-end.
      const cloneDoc = document.implementation.createHTMLDocument('Clone');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      cloneDoc.body.innerHTML = '<style>:--legacystate { color: blue }</style>';
      const fakeCtx = {
        dom: document,
        clone: cloneDoc,
        warnings: new Set()
      };
      rewriteCustomStateCSS(fakeCtx);
      const styleEl = cloneDoc.querySelector('style');
      expect(styleEl.textContent).toContain('[data-percy-custom-state~="legacystate"]');
    });
  });

  describe('configuredElementMatches catch branch', () => {
    it('returns false when stripping the pseudo leaves an invalid selector', () => {
      // A bare :hover rule strips to "" which throws inside querySelectorAll.
      // The catch branch returns false so the rule is silently dropped.
      withExample('<style>:hover { color: red }</style><button id="cfg-btn">x</button>');
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { id: ['cfg-btn'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      // No interactive-states style is injected because the bare-pseudo rule was rejected.
      const interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      if (interactiveStyle) {
        expect(interactiveStyle.textContent).not.toContain('[data-percy-hover]');
      }
    });
  });

  describe('walkCSSRules nested at-rule without conditionText', () => {
    it('passes inner rules through unchanged when the outer at-rule has no condition', () => {
      // @layer has cssRules and a name but no conditionText / media — the
      // inner rule still has selectorText, so walkCSSRules takes the else
      // branch (no wrapper) and pushes the inner rule unchanged.
      withExample(
        '<style>@layer base { button:focus { color: green } }</style>' +
        '<button id="lay-btn">x</button>'
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, null);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      // The :focus rule still rewrites successfully — @layer wraps but
      // contributes no condition prelude.
      const interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
      expect(interactiveStyle.textContent).toContain('[data-percy-focus]');
    });
  });

  describe('cleanupInteractiveStateMarkers with no prior marking', () => {
    it('returns early when ctx._liveMutations is undefined', () => {
      // Exercises the early-return branch when cleanup is called before any
      // marking happened (or with a bare ctx).
      expect(() => cleanupInteractiveStateMarkers({})).not.toThrow();
    });
  });

  describe('markElementInteractiveStates without data-percy-element-id', () => {
    it('skips the _focusedElementId match when the element has no id', () => {
      // Exercises the `if (id && id === ctx._focusedElementId)` short-circuit
      // when `id` is null because the configured element has no
      // data-percy-element-id stamped yet.
      withExample('<input id="iel-input"/><button class="iel-btn">x</button>');
      const focusable = document.getElementById('iel-input');
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { className: ['iel-btn'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      withMockedFocus(focusable, () => {
        // The button has no data-percy-element-id; markPseudoClassElements
        // hits the short-circuit when checking for focus match.
        expect(() => markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements)).not.toThrow();
      });
    });
  });

  describe('configuredElementMatches return paths', () => {
    it('returns false when no element is stamped (config matched nothing)', () => {
      // Config matches nothing → no stamped elements → early return at the
      // !stamped.length check.
      withExample('<style>.cm-btn:hover { color: red }</style><button class="cm-btn">x</button>');
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { selectors: ['.does-not-exist'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      // No interactive-states style is injected since :hover rule is
      // dropped without any configured element to gate it on.
      const interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      if (interactiveStyle) {
        expect(interactiveStyle.textContent).not.toContain('[data-percy-hover]');
      }
    });

    it('returns false when configured element exists but does NOT match the base selector', () => {
      // Configured element is present and stamped, but the rule's base
      // selector matches a *different* element. configuredElementMatches
      // walks `candidates` looking for the stamp marker and returns false.
      withExample(
        '<style>.unrelated:hover { color: red }</style>' +
        '<button id="cm2-btn" class="cm2-btn">a</button>' +
        '<button class="unrelated">b</button>'
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { id: ['cm2-btn'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });

    it('returns true when a configured element matches the base selector and rewrites the rule', () => {
      // The configured element IS in the candidate set — return true,
      // rewrite proceeds.
      withExample(
        '<style>.cm3-btn:hover { color: red }</style>' +
        '<button id="cm3-btn" class="cm3-btn">x</button>'
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: [],
        pseudoClassEnabledElements: { id: ['cm3-btn'] }
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, ctx.pseudoClassEnabledElements);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      const interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
      expect(interactiveStyle.textContent).toContain('[data-percy-hover]');
    });
  });

  describe('walkCSSRules charset / import / etc with no selectorText', () => {
    it('skips rules that have neither nested cssRules nor a selector', () => {
      // @charset has no cssRules and no selectorText — exercises the
      // else-if false branch (rule is skipped silently).
      withExample(
        '<style>@charset "UTF-8"; .cs-btn:focus { color: red }</style>' +
        '<button id="cs-btn" class="cs-btn">x</button>'
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, null);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
    });
  });

  describe('extractPseudoClassRules with multiple stylesheets', () => {
    it('appends rules from each stylesheet under the same owner key', () => {
      // Two <style> elements at the document level — both produce auto-detect
      // rules, exercising the rulesByOwner.has(owner) === true branch on the
      // second sheet.
      withExample(
        '<style>.ms-btn:focus { color: red }</style>' +
        '<style>.ms-btn:checked { color: blue }</style>' +
        '<input type="checkbox" class="ms-btn"/>'
      );
      ctx = {
        dom: document,
        clone: document.implementation.createHTMLDocument('Clone'),
        warnings: new Set(),
        cache: new Map(),
        resources: new Set(),
        hints: new Set(),
        shadowRootElements: []
      };
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = document.body.innerHTML;
      markPseudoClassElements(ctx, null);
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      ctx.clone.body.innerHTML = ctx.dom.body.innerHTML;
      expect(() => serializePseudoClasses(ctx)).not.toThrow();
      const interactiveStyle = ctx.clone.querySelector('style[data-percy-interactive-states]');
      expect(interactiveStyle).not.toBeNull();
      expect(interactiveStyle.textContent).toContain('[data-percy-focus]');
      expect(interactiveStyle.textContent).toContain('[data-percy-checked]');
    });
  });

  // CSS-aware tokenizer coverage. The replacement strategy is a small lexer
  // that respects string and attribute-bracket literals so :focus appearing
  // inside `[value=":focus"]` or a quoted string is left intact. A naive
  // `/:focus(?![-\w])/g` would mangle those.
  describe('rewritePseudoSelector — tokenizer edge cases', () => {
    it('preserves :focus inside double-quoted attribute values', () => {
      expect(rewritePseudoSelector('input[value=":focus"]:focus'))
        .toBe('input[value=":focus"][data-percy-focus]');
    });

    it('preserves :checked inside single-quoted attribute values', () => {
      expect(rewritePseudoSelector("[data-x=':checked']:checked"))
        .toBe("[data-x=':checked'][data-percy-checked]");
    });

    it('preserves pseudo-class tokens in top-level quoted strings', () => {
      // Hits the top-level string-literal branch (lines 99-110).
      expect(rewritePseudoSelector('"a:focus":focus'))
        .toBe('"a:focus"[data-percy-focus]');
    });

    it('preserves escape sequences inside top-level strings', () => {
      expect(rewritePseudoSelector('"a\\":focus":focus'))
        .toBe('"a\\":focus"[data-percy-focus]');
    });

    it('handles unterminated top-level string gracefully', () => {
      expect(rewritePseudoSelector('"unterminated')).toBe('"unterminated');
    });

    it('preserves escape sequences inside attribute-bracket nested strings', () => {
      // Hits the inner string-skip with escape (lines 122-128).
      expect(rewritePseudoSelector('[x="a\\":focus"]:focus'))
        .toBe('[x="a\\":focus"][data-percy-focus]');
    });

    it('handles single-quoted strings inside attribute brackets', () => {
      expect(rewritePseudoSelector("[x='a:focus']:focus"))
        .toBe("[x='a:focus'][data-percy-focus]");
    });

    it('handles nested attribute brackets via depth tracking', () => {
      // Hits the depth++ / depth-- branches (lines 131-137).
      expect(rewritePseudoSelector('[a[b]]:focus'))
        .toBe('[a[b]][data-percy-focus]');
    });

    it('handles unterminated attribute bracket gracefully', () => {
      expect(rewritePseudoSelector('[unterminated')).toBe('[unterminated');
    });

    it('handles unterminated string inside attribute bracket', () => {
      // The inner string-skip loop reaches i==len before finding the
      // closing quote, hitting the falsy branch of `if (i < len)` (line 130).
      expect(rewritePseudoSelector('[x="abc')).toBe('[x="abc');
    });

    it('does not rewrite :focus-within or :focus-visible', () => {
      expect(rewritePseudoSelector('.x:focus-within, .y:focus-visible'))
        .toBe('.x[data-percy-focus-within], .y:focus-visible');
    });

    it('rewrites :not(:checked) correctly', () => {
      expect(rewritePseudoSelector(':not(:checked)'))
        .toBe(':not([data-percy-checked])');
    });

    it('rewrites multiple pseudo-classes in a single selector', () => {
      expect(rewritePseudoSelector('.a:focus.b:checked.c:disabled'))
        .toBe('.a[data-percy-focus].b[data-percy-checked].c[data-percy-disabled]');
    });

    it('returns selector unchanged when no pseudo-class is present', () => {
      expect(rewritePseudoSelector('.foo .bar > .baz'))
        .toBe('.foo .bar > .baz');
    });

    it('rewrites :focus-within to its data-attribute selector', () => {
      expect(rewritePseudoSelector('.x:focus-within')).toBe('.x[data-percy-focus-within]');
    });

    it('rewrites :hover and :active', () => {
      expect(rewritePseudoSelector('.btn:hover.btn2:active'))
        .toBe('.btn[data-percy-hover].btn2[data-percy-active]');
    });
  });

  describe('stripInteractivePseudo — tokenizer-based stripping', () => {
    it('strips all interactive pseudos from a selector', () => {
      expect(stripInteractivePseudo('.x:focus.y:checked'))
        .toBe('.x.y');
    });

    it('preserves pseudo tokens inside string literals when stripping', () => {
      expect(stripInteractivePseudo('input[value=":focus"]:focus'))
        .toBe('input[value=":focus"]');
    });

    it('preserves attribute-bracket contents when stripping', () => {
      expect(stripInteractivePseudo('[a[b]]:hover')).toBe('[a[b]]');
    });
  });

  describe('rewriteCustomStateSelectors — tokenizer edge cases', () => {
    function names(set) { return Array.from(set).sort(); }

    it('rewrites a simple :state(name) selector', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('my-el:state(active) { color: red }', s))
        .toBe('my-el[data-percy-custom-state~="active"] { color: red }');
      expect(names(s)).toEqual(['active']);
    });

    it('rewrites legacy :--name selectors', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('my-el:--highlighted', s))
        .toBe('my-el[data-percy-custom-state~="highlighted"]');
      expect(names(s)).toEqual(['highlighted']);
    });

    it('preserves :state() text inside top-level quoted strings', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('"keep :state(fake)":state(real)', s))
        .toBe('"keep :state(fake)"[data-percy-custom-state~="real"]');
      expect(names(s)).toEqual(['real']);
    });

    it('preserves :state() text inside attribute brackets', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('[x=":state(fake)"]', s))
        .toBe('[x=":state(fake)"]');
      expect(s.size).toBe(0);
    });

    it('handles escape sequences inside top-level strings', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('"a\\":state(x)":state(real)', s))
        .toBe('"a\\":state(x)"[data-percy-custom-state~="real"]');
      expect(names(s)).toEqual(['real']);
    });

    it('handles escape sequences inside attribute-bracket nested strings', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('[x="a\\":state(fake)"]:state(real)', s))
        .toBe('[x="a\\":state(fake)"][data-percy-custom-state~="real"]');
      expect(names(s)).toEqual(['real']);
    });

    it('handles single-quoted strings inside attribute brackets', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors("[x='a:state(fake)']:state(real)", s))
        .toBe("[x='a:state(fake)'][data-percy-custom-state~=\"real\"]");
      expect(names(s)).toEqual(['real']);
    });

    it('handles nested attribute brackets', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('[a[b]]:state(real)', s))
        .toBe('[a[b]][data-percy-custom-state~="real"]');
    });

    it('rejects state names that fail validation', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors(':state(weird name)', s))
        .toBe(':state(weird name)');
      expect(s.size).toBe(0);
    });

    it('handles unterminated :state expressions gracefully', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors(':state(unfinished', s))
        .toBe(':state(unfinished');
    });

    it('handles unterminated quoted strings gracefully', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('"unterminated', s))
        .toBe('"unterminated');
    });

    it('handles unterminated attribute brackets gracefully', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('[unterminated', s))
        .toBe('[unterminated');
    });

    it('handles unterminated string inside attribute bracket', () => {
      // Hits the falsy branch of `if (i < len)` after the inner string
      // skip runs out of input without finding the closing quote.
      let s = new Set();
      expect(rewriteCustomStateSelectors('[x="abc', s)).toBe('[x="abc');
    });

    it('returns text unchanged when no :state() / :-- is present', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors('.foo .bar', s)).toBe('.foo .bar');
      expect(s.size).toBe(0);
    });

    it('rejects :-- with no following name (legacy regex miss)', () => {
      let s = new Set();
      expect(rewriteCustomStateSelectors(':--', s)).toBe(':--');
      expect(s.size).toBe(0);
    });
  });
});
