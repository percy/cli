import command from '@percy/cli-command';
import exec from './exec.js';

export const app = command('app', {
  description: 'Create Percy builds for native app snapshots',
  hidden: 'This command is still in development and may not work as expected',
  commands: [exec]
});

export default app;
