import serialize from './serialize-dom';

/* istanbul ignore next */
// works around instances where the context has an incorrect scope
if (typeof window !== 'undefined') {
  window.PercyDOM = { serialize };
}

export { serialize };
export default serialize;
