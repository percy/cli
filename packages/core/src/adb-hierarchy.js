// DEPRECATED — re-exports from `./maestro-hierarchy.js` for one-release compat.
// The Android view-hierarchy resolver is now platform-agnostic; iOS support is
// added in Phase 1 of the 2026-04-27 ios-element-regions plan. Update imports
// to `./maestro-hierarchy.js`. This shim is removed in V1.1.
export {
  dump,
  firstMatch,
  SELECTOR_KEYS_WHITELIST,
  ANDROID_SELECTOR_KEYS_WHITELIST,
  IOS_SELECTOR_KEYS_WHITELIST
} from './maestro-hierarchy.js';
