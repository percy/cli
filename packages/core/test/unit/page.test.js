import { setupTest, logger } from '../helpers/index.js';
import {
  loadPreflightScript,
  handlePreflightInjectionError,
  DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT,
  WAIT_FOR_CUSTOM_ELEMENTS_BODY
} from '../../src/page.js';
import fs from 'fs';

describe('Unit / Page module', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('loadPreflightScript', () => {
    it('returns the contents of preflight.js when it sits next to page.js', () => {
      // Module-load already exercised the success path; calling again is
      // independent and should still return a non-empty string.
      let result = loadPreflightScript();
      expect(typeof result).toBe('string');
      expect(result).toContain('__percyPreflightActive');
    });

    it('logs at warn level and returns "" when the file is unavailable', () => {
      logger.loglevel('warn');
      spyOn(fs, 'readFileSync').and.throwError(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );
      let result = loadPreflightScript();
      expect(result).toBe('');
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/\[fidelity\] Preflight script unavailable/)
      ]));
    });
  });

  describe('handlePreflightInjectionError', () => {
    beforeEach(() => logger.loglevel('debug'));

    it('swallows "closed"-style errors silently', () => {
      handlePreflightInjectionError(new Error('Target was closed.'));
      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Preflight script injection failed/)
      ]));
    });

    it('swallows "destroyed"-style errors silently', () => {
      handlePreflightInjectionError(new Error('Frame destroyed before commit.'));
      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Preflight script injection failed/)
      ]));
    });

    it('logs unexpected errors at debug', () => {
      handlePreflightInjectionError(new Error('Permission denied'));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Preflight script injection failed: Permission denied/)
      ]));
    });

    it('handles non-Error values without throwing', () => {
      expect(() => handlePreflightInjectionError('plain string')).not.toThrow();
      expect(() => handlePreflightInjectionError(undefined)).not.toThrow();
      expect(() => handlePreflightInjectionError(null)).not.toThrow();
    });
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
      // Deadline is 1500ms; the late-define resolves well before.
      expect(Date.now() - start).toBeLessThan(1000);
    });
  });
});
