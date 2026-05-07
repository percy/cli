// SDK-side closed-shadow capture for SDK plugins (puppeteer, playwright,
// cypress, selenium-chrome, etc.) to import. A near-identical copy lives
// in @percy/core for the CLI. Kept duplicated rather than cross-depended
// so @percy/core doesn't pull in this SDK-facing package. A parity test
// asserts the two source files stay byte-equal modulo this header so they
// can't drift.
//
// Discovers closed shadow roots in the live page and exposes them to
// PercyDOM.serialize() via the `window.__percyClosedShadowRoots` WeakMap
// that clone-dom.js reads.
//
// Closed shadow roots are inaccessible from JavaScript
// (`element.shadowRoot === null`), but Chrome DevTools Protocol's DOM domain
// can pierce them. We get the full DOM tree with `pierce: true` (which also
// traverses iframe boundaries — closed shadow hosts inside iframes are
// captured by the same walk), collect every closed-shadow host/root pair,
// resolve both to JS object references via `DOM.resolveNode`, then call
// `Runtime.callFunctionOn` to store the mapping in a per-document WeakMap
// that PercyDOM.serialize already knows how to read.
//
// Works for any caller that has a CDP session-like object exposing
// `send(method, params) => Promise`:
//   - Puppeteer:    `await page.target().createCDPSession()`
//   - Playwright:   `await context.newCDPSession(page)`
//   - Selenium:     `await driver.getDevTools()` (Chromium only)
//   - Percy CLI:    Percy's own session.send wrapper
//
// Side effect: temporarily enables and then disables the CDP `DOM` domain
// on the supplied session. Don't run concurrently with another `DOM`-domain
// consumer on the same session.
//
// Returns the number of closed shadow roots exposed (0 if none, -1 on error).
// Errors are swallowed and surfaced via the optional `log` callback —
// closed-shadow capture is best-effort and must never break a snapshot run.

const DEFAULT_LOG = () => {};

// Mirror HARD_MAX_IFRAME_DEPTH from @percy/dom serialize-frames so every
// recursive walk in the capture pipeline shares the same ceiling.
const MAX_SHADOW_DEPTH = 10;

// Bound concurrent CDP messages so we don't flood a session with hundreds
// of in-flight resolveNode/callFunctionOn calls when a page has many
// closed shadow hosts.
const CDP_BATCH_SIZE = 8;

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

    // Create the WeakMap on the page (idempotent — survives multiple calls).
    await cdp.send('Runtime.evaluate', {
      expression:
        'window.__percyClosedShadowRoots = window.__percyClosedShadowRoots || new WeakMap();'
    });

    // Phase 1: resolve every backendNodeId → objectId in parallel batches.
    // Within a pair the host and shadow resolveNode calls are independent,
    // so they fan out together; across pairs we batch CDP_BATCH_SIZE at a
    // time to keep in-flight CDP messages bounded.
    const resolved = [];
    for (let i = 0; i < closedPairs.length; i += CDP_BATCH_SIZE) {
      const slice = closedPairs.slice(i, i + CDP_BATCH_SIZE);
      const out = await Promise.all(slice.map(async pair => {
        try {
          const [hostRes, shadowRes] = await Promise.all([
            cdp.send('DOM.resolveNode', { backendNodeId: pair.hostBackendNodeId }),
            cdp.send('DOM.resolveNode', { backendNodeId: pair.shadowBackendNodeId })
          ]);
          return { hostObj: hostRes.object, shadowObj: shadowRes.object };
        } catch (err) {
          // One bad pair shouldn't abort the whole walk. The host may have
          // detached between getDocument and resolveNode.
          log(`Skipping a closed shadow pair: ${err && err.message ? err.message : err}`);
          return null;
        }
      }));
      for (const entry of out) if (entry) resolved.push(entry);
    }

    // Phase 2: stamp the WeakMap, also batched.
    for (let i = 0; i < resolved.length; i += CDP_BATCH_SIZE) {
      const slice = resolved.slice(i, i + CDP_BATCH_SIZE);
      await Promise.all(slice.map(({ hostObj, shadowObj }) =>
        cdp.send('Runtime.callFunctionOn', {
          functionDeclaration:
            'function(shadowRoot) { window.__percyClosedShadowRoots.set(this, shadowRoot); }',
          objectId: hostObj.objectId,
          arguments: [{ objectId: shadowObj.objectId }]
        }).catch(err => {
          log(`Skipping a closed shadow pair: ${err && err.message ? err.message : err}`);
        })
      ));
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
// closed-shadow host/root pair we encounter. `pierce: true` traverses both
// shadow boundaries and iframe `contentDocument` boundaries, so a single
// walk reaches closed shadow hosts inside nested iframes. Recursion is
// bounded at MAX_SHADOW_DEPTH levels to match the iframe ceiling and keep
// pathological pages from blowing the stack. Exported for tests.
export function walkCDPNodes(node, pairs, depth = 0) {
  if (!node || depth >= MAX_SHADOW_DEPTH) return;
  if (node.shadowRoots) {
    for (const sr of node.shadowRoots) {
      if (sr.shadowRootType === 'closed') {
        pairs.push({
          hostBackendNodeId: node.backendNodeId,
          shadowBackendNodeId: sr.backendNodeId
        });
      }
      walkCDPNodes(sr, pairs, depth + 1);
    }
  }
  if (node.children) {
    for (const child of node.children) walkCDPNodes(child, pairs, depth + 1);
  }
  // pierce: true also surfaces iframe content documents on the iframe node;
  // walk those so closed shadow hosts inside iframes are captured too.
  if (node.contentDocument) walkCDPNodes(node.contentDocument, pairs, depth + 1);
}

export default exposeClosedShadowRoots;
