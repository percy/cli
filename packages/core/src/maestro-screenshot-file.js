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

// Locate the screenshot on disk and confirm it lives under the sessionId-owned
// dir. Two paths converge on `chosenFile`:
//   1. `filePath` supplied (new SDK ≥ v0.4 — the SDK chose an absolute
//      path under the BS session root and saved Maestro's PNG there).
//   2. Legacy glob (older SDKs — file lives at the BS-infra-chosen
//      SCREENSHOTS_DIR layout). Either way, the shared realpath +
//      session-root prefix check below enforces the security invariant.
// Returns the canonicalized absolute path, or throws ServerError(404) when the
// file is missing or resolves outside the session dir. Callers pass `filePath`
// already validated for shape (string, absolute, length) — existence and
// session-root scoping are enforced here.
export async function locateScreenshot({ platform, sessionId, name, filePath }) {
  let chosenFile;
  if (filePath) {
    chosenFile = filePath;
  } else {
    // Legacy glob. Pattern depends on platform:
    //   Android (BrowserStack mobile): /tmp/{sid}_test_suite/logs/*/screenshots/{name}.png
    //   iOS (BrowserStack realmobile): /tmp/{sid}/<maestro_debug_dir>/**/{name}.png
    //     realmobile builds SCREENSHOTS_DIR with literal slashes from the flow-path
    //     concatenation, causing Maestro to mkdir a deeply nested structure under the
    //     {device}_maestro_debug_ root. The `**` recursive match handles any depth.
    //     Exact {name}.png match at the leaf filters out Maestro's emoji-prefixed
    //     debug frames (e.g., `screenshot-❌-<timestamp>-(flow).png`).
    let searchPattern = platform === 'ios'
      ? `/tmp/${sessionId}/*_maestro_debug_*/**/${name}.png`
      : `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`;

    let files;
    try {
      let { default: glob } = await import('fast-glob');
      files = await glob(searchPattern);
    } catch {
      // Fast-glob import / glob call failed — fall back to manual walker.
      // See manualScreenshotWalk() at file top for the rationale + the
      // file-level .semgrepignore covering path-traversal sinks inside.
      /* istanbul ignore next — only fires when fast-glob import throws
         (broken install / FS corruption); integration-test territory. */
      files = await manualScreenshotWalk(platform, sessionId, name);
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

  // Canonicalize and confirm the resolved path still lives under the sessionId-owned dir.
  // Defeats symlink swaps where a sessionId-named dir points elsewhere.
  // We resolve both the file and the expected prefix because /tmp is a symlink on macOS
  // (iOS hosts run macOS, where /tmp → /private/tmp).
  let expectedSessionRoot = platform === 'ios'
    ? `/tmp/${sessionId}`
    : `/tmp/${sessionId}_test_suite`;
  let realPath, realPrefix;
  try {
    realPath = await fs.promises.realpath(chosenFile);
    realPrefix = await fs.promises.realpath(expectedSessionRoot);
  } catch {
    throw new ServerError(404, `Screenshot not found: ${name}.png (path resolution failed)`);
  }
  if (!realPath.startsWith(`${realPrefix}/`)) {
    throw new ServerError(404, `Screenshot not found: ${name}.png (resolved outside session dir)`);
  }

  return realPath;
}
