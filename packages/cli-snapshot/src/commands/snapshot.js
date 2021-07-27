import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import globby from 'globby';
import picomatch from 'picomatch';
import * as pathToRegexp from 'path-to-regexp';
import YAML from 'yaml';
import { configSchema } from '../config';
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
      description: 'rewrite index and filepath URLs to be clean',
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

    if (this.server) {
      await new Promise(resolve => {
        this.server.close(resolve);
      });
    }
  }

  // Serves a static directory at a base-url and resolves when listening.
  async serve(dir, rewrites) {
    let localhost = 'http://localhost';
    if (this.flags['dry-run']) return localhost;

    return new Promise(resolve => {
      let http = require('http');
      let serve = require('serve-handler');
      let { cleanUrls } = this.percy.config.static;

      this.server = http.createServer((req, res) => {
        serve(req, res, {
          public: dir,
          cleanUrls,
          rewrites
        });
      }).listen(() => {
        let { port } = this.server.address();
        resolve(`${localhost}:${port}`);
      });
    });
  }

  // Mutates a page item to have default or normalized options
  withDefaults(page) {
    let url = (() => {
      // Throw a better error message for invalid urls
      try { return new URL(page.url, this.address); } catch (e) {
        throw new Error(`Invalid URL: ${e.input}`);
      }
    })();

    // default name to the page url
    page.name ||= `${url.pathname}${url.search}${url.hash}`;
    // normalize the page url
    page.url = url.href;

    return page;
  }

  // Starts a static server and returns a list of pages to snapshot.
  async loadStaticPages(pathname) {
    let config = this.percy.config.static;
    let baseUrl = this.flags['base-url'] || config.baseUrl;

    if (baseUrl && !baseUrl.startsWith('/')) {
      this.error('The base-url must begin with a forward slash (/) ' + (
        'when snapshotting static directories'));
    }

    // gather paths
    let paths = await globby(config.files, {
      ignore: [].concat(config.ignore || []),
      cwd: pathname
    });

    // reduce rewrite options with any base-url
    let rewrites = Object.entries(config.rewrites || {})
      .reduce((rewrites, [source, destination]) => (
        rewrites.concat({ source, destination })
      ), baseUrl ? [{
        source: path.posix.join(baseUrl, '/:path*'),
        destination: '/:path*'
      }] : []);

    // map, concat, and reduce rewrites with overrides into a single function
    let applyOverrides = [].concat({
      rewrite: url => path.posix.normalize(path.posix.join('/', url))
    }, rewrites.map(({ source, destination }) => ({
      test: pathToRegexp.match(destination),
      rewrite: pathToRegexp.compile(source)
    })), {
      test: url => config.cleanUrls && url,
      rewrite: url => url.replace(/(\/index)?\.html$/, '')
    }, (config.overrides || []).map(({ files, ignore, ...opts }) => ({
      test: picomatch(files || '**', { ignore: [].concat(ignore || []) }),
      override: page => Object.assign(page, opts)
    })), {
      override: page => this.withDefaults(page)
    }).reduceRight((apply, { test, rewrite, override }) => (p, page = { url: p }) => {
      let res = !test || test(rewrite ? page.url : p);
      if (res && rewrite) page.url = rewrite(test ? (res.params ?? res) : page.url);
      else if (res && override) override(page);
      return apply?.(p, page) ?? page;
    }, null);

    // start the static server
    this.address = await this.serve(pathname, rewrites);

    // sort and map pages with overrides
    return paths.sort().map(p => applyOverrides(p));
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

    // set the default page base address
    if (baseUrl) this.address = baseUrl;

    // support snapshots option for yaml references and lists of urls
    return (Array.isArray(pages) ? pages : pages.snapshots || []).map(page => (
      this.withDefaults(typeof page === 'string' ? { url: page } : page)
    ));
  }
}
