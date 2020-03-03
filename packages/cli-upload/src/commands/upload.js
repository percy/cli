import fs from 'fs';
import path from 'path';
import Command, { flags } from '@percy/cli-command';
import log from '@percy/logger';
import globby from 'globby';
import imageSize from 'image-size';
import PercyClient from '@percy/client';
import createImageResources from '../resources';
import { schema } from '../config';

const ALLOWED_IMAGE_TYPES = /\.(png|jpg|jpeg)$/i;

export class Upload extends Command {
  static description = 'Upload a directory of images to Percy';

  static args = [{
    name: 'dirname',
    description: 'directory of images to upload',
    required: true
  }];

  static flags = {
    ...flags.logging,
    ...flags.config,

    files: flags.glob({
      char: 'f',
      multiple: true,
      description: 'one or more globs matching image file paths to upload',
      default: schema.upload.properties.files.default,
      percyrc: 'upload.files'
    }),
    ignore: flags.glob({
      char: 'i',
      multiple: true,
      description: 'one or more globs matching image file paths to ignore',
      percyrc: 'upload.ignore'
    }),
    'dry-run': flags.boolean({
      char: 'd',
      description: 'prints a list of matching images to upload without uploading'
    })
  };

  static examples = [
    '$ percy upload ./images'
  ];

  async run() {
    if (!this.isPercyEnabled()) {
      log.info('Percy is disabled. Skipping upload');
      return;
    }

    let { dirname } = this.args;

    if (!fs.existsSync(dirname)) {
      return this.error(`Not found: ${dirname}`);
    } else if (!fs.lstatSync(dirname).isDirectory()) {
      return this.error(`Not a directory: ${dirname}`);
    }

    let { upload: { files, ignore } } = this.percyrc();
    ignore = [].concat(ignore).filter(Boolean);

    let paths = await globby(files, { cwd: dirname, ignore });
    paths.sort();

    if (!paths.length) {
      return this.error(`No matching files found in '${dirname}'`);
    } else if (this.flags['dry-run']) {
      log.info('Matching files:');
      return paths.forEach(p => console.log(p));
    }

    // we already have assets so we don't need asset discovery from @percy/core,
    // we can use @percy/client directly to send snapshots
    this.client = new PercyClient();
    await this.client.createBuild();
    log.info('Percy has started!');

    let build = this.client.build;
    log.info(`Created build #${build.number}: ${build.url}`);

    for (let name of paths) {
      log.debug(`Uploading snapshot: ${name}`);

      // only snapshot supported images
      if (!name.match(ALLOWED_IMAGE_TYPES)) {
        log.info(`Skipping unsupported image type: ${name}`);
        continue;
      }

      let filepath = path.resolve(dirname, name);
      let buffer = fs.readFileSync(filepath);
      let { width, height } = imageSize(filepath);

      await this.client.sendSnapshot({
        // width and height is clamped to API min and max
        widths: [Math.max(10, Math.min(width, 2000))],
        minimumHeight: Math.max(10, Math.min(height, 2000)),
        resources: createImageResources(name, buffer, width, height),
        name
      });

      log.info(`Snapshot uploaded: ${name}`);
    }
  }

  // Finalize the build when finished
  async finally() {
    let build = this.client?.build;

    if (build?.id) {
      await this.client?.finalizeBuild();
      log.info(`Finalized build #${build.number}: ${build.url}`);
    }
  }
}
