# @percy/sdk-utils

Common Node SDK utils

## Usage

### `log(level, message)`

Logs colored output and stack traces based on the loglevel defined by the `PERCY_LOGLEVEL`
environment variable.

``` js
const { log } = require('@percy/sdk-utils');

// logs unless loglevel is quiet or silent
log('info', 'foobar');
// [percy] foobar

// logs a red error message unless the loglevel is silent
log('error', 'bad');
// [percy] bad

// logs the stack trace when loglevel is debug
log('error', new Error('some error'));
// [percy] Error: some error
//     at example (/path/to/example.js:2:10)
//     at ...

// only logs when the loglevel is debug
log('debug', 'debug message');
// [percy] debug message
```

### `getInfo()`

Returns information about any running Percy CLI server. Some information is only available after
[`isPercyEnabled`](#isPercyEnabled) has been called.

``` js
const { getInfo } = require('@percy/sdk-utils');

let info = getInfo();

// CLI API address
info.cliApi === (process.env.PERCY_CLI_API || 'http://localhost:5338')

// CLI loglevel
info.loglevel === (process.env.PERCY_LOGLEVEL || 'info')

// CLI version parts (requires isPercyEnabled call)
info.version === (['1', '0', '0'] || undefined)

// CLI config options (requires isPercyEnabled call)
info.config === {}
```

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
