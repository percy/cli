#!/usr/bin/env node

// DO NOT REMOVE: Update NODE_ENV for executable
// ensure that we're running within a supported node version
if (parseInt(process.version.split('.')[0].substring(1), 10) < 20) {
  console.error(`Node ${process.version} is not supported. @percy/cli requires ` + (
    'Node 20 or later. Upgrade Node, or pin @percy/cli@1.32.x to stay on Node 14+.'));
  process.exit(1);
}

// heads up ahead of the next major release, which raises the minimum to Node 20
console.warn('Heads up! The next major version of @percy/cli will require Node 20+. ' + (
  'Either pin @percy/cli to its current major version, or make sure your setup runs ' +
  'on Node 20+, before the next major release.'));

import('../dist/index.js')
  .then(async ({ percy, checkForUpdate }) => {
    await checkForUpdate();
    await percy(process.argv.slice(2));
  })
  .catch(error => {
    console.error(`Percy CLI exited with an error: ${(error && error.stack) || error}`);
    process.exit(1);
  });
