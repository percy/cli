import {
  generatePromise,
  AbortController
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
});
