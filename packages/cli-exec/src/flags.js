import { flags } from '@percy/cli-command';

export default {
  port: flags.integer({
    char: 'p',
    description: 'server port',
    default: process.env.PERCY_CLI_PORT || 5338
  })
};
