# @percy/sdk-utils

Common Node SDK utils

- [Usage](#usage)
  - [`logger()`](#loggerdebug)
  - [`getInfo()`](#getinfo)
  - [`isPercyEnabled()`](#ispercyenabled)
  - [`postSnapshot()`](#postsnapshot)

## Usage

### `logger([debug])`

This function is a direct export of [`@percy/logger`](./packages/logger).

### `getInfo()`

Returns information about any running Percy CLI server. Some information is only available after
[`isPercyEnabled`](#ispercyenabled) has been called.

``` js
const { getInfo } = require('@percy/sdk-utils');

const { cliApi, loglevel, version, config } = getInfo();
```

#### Returned properties

- `cliApi` — CLI API address (`process.env.PERCY_SERVER_ADDRESS || 'http://localhost:5338'`)
- `loglevel` — CLI log level  (`process.env.PERCY_LOGLEVEL || 'info'`)

The following properties are only populated after [`isPercyEnabled`](#ispercyenabled) has been
called.

- `version` — CLI version parts (e.g. `['1', '0', '0']`)
- `config` — CLI config options

### `isPercyEnabled()`

Returns `true` or `false` if the Percy CLI API server is running. Calls the server's `/healthcheck`
endpoint and populates information for [`getInfo`](#getInfo). The result of this function is cached
and subsequent calls will return the first cached result. If the healthcheck fails, will log a
message unless the CLI loglevel is `quiet` or `silent`.

``` js
const { isPercyEnabled } = require('@percy/sdk-utils');

// CLI API not running
await isPercyEnabled() === false
// [percy] Percy is not running, disabling snapshots

// CLI API is running
await isPercyEnabled() === true
```

### `fetchPercyDOM()`

Fetches and returns the `@percy/dom` serialization script hosted by the CLI API server. The
resulting string can be evaulated within a browser context to add the `PercyDOM.serialize` function
to the global scope. Subsequent calls return the first cached result.

``` js
const { fetchPercyDOM } = require('@percy/sdk-utils');

let script = await fetchPercyDOM();

// selenium-webdriver
driver.executeScript(script);
// webdriverio
browser.execute(script);
// puppeteer
page.evaluate(script);
// protractor
browser.executeScript(script);
// etc...
```

### `postSnapshot(options)`

Posts snapshot options to the CLI API server.

``` js
const { postSnapshot } = require('@percy/sdk-utils');

await postSnapshot({
  // required
  name: 'Snapshot Name',
  url: 'http://localhost:8000/',
  domSnapshot: 'result from PercyDOM.serialize()'
  // optional
  environmentInfo: ['<lib>/<version>', '<lang>/<version>'],
  clientInfo: '<sdk>/<version>',
  widths: [475, 1280],
  minHeight: 1024,
  enableJavaScript: false,
  requestHeaders: {}
});
```
