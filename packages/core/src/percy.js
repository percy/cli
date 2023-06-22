import PercyClient from '@percy/client';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';
import Browser from './browser.js';

import {
  createPercyServer,
  createStaticServer
} from './api.js';
import {
  gatherSnapshots,
  createSnapshotsQueue,
  validateSnapshotOptions
} from './snapshot.js';
import {
  discoverSnapshotResources,
  createDiscoveryQueue
} from './discovery.js';
import {
  generatePromise,
  yieldAll,
  yieldTo
} from './utils.js';

// A Percy instance will create a new build when started, handle snapshot creation, asset discovery,
// and resource uploads, and will finalize the build when stopped. Snapshots are processed
// concurrently and the build is not finalized until all snapshots have been handled.
export class Percy {
  log = logger('core');
  readyState = null;

  #discovery = null;
  #snapshots = null;

  // Static shortcut to create and start an instance in one call
  static async start(options) {
    let instance = new this(options);
    await instance.start();
    return instance;
  }

  constructor({
    // initial log level
    loglevel,
    // process uploads before the next snapshot
    delayUploads,
    // process uploads after all snapshots
    deferUploads,
    // run without uploading anything
    skipUploads,
    // run without asset discovery
    skipDiscovery,
    // implies `skipUploads` and `skipDiscovery`
    dryRun,
    // implies `dryRun`, silent logs, and adds extra api endpoints
    testing,
    // configuration filepath
    config: configFile,
    // provided to @percy/client
    token,
    clientInfo = '',
    environmentInfo = '',
    // snapshot server options
    server = true,
    port = 5338,
    projectType = null,
    // options such as `snapshot` and `discovery` that are valid Percy config
    // options which will become accessible via the `.config` property
    ...options
  } = {}) {
    let { percy, ...config } = PercyConfig.load({
      overrides: options,
      path: configFile
    });

    deferUploads ??= percy?.deferUploads;
    this.config = config;

    if (testing) loglevel = 'silent';
    if (loglevel) this.loglevel(loglevel);

    this.projectType = projectType;
    this.testing = testing ? {} : null;
    this.dryRun = !!testing || !!dryRun;
    this.skipUploads = this.dryRun || !!skipUploads;
    this.skipDiscovery = this.dryRun || !!skipDiscovery;
    this.delayUploads = this.skipUploads || !!delayUploads;
    this.deferUploads = this.skipUploads || !!deferUploads;

    this.client = new PercyClient({ token, clientInfo, environmentInfo });
    if (server) this.server = createPercyServer(this, port);
    this.browser = new Browser(this);

    this.#discovery = createDiscoveryQueue(this);
    this.#snapshots = createSnapshotsQueue(this);

    // generator methods are wrapped to autorun and return promises
    for (let m of ['start', 'stop', 'flush', 'idle', 'snapshot', 'upload']) {
      // the original generator can be referenced with percy.yield.<method>
      let method = (this.yield ||= {})[m] = this[m].bind(this);
      this[m] = (...args) => generatePromise(method(...args));
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
  set({ clientInfo, environmentInfo, ...config }) {
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
    this.config = PercyConfig.merge([this.config, config], (path, prev, next) => {
      // replace arrays instead of merging
      return Array.isArray(next) && [path, next];
    });

    // adjust queue concurrency
    let { concurrency } = this.config.discovery;
    this.#discovery.set({ concurrency });
    this.#snapshots.set({ concurrency });

    return this.config;
  }

  // Starts a local API server, a browser process, and internal queues.
  async *start() {
    // already starting or started
    if (this.readyState != null) return;
    this.readyState = 0;

    try {
      // start the snapshots queue immediately when not delayed or deferred
      if (!this.delayUploads && !this.deferUploads) yield this.#snapshots.start();
      // do not start the discovery queue when not needed
      if (!this.skipDiscovery) yield this.#discovery.start();
      // start a local API server for SDK communication
      if (this.server) yield this.server.listen();
      // log and mark this instance as started
      this.log.info('Percy has started!');
      this.readyState = 1;
    } catch (error) {
      // on error, close any running server and end queues
      await this.server?.close();
      await this.#discovery.end();
      await this.#snapshots.end();

      // mark this instance as closed unless aborting
      this.readyState = error.name !== 'AbortError' ? 3 : null;

      // throw an easier-to-understand error when the port is in use
      if (error.code === 'EADDRINUSE') {
        throw new Error('Percy is already running or the port is in use');
      } else {
        throw error;
      }
    }
  }

  // Resolves once snapshot and upload queues are idle
  async *idle() {
    yield* this.#discovery.idle();
    yield* this.#snapshots.idle();
  }

  // Wait for currently queued snapshots then run and wait for resulting uploads
  async *flush(options) {
    if (!this.readyState || this.readyState > 2) return;
    let callback = typeof options === 'function' ? options : null;
    options &&= !callback ? [].concat(options) : null;

    // wait until the next event loop for synchronous snapshots
    yield new Promise(r => setImmediate(r));

    // flush and log progress for discovery before snapshots
    if (!this.skipDiscovery && this.#discovery.size) {
      if (options) yield* yieldAll(options.map(o => this.#discovery.process(o)));
      else yield* this.#discovery.flush(size => callback?.('Processing', size));
    }

    // flush and log progress for snapshot uploads
    if (!this.skipUploads && this.#snapshots.size) {
      if (options) yield* yieldAll(options.map(o => this.#snapshots.process(o)));
      else yield* this.#snapshots.flush(size => callback?.('Uploading', size));
    }
  }

  // Stops the local API server and closes the browser and internal queues once snapshots have
  // completed. Does nothing if not running. When `force` is true, any queued snapshots are cleared.
  async *stop(force) {
    // not started, but the browser was launched
    if (!this.readyState && this.browser.isConnected()) {
      await this.browser.close();
    }

    // not started or already stopped
    if (!this.readyState || this.readyState > 2) return;

    // close queues asap
    if (force) {
      this.#discovery.close(true);
      this.#snapshots.close(true);
    }

    // already stopping
    if (this.readyState === 2) return;
    this.readyState = 2;

    // log when force stopping
    if (force) this.log.info('Stopping percy...');

    // used to log snapshot count information
    let info = (state, size) => `${state} ` +
      `${size} snapshot${size !== 1 ? 's' : ''}`;

    try {
      // flush discovery and snapshot queues
      yield* this.yield.flush((state, size) => {
        this.log.progress(`${info(state, size)}...`, !!size);
      });
    } catch (error) {
      // reset ready state when aborted
      /* istanbul ignore else: all errors bubble */
      if (error.name === 'AbortError') this.readyState = 1;
      throw error;
    }

    // if dry-running, log the total number of snapshots
    if (this.dryRun && this.#snapshots.size) {
      this.log.info(info('Found', this.#snapshots.size));
    }

    // close server and end queues
    await this.server?.close();
    await this.#discovery.end();
    await this.#snapshots.end();

    // mark instance as stopped
    this.readyState = 3;
  }

  // Takes one or more snapshots of a page while discovering resources to upload with the resulting
  // snapshots. Once asset discovery has completed for the provided snapshots, the queued task will
  // resolve and an upload task will be queued separately.
  snapshot(options) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    } else if (this.build?.error) {
      throw new Error(this.build.error);
    } else if (Array.isArray(options)) {
      return yieldAll(options.map(o => this.yield.snapshot(o)));
    }

    // accept a url for a sitemap or snapshot
    if (typeof options === 'string') {
      options = options.endsWith('.xml')
        ? { sitemap: options }
        : { url: options };
    }

    // validate options and add client & environment info
    options = validateSnapshotOptions(options);
    this.client.addClientInfo(options.clientInfo);
    this.client.addEnvironmentInfo(options.environmentInfo);

    // without a discovery browser, capture is not possible
    if (this.skipDiscovery && !this.dryRun && !options.domSnapshot) {
      throw new Error('Cannot capture DOM snapshots when asset discovery is disabled');
    }

    // return an async generator to allow cancelation
    return (async function*() {
      let server;

      try {
        if ('serve' in options) {
          // create and start a static server
          let { baseUrl, snapshots } = options;
          server = yield createStaticServer(options).listen();
          baseUrl = options.baseUrl = new URL(baseUrl || '', server.address()).href;
          if (!snapshots) options.sitemap = new URL('sitemap.xml', baseUrl).href;
        }

        // gather snapshots and discover snapshot resources
        yield* discoverSnapshotResources(this.#discovery, {
          skipDiscovery: this.skipDiscovery,
          dryRun: this.dryRun,

          snapshots: yield* gatherSnapshots(options, {
            meta: { build: this.build },
            config: this.config
          })
        }, snapshot => {
          // push each finished snapshot to the snapshots queue
          this.#snapshots.push(snapshot);
        });
      } finally {
        // always close any created server
        await server?.close();
      }
    }.call(this));
  }

  // Uploads one or more snapshots directly to the current Percy build
  upload(options) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    } else if (Array.isArray(options)) {
      return yieldAll(options.map(o => this.yield.upload(o)));
    }

    // validate comparison uploads and warn about any errors
    if ('tag' in options || 'tiles' in options) {
      // throw when missing required snapshot or tag name
      if (!options.name) throw new Error('Missing required snapshot name');
      if (!options.tag?.name) throw new Error('Missing required tag name for comparison');

      // normalize, migrate, and remove certain properties from validating
      options = PercyConfig.migrate(options, '/comparison');
      let { clientInfo, environmentInfo, ...comparison } = options;
      let errors = PercyConfig.validate(comparison, '/comparison');

      if (errors) {
        this.log.warn('Invalid upload options:');
        for (let e of errors) this.log.warn(`- ${e.path}: ${e.message}`);
      }
    }

    // add client & environment info
    this.client.addClientInfo(options.clientInfo);
    this.client.addEnvironmentInfo(options.environmentInfo);

    // return an async generator to allow cancelation
    return (async function*() {
      try {
        return yield* yieldTo(this.#snapshots.push(options));
      } catch (error) {
        this.#snapshots.cancel(options);
        throw error;
      }
    }.call(this));
  }
}

export default Percy;
