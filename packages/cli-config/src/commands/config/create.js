import fs from 'fs';
import path from 'path';
import Command, { flags } from '@oclif/command';
import log from '@percy/logger';
import PercyConfig from '../../';

const FILETYPES = ['rc', 'yaml', 'yml', 'json', 'js'];

export class Create extends Command {
  static description = 'Create a Percy config file';

  static flags = {
    rc: flags.boolean({
      description: 'create a .percyrc file',
      exclusive: FILETYPES.filter(t => t !== 'rc')
    }),
    yaml: flags.boolean({
      description: 'create a .percy.yaml file',
      exclusive: FILETYPES.filter(t => t !== 'yaml')
    }),
    yml: flags.boolean({
      description: 'create a .percy.yml file',
      exclusive: FILETYPES.filter(t => t !== 'yml')
    }),
    json: flags.boolean({
      description: 'create a .percy.json file',
      exclusive: FILETYPES.filter(t => t !== 'json')
    }),
    js: flags.boolean({
      description: 'create a .percy.js file',
      exclusive: FILETYPES.filter(t => t !== 'js')
    })
  };

  static args = [{
    name: 'filepath',
    description: 'config filepath'
  }];

  static examples = [
    '$ percy config:create',
    '$ percy config:create --yaml',
    '$ percy config:create --json',
    '$ percy config:create --js',
    '$ percy config:create --rc',
    '$ percy config:create ./config/percy.yml'
  ];

  async run() {
    let { flags, args } = this.parse();
    log.loglevel('info');

    // discern the filetype
    let filetype = args.filepath
      ? path.extname(args.filepath).replace(/^./, '')
      : FILETYPES.find(t => flags[t]) ?? 'yml';

    // validate the filetype for filepaths
    if (!FILETYPES.includes(filetype)) {
      log.error(`Unsupported filetype: ${filetype}`);
      return this.exit(1);
    }

    // discern the appropriate filename
    let filepath = args.filepath || ({
      rc: '.percyrc',
      yaml: '.percy.yaml',
      yml: '.percy.yml',
      json: '.percy.json',
      js: '.percy.js'
    })[filetype];

    // validate the file does not already exist
    if (fs.existsSync(filepath)) {
      log.error(`Percy config already exists: ${filepath}`);
      return this.exit(1);
    }

    // discern the file format
    let format = ['rc', 'yaml', 'yml'].includes(filetype) ? 'yaml' : filetype;

    // write stringified default config options to the filepath
    fs.writeFileSync(filepath, PercyConfig.stringify(format));
    log.info(`Created Percy config: ${filepath}`);
  }
}
