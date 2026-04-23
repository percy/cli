# @percy/logger

Common logger used throughout the Percy CLI and SDKs.

- [Usage](#usage)
  - [`logger()`](#loggerdebug)
  - [`logger.loglevel()`](#loggerloglevel)
  - [`logger.format()`](#loggerformat)
  - [`logger.query()`](#loggerqueryfilter)
  - [`logger.reset()`](#loggerreset)
  - [`logger.toArray()`](#loggertoarray)
- [Storage model](#storage-model)
- [Environment variables](#environment-variables)

## Usage

``` js
import logger from '@percy/logger'

const log = logger('foobar')

log.info('info message')
log.error('error message')
log.warn('warning message')
log.debug('debug message')
log.deprecated('deprecation message')
```

### `logger([debug])`

Creates a group of logging functions that will be associated with the provided `debug` label. When
debug logging is enabled, this label is printed with the `[percy:*]` label and can be filtered via
the `PERCY_DEBUG` environment variable.

``` js
PERCY_DEBUG="one:*,*:a,-*:b"

logger.loglevel('debug')

logger('one').debug('test')
logger('one:a').debug('test')
logger('one:b').debug('test')
logger('one:c').debug('test')
logger('two').debug('test')
logger('two:a').debug('test')

// only logs from the matching debug string are printed
//=> [percy:one] test
//=> [percy:one:a] test
//=> [percy:one:c] test
//=> [percy:two:a] test
```

### `logger.loglevel([level][, flags])`

Sets or retrieves the log level of the shared logger. If the second argument is provided, `level` is
treated as a fallback when all logging flags are `false`. When no arguments are provided, the method
will return the current log level of the shared logger.

``` js
logger.loglevel('info', { verbose: true })
logger.loglevel() === 'debug'

logger.loglevel('info', { quiet: true })
logger.loglevel() === 'warn'

logger.loglevel('info', { silent: true })
logger.loglevel() === 'silent'

logger.loglevel('info')
logger.loglevel() === 'info'
```

### `logger.format(message, debug[, level])`

Returns a formatted `message` depending on the provided level and logger's own log level. When
debugging, the `debug` label is added to the prepended `[percy:*]` label.

``` js
logger.format('foobar', 'test')
//=> [percy] foobar

logger.loglevel('debug')
logger.format('foobar', 'test', 'warn')
//=> [percy:test] foobar (yellow for warnings)
```

### `logger.query(filter)`

Returns an array of recent in-memory logs matching the provided filter function. Searches the global
ring buffer and every live per-snapshot bucket. Log entries that have been evicted (after their
snapshot's upload completes) are **not** returned — use `logger.readBack()` via the internal
subexport if you need the full disk-backed enumeration.

``` js
let logs = logger.query(log => {
  return log.level === 'debug' &&
    log.message.match(/foobar/)
})
```

### `logger.reset()`

Asynchronously clears every in-memory entry, closes the disk writer, and removes the spill
directory. Used by test helpers and by the Percy test-mode `/test/api/reset` endpoint.

``` js
await logger.reset()
```

### `logger.toArray()`

Returns every currently-in-memory entry as a plain `Array`, equivalent to `logger.query(() => true)`.
Replaces the former `Array.from(logger.instance.messages)` pattern.

## Storage model

As of 1.31.12 (PER-7809), the logger maintains a bounded in-memory cache backed by an append-only
JSONL file on the OS tmp directory. The storage model is:

- Every log entry is **written to disk** (append-only JSONL). Disk is the source of truth for
  `sendBuildLogs` at end-of-build.
- An **in-memory global ring** holds the most recent non-snapshot-tagged entries for fast
  `query()` access by callers during a build.
- **Per-snapshot hot buckets** hold entries tagged with `meta.snapshot.{name, testCase}` while the
  snapshot is in flight. Buckets are evicted by `@percy/core` after the snapshot's upload POST
  completes, so memory usage is bounded by `concurrency × per-snapshot log volume` regardless of
  total build size or `deferUploads` window depth.
- Every entry's string values are **redacted at write-time** against the secret-patterns set
  (previously applied only at upload-time in `@percy/core/utils.redactSecrets`).
- On **disk unavailable / EACCES / ENOSPC**, the store transitions to an in-memory fallback mode
  that retains all entries until `sendBuildLogs` or process exit. Previously flushed disk entries
  are still read back.
- The spill directory is deleted on normal shutdown via `process.on('exit' | 'SIGINT' | 'SIGTERM')`
  handlers. Abandoned directories older than 24 h are swept at the next logger init.

## Environment variables

| Variable | Default | Behavior |
|---|---|---|
| `PERCY_LOG_RING_SIZE` | `2000` | Max entries in the in-memory global ring buffer. Overflowing entries are evicted from memory only; disk retains them. |
| `PERCY_LOGS_IN_MEMORY` | unset | If set to `1`, disables disk spill entirely. All entries remain in the ring / buckets for the process lifetime. Use as a rollback switch if a disk environment is misbehaving. |
| `PERCY_DEBUG` | unset | Namespace filter for debug-level logging (existing behavior). |
| `PERCY_LOGLEVEL` | `info` | Initial log level (existing behavior). |
