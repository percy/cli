import PercyClient from '@percy/client';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';
import { getProxy } from '@percy/client/utils';
import Browser from './browser.js';
import Pako from 'pako';
import {
  base64encode,
  generatePromise,
  yieldAll,
  yieldTo,
  redactSecrets,
  detectSystemProxyAndLog
} from './utils.js';

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
import { WaitForJob } from './wait-for-job.js';

const MAX_SUGGESTION_CALLS = 10;

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
    labels,
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
    suggestionsCallCounter = 0,
    // options such as `snapshot` and `discovery` that are valid Percy config
    // options which will become accessible via the `.config` property
    ...options
  } = {}) {
    let config = PercyConfig.load({
      overrides: options,
      path: configFile
    });

    labels ??= config.percy?.labels;
    deferUploads ??= config.percy?.deferUploads;
    this.config = config;
    this.cliStartTime = null;

    if (testing) loglevel = 'silent';
    if (loglevel) this.loglevel(loglevel);

    this.port = port;
    this.projectType = projectType;
    this.testing = testing ? {} : null;
    this.dryRun = !!testing || !!dryRun;
    this.skipUploads = this.dryRun || !!skipUploads;
    this.skipDiscovery = this.dryRun || !!skipDiscovery;
    this.delayUploads = this.skipUploads || !!delayUploads;
    this.deferUploads = this.skipUploads || !!deferUploads;
    this.labels = labels;
    this.suggestionsCallCounter = suggestionsCallCounter;

    this.client = new PercyClient({ token, clientInfo, environmentInfo, config, labels });
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

    if (errors?.length > 0) {
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
    this.cliStartTime = new Date().toISOString();

    try {
      if (process.env.PERCY_CLIENT_ERROR_LOGS !== 'false') {
        this.log.warn('Notice: Percy collects CI logs to improve service and enhance your experience. These logs help us debug issues and provide insights on your dashboards, making it easier to optimize the product experience. Logs are stored securely for 30 days. You can opt out anytime with export PERCY_CLIENT_ERROR_LOGS=false, but keeping this enabled helps us offer the best support and features.');
      }
      // Not awaiting proxy check as this can be asyncronous when not enabled
      const detectProxy = detectSystemProxyAndLog(this.config.percy.useSystemProxy);
      if (this.config.percy.useSystemProxy) await detectProxy;
      // start the snapshots queue immediately when not delayed or deferred
      if (!this.delayUploads && !this.deferUploads) yield this.#snapshots.start();
      // do not start the discovery queue when not needed
      if (!this.skipDiscovery) yield this.#discovery.start();
      // start a local API server for SDK communication
      if (this.server) yield this.server.listen();
      if (this.projectType === 'web') {
        if (!process.env.PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS || process.env.PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS !== 'true') {
          this.deviceDetails = yield this.client.getDeviceDetails(this.build?.id);
        }
      }
      const snapshotType = this.projectType === 'web' ? 'snapshot' : 'comparison';
      this.syncQueue = new WaitForJob(snapshotType, this);
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
        let errMsg = `Percy is already running or the port ${this.port} is in use`;
        await this.suggestionsForFix(errMsg);
        throw new Error(errMsg);
      } else {
        await this.suggestionsForFix(error.message);
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
    try {
      if (!this.readyState && this.browser.isConnected()) {
        await this.browser.close();
      }

      if (this.syncQueue) this.syncQueue.stop();
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
    } catch (err) {
      this.log.error(err);
      throw err;
    } finally {
      // This issue doesn't comes under regular error logs,
      // it's detected if we just and stop percy server
      await this.checkForNoSnapshotCommandError();
      await this.sendBuildLogs();
    }
  }

  // Takes one or more snapshots of a page while discovering resources to upload with the resulting
  // snapshots. Once asset discovery has completed for the provided snapshots, the queued task will
  // resolve and an upload task will be queued separately.
  snapshot(options, snapshotPromise = {}) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    } else if (this.build?.error) {
      throw new Error(this.build.error);
    } else if (Array.isArray(options)) {
      return yieldAll(options.map(o => this.yield.snapshot(o, snapshotPromise)));
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
          // attaching promise resolve reject so to wait for snapshot to complete
          if (this.syncMode(snapshot)) {
            snapshotPromise[snapshot.name] = new Promise((resolve, reject) => {
              Object.assign(snapshot, { resolve, reject });
            });
          }
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
  upload(options, callback = null, screenshotFlow = null) {
    if (this.readyState !== 1) {
      throw new Error('Not running');
    } else if (Array.isArray(options)) {
      return yieldAll(options.map(o => this.yield.upload(o)));
    }
    // validate comparison uploads and warn about any errors

    // we are having two similar attrs in options: tags & tag
    // tags: is used as labels and is string comma-separated like "tag1,tag"
    // tag: is comparison-tag used by app-percy & poa and this is used to create a comparison-tag in BE
    // its format is object like {name: "", os:"", os_version:"", device:""}
    // DO NOT GET CONFUSED!!! :)
    if ('tag' in options || 'tiles' in options) {
      // throw when missing required snapshot or tag name
      if (!options.name) throw new Error('Missing required snapshot name');
      if (!options.tag?.name) throw new Error('Missing required tag name for comparison');

      // normalize, migrate, and remove certain properties from validating
      options = PercyConfig.migrate(options, '/comparison');
      let { clientInfo, environmentInfo, labels, ...comparison } = options;
      let errors = PercyConfig.validate(comparison, '/comparison');

      if (errors?.length > 0) {
        this.log.warn('Invalid upload options:');
        for (let e of errors) this.log.warn(`- ${e.path}: ${e.message}`);
      }
    }

    // set meta for logging
    options.meta = {
      snapshot: {
        name: options.name,
        testCase: options.testCase,
        tag: options.tag?.name
      }
    };

    // add client & environment info
    this.client.addClientInfo(options.clientInfo);
    this.client.addEnvironmentInfo(options.environmentInfo);
    this.client.screenshotFlow = screenshotFlow;

    // Sync CLI support, attached resolve, reject promise
    if (this.syncMode(options)) {
      Object.assign(options, { ...callback });
    }

    // return an async generator to allow cancelation
    return (async function*() {
      try {
        return yield* yieldTo(this.#snapshots.push(options));
      } catch (error) {
        this.#snapshots.cancel(options);
        // Detecting and suggesting fix for errors;
        await this.suggestionsForFix(error.message);
        throw error;
      }
    }.call(this));
  }

  shouldSkipAssetDiscovery(tokenType) {
    if (this.testing && JSON.stringify(this.testing) === JSON.stringify({})) { return true; }
    return tokenType !== 'web';
  }

  syncMode(options) {
    let syncMode = false;
    if (this.config?.snapshot?.sync) syncMode = true;
    if (options?.sync) syncMode = true;
    if (options?.sync === false) syncMode = false;

    if ((this.skipUploads || this.deferUploads || this.delayUploads) && syncMode) {
      syncMode = false;
      options.sync = false;
      if (this.delayUploads && !this.skipUploads) {
        this.log.warn('Synchronous CLI functionality is not compatible with the snapshot command. Kindly consider taking screenshots via SDKs to achieve synchronous results instead.');
      } else {
        let type = 'deferUploads option';
        if (this.skipDiscovery && this.deferUploads) type = 'upload command';
        if (this.skipUploads) type = 'skipUploads option';
        this.log.warn(`The Synchronous CLI functionality is not compatible with ${type}.`);
      }
    }
    if (syncMode) options.sync = syncMode;
    return syncMode;
  }

  // This specific error will be hard coded
  async checkForNoSnapshotCommandError() {
    let isPercyStarted = false;
    let containsSnapshotTaken = false;
    logger.query((item) => {
      isPercyStarted ||= item?.message?.includes('Percy has started');
      containsSnapshotTaken ||= item?.message?.includes('Snapshot taken');

      // This case happens when you directly upload it using cli-upload
      containsSnapshotTaken ||= item?.message?.includes('Snapshot uploaded');
      return item;
    });

    if (isPercyStarted && !containsSnapshotTaken) {
      // This is the case for No snapshot command called
      this.#displaySuggestionLogs([{
        failure_reason: 'Snapshot command was not called',
        reason_message: 'Snapshot Command was not called. please check your CI for errors',
        suggestion: 'Try using percy snapshot command to take snapshots',
        reference_doc_link: ['https://www.browserstack.com/docs/percy/take-percy-snapshots/']
      }]);
    }
  }

  #displaySuggestionLogs(suggestions, options = {}) {
    if (!suggestions?.length) return;

    suggestions.forEach(item => {
      const failure = item?.failure_reason;
      const failureReason = item?.reason_message;
      const suggestion = item?.suggestion;
      const referenceDocLinks = item?.reference_doc_link;

      if (options?.snapshotLevel) {
        this.log.warn(`Detected error for Snapshot: ${options?.snapshotName}`);
      } else {
        this.log.warn('Detected error for percy build');
      }

      this.log.warn(`Failure: ${failure}`);
      this.log.warn(`Failure Reason: ${failureReason}`);
      this.log.warn(`Suggestion: ${suggestion}`);

      if (referenceDocLinks?.length > 0) {
        this.log.warn('Refer to the below Doc Links for the same');

        referenceDocLinks?.forEach(_docLink => {
          this.log.warn(`* ${_docLink}`);
        });
      }
    });
  }

  #proxyEnabled() {
    return !!(getProxy({ protocol: 'https:' }) || getProxy({}));
  }

  async suggestionsForFix(errors, options = {}) {
    try {
      this.suggestionsCallCounter++;
      if (this.suggestionsCallCounter > MAX_SUGGESTION_CALLS) {
        if (this.suggestionsCallCounter === MAX_SUGGESTION_CALLS + 1) {
          this.log.debug('Rate limit exceeded for Maximum allowed suggestions per build.');
        }
        return;
      }
      const suggestionResponse = await this.client.getErrorAnalysis(errors);
      this.#displaySuggestionLogs(suggestionResponse, options);
    } catch (e) {
      // Common error code for Proxy issues
      const PROXY_CODES = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'];
      if (!!e.code && PROXY_CODES.includes(e.code)) {
        // This can be due to proxy issue
        this.log.error('percy.io might not be reachable, check network connection, proxy and ensure that percy.io is whitelisted.');
        if (!this.#proxyEnabled()) {
          this.log.error('If inside a proxied envirnment, please configure the following environment variables: HTTP_PROXY, [ and optionally HTTPS_PROXY if you need it ]. Refer to our documentation for more details');
        }
      }
      this.log.error('Unable to analyze error logs');
      this.log.debug(e);
    }
  }

  async sendBuildLogs() {
    if (!process.env.PERCY_TOKEN) return;
    try {
      const logsObject = {
        clilogs: logger.query(log => !['ci'].includes(log.debug))
      };

      // Only add CI logs if not disabled voluntarily.
      const sendCILogs = process.env.PERCY_CLIENT_ERROR_LOGS !== 'false';
      if (sendCILogs) {
        const redactedContent = redactSecrets(logger.query(log => ['ci'].includes(log.debug)));
        logsObject.cilogs = redactedContent;
      }
      const content = base64encode(Pako.gzip(JSON.stringify(logsObject)));
      const referenceId = this.build?.id ? `build_${this.build?.id}` : this.build?.id;
      const eventObject = {
        content: content,
        build_id: this.build?.id,
        reference_id: referenceId,
        service_name: 'cli',
        base64encoded: true
      };
      // Ignore this will update once I implement logs controller.
      const logsSHA = await this.client.sendBuildLogs(eventObject);
      this.log.info(`Build's CLI${sendCILogs ? ' and CI' : ''} logs sent successfully. Please share this log ID with Percy team in case of any issues - ${logsSHA}`);
    } catch (err) {
      this.log.warn('Could not send the builds logs');
    }
  }
}

export default Percy;
