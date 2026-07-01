# Percy CLI Config — E2E Coverage Matrix (PER-8250)

Tracks which `percy snapshot` config options the E2E regression suite exercises,
and how. The option source of truth is `packages/core/src/config.js`
(`configSchema` + `snapshotSchema`) plus `packages/cli-snapshot/src/config.js`
(`static` / `sitemap`).

## Tracks

| Track | File(s) | Token? | What it proves |
|-------|---------|--------|----------------|
| **C — Config validation** | `config-validation.test.js`, `configs/`, `per-snapshot-options.yml` | no | The CLI parses, validates & loads **every** option with no `Invalid config:` output. Runs token-free + discovery-free (`--dry-run`), so it gates every PR including forks. The literal-100% option backbone. |
| **V — Visual** | `regression.test.js`, `snapshots.yml`, `pages/config-*.html` | yes | Render-affecting options produce the correct snapshot (reviewed via Percy's dashboard). The **only** track that creates a Percy build. |
| **F — Functional** | `functional.test.js`, `configs/functional-config.yml`, `server.js` gated routes | no | Discovery options behave correctly — asserted on what the test servers observed, not on log text. Runs `percy snapshot --debug` (skipUploads): discovery runs but **no build is created**, so it stays token-free and never adds a stray build to the visual project. |

Run:

```bash
yarn test:regression:config        # Track C — no token needed
yarn test:regression:functional    # Track F — no token needed (--debug, no build)
PERCY_TOKEN=… yarn test:regression  # Track V — token-gated, creates the build
```

## Scope boundaries (explicit non-goals)

- **`onlyAutomate` snapshot options are excluded** — unreachable via the
  `percy snapshot` web flow (they belong to the SDK / Percy-on-Automate path,
  covered separately under PER-8249): `fullPage`, `freezeAnimation`,
  `freezeAnimatedImage`, `freezeAnimatedImageOptions`, `ignoreRegions`,
  `considerRegions`.
- **`comparisonSchema`** (the upload/comparison wire format) is not user-facing
  CLI config — out of scope.
- **`/snapshot/server` `port`** is not reachable via `percy snapshot`: there is
  no `--port` flag on the command and it isn't in the `static` config namespace
  (the command only sets `serve`/`cleanUrls`/`baseUrl` for a directory — see
  `cli-snapshot/src/snapshot.js`). It's a programmatic/SDK option only. `serve`
  itself IS covered (server mode via `percy snapshot static-site/`).
- All additions are test-only; no production code changes.

## Coverage by namespace

Track key: **C** validated · **V** visual · **F** functional · **X** excluded.
Every listed option is at minimum **C** (in a config the CLI loads & validates).

### `percy`
| Option | Tracks | Where |
|--------|--------|-------|
| deferUploads, archiveDir, useSystemProxy, labels, skipBaseBuild, platforms[] | C | `configs/all-config.yml` |
| token | C | supplied via `PERCY_TOKEN` env (string field validated implicitly) |

### `snapshot`
| Option | Tracks | Where |
|--------|--------|-------|
| widths, minHeight | C, V | `all-config.yml`; `snapshots.yml` (responsive + defaults) |
| percyCSS | C, V | global `.percy.yml`; per-snapshot override "Config - percyCSS Override" |
| enableJavaScript | C, V | `snapshots.yml` "JavaScript Enabled" |
| cliEnableJavaScript | C | `all-config.yml` |
| disableShadowDOM | C, V | "Config - Disable Shadow DOM" |
| forceShadowAsLightDOM | C, V | "Config - Force Shadow As Light DOM" |
| enableLayout | C | `all-config.yml` |
| domTransformation | C, V | "Config - DOM Transformation" |
| reshuffleInvalidTags | C | `all-config.yml` |
| scope, scopeOptions.scroll | C, V | "Config - Scope" |
| sync | C | `all-config.yml` |
| readiness.* (preset, *WindowMs, timeoutMs, domStability, imageReady, fontReady, jsIdle, readySelectors, notPresentSelectors, maxTimeoutMs) | C | `all-config.yml` |
| responsiveSnapshotCapture | C, V | "Config - Responsive Snapshot Capture" |
| testCase, labels, thTestCaseExecutionId, browsers | C | `all-config.yml` |
| regions[] (elementSelector: boundingBox / elementCSS / elementXpath; padding, algorithm, configuration, assertion) | C | `all-config.yml` (all 3 selector forms) + `per-snapshot-options.yml` |
| algorithm (standard / layout / intelliignore / ignore), algorithmConfiguration.* | C | `all-config.yml` (incl. `layout`); `ignore` via region in `per-snapshot-options.yml` |
| ignoreCanvasSerializationErrors, ignoreStyleSheetSerializationErrors | C | `all-config.yml` |
| ignoreIframeSelectors | C, V | `snapshots.yml` "DOM Structures Coverage" |
| pseudoClassEnabledElements (id, className, xpath, selectors) | C, V | `all-config.yml` (all forms); "Interactive States" (selectors) |
| fullPage, freezeAnimation, freezeAnimatedImage, freezeAnimatedImageOptions, ignoreRegions, considerRegions | **X** | onlyAutomate — excluded |

### `discovery`
| Option | Tracks | Where |
|--------|--------|-------|
| allowedHostnames | C, V | global `.percy.yml` (CORS resources) |
| disallowedHostnames | C, F | `functional-config.yml` (9101 probe aborted) |
| networkIdleTimeout | C | global `.percy.yml` |
| waitForSelector, waitForTimeout | C | `all-config.yml` |
| scrollToBottom | C, V | "Config - Scroll To Bottom" |
| disableCache, maxCacheRam (int + null) | C | `all-config.yml` + `alt-forms.yml` |
| captureMockedServiceWorker | C | `all-config.yml` |
| captureSrcset | C, F | `functional-config.yml` (both srcset candidates fetched) |
| requestHeaders | C, F | `functional-config.yml` (header observed) |
| authorization | C, F | `functional-config.yml` (Basic auth observed) |
| cookies (object + array) | C, F | `all-config.yml` (object) + `alt-forms.yml` (array); F observes Cookie header |
| userAgent | C, F | `functional-config.yml` (UA observed) |
| devicePixelRatio | C | `all-config.yml` |
| concurrency | C | global `.percy.yml` |
| snapshotConcurrency, retry, autoConfigureAllowedHostnames | C | `all-config.yml` |
| launchOptions (executable, timeout, args, headless, closeBrowser) | C | `all-config.yml` (timeout also in global `.percy.yml`) |
| fontDomains | C | `all-config.yml` |

### `project`
| Option | Tracks | Where |
|--------|--------|-------|
| id, name | C | `all-config.yml` |

### Per-snapshot / list / static / sitemap (cli-snapshot)
| Option | Tracks | Where |
|--------|--------|-------|
| name | C, V | every snapshot |
| execute (string / lifecycle-object / array) | C, V | `per-snapshot-options.yml`; "Config - Execute" |
| additionalSnapshots (name / prefix / suffix / execute) | C, V | `per-snapshot-options.yml`; "Config - Execute" |
| precapture waitForSelector / waitForTimeout | C | `per-snapshot-options.yml` |
| include / exclude (filter; also `--include`/`--exclude`) | C | `per-snapshot-options.yml` |
| list baseUrl, options | C | `per-snapshot-options.yml` |
| static cleanUrls, rewrites, baseUrl, options | C | `all-config.yml` (`static:` section); `serve` + `cleanUrls` also via server mode `percy snapshot static-site/` |
| server mode: serve | C | `static-site/` via `percy snapshot <dir> --dry-run` (`port` is not CLI-reachable — see Scope) |
| sitemap options | C | `all-config.yml` (`sitemap:` section) |

## Adding coverage for a new option

1. Add it to `configs/all-config.yml` (or a focused fixture) and bump the
   expected count in `config-validation.test.js` if it adds snapshots — that
   alone gives Track C coverage.
2. If it changes the render, add a page + `snapshots.yml` entry (Track V).
3. If its effect is behavioral (a request/header/resource decision), add a
   gated route to `server.js` and an assertion to `functional.test.js` (Track F).
