import fs from 'fs';

try {
  if (!['false', '0', undefined].includes(process.env.PERCY_POSTINSTALL_BROWSER)) {
    // Automatically download and install Chromium if PERCY_POSTINSTALL_BROWSER is set
    await import('./dist/install.js').then(install => install.chromium());
  } else if (!process.send && fs.existsSync('./src')) {
    // In development, fork this script with the development loader and always install
    await import('child_process').then(cp => cp.fork('./post-install.js', {
      // --import (not --loader): the hooks are registered in-process via
      // module.registerHooks. See scripts/loader-register.js.
      execArgv: ['--no-warnings', '--import=../../scripts/loader-register.js'],
      env: { PERCY_POSTINSTALL_BROWSER: true }
    }));
  }
} catch (error) {
  const { logger } = await import('@percy/logger');
  const log = logger('core:post-install');

  log.error('Encountered an error while installing Chromium');
  log.error(error);
}
