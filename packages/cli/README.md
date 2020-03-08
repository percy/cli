# @percy/cli

A collection of CLI commmands for taking Percy snapshots.

## Commands
<!-- commands -->
* [`percy config:create [FILEPATH]`](#percy-configcreate-filepath)
* [`percy config:validate [FILEPATH]`](#percy-configvalidate-filepath)
* [`percy exec`](#percy-exec)
* [`percy exec:ping`](#percy-execping)
* [`percy exec:start`](#percy-execstart)
* [`percy exec:stop`](#percy-execstop)
* [`percy help [COMMAND]`](#percy-help-command)

## `percy config:create [FILEPATH]`

create a Percy config file

```
USAGE
  $ percy config:create [FILEPATH]

ARGUMENTS
  FILEPATH  config filepath

OPTIONS
  --js    create a .percy.js file
  --json  create a .percy.json file
  --rc    create a .percyrc file
  --yaml  create a .percy.yaml file
  --yml   create a .percy.yml file

EXAMPLES
  $ percy config:create
  $ percy config:create --yaml
  $ percy config:create --json
  $ percy config:create --js
  $ percy config:create --rc
  $ percy config:create ./config/percy.yml
```

## `percy config:validate [FILEPATH]`

validate a Percy config file

```
USAGE
  $ percy config:validate [FILEPATH]

ARGUMENTS
  FILEPATH  config filepath, detected by default

EXAMPLES
  $ percy config:validate
  $ percy config:validate ./config/percy.yml
```

## `percy exec`

start and stop Percy around a supplied command

```
USAGE
  $ percy exec

OPTIONS
  -c, --config=config                              configuration file path
  -h, --allowed-hostname=allowed-hostname          allowed hostnames
  -q, --quiet                                      log errors only
  -t, --network-idle-timeout=network-idle-timeout  [default: 100] asset discovery idle timeout
  -v, --verbose                                    log everything
  --disable-asset-cache                            disable asset discovery caches
  --silent                                         log nothing

EXAMPLES
  $ percy exec -- echo "percy is running around this echo command"
  $ percy exec -- yarn test
```

## `percy exec:ping`

pings a running Percy process

```
USAGE
  $ percy exec:ping

OPTIONS
  -q, --quiet    log errors only
  -v, --verbose  log everything
  --silent       log nothing

EXAMPLE
  $ percy server:ping
```

## `percy exec:start`

starts a Percy process

```
USAGE
  $ percy exec:start

OPTIONS
  -c, --config=config                              configuration file path
  -h, --allowed-hostname=allowed-hostname          allowed hostnames
  -q, --quiet                                      log errors only
  -t, --network-idle-timeout=network-idle-timeout  [default: 100] asset discovery idle timeout
  -v, --verbose                                    log everything
  --disable-asset-cache                            disable asset discovery caches
  --silent                                         log nothing

EXAMPLES
  $ percy server:start
  $ percy server:start &>/dev/null
```

## `percy exec:stop`

stops a running Percy process

```
USAGE
  $ percy exec:stop

OPTIONS
  -q, --quiet    log errors only
  -v, --verbose  log everything
  --silent       log nothing

EXAMPLE
  $ percy server:stop
```

## `percy help [COMMAND]`

display help for percy

```
USAGE
  $ percy help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.2.3/src/commands/help.ts)_
<!-- commandsstop -->
