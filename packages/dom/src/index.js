import serialize from './serialize-dom';

/* istanbul ignore next */
// works around instances where the context has an incorrect global scope
// https://github.com/mozilla/geckodriver/issues/1798
if (globalThis !== window) {
  window.PercyDOM = { serialize };
}

export { serialize };
export default serialize;
