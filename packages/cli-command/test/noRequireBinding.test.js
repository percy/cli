import fs from 'fs';
import path from 'path';

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

const FORBIDDEN = /\b(?:const|let|var)\s+require\s*=\s*createRequire\b/;

describe('source: no `require = createRequire` binding', () => {
  const root = findRepoRoot();
  const files = collectSourceFiles(root);

  it('scans a non-trivial number of source files', () => {
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
