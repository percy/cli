import percy from './percy-info.js';

// Merges .percy.yml config snapshot options with per-snapshot options.
// Per-snapshot options take priority over config options.
//
// This is a deliberate shallow merge, for two reasons:
//   1. Parity — the non-JS SDKs (python/ruby/java/.net) all shallow-merge
//      config with per-call options, and this package's own getReadinessConfig
//      (serialize-dom.js) does the same. JS must behave identically.
//   2. The CLI performs the authoritative deep config merge server-side, so the
//      SDK only needs top-level precedence: a per-snapshot key fully overrides
//      its config counterpart before the DOM is serialized.
export function mergeSnapshotOptions(options = {}) {
  const configOptions = percy?.config?.snapshot || {};
  return { ...configOptions, ...options };
}

export default mergeSnapshotOptions;
