# @percy/git-utils

Utility helpers for interacting with git (used internally by Percy CLI packages).

This package provides higher-level helpers around common git operations with smart error handling, retry logic, and diagnostic capabilities.

## Installation

```bash
npm install @percy/git-utils
# or
yarn add @percy/git-utils
```

## Usage

You can use the package in two ways:

### Individual Function Imports

```js
import { isGitRepository, getCurrentCommit } from '@percy/git-utils';

const isRepo = await isGitRepository();
const commit = await getCurrentCommit();
```

### PercyGitUtils Object

```js
import { PercyGitUtils } from '@percy/git-utils';

const isRepo = await PercyGitUtils.isGitRepository();
const commit = await PercyGitUtils.getCurrentCommit();
```

## API Reference

### Repository Validation

#### `isGitRepository()`

Check if the current directory is a git repository.

```js
import { isGitRepository } from '@percy/git-utils';

const isRepo = await isGitRepository();
// Returns: true or false
```

#### `getRepositoryRoot()`

Get the root directory of the git repository.

```js
import { getRepositoryRoot } from '@percy/git-utils';

const root = await getRepositoryRoot();
// Returns: '/path/to/repo'
// Throws: Error if not a git repository
```

### Commit & Branch Information

#### `getCurrentCommit()`

Get the SHA of the current HEAD commit.

```js
import { getCurrentCommit } from '@percy/git-utils';

const sha = await getCurrentCommit();
// Returns: 'abc123...' (40-character SHA)
```

#### `getCurrentBranch()`

Get the name of the current branch.

```js
import { getCurrentBranch } from '@percy/git-utils';

const branch = await getCurrentBranch();
// Returns: 'main' or 'HEAD' (if detached)
```

#### `commitExists(commit)`

Check if a commit exists in the repository.

```js
import { commitExists } from '@percy/git-utils';

const exists = await commitExists('abc123');
// Returns: true or false
```

### Repository State & Diagnostics

#### `getGitState()`

Get comprehensive diagnostic information about the repository state.

```js
import { getGitState } from '@percy/git-utils';

const state = await getGitState();
// Returns: {
//   isValid: true,
//   isShallow: false,
//   isDetached: false,
//   isFirstCommit: false,
//   hasRemote: true,
//   remoteName: 'origin',
//   defaultBranch: 'main',
//   issues: []  // Array of diagnostic messages
// }
```

**State Properties:**
- `isValid`: Whether the directory is a valid git repository
- `isShallow`: Whether the repository is a shallow clone
- `isDetached`: Whether HEAD is in detached state
- `isFirstCommit`: Whether the current commit is the first commit
- `hasRemote`: Whether a remote is configured
- `remoteName`: Name of the first remote (usually 'origin')
- `defaultBranch`: Detected default branch name
- `issues`: Array of diagnostic warning messages

### Merge Base & Changed Files

#### `getMergeBase(targetBranch?)`

Get the merge-base commit between HEAD and a target branch with smart fallback logic.

```js
import { getMergeBase } from '@percy/git-utils';

const result = await getMergeBase('main');
// Returns: {
//   success: true,
//   commit: 'abc123...',
//   branch: 'main',
//   error: null
// }

// Or on failure:
// {
//   success: false,
//   commit: null,
//   branch: 'main',
//   error: { code: 'SHALLOW_CLONE', message: '...' }
// }
```

**Error Codes:**
- `NOT_GIT_REPO`: Not a git repository
- `SHALLOW_CLONE`: Repository is shallow
- `NO_MERGE_BASE`: No common ancestor found
- `UNKNOWN_ERROR`: Other error

The function automatically:
- Detects the default branch if `targetBranch` is not provided
- Tries remote refs before local branches
- Handles detached HEAD state
- Provides helpful error messages

#### `getChangedFiles(baselineCommit)`

Get all changed files between a baseline commit and HEAD.

```js
import { getChangedFiles } from '@percy/git-utils';

const files = await getChangedFiles('origin/main');
// Returns: ['src/file.js', 'package.json', ...]
```

**Features:**
- Handles file renames (includes both old and new paths)
- Handles file copies (includes both source and destination)
- Detects submodule changes
- Returns paths relative to repository root

### File Operations

#### `checkoutFile(commit, filePath, outputDir)`

Checkout a file from a specific commit to an output directory.

```js
import { checkoutFile } from '@percy/git-utils';

const outputPath = await checkoutFile(
  'abc123',
  'src/file.js',
  '/tmp/checkout'
);
// Returns: '/tmp/checkout/file.js'
```

## Advanced Features

### Retry Logic

All git commands include automatic retry logic for concurrent operations:
- Detects `index.lock` and similar errors
- Exponential backoff (100ms, 200ms, 400ms)
- Configurable via `retries` and `retryDelay` options

### Error Handling

Functions provide detailed error messages with context:
- Diagnostic information about repository state
- Suggestions for fixing common issues
- Specific error codes for programmatic handling

## Development

This repository uses Lerna and package-local scripts. From repo root run:

```bash
yarn build
yarn test
yarn lint packages/git-utils
```

## License

MIT
