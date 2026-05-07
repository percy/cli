import { setupTest } from '../helpers/index.js';
import {
  DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT,
  WAIT_FOR_CUSTOM_ELEMENTS_BODY
} from '../../src/page.js';

describe('Unit / Page module', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT', () => {
    it('is a positive integer in the 0–10000 range (matches schema)', () => {
      expect(typeof DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT).toBe('number');
      expect(Number.isInteger(DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT)).toBe(true);
      expect(DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT).toBeGreaterThan(0);
      expect(DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT).toBeLessThanOrEqual(10000);
    });
  });

  describe('WAIT_FOR_CUSTOM_ELEMENTS_BODY', () => {
    it('is a JS string with the expected polling structure', () => {
      expect(typeof WAIT_FOR_CUSTOM_ELEMENTS_BODY).toBe('string');
      expect(WAIT_FOR_CUSTOM_ELEMENTS_BODY).toContain(':not(:defined)');
      expect(WAIT_FOR_CUSTOM_ELEMENTS_BODY).toContain('arguments[0]');
      expect(WAIT_FOR_CUSTOM_ELEMENTS_BODY).toContain('Promise.race');
      expect(WAIT_FOR_CUSTOM_ELEMENTS_BODY).toContain('customElements.whenDefined');
      // exits early when no undefined elements remain
      expect(WAIT_FOR_CUSTOM_ELEMENTS_BODY).toContain('if (!undef.length) return resolve()');
    });

    it('resolves immediately when no undefined elements exist', async () => {
      let doc = { querySelectorAll: () => [] };
      let win = { customElements: { whenDefined: () => Promise.resolve() } };
      // eslint-disable-next-line no-new-func
      let make = new Function('document', 'window',
        `return async function(timeoutArg) { ${WAIT_FOR_CUSTOM_ELEMENTS_BODY} };`);
      let fn = make(doc, win);
      await fn(50);
    });

    it('exits when the deadline elapses even if elements remain undefined', async () => {
      let doc = { querySelectorAll: () => [{ localName: 'never-defined' }] };
      let win = { customElements: { whenDefined: () => new Promise(() => {}) } };
      // eslint-disable-next-line no-new-func
      let make = new Function('document', 'window',
        `return async function(timeoutArg) { ${WAIT_FOR_CUSTOM_ELEMENTS_BODY} };`);
      let fn = make(doc, win);

      let start = Date.now();
      await fn(50);
      expect(Date.now() - start).toBeLessThan(2000);
    });

    it('resolves once a previously-undefined element gets defined mid-wait', async () => {
      let undefinedCount = 1;
      let doc = {
        querySelectorAll: () => undefinedCount > 0 ? [{ localName: 'lazy-el' }] : []
      };
      let win = {
        customElements: {
          whenDefined: () => new Promise(r => setTimeout(() => {
            undefinedCount = 0;
            r();
          }, 30))
        }
      };
      // eslint-disable-next-line no-new-func
      let make = new Function('document', 'window',
        `return async function(timeoutArg) { ${WAIT_FOR_CUSTOM_ELEMENTS_BODY} };`);
      let fn = make(doc, win);
      let start = Date.now();
      await fn(1500);
      expect(Date.now() - start).toBeLessThan(1000);
    });
  });
});
