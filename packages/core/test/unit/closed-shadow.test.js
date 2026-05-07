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
    expect(runtimeCalls[0][1].objectId).toBe('obj-2');
    expect(runtimeCalls[0][1].arguments[0].objectId).toBe('obj-10');
    expect(runtimeCalls[1][1].objectId).toBe('obj-4');
    expect(runtimeCalls[1][1].arguments[0].objectId).toBe('obj-20');
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
    expect(await exposeClosedShadowRoots(cdp, msg => logs.push(msg))).toBe(2);
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
    // The CDP send rejects with a plain string (not an Error) — the catch
    // path must format the message via the `err && err.message ? .. : err`
    // fallback rather than throw on `.message` of a non-Object.
    const nonErrorReason = 'plain string';
    let cdp = makeCdp({ 'DOM.enable': () => Promise.reject(nonErrorReason) });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(-1);
    expect(logs[0]).toContain('plain string');
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
});
