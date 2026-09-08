// Main-thread half of the test module-customization harness.
//
// Node >=18.19/20 runs module hooks on a dedicated worker thread, so the hooks
// cannot see main-thread state — not `global.__MOCK_IMPORTS__`, and not the
// memfs volume mockfs() installs at `fs.$vol`. Prior to that they ran in-thread
// and loader.js simply read both directly.
//
// This module owns that state in the main thread and mirrors the parts the
// hooks need onto the real filesystem, which is the one channel both threads
// share. Mock *values* never cross: the shim load() generates reads them back
// out of `global.__MOCK_IMPORTS__`, and that generated code executes here, in
// the main thread, where the jasmine spies live.
//
// Loaded via `--import`, so it runs before jasmine and before any test.
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Captured now, before any test calls mockfs() — which spies every method on
// `fs` and routes it through memfs. The manifest and the materialised modules
// must land on the REAL filesystem or the hooks worker cannot read them.
const realMkdirSync = fs.mkdirSync;
const realWriteFileSync = fs.writeFileSync;
const realRenameSync = fs.renameSync;
const realRmSync = fs.rmSync;
const realRealpathSync = fs.realpathSync;

const MOCK_REG = /^mock:\/\/|\?.+$/g;
const CJS_REG = /(^|\n)(module\.)?(exports)/;

// Canonicalized: on macOS os.tmpdir() is `/var/…`, a symlink to `/private/var/…`.
// Node hands the resolved (real) path back when it reads a module, so an
// uncanonicalized DIR makes the mockfs $bypass prefix-match miss and the read
// falls through to memfs as ENOENT.
realMkdirSync(path.join(os.tmpdir(), `percy-test-${process.pid}`), { recursive: true });
export const DIR = realRealpathSync(path.join(os.tmpdir(), `percy-test-${process.pid}`));
export const MANIFEST_PATH = path.join(DIR, 'manifest.json');

// mocks: { <specifier>: [exportName, …] }  — names only; values stay in-thread
// files: { <virtualAbsPath>: { real, format } }
const state = { uid: 0, mocks: {}, files: {} };
let counter = 0;

function flush() {
  // rename() so the hooks worker, which reads this synchronously, can never
  // observe a partially written object
  let tmp = `${MANIFEST_PATH}.tmp`;
  realWriteFileSync(tmp, JSON.stringify(state));
  realRenameSync(tmp, MANIFEST_PATH);
}

// Writes a real on-disk copy of a virtual module and records where it went.
// A fresh filename per call doubles as cache-busting: Node's ESM cache cannot
// be invalidated, so re-mocking the same path must resolve to a new URL or the
// stale module is reused and the new mock is silently ignored.
function materialize(absPath, content = '') {
  let source = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  let real = path.join(DIR, `m${counter++}-${path.basename(absPath)}`);

  realWriteFileSync(real, source);
  state.files[absPath] = { real, format: CJS_REG.test(source) ? 'commonjs' : 'module' };
  state.uid = ++MOCK_IMPORTS.__uid__;
  flush();
}

export const MOCK_IMPORTS = global.__MOCK_IMPORTS__ = global.__MOCK_IMPORTS__ ||
  new Proxy(Object.assign(new Map(), { __uid__: 0 }), {
    get(target, prop) {
      // internals used by @percy/config's mockfs(); not part of the Map surface
      if (prop === '__materialize__') return materialize;
      if (prop === '__dir__') return DIR;

      if (typeof target[prop] !== 'function') return target[prop];

      let bump = () => { state.uid = ++target.__uid__; };

      switch (prop) {
        case 'set': return (key, value) => {
          let k = String(key).replace(MOCK_REG, '');
          state.mocks[k] = Object.keys(value);
          bump(); flush();
          return target.set(k, value);
        };
        // intercepted because core/test/snapshot.test.js deletes a mock mid-spec;
        // without this the manifest would keep resolving the deleted specifier
        case 'delete': return key => {
          let k = String(key).replace(MOCK_REG, '');
          delete state.mocks[k];
          bump(); flush();
          return target.delete(k);
        };
        case 'clear': return () => {
          state.mocks = {};
          state.files = {};
          bump(); flush();
          return target.clear();
        };
        case 'get':
        case 'has': return key => target[prop](String(key).replace(MOCK_REG, ''));
        default: return target[prop].bind(target);
      }
    }
  });

flush();

process.on('exit', () => {
  try { realRmSync(DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// import.meta.url is already a URL — do NOT wrap it in pathToFileURL(), which
// treats it as a filesystem path and yields `<cwd>/file:/…`
register('./loader.js', import.meta.url, {
  data: { manifestPath: MANIFEST_PATH }
});
