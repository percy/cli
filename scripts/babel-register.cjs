const path = require('path');

require('@babel/register')({
  // allow monorepos to share a single babel config
  rootMode: 'upward',
  babelrcRoots: ['.'],

  only: [
    // specified without the cwd so tests can share helpers
    new RegExp(
      ['(@percy|packages)', '.+?', '(src|test|.*\\.c?js)']
      // escape windows path separators and escape the escape
        .join(path.sep === '/' ? '/' : '\\\\')
    )
  ]
});
