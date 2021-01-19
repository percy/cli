import Command from '@oclif/command';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';

export class Validate extends Command {
  static description = 'Validate a Percy config file';

  static args = [{
    name: 'filepath',
    description: 'config filepath, detected by default'
  }];

  static examples = [
    '$ percy config:validate',
    '$ percy config:validate ./config/percy.yml'
  ];

  log = logger('cli:config:validate');

  async run() {
    let { args: { filepath: path } } = this.parse();
    // when `bail` is true, #load() returns undefined on validation warnings
    let config = PercyConfig.load({ path, bail: true, print: true });
    if (!config) this.exit(1);
  }
}
