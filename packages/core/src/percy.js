import PercyClient from '@percy/client';
import PercyConfig from '@percy/config';
import { merge } from '@percy/config/dist/utils';
import logger from '@percy/logger';
import Queue from './queue';
import Browser from './browser';

import {
  createPercyServer,
  createStaticServer
} from './api';
import {
  getSnapshotConfig,
  getSitemapSnapshots,
  mapSnapshotOptions,
  validateSnapshotOptions,
  discoverSnapshotResources
} from './snapshot';
import {
  generatePromise
} from './utils';

// A Percy instance will create a new build when started, handle snapshot
// creation, asset discovery, and resource uploads, and will finalize the build
// when stopped. Snapshots are processed concurrently and the build is not
// finalized until all snapshots have been handled.
export class Percy {
  log = logger('core');
  readyState = null;

  #uploads = new Queue();
  #snapshots = new Queue();

  // Static shortcut to create and start an instance in one call
  static async start(options) {
    let instance = new this(options);
    await instance.start();
    return instance;
  }

  constructor({
    // initial log level
    loglevel,
    // do not eagerly upload snapshots
    deferUploads,
    // run without uploading anything
    skipUploads,
    // implies `skipUploads` and also skips asset discovery
    dryRun,
    // configuration filepath
    config,
    // provided to @percy/client
    token,
    clientInfo = '',
    environmentInfo = '',
    // snapshot server options
    server = true,
    port = 5338,
    // options such as `snapshot` and `discovery` that are valid Percy config
    // options which will become accessible via the `.config` property
    ...options
  } = {}) {
    if (loglevel) this.loglevel(loglevel);

    this.dryRun = !!dryRun;
    this.skipUploads = this.dryRun || !!skipUploads;
    this.deferUploads = this.skipUploads || !!deferUploads;
    if (this.deferUploads) this.#uploads.stop();

    this.config = PercyConfig.load({
      overrides: options,
      path: config
    });

    if (this.config.discovery.concurrency) {
      let { concurrency } = this.config.discovery;
      this.#uploads.concurrency = concurrency;
      this.#snapshots.concurrency = concurrency;
    }

    this.client = new PercyClient({
      token,
      clientInfo,
      environmentInfo
    });

    this.browser = new Browser({
      ...this.config.discovery.launchOptions,
      cookies: this.config.discovery.cookies
    });

    if (server) {
      this.server = createPercyServer(this, port);
    }
  }

  // Shortcut for controlling the global logger's log level.
  loglevel(level) {
    return logger.loglevel(level);
  }

  // Snapshot server API address
  address() {
    return this.server?.address();
  }

  // Set client & environment info, and override loaded config options
  setConfig({ clientInfo, environmentInfo, ...config }) {
    this.client.addClientInfo(clientInfo);
    this.client.addEnvironmentInfo(environmentInfo);

    // normalize config and do nothing if empty
    config = PercyConfig.normalize(config, { schema: '/config' });
    if (!config) return this.config;

    // validate provided config options
    let errors = PercyConfig.validate(config);

    if (errors) {
      this.log.warn('Invalid config:');
      for (let e of errors) this.log.warn(`- ${e.path}: ${e.message}`);
    }

    // merge and override existing config options
    this.config = merge([this.config, config], (path, prev, next) => {
      // replace arrays instead of merging
      return Array.isArray(next) && [path, next];
    });

    // adjust concurrency if necessary
    if (this.config.discovery.concurrency) {
      let { concurrency } = this.config.discovery;
      this.#uploads.concurrency = concurrency;
      this.#snapshots.concurrency = concurrency;
    }

    return this.config;
  }

  // Resolves once snapshot and upload queues are idle
  idle = () => generatePromise(async function*() {
    yield* this.#snapshots.idle();
    yield* this.#uploads.idle();
  }.bind(this))

  // Immediately stops all queues, preventing any more tasks from running
  close() {
    this.#snapshots.close(true);
    this.#uploads.close(true);
  }

  // Starts a local API server, a browser process, and queues creating a new Percy build which will run
  // at a later time when uploads are deferred, or run immediately when not deferred.
  start = options => generatePromise(async function*() {
    // already starting or started
    if (this.readyState != null) return;
    this.readyState = 0;

    // create a percy build as the first immediately queued task
    let buildTask = this.#uploads.push('build/create', () => {
      // pause other queued tasks until after the build is created
      this.#uploads.stop();

      return this.client.createBuild()
        .then(({ data: { id, attributes } }) => {
          this.build = { id };
          this.build.number = attributes['build-number'];
          this.build.url = attributes['web-url'];
          this.#uploads.run();
        });
    }, 0);

