import { flags } from '@percy/cli-command';

export default {
  port: flags.integer({
    char: 'p',
    description: 'server port',
    default: 5338
  })
};
