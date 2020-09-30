import fs from 'fs';
import path from 'path';
import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import log from '@percy/logger';
import globby from 'globby';
import YAML from 'yaml';
import { schema } from '../config';
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
      char: 'b',
      description: 'the url path to serve the static directory from',
      default: schema.static.properties.baseUrl.default,
      percyrc: 'static.baseUrl'
    }),
    files: flags.string({
      char: 'f',
      multiple: true,
      description: 'one or more globs matching static file paths to snapshot',
      default: schema.static.properties.files.default,
      percyrc: 'static.files'
    }),
    ignore: flags.string({
      char: 'i',
      multiple: true,
      description: 'one or more globs matching static file paths to ignore',
      percyrc: 'static.ignore'
    }),
    'dry-run': flags.boolean({
      char: 'd',
      description: 'prints a list of pages to snapshot without snapshotting'
    })
  };

  static examples = [
    '$ percy snapshot ./public',
    '$ percy snapshot pages.yml'
  ];

  async run() {
    if (!this.isPercyEnabled()) {
      log.info('Percy is disabled. Skipping snapshots');
      return;
    }

    let config = this.percyrc();
    let { pathname } = this.args;

    if (!fs.existsSync(pathname)) {
      return this.error(`Not found: ${pathname}`);
    } else if (config.static.baseUrl[0] !== '/') {
      return this.error('The base-url flag must begin with a forward slash (/)');
    }

    let pages = fs.lstatSync(pathname).isDirectory()
      ? await this.loadStaticPages(pathname, config.static)
      : await this.loadPagesFile(pathname);

    if (!pages.length) {
      return this.error('No snapshots found');
    }

    if (this.flags['dry-run']) {
      let l = pages.length;

      log.info(`Found ${l} snapshot${l === 1 ? '' : 's'}:`);

      return pages.forEach(({ name, snapshots = [] }) => {
        (name ? [{ name }].concat(snapshots) : snapshots)
          .forEach(({ name }) => console.log(name));
      });
    }

    this.percy = await Percy.start({
      clientInfo: `${pkg.name}/${pkg.version}`,
      server: false,
      config: false,
      ...config
    });

    await Promise.all(pages.map(page => (
      this.percy.capture(page)
    )));
  }

  // Called on error, interupt, or after running
  async finally() {
    await this.percy?.stop();

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
  async loadStaticPages(pathname, { baseUrl, files, ignore }) {
    ignore = [].concat(ignore).filter(Boolean);
    let paths = await globby(files, { cwd: pathname, ignore });
    let addr = '';

    if (!this.flags['dry-run']) {
      addr = await this.serve(pathname, baseUrl);
    }

    return paths.sort().map(path => ({
      url: `${addr}${baseUrl}${path}`,
      name: `${baseUrl}${path}`
    }));
  }

  // Loads pages to snapshot from a js, json, or yaml file.
  async loadPagesFile(pathname) {
    let ext = path.extname(pathname);

    if (ext === '.js') {
      let pages = require(path.resolve(pathname));
      return typeof pages === 'function' ? await pages() : pages;
    } else if (ext === '.json') {
      return JSON.parse(fs.readFileSync(pathname, { encoding: 'utf-8' }));
    } else if (ext.match(/\.ya?ml$/)) {
      return YAML.parse(fs.readFileSync(pathname, { encoding: 'utf-8' }));
    } else {
      return this.error(`Unsupported filetype: ${pathname}`);
    }
  }
}
