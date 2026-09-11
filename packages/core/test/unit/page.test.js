import { remoteError } from '../../src/page.js';

describe('remoteError', () => {
  // Page#eval used to `throw exceptionDetails.exception.description` -- a bare
  // string. Every caller's `error.message` was therefore undefined, which is
  // how an in-page failure came out as "Could not rasterize PDF: undefined".
  it('returns a real Error', () => {
    let error = remoteError({
      exception: { description: 'TypeError: x is not a function\n    at <anonymous>:1:1' }
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('TypeError: x is not a function');
  });

  it('keeps the remote stack verbatim', () => {
    // The description IS the page's stack trace, so nothing is lost by
    // wrapping it: callers that logged the old string can log error.stack.
    let description = 'Error: boom\n    at foo (<anonymous>:2:9)\n    at bar (<anonymous>:5:3)';

    expect(remoteError({ exception: { description } }).stack).toBe(description);
  });

  it('falls back to the thrown value when there is no description', () => {
    // Throwing a non-Error in the page gives CDP a value but no stack.
    expect(remoteError({ exception: { value: 'just a string' } }).message)
      .toBe('just a string');
    expect(remoteError({ exception: { value: { code: 42 } } }).message)
      .toBe('{"code":42}');
    expect(remoteError({ exception: { value: 0 } }).message).toBe('0');
    expect(remoteError({ exception: { value: false } }).message).toBe('false');
  });

  it("falls back to CDP's own summary when there is no value either", () => {
    expect(remoteError({ text: 'Uncaught (in promise)' }).message)
      .toBe('Uncaught (in promise)');
  });

  it('never produces an undefined message', () => {
    for (let details of [undefined, {}, { exception: {} }, { exception: { value: null } }]) {
      let error = remoteError(details);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Unknown page error');
    }
  });
});
