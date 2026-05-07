// SDK-side closed-shadow capture for SDK plugins (puppeteer, playwright,
// cypress, selenium-chrome, etc.) to import. A near-identical copy lives
// in @percy/core for the CLI. Kept duplicated rather than cross-depended
// so @percy/core doesn't pull in this SDK-facing package. The two files
// are kept manually in sync — this header is the only intentional
// difference.
//
// Discovers closed shadow roots in the live page and exposes them to
// PercyDOM.serialize() via per-document `__percyClosedShadowRoots`
// WeakMaps that clone-dom.js reads through shadow-utils.getRuntime().
//
// Closed shadow roots are inaccessible from JavaScript
// (`element.shadowRoot === null`), but Chrome DevTools Protocol's DOM domain
// can pierce them. We get the full DOM tree with `pierce: true` (which also
// traverses iframe boundaries — closed shadow hosts inside iframes are
// captured by the same walk), collect every closed-shadow host/root pair,
// resolve both to JS object references via `DOM.resolveNode`, then call
// `Runtime.callFunctionOn` to write the mapping. The function body installs
// the WeakMap on the host's *own* `ownerDocument.defaultView` — so a host
// inside an iframe writes into the iframe's realm, where shadow-utils will
// later read it.
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
// consumer on the same session — the helper installs an in-flight guard
// against itself, but can't see other consumers.
//
// Limitation: captures the closed shadow roots present at the time of the
// call. Custom elements that lazy-attach a closed shadow root after this
// returns (e.g. inside `requestIdleCallback` or `IntersectionObserver`)
// won't be captured. The caller is responsible for waiting until the page
// is settled before invoking.
//
// Returns the number of closed shadow roots successfully exposed (0 if none,
// -1 on top-level error). Per-pair errors are swallowed and surfaced via the
// optional `log` callback — closed-shadow capture is best-effort and must
// never break a snapshot run.

const DEFAULT_LOG = () => {};

// Mirror HARD_MAX_IFRAME_DEPTH from @percy/dom serialize-frames so every
// recursive walk in the capture pipeline shares the same ceiling. Counted
// only across shadow / iframe boundary crossings — not plain children —
// otherwise a normal deep DOM (html → body → div → … → custom-element)
// would burn through the budget before reaching any shadow host.
const MAX_SHADOW_DEPTH = 10;

// Bound concurrent CDP messages so we don't flood a session with hundreds
// of in-flight resolveNode/callFunctionOn calls when a page has many
// closed shadow hosts.
const CDP_BATCH_SIZE = 8;

// The function body that installs the WeakMap and writes the host→shadow
// pair. Runs inside Runtime.callFunctionOn with the host as `this`, so
// `this.ownerDocument.defaultView` is the host's *own* realm — the iframe's
// window when the host is inside an iframe.
const STAMP_FUNCTION =
  'function(shadowRoot) {' +
  '  var w = this.ownerDocument && this.ownerDocument.defaultView;' +
  '  if (!w) return;' +
  '  if (!w.__percyClosedShadowRoots) w.__percyClosedShadowRoots = new WeakMap();' +
  '  w.__percyClosedShadowRoots.set(this, shadowRoot);' +
  '}';

// Marker for the in-flight guard — prevents concurrent invocations on the
// same session from racing each other's DOM.enable / DOM.disable lifecycle.
const IN_FLIGHT = Symbol.for('percy.closedShadow.inFlight');

export async function exposeClosedShadowRoots(cdp, log = DEFAULT_LOG) {
  if (!cdp || typeof cdp.send !== 'function') return -1;
  if (cdp[IN_FLIGHT]) {
    log('Skipping concurrent closed-shadow CDP discovery on the same session');
    return -1;
  }
  cdp[IN_FLIGHT] = true;

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

    // Phase 1: resolve every backendNodeId → objectId in parallel batches.
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
          log(`Skipping a closed shadow pair: ${err && err.message ? err.message : err}`);
          return null;
        }
      }));
      for (const entry of out) if (entry) resolved.push(entry);
    }

    // Phase 2: stamp the WeakMap (per-realm), also batched. Track real
    // successes — earlier shapes returned closedPairs.length and overstated
    // success when stamps failed.
    let stamped = 0;
    for (let i = 0; i < resolved.length; i += CDP_BATCH_SIZE) {
      const slice = resolved.slice(i, i + CDP_BATCH_SIZE);
      const results = await Promise.all(slice.map(({ hostObj, shadowObj }) =>
        cdp.send('Runtime.callFunctionOn', {
          functionDeclaration: STAMP_FUNCTION,
          objectId: hostObj.objectId,
          arguments: [{ objectId: shadowObj.objectId }]
        }).then(() => true).catch(err => {
          log(`Skipping a closed shadow pair: ${err && err.message ? err.message : err}`);
          return false;
        })
      ));
      for (const ok of results) if (ok) stamped++;
    }

    return stamped;
  } catch (err) {
    log(`Could not expose closed shadow roots via CDP: ${err && err.message ? err.message : err}`);
    return -1;
  } finally {
    if (domEnabled) {
      await cdp.send('DOM.disable').catch(disableErr => {
        log(`DOM.disable failed during closed-shadow cleanup: ${disableErr && disableErr.message ? disableErr.message : disableErr}`);
      });
    }
    delete cdp[IN_FLIGHT];
  }
}

// Walk a DOM.getDocument tree (with pierce: true) collecting every
// closed-shadow host/root pair we encounter. `pierce: true` traverses both
// shadow boundaries and iframe `contentDocument` boundaries, so a single
// walk reaches closed shadow hosts inside nested iframes. Recursion is
// bounded at MAX_SHADOW_DEPTH levels — counted only across shadow/iframe
// boundary crossings, not plain children — so a deep ordinary DOM doesn't
// exhaust the budget before reaching its shadow hosts. Exported for tests.
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
      // crossing a shadow boundary — increment depth
      walkCDPNodes(sr, pairs, depth + 1);
    }
  }
  if (node.children) {
    // plain children — same realm, same depth
    for (const child of node.children) walkCDPNodes(child, pairs, depth);
  }
  // pierce: true surfaces iframe content documents on the iframe node;
  // crossing into the iframe's realm — increment depth.
  if (node.contentDocument) walkCDPNodes(node.contentDocument, pairs, depth + 1);
}

export default exposeClosedShadowRoots;
