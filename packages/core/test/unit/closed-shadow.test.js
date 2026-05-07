import exposeClosedShadowRoots, { walkCDPNodes } from '../../src/closed-shadow.js';

describe('Unit / core / exposeClosedShadowRoots', () => {
  function makeCdp(handlers) {
    let calls = [];
    return {
      calls,
      send: (method, params) => {
        calls.push([method, params]);
        let h = handlers[method];
        if (typeof h === 'function') return h(params);
        return Promise.resolve(h ?? {});
      }
    };
  }

  it('returns -1 for invalid cdp inputs', async () => {
    expect(await exposeClosedShadowRoots(null)).toBe(-1);
    expect(await exposeClosedShadowRoots({})).toBe(-1);
    expect(await exposeClosedShadowRoots({ send: 'not a function' })).toBe(-1);
  });

  it('returns 0 and disables DOM domain when no closed shadows exist', async () => {
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          children: [
            { backendNodeId: 2, children: [] },
            { backendNodeId: 3, shadowRoots: [{ shadowRootType: 'open', backendNodeId: 4 }] }
          ]
        }
      })
    });
    expect(await exposeClosedShadowRoots(cdp)).toBe(0);
    expect(cdp.calls.find(c => c[0] === 'DOM.disable')).toBeDefined();
  });

  it('exposes closed shadow roots via Runtime.callFunctionOn (per-realm install)', async () => {
    // The stamp function body must reference ownerDocument.defaultView so
    // hosts in any realm install the WeakMap on the right window.
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          children: [
            {
              backendNodeId: 2,
              shadowRoots: [
                { shadowRootType: 'closed', backendNodeId: 10, children: [] },
                { shadowRootType: 'open', backendNodeId: 11, children: [] }
              ]
            }
          ]
        }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      })
    });

    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, msg => logs.push(msg))).toBe(1);

    let runtimeCalls = cdp.calls.filter(c => c[0] === 'Runtime.callFunctionOn');
    expect(runtimeCalls.length).toBe(1);
    expect(runtimeCalls[0][1].objectId).toBe('obj-2');
    expect(runtimeCalls[0][1].arguments[0].objectId).toBe('obj-10');
    expect(runtimeCalls[0][1].functionDeclaration).toContain('ownerDocument.defaultView');
    expect(runtimeCalls[0][1].functionDeclaration).toContain('__percyClosedShadowRoots');

    // No standalone Runtime.evaluate to install the WeakMap — install is
    // bundled into the per-pair stamp now.
    expect(cdp.calls.find(c => c[0] === 'Runtime.evaluate')).toBeUndefined();
    expect(logs[0]).toContain('Found 1 closed shadow root');
  });

  it('returns the count of successfully stamped pairs, not just discovered', async () => {
    // 2 pairs discovered; second callFunctionOn rejects. Return value
    // reflects only the 1 that succeeded.
    let cfoCalls = 0;
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          shadowRoots: [
            { shadowRootType: 'closed', backendNodeId: 10 },
            { shadowRootType: 'closed', backendNodeId: 20 }
          ]
        }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      }),
      'Runtime.callFunctionOn': () => {
        cfoCalls++;
        if (cfoCalls === 1) return Promise.reject(new Error('detached'));
        return Promise.resolve({});
      }
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(1);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair: detached'))).toBe(true);
  });

  it('returns 0 when every stamp fails', async () => {
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 10 }]
        }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      }),
      'Runtime.callFunctionOn': () => Promise.reject(new Error('all bad'))
    });
    expect(await exposeClosedShadowRoots(cdp)).toBe(0);
  });

  it('skips a single bad resolveNode pair and continues with the rest', async () => {
    let resolveCalls = 0;
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          shadowRoots: [
            { shadowRootType: 'closed', backendNodeId: 100 },
            { shadowRootType: 'closed', backendNodeId: 200 }
          ]
        }
      }),
      'DOM.resolveNode': () => {
        resolveCalls++;
        if (resolveCalls === 1) return Promise.reject(new Error('node detached'));
        return Promise.resolve({ object: { objectId: `obj-${resolveCalls}` } });
      }
    });

    let logs = [];
    let result = await exposeClosedShadowRoots(cdp, msg => logs.push(msg));
    // Only one pair survived resolveNode → 1 stamp succeeded.
    expect(result).toBe(1);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair'))).toBe(true);
  });

  it('returns -1 and logs when DOM.enable / DOM.getDocument throws', async () => {
    let cdp = makeCdp({
      'DOM.enable': () => Promise.reject(new Error('CDP domain unavailable'))
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, msg => logs.push(msg))).toBe(-1);
    expect(logs.some(m => m.includes('CDP domain unavailable'))).toBe(true);
  });

  it('uses a default no-op log when no callback is supplied', async () => {
    let cdp = makeCdp({ 'DOM.enable': () => Promise.reject(new Error('exercise default log')) });
    expect(await exposeClosedShadowRoots(cdp)).toBe(-1);
  });

  it('tolerates non-Error thrown values in the catch path', async () => {
    const nonErrorReason = 'plain string';
    let cdp = makeCdp({ 'DOM.enable': () => Promise.reject(nonErrorReason) });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(-1);
    expect(logs[0]).toContain('plain string');
  });

  it('tolerates a non-Error thrown by DOM.resolveNode (per-pair catch)', async () => {
    const nonErrorReason = 'detached';
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 100 }]
        }
      }),
      'DOM.resolveNode': () => Promise.reject(nonErrorReason)
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(0);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair: detached'))).toBe(true);
  });

  it('tolerates a non-Error thrown by Runtime.callFunctionOn (per-pair catch)', async () => {
    const nonErrorReason = 'cfo-string';
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: {
          backendNodeId: 1,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 100 }]
        }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({ object: { objectId: `obj-${backendNodeId}` } }),
      'Runtime.callFunctionOn': () => Promise.reject(nonErrorReason)
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(0);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair: cfo-string'))).toBe(true);
  });

  it('logs (rather than swallowing silently) when DOM.disable rejects in finally', async () => {
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({ root: { backendNodeId: 1 } }),
      'DOM.disable': () => Promise.reject(new Error('disable failed'))
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(0);
    expect(logs.some(m => m.includes('DOM.disable failed') && m.includes('disable failed'))).toBe(true);
  });

  it('tolerates a non-Error thrown by DOM.disable in finally', async () => {
    const nonErrorReason = 'disable-string';
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({ root: { backendNodeId: 1 } }),
      'DOM.disable': () => Promise.reject(nonErrorReason)
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(0);
    expect(logs.some(m => m.includes('DOM.disable failed') && m.includes('disable-string'))).toBe(true);
  });

  it('processes more pairs than the batch size in multiple passes', async () => {
    const shadowRoots = [];
    for (let i = 0; i < 20; i++) {
      shadowRoots.push({ shadowRootType: 'closed', backendNodeId: 100 + i });
    }
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({
        root: { backendNodeId: 1, shadowRoots }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      })
    });
    expect(await exposeClosedShadowRoots(cdp)).toBe(20);
    let cfoCalls = cdp.calls.filter(c => c[0] === 'Runtime.callFunctionOn');
    expect(cfoCalls.length).toBe(20);
  });

  it('rejects concurrent invocations on the same session', async () => {
    // First invocation parks at DOM.getDocument; second invocation arrives,
    // sees the in-flight guard, and bails immediately with -1.
    let release;
    let getDocPromise = new Promise(resolve => { release = resolve; });
    let cdp = makeCdp({
      'DOM.getDocument': () => getDocPromise.then(() => ({
        root: {
          backendNodeId: 1,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 10 }]
        }
      })),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      })
    });

    let logs = [];
    let first = exposeClosedShadowRoots(cdp, m => logs.push(m));
    // Yield so the first call sets the in-flight guard before the second starts.
    await Promise.resolve();
    let second = exposeClosedShadowRoots(cdp, m => logs.push(m));
    expect(await second).toBe(-1);
    expect(logs.some(m => m.includes('Skipping concurrent closed-shadow CDP discovery'))).toBe(true);

    release();
    expect(await first).toBe(1);

    // After the first call finishes, the guard is cleared — a fresh invocation
    // proceeds normally.
    let third = await exposeClosedShadowRoots(cdp);
    expect(third).toBe(1);
  });
});

