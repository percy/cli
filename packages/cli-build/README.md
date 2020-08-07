# @percy/cli-build

Commands for interacting with Percy builds

## Commands
<!-- commands -->
* [`percy build:finalize`](#percy-buildfinalize)
* [`percy build:wait`](#percy-buildwait)

## `percy build:finalize`

Finalize parallel Percy builds where PERCY_PARALLEL_TOTAL=-1

```
USAGE
  $ percy build:finalize

OPTIONS
  -q, --quiet    log errors only
  -v, --verbose  log everything
  --silent       log nothing

EXAMPLE
  $ percy build:finalize
```

## `percy build:wait`

Wait for a build to be finished. Requires a full access PERCY_TOKEN

```
USAGE
  $ percy build:wait

OPTIONS
  -b, --build=build        build id
  -c, --commit=commit      build's commit sha for a project
  -f, --fail-on-changes    exits with an error when diffs are found in snapshots
  -i, --interval=interval  interval, in milliseconds, at which to poll for updates, defaults to 1000
  -p, --project=project    build's project slug, required with --commit
  -q, --quiet              log errors only
  -t, --timeout=timeout    timeout, in milliseconds, to exit when there are no updates, defaults to 10 minutes
  -v, --verbose            log everything
  --silent                 log nothing

EXAMPLES
  $ percy build:wait --build 123
  $ percy build:wait --project test --commit HEAD
```
<!-- commandsstop -->
