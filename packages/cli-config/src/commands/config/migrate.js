import fs from 'fs';
import path from 'path';
import Command, { flags } from '@oclif/command';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';

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

    try {
      ({ config, filepath: input } = PercyConfig.search(input));
    } catch (error) {
      this.log.error(error);
      this.exit(1);
    }

    if (config) {
      this.log.info(`Found config file: ${path.relative('', input)}`);
      output = output ? path.resolve(output) : input;
    } else {
      this.log.error('Config file not found');
      this.exit(1);
    }

    // if migrating versions, warn when latest
    if (input === output && config.version === 2) {
      this.log.warn('Config is already the latest version');
      return;
    }

    // migrate config
    this.log.info('Migrating config file...');
    let format = path.extname(output).replace(/^./, '') || 'yaml';
    let migrated = PercyConfig.migrate(config);

    // prefer kebab-case for yaml
    if (/^ya?ml$/.test(format)) {
      migrated = PercyConfig.normalize(migrated, { kebab: true });
    }

    // stringify to the desired format
    let body = PercyConfig.stringify(format, migrated);

    if (!dry) {
      let content = body;

      // update the package.json entry by requiring it and modifying it
      if (path.basename(output) === 'package.json') {
        let pkg = JSON.parse(fs.readFileSync(output));
        content = PercyConfig.stringify(format, { ...pkg, percy: migrated });
      // rename input if it is the output
      } else if (input === output) {
        let old = input.replace(path.extname(input), '.old$&');
        fs.renameSync(input, old);
      }

      // write to output
      fs.writeFileSync(output, content);
    }

    this.log.info('Config file migrated!');
    // when dry-running, print config to stdout when finished
    if (dry) logger.instance.stdout.write('\n' + body);
  }
}
