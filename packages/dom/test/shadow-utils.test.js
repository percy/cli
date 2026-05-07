import {
  getRuntime,
  getClosedShadowRoot,
  hasClosedShadowRoot,
  getCustomStateInternals,
  getShadowRoot,
  walkShadowDOM,
  queryShadowAll
} from '../src/shadow-utils';
import { withExample } from './helpers';

describe('shadow-utils', () => {
  describe('getRuntime', () => {
    it('returns the document.defaultView when present', () => {
      expect(getRuntime(document)).toBe(window);
      expect(getRuntime(document.body)).toBe(window);
    });

    it('falls back to global window when node has no ownerDocument or defaultView', () => {
      // A bare object with no ownerDocument and no defaultView lands on the
      // window fallback — covers the typeof-window branch that used to be
      // istanbul-ignored.
      expect(getRuntime({})).toBe(window);
      expect(getRuntime(null)).toBe(window);
    });

    // The non-browser fallback (typeof window === 'undefined') is honestly
    // unreachable in the karma browser runner — kept in the source as a
    // safety net for Node/Worker imports, ignored from coverage there.
  });

  describe('getClosedShadowRoot / hasClosedShadowRoot', () => {
    it('returns null when no preflight WeakMap is installed', () => {
      withExample('<div id="x"></div>', { withShadow: false });
      let el = document.getElementById('x');
      let prev = window.__percyClosedShadowRoots;
      delete window.__percyClosedShadowRoots;
      try {
        expect(getClosedShadowRoot(el)).toBeNull();
        expect(hasClosedShadowRoot(el)).toBe(false);
      } finally {
        if (prev) window.__percyClosedShadowRoots = prev;
      }
    });

    it('reads from the WeakMap when present', () => {
      withExample('<div id="x"></div>', { withShadow: false });
      let el = document.getElementById('x');
      let map = new WeakMap();
      let fakeRoot = { tag: 'fake' };
      map.set(el, fakeRoot);
      let prev = window.__percyClosedShadowRoots;
      window.__percyClosedShadowRoots = map;
      try {
        expect(getClosedShadowRoot(el)).toBe(fakeRoot);
        expect(hasClosedShadowRoot(el)).toBe(true);
      } finally {
        if (prev) {
          window.__percyClosedShadowRoots = prev;
        } else {
          delete window.__percyClosedShadowRoots;
        }
      }
    });
  });

  describe('getCustomStateInternals', () => {
    it('returns null when no preflight WeakMap is installed', () => {
      withExample('<div id="y"></div>', { withShadow: false });
      let el = document.getElementById('y');
      let prev = window.__percyInternals;
      delete window.__percyInternals;
      try {
        expect(getCustomStateInternals(el)).toBeNull();
      } finally {
        if (prev) window.__percyInternals = prev;
      }
    });

    it('reads from the WeakMap when present', () => {
      withExample('<div id="y"></div>', { withShadow: false });
      let el = document.getElementById('y');
      let map = new WeakMap();
      let fakeInternals = { states: new Set(['active']) };
      map.set(el, fakeInternals);
      let prev = window.__percyInternals;
      window.__percyInternals = map;
      try {
        expect(getCustomStateInternals(el)).toBe(fakeInternals);
      } finally {
        if (prev) {
          window.__percyInternals = prev;
        } else {
          delete window.__percyInternals;
        }
      }
    });
  });

  describe('getShadowRoot', () => {
    it('returns host.shadowRoot for open roots', () => {
      withExample('<div id="open-host"></div>', { withShadow: false });
      let host = document.getElementById('open-host');
      let shadow = host.attachShadow({ mode: 'open' });
      expect(getShadowRoot(host)).toBe(shadow);
    });

    it('falls back to the closed-shadow WeakMap when host.shadowRoot is null', () => {
      withExample('<div id="closed-host"></div>', { withShadow: false });
      let host = document.getElementById('closed-host');
      let stub = { tag: 'closed' };
      let map = new WeakMap();
      map.set(host, stub);
      let prev = window.__percyClosedShadowRoots;
      window.__percyClosedShadowRoots = map;
      try {
        expect(getShadowRoot(host)).toBe(stub);
      } finally {
        if (prev) {
          window.__percyClosedShadowRoots = prev;
        } else {
          delete window.__percyClosedShadowRoots;
        }
      }
    });

    it('returns null when neither open nor closed root is available', () => {
      withExample('<div id="bare"></div>', { withShadow: false });
      expect(getShadowRoot(document.getElementById('bare'))).toBeNull();
    });
  });

  describe('walkShadowDOM', () => {
    it('visits the root scope', () => {
      withExample('<div></div>', { withShadow: false });
      let scopes = [];
      walkShadowDOM(document, scope => scopes.push(scope));
      expect(scopes[0]).toBe(document);
    });

    it('descends into shadow hosts marked with data-percy-shadow-host', () => {
      withExample('<div id="sh"></div>', { withShadow: false });
      let host = document.getElementById('sh');
      host.setAttribute('data-percy-shadow-host', '');
      let shadow = host.attachShadow({ mode: 'open' });
      let scopes = [];
      walkShadowDOM(document, scope => scopes.push(scope));
      expect(scopes).toContain(shadow);
    });

    it('returns without recursing when root has no querySelectorAll', () => {
      // Fake "root" — no querySelectorAll. The visit callback fires once,
      // and the recursion guard returns cleanly (no throw).
      let scopes = [];
      let bareRoot = { tag: 'bare' };
      expect(() => walkShadowDOM(bareRoot, scope => scopes.push(scope))).not.toThrow();
      expect(scopes).toEqual([bareRoot]);
    });

    it('skips hosts whose getShadowRoot returns null', () => {
      // Marker present but no shadow root reachable — exercise the
      // "if (shadow) walkShadowDOM(...)" false branch.
      withExample('<div id="ghost"></div>', { withShadow: false });
      let host = document.getElementById('ghost');
      host.setAttribute('data-percy-shadow-host', '');
      // No shadow attached; no WeakMap entry.
      let scopes = [];
      walkShadowDOM(document, scope => scopes.push(scope));
      // Only the document scope should fire — the ghost host produces no inner scope.
      expect(scopes.filter(s => s !== document).length).toBe(0);
    });
  });

  describe('queryShadowAll', () => {
    it('returns matches from root and all shadow descendants', () => {
      withExample('<div id="qsa-host"></div><input id="top-input">', { withShadow: false });
      let host = document.getElementById('qsa-host');
      host.setAttribute('data-percy-shadow-host', '');
      let shadow = host.attachShadow({ mode: 'open' });
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
      shadow.innerHTML = '<input id="inner-input">';

      let inputs = queryShadowAll(document, 'input');
      let ids = inputs.map(i => i.id);
      expect(ids).toContain('top-input');
      expect(ids).toContain('inner-input');
    });

    it('tolerates a scope that throws on the user selector only', () => {
      // Throw only when called with the user's selector (so walkShadowDOM's
      // own [data-percy-shadow-host] query still works); the inner visit's
      // try/catch absorbs the user-selector throw and skips that scope.
      withExample('<div id="thrower"></div>', { withShadow: false });
      let host = document.getElementById('thrower');
      host.setAttribute('data-percy-shadow-host', '');
      let shadow = host.attachShadow({ mode: 'open' });
      let realQSA = shadow.querySelectorAll.bind(shadow);
      shadow.querySelectorAll = (sel) => {
        if (sel === 'input') throw new Error('boom');
        return realQSA(sel);
      };
      expect(() => queryShadowAll(document, 'input')).not.toThrow();
    });
  });
});
