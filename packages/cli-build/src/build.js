import command from '@percy/cli-command';
import finalize from './finalize.js';
import wait from './wait.js';
import id from './id.js';
import approve from './approve.js';

export const build = command('build', {
  description: 'Finalize and wait on Percy builds',
  commands: [finalize, wait, id, approve]
});

export default build;
