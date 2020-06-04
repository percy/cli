import Command from '@oclif/command';
import PercyConfig from '@percy/config';
import log from '@percy/logger';

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

  async run() {
    let { args: { filepath: path } } = this.parse();
    log.loglevel('debug');

    // when `bail` is true, #load() returns undefined on validation warnings
    if (!PercyConfig.load({ path, bail: true })) {
      this.exit(1);
    }
  }
}
