import percy from './percy-info.js';

// Merges .percy.yml config snapshot options with per-snapshot options.
// Per-snapshot options take priority over config options.
export function mergeSnapshotOptions(options) {
  const configOptions = percy?.config?.snapshot || {};
  return { ...configOptions, ...options };
}

export default mergeSnapshotOptions;
