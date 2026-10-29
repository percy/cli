import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const cjsRequire = createRequire(import.meta.url);
// the published package carries pdf.js in dist/pdfjs (see scripts/vendor-pdfjs.js)
const VENDORED_DIR = fileURLToPath(new URL('./pdfjs', import.meta.url));

export function pdfjsAssets({ vendoredDir = VENDORED_DIR } = {}) {
  // a source checkout has no vendored copy and uses the pdfjs-dist dev dependency
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  let root = fs.existsSync(path.join(vendoredDir, 'package.json'))
    ? vendoredDir
    : path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));

  // pdf.js 4+ is published only as ES modules. The page imports `libFile` from
  // the loopback asset server that serves `buildDir` (see loadLibrary), and
  // pdf.js then spawns `workerFile` as a module worker from the same directory.
  return {
    root,
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    buildDir: path.join(root, 'legacy/build'),
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    standardFontsDir: path.join(root, 'standard_fonts'),
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    cmapsDir: path.join(root, 'cmaps'),
    libFile: 'pdf.mjs',
    workerFile: 'pdf.worker.mjs'
  };
}
