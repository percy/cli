// Direct unit tests for readiness.js internal helpers.
//
// These helpers were previously covered only indirectly through
// MutationObserver-driven integration tests and marked with
// `istanbul ignore next`. They are pure and deterministic, so testing
// them directly gives real coverage and lets us drop the ignores.

import {
  isLayoutMutation,
  hasLayoutStyleChange,
  parseStyleProps,
  normalizeOptions,
  createAbortHandle
} from '../src/readiness';

describe('readiness helpers', () => {
  describe('parseStyleProps', () => {
    it('returns empty object for empty/undefined input', () => {
      expect(parseStyleProps('')).toEqual({});
      expect(parseStyleProps(undefined)).toEqual({});
      expect(parseStyleProps(null)).toEqual({});
    });

    it('parses a single declaration', () => {
      expect(parseStyleProps('color: red')).toEqual({ color: 'red' });
    });

    it('parses multiple declarations and trims whitespace', () => {
      expect(parseStyleProps('  width: 100px ;  height : 20px  '))
        .toEqual({ width: '100px', height: '20px' });
    });

    it('lowercases keys but preserves value case', () => {
      expect(parseStyleProps('Color: Red'))
        .toEqual({ color: 'Red' });
    });

    it('ignores declarations without a colon', () => {
      expect(parseStyleProps('color red; width: 10px'))
        .toEqual({ width: '10px' });
    });

    it('ignores empty keys', () => {
      expect(parseStyleProps(':red; width: 10px'))
        .toEqual({ width: '10px' });
    });

    it('ignores whitespace-only keys (covers the !key branch)', () => {
      // `   : red` has i > 0 but trims to empty — exercises the
      // `if (key)` falsy branch.
      expect(parseStyleProps('   : red; width: 10px'))
        .toEqual({ width: '10px' });
    });

    it('keeps the last value when a key is declared twice', () => {
      // parseStyleProps is a simple last-wins parser — matches loose
      // browser behavior for duplicate inline declarations.
      expect(parseStyleProps('width: 10px; width: 20px'))
        .toEqual({ width: '20px' });
    });
  });

  describe('hasLayoutStyleChange', () => {
    it('returns false when styles are identical', () => {
      expect(hasLayoutStyleChange('color: red', 'color: red')).toBe(false);
    });

    it('returns false when only non-layout properties change', () => {
      expect(hasLayoutStyleChange('color: red', 'color: blue')).toBe(false);
      expect(hasLayoutStyleChange('background: red', 'background: blue')).toBe(false);
    });

    it('returns true when a layout property changes', () => {
      expect(hasLayoutStyleChange('width: 10px', 'width: 20px')).toBe(true);
      expect(hasLayoutStyleChange('display: block', 'display: none')).toBe(true);
      expect(hasLayoutStyleChange('margin: 0', 'margin: 10px')).toBe(true);
    });

    it('returns true when a layout property is added or removed', () => {
      expect(hasLayoutStyleChange('', 'width: 20px')).toBe(true);
      expect(hasLayoutStyleChange('width: 20px', '')).toBe(true);
    });

    it('returns false when a non-layout property is added while layout props are stable', () => {
      expect(hasLayoutStyleChange('width: 10px', 'width: 10px; color: red')).toBe(false);
    });

    it('detects prefix-matched layout props (min-, max-, margin, padding, flex, grid, z-index)', () => {
      expect(hasLayoutStyleChange('min-width: 0', 'min-width: 100px')).toBe(true);
      expect(hasLayoutStyleChange('max-height: none', 'max-height: 200px')).toBe(true);
      expect(hasLayoutStyleChange('padding-left: 0', 'padding-left: 10px')).toBe(true);
      expect(hasLayoutStyleChange('flex: 1', 'flex: 2')).toBe(true);
      expect(hasLayoutStyleChange('z-index: 1', 'z-index: 2')).toBe(true);
    });
  });

  describe('isLayoutMutation', () => {
    // Build a minimal mutation-record-like object — the helper only reads
    // these fields and never calls MutationObserver APIs directly.
    function mutation({ type, attributeName, oldValue, targetAttr, tagName }) {
      return {
        type,
        attributeName,
        oldValue,
        target: {
          getAttribute: () => targetAttr ?? '',
          tagName: tagName ?? 'DIV'
        }
      };
    }

    it('returns true for any childList mutation', () => {
      expect(isLayoutMutation(mutation({ type: 'childList' }))).toBe(true);
    });

    it('returns false for data-* attribute changes', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes', attributeName: 'data-foo'
      }))).toBe(false);
    });

    it('returns false for aria-* attribute changes', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes', attributeName: 'aria-hidden'
      }))).toBe(false);
    });

    it('returns true for layout-affecting style changes', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes',
        attributeName: 'style',
        oldValue: 'width: 10px',
        targetAttr: 'width: 20px'
      }))).toBe(true);
    });

    it('handles null/undefined oldValue and missing target style', () => {
      // Covers the `mutation.oldValue || ''` and `target.getAttribute(...) || ''`
      // fallback branches when the browser reports no prior value.
      expect(isLayoutMutation({
        type: 'attributes',
        attributeName: 'style',
        oldValue: null,
        target: { getAttribute: () => null, tagName: 'DIV' }
      })).toBe(false);

      expect(isLayoutMutation({
        type: 'attributes',
        attributeName: 'style',
        oldValue: undefined,
        target: { getAttribute: () => 'width: 20px', tagName: 'DIV' }
      })).toBe(true);
    });

    it('returns false for non-layout style changes', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes',
        attributeName: 'style',
        oldValue: 'color: red',
        targetAttr: 'color: blue'
      }))).toBe(false);
    });

    it('treats href on <a> as NOT layout-affecting', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes', attributeName: 'href', tagName: 'A'
      }))).toBe(false);
    });

    it('treats href on <link> as layout-affecting', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes', attributeName: 'href', tagName: 'LINK'
      }))).toBe(true);
    });

    it('returns true for known layout attributes (class/width/height/src)', () => {
      for (let attr of ['class', 'width', 'height', 'src', 'display', 'visibility', 'position']) {
        expect(isLayoutMutation(mutation({
          type: 'attributes', attributeName: attr
        }))).toBe(true);
      }
    });

    it('returns false for unknown attributes', () => {
      expect(isLayoutMutation(mutation({
        type: 'attributes', attributeName: 'title'
      }))).toBe(false);
    });

    it('returns false for unsupported mutation types', () => {
      expect(isLayoutMutation(mutation({ type: 'characterData' }))).toBe(false);
    });
  });

  describe('normalizeOptions', () => {
    it('returns an object with all keys undefined when given no options', () => {
      let n = normalizeOptions();
      expect(n.preset).toBeUndefined();
      expect(n.stability_window_ms).toBeUndefined();
      expect(n.timeout_ms).toBeUndefined();
    });

    it('prefers camelCase and maps to snake_case', () => {
      let n = normalizeOptions({
        stabilityWindowMs: 100,
        networkIdleWindowMs: 200,
        timeoutMs: 3000,
        imageReady: true,
        fontReady: false,
        jsIdle: true,
        readySelectors: ['.a'],
        notPresentSelectors: ['.b'],
        maxTimeoutMs: 5000
      });
      expect(n).toEqual({
        preset: undefined,
        stability_window_ms: 100,
        network_idle_window_ms: 200,
        timeout_ms: 3000,
        image_ready: true,
        font_ready: false,
        js_idle: true,
        ready_selectors: ['.a'],
        not_present_selectors: ['.b'],
        max_timeout_ms: 5000
      });
    });

    it('accepts snake_case directly', () => {
      let n = normalizeOptions({
        stability_window_ms: 100,
        timeout_ms: 3000
      });
      expect(n.stability_window_ms).toBe(100);
      expect(n.timeout_ms).toBe(3000);
    });

    it('prefers camelCase when both are provided', () => {
      let n = normalizeOptions({
        stabilityWindowMs: 100,
        stability_window_ms: 999
      });
      expect(n.stability_window_ms).toBe(100);
    });

    it('does not coerce falsy user values (0, false) to undefined', () => {
      let n = normalizeOptions({
        stabilityWindowMs: 0,
        fontReady: false,
        imageReady: false
      });
      expect(n.stability_window_ms).toBe(0);
      expect(n.font_ready).toBe(false);
      expect(n.image_ready).toBe(false);
    });

    it('passes preset through', () => {
      expect(normalizeOptions({ preset: 'strict' }).preset).toBe('strict');
    });
  });

  describe('createAbortHandle', () => {
    it('starts with value === false and no callbacks fired', () => {
      let a = createAbortHandle();
      expect(a.value).toBe(false);
    });

    it('flips value to true and invokes all registered callbacks on abort', () => {
      let a = createAbortHandle();
      let calls = [];
      a.onAbort(() => calls.push('a'));
      a.onAbort(() => calls.push('b'));
      a.abort();
      expect(a.value).toBe(true);
      expect(calls).toEqual(['a', 'b']);
    });

    it('does not re-invoke callbacks on a second abort()', () => {
      let a = createAbortHandle();
      let count = 0;
      a.onAbort(() => count++);
      a.abort();
      a.abort();
      expect(count).toBe(1);
    });

    it('callbacks registered after abort() are not invoked by the initial abort', () => {
      let a = createAbortHandle();
      a.abort();
      let late = 0;
      a.onAbort(() => late++);
      // Callback is stored but will only fire on a future abort() call —
      // and the handle's internal callbacks list was reset, so the late
      // callback is orphaned. This just asserts current behavior.
      expect(late).toBe(0);
    });
  });
});
