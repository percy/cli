# Percy CLI E2E Regression Tests

E2E regression coverage for the `percy snapshot` CLI and its full config
surface. Three complementary tracks (see [`COVERAGE.md`](./COVERAGE.md) for the
per-option matrix):

- **Config validation** (`config-validation.test.js`) — token-free `--dry-run`
  that loads fixtures setting **every** CLI config option and asserts the CLI
  accepts them all (no `Invalid config:`). Runs on every PR, no token needed.
- **Visual** (`regression.test.js`) — uploads real snapshots; render-affecting
  options are reviewed as visual diffs in the Percy dashboard.
- **Functional** (`functional.test.js`) — runs `percy snapshot --debug`
  (discovery runs but no build is uploaded) and asserts discovery options
  against what the test servers observed (headers, auth, cookies, user-agent,
  blocked hosts). Token-free, and creates no build — so it never adds a stray
  build to the visual project.

> **Scope:** `onlyAutomate` snapshot options (`fullPage`, `freezeAnimation`,
> `freezeAnimatedImage`, `freezeAnimatedImageOptions`, `ignoreRegions`,
> `considerRegions`) are out of scope here — they are unreachable via the
> `percy snapshot` web flow and are covered on the SDK/Automate path.

## Setup

1. Create a Percy project at [percy.io](https://percy.io) named `percy-cli-regression`
2. Link it to the GitHub repo for VCS integration
3. Add `PERCY_REGRESSION_TOKEN` as a GitHub repository secret
4. Set the base branch to `master` in Percy project settings

## Running Locally

```bash
# Config validation + functional — no token required, run anywhere
yarn test:regression:config
yarn test:regression:functional

# Visual — requires PERCY_TOKEN (creates the build); skips gracefully without it
PERCY_TOKEN=your_token_here yarn test:regression
```

## How It Works

1. Starts two local servers: main (port 9100) and CORS (port 9101)
2. Runs `percy snapshot` against the pages defined in `snapshots.yml`
3. Percy uploads snapshots and creates a build
4. Visual diffs are reviewed in the Percy dashboard
5. Percy's GitHub VCS integration gates PRs via checks

The config-validation track instead runs `percy snapshot --dry-run` (no
discovery, no upload) and asserts the CLI loads every config fixture cleanly.

## Adding a New Test

1. Create a new HTML page in `pages/`
2. Add an entry to `snapshots.yml`
3. (Optional) Add assets to `assets/`
4. (Optional) Add special server routes to `server.js`

No changes to `regression.test.js` needed. To cover a new **config option**, see
the "Adding coverage" section of [`COVERAGE.md`](./COVERAGE.md).

## Configuration

- `snapshots.yml` — Visual snapshot definitions (URLs, names, per-snapshot options)
- `.percy.yml` — Percy project config (discovery settings, anti-flakiness CSS)
- `configs/` — Config-validation fixtures (`all-config.yml`, `alt-forms.yml`,
  `functional-config.yml`, `invalid-example.yml`)
- `per-snapshot-options.yml` — List-mode fixture covering per-snapshot options
- `functional-snapshots.yml` — Functional discovery snapshot
- [`COVERAGE.md`](./COVERAGE.md) — Per-option coverage matrix

Each snapshot entry supports all Percy options: `widths`, `enableJavaScript`, `discovery.allowedHostnames`, `waitForSelector`, `execute`, `percyCSS`, etc.

## CI

Runs automatically on PRs and pushes to master via the `regression` job in
`.github/workflows/test.yml` (Linux only): config validation and functional
run token-free; the visual track runs with `PERCY_REGRESSION_TOKEN` and is the
only step that creates a Percy build.
