# @percy/cli-command

The base command class that Percy CLI commands should extend from. Adds commonly used configuration
options to Percy config files, a `#percyrc()` method for parsing config files, and other shared
methods. Also provides common CLI flags along with oclif flag functions.

- [Usage](#usage)
- [Mapping CLI Flags](#mapping-cli-flags)

## Usage

```js
import PercyCommand, { flags } from '@percy/cli-command'

export class PercyPlugin extends PercyCommand {
  static flags = {
    ...flags.logging,
    ...flags.discovery,
    ...flags.config
  }

  run() {
    let { args, flags } = this
    let { snapshot, discovery } = this.percyrc()
    // ...
  }

  finally() {
    // called after #run() and also on process termination events
  }
}
```

## Mapping CLI Flags

The `#percyrc()` method will parse command flags for Percy configuration mappings as determined by a
`percyrc` flag configuration option.

``` js
'allowed-hostnames': flags.string({
  // maps the --allowed-hostnames flag to the corresponding config option
  percyrc: 'discovery.allowedHostnames'
})
```
