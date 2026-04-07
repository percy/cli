// Readiness check presets
const PRESETS = {
  balanced: {
    stability_window_ms: 300,
    network_idle_window_ms: 200,
    timeout_ms: 10000,
    image_ready: true,
    font_ready: true
  },
  strict: {
    stability_window_ms: 1000,
    network_idle_window_ms: 500,
    timeout_ms: 30000,
    image_ready: true,
    font_ready: true
  },
  fast: {
    stability_window_ms: 100,
    network_idle_window_ms: 100,
    timeout_ms: 5000,
    image_ready: false,
    font_ready: true
  }
};

const LAYOUT_ATTRIBUTES = new Set([
  'class', 'width', 'height', 'display', 'visibility',
  'position', 'src', 'href'
]);

const LAYOUT_STYLE_PROPS = /^(width|height|top|left|right|bottom|margin|padding|display|position|visibility|flex|grid|min-|max-|inset|gap|order|float|clear|overflow|z-index|columns)/;

function isLayoutMutation(mutation) {
  if (mutation.type === 'childList') return true;
  if (mutation.type === 'attributes') {
    let attr = mutation.attributeName;
    if (attr.startsWith('data-') || attr.startsWith('aria-')) return false;
    if (LAYOUT_ATTRIBUTES.has(attr)) {
      if (attr === 'style') {
        let oldStyle = mutation.oldValue || '';
        let newStyle = mutation.target.getAttribute('style') || '';
        return hasLayoutStyleChange(oldStyle, newStyle);
      }
      return true;
    }
  }
  return false;
}

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

function checkDOMStability(stabilityWindowMs) {
  return new Promise(resolve => {
    let startTime = performance.now();
    let timer = null;
    let mutationCount = 0;
    let lastMutationType = null;

    let observer = new MutationObserver(mutations => {
      let hasLayout = false;
      for (let m of mutations) {
        if (isLayoutMutation(m)) { hasLayout = true; mutationCount++; lastMutationType = m.type; }
      }
      if (hasLayout) { if (timer) clearTimeout(timer); timer = setTimeout(settle, stabilityWindowMs); }
    });

    function settle() {
      observer.disconnect();
      resolve({ passed: true, duration_ms: Math.round(performance.now() - startTime), mutations_observed: mutationCount, last_mutation_type: lastMutationType });
    }

    observer.observe(document.documentElement, {
      childList: true, attributes: true, attributeOldValue: true, subtree: true,
      attributeFilter: [...LAYOUT_ATTRIBUTES, 'style']
    });
    timer = setTimeout(settle, stabilityWindowMs);
  });
}

function checkNetworkIdle(networkIdleWindowMs) {
  return new Promise(resolve => {
    let startTime = performance.now();
    let lastCount = performance.getEntriesByType('resource').length;
    let timer = null;
    let interval = setInterval(() => {
      let count = performance.getEntriesByType('resource').length;
      if (count !== lastCount) { lastCount = count; if (timer) clearTimeout(timer); timer = setTimeout(settle, networkIdleWindowMs); }
    }, 50);

    function settle() { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - startTime) }); }
    timer = setTimeout(settle, networkIdleWindowMs);
  });
}

function checkFontReady() {
  let start = performance.now();
  if (!document.fonts?.ready) return Promise.resolve({ passed: true, duration_ms: 0, skipped: true });
  return Promise.race([
    document.fonts.ready.then(() => ({ passed: true, duration_ms: Math.round(performance.now() - start) })),
    new Promise(r => setTimeout(() => r({ passed: false, duration_ms: 5000, timed_out: true }), 5000))
  ]);
}

function checkImageReady() {
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
      if (getIncomplete().length === 0) {
        clearInterval(interval);
        resolve({ passed: true, duration_ms: Math.round(performance.now() - start), images_checked: total, images_incomplete_at_start: incStart });
      }
    }, 100);
  });
}

function checkReadySelectors(selectors) {
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
    let interval = setInterval(() => { if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); } }, 100);
  });
}

function checkNotPresentSelectors(selectors) {
  if (!selectors?.length) return Promise.resolve({ passed: true, duration_ms: 0, selectors: [] });
  return new Promise(resolve => {
    let start = performance.now();
    function check() { for (let s of selectors) { if (document.querySelector(s)) return false; } return true; }
    if (check()) { resolve({ passed: true, duration_ms: 0, selectors }); return; }
    let interval = setInterval(() => { if (check()) { clearInterval(interval); resolve({ passed: true, duration_ms: Math.round(performance.now() - start), selectors }); } }, 100);
  });
}

// --- Orchestrator ---

async function runAllChecks(config, result) {
  let checks = [];
  if (config.stability_window_ms > 0) checks.push(checkDOMStability(config.stability_window_ms).then(r => { result.checks.dom_stability = r; }));
  if (config.network_idle_window_ms > 0) checks.push(checkNetworkIdle(config.network_idle_window_ms).then(r => { result.checks.network_idle = r; }));
  if (config.font_ready !== false) checks.push(checkFontReady().then(r => { result.checks.font_ready = r; }));
  if (config.image_ready !== false) checks.push(checkImageReady().then(r => { result.checks.image_ready = r; }));
  if (config.ready_selectors?.length) checks.push(checkReadySelectors(config.ready_selectors).then(r => { result.checks.ready_selectors = r; }));
  if (config.not_present_selectors?.length) checks.push(checkNotPresentSelectors(config.not_present_selectors).then(r => { result.checks.not_present_selectors = r; }));
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

  try {
    await Promise.race([
      runAllChecks(config, result).then(() => { settled = true; }),
      new Promise(resolve => setTimeout(() => { if (!settled) result.timed_out = true; resolve(); }, effectiveTimeout))
    ]);
  } catch (error) {
    result.error = error.message || String(error);
  }

  result.total_duration_ms = Math.round(performance.now() - startTime);
  result.passed = !result.timed_out && !result.error && Object.values(result.checks).every(c => c.passed);
  return result;
}

export { PRESETS };
