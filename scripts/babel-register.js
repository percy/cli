const path = require('path');

require('@babel/register')({
  // allow monorepos to share a single babel config
  rootMode: 'upward',
  babelrcRoots: ['.'],

  // specified without the cwd so tests can share helpers
  only: [
    new RegExp(
      ['packages', '.*?', '(src|test)']
      // escape windows path seperators and escape the escape
        .join(path.sep === '/' ? '/' : '\\\\')
    )
  ]
});
