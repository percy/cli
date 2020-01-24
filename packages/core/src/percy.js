import PercyClient from '@percy/client';
import log from '@percy/logger';
import Queue from './queue';
import Discoverer from './discoverer';
import { createServerApp, startServer } from './server';
import injectPercyCSS from './percy-css';
import assert from './utils/assert';
import { createRootResource } from './utils/resources';
import { normalizeURL } from './utils/url';
import pkg from '../package.json';

// A Percy instance will create a new build when started, handle snapshot
// creation, asset discovery, and resource uploads, and will finalize the build
// when stopped. Snapshots are processed concurrently and the build is not
// finalized until all snapshots have been handled.
export default class Percy {
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
    // additional options such as `loglevel`, `snapshot`, and `discovery`
    // options which are all accessible via the `config` property
    ...config
  } = {}) {
    if (loglevel) {
      this.loglevel(loglevel);
    }

    if (server) {
      this.port = port;
      this.app = createServerApp(this);
    }

    this.#snapshots = new Queue();
    this.#captures = new Queue(concurrency);

    this.config = { loglevel: this.loglevel(), ...config };
    this.discoverer = new Discoverer(config.discovery);
    this.client = new PercyClient({
      clientInfo: [`${pkg.name}/${pkg.version}`].concat(clientInfo),
      environmentInfo,
      token
    });
  }

  // Shortcut for controlling the global logger's log level.
  loglevel(level) {
    return log.loglevel(level);
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
      // if there is an exress app, a server should be started
      if (this.app) {
        this.server = await startServer(this.app, this.port);
      }

      // launch the discoverer browser and create a percy build
      await this.discoverer.launch();
      await this.client.createBuild();

      // log build details
      let build = this.client.build;
      log.info('Percy has started!');
      log.info(`Created build #${build.number}: ${build.url}`);

      // mark this process as running
      this.#running = true;
    } catch (error) {
      // on error, close any running browser or server
      await this.discoverer.close();
      this.server?.close();

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
      log.info('Stopping percy...');

      // clear queued page captures and wait for any pending
      if (this.#captures.clear()) {
        log.info(`Waiting for ${this.#captures.length} page(s) to complete`);
        await this.#captures.idle();
      }

      // clear queued snapshots and wait for any pending
      if (this.#snapshots.clear()) {
        log.info(`Waiting for ${this.#snapshots.length} snapshot(s) to complete`);
        await this.#snapshots.idle();
      }

      // close the server and browser
      this.server?.close();
      await this.discoverer.close();
      this.#running = false;

      // log build info
      let build = this.client.build;
      await this.client.finalizeBuild();
      log.info(`Finalized build #${build.number}: ${build.url}`);

      log.info('Done!');
    }
  }

  // Handles asset discovery for the URL and DOM snapshot at each requested
  // width with the provided options. Resolves when the snapshot is complete,
  // although shouldn't be awaited on as snapshots are handled concurrently.
  snapshot({
    url,
    name,
    domSnapshot,
    widths,
    minimumHeight,
    percyCSS,
    requestHeaders,
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
    widths = widths ?? this.config.snapshot?.widths;
    assert(widths, 'Missing required argument: widths');
    assert(widths.length <= 10, 'too many widths');

    // normalize the URL
    url = normalizeURL(url);
    // fallback to instance minimum height
    minimumHeight = minimumHeight ?? this.config.snapshot?.minimumHeight;
    // combine snapshot Percy CSS with instance Percy CSS
    percyCSS = `${this.config.snapshot?.percyCSS ?? ''}\n${percyCSS ?? ''}`.trim();
    // combine snapshot request headers with instance request headers
    requestHeaders = { ...this.config.snapshot?.requestHeaders, ...requestHeaders };
    // fallback to instance enable JS flag
    enableJavaScript = enableJavaScript ?? this.config.snapshot?.enableJavaScript ?? false;

    // add this snapshot task to the snapshot queue
    return this.#snapshots.push(async () => {
      log.debug('---------');
      log.debug('Handling snapshot:');
      log.debug(`-> name: ${name}`);
      log.debug(`-> url: ${url}`);
      log.debug(`-> widths: ${widths.join('px, ')}px`);
      log.debug(`-> clientInfo: ${clientInfo}`);
      log.debug(`-> environmentInfo: ${environmentInfo}`);
      log.debug(`-> requestHeaders: ${JSON.stringify(requestHeaders)}`);
      log.debug(`-> domSnapshot:\n${(
        domSnapshot.length <= 1024 ? domSnapshot
          : (domSnapshot.substr(0, 1024) + '... [truncated]')
      )}`);

      try {
        // inject Percy CSS
        let [percyDOM, percyCSSResource] = injectPercyCSS(url, domSnapshot, percyCSS);
        // use a map so resources remain unique by url
        let resources = new Map([[url, createRootResource(url, percyDOM)]]);

        // gather resources at each width concurrently
        await Promise.all(widths.map(width => (
          this.discoverer.gatherResources(resources, {
            rootUrl: url,
            rootDom: domSnapshot,
            enableJavaScript,
            requestHeaders,
            width
          })
        )));

        // include the Percy CSS resource if there was one
        if (percyCSSResource) {
          resources.set(percyCSSResource.url, percyCSSResource);
        }

        // create, upload, and finalize the snapshot
        await this.client.sendSnapshot({
          name,
          widths,
          minimumHeight,
          enableJavaScript,
          clientInfo,
          environmentInfo,
          resources: Array.from(resources.values())
        });

        log.info(`Snapshot taken: ${name}`);
      } catch (error) {
        log.error(`Encountered an error for snapshot: ${name}`);
        log.error(error);
      }
    });
  }

  capture({
    url,
    name,
    waitFor,
    execute,
    snapshots = [],
    ...options
  }) {
    assert(this.isRunning(), 'Not running');

    assert(url, `Missing URL for${name ? ` ${name}` : ' snapshots'}`);
    snapshots = name ? [{ name, execute }].concat(snapshots) : snapshots;
    assert(snapshots.length && snapshots.every(s => s.name), `Missing name for ${url}`);

    return this.#captures.push(async () => {
      let results = [];
      let page;

      try {
        // borrow a page from the discoverer
        page = await this.discoverer.page();

        // allow @percy/dom injection
        await page.setBypassCSP(true);
        // set any request headers
        await page.setExtraHTTPHeaders(options.requestHeaders || {});
        // @todo - resize viewport
        // go to and wait for network idle
        await page.goto(url, { waitUntil: 'networkidle2' });
        // inject @percy/dom for serialization
        await page.addScriptTag({ path: require.resolve('@percy/dom') });
        // wait for any other elements or timeout before snapshotting
        if (waitFor) await page.waitFor(waitFor);

        // multiple snapshots can be captured on a single page
        for (let { name, execute } of snapshots) {
          // optionally execute a script to interact with the page
          if (execute) await execute(page);

          // serialize and capture a DOM snapshot
          /* istanbul ignore next: no instrumenting injected code */
          let domSnapshot = await page.evaluate(({ enableJavaScript }) => (
            /* eslint-disable-next-line no-undef */
            PercyDOM.serialize({ enableJavaScript })
          ), options);

          // snapshots are awaited on concurrently after sequentially capturing their DOM
          results.push(this.snapshot({ ...options, url, name, domSnapshot }));
        }
      } catch (error) {
        log.error(`Encountered an error for page: ${url}`);
        log.error(error);
      } finally {
        // awaiting on resulting snapshots syncs this task with those snapshot tasks
        await Promise.all(results);
        await page?.close();
      }
    });
  }
}
