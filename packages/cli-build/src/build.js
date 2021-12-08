import command from '@percy/cli-command';

import finalize from './finalize';
import wait from './wait';

export const build = command('build', {
  description: 'Finalize and wait on Percy builds',
  commands: [finalize, wait]
});

export default build;
