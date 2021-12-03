import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import { request } from '@percy/core/dist/utils';
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
  static description = 'Take snapshots from a static directory, snapshots file, or sitemap url';

  static args = [{
    name: 'dir|file|sitemap',
    description: 'static directory, snapshots file, or sitemap url',
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

    let { 'dir|file|sitemap': arg } = this.args;
    let isSitemap = /^https?:\/\//.test(arg);

    // validate directory or file existence
    if (!isSitemap && !fs.existsSync(arg)) this.error(`Not found: ${arg}`);
    let isStatic = !isSitemap && fs.lstatSync(arg).isDirectory();

    // initialize percy
    this.percy = new Percy({
      ...this.percyrc({
        [isSitemap ? 'sitemap' : 'static']: (
          (isSitemap || isStatic) ? {
            include: this.flags.include,
            exclude: this.flags.exclude
          } : undefined)
      }),

      clientInfo: `${pkg.name}/${pkg.version}`,
      environmentInfo: `node/${process.version}`,
      server: false
    });

    // gather snapshots
    let snapshots = (
      (isSitemap && await this.loadSitemapSnapshots(arg)) ||
      (isStatic && await this.loadStaticSnapshots(arg)) ||
      await this.loadSnapshotsFile(arg));

    if (!snapshots.length) {
      this.error('No snapshots found');
    }

    // start processing snapshots
    await this.percy.start();
    this.percy.snapshot(snapshots);
  }

  // Called on error, interupt, or after running
  async finally(error) {
    await this.percy?.stop(!!error);
    await this.server?.close();
  }

  // Fetches and maps sitemap URLs to snapshots.
  async loadSitemapSnapshots(sitemap) {
    let config = this.percy.config.sitemap;

    // fetch sitemap URLs
    let urls = await request(sitemap, (body, res) => {
      // validate sitemap content-type
      let [contentType] = res.headers['content-type'].split(';');

      if (!/^(application|text)\/xml$/.test(contentType)) {
        this.error('The sitemap must be an XML document, ' + (
          `but the content-type was "${contentType}"`));
      }

      // parse XML content into a list of URLs
      let urls = body.match(/(?<=<loc>)(.*)(?=<\/loc>)/ig);

      // filter out duplicate URLs that differ by a trailing slash
      return urls.filter((url, i) => {
        let match = urls.indexOf(url.replace(/\/$/, ''));
        return match === -1 || match === i;
      });
    });

    // map with inherited static options
    return mapStaticSnapshots(urls, config);
  }

  // Serves a static directory and returns a list of snapshots.
  async loadStaticSnapshots(dir) {
    let config = this.percy.config.static;
    let baseUrl = this.flags['base-url'] || config.baseUrl;
    let dryRun = this.flags['dry-run'];

    // validate any provided base-url
    if (baseUrl && !baseUrl.startsWith('/')) {
      this.error('The base-url must begin with a forward slash (/) ' + (
        'when snapshotting static directories'));
    }

    // start the server
    this.server = await serve(dir, {
      ...config, baseUrl, dryRun
    });

    // gather paths
    let isStr = s => typeof s === 'string';
    let strOr = (a, b) => a.length && a.every(isStr) ? a : b;
    let files = strOr([].concat(config.include || []), '**/*.html');
    let ignore = strOr([].concat(config.exclude || []), []);
    let paths = await globby(files, { cwd: dir, ignore });

    // map snapshots from paths and config
    return mapStaticSnapshots(paths, {
      ...config, server: this.server
    });
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
