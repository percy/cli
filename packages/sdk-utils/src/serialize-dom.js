import percy from './percy-info.js';

// Returns the readiness config from the Percy CLI config, if present.
// SDKs obtain percy.config via the healthcheck endpoint in isPercyEnabled().
function getReadinessConfig(snapshotOptions) {
  return snapshotOptions?.readiness ||
    percy.config?.snapshot?.readiness;
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
// to serialize the DOM with readiness support.
//
// Uses serializeDOMWithReadiness when available (new CLI) with a
// fallback to serialize (old CLI) for backward compatibility.
//
// The result is always wrapped in Promise.resolve() so it works
// uniformly with both async and sync execution APIs.
//
// Usage in SDKs:
//   // JS SDKs (Puppeteer, Playwright — auto-await):
//   let domSnapshot = await page.evaluate(serializeScript(options));
//
//   // Selenium SDKs (Python, Java, Ruby, .NET — executeAsyncScript):
//   let dom = driver.execute_async_script(
//     serializeScript(options, { callback: true }),
//     options
//   );
export function serializeScript(options = {}, { callback = false } = {}) {
  let opts = JSON.stringify(buildSerializeOptions(options));

  let core = `
    var fn = (typeof PercyDOM.serializeDOMWithReadiness === 'function')
      ? PercyDOM.serializeDOMWithReadiness
      : PercyDOM.serialize;
    var result = Promise.resolve(fn(${opts}));
  `;

  if (callback) {
    // For executeAsyncScript — last argument is the callback
    return `
      ${core}
      var done = arguments[arguments.length - 1];
      result.then(done).catch(function() { done(PercyDOM.serialize(${opts})); });
    `;
  }

  // For page.evaluate / executeScript with auto-await
  return `
    ${core}
    return result;
  `;
}

export default serializeScript;
