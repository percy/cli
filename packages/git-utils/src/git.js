import { spawn } from 'cross-spawn';
import path from 'path';
import fs from 'fs';

const fsPromises = fs.promises;

/**
 * Execute a git command with retry logic for concurrent operations
 * @param {string} command - Git command to execute
 * @param {Object} options - Options
 * @param {number} options.retries - Number of retries (default: 3)
 * @param {number} options.retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<string>} - Command output
 */
async function execGit(command, options = {}) {
  const { retries = 3, retryDelay = 100, ...spawnOptions } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await execGitOnce(command, spawnOptions);
    } catch (err) {
      lastError = err;

      // Check if error is due to concurrent git operations
      const errorMsg = err.message.toLowerCase();
      const isConcurrentError =
        errorMsg.includes('index.lock') ||
        errorMsg.includes('unable to create') ||
        errorMsg.includes('file exists') ||
        errorMsg.includes('another git process');

      // Only retry for concurrent operation errors
      if (isConcurrentError && attempt < retries) {
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // For other errors or last attempt, throw
      throw err;
    }
  }

  throw lastError;
}

/**
 * Execute a git command once (no retries)
 * @param {string} command - Git command to execute
 * @param {Object} options - Spawn options
 * @returns {Promise<string>} - Command output
 */
