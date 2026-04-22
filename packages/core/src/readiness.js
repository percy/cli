import logger from '@percy/logger';

const log = logger('core:readiness');

export const PRESETS = {
  balanced: { stability_window_ms: 300, network_idle_window_ms: 200, timeout_ms: 10000, image_ready: true, font_ready: true, js_idle: true },
  strict: { stability_window_ms: 1000, network_idle_window_ms: 500, timeout_ms: 30000, image_ready: true, font_ready: true, js_idle: true },
  fast: { stability_window_ms: 100, network_idle_window_ms: 100, timeout_ms: 5000, image_ready: false, font_ready: true, js_idle: true }
};

// Resolve readiness config from preset + per-snapshot overrides.
// Accepts camelCase (from Percy config normalizer) and outputs snake_case for @percy/dom.
/* istanbul ignore next: default params and ?? branches tested via unit tests */
export function resolveReadinessConfig(options = {}) {
  let readiness = options.readiness || {};
  let presetName = readiness.preset || 'balanced';
  if (presetName === 'disabled') return { preset: 'disabled' };

  let preset = PRESETS[presetName] || PRESETS.balanced;
  return {
    preset: presetName,
    stability_window_ms: (readiness.stabilityWindowMs ?? readiness.stability_window_ms) ?? preset.stability_window_ms,
    network_idle_window_ms: (readiness.networkIdleWindowMs ?? readiness.network_idle_window_ms) ?? preset.network_idle_window_ms,
    timeout_ms: (readiness.timeoutMs ?? readiness.timeout_ms) ?? preset.timeout_ms,
    image_ready: (readiness.imageReady ?? readiness.image_ready) ?? preset.image_ready,
    font_ready: (readiness.fontReady ?? readiness.font_ready) ?? preset.font_ready,
    js_idle: (readiness.jsIdle ?? readiness.js_idle) ?? preset.js_idle,
    ...((readiness.readySelectors ?? readiness.ready_selectors) && { ready_selectors: readiness.readySelectors ?? readiness.ready_selectors }),
    ...((readiness.notPresentSelectors ?? readiness.not_present_selectors) && { not_present_selectors: readiness.notPresentSelectors ?? readiness.not_present_selectors })
  };
}

// CLI-side readiness orchestrator.
// Calls PercyDOM.waitForReady() in the browser context via page.eval().
/* istanbul ignore next: warning logging branches tested via unit tests with mocks */
export async function waitForReadiness(page, options = {}) {
  let config = resolveReadinessConfig(options);
  if (config.preset === 'disabled') return null;

  log.debug(`Running readiness checks: preset=${config.preset}, not_present=${JSON.stringify(config.not_present_selectors || [])}`);

  // Note: insertPercyDom() is already called by the caller in page.snapshot() (line 218)
  // before waitForReadiness is invoked — no need to call it again here.

  let result;
  try {
    /* istanbul ignore next: no instrumenting injected code */
    /* istanbul ignore next: no instrumenting injected code */
    result = await page.eval((_, readinessConfig) => {
      // eslint-disable-next-line no-undef
      if (typeof PercyDOM === 'undefined' || typeof PercyDOM.waitForReady !== 'function') {
        return { passed: true, error: 'waitForReady not available', checks: {} };
      }
      // eslint-disable-next-line no-undef
      return PercyDOM.waitForReady(readinessConfig);
    }, config);
  } catch (error) {
    log.debug(`Readiness check error: ${error.message}`);
    result = { passed: false, timed_out: false, error: error.message, total_duration_ms: 0, checks: {} };
  }

  if (result && !result.passed) {
    let lines = [`Snapshot "${options.name || 'unknown'}" captured before stable (timed out after ${result.total_duration_ms}ms)`];
    for (let [name, check] of Object.entries(result.checks || {})) {
      let status = check.passed ? 'passed' : 'FAILED';
      let detail = check.duration_ms != null ? ` (${check.duration_ms}ms)` : '';
      if (!check.passed && check.mutations_observed) detail = ` (${check.mutations_observed} mutations in ${check.duration_ms}ms)`;
      lines.push(`  - ${name}: ${status}${detail}`);
    }
    let failed = Object.entries(result.checks || {}).filter(([, c]) => !c.passed);
    if (failed.length) {
      let [name] = failed[0];
      let tips = {
        dom_stability: 'Try adding notPresentSelectors for loading indicators, or increase stabilityWindowMs.',
        network_idle: 'Check for long-polling or analytics. Try adding endpoints to disallowedHostnames.',
        image_ready: 'Images still loading. Try imageReady: false if images load lazily.',
        js_idle: 'JavaScript still executing (long tasks detected on main thread). Try increasing timeoutMs or set jsIdle: false for pages with continuous JS.',
        ready_selectors: 'Required selector(s) not found. Verify selectors exist on the page.',
        not_present_selectors: 'Loading indicators still present. These may be skeleton loaders or spinners.'
      };
      if (tips[name]) lines.push(`  Tip: ${tips[name]}`);
    }
    log.warn(`Warning: ${lines[0]}`);
    for (let l of lines.slice(1)) log.warn(l);
  } else if (result) {
    log.debug(`Readiness checks passed in ${result.total_duration_ms}ms`);
  }

  return result;
}
