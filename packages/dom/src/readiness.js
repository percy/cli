/* eslint-disable no-undef */
// Browser globals (performance, MutationObserver, document, window, getComputedStyle)
// are available in the browser execution context where this code runs.

// Readiness check presets
const PRESETS = {
  balanced: {
    stability_window_ms: 300,
    network_idle_window_ms: 200,
    timeout_ms: 10000,
    image_ready: true,
    font_ready: true,
    js_idle: true
  },
  strict: {
    stability_window_ms: 1000,
    network_idle_window_ms: 500,
    timeout_ms: 30000,
    image_ready: true,
    font_ready: true,
    js_idle: true
  },
  fast: {
    stability_window_ms: 100,
    network_idle_window_ms: 100,
    timeout_ms: 5000,
    image_ready: false,
    font_ready: true,
    js_idle: true
  }
};

const LAYOUT_ATTRIBUTES = new Set([
  'class', 'width', 'height', 'display', 'visibility',
  'position', 'src', 'href'
]);

const LAYOUT_STYLE_PROPS = /^(width|height|top|left|right|bottom|margin|padding|display|position|visibility|flex|grid|min-|max-|inset|gap|order|float|clear|overflow|z-index|columns)/;

/* istanbul ignore next: branches constrained by MutationObserver attributeFilter config */
function isLayoutMutation(mutation) {
  if (mutation.type === 'childList') return true;
  if (mutation.type === 'attributes') {
    let attr = mutation.attributeName;
    if (attr.startsWith('data-') || attr.startsWith('aria-')) return false;
    if (attr === 'style') {
      let oldStyle = mutation.oldValue || '';
      let newStyle = mutation.target.getAttribute('style') || '';
      return hasLayoutStyleChange(oldStyle, newStyle);
    }
    if (LAYOUT_ATTRIBUTES.has(attr)) return true;
  }
  return false;
}

/* istanbul ignore next: style change detection with layout property matching */
function hasLayoutStyleChange(oldStyle, newStyle) {
  if (oldStyle === newStyle) return false;
  let oldProps = parseStyleProps(oldStyle);
  let newProps = parseStyleProps(newStyle);
  let allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (let key of allKeys) {
    if (LAYOUT_STYLE_PROPS.test(key) && oldProps[key] !== newProps[key]) return true;
  }
  return false;
}

/* istanbul ignore next: internal helper for style string parsing */
function parseStyleProps(styleStr) {
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
      attributeFilter: [...LAYOUT_ATTRIBUTES, 'style']
    });
    timer = setTimeout(settle, stabilityWindowMs);

    // Cleanup on abort
    aborted.onAbort(() => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    });
  });
}

/* istanbul ignore next: network idle polling is browser-timing dependent */
function checkNetworkIdle(networkIdleWindowMs, aborted) {
  return new Promise(resolve => {
    let startTime = performance.now();
    let lastCount = performance.getEntriesByType('resource').length;
    let timer = null;
    let interval = setInterval(() => {
      if (aborted.value) { clearInterval(interval); return; }
      let count = performance.getEntriesByType('resource').length;
      /* istanbul ignore next: timer is always set before interval fires */
      if (count !== lastCount) { lastCount = count; if (timer) clearTimeout(timer); timer = setTimeout(settle, networkIdleWindowMs); }
    }, 50);

    function settle() { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - startTime) }); }
    timer = setTimeout(settle, networkIdleWindowMs);

    aborted.onAbort(() => { clearInterval(interval); if (timer) clearTimeout(timer); });
  });
}

function checkFontReady() {
  let start = performance.now();
  /* istanbul ignore next: cannot mock document.fonts API in browser tests */
  if (!document.fonts?.ready) return Promise.resolve({ passed: true, duration_ms: 0, skipped: true });
  return Promise.race([
    document.fonts.ready.then(() => ({ passed: true, duration_ms: Math.round(performance.now() - start) })),
    /* istanbul ignore next: font timeout requires 5s delay, impractical in tests */
    new Promise(r => setTimeout(() => r({ passed: false, duration_ms: 5000, timed_out: true }), 5000))
  ]);
}

/* istanbul ignore next: image loading and viewport checks are browser-timing dependent */
function checkImageReady(aborted) {
  return new Promise(resolve => {
    let start = performance.now();
    let vh = window.innerHeight;
    function getIncomplete() {
      let imgs = document.querySelectorAll('img');
      let incomplete = [];
      for (let img of imgs) {
        let r = img.getBoundingClientRect();
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
      if (aborted.value) { clearInterval(interval); return; }
      if (getIncomplete().length === 0) {
        clearInterval(interval);
        resolve({ passed: true, duration_ms: Math.round(performance.now() - start), images_checked: total, images_incomplete_at_start: incStart });
      }
    }, 100);

    aborted.onAbort(() => clearInterval(interval));
  });
}

