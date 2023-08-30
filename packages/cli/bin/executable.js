// This file is used as a entry point for executable with NODE_ENV=executable
process.env.NODE_ENV = 'executable';
// ensure that we're running within a supported node version
if (parseInt(process.version.split('.')[0].substring(1), 10) < 14) {
  console.error(`Node ${process.version} is not supported. Percy only ` + (
    'supports current LTS versions of Node. Please upgrade to Node 14+'));
  process.exit(1);
}

import('../dist/index.js')
  .then(async ({ percy, checkForUpdate }) => {
    await checkForUpdate();
    await percy(process.argv.slice(2));
  });
