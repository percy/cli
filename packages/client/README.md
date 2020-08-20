# @percy/client

Communicate with Percy's API to create builds and snapshots, upload resources, and finalize builds
and snapshots. Uses `@percy/env` to send environment information with new builds. Can also be used
to query for a project's builds using a read access token.

## Usage

### `new PercyClient([options])`

``` js
import PercyClient from '@percy/client';

// provide a read or write token, defaults to PERCY_TOKEN environment variable
const client = new PercyClient({ token: 'abcdef123456' })
```

### Create a build

``` js
await client.createBuild()
```

### Create, upload, and finalize snapshots

``` js
await client.sendSnapshot({
  name,
  widths,
  minHeight,
  enableJavaScript,
  clientInfo,
  environmentInfo,
  // `sha` falls back to `content` sha
  resources: [{ url, sha, content, mimetype, root }]
})
```

### Finalize a build

``` js
await client.finalizeBuild()

// finalize all parallel build shards
await client.finalizeBuild({ all: true })
```

### Query for a build

**Requires a read access token**

``` js
await client.getBuild(buildId)
```

### Query for a project's builds

**Requires a read access token**

``` js
await client.getBuilds(projectSlug/*, filters*/)
```

### Wait for a build to be finished

**Requires a read access token**

``` js
await client.waitForBuild({ build: 'build-id' })
await client.waitForBuild({ project: 'project-slug', commit: '40-char-sha' })
```