/* istanbul ignore next: JS idle detection depends on browser runtime timing */
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

    // Tier 1: Long Task API — reset idle timer on each observed long task
    try {
      observer = new PerformanceObserver(list => {
        if (!observing || settled || aborted.value) return;
        for (let entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            longTaskCount++;
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(confirmIdle, idleWindowMs);
          }
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch (e) {
      // Long Task API not available — degrade to rIC/rAF-only path
      observer = null;
    }

    function cleanup() {
      settled = true;
      if (observer) observer.disconnect();
      if (idleTimer) clearTimeout(idleTimer);
    }

    function done(idleCallbackUsed) {
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
      if (settled || aborted.value) return;
      if (typeof requestIdleCallback === 'function') {
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
      if (aborted.value) return;
      observing = true;
      idleTimer = setTimeout(confirmIdle, idleWindowMs);
    });

    aborted.onAbort(() => cleanup());
  });
}

/* istanbul ignore next: selector polling and visibility checks are browser-timing dependent */
function checkReadySelectors(selectors, aborted) {
  if (!selectors?.length) return Promise.resolve({ passed: true, duration_ms: 0, selectors: [] });
  return new Promise(resolve => {
    let start = performance.now();
    function check() {
      for (let s of selectors) {
        let el = document.querySelector(s);
        if (!el) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'sticky') return false;
      }
      return true;
    }
    if (check()) { resolve({ passed: true, duration_ms: 0, selectors }); return; }
    let interval = setInterval(() => {
      if (aborted.value) { clearInterval(interval); return; }
      if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); }
    }, 100);

    aborted.onAbort(() => clearInterval(interval));
  });
}

/* istanbul ignore next: selector polling is browser-timing dependent */
function checkNotPresentSelectors(selectors, aborted) {
  if (!selectors?.length) return Promise.resolve({ passed: true, duration_ms: 0, selectors: [] });
  return new Promise(resolve => {
    let start = performance.now();
    function check() { for (let s of selectors) { if (document.querySelector(s)) return false; } return true; }
    if (check()) { resolve({ passed: true, duration_ms: 0, selectors }); return; }
    let interval = setInterval(() => {
      if (aborted.value) { clearInterval(interval); return; }
      if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); }
    }, 100);

    aborted.onAbort(() => clearInterval(interval));
  });
}

// --- Orchestrator ---

// Simple abort controller for browser context (no AbortController dependency)
function createAbortHandle() {
  let callbacks = [];
  return {
    value: false,
    onAbort(fn) { callbacks.push(fn); },
    abort() { this.value = true; callbacks.forEach(fn => fn()); callbacks = []; }
  };
}

// All expected check names — used to fill missing checks on timeout
const ALL_CHECKS = ['dom_stability', 'network_idle', 'font_ready', 'image_ready', 'js_idle', 'ready_selectors', 'not_present_selectors'];

async function runAllChecks(config, result, aborted) {
  let checks = [];
  let expected = [];
  if (config.stability_window_ms > 0) { expected.push('dom_stability'); checks.push(checkDOMStability(config.stability_window_ms, aborted).then(r => { result.checks.dom_stability = r; })); }
  if (config.network_idle_window_ms > 0) { expected.push('network_idle'); checks.push(checkNetworkIdle(config.network_idle_window_ms, aborted).then(r => { result.checks.network_idle = r; })); }
  if (config.font_ready !== false) { expected.push('font_ready'); checks.push(checkFontReady().then(r => { result.checks.font_ready = r; })); }
  if (config.image_ready !== false) { expected.push('image_ready'); checks.push(checkImageReady(aborted).then(r => { result.checks.image_ready = r; })); }
  if (config.js_idle !== false) { expected.push('js_idle'); checks.push(checkJSIdle(config.stability_window_ms, aborted).then(r => { result.checks.js_idle = r; })); }
  if (config.ready_selectors?.length) { expected.push('ready_selectors'); checks.push(checkReadySelectors(config.ready_selectors, aborted).then(r => { result.checks.ready_selectors = r; })); }
  if (config.not_present_selectors?.length) { expected.push('not_present_selectors'); checks.push(checkNotPresentSelectors(config.not_present_selectors, aborted).then(r => { result.checks.not_present_selectors = r; })); }
  result._expectedChecks = expected;
  await Promise.all(checks);
}

export async function waitForReady(options = {}) {
  let presetName = options.preset || 'balanced';
  if (presetName === 'disabled') return { passed: true, timed_out: false, skipped: true, checks: {} };

  let preset = PRESETS[presetName] || PRESETS.balanced;
  let config = { ...preset, ...options };
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

  // Mark any checks that didn't complete before timeout as failed
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
