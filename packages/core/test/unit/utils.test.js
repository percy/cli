import { setupTest } from '../helpers/index.js';
import {
  generatePromise,
  AbortController,
  yieldTo,
  yieldAll,
  DefaultMap,
  redactSecrets,
  base64encode,
  handleGoogleFontMimeType
} from '../../src/utils.js';

describe('Unit / Utils', () => {
  describe('generatePromise', () => {
    it('accepts a generator and returns a promise', async () => {
      let gen = (function*(done) { while (!done) done = yield; })();
      let promise = generatePromise(gen);

      expect(gen.next()).toHaveProperty('done', false);
      await expectAsync(promise).toBePending();

      expect(gen.next(true)).toHaveProperty('done', true);
      await expectAsync(promise).toBeResolved();

      // rejects with errors
      gen = (function*(err) { while (!err) err = yield; yield; throw err; })();
      promise = generatePromise(gen);

      let error = new Error('Testing');
      expect(gen.next(error)).toHaveProperty('done', false);
      await expectAsync(promise).toBeRejectedWith(error);
      expect(gen.next()).toHaveProperty('done', true);
    });

    it('accepts an optional node-style callback', async () => {
      let gen = (function*(done) { while (!done) done = yield; })();
      let callback = jasmine.createSpy('generatePromise');
      let promise = generatePromise(gen, callback);

      expect(gen.next()).toHaveProperty('done', false);
      await expectAsync(promise).toBePending();
      expect(callback).not.toHaveBeenCalled();

      expect(gen.next(true)).toHaveProperty('done', true);
      await expectAsync(promise).toBeResolved();
      expect(callback).toHaveBeenCalledTimes(1);

      // errors provided as first arg
      gen = (function*(err) { while (!err) err = yield; yield; throw err; })();
      callback = jasmine.createSpy('generatePromise').and.throwError('from callback');
      promise = generatePromise(gen, callback);

      expect(gen.next('from generator')).toHaveProperty('done', false);
      await expectAsync(promise).toBeRejectedWithError('from callback');
      expect(callback).toHaveBeenCalledOnceWith('from generator');
      expect(gen.next()).toHaveProperty('done', true);
    });

    it('accepts an optional abort signal', async () => {
      let gen = (function*() { while (true) yield; })();
      let callback = jasmine.createSpy('generatePromise');
      let ctrl = new AbortController();

      let promise = generatePromise(gen, ctrl.signal, callback);
      expect(gen.next()).toHaveProperty('done', false);
      await expectAsync(promise).toBePending();
      expect(callback).not.toHaveBeenCalled();

      let error = new Error('Test');
      callback.withArgs(error).and.throwError(error);
      ctrl.abort(error);

      await expectAsync(promise).toBeRejectedWith(error);
      expect(callback).toHaveBeenCalledOnceWith(error);
    });
  });

  describe('AbortController', () => {
    it('can abort the underlying signal', () => {
      let ctrl = new AbortController();
      let handler = jasmine.createSpy('abort');

      ctrl.signal.on('abort', handler);
      expect(ctrl.signal).not.toHaveProperty('aborted');
      expect(handler).not.toHaveBeenCalled();

      ctrl.abort();

      expect(ctrl.signal).toHaveProperty('aborted', true);
      expect(handler).toHaveBeenCalled();
    });

    it('cannot be aborted more than once', () => {
      let ctrl = new AbortController();
      let handler = jasmine.createSpy('abort');
      ctrl.signal.on('abort', handler);

      ctrl.abort();
      ctrl.abort();
      ctrl.abort();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('yieldTo', () => {
    it('returns a generator that finishes when the promise resolves', async () => {
      let resolve, promise = new Promise(r => (resolve = r));
      let gen = yieldTo(promise);

      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: undefined });
      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: undefined });
      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: undefined });

      resolve('foo');

      await expectAsync(promise).toBeResolved();
      await expectAsync(gen.next()).toBeResolvedTo({ done: true, value: 'foo' });
    });

    it('returns a generator that throws when the promise rejects', async () => {
      let reject, promise = new Promise((_, r) => (reject = r));
      let gen = yieldTo(promise);

      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: undefined });

      reject(new Error('foo'));

      await expectAsync(promise).toBeRejectedWithError('foo');
      await expectAsync(gen.next()).toBeRejectedWithError('foo');
    });

    it('returns a generator that yields to a provided generator', async () => {
      function* test(n) { for (let i = 0; i < n; i++) yield i; return n; }
      let gen = yieldTo(test(3));

      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: 0 });
      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: 1 });
      await expectAsync(gen.next()).toBeResolvedTo({ done: false, value: 2 });
      await expectAsync(gen.next()).toBeResolvedTo({ done: true, value: 3 });
    });

    it('returns a generator that finishes immediately for other values', async () => {
      await expectAsync(yieldTo(42).next()).toBeResolvedTo({ done: true, value: 42 });
    });
  });

  describe('yieldAll', () => {
    it('returns a generator that yields to all provided values concurrently', async () => {
      function* test(n) { for (let i = 0; i < n; i++) yield i; return n; }

      let resolve, promise = new Promise(r => (resolve = r));
      let gen = yieldAll([test(2), 4, null, test(3), promise]);

      await expectAsync(gen.next()).toBeResolvedTo(
        { done: false, value: [0, 4, null, 0, undefined] });
      await expectAsync(gen.next()).toBeResolvedTo(
        { done: false, value: [1, 4, null, 1, undefined] });
      await expectAsync(gen.next()).toBeResolvedTo(
        { done: false, value: [2, 4, null, 2, undefined] });
      await expectAsync(gen.next()).toBeResolvedTo(
        { done: false, value: [2, 4, null, 3, undefined] });
      await expectAsync(gen.next()).toBeResolvedTo(
        { done: false, value: [2, 4, null, 3, undefined] });

      resolve(6);

      await expectAsync(promise).toBeResolved();
      await expectAsync(gen.next()).toBeResolvedTo(
        { done: true, value: [2, 4, null, 3, 6] });
    });
  });

  describe('DefaultMap', () => {
    it('should throw an error if getDefaultValue is not a function', () => {
      expect(() => new DefaultMap('not a function')).toThrow(new Error('getDefaultValue must be a function'));
    });

    it('should return the default value for a key that has not been set', () => {
      const map = new DefaultMap((key) => `default value for ${key}`);
      expect(map.get('testKey')).toEqual('default value for testKey');
    });

    it('should return the correct value for a key that has been set', () => {
      const map = new DefaultMap((key) => `default value for ${key}`);
      map.set('testKey', 'testValue');
      expect(map.get('testKey')).toEqual('testValue');
    });
  });

  describe('redactSecrets', () => {
    beforeEach(async () => {
      await setupTest();
    });
    it('should redact sensitive keys from string', () => {
      expect(redactSecrets('This is a secret: ASIAY34FZKBOKMUTVV7A')).toEqual('This is a secret: [REDACTED]');
    });

    it('should redact sensitive keys from object', () => {
      expect(redactSecrets({ message: 'This is a secret: ASIAY34FZKBOKMUTVV7A' })).toEqual({ message: 'This is a secret: [REDACTED]' });
    });

    it('should redact sensitive keys from array of object', () => {
      expect(redactSecrets([{ message: 'This is a secret: ASIAY34FZKBOKMUTVV7A' }])).toEqual([{ message: 'This is a secret: [REDACTED]' }]);
    });
  });

  describe('base64encode', () => {
    it('should return base64 string', () => {
      expect(base64encode('abcd')).toEqual('YWJjZA==');
    });
  });

  describe('handleGoogleFontMimeType', () => {
    let mockLog, mockMeta;

    beforeEach(() => {
      mockLog = {
        debug: jasmine.createSpy('debug')
      };
      mockMeta = { url: 'http://fonts.gstatic.com/s/roboto/font' };
    });

    it('should detect WOFF2 format from Google Fonts with text/html mime type', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff2');

      const result = handleGoogleFontMimeType(urlObj, 'text/html', woff2Buffer, mockLog, mockMeta);

      expect(result).toBe('font/woff2');
      expect(mockLog.debug).toHaveBeenCalledWith(
        jasmine.stringMatching(/Detected Google Font as font\/woff2/),
        mockMeta
      );
    });

    it('should detect WOFF format from Google Fonts with text/html mime type', () => {
      const woffBuffer = Buffer.from([0x77, 0x4F, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff');

      const result = handleGoogleFontMimeType(urlObj, 'text/html', woffBuffer, mockLog, mockMeta);

      expect(result).toBe('font/woff');
      expect(mockLog.debug).toHaveBeenCalledWith(
        jasmine.stringMatching(/Detected Google Font as font\/woff/),
        mockMeta
      );
    });

    it('should fallback to application/font-woff2 when format cannot be detected', () => {
      const unknownBuffer = Buffer.from([0xFF, 0xFE, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font');

      const result = handleGoogleFontMimeType(urlObj, 'text/html', unknownBuffer, mockLog, mockMeta);

      expect(result).toBe('application/font-woff2');
      expect(mockLog.debug).toHaveBeenCalledWith(
        jasmine.stringMatching(/format unclear/),
        mockMeta
      );
    });

    it('should not override mime type for non-Google Fonts URLs', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://my-cdn.com/fonts/roboto.woff2');

      const result = handleGoogleFontMimeType(urlObj, 'text/html', woff2Buffer, mockLog, mockMeta);

      expect(result).toBe('text/html');
      expect(mockLog.debug).not.toHaveBeenCalled();
    });

    it('should not override mime type for Google Fonts with non-text/html response', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff2');

      const result = handleGoogleFontMimeType(urlObj, 'font/woff2', woff2Buffer, mockLog, mockMeta);

      expect(result).toBe('font/woff2');
      expect(mockLog.debug).not.toHaveBeenCalled();
    });

    it('should handle empty buffer gracefully', () => {
      const emptyBuffer = Buffer.from([]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font');

      const result = handleGoogleFontMimeType(urlObj, 'text/html', emptyBuffer, mockLog, mockMeta);

      expect(result).toBe('application/font-woff2');
      expect(mockLog.debug).toHaveBeenCalledWith(
        jasmine.stringMatching(/format unclear/),
        mockMeta
      );
    });
  });
});
