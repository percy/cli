import percy from './percy-info.js';

// Returns the readiness config for a snapshot.
// Priority: per-snapshot options > global percy.config > empty object (triggers balanced default).
// SDKs obtain percy.config via the healthcheck endpoint in isPercyEnabled().
export function getReadinessConfig(snapshotOptions = {}) {
  return snapshotOptions?.readiness ||
    percy.config?.snapshot?.readiness ||
    {};
}

// Returns true if readiness should be skipped for this snapshot.
export function isReadinessDisabled(snapshotOptions = {}) {
  let config = getReadinessConfig(snapshotOptions);
  return config?.preset === 'disabled';
}

// Build the serialize options object that SDKs pass into the browser.
// Merges per-snapshot readiness overrides with the global readiness config.
export function buildSerializeOptions(snapshotOptions = {}) {
  let readiness = getReadinessConfig(snapshotOptions);
  let options = { ...snapshotOptions };
  if (readiness) options.readiness = readiness;
  return options;
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
//   driver.execute_async_script(waitForReadyScript(config, { callback: true }), config);
//
// Graceful degradation:
//   - If PercyDOM.waitForReady is not available (old CLI): resolves immediately
//   - If waitForReady throws: resolves immediately (catch swallows the error)
//   - If readiness times out: waitForReady resolves with { timed_out: true }
export function waitForReadyScript(readinessConfig = {}, { callback = false } = {}) {
  let config = JSON.stringify(readinessConfig);

  let core = `
    if (typeof PercyDOM !== 'undefined' && typeof PercyDOM.waitForReady === 'function') {
      return PercyDOM.waitForReady(${config});
    }
  `;

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
    ${core}
  `;
}

// Legacy helper that combines readiness + serialize into one script.
// Kept for backward compatibility with SDKs that adopted the prior pattern.
export function serializeScript(options = {}, { callback = false } = {}) {
  let opts = JSON.stringify(buildSerializeOptions(options));

  let core = `
    var fn = (typeof PercyDOM.serializeDOMWithReadiness === 'function')
      ? PercyDOM.serializeDOMWithReadiness
      : PercyDOM.serialize;
    var result = Promise.resolve(fn(${opts}));
  `;

  if (callback) {
    return `
      ${core}
      var done = arguments[arguments.length - 1];
      result.then(done).catch(function() { done(PercyDOM.serialize(${opts})); });
    `;
  }

  return `
    ${core}
    return result;
  `;
}

export default waitForReadyScript;
