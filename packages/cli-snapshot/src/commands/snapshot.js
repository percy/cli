import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import globby from 'globby';
import YAML from 'yaml';
import { configSchema } from '../config';
import { serve, withDefaults, mapPages } from '../utils';
import pkg from '../../package.json';

export class Snapshot extends Command {
  static description = 'Snapshot a list of pages from a file or directory';

  static args = [{
    name: 'pathname',
    description: 'path to a directory or file containing a list of pages',
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
    'dry-run': flags.boolean({
      description: 'prints a list of pages to snapshot without snapshotting',
      char: 'd'
    }),

    // static only flags
    files: flags.string({
      description: 'one or more globs matching static file paths to snapshot',
      default: configSchema.static.properties.files.default,
      percyrc: 'static.files',
      multiple: true
    }),
    ignore: flags.string({
      description: 'one or more globs matching static file paths to ignore',
      default: configSchema.static.properties.ignore.default,
      percyrc: 'static.ignore',
      multiple: true
    }),
    'clean-urls': flags.boolean({
      description: 'rewrite static index and filepath URLs to be clean',
      percyrc: 'static.cleanUrls'
    })
  };

  static examples = [
    '$ percy snapshot ./public',
    '$ percy snapshot pages.yml'
  ];

  log = logger('cli:snapshot')

  async run() {
    if (!this.isPercyEnabled()) {
      return this.log.info('Percy is disabled. Skipping snapshots');
    }

    let { pathname } = this.args;

    if (!fs.existsSync(pathname)) {
      this.error(`Not found: ${pathname}`);
    }

    this.percy = new Percy({
      ...this.percyrc(),
      clientInfo: `${pkg.name}/${pkg.version}`,
      server: false
    });

    let pages = fs.lstatSync(pathname).isDirectory()
      ? await this.loadStaticPages(pathname)
      : await this.loadPagesFile(pathname);

    let l = pages.length;
    if (!l) this.error('No snapshots found');

    let dry = this.flags['dry-run'];
    if (!dry) await this.percy.start();
    else this.log.info(`Found ${l} snapshot${l === 1 ? '' : 's'}`);

    for (let page of pages) {
      if (dry) {
        this.log.info(`Snapshot found: ${page.name}`);
        this.log.debug(`-> url: ${page.url}`);

        for (let s of (page.additionalSnapshots || [])) {
          let name = s.name || `${s.prefix || ''}${page.name}${s.suffix || ''}`;
          this.log.info(`Snapshot found: ${name}`);
          this.log.debug(`-> url: ${page.url}`);
        }
      } else {
        this.percy.snapshot(page);
      }
    }
  }

  // Called on error, interupt, or after running
  async finally(error) {
    await this.percy?.stop(!!error);
    await this.server?.close();
  }

  // Starts a static server and returns a list of pages to snapshot.
  async loadStaticPages(pathname) {
    let config = this.percy.config.static;
    let baseUrl = this.flags['base-url'] || config.baseUrl;
    let dry = this.flags['dry-run'];

    if (baseUrl && !baseUrl.startsWith('/')) {
      this.error('The base-url must begin with a forward slash (/) ' + (
        'when snapshotting static directories'));
    }

    this.server = await serve(pathname, { ...config, baseUrl, dry });

    let { host, rewrites } = this.server;
    let ignore = [].concat(config.ignore || []);
    let paths = await globby(config.files, { cwd: pathname, ignore });
    return mapPages(paths, { ...config, host, rewrites });
  }

  // Loads pages to snapshot from a js, json, or yaml file.
  async loadPagesFile(pathname) {
    let ext = path.extname(pathname);
    let baseUrl = this.flags['base-url'];
    let pages = [];

    if (baseUrl && !baseUrl.startsWith('http')) {
      this.error('The base-url must include a protocol and hostname ' + (
        'when snapshotting a list of pages'));
    }

    if (ext === '.js') {
      pages = require(path.resolve(pathname));
      if (typeof pages === 'function') pages = await pages();
    } else if (ext === '.json') {
      pages = JSON.parse(fs.readFileSync(pathname, { encoding: 'utf-8' }));
    } else if (ext.match(/\.ya?ml$/)) {
      pages = YAML.parse(fs.readFileSync(pathname, { encoding: 'utf-8' }));
    } else {
      this.error(`Unsupported filetype: ${pathname}`);
    }

    // validate page listings
    let errors = PercyConfig.validate(pages, '/snapshot/list');

    if (errors) {
      this.log.warn('Invalid snapshot options:');
      for (let e of errors) this.log.warn(`- ${e.path}: ${e.message}`);
    }

    // support snapshots option for yaml references and lists of urls
    return (Array.isArray(pages) ? pages : pages.snapshots || [])
      .map(page => withDefaults(page, { host: baseUrl }));
  }
}
