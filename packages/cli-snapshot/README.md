# @percy/cli-snapshot

Snapshot a list or static directory of web pages.

## Commands
<!-- commands -->
* [`percy snapshot PATHNAME`](#percy-snapshot-pathname)

## `percy snapshot PATHNAME`

Snapshot a list of pages from a file or directory

```
USAGE
  $ percy snapshot PATHNAME

ARGUMENTS
  PATHNAME  path to a directory or file containing a list of pages

OPTIONS
  -b, --base-url=base-url                          the base url pages are hosted at when snapshotting
  -c, --config=config                              configuration file path
  -d, --dry-run                                    prints a list of pages to snapshot without snapshotting
  -h, --allowed-hostname=allowed-hostname          allowed hostnames
  -q, --quiet                                      log errors only
  -t, --network-idle-timeout=network-idle-timeout  asset discovery idle timeout
  -v, --verbose                                    log everything
  --clean-urls                                     rewrite static index and filepath URLs to be clean
  --disable-cache                                  disable asset discovery caches

  --files=files                                    [default: **/*.{html,htm}] one or more globs matching static file
                                                   paths to snapshot

  --ignore=ignore                                  one or more globs matching static file paths to ignore

  --silent                                         log nothing

EXAMPLES
  $ percy snapshot ./public
  $ percy snapshot pages.yml
```
<!-- commandsstop -->

## Usage

### Page Listing

When providing a file containing a list of pages to snapshot, the file must be YAML, JSON, or a JS
file exporting a list of pages. Each page must contain at least a `url` that can be navigated to
using a browser.

`pages.yml`:

```yaml
- http://localhost:8080
- http://localhost:8080/two
```

Snapshotting `pages.yml`:

```sh-session
$ percy snapshot pages.yml
[percy] Percy has started!
[percy] Snapshot taken: /
[percy] Snapshot taken: /two
[percy] Finalized build #1: https://percy.io/org/project/123
```

#### Page Options

A `name` can be provided which will override the default snapshot name generated from the url
path. The options `waitForTimeout` and `waitForSelector` can also be provided to wait for a timeout
or selector respectively before taking the page snapshot.

`pages.json`:

```json
[{
  "name": "Snapshot one",
  "url": "http://localhost:8080",
  "waitForTimeout": 1000
}, {
  "name": "Snapshot two",
  "url": "http://localhost:8080/two",
  "waitForSelector": ".some-element"
}]
```

Snapshotting `pages.json`:

```sh-session
$ percy snapshot pages.json
[percy] Percy has started!
[percy] Snapshot taken: Snapshot one
[percy] Snapshot taken: Snapshot two
[percy] Finalized build #1: https://percy.io/org/project/123
```

For more advanced use cases, an `execute` function and `additionalSnapshots` may be specified for
each page to execute JavaScript within the page execution context before subsequent snapshots are taken.

> Note: All options are also accepted by other file formats. For `execute` however, a string
> containing a function body can be provided when the file format prevents normal functions.

`pages.js`:

```js
module.exports = [{
  name: 'My form',
  url: 'http://localhost:8080/form',
  waitForSelector: '.form-loaded',
  execute() {
    document.querySelector('.name').value = 'Name Namerson';
    document.querySelector('.email').value = 'email@domain.com';
  },
  additionalSnapshots: [{
    suffix: ' - submitting',
    execute() {
      document.querySelector('.submit').click();
    }
  }, {
    suffix: ' - after submit',
    waitForSelector: '.form-submitted'
  }]
}]
```

Snapshotting `pages.js`:

```sh-session
$ percy snapshot pages.js
[percy] Percy has started!
[percy] Snapshot taken: My form
[percy] Snapshot taken: My form - submitting
[percy] Snapshot taken: My form - after submit
[percy] Finalized build #1: https://percy.io/org/project/123
```

JavaScript files may also export sync or async functions that return a list of pages to snapshot.

``` js
module.exports = async () => {
  let urls = await getSnapshotUrls()
  return urls.map(url => ({ name: url, url }))
}
```

### Static Directory

When providing a static directory, it will be served locally and pages matching the `files` argument
(and excluding the `ignore` argument) will be navigated to and snapshotted.

```sh-session
$ percy snapshot ./public
[percy] Percy has started!
[percy] Snapshot taken: /index.html
[percy] Snapshot taken: /about.html
[percy] Snapshot taken: /contact.html
[percy] Finalized build #1: https://percy.io/org/project/123
```

#### Static Options

For snapshotting static directories, the following Percy config file options are also accepted:

``` yaml
# .percy.yml
version: 2
static:
  files: **/*.{html,htm}
  ignore: []
  base-url: /
  clean-urls: false
  rewrites: {}
  overrides: []
```

- **files** - A glob or an array of globs matching static file paths to snapshot.
- **ignore** - A glob or an array of globs matching static file paths to ignore.
- **base-url** - The base URL path the static site should be served under.
- **clean-urls** - When true, rewrite index and filepath URLs to be clean.

<span/>

- **rewrites** - An object containing source-destination pairs for rewriting URLs.

  Paths for resources can sometimes be expected to be in a certain format that may not be covered by
  the `clean-urls` option. For such paths, rewrites can map a short, clean, or pretty path to a
  specific resource. Paths are matched using [path-to-regexp](https://github.com/pillarjs/path-to-regexp).

  ``` yaml
  # .percy.yml
  version: 2
  static:
    base-url: /blog
    rewrites:
      /:year/:month/:title: /posts/:year-:month--:title.html
      /:year/:month: /posts/index-:year-:month.html
      /:year: /posts/index-:year.html
  ```

- **overrides** - An array of per-snapshot option overrides.

  Just like [page listing options](#page-options), static snapshots may also contain
  per-snapshot configuration options. However, since pages are matched against the `files`
  option, so are per-snapshot configuration options via an array of `overrides`. If multiple
  overrides match a snapshot, they will be merged with previously matched overrides.

  ``` yaml
  # .percy.yml
  version: 2
  static:
    overrides:
    - files: /foo-bar.html
      waitForSelector: .is-ready
      execute: |
        document.querySelector('.button').click()
  ```
