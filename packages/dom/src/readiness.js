/* eslint-disable no-undef */
// Browser globals (performance, MutationObserver, document, window, getComputedStyle)
// are available in the browser execution context where this code runs.

// Readiness check presets
//
// `js_idle_window_ms` is separate from `stability_window_ms` on purpose:
// DOM stability and main-thread idleness measure different things. With
// the `strict` preset we want a long DOM-stability window (1000ms) but
// not necessarily 1000ms of no long tasks — that would cause unnecessary
// timeouts on pages with normal JS activity. Both windows are
// independently configurable but default to reasonable values per preset.
const PRESETS = {
  balanced: {
    stability_window_ms: 300,
    js_idle_window_ms: 300,
    network_idle_window_ms: 200,
    timeout_ms: 10000,
    image_ready: true,
    font_ready: true,
    js_idle: true
  },
  strict: {
    stability_window_ms: 1000,
    js_idle_window_ms: 500,
    network_idle_window_ms: 500,
    timeout_ms: 30000,
    image_ready: true,
    font_ready: true,
    js_idle: true
  },
  fast: {
    stability_window_ms: 100,
    js_idle_window_ms: 100,
    network_idle_window_ms: 100,
    timeout_ms: 5000,
    image_ready: false,
    font_ready: true,
    js_idle: true
  }
};

const LAYOUT_ATTRIBUTES = new Set([
  'class', 'width', 'height', 'display', 'visibility',
  'position', 'src'
]);

const LAYOUT_STYLE_PROPS = /^(width|height|top|left|right|bottom|margin|padding|display|position|visibility|flex|grid|min-|max-|inset|gap|order|float|clear|overflow|z-index|columns)/;

// Exported for direct unit testing — logic is deterministic and does not
// depend on browser timing, so it should not be covered only indirectly
// through MutationObserver-driven integration tests.
export function isLayoutMutation(mutation) {
  if (mutation.type === 'childList') return true;
  if (mutation.type === 'attributes') {
    let attr = mutation.attributeName;
    if (attr.startsWith('data-') || attr.startsWith('aria-')) return false;
    if (attr === 'style') {
      let oldStyle = mutation.oldValue || '';
      let newStyle = mutation.target.getAttribute('style') || '';
      return hasLayoutStyleChange(oldStyle, newStyle);
    }
    // href is only layout-affecting on <link> elements (stylesheets).
    // On <a> tags changing href is a no-op for layout.
    if (attr === 'href') return mutation.target.tagName === 'LINK';
    if (LAYOUT_ATTRIBUTES.has(attr)) return true;
  }
  return false;
}

export function hasLayoutStyleChange(oldStyle, newStyle) {
  if (oldStyle === newStyle) return false;
  let oldProps = parseStyleProps(oldStyle);
  let newProps = parseStyleProps(newStyle);
  let allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (let key of allKeys) {
    if (LAYOUT_STYLE_PROPS.test(key) && oldProps[key] !== newProps[key]) return true;
  }
  return false;
}

export function parseStyleProps(styleStr) {
  let props = {};
  if (!styleStr) return props;
  for (let part of styleStr.split(';')) {
    let i = part.indexOf(':');
    if (i > 0) {
      let key = part.slice(0, i).trim().toLowerCase();
      if (key) props[key] = part.slice(i + 1).trim();
    }
  }
  return props;
}

