# Percy CLI E2E Regression Tests

Visual regression tests that upload real snapshots to Percy, covering all asset discovery features.

## Setup

1. Create a Percy project at [percy.io](https://percy.io) named `percy-cli-regression`
2. Link it to the GitHub repo for VCS integration
3. Add `PERCY_REGRESSION_TOKEN` as a GitHub repository secret
4. Set the base branch to `master` in Percy project settings

## Running Locally

```bash
# Requires PERCY_TOKEN — skips gracefully without it
PERCY_TOKEN=your_token_here yarn test:regression
```

## How It Works

1. Starts two local servers: main (port 9100) and CORS (port 9101)
2. Runs `percy snapshot` against all pages defined in `snapshots.yml`
3. Percy uploads snapshots and creates a build
4. Visual diffs are reviewed in the Percy dashboard
5. Percy's GitHub VCS integration gates PRs via checks

## Adding a New Test

1. Create a new HTML page in `pages/`
2. Add an entry to `snapshots.yml`
3. (Optional) Add assets to `assets/`
4. (Optional) Add special server routes to `server.js`

No changes to `regression.test.js` needed.

## Configuration

- `snapshots.yml` — Snapshot definitions (URLs, names, per-snapshot options)
- `.percy.yml` — Percy project config (discovery settings, anti-flakiness CSS)

Each snapshot entry supports all Percy options: `widths`, `enableJavaScript`, `discovery.allowedHostnames`, `waitForSelector`, `execute`, `percyCSS`, etc.

## CI

Runs automatically on PRs and pushes to master via `.github/workflows/regression.yml` (Linux only).

**Important:** Never hardcode `PERCY_TOKEN` in any committed file. Always use environment variables.
