/* istanbul ignore next: no instrumenting injected code */
export default function waitFor(predicate, { poll = 10, timeout, ensure }) {
  return new Promise((resolve, reject) => {
    return (function check(start, done) {
      if (Date.now() - start >= timeout) {
        reject(new Error(`Timeout of ${timeout}ms exceeded.`));
      } else if (predicate()) {
        if (ensure && !done) {
          setTimeout(check, ensure, start, true);
        } else {
          resolve();
        }
      } else {
        setTimeout(check, poll, start);
      }
    })(Date.now());
  });
}
