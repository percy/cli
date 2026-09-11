import { withTimeout } from '../../src/pdf-rasterize.js';

describe('withTimeout', () => {
  // Page#eval resolves off Runtime.callFunctionOn with awaitPromise:true, which
  // has no timeout of its own -- Page.TIMEOUT only covers navigation. Without
  // this helper a PDF that wedges pdf.js hangs the HTTP request forever while
  // holding a browser page and a listening asset server.
  it('rejects when the promise outlives the budget', async () => {
    await expectAsync(withTimeout(new Promise(() => {}), 1, 'stalling'))
      .toBeRejectedWithError('Timed out after 1ms stalling');
  });

  it('names what timed out', async () => {
    await expectAsync(withTimeout(new Promise(() => {}), 1, 'rendering page 7'))
      .toBeRejectedWithError(/rendering page 7/);
  });

  it('passes a resolved value straight through', async () => {
    await expectAsync(withTimeout(Promise.resolve('ok'), 50000, 'x'))
      .toBeResolvedTo('ok');
  });

  it('passes an early rejection through rather than waiting out the budget', async () => {
    await expectAsync(withTimeout(Promise.reject(new Error('boom')), 50000, 'x'))
      .toBeRejectedWithError('boom');
  });

  it('clears the timer once the promise settles', async () => {
    // A live timer would keep the event loop busy and, before unref, could hold
    // the process open past the run.
    let clear = spyOn(global, 'clearTimeout').and.callThrough();

    await withTimeout(Promise.resolve('ok'), 50000, 'x');

    expect(clear).toHaveBeenCalled();
  });

  it('does not surface a late rejection as unhandled', async () => {
    // Promise.race attaches handlers to every input, so the loser's rejection
    // is already handled -- this pins that, since an extra .catch() here would
    // be dead code.
    let unhandled = [];
    let onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      let late = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('late')), 10);
      });

      await expectAsync(withTimeout(late, 1, 'x')).toBeRejectedWithError(/Timed out/);
      await new Promise(resolve => setTimeout(resolve, 40));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