// Resolve a single ready/notPresent selector to a DOM Element. Accepts:
//   - CSS string:                  '.app-loaded'
//   - XPath string:                '//div[@id="root"]'  (sniffed by leading /, //, ./, (/, (./)
//   - Object form (explicit):      { css: '.foo' } | { xpath: '//bar' }
// Returns the matched Element, or null when no element matches, the
// selector is malformed, or it resolves to a non-Element node.
//
// Exported for direct unit testing.
const XPATH_SNIFF = /^\(?\.?\//;
export function resolveSelector(selector) {
  if (!selector) return null;
  let xpath = null;
  let css = null;
  if (typeof selector === 'object') {
    if (selector.xpath) xpath = selector.xpath;
    else if (selector.css) css = selector.css;
    else return null;
  } else if (typeof selector === 'string') {
    if (XPATH_SNIFF.test(selector)) xpath = selector;
    else css = selector;
  } else {
    return null;
  }
  try {
    let el = xpath
      ? document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      : document.querySelector(css);
    return el instanceof Element ? el : null;
  } catch (e) {
    // Malformed XPath or invalid CSS — treat as no-match so the selector
    // gate keeps polling rather than blowing up the entire readiness gate.
    return null;
  }
}

// Subscribe to PerformanceObserver entries of a given type. Returns the
// observer (for the caller to disconnect) or null when PerformanceObserver
// (or the requested entry type) is unavailable, so callers can fall back.
//
// Used by checkNetworkIdle (`resource`) and checkJSIdle (`longtask`) to
// avoid duplicating the try/observe/disconnect boilerplate.
function observePerformance(type, onEntries) {
  try {
    let observer = new PerformanceObserver(list => onEntries(list.getEntries()));
    observer.observe({ type, buffered: false });
    return observer;
  } catch (e) /* istanbul ignore next: PerformanceObserver is available in Chrome/Firefox; catch is for old browsers */ {
    return null;
  }
}

// --- Individual Checks ---
// Each check accepts an `aborted` object ({ value: boolean }) so the orchestrator
// can signal cancellation on timeout. Checks must clean up timers/observers on abort.

function checkDOMStability(stabilityWindowMs, aborted) {
  return new Promise(resolve => {
    let startTime = performance.now();
    let timer = null;
    let mutationCount = 0;
    let lastMutationType = null;

    let observer = new MutationObserver(mutations => {
      /* istanbul ignore next: abort disconnects the observer synchronously, defensive dead code in tests */
      if (aborted.value) return;
      let hasLayout = false;
      for (let m of mutations) {
        if (isLayoutMutation(m)) { hasLayout = true; mutationCount++; lastMutationType = m.type; }
      }
      /* istanbul ignore next: timer is always set before observer fires */
      if (hasLayout) { if (timer) clearTimeout(timer); timer = setTimeout(settle, stabilityWindowMs); }
    });

    function settle() {
      observer.disconnect();
      resolve({
        passed: true,
        duration_ms: Math.round(performance.now() - startTime),
        mutations_observed: mutationCount,
        last_mutation_type: lastMutationType
      });
    }

    observer.observe(document.documentElement, {
      childList: true,
      attributes: true,
      attributeOldValue: true,
      subtree: true,
      attributeFilter: [...LAYOUT_ATTRIBUTES, 'style', 'href']
    });
    timer = setTimeout(settle, stabilityWindowMs);

    // Cleanup on abort
    aborted.onAbort(() => {
      /* istanbul ignore next: timer is always set at line 124 before abort can fire */
      if (timer) clearTimeout(timer);
      observer.disconnect();
    });
  });
}

function checkNetworkIdle(networkIdleWindowMs, aborted) {
  return new Promise(resolve => {
    let startTime = performance.now();
    let timer = null;
    let pollInterval = null;

    function settle() {
      /* istanbul ignore next: observer is only null on fallback path (itself ignored) */
      if (observer) observer.disconnect();
      /* istanbul ignore next: fallback polling path only used when PerformanceObserver is unavailable */
      if (pollInterval) clearInterval(pollInterval);
      resolve({ passed: true, duration_ms: Math.round(performance.now() - startTime) });
    }

    function resetIdleTimer() {
      /* istanbul ignore next: timer is always set before any resource entry arrives */
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, networkIdleWindowMs);
    }

    /* istanbul ignore next: observer callback body only runs if a network resource loads during the idle window */
    let observer = observePerformance('resource', entries => {
      if (aborted.value) return;
      if (entries.length > 0) resetIdleTimer();
    });

    /* istanbul ignore next: PerformanceObserver fallback only triggers in older browsers */
    if (!observer) {
      let lastCount = performance.getEntriesByType('resource').length;
      pollInterval = setInterval(() => {
        if (aborted.value) { clearInterval(pollInterval); return; }
        let count = performance.getEntriesByType('resource').length;
        if (count !== lastCount) { lastCount = count; resetIdleTimer(); }
      }, 50);
    }

    // Start the initial idle window.
    timer = setTimeout(settle, networkIdleWindowMs);

    aborted.onAbort(() => {
      /* istanbul ignore next: observer is only null on fallback path (itself ignored) */
      if (observer) observer.disconnect();
      /* istanbul ignore next: pollInterval is only set on the fallback path */
      if (pollInterval) clearInterval(pollInterval);
      /* istanbul ignore next: timer is always set before abort can fire */
      if (timer) clearTimeout(timer);
    });
  });
}

