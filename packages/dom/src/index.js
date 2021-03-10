import serialize from './serialize-dom';

/* istanbul ignore next */
// works around instances where the context has an incorrect global scope
// https://github.com/mozilla/geckodriver/issues/1798
try {
  if (globalThis !== window) {
    window.PercyDOM = { serialize };
  }
} catch (error) {
  // `globalThis` is probably not defined
}

export { serialize };
export default serialize;
