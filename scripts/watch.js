const path = require('path');
const { readFileSync } = require('fs');
const colors = require('colors');
const gaze = require('gaze');

// executes the callback when files within the current working directory have been modified
module.exports = function watch(callback) {
  // ignore file patterns are not globs, we need to convert them
  let ignorefile = path.join(__dirname, '../.gitignore');
  let ignorePatterns = readFileSync(ignorefile, 'utf8')
    .split('\n').filter(p => !!p && p[0] !== '#') // remove empties and comments
    .map(p => p[0] === '!' ? ['', p.substr(1)] : ['!', p]) // invert negations
    .filter(p => p[1].indexOf('/.') === -1 && p[1].indexOf('.') !== 0) // remove dotfiles
    .map(p => p[0] + (p[1][0] !== '/' ? `**/${p[1]}` : p[1].substr(1))) // add relative path
    .reduce((r, p) => r.concat(p, `${p}/**`), []); // concat file and dir globs

  // gaze on all files except ignored files and re-run the callback
  gaze(['**/*'].concat(ignorePatterns)).on('all', (e, f) => {
    console.log(colors.magenta(colors.bold('\nFiles modified!\n')));
    callback();
  });
};
