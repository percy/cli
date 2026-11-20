#!/usr/bin/env node

// DO NOT REMOVE: Update NODE_ENV for executable
// ensure that we're running within a supported node version
if (parseInt(process.version.split('.')[0].substring(1), 10) < 14) {
  console.error(`Node ${process.version} is not supported. Percy only ` + (
    'supports current LTS versions of Node. Please upgrade to Node 14+'));
  process.exit(1);
}

// heads up ahead of the next major release, which raises the minimum to Node 24
console.warn('Heads up! The next major version of @percy/cli will require Node 24+. ' + (
  'To stay on your current Node version, pin @percy/cli to the current major ' +
  '(e.g. "@percy/cli": "^1"), or move your setup to Node 24+ before the next major release.'));

import('../dist/index.js')
  .then(async ({ percy, checkForUpdate }) => {
    await checkForUpdate();
    await percy(process.argv.slice(2));
  });