async function execGitOnce(command, options = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, {
      ...options,
      encoding: 'utf8'
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('error', (err) => {
      reject(new Error(`Failed to execute git command: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Git command failed (exit ${code}): ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
export async function isGitRepository() {
  try {
    await execGit('git rev-parse --git-dir');
    return true;
  } catch (err) {
    return false;
  }
}

export async function getRepositoryRoot() {
  try {
    const root = await execGit('git rev-parse --show-toplevel');
    return root;
  } catch (err) {
    throw new Error('Not a git repository');
  }
}

export async function getCurrentCommit() {
  try {
    const commit = await execGit('git rev-parse HEAD');
    return commit;
  } catch (err) {
    throw new Error(`Failed to get current commit: ${err.message}`);
  }
}

/**
 * Get current git branch name
 * @returns {Promise<string>} - Current branch name
 */
export async function getCurrentBranch() {
  try {
    const branch = await execGit('git rev-parse --abbrev-ref HEAD');
    return branch;
  } catch (err) {
    throw new Error(`Failed to get current branch: ${err.message}`);
  }
}

/**
 * Validate git repository state and return diagnostic info
 * @returns {Promise<Object>} - { isValid, isShallow, isDetached, defaultBranch, issues }
 */
export async function getGitState() {
  const state = {
    isValid: false,
    isShallow: false,
    isDetached: false,
    isFirstCommit: false,
    hasRemote: false,
    remoteName: null,
    defaultBranch: null,
    issues: []
  };

  try {
    // Check if it's a git repository
    await execGit('git rev-parse --git-dir');
    state.isValid = true;
  } catch {
    state.issues.push('Not a git repository');
    return state;
  }

  // Check for remote configuration
  try {
    const remotes = await execGit('git remote -v');
    if (remotes && remotes.trim().length > 0) {
      state.hasRemote = true;
      // Extract first remote name (usually 'origin')
      const match = remotes.match(/^(\S+)\s+/);
      if (match) {
        state.remoteName = match[1];
      }
    } else {
      state.hasRemote = false;
      state.issues.push("No git remote configured - run 'git remote add origin <url>'");
    }
  } catch {
    state.hasRemote = false;
    state.issues.push('Failed to check git remote configuration');
  }

  // Check shallow clone
  try {
    const result = await execGit('git rev-parse --is-shallow-repository');
    state.isShallow = result === 'true';
  } catch {
    // Fallback: check for .git/shallow file
    try {
      const repoRoot = await getRepositoryRoot();
      const shallowPath = path.join(repoRoot, '.git', 'shallow');
      await fsPromises.access(shallowPath, fs.constants.F_OK);
      state.isShallow = true;
    } catch {
      state.isShallow = false;
    }
  }

  if (state.isShallow) {
    state.issues.push("Shallow clone detected - use 'git fetch --unshallow' or set fetch-depth: 0 in CI");
  }

  // Check detached HEAD
  try {
    const branch = await getCurrentBranch();
    state.isDetached = branch === 'HEAD';
    if (state.isDetached) {
      state.issues.push('Detached HEAD state - may need to fetch remote branches');
    }
  } catch {
    state.isDetached = false;
  }

  // Check if first commit
  try {
    const parents = await execGit('git rev-list --parents HEAD');
    const lines = parents.split('\n').filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[lines.length - 1];
      const shas = firstLine.trim().split(/\s+/);
      state.isFirstCommit = shas.length === 1;
    }
  } catch {
    state.isFirstCommit = false;
  }

  // Try to detect default branch (only if remote exists)
  if (state.hasRemote) {
    const remoteName = state.remoteName || 'origin';
    const commonBranches = ['main', 'master', 'develop', 'development'];
    for (const branch of commonBranches) {
      try {
        await execGit(`git rev-parse --verify ${remoteName}/${branch}`);
        state.defaultBranch = branch;
        break;
      } catch {
        // Try next branch
      }
    }

    // Try to get from remote HEAD
    if (!state.defaultBranch) {
      try {
        const output = await execGit(`git symbolic-ref refs/remotes/${remoteName}/HEAD`);
        const match = output.match(/refs\/remotes\/[^/]+\/(.+)/);
        if (match) {
          state.defaultBranch = match[1];
        }
      } catch {
        // Use fallback
        state.defaultBranch = 'main';
      }
    }
  } else {
    // No remote configured - try to detect local branches
    const localBranches = ['main', 'master', 'develop', 'development'];
    for (const branch of localBranches) {
      try {
        await execGit(`git rev-parse --verify ${branch}`);
        state.defaultBranch = branch;
        break;
      } catch {
        // Try next branch
      }
    }

    // Final fallback for local-only repos
    if (!state.defaultBranch) {
      state.defaultBranch = 'main';
    }
  }

  return state;
}

/**
 * Get merge-base commit with smart error handling and recovery
 * @param {string} targetBranch - Target branch (if null, auto-detects)
 * @returns {Promise<Object>} - { success, commit, branch, error }
 */
export async function getMergeBase(targetBranch = null) {
  const result = { success: false, commit: null, branch: null, error: null };

  try {
    // Get git state for diagnostics
    const gitState = await getGitState();

    // Early failures
    if (!gitState.isValid) {
      result.error = { code: 'NOT_GIT_REPO', message: 'Not a git repository' };
      return result;
    }

    if (gitState.isShallow) {
      result.error = {
        code: 'SHALLOW_CLONE',
        message: "Repository is a shallow clone. Use 'git fetch --unshallow' or configure CI with fetch-depth: 0"
      };
      return result;
    }

    // Disabled: do not bail on first commit for now. Keep diagnostic info but allow
    // the merge-base flow to continue so SmartSnap doesn't exit early in repos
    // that only contain a single commit (useful for certain CI environments).
    // if (gitState.isFirstCommit) {
    //   result.error = {
    //     code: "FIRST_COMMIT",
    //     message: "This is the first commit in the repository"
    //   };
    //   return result;
    // }

    // Determine target branch
    const branch = targetBranch || gitState.defaultBranch;
    result.branch = branch;

    // If detached HEAD, try to fetch the branch (only if remote exists)
    if (gitState.isDetached && gitState.hasRemote) {
      const remoteName = gitState.remoteName || 'origin';
      try {
        await execGit(`git rev-parse --verify ${remoteName}/${branch}`);
      } catch {
        try {
          await execGit(`git fetch ${remoteName} ${branch}:refs/remotes/${remoteName}/${branch} --depth=100`);
        } catch {
          // Continue anyway, merge-base might still work
        }
      }
    }

    // Try to get merge-base with various fallbacks
    const attempts = [];

    // For repos with remote, try remote refs first
    if (gitState.hasRemote) {
      const remoteName = gitState.remoteName || 'origin';
      attempts.push(`${remoteName}/${branch}`);
    }

    // Always try local branch
    attempts.push(branch);

    // Try default branch as fallback (if different)
    if (branch !== gitState.defaultBranch) {
      if (gitState.hasRemote) {
        const remoteName = gitState.remoteName || 'origin';
        attempts.push(`${remoteName}/${gitState.defaultBranch}`);
      }
      attempts.push(gitState.defaultBranch);
    }

    for (const attempt of attempts) {
      try {
        const commit = await execGit(`git merge-base HEAD ${attempt}`);
        result.success = true;
        result.commit = commit;
        return result;
      } catch (err) {
        // Continue to next attempt
      }
    }

    // All attempts failed - provide helpful error message
    let errorMessage = `Could not find common ancestor with ${branch}.`;

    if (!gitState.hasRemote) {
      errorMessage += ` No git remote configured. Tried local branch '${branch}'.`;
      errorMessage += ' Use --smart-snap-baseline=<branch> to specify a different baseline branch.';
    } else {
      errorMessage += ' This might be an orphan branch.';
      errorMessage += ` Tried: ${attempts.join(', ')}.`;
    }

    result.error = {
      code: 'NO_MERGE_BASE',
      message: errorMessage
    };
  } catch (err) {
    result.error = {
      code: 'UNKNOWN_ERROR',
      message: `Failed to get merge base: ${err.message}`
    };
  }

  return result;
}

/**
 * Get changed files between current commit and baseline
 * Handles renames, copies, and submodule changes
 * @param {string} baselineCommit - Baseline commit SHA or ref
 * @returns {Promise<string[]>} - Array of changed file paths (relative to repo root)
 */
export async function getChangedFiles(baselineCommit = 'origin/main') {
  try {
    // Use --name-status to detect renames
    // Output format: "R100\told/path\tnew/path" for renames
    //                "M\tfile/path" for modifications
    //                "A\tfile/path" for additions
    //                "D\tfile/path" for deletions
    const output = await execGit(`git diff --name-status ${baselineCommit}...HEAD`);

    if (!output) {
      return [];
    }

    const files = new Set();
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('\t');
      const status = parts[0];

      // Handle renames: R<similarity>\told\tnew
      if (status.startsWith('R')) {
        const oldPath = parts[1];
        const newPath = parts[2];

        if (oldPath) files.add(oldPath);
        if (newPath) files.add(newPath);
      } else if (status.startsWith('C')) {
        // Handle copies: C<similarity>\tsource\tdest
        const sourcePath = parts[1];
        const destPath = parts[2];

        if (sourcePath) files.add(sourcePath);
        if (destPath) files.add(destPath);
      } else {
        const filePath = parts[1];
        if (filePath) files.add(filePath);
      }
    }

    // Check for git submodule changes
    try {
      const submoduleOutput = await execGit(`git diff ${baselineCommit}...HEAD --submodule=short`);
      if (submoduleOutput && submoduleOutput.includes('Submodule')) {
        files.add('.gitmodules');

        // Also try to get actual changed files within submodules
        try {
          const submodulePaths = await execGit('git config --file .gitmodules --get-regexp path');
          const submodules = submodulePaths.split('\n')
            .filter(Boolean)
            .map(line => line.split(' ')[1]);

          for (const submodulePath of submodules) {
            try {
              const subOutput = await execGit(
                `git -C ${submodulePath} diff --name-only ${baselineCommit}...HEAD`,
                { retries: 1 }
              );
              if (subOutput) {
                const subFiles = subOutput.split('\n').filter(Boolean);
                for (const file of subFiles) {
                  files.add(`${submodulePath}/${file}`);
                }
              }
            } catch {
              // Submodule might not exist or be initialized
              // .gitmodules addition will trigger bail anyway
            }
          }
        } catch {
          // Failed to enumerate submodules, but .gitmodules added
        }
      }
    } catch {
      // Continue without submodule tracking
    }

    return Array.from(files);
  } catch (err) {
    throw new Error(`Failed to get changed files: ${err.message}`);
  }
}

/**
 * Checkout file from specific commit to output path
 * @param {string} commit - Commit SHA or ref
 * @param {string} filePath - File path relative to repo root
 * @param {string} outputDir - Output directory
 * @returns {Promise<string>} - Path to checked out file
 */
export async function checkoutFile(commit, filePath, outputDir) {
  try {
    await fsPromises.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, path.basename(filePath));
    const contents = await execGit(`git show ${commit}:${filePath}`);
    await fsPromises.writeFile(outputPath, contents, 'utf8');

    return outputPath;
  } catch (err) {
    throw new Error(`Failed to checkout file ${filePath} from ${commit}: ${err.message}`);
  }
}

export async function commitExists(commit) {
  try {
    // Use cat-file -e which fails if the object doesn't exist
    await execGit(`git cat-file -e ${commit}`);
    return true;
  } catch (err) {
    return false;
  }
}
