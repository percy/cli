import Cache from "../../src/util/cache.js";

describe('Cache', () => {
  const store = 'abc';
  const key = 'key';

  beforeEach(async () => {
    Cache.reset();
  });

  describe('withCache', () => {
    it('caches response', async () => {
      const expectedVal = 123;
      const func = jasmine.createSpy('func').and.returnValue(expectedVal);
      let val = await Cache.withCache(store, key, func);
      expect(func.calls.count()).toEqual(1);
      expect(val).toEqual(expectedVal);

      val = await Cache.withCache(store, key, func);
      expect(func.calls.count()).toEqual(1);
      expect(val).toEqual(expectedVal);
    });

    describe('with different key but same store', () => {
      it('calls func again and caches it', async () => {
        const expectedVal = 123;
        const func = jasmine.createSpy('func').and.returnValue(expectedVal);
        const key2 = 'key2';

        let val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(1);
        expect(val).toEqual(expectedVal);

        val = await Cache.withCache(store, key2, func);
        expect(func.calls.count()).toEqual(2);
        expect(val).toEqual(expectedVal);

        // test both cache
        val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(2); // does not increment
        expect(val).toEqual(expectedVal);

        val = await Cache.withCache(store, key2, func);
        expect(func.calls.count()).toEqual(2); // does not increment
        expect(val).toEqual(expectedVal);
      });
    });

    describe('with different store but same key', () => {
      it('calls func again and caches it', async () => {
        const expectedVal = 123;
        const func = jasmine.createSpy('func').and.returnValue(expectedVal);
        const store2 = 'store2';

        let val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(1);
        expect(val).toEqual(expectedVal);

        val = await Cache.withCache(store2, key, func);
        expect(func.calls.count()).toEqual(2);
        expect(val).toEqual(expectedVal);

        // test both cache
        val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(2); // does not increment
        expect(val).toEqual(expectedVal);

        val = await Cache.withCache(store2, key, func);
        expect(func.calls.count()).toEqual(2); // does not increment
        expect(val).toEqual(expectedVal);
      });
    });

    describe('with cacheExceptions', () => {
      it('caches exceptions', async () => {
        const expectedError = new Error('Some error');
        const func = jasmine.createSpy('func').and.throwError(expectedError);

        let actualError = null;
        try {
          await Cache.withCache(store, key, func, true);
        } catch (e) {
          actualError = e;
        }

        expect(func.calls.count()).toEqual(1);
        expect(actualError).toEqual(expectedError);

        try {
          await Cache.withCache(store, key, func, true);
        } catch (e) {
          actualError = e;
        }

        expect(func.calls.count()).toEqual(1);
        expect(actualError).toEqual(expectedError);
      });
    });

    describe('with expired cache', () => {
      const originalCacheTimeout = Cache.timeout;
      beforeAll(() => {
        Cache.timeout = 7; // 7ms
      });

      afterAll(() => {
        Cache.timeout = originalCacheTimeout;
      });

      it('calls func again and caches it', async () => {
        const expectedVal = 123;
        const func = jasmine.createSpy('func').and.returnValue(expectedVal);

        let val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(1);
        expect(val).toEqual(expectedVal);

        // wait for expiry
        await new Promise((resolve) => setTimeout(resolve, 10));

        // create a test entry that should not get deleted
        Cache.cache.random_store = {};
        Cache.cache.random_store.some_new_key = { val: 1, time: Date.now(), success: true };

        // test expired cache
        val = await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(2);
        expect(val).toEqual(expectedVal);

        // Not deleted
        expect(Cache.cache.random_store.some_new_key).toBeTruthy();
      });

      it('it invalidates all expired keys on any call', async () => {
        const expectedVal = 123;
        const func = jasmine.createSpy('func').and.returnValue(expectedVal);
        const key2 = 'key2';
        const store2 = 'store2';

        await Cache.withCache(store, key, func);
        await Cache.withCache(store, key2, func);
        await Cache.withCache(store2, key, func);

        // wait for expiry
        await new Promise((resolve) => setTimeout(resolve, 10));

        // test expired cache
        await Cache.withCache(store, key, func);
        expect(func.calls.count()).toEqual(4);

        // check internal to avoid calling via withCache
        expect(Cache.cache[store2][key]).toBeUndefined();
        expect(Cache.cache[store2][key2]).toBeUndefined();
      });
    });
  });
});
