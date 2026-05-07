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

  it('returns -1 when given a falsy or invalid cdp', async () => {
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
        // First pair: host resolve fails; second pair: succeed
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

  it('uses the default no-op log when no log callback is supplied', async () => {
    // Hit a code path that actually invokes the log function so DEFAULT_LOG
    // gets exercised (otherwise the no-args default is never called).
    let cdp = makeCdp({
      'DOM.enable': () => Promise.reject(new Error('use default log'))
    });
    // No second arg → uses DEFAULT_LOG. Should not throw.
    expect(await exposeClosedShadowRoots(cdp)).toBe(-1);
  });

  it('tolerates a non-Error thrown value in catch path', async () => {
    const nonErrorReason = 'plain string';
    let cdp = makeCdp({
      'DOM.enable': () => Promise.reject(nonErrorReason)
    });
    let logs = [];
    expect(await exposeClosedShadowRoots(cdp, m => logs.push(m))).toBe(-1);
    expect(logs[0]).toContain('plain string');
  });

  it('tolerates a non-Error thrown by DOM.resolveNode (per-pair catch)', async () => {
    // Exercises the per-pair `err && err.message ? err.message : err` branch
    // where err is a plain string instead of an Error.
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

  it('swallows DOM.disable errors in the finally cleanup', async () => {
    // Hits the `.catch(() => {})` on the DOM.disable send (the trailing
    // cleanup function). DOM.disable rejects after a successful run.
    let cdp = makeCdp({
      'DOM.getDocument': () => Promise.resolve({ root: { backendNodeId: 1 } }),
      'DOM.disable': () => Promise.reject(new Error('disable failed'))
    });
    expect(await exposeClosedShadowRoots(cdp)).toBe(0);
  });
});

describe('Unit / walkCDPNodes', () => {
  it('does nothing for a null/undefined node', () => {
    let pairs = [];
    walkCDPNodes(null, pairs);
    walkCDPNodes(undefined, pairs);
    expect(pairs).toEqual([]);
  });

  it('records closed shadow pairs and recurses into both shadow and child trees', () => {
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
