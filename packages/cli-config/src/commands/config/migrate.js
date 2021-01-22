import fs from 'fs';
import path from 'path';
import { isDirectorySync } from 'path-type';
import Command, { flags } from '@oclif/command';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';

function assignOrCreate(obj, key, value) {
  return Object.assign(obj || {}, { [key]: value });
}

export class Migrate extends Command {
  static description = 'Migrate a Percy config file to the latest version';

  static args = [{
    name: 'filepath',
    description: 'current config filepath, detected by default'
  }, {
    name: 'output',
    description: 'new config filepath to write to, defaults to FILEPATH'
  }];

  static flags = {
    'dry-run': flags.boolean({
      char: 'd',
      description: 'prints the new config rather than writing it'
    })
  };

  static examples = [
    '$ percy config:migrate',
    '$ percy config:migrate --dry-run',
    '$ percy config:migrate ./config/percy.yml',
    '$ percy config:migrate .percy.yml .percy.js'
  ];

  log = logger('cli:config:migrate');

  async run() {
    let config;

    let {
      args: { filepath: input, output },
      flags: { 'dry-run': dry }
    } = this.parse();

    logger.loglevel('info');

    // load config using the explorer directly rather than the load method to
    // better control logs and prevent validation
    try {
      let result = !input || isDirectorySync(input)
        ? PercyConfig.explorer.search(input)
        : PercyConfig.explorer.load(input);

      if (result && result.config) {
        ({ config, filepath: input } = result);
        this.log.info(`Found config file: ${path.relative('', input)}`);
        output = output ? path.resolve(output) : input;
      } else {
        this.log.error('Config file not found');
      }
    } catch (error) {
      this.log.error('Failed to load or parse config file');
      this.log.error(error);
    }

    // no config, bail
    if (!config) return this.exit(1);

    // if migrating versions, warn when latest
    if (input === output && config.version === 2) {
      this.log.warn('Config is already the latest version');
      return;
    }

    // migrate config
    this.log.info('Migrating config file...');
    let format = path.extname(output).replace(/^./, '') || 'yaml';
    config = PercyConfig.stringify(format, this.migrate(config));

    // update the package.json entry via string replacement
    if (!dry && path.basename(output) === 'package.json') {
      fs.writeFileSync(output, fs.readFileSync(output).replace(
        /(\s+)("percy":\s*){.*\1}/s,
        `$1$2${config.replace(/\n/g, '$$1')}`
      ));
    // write to output
    } else if (!dry) {
      // rename input if it is the output
      if (input === output) {
        let ext = path.extname(input);
        let old = input.replace(ext, `.old${ext}`);
        fs.renameSync(input, old);
      }

      fs.writeFileSync(output, config);
    }

    this.log.info('Config file migrated!');
    // when dry-running, print config to stdout when finished
    if (dry) logger.instance.stdout.write('\n' + config);
  }

  // Migrating config options is recursive so no matter which input version is
  // provided, the output will be the latest version.
  migrate(input) {
    switch (input.version) {
      case 2: return input; // latest version
      default: return this.migrate(this.v1(input));
    }
  }

  // Migrate config from v1 to v2.
  /* eslint-disable curly */
  v1(input) {
    let output = { version: 2 };

    // previous snapshot options map 1:1
    if (input.snapshot != null)
      output.snapshot = input.snapshot;
    // request-headers option moved
    if (input.agent?.['asset-discovery']?.['request-headers'] != null)
      output.snapshot = assignOrCreate(output.snapshot, 'request-headers', (
        input.agent['asset-discovery']['request-headers']));
    // only create discovery options when neccessary
    if (input.agent?.['asset-discovery']?.['allowed-hostnames'] != null)
      output.discovery = assignOrCreate(output.discovery, 'allowed-hostnames', (
        input.agent['asset-discovery']['allowed-hostnames']));
    if (input.agent?.['asset-discovery']?.['network-idle-timeout'] != null)
      output.discovery = assignOrCreate(output.discovery, 'network-idle-timeout', (
        input.agent['asset-discovery']['network-idle-timeout']));
    // page pooling was rewritten to be a concurrent task queue
    if (input.agent?.['asset-discovery']?.['page-pool-size-max'] != null)
      output.discovery = assignOrCreate(output.discovery, 'concurrency', (
        input.agent['asset-discovery']['page-pool-size-max']));
    // cache-responses was renamed to match the CLI flag
    if (input.agent?.['asset-discovery']?.['cache-responses'] != null)
      output.discovery = assignOrCreate(output.discovery, 'disable-cache', (
        !input.agent['asset-discovery']['cache-responses']));
    // image-snapshots was renamed
    if (input['image-snapshots'] != null)
      output.upload = input['image-snapshots'];
    // image-snapshots path was removed
    if (output.upload?.path != null)
      delete output.upload.path;
    // static-snapshots and options were renamed
    if (input['static-snapshots']?.['base-url'] != null)
      output.static = assignOrCreate(output.static, 'base-url', (
        input['static-snapshots']['base-url']));
    if (input['static-snapshots']?.['snapshot-files'] != null)
      output.static = assignOrCreate(output.static, 'files', (
        input['static-snapshots']['snapshot-files']));
    if (input['static-snapshots']?.['ignore-files'] != null)
      output.static = assignOrCreate(output.static, 'ignore', (
        input['static-snapshots']['ignore-files']));

    return output;
  }
}
