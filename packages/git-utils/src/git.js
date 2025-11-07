import { spawn } from 'cross-spawn';
import path from 'path';
import fs from 'fs';
import * as GitCommands from './git-commands.js';

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

      // Check if error is due to concurrent git operations (index lock, file conflicts, etc.)
      const errorMsg = err.message.toLowerCase();
      const isConcurrentError = GitCommands.CONCURRENT_ERROR_PATTERNS.some(
        pattern => errorMsg.includes(pattern)
      );

      // Only retry for concurrent operation errors with exponential backoff
      if (isConcurrentError && attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

/**
 * Execute a git command once (no retries)
 * @param {string} command - Git command to execute
 * @param {Object} options - Spawn options
 * @param {string|null} options.encoding - Output encoding ('utf8' or null for Buffer, default: 'utf8')
 * @returns {Promise<string|Buffer>} - Command output (string if utf8, Buffer if null encoding)
 */
async function execGitOnce(command, options = {}) {
  return new Promise((resolve, reject) => {
    let cmd;
    let args;

    if (Array.isArray(command)) {
      [cmd, ...args] = command;
    } else {
      [cmd, ...args] = command.split(' ');
    }

    // Extract encoding option, default to 'utf8' for backward compatibility
    const { encoding = 'utf8', ...spawnOptions } = options;
    const isBinaryMode = encoding === null || encoding === 'buffer';

    const child = spawn(cmd, args, {
      ...spawnOptions,
      encoding: isBinaryMode ? null : encoding
    });

    let stdout = isBinaryMode ? [] : '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        if (isBinaryMode) {
          stdout.push(data);
        } else {
          stdout += data.toString();
        }
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
        if (isBinaryMode) {
          resolve(Buffer.concat(stdout));
        } else {
          resolve(stdout.trim());
        }
      }
    });
  });
}

