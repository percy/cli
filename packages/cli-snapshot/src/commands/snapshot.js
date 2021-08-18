import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import globby from 'globby';
import YAML from 'yaml';
import pkg from '../../package.json';
import {
  serve,
  withDefaults,
  snapshotMatches,
  mapStaticSnapshots
} from '../utils';

export class Snapshot extends Command {
  static description = 'Take snapshots from a list or static directory';

  static args = [{
    name: 'pathname',
    description: 'path to a directory or file containing a list of snapshots',
    required: true
  }];

  static flags = {
    ...flags.logging,
    ...flags.discovery,
    ...flags.config,

    'base-url': flags.string({
      description: 'the base url pages are hosted at when snapshotting',
      char: 'b'
    }),
    include: flags.string({
      description: 'one or more globs/patterns matching snapshots to include',
      multiple: true
    }),
    exclude: flags.string({
      description: 'one or more globs/patterns matching snapshots to exclude',
      multiple: true
    }),
    'dry-run': flags.boolean({
      description: 'prints a list of snapshots without processing them',
      char: 'd'
    }),

    // static only flags
    'clean-urls': flags.boolean({
      description: 'rewrite static index and filepath URLs to be clean',
      percyrc: 'static.cleanUrls'
    }),
    // deprecated flags
    files: flags.string({
      deprecated: { map: 'include', until: '1.0.0' },
      percyrc: 'static.include',
      hidden: true
    }),
    ignore: flags.string({
      deprecated: { map: 'exclude', until: '1.0.0' },
      percyrc: 'static.exclude',
      hidden: true
    })
  };

  static examples = [
    '$ percy snapshot ./public',
    '$ percy snapshot snapshots.yml'
  ];

  log = logger('cli:snapshot')

  async run() {
    // skip snapshots
    if (!this.isPercyEnabled()) {
      return this.log.info('Percy is disabled. Skipping snapshots');
    }

    // validate path existence
    let { pathname } = this.args;
    if (!fs.existsSync(pathname)) this.error(`Not found: ${pathname}`);
    let isStatic = fs.lstatSync(pathname).isDirectory();

    // initialize percy
    this.percy = new Percy({
      ...this.percyrc({
        static: isStatic ? {
          include: this.flags.include,
          exclude: this.flags.exclude
        } : undefined
      }),

      clientInfo: `${pkg.name}/${pkg.version}`,
      server: false
    });

    // gather snapshots
    let snapshots = isStatic
      ? await this.loadStaticSnapshots(pathname)
      : await this.loadSnapshotsFile(pathname);

    let l = snapshots.length;
    if (!l) this.error('No snapshots found');

    // start processing snapshots
    let dry = this.flags['dry-run'];
    if (!dry) await this.percy.start();
    else this.log.info(`Found ${l} snapshot${l === 1 ? '' : 's'}`);

    for (let snap of snapshots) {
      if (dry) {
        this.log.info(`Snapshot found: ${snap.name}`);
        this.log.debug(`-> url: ${snap.url}`);

        for (let s of (snap.additionalSnapshots || [])) {
          let name = s.name || `${s.prefix || ''}${snap.name}${s.suffix || ''}`;
          this.log.info(`Snapshot found: ${name}`);
          this.log.debug(`-> url: ${snap.url}`);
        }
      } else {
        this.percy.snapshot(snap);
      }
    }
  }

  // Called on error, interupt, or after running
  async finally(error) {
    await this.percy?.stop(!!error);
    await this.server?.close();
  }

  // Serves a static directory and returns a list of snapshots.
  async loadStaticSnapshots(dir) {
    let config = this.percy.config.static;
    let baseUrl = this.flags['base-url'] || config.baseUrl;
    let dry = this.flags['dry-run'];

    // validate any provided base-url
    if (baseUrl && !baseUrl.startsWith('/')) {
      this.error('The base-url must begin with a forward slash (/) ' + (
        'when snapshotting static directories'));
    }

    // start the server
    this.server = await serve(dir, { ...config, baseUrl, dry });
    let { host, rewrites } = this.server;

    // gather paths and map snapshots
    let isStr = s => typeof s === 'string';
    let strOr = (a, b) => a.length && a.every(isStr) ? a : b;
    let files = strOr([].concat(config.include || []), '**/*.html');
    let ignore = strOr([].concat(config.exclude || []), []);
    let paths = await globby(files, { cwd: dir, ignore });
    return mapStaticSnapshots(paths, { ...config, host, rewrites });
  }

  // Loads snapshots from a js, json, or yaml file.
  async loadSnapshotsFile(file) {
    let ext = path.extname(file);
    let config = {};

    // load snapshots file
    if (ext === '.js') {
      config = require(path.resolve(file));
      if (typeof config === 'function') config = await config();
    } else if (ext === '.json') {
      config = JSON.parse(fs.readFileSync(file, { encoding: 'utf-8' }));
    } else if (ext.match(/\.ya?ml$/)) {
      config = YAML.parse(fs.readFileSync(file, { encoding: 'utf-8' }));
    } else {
      this.error(`Unsupported filetype: ${file}`);
    }

    let {
      // flags override config options
      'base-url': baseUrl = config.baseUrl,
      include = config.include,
      exclude = config.exclude
    } = this.flags;

    // validate base-url before config options
    if (baseUrl && !baseUrl.startsWith('http')) {
      this.error('The base-url must include a protocol and hostname ' + (
        'when providing a list of snapshots'));
    }

    // validate snapshot config options
    let errors = PercyConfig.validate(config, '/snapshot/list');

    if (errors) {
      this.log.warn('Invalid snapshot options:');
      for (let e of errors) this.log.warn(`- ${e.path}: ${e.message}`);
    }

    // support config that only contains a list of snapshots
    return (Array.isArray(config) ? config : config.snapshots || [])
      .reduce((snapshots, snap) => {
        // reduce matching snapshots with default options
        snap = withDefaults(snap, { host: baseUrl });

        return snapshotMatches(snap, include, exclude)
          ? snapshots.concat(snap) : snapshots;
      }, []);
  }
}
