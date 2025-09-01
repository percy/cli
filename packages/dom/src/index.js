export {
  default,
  serializeDOM,
  // namespace alias
  serializeDOM as serialize,
  waitForResize,
  // new async methods for blob URL handling
  preprocessDynamicResources,
  serializeDOMWithPreprocessing,
  convertBlobToDataUrl
} from './serialize-dom';

export { loadAllSrcsetLinks } from './serialize-image-srcset';
