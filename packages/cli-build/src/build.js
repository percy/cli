import command from '@percy/cli-command';
import finalize from './finalize.js';
import wait from './wait.js';
import id from './id.js';
import approve from './approve.js';
import reject from './reject.js';
import unapprove from './unapprove.js';
import deleteBuild from './delete.js';

export const build = command('build', {
  description: 'Finalize and wait on Percy builds',
  commands: [finalize, wait, id, approve, unapprove, reject, deleteBuild]
});

export default build;
