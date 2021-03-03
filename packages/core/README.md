# @percy/core

The core component of Percy's CLI and SDKs that handles creating builds, discovering snapshot
assets, uploading snapshots, and finalizing builds. Uses `@percy/client` for API communication, a
Puppeteer browser for asset discovery, and starts a local API server for posting snapshots from
other processes.

- [Usage](#usage)
  - [`#start()`](#start)
  - [`#stop()`](#stop)
  - [`#snapshot()`](#snapshotoptions)
  - [`#capture()`](#captureoptions)
- [Advanced](#advanced)
  - [Download discovery browser on install](#download-discovery-browser-on-install)

## Usage

A `Percy` class instance can manage a Percy build, take page snapshots, and perform snapshot asset
discovery. It also hosts a local API server for Percy SDKs to communicate with.

``` js
import Percy from '@percy/core'

// create a new instance
const percy = new Percy(percyOptions)

// create a new instance and start it
const percy = await Percy.start(percyOptions)
```

#### Options

- `token` — Your project's `PERCY_TOKEN` (**default** `process.env.PERCY_TOKEN`)
- `loglevel` — Logger level, one of `"info"`, `"warn"`, `"error"`, `"debug"` (**default** `"info"`)
- `server` — Controls whether an API server is created (**default** `true`)
- `port` — API server port (**default** `5338`)
- `clientInfo` — Client info sent to Percy via a user-agent string
- `environmentInfo` — Environment info also sent with the user-agent string
- `concurrency` — Page [`#capture()`](#captureoptions) concurrency (**default** `5`)

The following options can also be defined within a Percy config file

- `snapshot` — Snapshot options applied to each snapshot
  - `widths` — Widths to take screenshots at (**default** `[375, 1280]`)
  - `minHeight` — Minimum screenshot height (**default** `1024`)
  - `percyCSS` — Percy specific CSS to inject into the snapshot
  - `enableJavaScript` — Enable JavaScript for screenshots (**default** `false`)
  - `requestHeaders` — Request headers used when discovering snapshot assets
  - `authorization` — Basic auth `username` and `password` for protected snapshot assets
- `discovery` — Asset discovery options
  - `allowedHostnames` — Array of allowed hostnames to capture assets from
  - `networkIdleTimeout` — Milliseconds to wait for the network to idle (**default** `100`)
  - `disableCache` — Disable asset caching (**default** `false`)
  - `concurrency` — Asset discovery concerrency (**default** `5`)
  - `launchOptions` — Asset discovery browser launch options
    - `executable` — Browser executable path (**default** `process.env.PERCY_BROWSER_EXECUTABLE`)
    - `timeout` — Discovery launch timeout, in milliseconds (**default** `30000`)
    - `args` — Additional browser process arguments
    - `headless` — Runs the browser headlessy (**default** `true`)
    
Additional Percy config file options are also allowed and will override any options defined by a
local config file. These config file options are also made available to SDKs via the local API
health check endpoint.

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

### `#snapshot(options)`

Performs asset discovery for the provided DOM snapshot. This is the primary method used by Percy
SDKs to upload snapshots to the associated Percy build.

``` js
// snapshots can be handled concurrently, no need to await
percy.snapshot({
  name: 'My Snapshot',
  url: 'http://localhost:3000',
  domSnapshot: domSnapshot,
  clientInfo: 'my-sdk',
  environmentInfo: 'my-lib'
  ...snapshotOptions
})
```

#### Options

- `name` — Snapshot name (**required**)
- `url` — Snapshot URL (**required**)
- `domSnapshot` — Snapshot DOM string (**required**)
- `clientInfo` — Additional client info
- `environmentInfo` — Additional environment info

Common snapshot options are also accepted and will override instance snapshot options. [See intance
options](#options)

### `#capture(options)`

Navigates to a URL and captures one or more snapshots of a page. Before the snapshot is captured,
the page can be waited on and interacted with via various options. The resulting snapshot is then
uploaded using the [`#snapshot()`](#snapshotoptions) method.

``` js
// pages can be captured concurrently, no need to await
percy.capture({
  name: 'My Snapshot',
  url: 'http://localhost:3000/',
  waitForTimeout: 1000,
  waitForSelector: '.done-loading',
  execute: async () => {},
  snapshots: [{
    name: 'Second Snapshot',
    execute: async () => {},
    ...snapshotOptions
  }],
  ...snapshotOptions
})
```

#### Options

- `name` — Snapshot name (**required** for single snapshots)
- `url` — Snapshot URL (**required**)
- `waitForTimeout` — Milliseconds to wait before snapshotting
- `waitForSelector` — CSS selector to wait for before snapshotting
- `execute` — Function or function body to execute within the page
- `clientInfo` — Additional client info
- `environmentInfo` — Additional environment info
- `snapshots` — Array of additional sequential snapshots to take
  - `name` — Snapshot name (**required**)
  - `execute` — Function or function body to execute

Common snapshot options are also accepted and will override instance snapshot options. [See intance
options](#options)

## Advanced

### Download discovery browser on install

By default, the browser is only downloaded when asset discovery is started for the first time. This
is because many features of the CLI do not require a browser at all, and automatically downloading a
browser creates a much heavier footprint than needed for those features. However, if your CI caches
dependencies after the install step, the browser will not be cached and will be downloaded every
time Percy runs without it.

If the environment variable `PERCY_POSTINSTALL_BROWSER` is present and truthy, then the browser will
be downloaded after the package is installed to allow it to be cached. You can also require
`@percy/core/post-install` within another node module to trigger the browser download manually.

