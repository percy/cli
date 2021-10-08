import { flags } from '@oclif/command';

// Common logging flags exclusive of each other.
const logging = {
  verbose: flags.boolean({
    char: 'v',
    description: 'log everything',
    exclusive: ['quiet', 'silent']
  }),
  quiet: flags.boolean({
    char: 'q',
    description: 'log errors only',
    exclusive: ['verbose', 'silent']
  }),
  silent: flags.boolean({
    description: 'log nothing',
    exclusive: ['verbose', 'quiet']
  })
};

// Common asset discovery flags.
const discovery = {
  'allowed-hostname': flags.string({
    char: 'h',
    description: 'allowed hostnames to capture in asset discovery',
    multiple: true,
    percyrc: 'discovery.allowedHostnames'
  }),
  'network-idle-timeout': flags.integer({
    char: 't',
    description: 'asset discovery network idle timeout',
    percyrc: 'discovery.networkIdleTimeout'
  }),
  'disable-cache': flags.boolean({
    description: 'disable asset discovery caches',
    percyrc: 'discovery.disableCache'
  }),
  'dry-run': flags.boolean({
    char: 'd',
    description: 'print logs only and do not upload snapshots'
  }),
  debug: flags.boolean({
    description: 'debug asset discovery and do not upload snapshots'
  })
};

// Common flag for loading config files.
const config = {
  config: flags.string({
    char: 'c',
    description: 'configuration file path'
  })
};

// Export a single object imported as `flags`
export default {
  ...flags,
  logging,
  discovery,
  config
};
