import { Page } from '../../src/page.js';

describe('Unit / core / Page', () => {
  describe('_logShadowDebug', () => {
    it('forwards messages to log.debug with the page meta', () => {
      // Build a Page without going through the constructor — we only need
      // .log and .meta wired up to exercise the class-field arrow.
      let page = Object.create(Page.prototype);
      let calls = [];
      page.log = { debug: (msg, meta) => calls.push([msg, meta]) };
      page.meta = { snapshot: { name: 'parity' } };

      page._logShadowDebug('found 3 closed shadow root(s)');

      expect(calls).toEqual([['found 3 closed shadow root(s)', page.meta]]);
    });
  });
});
