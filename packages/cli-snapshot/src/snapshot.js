import { existsSync, lstatSync } from 'fs';
import command from '@percy/cli-command';
import * as SnapshotConfig from './config';
import pkg from '../package.json';

export const snapshot = command('snapshot', {
  description: 'Snapshot a static directory, snapshots file, or sitemap URL',

  args: [{
    name: 'dir|file|sitemap',
    description: 'Static directory, snapshots file, or sitemap url',
    required: true,
    attribute: val => {
      if (/^https?:\/\//.test(val)) return 'sitemap';
      if (!existsSync(val)) throw new Error(`Not found: ${val}`);
      return lstatSync(val).isDirectory() ? 'dir' : 'file';
    }
  }],

  flags: [{
    name: 'base-url',
    description: 'The base url pages are hosted at when snapshotting',
    type: 'string',
    short: 'b'
  }, {
    name: 'include',
    description: 'One or more globs/patterns matching snapshots to include',
    type: 'pattern',
    multiple: true
  }, {
    name: 'exclude',
    description: 'One or more globs/patterns matching snapshots to exclude',
    type: 'pattern',
    multiple: true
  }, {
    // static only
    name: 'clean-urls',
    description: 'Rewrite static index and filepath URLs to be clean',
    percyrc: 'static.cleanUrls',
    group: 'Static'
  }, {
    // deprecated
    name: 'files',
    deprecated: ['1.0.0', '--include'],
    percyrc: 'static.include',
    type: 'pattern'
  }, {
    name: 'ignore',
    deprecated: ['1.0.0', '--exclude'],
    percyrc: 'static.exclude',
    type: 'pattern'
  }],

  examples: [
    '$0 ./public',
    '$0 snapshots.yml',
    '$0 https://percy.io/sitemap.xml'
  ],

  percy: {
    clientInfo: `${pkg.name}/${pkg.version}`,
    environmentInfo: `node/${process.version}`
  },

  config: {
    schemas: [
      SnapshotConfig.commonSchema,
      SnapshotConfig.configSchema,
      SnapshotConfig.snapshotsFileSchema
    ],
    migrations: [
      SnapshotConfig.configMigration
    ]
  }
}, async function*({ percy, args, flags, log, exit }) {
  if (!percy) exit(0, 'Percy is disabled');

  // set and validate static or sitemap config flags
  if (args.dir || args.sitemap) {
    percy.setConfig({
      [args.dir ? 'static' : 'sitemap']: {
        include: flags.include,
        exclude: flags.exclude
      }
    });
  }

  // gather snapshots
  let snapshots, server;

  try {
    if (args.sitemap) {
      let { loadSitemapSnapshots } = await import('./sitemap');
      let config = { ...percy.config.sitemap, ...flags };

      snapshots = yield loadSitemapSnapshots(args.sitemap, config);
    } else if (args.dir) {
      let { serve, loadStaticSnapshots } = await import('./static');
      let config = { ...percy.config.static, ...flags };

      server = yield serve(args.dir, config);
      snapshots = yield loadStaticSnapshots(args.dir, { ...config, server });
    } else {
      let { loadSnapshotsFile } = await import('./file');

      snapshots = yield loadSnapshotsFile(args.file, flags, (invalid, i) => {
        if (i === 0) log.warn('Invalid snapshot options:');
        log.warn(`- ${invalid.path}: ${invalid.message}`);
      });
    }

    if (!snapshots.length) {
      exit(1, 'No snapshots found');
    }

    // start processing snapshots
    yield* percy.start();
    percy.snapshot(snapshots);
    yield* percy.stop();
  } catch (error) {
    await percy.stop(true);
    throw error;
  } finally {
    await server?.close();
  }
});

export default snapshot;