describe('Unit / core / walkCDPNodes', () => {
  it('does nothing for null/undefined', () => {
    let pairs = [];
    walkCDPNodes(null, pairs);
    walkCDPNodes(undefined, pairs);
    expect(pairs).toEqual([]);
  });

  it('records closed pairs and recurses into shadow + child trees', () => {
    let pairs = [];
    walkCDPNodes({
      backendNodeId: 1,
      shadowRoots: [
        {
          shadowRootType: 'closed',
          backendNodeId: 10,
          children: [{
            backendNodeId: 11,
            shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 12 }]
          }]
        }
      ],
      children: [
        { backendNodeId: 2, shadowRoots: [{ shadowRootType: 'open', backendNodeId: 20 }] }
      ]
    }, pairs);
    expect(pairs).toEqual([
      { hostBackendNodeId: 1, shadowBackendNodeId: 10 },
      { hostBackendNodeId: 11, shadowBackendNodeId: 12 }
    ]);
  });

  it('descends into iframe contentDocument from pierce: true', () => {
    let pairs = [];
    walkCDPNodes({
      backendNodeId: 1,
      children: [{
        backendNodeId: 2,
        nodeName: 'IFRAME',
        contentDocument: {
          backendNodeId: 3,
          children: [{
            backendNodeId: 4,
            shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 5 }]
          }]
        }
      }]
    }, pairs);
    expect(pairs).toEqual([
      { hostBackendNodeId: 4, shadowBackendNodeId: 5 }
    ]);
  });

  it('does NOT count plain children toward the depth budget', () => {
    // 30 plain children deep, then a closed shadow root at the bottom.
    // Without the boundary-only depth rule a 10-level plain-child cap would
    // miss this; the new rule only increments depth on shadow/iframe
    // boundary crossings, so the shadow at the bottom is still captured.
    let leaf = {
      backendNodeId: 9999,
      shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 10000 }]
    };
    for (let i = 0; i < 30; i++) {
      leaf = { backendNodeId: 1000 + i, children: [leaf] };
    }
    let pairs = [];
    walkCDPNodes(leaf, pairs);
    expect(pairs).toEqual([
      { hostBackendNodeId: 9999, shadowBackendNodeId: 10000 }
    ]);
  });

  it('caps shadow boundary recursion at MAX_SHADOW_DEPTH (10)', () => {
    // Build a chain of nested closed shadow hosts. Each shadow boundary
    // increments depth, so a 30-link chain truncates at 10 pairs.
    let leaf = { backendNodeId: 9999 };
    for (let i = 0; i < 30; i++) {
      leaf = {
        backendNodeId: 1000 + i,
        shadowRoots: [{
          shadowRootType: 'closed',
          backendNodeId: 2000 + i,
          children: [leaf]
        }]
      };
    }
    let pairs = [];
    walkCDPNodes(leaf, pairs);
    expect(pairs.length).toBe(10);
  });
});
