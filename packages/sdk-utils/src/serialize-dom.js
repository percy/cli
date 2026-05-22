import percy from './percy-info.js';

// Returns the readiness config for a snapshot.
// Shallow-merge of global .percy.yml config with per-snapshot overrides:
// per-snapshot keys win, unspecified keys are inherited from the global config.
// SDKs obtain percy.config via the healthcheck endpoint in isPercyEnabled().
//
// Why shallow-merge instead of `||`:
//   - `options.readiness = {}` would otherwise wipe the global config entirely.
//   - A partial per-snapshot override like `{ stabilityWindowMs: 500 }` would
//     drop a global `preset: disabled` kill switch — silently re-enabling the
//     gate for a snapshot the user thought was opted out.
export function getReadinessConfig(snapshotOptions = {}) {
  return {
    ...(percy.config?.snapshot?.readiness || {}),
    ...(snapshotOptions?.readiness || {})
  };
}

// Returns true if readiness should be skipped for this snapshot.
export function isReadinessDisabled(snapshotOptions = {}) {
  let config = getReadinessConfig(snapshotOptions);
  return config?.preset === 'disabled';
}

// Returns a JavaScript code string that SDKs evaluate in the browser
// to run readiness checks BEFORE serialize.
//
// This is the READINESS-ONLY call. Serialize stays as a separate sync call.
// The two-call pattern:
//   1. await evaluate(waitForReadyScript(config))     — async, readiness
//   2. evaluate('return PercyDOM.serialize(options)')  — sync, unchanged
//
// Usage:
//   // Puppeteer/Playwright (page.evaluate auto-awaits):
//   await page.evaluate(waitForReadyScript(config));
//
//   // Selenium (executeAsyncScript with callback):
//   driver.execute_async_script(waitForReadyScript(config, { callback: true }));
//
// Graceful degradation:
//   - If PercyDOM.waitForReady is not available (old CLI): resolves immediately
//   - If waitForReady throws: resolves immediately (catch swallows the error)
//   - If readiness times out: waitForReady resolves with { timed_out: true }
//
// IMPORTANT: The output is intended for CDP / executeScript / executeAsyncScript channels.
// Do NOT inline this string into HTML — `</script>` sequences in user config would break out
// of a <script> tag. SDK authors must add HTML escaping before any HTML-inline use.
export function waitForReadyScript(readinessConfig = {}, { callback = false } = {}) {
  // U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid in JSON strings but
  // were illegal in JS source string literals before ES2019. Escaping them keeps the emitted
  // script source legal on older engines that may host the SDK eval.
  let config = JSON.stringify(readinessConfig)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  if (callback) {
    // For executeAsyncScript — last argument is the callback
    return `
      var done = arguments[arguments.length - 1];
      try {
        if (typeof PercyDOM !== 'undefined' && typeof PercyDOM.waitForReady === 'function') {
          PercyDOM.waitForReady(${config}).then(function(r) { done(r); }).catch(function() { done(); });
        } else { done(); }
      } catch(e) { done(); }
    `;
  }

  // For page.evaluate (auto-await Promises)
  return `
    if (typeof PercyDOM !== 'undefined' && typeof PercyDOM.waitForReady === 'function') {
      return PercyDOM.waitForReady(${config});
    }
  `;
}

export default waitForReadyScript;
