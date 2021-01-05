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
  -b, --base-url=base-url                          [default: /] the url path to serve the static directory from
  -c, --config=config                              configuration file path
  -d, --dry-run                                    prints a list of pages to snapshot without snapshotting

  -f, --files=files                                [default: **/*.{html,htm}] one or more globs matching static file
                                                   paths to snapshot

  -h, --allowed-hostname=allowed-hostname          allowed hostnames

  -i, --ignore=ignore                              one or more globs matching static file paths to ignore

  -q, --quiet                                      log errors only

  -t, --network-idle-timeout=network-idle-timeout  asset discovery idle timeout

  -v, --verbose                                    log everything

  --disable-cache                                  disable asset discovery caches

  --silent                                         log nothing

EXAMPLES
  $ percy snapshot ./public
  $ percy snapshot pages.yml
```
<!-- commandsstop -->

## Usage

### Static Directory

When snapshotting a static directory, the directory will be served locally and each matching page
will be navigated to and snapshotted.

```sh-session
$ percy snapshot ./public
[percy] Percy has started!
[percy] Created build #1: https://percy.io/org/project/123
[percy] Snapshot taken: /index.html
[percy] Snapshot taken: /about.html
[percy] Snapshot taken: /contact.html
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/org/project/123
[percy] Done!
```

### Page Listing

When snapshotting a file containing a list of pages to snapshot, the page URLs must all be
accessible by a browser. The file must be YAML, JSON, or a JS file exporting a list of pages. Each
page must contain a snapshot `name` and `url`. The options `waitForTimeout` and `waitForSelector`
can also be provided option to wait for a timeout or selector respectively before snapshotting.

#### YAML

`pages.yml`:

```yaml
- name: Snapshot one
  url: http://localhost:8080

- name: Snapshot two
  url: http://localhost:8080/two
  # wait for a timeout and/or selector before snapshotting
  waitForTimeout: 1000
  waitForSelector: .some-element
```

Snapshotting `pages.yml`:

```sh-session
$ percy snapshot pages.yml
[percy] Percy has started!
[percy] Created build #1: https://percy.io/org/project/123
[percy] Snapshot taken: Snapshot one
[percy] Snapshot taken: Snapshot two
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/org/project/123
[percy] Done!
```

#### JSON

`pages.json`:

```json
[{
  "name": "Snapshot one",
  "url": "http://localhost:8080"
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
[percy] Created build #1: https://percy.io/org/project/123
[percy] Snapshot taken: Snapshot one
[percy] Snapshot taken: Snapshot two
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/org/project/123
[percy] Done!
```

#### JavaScript

For JavaScript exports, an `execute` function and additional `snapshots` may be specified for each
page to execute JavaScript within the execution context before snapshots are taken.

`pages.js`:

```js
module.exports = [{
  name: 'Snapshot one',
  url: 'http://localhost:8080',
  async execute(page) {
    await page.click('.button')
  }
}, {
  name: 'Snapshot two',
  url: 'http://localhost:8080/two',
  waitForSelector: '.some-element',
  snapshots: [{
    name: 'Snapshot two - after click',
    execute() {
      document.querySelector('.button').click();
    }
  }, {
    name: 'Snapshot two - after double click',
    execute() {
      document.querySelector('.button').click();
      document.querySelector('.button').click();
    }
  }]
}]
```

JavaScript files may also export sync or async functions that return a list of pages to snapshot.

``` js
module.exports = async () => {
  let urls = await getSnapshotUrls()
  return urls.map(url => ({ name: url, url }))
}
```

Snapshotting `pages.js`:

```sh-session
$ percy snapshot pages.js
[percy] Percy has started!
[percy] Created build #1: https://percy.io/org/project/123
[percy] Snapshot taken: Snapshot one
[percy] Snapshot taken: Snapshot two
[percy] Snapshot taken: Snapshot two - after click
[percy] Snapshot taken: Snapshot two - after double click
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/org/project/123
[percy] Done!
```