function checkFontReady(aborted) {
  let start = performance.now();
  /* istanbul ignore next: cannot mock document.fonts API in browser tests */
  if (!document.fonts?.ready) return Promise.resolve({ passed: true, duration_ms: 0, skipped: true });
  let fontTimer;
  let resolveAbort;
  // Resolve deterministically on abort so the race is settled by the orchestrator's timeout
  // path and doesn't get retroactively flipped to { passed: true } when document.fonts.ready
  // settles late. Important if we ever begin reading checks.font_ready post-timeout.
  let abortPromise = new Promise(r => { resolveAbort = r; });
  let result = Promise.race([
    document.fonts.ready.then(() => ({ passed: true, duration_ms: Math.round(performance.now() - start) })),
    /* istanbul ignore next: font timeout requires 5s delay, impractical in tests */
    new Promise(r => { fontTimer = setTimeout(() => r({ passed: false, duration_ms: 5000, timed_out: true }), 5000); }),
    abortPromise
  ]);
  /* istanbul ignore next: abort path not deterministically testable */
  if (aborted) {
    aborted.onAbort(() => {
      if (fontTimer) clearTimeout(fontTimer);
      resolveAbort({ passed: false, duration_ms: Math.round(performance.now() - start), aborted: true });
    });
  }
  return result;
}

function checkImageReady(aborted) {
  return new Promise(resolve => {
    let start = performance.now();
    let vh = window.innerHeight;
    function getIncomplete() {
      let imgs = document.querySelectorAll('img');
      let incomplete = [];
      for (let img of imgs) {
        let r = img.getBoundingClientRect();
        /* istanbul ignore else: test images are always placed in the viewport with non-zero dimensions */
        if (r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0) {
          if (!img.complete || img.naturalWidth === 0) incomplete.push(img);
        }
      }
      return incomplete;
    }
    let total = document.querySelectorAll('img').length;
    let incStart = getIncomplete().length;
    if (incStart === 0) { resolve({ passed: true, duration_ms: 0, images_checked: total, images_incomplete_at_start: 0 }); return; }
    let interval = setInterval(() => {
      /* istanbul ignore next: abort clears the interval synchronously, defensive dead code in tests */
      if (aborted.value) { clearInterval(interval); return; }
      /* istanbul ignore next: requires network latency — images load synchronously in tests with data: URLs */
      if (getIncomplete().length === 0) {
        clearInterval(interval);
        resolve({ passed: true, duration_ms: Math.round(performance.now() - start), images_checked: total, images_incomplete_at_start: incStart });
      }
    }, 100);

    /* istanbul ignore next: abort-on-timeout path; only fires when images never load in time */
    aborted.onAbort(() => clearInterval(interval));
  });
}

function checkJSIdle(idleWindowMs, aborted) {
  // Three-tier JS idle detection — purely observational, no monkey-patching:
  // Tier 1: Long Task API (PerformanceObserver) — detects main-thread tasks >50ms
  // Tier 2: requestIdleCallback — confirms browser idle (fallback: setTimeout 200ms)
  // Tier 3: Double-requestAnimationFrame — ensures render/paint cycle is complete
  return new Promise(resolve => {
    let start = performance.now();
    let longTaskCount = 0;
    let idleTimer = null;
    let observer = null;
    let settled = false;
    let observing = false;

    // Tier 1: Long Task API — reset idle timer on each observed long task.
    // observePerformance returns null on older browsers; we degrade to the
    // rIC/rAF-only path in that case.
    /* istanbul ignore next: longtask callback fires only on CPU-heavy >50ms tasks, not reliable in tests */
    observer = observePerformance('longtask', entries => {
      if (!observing || settled || aborted.value) return;
      for (let entry of entries) {
        if (entry.entryType === 'longtask') {
          longTaskCount++;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(confirmIdle, idleWindowMs);
        }
      }
    });

    function cleanup() {
      settled = true;
      /* istanbul ignore next: defensive — observer is always set except when Long Task API fails (itself ignored) */
      if (observer) observer.disconnect();
      /* istanbul ignore next: defensive — idleTimer may be null between cleanup calls from multiple abort paths */
      if (idleTimer) clearTimeout(idleTimer);
    }

    function done(idleCallbackUsed) {
      /* istanbul ignore next: defensive — re-entry guard for race between done/cleanup/abort */
      if (settled || aborted.value) return;
      cleanup();
      resolve({
        passed: true,
        duration_ms: Math.round(performance.now() - start),
        long_tasks_observed: longTaskCount,
        idle_callback_used: idleCallbackUsed
      });
    }

    // Tier 2: requestIdleCallback confirmation (or fallback)
    function confirmIdle() {
      /* istanbul ignore next: defensive re-entry guard — confirmIdle can be scheduled multiple times */
      if (settled || aborted.value) return;
      /* istanbul ignore else: rIC is available in modern Chrome/Firefox — fallback is for older browsers */
      if (typeof requestIdleCallback === 'function') {
        /* istanbul ignore next: rIC timeout only fires if requestIdleCallback takes longer than idleWindowMs * 2 — cleared by rIC callback in normal runs */
        let ricTimer = setTimeout(() => doubleRAF(false), idleWindowMs * 2);
        requestIdleCallback(() => {
          clearTimeout(ricTimer);
          doubleRAF(true);
        });
        aborted.onAbort(() => clearTimeout(ricTimer));
      } else {
        let fallbackTimer = setTimeout(() => doubleRAF(false), 200);
        aborted.onAbort(() => clearTimeout(fallbackTimer));
      }
    }

    // Tier 3: Double-rAF render gate
    function doubleRAF(usedRIC) {
      /* istanbul ignore next: defensive re-entry guard — doubleRAF can be scheduled from multiple paths */
      if (settled || aborted.value) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          done(usedRIC);
        });
      });
    }

    // Start: skip first frame to avoid detecting Percy's own insertPercyDom() setup,
    // then begin idle window
    requestAnimationFrame(() => {
      /* istanbul ignore next: abort only fires during timeout race, not on first rAF in tests */
      if (aborted.value) return;
      observing = true;
      idleTimer = setTimeout(confirmIdle, idleWindowMs);
    });

    aborted.onAbort(() => cleanup());
  });
}