// Check if the current directory is a git repository
// Executes: git rev-parse --git-dir
export async function isGitRepository() {
  try {
    await execGit(GitCommands.GIT_REV_PARSE_GIT_DIR);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get the root directory of the git repository
 * Executes: git rev-parse --show-toplevel
 */
export async function getRepositoryRoot() {
  try {
    const root = await execGit(GitCommands.GIT_REV_PARSE_SHOW_TOPLEVEL);
    return root;
  } catch (err) {
    throw new Error('Not a git repository');
  }
}

/**
 * Get the current commit SHA
 * Executes: git rev-parse HEAD
 */
export async function getCurrentCommit() {
  try {
    const commit = await execGit(GitCommands.GIT_REV_PARSE_HEAD);
    return commit;
  } catch (err) {
    throw new Error(`Failed to get current commit: ${err.message}`);
  }
}

/**
 * Get current git branch name
 * Executes: git rev-parse --abbrev-ref HEAD
 * @returns {Promise<string>} - Current branch name
 */
export async function getCurrentBranch() {
  try {
    const branch = await execGit(GitCommands.GIT_REV_PARSE_ABBREV_REF_HEAD);
    return branch;
  } catch (err) {
    throw new Error(`Failed to get current branch: ${err.message}`);
  }
}

/**
 * Validate git repository state and return diagnostic info
 * Checks: repository validity, shallow clone, detached HEAD, remote config, default branch
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

  // Verify this is a valid git repository
  // Executes: git rev-parse --git-dir
  try {
    await execGit(GitCommands.GIT_REV_PARSE_GIT_DIR);
    state.isValid = true;
  } catch {
    state.issues.push('Not a git repository');
    return state;
  }

  // Check for remote configuration
  // Executes: git remote -v
  try {
    const remotes = await execGit(GitCommands.GIT_REMOTE_V);
    if (remotes && remotes.trim().length > 0) {
      state.hasRemote = true;
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

  // Check if repository is a shallow clone
  // Executes: git rev-parse --is-shallow-repository
  try {
    const result = await execGit(GitCommands.GIT_REV_PARSE_IS_SHALLOW);
    state.isShallow = result === 'true';
  } catch {
    // Fallback: check for .git/shallow file existence
    try {
      const repoRoot = await getRepositoryRoot();
      const shallowPath = path.join(repoRoot, '.git', 'shallow');
      await fsPromises.access(shallowPath, fs.constants.F_OK);
      state.isShallow = true;
    } catch {
      state.isShallow = false;
    }
  }

  // Warn about shallow clone as it affects history operations
  if (state.isShallow) {
    state.issues.push("Shallow clone detected - use 'git fetch --unshallow' or set fetch-depth: 0 in CI");
  }

  // Check if HEAD is detached (not on a branch)
  try {
    const branch = await getCurrentBranch();
    state.isDetached = branch === 'HEAD';
    if (state.isDetached) {
      state.issues.push('Detached HEAD state - may need to fetch remote branches');
    }
  } catch {
    state.isDetached = false;
  }

  // Check if this is the first commit (no parent commits)
  // Executes: git rev-parse HEAD~1 (simplified approach)
  try {
    await execGit(GitCommands.GIT_REV_PARSE_VERIFY('HEAD~1'));
    state.isFirstCommit = false;
  } catch {
    // If HEAD~1 doesn't exist, this is the first commit
    state.isFirstCommit = true;
  }

  // Determine default branch by checking common branch names
  state.defaultBranch = await findDefaultBranch(state.hasRemote, state.remoteName);

  return state;
}

/**
 * Helper function to find the default branch
 * Uses git symbolic-ref to detect the actual default branch instead of guessing
 * @param {boolean} hasRemote - Whether repository has a remote configured
 * @param {string|null} remoteName - Name of the remote (e.g., 'origin')
 * @returns {Promise<string>} - Default branch name
 */
async function findDefaultBranch(hasRemote, remoteName) {
  if (hasRemote) {
    const remote = remoteName || 'origin';
    // Executes: git symbolic-ref refs/remotes/<remote>/HEAD
    // This returns the branch that the remote considers as default (e.g., refs/remotes/origin/main)
    try {
      const output = await execGit(GitCommands.GIT_SYMBOLIC_REF(`refs/remotes/${remote}/HEAD`));
      const match = output.match(/refs\/remotes\/[^/]+\/(.+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // If symbolic-ref fails, the remote HEAD might not be set
      // This can happen in shallow clones or if remote HEAD was never fetched
    }

    // Fallback: Try to set the remote HEAD by fetching it, then retry
    try {
      // Executes: git remote set-head <remote> --auto
      // This queries the remote and sets the symbolic-ref locally
      await execGit(GitCommands.GIT_REMOTE_SET_HEAD(remote, '--auto'));

      // Retry getting the symbolic ref
      const output = await execGit(GitCommands.GIT_SYMBOLIC_REF(`refs/remotes/${remote}/HEAD`));
      const match = output.match(/refs\/remotes\/[^/]+\/(.+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Remote set-head failed, continue to manual detection
    }

    // Last resort for remote: Check common branch names
    const commonBranches = ['main', 'master', 'develop', 'development'];
    for (const branch of commonBranches) {
      try {
        await execGit(GitCommands.GIT_REV_PARSE_VERIFY(`${remote}/${branch}`));
        return branch;
      } catch {
        // Try next branch
      }
    }
  } else {
    // No remote configured - detect local default branch
    // For local repos, we check which branch was used during git init

    try {
      // Executes: git config init.defaultBranch
      const configBranch = await execGit(GitCommands.GIT_CONFIG('init.defaultBranch'));
      if (configBranch) {
        // Verify this branch actually exists locally
        try {
          await execGit(GitCommands.GIT_REV_PARSE_VERIFY(configBranch));
          return configBranch;
        } catch {
          // Config branch doesn't exist, continue
        }
      }
    } catch {
      // init.defaultBranch not set, continue
    }

    // Fallback: Check common local branch names
    const commonBranches = ['main', 'master', 'develop', 'development'];
    for (const branch of commonBranches) {
      try {
        await execGit(GitCommands.GIT_REV_PARSE_VERIFY(branch));
        return branch;
      } catch {
        // Try next branch
      }
    }
  }
  return 'main';
}

/**
 * Get merge-base commit with smart error handling and recovery
 * Finds the common ancestor between HEAD and a target branch
 * Executes: git merge-base HEAD <branch>
 * @param {string} targetBranch - Target branch (if null, auto-detects)
 * @returns {Promise<Object>} - { success, commit, branch, error }
 */
export async function getMergeBase(targetBranch = null) {
  const result = { success: false, commit: null, branch: null, error: null };

  try {
    const gitState = await getGitState();

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

    const branch = targetBranch || gitState.defaultBranch;
    result.branch = branch;

    // If in detached HEAD state with remote, try to fetch the branch
    if (gitState.isDetached && gitState.hasRemote) {
      const remoteName = gitState.remoteName || 'origin';
      try {
        // Check if remote branch exists
        await execGit(GitCommands.GIT_REV_PARSE_VERIFY(`${remoteName}/${branch}`));
      } catch {
        try {
          // Fetch remote branch with limited depth
          // Executes: git fetch <remote> <branch>:refs/remotes/<remote>/<branch> --depth=100
          await execGit(GitCommands.GIT_FETCH(remoteName, `${branch}:refs/remotes/${remoteName}/${branch}`, '--depth=100'));
        } catch {
          // Fetch failed, continue with available refs
        }
      }
    }

    // Build list of branch references to try for merge-base
    const attempts = [];

    if (gitState.hasRemote) {
      const remoteName = gitState.remoteName || 'origin';
      attempts.push(`${remoteName}/${branch}`);
    }

    attempts.push(branch);

    // Also try default branch if different from target
    if (branch !== gitState.defaultBranch) {
      if (gitState.hasRemote) {
        const remoteName = gitState.remoteName || 'origin';
        attempts.push(`${remoteName}/${gitState.defaultBranch}`);
      }
      attempts.push(gitState.defaultBranch);
    }

    // Try each reference until one succeeds
    // Executes: git merge-base HEAD <ref>
    for (const attempt of attempts) {
      try {
        const commit = await execGit(GitCommands.GIT_MERGE_BASE('HEAD', attempt));
        result.success = true;
        result.commit = commit;
        return result;
      } catch (err) {
        // Continue to next attempt
      }
    }

    // No merge-base found - build helpful error message
    let errorMessage = `Could not find common ancestor with ${branch}.`;

    if (!gitState.hasRemote) {
      errorMessage += ` No git remote configured. Tried local branch '${branch}'.`;
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
 * Executes: git diff --name-status <baseline>..HEAD
 * @param {string} baselineCommit - Baseline commit SHA or ref
 * @returns {Promise<string[]>} - Array of changed file paths (relative to repo root)
 */
export async function getChangedFiles(baselineCommit = 'origin/main') {
  try {
    // Get list of changed files with status indicators
    const output = await execGit(GitCommands.GIT_DIFF_NAME_STATUS(baselineCommit));

    if (!output) {
      return [];
    }

    const files = new Set();
    const lines = output.split('\n').filter(Boolean);

    // Parse each line of git diff output
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
    // Executes: git diff <baseline>..HEAD --submodule=short
    try {
      const submoduleOutput = await execGit(GitCommands.GIT_DIFF_SUBMODULE(baselineCommit));
      if (submoduleOutput && submoduleOutput.includes('Submodule')) {
        files.add('.gitmodules');

        try {
          // Get list of submodule paths from .gitmodules
          // Executes: git config --file .gitmodules --get-regexp path
          const submodulePaths = await execGit(GitCommands.GIT_CONFIG_FILE_GET_REGEXP('.gitmodules', 'path'));
          const submodules = submodulePaths.split('\n')
            .filter(Boolean)
            .map(line => line.split(' ')[1]);

          for (const submodulePath of submodules) {
            try {
              // Validate submodule path to prevent path traversal attacks
              const normalizedSub = path.normalize(submodulePath);
              if (path.isAbsolute(normalizedSub) || normalizedSub.split(path.sep).includes('..')) {
                // Skip suspicious submodule paths
                continue;
              }

              // Get changed files within the submodule
              // Executes: git -C <submodule> diff --name-only <baseline>..HEAD
              const subOutput = await execGit(
                GitCommands.GIT_SUBMODULE_DIFF(normalizedSub, baselineCommit),
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
 * Get file content from a specific commit
 * Supports both text and binary files
 * Executes: git show <commit>:<filePath>
 * @param {string} commit - Commit SHA or ref (HEAD, branch name, etc.)
 * @param {string} filePath - File path relative to repo root
 * @param {Object} options - Options
 * @param {string|null} options.encoding - Output encoding ('utf8' or null for Buffer, default: 'utf8')
 * @returns {Promise<string|Buffer>} - File contents (string if utf8, Buffer if null encoding)
 */
export async function getFileContentFromCommit(commit, filePath, options = {}) {
  try {
    if (!commit || typeof commit !== 'string') {
      throw new Error('Invalid commit parameter');
    }
    // Sanitize file path to prevent path traversal attacks
    const normalized = path.normalize(filePath);
    if (path.isAbsolute(normalized) || normalized.split(path.sep).includes('..')) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    const { encoding = 'utf8' } = options;
    const contents = await execGit(GitCommands.GIT_SHOW(commit, normalized), { encoding });
    return contents;
  } catch (err) {
    throw new Error(`Failed to get file ${filePath} from commit ${commit}: ${err.message}`);
  }
}

/**
 * Check if a commit exists in the repository
 * Executes: git cat-file -e <commit>
 * @param {string} commit - Commit SHA or ref to check
 * @returns {Promise<boolean>} - True if commit exists
 */
export async function commitExists(commit) {
  try {
    if (!commit || typeof commit !== 'string') return false;
    // Validate commit reference format for security
    const safeRef = commit === 'HEAD' || /^[0-9a-fA-F]{4,40}$/.test(commit) || /^(refs\/[A-Za-z0-9._/-]+)$/.test(commit);
    if (!safeRef) return false;

    await execGit(GitCommands.GIT_CAT_FILE_E(commit));
    return true;
  } catch (err) {
    return false;
  }
}
