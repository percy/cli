// @percy/cli-pdf
//
// A leaf library: PDF bytes in, page rasters and their root DOM out. It holds
// no reference to @percy/core and knows nothing about builds, queues or
// resources -- core's pdf-snapshot.js owns all of that. Keeping the dependency
// pointing this way is what lets core list this package as an
// optionalDependency without creating a cycle.

export { rasterizePdf, DEFAULT_SCALE, MAX_SCALE, MIN_DIMENSION, MAX_DIMENSION } from './rasterize.js';
export { resolvePages } from './pages.js';
export { buildPageHtml } from './page-html.js';
