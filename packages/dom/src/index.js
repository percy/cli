export {
  default,
  serializeDOM,
  // namespace alias
  serializeDOM as serialize,
  waitForResize
} from './serialize-dom';

export { loadAllSrcsetLinks } from './serialize-image-srcset';

// Source of truth lives in @percy/sdk-utils. @percy/dom re-exports it here
// so the browser bundle continues to attach `PercyDOM.waitForReady` as a
// global — SDK callers (cypress, ember, puppeteer, etc.) keep working
// unchanged. Moved here to consolidate readiness ownership in the
// SDK-facing package (PER-7348).
export { waitForReady } from '@percy/sdk-utils/readiness-browser';
