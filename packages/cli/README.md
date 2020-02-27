# @percy/cli

A collection of CLI commmands for taking Percy snapshots.

## Commands
<!-- commands -->
* [`percy config:create [FILEPATH]`](#percy-configcreate-filepath)
* [`percy config:validate [FILEPATH]`](#percy-configvalidate-filepath)
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
