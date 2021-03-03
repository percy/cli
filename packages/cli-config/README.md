## @percy/cli-config

Uses [`@percy/config`](/packages/config) to add CLI commands for creating, validating, and updating
Percy configuration files.

## Commands
<!-- commands -->
* [`percy config:create [FILEPATH]`](#percy-configcreate-filepath)
* [`percy config:migrate [FILEPATH] [OUTPUT]`](#percy-configmigrate-filepath-output)
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

## `percy config:migrate [FILEPATH] [OUTPUT]`

Migrate a Percy config file to the latest version

```
USAGE
  $ percy config:migrate [FILEPATH] [OUTPUT]

ARGUMENTS
  FILEPATH  current config filepath, detected by default
  OUTPUT    new config filepath to write to, defaults to FILEPATH

OPTIONS
  -d, --dry-run  prints the new config rather than writing it

EXAMPLES
  $ percy config:migrate
  $ percy config:migrate --dry-run
  $ percy config:migrate ./config/percy.yml
  $ percy config:migrate .percy.yml .percy.js
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