function checkReadySelectors(selectors, aborted) {
  /* istanbul ignore next: orchestrator only calls this when selectors.length > 0; defensive for direct callers */
  if (!selectors?.length) return Promise.resolve({ passed: true, duration_ms: 0, selectors: [] });
  return new Promise(resolve => {
    let start = performance.now();
    function check() {
      for (let s of selectors) {
        let el = resolveSelector(s);
        if (!el) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'sticky') return false;
      }
      return true;
    }
    if (check()) { resolve({ passed: true, duration_ms: 0, selectors }); return; }
    let interval = setInterval(() => {
      /* istanbul ignore next: abort clears the interval synchronously, defensive dead code in tests */
      if (aborted.value) { clearInterval(interval); return; }
      if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); }
    }, 100);

    aborted.onAbort(() => clearInterval(interval));
  });
}

function checkNotPresentSelectors(selectors, aborted) {
  /* istanbul ignore next: orchestrator only calls this when selectors.length > 0; defensive for direct callers */
  if (!selectors?.length) return Promise.resolve({ passed: true, duration_ms: 0, selectors: [] });
  return new Promise(resolve => {
    let start = performance.now();
    function check() { for (let s of selectors) { if (resolveSelector(s)) return false; } return true; }
    if (check()) { resolve({ passed: true, duration_ms: 0, selectors }); return; }
    let interval = setInterval(() => {
      /* istanbul ignore next: abort clears the interval synchronously, defensive dead code in tests */
      if (aborted.value) { clearInterval(interval); return; }
      if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); }
    }, 100);

    /* istanbul ignore next: abort-on-timeout path; only fires when the excluded selector never disappears */
    aborted.onAbort(() => clearInterval(interval));
  });
}

// --- Orchestrator ---

// Simple abort controller for browser context (no AbortController dependency).
// Exported for direct unit testing.
export function createAbortHandle() {
  let callbacks = [];
  return {
    value: false,
    onAbort(fn) { callbacks.push(fn); },
    abort() { this.value = true; callbacks.forEach(fn => fn()); callbacks = []; }
  };
}

