# @percy/cli-exec

Percy CLI commands for running a local snapshot server using [`@percy/core`](./packages/core).

## Commands
<!-- commands -->
* [`percy exec`](#percy-exec)
* [`percy exec:ping`](#percy-execping)
* [`percy exec:start`](#percy-execstart)
* [`percy exec:stop`](#percy-execstop)

## `percy exec`

Start and stop Percy around a supplied command

```
USAGE
  $ percy exec

OPTIONS
  -P, --port=port                                  [default: 5338] server port
  -c, --config=config                              configuration file path
  -h, --allowed-hostname=allowed-hostname          allowed hostnames
  -q, --quiet                                      log errors only
  -t, --network-idle-timeout=network-idle-timeout  asset discovery idle timeout
  -v, --verbose                                    log everything
  --disable-cache                                  disable asset discovery caches
  --parallel                                       marks the build as one of many parallel builds
  --partial                                        marks the build as a partial build
  --silent                                         log nothing

EXAMPLES
  $ percy exec -- echo "percy is running around this echo command"
  $ percy exec -- yarn test
```

## `percy exec:ping`

Pings a local running Percy snapshot server

```
USAGE
  $ percy exec:ping

OPTIONS
  -P, --port=port  [default: 5338] server port
  -q, --quiet      log errors only
  -v, --verbose    log everything
  --silent         log nothing
```

## `percy exec:start`

Starts a local Percy snapshot server

```
USAGE
  $ percy exec:start

OPTIONS
  -P, --port=port                                  [default: 5338] server port
  -c, --config=config                              configuration file path
  -h, --allowed-hostname=allowed-hostname          allowed hostnames
  -q, --quiet                                      log errors only
  -t, --network-idle-timeout=network-idle-timeout  asset discovery idle timeout
  -v, --verbose                                    log everything
  --disable-cache                                  disable asset discovery caches
  --silent                                         log nothing

EXAMPLES
  $ percy exec:start
  $ percy exec:start &> percy.log
```

## `percy exec:stop`

Stops a local running Percy snapshot server

```
USAGE
  $ percy exec:stop

OPTIONS
  -P, --port=port  [default: 5338] server port
  -q, --quiet      log errors only
  -v, --verbose    log everything
  --silent         log nothing
```
<!-- commandsstop -->
