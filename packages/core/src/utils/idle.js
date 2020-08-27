// Returns a promise that resolves when the `count` function returns `0`. If `count` returns
// non-zero, it will check again after `interval`. The `count` function must eventually return `0`
// or the promise will never resolve. If a timeout is provided, the check will be run again before
// resolving to ensure `count` still returns `0` after the timeout.
export default function idle(count, timeout = 0, interval = 10) {
  return new Promise(resolve => (function check(last) {
    if (count() === 0) {
      if (!timeout || last) resolve();
      else setTimeout(check, timeout, true);
    } else {
      setTimeout(check, interval);
    }
  })());
}
