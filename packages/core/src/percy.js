import PercyClient from '@percy/client';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';
import { schema } from './config';
import Queue from './queue';
import Discoverer from './discovery/discoverer';
import createPercyServer from './server';

import assert from './utils/assert';
import { navigatePage, preparePage } from './utils/capture';
import injectPercyCSS from './utils/percy-css';
import { createRootResource, createLogResource } from './utils/resources';
import { normalizeURL } from './utils/url';

// Register core config options
PercyConfig.addSchema(schema);

// A Percy instance will create a new build when started, handle snapshot
// creation, asset discovery, and resource uploads, and will finalize the build
// when stopped. Snapshots are processed concurrently and the build is not
// finalized until all snapshots have been handled.
export default class Percy {
  log = logger('core');

  #captures = null;
  #snapshots = null;
  #stopping = false;
  #running = false;

  // Static shortcut to create and start an instance in one call
  static async start(options) {
    let instance = new this(options);
    await instance.start();
    return instance;
  }

  constructor({
    // provided to @percy/client
    token,
    clientInfo = '',
    environmentInfo = '',
    // snapshot server options
    server = true,
    port = 5338,
    // capture concurrency
    concurrency = 5,
    // initial log level
    loglevel,
    // configuration filepath
    config,
    // options such as `snapshot` and `discovery` that are valid Percy config
    // options which will become accessible via the `#config` property
    ...options
  } = {}) {
    if (loglevel) {
      this.loglevel(loglevel);
    }

    if (server) {
      this.port = port;
      this.server = createPercyServer(this);
    }

    this.#snapshots = new Queue();
    this.#captures = new Queue(concurrency);

    this.config = config === false
      ? PercyConfig.getDefaults(options)
      : PercyConfig.load({ path: config, overrides: options });

    this.discoverer = new Discoverer(this.config.discovery);
    this.client = new PercyClient({ token, clientInfo, environmentInfo });
  }

  // Shortcut for controlling the global logger's log level.
  loglevel(level) {
    return logger.loglevel(level);
  }

  // Snapshot server API address
  apiAddress() {
    return `http://localhost:${this.port}`;
  }

  // Returns a boolean indicating if this instance is running.
  isRunning() {
    return this.#running;
  }

  // Starts the local API server, the asset discovery process, and creates a new
  // Percy build. When an error is encountered, the discoverer and server are closed.
  async start() {
    // throws when the token is missing
    this.client.getToken();

    try {
      // launch the discoverer browser and create a percy build
      await this.discoverer.launch();
      await this.client.createBuild();

      // if there is a server, start listening
      await this.server?.listen(this.port);

      // log build details
      let build = this.client.build;
      let meta = { build: { id: build.id } };
      this.log.info('Percy has started!', meta);
      this.log.info(`Created build #${build.number}: ${build.url}`, meta);

      // mark this process as running
      this.#running = true;
    } catch (error) {
      // on error, close any running server or browser
      await this.server?.close();
      await this.discoverer.close();

      // throw an easier-to understand error when the port is taken
      if (error.code === 'EADDRINUSE') {
        throw new Error('Percy is already running or the port is in use');
      } else {
        throw error;
      }
    }
  }

  // Stops the local API server and discoverer once snapshots have completed and
  // finalizes the Percy build. Does nothing if not running.
  async stop() {
    // do nothing if not running or already stopping
    if (this.isRunning() && !this.#stopping) {
      this.#stopping = true;

      let build = this.client.build;
      let meta = { build: { id: build.id } };
      this.log.info('Stopping percy...', meta);

      // log about queued captures or uploads
      if (this.#captures.length) {
        this.log.info(`Waiting for ${this.#captures.length} page(s) to finish snapshotting`, meta);
      } else if (this.#snapshots.length) {
        this.log.info(`Waiting for ${this.#snapshots.length} snapshot(s) to finish uploading`, meta);
      }

      // wait for any queued captures or snapshots
      await this.idle();
      this.#running = false;

      // close the discoverer and server
      await this.discoverer.close();
      await this.server?.close();

      // finalize the build
      await this.client.finalizeBuild();
      this.log.info(`Finalized build #${build.number}: ${build.url}`, meta);
      this.log.info('Done!');
    }
  }

  // Resolves when captures and snapshots are idle.
  async idle() {
    await Promise.all([
      this.#captures.idle(),
      this.#snapshots.idle()
    ]);
  }

