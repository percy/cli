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
  let buildDir = path.join(root, 'legacy/build');

  return {
    root,
    buildDir,
    standardFontsDir: path.join(root, 'standard_fonts'),
    cmapsDir: path.join(root, 'cmaps'),
    // v4 ships ESM only, so the library and worker are imported as modules over
    // the asset server rather than read off disk and eval'd (see loadLibrary).
    libFile: 'pdf.mjs',
    libPath: path.join(buildDir, 'pdf.mjs'),
    workerFile: 'pdf.worker.mjs'
  };
}
