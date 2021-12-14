import fs from 'fs';
import path from 'path';
import Command, { flags } from '@percy/cli-command';
import logger from '@percy/logger';
import globby from 'globby';
import imageSize from 'image-size';
import PercyClient from '@percy/client';

// eslint-disable-next-line import/no-extraneous-dependencies
import Queue from '@percy/core/dist/queue';

import createImageResources from '../resources';
import { schema } from '../config';
import pkg from '../../package.json';

const ALLOWED_FILE_TYPES = /^\.(png|jpg|jpeg)$/i;

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

    files: flags.string({
      char: 'f',
      multiple: true,
      description: 'one or more globs matching image file paths to upload',
      default: schema.upload.properties.files.default,
      percyrc: 'upload.files'
    }),
    ignore: flags.string({
      char: 'i',
      multiple: true,
      description: 'one or more globs matching image file paths to ignore',
      percyrc: 'upload.ignore'
    }),
    'strip-extensions': flags.boolean({
      char: 'e',
      description: 'strips file extensions from snapshot names',
      percyrc: 'upload.stripExtensions'
    }),
    'dry-run': flags.boolean({
      char: 'd',
      description: 'prints a list of matching images to upload without uploading'
    })
  };

  static examples = [
    '$ percy upload ./images'
  ];

  log = logger('cli:upload');

  async run() {
    if (!this.isPercyEnabled()) {
      return this.log.info('Percy is disabled. Skipping upload');
    }

    let { dirname } = this.args;
    let { 'dry-run': dry } = this.flags;

    if (!fs.existsSync(dirname)) {
      return this.error(`Not found: ${dirname}`);
    } else if (!fs.lstatSync(dirname).isDirectory()) {
      return this.error(`Not a directory: ${dirname}`);
    }

    let { upload: conf } = this.percyrc();
    this.queue = new Queue(conf.concurrency);

    let paths = await globby(conf.files, {
      ignore: [].concat(conf.ignore || []),
      cwd: dirname
    });

    let l = paths.length;
    if (!l) this.error(`No matching files found in '${dirname}'`);
    paths.sort();

    this.client = new PercyClient({
      clientInfo: `${pkg.name}/${pkg.version}`,
      environmentInfo: `node/${process.version}`
    });

    if (dry) {
      this.log.info(`Found ${l} snapshot${l !== 1 ? 's' : ''}`);
    } else {
      let { data: build } = await this.client.createBuild();
      let { 'build-number': number, 'web-url': url } = build.attributes;
      this.build = { id: build.id, number, url };
      this.log.info('Percy has started!');
    }

    for (let filename of paths) {
      let file = path.parse(filename);

      if (!ALLOWED_FILE_TYPES.test(file.ext)) {
        this.log.info(`Skipping unsupported file type: ${filename}`);
        continue;
      }

      let name = conf.stripExtensions ? (
        path.join(file.dir, file.name)
      ) : filename;

      if (dry) this.log.info(`Snapshot found: ${name}`);
      else this.snapshot(name, filename, dirname);
    }
  }

  // Push a snapshot upload to the queue
  snapshot(name, filename, dirname) {
    this.queue.push(`upload/${name}`, async () => {
      let filepath = path.resolve(dirname, filename);
      let { width, height } = imageSize(filepath);
      let buffer = fs.readFileSync(filepath);

      await this.client.sendSnapshot(this.build.id, {
        // width and height is clamped to API min and max
        widths: [Math.max(10, Math.min(width, 2000))],
        minHeight: Math.max(10, Math.min(height, 2000)),
        resources: createImageResources(filename, buffer, width, height),
        name
      });

      this.log.info(`Snapshot uploaded: ${name}`);
    });
  }

  // Finalize the build when finished
  async finally(error) {
    if (!this.build?.id) return;
    if (error) this.queue.close(true);
    if (this.closing) return;
    this.closing = true;

    await this.queue.empty(s => {
      this.log.progress(`Uploading ${s} snapshot${s !== 1 ? 's' : ''}...`, !!s);
    });

    await this.client.finalizeBuild(this.build.id);
    this.log.info(`Finalized build #${this.build.number}: ${this.build.url}`);
  }
}
