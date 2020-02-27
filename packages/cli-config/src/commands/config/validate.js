import Command from '@oclif/command';
import log from '@percy/logger';
import PercyConfig from '../../';

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
    let { args: { filepath } } = this.parse();
    log.loglevel('debug');

    // when `bail` is true, #load() will return undefined if there are
    // validation errors
    if (!PercyConfig.load(filepath, null, true)) {
      this.exit(1);
    }
  }
}
