import fs from 'fs';
import path from 'path';
import { ServerError } from './server.js';

/* istanbul ignore next — defensive manual directory walker invoked only when
   fast-glob import fails (broken install / FS corruption). Unit tests
   exercise the primary glob path; integration tests on BS hosts exercise
   the walker against real session layouts. Path-traversal sinks inside this
   function are suppressed at file level in .semgrepignore with the same
   rationale (upstream SAFE_ID validation, depth cap, exact filename match). */
async function manualScreenshotWalk(platform, sessionId, name) {
  const files = [];
  try {
    if (platform === 'ios') {
      const sessionDir = `/tmp/${sessionId}`;
      const walk = async (dir, depth) => {
        if (depth > 15) return; // sanity cap
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          } else if (entry.isFile() && entry.name === `${name}.png` && full.includes('_maestro_debug_')) {
            files.push(full);
          }
        }
      };
      await walk(sessionDir, 0);
    } else {
      const baseDir = `/tmp/${sessionId}_test_suite/logs`;
      const logDirs = await fs.promises.readdir(baseDir);
      for (const dir of logDirs) {
        const screenshotPath = path.join(baseDir, dir, 'screenshots', `${name}.png`);
        try {
          await fs.promises.access(screenshotPath);
          files.push(screenshotPath);
        } catch { /* not found, continue */ }
      }
    }
  } catch { /* base dir not found */ }
  return files;
}

// Locate the screenshot on disk and confirm it lives under `scopeRoot`. Three
// paths converge on `chosenFile`:
//   1. `filePath` supplied (BrowserStack new SDK — absolute path under the BS
//      session root; rejected upstream in self-hosted mode).
//   2. BrowserStack glob (the BS-infra SCREENSHOTS_DIR layout).
//   3. Self-hosted recursive glob under scopeRoot (PERCY_MAESTRO_SCREENSHOT_DIR).
// Either way, the shared realpath + scopeRoot prefix check below enforces the
// security invariant. Returns the canonicalized absolute path, or throws
// ServerError(404) when the file is missing or resolves outside scopeRoot.
// Callers pass `filePath` already shape-validated, plus the resolved `scopeRoot`
// and `selfHosted` flag.
export async function locateScreenshot({ platform, sessionId, name, filePath, scopeRoot, selfHosted }) {
  let chosenFile;
  if (filePath) {
    chosenFile = filePath;
  } else {
    // Glob pattern depends on deployment shape:
    //   BrowserStack Android: /tmp/{sid}_test_suite/logs/*/screenshots/{name}.png
    //   BrowserStack iOS:     /tmp/{sid}/<maestro_debug_dir>/**/{name}.png
    //     (realmobile builds a deeply nested {device}_maestro_debug_ tree; `**`
    //     handles any depth, exact {name}.png filters Maestro's emoji-prefixed
    //     debug frames, e.g. `screenshot-❌-<timestamp>-(flow).png`).
    //   Self-hosted: recursive glob under the customer's --test-output-dir
    //     (scopeRoot = PERCY_MAESTRO_SCREENSHOT_DIR). `name` is SAFE_ID-validated
    //     by the caller, so it cannot contain separators or traversal chars.
    let searchPattern;
    if (selfHosted) {
      // fast-glob requires forward-slashes in patterns on every platform; on
      // Windows scopeRoot contains backslashes, so normalize before embedding.
      // Production-code Windows portability — verified by the CI Windows runner.
      const globRoot = scopeRoot.replace(/\\/g, '/');
      searchPattern = `${globRoot}/**/${name}.png`;
    } else {
      searchPattern = platform === 'ios'
        ? `/tmp/${sessionId}/*_maestro_debug_*/**/${name}.png`
        : `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`;
    }

    let files;
    try {
      let { default: glob } = await import('fast-glob');
      // Self-hosted needs `dot: true` because Maestro's default output dir is
      // `.maestro/` — a dot-prefixed entry fast-glob hides by default. BS
      // layouts have no dot-prefixed segments, so omitting it there keeps the
      // byte-identical behavior.
      files = await glob(searchPattern, selfHosted ? { dot: true } : undefined);
    } catch {
      // Fast-glob import / glob call failed — fall back to manual walker (BS
      // only; self-hosted has no fixed-layout convention, so empty → 404 with
      // the actionable PERCY_MAESTRO_SCREENSHOT_DIR guidance from the caller).
      // See manualScreenshotWalk() at file top + the file-level .semgrepignore.
      /* istanbul ignore next — only fires when fast-glob import throws
         (broken install / FS corruption); integration-test territory. */
      files = selfHosted ? [] : await manualScreenshotWalk(platform, sessionId, name);
    }

    if (!files || files.length === 0) {
      throw new ServerError(404, `Screenshot not found: ${name}.png (searched ${searchPattern})`);
    }

    // If multiple files match (iOS — same name reused across flows), pick the most recently modified
    // for determinism. The else branch only fires when a snapshot name
    // is reused across two flows in the same session; the realmobile
    // layout normally writes one file per snapshot per session, so the
    // multi-match path is exercised by integration tests on BS hosts
    // rather than the unit suite.
    /* istanbul ignore else */
    if (files.length === 1) {
      chosenFile = files[0];
    } else {
      let mtimes = await Promise.all(files.map(async f => {
        try { return { f, mtime: (await fs.promises.stat(f)).mtimeMs }; } catch { return { f, mtime: 0 }; }
      }));
      mtimes.sort((a, b) => b.mtime - a.mtime);
      chosenFile = mtimes[0].f;
    }
  }

  // Canonicalize and confirm the resolved path still lives under scopeRoot.
  // Defeats symlink swaps where the root points elsewhere. Both ends are
  // realpath'd because /tmp is a symlink on macOS (where iOS hosts run). The
  // trailing `/` on the prefix is load-bearing — it prevents sibling-prefix
  // bypass (e.g. /x/.maestro vs /x/.maestro-secrets). Both sides are
  // normalized to forward-slashes so the check works on Windows (real-fs
  // returns backslashes), POSIX (no-op), and memfs (POSIX-style virtual paths).
  let realPath, realPrefix;
  try {
    realPath = await fs.promises.realpath(chosenFile);
    realPrefix = await fs.promises.realpath(scopeRoot);
  } catch {
    throw new ServerError(404, `Screenshot not found: ${name}.png (path resolution failed)`);
  }
  const realPathFwd = realPath.replace(/\\/g, '/');
  const realPrefixFwd = realPrefix.replace(/\\/g, '/');
  if (!realPathFwd.startsWith(`${realPrefixFwd}/`)) {
    throw new ServerError(404, `Screenshot not found: ${name}.png (resolved outside ${selfHosted ? 'PERCY_MAESTRO_SCREENSHOT_DIR' : 'session dir'})`);
  }

  return realPath;
}
