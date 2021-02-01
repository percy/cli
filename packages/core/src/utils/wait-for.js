// Polls for the predicate to be truthy within a timeout or the returned promise rejects. If
// the second argument is an options object and `ensure` is provided, the predicate will be
// checked again after the ensure period. This helper is injected as an argument for the
// `percy#capture()` method's `execute` option.
/* istanbul ignore next: no instrumenting injected code */
export default function waitFor(predicate, timeoutOrOptions) {
  let { poll = 10, timeout, idle } =
    Number.isInteger(timeoutOrOptions)
      ? { timeout: timeoutOrOptions }
      : (timeoutOrOptions || {});

  return new Promise((resolve, reject) => {
    return (function check(start, done) {
      try {
        if (Date.now() - start >= timeout) {
          throw new Error(`Timeout of ${timeout}ms exceeded.`);
        } else if (predicate()) {
          if (idle && !done) {
            setTimeout(check, idle, start, true);
          } else {
            resolve();
          }
        } else {
          setTimeout(check, poll, start);
        }
      } catch (error) {
        reject(error);
      }
    })(Date.now());
  });
}
