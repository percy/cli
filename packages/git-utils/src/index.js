// Public entry point for @percy/git-utils
import * as gitUtils from './git.js';

// Export all individual functions
export * from './git.js';

// Export as a named object for convenient usage
export const PercyGitUtils = gitUtils;

// Default export for CommonJS consumers (bundlers may handle this)
export default gitUtils;
