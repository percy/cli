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

    // load config using the explorer directly rather than the load method to
    // better control logs and prevent validation
    try {
      let result = !input || fs.statSync(input).isDirectory()
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
    let migrated = PercyConfig.migrate(config);
    let body = PercyConfig.stringify(format, migrated);

    // update the package.json entry via string replacement
    if (!dry && path.basename(output) === 'package.json') {
      fs.writeFileSync(output, fs.readFileSync(output).replace(
        /(\s+)("percy":\s*){.*\1}/s,
        `$1$2${body.replace(/\n/g, '$$1')}`
      ));
    // write to output
    } else if (!dry) {
      // rename input if it is the output
      if (input === output) {
        let ext = path.extname(input);
        let old = input.replace(ext, `.old${ext}`);
        fs.renameSync(input, old);
      }

      fs.writeFileSync(output, body);
    }

    this.log.info('Config file migrated!');
    // when dry-running, print config to stdout when finished
    if (dry) logger.instance.stdout.write('\n' + body);
  }
}
