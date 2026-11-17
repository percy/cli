import path from 'path';
import { createRequire } from 'module';

// pdfjs-dist is an optionalDependency: the patched releases (GHSA-wgrm-67xf-hhpq)
// require Node >=20 while the CLI supports Node >=14, so the resolve is deferred
// to call time — importing this module never throws on older Node versions (or
// when the optional install was skipped for any other reason). Cached on first
// successful resolve. Same pattern as loadSnyk in cli-command/src/lockfileDiff.js,
// including the non-`require` binding name (see the Babel note there).
const cjsRequire = createRequire(import.meta.url);
let _pdfjsRoot;

/* istanbul ignore next: pdfjs-backed path — pdfjs-dist requires Node >=20 while
   CI runs the coverage suite on Node 14, so exactly one branch is reachable */
function resolvePdfjsRoot() {
  if (_pdfjsRoot) return _pdfjsRoot;
  try {
    _pdfjsRoot = path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));
    return _pdfjsRoot;
  } catch (e) {
    const err = new Error(`pdfjs-dist is not available (requires Node >=20, or the optional install was skipped): ${e.message}`);
    err.code = 'PDFJS_UNAVAILABLE';
    throw err;
  }
}

export function pdfjsAssets() {
  let root = resolvePdfjsRoot();

  return {
    root,
    buildDir: path.join(root, 'legacy/build'),
    standardFontsDir: path.join(root, 'standard_fonts'),
    cmapsDir: path.join(root, 'cmaps'),
    libPath: path.join(root, 'legacy/build/pdf.js'),
    workerFile: 'pdf.worker.js'
  };
}
