import PercyClient from '@percy/client';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';
import Queue from './queue';
import Browser from './browser';
import createPercyServer from './server';

import {
  getSnapshotConfig,
  debugSnapshotConfig,
  discoverSnapshotResources
} from './snapshot';

// A Percy instance will create a new build when started, handle snapshot
// creation, asset discovery, and resource uploads, and will finalize the build
// when stopped. Snapshots are processed concurrently and the build is not
// finalized until all snapshots have been handled.
export default class Percy {
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
    this.deferUploads = skipUploads || deferUploads;
    this.skipUploads = skipUploads;

    this.config = PercyConfig.load({
      overrides: options,
      path: config
    });

    let { concurrency } = this.config.discovery;
    if (concurrency) this.#snapshots.concurrency = concurrency;
    if (this.deferUploads) this.#uploads.stop();

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
      this.server = createPercyServer(this);
      this.port = port;
    }
  }

  // Shortcut for controlling the global logger's log level.
  loglevel(level) {
    return logger.loglevel(level);
  }

  // Snapshot server API address
  address() {
    return `http://localhost:${this.port}`;
  }

  // Resolves once snapshot and upload queues are idle
  async idle() {
    await this.#snapshots.idle();
    await this.#uploads.idle();
  }

  // Waits for snapshot idle and flushes the upload queue
  async dispatch() {
    await this.#snapshots.idle();
    if (!this.skipUploads) await this.#uploads.flush();
  }

  // Immediately stops all queues, preventing any more tasks from running
  close() {
    this.#snapshots.close(true);
    this.#uploads.close(true);
  }

  // Starts a local API server, a browser process, and queues creating a new Percy build which will run
  // at a later time when uploads are deferred, or run immediately when not deferred.
  async start() {
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
        this.log.error('Failed to create build');
        this.log.error(err);
        this.close();
      });
    }

    try {
      // when not deferred, wait until the build is created first
      if (!this.deferUploads) await buildTask;
      // launch the discovery browser
      await this.browser.launch(this.config.discovery.launchOptions);
      // if there is a server, start listening
      await this.server?.listen(this.port);

      // mark this process as running
      this.log.info('Percy has started!');
      this.readyState = 1;
    } catch (error) {
      // on error, close any running server and browser
      await this.server?.close();
      await this.browser.close();
      this.readyState = 3;

      // throw an easier-to-understand error when the port is taken
      if (error.code === 'EADDRINUSE') {
        throw new Error('Percy is already running or the port is in use');
      } else {
        throw error;
      }
    }
  }

  // Stops the local API server and browser once snapshots have completed and finalizes the Percy
  // build. Does nothing if not running. When `force` is true, any queued tasks are cleared.
  async stop(force) {
    // not started or already stopped
    if (!this.readyState || this.readyState > 2) return;

    // close queues asap
    if (force) this.close();

    // already stopping
    if (this.readyState === 2) return;
    this.readyState = 2;

    // log when force stopping
    let meta = { build: this.build };
    if (force) this.log.info('Stopping percy...', meta);

    // close the snapshot queue and wait for it to empty
    if (this.#snapshots.close().size) {
      await this.#snapshots.empty(s => {
        this.log.progress(`Processing ${s} snapshot${s !== 1 ? 's' : ''}...`, !!s)
      });
    }

    // run, close, and wait for the upload queue to empty
    if (!this.skipUploads && this.#uploads.run().close().size) {
      await this.#uploads.empty(s => {
        this.log.progress(`Uploading ${s} snapshot${s !== 1 ? 's' : ''}...`, !!s);
      });
    }

    // close the any running server and browser
    await this.server?.close();
    await this.browser.close();

    if (this.build?.failed) {
      // do not finalize failed builds
      this.log.warn(`Build #${this.build.number} failed: ${this.build.url}`, meta);
    } else if (this.build) {
      // finalize the build
      await this.client.finalizeBuild(this.build.id);
      this.log.info(`Finalized build #${this.build.number}: ${this.build.url}`, meta);
    } else {
      // no build was ever created (likely failed while deferred)
      this.log.warn('Build not created', meta);
    }

    this.readyState = 3;
  }

  // Deprecated capture method
  capture(options) {
    this.log.deprecated('The #capture() method will be ' + (
      'removed in 1.0.0. Use #snapshot() instead.'));
    return this.snapshot(options);
  }

  // Takes one or more snapshots of a page while discovering resources to upload with the
  // snapshot. If an existing dom snapshot is provided, it will be served as the root resource
  // during asset discovery. Once asset discovery has completed, the queued snapshot will resolve
  // and an upload task will be queued separately.
  snapshot(options) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    }

    // get derived snapshot config options
    let snapshot = getSnapshotConfig(this, options);

    // clear any existing pending upload for the same snapshot (for retries)
    this.#uploads.clear(`upload/${snapshot.name}`);

    // resolves after asset discovery has finished and the upload has been queued
    return this.#snapshots.push(`snapshot/${snapshot.name}`, async () => {
      debugSnapshotConfig(snapshot);

      try {
        await discoverSnapshotResources(this, snapshot, (snapshot, resources) => {
          this.log.info(`Snapshot taken: ${snapshot.name}`, snapshot.meta);
          this._scheduleUpload(snapshot, resources);
        });
      } catch (error) {
        this.log.error(`Encountered an error taking snapshot: ${snapshot.name}`, snapshot.meta);
        this.log.error(error, snapshot.meta);
      }
    });
  }

  // Queues a snapshot upload with the provided configuration options and resources
  _scheduleUpload(snapshot, resources) {
    this.#uploads.push(`upload/${snapshot.name}`, async () => {
      try {
        await this.client.sendSnapshot(this.build.id, { ...snapshot, resources });
      } catch (error) {
        let failed = error.response?.status === 422 && (
          error.response.body.errors.find(e => (
            e.source?.pointer === '/data/attributes/build'
          )));

        this.log.error(`Encountered an error uploading snapshot: ${snapshot.name}`, snapshot.meta);
        this.log.error(failed?.detail ?? error, snapshot.meta);

        // build failed at some point, stop accepting snapshots
        if (failed) {
          this.build.failed = true;
          this.close();
        }
      }
    });
  }
}
