# @percy/logger

Common [winston](https://github.com/winstonjs/winston) logger used throughout the Percy CLI.

## Usage

``` js
import log from '@percy/logger'

log.info('info message')
log.error('error message')
log.warn('warning message')
log.debug('debug message')
```

### `#loglevel([level][, flags])`

Sets or retrieves the log level of the console transport. If the second argument is provided,
`level` is treated as a fallback when all logging flags are `false`. When no arguments are provided,
the method will return the current log level of the console transport.

``` js
log.loglevel('info', { verbose: true })
log.loglevel() === 'debug'

log.loglevel('info', { quiet: true })
log.loglevel() === 'warn'

log.loglevel('info', { silent: true })
log.loglevel() === 'silent'

log.loglevel('info')
log.loglevel() === 'info'
```

### `#error(errorOrMessage)`

Patched `#error()` method that handles `Error` instance's and similar error objects. When
`#loglevel()` is equal to `debug`, the `Error` instance's stack trace is logged.

``` js
log.loglevel('debug')
log.error(new Error('example'))
// [percy] Error: example
//   at example:2:10
//   ...
```
