// Basic git queries
export const GIT_REV_PARSE_GIT_DIR = ['git', 'rev-parse', '--git-dir'];
export const GIT_REV_PARSE_SHOW_TOPLEVEL = ['git', 'rev-parse', '--show-toplevel'];
export const GIT_REV_PARSE_HEAD = ['git', 'rev-parse', 'HEAD'];
export const GIT_REV_PARSE_ABBREV_REF_HEAD = ['git', 'rev-parse', '--abbrev-ref', 'HEAD'];
export const GIT_REV_PARSE_IS_SHALLOW = ['git', 'rev-parse', '--is-shallow-repository'];

// Remote operations
export const GIT_REMOTE_V = ['git', 'remote', '-v'];
export const GIT_REMOTE_SET_HEAD = (remote, ...args) => ['git', 'remote', 'set-head', remote, ...args];

// History and commits
export const GIT_REV_LIST_PARENTS_HEAD = ['git', 'rev-list', '--parents', 'HEAD'];

// Branch operations
export const GIT_REV_PARSE_VERIFY = (ref) => ['git', 'rev-parse', '--verify', ref];
export const GIT_SYMBOLIC_REF = (ref) => ['git', 'symbolic-ref', ref];

// Config operations
export const GIT_CONFIG = (...args) => ['git', 'config', ...args];
export const GIT_CONFIG_FILE_GET_REGEXP = (file, pattern) =>
  ['git', 'config', '--file', file, '--get-regexp', pattern];

// Merge base
export const GIT_MERGE_BASE = (ref1, ref2) => ['git', 'merge-base', ref1, ref2];
export const GIT_FETCH = (remote, refspec, ...args) => ['git', 'fetch', remote, refspec, ...args];

// Diff operations
export const GIT_DIFF_NAME_STATUS = (baselineCommit, headCommit = 'HEAD') =>
  ['git', 'diff', '--name-status', `${baselineCommit}..${headCommit}`];
export const GIT_DIFF_SUBMODULE = (baselineCommit, headCommit = 'HEAD') =>
  ['git', 'diff', `${baselineCommit}..${headCommit}`, '--submodule=short'];
export const GIT_DIFF_NAME_ONLY_SUBMODULE = (baselineCommit, headCommit = 'HEAD') =>
  ['git', 'diff', '--name-only', `${baselineCommit}..${headCommit}`];

// Submodule operations
export const GIT_SUBMODULE_DIFF = (submodulePath, baselineCommit, headCommit = 'HEAD') =>
  ['git', '-C', submodulePath, 'diff', '--name-only', `${baselineCommit}..${headCommit}`];

// File operations
export const GIT_SHOW = (ref, filePath) => ['git', 'show', `${ref}:${filePath}`];
export const GIT_CAT_FILE_E = (ref) => ['git', 'cat-file', '-e', ref];

// Error patterns for retry logic
export const CONCURRENT_ERROR_PATTERNS = [
  'index.lock',
  'unable to create',
  'file exists',
  'another git process'
];
