// Returns a promise that resolves when the `count` function returns `0`. If
// `count` returns non-zero, will check again after `timeout`. The `count`
// function must eventually return `0` or the promise will never resolve.
export default function idle(count, timeout = 10) {
  return new Promise(resolve => (function check() {
    if (count() === 0) resolve();
    else setTimeout(check, timeout);
  })());
}
