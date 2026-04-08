# Fully Loaded Snapshot Capture — Readiness Gate

> **Status:** POC validated, PR open ([percy/cli#2172](https://github.com/percy/cli/pull/2172))
> **Jira:** [PER-7348](https://browserstack.atlassian.net/browse/PER-7348)
> **Confluence:** [Fully Loaded Snapshot Capture](https://browserstack.atlassian.net/wiki/spaces/PROD/pages/6068505301/Fully+Loaded+Snapshot+Capture)

---

## Table of Contents

- [Problem](#problem)
- [Solution Overview](#solution-overview)
- [Architecture](#architecture)
- [Complete Flow — URL-Based Snapshots](#complete-flow--url-based-snapshots-cli-percy-snapshot--storybook)
- [Complete Flow — SDK-Provided Snapshots (V2 Re-Capture)](#complete-flow--sdk-provided-snapshots-v2-re-capture)
- [Configuration](#configuration)
- [The 6 Readiness Checks](#the-6-readiness-checks)
- [DOM Mutation Filter](#dom-mutation-filter)
- [Timeout Behavior](#timeout-behavior)
- [Config Flow Diagram](#config-flow-diagram)
- [Files Changed](#files-changed)
- [POC Results](#poc-results)
- [Limitations](#limitations)
- [FAQ](#faq)

---

## Problem

Percy captures snapshots that sometimes show partially rendered UI — skeleton loaders, missing images, half-loaded SPAs. This happens because Percy captures the DOM as soon as network goes idle, without checking if the page is *visually* ready.

**Common causes of false diffs:**
- `setTimeout`-based content loading (invisible to network tracking)
- React Suspense / lazy-loaded components
- Skeleton loaders that disappear after data arrives
- Web fonts that haven't applied yet
- Images that haven't finished loading
- SPA route transitions still in progress

**Current workarounds** (`waitForSelector`, `waitForTimeout`, `execute` hooks) require per-page knowledge and manual maintenance.

---

## Solution Overview

A **readiness gate** that runs before DOM serialization, using 6 composable checks:

1. **DOM stability** — MutationObserver watches for layout-affecting changes
2. **Network idle** — Waits for no new resource loading
3. **Font readiness** — `document.fonts.ready`
4. **Image readiness** — Above-the-fold images complete
5. **Ready selectors** — Wait for elements to appear
6. **Not-present selectors** — Wait for skeleton loaders to disappear

All checks run **concurrently**, racing against a configurable **timeout**. If timeout is reached, the snapshot is captured anyway (graceful degradation).

**Key design decision:** Zero SDK changes required. The readiness gate runs entirely in the CLI.

---

## Architecture

There are two snapshot paths in Percy. The readiness gate handles both:

```
                    ┌──────────────────────────────┐
                    │         .percy.yml            │
                    │  snapshot:                    │
                    │    readiness:                 │
                    │      preset: strict           │
                    │      notPresentSelectors:     │
                    │        - .skeleton            │
                    └──────────────┬───────────────┘
                                   │
                         CLI loads at startup
                         (cosmiconfig search)
                                   │
                    ┌──────────────▼───────────────┐
                    │     Percy Constructor         │
                    │                               │
                    │  this.config.snapshot.readiness│
                    │  Page._globalReadinessConfig   │
                    └──────────────┬───────────────┘
                                   │
                 ┌─────────────────┴──────────────────┐
                 │                                    │
        URL-Based Path                      SDK-Provided Path
     (CLI / Storybook)                  (Cypress/Playwright/etc)
                 │                                    │
    ┌────────────▼──────────┐          ┌──────────────▼────────────┐
    │ CLI navigates browser │          │ SDK serializes DOM        │
    │ to URL                │          │ POSTs { domSnapshot }     │
    │                       │          │ to /percy/snapshot        │
    │ page.snapshot() runs: │          │                           │
    │  1. waitForTimeout    │          │ CLI receives POST:        │
    │  2. waitForSelector   │          │  _fromSDK: true added     │
    │  3. execute hooks     │          │                           │
    │  4. network.idle()    │          │ Discovery task handler:   │
    │  5. insertPercyDom()  │          │  readiness enabled?       │
    │                       │          │  AND _fromSDK?            │
    │  ┌─────────────────┐  │          │  AND domSnapshot exists?  │
    │  │ READINESS GATE  │  │          │         │                 │
    │  │ waitForReady()  │  │          │    YES: V2 Re-Capture     │
    │  │ in browser      │  │          │    ┌────▼──────────┐      │
    │  └────────┬────────┘  │          │    │ Delete domSnap │      │
    │           │           │          │    │ Clear root     │      │
    │  6. PercyDOM.serialize│          │    │ resource cache │      │
    │                       │          │    │ Enable JS      │      │
    │  Captures stable DOM  │          │    │ Navigate to URL│      │
    └───────────────────────┘          │    │ Run page.snap()│      │
                                       │    │ (same as left) │      │
                                       │    └────────────────┘      │
                                       │                           │
                                       │    NO: Use domSnapshot    │
                                       │    as-is (current flow)   │
                                       └───────────────────────────┘
```

---

## Complete Flow — URL-Based Snapshots (CLI `percy snapshot` / Storybook)

This path is used when the CLI navigates its own Chromium browser.

```
Step 1: Percy starts
        ├── Loads .percy.yml via cosmiconfig
        │   percy.config.snapshot.readiness = { preset: 'strict', ... }
        ├── Sets Page._globalReadinessConfig (static on Page class)
        ├── Launches Chromium browser
        └── Starts local API server on port 5338

Step 2: Snapshot requested (CLI command or Storybook iteration)
        ├── For Storybook: evalSetCurrentStory() fires storyRendered event
        │   + waitForLoadersToDisappear() (Storybook's own detection)
        └── Calls page.snapshot(options)

Step 3: page.snapshot() executes
        ├── waitForTimeout (if configured)
        ├── waitForSelector (if configured)
        ├── execute beforeSnapshot hooks (if configured)
        ├── network.idle() — waits for zero in-flight HTTP requests
        │   (uses CDP Network.requestWillBeSent / loadingFinished)
        │
        ├── insertPercyDom() — injects @percy/dom bundle into page
        │
        ├── READINESS GATE (new):
        │   ├── Resolves config: snapshot.readiness || page._readinessConfig
        │   │   || Page._globalReadinessConfig
        │   ├── If config is null or preset === 'disabled' → SKIP
        │   ├── Calls PercyDOM.waitForReady(config) via page.eval()
        │   │   ├── All 6 checks run concurrently (Promise.all)
        │   │   ├── Races against timeout_ms (Promise.race)
        │   │   ├── Returns diagnostic result:
        │   │   │   { passed, timed_out, preset, total_duration_ms,
        │   │   │     checks: { dom_stability, network_idle, ... } }
        │   │   └── ALWAYS resolves (never rejects)
        │   ├── If !passed: log warning with failed checks + recommendations
        │   └── Attach diagnostics to snapshot
        │
        ├── PercyDOM.serialize(options) — captures the stable DOM
        │   (synchronous — clones DOM, captures inputs, iframes, canvas, etc.)
        │
        └── Returns { domSnapshot, url, readiness_diagnostics }

Step 4: Asset discovery
        ├── Browser discovers referenced resources (CSS, images, fonts)
        └── Resources uploaded to Percy API

Step 5: Snapshot uploaded to Percy API
        └── readiness_diagnostics stored in snapshot metadata (JSON column)
```

### Storybook-Specific Flow

```
@percy/storybook iterates stories:
  │
  ├── evalSetCurrentStory(story)
  │   ├── channel.emit('setCurrentStory', { storyId })
  │   ├── Waits for 'storyRendered' event
  │   └── waitForLoadersToDisappear() (15s timeout, 3x stable checks)
  │       Checks: #preview-loader, .sb-preparing-story, .sb-preparing-docs,
  │       .sb-show-preparing-story/docs classes, all .sb-loader elements
  │
  ├── captureSerializedDOM(page, options)
  │   └── page.snapshot(options)
  │       └── READINESS GATE runs here (between insertPercyDom and serialize)
  │           Config comes from Page._globalReadinessConfig (.percy.yml)
  │
  └── percy.snapshot(snapshotData) → upload

No changes to @percy/storybook needed.
Readiness layers ON TOP of Storybook's own detection.
```

---

## Complete Flow — SDK-Provided Snapshots (V2 Re-Capture)

This is the flow for Cypress, Playwright, Selenium, etc.

```
Step 1: SDK captures DOM in test browser
        ├── SDK fetches dom.js from GET /percy/dom.js
        ├── SDK injects dom.js into test browser page
        ├── SDK calls PercyDOM.serialize() — SYNCHRONOUS
        │   Returns frozen HTML string (may contain skeletons)
        └── SDK POSTs to /percy/snapshot:
            {
              name: "Dashboard",
              url: "http://localhost:3000/dashboard",
              domSnapshot: "<html>...skeletons...</html>",
              widths: [1280]
            }

Step 2: CLI receives POST at api.js
        ├── Adds _fromSDK: true to the options
        │   (tags this as SDK-originated, not CLI-internal)
        └── Calls percy.snapshot({ ...req.body, _fromSDK: true })

Step 3: percy.snapshot() in percy.js
        ├── Preserves _fromSDK through config validation
        │   (validateSnapshotOptions strips unknown keys;
        │    _fromSDK is saved before and restored after)
        └── Pushes to discovery queue

Step 4: Discovery queue task handler (discovery.js)
        │
        ├── CHECK: Is V2 re-capture needed?
        │   readinessConfig = snapshot.readiness
        │                  || percy.config?.snapshot?.readiness
        │
        │   CONDITIONS (all must be true):
        │   ✓ snapshot._fromSDK === true
        │   ✓ snapshot.domSnapshot exists
        │   ✓ snapshot.url exists
        │   ✓ readinessConfig exists (readiness explicitly configured)
        │   ✓ readinessConfig.preset !== 'disabled'
        │
        ├── If ALL conditions met → V2 RE-CAPTURE:
        │   ├── Extract cookies from domSnapshot (preserve for navigation)
        │   ├── DELETE snapshot.domSnapshot
        │   ├── Clear root HTML resource from cache
        │   │   (so browser fetches live page, not cached SDK HTML)
        │   └── JS flag evaluates to true (needed for readiness gate)
        │
        │   The rest of the flow is now identical to URL-based path:
        │   ├── Browser navigates to snapshot.url
        │   ├── page.snapshot() runs the readiness gate
        │   ├── Captures fully loaded DOM
        │   └── Uploads to API
        │
        └── If ANY condition fails → NORMAL PATH:
            ├── Uses SDK's domSnapshot as-is
            ├── Browser navigates for asset discovery only
            └── Uploads SDK's original HTML

Step 5: Why each condition matters:
        │
        ├── _fromSDK: Prevents re-capture for Storybook/CLI-internal
        │   snapshots that already went through page.snapshot()
        │
        ├── domSnapshot: Only SDK snapshots have pre-serialized DOM
        │
        ├── url: Needed to navigate the browser to
        │
        ├── readinessConfig exists: Only re-capture when user explicitly
        │   configured readiness (not by default — backwards compatible)
        │
        └── preset !== 'disabled': User explicitly opted out
```

---

## Configuration

### .percy.yml (Global — applies to all snapshots)

```yaml
version: 2
snapshot:
  readiness:
    preset: balanced              # balanced | strict | fast | disabled
    stabilityWindowMs: 300        # override preset value
    networkIdleWindowMs: 200
    timeoutMs: 10000
    imageReady: true
    fontReady: true
    notPresentSelectors:          # wait for these to disappear
      - .skeleton
      - .loading-spinner
      - '[data-loading]'
    readySelectors:               # wait for these to appear
      - '[data-loaded=true]'
      - .content-ready
```

### Per-Snapshot Override (from SDK)

```javascript
// Cypress
cy.percySnapshot('Dashboard', {
  readiness: { preset: 'disabled' }  // skip for this snapshot only
});

// Playwright
await percySnapshot(page, 'Dashboard', {
  readiness: {
    preset: 'strict',
    notPresentSelectors: ['.custom-loader']
  }
});

// Selenium (JS)
await percySnapshot(driver, 'Dashboard', {
  readiness: { preset: 'fast' }
});
```

**Per-snapshot overrides take precedence over .percy.yml.**

### Presets

| Preset | stabilityWindowMs | networkIdleWindowMs | timeoutMs | imageReady | fontReady |
|--------|-------------------|---------------------|-----------|------------|-----------|
| `balanced` | 300 | 200 | 10,000 | true | true |
| `strict` | 1,000 | 500 | 30,000 | true | true |
| `fast` | 100 | 100 | 5,000 | false | true |
| `disabled` | — | — | — | — | — |

### Common Configurations

```yaml
# Disable readiness globally (backwards compatible behavior)
snapshot:
  readiness:
    preset: disabled

# Wait for skeleton loaders to disappear
snapshot:
  readiness:
    preset: strict
    notPresentSelectors:
      - .skeleton
      - .shimmer

# Fast mode for static sites
snapshot:
  readiness:
    preset: fast

# Custom: wait for specific data-attribute
snapshot:
  readiness:
    preset: balanced
    readySelectors:
      - '[data-page-ready]'
```

---

## The 6 Readiness Checks

All checks are implemented in `@percy/dom/src/readiness.js` and run **inside the browser** via `page.eval()`.

### 1. DOM Stability (MutationObserver)

```
What:   Watches for layout-affecting DOM mutations
How:    MutationObserver on document.documentElement (subtree: true)
Wait:   No qualifying mutations for stability_window_ms
Timer:  Resets on each qualifying mutation
```

**Watches:** `childList`, `attributes` (with `attributeOldValue: true`)
**Attribute filter:** `class, width, height, display, visibility, position, src, href, style`

See [DOM Mutation Filter](#dom-mutation-filter) for what counts as "layout-affecting".

### 2. Network Idle (PerformanceObserver)

```
What:   Waits for no new resources loading
How:    Polls performance.getEntriesByType('resource') count every 50ms
Wait:   No new entries for network_idle_window_ms
Note:   Browser-side only (no CDP). CLI-side uses CDP network events.
```

### 3. Font Readiness

```
What:   Waits for all web fonts to load
How:    document.fonts.ready (Promise API)
Wait:   Max 5 second sub-timeout
Skip:   If document.fonts API unavailable
Note:   Resolves immediately if page has no @font-face rules
```

### 4. Image Readiness

```
What:   Waits for above-the-fold images to complete loading
How:    Polls img.complete && img.naturalWidth > 0
Filter: Only images where getBoundingClientRect().top < window.innerHeight
        AND rect.bottom > 0 AND rect.width > 0 AND rect.height > 0
Wait:   Polls every 100ms
Skip:   When imageReady: false (default in 'fast' preset)
```

### 5. Ready Selectors

```
What:   Waits for specified CSS selectors to exist AND be visible
How:    Polls document.querySelector(sel) + visibility check
Visible: el.offsetParent !== null (except fixed/sticky positioning)
Wait:   ALL selectors must be present and visible simultaneously
Config: readySelectors: ['[data-loaded=true]', '.content-ready']
```

### 6. Not-Present Selectors

```
What:   Waits for specified CSS selectors to be ABSENT from the DOM
How:    Polls document.querySelector(sel) === null
Wait:   ALL selectors must return null
Config: notPresentSelectors: ['.skeleton', '.loading-spinner']
Use:    Skeleton loaders, loading indicators, Suspense fallbacks
```

---

## DOM Mutation Filter

The MutationObserver tracks all mutations but only resets the stability timer for **layout-affecting** changes.

### Resets Stability Timer (layout-affecting)

| Mutation Type | Condition |
|---------------|-----------|
| `childList` | Always (element added/removed) |
| `class` attribute | Always |
| `width`, `height` attribute | Always |
| `display`, `visibility`, `position` attribute | Always |
| `src` attribute (images) | Always |
| `href` attribute (stylesheets) | Always |
| `style` attribute | Only if geometry properties changed (see below) |

**Geometry style properties that reset stability:**
`width, height, top, left, right, bottom, margin, padding, display, position, visibility, flex, grid, min-*, max-*, inset, gap, order, float, clear, overflow, z-index, columns`

### Ignored (does NOT reset stability)

| Mutation Type | Reason |
|---------------|--------|
| `data-*` attributes | Framework internals (React, Angular, Vue) |
| `aria-*` attributes | Accessibility updates |
| `characterData` (text content) | Text-only changes |
| `title`, `alt`, `placeholder` | Non-visual attributes |
| `style` with only visual properties | CSS animations don't affect layout |

**Visual-only style properties (ignored):**
`transform, opacity, color, background, box-shadow, text-shadow, filter, animation, transition`

---

## Timeout Behavior

Every readiness check runs within `Promise.race` against `timeout_ms`:

```javascript
await Promise.race([
  runAllChecks(config, result),    // all 6 checks concurrently
  timeout(effectiveTimeout)         // timeout cap
]);
```

- `balanced`: 10 second timeout
- `strict`: 30 second timeout
- `fast`: 5 second timeout
- **The gate never waits forever** — there is always a timeout

### When timeout is reached:

1. Snapshot is captured anyway (graceful degradation)
2. CLI logs a warning:
   ```
   [percy] Warning: Snapshot "Dashboard" captured before stable (timed out after 10000ms)
   [percy]   - dom_stability: passed (302ms)
   [percy]   - network_idle: passed (201ms)
   [percy]   - font_ready: passed (1ms)
   [percy]   - not_present_selectors: FAILED
   [percy]   Tip: Loading indicators still present. These may be skeleton loaders or spinners.
   ```
3. Diagnostic metadata attached to the snapshot

### WebDriver Timeout Buffer

For Selenium SDKs using `executeAsyncScript`, the effective timeout is:
```
effectiveTimeout = min(timeout_ms, max_timeout_ms)
```
Where `max_timeout_ms` can be set to prevent WebDriver `ScriptTimeoutError`.

---

## Config Flow Diagram

```
                        .percy.yml
                            │
                    ┌───────▼────────┐
                    │  cosmiconfig   │
                    │  search()      │
                    └───────┬────────┘
                            │
                    ┌───────▼────────────────────────────┐
                    │  Percy Constructor                  │
                    │                                     │
                    │  config = PercyConfig.load()        │
                    │  this.config.snapshot.readiness      │
                    │       = { preset, stabilityWindowMs, │
                    │         notPresentSelectors, ... }   │
                    │                                     │
                    │  Page._globalReadinessConfig         │
                    │       = config.snapshot.readiness    │
                    └──────────┬──────────────────────────┘
                               │
           ┌───────────────────┼───────────────────────┐
           │                   │                       │
   URL-Based Path       Storybook Path          SDK Path
           │                   │                       │
   getSnapshotOptions    Page._global           POST /percy/snapshot
   merges config.snap    ReadinessConfig        { domSnapshot, url }
   into snapshot opts    set on Percy()         No readiness in body
           │                   │                       │
           ▼                   ▼                       ▼
   snapshot.readiness    page.snapshot()         discovery.js:
   = { preset: ... }    checks:                 snapshot.readiness
                         1. snapshot.readiness      || percy.config
                         2. page._readiness            .snapshot
                            Config                     .readiness
                         3. Page._global
                            ReadinessConfig

                    Per-snapshot override wins:
                    cy.percySnapshot('X', {
                      readiness: { preset: 'disabled' }
                    })
                    ↓
                    snapshot.readiness = { preset: 'disabled' }
                    Takes precedence over .percy.yml
```

---

## Files Changed

### `@percy/dom` (browser-side, runs in page context)

| File | Description |
|------|-------------|
| `src/readiness.js` | **NEW** — All 6 readiness checks, `waitForReady()` orchestrator, presets, timeout race, mutation filter |
| `src/index.js` | Export `waitForReady` from readiness module |
| `test/readiness.test.js` | **NEW** — 25+ browser-based specs (Karma + Chrome/Firefox) |

### `@percy/core` (CLI-side, Node.js)

| File | Description |
|------|-------------|
| `src/readiness.js` | **NEW** — CLI orchestrator: resolves config (camelCase/snake_case), calls `PercyDOM.waitForReady()` via `page.eval()`, logs warnings with recommendations |
| `src/page.js` | Import `waitForReadiness`. Add `Page._globalReadinessConfig` static. Insert readiness gate between `insertPercyDom()` and `serialize()`. Config fallback chain: per-snapshot > per-page > global |
| `src/discovery.js` | V2 re-capture: detect `_fromSDK` + `domSnapshot` + readiness enabled → delete domSnapshot, clear root resource cache, set `page._readinessConfig` |
| `src/config.js` | Add `readiness` schema to snapshot config (presets, overrides). Add to snapshot common `$defs`. Add `readiness_diagnostics` to `/snapshot/dom` schema |
| `src/api.js` | Add `_fromSDK: true` to POST `/percy/snapshot` handler |
| `src/percy.js` | Import `Page`. Set `Page._globalReadinessConfig` from config in constructor. Reset on `stop()`. Preserve `_fromSDK` through validation |
| `test/unit/config.test.js` | 7 specs — schema validation for readiness |
| `test/percy.test.js` | 3 specs — global config, _fromSDK preservation |
| `test/discovery.test.js` | 2 specs — V2 disabled/non-SDK paths |
| `test/snapshot.test.js` | 3 specs — readiness options validation |
| `test/api.test.js` | 1 spec — _fromSDK flag on POST |

### Percy SDKs — Zero Changes

All SDKs already pass `...options` spread to `postSnapshot()`. The `readiness` key flows through automatically.

---

## POC Results

Validated with production Percy builds:

| Build | Type | Readiness | Content | URL |
|-------|------|-----------|---------|-----|
| #648 | Storybook | disabled | Skeleton loaders | [percy.io/...48445550](https://percy.io/9560f98d/web/Figma_test_shivanshu-17c329c0/builds/48445550) |
| #649 | Storybook | strict + notPresentSelectors | **Fully loaded** (3.6s) | [percy.io/...48445625](https://percy.io/9560f98d/web/Figma_test_shivanshu-17c329c0/builds/48445625) |
| #652 | SDK (via API) | disabled | Skeleton loaders | [percy.io/...48445785](https://percy.io/9560f98d/web/Figma_test_shivanshu-17c329c0/builds/48445785) |
| #653 | SDK (via API) | V2 re-capture | **Fully loaded** (1.9s) | [percy.io/...48445871](https://percy.io/9560f98d/web/Figma_test_shivanshu-17c329c0/builds/48445871) |

---

## Limitations

| Limitation | Reason | Workaround |
|------------|--------|------------|
| **Post-interaction state** (after click/form fill) | V2 re-captures from fresh page load — can't reproduce test interactions | None in V2. Per-snapshot `readiness: { preset: 'disabled' }` to fall back to SDK DOM |
| **Auth-protected pages** | CLI's Chromium has no session from test browser | Configure `discovery.authorization` or `discovery.cookies` in `.percy.yml` |
| **Performance overhead** | V2 re-capture means extra page navigation (~2-5s per snapshot) | Use `fast` preset or `disabled` for stable pages |
| **Shadow DOM mutations** | MutationObserver on main document doesn't see inside shadow roots | Use `readySelectors` targeting shadow host attributes |
| **iframe content** | Only checks top-level document readiness | Not in V1 scope |
| **setTimeout-based content without selectors** | DOM stability window may pass before timer fires if no DOM changes yet | Use `notPresentSelectors` to explicitly wait for loading indicators |
| **CSS animations modifying layout properties** | Continuous `width`/`height` animations will prevent stability | Animation properties like `transform`/`opacity` are filtered out |

---

## FAQ

### Does readiness run by default?

**No.** Readiness only activates when explicitly configured in `.percy.yml` or per-snapshot options. Without configuration, Percy behaves exactly as before.

### Do I need to update my SDKs?

**No.** All SDKs already pass through all options via `...options` spread. The `readiness` config from `.percy.yml` is loaded by the CLI, not by SDKs.

### How do I disable readiness for one snapshot?

```javascript
cy.percySnapshot('Static Page', { readiness: { preset: 'disabled' } });
```

### How do I disable readiness globally?

```yaml
# .percy.yml
snapshot:
  readiness:
    preset: disabled
```

### What's the performance impact?

- **Stable page, balanced preset:** ~300ms added (stability window)
- **Stable page, fast preset:** ~100ms added
- **V2 re-capture (SDK path):** ~2-5s added (extra navigation)
- **Unstable page hitting timeout:** Up to timeout_ms (default 10s)
- **disabled preset:** Zero overhead

### How does it interact with existing waitForSelector/waitForTimeout?

Existing options run first, then the readiness gate runs on top. They are complementary, not conflicting:

```
waitForTimeout → waitForSelector → execute hooks → network.idle()
    → insertPercyDom() → READINESS GATE → PercyDOM.serialize()
```

### What happens when readiness times out?

The snapshot is captured anyway with a warning in CLI output and diagnostic metadata attached. No build failure.

### Does readiness work with responsive snapshots?

Yes. The readiness gate runs once after initial navigation, not per-width. Per-width resizes have their own font + network idle waits.

---

## Running the POC Tests

```bash
# CLI test (two builds: with vs without readiness)
cd /Users/shivanshusingh/Documents/Percy/poc/readiness-v2-capture-level
export PERCY_TOKEN=<your_token>
node test-v2-compare.mjs

# Storybook test
cd /Users/shivanshusingh/Documents/Percy/percy-storybook
cat > .percy.yml << 'EOF'
version: 2
snapshot:
  readiness:
    preset: strict
    notPresentSelectors:
      - .skeleton
EOF
npx percy storybook /path/to/storybook-static

# @percy/dom unit tests
cd /Users/shivanshusingh/Documents/Percy/cli/packages/dom
yarn test
```
