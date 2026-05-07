// SDK-side closed-shadow capture for SDK plugins (puppeteer, playwright,
// cypress, selenium-chrome, etc.) to import. A near-identical copy lives
// in @percy/core for the CLI. Kept duplicated rather than cross-depended
// so @percy/core doesn't pull in this SDK-facing package.
//
// Discovers closed shadow roots in the live page and exposes them to
// PercyDOM.serialize() via the `window.__percyClosedShadowRoots` WeakMap
// that clone-dom.js reads.
//
// Closed shadow roots are inaccessible from JavaScript
// (`element.shadowRoot === null`), but Chrome DevTools Protocol's DOM domain
// can pierce them. We get the full DOM tree with `pierce: true`, walk it to
// collect every closed-shadow host/root pair, resolve both to JS object
// references via `DOM.resolveNode`, then call `Runtime.callFunctionOn` to
// store the mapping in a per-document WeakMap that PercyDOM.serialize already
// knows how to read.
//
// Works for any caller that has a CDP session-like object exposing
// `send(method, params) => Promise`:
//   - Puppeteer:    `await page.target().createCDPSession()`
//   - Playwright:   `await context.newCDPSession(page)`
//   - Selenium:     `await driver.getDevTools()` (Chromium only)
//   - Percy CLI:    Percy's own session.send wrapper
//
// Returns the number of closed shadow roots exposed (0 if none, -1 on error).
// Errors are swallowed and surfaced via the optional `log` callback —
// closed-shadow capture is best-effort and must never break a snapshot run.

const DEFAULT_LOG = () => {};

export async function exposeClosedShadowRoots(cdp, log = DEFAULT_LOG) {
  if (!cdp || typeof cdp.send !== 'function') return -1;

  let domEnabled = false;
  try {
    await cdp.send('DOM.enable');
    domEnabled = true;

    const { root } = await cdp.send('DOM.getDocument', {
      depth: -1,
      pierce: true
    });

    const closedPairs = [];
    walkCDPNodes(root, closedPairs);

    if (closedPairs.length === 0) {
      return 0;
    }

    log(`Found ${closedPairs.length} closed shadow root(s), exposing via CDP`);

    // Create the WeakMap on the page (idempotent — survives multiple calls
    // and matches the global preflight may have installed in CLI mode).
    await cdp.send('Runtime.evaluate', {
      expression:
        'window.__percyClosedShadowRoots = window.__percyClosedShadowRoots || new WeakMap();'
    });

    for (const pair of closedPairs) {
      try {
        const { object: hostObj } = await cdp.send('DOM.resolveNode', {
          backendNodeId: pair.hostBackendNodeId
        });
        const { object: shadowObj } = await cdp.send('DOM.resolveNode', {
          backendNodeId: pair.shadowBackendNodeId
        });
        await cdp.send('Runtime.callFunctionOn', {
          functionDeclaration:
            'function(shadowRoot) { window.__percyClosedShadowRoots.set(this, shadowRoot); }',
          objectId: hostObj.objectId,
          arguments: [{ objectId: shadowObj.objectId }]
        });
      } catch (err) {
        // One bad pair shouldn't abort the whole walk. The host may have
        // detached between getDocument and resolveNode.
        log(`Skipping a closed shadow pair: ${err && err.message ? err.message : err}`);
      }
    }

    return closedPairs.length;
  } catch (err) {
    log(`Could not expose closed shadow roots via CDP: ${err && err.message ? err.message : err}`);
    return -1;
  } finally {
    if (domEnabled) {
      await cdp.send('DOM.disable').catch(() => {});
    }
  }
}

// Walk a DOM.getDocument tree (with pierce: true) collecting every
// closed-shadow host/root pair we encounter. Exported for tests.
export function walkCDPNodes(node, pairs) {
  if (!node) return;
  if (node.shadowRoots) {
    for (const sr of node.shadowRoots) {
      if (sr.shadowRootType === 'closed') {
        pairs.push({
          hostBackendNodeId: node.backendNodeId,
          shadowBackendNodeId: sr.backendNodeId
        });
      }
      walkCDPNodes(sr, pairs);
    }
  }
  if (node.children) {
    for (const child of node.children) walkCDPNodes(child, pairs);
  }
}

export default exposeClosedShadowRoots;
