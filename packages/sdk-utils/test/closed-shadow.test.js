import exposeClosedShadowRoots, { walkCDPNodes } from '../src/closed-shadow.js';

describe('Unit / exposeClosedShadowRoots', () => {
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

  it('exposes closed shadow roots via Runtime.callFunctionOn', async () => {
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
            },
            {
              backendNodeId: 3,
              children: [{
                backendNodeId: 4,
                shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 20, children: [] }]
              }]
            }
          ]
        }
      }),
      'DOM.resolveNode': ({ backendNodeId }) => Promise.resolve({
        object: { objectId: `obj-${backendNodeId}` }
      })
    });

    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, msg => logs.push(msg))).toBe(2);

    let runtimeCalls = cdp.calls.filter(c => c[0] === 'Runtime.callFunctionOn');
    expect(runtimeCalls.length).toBe(2);
    let hostObjectIds = runtimeCalls.map(c => c[1].objectId).sort();
    let shadowObjectIds = runtimeCalls.map(c => c[1].arguments[0].objectId).sort();
    expect(hostObjectIds).toEqual(['obj-2', 'obj-4']);
    expect(shadowObjectIds).toEqual(['obj-10', 'obj-20']);
    expect(logs[0]).toContain('Found 2 closed shadow root');
  });

  it('skips a single bad pair and continues with the rest', async () => {
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
    expect(result).toBe(2);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair'))).toBe(true);
  });

  it('logs and continues when callFunctionOn rejects on one pair', async () => {
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
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(2);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair: detached'))).toBe(true);
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
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(1);
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
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(1);
    expect(logs.some(m => m.includes('Skipping a closed shadow pair: cfo-string'))).toBe(true);
  });

  it('swallows DOM.disable errors in the finally cleanup', async () => {
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({ root: { backendNodeId: 1 } }),
      'DOM.disable': () => Promise.reject(new Error('disable failed'))
    });
    expect(await exposeClosedShadowRoots(cdp)).toBe(0);
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
});

describe('Unit / walkCDPNodes', () => {
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

  it('caps recursion at MAX_SHADOW_DEPTH (10)', () => {
    // Build a chain of nested closed shadow hosts. Without the depth cap a
    // long chain would record one pair per level; with the cap recursion
    // bottoms out and the tail of the chain is dropped.
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
    expect(pairs.length).toBeLessThanOrEqual(10);
    expect(pairs.length).toBeGreaterThan(0);
  });
});
