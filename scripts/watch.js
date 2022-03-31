/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs';
import url from 'url';
import path from 'path';
import gaze from 'gaze';
import colors from 'colors/safe.js';

// executes the callback when files within the current working directory have been modified
export function watch(callback) {
  let ignorefile = path.resolve(url.fileURLToPath(import.meta.url), '../../.gitignore');

  // ignore file patterns are not globs, we need to convert them
  let ignorePatterns = fs.readFileSync(ignorefile, 'utf-8')
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

export default watch;
