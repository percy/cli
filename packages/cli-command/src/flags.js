import { flags } from '@oclif/command';
import { schema } from './config';

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

// Common asset discovery flags mapped to config options.
const discovery = {
  'allowed-hostname': flags.string({
    char: 'h',
    description: 'allowed hostnames',
    multiple: true,
    percyrc: 'discovery.allowedHostnames'
  }),
  'network-idle-timeout': flags.integer({
    char: 't',
    description: 'asset discovery idle timeout',
    default: schema.discovery.properties.networkIdleTimeout.default,
    percyrc: 'discovery.networkIdleTimeout'
  }),
  'disable-asset-cache': flags.boolean({
    description: 'disable asset discovery caches',
    percyrc: 'discovery.disableAssetCache'
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