    // handle deferred build errors
    if (this.deferUploads) {
      buildTask.catch(err => {
        this.build = { error: 'Failed to create build' };
        this.log.error(this.build.error);
        this.log.error(err);
        this.close();
      });
    }

    try {
      // when not deferred, wait until the build is created first
      if (!this.deferUploads) await buildTask;

      // maybe launch the discovery browser
      if (!this.dryRun && options?.browser !== false) {
        yield this.browser.launch();
      }

      // start the server after everything else is ready
      yield this.server?.listen();

      // mark instance as started
      this.log.info('Percy has started!');
      this.readyState = 1;
    } catch (error) {
      // on error, close any running server and browser
      await this.server?.close();
      await this.browser.close();

      // mark instance as closed
      this.readyState = 3;

      // when uploads are deferred, cancel build creation
      if (error.canceled && this.deferUploads) {
        this.#uploads.cancel('build/create');
        this.readyState = null;
      }

      // throw an easier-to-understand error when the port is taken
      if (error.code === 'EADDRINUSE') {
        throw new Error('Percy is already running or the port is in use');
      } else {
        throw error;
      }
    }
  }.bind(this))

  // Wait for currently queued snapshots then run and wait for resulting uploads
  flush = close => generatePromise(async function*() {
    // wait until the next tick for synchronous snapshots
    yield new Promise(r => process.nextTick(r));

    // close the snapshot queue and wait for it to empty
    if (this.#snapshots.size) {
      if (close) this.#snapshots.close();

      yield* this.#snapshots.flush(s => {
        // do not log a count when not closing or while dry-running
        if (!close || this.dryRun) return;
        this.log.progress(`Processing ${s} snapshot${s !== 1 ? 's' : ''}...`, !!s);
      });
    }

    // run, close, and wait for the upload queue to empty
    if (!this.skipUploads && this.#uploads.size) {
      if (close) this.#uploads.close();

      yield* this.#uploads.flush(s => {
        // do not log a count when not closing or while creating a build
        if (!close || this.#uploads.has('build/create')) return;
        this.log.progress(`Uploading ${s} snapshot${s !== 1 ? 's' : ''}...`, !!s);
      });
    }
  }.bind(this)).canceled(() => {
    // reopen closed queues when canceled
    this.#snapshots.open();
    this.#uploads.open();
  })

  // Stops the local API server and browser once snapshots have completed and finalizes the Percy
  // build. Does nothing if not running. When `force` is true, any queued tasks are cleared.
  stop = force => generatePromise(async function*() {
    // not started, but the browser was launched
    if (!this.readyState && this.browser.isConnected()) {
      await this.browser.close();
    }

    // not started or already stopped
    if (!this.readyState || this.readyState > 2) return;

    // close queues asap
    if (force) this.close();

    // already stopping
    if (this.readyState === 2) return;
    this.readyState = 2;

    // log when force stopping
    if (force) this.log.info('Stopping percy...');

    // process uploads and close queues
    yield* this.flush(true);

    // if dry-running, log the total number of snapshots
    if (this.dryRun && this.#uploads.size) {
      let total = this.#uploads.size - 1; // subtract the build task
      this.log.info(`Found ${total} snapshot${total !== 1 ? 's' : ''}`);
    }

    // close any running server and browser
    await this.server?.close();
    await this.browser.close();

    // finalize and log build info
    let meta = { build: this.build };

    if (this.build?.failed) {
      // do not finalize failed builds
      this.log.warn(`Build #${this.build.number} failed: ${this.build.url}`, meta);
    } else if (this.build?.id) {
      // finalize the build
      await this.client.finalizeBuild(this.build.id);
      this.log.info(`Finalized build #${this.build.number}: ${this.build.url}`, meta);
    } else {
      // no build was ever created (likely failed while deferred)
      this.log.warn('Build not created', meta);
    }

    // mark instance as stopped
    this.readyState = 3;
  }.bind(this)).canceled(() => {
    // reset ready state when canceled
    this.readyState = 1;
  })

  // Deprecated capture method
  capture(options) {
    this.log.deprecated('The #capture() method will be ' + (
      'removed in 1.0.0. Use #snapshot() instead.'));
    return this.snapshot(options);
  }

  // Takes one or more snapshots of a page while discovering resources to upload with the
  // snapshot. Once asset discovery has completed, the queued snapshot will resolve and an upload
  // task will be queued separately. Accepts several different syntaxes for taking snapshots using
  // various methods.
  //
  // snapshot(url|{url}|[...url|{url}])
  // - requires fully qualified resolvable urls
  // - snapshot options may be provided with the object syntax
  //
  // snapshot({snapshots:[...url|{url}]})
  // - optional `baseUrl` prepended to snapshot urls
  // - optional `options` apply to all or specific snapshots
  //
  // snapshot(sitemap|{sitemap})
  // - required to be a fully qualified resolvable url ending in `.xml`
  // - optional `include`/`exclude` to filter snapshots
  // - optional `options` apply to all or specific snapshots
  //
  // snapshot({serve})
  // - server address is prepended to snapshot urls
  // - optional `baseUrl` used when serving pages
  // - optional `rewrites`/`cleanUrls` to control snapshot urls
  // - optional `include`/`exclude` to filter snapshots
  // - optional `snapshots`, with fallback to built-in sitemap.xml
  // - optional `options` apply to all or specific snapshots
  //
  // All available syntaxes will eventually push snapshots to the snapshot queue without the need to
  // await on this method directly. This method resolves after the snapshot upload is queued, but
  // does not await on the upload to complete.
  snapshot(options) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    } else if (this.build?.error) {
      throw new Error(this.build.error);
    } else if (Array.isArray(options)) {
      return Promise.all(options.map(o => this.snapshot(o)));
    }

    if (typeof options === 'string') {
      options = options.endsWith('.xml') ? { sitemap: options } : { url: options };
    }

    options = validateSnapshotOptions(options);
    this.client.addClientInfo(options.clientInfo);
    this.client.addEnvironmentInfo(options.environmentInfo);

    return Promise.resolve().then(async () => {
      let server = 'serve' in options ? (
        await createStaticServer(options).listen()
      ) : null;

      if (server) {
        options.baseUrl = new URL(options.baseUrl || '', server.address()).href;
        if (!options.snapshots) options.sitemap = new URL('sitemap.xml', options.baseUrl).href;
      }

      let snapshots = options.snapshots ||
        ('sitemap' in options && await getSitemapSnapshots(options)) ||
        ('url' in options && [options]);

      await Promise.all(mapSnapshotOptions(snapshots, options, (
        snapshot => this._takeSnapshot(snapshot)
      )));

      await server?.close();
    });
  }

  _takeSnapshot(options) {
    // get derived snapshot config options
    let snapshot = getSnapshotConfig(this, options);

    // clear any existing snapshot uploads of the same name (for retries)
    for (let { name } of [snapshot, ...(snapshot.additionalSnapshots || [])]) {
      this.#uploads.cancel(`upload/${name}`);
    }

    // resolves after asset discovery has finished and uploads have been queued
    return this.#snapshots.push(`snapshot/${snapshot.name}`, async function*() {
      try {
        yield* discoverSnapshotResources(this, snapshot, (snap, resources) => {
          if (!this.dryRun) this.log.info(`Snapshot taken: ${snap.name}`, snap.meta);
          this._scheduleUpload(snap.name, { ...snap, resources });
        });
      } catch (error) {
        if (error.canceled) {
          this.log.error('Received a duplicate snapshot name, ' + (
            `the previous snapshot was canceled: ${snapshot.name}`));
        } else {
          this.log.error(`Encountered an error taking snapshot: ${snapshot.name}`, snapshot.meta);
          this.log.error(error, snapshot.meta);
        }
      }

      // fixes an issue in Node 12 where implicit returns do not correctly resolve the async
      // generator objects — https://crbug.com/v8/10238
      return; // eslint-disable-line no-useless-return
    }.bind(this));
  }

  // Queues a snapshot upload with the provided options
  _scheduleUpload(name, options) {
    if (this.build?.error) {
      throw new Error(this.build.error);
    }

    return this.#uploads.push(`upload/${name}`, async () => {
      try {
        /* istanbul ignore if: useful for other internal packages */
        if (typeof options === 'function') options = await options();
        await this.client.sendSnapshot(this.build.id, options);
      } catch (error) {
        let failed = error.response?.statusCode === 422 && (
          error.response.body.errors.find(e => (
            e.source?.pointer === '/data/attributes/build'
          )));

        this.log.error(`Encountered an error uploading snapshot: ${name}`, options.meta);
        this.log.error(failed?.detail ?? error, options.meta);

        // build failed at some point, stop accepting snapshots
        if (failed) {
          this.build.error = failed.detail;
          this.build.failed = true;
          this.close();
        }
      }
    });
  }
}

export default Percy;
