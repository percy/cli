# @percy/core

The core component of Percy's CLI and SDKs that handles creating builds, discovering snapshot
assets, uploading snapshots, and finalizing builds. Uses `@percy/client` for API communication, a
Puppeteer browser for asset discovery, and starts a local API server for posting snapshots from
other processes.

## Usage

The `Percy` class will manage a Percy build and perform asset discovery on snapshots before
uploading them to Percy. It also hosts a local API server for Percy SDKs to communicate with.

``` js
import Percy from '@percy/core'

const percy = new Percy({
  token: PERCY_TOKEN,        // defaults to PERCY_TOKEN environment variable
  loglevel: 'info',          // what level logs to write to console
  server: true,              // start a local API server
  port: 5338,                // port to start the API server at
  concurrency: 5,            // concurrency of the #capture() method
  snapshot: {},              // global snapshot options (see snapshots section)
  discovery: {               // asset discovery options
    allowedHostnames: [],      // list of hostnames allowed to capture from
    networkIdleTimeout: 100,   // how long before network is considered idle
    disableCache: false,  // disable discovered asset caching
    concurrency: 5,            // asset discovery concurrency
    launchOptions: {}          // browser launch options
  },
  ...config                  // additional config options accessible by SDKs
})
```

### `#start()`

Starting a `Percy` instance will start a local API server, start the asset discovery browser, and
create a new Percy build. If an asset discovery browser is not found, one will be downloaded.

``` js
await percy.start()
// [percy] Percy has started!
// [percy] Created build #1: https://percy.io/org/project/123
```

#### API Server

Starting a `Percy` instance will start a local API server unless `server` is `false`. The server can
be found at `http://localhost:5338/` or at the provided `port` number.

- GET `/percy/healthcheck` – Responds with information about the running instance
- GET `/percy/dom.js` – Responds with the [`@percy/dom`](./packages/dom) library
- POST `/percy/snapshot` – Calls [`#snapshot()`](#snapshotoptions) with provided snapshot options
- POST `/percy/stop` - Remotely [stops](#stop) the running `Percy` instance

### `#snapshot(options)`

Performs asset discovery for the provided DOM snapshot at widths specified here or in the instance's
provided `snapshot` option. This is the primary method used by Percy SDKs to upload snapshots.

``` js
// snapshots can be handled concurrently, no need to await
percy.snapshot({
  name: 'My Snapshot',           // required name
  url: 'http://localhost:3000',  // required url
  domSnapshot: domSnapshot,      // required DOM string
  widths: [500, 1280],           // widths to discover resources
  minHeight: 1024,               // minimum height used when screenshotting
  percyCSS: '',                  // percy specific css to inject
  requestHeaders: {},            // asset request headers such as authorization
  authorization: {},             // asset authorization credentials
  clientInfo: '',                // user-agent client info for the SDK
  environmentInfo: ''            // user-agent environment info for the SDK
})
```

### `#capture(options)`

Navigates to a URL and captures a snapshot or multiple snapshots of a page after optionally
interacting with the page. Any [`#snapshot()`](#snapshotoptions) options can also be provided, with
the exception of `domSnapshot`.

``` js
// pages can be captured concurrently, no need to await
percy.capture({
  name: 'My Snapshot',            // snapshot name
  url: 'http://localhost:3000/',  // required page URL
  waitForTimeout: 1000,           // timeout to wait before snapshotting
  waitForSelector: '.selector',   // selector to wait for before snapshotting
  execute: async () => {},        // function to execute within the page context
  snapshots: [{                   // additional snapshots to take on this page
    name: 'Second Snapshot',        // additional snapshot name
    execute: async () => {},        // additional snapshot execute function
    ...options                      // ...additional snapshot options
  }],
  ...options                      // ...other snapshot options
})
```

### `#stop()`

Stopping a `Percy` instance will wait for any pending snapshots, close the asset discovery browser,
close the local API server, and finalize the current Percy build.

``` js
await percy.stop()
// [percy] Stopping percy...
// [percy] Waiting for 1 snapshot(s) to complete
// [percy] Snapshot taken: My Snapshot
// [percy] Finalized build #1: https://percy.io/org/project/123
// [percy] Done
```

## Advanced

### Chromium Executable Path

**Use with caution as asset discovery may not work with some versions of Chromium.** To avoid
downloading the browser used for asset discovery, the local browser executable can be defined with
an `executable` option provided within `discovery.launchOptions`. This option should be a path to
Chromium's binary executable and falls back to downloading a compatible browser when not found.