async function runAllChecks(config, result, aborted) {
  let checks = [];
  let expected = [];
  if (config.stability_window_ms > 0) { expected.push('dom_stability'); checks.push(checkDOMStability(config.stability_window_ms, aborted).then(r => { result.checks.dom_stability = r; })); }
  if (config.network_idle_window_ms > 0) { expected.push('network_idle'); checks.push(checkNetworkIdle(config.network_idle_window_ms, aborted).then(r => { result.checks.network_idle = r; })); }
  if (config.font_ready !== false) { expected.push('font_ready'); checks.push(checkFontReady(aborted).then(r => { result.checks.font_ready = r; })); }
  if (config.image_ready !== false) { expected.push('image_ready'); checks.push(checkImageReady(aborted).then(r => { result.checks.image_ready = r; })); }
  if (config.js_idle !== false) {
    expected.push('js_idle');
    // Fall back to stability_window_ms if js_idle_window_ms is not set.
    // All built-in presets set js_idle_window_ms, so this fallback only
    // fires when a caller passes a custom config that predates the
    // dedicated option — preserves backward compatibility.
    /* istanbul ignore next: fallback only hit by pre-js_idle_window_ms configs; built-in presets always set it */
    let jsIdleWindow = config.js_idle_window_ms ?? config.stability_window_ms;
    checks.push(checkJSIdle(jsIdleWindow, aborted).then(r => { result.checks.js_idle = r; }));
  }
  if (config.ready_selectors?.length) { expected.push('ready_selectors'); checks.push(checkReadySelectors(config.ready_selectors, aborted).then(r => { result.checks.ready_selectors = r; })); }
  if (config.not_present_selectors?.length) { expected.push('not_present_selectors'); checks.push(checkNotPresentSelectors(config.not_present_selectors, aborted).then(r => { result.checks.not_present_selectors = r; })); }
  result._expectedChecks = expected;
  await Promise.all(checks);
}

// Normalize camelCase config keys (from .percy.yml / SDK options) to the
// snake_case keys used internally. Accepts either naming.
// Exported for direct unit testing.
export function normalizeOptions(options = {}) {
  return {
    preset: options.preset,
    stability_window_ms: options.stabilityWindowMs ?? options.stability_window_ms,
    js_idle_window_ms: options.jsIdleWindowMs ?? options.js_idle_window_ms,
    network_idle_window_ms: options.networkIdleWindowMs ?? options.network_idle_window_ms,
    timeout_ms: options.timeoutMs ?? options.timeout_ms,
    image_ready: options.imageReady ?? options.image_ready,
    font_ready: options.fontReady ?? options.font_ready,
    js_idle: options.jsIdle ?? options.js_idle,
    ready_selectors: options.readySelectors ?? options.ready_selectors,
    not_present_selectors: options.notPresentSelectors ?? options.not_present_selectors,
    max_timeout_ms: options.maxTimeoutMs ?? options.max_timeout_ms
  };
}

export async function waitForReady(options = {}) {
  let presetName = options.preset || 'balanced';
  if (presetName === 'disabled') return { passed: true, timed_out: false, skipped: true, checks: {} };

  let preset = PRESETS[presetName] || PRESETS.balanced;
  // Normalize user options to snake_case, then merge. Only overrides
  // where user explicitly provided a value (undefined keys don't overwrite).
  let userOptions = normalizeOptions(options);
  let config = { ...preset };
  for (let key of Object.keys(userOptions)) {
    if (userOptions[key] !== undefined) config[key] = userOptions[key];
  }
  let effectiveTimeout = config.max_timeout_ms ? Math.min(config.timeout_ms, config.max_timeout_ms) : config.timeout_ms;

  let startTime = performance.now();
  let result = { passed: false, timed_out: false, preset: presetName, checks: {} };
  let settled = false;
  let aborted = createAbortHandle();

  try {
    await Promise.race([
      runAllChecks(config, result, aborted).then(() => { settled = true; }),
      new Promise(resolve => setTimeout(() => {
        if (!settled) {
          result.timed_out = true;
          // Abort all running checks — clears intervals, disconnects observers
          aborted.abort();
        }
        resolve();
      }, effectiveTimeout))
    ]);
  } catch (error) {
    /* istanbul ignore next: safety net for unexpected errors in readiness checks */
    result.error = error.message || String(error);
  }

  // Mark any checks that didn't complete before timeout as failed.
  // `_expectedChecks` is always set by runAllChecks, but coverage here
  // depends on whether any expected check was skipped due to timeout.
  /* istanbul ignore next: only falsy when the catch block above fires before runAllChecks sets _expectedChecks */
  if (result._expectedChecks) {
    for (let name of result._expectedChecks) {
      if (!result.checks[name]) {
        result.checks[name] = { passed: false, timed_out: true };
      }
    }
    delete result._expectedChecks;
  }

  result.total_duration_ms = Math.round(performance.now() - startTime);
  result.passed = !result.timed_out && !result.error && Object.values(result.checks).every(c => c.passed);
  return result;
}

export { PRESETS };
