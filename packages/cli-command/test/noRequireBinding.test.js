import fs from 'fs';
import path from 'path';

// Regression guard for the packaged-binary crash fixed in
// fix/cli-command-createRequire-binary-crash.
//
// In an ESM source file, declaring the createRequire result with the binding
// name `require`:
//
//   const require = createRequire(import.meta.url);
//
// is fine under Node ESM, but breaks the `pkg`-built executable. When the file
// is transpiled to CommonJS for the binary, two Babel transforms collide:
//   - preset-env renames the local `require` binding to `_require`, and
//   - transform-import-meta expands `import.meta.url` into a `require('url')`
//     call that is *also* renamed to `_require`.
// The result is `_require(...)` evaluated inside its own initializer →
// `TypeError: _require is not a function`, thrown on startup before any command
// runs. The fix is simply to bind to a non-`require` name (e.g. `cjsRequire`).
//
// This is a static source scan — no build step, no new tooling, just fs + a
// regex over every package's published source. It runs inside the existing
// Jasmine node suite.

// Walk up from the package cwd to the monorepo root (the dir holding lerna.json
// and packages/), so the scan covers the whole repo regardless of which package
// the suite happens to run from.
function findRepoRoot() {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, 'lerna.json')) &&
        fs.existsSync(path.join(dir, 'packages'))) return dir;
    let parent = path.dirname(dir);
    if (parent === dir) throw new Error('could not locate monorepo root');
    dir = parent;
  }
}

// Collect every source file under packages/<pkg>/src. Build output (dist/build),
// dependencies, tests and coverage are excluded — only authored source matters.
function collectSourceFiles(root) {
  const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'test', '.nyc_output']);
  const SRC_EXT = new Set(['.js', '.cjs', '.mjs']);
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SRC_EXT.has(path.extname(entry.name))) {
        files.push(path.join(dir, entry.name));
      }
    }
  };

  const packagesDir = path.join(root, 'packages');
  for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = path.join(packagesDir, pkg.name, 'src');
    if (fs.existsSync(src)) walk(src);
  }

  return files;
}

// Matches a const/let/var binding literally named `require` assigned from
// createRequire(...). `\s` spans newlines, so a wrapped declaration is caught.
const FORBIDDEN = /\b(?:const|let|var)\s+require\s*=\s*createRequire\b/;

describe('source: no `require = createRequire` binding', () => {
  const root = findRepoRoot();
  const files = collectSourceFiles(root);

  it('scans a non-trivial number of source files', () => {
    // Guards against the walk silently finding nothing (wrong cwd, refactor).
    expect(files.length).toBeGreaterThan(20);
  });

  it('never binds createRequire to a name `require` (breaks the packaged binary)', () => {
    const violations = [];

    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          violations.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations)
      .withContext(
        'Bind createRequire to a non-`require` name (e.g. `const cjsRequire = ' +
        'createRequire(import.meta.url)`). Naming it `require` collides with Babel ' +
        'transforms and crashes the pkg binary with "_require is not a function":\n' +
        violations.join('\n'))
      .toEqual([]);
  });
});
