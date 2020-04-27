## @percy/cli-config

Uses [`percy/config`](/packages/config) to add CLI commands for creating, validating, and updating
Percy configuration files.

## Commands
<!-- commands -->
* [`percy config:create [FILEPATH]`](#percy-configcreate-filepath)
* [`percy config:validate [FILEPATH]`](#percy-configvalidate-filepath)

## `percy config:create [FILEPATH]`

Create a Percy config file

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

Validate a Percy config file

```
USAGE
  $ percy config:validate [FILEPATH]

ARGUMENTS
  FILEPATH  config filepath, detected by default

EXAMPLES
  $ percy config:validate
  $ percy config:validate ./config/percy.yml
```
<!-- commandsstop -->
