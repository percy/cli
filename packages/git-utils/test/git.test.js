import {
  isGitRepository,
  getRepositoryRoot,
  getCurrentCommit,
  getCurrentBranch,
  getGitState,
  getMergeBase,
  getChangedFiles,
  getFileContentFromCommit,
  commitExists
} from '../src/git.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('@percy/git-utils', () => {
  describe('isGitRepository', () => {
    it('should return true when in a git repository', async () => {
      const result = await isGitRepository();
      expect(result).toBe(true);
    });

    it('should return false when not in a git repository', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(tmpDir);
        const result = await isGitRepository();
        expect(result).toBe(false);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('getRepositoryRoot', () => {
    it('should return the repository root path', async () => {
      const root = await getRepositoryRoot();
      expect(typeof root).toBe('string');
      expect(root.length).toBeGreaterThan(0);
      expect(root).toContain('cli');
    });

    it('should throw error when not in a git repository', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(tmpDir);
        await expectAsync(getRepositoryRoot()).toBeRejectedWithError(/Not a git repository/);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('getCurrentCommit', () => {
    it('should return current commit SHA', async () => {
      const commit = await getCurrentCommit();
      expect(typeof commit).toBe('string');
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
    });

    it('should return valid commit that exists', async () => {
      const commit = await getCurrentCommit();
      const exists = await commitExists(commit);
      expect(exists).toBe(true);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      const branch = await getCurrentBranch();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });

    it('should return a valid branch name', async () => {
      const branch = await getCurrentBranch();
      // Branch should not be empty and should be valid git ref format
      expect(branch).not.toBe('');
      expect(branch).toMatch(/^[a-zA-Z0-9/_-]+$/);
    });
  });

  describe('commitExists', () => {
    it('should return true for existing commit (HEAD)', async () => {
      const currentCommit = await getCurrentCommit();
      const exists = await commitExists(currentCommit);
      expect(exists).toBe(true);
    });

    it('should return true for HEAD reference', async () => {
      const exists = await commitExists('HEAD');
      expect(exists).toBe(true);
    });

    it('should return false for non-existing commit', async () => {
      // Use a SHA with an unusual pattern that won't match any object
      const exists = await commitExists('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
      expect(exists).toBe(false);
    });

    it('should return false for invalid commit format', async () => {
      const exists = await commitExists('invalid-commit-sha');
      expect(exists).toBe(false);
    });
  });

  describe('getGitState', () => {
    it('should return comprehensive git state object', async () => {
      const state = await getGitState();

      // Verify structure
      expect(state).toEqual(jasmine.objectContaining({
        isValid: jasmine.any(Boolean),
        isShallow: jasmine.any(Boolean),
        isDetached: jasmine.any(Boolean),
        isFirstCommit: jasmine.any(Boolean),
        hasRemote: jasmine.any(Boolean),
        defaultBranch: jasmine.any(String),
        issues: jasmine.any(Array)
      }));
    });

    it('should detect valid git repository', async () => {
      const state = await getGitState();
      expect(state.isValid).toBe(true);
    });

    it('should have a default branch set', async () => {
      const state = await getGitState();
      expect(state.defaultBranch).toBeTruthy();
      expect(['main', 'master', 'develop', 'development']).toContain(state.defaultBranch);
    });

    it('should detect remote configuration correctly', async () => {
      const state = await getGitState();
      expect(state.hasRemote).toBe(true);
      if (state.hasRemote) {
        expect(state.remoteName).toBeTruthy();
        expect(typeof state.remoteName).toBe('string');
      }
    });

    it('should not be shallow repository in normal clone', async () => {
      const state = await getGitState();
      // In a normal development environment, this should not be shallow
      // CI environments might be shallow, so we just verify the type
      expect(typeof state.isShallow).toBe('boolean');
    });

    it('should detect non-git repository', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(tmpDir);
        const state = await getGitState();
        expect(state.isValid).toBe(false);
        expect(state.issues).toContain('Not a git repository');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should include issues array with helpful messages', async () => {
      const state = await getGitState();
      expect(Array.isArray(state.issues)).toBe(true);
      // In a valid repo with remote, issues should be empty or informational
      if (!state.isValid || !state.hasRemote || state.isShallow || state.isDetached) {
        expect(state.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getMergeBase', () => {
    it('should return result object with correct structure', async () => {
      const result = await getMergeBase();

      expect(result).toEqual(jasmine.objectContaining({
        success: jasmine.any(Boolean),
        commit: jasmine.any(String),
        branch: jasmine.any(String),
        error: null
      }));
    });

    it('should successfully get merge-base with default branch', async () => {
      const result = await getMergeBase();

      expect(result.success).toBe(true);
      expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(result.error).toBe(null);
    });

    it('should return valid commit SHA that exists', async () => {
      const result = await getMergeBase();

      if (result.success) {
        const exists = await commitExists(result.commit);
        expect(exists).toBe(true);
      }
    });

    it('should accept specific target branch', async () => {
      const currentBranch = await getCurrentBranch();
      const result = await getMergeBase(currentBranch);

      // Should succeed or provide error
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(result.branch).toBe(currentBranch);
    });

    it('should handle non-existent branch gracefully with fallback', async () => {
      const result = await getMergeBase('this-branch-definitely-does-not-exist-xyz-12345-nonexistent');

      expect(typeof result.success).toBe('boolean');
      expect(result.branch).toBe('this-branch-definitely-does-not-exist-xyz-12345-nonexistent');

      if (!result.success) {
        expect(result.error).toBeTruthy();
        expect(result.error.code).toBe('NO_MERGE_BASE');
        expect(result.error.message).toContain('Could not find common ancestor');
      } else {
        expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
      }
    });

    it('should provide helpful error messages', async () => {
      const result = await getMergeBase('nonexistent-branch');

      if (!result.success) {
        expect(result.error).toBeTruthy();
        expect(result.error.code).toBeTruthy();
        expect(result.error.message).toBeTruthy();
        expect(typeof result.error.message).toBe('string');
      }
    });
  });

  describe('getChangedFiles', () => {
    it('should return an array', async () => {
      const files = await getChangedFiles('HEAD');
      expect(Array.isArray(files)).toBe(true);
    });

    it('should return empty array when comparing HEAD to itself', async () => {
      const files = await getChangedFiles('HEAD');
      expect(files).toEqual([]);
    });

    it('should detect changes between commits', async () => {
      try {
        const files = await getChangedFiles('HEAD~1');
        expect(Array.isArray(files)).toBe(true);
        expect(files.length).toBeGreaterThanOrEqual(0);
      } catch (err) {
        expect(err.message).toContain('Failed to get changed files');
      }
    });

    it('should return file paths as strings', async () => {
      try {
        const files = await getChangedFiles('HEAD~10');
        files.forEach(file => {
          expect(typeof file).toBe('string');
          expect(file.length).toBeGreaterThan(0);
        });
      } catch (err) {
        expect(err.message).toContain('Failed to get changed files');
      }
    });

    it('should handle baseline commit reference', async () => {
      const state = await getGitState();
      const remote = state.remoteName || 'origin';
      const branch = state.defaultBranch || 'main';

      try {
        const files = await getChangedFiles(`${remote}/${branch}`);
        expect(Array.isArray(files)).toBe(true);
      } catch (err) {
        expect(err.message).toBeTruthy();
      }
    });
  });

  describe('getFileContentFromCommit', () => {
    it('should get text file content from current commit', async () => {
      const currentCommit = await getCurrentCommit();
      const content = await getFileContentFromCommit(currentCommit, 'README.md');

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should get file content from HEAD reference', async () => {
      const content = await getFileContentFromCommit('HEAD', 'README.md');

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should get file content with relative path', async () => {
      const currentCommit = await getCurrentCommit();
      const content = await getFileContentFromCommit(currentCommit, 'packages/git-utils/package.json');

      expect(typeof content).toBe('string');
      expect(content).toContain('"name"');
    });

    it('should get binary file content without corruption', async () => {
      const currentCommit = await getCurrentCommit();

      // Get binary content with encoding: null
      const binaryContent = await getFileContentFromCommit(
        currentCommit,
        'packages/git-utils/test-binary.bin',
        { encoding: null }
      );

      expect(Buffer.isBuffer(binaryContent)).toBe(true);

      // Verify PNG header bytes
      expect(binaryContent[0]).toBe(0x89);
      expect(binaryContent[1]).toBe(0x50);
      expect(binaryContent[2]).toBe(0x4e);
      expect(binaryContent[3]).toBe(0x47);

      // Compare with actual file
      const repoRoot = await getRepositoryRoot();
      const actualContent = fs.readFileSync(path.join(repoRoot, 'packages/git-utils/test-binary.bin'));
      expect(Buffer.compare(binaryContent, actualContent)).toBe(0);
    });

    it('should throw error for non-existent file', async () => {
      const currentCommit = await getCurrentCommit();

      await expectAsync(
        getFileContentFromCommit(currentCommit, 'this-file-does-not-exist.txt')
      ).toBeRejectedWithError(/Failed to get file/);
    });

    it('should throw error for invalid commit', async () => {
      await expectAsync(
        getFileContentFromCommit('invalid-commit-sha-12345', 'README.md')
      ).toBeRejectedWithError(/Failed to get file/);
    });

    it('should reject absolute paths', async () => {
      const currentCommit = await getCurrentCommit();

      await expectAsync(
        getFileContentFromCommit(currentCommit, '/etc/passwd')
      ).toBeRejectedWithError(/Invalid file path/);
    });

    it('should reject path traversal attempts', async () => {
      const currentCommit = await getCurrentCommit();

      await expectAsync(
        getFileContentFromCommit(currentCommit, '../../../etc/passwd')
      ).toBeRejectedWithError(/Invalid file path/);

      await expectAsync(
        getFileContentFromCommit(currentCommit, 'foo/../../secrets.txt')
      ).toBeRejectedWithError(/Invalid file path/);
    });

    it('should throw error for invalid commit parameter', async () => {
      await expectAsync(
        getFileContentFromCommit('', 'README.md')
      ).toBeRejectedWithError(/Invalid commit parameter/);

      await expectAsync(
        getFileContentFromCommit(null, 'README.md')
      ).toBeRejectedWithError(/Invalid commit parameter/);
    });

    it('should return string by default for text files', async () => {
      const currentCommit = await getCurrentCommit();

      // Default behavior without encoding option
      const content = await getFileContentFromCommit(currentCommit, 'package.json');

      expect(typeof content).toBe('string');
      expect(content).toContain('"private"');
      expect(content).toContain('"workspaces"');
    });

    it('should return Buffer when encoding is null', async () => {
      const currentCommit = await getCurrentCommit();

      const content = await getFileContentFromCommit(
        currentCommit,
        'package.json',
        { encoding: null }
      );

      expect(Buffer.isBuffer(content)).toBe(true);

      // Can convert back to string
      const str = content.toString('utf8');
      expect(str).toContain('"private"');
      expect(str).toContain('"workspaces"');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle concurrent operations with retry', async () => {
      // Run multiple operations concurrently
      const promises = [
        isGitRepository(),
        getCurrentCommit(),
        getCurrentBranch(),
        getGitState()
      ];

      const results = await Promise.all(promises);

      expect(results[0]).toBe(true);
      expect(typeof results[1]).toBe('string');
      expect(typeof results[2]).toBe('string');
      expect(results[3].isValid).toBe(true);
    });

    it('should handle operations in non-git directory gracefully', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(tmpDir);

        const isRepo = await isGitRepository();
        expect(isRepo).toBe(false);

        await expectAsync(getRepositoryRoot()).toBeRejected();
        await expectAsync(getCurrentCommit()).toBeRejected();
        await expectAsync(getCurrentBranch()).toBeRejected();

        const state = await getGitState();
        expect(state.isValid).toBe(false);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should handle multiple sequential operations', async () => {
      const isRepo = await isGitRepository();
      const root = await getRepositoryRoot();
      const commit = await getCurrentCommit();
      const branch = await getCurrentBranch();
      const state = await getGitState();

      expect(isRepo).toBe(true);
      expect(root).toBeTruthy();
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
      expect(branch).toBeTruthy();
      expect(state.isValid).toBe(true);
    });
  });

  describe('security checks', () => {
    it('commitExists should reject clearly invalid refs', async () => {
      const invalid = 'some$weird;ref`rm -rf /`';
      const exists = await commitExists(invalid);
      expect(exists).toBe(false);
    });
  });

  describe('Integration scenarios', () => {
    it('should provide complete workflow: check repo, get state, find merge-base', async () => {
      const isRepo = await isGitRepository();
      expect(isRepo).toBe(true);

      const state = await getGitState();
      expect(state.isValid).toBe(true);

      const mergeBase = await getMergeBase(state.defaultBranch);
      expect(mergeBase.success).toBe(true);
      expect(mergeBase.commit).toBeTruthy();
    });

    it('should support typical CI workflow', async () => {
      const state = await getGitState();

      if (state.isValid && !state.isShallow && state.hasRemote) {
        const mergeBase = await getMergeBase();
        expect(mergeBase.success).toBe(true);

        if (mergeBase.success) {
          const changedFiles = await getChangedFiles(mergeBase.commit);
          expect(Array.isArray(changedFiles)).toBe(true);
        }
      }
    });
  });
});
