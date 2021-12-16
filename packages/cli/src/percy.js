import command from '@percy/cli-command';
import { importCommands } from './commands';
import pkg from '../package.json';

export const percy = command('percy', {
  version: `${pkg.name} ${pkg.version}`,
  commands: () => importCommands(),
  exitOnError: true
});

export default percy;