  // Handles asset discovery for the URL and DOM snapshot at each requested
  // width with the provided options. Resolves when the snapshot has been taken
  // and asset discovery is finished, but does not gaurantee that the snapshot
  // will be succesfully uploaded.
  snapshot({
    url,
    name,
    domSnapshot,
    widths,
    minHeight,
    percyCSS,
    requestHeaders,
    authorization,
    enableJavaScript,
    clientInfo,
    environmentInfo
  }) {
    // required assertions
    assert(this.isRunning(), 'Not running');
    assert(url, 'Missing required argument: url');
    assert(name, 'Missing required argument: name');
    assert(domSnapshot, 'Missing required argument: domSnapshot');

    // fallback to instance snapshot widths
    widths = widths?.length ? widths : this.config.snapshot.widths;
    assert(widths?.length, 'Missing required argument: widths');
    assert(widths.length <= 10, 'too many widths');

    // normalize the URL
    url = normalizeURL(url);
    // fallback to instance minimum height
    minHeight = minHeight ?? this.config.snapshot.minHeight;
    // combine snapshot Percy CSS with instance Percy CSS
    percyCSS = [this.config.snapshot.percyCSS, percyCSS].filter(Boolean).join('\n');
    // combine snapshot request headers with instance request headers
    requestHeaders = { ...this.config.snapshot.requestHeaders, ...requestHeaders };
    // fallback to instance enable JS flag
    enableJavaScript = enableJavaScript ?? this.config.snapshot.enableJavaScript ?? false;

    // useful meta info for the logfile
    let meta = {
      snapshot: { name },
      build: { id: this.client.build.id }
    };

    this.log.debug('---------');
    this.log.debug('Handling snapshot:', meta);
    this.log.debug(`-> name: ${name}`, meta);
    this.log.debug(`-> url: ${url}`, meta);
    this.log.debug(`-> widths: ${widths.join('px, ')}px`, meta);
    this.log.debug(`-> clientInfo: ${clientInfo}`, meta);
    this.log.debug(`-> environmentInfo: ${environmentInfo}`, meta);
    this.log.debug(`-> requestHeaders: ${JSON.stringify(requestHeaders)}`, meta);
    this.log.debug(`-> authorization: ${JSON.stringify(authorization)}`, meta);
    this.log.debug(`-> domSnapshot:\n${(
      domSnapshot.length <= 1024 ? domSnapshot
        : (domSnapshot.substr(0, 1024) + '... [truncated]')
    )}`, meta);

    // use a promise as a try-catch so we can do the remaining work
    // asynchronously, but perform the above synchronously
    return Promise.resolve().then(async () => {
      // inject Percy CSS
      let [percyDOM, percyCSSResource] = injectPercyCSS(url, domSnapshot, percyCSS, meta);
      // use a map so resources remain unique by url
      let resources = new Map([[url, createRootResource(url, percyDOM)]]);
      // include the Percy CSS resource if there was one
      if (percyCSSResource) resources.set('percy-css', percyCSSResource);

      // gather resources at each width concurrently
      await Promise.all(widths.map(width => (
        this.discoverer.gatherResources({
          onDiscovery: r => resources.set(r.url, r),
          rootUrl: url,
          rootDom: domSnapshot,
          enableJavaScript,
          requestHeaders,
          authorization,
          width,
          meta
        })
      )));

      // include a log resource for debugging
      let logs = logger.query(({ meta }) => meta.snapshot?.name === name);
      resources.set('percy-logs', createLogResource(logs));

      // log that the snapshot has been taken before uploading it
      this.log.info(`Snapshot taken: ${name}`, meta);

      // upload within the async snapshot queue
      this.#snapshots.push(() => this.client.sendSnapshot({
        name,
        widths,
        minHeight,
        enableJavaScript,
        clientInfo,
        environmentInfo,
        resources: Array.from(resources.values())
      }).catch(error => {
        this.log.error(`Encountered an error uploading snapshot: ${name}`, meta);
        this.log.error(error);
      }));
    }).catch(error => {
      this.log.error(`Encountered an error taking snapshot: ${name}`, meta);
      this.log.error(error);
    });
  }

  capture({
    url,
    name,
    waitForTimeout,
    waitForSelector,
    execute,
    snapshots = [],
    ...options
  }) {
    assert(this.isRunning(), 'Not running');

    assert(url, `Missing URL for${name ? ` ${name}` : ' snapshots'}`);
    snapshots = name ? [{ name, execute }].concat(snapshots) : snapshots;
    assert(snapshots.length && snapshots.every(s => s.name), `Missing name for ${url}`);

    // the entire capture process happens within the async capture queue
    return this.#captures.push(async () => {
      let { requestHeaders, authorization } = options;
      let results = [];
      let page;

      try {
        // borrow a page from the discoverer
        page = await this.discoverer.page({ requestHeaders, authorization });

        // navigate to the page and wait until ready
        await navigatePage(page, url, { waitForTimeout, waitForSelector });

        // multiple snapshots can be captured on a single page
        for (let { name, execute } of snapshots) {
          // prepare page for snapshotting
          await preparePage(page, execute);

          // serialize and capture a DOM snapshot
          /* istanbul ignore next: no instrumenting injected code */
          let { url, domSnapshot } = await page.eval(({ enableJavaScript }) => ({
            /* eslint-disable-next-line no-undef */
            domSnapshot: PercyDOM.serialize({ enableJavaScript }),
            url: document.URL
          }), options);

          // snapshots are awaited on concurrently after sequentially capturing their DOM
          results.push(this.snapshot({ ...options, url, name, domSnapshot }));
        }
      } catch (error) {
        // handle errors
        this.log.error(`Encountered an error for page: ${url}`);
        this.log.error(error);
      } finally {
        // close the page
        await page?.close();
        // await on any resulting snapshots
        await Promise.all(results);
      }
    });
  }
}
