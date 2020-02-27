## @percy/cli-config

Handles Percy configuration for Percy CLI commands. Uses
[cosmiconfig](https://github.com/davidtheclark/cosmiconfig) to load configuration files and [JSON
schema](https://json-schema.org/) with [AJV](https://github.com/epoberezkin/ajv) to validate those
configuration files. Adds CLI commands for creating, validating, and updating Percy configuration
files.

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

## Plugin Usage

### Loading config files

The `#load()` method will load and validate a configuation file, optionally merging it with any
`input` options. If no `filepath` is provided, will search for the first supported config found from
the current directory up to the home directoy.

```js
import PercyConfig from '@percy/cli-config'

// `filepath` - the path to a Percy config file
// `input` - additional configuration options
// `bail` - return undefined on validation warnings
const config = PercyConfig.load(filepath, input, bail)
```

#### Supported configs

- `"percy"` entry in `package.json`
- `.percyrc` YAML or JSON file
- `.percy.json` JSON file
- `.percy.yaml` or `.percy.yml` YAML file
- `.percy.js` or `percy.config.js` file that exports an object

### Extending config options

The `.addSchema()` function will add a sub-schema to the Percy configuration file which will be
parsed and validated when `PercyConfig.load()` is called. See [JSON
schema](https://json-schema.org/) for possible schema options.

```js
import PercyConfig from '@percy/cli-config'

PercyConfig.addSchema({ propertyName: JSONSchema })
```
