import fs from 'fs';
import path from 'path';
import command from '@percy/cli-command';
import * as UploadConfig from './config.js';

const ALLOWED_FILE_TYPES = /\.(png|jpg|jpeg)$/i;
const ALLOWED_TOKEN_TYPES = ['web', 'generic'];

// The dimension reader recognises about ten formats; this command accepts two.
const SUPPORTED_IMAGE_TYPES = new Set(['png', 'jpg']);

// A JPEG frame header sits behind however much metadata the encoder wrote, so
// dimensions cannot be read at a fixed offset. This is the limit the previous
// `image-size` dependency applied, kept so that no file it could read becomes
// unreadable.
const MAX_HEADER_BYTES = 512 * 1024;

// Reads the leading bytes of a file, rather than pulling a multi-megabyte image
// into memory just to read its dimensions.
function readImageHeader(absolutePath) {
  let fd = fs.openSync(absolutePath, 'r');

  try {
    let length = Math.min(fs.fstatSync(fd).size, MAX_HEADER_BYTES);
    let header = Buffer.alloc(length);
    return header.subarray(0, fs.readSync(fd, header, 0, length, 0));
  } finally {
    fs.closeSync(fd);
  }
}

// All BYOS screenshots have a fixed comparison tag
export const BYOS_TAG = {
  name: 'Uploaded Screenshot',
  width: 1,
  height: 1
};

export const upload = command('upload', {
  description: 'Upload a directory of images to Percy',

  args: [{
    name: 'dirname',
    description: 'Directory of images to upload',
    required: true,
    validate: dir => {
      if (!fs.existsSync(dir)) {
        throw new Error(`Not found: ${dir}`);
      } else if (!fs.lstatSync(dir).isDirectory()) {
        throw new Error(`Not a directory: ${dir}`);
      }
    }
  }],

  flags: [{
    name: 'files',
    description: 'One or more globs matching image file paths to upload',
    default: UploadConfig.schema.upload.properties.files.default,
    percyrc: 'upload.files',
    type: 'pattern',
    multiple: true,
    short: 'f'
  }, {
    name: 'ignore',
    description: 'One or more globs matching image file paths to ignore',
    percyrc: 'upload.ignore',
    type: 'pattern',
    multiple: true,
    short: 'i'
  }, {
    name: 'strip-extensions',
    description: 'Strips file extensions from snapshot names',
    percyrc: 'upload.stripExtensions',
    short: 'e'
  }],

  examples: [
    '$0 ./images'
  ],

  percy: {
    deferUploads: true,
    skipDiscovery: true
  },

  config: {
    schemas: [UploadConfig.schema],
    migrations: [UploadConfig.migration]
  }
}, async function*({ flags, args, percy, log, exit }) {
  if (!percy) exit(0, 'Percy is disabled');
  let config = percy.config.upload;

  let { default: glob } = await import('fast-glob');
  let pathnames = yield glob(config.files, {
    ignore: [].concat(config.ignore || []),
    cwd: args.dirname,
    fs
  });

  if (!pathnames.length) {
    exit(1, `No matching files found in '${args.dirname}'`);
  }

  const tokenType = percy.client.tokenType();

  if (!ALLOWED_TOKEN_TYPES.includes(tokenType)) {
    exit(1, 'Invalid Token Type. Only "web" and "self-managed" token types are allowed.');
  }

  // `sync.js` is the buffer-parser entrypoint — none of the http or stream
  // machinery. The extension is required because the package publishes no
  // `exports` map and this one is ESM.
  let { default: probeImageSize } = await import('probe-image-size/sync.js');
  let { getImageResources } = await import('./utils.js');

  // the internal discovery queue shares a concurrency with the snapshots queue
  percy.set({ discovery: { concurrency: config.concurrency } });
  yield* percy.yield.start();

  for (let relativePath of pathnames) {
    if (!ALLOWED_FILE_TYPES.test(relativePath)) {
      log.info(`Skipping unsupported file type: ${relativePath}`);
    } else {
      let absolutePath = path.resolve(args.dirname, relativePath);
      let probed = probeImageSize(readImageHeader(absolutePath));

      // covers a file whose extension disagrees with its contents — including a
      // readable image in a format this command does not accept
      if (!probed || !SUPPORTED_IMAGE_TYPES.has(probed.type)) {
        log.info(`Skipping file with unreadable image data: ${relativePath}`);
        continue;
      }

      let img = {
        relativePath,
        absolutePath,
        width: probed.width,
        height: probed.height
      };
      let { dir, name, ext } = path.parse(relativePath);
      img.type = ext === '.png' ? 'png' : 'jpeg';
      img.name = path.join(dir, name);
      let snapshotName = config.stripExtensions ? img.name : relativePath;

      if (tokenType === 'generic') {
        percy.upload({
          name: snapshotName,
          tag: BYOS_TAG,
          tiles: [
            { filepath: img.absolutePath }
          ]
        });
      } else {
        percy.upload({
          name: snapshotName,
          // width and height is clamped to API min and max
          widths: [Math.max(10, Math.min(img.width, 2000))],
          minHeight: Math.max(10, Math.min(img.height, 2000)),
          // resources are read from the filesystem as needed
          resources: () => getImageResources(img)
        });
      }
    }
  }

  try {
    yield* percy.yield.stop();
  } catch (error) {
    await percy.stop(true);
    throw error;
  }
});

export default upload;
