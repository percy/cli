import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import globby from 'globby';
import picomatch from 'picomatch';
import YAML from 'yaml';
import { configSchema } from '../config';
import pkg from '../../package.json';

// Throw a better error message for invalid urls
function validURL(input, base) {
  try { return new URL(input, base || undefined); } catch (error) {
    throw new Error(`Invalid URL: ${error.input}`);
  }
}

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

    let { 'base-url': baseUrl, 'dry-run': dry } = this.flags;
    let isStatic = fs.lstatSync(pathname).isDirectory();

    if (baseUrl) {
      if (isStatic && !baseUrl.startsWith('/')) {
        this.error('The base-url must begin with a forward slash (/) ' + (
          'when snapshotting static directories'));
      } else if (!isStatic && !baseUrl.startsWith('http')) {
        this.error('The base-url must include a protocol and hostname ' + (
          'when snapshotting a list of pages'));
      }
    }

    this.percy = new Percy({
      ...this.percyrc({ static: isStatic ? { baseUrl } : null }),
      clientInfo: `${pkg.name}/${pkg.version}`,
      server: false
    });

    let pages = isStatic
      ? await this.loadStaticPages(pathname)
      : await this.loadPagesFile(pathname);

    pages = pages.map(page => {
      // allow a list of urls
      if (typeof page === 'string') page = { url: page };

      // validate and prepend the baseUrl
      let uri = validURL(page.url, !isStatic && baseUrl);
      page.url = uri.href;

      // default page name to url /pathname?search#hash
      page.name ||= `${uri.pathname}${uri.search}${uri.hash}`;

      return page;
    });

    let l = pages.length;
    if (!l) this.error('No snapshots found');

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
  async serve(staticDir, baseUrl) {
    let http = require('http');
    let serve = require('serve-handler');

    return new Promise(resolve => {
      this.server = http.createServer((req, res) => {
        serve(req, res, { public: staticDir });
      }).listen(() => {
        let { port } = this.server.address();
        resolve(`http://localhost:${port}`);
      });
    });
  }

  // Starts a static server and returns a list of pages to snapshot.
  async loadStaticPages(pathname) {
    let config = this.percy.config.static;

    // gather paths
    let paths = await globby(config.files, {
      ignore: [].concat(config.ignore || []),
      cwd: pathname
    });

    // reduce overrides into a single map function
    let applyOverrides = (config.overrides || [])
      .reduce((map, { files, ignore, ...opts }) => {
        let test = picomatch(files || '*', {
          ignore: [].concat(ignore || [])
        });

        return (path, page) => test(path)
          ? { ...map(path, page), ...opts }
          : map(path, page);
      }, path => ({
        url: new URL(`${config.baseUrl}${path}`, addr).href
      }));

    // start the static server
    let addr = this.flags['dry-run'] ? 'http://localhost'
      : await this.serve(pathname, config.baseUrl);

    // sort and map pages with overrides
    return paths.sort().map(path => (
      applyOverrides(path)
    ));
  }

  // Loads pages to snapshot from a js, json, or yaml file.
  async loadPagesFile(pathname) {
    let ext = path.extname(pathname);
    let pages = [];

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

    return Array.isArray(pages) ? pages
    // support a nested snapshots array for yaml references
      : (pages.snapshots ?? []);
  }
}
